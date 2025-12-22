/**
 * Agent Mail - Embedded event-sourced implementation
 *
 * Replaces the MCP-based agent-mail with embedded PGLite storage.
 * Same API surface, but no external server dependency.
 *
 * Key features:
 * - Event sourcing for full audit trail
 * - Offset-based resumability (Durable Streams inspired)
 * - Materialized views for fast queries
 * - File reservation with conflict detection
 */
import { registerAgent, sendMessage, reserveFiles, appendEvent } from "./store";
import {
  getAgents,
  getAgent,
  getInbox,
  getMessage,
  getActiveReservations,
  checkConflicts,
} from "./projections";
import { createEvent } from "./events";
import { needsMigration, migrateProjectToGlobal } from "./auto-migrate";
import type { DatabaseAdapter } from "../types/database";
// Removed: isDatabaseHealthy, getDatabaseStats (PGlite infrastructure cleanup)

// ============================================================================
// Constants
// ============================================================================

const MAX_INBOX_LIMIT = 5; // HARD CAP - context preservation
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

// Agent name generation
const ADJECTIVES = [
  "Blue",
  "Red",
  "Green",
  "Gold",
  "Silver",
  "Swift",
  "Bright",
  "Dark",
  "Calm",
  "Bold",
  "Wise",
  "Quick",
  "Warm",
  "Cool",
  "Pure",
  "Wild",
];
const NOUNS = [
  "Lake",
  "Stone",
  "River",
  "Mountain",
  "Forest",
  "Ocean",
  "Star",
  "Moon",
  "Wind",
  "Fire",
  "Cloud",
  "Storm",
  "Dawn",
  "Dusk",
  "Hawk",
  "Wolf",
];

function generateAgentName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}`;
}

// ============================================================================
// Types
// ============================================================================

export interface AgentMailContext {
  projectKey: string;
  agentName: string;
}

export interface InitAgentOptions {
  projectPath: string;
  agentName?: string;
  program?: string;
  model?: string;
  taskDescription?: string;
  dbOverride?: DatabaseAdapter;
}

export interface SendMessageOptions {
  projectPath: string;
  fromAgent: string;
  toAgents: string[];
  subject: string;
  body: string;
  threadId?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ackRequired?: boolean;
}

export interface SendMessageResult {
  success: boolean;
  messageId: number;
  threadId?: string;
  recipientCount: number;
}

export interface GetInboxOptions {
  projectPath: string;
  agentName: string;
  limit?: number;
  urgentOnly?: boolean;
  unreadOnly?: boolean;
  includeBodies?: boolean;
}

export interface InboxMessage {
  id: number;
  from_agent: string;
  subject: string;
  body?: string;
  thread_id: string | null;
  importance: string;
  created_at: number;
}

export interface InboxResult {
  messages: InboxMessage[];
  total: number;
}

export interface ReadMessageOptions {
  projectPath: string;
  messageId: number;
  agentName?: string;
  markAsRead?: boolean;
}

export interface ReserveFilesOptions {
  projectPath: string;
  agentName: string;
  paths: string[];
  reason?: string;
  exclusive?: boolean;
  ttlSeconds?: number;
  force?: boolean;
  dbOverride?: DatabaseAdapter;
}

export interface GrantedReservation {
  id: number;
  path: string;
  expiresAt: number;
}

export interface ReservationConflict {
  path: string;
  holder: string;
  pattern: string;
}

export interface ReserveFilesResult {
  granted: GrantedReservation[];
  conflicts: ReservationConflict[];
}

export interface ReleaseFilesOptions {
  projectPath: string;
  agentName: string;
  paths?: string[];
  reservationIds?: number[];
  dbOverride?: DatabaseAdapter;
}

export interface ReleaseFilesResult {
  released: number;
  releasedAt: number;
}

export interface AcknowledgeOptions {
  projectPath: string;
  messageId: number;
  agentName: string;
}

export interface AcknowledgeResult {
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface HealthResult {
  healthy: boolean;
  database: "connected" | "disconnected";
  stats?: {
    events: number;
    agents: number;
    messages: number;
    reservations: number;
  };
}

// ============================================================================
// Database Helper
// ============================================================================

/**
 * Get database adapter for a project path
 * Creates adapter on-demand for each operation and ensures schema exists
 */
async function getProjectDatabase(projectPath: string) {
  const { getDatabasePath } = await import("./index");
  const { createLibSQLAdapter } = await import("../libsql");
  const { createLibSQLStreamsSchema } = await import("./libsql-schema");
  
  const dbPath = getDatabasePath(projectPath);
  const db = await createLibSQLAdapter({ url: `file:${dbPath}` });
  
  // Ensure schema exists (idempotent)
  await createLibSQLStreamsSchema(db);
  
  return db;
}

// ============================================================================
// Agent Operations
// ============================================================================

/**
 * Initialize an agent for this session
 * 
 * Automatically migrates old project-local databases to global DB on first init.
 */
export async function initAgent(
  options: InitAgentOptions,
): Promise<AgentMailContext> {
  const {
    projectPath,
    agentName = generateAgentName(),
    program = "opencode",
    model = "unknown",
    taskDescription,
    dbOverride,
  } = options;

  // Auto-migrate old project DBs to global DB (fast check, runs once per project)
  if (needsMigration(projectPath)) {
    try {
      const result = await migrateProjectToGlobal(projectPath);
      console.log(`[SwarmMail] Migrated ${result.sourceType} DB → global (${result.stats.events} events, ${result.stats.messages} messages)`);
    } catch (err) {
      // Log but don't fail - migration is best-effort
      console.warn(`[SwarmMail] Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Get database adapter
  const db = dbOverride ?? await getProjectDatabase(projectPath);

  // Register the agent (creates event + updates view)
  await registerAgent(
    projectPath, // Use projectPath as projectKey
    agentName,
    { program, model, taskDescription },
    projectPath,
    db, // Pass database adapter
  );

  // Close database connection (only if we created it)
  if (!dbOverride) {
    await db.close?.();
  }

  return {
    projectKey: projectPath,
    agentName,
  };
}

// ============================================================================
// Message Operations
// ============================================================================

/**
 * Send a message to other agents
 */
export async function sendAgentMessage(
  options: SendMessageOptions,
): Promise<SendMessageResult> {
  const {
    projectPath,
    fromAgent,
    toAgents,
    subject,
    body,
    threadId,
    importance = "normal",
    ackRequired = false,
  } = options;

  // Get database adapter
  const db = await getProjectDatabase(projectPath);

  await sendMessage(
    projectPath,
    fromAgent,
    toAgents,
    subject,
    body,
    { threadId, importance, ackRequired },
    projectPath,
    db, // Pass database adapter
  );

  // Get the message ID from the messages table (not the event ID)
  const { toDrizzleDb } = await import("../libsql.convenience");
  const { messagesTable } = await import("../db/schema/streams");
  const { eq, desc, and } = await import("drizzle-orm");
  
  const swarmDb = toDrizzleDb(db);
  const result = await swarmDb
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.project_key, projectPath),
      eq(messagesTable.from_agent, fromAgent),
      eq(messagesTable.subject, subject)
    ))
    .orderBy(desc(messagesTable.created_at))
    .limit(1);

  const messageId = result[0]?.id ?? 0;

  // Close database connection
  await db.close?.();

  return {
    success: true,
    messageId,
    threadId,
    recipientCount: toAgents.length,
  };
}

/**
 * Get inbox messages for an agent
 */
export async function getAgentInbox(
  options: GetInboxOptions,
): Promise<InboxResult> {
  const {
    projectPath,
    agentName,
    limit = MAX_INBOX_LIMIT,
    urgentOnly = false,
    unreadOnly = false,
    includeBodies = false,
  } = options;

  // Enforce max limit
  const effectiveLimit = Math.min(limit, MAX_INBOX_LIMIT);

  // Get database adapter
  const db = await getProjectDatabase(projectPath);

  const messages = await getInbox(
    projectPath,
    agentName,
    {
      limit: effectiveLimit,
      urgentOnly,
      unreadOnly,
      includeBodies,
    },
    projectPath,
    db, // Pass database adapter
  );

  // Close database connection
  await db.close?.();

  return {
    messages: messages.map((m) => ({
      id: m.id,
      from_agent: m.from_agent,
      subject: m.subject,
      body: includeBodies ? m.body : undefined,
      thread_id: m.thread_id,
      importance: m.importance,
      created_at: m.created_at,
    })),
    total: messages.length,
  };
}

/**
 * Read a single message with full body
 */
export async function readAgentMessage(
  options: ReadMessageOptions,
): Promise<InboxMessage | null> {
  const { projectPath, messageId, agentName, markAsRead = false } = options;

  // Get database adapter
  const db = await getProjectDatabase(projectPath);

  const message = await getMessage(projectPath, messageId, projectPath, db);

  if (!message) {
    await db.close?.();
    return null;
  }

  // Mark as read if requested
  if (markAsRead && agentName) {
    await appendEvent(
      createEvent("message_read", {
        project_key: projectPath,
        message_id: messageId,
        agent_name: agentName,
      }),
      projectPath,
      db, // Pass database adapter
    );
  }

  // Close database connection
  await db.close?.();

  return {
    id: message.id,
    from_agent: message.from_agent,
    subject: message.subject,
    body: message.body,
    thread_id: message.thread_id,
    importance: message.importance,
    created_at: message.created_at,
  };
}

// ============================================================================
// Reservation Operations
// ============================================================================

/**
 * Reserve files for exclusive editing
 * 
 * Now uses DurableLock underneath for actual mutual exclusion
 */
export async function reserveAgentFiles(
  options: ReserveFilesOptions,
): Promise<ReserveFilesResult> {
  const {
    projectPath,
    agentName,
    paths,
    reason,
    exclusive = true,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    force = false,
    dbOverride,
  } = options;

  // Get database adapter
  const db = dbOverride ?? await getProjectDatabase(projectPath);

  // Check for conflicts first
  const conflicts = await checkConflicts(
    projectPath,
    agentName,
    paths,
    projectPath,
    db, // Pass database adapter
  );

  // If conflicts exist and not forcing, reject reservation
  if (conflicts.length > 0 && !force) {
    if (!dbOverride) {
      await db.close?.();
    }
    return {
      granted: [],
      conflicts: conflicts.map((c) => ({
        path: c.path,
        holder: c.holder,
        pattern: c.pattern,
      })),
    };
  }

  // Acquire DurableLocks for each path (only for exclusive reservations)
  const lockHolderIds: string[] = [];
  
  if (exclusive) {
    const { Effect } = await import("effect");
    const { acquireLock, DurableLockLive } = await import("./effect/lock");
    
    try {
      for (const path of paths) {
        const program = Effect.gen(function* (_) {
          const lock = yield* _(acquireLock(path, { db, ttlSeconds }));
          return lock.holder;
        });
        
        const holder = await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
        lockHolderIds.push(holder);
      }
    } catch (error) {
      // Close database connection if we created it
      if (!dbOverride) {
        await db.close?.();
      }
      
      // Re-throw with meaningful context
      if (error && typeof error === 'object' && '_tag' in error) {
        // Effect-TS LockError types
        const lockError = error as { _tag: string; resource?: string; holder?: string };
        throw new Error(`Failed to acquire lock for file reservation: ${lockError._tag}${lockError.resource ? ` (resource: ${lockError.resource})` : ''}`);
      }
      
      // Database or other errors
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to acquire locks for file reservation: ${message}`);
    }
  }

  // Create reservations with lock holder IDs
  const event = await reserveFiles(
    projectPath,
    agentName,
    paths,
    { reason, exclusive, ttlSeconds, lockHolderIds },
    projectPath,
    db, // Pass database adapter
  );

  // Build granted list
  const granted: GrantedReservation[] = paths.map((path, index) => ({
    id: event.id + index, // Approximate - each path gets a reservation
    path,
    expiresAt: event.expires_at,
  }));

  // Close database connection (only if we created it)
  if (!dbOverride) {
    await db.close?.();
  }

  return {
    granted,
    conflicts: conflicts.map((c) => ({
      path: c.path,
      holder: c.holder,
      pattern: c.pattern,
    })),
  };
}

/**
 * Release file reservations
 * 
 * Now uses DurableLock.release() for actual lock release
 */
export async function releaseAgentFiles(
  options: ReleaseFilesOptions,
): Promise<ReleaseFilesResult> {
  const { projectPath, agentName, paths, reservationIds, dbOverride } = options;

  // Get database adapter
  const db = dbOverride ?? await getProjectDatabase(projectPath);

  // Get current reservations to count what we're releasing and get lock holders
  const currentReservations = await getActiveReservations(
    projectPath,
    projectPath,
    agentName,
    db, // Pass database adapter
  );

  let releaseCount = 0;
  let reservationsToRelease: typeof currentReservations = [];

  if (paths && paths.length > 0) {
    // Release specific paths
    reservationsToRelease = currentReservations.filter((r) =>
      paths.includes(r.path_pattern),
    );
    releaseCount = reservationsToRelease.length;
  } else if (reservationIds && reservationIds.length > 0) {
    // Release by ID
    reservationsToRelease = currentReservations.filter((r) =>
      reservationIds.includes(r.id),
    );
    releaseCount = reservationsToRelease.length;
  } else {
    // Release all
    reservationsToRelease = currentReservations;
    releaseCount = currentReservations.length;
  }

  // Release DurableLocks for each reservation using stored holder IDs
  const { Effect } = await import("effect");
  const { releaseLock, DurableLockLive } = await import("./effect/lock");
  
  const lockHolderIds: string[] = [];
  
  // Attempt to release locks using stored holder IDs
  for (const reservation of reservationsToRelease) {
    if (reservation.lock_holder_id) {
      lockHolderIds.push(reservation.lock_holder_id);
      
      try {
        const program = releaseLock(reservation.path_pattern, reservation.lock_holder_id, db);
        await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
      } catch (error) {
        // Ignore lock release errors - locks may have already expired (OK)
        console.warn(`[agent-mail] Failed to release lock for ${reservation.path_pattern}:`, error);
      }
    }
  }

  // Create release event
  await appendEvent(
    createEvent("file_released", {
      project_key: projectPath,
      agent_name: agentName,
      paths,
      reservation_ids: reservationIds,
      lock_holder_ids: lockHolderIds,
    }),
    projectPath,
    db, // Pass database adapter
  );

  // Close database connection (only if we created it)
  if (!dbOverride) {
    await db.close?.();
  }

  return {
    released: releaseCount,
    releasedAt: Date.now(),
  };
}

// ============================================================================
// Acknowledgement Operations
// ============================================================================

/**
 * Acknowledge a message
 */
export async function acknowledgeMessage(
  options: AcknowledgeOptions,
): Promise<AcknowledgeResult> {
  const { projectPath, messageId, agentName } = options;

  const timestamp = Date.now();

  // Get database adapter
  const db = await getProjectDatabase(projectPath);

  await appendEvent(
    createEvent("message_acked", {
      project_key: projectPath,
      message_id: messageId,
      agent_name: agentName,
    }),
    projectPath,
    db, // Pass database adapter
  );

  // Close database connection
  await db.close?.();

  return {
    acknowledged: true,
    acknowledgedAt: new Date(timestamp).toISOString(),
  };
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if the agent mail store is healthy
 * 
 * Migrated from PGlite to libSQL adapter pattern.
 * Delegates to checkSwarmHealth() which uses getSwarmMailLibSQL().
 */
export async function checkHealth(projectPath?: string): Promise<HealthResult> {
  const { checkSwarmHealth } = await import("./swarm-mail.js");
  const result = await checkSwarmHealth(projectPath);
  
  return {
    healthy: result.healthy,
    database: result.database,
  };
}
