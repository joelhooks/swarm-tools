/**
 * Event Store - Append-only event log (DEPRECATED - use store-drizzle.ts)
 *
 * Legacy PGlite-based event store. This file exists only for backward compatibility
 * and migration support. New code should use store-drizzle.ts instead.
 *
 * @deprecated Use store-drizzle.ts with DatabaseAdapter
 */
import { withTiming, getDatabasePath } from "./index";
import type { DatabaseAdapter } from "../types/database";
import { createLibSQLAdapter } from "../libsql";
import { createLibSQLStreamsSchema } from "./libsql-schema";

/**
 * Adapter cache to avoid creating multiple instances for the same project
 * Key: projectPath (or "global" for no projectPath)
 */
const adapterCache = new Map<string, DatabaseAdapter>();

/**
 * Clear the adapter cache (primarily for test isolation)
 * 
 * In production, adapters are long-lived. In tests, call this in afterEach
 * to ensure each test gets a fresh database instance.
 * 
 * @internal
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}

/**
 * Get or create a DatabaseAdapter
 * 
 * If dbOverride is provided, returns it directly (dependency injection).
 * Otherwise, creates/reuses a cached adapter for the given projectPath.
 * 
 * CRITICAL: This function ALWAYS uses the global database path (~/.config/swarm-tools/swarm.db).
 * Local/project-specific databases are NOT supported. The projectPath parameter is only used
 * for triggering auto-migration of legacy local databases to the global database.
 * 
 * @param dbOverride - Optional explicit adapter (for dependency injection)
 * @param projectPath - Optional project path (triggers auto-migration, but DB is always global)
 * @returns DatabaseAdapter instance
 * 
 * @internal Exported for use by store-drizzle.ts to ensure adapter consistency
 */
export async function getOrCreateAdapter(
  dbOverride?: DatabaseAdapter,
  projectPath?: string,
): Promise<DatabaseAdapter> {
  // If explicit adapter provided, use it (dependency injection)
  if (dbOverride) {
    return dbOverride;
  }

  // CRITICAL: Always use "global" as cache key - we only have ONE database
  // The projectPath is only used for triggering auto-migration of legacy local DBs
  const cacheKey = "global";

  // Check cache
  const cached = adapterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Create new adapter - ALWAYS uses global path
  // getDatabasePath() returns ~/.config/swarm-tools/swarm.db and triggers
  // auto-migration if projectPath has a legacy local DB
  const dbPath = getDatabasePath(projectPath);
  
  // RUNTIME GUARD: Verify we're using the global database path
  // This prevents accidental creation of local databases
  const expectedGlobalPath = getDatabasePath(); // No projectPath = canonical global path
  if (dbPath !== expectedGlobalPath) {
    throw new Error(
      `[SwarmMail] RUNTIME GUARD VIOLATION: Attempted to create non-global database.\n` +
      `  Requested: ${dbPath}\n` +
      `  Expected:  ${expectedGlobalPath}\n` +
      `  All databases must use the global path: ~/.config/swarm-tools/swarm.db\n` +
      `  See: .hive/analysis/stray-database-audit.md`
    );
  }
  
  const adapter = await createLibSQLAdapter({ url: `file:${dbPath}` });
  
  // Initialize schema if needed
  await createLibSQLStreamsSchema(adapter);
  
  adapterCache.set(cacheKey, adapter);
  return adapter;
}
import {
  type AgentEvent,
  createEvent,
  type AgentRegisteredEvent,
  type MessageSentEvent,
  type FileReservedEvent,
} from "./events";

// ============================================================================
// Timestamp Parsing
// ============================================================================

/**
 * Maximum safe timestamp before integer overflow (approximately year 2286)
 * PostgreSQL BIGINT can exceed JavaScript's MAX_SAFE_INTEGER (2^53-1)
 */
const TIMESTAMP_SAFE_UNTIL = new Date("2286-01-01").getTime();

/**
 * Parse timestamp from database row.
 *
 * NOTE: Timestamps are stored as BIGINT but parsed as JavaScript number.
 * This is safe for dates before year 2286 (MAX_SAFE_INTEGER = 9007199254740991).
 * For timestamps beyond this range, use BigInt parsing.
 *
 * @param timestamp String representation of Unix timestamp in milliseconds
 * @returns JavaScript number (safe for dates before 2286)
 * @throws Error if timestamp is not a valid number
 */
function parseTimestamp(timestamp: string): number {
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) {
    throw new Error(`[SwarmMail] Invalid timestamp: ${timestamp}`);
  }
  if (ts > Number.MAX_SAFE_INTEGER) {
    console.warn(
      `[SwarmMail] Timestamp ${timestamp} exceeds MAX_SAFE_INTEGER (year 2286+), precision may be lost`,
    );
  }
  return ts;
}

// ============================================================================
// Event Store Operations
// ============================================================================

/**
 * Append an event to the log
 *
 * Also updates materialized views (agents, messages, reservations)
 *
 * @param event - Event to append
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 */
export async function appendEvent(
  event: AgentEvent,
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<AgentEvent & { id: number; sequence: number }> {
  const db = await getOrCreateAdapter(dbOverride, projectPath);

  // Extract common fields
  const { type, project_key, timestamp, ...rest } = event;

  // Insert event
  const result = await db.query<{ id: number; sequence: number }>(
    `INSERT INTO events (type, project_key, timestamp, data)
     VALUES ($1, $2, $3, $4)
     RETURNING id, sequence`,
    [type, project_key, timestamp, JSON.stringify(rest)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to insert event - no row returned");
  }
  const { id, sequence } = row;

  // Update materialized views based on event type
  await updateMaterializedViews(db, { ...event, id, sequence });

  return { ...event, id, sequence };
}

/**
 * Append multiple events in a transaction
 *
 * @param events - Events to append
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 */
export async function appendEvents(
  events: AgentEvent[],
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<Array<AgentEvent & { id: number; sequence: number }>> {
  return withTiming("appendEvents", async () => {
    const db = await getOrCreateAdapter(dbOverride, projectPath);
    const results: Array<AgentEvent & { id: number; sequence: number }> = [];

    await db.exec("BEGIN");
    try {
      for (const event of events) {
        const { type, project_key, timestamp, ...rest } = event;

        const result = await db.query<{ id: number; sequence: number }>(
          `INSERT INTO events (type, project_key, timestamp, data)
           VALUES ($1, $2, $3, $4)
           RETURNING id, sequence`,
          [type, project_key, timestamp, JSON.stringify(rest)],
        );

        const row = result.rows[0];
        if (!row) {
          throw new Error("Failed to insert event - no row returned");
        }
        const { id, sequence } = row;
        const enrichedEvent = { ...event, id, sequence };

        await updateMaterializedViews(db, enrichedEvent);
        results.push(enrichedEvent);
      }
      await db.exec("COMMIT");
    } catch (e) {
      // FIX: Propagate rollback failures to prevent silent data corruption
      let rollbackError: unknown = null;
      try {
        await db.exec("ROLLBACK");
      } catch (rbErr) {
        rollbackError = rbErr;
        console.error("[SwarmMail] ROLLBACK failed:", rbErr);
      }

      if (rollbackError) {
        // Throw composite error so caller knows both failures
        const compositeError = new Error(
          `Transaction failed: ${e instanceof Error ? e.message : String(e)}. ` +
            `ROLLBACK also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}. ` +
            `Database may be in inconsistent state.`,
        );
        (compositeError as any).originalError = e;
        (compositeError as any).rollbackError = rollbackError;
        throw compositeError;
      }
      throw e;
    }

    return results;
  });
}

/**
 * Read events with optional filters
 *
 * @param options - Filter options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 */
export async function readEvents(
  options: {
    projectKey?: string;
    types?: AgentEvent["type"][];
    since?: number; // timestamp
    until?: number; // timestamp
    afterSequence?: number;
    limit?: number;
    offset?: number;
  } = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<Array<AgentEvent & { id: number; sequence: number }>> {
  return withTiming("readEvents", async () => {
    const db = await getOrCreateAdapter(dbOverride, projectPath);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.projectKey) {
      conditions.push(`project_key = $${paramIndex++}`);
      params.push(options.projectKey);
    }

    if (options.types && options.types.length > 0) {
      conditions.push(`type = ANY($${paramIndex++})`);
      params.push(options.types);
    }

    if (options.since !== undefined) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(options.since);
    }

    if (options.until !== undefined) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(options.until);
    }

    if (options.afterSequence !== undefined) {
      conditions.push(`sequence > $${paramIndex++}`);
      params.push(options.afterSequence);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let query = `
      SELECT id, type, project_key, timestamp, sequence, data
      FROM events
      ${whereClause}
      ORDER BY sequence ASC
    `;

    if (options.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(options.limit);
    }

    if (options.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(options.offset);
    }

    const result = await db.query<{
      id: number;
      type: string;
      project_key: string;
      timestamp: string;
      sequence: number;
      data: string;
    }>(query, params);

    return result.rows.map((row) => {
      const data =
        typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      return {
        id: row.id,
        type: row.type as AgentEvent["type"],
        project_key: row.project_key,
        timestamp: parseTimestamp(row.timestamp as string),
        sequence: row.sequence,
        ...data,
      } as AgentEvent & { id: number; sequence: number };
    });
  });
}

/**
 * Get the latest sequence number
 *
 * @param projectKey - Optional project key to filter by
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 */
export async function getLatestSequence(
  projectKey?: string,
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<number> {
  const db = await getOrCreateAdapter(dbOverride, projectPath);

  const query = projectKey
    ? "SELECT MAX(sequence) as seq FROM events WHERE project_key = $1"
    : "SELECT MAX(sequence) as seq FROM events";

  const params = projectKey ? [projectKey] : [];
  const result = await db.query<{ seq: number | null }>(query, params);

  return result.rows[0]?.seq ?? 0;
}

/**
 * Replay events to rebuild materialized views
 *
 * Useful for:
 * - Recovering from corruption
 * - Migrating to new schema
 * - Debugging state issues
 *
 * @param options - Replay options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 */
export async function replayEvents(
  options: {
    projectKey?: string;
    fromSequence?: number;
    clearViews?: boolean;
  } = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<{ eventsReplayed: number; duration: number }> {
  return withTiming("replayEvents", async () => {
    const startTime = Date.now();
    const db = await getOrCreateAdapter(dbOverride, projectPath);

    // Optionally clear materialized views
    if (options.clearViews) {
      if (options.projectKey) {
        // Use parameterized queries to prevent SQL injection
        await db.query(
          `DELETE FROM message_recipients WHERE message_id IN (
            SELECT id FROM messages WHERE project_key = $1
          )`,
          [options.projectKey],
        );
        await db.query(`DELETE FROM messages WHERE project_key = $1`, [
          options.projectKey,
        ]);
        await db.query(`DELETE FROM reservations WHERE project_key = $1`, [
          options.projectKey,
        ]);
        await db.query(`DELETE FROM agents WHERE project_key = $1`, [
          options.projectKey,
        ]);
      } else {
        await db.exec(`
          DELETE FROM message_recipients;
          DELETE FROM messages;
          DELETE FROM reservations;
          DELETE FROM agents;
        `);
      }
    }

    // Read all events
    const events = await readEvents(
      {
        projectKey: options.projectKey,
        afterSequence: options.fromSequence,
      },
      projectPath,
    );

    // Replay each event
    for (const event of events) {
      await updateMaterializedViews(db, event);
    }

    return {
      eventsReplayed: events.length,
      duration: Date.now() - startTime,
    };
  });
}

/**
 * Replay events in batches to avoid OOM
 *
 * For large event logs (>100k events), use this instead of replayEvents()
 * to keep memory usage constant.
 *
 * Example:
 * ```typescript
 * const result = await replayEventsBatched(
 *   "my-project",
 *   async (events, progress) => {
 *     console.log(`Replayed ${progress.processed}/${progress.total} (${progress.percent}%)`);
 *   },
 *   { batchSize: 1000, clearViews: true },
 *   "/path/to/project"
 * );
 * console.log(`Replayed ${result.eventsReplayed} events in ${result.duration}ms`);
 * ```
 *
 * @param projectKey Project key to filter events
 * @param onBatch Callback invoked for each batch with progress
 * @param options Configuration options
 * @param options.batchSize Number of events per batch (default 1000)
 * @param options.fromSequence Start from this sequence number (default 0)
 * @param options.clearViews Clear materialized views before replay (default false)
 * @param projectPath Path to project database
 */
export async function replayEventsBatched(
  projectKey: string,
  onBatch: (
    events: Array<AgentEvent & { id: number; sequence: number }>,
    progress: { processed: number; total: number; percent: number },
  ) => Promise<void>,
  options: {
    batchSize?: number;
    fromSequence?: number;
    clearViews?: boolean;
  } = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<{ eventsReplayed: number; duration: number }> {
  return withTiming("replayEventsBatched", async () => {
    const startTime = Date.now();
    const batchSize = options.batchSize ?? 1000;
    const fromSequence = options.fromSequence ?? 0;
    const db = await getOrCreateAdapter(dbOverride, projectPath);

    // Optionally clear materialized views
    if (options.clearViews) {
      await db.query(
        `DELETE FROM message_recipients WHERE message_id IN (
          SELECT id FROM messages WHERE project_key = $1
        )`,
        [projectKey],
      );
      await db.query(`DELETE FROM messages WHERE project_key = $1`, [
        projectKey,
      ]);
      await db.query(`DELETE FROM reservations WHERE project_key = $1`, [
        projectKey,
      ]);
      await db.query(`DELETE FROM agents WHERE project_key = $1`, [projectKey]);
    }

    // Get total count first
    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM events WHERE project_key = $1 AND sequence > $2`,
      [projectKey, fromSequence],
    );
    const total = parseInt(countResult.rows[0]?.count ?? "0");

    if (total === 0) {
      return { eventsReplayed: 0, duration: Date.now() - startTime };
    }

    let processed = 0;
    let offset = 0;

    while (processed < total) {
      // Fetch batch
      const events = await readEvents(
        {
          projectKey,
          afterSequence: fromSequence,
          limit: batchSize,
          offset,
        },
        projectPath,
      );

      if (events.length === 0) break;

      // Update materialized views for this batch
      for (const event of events) {
        await updateMaterializedViews(db, event);
      }

      processed += events.length;
      const percent = Math.round((processed / total) * 100);

      // Report progress
      await onBatch(events, { processed, total, percent });

      offset += batchSize;
    }

    return {
      eventsReplayed: processed,
      duration: Date.now() - startTime,
    };
  });
}

// ============================================================================
// Materialized View Updates
// ============================================================================

/**
 * Update materialized views based on event type
 *
 * This is called after each event is appended.
 * Views are denormalized for fast reads.
 */
async function updateMaterializedViews(
  db: DatabaseAdapter,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  try {
    switch (event.type) {
      case "agent_registered":
        await handleAgentRegistered(
          db,
          event as AgentRegisteredEvent & { id: number; sequence: number },
        );
        break;

      case "agent_active":
        await db.query(
          `UPDATE agents SET last_active_at = $1 WHERE project_key = $2 AND name = $3`,
          [event.timestamp, event.project_key, event.agent_name],
        );
        break;

      case "message_sent":
        await handleMessageSent(
          db,
          event as MessageSentEvent & { id: number; sequence: number },
        );
        break;

      case "message_read":
        await db.query(
          `UPDATE message_recipients SET read_at = $1 WHERE message_id = $2 AND agent_name = $3`,
          [event.timestamp, event.message_id, event.agent_name],
        );
        break;

      case "message_acked":
        await db.query(
          `UPDATE message_recipients SET acked_at = $1 WHERE message_id = $2 AND agent_name = $3`,
          [event.timestamp, event.message_id, event.agent_name],
        );
        break;

      // Thread events - no materialized views needed (query events directly)
      case "thread_created":
      case "thread_activity":
        // No-op - these are observability events, not state changes
        break;

      case "file_reserved":
        await handleFileReserved(
          db,
          event as FileReservedEvent & { id: number; sequence: number },
        );
        break;

      case "file_released":
        await handleFileReleased(db, event);
        break;

      // Task events don't need materialized views (query events directly)
      case "task_started":
      case "task_progress":
      case "task_completed":
      case "task_blocked":
        // No-op for now - could add task tracking table later
        break;

      // Eval capture events - update eval_records projection
      case "decomposition_generated":
        await handleDecompositionGenerated(db, event);
        break;

      case "subtask_outcome":
        await handleSubtaskOutcome(db, event);
        break;

      case "human_feedback":
        await handleHumanFeedback(db, event);
        break;

      // Swarm checkpoint events - update swarm_contexts table
      case "swarm_checkpointed":
        await handleSwarmCheckpointed(db, event);
        break;

      case "swarm_recovered":
        await handleSwarmRecovered(db, event);
        break;

      // Swarm lifecycle events - no materialized views needed (query events directly)
      case "swarm_started":
      case "worker_spawned":
      case "worker_completed":
      case "review_started":
      case "review_completed":
      case "swarm_completed":
      case "file_conflict":
        // No-op - these are observability events, not state changes
        break;
    }
  } catch (error) {
    console.error("[SwarmMail] Failed to update materialized views", {
      eventType: event.type,
      eventId: event.id,
      error,
    });
    throw error;
  }
}

async function handleAgentRegistered(
  db: DatabaseAdapter,
  event: AgentRegisteredEvent & { id: number; sequence: number },
): Promise<void> {
  await db.query(
    `INSERT INTO agents (project_key, name, program, model, task_description, registered_at, last_active_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (project_key, name) DO UPDATE SET
       program = EXCLUDED.program,
       model = EXCLUDED.model,
       task_description = EXCLUDED.task_description,
       last_active_at = EXCLUDED.last_active_at`,
    [
      event.project_key,
      event.agent_name,
      event.program,
      event.model,
      event.task_description || null,
      event.timestamp,
    ],
  );
}

async function handleMessageSent(
  db: DatabaseAdapter,
  event: MessageSentEvent & { id: number; sequence: number },
): Promise<void> {


  // Insert message
  const result = await db.query<{ id: number }>(
    `INSERT INTO messages (project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      event.project_key,
      event.from_agent,
      event.subject,
      event.body,
      event.thread_id || null,
      event.importance,
      event.ack_required,
      event.timestamp,
    ],
  );

  const msgRow = result.rows[0];
  if (!msgRow) {
    throw new Error("Failed to insert message - no row returned");
  }
  const messageId = msgRow.id;

  // FIX: Bulk insert recipients to avoid N+1 queries
  if (event.to_agents.length > 0) {
    const values = event.to_agents.map((_, i) => `($1, $${i + 2})`).join(", ");
    const params = [messageId, ...event.to_agents];

    await db.query(
      `INSERT INTO message_recipients (message_id, agent_name)
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      params,
    );
  }
}

async function handleFileReserved(
  db: DatabaseAdapter,
  event: FileReservedEvent & { id: number; sequence: number },
): Promise<void> {

  // FIX: Bulk insert reservations to avoid N+1 queries
  if (event.paths.length > 0) {
    // Each path gets its own VALUES clause with placeholders:
    // ($1=project_key, $2=agent_name, $3=path1, $4=exclusive, $5=reason, $6=created_at, $7=expires_at, $8=lock_holder_id1)
    // ($1=project_key, $2=agent_name, $9=path2, $4=exclusive, $5=reason, $6=created_at, $7=expires_at, $10=lock_holder_id2)
    // etc.
    const lockHolderIds = event.lock_holder_ids || [];
    const baseParamCount = 3 + event.paths.length; // project_key, agent_name, ...paths
    
    const values = event.paths
      .map(
        (_, i) =>
          `($1, $2, $${i + 3}, $${baseParamCount}, $${baseParamCount + 1}, $${baseParamCount + 2}, $${baseParamCount + 3}, $${baseParamCount + 4 + i})`,
      )
      .join(", ");

    const params = [
      event.project_key, // $1
      event.agent_name, // $2
      ...event.paths, // $3, $4, ... (one per path)
      event.exclusive, // $baseParamCount
      event.reason || null, // $baseParamCount+1
      event.timestamp, // $baseParamCount+2
      event.expires_at, // $baseParamCount+3
      ...lockHolderIds.map((id, i) => id || null), // $baseParamCount+4, $baseParamCount+5, ... (one per path)
    ];

    // FIX: Make idempotent by deleting existing active reservations first
    // This handles retry scenarios (network timeouts, etc.) without creating duplicates
    if (event.paths.length > 0) {
      await db.query(
        `DELETE FROM reservations 
         WHERE project_key = $1 
           AND agent_name = $2 
           AND path_pattern = ANY($3)
           AND released_at IS NULL`,
        [event.project_key, event.agent_name, event.paths],
      );
    }

    await db.query(
      `INSERT INTO reservations (project_key, agent_name, path_pattern, exclusive, reason, created_at, expires_at, lock_holder_id)
       VALUES ${values}`,
      params,
    );

  }
}

async function handleFileReleased(
  db: DatabaseAdapter,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "file_released") return;

  if (event.reservation_ids && event.reservation_ids.length > 0) {
    // Release specific reservations
    await db.query(
      `UPDATE reservations SET released_at = $1 WHERE id = ANY($2)`,
      [event.timestamp, event.reservation_ids],
    );
  } else if (event.paths && event.paths.length > 0) {
    // Release by path
    await db.query(
      `UPDATE reservations SET released_at = $1
       WHERE project_key = $2 AND agent_name = $3 AND path_pattern = ANY($4) AND released_at IS NULL`,
      [event.timestamp, event.project_key, event.agent_name, event.paths],
    );
  } else {
    // Release all for agent
    await db.query(
      `UPDATE reservations SET released_at = $1
       WHERE project_key = $2 AND agent_name = $3 AND released_at IS NULL`,
      [event.timestamp, event.project_key, event.agent_name],
    );
  }
}

async function handleDecompositionGenerated(
  db: DatabaseAdapter,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "decomposition_generated") return;

  await db.query(
    `INSERT INTO eval_records (
      id, project_key, task, context, strategy, epic_title, subtasks, 
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
    ON CONFLICT (id) DO NOTHING`,
    [
      event.epic_id,
      event.project_key,
      event.task,
      event.context || null,
      event.strategy,
      event.epic_title,
      JSON.stringify(event.subtasks),
      event.timestamp,
    ],
  );
}

async function handleSubtaskOutcome(
  db: DatabaseAdapter,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "subtask_outcome") return;

  // Fetch current record to compute metrics
  const result = await db.query<{
    outcomes: string | null;
    subtasks: string;
  }>(`SELECT outcomes, subtasks FROM eval_records WHERE id = $1`, [
    event.epic_id,
  ]);

  if (!result.rows[0]) {
    console.warn(
      `[SwarmMail] No eval_record found for epic_id ${event.epic_id}`,
    );
    return;
  }

  const row = result.rows[0];
  // PGlite returns JSONB columns as already-parsed objects
  const subtasks = (
    typeof row.subtasks === "string" ? JSON.parse(row.subtasks) : row.subtasks
  ) as Array<{
    title: string;
    files: string[];
  }>;
  const outcomes = row.outcomes
    ? ((typeof row.outcomes === "string"
        ? JSON.parse(row.outcomes)
        : row.outcomes) as Array<{
        bead_id: string;
        planned_files: string[];
        actual_files: string[];
        duration_ms: number;
        error_count: number;
        retry_count: number;
        success: boolean;
      }>)
    : [];

  // Create new outcome
  const newOutcome = {
    bead_id: event.bead_id,
    planned_files: event.planned_files,
    actual_files: event.actual_files,
    duration_ms: event.duration_ms,
    error_count: event.error_count,
    retry_count: event.retry_count,
    success: event.success,
  };

  // Append to outcomes array
  const updatedOutcomes = [...outcomes, newOutcome];

  // Compute metrics
  const fileOverlapCount = computeFileOverlap(subtasks);
  const scopeAccuracy = computeScopeAccuracy(
    event.planned_files,
    event.actual_files,
  );
  const timeBalanceRatio = computeTimeBalanceRatio(updatedOutcomes);
  const overallSuccess = updatedOutcomes.every((o) => o.success);
  const totalDurationMs = updatedOutcomes.reduce(
    (sum, o) => sum + o.duration_ms,
    0,
  );
  const totalErrors = updatedOutcomes.reduce(
    (sum, o) => sum + o.error_count,
    0,
  );

  // Update record
  await db.query(
    `UPDATE eval_records SET
      outcomes = $1,
      file_overlap_count = $2,
      scope_accuracy = $3,
      time_balance_ratio = $4,
      overall_success = $5,
      total_duration_ms = $6,
      total_errors = $7,
      updated_at = $8
    WHERE id = $9`,
    [
      JSON.stringify(updatedOutcomes),
      fileOverlapCount,
      scopeAccuracy,
      timeBalanceRatio,
      overallSuccess,
      totalDurationMs,
      totalErrors,
      event.timestamp,
      event.epic_id,
    ],
  );
}

async function handleHumanFeedback(
  db: DatabaseAdapter,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "human_feedback") return;

  await db.query(
    `UPDATE eval_records SET
      human_accepted = $1,
      human_modified = $2,
      human_notes = $3,
      updated_at = $4
    WHERE id = $5`,
    [
      event.accepted,
      event.modified,
      event.notes || null,
      event.timestamp,
      event.epic_id,
    ],
  );
}

async function handleSwarmCheckpointed(
  db: DatabaseAdapter,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "swarm_checkpointed") return;

  await db.query(
    `INSERT INTO swarm_contexts (
      id, project_key, epic_id, bead_id, strategy, files, dependencies, 
      directives, recovery, created_at, checkpointed_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)
    ON CONFLICT (project_key, epic_id, bead_id) DO UPDATE SET
      id = EXCLUDED.id,
      strategy = EXCLUDED.strategy,
      files = EXCLUDED.files,
      dependencies = EXCLUDED.dependencies,
      directives = EXCLUDED.directives,
      recovery = EXCLUDED.recovery,
      checkpointed_at = EXCLUDED.checkpointed_at,
      updated_at = EXCLUDED.updated_at`,
    [
      event.bead_id, // Use bead_id as the unique id
      event.project_key,
      event.epic_id,
      event.bead_id,
      event.strategy,
      JSON.stringify(event.files),
      JSON.stringify(event.dependencies),
      JSON.stringify(event.directives),
      JSON.stringify(event.recovery),
      event.timestamp,
    ],
  );
}

async function handleSwarmRecovered(
  db: DatabaseAdapter,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "swarm_recovered") return;

  // Update swarm_contexts to mark as recovered
  await db.query(
    `UPDATE swarm_contexts SET
      recovered_at = $1,
      recovered_from_checkpoint = $2,
      updated_at = $1
    WHERE project_key = $3 AND epic_id = $4 AND bead_id = $5`,
    [
      event.timestamp,
      event.recovered_from_checkpoint,
      event.project_key,
      event.epic_id,
      event.bead_id,
    ],
  );
}

// ============================================================================
// Metric Computation Helpers
// ============================================================================

/**
 * Count files that appear in multiple subtasks
 */
function computeFileOverlap(subtasks: Array<{ files: string[] }>): number {
  const fileCount = new Map<string, number>();

  for (const subtask of subtasks) {
    for (const file of subtask.files) {
      fileCount.set(file, (fileCount.get(file) || 0) + 1);
    }
  }

  return Array.from(fileCount.values()).filter((count) => count > 1).length;
}

/**
 * Compute scope accuracy: intersection(actual, planned) / planned.length
 */
function computeScopeAccuracy(planned: string[], actual: string[]): number {
  if (planned.length === 0) return 1.0;

  const plannedSet = new Set(planned);
  const intersection = actual.filter((file) => plannedSet.has(file));

  return intersection.length / planned.length;
}

/**
 * Compute time balance ratio: max(duration) / min(duration)
 * Lower is better (more balanced)
 */
function computeTimeBalanceRatio(
  outcomes: Array<{ duration_ms: number }>,
): number | null {
  if (outcomes.length === 0) return null;

  const durations = outcomes.map((o) => o.duration_ms);
  const max = Math.max(...durations);
  const min = Math.min(...durations);

  if (min === 0) return null;

  return max / min;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Register an agent (creates event + updates view)
 *
 * @param projectKey - Project identifier
 * @param agentName - Agent name
 * @param options - Registration options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 */
export async function registerAgent(
  projectKey: string,
  agentName: string,
  options: {
    program?: string;
    model?: string;
    taskDescription?: string;
  } = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<AgentRegisteredEvent & { id: number; sequence: number }> {
  const event = createEvent("agent_registered", {
    project_key: projectKey,
    agent_name: agentName,
    program: options.program || "opencode",
    model: options.model || "unknown",
    task_description: options.taskDescription,
  });

  return appendEvent(event, projectPath, dbOverride) as Promise<
    AgentRegisteredEvent & { id: number; sequence: number }
  >;
}

/**
 * Send a message (creates event + updates view)
 *
 * @param projectKey - Project identifier
 * @param fromAgent - Sender agent name
 * @param toAgents - Recipient agent names
 * @param subject - Message subject
 * @param body - Message body
 * @param options - Message options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 */
export async function sendMessage(
  projectKey: string,
  fromAgent: string,
  toAgents: string[],
  subject: string,
  body: string,
  options: {
    threadId?: string;
    importance?: "low" | "normal" | "high" | "urgent";
    ackRequired?: boolean;
  } = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<MessageSentEvent & { id: number; sequence: number }> {
  const event = createEvent("message_sent", {
    project_key: projectKey,
    from_agent: fromAgent,
    to_agents: toAgents,
    subject,
    body,
    thread_id: options.threadId,
    importance: options.importance || "normal",
    ack_required: options.ackRequired || false,
  });

  return appendEvent(event, projectPath, dbOverride) as Promise<
    MessageSentEvent & { id: number; sequence: number }
  >;
}

/**
 * Reserve files (creates event + updates view)
 *
 * @param projectKey - Project identifier
 * @param agentName - Agent reserving the files
 * @param paths - File paths to reserve
 * @param options - Reservation options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 */
export async function reserveFiles(
  projectKey: string,
  agentName: string,
  paths: string[],
  options: {
    reason?: string;
    exclusive?: boolean;
    ttlSeconds?: number;
    lockHolderIds?: string[];
    epicId?: string;
    beadId?: string;
    isRetry?: boolean;
    conflictAgent?: string;
  } = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<FileReservedEvent & { id: number; sequence: number }> {
  const ttlSeconds = options.ttlSeconds || 3600;
  const event = createEvent("file_reserved", {
    project_key: projectKey,
    agent_name: agentName,
    paths,
    reason: options.reason,
    exclusive: options.exclusive ?? true,
    ttl_seconds: ttlSeconds,
    expires_at: Date.now() + ttlSeconds * 1000,
    lock_holder_ids: options.lockHolderIds,
    file_count: paths.length,
    epic_id: options.epicId,
    bead_id: options.beadId,
    is_retry: options.isRetry,
    conflict_agent: options.conflictAgent,
  });

  return appendEvent(event, projectPath, dbOverride) as Promise<
    FileReservedEvent & { id: number; sequence: number }
  >;
}
