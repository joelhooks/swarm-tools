/**
 * Swarm Mail Plugin Tools - Embedded event-sourced implementation
 *
 * Replaces the MCP-based agent-mail with embedded PGLite storage.
 * Same tool API surface, but no external server dependency.
 *
 * Key features:
 * - Event sourcing for full audit trail
 * - Offset-based resumability (Durable Streams inspired)
 * - Materialized views for fast queries
 * - File reservation with conflict detection
 *
 * CRITICAL CONSTRAINTS (same as agent-mail):
 * - swarmmail_inbox ALWAYS limits to 5 messages max
 * - swarmmail_inbox ALWAYS excludes bodies by default
 * - Use summarize_thread instead of fetching all messages
 * - Auto-release reservations when tasks complete
 */
import { tool } from "@opencode-ai/plugin";
import {
  initSwarmAgent,
  sendSwarmMessage,
  getSwarmInbox,
  readSwarmMessage,
  reserveSwarmFiles,
  releaseSwarmFiles,
  releaseAllSwarmFiles,
  releaseSwarmFilesForAgent,
  acknowledgeSwarmMessage,
  checkSwarmHealth,
  getActiveReservations,
  type MailSessionState,
} from "swarm-mail";
import { isInCoordinatorContext } from "./planning-guardrails";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// Types
// ============================================================================

/** Tool execution context from OpenCode plugin */
interface ToolContext {
  sessionID: string;
}

/**
 * Swarm Mail session state
 * @deprecated Use MailSessionState from streams/events.ts instead
 * This is kept for backward compatibility and re-exported as an alias
 */
export type SwarmMailState = MailSessionState;

/** Init tool arguments */
interface InitArgs {
  project_path?: string;
  agent_name?: string;
  task_description?: string;
}

/** Send tool arguments */
interface SendArgs {
  to: string[];
  subject: string;
  body: string;
  thread_id?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ack_required?: boolean;
}

/** Inbox tool arguments */
interface InboxArgs {
  limit?: number;
  urgent_only?: boolean;
}

/** Read message tool arguments */
interface ReadMessageArgs {
  message_id: number;
}

/** Reserve tool arguments */
interface ReserveArgs {
  paths: string[];
  reason?: string;
  exclusive?: boolean;
  ttl_seconds?: number;
}

/** Release tool arguments */
interface ReleaseArgs {
  paths?: string[];
  reservation_ids?: number[];
}

/** Release by agent tool arguments */
interface ReleaseAgentArgs {
  agent_name: string;
}

/** Ack tool arguments */
interface AckArgs {
  message_id: number;
}

// ============================================================================
// Configuration
// ============================================================================

const MAX_INBOX_LIMIT = 5; // HARD CAP - context preservation

/**
 * Default project directory for Swarm Mail operations
 *
 * This is set by the plugin init to the actual working directory (from OpenCode).
 * Without this, tools might use the plugin's directory instead of the project's.
 */
let swarmMailProjectDirectory: string | null = null;

/**
 * Set the default project directory for Swarm Mail operations
 *
 * Called during plugin initialization with the actual project directory.
 */
export function setSwarmMailProjectDirectory(directory: string): void {
  swarmMailProjectDirectory = directory;
}

/**
 * Get the default project directory
 * Returns undefined if not set - let getDatabasePath use global fallback
 */
export function getSwarmMailProjectDirectory(): string | undefined {
  return swarmMailProjectDirectory ?? undefined;
}

// ============================================================================
// Session State Management
// ============================================================================

const SESSION_STATE_DIR =
  process.env.SWARM_STATE_DIR || join(tmpdir(), "swarm-sessions");

function getSessionStatePath(sessionID: string): string {
  const safeID = sessionID.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(SESSION_STATE_DIR, `${safeID}.json`);
}

function loadSessionState(sessionID: string): SwarmMailState | null {
  const path = getSessionStatePath(sessionID);
  try {
    if (existsSync(path)) {
      const data = readFileSync(path, "utf-8");
      return JSON.parse(data) as SwarmMailState;
    }
  } catch (error) {
    console.warn(`[swarm-mail] Could not load session state: ${error}`);
  }
  return null;
}

function saveSessionState(sessionID: string, state: SwarmMailState): boolean {
  try {
    if (!existsSync(SESSION_STATE_DIR)) {
      mkdirSync(SESSION_STATE_DIR, { recursive: true });
    }
    const path = getSessionStatePath(sessionID);
    writeFileSync(path, JSON.stringify(state, null, 2));
    return true;
  } catch (error) {
    console.warn(`[swarm-mail] Could not save session state: ${error}`);
    return false;
  }
}

export function clearSessionState(sessionID: string): void {
  const path = getSessionStatePath(sessionID);
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Ignore errors
  }
}

function hasCoordinatorOverride(sessionID?: string): boolean {
  return isInCoordinatorContext(sessionID) || isInCoordinatorContext();
}

function formatCoordinatorOverrideError(params: {
  tool: "swarmmail_release_all" | "swarmmail_release_agent";
  state: SwarmMailState;
  sessionID: string;
}): string {
  return JSON.stringify(
    {
      error:
        "Coordinator-only override. Ask the coordinator to use this tool for stale or orphaned reservations.",
      guard: "coordinator_only",
      required_context: "coordinator",
      tool: params.tool,
      agent_name: params.state.agentName,
      project_key: params.state.projectKey,
      session_id: params.sessionID,
      suggestion:
        "If reservations are stale, notify the coordinator via swarmmail_send before releasing.",
    },
    null,
    2,
  );
}

// ============================================================================
// Plugin Tools
// ============================================================================

/**
 * Initialize Swarm Mail session
 */
export const swarmmail_init = tool({
  description:
    "Initialize Swarm Mail session. Creates agent identity and registers with the embedded event store.",
  args: {
    project_path: tool.schema
      .string()
      .optional()
      .describe("Project path (defaults to current working directory)"),
    agent_name: tool.schema
      .string()
      .optional()
      .describe("Custom agent name (auto-generated if not provided)"),
    task_description: tool.schema
      .string()
      .optional()
      .describe("Description of the task this agent is working on"),
  },
  async execute(args: InitArgs, ctx: ToolContext): Promise<string> {
    // For init, we need a project path - use provided, stored, or cwd
    const projectPath =
      args.project_path || getSwarmMailProjectDirectory() || process.cwd();
    const sessionID = ctx.sessionID || "default";

    // Check if already initialized
    const existingState = loadSessionState(sessionID);
    if (existingState) {
      return JSON.stringify(
        {
          agent_name: existingState.agentName,
          project_key: existingState.projectKey,
          message: `Session already initialized as ${existingState.agentName}`,
          already_initialized: true,
        },
        null,
        2,
      );
    }

    try {
      const result = await initSwarmAgent({
        projectPath,
        agentName: args.agent_name,
        taskDescription: args.task_description,
      });

      // Save session state
      const state: SwarmMailState = {
        projectKey: result.projectKey,
        agentName: result.agentName,
        reservations: [],
        startedAt: new Date().toISOString(),
      };
      saveSessionState(sessionID, state);

      return JSON.stringify(
        {
          agent_name: result.agentName,
          project_key: result.projectKey,
          message: `Initialized as ${result.agentName}`,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Send message to other agents
 */
export const swarmmail_send = tool({
  description: "Send message to other swarm agents",
  args: {
    to: tool.schema
      .array(tool.schema.string())
      .describe("List of recipient agent names"),
    subject: tool.schema.string().describe("Message subject"),
    body: tool.schema.string().describe("Message body"),
    thread_id: tool.schema
      .string()
      .optional()
      .describe("Thread ID for conversation tracking"),
    importance: tool.schema
      .enum(["low", "normal", "high", "urgent"])
      .optional()
      .describe("Message importance level"),
    ack_required: tool.schema
      .boolean()
      .optional()
      .describe("Whether acknowledgement is required"),
  },
  async execute(args: SendArgs, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call swarmmail_init first." },
        null,
        2,
      );
    }

    try {
      const result = await sendSwarmMessage({
        projectPath: state.projectKey,
        fromAgent: state.agentName,
        toAgents: args.to,
        subject: args.subject,
        body: args.body,
        threadId: args.thread_id,
        importance: args.importance,
        ackRequired: args.ack_required,
      });

      return JSON.stringify(
        {
          success: result.success,
          message_id: result.messageId,
          thread_id: result.threadId,
          recipient_count: result.recipientCount,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Fetch inbox (CONTEXT-SAFE: bodies excluded, limit 5)
 */
export const swarmmail_inbox = tool({
  description:
    "Fetch inbox (CONTEXT-SAFE: bodies excluded by default, max 5 messages). Use swarmmail_read_message for full body.",
  args: {
    limit: tool.schema
      .number()
      .max(MAX_INBOX_LIMIT)
      .optional()
      .describe(`Max messages to fetch (hard cap: ${MAX_INBOX_LIMIT})`),
    urgent_only: tool.schema
      .boolean()
      .optional()
      .describe("Only fetch urgent messages"),
  },
  async execute(args: InboxArgs, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call swarmmail_init first." },
        null,
        2,
      );
    }

    try {
      const result = await getSwarmInbox({
        projectPath: state.projectKey,
        agentName: state.agentName,
        limit: Math.min(args.limit || MAX_INBOX_LIMIT, MAX_INBOX_LIMIT),
        urgentOnly: args.urgent_only,
        includeBodies: false, // ALWAYS false for context preservation
      });

      return JSON.stringify(
        {
          messages: result.messages.map((m) => ({
            id: m.id,
            from: m.from_agent,
            subject: m.subject,
            thread_id: m.thread_id,
            importance: m.importance,
            timestamp: m.created_at,
          })),
          total: result.total,
          note: "Use swarmmail_read_message to fetch full body",
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to fetch inbox: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Fetch ONE message body by ID
 */
export const swarmmail_read_message = tool({
  description:
    "Fetch ONE message body by ID. Use for reading full message content.",
  args: {
    message_id: tool.schema.number().describe("Message ID to read"),
  },
  async execute(args: ReadMessageArgs, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call swarmmail_init first." },
        null,
        2,
      );
    }

    try {
      const message = await readSwarmMessage({
        projectPath: state.projectKey,
        messageId: args.message_id,
        agentName: state.agentName,
        markAsRead: true,
      });

      if (!message) {
        return JSON.stringify(
          { error: `Message ${args.message_id} not found` },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          id: message.id,
          from: message.from_agent,
          subject: message.subject,
          body: message.body,
          thread_id: message.thread_id,
          importance: message.importance,
          timestamp: message.created_at,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to read message: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Normalize file paths by removing unnecessary escape characters.
 * LLMs sometimes escape brackets/parens that don't need escaping.
 */
function normalizePath(path: string): string {
  // Remove backslash escapes from brackets and parentheses
  // e.g., "app/\\(content\\)/\\[slug\\]" -> "app/(content)/[slug]"
  return path.replace(/\\([[\]()])/g, "$1");
}

/**
 * Reserve file paths for exclusive editing
 */
export const swarmmail_reserve = tool({
  description:
    "Reserve file paths for exclusive editing. Prevents conflicts with other agents. " +
    "IMPORTANT: Do NOT escape brackets or parentheses - paths like app/(content)/[slug]/page.tsx work as-is.",
  args: {
    paths: tool.schema
      .array(tool.schema.string())
      .transform((paths) => paths.map(normalizePath))
      .describe(
        "File paths or glob patterns to reserve. Do NOT escape [ ] ( ) characters.",
      ),
    reason: tool.schema
      .string()
      .optional()
      .describe("Reason for reservation (e.g., bead ID)"),
    exclusive: tool.schema
      .boolean()
      .optional()
      .describe("Whether reservation is exclusive (default: true)"),
    ttl_seconds: tool.schema
      .number()
      .optional()
      .describe("Time-to-live in seconds (default: 3600)"),
  },
  async execute(args: ReserveArgs, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call swarmmail_init first." },
        null,
        2,
      );
    }

    try {
      // Normalize paths - LLMs sometimes escape brackets/parens that don't need it
      const normalizedPaths = args.paths.map(normalizePath);

      const result = await reserveSwarmFiles({
        projectPath: state.projectKey,
        agentName: state.agentName,
        paths: normalizedPaths,
        reason: args.reason,
        exclusive: args.exclusive ?? true,
        ttlSeconds: args.ttl_seconds,
      });

      // Track reservations in session state
      if (result.granted.length > 0) {
        state.reservations.push(...result.granted.map((r) => r.id));
        saveSessionState(sessionID, state);
      }

      if (result.conflicts.length > 0) {
        return JSON.stringify(
          {
            granted: result.granted,
            conflicts: result.conflicts,
            warning: `${result.conflicts.length} path(s) already reserved by other agents`,
          },
          null,
          2,
        );
      }

      return JSON.stringify(
        {
          granted: result.granted,
          message: `Reserved ${result.granted.length} path(s)`,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to reserve files: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Release file reservations
 */
export const swarmmail_release = tool({
  description:
    "Release file reservations. Call when done editing files. " +
    "Do NOT escape brackets or parentheses in paths.",
  args: {
    paths: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Specific paths to release (releases all if omitted). Do NOT escape [ ] ( ) characters.",
      ),
    reservation_ids: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("Specific reservation IDs to release"),
  },
  async execute(args: ReleaseArgs, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call swarmmail_init first." },
        null,
        2,
      );
    }

    try {
      // Get current reservations to find which IDs correspond to paths
      const currentReservations = await getActiveReservations(
        state.projectKey,
        state.projectKey,
        state.agentName,
      );

      // Normalize paths if provided
      const normalizedPaths = args.paths?.map(normalizePath);

      const result = await releaseSwarmFiles({
        projectPath: state.projectKey,
        agentName: state.agentName,
        paths: normalizedPaths,
        reservationIds: args.reservation_ids,
      });

      // Clear tracked reservations
      if (!args.paths && !args.reservation_ids) {
        state.reservations = [];
      } else if (args.reservation_ids) {
        state.reservations = state.reservations.filter(
          (id) => !args.reservation_ids!.includes(id),
        );
      } else if (args.paths) {
        // When releasing by paths, find the reservation IDs that match those paths
        const releasedIds = currentReservations
          .filter((r: { path_pattern: string }) =>
            args.paths!.includes(r.path_pattern),
          )
          .map((r: { id: number }) => r.id);
        state.reservations = state.reservations.filter(
          (id: number) => !releasedIds.includes(id),
        );
      }
      saveSessionState(sessionID, state);

      return JSON.stringify(
        {
          released: result.released,
          released_at: result.releasedAt,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to release files: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Release all reservations in the project (coordinator override)
 */
export const swarmmail_release_all = tool({
  description: "Release all file reservations in the project (coordinator override)",
  args: {},
  async execute(_args: Record<string, never>, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call swarmmail_init first." },
        null,
        2,
      );
    }

    if (!hasCoordinatorOverride(sessionID)) {
      return formatCoordinatorOverrideError({
        tool: "swarmmail_release_all",
        state,
        sessionID,
      });
    }

    try {
      const result = await releaseAllSwarmFiles({
        projectPath: state.projectKey,
        actorName: state.agentName,
      });

      state.reservations = [];
      saveSessionState(sessionID, state);

      return JSON.stringify(
        {
          released: result.released,
          released_at: result.releasedAt,
          release_all: true,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to release all files: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Release all reservations for a specific agent (coordinator override)
 */
export const swarmmail_release_agent = tool({
  description: "Release all file reservations for a specific agent (coordinator override)",
  args: {
    agent_name: tool.schema.string().describe("Target agent name"),
  },
  async execute(args: ReleaseAgentArgs, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call swarmmail_init first." },
        null,
        2,
      );
    }

    if (!hasCoordinatorOverride(sessionID)) {
      return formatCoordinatorOverrideError({
        tool: "swarmmail_release_agent",
        state,
        sessionID,
      });
    }

    try {
      const result = await releaseSwarmFilesForAgent({
        projectPath: state.projectKey,
        actorName: state.agentName,
        targetAgent: args.agent_name,
      });

      if (args.agent_name === state.agentName) {
        state.reservations = [];
        saveSessionState(sessionID, state);
      }

      return JSON.stringify(
        {
          released: result.released,
          released_at: result.releasedAt,
          target_agent: args.agent_name,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to release files for agent: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Acknowledge a message
 */
export const swarmmail_ack = tool({
  description:
    "Acknowledge a message (for messages that require acknowledgement)",
  args: {
    message_id: tool.schema.number().describe("Message ID to acknowledge"),
  },
  async execute(args: AckArgs, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call swarmmail_init first." },
        null,
        2,
      );
    }

    try {
      const result = await acknowledgeSwarmMessage({
        projectPath: state.projectKey,
        messageId: args.message_id,
        agentName: state.agentName,
      });

      return JSON.stringify(
        {
          acknowledged: result.acknowledged,
          acknowledged_at: result.acknowledgedAt,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to acknowledge message: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Check if Swarm Mail is healthy
 */
export const swarmmail_health = tool({
  description: "Check if Swarm Mail embedded store is healthy",
  args: {},
  async execute(
    _args: Record<string, never>,
    ctx: ToolContext,
  ): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);
    // For health check, undefined is OK - database layer uses global fallback
    const projectPath = state?.projectKey || getSwarmMailProjectDirectory();

    try {
      const result = await checkSwarmHealth(projectPath);

      return JSON.stringify(
        {
          healthy: result.healthy,
          database: result.database,
          stats: result.stats,
          session: state
            ? {
                agent_name: state.agentName,
                project_key: state.projectKey,
                reservations: state.reservations.length,
              }
            : null,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          healthy: false,
          error: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

// ============================================================================
// Exports
// ============================================================================

export const swarmMailTools = {
  swarmmail_init: swarmmail_init,
  swarmmail_send: swarmmail_send,
  swarmmail_inbox: swarmmail_inbox,
  swarmmail_read_message: swarmmail_read_message,
  swarmmail_reserve: swarmmail_reserve,
  swarmmail_release: swarmmail_release,
  swarmmail_release_all: swarmmail_release_all,
  swarmmail_release_agent: swarmmail_release_agent,
  swarmmail_ack: swarmmail_ack,
  swarmmail_health: swarmmail_health,
};
