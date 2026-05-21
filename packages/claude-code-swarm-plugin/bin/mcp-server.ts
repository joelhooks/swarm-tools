#!/usr/bin/env bun
/**
 * Thin MCP server for Claude Code that shells out to swarm CLI.
 *
 * This avoids bundling issues with native deps (@libsql/client) by
 * delegating all tool execution to the installed swarm CLI.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFileSync } from "child_process";
import { z } from "zod";
import { randomBytes } from "crypto";

// Generate a persistent session ID for this MCP server instance
// This ensures all tool calls within the same MCP connection share state
const MCP_SESSION_ID = `mcp-${randomBytes(8).toString("hex")}`;

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Tool definitions with proper JSON schemas.
 *
 * These are the canonical schemas for all MCP-exposed swarm tools.
 * Previously these were scraped from the CLI at startup, but `swarm tool --list --json`
 * was never implemented, causing all schemas to be empty and all params to arrive as undefined.
 *
 * Organized by user-facing vs agent-internal.
 */
const TOOL_DEFINITIONS: ToolInfo[] = [
  // ========== USER-FACING ==========

  // Hive - task/cell management
  {
    name: "hive_cells",
    description: "Query cells from hive with filters (status, type, ready, parent_id). Supports cross-project queries via project_key.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: open, in_progress, blocked, closed" },
        type: { type: "string", description: "Filter by type: task, bug, feature, epic, chore" },
        ready: { type: "boolean", description: "Get only unblocked cells" },
        parent_id: { type: "string", description: "Get children of an epic" },
        id: { type: "string", description: "Get specific cell by partial ID" },
        limit: { type: "number", description: "Max results" },
        project_key: { type: "string", description: "Override project scope (use hive_projects to list available)" },
      },
    },
  },
  {
    name: "hive_create",
    description: "Create a new cell in the hive",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Cell title (required)" },
        description: { type: "string", description: "Cell description" },
        type: { type: "string", description: "Cell type: task, bug, feature, epic, chore" },
        priority: { type: "number", description: "Priority (lower = higher priority)" },
        parent_id: { type: "string", description: "Parent epic ID" },
      },
      required: ["title"],
    },
  },
  {
    name: "hive_create_epic",
    description: "Create epic with subtasks atomically",
    inputSchema: {
      type: "object",
      properties: {
        epic_title: { type: "string", description: "Epic title (required)" },
        epic_description: { type: "string", description: "Epic description" },
        subtasks: { type: "array", items: { type: "object" }, description: "Array of subtasks: [{title: string, files?: string[], priority?: number}]" },
        strategy: { type: "string", description: "Decomposition strategy: file-based, feature-based, risk-based" },
      },
      required: ["epic_title", "subtasks"],
    },
  },
  {
    name: "hive_close",
    description: "Close a cell with reason",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Cell ID (required)" },
        reason: { type: "string", description: "Closure reason (required)" },
      },
      required: ["id", "reason"],
    },
  },
  {
    name: "hive_query",
    description: "Query hive cells with filters (same as hive_cells)",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: open, in_progress, blocked, closed" },
        type: { type: "string", description: "Filter by type: task, bug, feature, epic, chore" },
        ready: { type: "boolean", description: "Get only unblocked cells" },
        parent_id: { type: "string", description: "Get children of an epic" },
        limit: { type: "number", description: "Max results" },
      },
    },
  },
  {
    name: "hive_ready",
    description: "Get the next ready (unblocked, highest priority) cell",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_update",
    description: "Update cell status or description",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Cell ID (required)" },
        status: { type: "string", description: "New status: open, in_progress, blocked, closed" },
        description: { type: "string", description: "New description" },
        priority: { type: "number", description: "New priority" },
      },
      required: ["id"],
    },
  },
  {
    name: "hive_projects",
    description: "List all projects with hive cells. Shows project_key, cell counts, and which is current.",
    inputSchema: { type: "object", properties: {} },
  },

  // Hivemind - unified memory
  {
    name: "hivemind_find",
    description: "Search memories by semantic similarity or full-text",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (required)" },
        limit: { type: "number", description: "Max results (default 5)" },
        fts: { type: "boolean", description: "Use full-text search instead of semantic" },
        expand: { type: "boolean", description: "Return expanded context" },
        collection: { type: "string", description: "Filter by collection" },
        decayTier: { type: "string", description: "Filter by decay tier: hot, warm, cold, stale" },
        project_key: { type: "string", description: "Override project scope (default: current working directory)" },
      },
      required: ["query"],
    },
  },
  {
    name: "hivemind_store",
    description: "Store a memory with semantic embedding",
    inputSchema: {
      type: "object",
      properties: {
        information: { type: "string", description: "Information to store (required)" },
        tags: { type: "string", description: "Comma-separated tags" },
        collection: { type: "string", description: "Collection name (default: 'default')" },
        confidence: { type: "number", description: "Confidence score 0-1" },
        extractEntities: { type: "boolean", description: "Extract entities from content" },
        autoTag: { type: "boolean", description: "Auto-tag based on content analysis" },
        autoLink: { type: "boolean", description: "Auto-link to related memories" },
        project_key: { type: "string", description: "Override project scope (default: current working directory)" },
      },
      required: ["information"],
    },
  },
  {
    name: "hivemind_get",
    description: "Retrieve a specific memory by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID (required)" },
        project_key: { type: "string", description: "Override project scope (default: current working directory)" },
      },
      required: ["id"],
    },
  },
  {
    name: "hivemind_stats",
    description: "Get hivemind memory statistics - counts, embeddings, health",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Override project scope (default: current working directory)" },
      },
    },
  },

  // Swarmmail - agent coordination
  {
    name: "swarmmail_init",
    description: "Initialize swarm mail session for agent coordination",
    inputSchema: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "Agent name" },
        project_path: { type: "string", description: "Project path" },
        task_description: { type: "string", description: "Task description" },
      },
    },
  },
  {
    name: "swarmmail_inbox",
    description: "Fetch inbox messages from other agents",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max messages" },
        urgent_only: { type: "boolean", description: "Only urgent messages" },
      },
    },
  },
  {
    name: "swarmmail_send",
    description: "Send message to other swarm agents",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, description: "Recipient agent names (e.g., [\"coordinator\"] or [\"worker-1\", \"worker-2\"])" },
        subject: { type: "string", description: "Message subject (required)" },
        body: { type: "string", description: "Message body (required)" },
        importance: { type: "string", description: "low, normal, high, urgent" },
        thread_id: { type: "string", description: "Thread ID for replies" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "swarmmail_reserve",
    description: "Reserve file paths for exclusive editing",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "File paths to reserve (e.g., [\"src/auth.ts\", \"src/auth.test.ts\"])" },
        reason: { type: "string", description: "Reservation reason" },
        exclusive: { type: "boolean", description: "Exclusive lock" },
        ttl_seconds: { type: "number", description: "Time-to-live in seconds" },
      },
      required: ["paths"],
    },
  },
  {
    name: "swarmmail_release",
    description: "Release file reservations",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "File paths to release" },
        reservation_ids: { type: "array", items: { type: "string" }, description: "Reservation IDs to release" },
      },
    },
  },

  // ========== CORE SWARM ==========
  {
    name: "swarm_decompose",
    description: "Generate decomposition prompt for parallel subtasks",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task to decompose (required)" },
        context: { type: "string", description: "Additional context" },
        query_cass: { type: "boolean", description: "Query hivemind for similar tasks" },
      },
      required: ["task"],
    },
  },
  {
    name: "swarm_status",
    description: "Get status of a swarm by epic ID",
    inputSchema: {
      type: "object",
      properties: {
        epic_id: { type: "string", description: "Epic ID (required)" },
        project_key: { type: "string", description: "Project key (required)" },
      },
      required: ["epic_id", "project_key"],
    },
  },

  // ========== AGENT-INTERNAL ==========
  // Used by coordinator/worker agents
  {
    name: "swarm_plan_prompt",
    description: "Generate strategy-specific decomposition prompt with hivemind context",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task to plan (required)" },
        strategy: { type: "string", description: "Strategy: file-based, feature-based, risk-based, auto" },
        context: { type: "string", description: "Additional context" },
        query_cass: { type: "boolean", description: "Query hivemind for similar tasks" },
        cass_limit: { type: "number", description: "Max hivemind results" },
        include_skills: { type: "boolean", description: "Include skill recommendations" },
      },
      required: ["task"],
    },
  },
  {
    name: "swarm_validate_decomposition",
    description: "Validate decomposition JSON before creating epic - checks file conflicts and dependencies",
    inputSchema: {
      type: "object",
      properties: {
        response: { type: "string", description: "JSON string with {epic: {title, description}, subtasks: [{title, files, dependencies}]} (required)" },
        task: { type: "string", description: "Original task description" },
        strategy: { type: "string", description: "Strategy used: file-based, feature-based, risk-based, auto" },
        project_path: { type: "string", description: "Project path for file validation" },
        epic_id: { type: "string", description: "Existing epic ID if updating" },
        context: { type: "string", description: "Additional context" },
      },
      required: ["response"],
    },
  },
  {
    name: "swarm_spawn_subtask",
    description: "Prepare a subtask for spawning with agent mail tracking",
    inputSchema: {
      type: "object",
      properties: {
        bead_id: { type: "string", description: "Bead/cell ID (required)" },
        epic_id: { type: "string", description: "Epic ID (required)" },
        subtask_title: { type: "string", description: "Subtask title (required)" },
        files: { type: "array", items: { type: "string" }, description: "Files to work on (e.g., [\"src/auth.ts\", \"src/auth.test.ts\"])" },
        subtask_description: { type: "string", description: "Subtask description" },
        project_path: { type: "string", description: "Project path" },
        shared_context: { type: "string", description: "Shared context for worker" },
      },
      required: ["bead_id", "epic_id", "subtask_title", "files"],
    },
  },
  {
    name: "swarm_review",
    description: "Generate a review prompt for a completed subtask with epic context and diff",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Project key (required)" },
        epic_id: { type: "string", description: "Epic ID (required)" },
        task_id: { type: "string", description: "Task/cell ID (required)" },
        files_touched: { type: "array", items: { type: "string" }, description: "Files that were modified" },
      },
      required: ["project_key", "epic_id", "task_id"],
    },
  },
  {
    name: "swarm_review_feedback",
    description: "Send review feedback to a worker - tracks attempts (max 3 rejections)",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Project key (required)" },
        task_id: { type: "string", description: "Task/cell ID (required)" },
        worker_id: { type: "string", description: "Worker agent ID (required)" },
        status: { type: "string", description: "Review status: approved, needs_changes (required)" },
        summary: { type: "string", description: "Review summary" },
        issues: { type: "string", description: "Issues to address if needs_changes" },
      },
      required: ["project_key", "task_id", "worker_id", "status"],
    },
  },
  {
    name: "swarm_progress",
    description: "Report progress on a subtask to coordinator",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Project key (required)" },
        agent_name: { type: "string", description: "Agent name (required)" },
        bead_id: { type: "string", description: "Bead/cell ID (required)" },
        status: { type: "string", description: "Status: in_progress, blocked, completed, failed (required)" },
        progress_percent: { type: "number", description: "Progress percentage" },
        message: { type: "string", description: "Status message" },
        files_touched: { type: "array", items: { type: "string" }, description: "Files that were modified" },
      },
      required: ["project_key", "agent_name", "bead_id", "status"],
    },
  },
  {
    name: "swarm_complete",
    description: "Mark subtask complete with verification gate",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Project key (required)" },
        agent_name: { type: "string", description: "Agent name (required)" },
        bead_id: { type: "string", description: "Bead/cell ID (required)" },
        summary: { type: "string", description: "Work summary (required)" },
        start_time: { type: "number", description: "Start timestamp (required)" },
        files_touched: { type: "array", items: { type: "string" }, description: "Files that were modified" },
        skip_verification: { type: "boolean", description: "Skip verification gate" },
      },
      required: ["project_key", "agent_name", "bead_id", "summary", "start_time"],
    },
  },

  // ========== RALPH SUPERVISOR ==========
  // Claude supervises, Codex executes
  {
    name: "ralph_init",
    description: "Initialize a ralph supervisor project. Creates prd.json and progress.txt for tracking stories.",
    inputSchema: {
      type: "object",
      properties: {
        workdir: { type: "string", description: "Working directory (defaults to project root)" },
        project_name: { type: "string", description: "Project name (required)" },
        description: { type: "string", description: "Project description" },
        use_hive: { type: "boolean", description: "Track stories as hive cells (default: true)" },
      },
      required: ["project_name"],
    },
  },
  {
    name: "ralph_story",
    description: "Add a story (task) to the ralph project. Stories are discrete units of work that Codex will implement.",
    inputSchema: {
      type: "object",
      properties: {
        workdir: { type: "string", description: "Working directory" },
        title: { type: "string", description: "Story title (required)" },
        description: { type: "string", description: "Detailed description of what to implement (required)" },
        priority: { type: "number", description: "Priority 1-10 (1=highest, default 5)" },
        validation_command: { type: "string", description: "Command to validate (defaults to npm test)" },
        acceptance_criteria: { type: "array", items: { type: "string" }, description: "List of acceptance criteria (e.g., [\"Tests pass\", \"Types correct\"])" },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "ralph_iterate",
    description: "Run a single ralph iteration. Picks the next pending story, spawns Codex to implement it, runs validation, and commits on success.",
    inputSchema: {
      type: "object",
      properties: {
        workdir: { type: "string", description: "Working directory" },
        model: { type: "string", description: "Codex model to use (default: gpt-5.3-codex)" },
        sandbox: { type: "string", description: "Sandbox mode: read-only, workspace-write, danger-full-access" },
        dry_run: { type: "boolean", description: "Don't actually run Codex, just show what would happen" },
        timeout_ms: { type: "number", description: "Timeout per iteration in ms (default: 600000)" },
      },
    },
  },
  {
    name: "ralph_loop",
    description: "Run the ralph loop until all stories pass or limits are reached. Spawns Codex for each story, validates, commits on success, and continues.",
    inputSchema: {
      type: "object",
      properties: {
        workdir: { type: "string", description: "Working directory" },
        max_iterations: { type: "number", description: "Maximum iterations (default: 20)" },
        model: { type: "string", description: "Codex model (default: gpt-5.3-codex)" },
        sandbox: { type: "string", description: "Sandbox mode" },
        stop_on_failure: { type: "boolean", description: "Stop on first validation failure" },
        auto_commit: { type: "boolean", description: "Auto-commit on success (default: true)" },
        sync: { type: "boolean", description: "Run synchronously (default: false)" },
      },
    },
  },
  {
    name: "ralph_status",
    description: "Get the status of a ralph project or running loop job.",
    inputSchema: {
      type: "object",
      properties: {
        workdir: { type: "string", description: "Working directory" },
        job_id: { type: "string", description: "Specific job ID to check" },
      },
    },
  },
  {
    name: "ralph_cancel",
    description: "Cancel a running ralph loop.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID to cancel (required)" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "ralph_review",
    description: "Review a completed story. Approve to keep it passed, or reject with feedback to retry.",
    inputSchema: {
      type: "object",
      properties: {
        workdir: { type: "string", description: "Working directory" },
        story_id: { type: "string", description: "Story ID to review (required)" },
        approve: { type: "boolean", description: "Whether to approve the work (required)" },
        feedback: { type: "string", description: "Feedback if rejecting" },
      },
      required: ["story_id", "approve"],
    },
  },
];

/**
 * Set of allowed tool names for quick filtering.
 */
const ALLOWED_TOOLS = new Set(TOOL_DEFINITIONS.map(t => t.name));

/**
 * Convert JSON Schema to Zod schema for MCP SDK.
 * Handles the common types used in tool parameter schemas.
 */
function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const props = schema.properties as Record<string, { type?: string; enum?: string[]; items?: Record<string, unknown> }> | undefined;
  const required = (schema.required as string[]) || [];

  if (!props || Object.keys(props).length === 0) {
    // Empty schema - accept any properties
    return {};
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(props)) {
    let fieldSchema: z.ZodTypeAny;

    switch (prop.type) {
      case "string":
        fieldSchema = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string();
        break;
      case "number":
        fieldSchema = z.number();
        break;
      case "boolean":
        fieldSchema = z.boolean();
        break;
      case "array":
        // MCP protocol flattens array schemas to string, so accept both.
        // Actual coercion from string→array happens in coerceArrayParams().
        fieldSchema = z.union([z.string(), z.array(z.unknown())]);
        break;
      case "object":
        fieldSchema = z.object(jsonSchemaToZodShape(prop as Record<string, unknown>)).passthrough();
        break;
      default:
        fieldSchema = z.unknown();
    }

    // Make optional if not in required array
    shape[key] = required.includes(key) ? fieldSchema : fieldSchema.optional();
  }

  return shape; // passthrough allows extra properties
}

/**
 * Build a lookup of which tool params are arrays, so we can coerce
 * string→array when the MCP protocol flattens array schemas to string.
 */
const ARRAY_PARAMS: Record<string, Set<string>> = {};
for (const tool of TOOL_DEFINITIONS) {
  const props = tool.inputSchema.properties as Record<string, { type?: string }> | undefined;
  if (!props) continue;
  for (const [key, prop] of Object.entries(props)) {
    if (prop.type === "array") {
      if (!ARRAY_PARAMS[tool.name]) ARRAY_PARAMS[tool.name] = new Set();
      ARRAY_PARAMS[tool.name].add(key);
    }
  }
}

/**
 * Coerce string values to arrays for params declared as type: "array".
 * The MCP protocol flattens all array schemas to type: "string", so Claude
 * sends JSON-encoded strings or pipe-delimited strings instead of arrays.
 */
function coerceArrayParams(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const arrayKeys = ARRAY_PARAMS[name];
  if (!arrayKeys) return args;

  const coerced = { ...args };
  for (const key of arrayKeys) {
    const val = coerced[key];
    if (typeof val !== "string") continue;

    const trimmed = val.trim();

    // Try JSON parse first (handles "[{...}, {...}]" and "[\"a\", \"b\"]")
    if (trimmed.startsWith("[")) {
      try {
        coerced[key] = JSON.parse(trimmed);
        continue;
      } catch {
        // Fall through to pipe-delimited
      }
    }

    // Pipe-delimited fallback (handles "task A | task B | task C")
    if (trimmed.includes("|")) {
      coerced[key] = trimmed.split("|").map(s => {
        const t = s.trim();
        // If the array items are objects (like subtasks), wrap in {title: ...}
        return t.startsWith("{") ? JSON.parse(t) : { title: t };
      });
      continue;
    }

    // Comma-separated fallback for simple string arrays
    if (trimmed.includes(",")) {
      coerced[key] = trimmed.split(",").map(s => s.trim()).filter(Boolean);
      continue;
    }

    // Single value → wrap in array
    coerced[key] = [trimmed.startsWith("{") ? JSON.parse(trimmed) : trimmed];
  }

  return coerced;
}

/**
 * Execute a tool via swarm CLI.
 * Uses execFileSync to eliminate shell injection risk.
 */
function executeTool(name: string, args: Record<string, unknown>): string {
  try {
    const coercedArgs = coerceArrayParams(name, args);
    const argsJson = JSON.stringify(coercedArgs);
    const output = execFileSync("swarm", ["tool", name, "--json", argsJson], {
      encoding: "utf-8",
      timeout: 300000, // 5 minute timeout for long operations
      env: {
        ...process.env,
        // Pass persistent session ID so swarmmail state persists across tool calls
        OPENCODE_SESSION_ID: MCP_SESSION_ID,
        CLAUDE_SESSION_ID: process.env.CLAUDE_SESSION_ID,
        CLAUDE_MESSAGE_ID: process.env.CLAUDE_MESSAGE_ID,
        CLAUDE_AGENT_NAME: process.env.CLAUDE_AGENT_NAME,
      },
    });
    return output;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string; code?: string };
    if (err.stdout) return err.stdout;

    // Determine error code
    let errorCode = "EXECUTION_ERROR";
    if (err.code === "ENOENT") {
      errorCode = "CLI_NOT_FOUND";
    } else if (err.message?.includes("timeout")) {
      errorCode = "CLI_TIMEOUT";
    } else if (err.stderr?.includes("Unknown tool") || err.stderr?.includes("not found")) {
      errorCode = "TOOL_ERROR";
    }

    return JSON.stringify({
      success: false,
      error: {
        code: errorCode,
        message: err.message || String(error),
        stderr: err.stderr,
        hint: errorCode === "CLI_NOT_FOUND"
          ? "swarm CLI not found in PATH. Run: npm install -g @opencode/swarm"
          : errorCode === "CLI_TIMEOUT"
          ? "Tool execution timed out after 5 minutes"
          : undefined,
      },
    });
  }
}

/**
 * Get swarm CLI version.
 * Falls back to a placeholder if CLI not available.
 */
function getSwarmVersion(): string {
  try {
    const output = execFileSync("swarm", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    // Parse version from output like "v0.57.5" or "0.57.5"
    const match = output.match(/v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : "unknown";
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  // Health check: verify swarm CLI is available before starting server
  try {
    execFileSync("swarm", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === "ENOENT") {
      console.error("[swarm-mcp] ERROR: swarm CLI not found in PATH");
      console.error("[swarm-mcp] Install with: npm install -g @opencode/swarm");
      process.exit(1);
    } else {
      console.error("[swarm-mcp] WARNING: Failed to check swarm CLI version:", error);
      // Continue anyway - might be a transient error
    }
  }

  const server = new McpServer({
    name: "swarm-tools",
    version: getSwarmVersion(),
  });

  // Register tools with proper schemas (inline definitions, not scraped from CLI)
  console.error(`[swarm-mcp] Registering ${TOOL_DEFINITIONS.length} tools`);

  for (const tool of TOOL_DEFINITIONS) {
    // Convert JSON Schema from CLI to Zod for MCP SDK
    const zodSchema = jsonSchemaToZodShape(tool.inputSchema);

    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: zodSchema as any },
      async (args: Record<string, unknown>) => {
        const result = executeTool(tool.name, args ?? {});
        return {
          content: [{ type: "text" as const, text: result }],
        };
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[swarm-mcp] Server started");
}

main().catch((error) => {
  console.error("[swarm-mcp] Server failed", error);
  process.exit(1);
});
