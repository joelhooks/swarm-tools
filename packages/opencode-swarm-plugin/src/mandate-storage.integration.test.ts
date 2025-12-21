/**
 * Integration tests for mandate_* tools
 *
 * Tests the complete tool execution flow through tool.execute():
 * - mandate_file: Submit mandates
 * - mandate_vote: Cast votes with promotion logic
 * - mandate_query: Semantic search
 * - mandate_list: List with filters
 * - mandate_stats: Statistics calculation
 *
 * ## Test Pattern
 * - Call tool.execute() directly (simulates plugin invocation)
 * - Use InMemoryMandateStorage for isolation
 * - Test happy paths and real-world workflows
 * - Unit tests cover storage implementation details
 */

import type { ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	mandate_file,
	mandate_list,
	mandate_query,
	mandate_stats,
	mandate_vote,
} from "./mandates";
import {
	type MandateStorage,
	createMandateStorage,
	resetMandateStorage,
	setMandateStorage,
} from "./mandate-storage";

// Mock ToolContext for tool execution
const mockCtx = {} as ToolContext;

// Test storage instance
let storage: MandateStorage;

describe("Mandate Tools Integration", () => {
	beforeEach(async () => {
		// Create isolated in-memory storage for each test
		storage = createMandateStorage({ backend: "memory" });
		setMandateStorage(storage);
	});

	afterEach(async () => {
		// Clean up
		await resetMandateStorage();
	});

	// ============================================================================
	// mandate_file - Create and Store Mandate
	// ============================================================================

	describe("mandate_file integration", () => {
		it("creates mandate entry successfully", async () => {
			const result = await mandate_file.execute(
				{
					content: "Always use Effect for async operations",
					content_type: "tip",
					tags: ["async", "effect", "best-practices"],
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.mandate).toBeDefined();
			expect(parsed.mandate.id).toContain("mandate-");
			expect(parsed.mandate.content).toBe("Always use Effect for async operations");
			expect(parsed.mandate.status).toBe("candidate");
		});

		it("supports all content types", async () => {
			const types = ["idea", "tip", "lore", "snippet", "feature_request"] as const;

			for (const type of types) {
				const result = await mandate_file.execute(
					{
						content: `Test ${type}`,
						content_type: type,
						tags: [],
					},
					mockCtx,
				);

				const parsed = JSON.parse(result);
				expect(parsed.success).toBe(true);
				expect(parsed.mandate.content_type).toBe(type);
			}
		});

		it("supports metadata for snippets", async () => {
			const result = await mandate_file.execute(
				{
					content: 'const retry = <T>(fn: () => Promise<T>, n: number) => fn().catch(e => n > 0 ? retry(fn, n - 1) : Promise.reject(e));',
					content_type: "snippet",
					tags: ["typescript"],
					metadata: { language: "typescript", category: "retry" },
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.mandate.metadata).toEqual({
				language: "typescript",
				category: "retry",
			});
		});

		it("generates unique IDs", async () => {
			const results = await Promise.all([
				mandate_file.execute(
					{ content: "M1", content_type: "tip", tags: [] },
					mockCtx,
				),
				mandate_file.execute(
					{ content: "M2", content_type: "tip", tags: [] },
					mockCtx,
				),
				mandate_file.execute(
					{ content: "M3", content_type: "tip", tags: [] },
					mockCtx,
				),
			]);

			const ids = results.map((r) => JSON.parse(r).mandate.id);
			const uniqueIds = new Set(ids);
			expect(uniqueIds.size).toBe(3);
		});
	});

	// ============================================================================
	// mandate_vote - Cast Votes with Promotion
	// ============================================================================

	describe("mandate_vote integration", () => {
		let mandateId: string;

		beforeEach(async () => {
			// Create a mandate to vote on
			const createResult = await mandate_file.execute(
				{
					content: "Use TDD for all new features",
					content_type: "tip",
					tags: ["testing"],
				},
				mockCtx,
			);
			mandateId = JSON.parse(createResult).mandate.id;
		});

		it("casts upvote successfully with promotion data", async () => {
			const result = await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "TestAgent",
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.vote).toBeDefined();
			expect(parsed.vote.vote_type).toBe("upvote");
			expect(parsed.promotion).toBeDefined();
			expect(parsed.promotion.score).toBeDefined();
		});

		it("casts downvote successfully", async () => {
			const result = await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "downvote",
					agent_name: "TestAgent",
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.vote.vote_type).toBe("downvote");
		});

		it("defaults weight to 1.0", async () => {
			const result = await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "TestAgent",
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			// Tool hardcodes weight to 1.0 (see mandates.ts line 170)
			expect(parsed.vote.weight).toBe(1.0);
		});

		it("prevents duplicate votes from same agent", async () => {
			// First vote succeeds
			const result1 = await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "Agent1",
				},
				mockCtx,
			);
			expect(JSON.parse(result1).success).toBe(true);

			// Second vote from same agent fails
			await expect(
				mandate_vote.execute(
					{
						mandate_id: mandateId,
						vote_type: "downvote",
						agent_name: "Agent1",
					},
					mockCtx,
				),
			).rejects.toThrow("already voted");
		});

		it("allows different agents to vote", async () => {
			const result1 = await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "Agent1",
				},
				mockCtx,
			);
			expect(JSON.parse(result1).success).toBe(true);

			const result2 = await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "Agent2",
				},
				mockCtx,
			);
			expect(JSON.parse(result2).success).toBe(true);
		});
	});

	// ============================================================================
	// mandate_query - Semantic Search
	// ============================================================================

	describe("mandate_query integration", () => {
		beforeEach(async () => {
			// Create searchable mandates
			await mandate_file.execute(
				{
					content: "Always use Effect for async operations",
					content_type: "tip",
					tags: ["async", "effect"],
				},
				mockCtx,
			);
			await mandate_file.execute(
				{
					content: "Prefer semantic memory for persistence",
					content_type: "tip",
					tags: ["storage"],
				},
				mockCtx,
			);
		});

		it("searches by content text", async () => {
			const result = await mandate_query.execute(
				{ query: "Effect" },
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.count).toBeGreaterThanOrEqual(1);
			expect(parsed.results.length).toBeGreaterThanOrEqual(1);
			expect(parsed.results[0]).toHaveProperty("content");
			expect(parsed.results[0]).toHaveProperty("score");
		});

		it("limits results", async () => {
			const result = await mandate_query.execute(
				{ query: "tip", limit: 1 },
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.results.length).toBeLessThanOrEqual(1);
		});

		it("returns empty for non-matching query", async () => {
			const result = await mandate_query.execute(
				{ query: "nonexistent123xyz" },
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.count).toBe(0);
		});
	});

	// ============================================================================
	// mandate_list - List with Filters
	// ============================================================================

	describe("mandate_list integration", () => {
		beforeEach(async () => {
			await mandate_file.execute(
				{ content: "Tip 1", content_type: "tip", tags: [] },
				mockCtx,
			);
			await mandate_file.execute(
				{ content: "Idea 1", content_type: "idea", tags: [] },
				mockCtx,
			);
			await mandate_file.execute(
				{ content: "Lore 1", content_type: "lore", tags: [] },
				mockCtx,
			);
		});

		it("lists all mandates when no filter", async () => {
			const result = await mandate_list.execute({}, mockCtx);

			const parsed = JSON.parse(result);
			expect(parsed.count).toBe(3);
			expect(parsed.results.length).toBe(3);
		});

		it("filters by content_type", async () => {
			const result = await mandate_list.execute(
				{ content_type: "tip" },
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.count).toBe(1);
			expect(parsed.results[0].content_type).toBe("tip");
		});

		it("filters by status", async () => {
			const result = await mandate_list.execute(
				{ status: "candidate" },
				mockCtx,
			);

			const parsed = JSON.parse(result);
			// All new mandates start as candidate
			expect(parsed.count).toBe(3);
		});

		it("returns empty list when no matches", async () => {
			const result = await mandate_list.execute(
				{ status: "mandate" }, // No mandates promoted yet
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.count).toBe(0);
		});
	});

	// ============================================================================
	// mandate_stats - Statistics
	// ============================================================================

	describe("mandate_stats integration", () => {
		it("returns zero stats for empty storage", async () => {
			const result = await mandate_stats.execute({}, mockCtx);

			const parsed = JSON.parse(result);
			expect(parsed.total_mandates).toBe(0);
			expect(parsed.by_status).toBeDefined();
			expect(parsed.by_content_type).toBeDefined();
			expect(parsed.total_votes).toBe(0);
		});

		it("counts mandates by status", async () => {
			await mandate_file.execute(
				{ content: "Tip 1", content_type: "tip", tags: [] },
				mockCtx,
			);
			await mandate_file.execute(
				{ content: "Tip 2", content_type: "tip", tags: [] },
				mockCtx,
			);

			const result = await mandate_stats.execute({}, mockCtx);

			const parsed = JSON.parse(result);
			expect(parsed.total_mandates).toBe(2);
			expect(parsed.by_status.candidate).toBe(2);
		});

		it("counts mandates by content type", async () => {
			await mandate_file.execute(
				{ content: "Tip 1", content_type: "tip", tags: [] },
				mockCtx,
			);
			await mandate_file.execute(
				{ content: "Idea 1", content_type: "idea", tags: [] },
				mockCtx,
			);

			const result = await mandate_stats.execute({}, mockCtx);

			const parsed = JSON.parse(result);
			expect(parsed.by_content_type.tip).toBe(1);
			expect(parsed.by_content_type.idea).toBe(1);
		});

		it("counts total votes after voting", async () => {
			// Create mandate
			const createResult = await mandate_file.execute(
				{ content: "Test", content_type: "tip", tags: [] },
				mockCtx,
			);
			const mandateId = JSON.parse(createResult).mandate.id;

			// Cast votes
			await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "Agent1",
				},
				mockCtx,
			);
			await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "Agent2",
				},
				mockCtx,
			);

			const result = await mandate_stats.execute({}, mockCtx);

			const parsed = JSON.parse(result);
			expect(parsed.total_votes).toBe(2);
		});
	});

	// ============================================================================
	// Integration: Complete Workflows
	// ============================================================================

	describe("Complete voting workflow", () => {
		it("file → vote → query → stats workflow", async () => {
			// 1. File a mandate
			const createResult = await mandate_file.execute(
				{
					content: "Always write integration tests",
					content_type: "tip",
					tags: ["testing"],
				},
				mockCtx,
			);
			const mandateId = JSON.parse(createResult).mandate.id;

			// 2. Cast votes
			await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "Agent1",
				},
				mockCtx,
			);
			await mandate_vote.execute(
				{
					mandate_id: mandateId,
					vote_type: "upvote",
					agent_name: "Agent2",
				},
				mockCtx,
			);

			// 3. Query finds it
			const queryResult = await mandate_query.execute(
				{ query: "integration tests" },
				mockCtx,
			);
			const query = JSON.parse(queryResult);
			expect(query.count).toBeGreaterThanOrEqual(1);

			// 4. Stats reflect votes
			const statsResult = await mandate_stats.execute({}, mockCtx);
			const stats = JSON.parse(statsResult);
			expect(stats.total_votes).toBe(2);
			expect(stats.total_mandates).toBe(1);
		});

		it("supports multiple mandates with independent voting", async () => {
			// Create multiple mandates
			const create1 = await mandate_file.execute(
				{ content: "Mandate 1", content_type: "tip", tags: [] },
				mockCtx,
			);
			const create2 = await mandate_file.execute(
				{ content: "Mandate 2", content_type: "idea", tags: [] },
				mockCtx,
			);

			const mandate1Id = JSON.parse(create1).mandate.id;
			const mandate2Id = JSON.parse(create2).mandate.id;

			// Vote on both (different agents)
			await mandate_vote.execute(
				{
					mandate_id: mandate1Id,
					vote_type: "upvote",
					agent_name: "Agent1",
				},
				mockCtx,
			);
			await mandate_vote.execute(
				{
					mandate_id: mandate2Id,
					vote_type: "downvote",
					agent_name: "Agent1",
				},
				mockCtx,
			);

			// Stats show correct counts
			const statsResult = await mandate_stats.execute({}, mockCtx);
			const stats = JSON.parse(statsResult);
			expect(stats.total_votes).toBe(2);
			expect(stats.total_mandates).toBe(2);
		});
	});

	// ============================================================================
	// Edge Cases
	// ============================================================================

	describe("Edge cases and error handling", () => {
		it("handles unicode and special characters", async () => {
			const result = await mandate_file.execute(
				{
					content: "Use emoji for clarity 🎉 和 你好",
					content_type: "tip",
					tags: ["unicode"],
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.mandate.content).toContain("🎉");
		});

		it("handles empty tags array", async () => {
			const result = await mandate_file.execute(
				{
					content: "No tags mandate",
					content_type: "tip",
					tags: [],
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.mandate.tags).toEqual([]);
		});

		it("handles large metadata objects", async () => {
			const largeMetadata = {
				key1: "value1",
				nested: { deep: { object: "value" } },
				array: [1, 2, 3, 4, 5],
			};

			const result = await mandate_file.execute(
				{
					content: "Mandate with metadata",
					content_type: "snippet",
					tags: [],
					metadata: largeMetadata,
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.mandate.metadata).toEqual(largeMetadata);
		});
	});
});
