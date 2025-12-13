/**
 * DurableDeferred Service - Distributed Promises
 *
 * Creates a "distributed promise" that can be resolved from anywhere.
 * Useful for request/response patterns over streams.
 *
 * @example
 * ```typescript
 * const response = await DurableDeferred.create<Response>({ ttlSeconds: 60 })
 * await actor.append({ payload: message, replyTo: response.url })
 * return response.value // blocks until resolved or timeout
 * ```
 *
 * Implementation:
 * - Uses Effect.Deferred internally for blocking await
 * - Stores pending promises in 'deferred' table with TTL
 * - Polls database for resolution (could be upgraded to NOTIFY/LISTEN)
 * - Cleans up expired entries automatically
 */

import { Context, Deferred, Duration, Effect, Layer } from "effect";
import { nanoid } from "nanoid";
import { getDatabase } from "../index";

// ============================================================================
// Errors
// ============================================================================

/**
 * Timeout error when deferred expires before resolution
 */
export class TimeoutError extends Error {
  readonly _tag = "TimeoutError";
  constructor(
    public readonly url: string,
    public readonly ttlSeconds: number,
  ) {
    super(`Deferred ${url} timed out after ${ttlSeconds}s`);
  }
}

/**
 * Not found error when deferred URL doesn't exist
 */
export class NotFoundError extends Error {
  readonly _tag = "NotFoundError";
  constructor(public readonly url: string) {
    super(`Deferred ${url} not found`);
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Handle for a pending deferred promise
 */
export interface DeferredHandle<T> {
  /** Unique URL/identifier for this deferred */
  readonly url: string;
  /** Blocks until resolved/rejected or timeout */
  readonly value: Effect.Effect<T, TimeoutError | NotFoundError>;
}

/**
 * Configuration for creating a deferred
 */
export interface DeferredConfig {
  /** Time-to-live in seconds before timeout */
  readonly ttlSeconds: number;
  /** Optional project path for database isolation */
  readonly projectPath?: string;
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * DurableDeferred service for distributed promises
 */
export class DurableDeferred extends Context.Tag("DurableDeferred")<
  DurableDeferred,
  {
    /**
     * Create a new deferred promise
     *
     * @returns Handle with URL and value getter
     */
    readonly create: <T>(
      config: DeferredConfig,
    ) => Effect.Effect<DeferredHandle<T>>;

    /**
     * Resolve a deferred with a value
     *
     * @param url - Deferred identifier
     * @param value - Resolution value
     */
    readonly resolve: <T>(
      url: string,
      value: T,
      projectPath?: string,
    ) => Effect.Effect<void, NotFoundError>;

    /**
     * Reject a deferred with an error
     *
     * @param url - Deferred identifier
     * @param error - Error to reject with
     */
    readonly reject: (
      url: string,
      error: Error,
      projectPath?: string,
    ) => Effect.Effect<void, NotFoundError>;

    /**
     * Await a deferred's resolution (internal - use handle.value instead)
     */
    readonly await: <T>(
      url: string,
      ttlSeconds: number,
      projectPath?: string,
    ) => Effect.Effect<T, TimeoutError | NotFoundError>;
  }
>() {}

// ============================================================================
// Implementation
// ============================================================================

/**
 * In-memory registry of active deferreds
 * Maps URL -> Effect.Deferred for instant resolution without polling
 */
const activeDefersMap = new Map<string, Deferred.Deferred<unknown, Error>>();

/**
 * Ensure deferred table exists in database
 */
async function ensureDeferredTable(projectPath?: string): Promise<void> {
  const db = await getDatabase(projectPath);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS deferred (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      value JSONB,
      error TEXT,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_deferred_url ON deferred(url);
    CREATE INDEX IF NOT EXISTS idx_deferred_expires ON deferred(expires_at);
  `);
}

/**
 * Clean up expired deferred entries
 */
async function cleanupExpired(projectPath?: string): Promise<number> {
  const db = await getDatabase(projectPath);
  const now = Date.now();
  // DELETE...RETURNING returns the deleted rows, so count them directly
  const result = await db.query<{ url: string }>(
    `DELETE FROM deferred WHERE expires_at < $1 RETURNING url`,
    [now],
  );
  return result.rows.length;
}

/**
 * Create implementation
 */
function createImpl<T>(
  config: DeferredConfig,
): Effect.Effect<DeferredHandle<T>> {
  return Effect.gen(function* (_) {
    // Ensure table exists
    yield* _(Effect.promise(() => ensureDeferredTable(config.projectPath)));

    // Generate unique URL
    const url = `deferred:${nanoid()}`;
    const expiresAt = Date.now() + config.ttlSeconds * 1000;

    // Create Effect.Deferred for instant resolution
    const deferred = yield* _(Deferred.make<T, Error>());
    activeDefersMap.set(url, deferred as Deferred.Deferred<unknown, Error>);

    // Insert into database
    const db = yield* _(Effect.promise(() => getDatabase(config.projectPath)));
    yield* _(
      Effect.promise(() =>
        db.query(
          `INSERT INTO deferred (url, resolved, expires_at, created_at)
           VALUES ($1, $2, $3, $4)`,
          [url, false, expiresAt, Date.now()],
        ),
      ),
    );

    // Create value getter that directly calls awaitImpl (doesn't need service context)
    const value: Effect.Effect<T, TimeoutError | NotFoundError> = awaitImpl<T>(
      url,
      config.ttlSeconds,
      config.projectPath,
    );

    return { url, value };
  });
}

/**
 * Resolve implementation
 */
function resolveImpl<T>(
  url: string,
  value: T,
  projectPath?: string,
): Effect.Effect<void, NotFoundError> {
  return Effect.gen(function* (_) {
    yield* _(Effect.promise(() => ensureDeferredTable(projectPath)));

    const db = yield* _(Effect.promise(() => getDatabase(projectPath)));

    // Update database
    const result = yield* _(
      Effect.promise(() =>
        db.query<{ url: string }>(
          `UPDATE deferred 
           SET resolved = TRUE, value = $1::jsonb
           WHERE url = $2 AND resolved = FALSE
           RETURNING url`,
          [JSON.stringify(value), url],
        ),
      ),
    );

    if (result.rows.length === 0) {
      yield* _(Effect.fail(new NotFoundError(url)));
    }

    // Resolve in-memory deferred if it exists
    const deferred = activeDefersMap.get(url);
    if (deferred) {
      yield* _(
        Deferred.succeed(deferred, value as unknown) as Effect.Effect<
          boolean,
          never
        >,
      );
    }
  });
}

/**
 * Reject implementation
 */
function rejectImpl(
  url: string,
  error: Error,
  projectPath?: string,
): Effect.Effect<void, NotFoundError> {
  return Effect.gen(function* (_) {
    yield* _(Effect.promise(() => ensureDeferredTable(projectPath)));

    const db = yield* _(Effect.promise(() => getDatabase(projectPath)));

    // Update database
    const result = yield* _(
      Effect.promise(() =>
        db.query<{ url: string }>(
          `UPDATE deferred 
           SET resolved = TRUE, error = $1
           WHERE url = $2 AND resolved = FALSE
           RETURNING url`,
          [error.message, url],
        ),
      ),
    );

    if (result.rows.length === 0) {
      yield* _(Effect.fail(new NotFoundError(url)));
    }

    // Reject in-memory deferred if it exists
    const deferred = activeDefersMap.get(url);
    if (deferred) {
      yield* _(Deferred.fail(deferred, error) as Effect.Effect<boolean, never>);
    }
  });
}

/**
 * Await implementation (uses in-memory deferred if available, otherwise polls)
 */
function awaitImpl<T>(
  url: string,
  ttlSeconds: number,
  projectPath?: string,
): Effect.Effect<T, TimeoutError | NotFoundError> {
  return Effect.gen(function* (_) {
    yield* _(Effect.promise(() => ensureDeferredTable(projectPath)));

    // Check if we have an in-memory deferred
    const deferred = activeDefersMap.get(url);
    if (deferred) {
      // Use in-memory deferred with timeout
      const result = yield* _(
        Deferred.await(deferred as Deferred.Deferred<T, Error>).pipe(
          Effect.timeoutFail({
            duration: Duration.seconds(ttlSeconds),
            onTimeout: () => new TimeoutError(url, ttlSeconds),
          }),
          Effect.catchAll((error) =>
            Effect.fail(
              error instanceof NotFoundError || error instanceof TimeoutError
                ? error
                : new NotFoundError(url),
            ),
          ),
        ),
      );

      // Cleanup
      activeDefersMap.delete(url);
      return result as T;
    }

    // Fall back to polling database
    const db = yield* _(Effect.promise(() => getDatabase(projectPath)));
    const startTime = Date.now();
    const timeoutMs = ttlSeconds * 1000;

    // Poll loop
    while (true) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        return yield* _(Effect.fail(new TimeoutError(url, ttlSeconds)));
      }

      // Query database
      const result = yield* _(
        Effect.promise(() =>
          db.query<{ resolved: boolean; value: unknown; error: string | null }>(
            `SELECT resolved, value, error FROM deferred WHERE url = $1`,
            [url],
          ),
        ),
      );

      const row = result.rows[0];
      if (!row) {
        return yield* _(Effect.fail(new NotFoundError(url)));
      }

      // Check if resolved
      if (row.resolved) {
        if (row.error) {
          // Convert stored error message to NotFoundError
          return yield* _(Effect.fail(new NotFoundError(url)));
        }
        // Value should exist if resolved=true and error=null
        if (!row.value) {
          return yield* _(Effect.fail(new NotFoundError(url)));
        }
        // PGLite returns JSONB as parsed object already
        return (
          typeof row.value === "string" ? JSON.parse(row.value) : row.value
        ) as T;
      }

      // Sleep before next poll (100ms)
      yield* _(Effect.sleep(Duration.millis(100)));
    }
  });
}

// ============================================================================
// Layer
// ============================================================================

/**
 * Live implementation of DurableDeferred service
 */
export const DurableDeferredLive = Layer.succeed(DurableDeferred, {
  create: createImpl,
  resolve: resolveImpl,
  reject: rejectImpl,
  await: awaitImpl,
});

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a deferred promise
 */
export function createDeferred<T>(
  config: DeferredConfig,
): Effect.Effect<DeferredHandle<T>, never, DurableDeferred> {
  return Effect.gen(function* (_) {
    const service = yield* _(DurableDeferred);
    return yield* _(service.create<T>(config));
  });
}

/**
 * Resolve a deferred
 */
export function resolveDeferred<T>(
  url: string,
  value: T,
  projectPath?: string,
): Effect.Effect<void, NotFoundError, DurableDeferred> {
  return Effect.gen(function* (_) {
    const service = yield* _(DurableDeferred);
    return yield* _(service.resolve(url, value, projectPath));
  });
}

/**
 * Reject a deferred
 */
export function rejectDeferred(
  url: string,
  error: Error,
  projectPath?: string,
): Effect.Effect<void, NotFoundError, DurableDeferred> {
  return Effect.gen(function* (_) {
    const service = yield* _(DurableDeferred);
    return yield* _(service.reject(url, error, projectPath));
  });
}

/**
 * Cleanup expired deferred entries (call periodically)
 */
export function cleanupDeferreds(projectPath?: string): Effect.Effect<number> {
  return Effect.promise(() => cleanupExpired(projectPath));
}
