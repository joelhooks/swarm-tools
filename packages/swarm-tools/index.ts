/**
 * Clawdbot Swarm Plugin
 *
 * Integrates swarm-tools into clawdbot:
 * - Hive: cell/task management
 * - Hivemind: semantic memory
 * - Swarmmail: agent coordination
 * - Swarm: parallel workflow orchestration
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { execFileSync } from "child_process";

function executeSwarmTool(name: string, args: Record<string, unknown>): string {
  try {
    // Auto-inject start_time for swarm_complete if not provided
    if (name === "swarm_complete" && args.start_time === undefined) {
      args = { ...args, start_time: Date.now() };
    }
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
// Exported for use by MCP server (bin/mcp-server.ts)
export const SWARM_TOOLS = [
  // Hive - cell/task management
  {
    name: "hive_cells",
    label: "Hive Cells",
    description: "Query cells from hive with filters (status, type, ready, parent_id). Supports cross-project queries via project_key.",
    parameters: {
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
      additionalProperties: false,
    },
  },
  {
    name: "hive_projects",
    label: "Hive Projects",
    description: "List all projects with hive cells. Shows project_key, cell counts, and which is current.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
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
    parameters: {
      type: "object",
      properties: {
        project_key: { type: "string", description: "Override project scope (default: current working directory)" },
      },
      additionalProperties: false,
    },
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
        decayTier: { type: "string", description: "Filter by decay tier: hot, warm, cold, stale" },
        project_key: { type: "string", description: "Override project scope (default: current working directory)" },
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
        extractEntities: { type: "boolean", description: "Extract entities from content" },
        autoTag: { type: "boolean", description: "Auto-tag based on content analysis" },
        autoLink: { type: "boolean", description: "Auto-link to related memories" },
        project_key: { type: "string", description: "Override project scope (default: current working directory)" },
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
        project_key: { type: "string", description: "Override project scope (default: current working directory)" },
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
        start_time: { type: "number", description: "Start timestamp (auto-injected as Date.now() if not provided)" },
        files_touched: { type: "string", description: "Files touched (JSON array)" },
        skip_verification: { type: "boolean", description: "Skip verification gate" },
      },
      required: ["project_key", "agent_name", "bead_id", "summary"],
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

  // Queue management - BullMQ background job processing
  {
    name: "queue_submit",
    label: "Queue Submit",
    description: "Submit a job to the background queue with type, payload, and options (priority, delay, attempts). Returns job ID for tracking.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "Job type identifier (required)" },
        payload: { type: "string", description: "Job payload as JSON string (required)" },
        queue_name: { type: "string", description: "Queue name (default: 'swarm')" },
        priority: { type: "number", description: "Job priority (lower = higher priority, default: 0)" },
        delay: { type: "number", description: "Delay in milliseconds before job can be processed" },
        attempts: { type: "number", description: "Number of retry attempts on failure (default: 3)" },
        remove_on_complete: { type: "boolean", description: "Remove job after successful completion (default: false)" },
      },
      required: ["type", "payload"],
      additionalProperties: false,
    },
  },
  {
    name: "queue_status",
    label: "Queue Status",
    description: "Get status of a job by ID. Returns job state, progress, data, and error info if failed.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID to query (required)" },
        queue_name: { type: "string", description: "Queue name (default: 'swarm')" },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
  },
  {
    name: "queue_list",
    label: "Queue List",
    description: "List jobs by state (waiting, active, completed, failed, delayed). Returns job IDs, types, and basic info.",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", description: "Job state filter: waiting, active, completed, failed, delayed (default: all)" },
        queue_name: { type: "string", description: "Queue name (default: 'swarm')" },
        limit: { type: "number", description: "Maximum number of jobs to return (default: 10)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "queue_cancel",
    label: "Queue Cancel",
    description: "Cancel and remove a job by ID. Works for jobs in any state (waiting, delayed, active, completed, failed).",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID to cancel (required)" },
        queue_name: { type: "string", description: "Queue name (default: 'swarm')" },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
  },
] as const;

// ============================================================================
// Hivemind Memory Hooks (auto-recall / auto-capture)
// ============================================================================

interface MemoryResult {
  memory: {
    id: string;
    content: string;
    metadata?: { tags?: string[] };
    collection?: string;
    createdAt?: string;
    confidence?: number;
    decayTier?: string;
  };
  score: number;
  matchType: string;
}

// Global project key for system-wide memory (set via config)
let globalProjectKey: string | null = null;

// Content hash cache to prevent duplicates within session
const recentContentHashes = new Set<string>();
const MAX_HASH_CACHE_SIZE = 100;

function hashContent(text: string): string {
  // Simple hash for dedup - first 100 chars normalized + length
  const normalized = text.slice(0, 100).toLowerCase().replace(/\s+/g, " ").trim();
  return `${normalized.length}:${normalized.slice(0, 50)}`;
}

function swarmMemory(action: string, args: Record<string, unknown>): { success: boolean; data?: unknown; error?: string; results?: MemoryResult[] } {
  try {
    const cmdArgs = ["memory", action];
    if (action === "store" && args.information) {
      cmdArgs.push(String(args.information));
      if (args.tags) cmdArgs.push("--tags", String(args.tags));
    } else if (action === "find" && args.query) {
      cmdArgs.push(String(args.query));
      if (args.limit) cmdArgs.push("--limit", String(args.limit));
    }
    cmdArgs.push("--json");

    const output = execFileSync("swarm", cmdArgs, {
      encoding: "utf-8",
      timeout: 30000,
      // Use global project path as cwd for system-wide memory
      cwd: globalProjectKey || undefined,
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
    });
    return JSON.parse(output);
  } catch (error) {
    const err = error as { stdout?: string; message?: string };
    if (err.stdout) {
      try { return JSON.parse(err.stdout); } catch { /* ignore */ }
    }
    return { success: false, error: err.message || String(error) };
  }
}

/**
 * Check if content is a duplicate (in session cache or similar in DB)
 */
function isDuplicate(text: string, minScore = 0.85): boolean {
  const hash = hashContent(text);

  // Check session cache first (fast)
  if (recentContentHashes.has(hash)) {
    return true;
  }

  // Check DB for similar content (semantic dedup)
  const result = swarmMemory("find", { query: text.slice(0, 200), limit: 3 });
  if (result.success && result.results) {
    for (const r of result.results) {
      if (r.score >= minScore) {
        // Very similar content exists
        return true;
      }
    }
  }

  return false;
}

/**
 * Add content hash to session cache
 */
function markAsStored(text: string): void {
  const hash = hashContent(text);
  recentContentHashes.add(hash);

  // Prune cache if too large
  if (recentContentHashes.size > MAX_HASH_CACHE_SIZE) {
    const toDelete = Array.from(recentContentHashes).slice(0, 20);
    toDelete.forEach(h => recentContentHashes.delete(h));
  }
}

// Patterns that indicate content worth storing (must signal actual knowledge, not system logs)
const STRONG_CAPTURE_PATTERNS = [
  /\b(prefer|always use|never use|convention is|standard is)\b/i,
  /\b(decided to|chose .+ because|decision:|the approach is)\b/i,
  /\b(learned that|discovered that|found out that|realized that|turns out|gotcha:|pitfall:)\b/i,
  /\b(pattern:|architecture:|design decision)\b/i,
  /\b(important:|warning:|caveat:|careful with|watch out for)\b/i,
  /\b(requires|must be|needs to be|config.+should)\b/i,
];

// Patterns that indicate entity-rich content (names, projects, technologies)
const ENTITY_PATTERNS = [
  /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/, // Proper names (e.g., "John Smith")
  /\b(React|Next\.js|TypeScript|JavaScript|Python|Java|AWS|Azure|GCP)\b/i, // Technologies
  /\b(GitHub|GitLab|Jira|Slack|Notion|Figma)\b/i, // Tools/platforms
  /\b(project|repository|repo|codebase|app|application|system)\s+['""]?([A-Z][a-z-]+)/i, // Named projects
  /\b([A-Z][A-Z0-9_-]{2,})\b/, // Acronyms/constants (e.g., "API", "DB_HOST")
];

const SKIP_PATTERNS = [
  /^(ok|okay|sure|yes|no|thanks|thank you|got it|understood)\.?$/i,
  /^(hi|hello|hey|bye|goodbye)\.?$/i,
  /<hivemind-context>[\s\S]*<\/hivemind-context>/,
  /^\s*$/,
];

const SYSTEM_MESSAGE_PATTERNS = [
  /^System:\s*\[/,                    // System: [timestamp] messages
  /^OUTCOME:/,                        // Swarm OUTCOME blocks
  /^DECISION:/,                       // Swarm DECISION blocks
  /^COMPACTION:/,                     // Context compaction markers
  /health.?watchdog/i,                // Health watchdog checks
  /^Exec completed/i,                 // Exec completion logs
  /heartbeat/i,                       // Heartbeat prompts
  /^Run ~?\/?.*health-watchdog/i,     // Health watchdog commands
  /^\[.*\]\s*(Starting|Checking|Running)/, // Bracketed system logs
  /^Telegram\b/i,                     // Telegram relay messages
  /^Session \w+ \(\d{4}-/,           // Auto session summaries
  /^Session ended without summary/,   // Garbage summary placeholder
  /openclaw system event/i,           // Event notifications
  /^\[swarm-plugin\]/,                // Plugin's own log output
  /^<hivemind-context>/,              // Previously injected context
  /Read HEARTBEAT\.md/i,              // Heartbeat instructions
  /HEARTBEAT_OK/i,                    // Heartbeat responses
  /^Worker Monitor/i,                 // Worker monitor logs
  /Ralph loop monitor/i,              // Ralph loop checks
];

function isSystemMessage(text: string): boolean {
  const trimmed = text.trim();
  for (const pattern of SYSTEM_MESSAGE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function shouldCapture(text: string): boolean {
  if (text.length < 80) return false;
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  // Block system messages — this is the primary noise filter
  if (isSystemMessage(text)) return false;

  // Require a strong capture signal
  for (const pattern of STRONG_CAPTURE_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  // Only capture long messages if they're also entity-rich (not just verbose system output)
  if (text.length > 300 && isEntityRich(text)) return true;

  return false;
}

function isEntityRich(text: string): boolean {
  let matches = 0;
  for (const pattern of ENTITY_PATTERNS) {
    if (pattern.test(text)) matches++;
  }
  return matches >= 2; // At least 2 entity patterns
}

function detectTags(text: string): string[] {
  const tags: string[] = ["auto-captured"];
  const lower = text.toLowerCase();
  if (/\b(prefer|always use|never use|convention)\b/.test(lower)) tags.push("preference");
  if (/\b(decision|decided|chose|approach)\b/.test(lower)) tags.push("decision");
  if (/\b(learned|discovered|found out|realized|turns out|gotcha|pitfall)\b/.test(lower)) tags.push("learning");
  if (/\b(gotcha|pitfall|caveat|watch out|careful with|warning)\b/.test(lower)) tags.push("gotcha");
  if (/\b(architecture|pattern|design decision|system design)\b/.test(lower)) tags.push("architecture");
  if (/\b(config|configuration|setting|env|environment)\b/.test(lower)) tags.push("config");
  return tags;
}

function formatRecallContext(results: MemoryResult[], contentLimit = 600): string {
  if (results.length === 0) return "";
  const lines = results.map((r) => {
    const tags = r.memory.metadata?.tags?.join(",") || "general";
    const score = Math.round(r.score * 100);
    const content = r.memory.content.slice(0, contentLimit);
    return `- (${score}%) [${tags}] ${content}${content.length >= contentLimit ? "..." : ""}`;
  });
  return `<hivemind-context>\n${lines.join("\n")}\n</hivemind-context>`;
}

// ============================================================================
// HATEOAS Hint Generators
// ============================================================================

/**
 * Add contextual hints to hivemind_find responses
 */
function addHivemindFindHints(resultJson: string, params: Record<string, unknown>): string {
  try {
    const result = JSON.parse(resultJson);
    if (!result.success) return resultJson;

    const data = result.data || result;
    const results = data.results || [];
    const count = results.length;
    const query = params.query as string;
    const limit = (params.limit as number) || 5;
    const fts = params.fts as boolean;
    const expand = params.expand as boolean;

    const hints: string[] = [];

    // Result count hints
    if (count === 0) {
      hints.push(`No results found. Try: hivemind_find({query: '<broader topic>'}) or add fts: true for full-text search`);
    } else if (count === 1) {
      hints.push(`Low results (1 match). Try fts: true for full-text search or broaden your query`);
    } else if (count >= limit) {
      hints.push(`Found ${count} results (limit reached). For more results, increase limit or narrow your query`);
    } else if (count > 1 && count < 5) {
      hints.push(`Found ${count} results. For more context try: hivemind_find({query: '${query} gotchas'})`);
    }

    // Feature suggestion hints
    if (!expand && count > 0) {
      hints.push(`Tip: Use expand: true for full content with surrounding context`);
    }

    if (!fts && count < 3) {
      hints.push(`Tip: Try fts: true for literal/full-text matching instead of semantic search`);
    }

    // Add related query suggestions based on results
    if (count > 0) {
      const firstResult = results[0];
      const tags = firstResult.metadata?.tags || [];
      if (tags.length > 0) {
        const tag = tags[0];
        hints.push(`Related: Try hivemind_find({query: '${tag}'}) to explore similar memories`);
      }
    }

    // Append hints to result
    if (hints.length > 0) {
      result.hints = hints;
    }

    return JSON.stringify(result, null, 2);
  } catch {
    return resultJson;
  }
}

/**
 * Add contextual hints to hivemind_store responses
 */
function addHivemindStoreHints(resultJson: string, params: Record<string, unknown>): string {
  try {
    const result = JSON.parse(resultJson);
    if (!result.success) return resultJson;

    const information = params.information as string;
    const tags = params.tags as string;
    const hints: string[] = [];

    // Success hints
    hints.push(`Stored! Memory is now searchable via hivemind_find`);

    // Tag suggestions
    if (!tags || tags.trim() === "") {
      hints.push(`Tip: Add tags to improve discoverability: hivemind_store({information: '...', tags: 'topic,context'})`);
    }

    // Related memory check
    const shortened = information.slice(0, 100);
    hints.push(`Related memories may exist. Consider: hivemind_find({query: '${shortened.slice(0, 50)}'})`);

    // Feature hints
    if (!params.extractEntities) {
      hints.push(`Tip: Use extractEntities: true to auto-extract entities from content`);
    }

    if (!params.autoLink) {
      hints.push(`Tip: Use autoLink: true to automatically link to related memories`);
    }

    // Append hints to result
    if (hints.length > 0) {
      result.hints = hints;
    }

    return JSON.stringify(result, null, 2);
  } catch {
    return resultJson;
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

const swarmPlugin = {
  id: "swarm-tools",
  name: "Swarm Tools",
  description: "Multi-agent swarm coordination with hivemind memory (auto-recall/capture), cells, and workflows",
  configSchema: {
    type: "object",
    properties: {
      autoRecall: { type: "boolean", default: true, description: "Inject relevant memories before each turn" },
      autoCapture: { type: "boolean", default: true, description: "Store important info after each turn" },
      maxRecallResults: { type: "number", default: 3, description: "Max memories to inject" },
      minScore: { type: "number", default: 0.55, description: "Min similarity score for recall" },
      dedupScore: { type: "number", default: 0.85, description: "Min similarity to consider duplicate (prevents storing)" },
      memoryScope: { type: "string", default: "global", description: "Memory scope: 'global' (system-wide) or 'project' (per-directory)" },
      globalMemoryPath: { type: "string", description: "Path for global memory (default: ~/clawd)" },
      decayTierFilter: { type: "string", default: "hot", description: "Filter memories by decay tier: hot, warm, cold, stale, or 'all'" },
      extractEntitiesOnCapture: { type: "boolean", default: true, description: "Extract entities from captured memories" },
      recallCooldownMs: { type: "number", default: 30000, description: "Min ms between recall queries (prevents flooding)" },
      maxCapturePerTurn: { type: "number", default: 1, description: "Max memories to capture per agent turn" },
      captureContentLimit: { type: "number", default: 1000, description: "Max chars to store per captured memory" },
      recallContentLimit: { type: "number", default: 600, description: "Max chars to show per recalled memory" },
      debug: { type: "boolean", default: false, description: "Debug logging" },
    },
    additionalProperties: false,
  },

  register(api: OpenClawPluginApi) {
    const cfg = {
      autoRecall: true,
      autoCapture: true,
      maxRecallResults: 3,
      minScore: 0.55,
      dedupScore: 0.85,
      memoryScope: "global",
      globalMemoryPath: `${process.env.HOME}/clawd`,
      decayTierFilter: "hot",
      extractEntitiesOnCapture: true,
      recallCooldownMs: 30000,
      maxCapturePerTurn: 1,
      captureContentLimit: 1000,
      recallContentLimit: 600,
      debug: false,
      ...(api.pluginConfig as Record<string, unknown>),
    };

    // Set global project key for system-wide memory
    if (cfg.memoryScope === "global") {
      globalProjectKey = cfg.globalMemoryPath as string;
      console.log(`[swarm-plugin] Using global memory scope: ${globalProjectKey}`);
    }

    // Register all swarm tools
    for (const tool of SWARM_TOOLS) {
      api.registerTool({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (_toolCallId: string, params: Record<string, unknown>) => {
          const result = executeSwarmTool(tool.name, params);

          // Add HATEOAS-style hints for hivemind tools
          if (tool.name === "hivemind_find") {
            return {
              content: [{ type: "text", text: addHivemindFindHints(result, params) }],
            };
          } else if (tool.name === "hivemind_store") {
            return {
              content: [{ type: "text", text: addHivemindStoreHints(result, params) }],
            };
          }

          return {
            content: [{ type: "text", text: result }],
          };
        },
      });
    }

    console.log(`[swarm-plugin] Registered ${SWARM_TOOLS.length} tools`);

    // ========================================================================
    // Auto-recall: inject relevant memories before agent starts
    // ========================================================================
    let lastRecallTime = 0;

    if (cfg.autoRecall) {
      if (cfg.debug) console.log(`[swarm-plugin] Registering before_agent_start hook`);
      api.on("before_agent_start", async (event: Record<string, unknown>) => {
        const prompt = event.prompt as string | undefined;
        if (!prompt || prompt.length < 30) {
          if (cfg.debug) console.log(`[swarm-plugin] Skipping recall: prompt too short`);
          return;
        }

        // Gate: skip system messages
        if (isSystemMessage(prompt)) {
          if (cfg.debug) console.log(`[swarm-plugin] Skipping recall: system message`);
          return;
        }

        // Gate: cooldown between recall queries
        const now = Date.now();
        const cooldown = (cfg.recallCooldownMs as number) || 30000;
        if (now - lastRecallTime < cooldown) {
          if (cfg.debug) console.log(`[swarm-plugin] Skipping recall: cooldown (${Math.round((cooldown - (now - lastRecallTime)) / 1000)}s remaining)`);
          return;
        }
        lastRecallTime = now;

        try {
          // Truncate query to first 200 chars — full prompts are noisy
          const queryText = prompt.slice(0, 200);
          if (cfg.debug) console.log(`[swarm-plugin] Querying hivemind for: ${queryText.slice(0, 50)}...`);
          const findParams: Record<string, unknown> = { query: queryText, limit: cfg.maxRecallResults };
          if (cfg.decayTierFilter && cfg.decayTierFilter !== "all") {
            findParams.decayTier = cfg.decayTierFilter;
          }
          const result = swarmMemory("find", findParams);
          if (cfg.debug) console.log(`[swarm-plugin] Hivemind result: success=${result.success}`);
          if (!result.success) return;

          // swarm memory find returns { success, results } not { success, data: { results } }
          const parsed = result as unknown as { success: boolean; results?: MemoryResult[] };
          const results = (parsed.results || []).filter((r) => r.score >= cfg.minScore);
          if (cfg.debug) console.log(`[swarm-plugin] Found ${results.length} memories above ${cfg.minScore} threshold`);
          if (results.length === 0) return;

          const context = formatRecallContext(results, cfg.recallContentLimit as number);
          if (cfg.debug) console.log(`[swarm-plugin] Injecting ${results.length} memories (${context.length} chars)`);

          return { prependContext: context };
        } catch (err) {
          if (cfg.debug) console.log(`[swarm-plugin] Recall error: ${err}`);
        }
      });
    }

    // ========================================================================
    // Auto-capture: store important info after agent ends
    // ========================================================================
    if (cfg.autoCapture) {
      api.on("agent_end", async (event: Record<string, unknown>) => {
        if (!event.success || !Array.isArray(event.messages) || event.messages.length === 0) return;

        try {
          const texts: string[] = [];
          for (const msg of event.messages) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;
            const role = msgObj.role;
            // Only capture assistant responses — user messages and system are noise
            if (role !== "assistant") continue;

            const content = msgObj.content;
            if (typeof content === "string") {
              if (!isSystemMessage(content)) texts.push(content);
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block && typeof block === "object" &&
                    (block as Record<string, unknown>).type === "text" &&
                    typeof (block as Record<string, unknown>).text === "string") {
                  const t = (block as Record<string, unknown>).text as string;
                  if (!isSystemMessage(t)) texts.push(t);
                }
              }
            }
          }

          const toCapture = texts.filter((t) => shouldCapture(t) && !t.includes("<hivemind-context>"));
          if (toCapture.length === 0) return;

          const maxCaptures = (cfg.maxCapturePerTurn as number) || 1;
          const contentLimit = (cfg.captureContentLimit as number) || 1000;
          let stored = 0;
          let skippedDupes = 0;
          for (const text of toCapture.slice(0, maxCaptures)) {
            const truncated = text.slice(0, contentLimit);

            // Check for duplicates before storing
            if (isDuplicate(truncated, cfg.dedupScore as number)) {
              skippedDupes++;
              if (cfg.debug) console.log(`[swarm-plugin] Skipping duplicate: ${truncated.slice(0, 50)}...`);
              continue;
            }

            const tags = detectTags(text);
            const storeParams: Record<string, unknown> = { information: truncated, tags: tags.join(",") };

            // Enable entity extraction for entity-rich content
            if (cfg.extractEntitiesOnCapture && isEntityRich(text)) {
              storeParams.extractEntities = true;
            }

            const result = swarmMemory("store", storeParams);
            if (result.success) {
              stored++;
              markAsStored(truncated);
            }
          }

          if (cfg.debug && (stored > 0 || skippedDupes > 0)) {
            console.log(`[swarm-plugin] Captured ${stored} memories, skipped ${skippedDupes} duplicates`);
          }
        } catch (err) {
          if (cfg.debug) console.log(`[swarm-plugin] Capture error: ${err}`);
        }
      });
    }

    if (cfg.autoRecall || cfg.autoCapture) {
      console.log(`[swarm-plugin] Hivemind hooks: autoRecall=${cfg.autoRecall}, autoCapture=${cfg.autoCapture}`);
    }
  },
};

export default swarmPlugin;
