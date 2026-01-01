/**
 * Swarm Insights Data Layer
 *
 * Aggregates insights from swarm coordination for prompt injection.
 * Provides concise, context-efficient summaries for coordinators and workers.
 *
 * Data sources:
 * - Event store (subtask_outcome, eval_finalized)
 * - Semantic memory (file-specific learnings)
 * - Anti-pattern registry
 */

import type { SwarmMailAdapter } from "swarm-mail";
import { getMemoryAdapter } from "./memory-tools.js";

// ============================================================================
// Types
// ============================================================================

export interface StrategyInsight {
	strategy: string;
	successRate: number;
	totalAttempts: number;
	recommendation: string;
}

export interface FileInsight {
	file: string;
	failureCount: number;
	lastFailure: string | null;
	gotchas: string[];
}

export interface FileFailureHistory {
	file: string;
	rejectionCount: number;
	topIssues: string[];
}

export interface PatternInsight {
	pattern: string;
	frequency: number;
	recommendation: string;
}

export interface InsightsBundle {
	strategies?: StrategyInsight[];
	files?: FileInsight[];
	patterns?: PatternInsight[];
}

export interface FormatOptions {
	maxTokens?: number;
}

export interface RejectionReason {
	category: string;
	count: number;
	percentage: number;
}

export interface RejectionAnalytics {
	totalReviews: number;
	approved: number;
	rejected: number;
	approvalRate: number;
	topReasons: RejectionReason[];
}

export interface ViolationMetric {
	violationType: string;
	count: number;
	percentage: number;
}

export interface ViolationAnalytics {
	totalViolations: number;
	byType: ViolationMetric[];
	violationRate: number; // violations per 100 coordination actions
}

// ============================================================================
// Strategy Insights
// ============================================================================

/**
 * Get strategy success rates and recommendations for a task.
 *
 * Queries the event store for subtask_outcome events and calculates
 * success rates by strategy. Returns recommendations based on historical data.
 *
 * @param swarmMail - SwarmMail adapter for database access
 * @param _task - Task description (currently unused, reserved for future filtering)
 * @returns Promise resolving to array of strategy insights with success rates and recommendations
 *
 * @example
 * ```typescript
 * const insights = await getStrategyInsights(swarmMail, "Add authentication");
 * // Returns: [
 * //   { strategy: "file-based", successRate: 85.5, totalAttempts: 12, recommendation: "..." },
 * //   { strategy: "feature-based", successRate: 65.0, totalAttempts: 8, recommendation: "..." }
 * // ]
 * ```
 */
export async function getStrategyInsights(
	swarmMail: SwarmMailAdapter,
	_task: string,
): Promise<StrategyInsight[]> {
	const db = await swarmMail.getDatabase();

	const query = `
		SELECT 
			json_extract(data, '$.strategy') as strategy,
			COUNT(*) as total_attempts,
			SUM(CASE WHEN json_extract(data, '$.success') = 'true' THEN 1 ELSE 0 END) as successes
		FROM events
		WHERE type = 'subtask_outcome'
		AND json_extract(data, '$.strategy') IS NOT NULL
		GROUP BY json_extract(data, '$.strategy')
		ORDER BY total_attempts DESC
	`;

	const result = await db.query(query, []);
	const rows = result.rows as Array<{
		strategy: string;
		total_attempts: number;
		successes: number;
	}>;

	return rows.map((row) => {
		const successRate = (row.successes / row.total_attempts) * 100;
		return {
			strategy: row.strategy,
			successRate: Math.round(successRate * 100) / 100,
			totalAttempts: row.total_attempts,
			recommendation: getStrategyRecommendation(row.strategy, successRate),
		};
	});
}

/**
 * Generate recommendation based on strategy and success rate.
 *
 * @param strategy - Strategy name (e.g., "file-based", "feature-based")
 * @param successRate - Success rate percentage (0-100)
 * @returns Recommendation string based on performance thresholds
 *
 * @example
 * ```typescript
 * getStrategyRecommendation("file-based", 85);
 * // Returns: "file-based is performing well (85% success)"
 *
 * getStrategyRecommendation("feature-based", 35);
 * // Returns: "AVOID feature-based - high failure rate (35%)"
 * ```
 */
function getStrategyRecommendation(strategy: string, successRate: number): string {
	if (successRate >= 80) {
		return `${strategy} is performing well (${successRate.toFixed(0)}% success)`;
	}
	if (successRate >= 60) {
		return `${strategy} is moderate - monitor for issues`;
	}
	if (successRate >= 40) {
		return `${strategy} has low success - consider alternatives`;
	}
	return `AVOID ${strategy} - high failure rate (${successRate.toFixed(0)}%)`;
}

// ============================================================================
// File Insights
// ============================================================================

/**
 * Get insights for specific files based on historical outcomes.
 *
 * Queries the event store for failures involving these files and
 * semantic memory for file-specific gotchas.
 *
 * @param swarmMail - SwarmMail adapter for database access
 * @param files - Array of file paths to analyze
 * @returns Promise resolving to array of file-specific insights including failure counts and gotchas
 *
 * @example
 * ```typescript
 * const insights = await getFileInsights(swarmMail, ["src/auth.ts", "src/db.ts"]);
 * // Returns: [
 * //   { file: "src/auth.ts", failureCount: 3, lastFailure: "2025-12-20T10:30:00Z", gotchas: [...] }
 * // ]
 * ```
 */
export async function getFileInsights(
	swarmMail: SwarmMailAdapter,
	files: string[],
): Promise<FileInsight[]> {
	if (files.length === 0) return [];

	const db = await swarmMail.getDatabase();
	const insights: FileInsight[] = [];

	for (const file of files) {
		// Query for failures involving this file
		const query = `
			SELECT 
				COUNT(*) as failure_count,
				MAX(timestamp) as last_failure
			FROM events
			WHERE type = 'subtask_outcome'
			AND json_extract(data, '$.success') = 'false'
			AND json_extract(data, '$.files_touched') LIKE ?
		`;

		const result = await db.query(query, [`%${file}%`]);
		const row = result.rows[0] as {
			failure_count: number;
			last_failure: string | null;
		};

		if (row && row.failure_count > 0) {
			// Query semantic memory for gotchas (simplified - would use actual memory search)
			const gotchas = await getFileGotchas(swarmMail, file);

			insights.push({
				file,
				failureCount: row.failure_count,
				lastFailure: row.last_failure,
				gotchas,
			});
		}
	}

	return insights;
}

/**
 * Truncate text to specified max length with ellipsis.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default 100)
 * @returns Truncated text with "..." suffix if needed
 */
function truncateText(text: string, maxLength = 100): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.slice(0, maxLength) + "...";
}

/**
 * Get file-specific gotchas from semantic memory (hivemind).
 *
 * Queries semantic memory for learnings related to a specific file.
 * Used in worker prompts to surface historical issues/warnings.
 *
 * Strategy:
 * 1. Query hivemind with file path + "gotcha pitfall warning" keywords
 * 2. Filter results to only include memories that mention the specific file
 * 3. Return top 3 learnings, truncated to ~100 chars each for context efficiency
 *
 * @param _swarmMail - SwarmMail adapter (unused, kept for API consistency)
 * @param file - File path to query learnings for
 * @returns Promise resolving to array of gotcha strings (max 3)
 *
 * @example
 * ```typescript
 * const gotchas = await getFileGotchas(swarmMail, "src/auth.ts");
 * // Returns semantic memory learnings like:
 * // ["OAuth tokens need 5min buffer before expiry to avoid race conditions in src/auth.ts", ...]
 * ```
 */
export async function getFileGotchas(
	_swarmMail: SwarmMailAdapter,
	file: string,
): Promise<string[]> {
	try {
		const memoryAdapter = await getMemoryAdapter();
		
		// Query hivemind with file path as context
		const result = await memoryAdapter.find({
			query: `${file} gotcha pitfall warning`,
			limit: 10, // Get more results to filter by file match
		});
		
		if (result.count === 0) {
			return [];
		}
		
		// Filter for results that actually mention the specific file, take top 3
		const fileSpecific = result.results
			.filter(memory => memory.content.includes(file))
			.slice(0, 3);
		
		// Truncate each gotcha to ~100 chars for context efficiency
		return fileSpecific.map(memory => truncateText(memory.content, 100));
	} catch (error) {
		// Gracefully handle errors - return empty array on failure
		console.warn(`Failed to query file gotchas for ${file}:`, error);
		return [];
	}
}

/**
 * Get failure history for specific files from review feedback events.
 *
 * Queries the event store for review_feedback events where status="needs_changes"
 * and aggregates rejection reasons by file. Returns top 3 most common issues per file.
 *
 * @param swarmMail - SwarmMail adapter for database access
 * @param files - Array of file paths to query history for
 * @returns Promise resolving to array of file failure histories with rejection counts and top issues
 *
 * @example
 * ```typescript
 * const history = await getFileFailureHistory(swarmMail, ["src/auth.ts", "src/db.ts"]);
 * // Returns: [
 * //   { file: "src/auth.ts", rejectionCount: 3, topIssues: ["Missing null checks", "Forgot rate limiting"] }
 * // ]
 * ```
 */
export async function getFileFailureHistory(
	swarmMail: SwarmMailAdapter,
	files: string[],
): Promise<FileFailureHistory[]> {
	if (files.length === 0) return [];

	const db = await swarmMail.getDatabase();
	const histories: FileFailureHistory[] = [];

	for (const file of files) {
		// Query for review_feedback events with needs_changes status
		// The issues field contains JSON array of ReviewIssue objects
		const query = `
			SELECT data
			FROM events
			WHERE type = 'review_feedback'
			AND json_extract(data, '$.status') = 'needs_changes'
			AND json_extract(data, '$.issues') LIKE ?
		`;

		const result = await db.query(query, [`%${file}%`]);
		
		if (!result.rows || result.rows.length === 0) {
			continue;
		}

		// Aggregate issues by file
		const issueTexts: string[] = [];
		for (const row of result.rows as Array<{ data: string }>) {
			try {
				const data = JSON.parse(row.data);
				const issuesStr = data.issues;
				if (!issuesStr) continue;
				
				const issues = JSON.parse(issuesStr);
				for (const issue of issues) {
					if (issue.file === file) {
						issueTexts.push(issue.issue);
					}
				}
			} catch (e) {
				// Skip malformed data
				continue;
			}
		}

		if (issueTexts.length === 0) {
			continue;
		}

		// Count frequency of each issue text
		const issueCounts = new Map<string, number>();
		for (const text of issueTexts) {
			issueCounts.set(text, (issueCounts.get(text) || 0) + 1);
		}

		// Sort by frequency and take top 3
		const topIssues = Array.from(issueCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([text]) => text);

		histories.push({
			file,
			rejectionCount: issueTexts.length,
			topIssues,
		});
	}

	return histories;
}

/**
 * Get rejection analytics from review feedback events.
 *
 * Analyzes review_feedback events to calculate approval/rejection rates and
 * categorize common rejection reasons. Returns aggregated analytics suitable
 * for the swarm stats --rejections dashboard.
 *
 * @param swarmMail - SwarmMail adapter for database access
 * @returns Promise resolving to rejection analytics with rates and categorized reasons
 *
 * @example
 * ```typescript
 * const analytics = await getRejectionAnalytics(swarmMail);
 * // Returns: {
 * //   totalReviews: 449,
 * //   approved: 175,
 * //   rejected: 274,
 * //   approvalRate: 38.97,
 * //   topReasons: [
 * //     { category: "Missing tests", count: 89, percentage: 32.48 },
 * //     { category: "Type errors", count: 67, percentage: 24.45 }
 * //   ]
 * // }
 * ```
 */
export async function getRejectionAnalytics(
	swarmMail: SwarmMailAdapter,
): Promise<RejectionAnalytics> {
	const db = await swarmMail.getDatabase();

	// Query all review_feedback events
	const query = `
		SELECT data
		FROM events
		WHERE type = 'review_feedback'
		ORDER BY timestamp DESC
	`;

	const result = await db.query(query, []);
	
	if (!result.rows || result.rows.length === 0) {
		return {
			totalReviews: 0,
			approved: 0,
			rejected: 0,
			approvalRate: 0,
			topReasons: [],
		};
	}

	let approved = 0;
	let rejected = 0;
	const reasonCounts = new Map<string, number>();

	for (const row of result.rows as Array<{ data: string }>) {
		try {
			const data = JSON.parse(row.data);
			
			if (data.status === "approved") {
				approved++;
			} else if (data.status === "needs_changes") {
				rejected++;

				// Parse issues and categorize
				if (data.issues) {
					const issues = JSON.parse(data.issues);
					for (const issue of issues) {
						const category = categorizeRejectionReason(issue.issue);
						reasonCounts.set(category, (reasonCounts.get(category) || 0) + 1);
					}
				}
			}
		} catch (e) {
			// Skip malformed data
			continue;
		}
	}

	const totalReviews = approved + rejected;
	const approvalRate = totalReviews > 0 ? (approved / totalReviews) * 100 : 0;

	// Sort reasons by count and take top 5
	const topReasons = Array.from(reasonCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([category, count]) => ({
			category,
			count,
			percentage: rejected > 0 ? (count / rejected) * 100 : 0,
		}));

	return {
		totalReviews,
		approved,
		rejected,
		approvalRate,
		topReasons,
	};
}

/**
 * Categorize a rejection reason into a standard category.
 *
 * Uses pattern matching to group similar issues into categories for analytics.
 *
 * @param reason - Raw rejection reason text from review feedback
 * @returns Categorized reason string
 *
 * @example
 * ```typescript
 * categorizeRejectionReason("Missing tests for login function");
 * // Returns: "Missing tests"
 *
 * categorizeRejectionReason("Type error: undefined is not assignable");
 * // Returns: "Type errors"
 * ```
 */
function categorizeRejectionReason(reason: string): string {
	const lowerReason = reason.toLowerCase();

	// Test-related issues
	if (
		lowerReason.includes("test") ||
		lowerReason.includes("spec") ||
		lowerReason.includes("coverage")
	) {
		return "Missing tests";
	}

	// Type-related issues
	if (
		lowerReason.includes("type") ||
		lowerReason.includes("undefined") ||
		lowerReason.includes("null") ||
		lowerReason.includes("assignable")
	) {
		return "Type errors";
	}

	// Implementation completeness issues
	if (
		lowerReason.includes("incomplete") ||
		lowerReason.includes("missing") ||
		lowerReason.includes("forgot") ||
		lowerReason.includes("didn't implement")
	) {
		return "Incomplete implementation";
	}

	// Wrong file issues
	if (
		lowerReason.includes("wrong file") ||
		lowerReason.includes("modified incorrect") ||
		lowerReason.includes("shouldn't have changed")
	) {
		return "Wrong file modified";
	}

	// Performance issues
	if (
		lowerReason.includes("performance") ||
		lowerReason.includes("slow") ||
		lowerReason.includes("inefficient")
	) {
		return "Performance issue";
	}

	// Security issues
	if (
		lowerReason.includes("security") ||
		lowerReason.includes("vulnerability") ||
		lowerReason.includes("unsafe")
	) {
		return "Security vulnerability";
	}

	// Error handling issues
	if (
		lowerReason.includes("error handling") ||
		lowerReason.includes("try/catch") ||
		lowerReason.includes("exception")
	) {
		return "Missing error handling";
	}

	// Default to "Other"
	return "Other";
}

// ============================================================================
// Pattern Insights
// ============================================================================

/**
 * Get common failure patterns and anti-patterns.
 *
 * Analyzes event store for recurring failure patterns and
 * queries the anti-pattern registry.
 *
 * @param swarmMail - SwarmMail adapter for database access
 * @returns Promise resolving to array of pattern insights with frequency and recommendations
 *
 * @example
 * ```typescript
 * const patterns = await getPatternInsights(swarmMail);
 * // Returns: [
 * //   { pattern: "type_error", frequency: 5, recommendation: "Add explicit type annotations and null checks" },
 * //   { pattern: "timeout", frequency: 3, recommendation: "Consider breaking into smaller tasks" }
 * // ]
 * ```
 */
export async function getPatternInsights(
	swarmMail: SwarmMailAdapter,
): Promise<PatternInsight[]> {
	const db = await swarmMail.getDatabase();
	const patterns: PatternInsight[] = [];

	// Query for common error patterns
	const query = `
		SELECT 
			json_extract(data, '$.error_type') as error_type,
			COUNT(*) as frequency
		FROM events
		WHERE type = 'subtask_outcome'
		AND json_extract(data, '$.success') = 'false'
		AND json_extract(data, '$.error_type') IS NOT NULL
		GROUP BY json_extract(data, '$.error_type')
		HAVING COUNT(*) >= 2
		ORDER BY frequency DESC
		LIMIT 5
	`;

	const result = await db.query(query, []);
	const rows = result.rows as Array<{
		error_type: string;
		frequency: number;
	}>;

	for (const row of rows) {
		patterns.push({
			pattern: row.error_type,
			frequency: row.frequency,
			recommendation: getPatternRecommendation(row.error_type),
		});
	}

	return patterns;
}

/**
 * Generate recommendation for a failure pattern.
 *
 * @param errorType - Type of error pattern (e.g., "type_error", "timeout", "conflict")
 * @returns Recommendation string for addressing the pattern
 *
 * @example
 * ```typescript
 * getPatternRecommendation("type_error");
 * // Returns: "Add explicit type annotations and null checks"
 *
 * getPatternRecommendation("unknown_error");
 * // Returns: "Address unknown_error issues"
 * ```
 */
function getPatternRecommendation(errorType: string): string {
	// Common patterns and their recommendations
	const recommendations: Record<string, string> = {
		type_error: "Add explicit type annotations and null checks",
		timeout: "Consider breaking into smaller tasks",
		conflict: "Check file reservations before editing",
		test_failure: "Run tests incrementally during implementation",
	};

	return recommendations[errorType] || `Address ${errorType} issues`;
}

// ============================================================================
// Prompt Formatting
// ============================================================================

/**
 * Format insights bundle for prompt injection.
 *
 * Produces a concise, context-efficient summary suitable for
 * inclusion in coordinator or worker prompts.
 *
 * @param bundle - Insights bundle containing strategies, files, and patterns
 * @param options - Formatting options (maxTokens defaults to 500)
 * @returns Formatted markdown string for prompt injection, or empty string if no insights
 *
 * @example
 * ```typescript
 * const bundle = {
 *   strategies: [{ strategy: "file-based", successRate: 85.5, totalAttempts: 12, recommendation: "..." }],
 *   files: [{ file: "src/auth.ts", failureCount: 2, lastFailure: null, gotchas: [] }],
 *   patterns: [{ pattern: "type_error", frequency: 3, recommendation: "Add type checks" }]
 * };
 * const formatted = formatInsightsForPrompt(bundle, { maxTokens: 300 });
 * // Returns formatted markdown with top 3 strategies, top 5 files, top 3 patterns
 * ```
 */
export function formatInsightsForPrompt(
	bundle: InsightsBundle,
	options: FormatOptions = {},
): string {
	const { maxTokens = 500 } = options;
	const sections: string[] = [];

	// Format strategy insights
	if (bundle.strategies && bundle.strategies.length > 0) {
		const strategyLines = bundle.strategies
			.slice(0, 3) // Top 3 strategies
			.map(
				(s) =>
					`- ${s.strategy}: ${s.successRate.toFixed(0)}% success (${s.totalAttempts} attempts)`,
			);
		sections.push(`**Strategy Performance:**\n${strategyLines.join("\n")}`);
	}

	// Format file insights
	if (bundle.files && bundle.files.length > 0) {
		const fileLines = bundle.files.slice(0, 5).map((f) => {
			const gotchaStr =
				f.gotchas.length > 0 ? ` - ${f.gotchas[0]}` : "";
			return `- ${f.file}: ${f.failureCount} past failures${gotchaStr}`;
		});
		sections.push(`**File-Specific Gotchas:**\n${fileLines.join("\n")}`);
	}

	// Format pattern insights
	if (bundle.patterns && bundle.patterns.length > 0) {
		const patternLines = bundle.patterns
			.slice(0, 3)
			.map((p) => `- ${p.pattern} (${p.frequency}x): ${p.recommendation}`);
		sections.push(`**Common Pitfalls:**\n${patternLines.join("\n")}`);
	}

	if (sections.length === 0) {
		return "";
	}

	let result = sections.join("\n\n");

	// Truncate to fit token budget (rough estimate: 4 chars per token)
	const maxChars = maxTokens * 4;
	if (result.length > maxChars) {
		result = result.slice(0, maxChars - 3) + "...";
	}

	return result;
}

// ============================================================================
// Caching (for future optimization)
// ============================================================================

// Simple in-memory cache with TTL
const insightsCache = new Map<
	string,
	{ data: InsightsBundle; expires: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached insights or compute fresh ones.
 *
 * Simple in-memory cache with 5-minute TTL to avoid redundant database queries.
 *
 * @param _swarmMail - SwarmMail adapter (currently unused, reserved for future cache invalidation)
 * @param cacheKey - Unique key for caching (e.g., "strategies:task-name" or "files:src/auth.ts")
 * @param computeFn - Function to compute fresh insights if cache miss
 * @returns Promise resolving to cached or freshly computed insights bundle
 *
 * @example
 * ```typescript
 * const insights = await getCachedInsights(
 *   swarmMail,
 *   "strategies:add-auth",
 *   async () => ({
 *     strategies: await getStrategyInsights(swarmMail, "add auth"),
 *   })
 * );
 * // First call: computes and caches. Subsequent calls within 5min: returns cached.
 * ```
 */
export async function getCachedInsights(
	_swarmMail: SwarmMailAdapter,
	cacheKey: string,
	computeFn: () => Promise<InsightsBundle>,
): Promise<InsightsBundle> {
	const cached = insightsCache.get(cacheKey);
	if (cached && cached.expires > Date.now()) {
		return cached.data;
	}

	const data = await computeFn();
	insightsCache.set(cacheKey, {
		data,
		expires: Date.now() + CACHE_TTL_MS,
	});

	return data;
}

/**
 * Clear the insights cache.
 *
 * Useful for testing or forcing fresh insights computation.
 *
 * @returns void
 *
 * @example
 * ```typescript
 * clearInsightsCache();
 * // All cached insights invalidated, next getCachedInsights() will recompute
 * ```
 */
export function clearInsightsCache(): void {
	insightsCache.clear();
}

// ============================================================================
// Violation Tracking and Metrics
// ============================================================================

/**
 * Track a coordinator violation event in the event store.
 *
 * Records when a coordinator attempts forbidden actions (editing files,
 * running tests, reserving files). These events feed violation analytics
 * for swarm health monitoring.
 *
 * @param swarmMail - SwarmMail adapter for database access
 * @param violation - Violation details
 * @returns Promise resolving to event ID
 *
 * @example
 * ```typescript
 * import { CoordinatorGuardError } from "./coordinator-guard";
 * 
 * try {
 *   // Coordinator attempts to edit file
 * } catch (error) {
 *   if (error instanceof CoordinatorGuardError) {
 *     await trackCoordinatorViolation(swarmMail, {
 *       project_key: "/abs/path/to/project",
 *       session_id: "session-123",
 *       epic_id: "mjudv5mwh66",
 *       violation_type: error.violationType,
 *       payload: error.payload,
 *     });
 *   }
 * }
 * ```
 */
export async function trackCoordinatorViolation(
	swarmMail: SwarmMailAdapter,
	violation: {
		project_key: string;
		session_id: string;
		epic_id: string;
		violation_type:
			| "coordinator_edited_file"
			| "coordinator_ran_tests"
			| "coordinator_reserved_files";
		payload: Record<string, unknown>;
	},
): Promise<number> {
	const db = await swarmMail.getDatabase();

	const query = `
		INSERT INTO events (type, project_key, timestamp, data)
		VALUES (?, ?, ?, ?)
		RETURNING id
	`;

	const data = JSON.stringify({
		session_id: violation.session_id,
		epic_id: violation.epic_id,
		event_type: "VIOLATION",
		violation_type: violation.violation_type,
		payload: violation.payload,
	});

	const result = await db.query(query, [
		"coordinator_violation",
		violation.project_key,
		Date.now(),
		data,
	]);

	return (result.rows[0] as { id: number }).id;
}

/**
 * Get violation analytics from coordinator guard events.
 *
 * Analyzes coordinator_violation events to calculate total violations,
 * breakdown by type, and violation rate relative to total coordination
 * actions. Used in swarm_status output to surface coordinator discipline.
 *
 * @param swarmMail - SwarmMail adapter for database access
 * @param projectKey - Optional project key to filter violations
 * @returns Promise resolving to violation analytics
 *
 * @example
 * ```typescript
 * const analytics = await getViolationAnalytics(swarmMail);
 * // Returns: {
 * //   totalViolations: 12,
 * //   byType: [
 * //     { violationType: "coordinator_edited_file", count: 8, percentage: 66.67 },
 * //     { violationType: "coordinator_ran_tests", count: 3, percentage: 25.00 },
 * //     { violationType: "coordinator_reserved_files", count: 1, percentage: 8.33 }
 * //   ],
 * //   violationRate: 2.4  // 12 violations per 500 coordination actions = 2.4%
 * // }
 * ```
 */
export async function getViolationAnalytics(
	swarmMail: SwarmMailAdapter,
	projectKey?: string,
): Promise<ViolationAnalytics> {
	const db = await swarmMail.getDatabase();

	// Query violation events, optionally filtered by project
	const violationsQuery = projectKey
		? `
		SELECT data
		FROM events
		WHERE type = 'coordinator_violation'
		AND project_key = ?
		ORDER BY timestamp DESC
	`
		: `
		SELECT data
		FROM events
		WHERE type = 'coordinator_violation'
		ORDER BY timestamp DESC
	`;

	const params = projectKey ? [projectKey] : [];
	const result = await db.query(violationsQuery, params);

	if (!result.rows || result.rows.length === 0) {
		return {
			totalViolations: 0,
			byType: [],
			violationRate: 0,
		};
	}

	// Aggregate violations by type
	const violationCounts = new Map<string, number>();
	let totalViolations = 0;

	for (const row of result.rows as Array<{ data: string }>) {
		try {
			const data = JSON.parse(row.data);
			const violationType = data.violation_type;

			if (violationType) {
				violationCounts.set(
					violationType,
					(violationCounts.get(violationType) || 0) + 1,
				);
				totalViolations++;
			}
		} catch (e) {
			// Skip malformed data
			continue;
		}
	}

	// Convert to sorted array
	const byType = Array.from(violationCounts.entries())
		.sort((a, b) => b[1] - a[1]) // Sort by count descending
		.map(([violationType, count]) => ({
			violationType,
			count,
			percentage: (count / totalViolations) * 100,
		}));

	// Calculate violation rate (violations per 100 coordination events)
	// Coordination events include: worker_spawned, review_feedback, message_sent (to workers)
	const coordinationQuery = projectKey
		? `
		SELECT COUNT(*) as count
		FROM events
		WHERE type IN ('worker_spawned', 'review_feedback', 'message_sent')
		AND project_key = ?
	`
		: `
		SELECT COUNT(*) as count
		FROM events
		WHERE type IN ('worker_spawned', 'review_feedback', 'message_sent')
	`;

	const coordResult = await db.query(coordinationQuery, params);
	const coordinationCount = (coordResult.rows[0] as { count: number })?.count || 0;

	const violationRate =
		coordinationCount > 0 ? (totalViolations / coordinationCount) * 100 : 0;

	return {
		totalViolations,
		byType,
		violationRate,
	};
}

// ============================================================================
// File History Warnings (for Worker Prompts)
// ============================================================================

/**
 * Format file failure history as warnings for worker prompts.
 *
 * Produces a concise warning section showing which files have caused
 * previous workers to fail review, with the top issues encountered.
 *
 * Limits output to fit context budget (~300 tokens).
 *
 * @param histories - Array of file failure histories
 * @returns Formatted warning section with emoji header, or empty string if no histories
 *
 * @example
 * ```typescript
 * const histories = [
 *   { file: "src/auth.ts", rejectionCount: 3, topIssues: ["Missing null checks", "Forgot rate limiting"] }
 * ];
 * const warnings = formatFileHistoryWarnings(histories);
 * // Returns:
 * // ⚠️ FILE HISTORY WARNINGS:
 * // - src/auth.ts: 3 previous workers rejected for missing null checks, forgot rate limiting
 * ```
 */
export function formatFileHistoryWarnings(
	histories: FileFailureHistory[],
): string {
	if (histories.length === 0) {
		return "";
	}

	const lines: string[] = ["⚠️ FILE HISTORY WARNINGS:"];

	for (const history of histories) {
		// Format: "- file: N previous workers rejected for issue1, issue2"
		const workerText = history.rejectionCount === 1
			? "1 previous worker rejected"
			: `${history.rejectionCount} previous workers rejected`;
		
		const issuesText = history.topIssues.join(", ");

		lines.push(`- ${history.file}: ${workerText} for ${issuesText}`);
	}

	let result = lines.join("\n");

	// Respect context budget (~300 tokens ≈ 1200 chars)
	const maxChars = 300 * 4;
	if (result.length > maxChars) {
		result = result.slice(0, maxChars - 3) + "...";
	}

	return result;
}
