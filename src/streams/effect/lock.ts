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
 * // Using Effect API
 * const program = Effect.gen(function* (_) {
 *   const lock = yield* _(acquireLock("my-resource", { ttlSeconds: 30 }))
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
 *   yield* _(lock.withLock("my-resource", Effect.succeed(42)))
 * }).pipe(Effect.provide(DurableLockLive))
 * ```
 */

import { Context, Effect, Layer, Schedule } from "effect";
import { getDatabase } from "../index";
import { randomUUID } from "node:crypto";

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
   * Project path for database instance
   */
  projectPath?: string;

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
      config?: LockConfig,
    ) => Effect.Effect<LockHandle, LockError>;

    /**
     * Release a lock
     *
     * Only succeeds if the holder matches.
     */
    readonly release: (
      resource: string,
      holder: string,
      projectPath?: string,
    ) => Effect.Effect<void, LockError>;

    /**
     * Execute an effect with automatic lock acquisition and release
     *
     * Guarantees lock release even on error (Effect.ensuring).
     */
    readonly withLock: <A, E, R>(
      resource: string,
      effect: Effect.Effect<A, E, R>,
      config?: LockConfig,
    ) => Effect.Effect<A, E | LockError, R | DurableLock>;
  }
>() {}

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
  projectPath?: string,
): Promise<{ seq: number; acquiredAt: number } | null> {
  const db = await getDatabase(projectPath);
  const now = Date.now();

  try {
    // Try INSERT first (no existing lock)
    const insertResult = await db.query<{ seq: number }>(
      `INSERT INTO locks (resource, holder, seq, acquired_at, expires_at)
       VALUES ($1, $2, 0, $3, $4)
       RETURNING seq`,
      [resource, holder, now, expiresAt],
    );

    if (insertResult.rows.length > 0) {
      return { seq: insertResult.rows[0]!.seq, acquiredAt: now };
    }
  } catch {
    // INSERT failed - lock exists, try UPDATE
    const updateResult = await db.query<{ seq: number }>(
      `UPDATE locks
       SET holder = $2, seq = seq + 1, acquired_at = $3, expires_at = $4
       WHERE resource = $1
         AND (expires_at < $3 OR holder = $2)
       RETURNING seq`,
      [resource, holder, now, expiresAt],
    );

    if (updateResult.rows.length > 0) {
      return { seq: updateResult.rows[0]!.seq, acquiredAt: now };
    }
  }

  return null;
}

/**
 * Release a lock by holder
 */
async function tryRelease(
  resource: string,
  holder: string,
  projectPath?: string,
): Promise<boolean> {
  const db = await getDatabase(projectPath);

  const result = await db.query<{ holder: string }>(
    `DELETE FROM locks
     WHERE resource = $1 AND holder = $2
     RETURNING holder`,
    [resource, holder],
  );

  return result.rows.length > 0;
}

/**
 * Acquire implementation
 */
function acquireImpl(
  resource: string,
  config?: LockConfig,
): Effect.Effect<LockHandle, LockError> {
  return Effect.gen(function* (_) {
    const {
      ttlSeconds = 30,
      maxRetries = 10,
      baseDelayMs = 50,
      projectPath,
      holderId,
    } = config || {};

    const holder = holderId || randomUUID();
    const expiresAt = Date.now() + ttlSeconds * 1000;

    // Retry schedule: exponential backoff with max retries
    const retrySchedule = Schedule.exponential(baseDelayMs).pipe(
      Schedule.compose(Schedule.recurs(maxRetries)),
    );

    // Attempt acquisition with retries
    const result = yield* _(
      Effect.tryPromise({
        try: () => tryAcquire(resource, holder, expiresAt, projectPath),
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
      release: () => releaseImpl(resource, holder, projectPath),
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
  projectPath?: string,
): Effect.Effect<void, LockError> {
  return Effect.gen(function* (_) {
    const released = yield* _(
      Effect.tryPromise({
        try: () => tryRelease(resource, holder, projectPath),
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
  config?: LockConfig,
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
  config?: LockConfig,
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
  projectPath?: string,
): Effect.Effect<void, LockError, DurableLock> {
  return Effect.gen(function* (_) {
    const service = yield* _(DurableLock);
    return yield* _(service.release(resource, holder, projectPath));
  });
}

/**
 * Execute with lock (convenience Effect wrapper)
 */
export function withLock<A, E, R>(
  resource: string,
  effect: Effect.Effect<A, E, R>,
  config?: LockConfig,
): Effect.Effect<A, E | LockError, R | DurableLock> {
  return Effect.gen(function* (_) {
    const service = yield* _(DurableLock);
    return yield* _(service.withLock(resource, effect, config));
  });
}
