/**
 * Swarm Insights Data Layer Tests
 *
 * TDD: Red → Green → Refactor
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
	getStrategyInsights,
	getFileInsights,
	getPatternInsights,
	formatInsightsForPrompt,
	trackCoordinatorViolation,
	getViolationAnalytics,
	type StrategyInsight,
	type FileInsight,
	type PatternInsight,
} from "./swarm-insights";
import { createInMemorySwarmMail, type SwarmMailAdapter } from "swarm-mail";

describe("swarm-insights data layer", () => {
	let swarmMail: SwarmMailAdapter;

	beforeAll(async () => {
		swarmMail = await createInMemorySwarmMail("test-insights");
	});

	afterAll(async () => {
		await swarmMail.close();
	});

	describe("getStrategyInsights", () => {
		test("returns empty array when no data", async () => {
			const insights = await getStrategyInsights(swarmMail, "test-task");
			expect(insights).toEqual([]);
		});

		test("returns strategy success rates from outcomes", async () => {
			// Seed some outcome events (id is auto-increment, timestamp is integer)
			const db = await swarmMail.getDatabase();
			const now = Date.now();
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('subtask_outcome', 'test', ?, ?),
				('subtask_outcome', 'test', ?, ?),
				('subtask_outcome', 'test', ?, ?)`,
				[
					now,
					JSON.stringify({ strategy: "file-based", success: "true" }),
					now,
					JSON.stringify({ strategy: "file-based", success: "true" }),
					now,
					JSON.stringify({ strategy: "file-based", success: "false" }),
				],
			);

			const insights = await getStrategyInsights(swarmMail, "test-task");

			expect(insights.length).toBeGreaterThan(0);
			const fileBased = insights.find((i) => i.strategy === "file-based");
			expect(fileBased).toBeDefined();
			expect(fileBased?.successRate).toBeCloseTo(66.67, 0);
			expect(fileBased?.totalAttempts).toBe(3);
		});

		test("includes recommendation based on success rate", async () => {
			const insights = await getStrategyInsights(swarmMail, "test-task");
			const fileBased = insights.find((i) => i.strategy === "file-based");

			expect(fileBased?.recommendation).toBeDefined();
			expect(typeof fileBased?.recommendation).toBe("string");
		});
	});

	describe("getFileInsights", () => {
		test("returns empty array for unknown files", async () => {
			const insights = await getFileInsights(swarmMail, [
				"src/unknown-file.ts",
			]);
			expect(insights).toEqual([]);
		});

		test("returns past issues for known files", async () => {
			// Seed some file-related events (id is auto-increment, timestamp is integer)
			const db = await swarmMail.getDatabase();
			const now = Date.now();
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('subtask_outcome', 'test', ?, ?)`,
				[
					now,
					JSON.stringify({
						files_touched: ["src/auth.ts"],
						success: "false",
						error_count: 2,
					}),
				],
			);

			const insights = await getFileInsights(swarmMail, ["src/auth.ts"]);

			expect(insights.length).toBeGreaterThan(0);
			const authInsight = insights.find((i) => i.file === "src/auth.ts");
			expect(authInsight).toBeDefined();
			expect(authInsight?.failureCount).toBeGreaterThan(0);
		});

		test("includes gotchas from semantic memory", async () => {
			// This would query semantic memory for file-specific learnings
			const insights = await getFileInsights(swarmMail, ["src/auth.ts"]);

			// Even if no gotchas, the structure should be correct
			const authInsight = insights.find((i) => i.file === "src/auth.ts");
			expect(authInsight?.gotchas).toBeDefined();
			expect(Array.isArray(authInsight?.gotchas)).toBe(true);
		});
	});

	describe("getPatternInsights", () => {
		test("returns common failure patterns", async () => {
			const insights = await getPatternInsights(swarmMail);

			expect(Array.isArray(insights)).toBe(true);
			// Structure check
			if (insights.length > 0) {
				expect(insights[0]).toHaveProperty("pattern");
				expect(insights[0]).toHaveProperty("frequency");
				expect(insights[0]).toHaveProperty("recommendation");
			}
		});

		test("includes anti-patterns from learning system", async () => {
			const insights = await getPatternInsights(swarmMail);

			// Should include anti-patterns if any exist
			expect(Array.isArray(insights)).toBe(true);
		});
	});

	describe("formatInsightsForPrompt", () => {
		test("formats strategy insights concisely", () => {
			const strategies: StrategyInsight[] = [
				{
					strategy: "file-based",
					successRate: 85,
					totalAttempts: 20,
					recommendation: "Preferred for this project",
				},
				{
					strategy: "feature-based",
					successRate: 60,
					totalAttempts: 10,
					recommendation: "Use with caution",
				},
			];

			const formatted = formatInsightsForPrompt({ strategies });

			expect(formatted).toContain("file-based");
			expect(formatted).toContain("85%");
			expect(formatted.length).toBeLessThan(500); // Context-efficient
		});

		test("formats file insights concisely", () => {
			const files: FileInsight[] = [
				{
					file: "src/auth.ts",
					failureCount: 3,
					lastFailure: "2025-12-25",
					gotchas: ["Watch for race conditions in token refresh"],
				},
			];

			const formatted = formatInsightsForPrompt({ files });

			expect(formatted).toContain("src/auth.ts");
			expect(formatted).toContain("race conditions");
			expect(formatted.length).toBeLessThan(300); // Per-file budget
		});

		test("formats pattern insights concisely", () => {
			const patterns: PatternInsight[] = [
				{
					pattern: "Missing error handling",
					frequency: 5,
					recommendation: "Add try/catch around async operations",
				},
			];

			const formatted = formatInsightsForPrompt({ patterns });

			expect(formatted).toContain("Missing error handling");
			expect(formatted).toContain("try/catch");
		});

		test("respects token budget", () => {
			// Create many insights
			const strategies: StrategyInsight[] = Array.from({ length: 10 }, (_, i) => ({
				strategy: `strategy-${i}`,
				successRate: 50 + i * 5,
				totalAttempts: 10,
				recommendation: `Recommendation for strategy ${i}`,
			}));

			const formatted = formatInsightsForPrompt({ strategies }, { maxTokens: 200 });

			// Should truncate to fit budget
			expect(formatted.length).toBeLessThan(1000); // ~200 tokens ≈ 800 chars
		});

		test("returns empty string when no insights", () => {
			const formatted = formatInsightsForPrompt({});
			expect(formatted).toBe("");
		});
	});

	describe("getFileFailureHistory", () => {
		test("returns empty array for files with no review feedback", async () => {
			const { getFileFailureHistory } = await import("./swarm-insights");
			const history = await getFileFailureHistory(swarmMail, ["src/new-file.ts"]);
			expect(history).toEqual([]);
		});

		test("aggregates rejection reasons by file from review events", async () => {
			const { getFileFailureHistory } = await import("./swarm-insights");
			
			// Seed review_feedback events with rejection reasons
			const db = await swarmMail.getDatabase();
			const now = Date.now();
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('review_feedback', 'test', ?, ?),
				('review_feedback', 'test', ?, ?)`,
				[
					now,
					JSON.stringify({
						task_id: "task-1",
						status: "needs_changes",
						issues: JSON.stringify([
							{
								file: "src/auth.ts",
								line: 42,
								issue: "Missing null checks",
								suggestion: "Add null guard for user.email"
							}
						])
					}),
					now + 1000,
					JSON.stringify({
						task_id: "task-2",
						status: "needs_changes",
						issues: JSON.stringify([
							{
								file: "src/auth.ts",
								line: 58,
								issue: "Forgot rate limiting",
								suggestion: "Add rate limiter middleware"
							}
						])
					}),
				],
			);

			const history = await getFileFailureHistory(swarmMail, ["src/auth.ts"]);

			expect(history.length).toBe(1);
			const authHistory = history[0];
			expect(authHistory.file).toBe("src/auth.ts");
			expect(authHistory.rejectionCount).toBe(2);
			expect(authHistory.topIssues.length).toBeGreaterThan(0);
			expect(authHistory.topIssues[0]).toContain("null checks");
		});

		test("limits to top 3 warnings per file", async () => {
			const { getFileFailureHistory } = await import("./swarm-insights");
			
			// Seed many review feedback events for same file
			const db = await swarmMail.getDatabase();
			const now = Date.now();
			const issues = [
				"Missing null checks",
				"Forgot rate limiting", 
				"Type errors in response",
				"Memory leak in event listener",
				"Unused import statements"
			];
			
			for (let i = 0; i < issues.length; i++) {
				await db.query(
					`INSERT INTO events (type, project_key, timestamp, data) VALUES ('review_feedback', 'test', ?, ?)`,
					[
						now + i,
						JSON.stringify({
							task_id: `task-${i}`,
							status: "needs_changes",
							issues: JSON.stringify([
								{
									file: "src/api/client.ts",
									line: 10 + i,
									issue: issues[i],
									suggestion: "Fix it"
								}
							])
						})
					]
				);
			}

			const history = await getFileFailureHistory(swarmMail, ["src/api/client.ts"]);

			expect(history.length).toBe(1);
			expect(history[0].topIssues.length).toBeLessThanOrEqual(3);
		});
	});

	describe("formatFileHistoryWarnings", () => {
		test("formats file history as warning section", () => {
			const { formatFileHistoryWarnings } = require("./swarm-insights");
			
			const histories: Array<{ file: string; rejectionCount: number; topIssues: string[] }> = [
				{
					file: "src/auth.ts",
					rejectionCount: 3,
					topIssues: ["Missing null checks", "Forgot rate limiting"]
				},
				{
					file: "src/api/client.ts",
					rejectionCount: 2,
					topIssues: ["Rate limiting not implemented"]
				}
			];

			const formatted = formatFileHistoryWarnings(histories);

			expect(formatted).toContain("⚠️ FILE HISTORY WARNINGS:");
			expect(formatted).toContain("src/auth.ts");
			expect(formatted).toContain("3 previous workers");
			expect(formatted).toContain("Missing null checks");
		});

		test("returns empty string when no history", () => {
			const { formatFileHistoryWarnings } = require("./swarm-insights");
			const formatted = formatFileHistoryWarnings([]);
			expect(formatted).toBe("");
		});

		test("respects context budget", () => {
			const { formatFileHistoryWarnings } = require("./swarm-insights");
			
			// Create many histories
			const histories = Array.from({ length: 10 }, (_, i) => ({
				file: `src/file-${i}.ts`,
				rejectionCount: i + 1,
				topIssues: [`Issue ${i}A`, `Issue ${i}B`, `Issue ${i}C`]
			}));

			const formatted = formatFileHistoryWarnings(histories);

			// Should have warning header
			expect(formatted).toContain("⚠️ FILE HISTORY WARNINGS:");
			// Should be reasonably compact (rough estimate: 300 tokens ≈ 1200 chars)
			expect(formatted.length).toBeLessThan(1500);
		});
	});

	describe("getRejectionAnalytics", () => {
		test("returns valid structure with required fields", async () => {
			const { getRejectionAnalytics } = await import("./swarm-insights");
			const analytics = await getRejectionAnalytics(swarmMail);

			// Structure validation
			expect(typeof analytics.totalReviews).toBe("number");
			expect(typeof analytics.approved).toBe("number");
			expect(typeof analytics.rejected).toBe("number");
			expect(typeof analytics.approvalRate).toBe("number");
			expect(Array.isArray(analytics.topReasons)).toBe(true);
			
			// Consistency check
			expect(analytics.totalReviews).toBe(analytics.approved + analytics.rejected);
		});

		test("calculates approval/rejection rates from review_feedback events", async () => {
			const { getRejectionAnalytics } = await import("./swarm-insights");

			// Get baseline counts
			const beforeAnalytics = await getRejectionAnalytics(swarmMail);

			// Seed review_feedback events
			const db = await swarmMail.getDatabase();
			const now = Date.now();
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('review_feedback', 'test', ?, ?),
				('review_feedback', 'test', ?, ?),
				('review_feedback', 'test', ?, ?)`,
				[
					now,
					JSON.stringify({ status: "approved" }),
					now + 1000,
					JSON.stringify({ status: "needs_changes", issues: JSON.stringify([]) }),
					now + 2000,
					JSON.stringify({ status: "approved" }),
				],
			);

			const afterAnalytics = await getRejectionAnalytics(swarmMail);

			// Verify the delta (3 new reviews: 2 approved, 1 rejected)
			expect(afterAnalytics.totalReviews).toBe(beforeAnalytics.totalReviews + 3);
			expect(afterAnalytics.approved).toBe(beforeAnalytics.approved + 2);
			expect(afterAnalytics.rejected).toBe(beforeAnalytics.rejected + 1);
			
			// Verify consistency
			expect(afterAnalytics.totalReviews).toBe(afterAnalytics.approved + afterAnalytics.rejected);
		});

		test("categorizes rejection reasons from issues field", async () => {
			const { getRejectionAnalytics } = await import("./swarm-insights");

			// Seed rejection events with categorizable issues
			const db = await swarmMail.getDatabase();
			const now = Date.now();
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('review_feedback', 'test', ?, ?),
				('review_feedback', 'test', ?, ?),
				('review_feedback', 'test', ?, ?),
				('review_feedback', 'test', ?, ?)`,
				[
					now,
					JSON.stringify({
						status: "needs_changes",
						issues: JSON.stringify([
							{ file: "src/auth.ts", issue: "Missing tests for login function" },
						]),
					}),
					now + 1000,
					JSON.stringify({
						status: "needs_changes",
						issues: JSON.stringify([
							{ file: "src/api.ts", issue: "Type error: undefined is not assignable" },
						]),
					}),
					now + 2000,
					JSON.stringify({
						status: "needs_changes",
						issues: JSON.stringify([
							{ file: "src/auth.ts", issue: "Add unit tests for token refresh" },
						]),
					}),
					now + 3000,
					JSON.stringify({
						status: "needs_changes",
						issues: JSON.stringify([
							{ file: "src/db.ts", issue: "Implementation incomplete - missing error handling" },
						]),
					}),
				],
			);

			const analytics = await getRejectionAnalytics(swarmMail);

			expect(analytics.topReasons.length).toBeGreaterThan(0);

			// Should have "Missing tests" category with at least 2 occurrences
			const testsReason = analytics.topReasons.find((r) =>
				r.category.toLowerCase().includes("test"),
			);
			expect(testsReason).toBeDefined();
			expect(testsReason?.count).toBeGreaterThanOrEqual(2);

			// Should have "Type errors" category with at least 1 occurrence
			const typeReason = analytics.topReasons.find((r) =>
				r.category.toLowerCase().includes("type"),
			);
			expect(typeReason).toBeDefined();
			expect(typeReason?.count).toBeGreaterThanOrEqual(1);

			// Should have "Incomplete implementation" category
			const incompleteReason = analytics.topReasons.find((r) =>
				r.category.toLowerCase().includes("incomplete"),
			);
			expect(incompleteReason).toBeDefined();
		});

		test("limits to top 5 rejection reasons", async () => {
			const { getRejectionAnalytics } = await import("./swarm-insights");

			// Seed many different rejection types
			const db = await swarmMail.getDatabase();
			const now = Date.now();
			const issueTypes = [
				"Missing tests",
				"Type error",
				"Incomplete implementation",
				"Wrong file modified",
				"Missing error handling",
				"Performance issue",
				"Security vulnerability",
			];

			for (let i = 0; i < issueTypes.length; i++) {
				await db.query(
					`INSERT INTO events (type, project_key, timestamp, data) VALUES ('review_feedback', 'test', ?, ?)`,
					[
						now + i,
						JSON.stringify({
							status: "needs_changes",
							issues: JSON.stringify([{ file: "src/file.ts", issue: issueTypes[i] }]),
						}),
					],
				);
			}

			const analytics = await getRejectionAnalytics(swarmMail);

			expect(analytics.topReasons.length).toBeLessThanOrEqual(5);
		});

		test("includes other category for uncategorized rejections", async () => {
			const { getRejectionAnalytics } = await import("./swarm-insights");

			// Seed multiple rejections with non-standard issues to ensure it makes top 5
			const db = await swarmMail.getDatabase();
			const now = Date.now();
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('review_feedback', 'test', ?, ?),
				('review_feedback', 'test', ?, ?),
				('review_feedback', 'test', ?, ?)`,
				[
					now,
					JSON.stringify({
						status: "needs_changes",
						issues: JSON.stringify([
							{ file: "src/weird.ts", issue: "Something very unusual happened" },
						]),
					}),
					now + 1000,
					JSON.stringify({
						status: "needs_changes",
						issues: JSON.stringify([
							{ file: "src/strange.ts", issue: "Bizarre edge case encountered" },
						]),
					}),
					now + 2000,
					JSON.stringify({
						status: "needs_changes",
						issues: JSON.stringify([
							{ file: "src/odd.ts", issue: "Random unclassifiable problem" },
						]),
					}),
				],
			);

			const analytics = await getRejectionAnalytics(swarmMail);

			const otherReason = analytics.topReasons.find((r) =>
				r.category.toLowerCase().includes("other"),
			);
			expect(otherReason).toBeDefined();
			expect(otherReason?.count).toBeGreaterThanOrEqual(3);
		});
	});

	describe("trackCoordinatorViolation", () => {
		test("records violation event and returns ID", async () => {
			const eventId = await trackCoordinatorViolation(swarmMail, {
				project_key: "test-project",
				session_id: "session-123",
				epic_id: "mjudv5mwh66",
				violation_type: "coordinator_edited_file",
				payload: { tool: "edit", file: "src/auth.ts" },
			});

			expect(eventId).toBeGreaterThan(0);

			// Verify event was recorded
			const db = await swarmMail.getDatabase();
			const result = await db.query(
				`SELECT * FROM events WHERE id = ?`,
				[eventId],
			);

			expect(result.rows.length).toBe(1);
			const event = result.rows[0] as { type: string; data: string };
			expect(event.type).toBe("coordinator_violation");

			const data = JSON.parse(event.data);
			expect(data.session_id).toBe("session-123");
			expect(data.epic_id).toBe("mjudv5mwh66");
			expect(data.violation_type).toBe("coordinator_edited_file");
			expect(data.payload.tool).toBe("edit");
		});

		test("tracks different violation types", async () => {
			await trackCoordinatorViolation(swarmMail, {
				project_key: "test-project",
				session_id: "session-456",
				epic_id: "mjudv5mwh66",
				violation_type: "coordinator_ran_tests",
				payload: { tool: "bash", command: "bun test" },
			});

			await trackCoordinatorViolation(swarmMail, {
				project_key: "test-project",
				session_id: "session-789",
				epic_id: "mjudv5mwh66",
				violation_type: "coordinator_reserved_files",
				payload: { tool: "swarmmail_reserve", paths: ["src/auth.ts"] },
			});

			const db = await swarmMail.getDatabase();
			const result = await db.query(
				`SELECT COUNT(*) as count FROM events WHERE type = 'coordinator_violation'`,
				[],
			);

			expect((result.rows[0] as { count: number }).count).toBeGreaterThanOrEqual(3);
		});
	});

	describe("getViolationAnalytics", () => {
		test("returns zero analytics when no violations", async () => {
			// Use a fresh in-memory instance for isolation
			const freshSwarmMail = await createInMemorySwarmMail("test-no-violations");
			
			const analytics = await getViolationAnalytics(freshSwarmMail);

			expect(analytics.totalViolations).toBe(0);
			expect(analytics.byType).toEqual([]);
			expect(analytics.violationRate).toBe(0);

			await freshSwarmMail.close();
		});

		test("aggregates violations by type with percentages", async () => {
			// Seed violation events
			const db = await swarmMail.getDatabase();
			const now = Date.now();

			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('coordinator_violation', 'test', ?, ?),
				('coordinator_violation', 'test', ?, ?),
				('coordinator_violation', 'test', ?, ?),
				('coordinator_violation', 'test', ?, ?)`,
				[
					now,
					JSON.stringify({ violation_type: "coordinator_edited_file", session_id: "s1" }),
					now + 1000,
					JSON.stringify({ violation_type: "coordinator_edited_file", session_id: "s2" }),
					now + 2000,
					JSON.stringify({ violation_type: "coordinator_edited_file", session_id: "s3" }),
					now + 3000,
					JSON.stringify({ violation_type: "coordinator_ran_tests", session_id: "s4" }),
				],
			);

			const analytics = await getViolationAnalytics(swarmMail);

			expect(analytics.totalViolations).toBeGreaterThanOrEqual(4);
			expect(analytics.byType.length).toBeGreaterThan(0);

			const editedFile = analytics.byType.find(
				(v) => v.violationType === "coordinator_edited_file",
			);
			expect(editedFile).toBeDefined();
			expect(editedFile?.count).toBeGreaterThanOrEqual(3);
			expect(editedFile?.percentage).toBeGreaterThan(0);
		});

		test("calculates violation rate relative to coordination events", async () => {
			const db = await swarmMail.getDatabase();
			const now = Date.now();

			// Seed some coordination events (worker_spawned, review_feedback, message_sent)
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('worker_spawned', 'test', ?, ?),
				('worker_spawned', 'test', ?, ?),
				('review_feedback', 'test', ?, ?),
				('message_sent', 'test', ?, ?)`,
				[
					now,
					JSON.stringify({ worker: "BlueLake" }),
					now + 1000,
					JSON.stringify({ worker: "DarkHawk" }),
					now + 2000,
					JSON.stringify({ status: "approved" }),
					now + 3000,
					JSON.stringify({ from_agent: "coordinator", to_agents: ["BlueLake"] }),
				],
			);

			const analytics = await getViolationAnalytics(swarmMail);

			// violationRate = (totalViolations / coordinationCount) * 100
			expect(analytics.violationRate).toBeGreaterThanOrEqual(0);
			expect(analytics.violationRate).toBeLessThanOrEqual(100);
		});

		test("filters violations by project key", async () => {
			const db = await swarmMail.getDatabase();
			const now = Date.now();

			// Seed violations for different projects
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('coordinator_violation', 'project-A', ?, ?),
				('coordinator_violation', 'project-B', ?, ?)`,
				[
					now,
					JSON.stringify({ violation_type: "coordinator_edited_file", session_id: "sA" }),
					now + 1000,
					JSON.stringify({ violation_type: "coordinator_ran_tests", session_id: "sB" }),
				],
			);

			const analyticsA = await getViolationAnalytics(swarmMail, "project-A");
			const analyticsB = await getViolationAnalytics(swarmMail, "project-B");

			// Each project should have at least 1 violation
			expect(analyticsA.totalViolations).toBeGreaterThanOrEqual(1);
			expect(analyticsB.totalViolations).toBeGreaterThanOrEqual(1);
		});
	});
});
