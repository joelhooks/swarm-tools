/**
 * OpenCode Swarm Plugin
 *
 * A type-safe plugin for multi-agent coordination with beads issue tracking
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
 * // Programmatic usage
 * import { beadsTools, agentMailTools } from "opencode-swarm-plugin"
 * ```
 */
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";

import { beadsTools } from "./beads";
import {
  agentMailTools,
  type AgentMailState,
  AGENT_MAIL_URL,
} from "./agent-mail";
import { structuredTools } from "./structured";
import { swarmTools } from "./swarm";
import { repoCrawlTools } from "./repo-crawl";

/**
 * OpenCode Swarm Plugin
 *
 * Registers all swarm coordination tools:
 * - beads:* - Type-safe beads issue tracker wrappers
 * - agent-mail:* - Multi-agent coordination via Agent Mail MCP
 * - structured:* - Structured output parsing and validation
 * - swarm:* - Swarm orchestration and task decomposition
 * - repo-crawl:* - GitHub API tools for repository research
 *
 * @param input - Plugin context from OpenCode
 * @returns Plugin hooks including tools, events, and tool execution hooks
 */
export const SwarmPlugin: Plugin = async (
  input: PluginInput,
): Promise<Hooks> => {
  const { $ } = input;

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
        console.log(
          `[swarm-plugin] Auto-released ${activeAgentMailState.reservations.length} file reservation(s)`,
        );
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
     * - beads:create, beads:query, beads:update, etc.
     * - agent-mail:init, agent-mail:send, agent-mail:reserve, etc.
     * - repo-crawl:readme, repo-crawl:structure, etc.
     */
    tool: {
      ...beadsTools,
      ...agentMailTools,
      ...structuredTools,
      ...swarmTools,
      ...repoCrawlTools,
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
     * Hook after tool execution for automatic cleanup
     *
     * Auto-releases file reservations after swarm:complete or beads:close
     * to prevent stale locks when tasks finish.
     */
    "tool.execute.after": async (input, output) => {
      const toolName = input.tool;

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
        console.log(
          "[swarm-plugin] Auto-released reservations after swarm:complete",
        );
      }

      // Auto-sync beads after closing
      if (toolName === "beads_close") {
        // Trigger async sync without blocking - fire and forget
        void $`bd sync`
          .quiet()
          .nothrow()
          .then(() => {
            console.log("[swarm-plugin] Auto-synced beads after close");
          });
      }
    },
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
 * Re-export beads module
 *
 * Includes:
 * - beadsTools - All bead tool definitions
 * - Individual tool exports (beads_create, beads_query, etc.)
 * - BeadError, BeadValidationError - Error classes
 */
export * from "./beads";

/**
 * Re-export agent-mail module
 *
 * Includes:
 * - agentMailTools - All agent mail tool definitions
 * - AgentMailError, FileReservationConflictError - Error classes
 * - AgentMailState - Session state type
 *
 * NOTE: We selectively export to avoid exporting constants like AGENT_MAIL_URL
 * which would confuse the plugin loader (it tries to call all exports as functions)
 */
export {
  agentMailTools,
  AgentMailError,
  AgentMailNotInitializedError,
  FileReservationConflictError,
  type AgentMailState,
} from "./agent-mail";

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
 */
export const allTools = {
  ...beadsTools,
  ...agentMailTools,
  ...structuredTools,
  ...swarmTools,
  ...repoCrawlTools,
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
