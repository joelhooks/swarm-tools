/**
 * Event Store - Drizzle ORM Implementation
 *
 * Drizzle-based implementation of event store operations.
 * Replaces raw SQL queries with type-safe Drizzle query builder.
 *
 * Core operations:
 * - appendEvent(): Add events to the log
 * - readEvents(): Read events with filters
 * - getLatestSequence(): Get max sequence number
 *
 * All state changes go through events. Projections compute current state.
 */

import { and, eq, gte, gt, inArray, lte, sql } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import type {
  AgentEvent,
  AgentRegisteredEvent,
  FileReservedEvent,
  MessageSentEvent,
} from "./events.js";
import {
  agentsTable,
  evalRecordsTable,
  eventsTable,
  messageRecipientsTable,
  messagesTable,
  reservationsTable,
  swarmContextsTable,
} from "../db/schema/streams.js";

// ============================================================================
// Event Store Operations
// ============================================================================

/**
 * Append an event to the log using Drizzle
 *
 * @param db - Drizzle database instance
 * @param event - Event to append
 * @returns Event with id and sequence
 */
export async function appendEventDrizzle(
  db: SwarmDb,
  event: AgentEvent,
): Promise<AgentEvent & { id: number; sequence: number }> {
  const { type, project_key, timestamp, ...rest } = event;

  // Insert event
  const result = await db
    .insert(eventsTable)
    .values({
      type,
      project_key,
      timestamp,
      data: JSON.stringify(rest),
      // sequence omitted - auto-assigned by database (SERIAL in PGlite, trigger in LibSQL)
    })
    .returning({ id: eventsTable.id, sequence: eventsTable.sequence });

  const row = result[0];
  if (!row || row.sequence === null || row.sequence === undefined) {
    throw new Error("Failed to insert event - no row returned or sequence is null");
  }

  const { id, sequence } = row;

  // Update materialized views based on event type
  await updateMaterializedViewsDrizzle(db, { ...event, id, sequence });

  return { ...event, id, sequence };
}

/**
 * Read events with optional filters using Drizzle
 *
 * @param db - Drizzle database instance
 * @param options - Filter options
 * @returns Array of events with id and sequence
 */
export async function readEventsDrizzle(
  db: SwarmDb,
  options: {
    projectKey?: string;
    types?: AgentEvent["type"][];
    since?: number;
    until?: number;
    afterSequence?: number;
    limit?: number;
    offset?: number;
  } = {},
): Promise<Array<AgentEvent & { id: number; sequence: number }>> {
  const conditions = [];

  if (options.projectKey) {
    conditions.push(eq(eventsTable.project_key, options.projectKey));
  }

  if (options.types && options.types.length > 0) {
    conditions.push(inArray(eventsTable.type, options.types));
  }

  if (options.since !== undefined) {
    conditions.push(gte(eventsTable.timestamp, options.since));
  }

  if (options.until !== undefined) {
    conditions.push(lte(eventsTable.timestamp, options.until));
  }

  if (options.afterSequence !== undefined) {
    conditions.push(gt(eventsTable.sequence, options.afterSequence));
  }

  let query = db
    .select()
    .from(eventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(eventsTable.sequence)
    .$dynamic();

  if (options.limit) {
    query = query.limit(options.limit);
  }

  if (options.offset) {
    query = query.offset(options.offset);
  }

  const rows = await query;

  return rows.map((row) => {
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    return {
      id: row.id,
      type: row.type as AgentEvent["type"],
      project_key: row.project_key,
      timestamp: row.timestamp,
      sequence: row.sequence ?? 0,
      ...data,
    } as AgentEvent & { id: number; sequence: number };
  });
}

/**
 * Get the latest sequence number using Drizzle
 *
 * @param db - Drizzle database instance
 * @param projectKey - Optional project key to filter by
 * @returns Latest sequence number (0 if no events)
 */
export async function getLatestSequenceDrizzle(
  db: SwarmDb,
  projectKey?: string,
): Promise<number> {
  const condition = projectKey
    ? eq(eventsTable.project_key, projectKey)
    : undefined;

  const result = await db
    .select({ seq: sql<number>`MAX(${eventsTable.sequence})` })
    .from(eventsTable)
    .where(condition);

  return result[0]?.seq ?? 0;
}

// ============================================================================
// Materialized View Updates (Drizzle)
// ============================================================================

/**
 * Update materialized views based on event type using Drizzle
 */
async function updateMaterializedViewsDrizzle(
  db: SwarmDb,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  try {
    switch (event.type) {
      case "agent_registered":
        await handleAgentRegisteredDrizzle(
          db,
          event as AgentRegisteredEvent & { id: number; sequence: number },
        );
        break;

      case "agent_active":
        await db
          .update(agentsTable)
          .set({ last_active_at: event.timestamp })
          .where(
            and(
              eq(agentsTable.project_key, event.project_key),
              eq(agentsTable.name, event.agent_name),
            ),
          );
        break;

      case "message_sent":
        await handleMessageSentDrizzle(
          db,
          event as MessageSentEvent & { id: number; sequence: number },
        );
        break;

      case "message_read":
        await db
          .update(messageRecipientsTable)
          .set({ read_at: event.timestamp })
          .where(
            and(
              eq(messageRecipientsTable.message_id, event.message_id),
              eq(messageRecipientsTable.agent_name, event.agent_name),
            ),
          );
        break;

      case "message_acked":
        await db
          .update(messageRecipientsTable)
          .set({ acked_at: event.timestamp })
          .where(
            and(
              eq(messageRecipientsTable.message_id, event.message_id),
              eq(messageRecipientsTable.agent_name, event.agent_name),
            ),
          );
        break;

      case "file_reserved":
        await handleFileReservedDrizzle(
          db,
          event as FileReservedEvent & { id: number; sequence: number },
        );
        break;

      case "file_released":
        await handleFileReleasedDrizzle(db, event);
        break;

      // Task events don't need materialized views (query events directly)
      case "task_started":
      case "task_progress":
      case "task_completed":
      case "task_blocked":
        // No-op for now
        break;

      // Eval capture events
      case "decomposition_generated":
        await handleDecompositionGeneratedDrizzle(db, event);
        break;

      case "subtask_outcome":
        await handleSubtaskOutcomeDrizzle(db, event);
        break;

      case "human_feedback":
        await handleHumanFeedbackDrizzle(db, event);
        break;

      // Swarm checkpoint events
      case "swarm_checkpointed":
        await handleSwarmCheckpointedDrizzle(db, event);
        break;

      case "swarm_recovered":
        await handleSwarmRecoveredDrizzle(db, event);
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

async function handleAgentRegisteredDrizzle(
  db: SwarmDb,
  event: AgentRegisteredEvent & { id: number; sequence: number },
): Promise<void> {
  await db
    .insert(agentsTable)
    .values({
      project_key: event.project_key,
      name: event.agent_name,
      program: event.program,
      model: event.model,
      task_description: event.task_description || null,
      registered_at: event.timestamp,
      last_active_at: event.timestamp,
    })
    .onConflictDoUpdate({
      target: [agentsTable.project_key, agentsTable.name],
      set: {
        program: event.program,
        model: event.model,
        task_description: event.task_description || null,
        last_active_at: event.timestamp,
      },
    });
}

async function handleMessageSentDrizzle(
  db: SwarmDb,
  event: MessageSentEvent & { id: number; sequence: number },
): Promise<void> {
  // Insert message
  const result = await db
    .insert(messagesTable)
    .values({
      project_key: event.project_key,
      from_agent: event.from_agent,
      subject: event.subject,
      body: event.body,
      thread_id: event.thread_id || null,
      importance: event.importance,
      ack_required: event.ack_required,
      created_at: event.timestamp,
    })
    .returning({ id: messagesTable.id });

  const messageId = result[0]?.id;
  if (!messageId) {
    throw new Error("Failed to insert message - no row returned");
  }

  // Bulk insert recipients
  if (event.to_agents.length > 0) {
    await db
      .insert(messageRecipientsTable)
      .values(
        event.to_agents.map((agentName) => ({
          message_id: messageId,
          agent_name: agentName,
          read_at: null,
          acked_at: null,
        })),
      )
      .onConflictDoNothing();
  }
}

async function handleFileReservedDrizzle(
  db: SwarmDb,
  event: FileReservedEvent & { id: number; sequence: number },
): Promise<void> {
  // Delete existing active reservations first (idempotency)
  if (event.paths.length > 0) {
    await db
      .delete(reservationsTable)
      .where(
        and(
          eq(reservationsTable.project_key, event.project_key),
          eq(reservationsTable.agent_name, event.agent_name),
          inArray(reservationsTable.path_pattern, event.paths),
          sql`${reservationsTable.released_at} IS NULL`,
        ),
      );
  }

  // Bulk insert reservations
  if (event.paths.length > 0) {
    await db.insert(reservationsTable).values(
      event.paths.map((path) => ({
        project_key: event.project_key,
        agent_name: event.agent_name,
        path_pattern: path,
        exclusive: event.exclusive,
        reason: event.reason || null,
        created_at: event.timestamp,
        expires_at: event.expires_at,
        released_at: null,
      })),
    );
  }
}

async function handleFileReleasedDrizzle(
  db: SwarmDb,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "file_released") return;

  if (event.reservation_ids && event.reservation_ids.length > 0) {
    // Release specific reservations
    await db
      .update(reservationsTable)
      .set({ released_at: event.timestamp })
      .where(inArray(reservationsTable.id, event.reservation_ids));
  } else if (event.paths && event.paths.length > 0) {
    // Release by path
    await db
      .update(reservationsTable)
      .set({ released_at: event.timestamp })
      .where(
        and(
          eq(reservationsTable.project_key, event.project_key),
          eq(reservationsTable.agent_name, event.agent_name),
          inArray(reservationsTable.path_pattern, event.paths),
          sql`${reservationsTable.released_at} IS NULL`,
        ),
      );
  } else {
    // Release all for agent
    await db
      .update(reservationsTable)
      .set({ released_at: event.timestamp })
      .where(
        and(
          eq(reservationsTable.project_key, event.project_key),
          eq(reservationsTable.agent_name, event.agent_name),
          sql`${reservationsTable.released_at} IS NULL`,
        ),
      );
  }
}

// Placeholder implementations for eval and swarm checkpoint handlers
async function handleDecompositionGeneratedDrizzle(
  db: SwarmDb,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "decomposition_generated") return;

  await db
    .insert(evalRecordsTable)
    .values({
      id: event.epic_id,
      project_key: event.project_key,
      task: event.task,
      context: event.context || null,
      strategy: event.strategy,
      epic_title: event.epic_title,
      subtasks: JSON.stringify(event.subtasks),
      created_at: event.timestamp,
      updated_at: event.timestamp,
      outcomes: null,
      overall_success: null,
      total_duration_ms: null,
      total_errors: null,
      human_accepted: null,
      human_modified: null,
      human_notes: null,
      file_overlap_count: null,
      scope_accuracy: null,
      time_balance_ratio: null,
    })
    .onConflictDoNothing();
}

async function handleSubtaskOutcomeDrizzle(
  _db: SwarmDb,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "subtask_outcome") return;

  // TODO: Implement outcome tracking logic
  // This requires reading current record, appending to outcomes array, recomputing metrics
  console.warn("[SwarmMail] handleSubtaskOutcomeDrizzle not fully implemented");
}

async function handleHumanFeedbackDrizzle(
  db: SwarmDb,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "human_feedback") return;

  await db
    .update(evalRecordsTable)
    .set({
      human_accepted: event.accepted,
      human_modified: event.modified,
      human_notes: event.notes || null,
      updated_at: event.timestamp,
    })
    .where(eq(evalRecordsTable.id, event.epic_id));
}

async function handleSwarmCheckpointedDrizzle(
  db: SwarmDb,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "swarm_checkpointed") return;

  await db
    .insert(swarmContextsTable)
    .values({
      id: event.bead_id,
      project_key: event.project_key,
      epic_id: event.epic_id,
      bead_id: event.bead_id,
      strategy: event.strategy,
      files: JSON.stringify(event.files),
      dependencies: JSON.stringify(event.dependencies),
      directives: JSON.stringify(event.directives),
      recovery: JSON.stringify(event.recovery),
      created_at: event.timestamp,
      checkpointed_at: event.timestamp,
      updated_at: event.timestamp,
      recovered_at: null,
      recovered_from_checkpoint: null,
    })
    .onConflictDoUpdate({
      target: swarmContextsTable.id,
      set: {
        project_key: event.project_key,
        strategy: event.strategy,
        files: JSON.stringify(event.files),
        dependencies: JSON.stringify(event.dependencies),
        directives: JSON.stringify(event.directives),
        recovery: JSON.stringify(event.recovery),
        checkpointed_at: event.timestamp,
        updated_at: event.timestamp,
      },
    });
}

async function handleSwarmRecoveredDrizzle(
  db: SwarmDb,
  event: AgentEvent & { id: number; sequence: number },
): Promise<void> {
  if (event.type !== "swarm_recovered") return;

  await db
    .update(swarmContextsTable)
    .set({
      recovered_at: event.timestamp,
      recovered_from_checkpoint: event.recovered_from_checkpoint,
      updated_at: event.timestamp,
    })
    .where(
      and(
        eq(swarmContextsTable.project_key, event.project_key),
        eq(swarmContextsTable.epic_id, event.epic_id),
        eq(swarmContextsTable.bead_id, event.bead_id),
      ),
    );
}

// ============================================================================
// Convenience Wrappers (compatible with old PGlite-based signatures)
// ============================================================================

/**
 * Convenience wrapper for appendEventDrizzle that matches the old signature.
 * Gets database from adapter and converts to SwarmDb.
 */
export async function appendEvent(
  event: AgentEvent,
  projectPath?: string,
  dbOverride?: any,
): Promise<AgentEvent & { id: number; sequence: number }> {
  const { getDatabasePath } = await import("./index.js");
  const { createLibSQLAdapter } = await import("../libsql.js");
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = dbOverride ?? (await createLibSQLAdapter({ url: `file:${getDatabasePath(projectPath)}` }));
  const swarmDb = toDrizzleDb(db);
  
  return appendEventDrizzle(swarmDb, event);
}

/**
 * Convenience wrapper for readEventsDrizzle
 */
export async function readEvents(
  options: {
    projectKey?: string;
    types?: AgentEvent["type"][];
    since?: number;
    until?: number;
    afterSequence?: number;
    limit?: number;
    offset?: number;
  } = {},
  projectPath?: string,
  dbOverride?: any,
): Promise<Array<AgentEvent & { id: number; sequence: number }>> {
  const { getDatabasePath } = await import("./index.js");
  const { createLibSQLAdapter } = await import("../libsql.js");
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = dbOverride ?? (await createLibSQLAdapter({ url: `file:${getDatabasePath(projectPath)}` }));
  const swarmDb = toDrizzleDb(db);
  
  return readEventsDrizzle(swarmDb, options);
}

/**
 * Convenience wrapper for getLatestSequenceDrizzle
 */
export async function getLatestSequence(
  projectKey?: string,
  projectPath?: string,
  dbOverride?: any,
): Promise<number> {
  const { getDatabasePath } = await import("./index.js");
  const { createLibSQLAdapter } = await import("../libsql.js");
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = dbOverride ?? (await createLibSQLAdapter({ url: `file:${getDatabasePath(projectPath)}` }));
  const swarmDb = toDrizzleDb(db);
  
  return getLatestSequenceDrizzle(swarmDb, projectKey);
}
