/**
 * Clawdbot Swarm Plugin
 *
 * Integrates swarm-tools into clawdbot:
 * - Hive: cell/task management
 * - Hivemind: semantic memory
 * - Swarmmail: agent coordination
 * - Swarm: parallel workflow orchestration
 */
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";
import { execFileSync } from "child_process";

function executeSwarmTool(name: string, args: Record<string, unknown>): string {
  try {
    const argsJson = JSON.stringify(args);
    const output = execFileSync("swarm", ["tool", name, "--json", argsJson], {
      encoding: "utf-8",
      timeout: 300000,
      env: process.env,
    });
    return output;
  } catch (error) {
    const err = error as { stdout?: string; message?: string; code?: string };
    if (err.stdout) return err.stdout;
    return JSON.stringify({ error: err.message || String(error) });
  }
}

// Tool definitions with proper schemas
const SWARM_TOOLS = [
  // Hive - cell/task management
  {
    name: "hive_cells",
    label: "Hive Cells",
    description: "Query cells from hive with filters (status, type, ready, parent_id)",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: open, in_progress, blocked, closed" },
        type: { type: "string", description: "Filter by type: task, bug, feature, epic, chore" },
        ready: { type: "boolean", description: "Get only unblocked cells" },
        parent_id: { type: "string", description: "Get children of an epic" },
        id: { type: "string", description: "Get specific cell by partial ID" },
        limit: { type: "number", description: "Max results" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "hive_create",
    label: "Hive Create",
    description: "Create a new cell in the hive",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Cell title (required)" },
        description: { type: "string", description: "Cell description" },
        type: { type: "string", description: "Cell type: task, bug, feature, epic, chore" },
        priority: { type: "number", description: "Priority (lower = higher priority)" },
        parent_id: { type: "string", description: "Parent epic ID" },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "hive_update",
    label: "Hive Update",
    description: "Update cell status or description",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Cell ID (required)" },
        status: { type: "string", description: "New status: open, in_progress, blocked, closed" },
        description: { type: "string", description: "New description" },
        priority: { type: "number", description: "New priority" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "hive_close",
    label: "Hive Close",
    description: "Close a cell with reason",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Cell ID (required)" },
        reason: { type: "string", description: "Closure reason (required)" },
      },
      required: ["id", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "hive_ready",
    label: "Hive Ready",
    description: "Get the next ready (unblocked, highest priority) cell",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "hive_query",
    label: "Hive Query",
    description: "Query hive cells with filters (same as hive_cells)",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: open, in_progress, blocked, closed" },
        type: { type: "string", description: "Filter by type: task, bug, feature, epic, chore" },
        ready: { type: "boolean", description: "Get only unblocked cells" },
        parent_id: { type: "string", description: "Get children of an epic" },
        limit: { type: "number", description: "Max results" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "hive_create_epic",
    label: "Hive Create Epic",
    description: "Create epic with subtasks atomically",
    parameters: {
      type: "object",
      properties: {
        epic_title: { type: "string", description: "Epic title (required)" },
        epic_description: { type: "string", description: "Epic description" },
        subtasks: { type: "string", description: "JSON array of subtasks [{title, files?, priority?}]" },
        strategy: { type: "string", description: "Decomposition strategy: file-based, feature-based, risk-based" },
      },
      required: ["epic_title", "subtasks"],
      additionalProperties: false,
    },
  },

  // Hivemind - semantic memory
  {
    name: "hivemind_stats",
    label: "Hivemind Stats",
    description: "Get hivemind memory statistics - counts, embeddings, health",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "hivemind_find",
    label: "Hivemind Find",
    description: "Search memories by semantic similarity or full-text",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (required)" },
        limit: { type: "number", description: "Max results (default 5)" },
        fts: { type: "boolean", description: "Use full-text search instead of semantic" },
        expand: { type: "boolean", description: "Return expanded context" },
        collection: { type: "string", description: "Filter by collection" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "hivemind_store",
    label: "Hivemind Store",
    description: "Store a memory with semantic embedding",
    parameters: {
      type: "object",
      properties: {
        information: { type: "string", description: "Information to store (required)" },
        tags: { type: "string", description: "Comma-separated tags" },
        collection: { type: "string", description: "Collection name (default: 'default')" },
        confidence: { type: "number", description: "Confidence score 0-1" },
      },
      required: ["information"],
      additionalProperties: false,
    },
  },
  {
    name: "hivemind_get",
    label: "Hivemind Get",
    description: "Retrieve a specific memory by ID",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID (required)" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },

  // Swarmmail - agent coordination
  {
    name: "swarmmail_init",
    label: "Swarmmail Init",
    description: "Initialize swarm mail session for agent coordination",
    parameters: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "Agent name" },
        project_path: { type: "string", description: "Project path" },
        task_description: { type: "string", description: "Task description" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "swarmmail_inbox",
    label: "Swarmmail Inbox",
    description: "Fetch inbox messages from other agents",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max messages" },
        urgent_only: { type: "boolean", description: "Only urgent messages" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "swarmmail_send",
    label: "Swarmmail Send",
    description: "Send message to other swarm agents",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient agent names (JSON array)" },
        subject: { type: "string", description: "Message subject (required)" },
        body: { type: "string", description: "Message body (required)" },
        importance: { type: "string", description: "low, normal, high, urgent" },
        thread_id: { type: "string", description: "Thread ID for replies" },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "swarmmail_reserve",
    label: "Swarmmail Reserve",
    description: "Reserve file paths for exclusive editing",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "string", description: "File paths to reserve (required)" },
        reason: { type: "string", description: "Reservation reason" },
        exclusive: { type: "boolean", description: "Exclusive lock" },
        ttl_seconds: { type: "number", description: "Time-to-live in seconds" },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  {
    name: "swarmmail_release",
    label: "Swarmmail Release",
    description: "Release file reservations",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "string", description: "File paths to release (JSON array)" },
        reservation_ids: { type: "string", description: "Reservation IDs to release (JSON array)" },
      },
      additionalProperties: false,
    },
  },

  // Swarm coordination
  {
    name: "swarm_decompose",
    label: "Swarm Decompose",
    description: "Generate decomposition prompt for parallel subtasks",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task to decompose (required)" },
        context: { type: "string", description: "Additional context" },
        query_cass: { type: "boolean", description: "Query hivemind for similar tasks" },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "swarm_status",
    label: "Swarm Status",
    description: "Get status of a swarm by epic ID",
    parameters: {
      type: "object",
      properties: {
        epic_id: { type: "string", description: "Epic ID (required)" },
        project_key: { type: "string", description: "Project key (required)" },
      },
      required: ["epic_id", "project_key"],
      additionalProperties: false,
    },
  },
  {
    name: "swarm_spawn_subtask",
    label: "Swarm Spawn Subtask",
    description: "Prepare a subtask for spawning with agent mail tracking",
    parameters: {
      type: "object",
      properties: {
        bead_id: { type: "string", description: "Bead/cell ID (required)" },
        epic_id: { type: "string", description: "Epic ID (required)" },
        subtask_title: { type: "string", description: "Subtask title (required)" },
        files: { type: "string", description: "Files to work on (JSON array, required)" },
        subtask_description: { type: "string", description: "Subtask description" },
        project_path: { type: "string", description: "Project path" },
        shared_context: { type: "string", description: "Shared context for worker" },
      },
      required: ["bead_id", "epic_id", "subtask_title", "files"],
      additionalProperties: false,
    },
  },
  {
    name: "swarm_progress",
    label: "Swarm Progress",
    description: "Report progress on a subtask to coordinator",
    parameters: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Project key (required)" },
        agent_name: { type: "string", description: "Agent name (required)" },
        bead_id: { type: "string", description: "Bead/cell ID (required)" },
        status: { type: "string", description: "Status: in_progress, blocked, completed, failed (required)" },
        progress_percent: { type: "number", description: "Progress percentage" },
        message: { type: "string", description: "Status message" },
        files_touched: { type: "string", description: "Files touched (JSON array)" },
      },
      required: ["project_key", "agent_name", "bead_id", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "swarm_complete",
    label: "Swarm Complete",
    description: "Mark subtask complete with verification gate",
    parameters: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Project key (required)" },
        agent_name: { type: "string", description: "Agent name (required)" },
        bead_id: { type: "string", description: "Bead/cell ID (required)" },
        summary: { type: "string", description: "Work summary (required)" },
        start_time: { type: "number", description: "Start timestamp (required)" },
        files_touched: { type: "string", description: "Files touched (JSON array)" },
        skip_verification: { type: "boolean", description: "Skip verification gate" },
      },
      required: ["project_key", "agent_name", "bead_id", "summary", "start_time"],
      additionalProperties: false,
    },
  },
  {
    name: "swarm_plan_prompt",
    label: "Swarm Plan Prompt",
    description: "Generate strategy-specific decomposition prompt with hivemind context",
    parameters: {
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
      additionalProperties: false,
    },
  },
  {
    name: "swarm_validate_decomposition",
    label: "Swarm Validate Decomposition",
    description: "Validate decomposition JSON before creating epic - checks file conflicts and dependencies",
    parameters: {
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
      additionalProperties: false,
    },
  },
  {
    name: "swarm_review",
    label: "Swarm Review",
    description: "Generate a review prompt for a completed subtask with epic context and diff",
    parameters: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Project key (required)" },
        epic_id: { type: "string", description: "Epic ID (required)" },
        task_id: { type: "string", description: "Task/cell ID (required)" },
        files_touched: { type: "string", description: "Files touched (JSON array)" },
      },
      required: ["project_key", "epic_id", "task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "swarm_review_feedback",
    label: "Swarm Review Feedback",
    description: "Send review feedback to a worker - tracks attempts (max 3 rejections)",
    parameters: {
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
      additionalProperties: false,
    },
  },
] as const;

const swarmPlugin = {
  id: "swarm-tools",
  name: "Swarm Tools",
  description: "Multi-agent swarm coordination with hivemind memory and cells",
  configSchema: emptyPluginConfigSchema(),

  register(api: ClawdbotPluginApi) {
    for (const tool of SWARM_TOOLS) {
      api.registerTool({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (_toolCallId: string, params: Record<string, unknown>) => {
          const result = executeSwarmTool(tool.name, params);
          return {
            content: [{ type: "text", text: result }],
          };
        },
      });
    }

    console.log(`[swarm-plugin] Registered ${SWARM_TOOLS.length} tools`);
  },
};

export default swarmPlugin;
