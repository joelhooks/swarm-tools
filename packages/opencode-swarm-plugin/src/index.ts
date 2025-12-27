/**
 * OpenCode Swarm Plugin
 *
 * A type-safe plugin for multi-agent coordination with hive issue tracking
 * and Agent Mail integration. Provides structured tools for swarm operations.
 *
 * @module opencode-swarm-plugin
 *
 * @example
 * ```typescript
 * // In opencode.jsonc
 * {
 *   "plugins": ["opencode-swarm-plugin"]
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Programmatic usage (hive is the new name, beads is deprecated)
 * import { hiveTools, beadsTools, agentMailTools, swarmMailTools } from "opencode-swarm-plugin"
 * ```
 */
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";

import {
  hiveTools,
  beadsTools,
  setHiveWorkingDirectory,
  setBeadsWorkingDirectory,
} from "./hive";
import {
  agentMailTools,
  setAgentMailProjectDirectory,
  type AgentMailState,
  AGENT_MAIL_URL,
} from "./agent-mail";
import {
  swarmMailTools,
  setSwarmMailProjectDirectory,
  type SwarmMailState,
} from "./swarm-mail";
import { structuredTools } from "./structured";
import { swarmTools } from "./swarm";
import { worktreeTools } from "./swarm-worktree";
import { reviewTools } from "./swarm-review";
import { repoCrawlTools } from "./repo-crawl";
import { skillsTools, setSkillsProjectDirectory } from "./skills";
import { mandateTools } from "./mandates";
import { memoryTools } from "./memory-tools";
import { observabilityTools } from "./observability-tools";
import { researchTools } from "./swarm-research";
import { evalTools } from "./eval-runner";
import { contributorTools } from "./contributor-tools";
import {
  guardrailOutput,
  DEFAULT_GUARDRAIL_CONFIG,
  type GuardrailResult,
} from "./output-guardrails";
import {
  analyzeTodoWrite,
  shouldAnalyzeTool,
  detectCoordinatorViolation,
  isInCoordinatorContext,
  getCoordinatorContext,
  setCoordinatorContext,
  clearCoordinatorContext,
} from "./planning-guardrails";
import { createCompactionHook } from "./compaction-hook";

/**
 * OpenCode Swarm Plugin
 *
 * Registers all swarm coordination tools:
 * - hive:* - Type-safe hive issue tracker wrappers (primary)
 * - beads:* - Legacy aliases for hive tools (deprecated, use hive:* instead)
 * - agent-mail:* - Multi-agent coordination via Agent Mail MCP (legacy)
 * - swarm-mail:* - Multi-agent coordination with embedded event sourcing (recommended)
 * - structured:* - Structured output parsing and validation
 * - swarm:* - Swarm orchestration and task decomposition
 * - repo-crawl:* - GitHub API tools for repository research
 * - skills:* - Agent skills discovery, activation, and execution
 * - mandate:* - Agent voting system for collaborative knowledge curation
 * - semantic-memory:* - Semantic memory with vector embeddings (Ollama + PGLite)
 * - contributor_lookup - GitHub contributor profile lookup with changeset credit generation
 *
 * @param input - Plugin context from OpenCode
 * @returns Plugin hooks including tools, events, and tool execution hooks
 */
const SwarmPlugin: Plugin = async (
  input: PluginInput,
): Promise<Hooks> => {
  const { $, directory, client } = input;

  // Set the working directory for hive commands
  // This ensures hive operations run in the project directory, not ~/.config/opencode
  setHiveWorkingDirectory(directory);

  // Set the project directory for skills discovery
  // Skills are discovered from .opencode/skill/, .claude/skills/, or skills/
  setSkillsProjectDirectory(directory);

  // Set the project directory for Agent Mail (legacy MCP-based)
  // This ensures agentmail_init uses the correct project path by default
  // (prevents using plugin directory when working in a different project)
  setAgentMailProjectDirectory(directory);

  // Set the project directory for Swarm Mail (embedded event-sourced)
  // This ensures swarmmail_init uses the correct project path by default
  setSwarmMailProjectDirectory(directory);

  /** Track active sessions for cleanup */
  let activeAgentMailState: AgentMailState | null = null;

  /**
   * Release all file reservations for the active agent
   * Best-effort cleanup - errors are logged but not thrown
   */
  async function releaseReservations(): Promise<void> {
    if (
      !activeAgentMailState ||
      activeAgentMailState.reservations.length === 0
    ) {
      return;
    }

    try {
      const response = await fetch(`${AGENT_MAIL_URL}/mcp/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomUUID(),
          method: "tools/call",
          params: {
            name: "release_file_reservations",
            arguments: {
              project_key: activeAgentMailState.projectKey,
              agent_name: activeAgentMailState.agentName,
            },
          },
        }),
      });

      if (response.ok) {
        activeAgentMailState.reservations = [];
      }
    } catch (error) {
      // Agent Mail might not be running - that's ok
      console.warn(
        `[swarm-plugin] Could not auto-release reservations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    /**
     * Register all tools from modules
     *
     * Tools are namespaced by module:
     * - hive:create, hive:query, hive:update, etc. (primary)
     * - beads:* - Legacy aliases (deprecated, use hive:* instead)
     * - agent-mail:init, agent-mail:send, agent-mail:reserve, etc. (legacy MCP)
     * - swarm-mail:init, swarm-mail:send, swarm-mail:reserve, etc. (embedded)
  * - repo-crawl:readme, repo-crawl:structure, etc.
  * - mandate:file, mandate:vote, mandate:query, etc.
  * - semantic-memory:store, semantic-memory:find, semantic-memory:get, etc.
  * - contributor_lookup - GitHub contributor profile lookup with changeset credits
 */
     tool: {
      ...hiveTools,
      ...swarmMailTools,
      ...structuredTools,
      ...swarmTools,
      ...worktreeTools,
      ...reviewTools,
      ...repoCrawlTools,
      ...skillsTools,
      ...mandateTools,
      ...memoryTools,
      ...observabilityTools,
      ...researchTools,
      ...evalTools,
      ...contributorTools,
    },

    /**
     * Event hook for session lifecycle
     *
     * Handles cleanup when session becomes idle:
     * - Releases any held file reservations
     */
    event: async ({ event }) => {
      // Auto-release reservations on session idle
      if (event.type === "session.idle") {
        await releaseReservations();
      }
    },

    /**
     * Hook before tool execution for planning guardrails
     *
     * Warns when agents are about to make planning mistakes:
     * - Using todowrite for multi-file implementation (should use swarm)
     * - Coordinator editing files directly (should spawn workers)
     * - Coordinator running tests (workers should run tests)
     */
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool;

      // Check for planning anti-patterns
      if (shouldAnalyzeTool(toolName)) {
        const analysis = analyzeTodoWrite(output.args);
        if (analysis.warning) {
          console.warn(`[swarm-plugin] ${analysis.warning}`);
        }
      }

      // Check for coordinator violations when in coordinator context
      if (isInCoordinatorContext()) {
        const ctx = getCoordinatorContext();
        const violation = detectCoordinatorViolation({
          sessionId: input.sessionID || "unknown",
          epicId: ctx.epicId || "unknown",
          toolName,
          toolArgs: output.args as Record<string, unknown>,
          agentContext: "coordinator",
        });

        if (violation.isViolation) {
          console.warn(`[swarm-plugin] ${violation.message}`);
        }
      }

      // Activate coordinator context when swarm tools are used
      if (toolName === "hive_create_epic" || toolName === "swarm_decompose") {
        setCoordinatorContext({
          isCoordinator: true,
          sessionId: input.sessionID,
        });
      }

      // Capture epic ID when epic is created
      if (toolName === "hive_create_epic" && output.args) {
        const args = output.args as { epic_title?: string };
        // Epic ID will be set after execution in tool.execute.after
      }
    },

    /**
     * Hook after tool execution for automatic cleanup and guardrails
     *
     * - Applies output guardrails to prevent context blowout from MCP tools
     * - Auto-releases file reservations after swarm:complete or hive:close
     * - Auto-syncs cells after closing
     */
    "tool.execute.after": async (input, output) => {
      const toolName = input.tool;

      // Apply output guardrails to prevent context blowout
      // Skip if output is empty or tool is in skip list
      if (output.output && typeof output.output === "string") {
        const guardrailResult = guardrailOutput(toolName, output.output);
        if (guardrailResult.truncated) {
          output.output = guardrailResult.output;
        }
      }

      // Track Agent Mail state for cleanup
      if (toolName === "agentmail_init" && output.output) {
        try {
          const result = JSON.parse(output.output);
          if (result.agent) {
            activeAgentMailState = {
              projectKey: result.project?.human_key || "",
              agentName: result.agent.name,
              reservations: [],
              startedAt: new Date().toISOString(),
            };
          }
        } catch {
          // Parsing failed - ignore
        }
      }

      // Track reservations from output
      if (
        toolName === "agentmail_reserve" &&
        output.output &&
        activeAgentMailState
      ) {
        // Extract reservation count from output if present
        const match = output.output.match(/Reserved (\d+) path/);
        if (match) {
          // Track reservation for cleanup
          activeAgentMailState.reservations.push(Date.now());
        }
      }

      // Auto-release after swarm:complete
      if (toolName === "swarm_complete" && activeAgentMailState) {
        await releaseReservations();
      }

      // Capture epic ID when epic is created (for coordinator context)
      if (toolName === "hive_create_epic" && output.output) {
        try {
          const result = JSON.parse(output.output);
          if (result.epic?.id) {
            setCoordinatorContext({
              isCoordinator: true,
              epicId: result.epic.id,
              sessionId: input.sessionID,
            });
          }
        } catch {
          // Parsing failed - ignore
        }
      }

      // Clear coordinator context when epic is closed
      if (toolName === "hive_close" && output.output && isInCoordinatorContext()) {
        const ctx = getCoordinatorContext();
        try {
          // Check if the closed cell is the active epic
          const result = JSON.parse(output.output);
          if (result.id === ctx.epicId) {
            clearCoordinatorContext();
          }
        } catch {
          // Parsing failed - ignore
        }
      }

      // Note: hive_sync should be called explicitly at session end
      // Auto-sync was removed because bd CLI is deprecated
      // The hive_sync tool handles flushing to JSONL and git commit/push
    },

    /**
     * Compaction hook for swarm context preservation
     *
     * When OpenCode compacts session context, this hook injects swarm state
     * to ensure coordinators can resume orchestration seamlessly.
     *
     * Uses SDK client to scan actual session messages for precise swarm state
     * (epic IDs, subtask status, agent names) rather than relying solely on
     * heuristic detection from hive/swarm-mail.
     *
     * Note: This hook is experimental and may not be in the published Hooks type yet.
     */
    "experimental.session.compacting": createCompactionHook(client),
  } as Hooks & {
    "experimental.session.compacting"?: (
      input: { sessionID: string },
      output: { context: string[] },
    ) => Promise<void>;
  };
};

/**
 * Default export for OpenCode plugin loading
 *
 * OpenCode loads plugins by their default export, so this allows:
 * ```json
 * { "plugins": ["opencode-swarm-plugin"] }
 * ```
 */
export default SwarmPlugin;

// =============================================================================
// Re-exports for programmatic use
// =============================================================================

/**
 * Re-export all schemas for type-safe usage
 */
export * from "./schemas";

/**
 * Re-export hive module (primary) and beads module (deprecated aliases)
 *
 * Includes:
 * - hiveTools - All hive tool definitions (primary)
 * - beadsTools - Legacy aliases for backward compatibility (deprecated)
 * - Individual tool exports (hive_create, hive_query, etc.)
 * - Legacy aliases (hive_create, hive_query, etc.)
 * - HiveError, HiveValidationError (and BeadError, BeadValidationError aliases)
 *
 * DEPRECATED: Use hive_* tools instead of beads_* tools
 */
export * from "./hive";

/**
 * Re-export agent-mail module (legacy MCP-based)
 *
 * Includes:
 * - agentMailTools - All agent mail tool definitions
 * - AgentMailError, FileReservationConflictError - Error classes
 * - AgentMailState - Session state type
 *
 * NOTE: For OpenCode plugin usage, import from "opencode-swarm-plugin/plugin" instead
 * to avoid the plugin loader trying to call these classes as functions.
 *
 * DEPRECATED: Use swarm-mail module instead for embedded event-sourced implementation.
 */
export {
  agentMailTools,
  AgentMailError,
  AgentMailNotInitializedError,
  FileReservationConflictError,
  createAgentMailError,
  setAgentMailProjectDirectory,
  getAgentMailProjectDirectory,
  mcpCallWithAutoInit,
  isProjectNotFoundError,
  isAgentNotFoundError,
  type AgentMailState,
} from "./agent-mail";

/**
 * Re-export swarm-mail module (embedded event-sourced)
 *
 * Includes:
 * - swarmMailTools - All swarm mail tool definitions
 * - setSwarmMailProjectDirectory, getSwarmMailProjectDirectory - Directory management
 * - clearSessionState - Session cleanup
 * - SwarmMailState - Session state type
 *
 * Features:
 * - Embedded PGLite storage (no external server dependency)
 * - Event sourcing for full audit trail
 * - Offset-based resumability
 * - Materialized views for fast queries
 * - File reservation with conflict detection
 */
export {
  swarmMailTools,
  setSwarmMailProjectDirectory,
  getSwarmMailProjectDirectory,
  clearSessionState,
  type SwarmMailState,
} from "./swarm-mail";

/**
 * Re-export shared types from swarm-mail package
 *
 * Includes:
 * - MailSessionState - Shared session state type for Agent Mail and Swarm Mail
 */
export { type MailSessionState } from "swarm-mail";

/**
 * Re-export structured module
 *
 * Includes:
 * - structuredTools - Structured output parsing tools
 * - Utility functions for JSON extraction
 */
export {
  structuredTools,
  extractJsonFromText,
  formatZodErrors,
  getSchemaByName,
} from "./structured";

/**
 * Re-export swarm module
 *
 * Includes:
 * - swarmTools - Swarm orchestration tools
 * - SwarmError, DecompositionError - Error classes
 * - formatSubtaskPrompt, formatEvaluationPrompt - Prompt helpers
 * - selectStrategy, formatStrategyGuidelines - Strategy selection helpers
 * - STRATEGIES - Strategy definitions
 *
 * Types:
 * - DecompositionStrategy - Strategy type union
 * - StrategyDefinition - Strategy definition interface
 *
 * NOTE: Prompt template strings (DECOMPOSITION_PROMPT, etc.) are NOT exported
 * to avoid confusing the plugin loader which tries to call all exports as functions
 */
export {
  swarmTools,
  SwarmError,
  DecompositionError,
  formatSubtaskPrompt,
  formatSubtaskPromptV2,
  formatEvaluationPrompt,
  SUBTASK_PROMPT_V2,
  // Strategy exports
  STRATEGIES,
  selectStrategy,
  formatStrategyGuidelines,
  type DecompositionStrategy,
  type StrategyDefinition,
} from "./swarm";

// =============================================================================
// Unified Tool Registry for CLI
// =============================================================================

/**
 * All tools in a single registry for CLI tool execution
 *
 * This is used by `swarm tool <name>` command to dynamically execute tools.
 * Each tool has an `execute` function that takes (args, ctx) and returns a string.
 *
 * Note: hiveTools includes both hive_* and beads_* (legacy aliases)
 */
export const allTools = {
  ...hiveTools,
  ...swarmMailTools,
  ...structuredTools,
  ...swarmTools,
  ...worktreeTools,
  ...reviewTools,
  ...repoCrawlTools,
  ...skillsTools,
  ...mandateTools,
  ...memoryTools,
  ...observabilityTools,
  ...contributorTools,
} as const;

/**
 * Type for CLI tool names (all available tools)
 */
export type CLIToolName = keyof typeof allTools;

/**
 * Re-export storage module
 *
 * Includes:
 * - createStorage, createStorageWithFallback - Factory functions
 * - getStorage, setStorage, resetStorage - Global instance management
 * - InMemoryStorage, SemanticMemoryStorage - Storage implementations
 * - isSemanticMemoryAvailable - Availability check
 * - DEFAULT_STORAGE_CONFIG - Default configuration
 *
 * Types:
 * - LearningStorage - Unified storage interface
 * - StorageConfig, StorageBackend, StorageCollections - Configuration types
 */
export {
  createStorage,
  createStorageWithFallback,
  getStorage,
  setStorage,
  resetStorage,
  InMemoryStorage,
  SemanticMemoryStorage,
  isSemanticMemoryAvailable,
  DEFAULT_STORAGE_CONFIG,
  type LearningStorage,
  type StorageConfig,
  type StorageBackend,
  type StorageCollections,
} from "./storage";

/**
 * Re-export tool-availability module
 *
 * Includes:
 * - checkTool, isToolAvailable - Check individual tool availability
 * - checkAllTools - Check all tools at once
 * - withToolFallback, ifToolAvailable - Execute with graceful fallback
 * - formatToolAvailability - Format availability for display
 * - resetToolCache - Reset cached availability (for testing)
 *
 * Types:
 * - ToolName - Supported tool names
 * - ToolStatus, ToolAvailability - Status types
 */
export {
  checkTool,
  isToolAvailable,
  checkAllTools,
  getToolAvailability,
  withToolFallback,
  ifToolAvailable,
  warnMissingTool,
  requireTool,
  formatToolAvailability,
  resetToolCache,
  type ToolName,
  type ToolStatus,
  type ToolAvailability,
} from "./tool-availability";

/**
 * Re-export repo-crawl module
 *
 * Includes:
 * - repoCrawlTools - All GitHub API repository research tools
 * - repo_readme, repo_structure, repo_tree, repo_file, repo_search - Individual tools
 * - RepoCrawlError - Error class
 *
 * Features:
 * - Parse repos from various formats (owner/repo, URLs)
 * - Optional GITHUB_TOKEN auth for higher rate limits (5000 vs 60 req/hour)
 * - Tech stack detection from file patterns
 * - Graceful rate limit handling
 */
export { repoCrawlTools, RepoCrawlError } from "./repo-crawl";

/**
 * Re-export skills module
 *
 * Implements Anthropic's Agent Skills specification for OpenCode.
 *
 * Includes:
 * - skillsTools - All skills tools (list, use, execute, read)
 * - discoverSkills, getSkill, listSkills - Discovery functions
 * - parseFrontmatter - YAML frontmatter parser
 * - getSkillsContextForSwarm - Swarm integration helper
 * - findRelevantSkills - Task-based skill matching
 *
 * Types:
 * - Skill, SkillMetadata, SkillRef - Skill data types
 */
export {
  skillsTools,
  discoverSkills,
  getSkill,
  listSkills,
  parseFrontmatter,
  setSkillsProjectDirectory,
  invalidateSkillsCache,
  getSkillsContextForSwarm,
  findRelevantSkills,
  type Skill,
  type SkillMetadata,
  type SkillRef,
} from "./skills";

/**
 * Re-export mandates module
 *
 * Agent voting system for collaborative knowledge curation.
 *
 * Includes:
 * - mandateTools - All mandate tools (file, vote, query, list, stats)
 * - MandateError - Error class
 *
 * Features:
 * - Submit ideas, tips, lore, snippets, and feature requests
 * - Vote on entries (upvote/downvote) with 90-day decay
 * - Semantic search for relevant mandates
 * - Status transitions based on consensus (candidate → established → mandate)
 * - Persistent storage with semantic-memory
 *
 * Types:
 * - MandateEntry, Vote, MandateScore - Core data types
 * - MandateStatus, MandateContentType - Enum types
 */
export { mandateTools, MandateError } from "./mandates";

/**
 * Re-export mandate-storage module
 *
 * Includes:
 * - createMandateStorage - Factory function
 * - getMandateStorage, setMandateStorage, resetMandateStorage - Global instance management
 * - updateMandateStatus, updateAllMandateStatuses - Status update helpers
 * - InMemoryMandateStorage, SemanticMemoryMandateStorage - Storage implementations
 *
 * Types:
 * - MandateStorage - Unified storage interface
 * - MandateStorageConfig, MandateStorageBackend, MandateStorageCollections - Configuration types
 */
export {
  createMandateStorage,
  getMandateStorage,
  setMandateStorage,
  resetMandateStorage,
  updateMandateStatus,
  updateAllMandateStatuses,
  InMemoryMandateStorage,
  SemanticMemoryMandateStorage,
  DEFAULT_MANDATE_STORAGE_CONFIG,
  type MandateStorage,
  type MandateStorageConfig,
  type MandateStorageBackend,
  type MandateStorageCollections,
} from "./mandate-storage";

/**
 * Re-export mandate-promotion module
 *
 * Includes:
 * - evaluatePromotion - Evaluate status transitions
 * - shouldPromote - Determine new status based on score
 * - formatPromotionResult - Format promotion result for display
 * - evaluateBatchPromotions, getStatusChanges, groupByTransition - Batch helpers
 *
 * Types:
 * - PromotionResult - Promotion evaluation result
 */
export {
  evaluatePromotion,
  shouldPromote,
  formatPromotionResult,
  evaluateBatchPromotions,
  getStatusChanges,
  groupByTransition,
  type PromotionResult,
} from "./mandate-promotion";

/**
 * Re-export output-guardrails module
 *
 * Includes:
 * - guardrailOutput - Main entry point for truncating tool output
 * - truncateWithBoundaries - Smart truncation preserving structure
 * - getToolLimit - Get character limit for a tool
 * - DEFAULT_GUARDRAIL_CONFIG - Default configuration
 *
 * Types:
 * - GuardrailConfig - Configuration interface
 * - GuardrailResult - Result of guardrail processing
 * - GuardrailMetrics - Analytics data
 */
export {
  guardrailOutput,
  truncateWithBoundaries,
  createMetrics,
  DEFAULT_GUARDRAIL_CONFIG,
  type GuardrailConfig,
  type GuardrailResult,
  type GuardrailMetrics,
} from "./output-guardrails";

/**
 * Re-export compaction-hook module
 *
 * Includes:
 * - SWARM_COMPACTION_CONTEXT - Prompt text for swarm state preservation
 * - createCompactionHook - Factory function for the compaction hook
 * - scanSessionMessages - Scan session for swarm state
 * - ScannedSwarmState - Scanned state interface
 *
 * Usage:
 * ```typescript
 * import { createCompactionHook } from "opencode-swarm-plugin";
 *
 * const hooks = {
 *   "experimental.session.compacting": createCompactionHook(),
 * };
 * ```
 */
export { 
  SWARM_COMPACTION_CONTEXT, 
  createCompactionHook,
  scanSessionMessages,
  type ScannedSwarmState,
} from "./compaction-hook";

/**
 * Re-export compaction-observability module
 *
 * Includes:
 * - CompactionPhase - Enum of compaction phases
 * - createMetricsCollector - Create a metrics collector
 * - recordPhaseStart, recordPhaseComplete - Phase timing
 * - recordPatternExtracted, recordPatternSkipped - Pattern tracking
 * - getMetricsSummary - Get metrics summary
 *
 * Types:
 * - CompactionMetrics - Mutable metrics collector
 * - CompactionMetricsSummary - Read-only summary snapshot
 *
 * Features:
 * - Phase timing breakdown (START, GATHER, DETECT, INJECT, COMPLETE)
 * - Pattern extraction tracking with reasons
 * - Success rate calculation
 * - Debug mode for verbose details
 * - JSON serializable for persistence
 *
 * Usage:
 * ```typescript
 * import { createMetricsCollector, CompactionPhase, recordPhaseStart } from "opencode-swarm-plugin";
 *
 * const metrics = createMetricsCollector({ session_id: "abc123" });
 * recordPhaseStart(metrics, CompactionPhase.DETECT);
 * // ... work ...
 * recordPhaseComplete(metrics, CompactionPhase.DETECT);
 * const summary = getMetricsSummary(metrics);
 * ```
 */
export {
  CompactionPhase,
  createMetricsCollector,
  recordPhaseStart,
  recordPhaseComplete,
  recordPatternExtracted,
  recordPatternSkipped,
  getMetricsSummary,
  type CompactionMetrics,
  type CompactionMetricsSummary,
} from "./compaction-observability";

/**
 * Re-export memory module
 *
 * Includes:
 * - memoryTools - All semantic-memory tools (store, find, get, remove, validate, list, stats, check)
 * - createMemoryAdapter - Factory function for memory adapter
 * - resetMemoryCache - Cache management for testing
 *
 * Types:
 * - MemoryAdapter - Memory adapter interface
 * - StoreArgs, FindArgs, IdArgs, ListArgs - Tool argument types
 * - StoreResult, FindResult, StatsResult, HealthResult, OperationResult - Result types
 */
export {
  memoryTools,
  createMemoryAdapter,
  resetMemoryCache,
  type MemoryAdapter,
  type StoreArgs,
  type FindArgs,
  type IdArgs,
  type ListArgs,
  type StoreResult,
  type FindResult,
  type StatsResult,
  type HealthResult,
  type OperationResult,
} from "./memory-tools";
export type { Memory, SearchResult, SearchOptions } from "swarm-mail";

/**
 * Re-export eval-history module
 *
 * Includes:
 * - recordEvalRun - Record eval run to JSONL history
 * - getScoreHistory - Get score history for a specific eval
 * - getPhase - Get current phase based on run count and variance
 * - calculateVariance - Calculate statistical variance of scores
 * - ensureEvalHistoryDir - Ensure history directory exists
 * - getEvalHistoryPath - Get path to eval history file
 *
 * Constants:
 * - DEFAULT_EVAL_HISTORY_PATH - Default path (.opencode/eval-history.jsonl)
 * - VARIANCE_THRESHOLD - Variance threshold for production phase (0.1)
 * - BOOTSTRAP_THRESHOLD - Run count for bootstrap phase (10)
 * - STABILIZATION_THRESHOLD - Run count for stabilization phase (50)
 *
 * Types:
 * - Phase - Progressive phases (bootstrap | stabilization | production)
 * - EvalRunRecord - Single eval run record
 */
export {
  recordEvalRun,
  getScoreHistory,
  getPhase,
  calculateVariance,
  ensureEvalHistoryDir,
  getEvalHistoryPath,
  DEFAULT_EVAL_HISTORY_PATH,
  VARIANCE_THRESHOLD,
  BOOTSTRAP_THRESHOLD,
  STABILIZATION_THRESHOLD,
  type Phase,
  type EvalRunRecord,
} from "./eval-history";

/**
 * Re-export eval-gates module
 *
 * Includes:
 * - checkGate - Check if current score passes quality gate
 * - DEFAULT_THRESHOLDS - Default regression thresholds by phase
 *
 * Types:
 * - GateResult - Result from gate check
 * - GateConfig - Configuration for gate thresholds
 *
 * Features:
 * - Phase-based regression thresholds (Bootstrap: none, Stabilization: 10%, Production: 5%)
 * - Configurable thresholds via GateConfig
 * - Clear pass/fail messages with baseline comparison
 * - Handles edge cases (division by zero, no history)
 */
export {
  checkGate,
  DEFAULT_THRESHOLDS,
  type GateResult,
  type GateConfig,
} from "./eval-gates";

/**
 * Re-export logger infrastructure
 *
 * Includes:
 * - getLogger - Gets or creates the main logger instance
 * - createChildLogger - Creates a module-specific child logger with separate log file
 * - logger - Default logger instance for immediate use
 *
 * Features:
 * - Daily log rotation via pino-roll (numeric format: swarm.1log, swarm.2log, etc.)
 * - 14-day retention
 * - Module-specific child loggers
 * - Pretty mode for development (SWARM_LOG_PRETTY=1)
 * - Logs to ~/.config/swarm-tools/logs/
 *
 * @example
 * ```typescript
 * import { logger, createChildLogger } from "opencode-swarm-plugin";
 *
 * // Use default logger
 * logger.info("Application started");
 *
 * // Create module-specific logger
 * const compactionLog = createChildLogger("compaction");
 * compactionLog.info("Compaction started");
 * ```
 */
export { getLogger, createChildLogger, logger } from "./logger";

/**
 * Re-export swarm-research module
 *
 * Includes:
 * - discoverDocTools - Discover available documentation tools
 * - getInstalledVersions - Get installed package versions from lockfile
 * - researchTools - Plugin tools for tool discovery and version detection
 *
 * Types:
 * - DiscoveredTool - Tool discovery result interface
 * - VersionInfo - Package version information
 */
export {
  discoverDocTools,
  getInstalledVersions,
  researchTools,
  type DiscoveredTool,
  type VersionInfo,
} from "./swarm-research";

/**
 * Re-export swarm-validation module
 *
 * Provides validation event types and hooks for post-swarm validation.
 * Integrates with swarm-mail event sourcing to emit validation events.
 *
 * Includes:
 * - ValidationIssueSeverity - Zod schema for severity levels (error, warning, info)
 * - ValidationIssueCategory - Zod schema for issue categories
 * - ValidationIssueSchema - Zod schema for validation issues
 * - runPostSwarmValidation - Main validation hook
 * - reportIssue - Helper to emit validation_issue events
 *
 * Types:
 * - ValidationIssue - Validation issue with severity, category, message, and optional location
 * - ValidationContext - Context for validation execution
 */
export {
  ValidationIssueSeverity,
  ValidationIssueCategory,
  ValidationIssueSchema,
  runPostSwarmValidation,
  reportIssue,
  type ValidationIssue,
  type ValidationContext,
} from "./swarm-validation";
