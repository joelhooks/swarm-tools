/**
 * Swarm Mail - Embedded event-sourced implementation
 *
 * Replaces the MCP-based agent-mail with embedded PGLite storage.
 * Same API surface, but no external server dependency.
 *
 * Key features:
 * - Event sourcing for full audit trail
 * - Offset-based resumability (Durable Streams inspired)
 * - Materialized views for fast queries
 * - File reservation with conflict detection
 *
 * Effect-TS Integration:
 * - DurableMailbox for message send/receive (envelope pattern)
 * - DurableCursor for positioned inbox consumption with checkpointing
 * - DurableLock for file reservations (mutual exclusion via CAS)
 * - DurableDeferred for request/response messaging
 */
import { createEvent } from "./events";
// Note: isDatabaseHealthy and getDatabaseStats have been removed (PGlite infrastructure cleanup)
// Use Drizzle-based implementations that auto-create adapters when dbOverride is not provided
import {
  type Conflict,
  checkConflicts,
  getActiveReservations,
  getInbox,
  getMessage,
} from "./projections-drizzle";
import { appendEvent } from "./store-drizzle";

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

function generateSwarmAgentName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}`;
}

// ============================================================================
// Types
// ============================================================================

export interface SwarmMailContext {
  projectKey: string;
  agentName: string;
}

export interface InitSwarmAgentOptions {
  projectPath: string;
  agentName?: string;
  program?: string;
  model?: string;
  taskDescription?: string;
  dbOverride?: any;
}

export interface SendSwarmMessageOptions {
  projectPath: string;
  fromAgent: string;
  toAgents: string[];
  subject: string;
  body: string;
  threadId?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ackRequired?: boolean;
  dbOverride?: any;
}

export interface SendSwarmMessageResult {
  success: boolean;
  messageId: number;
  threadId?: string;
  recipientCount: number;
}

export interface GetSwarmInboxOptions {
  projectPath: string;
  agentName: string;
  limit?: number;
  urgentOnly?: boolean;
  unreadOnly?: boolean;
  includeBodies?: boolean;
  dbOverride?: any;
}

export interface SwarmInboxMessage {
  id: number;
  from_agent: string;
  subject: string;
  body?: string;
  thread_id: string | null;
  importance: string;
  created_at: number;
}

export interface SwarmInboxResult {
  messages: SwarmInboxMessage[];
  total: number;
}

export interface ReadSwarmMessageOptions {
  projectPath: string;
  messageId: number;
  agentName?: string;
  markAsRead?: boolean;
  dbOverride?: any;
}

export interface ReserveSwarmFilesOptions {
  projectPath: string;
  agentName: string;
  paths: string[];
  reason?: string;
  exclusive?: boolean;
  ttlSeconds?: number;
  force?: boolean;
  dbOverride?: any;
}

export interface GrantedSwarmReservation {
  id: number;
  path_pattern: string;
  exclusive: boolean;
  expiresAt: number;
}

export interface SwarmReservationConflict {
  path: string;
  holder: string;
  pattern: string;
}

export interface ReserveSwarmFilesResult {
  granted: GrantedSwarmReservation[];
  conflicts: SwarmReservationConflict[];
}

export interface ReleaseSwarmFilesOptions {
  projectPath: string;
  agentName: string;
  paths?: string[];
  reservationIds?: number[];
  dbOverride?: any;
}

export interface ReleaseSwarmFilesResult {
  released: number;
  releasedAt: number;
}

export interface ReleaseSwarmFilesAdminOptions {
  projectPath: string;
  actorName: string;
  dbOverride?: any;
}

export interface ReleaseSwarmFilesForAgentOptions {
  projectPath: string;
  actorName: string;
  targetAgent: string;
  dbOverride?: any;
}

export interface AcknowledgeSwarmOptions {
  projectPath: string;
  messageId: number;
  agentName: string;
  dbOverride?: any;
}

export interface AcknowledgeSwarmResult {
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface SwarmHealthResult {
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
// Agent Operations
// ============================================================================

/**
 * Initialize a swarm agent for this session
 *
 * Future: Can use DurableMailbox.create() for actor-style message consumption
 */
export async function initSwarmAgent(
  options: InitSwarmAgentOptions,
): Promise<SwarmMailContext> {
  const {
    projectPath,
    agentName = generateSwarmAgentName(),
    program = "opencode",
    model = "unknown",
    taskDescription,
    dbOverride,
  } = options;

  // Register the agent (creates event + updates view)
  // Inline the registerAgent logic using appendEvent + createEvent
  const event = createEvent("agent_registered", {
    project_key: projectPath,
    agent_name: agentName,
    program,
    model,
    task_description: taskDescription,
  });
  await appendEvent(event, projectPath, dbOverride);

  return {
    projectKey: projectPath,
    agentName,
  };
}

// ============================================================================
// Message Operations
// ============================================================================

/**
 * Send a message to other swarm agents
 *
 * Future: Use DurableMailbox.send() for envelope pattern with replyTo support
 */
export async function sendSwarmMessage(
  options: SendSwarmMessageOptions,
): Promise<SendSwarmMessageResult> {
  const {
    projectPath,
    fromAgent,
    toAgents,
    subject,
    body,
    threadId,
    importance = "normal",
    ackRequired = false,
    dbOverride,
  } = options;

  // Check if thread exists (for thread_created event)
  let isNewThread = false;
  if (threadId) {
    const { getOrCreateAdapter } = await import("./store-drizzle");
    const { toDrizzleDb } = await import("../libsql.convenience");
    const { messagesTable } = await import("../db/schema/streams");
    const { eq, count } = await import("drizzle-orm");
    
    const adapter = await getOrCreateAdapter(projectPath, dbOverride);
    const swarmDb = toDrizzleDb(adapter);
    const threadCount = await swarmDb
      .select({ count: count() })
      .from(messagesTable)
      .where(eq(messagesTable.thread_id, threadId));
    
    isNewThread = (threadCount[0]?.count ?? 0) === 0;
  }

  // Extract epic_id from thread_id if it matches pattern (e.g., "bd-123" or "mjn...")
  const epicId = threadId; // Assume thread_id IS the epic_id for swarm work
  
  // Classify message type from subject
  let messageType: "progress" | "blocked" | "question" | "status" | "general" | undefined;
  const subjectLower = subject.toLowerCase();
  if (subjectLower.includes("progress") || subjectLower.includes("done") || subjectLower.includes("complete")) {
    messageType = "progress";
  } else if (subjectLower.includes("blocked") || subjectLower.includes("waiting")) {
    messageType = "blocked";
  } else if (subjectLower.includes("?") || subjectLower.includes("question")) {
    messageType = "question";
  } else if (subjectLower.includes("status") || subjectLower.includes("update")) {
    messageType = "status";
  } else {
    messageType = "general";
  }

  // Inline the sendMessage logic using appendEvent + createEvent with enrichment
  const messageEvent = createEvent("message_sent", {
    project_key: projectPath,
    from_agent: fromAgent,
    to_agents: toAgents,
    subject,
    body,
    thread_id: threadId,
    importance,
    ack_required: ackRequired,
    // Thread context enrichment
    epic_id: epicId,
    message_type: messageType,
    body_length: body.length,
    recipient_count: toAgents.length,
    is_broadcast: toAgents.length > 2,
  });
  await appendEvent(messageEvent, projectPath, dbOverride);

  // Emit thread_created event if this is the first message in the thread
  if (isNewThread && threadId) {
    const threadCreatedEvent = createEvent("thread_created", {
      project_key: projectPath,
      thread_id: threadId,
      epic_id: epicId,
      initial_subject: subject,
      creator_agent: fromAgent,
    });
    await appendEvent(threadCreatedEvent, projectPath, dbOverride);
  }

  // Get the message ID from the messages table (not the event ID)
  // CRITICAL: Use same adapter as appendEvent above to avoid empty inbox bug
  const { toDrizzleDb } = await import("../libsql.convenience");
  const { messagesTable } = await import("../db/schema/streams");
  const { eq, desc, and } = await import("drizzle-orm");
  
  // Use getOrCreateAdapter from store-drizzle to get the same cached adapter
  const { getOrCreateAdapter } = await import("./store-drizzle");
  const adapter = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(adapter);
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

  return {
    success: true,
    messageId,
    threadId,
    recipientCount: toAgents.length,
  };
}

/**
 * Get inbox messages for a swarm agent
 *
 * Future: Use DurableCursor.consume() for positioned consumption with checkpointing
 */
export async function getSwarmInbox(
  options: GetSwarmInboxOptions,
): Promise<SwarmInboxResult> {
  const {
    projectPath,
    agentName,
    limit = MAX_INBOX_LIMIT,
    urgentOnly = false,
    unreadOnly = false,
    includeBodies = false,
    dbOverride,
  } = options;

  // Enforce max limit
  const effectiveLimit = Math.min(limit, MAX_INBOX_LIMIT);

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
    dbOverride,
  );

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
export async function readSwarmMessage(
  options: ReadSwarmMessageOptions,
): Promise<SwarmInboxMessage | null> {
  const { projectPath, messageId, agentName, markAsRead = false, dbOverride } = options;

  const message = await getMessage(projectPath, messageId, projectPath, dbOverride);

  if (!message) {
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
      dbOverride,
    );
  }

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
 * Always grants reservations (even with conflicts) - conflicts are warnings, not blockers.
 * This matches the test expectations and allows agents to proceed with awareness.
 * 
 * DEFENSIVE: Cleans up expired reservations before checking conflicts.
 * This ensures expired reservations don't block new reservations.
 *
 * Future: Use DurableLock.acquire() for distributed mutex with automatic expiry
 */
export async function reserveSwarmFiles(
  options: ReserveSwarmFilesOptions,
): Promise<ReserveSwarmFilesResult> {
  const {
    projectPath,
    agentName,
    paths,
    reason,
    exclusive = true,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    dbOverride,
  } = options;

  // CLEANUP: Auto-release expired reservations BEFORE checking conflicts
  // This prevents false conflicts from expired but unreleased reservations
  const { getOrCreateAdapter } = await import("./store-drizzle");
  const { toDrizzleDb } = await import("../libsql.convenience");
  const { cleanupExpiredReservations } = await import("./reservation-utils");

  const adapter = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(adapter);

  await cleanupExpiredReservations(swarmDb, projectPath);

  // Check for conflicts (after cleanup)
  const conflicts = await checkConflicts(
    projectPath,
    agentName,
    paths,
    projectPath,
    dbOverride,
  );

  // Always create reservations - conflicts are warnings, not blockers
  // Inline the reserveFiles logic using appendEvent + createEvent
  const reserveEvent = createEvent("file_reserved", {
    project_key: projectPath,
    agent_name: agentName,
    paths,
    reason,
    exclusive,
    ttl_seconds: ttlSeconds,
    expires_at: Date.now() + ttlSeconds * 1000,
    file_count: paths.length,
    conflict_agent: conflicts.length > 0 ? conflicts[0].holder : undefined,
  });
  await appendEvent(reserveEvent, projectPath, dbOverride);

  // Query the actual reservation IDs from the database
  const reservations = await getActiveReservations(
    projectPath,
    projectPath,
    agentName,
    dbOverride,
  );

  // Filter to just the paths we reserved (most recent ones)
  const granted: GrantedSwarmReservation[] = reservations
    .filter((r) => paths.includes(r.path_pattern))
    .map((r) => ({
      id: r.id,
      path_pattern: r.path_pattern,
      exclusive: r.exclusive,
      expiresAt: r.expires_at,
    }));

  return {
    granted,
    conflicts: conflicts.map((c: Conflict) => ({
      path: c.path,
      holder: c.holder,
      pattern: c.pattern,
    })),
  };
}

/**
 * Release file reservations
 * 
 * DEFENSIVE: Also releases ALL expired reservations (opportunistic cleanup).
 * This is a good opportunity to clean up the database when an agent is explicitly releasing.
 *
 * Future: Use DurableLock.release() for automatic cleanup
 */
export async function releaseSwarmFiles(
  options: ReleaseSwarmFilesOptions,
): Promise<ReleaseSwarmFilesResult> {
  const { projectPath, agentName, paths, reservationIds, dbOverride } = options;

  // OPPORTUNISTIC CLEANUP: Release ALL expired reservations (not just this agent's)
  // This is a good place to do global cleanup since we're already releasing
  const { getOrCreateAdapter } = await import("./store-drizzle");
  const { toDrizzleDb } = await import("../libsql.convenience");
  const { cleanupExpiredReservations } = await import("./reservation-utils");

  const adapter = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(adapter);

  await cleanupExpiredReservations(swarmDb, projectPath);

  // Get current reservations to count what we're releasing
  const currentReservations = await getActiveReservations(
    projectPath,
    projectPath,
    agentName,
    dbOverride,
  );

  let releaseCount = 0;

  if (paths && paths.length > 0) {
    // Release specific paths
    releaseCount = currentReservations.filter((r) =>
      paths.includes(r.path_pattern),
    ).length;
  } else if (reservationIds && reservationIds.length > 0) {
    // Release by ID
    releaseCount = currentReservations.filter((r) =>
      reservationIds.includes(r.id),
    ).length;
  } else {
    // Release all
    releaseCount = currentReservations.length;
  }

  // Create release event with context
  await appendEvent(
    createEvent("file_released", {
      project_key: projectPath,
      agent_name: agentName,
      paths,
      reservation_ids: reservationIds,
      file_count: releaseCount,
    }),
    projectPath,
    dbOverride,
  );

  return {
    released: releaseCount,
    releasedAt: Date.now(),
  };
}

/**
 * Release ALL reservations in a project (coordinator override)
 */
export async function releaseAllSwarmFiles(
  options: ReleaseSwarmFilesAdminOptions,
): Promise<ReleaseSwarmFilesResult> {
  const { projectPath, actorName, dbOverride } = options;

  const currentReservations = await getActiveReservations(
    projectPath,
    projectPath,
    undefined,
    dbOverride,
  );

  const releaseCount = currentReservations.length;

  await appendEvent(
    createEvent("file_released", {
      project_key: projectPath,
      agent_name: actorName,
      release_all: true,
      file_count: releaseCount,
    }),
    projectPath,
    dbOverride,
  );

  return {
    released: releaseCount,
    releasedAt: Date.now(),
  };
}

/**
 * Release all reservations for a specific agent (coordinator override)
 */
export async function releaseSwarmFilesForAgent(
  options: ReleaseSwarmFilesForAgentOptions,
): Promise<ReleaseSwarmFilesResult> {
  const { projectPath, actorName, targetAgent, dbOverride } = options;

  const currentReservations = await getActiveReservations(
    projectPath,
    projectPath,
    targetAgent,
    dbOverride,
  );

  const releaseCount = currentReservations.length;

  await appendEvent(
    createEvent("file_released", {
      project_key: projectPath,
      agent_name: actorName,
      target_agent: targetAgent,
      file_count: releaseCount,
    }),
    projectPath,
    dbOverride,
  );

  return {
    released: releaseCount,
    releasedAt: Date.now(),
  };
}

// ============================================================================
// Acknowledgement Operations
// ============================================================================

/**
 * Acknowledge a swarm message
 */
export async function acknowledgeSwarmMessage(
  options: AcknowledgeSwarmOptions,
): Promise<AcknowledgeSwarmResult> {
  const { projectPath, messageId, agentName, dbOverride } = options;

  const timestamp = Date.now();

  await appendEvent(
    createEvent("message_acked", {
      project_key: projectPath,
      message_id: messageId,
      agent_name: agentName,
    }),
    projectPath,
    dbOverride,
  );

  return {
    acknowledged: true,
    acknowledgedAt: new Date(timestamp).toISOString(),
  };
}

// ============================================================================
// Thread Activity Tracking
// ============================================================================

/**
 * Emit thread_activity event for observability
 * 
 * Call this periodically or after significant thread changes to track:
 * - Number of messages in thread
 * - Number of unique participants
 * - Last agent to send a message
 * - Whether there are unread messages
 * 
 * @param projectPath - Project path
 * @param threadId - Thread ID to track
 * @param dbOverride - Optional database adapter
 */
export async function emitThreadActivity(
  projectPath: string,
  threadId: string,
  dbOverride?: any,
): Promise<void> {
  const { getOrCreateAdapter } = await import("./store-drizzle");
  const { toDrizzleDb } = await import("../libsql.convenience");
  const { messagesTable, messageRecipientsTable } = await import("../db/schema/streams");
  const { eq, count, sql } = await import("drizzle-orm");
  
  const adapter = await getOrCreateAdapter(projectPath, dbOverride);
  const swarmDb = toDrizzleDb(adapter);
  
  // Get message count
  const messageCountResult = await swarmDb
    .select({ count: count() })
    .from(messagesTable)
    .where(eq(messagesTable.thread_id, threadId));
  const messageCount = messageCountResult[0]?.count ?? 0;
  
  // Get participant count (distinct senders)
  const participantResult = await swarmDb
    .select({ count: sql<number>`COUNT(DISTINCT ${messagesTable.from_agent})` })
    .from(messagesTable)
    .where(eq(messagesTable.thread_id, threadId));
  const participantCount = participantResult[0]?.count ?? 0;
  
  // Get last message agent
  const lastMessageResult = await swarmDb
    .select({ from_agent: messagesTable.from_agent })
    .from(messagesTable)
    .where(eq(messagesTable.thread_id, threadId))
    .orderBy(sql`${messagesTable.created_at} DESC`)
    .limit(1);
  const lastMessageAgent = lastMessageResult[0]?.from_agent ?? "";
  
  // Check for unread messages (any message with null read_at)
  const unreadResult = await swarmDb
    .select({ count: count() })
    .from(messageRecipientsTable)
    .innerJoin(messagesTable, eq(messageRecipientsTable.message_id, messagesTable.id))
    .where(
      sql`${messagesTable.thread_id} = ${threadId} AND ${messageRecipientsTable.read_at} IS NULL`
    );
  const hasUnread = (unreadResult[0]?.count ?? 0) > 0;
  
  // Emit thread_activity event
  const activityEvent = createEvent("thread_activity", {
    project_key: projectPath,
    thread_id: threadId,
    message_count: messageCount,
    participant_count: participantCount,
    last_message_agent: lastMessageAgent,
    has_unread: hasUnread,
  });
  
  await appendEvent(activityEvent, projectPath, dbOverride);
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if the swarm mail store is healthy
 * 
 * Migrated from PGlite to libSQL adapter pattern.
 */
export async function checkSwarmHealth(
  projectPath?: string,
): Promise<SwarmHealthResult> {
  const { getSwarmMailLibSQL } = await import("../libsql.convenience.js");
  
  const swarmMail = await getSwarmMailLibSQL(projectPath);
  const db = await swarmMail.getDatabase();
  
  // Test basic connectivity with a simple query
  const result = await db.query("SELECT 1 as test");
  const isHealthy = result.rows.length === 1;
  
  return {
    healthy: isHealthy,
    database: isHealthy ? "connected" : "disconnected",
  };
}
