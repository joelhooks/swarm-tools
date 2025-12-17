/**
 * Output Guardrails for MCP Tool Response Truncation
 *
 * Prevents MCP tools from blowing out context with massive responses.
 * Provides smart truncation that preserves JSON, code blocks, and markdown structure.
 *
 * @module output-guardrails
 *
 * @example
 * ```typescript
 * import { guardrailOutput, DEFAULT_GUARDRAIL_CONFIG } from "./output-guardrails"
 *
 * const result = guardrailOutput("context7_get-library-docs", hugeOutput)
 * if (result.truncated) {
 *   console.log(`Truncated ${result.originalLength - result.truncatedLength} chars`)
 * }
 * ```
 */

/**
 * Guardrail configuration for tool output limits
 *
 * Controls per-tool character limits and skip rules.
 */
export interface GuardrailConfig {
  /**
   * Default max characters for tool output
   * Default: 32000 chars (~8000 tokens at 4 chars/token)
   */
  defaultMaxChars: number;

  /**
   * Per-tool character limit overrides
   *
   * Higher limits for code/doc tools that commonly return large outputs.
   */
  toolLimits: Record<string, number>;

  /**
   * Tools that should never be truncated
   *
   * Internal coordination tools (beads_*, swarmmail_*, structured_*)
   * should always return complete output.
   */
  skipTools: string[];
}

/**
 * Result of guardrail output processing
 */
export interface GuardrailResult {
  /** Processed output (truncated if needed) */
  output: string;

  /** Whether truncation occurred */
  truncated: boolean;

  /** Original output length in characters */
  originalLength: number;

  /** Final output length in characters */
  truncatedLength: number;
}

/**
 * Metrics for guardrail analytics
 *
 * Used to track truncation patterns and adjust limits.
 */
export interface GuardrailMetrics {
  /** Tool that produced the output */
  toolName: string;

  /** Original output length */
  originalLength: number;

  /** Truncated output length */
  truncatedLength: number;

  /** Timestamp of truncation */
  timestamp: number;
}

/**
 * Default guardrail configuration
 *
 * - defaultMaxChars: 32000 (~8000 tokens)
 * - Higher limits for code/doc tools (64000)
 * - Skip internal coordination tools
 */
export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  defaultMaxChars: 32000,

  toolLimits: {
    // Higher limits for code/doc tools that commonly return large outputs
    "repo-autopsy_file": 64000,
    "repo-autopsy_search": 64000,
    "repo-autopsy_exports_map": 64000,
    "context7_get-library-docs": 64000,
    cass_view: 64000,
    cass_search: 48000,
    skills_read: 48000,

    // Lower limits for list/stats tools
    "repo-autopsy_structure": 24000,
    "repo-autopsy_stats": 16000,
    cass_stats: 8000,
  },

  skipTools: [
    // Beads tools - always return full output
    "hive_create",
    "hive_create_epic",
    "hive_query",
    "hive_update",
    "hive_close",
    "hive_start",
    "hive_ready",
    "hive_sync",

    // Agent Mail tools - always return full output
    "agentmail_init",
    "agentmail_send",
    "agentmail_inbox",
    "agentmail_read_message",
    "agentmail_summarize_thread",
    "agentmail_reserve",
    "agentmail_release",
    "agentmail_ack",

    // Swarm Mail tools - always return full output
    "swarmmail_init",
    "swarmmail_send",
    "swarmmail_inbox",
    "swarmmail_read_message",
    "swarmmail_reserve",
    "swarmmail_release",
    "swarmmail_ack",

    // Structured output tools - always return full output
    "structured_extract_json",
    "structured_validate",
    "structured_parse_evaluation",
    "structured_parse_decomposition",
    "structured_parse_cell_tree",

    // Swarm orchestration tools - always return full output
    "swarm_select_strategy",
    "swarm_plan_prompt",
    "swarm_decompose",
    "swarm_validate_decomposition",
    "swarm_status",
    "swarm_progress",
    "swarm_complete",
    "swarm_record_outcome",
    "swarm_subtask_prompt",
    "swarm_spawn_subtask",
    "swarm_complete_subtask",
    "swarm_evaluation_prompt",

    // Mandate tools - always return full output
    "mandate_file",
    "mandate_vote",
    "mandate_query",
    "mandate_list",
    "mandate_stats",
  ],
};

/**
 * Find matching closing brace for JSON truncation
 *
 * Walks forward from startIdx to find the matching closing brace,
 * respecting nested braces and brackets.
 *
 * @param text - Text to search
 * @param startIdx - Index of opening brace
 * @returns Index of matching closing brace, or -1 if not found
 */
function findMatchingBrace(text: string, startIdx: number): number {
  const openChar = text[startIdx];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 1;

  for (let i = startIdx + 1; i < text.length; i++) {
    if (text[i] === openChar) {
      depth++;
    } else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Smart truncation preserving structure boundaries
 *
 * Truncates text while preserving:
 * - JSON structure (finds matching braces, doesn't cut mid-object)
 * - Code blocks (preserves ``` boundaries)
 * - Markdown headers (cuts at ## boundaries when possible)
 *
 * @param text - Text to truncate
 * @param maxChars - Maximum character count
 * @returns Truncated text with "[TRUNCATED - X chars removed]" suffix
 */
export function truncateWithBoundaries(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  // Try to find a good truncation point
  let truncateAt = maxChars;

  // Check if we're in the middle of a JSON structure
  const beforeTruncate = text.slice(0, maxChars);
  const lastOpenBrace = Math.max(
    beforeTruncate.lastIndexOf("{"),
    beforeTruncate.lastIndexOf("["),
  );
  const lastCloseBrace = Math.max(
    beforeTruncate.lastIndexOf("}"),
    beforeTruncate.lastIndexOf("]"),
  );

  // If we have an unclosed brace/bracket, try to find the matching close
  if (lastOpenBrace > lastCloseBrace) {
    const matchingClose = findMatchingBrace(text, lastOpenBrace);
    if (matchingClose !== -1 && matchingClose < maxChars * 1.2) {
      // If the matching close is within 20% of maxChars, include it
      truncateAt = matchingClose + 1;
    } else {
      // Otherwise, truncate before the unclosed brace
      truncateAt = lastOpenBrace;
    }
  }

  // Check for code block boundaries (```)
  const codeBlockMarker = "```";
  const beforeTruncateForCode = text.slice(0, truncateAt);
  const codeBlockCount = (beforeTruncateForCode.match(/```/g) || []).length;

  // If we have an odd number of ``` markers, we're inside a code block
  if (codeBlockCount % 2 === 1) {
    // Try to find the closing ```
    const closeMarkerIdx = text.indexOf(codeBlockMarker, truncateAt);
    if (closeMarkerIdx !== -1 && closeMarkerIdx < maxChars * 1.2) {
      // If close marker is within 20% of maxChars, include it
      truncateAt = closeMarkerIdx + codeBlockMarker.length;
    } else {
      // Otherwise, truncate before the opening ```
      const lastOpenMarker = beforeTruncateForCode.lastIndexOf(codeBlockMarker);
      if (lastOpenMarker !== -1) {
        truncateAt = lastOpenMarker;
      }
    }
  }

  // Try to find a markdown header boundary (## or ###)
  const headerMatch = text.slice(0, truncateAt).match(/\n#{1,6}\s/g);
  if (headerMatch && headerMatch.length > 0) {
    const lastHeaderIdx = beforeTruncateForCode.lastIndexOf("\n##");
    if (lastHeaderIdx !== -1 && lastHeaderIdx > maxChars * 0.8) {
      // If we have a header within 80% of maxChars, truncate there
      truncateAt = lastHeaderIdx;
    }
  }

  // Ensure we don't truncate in the middle of a word
  // Walk back to the last whitespace
  while (truncateAt > 0 && !/\s/.test(text[truncateAt])) {
    truncateAt--;
  }

  const truncated = text.slice(0, truncateAt).trimEnd();
  const charsRemoved = text.length - truncated.length;

  return `${truncated}\n\n[TRUNCATED - ${charsRemoved.toLocaleString()} chars removed]`;
}

/**
 * Get the character limit for a specific tool
 *
 * @param toolName - Name of the tool
 * @param config - Guardrail configuration
 * @returns Character limit for the tool
 */
function getToolLimit(
  toolName: string,
  config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): number {
  return config.toolLimits[toolName] ?? config.defaultMaxChars;
}

/**
 * Apply guardrails to tool output
 *
 * Main entry point for guardrail processing:
 * 1. Check if tool is in skipTools → return unchanged
 * 2. Check if output.length > getToolLimit(toolName) → truncate
 * 3. Return { output, truncated, originalLength, truncatedLength }
 *
 * @param toolName - Name of the tool that produced the output
 * @param output - Tool output to process
 * @param config - Optional guardrail configuration (defaults to DEFAULT_GUARDRAIL_CONFIG)
 * @returns Guardrail result with truncated output and metadata
 *
 * @example
 * ```typescript
 * const result = guardrailOutput("context7_get-library-docs", hugeOutput)
 * console.log(result.output)  // Truncated or original
 * console.log(result.truncated)  // true if truncated
 * console.log(`${result.originalLength} → ${result.truncatedLength} chars`)
 * ```
 */
export function guardrailOutput(
  toolName: string,
  output: string,
  config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): GuardrailResult {
  const originalLength = output.length;

  // Check if tool should be skipped
  if (config.skipTools.includes(toolName)) {
    return {
      output,
      truncated: false,
      originalLength,
      truncatedLength: originalLength,
    };
  }

  // Get the limit for this tool
  const limit = getToolLimit(toolName, config);

  // Check if truncation is needed
  if (originalLength <= limit) {
    return {
      output,
      truncated: false,
      originalLength,
      truncatedLength: originalLength,
    };
  }

  // Truncate with smart boundaries
  const truncatedOutput = truncateWithBoundaries(output, limit);
  const truncatedLength = truncatedOutput.length;

  return {
    output: truncatedOutput,
    truncated: true,
    originalLength,
    truncatedLength,
  };
}

/**
 * Create a guardrail metrics entry
 *
 * Used for analytics and learning about truncation patterns.
 *
 * @param result - Guardrail result from guardrailOutput
 * @param toolName - Name of the tool
 * @returns Metrics entry
 */
export function createMetrics(
  result: GuardrailResult,
  toolName: string,
): GuardrailMetrics {
  return {
    toolName,
    originalLength: result.originalLength,
    truncatedLength: result.truncatedLength,
    timestamp: Date.now(),
  };
}
