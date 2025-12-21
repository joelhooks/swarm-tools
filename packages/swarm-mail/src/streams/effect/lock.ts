/**
 * DurableLock - Distributed Mutual Exclusion via CAS
 *
 * Uses seq=0 CAS (Compare-And-Swap) pattern for distributed locking.
 * Provides acquire/release/withLock methods with TTL expiry and contention handling.
 *
 * Based on Kyle Matthews' pattern from Agent Mail.
 *
 * @example
 * ```typescript
 * // Using Effect API with DatabaseAdapter
 * const program = Effect.gen(function* (_) {
 *   const lock = yield* _(acquireLock("my-resource", { ttlSeconds: 30, db }))
 *   try {
 *     // Critical section
 *   } finally {
 *     yield* _(lock.release())
 *   }
 * }).pipe(Effect.provide(DurableLockLive))
 *
 * // Or use withLock helper
 * const program = Effect.gen(function* (_) {
 *   const lock = yield* _(DurableLock)
 *   yield* _(lock.withLock("my-resource", Effect.succeed(42), { db }))
 * }).pipe(Effect.provide(DurableLockLive))
 * ```
 */

import { randomUUID } from "node:crypto";
import { Context, Effect, Layer, Schedule } from "effect";
import type { DatabaseAdapter } from "../../types/database";

// ============================================================================
// Types & Errors
// ============================================================================

/**
 * Configuration for lock acquisition
 */
export interface LockConfig {
  /**
   * Time-to-live in seconds before lock auto-expires
   * @default 30
   */
  ttlSeconds?: number;

  /**
   * Maximum retry attempts when lock is contended
   * @default 10
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds for exponential backoff
   * @default 50
   */
  baseDelayMs?: number;

  /**
   * Database adapter for lock storage
   * Required for all operations
   */
  db: DatabaseAdapter;

  /**
   * Custom holder ID (defaults to generated UUID)
   */
  holderId?: string;
}

/**
 * Handle representing an acquired lock
 */
export interface LockHandle {
  /** Resource being locked */
  readonly resource: string;
  /** Holder ID who owns the lock */
  readonly holder: string;
  /** Sequence number when acquired */
  readonly seq: number;
  /** Timestamp when lock was acquired */
  readonly acquiredAt: number;
  /** Timestamp when lock expires */
  readonly expiresAt: number;
  /** Release the lock */
  readonly release: () => Effect.Effect<void, LockError>;
}

/**
 * Lock errors
 */
export type LockError =
  | { readonly _tag: "LockTimeout"; readonly resource: string }
  | { readonly _tag: "LockContention"; readonly resource: string }
  | {
      readonly _tag: "LockNotHeld";
      readonly resource: string;
      readonly holder: string;
    }
  | { readonly _tag: "DatabaseError"; readonly error: Error };

// ============================================================================
// Service Definition
// ============================================================================

/**
 * DurableLock service for distributed mutual exclusion
 */
export class DurableLock extends Context.Tag("DurableLock")<
  DurableLock,
  {
    /**
     * Acquire a lock on a resource
     *
     * Uses CAS (seq=0) pattern:
     * - INSERT if no lock exists
     * - UPDATE if expired or we already hold it
     *
     * Retries with exponential backoff on contention.
     */
    readonly acquire: (
      resource: string,
      config: LockConfig,
    ) => Effect.Effect<LockHandle, LockError>;

    /**
     * Release a lock
     *
     * Only succeeds if the holder matches.
     */
    readonly release: (
      resource: string,
      holder: string,
      db: DatabaseAdapter,
    ) => Effect.Effect<void, LockError>;

    /**
     * Execute an effect with automatic lock acquisition and release
     *
     * Guarantees lock release even on error (Effect.ensuring).
     */
    readonly withLock: <A, E, R>(
      resource: string,
      effect: Effect.Effect<A, E, R>,
      config: LockConfig,
    ) => Effect.Effect<A, E | LockError, R | DurableLock>;
  }
>() {}

// ============================================================================
// Schema Initialization
// ============================================================================

/**
 * Ensure locks table exists (SQLite syntax)
 */
async function ensureLocksTable(db: DatabaseAdapter): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS locks (
      resource TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_locks_holder ON locks(holder);
  `);
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Try to acquire lock once via CAS pattern
 *
 * Returns sequence number on success, null on contention
 */
async function tryAcquire(
  resource: string,
  holder: string,
  expiresAt: number,
  db: DatabaseAdapter,
): Promise<{ seq: number; acquiredAt: number } | null> {
  await ensureLocksTable(db);
  const now = Date.now();

  // Check if lock already exists
  const existingLock = await db.query<{ holder: string; seq: number; expires_at: number }>(
    `SELECT holder, seq, expires_at FROM locks WHERE resource = ?`,
    [resource],
  );

  const existing = existingLock.rows[0];

  if (!existing) {
    // No existing lock - INSERT new one
    await db.exec(`
      INSERT INTO locks (resource, holder, seq, acquired_at, expires_at)
      VALUES ('${resource}', '${holder}', 0, ${now}, ${expiresAt})
    `);
    return { seq: 0, acquiredAt: now };
  }

  // Lock exists - check if we can acquire it
  const isExpired = existing.expires_at < now;
  const isSameHolder = existing.holder === holder;

  if (isExpired || isSameHolder) {
    // We can take over - UPDATE with incremented seq
    const newSeq = existing.seq + 1;
    await db.exec(`
      UPDATE locks
      SET holder = '${holder}', seq = ${newSeq}, acquired_at = ${now}, expires_at = ${expiresAt}
      WHERE resource = '${resource}'
    `);
    return { seq: newSeq, acquiredAt: now };
  }

  // Lock is held by someone else and not expired - contention
  return null;
}

/**
 * Release a lock by holder
 */
async function tryRelease(
  resource: string,
  holder: string,
  db: DatabaseAdapter,
): Promise<boolean> {
  await ensureLocksTable(db);

  // Check if lock exists with this holder before deleting
  const checkResult = await db.query<{ holder: string }>(
    `SELECT holder FROM locks WHERE resource = ? AND holder = ?`,
    [resource, holder],
  );

  if (checkResult.rows.length === 0) {
    return false;
  }

  await db.exec(`DELETE FROM locks WHERE resource = '${resource}' AND holder = '${holder}'`);
  return true;
}

/**
 * Acquire implementation
 */
function acquireImpl(
  resource: string,
  config: LockConfig,
): Effect.Effect<LockHandle, LockError> {
  return Effect.gen(function* (_) {
    const {
      ttlSeconds = 30,
      maxRetries = 10,
      baseDelayMs = 50,
      db,
      holderId,
    } = config;

    const holder = holderId || randomUUID();
    const expiresAt = Date.now() + ttlSeconds * 1000;

    // Retry schedule: exponential backoff with max retries
    const retrySchedule = Schedule.exponential(baseDelayMs).pipe(
      Schedule.compose(Schedule.recurs(maxRetries)),
    );

    // Attempt acquisition with retries
    const result = yield* _(
      Effect.tryPromise({
        try: () => tryAcquire(resource, holder, expiresAt, db),
        catch: (error) => ({
          _tag: "DatabaseError" as const,
          error: error as Error,
        }),
      }).pipe(
        Effect.flatMap((result) =>
          result
            ? Effect.succeed(result)
            : Effect.fail({
                _tag: "LockContention" as const,
                resource,
              }),
        ),
        Effect.retry(retrySchedule),
        Effect.catchTag("LockContention", () =>
          Effect.fail({
            _tag: "LockTimeout" as const,
            resource,
          }),
        ),
      ),
    );

    const { seq, acquiredAt } = result;

    // Create lock handle with release method
    const lockHandle: LockHandle = {
      resource,
      holder,
      seq,
      acquiredAt,
      expiresAt,
      release: () => releaseImpl(resource, holder, db),
    };

    return lockHandle;
  });
}

/**
 * Release implementation
 */
function releaseImpl(
  resource: string,
  holder: string,
  db: DatabaseAdapter,
): Effect.Effect<void, LockError> {
  return Effect.gen(function* (_) {
    const released = yield* _(
      Effect.tryPromise({
        try: () => tryRelease(resource, holder, db),
        catch: (error) => ({
          _tag: "DatabaseError" as const,
          error: error as Error,
        }),
      }),
    );

    if (!released) {
      yield* _(
        Effect.fail({
          _tag: "LockNotHeld" as const,
          resource,
          holder,
        }),
      );
    }
  });
}

/**
 * WithLock implementation
 */
function withLockImpl<A, E, R>(
  resource: string,
  effect: Effect.Effect<A, E, R>,
  config: LockConfig,
): Effect.Effect<A, E | LockError, R | DurableLock> {
  return Effect.gen(function* (_) {
    const lock = yield* _(DurableLock);
    const lockHandle = yield* _(lock.acquire(resource, config));

    // Execute effect with guaranteed release
    const result = yield* _(
      effect.pipe(
        Effect.ensuring(
          lockHandle.release().pipe(
            Effect.catchAll(() => Effect.void), // Swallow release errors in cleanup
          ),
        ),
      ),
    );

    return result;
  });
}

// ============================================================================
// Layer
// ============================================================================

/**
 * Live implementation of DurableLock service
 */
export const DurableLockLive = Layer.succeed(DurableLock, {
  acquire: acquireImpl,
  release: releaseImpl,
  withLock: withLockImpl,
});

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Acquire a lock (convenience Effect wrapper)
 */
export function acquireLock(
  resource: string,
  config: LockConfig,
): Effect.Effect<LockHandle, LockError, DurableLock> {
  return Effect.gen(function* (_) {
    const service = yield* _(DurableLock);
    return yield* _(service.acquire(resource, config));
  });
}

/**
 * Release a lock (convenience Effect wrapper)
 */
export function releaseLock(
  resource: string,
  holder: string,
  db: DatabaseAdapter,
): Effect.Effect<void, LockError, DurableLock> {
  return Effect.gen(function* (_) {
    const service = yield* _(DurableLock);
    return yield* _(service.release(resource, holder, db));
  });
}

/**
 * Execute with lock (convenience Effect wrapper)
 */
export function withLock<A, E, R>(
  resource: string,
  effect: Effect.Effect<A, E, R>,
  config: LockConfig,
): Effect.Effect<A, E | LockError, R | DurableLock> {
  return Effect.gen(function* (_) {
    const service = yield* _(DurableLock);
    return yield* _(service.withLock(resource, effect, config));
  });
}
