/**
 * DurableCursor - Positioned event stream consumption with checkpointing
 *
 * Effect-TS service that wraps event stream reading with cursor state management.
 * Enables reliable event processing with resumable position tracking.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const cursor = yield* DurableCursor;
 *   const consumer = yield* cursor.create({
 *     stream: "projects/foo/events",
 *     checkpoint: "agents/bar/position"
 *   });
 *
 *   for await (const msg of consumer.consume()) {
 *     yield* handleMessage(msg.value);
 *     yield* msg.commit();
 *   }
 * });
 * ```
 */
import { Context, Effect, Ref, Stream } from "effect";
import { readEvents } from "../store";
import type { AgentEvent } from "../events";
import type { DatabaseAdapter } from "../../types/database";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for creating a cursor
 */
export interface CursorConfig {
  /** Stream identifier (e.g. "projects/foo/events") */
  readonly stream: string;
  /** Checkpoint identifier (e.g. "agents/bar/position") */
  readonly checkpoint: string;
  /** Database adapter for cursor storage */
  readonly db: DatabaseAdapter;
  /** Batch size for reading events (default: 100) */
  readonly batchSize?: number;
  /** Optional filters for event types */
  readonly types?: AgentEvent["type"][];
}

/**
 * A message from the cursor with commit capability
 */
export interface CursorMessage<T = unknown> {
  /** The event value */
  readonly value: T;
  /** Event sequence number */
  readonly sequence: number;
  /** Commit this position to the checkpoint */
  readonly commit: () => Effect.Effect<void>;
}

/**
 * A cursor instance for consuming events
 */
export interface Cursor {
  /** Get current position */
  readonly getPosition: () => Effect.Effect<number>;
  /** Consume events as an async iterable */
  readonly consume: <
    T = AgentEvent & { id: number; sequence: number },
  >() => AsyncIterable<CursorMessage<T>>;
  /** Update checkpoint position */
  readonly commit: (sequence: number) => Effect.Effect<void>;
}

/**
 * DurableCursor service interface
 */
export interface DurableCursorService {
  /** Create a new cursor instance */
  readonly create: (config: CursorConfig) => Effect.Effect<Cursor>;
}

// ============================================================================
// Service Definition
// ============================================================================

/**
 * DurableCursor Context.Tag
 */
export class DurableCursor extends Context.Tag("DurableCursor")<
  DurableCursor,
  DurableCursorService
>() {}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Initialize cursor table schema (SQLite syntax)
 */
async function ensureCursorsTable(db: DatabaseAdapter): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cursors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE(stream, checkpoint)
    );

    CREATE INDEX IF NOT EXISTS idx_cursors_stream ON cursors(stream);
    CREATE INDEX IF NOT EXISTS idx_cursors_checkpoint ON cursors(checkpoint);
  `);
}

/**
 * Load cursor position from database
 */
async function loadCursorPosition(
  stream: string,
  checkpoint: string,
  db: DatabaseAdapter,
): Promise<number> {
  await ensureCursorsTable(db);

  const result = await db.query<{ position: number }>(
    `SELECT position FROM cursors WHERE stream = ? AND checkpoint = ?`,
    [stream, checkpoint],
  );

  if (result.rows.length === 0) {
    // Initialize cursor at position 0
    await db.exec(`
      INSERT INTO cursors (stream, checkpoint, position, updated_at)
      VALUES ('${stream}', '${checkpoint}', 0, ${Date.now()})
      ON CONFLICT (stream, checkpoint) DO NOTHING
    `);
    return 0;
  }

  return result.rows[0]?.position ?? 0;
}

/**
 * Save cursor position to database
 */
async function saveCursorPosition(
  stream: string,
  checkpoint: string,
  position: number,
  db: DatabaseAdapter,
): Promise<void> {
  await db.exec(`
    INSERT INTO cursors (stream, checkpoint, position, updated_at)
    VALUES ('${stream}', '${checkpoint}', ${position}, ${Date.now()})
    ON CONFLICT (stream, checkpoint)
    DO UPDATE SET position = EXCLUDED.position, updated_at = EXCLUDED.updated_at
  `);
}

/**
 * Create cursor implementation
 */
function createCursorImpl(config: CursorConfig): Effect.Effect<Cursor> {
  return Effect.gen(function* () {
    // Load initial position from database
    const initialPosition = yield* Effect.promise(() =>
      loadCursorPosition(config.stream, config.checkpoint, config.db),
    );

    // Create mutable reference for current position
    const positionRef = yield* Ref.make(initialPosition);

    // Commit function - updates database and reference
    const commitPosition = (sequence: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          saveCursorPosition(
            config.stream,
            config.checkpoint,
            sequence,
            config.db,
          ),
        );
        yield* Ref.set(positionRef, sequence);
      });

    // Get current position
    const getPosition = (): Effect.Effect<number> => Ref.get(positionRef);

    // Consume events as async iterable
    const consume = <
      T = AgentEvent & { id: number; sequence: number },
    >(): AsyncIterable<CursorMessage<T>> => {
      const batchSize = config.batchSize ?? 100;

      return {
        [Symbol.asyncIterator]() {
          let currentBatch: Array<
            AgentEvent & { id: number; sequence: number }
          > = [];
          let batchIndex = 0;
          let done = false;

          return {
            async next(): Promise<IteratorResult<CursorMessage<T>>> {
              // Load next batch if current batch is exhausted
              if (batchIndex >= currentBatch.length && !done) {
                const currentPosition = await Effect.runPromise(
                  Ref.get(positionRef),
                );

                const events = await readEvents(
                  {
                    afterSequence: currentPosition,
                    limit: batchSize,
                    types: config.types,
                  },
                  undefined, // no projectPath
                  config.db, // pass db directly
                );

                if (events.length === 0) {
                  done = true;
                  return { done: true, value: undefined };
                }

                currentBatch = events;
                batchIndex = 0;
              }

              // Return next message from current batch
              if (batchIndex < currentBatch.length) {
                const event = currentBatch[batchIndex++];
                if (!event) {
                  done = true;
                  return { done: true, value: undefined };
                }

                const message: CursorMessage<T> = {
                  value: event as unknown as T,
                  sequence: event.sequence,
                  commit: () => commitPosition(event.sequence),
                };

                return { done: false, value: message };
              }

              done = true;
              return { done: true, value: undefined };
            },
          };
        },
      };
    };

    return {
      getPosition,
      consume,
      commit: commitPosition,
    };
  });
}

// ============================================================================
// Layer
// ============================================================================

/**
 * Live implementation of DurableCursor service
 */
export const DurableCursorLive = DurableCursor.of({
  create: createCursorImpl,
});

/**
 * Default layer for DurableCursor service
 */
export const DurableCursorLayer = Context.make(
  DurableCursor,
  DurableCursorLive,
);
