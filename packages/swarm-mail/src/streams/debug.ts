/**
 * Swarm Mail Debug Tools (DEPRECATED - PGlite functions removed)
 *
 * Legacy PGlite-based debug tools. This file exists only for backward compatibility.
 * Most functions now require explicit DatabaseAdapter parameter.
 *
 * @deprecated Use adapter-based debugging tools instead
 */
import { readEvents, getLatestSequence, replayEventsBatched } from "./store";
import { getAgent, getActiveReservations, getMessage } from "./projections";
import type { AgentEvent } from "./events";

// ============================================================================
// Types
// ============================================================================

export interface DebugEventsOptions {
  projectPath: string;
  types?: AgentEvent["type"][];
  agentName?: string;
  limit?: number;
  since?: number;
  until?: number;
}

export interface DebugEventResult {
  id: number;
  sequence: number;
  type: AgentEvent["type"];
  timestamp: number;
  timestamp_human: string;
  agent_name?: string;
  from_agent?: string;
  to_agents?: string[];
  [key: string]: unknown;
}

export interface DebugEventsResult {
  events: DebugEventResult[];
  total: number;
}

export interface DebugAgentOptions {
  projectPath: string;
  agentName: string;
  includeEvents?: boolean;
}

export interface DebugAgentResult {
  agent: {
    name: string;
    program: string;
    model: string;
    task_description: string | null;
    registered_at: number;
    last_active_at: number;
  } | null;
  stats: {
    messagesSent: number;
    messagesReceived: number;
  };
  reservations: Array<{
    id: number;
    path: string;
    reason: string | null;
    expires_at: number;
  }>;
  recentEvents?: DebugEventResult[];
}

export interface DebugMessageOptions {
  projectPath: string;
  messageId: number;
  includeEvents?: boolean;
}

export interface DebugMessageResult {
  message: {
    id: number;
    from_agent: string;
    subject: string;
    body: string;
    thread_id: string | null;
    importance: string;
    created_at: number;
  } | null;
  recipients: Array<{
    agent_name: string;
    read_at: number | null;
    acked_at: number | null;
  }>;
  events?: DebugEventResult[];
}

export interface DebugReservationsOptions {
  projectPath: string;
  checkConflicts?: boolean;
}

export interface DebugReservationsResult {
  reservations: Array<{
    id: number;
    agent_name: string;
    path_pattern: string;
    reason: string | null;
    expires_at: number;
    expires_in_human: string;
  }>;
  byAgent: Record<string, Array<{ path: string; expires_at: number }>>;
  conflicts?: Array<{
    path1: string;
    agent1: string;
    path2: string;
    agent2: string;
  }>;
}

export interface TimelineEntry {
  time: string;
  type: AgentEvent["type"];
  summary: string;
  agent: string;
  sequence: number;
}

export interface TimelineResult {
  timeline: TimelineEntry[];
}

export interface InspectStateOptions {
  projectPath: string;
  format?: "object" | "json";
}

export interface InspectStateResult {
  agents: Array<{
    name: string;
    program: string;
    model: string;
    task_description: string | null;
  }>;
  messages: Array<{
    id: number;
    from_agent: string;
    subject: string;
    thread_id: string | null;
  }>;
  reservations: Array<{
    id: number;
    agent_name: string;
    path_pattern: string;
  }>;
  eventCount: number;
  latestSequence: number;
  stats: {
    events: number;
    agents: number;
    messages: number;
    reservations: number;
  };
  json?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format timestamp as human-readable ISO string
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Format duration as human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 0) return "expired";
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

/**
 * Generate event summary for timeline
 */
function summarizeEvent(
  event: AgentEvent & { id: number; sequence: number },
): string {
  switch (event.type) {
    case "agent_registered":
      return `Agent ${event.agent_name} registered (${event.program}/${event.model})`;
    case "agent_active":
      return `Agent ${event.agent_name} active`;
    case "message_sent":
      return `${event.from_agent} → ${event.to_agents.join(", ")}: "${event.subject}"`;
    case "message_read":
      return `${event.agent_name} read message #${event.message_id}`;
    case "message_acked":
      return `${event.agent_name} acked message #${event.message_id}`;
    case "file_reserved":
      return `${event.agent_name} reserved ${event.paths.length} file(s)`;
    case "file_released":
      return `${event.agent_name} released files`;
    case "task_started":
      return `${event.agent_name} started task: ${event.bead_id}`;
    case "task_progress":
      return `${event.agent_name} progress on ${event.bead_id}: ${event.progress_percent}%`;
    case "task_completed":
      return `${event.agent_name} completed ${event.bead_id}`;
    case "task_blocked":
      return `${event.agent_name} blocked on ${event.bead_id}: ${event.reason}`;
    default:
      return `Unknown event type`;
  }
}

/**
 * Get agent name from event (handles different event types)
 */
function getAgentFromEvent(event: AgentEvent): string {
  if ("agent_name" in event && event.agent_name) return event.agent_name;
  if ("from_agent" in event && event.from_agent) return event.from_agent;
  return "unknown";
}

// ============================================================================
// Debug Functions
// ============================================================================

/**
 * Get recent events with filtering
 *
 * For large event logs (>100k events), consider using batchSize option
 * to paginate through results instead of loading all events.
 */
export async function debugEvents(
  options: DebugEventsOptions & { batchSize?: number },
): Promise<DebugEventsResult> {
  const {
    projectPath,
    types,
    agentName,
    limit = 50,
    since,
    until,
    batchSize,
  } = options;

  // If batchSize is specified, use pagination to avoid OOM
  if (batchSize && batchSize > 0) {
    return await debugEventsPaginated({ ...options, batchSize });
  }

  // Get all events first (we'll filter in memory for agent name)
  const allEvents = await readEvents(
    {
      projectKey: projectPath,
      types,
      since,
      until,
    },
    projectPath,
  );

  // Filter by agent name if specified
  let filteredEvents = allEvents;
  if (agentName) {
    filteredEvents = allEvents.filter((e) => {
      if ("agent_name" in e && e.agent_name === agentName) return true;
      if ("from_agent" in e && e.from_agent === agentName) return true;
      if ("to_agents" in e && e.to_agents?.includes(agentName)) return true;
      return false;
    });
  }

  // Sort by sequence descending (most recent first)
  filteredEvents.sort((a, b) => b.sequence - a.sequence);

  // Apply limit
  const limitedEvents = filteredEvents.slice(0, limit);

  // Format for output - extract known fields, spread rest
  const events: DebugEventResult[] = limitedEvents.map((e) => {
    const { id, sequence, type, timestamp, project_key, ...rest } = e;
    return {
      id,
      sequence,
      type,
      timestamp,
      timestamp_human: formatTimestamp(timestamp),
      ...rest,
    };
  });

  return {
    events,
    total: filteredEvents.length,
  };
}

/**
 * Get events using pagination to avoid OOM on large logs
 */
async function debugEventsPaginated(
  options: DebugEventsOptions & { batchSize: number },
): Promise<DebugEventsResult> {
  const {
    projectPath,
    types,
    agentName,
    limit = 50,
    since,
    until,
    batchSize,
  } = options;

  const allEvents: Array<AgentEvent & { id: number; sequence: number }> = [];
  let offset = 0;
  let hasMore = true;

  // Fetch in batches until we have enough events or run out
  while (hasMore && allEvents.length < limit) {
    const batch = await readEvents(
      {
        projectKey: projectPath,
        types,
        since,
        until,
        limit: batchSize,
        offset,
      },
      projectPath,
    );

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    // Filter by agent name if specified
    const filtered = agentName
      ? batch.filter((e) => {
          if ("agent_name" in e && e.agent_name === agentName) return true;
          if ("from_agent" in e && e.from_agent === agentName) return true;
          if ("to_agents" in e && e.to_agents?.includes(agentName)) return true;
          return false;
        })
      : batch;

    allEvents.push(...filtered);
    offset += batchSize;


  }

  // Sort by sequence descending (most recent first)
  allEvents.sort((a, b) => b.sequence - a.sequence);

  // Apply limit
  const limitedEvents = allEvents.slice(0, limit);

  // Format for output
  const events: DebugEventResult[] = limitedEvents.map((e) => {
    const { id, sequence, type, timestamp, project_key, ...rest } = e;
    return {
      id,
      sequence,
      type,
      timestamp,
      timestamp_human: formatTimestamp(timestamp),
      ...rest,
    };
  });

  return {
    events,
    total: allEvents.length,
  };
}

/**
 * Get detailed agent information
 * 
 * @deprecated Use Drizzle-based queries directly with DatabaseAdapter
 */
export async function debugAgent(
  options: DebugAgentOptions,
): Promise<DebugAgentResult> {
  const { projectPath, agentName, includeEvents = false } = options;

  // Get agent from projections
  const agent = await getAgent(projectPath, agentName, projectPath);

  if (!agent) {
    return {
      agent: null,
      stats: { messagesSent: 0, messagesReceived: 0 },
      reservations: [],
    };
  }

  // Get message counts using Drizzle
  const { getDatabasePath } = await import("./index");
  const { createLibSQLAdapter } = await import("../libsql");
  const { toDrizzleDb } = await import("../libsql.convenience");
  const { messagesTable, messageRecipientsTable } = await import("../db/schema/streams");
  const { eq, sql, and } = await import("drizzle-orm");
  
  const dbPath = getDatabasePath(projectPath);
  const adapter = await createLibSQLAdapter({ url: `file:${dbPath}` });
  const swarmDb = toDrizzleDb(adapter);
  
  const sentResult = await swarmDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(messagesTable)
    .where(and(
      eq(messagesTable.project_key, projectPath),
      eq(messagesTable.from_agent, agentName)
    ));
  
  const receivedResult = await swarmDb
    .select({ count: sql<number>`COUNT(*)` })
    .from(messageRecipientsTable)
    .innerJoin(messagesTable, eq(messageRecipientsTable.message_id, messagesTable.id))
    .where(and(
      eq(messagesTable.project_key, projectPath),
      eq(messageRecipientsTable.agent_name, agentName)
    ));

  // Get active reservations
  const reservations = await getActiveReservations(
    projectPath,
    projectPath,
    agentName,
  );

  const result: DebugAgentResult = {
    agent: {
      name: agent.name,
      program: agent.program,
      model: agent.model,
      task_description: agent.task_description,
      registered_at: agent.registered_at,
      last_active_at: agent.last_active_at,
    },
    stats: {
      messagesSent: sentResult[0]?.count ?? 0,
      messagesReceived: receivedResult[0]?.count ?? 0,
    },
    reservations: reservations.map((r) => ({
      id: r.id,
      path: r.path_pattern,
      reason: r.reason,
      expires_at: r.expires_at,
    })),
  };

  // Include recent events if requested
  if (includeEvents) {
    const eventsResult = await debugEvents({
      projectPath,
      agentName,
      limit: 20,
    });
    result.recentEvents = eventsResult.events;
  }

  return result;
}

/**
 * Get detailed message information with audit trail
 * 
 * @deprecated PGlite getDatabase() has been removed. Use Drizzle-based queries with DatabaseAdapter.
 */
export async function debugMessage(
  options: DebugMessageOptions,
): Promise<DebugMessageResult> {
  throw new Error(
    "[debug] debugMessage() requires refactoring after PGlite removal. " +
    "Use Drizzle-based queries with DatabaseAdapter instead."
  );
}

/**
 * Get current reservation state
 */
export async function debugReservations(
  options: DebugReservationsOptions,
): Promise<DebugReservationsResult> {
  const { projectPath, checkConflicts = false } = options;

  const reservations = await getActiveReservations(projectPath, projectPath);
  const now = Date.now();

  // Format reservations
  const formattedReservations = reservations.map((r) => ({
    id: r.id,
    agent_name: r.agent_name,
    path_pattern: r.path_pattern,
    reason: r.reason,
    expires_at: r.expires_at,
    expires_in_human: formatDuration(r.expires_at - now),
  }));

  // Group by agent
  const byAgent: Record<
    string,
    Array<{ path: string; expires_at: number }>
  > = {};
  for (const r of reservations) {
    if (!byAgent[r.agent_name]) {
      byAgent[r.agent_name] = [];
    }
    byAgent[r.agent_name].push({
      path: r.path_pattern,
      expires_at: r.expires_at,
    });
  }

  const result: DebugReservationsResult = {
    reservations: formattedReservations,
    byAgent,
  };

  // Check for conflicts if requested
  if (checkConflicts) {
    const conflicts: Array<{
      path1: string;
      agent1: string;
      path2: string;
      agent2: string;
    }> = [];

    // Simple overlap detection - check if any patterns might conflict
    for (let i = 0; i < reservations.length; i++) {
      for (let j = i + 1; j < reservations.length; j++) {
        const r1 = reservations[i];
        const r2 = reservations[j];

        // Skip same agent
        if (r1.agent_name === r2.agent_name) continue;

        // Check for potential overlap (simple heuristic)
        const p1 = r1.path_pattern;
        const p2 = r2.path_pattern;

        // Glob pattern might overlap with specific file
        if (
          p1.includes("**") &&
          p2.startsWith(p1.replace("/**", "").replace("**", ""))
        ) {
          conflicts.push({
            path1: p1,
            agent1: r1.agent_name,
            path2: p2,
            agent2: r2.agent_name,
          });
        } else if (
          p2.includes("**") &&
          p1.startsWith(p2.replace("/**", "").replace("**", ""))
        ) {
          conflicts.push({
            path1: p2,
            agent1: r2.agent_name,
            path2: p1,
            agent2: r1.agent_name,
          });
        }
      }
    }

    result.conflicts = conflicts;
  }

  return result;
}

/**
 * Get event timeline for visualization
 */
export async function getEventTimeline(options: {
  projectPath: string;
  since?: number;
  until?: number;
  limit?: number;
}): Promise<TimelineResult> {
  const { projectPath, since, until, limit = 100 } = options;

  const events = await readEvents(
    {
      projectKey: projectPath,
      since,
      until,
      limit,
    },
    projectPath,
  );

  // Sort by sequence ascending for timeline
  events.sort((a, b) => a.sequence - b.sequence);

  const timeline: TimelineEntry[] = events.map((e) => ({
    time: formatTimestamp(e.timestamp),
    type: e.type,
    summary: summarizeEvent(e),
    agent: getAgentFromEvent(e),
    sequence: e.sequence,
  }));

  return { timeline };
}

/**
 * Get complete state snapshot for debugging
 * 
 * @deprecated PGlite getDatabase() has been removed. Use Drizzle-based queries with DatabaseAdapter.
 */
export async function inspectState(
  options: InspectStateOptions,
): Promise<InspectStateResult> {
  throw new Error(
    "[debug] inspectState() requires refactoring after PGlite removal. " +
    "Use Drizzle-based queries with DatabaseAdapter instead."
  );
}
