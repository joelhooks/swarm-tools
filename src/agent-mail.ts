/**
 * Agent Mail Module - MCP client for multi-agent coordination
 *
 * This module provides type-safe wrappers around the Agent Mail MCP server.
 * It enforces context-preservation defaults to prevent session exhaustion.
 *
 * CRITICAL CONSTRAINTS:
 * - fetch_inbox ALWAYS uses include_bodies: false
 * - fetch_inbox ALWAYS limits to 5 messages max
 * - Use summarize_thread instead of fetching all messages
 * - Auto-release reservations when tasks complete
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

// ============================================================================
// Configuration
// ============================================================================

const AGENT_MAIL_URL = "http://127.0.0.1:8765";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const MAX_INBOX_LIMIT = 5; // HARD CAP - never exceed this

// ============================================================================
// Types
// ============================================================================

/** Agent Mail session state */
export interface AgentMailState {
  projectKey: string;
  agentName: string;
  reservations: number[];
  startedAt: string;
}

// ============================================================================
// Module-level state (keyed by sessionID)
// ============================================================================

/**
 * State storage keyed by sessionID.
 * Since ToolContext doesn't have persistent state, we use a module-level map.
 */
const sessionStates = new Map<string, AgentMailState>();

/** MCP JSON-RPC response */
interface MCPResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** Agent registration result */
interface AgentInfo {
  id: number;
  name: string;
  program: string;
  model: string;
  task_description: string;
  inception_ts: string;
  last_active_ts: string;
  project_id: number;
}

/** Project info */
interface ProjectInfo {
  id: number;
  slug: string;
  human_key: string;
  created_at: string;
}

/** Message header (no body) */
interface MessageHeader {
  id: number;
  subject: string;
  from: string;
  created_ts: string;
  importance: string;
  ack_required: boolean;
  thread_id?: string;
  kind?: string;
}

/** File reservation result */
interface ReservationResult {
  granted: Array<{
    id: number;
    path_pattern: string;
    exclusive: boolean;
    reason: string;
    expires_ts: string;
  }>;
  conflicts: Array<{
    path: string;
    holders: string[];
  }>;
}

/** Thread summary */
interface ThreadSummary {
  thread_id: string;
  summary: {
    participants: string[];
    key_points: string[];
    action_items: string[];
    total_messages: number;
  };
  examples?: Array<{
    id: number;
    subject: string;
    from: string;
    body_md?: string;
  }>;
}

// ============================================================================
// Errors
// ============================================================================

export class AgentMailError extends Error {
  constructor(
    message: string,
    public readonly tool: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "AgentMailError";
  }
}

export class AgentMailNotInitializedError extends Error {
  constructor() {
    super("Agent Mail not initialized. Call agent-mail:init first.");
    this.name = "AgentMailNotInitializedError";
  }
}

export class FileReservationConflictError extends Error {
  constructor(
    message: string,
    public readonly conflicts: Array<{ path: string; holders: string[] }>,
  ) {
    super(message);
    this.name = "FileReservationConflictError";
  }
}

// ============================================================================
// MCP Client
// ============================================================================

/**
 * Call an Agent Mail MCP tool
 */
async function mcpCall<T>(
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${AGENT_MAIL_URL}/mcp/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!response.ok) {
    throw new AgentMailError(
      `HTTP ${response.status}: ${response.statusText}`,
      toolName,
    );
  }

  const result = (await response.json()) as MCPResponse<T>;

  if (result.error) {
    throw new AgentMailError(
      result.error.message,
      toolName,
      result.error.code,
      result.error.data,
    );
  }

  return result.result as T;
}

/**
 * Get Agent Mail state for a session, or throw if not initialized
 */
function requireState(sessionID: string): AgentMailState {
  const state = sessionStates.get(sessionID);
  if (!state) {
    throw new AgentMailNotInitializedError();
  }
  return state;
}

/**
 * Store Agent Mail state for a session
 */
function setState(sessionID: string, state: AgentMailState): void {
  sessionStates.set(sessionID, state);
}

/**
 * Get state if exists (for cleanup hooks)
 */
function getState(sessionID: string): AgentMailState | undefined {
  return sessionStates.get(sessionID);
}

/**
 * Clear state for a session
 */
function clearState(sessionID: string): void {
  sessionStates.delete(sessionID);
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Initialize Agent Mail session
 */
export const agentmail_init = tool({
  description:
    "Initialize Agent Mail session (ensure project + register agent)",
  args: {
    project_path: tool.schema
      .string()
      .describe("Absolute path to the project/repo"),
    agent_name: tool.schema
      .string()
      .optional()
      .describe("Agent name (omit for auto-generated adjective+noun)"),
    task_description: tool.schema
      .string()
      .optional()
      .describe("Description of current task"),
  },
  async execute(args, ctx) {
    // 1. Ensure project exists
    const project = await mcpCall<ProjectInfo>("ensure_project", {
      human_key: args.project_path,
    });

    // 2. Register agent
    const agent = await mcpCall<AgentInfo>("register_agent", {
      project_key: args.project_path,
      program: "opencode",
      model: "claude-opus-4",
      name: args.agent_name, // undefined = auto-generate
      task_description: args.task_description || "",
    });

    // 3. Store state using sessionID
    const state: AgentMailState = {
      projectKey: args.project_path,
      agentName: agent.name,
      reservations: [],
      startedAt: new Date().toISOString(),
    };
    setState(ctx.sessionID, state);

    return JSON.stringify({ project, agent }, null, 2);
  },
});

/**
 * Send a message to other agents
 */
export const agentmail_send = tool({
  description: "Send message to other agents",
  args: {
    to: tool.schema
      .array(tool.schema.string())
      .describe("Recipient agent names"),
    subject: tool.schema.string().describe("Message subject"),
    body: tool.schema.string().describe("Message body (Markdown)"),
    thread_id: tool.schema
      .string()
      .optional()
      .describe("Thread ID (use bead ID for linking)"),
    importance: tool.schema
      .enum(["low", "normal", "high", "urgent"])
      .optional()
      .describe("Message importance (default: normal)"),
    ack_required: tool.schema
      .boolean()
      .optional()
      .describe("Require acknowledgement (default: false)"),
  },
  async execute(args, ctx) {
    const state = requireState(ctx.sessionID);

    await mcpCall("send_message", {
      project_key: state.projectKey,
      sender_name: state.agentName,
      to: args.to,
      subject: args.subject,
      body_md: args.body,
      thread_id: args.thread_id,
      importance: args.importance || "normal",
      ack_required: args.ack_required || false,
    });

    return `Message sent to ${args.to.join(", ")}`;
  },
});

/**
 * Fetch inbox (CONTEXT-SAFE: bodies excluded, limit 5)
 */
export const agentmail_inbox = tool({
  description: "Fetch inbox (CONTEXT-SAFE: bodies excluded, limit 5)",
  args: {
    limit: tool.schema
      .number()
      .max(MAX_INBOX_LIMIT)
      .optional()
      .describe(`Max messages (hard cap: ${MAX_INBOX_LIMIT})`),
    urgent_only: tool.schema
      .boolean()
      .optional()
      .describe("Only show urgent messages"),
    since_ts: tool.schema
      .string()
      .optional()
      .describe("Only messages after this ISO-8601 timestamp"),
  },
  async execute(args, ctx) {
    const state = requireState(ctx.sessionID);

    // CRITICAL: Enforce context-safe defaults
    const limit = Math.min(args.limit || MAX_INBOX_LIMIT, MAX_INBOX_LIMIT);

    const messages = await mcpCall<MessageHeader[]>("fetch_inbox", {
      project_key: state.projectKey,
      agent_name: state.agentName,
      limit,
      include_bodies: false, // MANDATORY - never include bodies
      urgent_only: args.urgent_only || false,
      since_ts: args.since_ts,
    });

    return JSON.stringify(messages, null, 2);
  },
});

/**
 * Read a single message body by ID
 */
export const agentmail_read_message = tool({
  description: "Fetch ONE message body by ID (use after inbox)",
  args: {
    message_id: tool.schema.number().describe("Message ID from inbox"),
  },
  async execute(args, ctx) {
    const state = requireState(ctx.sessionID);

    // Mark as read
    await mcpCall("mark_message_read", {
      project_key: state.projectKey,
      agent_name: state.agentName,
      message_id: args.message_id,
    });

    // Fetch with body - we need to use fetch_inbox with specific message
    // Since there's no get_message, we'll use search
    const messages = await mcpCall<MessageHeader[]>("fetch_inbox", {
      project_key: state.projectKey,
      agent_name: state.agentName,
      limit: 1,
      include_bodies: true, // Only for single message fetch
    });

    const message = messages.find((m) => m.id === args.message_id);
    if (!message) {
      return `Message ${args.message_id} not found`;
    }

    return JSON.stringify(message, null, 2);
  },
});

/**
 * Summarize a thread (PREFERRED over fetching all messages)
 */
export const agentmail_summarize_thread = tool({
  description: "Summarize thread (PREFERRED over fetching all messages)",
  args: {
    thread_id: tool.schema.string().describe("Thread ID (usually bead ID)"),
    include_examples: tool.schema
      .boolean()
      .optional()
      .describe("Include up to 3 sample messages"),
  },
  async execute(args, ctx) {
    const state = requireState(ctx.sessionID);

    const summary = await mcpCall<ThreadSummary>("summarize_thread", {
      project_key: state.projectKey,
      thread_id: args.thread_id,
      include_examples: args.include_examples || false,
      llm_mode: true, // Use LLM for better summaries
    });

    return JSON.stringify(summary, null, 2);
  },
});

/**
 * Reserve file paths for exclusive editing
 */
export const agentmail_reserve = tool({
  description: "Reserve file paths for exclusive editing",
  args: {
    paths: tool.schema
      .array(tool.schema.string())
      .describe("File paths or globs to reserve (e.g., src/auth/**)"),
    ttl_seconds: tool.schema
      .number()
      .optional()
      .describe(`Time to live in seconds (default: ${DEFAULT_TTL_SECONDS})`),
    exclusive: tool.schema
      .boolean()
      .optional()
      .describe("Exclusive lock (default: true)"),
    reason: tool.schema
      .string()
      .optional()
      .describe("Reason for reservation (include bead ID)"),
  },
  async execute(args, ctx) {
    const state = requireState(ctx.sessionID);

    const result = await mcpCall<ReservationResult>("file_reservation_paths", {
      project_key: state.projectKey,
      agent_name: state.agentName,
      paths: args.paths,
      ttl_seconds: args.ttl_seconds || DEFAULT_TTL_SECONDS,
      exclusive: args.exclusive ?? true,
      reason: args.reason || "",
    });

    // Handle unexpected response structure
    if (!result) {
      throw new AgentMailError(
        "Unexpected response: file_reservation_paths returned null/undefined",
        "file_reservation_paths",
      );
    }

    // Check for conflicts
    if (result.conflicts && result.conflicts.length > 0) {
      const conflictDetails = result.conflicts
        .map((c) => `${c.path}: held by ${c.holders.join(", ")}`)
        .join("\n");

      throw new FileReservationConflictError(
        `Cannot reserve files:\n${conflictDetails}`,
        result.conflicts,
      );
    }

    // Handle case where granted is undefined/null (alternative response formats)
    const granted = result.granted ?? [];
    if (!Array.isArray(granted)) {
      throw new AgentMailError(
        `Unexpected response format: expected granted to be an array, got ${typeof granted}`,
        "file_reservation_paths",
      );
    }

    // Store reservation IDs for auto-release
    const reservationIds = granted.map((r) => r.id);
    state.reservations = [...state.reservations, ...reservationIds];
    setState(ctx.sessionID, state);

    if (granted.length === 0) {
      return "No paths were reserved (empty granted list)";
    }

    return `Reserved ${granted.length} path(s):\n${granted
      .map((r) => `  - ${r.path_pattern} (expires: ${r.expires_ts})`)
      .join("\n")}`;
  },
});

/**
 * Release file reservations
 */
export const agentmail_release = tool({
  description: "Release file reservations (auto-called on task completion)",
  args: {
    paths: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Specific paths to release (omit for all)"),
    reservation_ids: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("Specific reservation IDs to release"),
  },
  async execute(args, ctx) {
    const state = requireState(ctx.sessionID);

    const result = await mcpCall<{ released: number; released_at: string }>(
      "release_file_reservations",
      {
        project_key: state.projectKey,
        agent_name: state.agentName,
        paths: args.paths,
        file_reservation_ids: args.reservation_ids,
      },
    );

    // Clear stored reservation IDs
    state.reservations = [];
    setState(ctx.sessionID, state);

    return `Released ${result.released} reservation(s)`;
  },
});

/**
 * Acknowledge a message
 */
export const agentmail_ack = tool({
  description: "Acknowledge a message (for ack_required messages)",
  args: {
    message_id: tool.schema.number().describe("Message ID to acknowledge"),
  },
  async execute(args, ctx) {
    const state = requireState(ctx.sessionID);

    await mcpCall("acknowledge_message", {
      project_key: state.projectKey,
      agent_name: state.agentName,
      message_id: args.message_id,
    });

    return `Acknowledged message ${args.message_id}`;
  },
});

/**
 * Search messages
 */
export const agentmail_search = tool({
  description: "Search messages by keyword (FTS5 syntax supported)",
  args: {
    query: tool.schema
      .string()
      .describe('Search query (e.g., "build plan", plan AND users)'),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max results (default: 20)"),
  },
  async execute(args, ctx) {
    const state = requireState(ctx.sessionID);

    const results = await mcpCall<MessageHeader[]>("search_messages", {
      project_key: state.projectKey,
      query: args.query,
      limit: args.limit || 20,
    });

    return JSON.stringify(results, null, 2);
  },
});

/**
 * Check Agent Mail health
 */
export const agentmail_health = tool({
  description: "Check if Agent Mail server is running",
  args: {},
  async execute(args, ctx) {
    try {
      const response = await fetch(`${AGENT_MAIL_URL}/health/liveness`);
      if (response.ok) {
        return "Agent Mail is running";
      }
      return `Agent Mail returned status ${response.status}`;
    } catch (error) {
      return `Agent Mail not reachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const agentMailTools = {
  agentmail_init: agentmail_init,
  agentmail_send: agentmail_send,
  agentmail_inbox: agentmail_inbox,
  agentmail_read_message: agentmail_read_message,
  agentmail_summarize_thread: agentmail_summarize_thread,
  agentmail_reserve: agentmail_reserve,
  agentmail_release: agentmail_release,
  agentmail_ack: agentmail_ack,
  agentmail_search: agentmail_search,
  agentmail_health: agentmail_health,
};

// ============================================================================
// Utility exports for other modules
// ============================================================================

export {
  mcpCall,
  requireState,
  setState,
  getState,
  clearState,
  sessionStates,
  AGENT_MAIL_URL,
  MAX_INBOX_LIMIT,
};
