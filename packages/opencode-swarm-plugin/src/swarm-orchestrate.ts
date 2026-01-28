/**
 * Swarm Orchestrate Module - Status tracking and completion handling
 *
 * Handles swarm execution lifecycle:
 * - Initialization and tool availability
 * - Status tracking and progress reporting
 * - Completion verification and gates
 * - Error accumulation and 3-strike detection
 * - Learning from outcomes
 *
 * Key responsibilities:
 * - swarm_init - Check tools and discover skills
 * - swarm_status - Query epic progress
 * - swarm_progress - Report agent progress
 * - swarm_complete - Verification gate and completion
 * - swarm_record_outcome - Learning signals
 * - swarm_broadcast - Mid-task context sharing
 * - Error accumulation tools
 * - 3-strike detection for architectural problems
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { minimatch } from "minimatch";
import {
  type AgentProgress,
  AgentProgressSchema,
  type Bead,
  BeadSchema,
  type Evaluation,
  EvaluationSchema,
  type SpawnedAgent,
  type SwarmStatus,
  SwarmStatusSchema,
} from "./schemas";
import {
  type WorkerHandoff,
  WorkerHandoffSchema,
} from "./schemas/worker-handoff";
import {
  getSwarmInbox,
  releaseSwarmFiles,
  sendSwarmMessage,
  getAgent,
  createEvent,
  appendEvent,
  getSwarmMailLibSQL,
} from "swarm-mail";
import {
  addStrike,
  clearStrikes,
  DEFAULT_LEARNING_CONFIG,
  type DecompositionStrategy as LearningDecompositionStrategy,
  ErrorAccumulator,
  type ErrorType,
  type FeedbackEvent,
  formatMemoryStoreOn3Strike,
  formatMemoryStoreOnSuccess,
  getArchitecturePrompt,
  getStrikes,
  InMemoryStrikeStorage,
  isStrikedOut,
  type OutcomeSignals,
  OutcomeSignalsSchema,
  outcomeToFeedback,
  type ScoredOutcome,
  scoreImplicitFeedback,
  type StrikeStorage,
} from "./learning";
import {
  checkAllTools,
  formatToolAvailability,
  isToolAvailable,
  warnMissingTool,
} from "./tool-availability";
import { getHiveAdapter, hive_sync, setHiveWorkingDirectory, getHiveWorkingDirectory } from "./hive";
import { listSkills } from "./skills";
import {
  canUseWorktreeIsolation,
  getStartCommit,
} from "./swarm-worktree";
import {
  isReviewApproved,
  getReviewStatus,
} from "./swarm-review";
import { getGitCommitInfo } from "./utils/git-commit-info";
import { captureCoordinatorEvent, type EvalRecord } from "./eval-capture.js";
import { formatResearcherPrompt } from "./swarm-prompts";
import {
  runVerificationGate,
  type VerificationGateResult,
  type VerificationStep,
} from "./swarm-verify";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a WorkerHandoff object from subtask parameters
 *
 * Creates a machine-readable contract that replaces prose instructions in SUBTASK_PROMPT_V2.
 * Workers receive typed handoffs with explicit files, criteria, and escalation paths.
 *
 * @param params - Subtask parameters
 * @returns WorkerHandoff object validated against schema
 */
export function generateWorkerHandoff(params: {
  task_id: string;
  files_owned: string[];
  files_readonly?: string[];
  dependencies_completed?: string[];
  success_criteria?: string[];
  epic_summary: string;
  your_role: string;
  what_others_did?: string;
  what_comes_next?: string;
}): WorkerHandoff {
  const handoff: WorkerHandoff = {
    contract: {
      task_id: params.task_id,
      files_owned: params.files_owned,
      files_readonly: params.files_readonly || [],
      dependencies_completed: params.dependencies_completed || [],
      success_criteria: params.success_criteria || [
        "All files compile without errors",
        "Tests pass for modified code",
        "Code follows project patterns",
      ],
    },
    context: {
      epic_summary: params.epic_summary,
      your_role: params.your_role,
      what_others_did: params.what_others_did || "",
      what_comes_next: params.what_comes_next || "",
    },
    escalation: {
      blocked_contact: "coordinator",
      scope_change_protocol:
        "Send swarmmail_send(to=['coordinator'], subject='Scope change request: <task_id>', importance='high') and wait for approval before expanding beyond files_owned",
    },
  };

  // Validate against schema
  return WorkerHandoffSchema.parse(handoff);
}

/**
 * Validate that files_touched is a subset of files_owned (supports globs)
 *
 * Checks contract compliance - workers should only modify files they own.
 * Glob patterns in files_owned are matched against files_touched paths.
 *
 * @param files_touched - Actual files modified by the worker
 * @param files_owned - Files the worker is allowed to modify (may include globs)
 * @returns Validation result with violations list
 *
 * @example
 * ```typescript
 * // Exact match - passes
 * validateContract(["src/a.ts"], ["src/a.ts", "src/b.ts"])
 * // => { valid: true, violations: [] }
 *
 * // Glob match - passes
 * validateContract(["src/auth/service.ts"], ["src/auth/**"])
 * // => { valid: true, violations: [] }
 *
 * // Violation - fails
 * validateContract(["src/other.ts"], ["src/auth/**"])
 * // => { valid: false, violations: ["src/other.ts"] }
 * ```
 */
export function validateContract(
  files_touched: string[],
  files_owned: string[]
): { valid: boolean; violations: string[] } {
  // Empty files_touched is valid (read-only work)
  if (files_touched.length === 0) {
    return { valid: true, violations: [] };
  }

  const violations: string[] = [];

  for (const touchedFile of files_touched) {
    let matched = false;

    for (const ownedPattern of files_owned) {
      // Check if pattern is a glob or exact match
      if (ownedPattern.includes("*") || ownedPattern.includes("?")) {
        // Glob pattern - use minimatch
        if (minimatch(touchedFile, ownedPattern)) {
          matched = true;
          break;
        }
      } else {
        // Exact match
        if (touchedFile === ownedPattern) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      violations.push(touchedFile);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Get files_owned for a subtask from DecompositionGeneratedEvent
 *
 * Queries the event log for the decomposition that created this epic,
 * then extracts the files array for the matching subtask.
 *
 * @param projectKey - Project path
 * @param epicId - Epic ID
 * @param subtaskId - Subtask cell ID  
 * @returns Array of file patterns this subtask owns, or null if not found
 */
async function getSubtaskFilesOwned(
  projectKey: string,
  epicId: string,
  subtaskId: string
): Promise<string[] | null> {
  try {
    // Import readEvents from swarm-mail
    const { readEvents } = await import("swarm-mail");
    
    // Query for decomposition_generated events for this epic
    const events = await readEvents({
      projectKey,
      types: ["decomposition_generated"],
    }, projectKey);
    
    // Find the event for this epic
    const decompositionEvent = events.find((e: any) => 
      e.type === "decomposition_generated" && e.epic_id === epicId
    );
    
    if (!decompositionEvent) {
      console.warn(`[swarm_complete] No decomposition event found for epic ${epicId}`);
      return null;
    }
    
    // Extract subtask index from subtask ID (e.g., "bd-abc123.0" -> 0)
    // Subtask IDs follow pattern: epicId.index
    const subtaskMatch = subtaskId.match(/\.(\d+)$/);
    if (!subtaskMatch) {
      console.warn(`[swarm_complete] Could not parse subtask index from ${subtaskId}`);
      return null;
    }
    
    const subtaskIndex = parseInt(subtaskMatch[1], 10);
    const subtasks = (decompositionEvent as any).subtasks || [];
    
    if (subtaskIndex >= subtasks.length) {
      console.warn(`[swarm_complete] Subtask index ${subtaskIndex} out of range (${subtasks.length} subtasks)`);
      return null;
    }
    
    const subtask = subtasks[subtaskIndex];
    return subtask.files || [];
  } catch (error) {
    console.error(`[swarm_complete] Failed to query subtask files:`, error);
    return null;
  }
}

/**
 * Query beads for subtasks of an epic using HiveAdapter (not bd CLI)
 */
async function queryEpicSubtasks(projectKey: string, epicId: string): Promise<Bead[]> {
  try {
    const adapter = await getHiveAdapter(projectKey);
    const cells = await adapter.queryCells(projectKey, { parent_id: epicId });
    // Map Cell (from HiveAdapter) to Bead schema format
    // Cell uses `type` and numeric timestamps, Bead uses `issue_type` and ISO strings
    return cells
      .filter(cell => cell.status !== "tombstone") // Exclude deleted cells
      .map(cell => ({
        id: cell.id,
        title: cell.title,
        description: cell.description || "",
        status: cell.status as "open" | "in_progress" | "blocked" | "closed",
        priority: cell.priority,
        issue_type: cell.type as "bug" | "feature" | "task" | "epic" | "chore",
        created_at: new Date(cell.created_at).toISOString(),
        updated_at: cell.updated_at ? new Date(cell.updated_at).toISOString() : undefined,
        dependencies: [], // Dependencies fetched separately if needed
        metadata: {},
      }));
  } catch (error) {
    console.error(
      `[swarm] ERROR: Failed to query subtasks for epic ${epicId}:`,
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

/**
 * Query Agent Mail for swarm thread messages
 */
async function querySwarmMessages(
  projectKey: string,
  threadId: string,
): Promise<number> {
  // Check if agent-mail is available
  const agentMailAvailable = await isToolAvailable("agent-mail");
  if (!agentMailAvailable) {
    // Don't warn here - it's checked elsewhere
    return 0;
  }

  try {
    // Use embedded swarm-mail inbox to count messages in thread
    const inbox = await getSwarmInbox({
      projectPath: projectKey,
      agentName: "coordinator", // Dummy agent name for thread query
      limit: 5,
      includeBodies: false,
    });

    // Count messages that match the thread ID
    const threadMessages = inbox.messages.filter(
      (m) => m.thread_id === threadId,
    );
    return threadMessages.length;
  } catch (error) {
    // Thread might not exist yet, or query failed
    console.warn(
      `[swarm] Failed to query swarm messages for thread ${threadId}:`,
      error,
    );
    return 0;
  }
}

/**
 * Format a progress message for Agent Mail
 */
function formatProgressMessage(progress: AgentProgress): string {
  const lines = [
    `**Status**: ${progress.status}`,
    progress.progress_percent !== undefined
      ? `**Progress**: ${progress.progress_percent}%`
      : null,
    progress.message ? `**Message**: ${progress.message}` : null,
    progress.files_touched && progress.files_touched.length > 0
      ? `**Files touched**:\n${progress.files_touched.map((f) => `- \`${f}\``).join("\n")}`
      : null,
    progress.blockers && progress.blockers.length > 0
      ? `**Blockers**:\n${progress.blockers.map((b) => `- ${b}`).join("\n")}`
      : null,
  ];

  return lines.filter(Boolean).join("\n\n");
}

// ============================================================================
// Verification Gate - Delegated to swarm-verify.ts
// ============================================================================
// Verification logic moved to swarm-verify.ts to keep coordinator lean.
// Import runVerificationGate and types from there.

/**
 * Classify failure based on error message heuristics
 *
 * Simple pattern matching to categorize why a task failed.
 * Used when failure_mode is not explicitly provided.
 *
 * @param error - Error object or message
 * @returns FailureMode classification
 */
function classifyFailure(error: Error | string): string {
  const msg = (typeof error === "string" ? error : error.message).toLowerCase();

  if (msg.includes("timeout")) return "timeout";
  if (msg.includes("conflict") || msg.includes("reservation"))
    return "conflict";
  if (msg.includes("validation") || msg.includes("schema")) return "validation";
  if (msg.includes("context") || msg.includes("token"))
    return "context_overflow";
  if (msg.includes("blocked") || msg.includes("dependency"))
    return "dependency_blocked";
  if (msg.includes("cancel")) return "user_cancelled";

  // Check for tool failure patterns
  if (
    msg.includes("tool") ||
    msg.includes("command") ||
    msg.includes("failed to execute")
  ) {
    return "tool_failure";
  }

  return "unknown";
}

// ============================================================================
// Global Storage
// ============================================================================

/**
 * Global error accumulator for tracking errors across subtasks
 *
 * This is a session-level singleton that accumulates errors during
 * swarm execution for feeding into retry prompts.
 */
const globalErrorAccumulator = new ErrorAccumulator();

/**
 * Global strike storage for tracking consecutive fix failures
 */
const globalStrikeStorage: StrikeStorage = new InMemoryStrikeStorage();

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Initialize swarm and check tool availability
 *
 * Call this at the start of a swarm session to see what tools are available,
 * what skills exist in the project, and what features will be degraded.
 *
 * Skills are automatically discovered from:
 * - .opencode/skills/
 * - .claude/skills/
 * - skills/
 */
export const swarm_init = tool({
  description:
    "Initialize swarm session: discovers available skills, checks tool availability. ALWAYS call at swarm start.",
  args: {
    project_path: tool.schema
      .string()
      .optional()
      .describe("Project path (for Agent Mail init)"),
    isolation: tool.schema
      .enum(["worktree", "reservation"])
      .optional()
      .default("reservation")
      .describe(
        "Isolation mode: 'worktree' for git worktree isolation (requires clean git state), 'reservation' for file reservations (default)",
      ),
  },
  async execute(args) {
    // Check all tools
    const availability = await checkAllTools();

    // Build status report
    const report = formatToolAvailability(availability);

    // Check critical tools
    const beadsAvailable = availability.get("beads")?.status.available ?? false;
    const agentMailAvailable =
      availability.get("agent-mail")?.status.available ?? false;

    // Build warnings
    const warnings: string[] = [];
    const degradedFeatures: string[] = [];

    if (!beadsAvailable) {
      warnings.push(
        "⚠️  beads (bd) not available - issue tracking disabled, swarm coordination will be limited",
      );
      degradedFeatures.push("issue tracking", "progress persistence");
    }

    if (!agentMailAvailable) {
      warnings.push(
        "⚠️  agent-mail not available - multi-agent communication disabled",
      );
      degradedFeatures.push("agent communication", "file reservations");
    }

    if (!availability.get("cass")?.status.available) {
      degradedFeatures.push("historical context from past sessions");
    }

    if (!availability.get("hivemind")?.status.available) {
      degradedFeatures.push("persistent learning (using in-memory fallback)");
    }

    // Discover available skills
    const availableSkills = await listSkills();
    const skillsInfo = {
      count: availableSkills.length,
      available: availableSkills.length > 0,
      skills: availableSkills.map((s) => ({
        name: s.name,
        description: s.description,
        hasScripts: s.hasScripts,
      })),
    };

    // Add skills guidance if available
    let skillsGuidance: string | undefined;
    if (availableSkills.length > 0) {
      skillsGuidance = `Found ${availableSkills.length} skill(s). Use skills_list to see details, skills_use to activate.`;
    } else {
      skillsGuidance =
        "No skills found. Add skills to .opencode/skills/ or .claude/skills/ for specialized guidance.";
    }

    // Check isolation mode
    const isolationMode = args.isolation ?? "reservation";
    let isolationInfo: {
      mode: "worktree" | "reservation";
      available: boolean;
      start_commit?: string;
      reason?: string;
    } = {
      mode: isolationMode,
      available: true,
    };

    if (isolationMode === "worktree" && args.project_path) {
      const worktreeCheck = await canUseWorktreeIsolation(args.project_path);
      if (worktreeCheck.canUse) {
        const startCommit = await getStartCommit(args.project_path);
        isolationInfo = {
          mode: "worktree",
          available: true,
          start_commit: startCommit ?? undefined,
        };
      } else {
        // Fall back to reservation mode
        isolationInfo = {
          mode: "reservation",
          available: false,
          reason: `Worktree mode unavailable: ${worktreeCheck.reason}. Falling back to reservation mode.`,
        };
        warnings.push(
          `⚠️  Worktree isolation unavailable: ${worktreeCheck.reason}. Using file reservations instead.`,
        );
      }
    } else if (isolationMode === "worktree" && !args.project_path) {
      isolationInfo = {
        mode: "reservation",
        available: false,
        reason: "Worktree mode requires project_path. Falling back to reservation mode.",
      };
      warnings.push(
        "⚠️  Worktree isolation requires project_path. Using file reservations instead.",
      );
    }

    return JSON.stringify(
      {
        ready: true,
        isolation: isolationInfo,
        tool_availability: Object.fromEntries(
          Array.from(availability.entries()).map(([k, v]) => [
            k,
            {
              available: v.status.available,
              fallback: v.status.available ? null : v.fallbackBehavior,
            },
          ]),
        ),
        skills: skillsInfo,
        warnings: warnings.length > 0 ? warnings : undefined,
        degraded_features:
          degradedFeatures.length > 0 ? degradedFeatures : undefined,
        recommendations: {
          skills: skillsGuidance,
          beads: beadsAvailable
            ? "✓ Use beads for all task tracking"
            : "Install beads: npm i -g @joelhooks/beads",
          agent_mail: agentMailAvailable
            ? "✓ Use Agent Mail for coordination"
            : "Start Agent Mail: agent-mail serve",
          isolation:
            isolationInfo.mode === "worktree"
              ? "✓ Using git worktree isolation"
              : "✓ Using file reservation isolation",
        },
        report,
      },
      null,
      2,
    );
  },
});

/**
 * Get status of a swarm by epic ID
 *
 * Requires project_key to query Agent Mail for message counts.
 */
export const swarm_status = tool({
  description: "Get status of a swarm by epic ID",
  args: {
    epic_id: tool.schema.string().describe("Epic bead ID (e.g., bd-abc123)"),
    project_key: tool.schema
      .string()
      .describe("Project path (for Agent Mail queries)"),
  },
  async execute(args) {
    // Query subtasks from beads
    const subtasks = await queryEpicSubtasks(args.project_key, args.epic_id);

    // Count statuses
    const statusCounts = {
      running: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
    };

    const agents: SpawnedAgent[] = [];

    for (const bead of subtasks) {
      // Map cell status to agent status
      let agentStatus: SpawnedAgent["status"] = "pending";
      switch (bead.status) {
        case "in_progress":
          agentStatus = "running";
          statusCounts.running++;
          break;
        case "closed":
          agentStatus = "completed";
          statusCounts.completed++;
          break;
        case "blocked":
          agentStatus = "pending"; // Blocked treated as pending for swarm
          statusCounts.blocked++;
          break;
        default:
          // open = pending
          break;
      }

      agents.push({
        bead_id: bead.id,
        agent_name: "", // We don't track this in beads
        status: agentStatus,
        files: [], // Would need to parse from description
      });
    }

    // Query Agent Mail for message activity
    const messageCount = await querySwarmMessages(
      args.project_key,
      args.epic_id,
    );

    const status: SwarmStatus = {
      epic_id: args.epic_id,
      total_agents: subtasks.length,
      running: statusCounts.running,
      completed: statusCounts.completed,
      failed: statusCounts.failed,
      blocked: statusCounts.blocked,
      agents,
      last_update: new Date().toISOString(),
    };

    // Validate and return
    const validated = SwarmStatusSchema.parse(status);

    return JSON.stringify(
      {
        ...validated,
        message_count: messageCount,
        progress_percent:
          subtasks.length > 0
            ? Math.round((statusCounts.completed / subtasks.length) * 100)
            : 0,
      },
      null,
      2,
    );
  },
});

/**
 * Report progress on a subtask
 *
 * Takes explicit agent identity since tools don't have persistent state.
 */
export const swarm_progress = tool({
  description: "Report progress on a subtask to coordinator. REQUIRED: project_key, agent_name, bead_id, status. Call periodically (every 25% or when blocked) to keep coordinator informed. Use status='blocked' with message explaining the blocker if you're stuck.",
  args: {
    project_key: tool.schema.string().describe("Project path (e.g., '/Users/name/project')"),
    agent_name: tool.schema.string().describe("Your agent name from swarmmail_init"),
    bead_id: tool.schema.string().describe("Task ID from your spawn prompt or hive cell"),
    status: tool.schema
      .enum(["in_progress", "blocked", "completed", "failed"])
      .describe("Current status"),
    message: tool.schema
      .string()
      .optional()
      .describe("Progress message or blockers"),
    progress_percent: tool.schema
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Completion percentage"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files modified so far"),
  },
  async execute(args) {
    // Validate required parameters with helpful error messages
    const missing: string[] = [];
    if (!args.bead_id) missing.push("bead_id");
    if (!args.project_key) missing.push("project_key");
    if (!args.agent_name) missing.push("agent_name");
    if (!args.status) missing.push("status");

    if (missing.length > 0) {
      return JSON.stringify({
        success: false,
        error: `Missing required parameters: ${missing.join(", ")}`,
        hint: "swarm_progress reports task progress to the coordinator.",
        example: {
          project_key: "/path/to/project",
          agent_name: "your-agent-name",
          bead_id: "your-task-id from spawn",
          status: "in_progress",
          progress_percent: 50,
          message: "Completed X, working on Y",
        },
      }, null, 2);
    }

    // Build progress report
    const progress: AgentProgress = {
      bead_id: args.bead_id,
      agent_name: args.agent_name,
      status: args.status,
      progress_percent: args.progress_percent,
      message: args.message,
      files_touched: args.files_touched,
      timestamp: new Date().toISOString(),
    };

    // Validate
    const validated = AgentProgressSchema.parse(progress);

    // Update cell status if needed (using HiveAdapter, not bd CLI)
    if (args.status === "blocked" || args.status === "in_progress") {
      try {
        const adapter = await getHiveAdapter(args.project_key);
        const newStatus = args.status === "blocked" ? "blocked" : "in_progress";
        await adapter.changeCellStatus(args.project_key, args.bead_id, newStatus);
      } catch (error) {
        // Non-fatal - log but continue
        console.error(`[swarm] Failed to update cell status: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Extract epic ID from bead ID (e.g., bd-abc123.1 -> bd-abc123)
    const epicId = args.bead_id.includes(".")
      ? args.bead_id.split(".")[0]
      : args.bead_id;

    // Send progress message to thread using embedded swarm-mail
    await sendSwarmMessage({
      projectPath: args.project_key,
      fromAgent: args.agent_name,
      toAgents: [], // Coordinator will pick it up from thread
      subject: `Progress: ${args.bead_id} - ${args.status}`,
      body: formatProgressMessage(validated),
      threadId: epicId,
      importance: args.status === "blocked" ? "high" : "normal",
    });

    // Auto-checkpoint at milestone progress (25%, 50%, 75%)
    let checkpointCreated = false;
    if (
      args.progress_percent !== undefined &&
      args.files_touched &&
      args.files_touched.length > 0
    ) {
      const milestones = [25, 50, 75];
      if (milestones.includes(args.progress_percent)) {
        try {
          // Create checkpoint event directly (non-fatal if it fails)
          const checkpoint = {
            epic_id: epicId,
            bead_id: args.bead_id,
            strategy: "file-based" as const,
            files: args.files_touched,
            dependencies: [] as string[],
            directives: {},
            recovery: {
              last_checkpoint: Date.now(),
              files_modified: args.files_touched,
              progress_percent: args.progress_percent,
              last_message: args.message,
            },
          };

          // Emit swarm_checkpointed event
          const checkpointData = JSON.stringify(checkpoint);
          const checkpointEvent = createEvent("swarm_checkpointed", {
            project_key: args.project_key,
            ...checkpoint,
            checkpoint_size_bytes: Buffer.byteLength(checkpointData, "utf8"),
            trigger: "progress",
          });
          await appendEvent(checkpointEvent, args.project_key);

          // Emit checkpoint_created event for observability
          const checkpointId = `ckpt-${Date.now()}-${args.bead_id}`;
          const createdEvent = createEvent("checkpoint_created", {
            project_key: args.project_key,
            epic_id: epicId,
            bead_id: args.bead_id,
            agent_name: args.agent_name,
            checkpoint_id: checkpointId,
            trigger: "progress",
            progress_percent: args.progress_percent,
            files_snapshot: args.files_touched,
          });
          await appendEvent(createdEvent, args.project_key);

          // NOTE: The event handler (handleSwarmCheckpointed in store.ts) updates
          // the swarm_contexts table. We follow event sourcing pattern here.
          checkpointCreated = true;
        } catch (error) {
          // Non-fatal - log and continue
          console.warn(
            `[swarm_progress] Auto-checkpoint failed at ${args.progress_percent}%:`,
            error,
          );
        }
      }
    }

    return `Progress reported: ${args.status}${args.progress_percent !== undefined ? ` (${args.progress_percent}%)` : ""}${checkpointCreated ? " [checkpoint created]" : ""}`;
  },
});

/**
 * Broadcast context updates to all agents in the epic
 *
 * Enables mid-task coordination by sharing discoveries, warnings, or blockers
 * with all agents working on the same epic. Agents can broadcast without
 * waiting for task completion.
 *
 * Based on "Patterns for Building AI Agents" p.31: "Ensure subagents can share context along the way"
 */
export const swarm_broadcast = tool({
  description:
    "Broadcast context update to all agents working on the same epic",
  args: {
    project_path: tool.schema
      .string()
      .describe("Absolute path to project root"),
    agent_name: tool.schema
      .string()
      .describe("Name of the agent broadcasting the message"),
    epic_id: tool.schema.string().describe("Epic ID (e.g., bd-abc123)"),
    message: tool.schema
      .string()
      .describe("Context update to share (what changed, what was learned)"),
    importance: tool.schema
      .enum(["info", "warning", "blocker"])
      .default("info")
      .describe("Priority level (default: info)"),
    files_affected: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files this context relates to"),
  },
  async execute(args) {
    // Extract bead_id from context if available (for traceability)
    const beadId = "unknown"; // Context not currently available in tool execution

    // Format the broadcast message
    const body = [
      `## Context Update`,
      "",
      `**From**: ${args.agent_name} (${beadId})`,
      `**Priority**: ${args.importance.toUpperCase()}`,
      "",
      args.message,
      "",
      args.files_affected && args.files_affected.length > 0
        ? `**Files affected**:\n${args.files_affected.map((f) => `- \`${f}\``).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Map importance to Agent Mail importance
    const mailImportance =
      args.importance === "blocker"
        ? "urgent"
        : args.importance === "warning"
          ? "high"
          : "normal";

    // Send as broadcast to thread using embedded swarm-mail
    await sendSwarmMessage({
      projectPath: args.project_path,
      fromAgent: args.agent_name,
      toAgents: [], // Broadcast to thread
      subject: `[${args.importance.toUpperCase()}] Context update from ${args.agent_name}`,
      body,
      threadId: args.epic_id,
      importance: mailImportance,
      ackRequired: args.importance === "blocker",
    });

    return JSON.stringify(
      {
        broadcast: true,
        epic_id: args.epic_id,
        from: args.agent_name,
        bead_id: beadId,
        importance: args.importance,
        recipients: "all agents in epic",
        ack_required: args.importance === "blocker",
      },
      null,
      2,
    );
  },
});

/**
 * Mark a subtask as complete
 *
 * Implements the Verification Gate (from superpowers):
 * 1. IDENTIFY: What commands prove this claim?
 * 2. RUN: Execute verification (typecheck, tests)
 * 3. READ: Check exit codes and output
 * 4. VERIFY: All checks must pass
 * 5. ONLY THEN: Close the cell
 *
 * Closes cell, releases reservations, notifies coordinator, and resolves
 * a DurableDeferred keyed by bead_id for cross-agent task completion signaling.
 *
 * ## DurableDeferred Integration
 *
 * When a coordinator spawns workers, it can create a deferred BEFORE spawning:
 *
 * ```typescript
 * const swarmMail = await getSwarmMailLibSQL(projectPath);
 * const db = await swarmMail.getDatabase();
 *
 * // Create deferred keyed by bead_id
 * const deferredUrl = `deferred:${beadId}`;
 * await db.query(
 *   `INSERT INTO deferred (url, resolved, expires_at, created_at) VALUES (?, 0, ?, ?)`,
 *   [deferredUrl, Date.now() + 3600000, Date.now()]
 * );
 *
 * // Spawn worker (swarm_spawn_subtask...)
 *
 * // Await completion
 * const result = await db.query<{ value: string }>(
 *   `SELECT value FROM deferred WHERE url = ? AND resolved = 1`,
 *   [deferredUrl]
 * );
 * ```
 *
 * When the worker calls swarm_complete, it resolves the deferred automatically.
 * Coordinator can await without polling.
 */
export const swarm_complete = tool({
  description:
    "Mark subtask complete with Verification Gate. REQUIRED: project_key, agent_name, bead_id (from your task assignment), summary, start_time (Date.now() from when you started). Before calling: 1) hivemind_store your learnings, 2) list files_touched for verification. Runs typecheck/tests before finalizing.",
  args: {
    project_key: tool.schema.string().describe("Project path (e.g., '/Users/name/project')"),
    agent_name: tool.schema.string().describe("Your agent name from swarmmail_init"),
    bead_id: tool.schema.string().describe("Task ID from your spawn prompt or hive cell"),
    summary: tool.schema.string().describe("What you accomplished (1-3 sentences)"),
    evaluation: tool.schema
      .string()
      .optional()
      .describe("Self-evaluation JSON (Evaluation schema)"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files modified - will be verified (typecheck, tests)"),
    skip_verification: tool.schema
      .boolean()
      .optional()
      .describe(
        "Skip ALL verification (typecheck, tests). Use sparingly! (default: false)",
      ),
    planned_files: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files that were originally planned to be modified"),
    start_time: tool.schema
      .number()
      .describe("Task start timestamp (Unix ms) for duration calculation - REQUIRED for accurate analytics"),
    error_count: tool.schema
      .number()
      .optional()
      .describe("Number of errors encountered during task"),
    retry_count: tool.schema
      .number()
      .optional()
      .describe("Number of retry attempts during task"),
    skip_review: tool.schema
      .boolean()
      .optional()
      .describe(
        "Skip review gate check (default: false). Use only for tasks that don't require coordinator review.",
      ),
    commit_sha: tool.schema
      .string()
      .optional()
      .describe("Git commit SHA (auto-detected if not provided)"),
    commit_message: tool.schema
      .string()
      .optional()
      .describe("Commit message (auto-detected if not provided)"),
    commit_branch: tool.schema
      .string()
      .optional()
      .describe("Git branch (auto-detected if not provided)"),
  },
  async execute(args, _ctx) {
    // Validate required parameters with helpful error messages
    const missing: string[] = [];
    if (!args.bead_id) missing.push("bead_id");
    if (!args.project_key) missing.push("project_key");
    if (!args.agent_name) missing.push("agent_name");
    if (!args.summary) missing.push("summary");
    if (args.start_time === undefined) missing.push("start_time");

    if (missing.length > 0) {
      return JSON.stringify({
        success: false,
        error: `Missing required parameters: ${missing.join(", ")}`,
        hint: "swarm_complete marks a subtask as done. All parameters are required.",
        example: {
          project_key: "/path/to/project",
          agent_name: "your-agent-name",
          bead_id: "epic-id.subtask-num OR cell-id from hive",
          summary: "Brief description of what you completed",
          start_time: Date.now(),
          files_touched: ["src/file1.ts", "src/file2.ts"],
        },
        tip: "The bead_id comes from swarm_spawn_subtask or hive_create. Check your task assignment for the correct ID.",
      }, null, 2);
    }

    // Extract epic ID early for error notifications and review gate
    const epicId = args.bead_id.includes(".")
      ? args.bead_id.split(".")[0]
      : args.bead_id;

    // Check review gate (unless skipped) - BEFORE try block so errors are clear
    if (!args.skip_review) {
      const reviewStatusResult = getReviewStatus(args.bead_id);

      if (!reviewStatusResult.approved) {
        // Check if review was even attempted
        if (!reviewStatusResult.reviewed) {
          return JSON.stringify(
            {
              success: true,
              status: "pending_review",
              review_status: reviewStatusResult,
              message: "Task completed but awaiting coordinator review before finalization.",
              next_steps: [
                `Request review with swarm_review(project_key="${args.project_key}", epic_id="${epicId}", task_id="${args.bead_id}", files_touched=[...])`,
                "Wait for coordinator to review and approve with swarm_review_feedback",
                "Once approved, call swarm_complete again to finalize",
                "Or use skip_review=true to bypass (not recommended for production work)",
              ],
            },
            null,
            2,
          );
        }

        // Review was attempted but not approved
        return JSON.stringify(
          {
            success: true,
            status: "needs_changes",
            review_status: reviewStatusResult,
            message: `Task reviewed but changes requested. ${reviewStatusResult.remaining_attempts} attempt(s) remaining.`,
            next_steps: [
              "Address the feedback from the reviewer",
              `Request another review with swarm_review(project_key="${args.project_key}", epic_id="${epicId}", task_id="${args.bead_id}", files_touched=[...])`,
              "Once approved, call swarm_complete again to finalize",
            ],
          },
          null,
          2,
        );
      }
    }

    // Auto-detect git commit info (non-blocking, best-effort)
    const gitInfo = getGitCommitInfo(args.project_key) || {} as Partial<import("./utils/git-commit-info").GitCommitInfo>;
    const commitSha = args.commit_sha || gitInfo.sha;
    const commitMessage = args.commit_message || gitInfo.message;
    const commitBranch = args.commit_branch || gitInfo.branch;

    // Build result text with optional commit info
    const resultText = commitSha
      ? `${args.summary}\n\nCommit: ${commitSha.slice(0, 8)} (${commitBranch || "unknown"}) - ${commitMessage || "no message"}`
      : args.summary;

    try {
      // Validate bead_id exists and is not already closed (EARLY validation)
      // NOTE: Use args.project_key directly - cells are stored with the original path
      // (e.g., "/Users/joel/Code/project"), not a mangled version.

      // Use HiveAdapter for validation (not bd CLI)
      const adapter = await getHiveAdapter(args.project_key);

      // 1. Check if bead exists
      const cell = await adapter.getCell(args.project_key, args.bead_id);
      if (!cell) {
        return JSON.stringify({
          success: false,
          error: `Bead not found: ${args.bead_id}`,
          hint: "Check the bead ID is correct. Use hive_query to list open cells.",
        });
      }

      // 2. Check if bead is already closed
      if (cell.status === "closed") {
        return JSON.stringify({
          success: false,
          error: `Bead already closed: ${args.bead_id}`,
          hint: "This bead was already completed. No action needed.",
        });
      }

      // Verify agent is registered in swarm-mail
      // This catches agents who skipped swarmmail_init
      let agentRegistered = false;
      let registrationWarning = "";

      try {
        const agent = await getAgent(
          args.project_key,
          args.agent_name,
          args.project_key,
        );
        agentRegistered = agent !== null;

        if (!agentRegistered) {
          registrationWarning = `⚠️  WARNING: Agent '${args.agent_name}' was NOT registered in swarm-mail for project '${args.project_key}'.

This usually means you skipped the MANDATORY swarmmail_init step.

**Impact:**
- Your work was not tracked in the coordination system
- File reservations may not have been managed
- Other agents couldn't coordinate with you
- Learning/eval data may be incomplete

**Next time:** Run swarmmail_init(project_path="${args.project_key}", task_description="<task>") FIRST, before any other work.

Continuing with completion, but this should be fixed for future subtasks.`;

          console.warn(`[swarm_complete] ${registrationWarning}`);
        }
      } catch (error) {
        // Non-fatal - agent might be using legacy workflow
        console.warn(
          `[swarm_complete] Could not verify agent registration:`,
          error,
        );
        registrationWarning = `ℹ️  Could not verify swarm-mail registration (database may not be available). Consider running swarmmail_init next time.`;
      }

      // Run Verification Gate unless explicitly skipped
      let verificationResult: VerificationGateResult | null = null;

      if (!args.skip_verification && args.files_touched?.length) {
        verificationResult = await runVerificationGate(
          args.files_touched,
          false,
        );

        // Block completion if verification failed
        if (!verificationResult.passed) {
          return JSON.stringify(
            {
              success: false,
              error: "Verification Gate FAILED - fix issues before completing",
              verification: {
                passed: false,
                summary: verificationResult.summary,
                blockers: verificationResult.blockers,
                steps: verificationResult.steps.map((s) => ({
                  name: s.name,
                  passed: s.passed,
                  skipped: s.skipped,
                  skipReason: s.skipReason,
                  error: s.error?.slice(0, 200),
                })),
              },
              hint:
                verificationResult.blockers.length > 0
                  ? `Fix these issues: ${verificationResult.blockers.map((b, i) => `${i + 1}. ${b}`).join(", ")}. Use skip_verification=true only as last resort.`
                  : "Fix the failing checks and try again. Use skip_verification=true only as last resort.",
              gate_function:
                "IDENTIFY → RUN → READ → VERIFY → CLAIM (you are at VERIFY, claim blocked)",
            },
            null,
            2,
          );
        }
      }

      // Contract Validation - check files_touched against WorkerHandoff contract
      let contractValidation: { valid: boolean; violations: string[] } | null = null;
      let contractWarning: string | undefined;

      if (args.files_touched && args.files_touched.length > 0) {
        // Extract epic ID from subtask ID
        const isSubtask = args.bead_id.includes(".");
        
        if (isSubtask) {
          const epicId = args.bead_id.split(".")[0];
          
          // Query decomposition event for files_owned
          const filesOwned = await getSubtaskFilesOwned(
            args.project_key,
            epicId,
            args.bead_id
          );
          
          if (filesOwned) {
            contractValidation = validateContract(args.files_touched, filesOwned);
            
            if (!contractValidation.valid) {
              // Contract violation - log warning (don't block completion)
              contractWarning = `⚠️  CONTRACT VIOLATION: Modified files outside owned scope
              
**Files owned**: ${filesOwned.join(", ")}
**Files touched**: ${args.files_touched.join(", ")}
**Violations**: ${contractValidation.violations.join(", ")}

This indicates scope creep - the worker modified files they weren't assigned.
This will be recorded as a negative learning signal.`;

              console.warn(`[swarm_complete] ${contractWarning}`);
            } else {
              console.log(`[swarm_complete] Contract validation passed: all ${args.files_touched.length} files within owned scope`);
            }
          } else {
            console.warn(`[swarm_complete] Could not retrieve files_owned for contract validation - skipping`);
          }
        }
      }

      // Parse and validate evaluation if provided
      let parsedEvaluation: Evaluation | undefined;
      if (args.evaluation) {
        try {
          parsedEvaluation = EvaluationSchema.parse(
            JSON.parse(args.evaluation),
          );
        } catch (error) {
          return JSON.stringify(
            {
              success: false,
              error: "Invalid evaluation format",
              details:
                error instanceof z.ZodError ? error.issues : String(error),
            },
            null,
            2,
          );
        }

        // If evaluation failed, don't complete
        if (!parsedEvaluation.passed) {
          return JSON.stringify(
            {
              success: false,
              error: "Self-evaluation failed",
              retry_suggestion: parsedEvaluation.retry_suggestion,
              feedback: parsedEvaluation.overall_feedback,
            },
            null,
            2,
          );
        }
      }

      // Close the cell using HiveAdapter (not bd CLI)
      // Pass resultText (summary + commit info) as both reason and result
      try {
        await adapter.closeCell(args.project_key, args.bead_id, args.summary, {
          result: resultText,
        });
      } catch (closeError) {
        const errorMessage = closeError instanceof Error ? closeError.message : String(closeError);
        return JSON.stringify(
          {
            success: false,
            error: "Failed to close cell",
            failed_step: "closeCell",
            details: errorMessage,
            bead_id: args.bead_id,
            project_key: args.project_key,
            recovery: {
              steps: [
                `1. Check cell exists: hive_query()`,
                `2. Check cell status (might already be closed)`,
                `3. If cell is blocked, unblock first: hive_update(id="${args.bead_id}", status="in_progress")`,
                `4. Try closing directly: hive_close(id="${args.bead_id}", reason="...")`,
              ],
              hint: "Cell may already be closed, or the ID is incorrect.",
            },
          },
          null,
          2,
        );
      }

      // Resolve DurableDeferred for cross-agent task completion signaling
      // This allows coordinator to await worker completion without polling
      let deferredResolved = false;
      let deferredError: string | undefined;
      try {
        const swarmMail = await getSwarmMailLibSQL(args.project_key);
        const db = await swarmMail.getDatabase();
        
        // Resolve deferred keyed by bead_id
        // Coordinator should have created this deferred before spawning worker
        const deferredUrl = `deferred:${args.bead_id}`;
        
        // Check if deferred exists before resolving
        const checkResult = await db.query<{ url: string; resolved: number }>(
          `SELECT url, resolved FROM deferred WHERE url = ? AND resolved = 0`,
          [deferredUrl],
        );
        
        if (checkResult.rows.length > 0) {
          // Resolve with completion payload
          await db.query(
            `UPDATE deferred SET resolved = 1, value = ? WHERE url = ? AND resolved = 0`,
            [JSON.stringify({ completed: true, summary: args.summary }), deferredUrl],
          );
          
          deferredResolved = true;
        } else {
          // Deferred doesn't exist - worker was likely not spawned via swarm pattern
          // This is non-fatal - just log for debugging
          console.info(
            `[swarm_complete] No deferred found for ${args.bead_id} - task may not be part of active swarm`,
          );
        }
      } catch (error) {
        // Non-fatal - deferred resolution is optional for backward compatibility
        deferredError = error instanceof Error ? error.message : String(error);
        console.warn(
          `[swarm_complete] Failed to resolve deferred (non-fatal): ${deferredError}`,
        );
      }

      // Sync cell to .hive/issues.jsonl (auto-sync on complete)
      // This ensures the worker's completed work persists before process exits
      let syncSuccess = false;
      let syncError: string | undefined;
      try {
        // Save current working directory and set to project path
        const previousWorkingDir = getHiveWorkingDirectory();
        setHiveWorkingDirectory(args.project_key);
        
        try {
          const syncResult = await hive_sync.execute({ auto_pull: false }, _ctx);
          syncSuccess = !syncResult.includes("error");
        } finally {
          // Restore previous working directory
          setHiveWorkingDirectory(previousWorkingDir);
        }
      } catch (error) {
        // Non-fatal - log warning but don't block completion
        syncError = error instanceof Error ? error.message : String(error);
        console.warn(
          `[swarm_complete] Auto-sync failed (non-fatal): ${syncError}`,
        );
      }

      // Emit SubtaskOutcomeEvent for learning system
      // start_time is now required, so we can calculate duration directly
      const completionDurationMs = Date.now() - args.start_time;
      
      // Determine epic ID: use parent_id if available, otherwise fall back to extracting from bead_id
      // (New hive cell IDs don't follow epicId.subtaskNum pattern - they're independent IDs)
      const eventEpicId = cell.parent_id || (args.bead_id.includes(".")
        ? args.bead_id.split(".")[0]
        : args.bead_id);

      let outcomeEventId: number | undefined;
      try {
        const event = createEvent("subtask_outcome", {
          project_key: args.project_key,
          epic_id: eventEpicId,
          bead_id: args.bead_id,
          planned_files: args.planned_files || [],
          actual_files: args.files_touched || [],
          duration_ms: completionDurationMs,
          error_count: args.error_count || 0,
          retry_count: args.retry_count || 0,
          success: true,
          scope_violation: contractValidation ? !contractValidation.valid : undefined,
          violation_files: contractValidation?.violations,
          commit: commitSha ? { sha: commitSha, message: commitMessage, branch: commitBranch } : undefined,
        });
        const savedEvent = await appendEvent(event, args.project_key);
        outcomeEventId = savedEvent.id;
      } catch (error) {
        // Non-fatal - log and continue
        console.warn(
          "[swarm_complete] Failed to emit SubtaskOutcomeEvent:",
          error,
        );
      }

      // Link outcome to decision trace for quality scoring
      if (outcomeEventId) {
        try {
          const { linkOutcomeToDecisionTrace } = await import("./decision-trace-integration.js");
          await linkOutcomeToDecisionTrace({
            projectKey: args.project_key,
            beadId: args.bead_id,
            outcomeEventId,
          });
        } catch (error) {
          // Non-fatal - log and continue
          console.warn(
            "[swarm_complete] Failed to link outcome to decision trace:",
            error,
          );
        }
      }

      // Emit worker_completed event for dashboard observability
      try {
        const workerCompletedEvent = createEvent("worker_completed", {
          project_key: args.project_key,
          epic_id: eventEpicId,
          bead_id: args.bead_id,
          worker_agent: args.agent_name,
          success: true,
          duration_ms: completionDurationMs,
          files_touched: args.files_touched || [],
        });
        await appendEvent(workerCompletedEvent, args.project_key);
      } catch (error) {
        // Non-fatal - log and continue
        console.warn(
          "[swarm_complete] Failed to emit worker_completed event:",
          error,
        );
      }

      // Automatic memory capture (MANDATORY on successful completion)
      // Extract strategy from bead metadata if available
      let capturedStrategy: LearningDecompositionStrategy | undefined;

      // Build memory information from task completion
      const memoryInfo = formatMemoryStoreOnSuccess(
        args.bead_id,
        args.summary,
        args.files_touched || [],
        capturedStrategy,
      );

      let memoryStored = false;
      let memoryError: string | undefined;

      // Attempt to store in hivemind (non-blocking)
      try {
        const memoryAvailable = await isToolAvailable("hivemind");
        if (memoryAvailable) {
          // Call hivemind store command
          const storeResult =
            await Bun.$`hivemind store ${memoryInfo.information} --metadata ${memoryInfo.metadata}`
              .quiet()
              .nothrow();

          if (storeResult.exitCode === 0) {
            memoryStored = true;
          } else {
            memoryError = `hivemind store failed: ${storeResult.stderr.toString().slice(0, 200)}`;
            console.warn(`[swarm_complete] ${memoryError}`);
          }
        } else {
          memoryError =
            "hivemind not available - learning stored in-memory only";
          warnMissingTool("hivemind");
        }
      } catch (error) {
        memoryError = `Failed to store memory: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`[swarm_complete] ${memoryError}`);
      }

      // Release file reservations for this agent using embedded swarm-mail
      let reservationsReleased = false;
      let reservationsReleasedCount = 0;
      let reservationsReleaseError: string | undefined;
      try {
        const releaseResult = await releaseSwarmFiles({
          projectPath: args.project_key,
          agentName: args.agent_name,
          // Release all reservations for this agent
        });
        reservationsReleased = true;
        reservationsReleasedCount = releaseResult.released;
      } catch (error) {
        // Release might fail (e.g., no reservations existed)
        // This is non-fatal - log and continue
        reservationsReleaseError = error instanceof Error ? error.message : String(error);
        console.warn(
          `[swarm] Failed to release file reservations for ${args.agent_name}:`,
          error,
        );
      }

      // Score outcome and update pattern maturity
      let outcomeScored = false;
      let outcomeFeedbackType: string | undefined;
      let outcomeScore: number | undefined;
      let outcomeReasoning: string | undefined;
      try {
        const { scoreOutcome, OutcomeSignalsSchema } = await import("./learning");
        const { getStorage } = await import("./storage");
        const { updatePatternMaturity } = await import("./pattern-maturity");
        
        // Build outcome signals
        const durationMs = args.start_time ? Date.now() - args.start_time : 0;
        const signals = OutcomeSignalsSchema.parse({
          bead_id: args.bead_id,
          duration_ms: durationMs,
          error_count: args.error_count ?? 0,
          retry_count: args.retry_count ?? 0,
          success: true, // swarm_complete only runs on success
          files_touched: args.files_touched || [],
          timestamp: new Date().toISOString(),
          strategy: undefined, // TODO: Extract strategy from decomposition event
        });

        // Score the outcome
        const outcome = scoreOutcome(signals);
        outcomeScored = true;
        outcomeFeedbackType = outcome.type;
        outcomeScore = outcome.score;
        outcomeReasoning = outcome.reasoning;

        // Store feedback event
        const storage = await getStorage();
        const { outcomeToFeedback, scoreImplicitFeedback } = await import("./learning");
        const scoredOutcome = scoreImplicitFeedback(signals);
        const feedbackEvent = outcomeToFeedback(scoredOutcome, "task_completion");
        await storage.storeFeedback(feedbackEvent);

        // Update pattern maturity (if strategy was used)
        if (signals.strategy) {
          const maturity = await storage.getMaturity(signals.strategy);
          if (maturity) {
            const allFeedback = await storage.getMaturityFeedback(signals.strategy);
            const updated = updatePatternMaturity(maturity, allFeedback);
            await storage.storeMaturity(updated);
          }
        }
      } catch (error) {
        // Non-fatal - don't block completion if scoring fails
        console.warn(
          `[swarm_complete] Failed to score outcome (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Record pattern observations for anti-pattern auto-deprecation
      const patternObservations = {
        extracted_patterns: [] as string[],
        recorded_count: 0,
        inversions: [] as any[],
      };
      
      try {
        const {
          extractPatternsFromDescription,
          recordPatternObservation,
          createPattern,
          InMemoryPatternStorage,
        } = await import("./anti-patterns");
        
        // Determine epic ID: use parent_id if available, otherwise fall back to extracting from bead_id
        // The cell was already fetched earlier, so we can reuse it
        const epicIdForPattern = cell.parent_id || (args.bead_id.includes(".")
          ? args.bead_id.split(".")[0]
          : args.bead_id);
        
        // Get epic to extract patterns from description
        const epicCell = await adapter.getCell(args.project_key, epicIdForPattern);
        if (epicCell?.description) {
          const patterns = extractPatternsFromDescription(epicCell.description);
          patternObservations.extracted_patterns = patterns;
          
          if (patterns.length > 0) {
            // Initialize storage (in-memory for now, can integrate with persistent storage later)
            const patternStorage = new InMemoryPatternStorage();
            
            // Record observation for each pattern (success=true since swarm_complete only runs on success)
            for (const patternContent of patterns) {
              // Find or create pattern
              const existingPatterns = await patternStorage.findByContent(patternContent);
              let pattern = existingPatterns[0];
              
              if (!pattern) {
                // Create new pattern
                pattern = createPattern(patternContent, ["decomposition", "auto-detected"]);
                await patternStorage.store(pattern);
              }
              
              // Record successful observation
              const result = recordPatternObservation(
                pattern,
                true, // success=true (swarm_complete only runs on success)
                args.bead_id,
              );
              
              // Update storage with new counts
              await patternStorage.store(result.pattern);
              patternObservations.recorded_count++;
              
              // If pattern was inverted, store the anti-pattern
              if (result.inversion) {
                await patternStorage.store(result.inversion.inverted);
                patternObservations.inversions.push({
                  original: result.inversion.original.content,
                  inverted: result.inversion.inverted.content,
                  reason: result.inversion.reason,
                });
              }
            }
          }
        }
      } catch (error) {
        // Non-fatal - don't block completion if pattern observation fails
        console.warn(
          `[swarm_complete] Failed to record pattern observations (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Extract epic ID (for message sending)
      const epicId = args.bead_id.includes(".")
        ? args.bead_id.split(".")[0]
        : args.bead_id;

      // Send completion message using embedded swarm-mail with memory capture status
      const completionBody = [
        `## Subtask Complete: ${args.bead_id}`,
        "",
        `**Summary**: ${args.summary}`,
        "",
        parsedEvaluation
          ? `**Self-Evaluation**: ${parsedEvaluation.passed ? "PASSED" : "FAILED"}`
          : "",
        parsedEvaluation?.overall_feedback
          ? `**Feedback**: ${parsedEvaluation.overall_feedback}`
          : "",
        "",
        `**Memory Capture**: ${memoryStored ? "✓ Stored in hivemind" : `✗ ${memoryError || "Failed"}`}`,
      ]
        .filter(Boolean)
        .join("\n");

      // Send completion message (non-fatal if it fails)
      let messageSent = false;
      let messageError: string | undefined;
      try {
        await sendSwarmMessage({
          projectPath: args.project_key,
          fromAgent: args.agent_name,
          toAgents: [], // Thread broadcast
          subject: `Complete: ${args.bead_id}`,
          body: completionBody,
          threadId: epicId,
          importance: "normal",
        });
        messageSent = true;
      } catch (error) {
        // Non-fatal - log and continue
        messageError = error instanceof Error ? error.message : String(error);
        console.warn(
          `[swarm_complete] Failed to send completion message: ${messageError}`,
        );
      }

      // Build success response with hivemind integration
      const response = {
        success: true,
        bead_id: args.bead_id,
        closed: true,
        result: resultText,
        commit: commitSha ? { sha: commitSha, message: commitMessage, branch: commitBranch } : undefined,
        reservations_released: reservationsReleased,
        reservations_released_count: reservationsReleasedCount,
        reservations_release_error: reservationsReleaseError,
        synced: syncSuccess,
        sync_error: syncError,
        message_sent: messageSent,
        message_error: messageError,
        deferred_resolved: deferredResolved,
        deferred_error: deferredError,
        agent_registration: {
          verified: agentRegistered,
          warning: registrationWarning || undefined,
        },
        verification_gate: verificationResult
          ? {
              passed: true,
              summary: verificationResult.summary,
              steps: verificationResult.steps.map((s) => ({
                name: s.name,
                passed: s.passed,
                skipped: s.skipped,
                skipReason: s.skipReason,
              })),
            }
          : args.skip_verification
            ? { skipped: true, reason: "skip_verification=true" }
            : { skipped: true, reason: "no files_touched provided" },
        learning_prompt: `## Reflection

Did you learn anything reusable during this subtask? Consider:

1. **Patterns**: Any code patterns or approaches that worked well?
2. **Gotchas**: Edge cases or pitfalls to warn future agents about?
3. **Best Practices**: Domain-specific guidelines worth documenting?
4. **Tool Usage**: Effective ways to use tools for this type of task?

If you discovered something valuable, use \`swarm_learn\` or \`skills_create\` to preserve it as a skill for future swarms.

Files touched: ${args.files_touched?.join(", ") || "none recorded"}`,
        // Automatic memory capture (MANDATORY)
        memory_capture: {
          attempted: true,
          stored: memoryStored,
          error: memoryError,
          information: memoryInfo.information,
          metadata: memoryInfo.metadata,
          note: memoryStored
            ? "Learning automatically stored in hivemind"
            : `Failed to store: ${memoryError}. Learning lost unless hivemind is available.`,
        },
        // Outcome scoring (learning system integration)
        outcome_scoring: outcomeScored
          ? {
              scored: true,
              feedback_type: outcomeFeedbackType,
              score: outcomeScore,
              reasoning: outcomeReasoning,
              note: "Outcome scored and stored for pattern maturity tracking",
            }
          : {
              scored: false,
              note: "Outcome scoring failed (non-fatal)",
            },
        // Contract validation result
        contract_validation: contractValidation
          ? {
              validated: true,
              passed: contractValidation.valid,
              violations: contractValidation.violations,
              warning: contractWarning,
              note: contractValidation.valid
                ? "All files within owned scope"
                : "Scope violation detected - recorded as negative learning signal",
            }
          : {
              validated: false,
              reason: "No files_owned contract found (non-epic subtask or decomposition event missing)",
            },
        // Pattern observations for anti-pattern auto-deprecation
        pattern_observations: patternObservations,
      };

      // Capture subtask completion outcome for eval data
      try {
        const { captureSubtaskOutcome } = await import("./eval-capture.js");
        const durationMs = args.start_time ? Date.now() - args.start_time : 0;
        
        // Determine epic ID: use parent_id if available, otherwise fall back to extracting from bead_id
        const evalEpicId = cell.parent_id || epicId;
        
        captureSubtaskOutcome({
          epicId: evalEpicId,
          projectPath: args.project_key,
          beadId: args.bead_id,
          title: cell.title,
          plannedFiles: args.planned_files || [],
          actualFiles: args.files_touched || [],
          durationMs,
          errorCount: args.error_count || 0,
          retryCount: args.retry_count || 0,
          success: true,
        });
      } catch (error) {
        // Non-fatal - don't block completion if capture fails
        console.warn("[swarm_complete] Failed to capture subtask outcome:", error);
      }

      // Capture subtask completion outcome
      try {
        const durationMs = args.start_time ? Date.now() - args.start_time : 0;
        captureCoordinatorEvent({
          session_id: _ctx.sessionID || "unknown",
          epic_id: epicId,
          timestamp: new Date().toISOString(),
          event_type: "OUTCOME",
          outcome_type: "subtask_success",
          payload: {
            bead_id: args.bead_id,
            duration_ms: durationMs,
            files_touched: args.files_touched || [],
            verification_passed: verificationResult?.passed ?? false,
            verification_skipped: args.skip_verification ?? false,
          },
        });
      } catch (error) {
        // Non-fatal - don't block completion if capture fails
        console.warn("[swarm_complete] Failed to capture subtask_success:", error);
      }

      return JSON.stringify(response, null, 2);
    } catch (error) {
      // CRITICAL: Notify coordinator of failure via swarm mail
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Determine which step failed
      let failedStep = "unknown";
      if (errorMessage.includes("verification")) {
        failedStep = "Verification Gate (typecheck/tests)";
      } else if (errorMessage.includes("evaluation")) {
        failedStep = "Self-evaluation parsing";
      } else if (
        errorMessage.includes("bead") ||
        errorMessage.includes("close")
      ) {
        failedStep = "Bead close";
      } else if (
        errorMessage.includes("memory") ||
        errorMessage.includes("semantic")
      ) {
        failedStep = "Memory storage (non-fatal)";
      } else if (
        errorMessage.includes("reservation") ||
        errorMessage.includes("release")
      ) {
        failedStep = "File reservation release";
      } else if (
        errorMessage.includes("message") ||
        errorMessage.includes("mail")
      ) {
        failedStep = "Swarm mail notification";
      }

      // Build error notification body
      const errorBody = [
        `## ⚠️ SWARM_COMPLETE FAILED`,
        "",
        `**Bead**: ${args.bead_id}`,
        `**Agent**: ${args.agent_name}`,
        `**Failed Step**: ${failedStep}`,
        "",
        `### Error Message`,
        "```",
        errorMessage,
        "```",
        "",
        errorStack
          ? `### Stack Trace\n\`\`\`\n${errorStack.slice(0, 1000)}\n\`\`\`\n`
          : "",
         `### Context`,
        `- **Summary**: ${args.summary}`,
        `- **Files touched**: ${args.files_touched?.length ? args.files_touched.join(", ") : "none"}`,
        `- **Skip verification**: ${args.skip_verification ?? false}`,
        "",
        `### Recovery Actions`,
        "1. Check error message for specific issue",
        "2. Review failed step (typecheck, tests, cell close, etc.)",
        "3. Fix underlying issue or use skip flags if appropriate",
        "4. Retry swarm_complete after fixing",
      ]
        .filter(Boolean)
        .join("\n");

      // Send urgent notification to coordinator
      let notificationSent = false;
      try {
        await sendSwarmMessage({
          projectPath: args.project_key,
          fromAgent: args.agent_name,
          toAgents: [], // Thread broadcast to coordinator
          subject: `FAILED: swarm_complete for ${args.bead_id}`,
          body: errorBody,
          threadId: epicId,
          importance: "urgent",
        });
        notificationSent = true;
      } catch (mailError) {
        // Even swarm mail failed - log to console as last resort
        console.error(
          `[swarm_complete] CRITICAL: Failed to notify coordinator of failure for ${args.bead_id}:`,
          mailError,
        );
        console.error(`[swarm_complete] Original error:`, error);
      }

      // Capture subtask failure outcome
      try {
        const durationMs = args.start_time ? Date.now() - args.start_time : 0;
        captureCoordinatorEvent({
          session_id: _ctx.sessionID || "unknown",
          epic_id: epicId,
          timestamp: new Date().toISOString(),
          event_type: "OUTCOME",
          outcome_type: "subtask_failed",
          payload: {
            bead_id: args.bead_id,
            duration_ms: durationMs,
            failed_step: failedStep,
            error_message: errorMessage.slice(0, 500),
          },
        });
      } catch (captureError) {
        // Non-fatal - don't block error return if capture fails
        console.warn("[swarm_complete] Failed to capture subtask_failed:", captureError);
      }

      // Return structured error instead of throwing
      // This ensures the agent sees the actual error message
      return JSON.stringify(
        {
          success: false,
          error: `swarm_complete failed: ${errorMessage}`,
          failed_step: failedStep,
          bead_id: args.bead_id,
          agent_name: args.agent_name,
          coordinator_notified: notificationSent,
          stack_trace: errorStack?.slice(0, 500),
          hint: "Check the error message above. Common issues: bead not found, session not initialized.",
           context: {
            summary: args.summary,
            files_touched: args.files_touched || [],
            skip_verification: args.skip_verification ?? false,
          },
          recovery: {
            steps: [
              "1. Check the error message above for specific issue",
              `2. Review failed step: ${failedStep}`,
              "3. Fix underlying issue or use skip flags if appropriate",
              "4. Retry swarm_complete after fixing",
            ],
            common_fixes: {
              "Verification Gate": "Use skip_verification=true to bypass (not recommended)",
              "Cell close": "Check cell status with hive_query(), may need hive_update() first",
              "Self-evaluation": "Check evaluation JSON format matches EvaluationSchema",
            },
          },
        },
        null,
        2,
      );
    }
  },
});

/**
 * Record outcome signals from a completed subtask
 *
 * Tracks implicit feedback (duration, errors, retries) to score
 * decomposition quality over time. This data feeds into criterion
 * weight calculations.
 *
 * Strategy tracking enables learning about which decomposition strategies
 * work best for different task types.
 *
 * @see src/learning.ts for scoring logic
 */
export const swarm_record_outcome = tool({
  description:
    "Record subtask outcome for implicit feedback scoring. Tracks duration, errors, retries to learn decomposition quality.",
  args: {
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    duration_ms: tool.schema
      .number()
      .int()
      .min(0)
      .describe("Duration in milliseconds"),
    error_count: tool.schema
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of errors encountered"),
    retry_count: tool.schema
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of retry attempts"),
    success: tool.schema.boolean().describe("Whether the subtask succeeded"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files that were modified"),
    criteria: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Criteria to generate feedback for (default: all default criteria)",
      ),
    strategy: tool.schema
      .enum(["file-based", "feature-based", "risk-based", "research-based"])
      .optional()
      .describe("Decomposition strategy used for this task"),
    failure_mode: tool.schema
      .enum([
        "timeout",
        "conflict",
        "validation",
        "tool_failure",
        "context_overflow",
        "dependency_blocked",
        "user_cancelled",
        "unknown",
      ])
      .optional()
      .describe(
        "Failure classification (only when success=false). Auto-classified if not provided.",
      ),
    failure_details: tool.schema
      .string()
      .optional()
      .describe("Detailed failure context (error message, stack trace, etc.)"),
    project_path: tool.schema
      .string()
      .optional()
      .describe("Project path (for finalizing eval records when all subtasks complete)"),
    epic_id: tool.schema
      .string()
      .optional()
      .describe("Epic ID (for finalizing eval records when all subtasks complete)"),
  },
  async execute(args) {
    // Build outcome signals
    const signals: OutcomeSignals = {
      bead_id: args.bead_id,
      duration_ms: args.duration_ms,
      error_count: args.error_count ?? 0,
      retry_count: args.retry_count ?? 0,
      success: args.success,
      files_touched: args.files_touched ?? [],
      timestamp: new Date().toISOString(),
      strategy: args.strategy as LearningDecompositionStrategy | undefined,
      failure_mode: args.failure_mode,
      failure_details: args.failure_details,
    };

    // If task failed but no failure_mode provided, try to classify from failure_details
    if (!args.success && !args.failure_mode && args.failure_details) {
      const classified = classifyFailure(args.failure_details);
      signals.failure_mode = classified as OutcomeSignals["failure_mode"];
    }

    // Validate signals
    const validated = OutcomeSignalsSchema.parse(signals);

    // Score the outcome
    const scored: ScoredOutcome = scoreImplicitFeedback(
      validated,
      DEFAULT_LEARNING_CONFIG,
    );

    // Get error patterns from accumulator
    const errorStats = await globalErrorAccumulator.getErrorStats(args.bead_id);

    // Finalize eval record if project_path and epic_id provided
    let finalizedRecord: EvalRecord | null = null;
    if (args.project_path && args.epic_id) {
      try {
        const { finalizeEvalRecord } = await import("./eval-capture.js");
        finalizedRecord = finalizeEvalRecord({
          epicId: args.epic_id,
          projectPath: args.project_path,
        });
      } catch (error) {
        // Non-fatal - log and continue
        console.warn("[swarm_record_outcome] Failed to finalize eval record:", error);
      }
    }

    // Generate feedback events for each criterion
    const criteriaToScore = args.criteria ?? [
      "type_safe",
      "no_bugs",
      "patterns",
      "readable",
    ];
    const feedbackEvents: FeedbackEvent[] = criteriaToScore.map((criterion) => {
      const event = outcomeToFeedback(scored, criterion);
      // Include strategy in feedback context for future analysis
      if (args.strategy) {
        event.context =
          `${event.context || ""} [strategy: ${args.strategy}]`.trim();
      }
      // Include error patterns in feedback context
      if (errorStats.total > 0) {
        const errorSummary = Object.entries(errorStats.by_type)
          .map(([type, count]) => `${type}:${count}`)
          .join(", ");
        event.context =
          `${event.context || ""} [errors: ${errorSummary}]`.trim();
      }
      return event;
    });

    return JSON.stringify(
      {
        success: true,
        outcome: {
          signals: validated,
          scored: {
            type: scored.type,
            decayed_value: scored.decayed_value,
            reasoning: scored.reasoning,
          },
        },
        feedback_events: feedbackEvents,
        error_patterns: errorStats,
        summary: {
          feedback_type: scored.type,
          duration_seconds: Math.round(args.duration_ms / 1000),
          error_count: args.error_count ?? 0,
          retry_count: args.retry_count ?? 0,
          success: args.success,
          strategy: args.strategy,
          failure_mode: validated.failure_mode,
          failure_details: validated.failure_details,
          accumulated_errors: errorStats.total,
          unresolved_errors: errorStats.unresolved,
        },
        finalized_eval_record: finalizedRecord || undefined,
        note: "Feedback events should be stored for criterion weight calculation. Use learning.ts functions to apply weights.",
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Research Phase
// ============================================================================

/**
 * Known technology patterns for extraction from task descriptions
 * Maps common mentions to normalized package names
 */
const TECH_PATTERNS: Record<string, RegExp> = {
  next: /next\.?js|nextjs/i,
  react: /react(?!ive)/i,
  zod: /zod/i,
  typescript: /typescript|ts(?!\w)/i,
  tailwind: /tailwind(?:css)?/i,
  prisma: /prisma/i,
  drizzle: /drizzle(?:-orm)?/i,
  trpc: /trpc/i,
  "react-query": /react-query|tanstack.*query/i,
  axios: /axios/i,
  "node-fetch": /node-fetch|fetch api/i,
};

/**
 * Extract technology stack from task description
 *
 * Searches for common framework/library mentions and returns
 * a deduplicated array of normalized names.
 *
 * @param task - Task description
 * @returns Array of detected technology names (normalized, lowercase)
 *
 * @example
 * ```typescript
 * extractTechStack("Add Next.js API routes with Zod validation")
 * // => ["next", "zod"]
 * ```
 */
export function extractTechStack(task: string): string[] {
  const detected = new Set<string>();

  for (const [tech, pattern] of Object.entries(TECH_PATTERNS)) {
    if (pattern.test(task)) {
      detected.add(tech);
    }
  }

  return Array.from(detected);
}

/**
 * Spawn instruction for a researcher worker
 */
export interface ResearchSpawnInstruction {
  /** Unique ID for this research task */
  research_id: string;
  /** Technology being researched */
  tech: string;
  /** Full prompt for the researcher agent */
  prompt: string;
  /** Agent type for the Task tool */
  subagent_type: "swarm-researcher";
}

/**
 * Research result from documentation discovery phase
 */
export interface ResearchResult {
  /** Technologies identified and researched */
  tech_stack: string[];
  /** Spawn instructions for researcher workers */
  spawn_instructions: ResearchSpawnInstruction[];
  /** Summaries keyed by technology name */
  summaries: Record<string, string>;
  /** Hivemind IDs where research is stored */
  memory_ids: string[];
}

/**
 * Run research phase before task decomposition
 *
 * This is the INTEGRATION point that:
 * 1. Analyzes task to identify technologies
 * 2. Spawns researcher agents for each technology (parallel)
 * 3. Waits for researchers to complete
 * 4. Collects summaries from hivemind
 * 5. Returns combined context for shared_context
 *
 * Flow:
 * ```
 * Task received
 *   ↓
 * extractTechStack(task) → ["next", "zod"]
 *   ↓
 * For each tech: swarm_spawn_researcher(tech_stack=[tech])
 *   ↓
 * Spawn Task agents in parallel
 *   ↓
 * Wait for all to complete
 *   ↓
 * Collect summaries from swarm mail
 *   ↓
 * Return ResearchResult → inject into shared_context
 * ```
 *
 * @param task - Task description to analyze
 * @param projectPath - Absolute path to project root
 * @param options - Optional configuration
 * @returns Research results with summaries and memory IDs
 *
 * @example
 * ```typescript
 * const result = await runResearchPhase(
 *   "Add Next.js API routes with Zod validation",
 *   "/path/to/project"
 * );
 * // result.tech_stack => ["next", "zod"]
 * // result.summaries => { next: "...", zod: "..." }
 * // Use result as shared_context for decomposition
 * ```
 */
export async function runResearchPhase(
  task: string,
  projectPath: string,
  options?: { checkUpgrades?: boolean }
): Promise<ResearchResult> {
  // Step 1: Extract technologies from task description
  const techStack = extractTechStack(task);

  // Early return if no technologies detected
  if (techStack.length === 0) {
    return {
      tech_stack: [],
      spawn_instructions: [],
      summaries: {},
      memory_ids: [],
    };
  }

  // Step 2: Generate spawn instructions for each technology
  // The coordinator will use these to spawn researcher workers via Task()
  const spawnInstructions: ResearchSpawnInstruction[] = [];
  
  for (const tech of techStack) {
    // Generate unique research ID
    const researchId = `research-${tech}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    // Generate researcher prompt
    const prompt = formatResearcherPrompt({
      research_id: researchId,
      epic_id: "standalone-research", // No epic context for standalone research
      tech_stack: [tech], // Single tech per researcher
      project_path: projectPath,
      check_upgrades: options?.checkUpgrades ?? false,
    });
    
    spawnInstructions.push({
      research_id: researchId,
      tech,
      prompt,
      subagent_type: "swarm-researcher",
    });
  }

  // Step 3: Return spawn instructions for coordinator
  // The coordinator will spawn Task() agents using these instructions
  // and collect results from swarm mail after completion
  return {
    tech_stack: techStack,
    spawn_instructions: spawnInstructions,
    summaries: {}, // Will be populated by coordinator after researchers complete
    memory_ids: [], // Will be populated by coordinator after researchers store in hivemind
  };
}

/**
 * Plugin tool for running research phase
 *
 * Exposes research phase as a tool for manual triggering or
 * integration into orchestration flows.
 */
export const swarm_research_phase = tool({
  description:
    "Run research phase to gather documentation for detected technologies. Returns summaries for injection into shared_context.",
  args: {
    task: tool.schema.string().min(1).describe("Task description to analyze"),
    project_path: tool.schema
      .string()
      .describe("Absolute path to project root"),
    check_upgrades: tool.schema
      .boolean()
      .optional()
      .describe(
        "Compare installed vs latest versions (default: false)"
      ),
  },
  async execute(args) {
    const result = await runResearchPhase(args.task, args.project_path, {
      checkUpgrades: args.check_upgrades,
    });

    return JSON.stringify(
      {
        tech_stack: result.tech_stack,
        summaries: result.summaries,
        memory_ids: result.memory_ids,
        summary: {
          technologies_detected: result.tech_stack.length,
          summaries_collected: Object.keys(result.summaries).length,
          memories_stored: result.memory_ids.length,
        },
        usage_hint:
          "Inject summaries into shared_context for task decomposition. Each technology has documentation in hivemind.",
      },
      null,
      2
    );
  },
});

/**
 * Record an error during subtask execution
 *
 * Implements pattern from "Patterns for Building AI Agents" p.40:
 * "Good agents examine and correct errors when something goes wrong"
 *
 * Errors are accumulated and can be fed into retry prompts to help
 * agents learn from past failures.
 */
export const swarm_accumulate_error = tool({
  description:
    "Record an error during subtask execution. Errors feed into retry prompts.",
  args: {
    bead_id: tool.schema.string().describe("Cell ID where error occurred"),
    error_type: tool.schema
      .enum(["validation", "timeout", "conflict", "tool_failure", "unknown"])
      .describe("Category of error"),
    message: tool.schema.string().describe("Human-readable error message"),
    stack_trace: tool.schema
      .string()
      .optional()
      .describe("Stack trace for debugging"),
    tool_name: tool.schema.string().optional().describe("Tool that failed"),
    context: tool.schema
      .string()
      .optional()
      .describe("What was happening when error occurred"),
  },
  async execute(args) {
    const entry = await globalErrorAccumulator.recordError(
      args.bead_id,
      args.error_type as ErrorType,
      args.message,
      {
        stack_trace: args.stack_trace,
        tool_name: args.tool_name,
        context: args.context,
      },
    );

    return JSON.stringify(
      {
        success: true,
        error_id: entry.id,
        bead_id: entry.bead_id,
        error_type: entry.error_type,
        message: entry.message,
        timestamp: entry.timestamp,
        note: "Error recorded for retry context. Use swarm_get_error_context to retrieve accumulated errors.",
      },
      null,
      2,
    );
  },
});

/**
 * Get accumulated errors for a bead to feed into retry prompts
 *
 * Returns formatted error context that can be injected into retry prompts
 * to help agents learn from past failures.
 */
export const swarm_get_error_context = tool({
  description:
    "Get accumulated errors for a bead. Returns formatted context for retry prompts.",
  args: {
    bead_id: tool.schema.string().describe("Cell ID to get errors for"),
    include_resolved: tool.schema
      .boolean()
      .optional()
      .describe("Include resolved errors (default: false)"),
  },
  async execute(args) {
    const errorContext = await globalErrorAccumulator.getErrorContext(
      args.bead_id,
      args.include_resolved ?? false,
    );

    const stats = await globalErrorAccumulator.getErrorStats(args.bead_id);

    return JSON.stringify(
      {
        bead_id: args.bead_id,
        error_context: errorContext,
        stats: {
          total_errors: stats.total,
          unresolved: stats.unresolved,
          by_type: stats.by_type,
        },
        has_errors: errorContext.length > 0,
        usage:
          "Inject error_context into retry prompt using {error_context} placeholder",
      },
      null,
      2,
    );
  },
});

/**
 * Mark an error as resolved
 *
 * Call this after an agent successfully addresses an error to update
 * the accumulator state.
 */
export const swarm_resolve_error = tool({
  description:
    "Mark an error as resolved after fixing it. Updates error accumulator state.",
  args: {
    error_id: tool.schema.string().describe("Error ID to mark as resolved"),
  },
  async execute(args) {
    await globalErrorAccumulator.resolveError(args.error_id);

    return JSON.stringify(
      {
        success: true,
        error_id: args.error_id,
        resolved: true,
      },
      null,
      2,
    );
  },
});

/**
 * Check if a bead has struck out (3 consecutive failures)
 *
 * The 3-Strike Rule:
 * IF 3+ fixes have failed:
 *   STOP → Question the architecture
 *   DON'T attempt Fix #4
 *   Discuss with human partner
 *
 * This is NOT a failed hypothesis.
 * This is a WRONG ARCHITECTURE.
 *
 * Use this tool to:
 * - Check strike count before attempting a fix
 * - Get architecture review prompt if struck out
 * - Record a strike when a fix fails
 * - Clear strikes when a fix succeeds
 */
export const swarm_check_strikes = tool({
  description:
    "Check 3-strike status for a bead. Records failures, detects architectural problems, generates architecture review prompts.",
  args: {
    bead_id: tool.schema.string().describe("Cell ID to check"),
    action: tool.schema
      .enum(["check", "add_strike", "clear", "get_prompt"])
      .describe(
        "Action: check count, add strike, clear strikes, or get prompt",
      ),
    attempt: tool.schema
      .string()
      .optional()
      .describe("Description of fix attempt (required for add_strike)"),
    reason: tool.schema
      .string()
      .optional()
      .describe("Why the fix failed (required for add_strike)"),
  },
  async execute(args) {
    switch (args.action) {
      case "check": {
        const count = await getStrikes(args.bead_id, globalStrikeStorage);
        const strikedOut = await isStrikedOut(
          args.bead_id,
          globalStrikeStorage,
        );

        return JSON.stringify(
          {
            bead_id: args.bead_id,
            strike_count: count,
            is_striked_out: strikedOut,
            message: strikedOut
              ? "⚠️ STRUCK OUT: 3 strikes reached. Use get_prompt action for architecture review."
              : count === 0
                ? "No strikes. Clear to proceed."
                : `${count} strike${count > 1 ? "s" : ""}. ${3 - count} remaining before architecture review required.`,
            next_action: strikedOut
              ? "Call with action=get_prompt to get architecture review questions"
              : "Continue with fix attempt",
          },
          null,
          2,
        );
      }

      case "add_strike": {
        if (!args.attempt || !args.reason) {
          return JSON.stringify(
            {
              error: "add_strike requires 'attempt' and 'reason' parameters",
            },
            null,
            2,
          );
        }

        const record = await addStrike(
          args.bead_id,
          args.attempt,
          args.reason,
          globalStrikeStorage,
        );

        const strikedOut = record.strike_count >= 3;

        // Build response with memory storage hint on 3-strike
        const response: Record<string, unknown> = {
          bead_id: args.bead_id,
          strike_count: record.strike_count,
          is_striked_out: strikedOut,
          failures: record.failures,
          message: strikedOut
            ? "⚠️ STRUCK OUT: 3 strikes reached. STOP and question the architecture."
            : `Strike ${record.strike_count} recorded. ${3 - record.strike_count} remaining.`,
          warning: strikedOut
            ? "DO NOT attempt Fix #4. Call with action=get_prompt for architecture review."
            : undefined,
        };

        // Add hivemind storage hint on 3-strike
        if (strikedOut) {
          response.memory_store = formatMemoryStoreOn3Strike(
            args.bead_id,
            record.failures,
          );
        }

        return JSON.stringify(response, null, 2);
      }

      case "clear": {
        await clearStrikes(args.bead_id, globalStrikeStorage);

        return JSON.stringify(
          {
            bead_id: args.bead_id,
            strike_count: 0,
            is_striked_out: false,
            message: "Strikes cleared. Fresh start.",
          },
          null,
          2,
        );
      }

      case "get_prompt": {
        const prompt = await getArchitecturePrompt(
          args.bead_id,
          globalStrikeStorage,
        );

        if (!prompt) {
          return JSON.stringify(
            {
              bead_id: args.bead_id,
              has_prompt: false,
              message: "No architecture prompt (not struck out yet)",
            },
            null,
            2,
          );
        }

        return JSON.stringify(
          {
            bead_id: args.bead_id,
            has_prompt: true,
            architecture_review_prompt: prompt,
            message:
              "Architecture review required. Present this prompt to the human partner.",
          },
          null,
          2,
        );
      }

      default:
        return JSON.stringify(
          {
            error: `Unknown action: ${args.action}`,
          },
          null,
          2,
        );
    }
  },
});

/**
 * Swarm context shape stored in swarm_contexts table
 */
interface SwarmBeadContext {
  id: string;
  epic_id: string;
  bead_id: string;
  strategy: "file-based" | "feature-based" | "risk-based";
  files: string[];
  dependencies: string[];
  directives: {
    shared_context?: string;
    skills_to_load?: string[];
    coordinator_notes?: string;
  };
  recovery: {
    last_checkpoint: number;
    files_modified: string[];
    progress_percent: number;
    last_message?: string;
    error_context?: string;
  };
  created_at: number;
  updated_at: number;
}

/**
 * Checkpoint swarm context for recovery
 *
 * Records the current state of a subtask to enable recovery after crashes,
 * context overflows, or agent restarts. Non-fatal errors - logs warnings
 * and continues if checkpoint fails.
 *
 * Integration:
 * - Called automatically by swarm_progress at milestone thresholds (25%, 50%, 75%)
 * - Can be called manually by agents at critical points
 * - Emits SwarmCheckpointedEvent for audit trail
 * - Updates swarm_contexts table for fast recovery queries
 */
export const swarm_checkpoint = tool({
  description:
    "Checkpoint swarm context for recovery. Records current state for crash recovery. Non-fatal errors.",
  args: {
    project_key: tool.schema.string().describe("Project path"),
    agent_name: tool.schema.string().describe("Agent name"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    epic_id: tool.schema.string().describe("Epic bead ID"),
    files_modified: tool.schema
      .array(tool.schema.string())
      .describe("Files modified so far"),
    progress_percent: tool.schema
      .number()
      .min(0)
      .max(100)
      .describe("Current progress"),
    directives: tool.schema
      .object({
        shared_context: tool.schema.string().optional(),
        skills_to_load: tool.schema.array(tool.schema.string()).optional(),
        coordinator_notes: tool.schema.string().optional(),
      })
      .optional()
      .describe("Coordinator directives for this subtask"),
    error_context: tool.schema
      .string()
      .optional()
      .describe("Error context if checkpoint is during error handling"),
  },
  async execute(args) {
    try {
      // Build checkpoint data
      const checkpoint: Omit<
        SwarmBeadContext,
        "id" | "created_at" | "updated_at"
      > = {
        epic_id: args.epic_id,
        bead_id: args.bead_id,
        strategy: "file-based", // TODO: Extract from decomposition metadata
        files: args.files_modified,
        dependencies: [], // TODO: Extract from bead metadata
        directives: args.directives || {},
        recovery: {
          last_checkpoint: Date.now(),
          files_modified: args.files_modified,
          progress_percent: args.progress_percent,
          error_context: args.error_context,
        },
      };

      // Emit checkpoint event
      const checkpointData = JSON.stringify(checkpoint);
      const event = createEvent("swarm_checkpointed", {
        project_key: args.project_key,
        epic_id: args.epic_id,
        bead_id: args.bead_id,
        strategy: checkpoint.strategy,
        files: checkpoint.files,
        dependencies: checkpoint.dependencies,
        directives: checkpoint.directives,
        recovery: checkpoint.recovery,
        checkpoint_size_bytes: Buffer.byteLength(checkpointData, "utf8"),
        trigger: args.error_context ? "error" : "manual",
      });

      await appendEvent(event, args.project_key);

      // NOTE: The event handler (handleSwarmCheckpointed in store.ts) updates
      // the swarm_contexts table. We don't write directly here to follow
      // event sourcing pattern - single source of truth is the event log.

      const now = Date.now();

      return JSON.stringify(
        {
          success: true,
          checkpoint_timestamp: now,
          summary: `Checkpoint saved for ${args.bead_id} at ${args.progress_percent}%`,
          bead_id: args.bead_id,
          epic_id: args.epic_id,
          files_tracked: args.files_modified.length,
        },
        null,
        2,
      );
    } catch (error) {
      // Non-fatal - log warning and continue
      console.warn(
        `[swarm_checkpoint] Failed to checkpoint ${args.bead_id}:`,
        error,
      );
      return JSON.stringify(
        {
          success: false,
          warning: "Checkpoint failed but continuing",
          error: error instanceof Error ? error.message : String(error),
          bead_id: args.bead_id,
          note: "This is non-fatal. Work can continue without checkpoint.",
        },
        null,
        2,
      );
    }
  },
});

/**
 * Recover swarm context from last checkpoint
 *
 * Queries swarm_contexts table for the most recent checkpoint of an epic.
 * Returns the full context including files, progress, and recovery state.
 * Emits SwarmRecoveredEvent for audit trail.
 *
 * Graceful fallback: Returns { found: false } if no checkpoint exists.
 */
export const swarm_recover = tool({
  description:
    "Recover swarm context from last checkpoint. Returns context or null if not found.",
  args: {
    project_key: tool.schema.string().describe("Project path"),
    epic_id: tool.schema.string().describe("Epic bead ID to recover"),
  },
  async execute(args) {
    try {
      const { getSwarmMailLibSQL } = await import("swarm-mail");
      const swarmMail = await getSwarmMailLibSQL(args.project_key);
      const db = await swarmMail.getDatabase();

      // Query most recent checkpoint for this epic
      const result = await db.query<{
        id: string;
        epic_id: string;
        bead_id: string;
        strategy: string;
        files: string;
        dependencies: string;
        directives: string;
        recovery: string;
        created_at: number;
        updated_at: number;
      }>(
        `SELECT * FROM swarm_contexts 
         WHERE epic_id = $1 
         ORDER BY updated_at DESC 
         LIMIT 1`,
        [args.epic_id],
      );

      if (result.rows.length === 0) {
        return JSON.stringify(
          {
            found: false,
            message: `No checkpoint found for epic ${args.epic_id}`,
            epic_id: args.epic_id,
          },
          null,
          2,
        );
      }

      const row = result.rows[0];
      // PGLite auto-parses JSON columns, so we need to handle both cases
      const parseIfString = <T>(val: unknown): T =>
        typeof val === "string" ? JSON.parse(val) : (val as T);

      const context: SwarmBeadContext = {
        id: row.id,
        epic_id: row.epic_id,
        bead_id: row.bead_id,
        strategy: row.strategy as SwarmBeadContext["strategy"],
        files: parseIfString<string[]>(row.files),
        dependencies: parseIfString<string[]>(row.dependencies),
        directives: parseIfString<SwarmBeadContext["directives"]>(
          row.directives,
        ),
        recovery: parseIfString<SwarmBeadContext["recovery"]>(row.recovery),
        created_at: row.created_at,
        updated_at: row.updated_at,
      };

      // Emit recovery event
      const event = createEvent("swarm_recovered", {
        project_key: args.project_key,
        epic_id: args.epic_id,
        bead_id: context.bead_id,
        recovered_from_checkpoint: context.recovery.last_checkpoint,
      });

      await appendEvent(event, args.project_key);

      return JSON.stringify(
        {
          found: true,
          context,
          summary: `Recovered checkpoint from ${new Date(context.updated_at).toISOString()}`,
          age_seconds: Math.round((Date.now() - context.updated_at) / 1000),
        },
        null,
        2,
      );
    } catch (error) {
      // Graceful fallback
      console.warn(
        `[swarm_recover] Failed to recover context for ${args.epic_id}:`,
        error,
      );
      return JSON.stringify(
        {
          found: false,
          error: error instanceof Error ? error.message : String(error),
          message: `Recovery failed for epic ${args.epic_id}`,
          epic_id: args.epic_id,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Learn from completed work and optionally create a skill
 *
 * This tool helps agents reflect on patterns, best practices, or domain
 * knowledge discovered during task execution and codify them into reusable
 * skills for future swarms.
 *
 * Implements the "learning swarm" pattern where swarms get smarter over time.
 */
export const swarm_learn = tool({
  description: `Analyze completed work and optionally create a skill from learned patterns.

Use after completing a subtask when you've discovered:
- Reusable code patterns or approaches
- Domain-specific best practices
- Gotchas or edge cases to warn about
- Effective tool usage patterns

This tool helps you formalize learnings into a skill that future agents can discover and use.`,
  args: {
    summary: tool.schema
      .string()
      .describe("Brief summary of what was learned (1-2 sentences)"),
    pattern_type: tool.schema
      .enum([
        "code-pattern",
        "best-practice",
        "gotcha",
        "tool-usage",
        "domain-knowledge",
        "workflow",
      ])
      .describe("Category of the learning"),
    details: tool.schema
      .string()
      .describe("Detailed explanation of the pattern or practice"),
    example: tool.schema
      .string()
      .optional()
      .describe("Code example or concrete illustration"),
    when_to_use: tool.schema
      .string()
      .describe("When should an agent apply this knowledge?"),
    files_context: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files that exemplify this pattern"),
    create_skill: tool.schema
      .boolean()
      .optional()
      .describe(
        "Create a skill from this learning (default: false, just document)",
      ),
    skill_name: tool.schema
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(64)
      .optional()
      .describe("Skill name if creating (required if create_skill=true)"),
    skill_tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tags for the skill if creating"),
  },
  async execute(args) {
    // Format the learning as structured documentation
    const learning = {
      summary: args.summary,
      type: args.pattern_type,
      details: args.details,
      example: args.example,
      when_to_use: args.when_to_use,
      files_context: args.files_context,
      recorded_at: new Date().toISOString(),
    };

    // If creating a skill, generate and create it
    if (args.create_skill) {
      if (!args.skill_name) {
        return JSON.stringify(
          {
            success: false,
            error: "skill_name is required when create_skill=true",
            learning: learning,
          },
          null,
          2,
        );
      }

      // Build skill body from learning
      const skillBody = `# ${args.summary}

## When to Use
${args.when_to_use}

## ${args.pattern_type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}

${args.details}

${args.example ? `## Example\n\n\`\`\`\n${args.example}\n\`\`\`\n` : ""}
${args.files_context && args.files_context.length > 0 ? `## Reference Files\n\n${args.files_context.map((f) => `- \`${f}\``).join("\n")}\n` : ""}

---
*Learned from swarm execution on ${new Date().toISOString().split("T")[0]}*`;

      // Import skills_create functionality
      const { getSkill, invalidateSkillsCache } = await import("./skills");
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      // Check if skill exists
      const existing = await getSkill(args.skill_name);
      if (existing) {
        return JSON.stringify(
          {
            success: false,
            error: `Skill '${args.skill_name}' already exists`,
            existing_path: existing.path,
            learning: learning,
            suggestion:
              "Use skills_update to add to existing skill, or choose a different name",
          },
          null,
          2,
        );
      }

      // Create skill directory and file
      const skillDir = join(
        process.cwd(),
        ".opencode",
        "skills",
        args.skill_name,
      );
      const skillPath = join(skillDir, "SKILL.md");

      const frontmatter = [
        "---",
        `name: ${args.skill_name}`,
        `description: ${args.when_to_use.slice(0, 200)}${args.when_to_use.length > 200 ? "..." : ""}`,
        "tags:",
        `  - ${args.pattern_type}`,
        `  - learned`,
        ...(args.skill_tags || []).map((t) => `  - ${t}`),
        "---",
      ].join("\n");

      try {
        await mkdir(skillDir, { recursive: true });
        await writeFile(skillPath, `${frontmatter}\n\n${skillBody}`, "utf-8");
        invalidateSkillsCache();

        return JSON.stringify(
          {
            success: true,
            skill_created: true,
            skill: {
              name: args.skill_name,
              path: skillPath,
              type: args.pattern_type,
            },
            learning: learning,
            message: `Created skill '${args.skill_name}' from learned pattern. Future agents can discover it with skills_list.`,
          },
          null,
          2,
        );
      } catch (error) {
        return JSON.stringify(
          {
            success: false,
            error: `Failed to create skill: ${error instanceof Error ? error.message : String(error)}`,
            learning: learning,
          },
          null,
          2,
        );
      }
    }

    // Just document the learning without creating a skill
    return JSON.stringify(
      {
        success: true,
        skill_created: false,
        learning: learning,
        message:
          "Learning documented. Use create_skill=true to persist as a skill for future agents.",
        suggested_skill_name:
          args.skill_name ||
          args.summary
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .slice(0, 64),
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Export tools
// ============================================================================

export const orchestrateTools = {
  swarm_init,
  swarm_status,
  swarm_progress,
  swarm_broadcast,
  swarm_complete,
  swarm_record_outcome,
  swarm_research_phase,
  swarm_accumulate_error,
  swarm_get_error_context,
  swarm_resolve_error,
  swarm_check_strikes,
  swarm_checkpoint,
  swarm_recover,
  swarm_learn,
};
