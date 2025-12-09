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
 *
 * GRACEFUL DEGRADATION:
 * - If Agent Mail server is not running, tools return helpful error messages
 * - Swarm can still function without Agent Mail (just no coordination)
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { isToolAvailable, warnMissingTool } from "./tool-availability";
import { getRateLimiter, type RateLimiter } from "./rate-limiter";

// ============================================================================
// Configuration
// ============================================================================

const AGENT_MAIL_URL = "http://127.0.0.1:8765";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const MAX_INBOX_LIMIT = 5; // HARD CAP - never exceed this

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: parseInt(process.env.OPENCODE_AGENT_MAIL_MAX_RETRIES || "3"),
  baseDelayMs: parseInt(process.env.OPENCODE_AGENT_MAIL_BASE_DELAY_MS || "100"),
  maxDelayMs: parseInt(process.env.OPENCODE_AGENT_MAIL_MAX_DELAY_MS || "5000"),
  timeoutMs: parseInt(process.env.OPENCODE_AGENT_MAIL_TIMEOUT_MS || "10000"),
  jitterPercent: 20,
};

// Server recovery configuration
const RECOVERY_CONFIG = {
  /** Max consecutive failures before attempting restart */
  failureThreshold: 2,
  /** Cooldown between restart attempts (ms) */
  restartCooldownMs: 30000,
  /** Whether auto-restart is enabled */
  enabled: process.env.OPENCODE_AGENT_MAIL_AUTO_RESTART !== "false",
};

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

export class RateLimitExceededError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly remaining: number,
    public readonly resetAt: number,
  ) {
    const resetDate = new Date(resetAt);
    const waitMs = Math.max(0, resetAt - Date.now());
    const waitSec = Math.ceil(waitMs / 1000);
    super(
      `Rate limit exceeded for ${endpoint}. ` +
        `${remaining} remaining. ` +
        `Retry in ${waitSec}s (at ${resetDate.toISOString()})`,
    );
    this.name = "RateLimitExceededError";
  }
}

// ============================================================================
// Server Recovery
// ============================================================================

/** Track consecutive failures for recovery decisions */
let consecutiveFailures = 0;
let lastRestartAttempt = 0;
let isRestarting = false;

/**
 * Check if the server is responding to health checks
 */
async function isServerHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${AGENT_MAIL_URL}/health/liveness`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Test if the server can handle a basic MCP call
 * This catches cases where health is OK but MCP is broken
 */
async function isServerFunctional(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${AGENT_MAIL_URL}/mcp/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "health-test",
        method: "tools/call",
        params: { name: "health_check", arguments: {} },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return false;

    const json = (await response.json()) as { result?: { isError?: boolean } };
    // Check if it's an error response
    if (json.result?.isError) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to restart the Agent Mail server
 *
 * Finds the running process, kills it, and starts a new one.
 * Returns true if restart was successful.
 */
async function restartServer(): Promise<boolean> {
  if (!RECOVERY_CONFIG.enabled) {
    console.warn(
      "[agent-mail] Auto-restart disabled via OPENCODE_AGENT_MAIL_AUTO_RESTART=false",
    );
    return false;
  }

  // Prevent concurrent restart attempts
  if (isRestarting) {
    console.warn("[agent-mail] Restart already in progress");
    return false;
  }

  // Respect cooldown
  const now = Date.now();
  if (now - lastRestartAttempt < RECOVERY_CONFIG.restartCooldownMs) {
    const waitSec = Math.ceil(
      (RECOVERY_CONFIG.restartCooldownMs - (now - lastRestartAttempt)) / 1000,
    );
    console.warn(`[agent-mail] Restart cooldown active, wait ${waitSec}s`);
    return false;
  }

  isRestarting = true;
  lastRestartAttempt = now;

  try {
    console.warn("[agent-mail] Attempting server restart...");

    // Find the agent-mail process
    const findProc = Bun.spawn(["lsof", "-i", ":8765", "-t"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const findOutput = await new Response(findProc.stdout).text();
    await findProc.exited;

    const pids = findOutput.trim().split("\n").filter(Boolean);

    if (pids.length > 0) {
      // Kill existing process(es)
      for (const pid of pids) {
        console.warn(`[agent-mail] Killing process ${pid}`);
        Bun.spawn(["kill", pid]);
      }

      // Wait for process to die
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Find the agent-mail installation directory
    // Try common locations
    const possiblePaths = [
      `${process.env.HOME}/Code/Dicklesworthstone/mcp_agent_mail`,
      `${process.env.HOME}/.local/share/agent-mail`,
      `${process.env.HOME}/mcp_agent_mail`,
    ];

    let serverDir: string | null = null;
    for (const path of possiblePaths) {
      try {
        const stat = await Bun.file(`${path}/pyproject.toml`).exists();
        if (stat) {
          serverDir = path;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!serverDir) {
      console.error(
        "[agent-mail] Could not find agent-mail installation directory",
      );
      return false;
    }

    // Start the server
    console.warn(`[agent-mail] Starting server from ${serverDir}`);
    Bun.spawn(["python", "-m", "mcp_agent_mail.cli", "serve-http"], {
      cwd: serverDir,
      stdout: "ignore",
      stderr: "ignore",
      // Detach so it survives our process
      detached: true,
    });

    // Wait for server to come up
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (await isServerHealthy()) {
        console.warn("[agent-mail] Server restarted successfully");
        consecutiveFailures = 0;
        return true;
      }
    }

    console.error("[agent-mail] Server failed to start after restart");
    return false;
  } catch (error) {
    console.error("[agent-mail] Restart failed:", error);
    return false;
  } finally {
    isRestarting = false;
  }
}

/**
 * Reset recovery state (for testing)
 */
export function resetRecoveryState(): void {
  consecutiveFailures = 0;
  lastRestartAttempt = 0;
  isRestarting = false;
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Calculate delay with exponential backoff + jitter
 */
function calculateBackoffDelay(attempt: number): number {
  if (attempt === 0) return 0;

  const exponentialDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, RETRY_CONFIG.maxDelayMs);

  // Add jitter (±jitterPercent%)
  const jitterRange = cappedDelay * (RETRY_CONFIG.jitterPercent / 100);
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  return Math.round(cappedDelay + jitter);
}

/**
 * Check if an error is retryable (transient network/server issues)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("socket") ||
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("aborted")
    ) {
      return true;
    }

    // Server errors (but not 500 which is usually a logic bug)
    if (error instanceof AgentMailError && error.code) {
      return error.code === 502 || error.code === 503 || error.code === 504;
    }

    // Generic "unexpected error" from server - might be recoverable with restart
    if (message.includes("unexpected error")) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// MCP Client
// ============================================================================

/** MCP tool result with content wrapper (real Agent Mail format) */
interface MCPToolResult<T = unknown> {
  content?: Array<{ type: string; text: string }>;
  structuredContent?: T;
  isError?: boolean;
}

/** Cached availability check result */
let agentMailAvailable: boolean | null = null;

/**
 * Check if Agent Mail server is available (cached)
 */
async function checkAgentMailAvailable(): Promise<boolean> {
  if (agentMailAvailable !== null) {
    return agentMailAvailable;
  }

  agentMailAvailable = await isToolAvailable("agent-mail");
  return agentMailAvailable;
}

/**
 * Reset availability cache (for testing)
 */
export function resetAgentMailCache(): void {
  agentMailAvailable = null;
}

/** Cached rate limiter instance */
let rateLimiter: RateLimiter | null = null;

/** Whether rate limiting is enabled (can be disabled via env var) */
const RATE_LIMITING_ENABLED =
  process.env.OPENCODE_RATE_LIMIT_DISABLED !== "true";

/**
 * Check rate limit for an endpoint and throw if exceeded
 *
 * @param agentName - The agent making the request
 * @param endpoint - The endpoint being accessed (e.g., "send", "inbox")
 * @throws RateLimitExceededError if rate limit is exceeded
 */
async function checkRateLimit(
  agentName: string,
  endpoint: string,
): Promise<void> {
  if (!RATE_LIMITING_ENABLED) {
    return;
  }

  if (!rateLimiter) {
    rateLimiter = await getRateLimiter();
  }

  const result = await rateLimiter.checkLimit(agentName, endpoint);
  if (!result.allowed) {
    throw new RateLimitExceededError(
      endpoint,
      result.remaining,
      result.resetAt,
    );
  }
}

/**
 * Record a request against the rate limit (call after successful request)
 *
 * @param agentName - The agent making the request
 * @param endpoint - The endpoint being accessed
 */
async function recordRateLimitedRequest(
  agentName: string,
  endpoint: string,
): Promise<void> {
  if (!RATE_LIMITING_ENABLED) {
    return;
  }

  if (!rateLimiter) {
    rateLimiter = await getRateLimiter();
  }

  await rateLimiter.recordRequest(agentName, endpoint);
}

/**
 * Reset rate limiter (for testing)
 */
export async function resetRateLimiterCache(): Promise<void> {
  if (rateLimiter) {
    await rateLimiter.close();
    rateLimiter = null;
  }
}

/**
 * Execute a single MCP call (no retry)
 */
async function mcpCallOnce<T>(
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RETRY_CONFIG.timeoutMs);

  try {
    const response = await fetch(`${AGENT_MAIL_URL}/mcp/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new AgentMailError(
        `HTTP ${response.status}: ${response.statusText}`,
        toolName,
        response.status,
      );
    }

    const json = (await response.json()) as MCPResponse<MCPToolResult<T> | T>;

    if (json.error) {
      throw new AgentMailError(
        json.error.message,
        toolName,
        json.error.code,
        json.error.data,
      );
    }

    const result = json.result;

    // Handle wrapped response format (real Agent Mail server)
    // Check for isError first (error responses don't have structuredContent)
    if (result && typeof result === "object") {
      const wrapped = result as MCPToolResult<T>;

      // Check for error response (has isError: true but no structuredContent)
      if (wrapped.isError) {
        const errorText = wrapped.content?.[0]?.text || "Unknown error";
        throw new AgentMailError(errorText, toolName);
      }

      // Check for success response with structuredContent
      if ("structuredContent" in wrapped) {
        return wrapped.structuredContent as T;
      }
    }

    // Handle direct response format (mock server)
    return result as T;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Call an Agent Mail MCP tool with retry and auto-restart
 *
 * Features:
 * - Exponential backoff with jitter on retryable errors
 * - Auto-restart server after consecutive failures
 * - Timeout handling per request
 *
 * Handles both direct results (mock server) and wrapped results (real server).
 * Real Agent Mail returns: { content: [...], structuredContent: {...} }
 */
export async function mcpCall<T>(
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    // Apply backoff delay (except first attempt)
    if (attempt > 0) {
      const delay = calculateBackoffDelay(attempt);
      console.warn(
        `[agent-mail] Retry ${attempt}/${RETRY_CONFIG.maxRetries} for ${toolName} after ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const result = await mcpCallOnce<T>(toolName, args);

      // Success - reset failure counter
      consecutiveFailures = 0;
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Track consecutive failures
      consecutiveFailures++;

      // Check if we should attempt server restart
      if (
        consecutiveFailures >= RECOVERY_CONFIG.failureThreshold &&
        RECOVERY_CONFIG.enabled
      ) {
        console.warn(
          `[agent-mail] ${consecutiveFailures} consecutive failures, checking server health...`,
        );

        const healthy = await isServerFunctional();
        if (!healthy) {
          console.warn("[agent-mail] Server unhealthy, attempting restart...");
          const restarted = await restartServer();
          if (restarted) {
            // Reset availability cache since server restarted
            agentMailAvailable = null;
            // Don't count this attempt against retries - try again
            attempt--;
            continue;
          }
        }
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        console.warn(
          `[agent-mail] Non-retryable error for ${toolName}: ${lastError.message}`,
        );
        throw lastError;
      }

      // If this was the last retry, throw
      if (attempt === RETRY_CONFIG.maxRetries) {
        console.error(
          `[agent-mail] All ${RETRY_CONFIG.maxRetries} retries exhausted for ${toolName}`,
        );
        throw lastError;
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error("Unknown error in mcpCall");
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
    // Check if Agent Mail is available
    const available = await checkAgentMailAvailable();
    if (!available) {
      warnMissingTool("agent-mail");
      return JSON.stringify(
        {
          error: "Agent Mail server not available",
          available: false,
          hint: "Start Agent Mail with: agent-mail serve",
          fallback:
            "Swarm will continue without multi-agent coordination. File conflicts possible if multiple agents active.",
        },
        null,
        2,
      );
    }

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

    return JSON.stringify({ project, agent, available: true }, null, 2);
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

    // Check rate limit before sending
    await checkRateLimit(state.agentName, "send");

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

    // Record successful request
    await recordRateLimitedRequest(state.agentName, "send");

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

    // Check rate limit
    await checkRateLimit(state.agentName, "inbox");

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

    // Record successful request
    await recordRateLimitedRequest(state.agentName, "inbox");

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

    // Check rate limit
    await checkRateLimit(state.agentName, "read_message");

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

    // Record successful request
    await recordRateLimitedRequest(state.agentName, "read_message");

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

    // Check rate limit
    await checkRateLimit(state.agentName, "summarize_thread");

    const summary = await mcpCall<ThreadSummary>("summarize_thread", {
      project_key: state.projectKey,
      thread_id: args.thread_id,
      include_examples: args.include_examples || false,
      llm_mode: true, // Use LLM for better summaries
    });

    // Record successful request
    await recordRateLimitedRequest(state.agentName, "summarize_thread");

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

    // Check rate limit
    await checkRateLimit(state.agentName, "reserve");

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

    // Record successful request
    await recordRateLimitedRequest(state.agentName, "reserve");

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

    // Check rate limit
    await checkRateLimit(state.agentName, "release");

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

    // Record successful request
    await recordRateLimitedRequest(state.agentName, "release");

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

    // Check rate limit
    await checkRateLimit(state.agentName, "ack");

    await mcpCall("acknowledge_message", {
      project_key: state.projectKey,
      agent_name: state.agentName,
      message_id: args.message_id,
    });

    // Record successful request
    await recordRateLimitedRequest(state.agentName, "ack");

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

    // Check rate limit
    await checkRateLimit(state.agentName, "search");

    const results = await mcpCall<MessageHeader[]>("search_messages", {
      project_key: state.projectKey,
      query: args.query,
      limit: args.limit || 20,
    });

    // Record successful request
    await recordRateLimitedRequest(state.agentName, "search");

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
  requireState,
  setState,
  getState,
  clearState,
  sessionStates,
  AGENT_MAIL_URL,
  MAX_INBOX_LIMIT,
  // Recovery/retry utilities (resetRecoveryState already exported at definition)
  isServerHealthy,
  isServerFunctional,
  restartServer,
  RETRY_CONFIG,
  RECOVERY_CONFIG,
};
