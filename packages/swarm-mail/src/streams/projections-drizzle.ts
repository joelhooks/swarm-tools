/**
 * Swarm Mail Projections Layer - Drizzle Implementation
 *
 * Drizzle-based queries for materialized views.
 * These are the read-side of CQRS - fast queries over denormalized data.
 *
 * Key projections:
 * - getAgents: List registered agents
 * - getInbox: Get messages for an agent
 * - getActiveReservations: Get current file locks
 * - checkConflicts: Detect reservation conflicts
 */

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { minimatch } from "minimatch";
import type { SwarmDb } from "../db/client.js";
import {
  agentsTable,
  evalRecordsTable,
  messageRecipientsTable,
  messagesTable,
  reservationsTable,
} from "../db/schema/streams.js";
import { cleanupExpiredReservations } from "./reservation-utils.js";

// ============================================================================
// Types
// ============================================================================

export interface Agent {
  id: number;
  name: string;
  program: string;
  model: string;
  task_description: string | null;
  registered_at: number;
  last_active_at: number;
}

export interface Message {
  id: number;
  from_agent: string;
  subject: string;
  body?: string;
  thread_id: string | null;
  importance: string;
  ack_required: boolean;
  created_at: number;
  read_at?: number | null;
  acked_at?: number | null;
}

export interface Reservation {
  id: number;
  agent_name: string;
  path_pattern: string;
  exclusive: boolean;
  reason: string | null;
  created_at: number;
  expires_at: number;
}

export interface Conflict {
  path: string;
  holder: string;
  pattern: string;
  exclusive: boolean;
}

// ============================================================================
// Agent Projections
// ============================================================================

/**
 * Get all agents for a project using Drizzle
 */
export async function getAgentsDrizzle(
  db: SwarmDb,
  projectKey: string,
): Promise<Agent[]> {
  const result = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.project_key, projectKey))
    .orderBy(agentsTable.registered_at);

  return result.map((row) => ({
    id: row.id,
    name: row.name,
    program: row.program ?? "opencode",
    model: row.model ?? "unknown",
    task_description: row.task_description,
    registered_at: row.registered_at,
    last_active_at: row.last_active_at,
  }));
}

/**
 * Get a specific agent by name using Drizzle
 */
export async function getAgentDrizzle(
  db: SwarmDb,
  projectKey: string,
  agentName: string,
): Promise<Agent | null> {
  const result = await db
    .select()
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.project_key, projectKey),
        eq(agentsTable.name, agentName),
      ),
    )
    .limit(1);

  const row = result[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    program: row.program ?? "opencode",
    model: row.model ?? "unknown",
    task_description: row.task_description,
    registered_at: row.registered_at,
    last_active_at: row.last_active_at,
  };
}

// ============================================================================
// Message Projections
// ============================================================================

export interface InboxOptions {
  limit?: number;
  urgentOnly?: boolean;
  unreadOnly?: boolean;
  includeBodies?: boolean;
  sinceTs?: string;
}

/**
 * Get inbox messages for an agent using Drizzle
 */
export async function getInboxDrizzle(
  db: SwarmDb,
  projectKey: string,
  agentName: string,
  options: InboxOptions = {},
): Promise<Message[]> {
  const { limit = 50, urgentOnly = false, unreadOnly = false, includeBodies = true } = options;

  const conditions = [
    eq(messagesTable.project_key, projectKey),
    eq(messageRecipientsTable.agent_name, agentName),
  ];

  if (urgentOnly) {
    conditions.push(eq(messagesTable.importance, "urgent"));
  }

  if (unreadOnly) {
    conditions.push(sql`${messageRecipientsTable.read_at} IS NULL`);
  }

  // Build select fields conditionally
  const selectFields = {
    id: messagesTable.id,
    from_agent: messagesTable.from_agent,
    subject: messagesTable.subject,
    ...(includeBodies ? { body: messagesTable.body } : {}),
    thread_id: messagesTable.thread_id,
    importance: messagesTable.importance,
    ack_required: messagesTable.ack_required,
    created_at: messagesTable.created_at,
    read_at: messageRecipientsTable.read_at,
    acked_at: messageRecipientsTable.acked_at,
  };

  const result = await db
    .select(selectFields)
    .from(messagesTable)
    .innerJoin(
      messageRecipientsTable,
      eq(messagesTable.id, messageRecipientsTable.message_id),
    )
    .where(and(...conditions))
    .orderBy(desc(messagesTable.created_at))
    .limit(limit);

  return result.map((row) => ({
    id: row.id,
    from_agent: row.from_agent,
    subject: row.subject,
    ...(includeBodies && 'body' in row ? { body: row.body } : {}),
    thread_id: row.thread_id,
    importance: row.importance ?? "normal",
    ack_required: Boolean(row.ack_required),
    created_at: row.created_at,
    read_at: row.read_at,
    acked_at: row.acked_at,
  }));
}

/**
 * Get a single message by ID with full body using Drizzle
 */
export async function getMessageDrizzle(
  db: SwarmDb,
  projectKey: string,
  messageId: number,
): Promise<Message | null> {
  const result = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.project_key, projectKey),
        eq(messagesTable.id, messageId),
      ),
    )
    .limit(1);

  const row = result[0];
  if (!row) return null;

  return {
    id: row.id,
    from_agent: row.from_agent,
    subject: row.subject,
    body: row.body,
    thread_id: row.thread_id,
    importance: row.importance ?? "normal",
    ack_required: Boolean(row.ack_required),
    created_at: row.created_at,
  };
}

/**
 * Get all messages in a thread using Drizzle
 */
export async function getThreadMessagesDrizzle(
  db: SwarmDb,
  projectKey: string,
  threadId: string,
): Promise<Message[]> {
  const result = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.project_key, projectKey),
        eq(messagesTable.thread_id, threadId),
      ),
    )
    .orderBy(messagesTable.created_at);

  return result.map((row) => ({
    id: row.id,
    from_agent: row.from_agent,
    subject: row.subject,
    body: row.body,
    thread_id: row.thread_id,
    importance: row.importance ?? "normal",
    ack_required: Boolean(row.ack_required),
    created_at: row.created_at,
  }));
}

// ============================================================================
// Reservation Projections
// ============================================================================

/**
 * Get active (non-expired, non-released) reservations using Drizzle
 * 
 * DEFENSIVE: Auto-releases expired reservations before returning results.
 * This ensures eventual cleanup even if agents crash without releasing.
 */
export async function getActiveReservationsDrizzle(
  db: SwarmDb,
  projectKey: string,
  agentName?: string,
): Promise<Reservation[]> {
  const now = Date.now();

  // CLEANUP: Auto-release expired reservations before querying
  await cleanupExpiredReservations(db, projectKey);

  const conditions = [
    eq(reservationsTable.project_key, projectKey),
    sql`${reservationsTable.released_at} IS NULL`,
    gt(reservationsTable.expires_at, now),
  ];

  if (agentName) {
    conditions.push(eq(reservationsTable.agent_name, agentName));
  }

  const result = await db
    .select()
    .from(reservationsTable)
    .where(and(...conditions))
    .orderBy(reservationsTable.created_at);

  return result.map((row) => ({
    id: row.id,
    agent_name: row.agent_name,
    path_pattern: row.path_pattern,
    exclusive: Boolean(row.exclusive),
    reason: row.reason,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }));
}

/**
 * Check for conflicts with existing reservations using Drizzle
 */
export async function checkConflictsDrizzle(
  db: SwarmDb,
  projectKey: string,
  agentName: string,
  paths: string[],
): Promise<Conflict[]> {
  // Get all active exclusive reservations from OTHER agents
  const reservations = await getActiveReservationsDrizzle(db, projectKey);

  const conflicts: Conflict[] = [];

  for (const reservation of reservations) {
    // Skip own reservations
    if (reservation.agent_name === agentName) {
      continue;
    }

    // Skip non-exclusive reservations
    if (!reservation.exclusive) {
      continue;
    }

    // Check each requested path against the reservation pattern
    for (const path of paths) {
      if (pathMatches(path, reservation.path_pattern)) {
        console.warn("[SwarmMail] Conflict detected", {
          path,
          holder: reservation.agent_name,
          pattern: reservation.path_pattern,
          requestedBy: agentName,
        });

        conflicts.push({
          path,
          holder: reservation.agent_name,
          pattern: reservation.path_pattern,
          exclusive: reservation.exclusive,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    console.warn("[SwarmMail] Total conflicts detected", {
      count: conflicts.length,
      requestedBy: agentName,
      paths,
    });
  }

  return conflicts;
}

/**
 * Check if a path matches a pattern (supports glob patterns)
 */
function pathMatches(path: string, pattern: string): boolean {
  // Exact match
  if (path === pattern) {
    return true;
  }

  // Glob match using minimatch
  return minimatch(path, pattern);
}

// ============================================================================
// Eval Records Projections
// ============================================================================

export interface EvalRecord {
  id: string;
  project_key: string;
  task: string;
  context: string | null;
  strategy: string;
  epic_title: string;
  subtasks: Array<{
    title: string;
    files: string[];
    priority?: number;
  }>;
  outcomes?: Array<{
    bead_id: string;
    planned_files: string[];
    actual_files: string[];
    duration_ms: number;
    error_count: number;
    retry_count: number;
    success: boolean;
  }>;
  overall_success: boolean | null;
  total_duration_ms: number | null;
  total_errors: number | null;
  human_accepted: boolean | null;
  human_modified: boolean | null;
  human_notes: string | null;
  file_overlap_count: number | null;
  scope_accuracy: number | null;
  time_balance_ratio: number | null;
  created_at: number;
  updated_at: number;
}

export interface EvalStats {
  totalRecords: number;
  successRate: number;
  avgDurationMs: number;
  byStrategy: Record<string, number>;
}

/**
 * Get eval records with optional filters using Drizzle
 */
export async function getEvalRecordsDrizzle(
  db: SwarmDb,
  projectKey: string,
  options?: { limit?: number; strategy?: string },
): Promise<EvalRecord[]> {
  const conditions = [eq(evalRecordsTable.project_key, projectKey)];

  if (options?.strategy) {
    conditions.push(eq(evalRecordsTable.strategy, options.strategy));
  }

  let query = db
    .select()
    .from(evalRecordsTable)
    .where(and(...conditions))
    .orderBy(desc(evalRecordsTable.created_at))
    .$dynamic();

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const result = await query;

  return result.map((row) => ({
    id: row.id,
    project_key: row.project_key,
    task: row.task,
    context: row.context,
    strategy: row.strategy,
    epic_title: row.epic_title,
    subtasks:
      typeof row.subtasks === "string"
        ? JSON.parse(row.subtasks)
        : row.subtasks,
    outcomes: row.outcomes
      ? typeof row.outcomes === "string"
        ? JSON.parse(row.outcomes)
        : row.outcomes
      : undefined,
    overall_success: row.overall_success ? Boolean(row.overall_success) : null,
    total_duration_ms: row.total_duration_ms,
    total_errors: row.total_errors,
    human_accepted: row.human_accepted ? Boolean(row.human_accepted) : null,
    human_modified: row.human_modified ? Boolean(row.human_modified) : null,
    human_notes: row.human_notes,
    file_overlap_count: row.file_overlap_count,
    scope_accuracy: row.scope_accuracy,
    time_balance_ratio: row.time_balance_ratio,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Get eval statistics for a project using Drizzle
 */
export async function getEvalStatsDrizzle(
  db: SwarmDb,
  projectKey: string,
): Promise<EvalStats> {
  // Get overall stats
  const overallResult = await db
    .select({
      total_records: sql<number>`COUNT(*)`,
      success_count: sql<number>`COUNT(*) FILTER (WHERE ${evalRecordsTable.overall_success} = 1)`,
      avg_duration: sql<number>`AVG(${evalRecordsTable.total_duration_ms})`,
    })
    .from(evalRecordsTable)
    .where(eq(evalRecordsTable.project_key, projectKey));

  const totalRecords = overallResult[0]?.total_records ?? 0;
  const successCount = overallResult[0]?.success_count ?? 0;
  const avgDurationMs = overallResult[0]?.avg_duration ?? 0;

  // Get by-strategy breakdown
  const strategyResult = await db
    .select({
      strategy: evalRecordsTable.strategy,
      count: sql<number>`COUNT(*)`,
    })
    .from(evalRecordsTable)
    .where(eq(evalRecordsTable.project_key, projectKey))
    .groupBy(evalRecordsTable.strategy);

  const byStrategy: Record<string, number> = {};
  for (const row of strategyResult) {
    byStrategy[row.strategy] = row.count;
  }

  return {
    totalRecords,
    successRate: totalRecords > 0 ? successCount / totalRecords : 0,
    avgDurationMs,
    byStrategy,
  };
}

// ============================================================================
// Convenience Wrappers (compatible with old PGlite-based signatures)
// ============================================================================

/**
 * Utility: Get or create database adapter with schema initialization
 * 
 * CRITICAL: All convenience wrappers MUST call this to ensure schema exists.
 * Fixes bug where raw adapters (dbOverride) or auto-created adapters
 * would throw "no such table" errors.
 */
async function getOrCreateAdapter(projectPath?: string, dbOverride?: any): Promise<any> {
  const { getDatabasePath } = await import("./index.js");
  const { createLibSQLAdapter } = await import("../libsql.js");
  const { createLibSQLStreamsSchema } = await import("./libsql-schema.js");
  
  const db = dbOverride ?? (await createLibSQLAdapter({ url: `file:${getDatabasePath(projectPath)}` }));
  
  // CRITICAL: Ensure schema exists (idempotent - safe to call multiple times)
  await createLibSQLStreamsSchema(db);
  
  return db;
}

/**
 * Convenience wrapper for getAgentsDrizzle that matches the old signature.
 */
export async function getAgents(
  projectKey: string,
  projectPath?: string,
  dbOverride?: any,
): Promise<Agent[]> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return getAgentsDrizzle(swarmDb, projectKey);
}

/**
 * Convenience wrapper for getAgentDrizzle
 */
export async function getAgent(
  projectKey: string,
  agentName: string,
  projectPath?: string,
  dbOverride?: any,
): Promise<Agent | null> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return getAgentDrizzle(swarmDb, projectKey, agentName);
}

/**
 * Convenience wrapper for getInboxDrizzle
 */
export async function getInbox(
  projectKey: string,
  agentName: string,
  options?: InboxOptions,
  projectPath?: string,
  dbOverride?: any,
): Promise<Message[]> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return getInboxDrizzle(swarmDb, projectKey, agentName, options);
}

/**
 * Convenience wrapper for getMessageDrizzle
 */
export async function getMessage(
  projectKey: string,
  messageId: number,
  projectPath?: string,
  dbOverride?: any,
): Promise<Message | null> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return getMessageDrizzle(swarmDb, projectKey, messageId);
}

/**
 * Convenience wrapper for getThreadMessagesDrizzle
 */
export async function getThreadMessages(
  projectKey: string,
  threadId: string,
  projectPath?: string,
  dbOverride?: any,
): Promise<Message[]> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return getThreadMessagesDrizzle(swarmDb, projectKey, threadId);
}

/**
 * Convenience wrapper for getActiveReservationsDrizzle
 */
export async function getActiveReservations(
  projectKey: string,
  projectPath?: string,
  agentName?: string,
  dbOverride?: any,
): Promise<Reservation[]> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return getActiveReservationsDrizzle(swarmDb, projectKey, agentName);
}

/**
 * Convenience wrapper for checkConflictsDrizzle
 */
export async function checkConflicts(
  projectKey: string,
  agentName: string,
  paths: string[],
  projectPath?: string,
  dbOverride?: any,
): Promise<Conflict[]> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return checkConflictsDrizzle(swarmDb, projectKey, agentName, paths);
}

/**
 * Convenience wrapper for getEvalRecordsDrizzle
 */
export async function getEvalRecords(
  projectKey: string,
  options?: { limit?: number; offset?: number; strategy?: string },
  projectPath?: string,
  dbOverride?: any,
): Promise<EvalRecord[]> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return getEvalRecordsDrizzle(swarmDb, projectKey, options);
}

/**
 * Convenience wrapper for getEvalStatsDrizzle
 */
export async function getEvalStats(
  projectKey: string,
  projectPath?: string,
  dbOverride?: any,
): Promise<EvalStats> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");
  
  const db = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(db);
  
  return getEvalStatsDrizzle(swarmDb, projectKey);
}
