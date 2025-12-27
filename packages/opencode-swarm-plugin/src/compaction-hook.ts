/**
 * Swarm-Aware Compaction Hook
 *
 * Provides context preservation during OpenCode session compaction.
 * When context is compacted, this hook injects instructions for the summarizer
 * to preserve swarm coordination state and enable seamless resumption.
 *
 * ## Philosophy: Err on the Side of Continuation
 * 
 * It's better to inject swarm context unnecessarily than to lose an active swarm.
 * The cost of a false positive (extra context) is low.
 * The cost of a false negative (lost swarm) is high - wasted work, confused agents.
 *
 * Hook signature (from @opencode-ai/plugin):
 * ```typescript
 * "experimental.session.compacting"?: (
 *   input: { sessionID: string },
 *   output: { context: string[] }
 * ) => Promise<void>
 * ```
 *
 * @example
 * ```typescript
 * import { SWARM_COMPACTION_CONTEXT, createCompactionHook } from "opencode-swarm-plugin";
 *
 * const hooks: Hooks = {
 *   "experimental.session.compacting": createCompactionHook(),
 * };
 * ```
 */

import { checkSwarmHealth } from "swarm-mail";
import {
  CompactionPhase,
  createMetricsCollector,
  getMetricsSummary,
  recordPatternExtracted,
  recordPatternSkipped,
  recordPhaseComplete,
  recordPhaseStart,
} from "./compaction-observability";
import { getHiveAdapter, getHiveWorkingDirectory } from "./hive";
import { createChildLogger } from "./logger";

let _logger: any | undefined;

/**
 * Get logger instance (lazy initialization for testability)
 *
 * Logs to: ~/.config/swarm-tools/logs/compaction.1log
 *
 * Log structure:
 * - START: session_id, trigger
 * - GATHER: source (swarm-mail|hive), duration_ms, stats/counts
 * - DETECT: confidence, detected, reason_count, reasons
 * - INJECT: confidence, context_length, context_type (full|fallback|none)
 * - COMPLETE: duration_ms, success, detected, confidence, context_injected
 */
function getLog() {
  if (!_logger) {
    _logger = createChildLogger("compaction");
  }
  return _logger;
}

// ============================================================================
// Compaction Context
// ============================================================================

/**
 * Swarm-aware compaction context
 *
 * Injected during compaction to keep the swarm cooking. The coordinator should
 * wake up from compaction and immediately resume orchestration - spawning agents,
 * monitoring progress, unblocking work.
 *
 * This is NOT about preserving state for a human - it's about the swarm continuing
 * autonomously after context compression.
 * 
 * Structure optimized for eval scores:
 * 1. ASCII header (visual anchor, coordinatorIdentity scorer)
 * 2. What Good Looks Like (behavioral examples, outcome-focused)
 * 3. Immediate actions (actionable tool calls, postCompactionDiscipline scorer)
 * 4. Forbidden tools (explicit list, forbiddenToolsPresent scorer)
 * 5. Mandatory behaviors (inbox, skills, review)
 * 6. Role & mandates (strong language, coordinatorIdentity scorer)
 * 7. Reference sections (supporting material)
 */
export const SWARM_COMPACTION_CONTEXT = `
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│             🐝  YOU ARE THE COORDINATOR  🐝                 │
│                                                             │
│             NOT A WORKER. NOT AN IMPLEMENTER.               │
│                  YOU ORCHESTRATE.                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Context was compacted but the swarm is still running. **YOU ARE THE COORDINATOR.**

Your role is ORCHESTRATION, not implementation. The resume steps above (if present) tell you exactly what to do first.

---

## 🎯 WHAT GOOD LOOKS LIKE (Behavioral Examples)

**✅ GOOD Coordinator Behavior:**
- Spawned researcher for unfamiliar tech → got summary → stored in semantic-memory
- Loaded \`skills_use(name="testing-patterns")\` BEFORE spawning test workers
- Checked \`swarmmail_inbox()\` every 5-10 minutes → caught blocked worker → unblocked in 2min
- Delegated planning to swarm/planner subagent → main context stayed clean
- Workers reserved their OWN files → no conflicts
- Reviewed all worker output with \`swarm_review\` → caught integration issue before merge

**❌ COMMON MISTAKES (Avoid These):**
- Called context7/pdf-brain directly → dumped 50KB into thread → context exhaustion
- Skipped skill loading → workers reinvented patterns already in skills
- Never checked inbox → worker stuck 25 minutes → silent failure
- Reserved files as coordinator → workers blocked → swarm stalled
- Closed cells when workers said "done" → skipped review → shipped broken code

---

## 🚫 FORBIDDEN TOOLS (NEVER Use These Directly)

Coordinators do NOT do implementation work. These tools are **FORBIDDEN**:

### File Modification (ALWAYS spawn workers instead)
- \`Edit\` - SPAWN A WORKER
- \`Write\` - SPAWN A WORKER
- \`bash\` (for file modifications) - SPAWN A WORKER
- \`swarmmail_reserve\` - Workers reserve their own files
- \`git commit\` - Workers commit their own changes

### External Data Fetching (SPAWN A RESEARCHER instead)

**Repository fetching:**
- \`repo-crawl_file\`, \`repo-crawl_readme\`, \`repo-crawl_search\`, \`repo-crawl_structure\`, \`repo-crawl_tree\`
- \`repo-autopsy_*\` (all repo-autopsy tools)

**Web/documentation fetching:**
- \`webfetch\`, \`fetch_fetch\`
- \`context7_resolve-library-id\`, \`context7_get-library-docs\`

**Knowledge base:**
- \`pdf-brain_search\`, \`pdf-brain_read\`

**Instead:** Use \`swarm_spawn_researcher\` with a clear research task. The researcher will fetch, summarize, and return findings.

---

## 💼 YOUR ROLE (Non-Negotiable)

You are the **COORDINATOR**. Your job is ORCHESTRATION, not implementation.

### What Coordinators Do:
- ✅ Spawn workers for implementation tasks
- ✅ Monitor worker progress via \`swarm_status\` and \`swarmmail_inbox\`
- ✅ Review completed work with \`swarm_review\`
- ✅ Unblock dependencies and resolve conflicts
- ✅ Close the loop when epics complete

### What Coordinators NEVER Do:
- ❌ **NEVER** edit or write files directly
- ❌ **NEVER** run tests with \`bash\`
- ❌ **NEVER** "just do it myself to save time"
- ❌ **NEVER** reserve files (workers reserve)
- ❌ **NEVER** fetch external data directly (spawn researchers)

**If you catch yourself about to edit a file, STOP. Use \`swarm_spawn_subtask\` instead.**

### Strong Mandates:
- **ALWAYS** spawn workers for implementation tasks
- **ALWAYS** check status and inbox before decisions
- **ALWAYS** review worker output before accepting
- **NON-NEGOTIABLE:** You orchestrate. You do NOT implement.

---

## 📋 MANDATORY BEHAVIORS (Post-Compaction Checklist)

### 1. Inbox Monitoring (EVERY 5-10 MINUTES)
\`\`\`
swarmmail_inbox(limit=5)           # Check for messages
swarmmail_read_message(message_id=N)  # Read urgent ones
swarm_status(epic_id, project_key)    # Overall progress
\`\`\`
**Intervention triggers:** Worker blocked >5min, file conflict, scope creep

### 2. Skill Loading (BEFORE spawning workers)
\`\`\`
use skill swarm-coordination  # ALWAYS for swarms
use skill testing-patterns    # If task involves tests
use skill system-design       # If architectural decisions
\`\`\`
**Include skill recommendations in shared_context for workers.**

### 3. Worker Review (AFTER EVERY worker returns)
\`\`\`
swarm_review(project_key, epic_id, task_id, files_touched)
# Evaluate: Does it fulfill requirements? Enable downstream tasks? Type safe?
swarm_review_feedback(project_key, task_id, worker_id, status, issues)
\`\`\`
**3-Strike Rule:** After 3 rejections → mark blocked → escalate to human.

### 4. Research Spawning (For unfamiliar tech)
\`\`\`
Task(subagent_type="swarm-researcher", prompt="Research <topic>...")
\`\`\`
**NEVER call context7, pdf-brain, webfetch directly.** Spawn a researcher.

---

## 📝 SUMMARY FORMAT (Preserve This State)

When compaction occurs, extract and preserve this structure:

\`\`\`
## 🐝 Swarm State

**Epic:** CELL_ID - TITLE
**Project:** PROJECT_PATH
**Progress:** X/Y subtasks complete

**Active:**
- CELL_ID: TITLE [in_progress] → AGENT working on FILES

**Blocked:**
- CELL_ID: TITLE - BLOCKED: REASON

**Completed:**
- CELL_ID: TITLE ✓

**Ready to Spawn:**
- CELL_ID: TITLE (files: FILES)
\`\`\`

### What to Extract:
1. **Epic & Subtasks** - IDs, titles, status, file assignments
2. **What's Running** - Active agents and their current work
3. **What's Blocked** - Blockers and what's needed to unblock
4. **What's Done** - Completed work and follow-ups
5. **What's Next** - Pending subtasks ready to spawn

---

## 📋 REFERENCE: Full Coordinator Workflow

You are ALWAYS swarming. Use this workflow for any new work:

### Phase 1.5: Research (For Complex Tasks)

If the task requires unfamiliar technologies, spawn a researcher FIRST:

\`\`\`
swarm_spawn_researcher(
  research_id="research-TOPIC",
  epic_id="mjkw...",  # your epic ID
  tech_stack=["TECHNOLOGY"],
  project_path="PROJECT_PATH"
)
// Then spawn with Task(subagent_type="swarm/researcher", prompt="...")
\`\`\`

### Phase 2: Knowledge Gathering

\`\`\`
semantic-memory_find(query="TASK_KEYWORDS", limit=5)   # Past learnings
cass_search(query="TASK_DESCRIPTION", limit=5)         # Similar past tasks
# Skills are managed by OpenCode native format (.opencode/skill/)
# Check .opencode/skill/ directory for available skills
\`\`\`

### Phase 3: Decompose

\`\`\`
swarm_select_strategy(task="TASK")
swarm_plan_prompt(task="TASK", context="KNOWLEDGE")
swarm_validate_decomposition(response="CELLTREE_JSON")
\`\`\`

### Phase 4: Create Cells

\`hive_create_epic(epic_title="TASK", subtasks=[...])\`

### Phase 5: File Reservations

> **⚠️ Coordinator NEVER reserves files.** Workers reserve their own files with \`swarmmail_reserve\`.

### Phase 6: Spawn Workers

\`\`\`
swarm_spawn_subtask(bead_id, epic_id, title, files, shared_context, project_path)
Task(subagent_type="swarm/worker", prompt="GENERATED_PROMPT")
\`\`\`

### Phase 7: Review Loop (MANDATORY)

**AFTER EVERY Task() RETURNS:**

1. \`swarmmail_inbox()\` - Check for messages
2. \`swarm_review(project_key, epic_id, task_id, files_touched)\` - Generate review
3. Evaluate against epic goals
4. \`swarm_review_feedback(project_key, task_id, worker_id, status, issues)\`

**If needs_changes:**
\`\`\`
swarm_spawn_retry(bead_id, epic_id, original_prompt, attempt, issues, diff, files, project_path)
// Spawn NEW worker with Task() using retry prompt
// Max 3 attempts before marking task blocked
\`\`\`

### Phase 8: Complete

\`hive_sync()\` - Sync all cells to git

---

## 📊 REFERENCE: Decomposition Strategies

| Strategy       | Best For                 | Keywords                               |
| -------------- | ------------------------ | -------------------------------------- |
| file-based     | Refactoring, migrations  | refactor, migrate, rename, update all  |
| feature-based  | New features             | add, implement, build, create, feature |
| risk-based     | Bug fixes, security      | fix, bug, security, critical, urgent   |

---

**You are the COORDINATOR. You orchestrate. You do NOT implement. Spawn workers.**
`;

/**
 * Fallback detection prompt - tells the compactor what to look for
 * 
 * Used when we can't definitively detect a swarm but want to be safe.
 * The compactor can check the conversation context for these patterns.
 */
export const SWARM_DETECTION_FALLBACK = `## 🐝 Swarm Detection - Check Your Context

**IMPORTANT:** Before summarizing, check if this session involves an active swarm.

Look for ANY of these patterns in the conversation:

### Tool Calls (definite swarm sign)
- \`swarm_decompose\`, \`swarm_spawn_subtask\`, \`swarm_status\`, \`swarm_complete\`
- \`swarmmail_init\`, \`swarmmail_reserve\`, \`swarmmail_send\`
- \`hive_create_epic\`, \`hive_start\`, \`hive_close\`

### IDs and Names
- Cell IDs: \`bd-xxx\`, \`bd-xxx.N\` (subtask format)
- Agent names: BlueLake, RedMountain, GreenValley, etc.
- Epic references: "epic", "subtask", "parent"

### Coordination Language
- "spawn", "worker", "coordinator"
- "reserve", "reservation", "files"
- "blocked", "unblock", "dependency"
- "progress", "complete", "in_progress"

### If You Find Swarm Evidence

Include this in your summary:
1. Epic ID and title
2. Project path
3. Subtask status (running/blocked/done/pending)
4. Any blockers or issues
5. What should happen next

**Then tell the resumed session:**
"This is an active swarm. Check swarm_status and swarmmail_inbox immediately."
`;

// ============================================================================
// Dynamic Context Building
// ============================================================================

/**
 * Build dynamic swarm state section from detected state
 * 
 * This injects SPECIFIC values instead of placeholders, making the context
 * immediately actionable on resume.
 */
function buildDynamicSwarmState(state: SwarmState): string {
  const parts: string[] = [];
  
  // Lead with epic context
  if (state.epicId && state.epicTitle) {
    parts.push(`You are coordinating epic **${state.epicId}** - ${state.epicTitle}`);
  } else if (state.epicId) {
    parts.push(`You are coordinating epic **${state.epicId}**`);
  }
  
  parts.push(`Project: ${state.projectPath}\n`);
  
  // IMMEDIATE ACTIONS section (must come FIRST for postCompactionDiscipline scoring)
  if (state.epicId) {
    parts.push(`## 1️⃣ IMMEDIATE ACTIONS (Do These FIRST)\n`);
    parts.push(`1. \`swarm_status(epic_id="${state.epicId}", project_key="${state.projectPath}")\` - Get current swarm state`);
    parts.push(`2. \`swarmmail_inbox(limit=5)\` - Check for worker messages and blockers`);
    parts.push(`3. For completed work: Review with \`swarm_review\` → \`swarm_review_feedback\``);
    parts.push(`4. For open subtasks: Spawn workers with \`swarm_spawn_subtask\``);
    parts.push(`5. For blocked work: Investigate, unblock, or reassign\n`);
  }
  
  // Swarm state summary
  parts.push(`## 🐝 Current Swarm State\n`);
  
  if (state.epicId && state.epicTitle) {
    parts.push(`**Epic:** ${state.epicId} - ${state.epicTitle}`);
    
    const totalSubtasks = state.subtasks.closed + state.subtasks.in_progress + 
                          state.subtasks.open + state.subtasks.blocked;
    
    if (totalSubtasks > 0) {
      parts.push(`**Subtasks:**`);
      if (state.subtasks.closed > 0) parts.push(`  - ${state.subtasks.closed} closed`);
      if (state.subtasks.in_progress > 0) parts.push(`  - ${state.subtasks.in_progress} in_progress`);
      if (state.subtasks.open > 0) parts.push(`  - ${state.subtasks.open} open`);
      if (state.subtasks.blocked > 0) parts.push(`  - ${state.subtasks.blocked} blocked`);
    }
  }
  
  parts.push(`**Project:** ${state.projectPath}\n`);
  
  return parts.join("\n");
}

// ============================================================================
// SDK Message Scanning
// ============================================================================

/**
 * Tool part with completed state containing input/output
 */
interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state: ToolState;
}

/**
 * Tool state (completed tools have input/output we need)
 */
type ToolState =
  | {
      status: "completed";
      input: { [key: string]: unknown };
      output: string;
      title: string;
      metadata: { [key: string]: unknown };
      time: { start: number; end: number };
    }
  | {
      status: string;
      [key: string]: unknown;
    };

/**
 * SDK Client type (minimal interface for scanSessionMessages)
 * 
 * The actual SDK client uses a more complex Options-based API:
 * client.session.messages({ path: { id: sessionID }, query: { limit } })
 * 
 * We accept `unknown` and handle the type internally to avoid
 * tight coupling to SDK internals.
 */
export type OpencodeClient = unknown;

/**
 * Scanned swarm state extracted from session messages
 */
export interface ScannedSwarmState {
  epicId?: string;
  epicTitle?: string;
  projectPath?: string;
  agentName?: string;
  subtasks: Map<
    string,
    { title: string; status: string; worker?: string; files?: string[] }
  >;
  lastAction?: { tool: string; args: unknown; timestamp: number };
}

/**
 * Scan session messages for swarm state using SDK client
 *
 * Extracts swarm coordination state from actual tool calls:
 * - swarm_spawn_subtask → subtask tracking
 * - swarmmail_init → agent name, project path
 * - hive_create_epic → epic ID and title
 * - swarm_status → epic reference
 * - swarm_complete → subtask completion
 *
 * @param client - OpenCode SDK client (undefined if not available)
 * @param sessionID - Session to scan
 * @param limit - Max messages to fetch (default 100)
 * @returns Extracted swarm state
 */
export async function scanSessionMessages(
  client: OpencodeClient,
  sessionID: string,
  limit: number = 100,
): Promise<ScannedSwarmState> {
  const state: ScannedSwarmState = {
    subtasks: new Map(),
  };

  if (!client) {
    return state;
  }

  try {
    // SDK client uses Options-based API: { path: { id }, query: { limit } }
    const sdkClient = client as {
      session: {
        messages: (opts: {
          path: { id: string };
          query?: { limit?: number };
        }) => Promise<{ data?: Array<{ info: unknown; parts: ToolPart[] }> }>;
      };
    };

    const response = await sdkClient.session.messages({
      path: { id: sessionID },
      query: { limit },
    });

    const messages = response.data || [];

    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool" || part.state.status !== "completed") {
          continue;
        }

        const { tool, state: toolState } = part;
        const { input, output, time } = toolState as Extract<
          ToolState,
          { status: "completed" }
        >;

        // Track last action
        state.lastAction = {
          tool,
          args: input,
          timestamp: time.end,
        };

        // Extract swarm state based on tool type
        switch (tool) {
          case "hive_create_epic": {
            try {
              const parsed = JSON.parse(output);
              if (parsed.epic?.id) {
                state.epicId = parsed.epic.id;
              }
              if (input.epic_title && typeof input.epic_title === "string") {
                state.epicTitle = input.epic_title;
              }
            } catch {
              // Invalid JSON, skip
            }
            break;
          }

          case "swarmmail_init": {
            try {
              const parsed = JSON.parse(output);
              if (parsed.agent_name) {
                state.agentName = parsed.agent_name;
              }
              if (parsed.project_key) {
                state.projectPath = parsed.project_key;
              }
            } catch {
              // Invalid JSON, skip
            }
            break;
          }

          case "swarm_spawn_subtask": {
            const beadId = input.bead_id as string | undefined;
            const epicId = input.epic_id as string | undefined;
            const title = input.subtask_title as string | undefined;
            const files = input.files as string[] | undefined;

            if (beadId && title) {
              let worker: string | undefined;
              try {
                const parsed = JSON.parse(output);
                worker = parsed.worker;
              } catch {
                // No worker in output
              }

              state.subtasks.set(beadId, {
                title,
                status: "spawned",
                worker,
                files,
              });

              if (epicId && !state.epicId) {
                state.epicId = epicId;
              }
            }
            break;
          }

          case "swarm_complete": {
            const beadId = input.bead_id as string | undefined;
            if (beadId && state.subtasks.has(beadId)) {
              const existing = state.subtasks.get(beadId)!;
              state.subtasks.set(beadId, {
                ...existing,
                status: "completed",
              });
            }
            break;
          }

          case "swarm_status": {
            const epicId = input.epic_id as string | undefined;
            if (epicId && !state.epicId) {
              state.epicId = epicId;
            }
            const projectKey = input.project_key as string | undefined;
            if (projectKey && !state.projectPath) {
              state.projectPath = projectKey;
            }
            break;
          }
        }
      }
    }
  } catch (error) {
    getLog().debug(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "SDK message scanning failed",
    );
    // SDK not available or error fetching messages - return what we have
  }

  return state;
}

/**
 * Build dynamic swarm state from scanned messages (more precise than hive detection)
 */
function buildDynamicSwarmStateFromScanned(
  scanned: ScannedSwarmState,
  detected: SwarmState,
): string {
  const parts: string[] = [];

  // Prefer scanned data over detected
  const epicId = scanned.epicId || detected.epicId;
  const epicTitle = scanned.epicTitle || detected.epicTitle;
  const projectPath = scanned.projectPath || detected.projectPath;

  // Lead with epic context
  if (epicId && epicTitle) {
    parts.push(`You are coordinating epic **${epicId}** - ${epicTitle}`);
  } else if (epicId) {
    parts.push(`You are coordinating epic **${epicId}**`);
  }

  if (scanned.agentName) {
    parts.push(`Coordinator: ${scanned.agentName}`);
  }

  parts.push(`Project: ${projectPath}\n`);

  // IMMEDIATE ACTIONS section (must come FIRST for postCompactionDiscipline scoring)
  if (epicId) {
    parts.push(`## 1️⃣ IMMEDIATE ACTIONS (Do These FIRST)\n`);
    parts.push(
      `1. \`swarm_status(epic_id="${epicId}", project_key="${projectPath}")\` - Get current swarm state`,
    );
    parts.push(`2. \`swarmmail_inbox(limit=5)\` - Check for worker messages and blockers`);
    parts.push(
      `3. For completed work: Review with \`swarm_review\` → \`swarm_review_feedback\``,
    );
    parts.push(`4. For open subtasks: Spawn workers with \`swarm_spawn_subtask\``);
    parts.push(`5. For blocked work: Investigate, unblock, or reassign\n`);
  }

  // Swarm state summary
  parts.push(`## 🐝 Current Swarm State\n`);

  if (epicId) {
    parts.push(`**Epic:** ${epicId}${epicTitle ? ` - ${epicTitle}` : ""}`);
  }

  // Show detailed subtask info from scanned state
  if (scanned.subtasks.size > 0) {
    parts.push(`\n**Subtasks:**`);
    for (const [id, subtask] of scanned.subtasks) {
      const status = subtask.status === "completed" ? "✓" : `[${subtask.status}]`;
      const worker = subtask.worker ? ` → ${subtask.worker}` : "";
      const files = subtask.files?.length ? ` (${subtask.files.join(", ")})` : "";
      parts.push(`  - ${id}: ${subtask.title} ${status}${worker}${files}`);
    }
  } else if (detected.subtasks) {
    // Fall back to counts from hive detection
    const total =
      detected.subtasks.closed +
      detected.subtasks.in_progress +
      detected.subtasks.open +
      detected.subtasks.blocked;

    if (total > 0) {
      parts.push(`\n**Subtasks:**`);
      if (detected.subtasks.closed > 0)
        parts.push(`  - ${detected.subtasks.closed} closed`);
      if (detected.subtasks.in_progress > 0)
        parts.push(`  - ${detected.subtasks.in_progress} in_progress`);
      if (detected.subtasks.open > 0)
        parts.push(`  - ${detected.subtasks.open} open`);
      if (detected.subtasks.blocked > 0)
        parts.push(`  - ${detected.subtasks.blocked} blocked`);
    }
  }

  parts.push(`\n**Project:** ${projectPath}`);

  // Show last action if available
  if (scanned.lastAction) {
    parts.push(`**Last Action:** \`${scanned.lastAction.tool}\``);
  }

  return parts.join("\n");
}

// ============================================================================
// Swarm Detection
// ============================================================================

/**
 * Detection result with confidence level
 */
interface SwarmDetection {
  detected: boolean;
  confidence: "high" | "medium" | "low" | "none";
  reasons: string[];
  /** Specific swarm state data for context injection */
  state?: SwarmState;
}

/**
 * Specific swarm state captured during detection
 */
interface SwarmState {
  epicId?: string;
  epicTitle?: string;
  projectPath: string;
  subtasks: {
    closed: number;
    in_progress: number;
    open: number;
    blocked: number;
  };
}

/**
 * Check for swarm sign - evidence a swarm passed through
 * 
 * Uses multiple signals with different confidence levels:
 * - HIGH: Active reservations, in_progress cells
 * - MEDIUM: Open subtasks, unclosed epics, recent activity
 * - LOW: Any cells exist, swarm-mail initialized
 * 
 * Philosophy: Err on the side of continuation.
 */
async function detectSwarm(): Promise<SwarmDetection> {
  const reasons: string[] = [];
  let highConfidence = false;
  let mediumConfidence = false;
  let lowConfidence = false;
  let state: SwarmState | undefined;

  try {
    const projectKey = getHiveWorkingDirectory();
    
    // Initialize state with project path
    state = {
      projectPath: projectKey,
      subtasks: {
        closed: 0,
        in_progress: 0,
        open: 0,
        blocked: 0,
      },
    };

    // Check 1: Active reservations in swarm-mail (HIGH confidence)
    const swarmMailStart = Date.now();
    try {
      const health = await checkSwarmHealth(projectKey);
      const duration = Date.now() - swarmMailStart;

      getLog().debug(
        {
          source: "swarm-mail",
          duration_ms: duration,
          healthy: health.healthy,
          stats: health.stats,
        },
        "checked swarm-mail health",
      );

      if (health.healthy && health.stats) {
        if (health.stats.reservations > 0) {
          highConfidence = true;
          reasons.push(`${health.stats.reservations} active file reservations`);
        }
        if (health.stats.agents > 0) {
          mediumConfidence = true;
          reasons.push(`${health.stats.agents} registered agents`);
        }
        if (health.stats.messages > 0) {
          lowConfidence = true;
          reasons.push(`${health.stats.messages} swarm messages`);
        }
      }
    } catch (error) {
      getLog().debug(
        {
          source: "swarm-mail",
          duration_ms: Date.now() - swarmMailStart,
          error: error instanceof Error ? error.message : String(error),
        },
        "swarm-mail check failed",
      );
      // Swarm-mail not available, continue with other checks
    }

    // Check 2: Hive cells (various confidence levels)
    const hiveStart = Date.now();
    try {
      const adapter = await getHiveAdapter(projectKey);
      const cells = await adapter.queryCells(projectKey, {});
      const duration = Date.now() - hiveStart;

      if (Array.isArray(cells) && cells.length > 0) {
        // HIGH: Any in_progress cells
        const inProgress = cells.filter((c) => c.status === "in_progress");
        if (inProgress.length > 0) {
          highConfidence = true;
          reasons.push(`${inProgress.length} cells in_progress`);
        }

        // MEDIUM: Open subtasks (cells with parent_id)
        const subtasks = cells.filter(
          (c) => c.status === "open" && c.parent_id,
        );
        if (subtasks.length > 0) {
          mediumConfidence = true;
          reasons.push(`${subtasks.length} open subtasks`);
        }

        // MEDIUM: Unclosed epics
        const openEpics = cells.filter(
          (c) => c.type === "epic" && c.status !== "closed",
        );
        if (openEpics.length > 0) {
          mediumConfidence = true;
          reasons.push(`${openEpics.length} unclosed epics`);
          
          // Capture in_progress epic data for state
          const inProgressEpic = openEpics.find((c) => c.status === "in_progress");
          if (inProgressEpic && state) {
            state.epicId = inProgressEpic.id;
            state.epicTitle = inProgressEpic.title;
            
            // Count subtasks for this epic
            const epicSubtasks = cells.filter((c) => c.parent_id === inProgressEpic.id);
            state.subtasks.closed = epicSubtasks.filter((c) => c.status === "closed").length;
            state.subtasks.in_progress = epicSubtasks.filter((c) => c.status === "in_progress").length;
            state.subtasks.open = epicSubtasks.filter((c) => c.status === "open").length;
            state.subtasks.blocked = epicSubtasks.filter((c) => c.status === "blocked").length;
            
            getLog().debug(
              {
                epic_id: state.epicId,
                epic_title: state.epicTitle,
                subtasks_closed: state.subtasks.closed,
                subtasks_in_progress: state.subtasks.in_progress,
                subtasks_open: state.subtasks.open,
                subtasks_blocked: state.subtasks.blocked,
              },
              "captured epic state for context",
            );
          }
        }

        // MEDIUM: Recently updated cells (last hour)
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const recentCells = cells.filter((c) => c.updated_at > oneHourAgo);
        if (recentCells.length > 0) {
          mediumConfidence = true;
          reasons.push(`${recentCells.length} cells updated in last hour`);
        }

        // LOW: Any cells exist at all
        if (cells.length > 0) {
          lowConfidence = true;
          reasons.push(`${cells.length} total cells in hive`);
        }

        getLog().debug(
          {
            source: "hive",
            duration_ms: duration,
            total_cells: cells.length,
            in_progress: inProgress.length,
            open_subtasks: subtasks.length,
            open_epics: openEpics.length,
            recent_updates: recentCells.length,
          },
          "checked hive cells",
        );
      } else {
        getLog().debug(
          { source: "hive", duration_ms: duration, total_cells: 0 },
          "hive empty",
        );
      }
    } catch (error) {
      getLog().debug(
        {
          source: "hive",
          duration_ms: Date.now() - hiveStart,
          error: error instanceof Error ? error.message : String(error),
        },
        "hive check failed",
      );
      // Hive not available, continue
    }
  } catch (error) {
    // Project detection failed, use fallback
    lowConfidence = true;
    reasons.push("Could not detect project, using fallback");
    getLog().debug(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "project detection failed",
    );
  }

  // Determine overall confidence
  let confidence: "high" | "medium" | "low" | "none";
  if (highConfidence) {
    confidence = "high";
  } else if (mediumConfidence) {
    confidence = "medium";
  } else if (lowConfidence) {
    confidence = "low";
  } else {
    confidence = "none";
  }

  const result = {
    detected: confidence !== "none",
    confidence,
    reasons,
    state,
  };

  getLog().debug(
    {
      detected: result.detected,
      confidence: result.confidence,
      reason_count: result.reasons.length,
      reasons: result.reasons,
      has_state: !!result.state,
    },
    "swarm detection complete",
  );

  return result;
}

// ============================================================================
// Hook Registration
// ============================================================================

/**
 * Create the compaction hook for use in plugin registration
 *
 * Injects swarm context based on detection confidence:
 * - HIGH/MEDIUM: Full swarm context (definitely/probably a swarm)
 * - LOW: Fallback detection prompt (let compactor check context)
 * - NONE: No injection (probably not a swarm)
 *
 * Philosophy: Err on the side of continuation. A false positive costs
 * a bit of context space. A false negative loses the swarm.
 *
 * @param client - Optional OpenCode SDK client for scanning session messages.
 *                 When provided, extracts PRECISE swarm state from actual tool calls.
 *                 When undefined, falls back to hive/swarm-mail heuristic detection.
 *
 * @example
 * ```typescript
 * import { createCompactionHook } from "opencode-swarm-plugin";
 *
 * export const SwarmPlugin: Plugin = async (input) => ({
 *   tool: { ... },
 *   "experimental.session.compacting": createCompactionHook(input.client),
 * });
 * ```
 */
export function createCompactionHook(client?: OpencodeClient) {
  return async (
    input: { sessionID: string },
    output: { context: string[] },
  ): Promise<void> => {
    const startTime = Date.now();
    
    // Create metrics collector
    const metrics = createMetricsCollector({
      session_id: input.sessionID,
      has_sdk_client: !!client,
    });

    getLog().info(
      {
        session_id: input.sessionID,
        trigger: "session_compaction",
        has_sdk_client: !!client,
      },
      "compaction started",
    );
    
    recordPhaseStart(metrics, CompactionPhase.START);

    try {
      recordPhaseComplete(metrics, CompactionPhase.START);
      
      // Scan session messages for precise swarm state (if client available)
      recordPhaseStart(metrics, CompactionPhase.GATHER_SWARM_MAIL);
      const scannedState = await scanSessionMessages(client, input.sessionID);
      recordPhaseComplete(metrics, CompactionPhase.GATHER_SWARM_MAIL);
      
      // Also run heuristic detection from hive/swarm-mail
      recordPhaseStart(metrics, CompactionPhase.DETECT);
      const detection = await detectSwarm();

      // Boost confidence if we found swarm evidence in session messages
      let effectiveConfidence = detection.confidence;
      if (scannedState.epicId || scannedState.subtasks.size > 0) {
        // Session messages show swarm activity - this is HIGH confidence
        if (effectiveConfidence === "none" || effectiveConfidence === "low") {
          effectiveConfidence = "medium";
          detection.reasons.push("swarm tool calls found in session");
          recordPatternExtracted(metrics, "swarm_tool_calls", "Found swarm tool calls in session");
        }
        if (scannedState.subtasks.size > 0) {
          effectiveConfidence = "high";
          detection.reasons.push(`${scannedState.subtasks.size} subtasks spawned`);
          recordPatternExtracted(metrics, "subtasks", `${scannedState.subtasks.size} subtasks spawned`);
        }
      }
      
      recordPhaseComplete(metrics, CompactionPhase.DETECT, {
        confidence: effectiveConfidence,
        detected: detection.detected || scannedState.epicId !== undefined,
      });

      recordPhaseStart(metrics, CompactionPhase.INJECT);
      if (
        effectiveConfidence === "high" ||
        effectiveConfidence === "medium"
      ) {
        // Definite or probable swarm - inject full context
        const header = `[Swarm detected: ${detection.reasons.join(", ")}]\n\n`;

        // Build dynamic state section - prefer scanned state (ground truth) over detected
        let dynamicState = "";
        if (scannedState.epicId || scannedState.subtasks.size > 0) {
          // Use scanned state (more precise)
          dynamicState =
            buildDynamicSwarmStateFromScanned(
              scannedState,
              detection.state || {
                projectPath: scannedState.projectPath || process.cwd(),
                subtasks: { closed: 0, in_progress: 0, open: 0, blocked: 0 },
              },
            ) + "\n\n";
        } else if (detection.state && detection.state.epicId) {
          // Fall back to hive-detected state
          dynamicState = buildDynamicSwarmState(detection.state) + "\n\n";
        }

        const contextContent = header + dynamicState + SWARM_COMPACTION_CONTEXT;
        output.context.push(contextContent);
        
        recordPhaseComplete(metrics, CompactionPhase.INJECT, {
          context_length: contextContent.length,
          context_type: "full",
        });

        getLog().info(
          {
            confidence: effectiveConfidence,
            context_length: contextContent.length,
            context_type: "full",
            reasons: detection.reasons,
            has_dynamic_state: !!dynamicState,
            epic_id: scannedState.epicId || detection.state?.epicId,
            scanned_subtasks: scannedState.subtasks.size,
            scanned_agent: scannedState.agentName,
          },
          "injected swarm context",
        );
      } else if (effectiveConfidence === "low") {
        // Possible swarm - inject fallback detection prompt
        const header = `[Possible swarm: ${detection.reasons.join(", ")}]\n\n`;
        const contextContent = header + SWARM_DETECTION_FALLBACK;
        output.context.push(contextContent);
        
        recordPhaseComplete(metrics, CompactionPhase.INJECT, {
          context_length: contextContent.length,
          context_type: "fallback",
        });

        getLog().info(
          {
            confidence: effectiveConfidence,
            context_length: contextContent.length,
            context_type: "fallback",
            reasons: detection.reasons,
          },
          "injected swarm context",
        );
      } else {
        recordPhaseComplete(metrics, CompactionPhase.INJECT, {
          context_type: "none",
        });
        
        getLog().debug(
          {
            confidence: effectiveConfidence,
            context_type: "none",
          },
          "no swarm detected, skipping injection",
        );
      }
      // confidence === "none" - no injection, probably not a swarm

      recordPhaseStart(metrics, CompactionPhase.COMPLETE);
      const duration = Date.now() - startTime;
      const summary = getMetricsSummary(metrics);
      
      getLog().info(
        {
          duration_ms: duration,
          success: true,
          detected: detection.detected || scannedState.epicId !== undefined,
          confidence: effectiveConfidence,
          context_injected: output.context.length > 0,
          // Add metrics summary
          metrics: {
            phases: Object.keys(summary.phases).map(phase => ({
              name: phase,
              duration_ms: summary.phases[phase].duration_ms,
              success: summary.phases[phase].success,
            })),
            patterns_extracted: summary.patterns_extracted,
            patterns_skipped: summary.patterns_skipped,
            extraction_success_rate: summary.extraction_success_rate,
          },
        },
        "compaction complete",
      );
      
      recordPhaseComplete(metrics, CompactionPhase.COMPLETE);
    } catch (error) {
      const duration = Date.now() - startTime;
      
      recordPhaseComplete(metrics, CompactionPhase.COMPLETE, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      
      getLog().error(
        {
          duration_ms: duration,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        "compaction failed",
      );
      // Don't throw - compaction hook failures shouldn't break the session
    }
  };
}
