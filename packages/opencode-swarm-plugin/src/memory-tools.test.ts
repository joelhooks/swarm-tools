/**
 * Memory Tools Integration Tests
 *
 * Tests for semantic-memory_* tool registration and execution.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
	memoryTools,
	resetMemoryCache,
	calculateDecayPercent,
	calculateAgeDays,
	HALF_LIFE_DAYS,
} from "./memory-tools";
import { closeAllSwarmMail } from "swarm-mail";

// ============================================================================
// Unit Tests (No Database Required)
// ============================================================================

describe("decay calculation utilities", () => {
	test("HALF_LIFE_DAYS is 90", () => {
		expect(HALF_LIFE_DAYS).toBe(90);
	});

	describe("calculateAgeDays", () => {
		test("returns 0 for current time", () => {
			const now = new Date();
			const age = calculateAgeDays(now.toISOString(), now);
			expect(age).toBe(0);
		});

		test("returns correct age in days", () => {
			const now = new Date("2024-12-31T00:00:00Z");
			const created = "2024-12-19T00:00:00Z"; // 12 days ago
			const age = calculateAgeDays(created, now);
			expect(age).toBe(12);
		});

		test("returns fractional days for partial days", () => {
			const now = new Date("2024-12-31T12:00:00Z"); // noon
			const created = "2024-12-31T00:00:00Z"; // midnight same day
			const age = calculateAgeDays(created, now);
			expect(age).toBeCloseTo(0.5, 5); // half a day
		});

		test("handles future dates gracefully (returns 0)", () => {
			const now = new Date("2024-12-01T00:00:00Z");
			const created = "2024-12-31T00:00:00Z"; // in the future
			const age = calculateAgeDays(created, now);
			expect(age).toBe(0);
		});
	});

	describe("calculateDecayPercent", () => {
		test("returns ~100% for brand new memory", () => {
			const now = new Date();
			const decay = calculateDecayPercent(now.toISOString(), now);
			expect(decay).toBeCloseTo(100, 1);
		});

		test("returns ~50% after one half-life (90 days)", () => {
			const now = new Date("2024-12-31T00:00:00Z");
			const created = "2024-10-02T00:00:00Z"; // 90 days ago
			const decay = calculateDecayPercent(created, now);
			expect(decay).toBeCloseTo(50, 1);
		});

		test("returns ~25% after two half-lives (180 days)", () => {
			const now = new Date("2024-12-31T00:00:00Z");
			const created = "2024-07-04T00:00:00Z"; // ~180 days ago
			const decay = calculateDecayPercent(created, now);
			expect(decay).toBeCloseTo(25, 1);
		});

		test("returns ~99% for 1-day old memory", () => {
			const now = new Date("2024-12-31T00:00:00Z");
			const created = "2024-12-30T00:00:00Z"; // 1 day ago
			const decay = calculateDecayPercent(created, now);
			// After 1 day with 90-day half-life: 0.5^(1/90) ≈ 0.9923 ≈ 99.23%
			expect(decay).toBeGreaterThan(99);
			expect(decay).toBeLessThan(100);
		});

		test("decay decreases with age", () => {
			const now = new Date("2024-12-31T00:00:00Z");
			const decay1 = calculateDecayPercent("2024-12-30T00:00:00Z", now); // 1 day
			const decay10 = calculateDecayPercent("2024-12-21T00:00:00Z", now); // 10 days
			const decay30 = calculateDecayPercent("2024-12-01T00:00:00Z", now); // 30 days
			const decay90 = calculateDecayPercent("2024-10-02T00:00:00Z", now); // 90 days

			expect(decay1).toBeGreaterThan(decay10);
			expect(decay10).toBeGreaterThan(decay30);
			expect(decay30).toBeGreaterThan(decay90);
		});
	});
});

// ============================================================================
// Integration Tests (Require Database)
// ============================================================================

describe("memory tools integration", () => {
	afterAll(async () => {
		resetMemoryCache();
		await closeAllSwarmMail();
	});

	test("all tools are registered with correct names", () => {
		const toolNames = Object.keys(memoryTools);
		expect(toolNames).toContain("semantic-memory_store");
		expect(toolNames).toContain("semantic-memory_find");
		expect(toolNames).toContain("semantic-memory_get");
		expect(toolNames).toContain("semantic-memory_remove");
		expect(toolNames).toContain("semantic-memory_validate");
		expect(toolNames).toContain("semantic-memory_list");
		expect(toolNames).toContain("semantic-memory_stats");
		expect(toolNames).toContain("semantic-memory_check");
		expect(toolNames).toContain("semantic-memory_upsert");
	});

	test("tools have execute functions", () => {
		for (const [name, tool] of Object.entries(memoryTools)) {
			expect(typeof tool.execute).toBe("function");
		}
	});

	describe("semantic-memory_store", () => {
		test("executes and returns JSON", async () => {
			const tool = memoryTools["semantic-memory_store"];
			const result = await tool.execute(
				{
					information: "Test memory for tools integration",
					tags: "test",
				},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(parsed.id).toBeDefined();
			expect(parsed.id).toMatch(/^mem-/); // swarm-mail uses hyphen, not underscore
			expect(parsed.message).toContain("Stored memory");
		});
	});

	describe("semantic-memory_find", () => {
		test("executes and returns compact formatted output", async () => {
			// Store a memory first
			const storeTool = memoryTools["semantic-memory_store"];
			await storeTool.execute(
				{
					information: "Findable test memory with unique keyword xyztest123",
				},
				{ sessionID: "test-session" } as any,
			);

			// Search for it
			const findTool = memoryTools["semantic-memory_find"];
			const result = await findTool.execute(
				{
					query: "xyztest123",
					limit: 5,
				},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			// Should have header with emoji and query
			expect(result).toContain("📚 Semantic Memory");
			expect(result).toContain("xyztest123");
			// Should show results count
			expect(result).toMatch(/\(\d+ results? for/);
		});

		test("shows score, decay, and age for each result", async () => {
			// Store a memory first
			const storeTool = memoryTools["semantic-memory_store"];
			await storeTool.execute(
				{
					information: "Memory for format testing uniquekeyword789",
				},
				{ sessionID: "test-session" } as any,
			);

			// Search for it
			const findTool = memoryTools["semantic-memory_find"];
			const result = await findTool.execute(
				{
					query: "uniquekeyword789",
					limit: 5,
				},
				{ sessionID: "test-session" } as any,
			);

			// Should have compact format with score, decay%, and age
			expect(result).toMatch(/score: \d+\.\d+/);
			expect(result).toMatch(/decay: \d+%/);
			expect(result).toMatch(/\d+[dhm]\)/); // age like "12d)" or "3h)"
		});

		test("handles empty results", async () => {
			const findTool = memoryTools["semantic-memory_find"];
			const result = await findTool.execute(
				{
					query: "nonexistent_query_that_will_match_nothing_xyz_abc_123",
					limit: 5,
				},
				{ sessionID: "test-session" } as any,
			);

			expect(result).toContain("📚 Semantic Memory");
			expect(result).toContain("0 results");
			expect(result).toContain("No matching memories found");
		});
	});

	describe("semantic-memory_stats", () => {
		test("returns memory and embedding counts", async () => {
			const tool = memoryTools["semantic-memory_stats"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(typeof parsed.memories).toBe("number");
			expect(typeof parsed.embeddings).toBe("number");
		});
	});

	describe("semantic-memory_check", () => {
		test("checks Ollama health", async () => {
			const tool = memoryTools["semantic-memory_check"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(typeof parsed.ollama).toBe("boolean");
		});
	});

	describe("semantic-memory_upsert", () => {
		// Skip AI-dependent tests if no API credits or key
		// These tests require working Vercel AI API (costs money)
		const skipAI = true; // TODO: Re-enable when API credits available
		
		test.skipIf(skipAI)("returns valid ADD operation result", async () => {
			const tool = memoryTools["semantic-memory_upsert"];
			const result = await tool.execute(
				{
					information: "Test memory for plugin tool",
					tags: "test,plugin",
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			
			expect(parsed.operation).toBe("ADD");
			expect(parsed.reason).toBeDefined();
			expect(parsed.memoryId).toBeDefined();
			expect(parsed.memoryId).toMatch(/^mem-/); // swarm-mail uses hyphen, not underscore
		});

		test.skipIf(skipAI)("includes autoTags when enabled", async () => {
			const tool = memoryTools["semantic-memory_upsert"];
			const result = await tool.execute(
				{
					information: "TypeScript is a typed superset of JavaScript",
					autoTag: true,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			
			expect(parsed.autoTags).toBeDefined();
			expect(parsed.autoTags.tags).toBeInstanceOf(Array);
			expect(parsed.autoTags.keywords).toBeInstanceOf(Array);
			expect(parsed.autoTags.category).toBe("general");
		});

		test.skipIf(skipAI)("includes linksCreated when autoLink enabled", async () => {
			const tool = memoryTools["semantic-memory_upsert"];
			const result = await tool.execute(
				{
					information: "React hooks enable functional components to use state",
					autoLink: true,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			
			expect(parsed.linksCreated).toBeDefined();
			expect(typeof parsed.linksCreated).toBe("number");
		});

		test.skipIf(skipAI)("includes entitiesExtracted when extractEntities enabled", async () => {
			const tool = memoryTools["semantic-memory_upsert"];
			const result = await tool.execute(
				{
					information: "Next.js 15 was released by Vercel in October 2024",
					extractEntities: true,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			
			expect(parsed.entitiesExtracted).toBeDefined();
			expect(typeof parsed.entitiesExtracted).toBe("number");
		});

		test("throws error when information is missing", async () => {
			const tool = memoryTools["semantic-memory_upsert"];
			
			await expect(async () => {
				await tool.execute(
					{
						tags: "test",
					} as any,
					{ sessionID: "test-session" } as any,
				);
			}).toThrow("information is required");
		});
	});
});
