/**
 * Result Formatter Utilities
 *
 * Shared formatting functions for displaying tool results in a compact, scannable format.
 * Used by semantic-memory_find, cass_search, and similar tools.
 *
 * Output style inspired by OpenCode subagent UI - concise, information-dense,
 * with consistent visual hierarchy.
 */

import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

/**
 * Semantic memory search result
 */
export interface MemoryResult {
	/** Short ID for the memory (e.g., "abc123") */
	id: string;
	/** Similarity/relevance score (0-1) */
	score: number;
	/** Age in days since creation */
	age_days: number;
	/** Decay percentage (0-100, higher = more retained) */
	decay_percent: number;
	/** Memory content text */
	content: string;
	/** Optional collection name */
	collection?: string;
}

/**
 * CASS (Cross-Agent Session Search) result
 */
export interface CassResult {
	/** Agent that produced this session (e.g., "claude", "cursor") */
	agent: string;
	/** Path to the session file */
	path: string;
	/** Line number in the session file */
	line: number;
	/** Preview snippet of the matched content */
	preview: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Truncate text to a maximum length, adding ellipsis if truncated.
 *
 * @param text - Text to truncate
 * @param maxLen - Maximum length (not counting ellipsis)
 * @returns Truncated text with ellipsis if needed
 *
 * @example
 * truncate("hello world", 5)  // "hello..."
 * truncate("hi", 10)          // "hi"
 */
export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) {
		return text;
	}

	// Truncate and remove trailing whitespace
	const truncated = text.slice(0, maxLen).trimEnd();
	return `${truncated}...`;
}

/**
 * Format age in days to a compact human-readable string.
 *
 * @param days - Age in days (can be fractional)
 * @returns Formatted string like "12d", "3h", "5m"
 *
 * @example
 * formatAge(12)    // "12d"
 * formatAge(0.5)   // "12h"
 * formatAge(0.02)  // "29m"
 * formatAge(0)     // "<1d"
 */
export function formatAge(days: number): string {
	if (days === 0) {
		return "<1d";
	}

	if (days >= 1) {
		return `${Math.floor(days)}d`;
	}

	// Less than 1 day - show hours
	const hours = days * 24;
	if (hours >= 1) {
		return `${Math.floor(hours)}h`;
	}

	// Less than 1 hour - show minutes
	const minutes = hours * 60;
	return `${Math.floor(minutes)}m`;
}

/**
 * Format decay percentage with visual indicator.
 *
 * @param percent - Decay percentage (0-100)
 * @returns Formatted string like "91%"
 *
 * @example
 * formatDecay(91)    // "91%"
 * formatDecay(100)   // "100%"
 * formatDecay(0.5)   // "1%"
 */
export function formatDecay(percent: number): string {
	return `${Math.round(percent)}%`;
}

/**
 * Format a similarity/relevance score.
 *
 * @param score - Score value (typically 0-1)
 * @returns Formatted string with 2 decimal places
 *
 * @example
 * formatScore(0.57)   // "0.57"
 * formatScore(1.0)    // "1.00"
 * formatScore(0.567)  // "0.57"
 */
export function formatScore(score: number): string {
	return score.toFixed(2);
}

/**
 * Get the last N path components from a file path
 *
 * @param filePath - Full file path
 * @param components - Number of path components to include (default 2)
 * @returns Shortened path with last N components
 */
function getShortPath(filePath: string, components: number = 2): string {
	const parts = filePath.split(path.sep).filter(Boolean);
	if (parts.length <= components) {
		return parts.join("/");
	}
	return parts.slice(-components).join("/");
}

// ============================================================================
// Memory Result Formatter
// ============================================================================

/** Maximum length for content preview in memory results */
const MEMORY_CONTENT_MAX_LEN = 60;

/**
 * Format semantic memory search results in a compact list style.
 *
 * Output format:
 * ```
 * 📚 Semantic Memory (3 results for "auth tokens"):
 *   [abc123] OAuth refresh tokens need 5min buffer... (score: 0.57, decay: 91%, 12d)
 *   [def456] Next.js cache components gotcha... (score: 0.56, decay: 99%, 1d)
 *   [ghi789] Zod async validation anti-pattern... (score: 0.55, decay: 93%, 9d) [patterns]
 * ```
 *
 * @param results - Array of memory search results
 * @param query - The search query (for display in header)
 * @returns Formatted string ready for display
 */
export function formatMemoryResults(
	results: MemoryResult[],
	query: string,
): string {
	const count = results.length;
	const lines: string[] = [];

	// Header
	lines.push(`📚 Semantic Memory (${count} results for "${query}"):`);

	if (count === 0) {
		lines.push("  No matching memories found.");
		return lines.join("\n");
	}

	// Each result
	for (const result of results) {
		const id = result.id;
		const content = truncate(result.content, MEMORY_CONTENT_MAX_LEN);
		const score = formatScore(result.score);
		const decay = formatDecay(result.decay_percent);
		const age = formatAge(result.age_days);

		let line = `  [${id}] ${content} (score: ${score}, decay: ${decay}, ${age})`;

		// Add collection tag if present
		if (result.collection && result.collection !== "default") {
			line += ` [${result.collection}]`;
		}

		lines.push(line);
	}

	return lines.join("\n");
}

// ============================================================================
// CASS Result Formatter
// ============================================================================

/** Maximum length for preview text in CASS results */
const CASS_PREVIEW_MAX_LEN = 50;

/**
 * Format CASS (Cross-Agent Session Search) results in a compact list style.
 *
 * Output format:
 * ```
 * 🔍 CASS Search (3 results for "auth", 10 total):
 *   [claude] abc.jsonl:42 - "auth token refresh pattern..."
 *   [cursor] def.jsonl:89 - "similar authentication..."
 *   [opencode] ghi.jsonl:156 - "OAuth implementation..."
 * ```
 *
 * @param results - Array of CASS search results
 * @param query - The search query (for display in header)
 * @param total - Total number of matches (may differ from displayed count due to limit)
 * @returns Formatted string ready for display
 */
export function formatCassResults(
	results: CassResult[],
	query: string,
	total: number,
): string {
	const count = results.length;
	const lines: string[] = [];

	// Header with total if different from displayed count
	let header = `🔍 CASS Search (${count} results for "${query}"`;
	if (total > count) {
		header += `, ${total} total`;
	}
	header += "):";
	lines.push(header);

	if (count === 0) {
		lines.push("  No matching sessions found.");
		return lines.join("\n");
	}

	// Each result
	for (const result of results) {
		const agent = result.agent;
		const shortPath = getShortPath(result.path);
		const line = result.line;
		const preview = truncate(result.preview, CASS_PREVIEW_MAX_LEN);

		lines.push(`  [${agent}] ${shortPath}:${line} - "${preview}"`);
	}

	return lines.join("\n");
}
