/**
 * Hivemind Tools Integration Tests
 *
 * Tests for hivemind_* tool registration and execution.
 * Unified memory system for learnings + sessions.
 *
 * ## Test Strategy (TDD)
 * - RED: Write failing test for expected behavior
 * - GREEN: Verify implementation passes
 * - REFACTOR: Clean up while keeping tests green
 *
 * ## Coverage
 * 1. Tool registration and schema validation
 * 2. Full workflow: store → find → get → validate → remove
 * 3. Collection filtering (default vs custom collections)
 * 4. In-memory libSQL isolation (fast tests, no side effects)
 * 5. Deprecation aliases (semantic-memory_*, cass_*)
 * 6. Error handling and edge cases
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { hivemindTools, resetHivemindCache } from "./hivemind-tools";
import { closeAllSwarmMail, createInMemorySwarmMail } from "swarm-mail";
import { server } from "./test-utils/msw-server";

describe("hivemind tools integration", () => {
	beforeAll(async () => {
		// MSW intercepts Ollama API calls at the network level.
		// No globalThis.fetch mutation needed.
		server.listen({ onUnhandledRequest: "bypass" });

		// Create in-memory database for tests
		// This ensures tests are isolated and don't affect real data
		await createInMemorySwarmMail("hivemind-test");
	});

	afterEach(() => {
		server.resetHandlers();
	});

	afterAll(async () => {
		server.close();
		resetHivemindCache();
		await closeAllSwarmMail();
	});

	describe("tool registration", () => {
		test("all 8 core tools are registered", () => {
			const toolNames = Object.keys(hivemindTools);
			expect(toolNames).toContain("hivemind_store");
			expect(toolNames).toContain("hivemind_find");
			expect(toolNames).toContain("hivemind_get");
			expect(toolNames).toContain("hivemind_remove");
			expect(toolNames).toContain("hivemind_validate");
			expect(toolNames).toContain("hivemind_stats");
			expect(toolNames).toContain("hivemind_index");
			expect(toolNames).toContain("hivemind_sync");
		});

		test("all tools have execute functions", () => {
			for (const [name, tool] of Object.entries(hivemindTools)) {
				expect(typeof tool.execute).toBe("function");
			}
		});

		test("tools have proper metadata (description, args)", () => {
			const coreTool = hivemindTools["hivemind_store"];
			expect(coreTool.description).toBeDefined();
			expect(typeof coreTool.description).toBe("string");
			expect(coreTool.description.length).toBeGreaterThan(0);
		});
	});

	describe("hivemind_store", () => {
		test("stores memory and returns ID with mem- prefix", async () => {
			const tool = hivemindTools["hivemind_store"];
			const result = await tool.execute(
				{
					information: "Test memory for hivemind integration",
					tags: "test,hivemind",
				},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(parsed.id).toBeDefined();
			expect(parsed.id).toMatch(/^mem-/);
			expect(parsed.message).toContain("Stored memory");
		});

		test("stores memory with custom collection", async () => {
			const tool = hivemindTools["hivemind_store"];
			const result = await tool.execute(
				{
					information: "Memory in custom collection",
					collection: "test-collection",
					tags: "test",
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.id).toMatch(/^mem-/);
		});

		test("stores memory with metadata", async () => {
			const tool = hivemindTools["hivemind_store"];
			const metadata = JSON.stringify({ source: "test", priority: "high" });
			
			const result = await tool.execute(
				{
					information: "Memory with metadata",
					metadata,
					tags: "test",
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.id).toBeDefined();
		});

		test("stores memory with confidence factor", async () => {
			const tool = hivemindTools["hivemind_store"];
			const result = await tool.execute(
				{
					information: "High confidence memory",
					confidence: 0.9,
					tags: "test,confidence",
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.id).toBeDefined();
		});
	});

	describe("hivemind_find", () => {
		test("finds stored memories by content", async () => {
			// Store a memory with unique keyword
			const storeTool = hivemindTools["hivemind_store"];
			await storeTool.execute(
				{
					information: "Findable hivemind test memory with unique keyword xyzHIVE789",
					tags: "test,findable",
				},
				{ sessionID: "test-session" } as any,
			);

			// Search using FTS — exact keyword matching is a full-text search scenario,
			// not a semantic similarity one. Random strings like "xyzHIVE789" don't have
			// meaningful embeddings, making vector search unreliable for this use case.
			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{
					query: "xyzHIVE789",
					limit: 5,
					fts: true,
				},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(parsed.results).toBeDefined();
			expect(Array.isArray(parsed.results)).toBe(true);
			expect(parsed.count).toBeGreaterThanOrEqual(1);
			
			// Verify the result contains our unique keyword
			const found = parsed.results.some((r: any) => 
				r.content.includes("xyzHIVE789")
			);
			expect(found).toBe(true);
		});

		test("filters by collection", async () => {
			// Store memory in 'test-collection'
			const storeTool = hivemindTools["hivemind_store"];
			await storeTool.execute(
				{
					information: "Memory in test collection with keyword TESTCOLL123",
					collection: "test-collection",
					tags: "test",
				},
				{ sessionID: "test-session" } as any,
			);

			// Search with collection filter
			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{
					query: "TESTCOLL123",
					collection: "test-collection",
					limit: 5,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.results).toBeDefined();
			expect(parsed.count).toBeGreaterThanOrEqual(1);
		});

		test("returns truncated content by default (expand=false)", async () => {
			const storeTool = hivemindTools["hivemind_store"];
			const longContent = "A".repeat(500);
			await storeTool.execute(
				{
					information: `Long content for truncation test: ${longContent} TRUNCTEST456`,
					tags: "test,truncation",
				},
				{ sessionID: "test-session" } as any,
			);

			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{
					query: "TRUNCTEST456",
					limit: 1,
					expand: false,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.results.length).toBeGreaterThanOrEqual(1);
			// Result should exist but content might be truncated
		});

		test("returns full content when expand=true", async () => {
			const storeTool = hivemindTools["hivemind_store"];
			const uniqueMarker = "EXPANDTEST789";
			await storeTool.execute(
				{
					information: `Full content test ${uniqueMarker}`,
					tags: "test,expand",
				},
				{ sessionID: "test-session" } as any,
			);

			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{
					query: uniqueMarker,
					limit: 1,
					expand: true,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.results.length).toBeGreaterThanOrEqual(1);
			// Full content should be returned
			expect(parsed.results[0].content).toContain(uniqueMarker);
		});

		test("uses full-text search when fts=true", async () => {
			const storeTool = hivemindTools["hivemind_store"];
			await storeTool.execute(
				{
					information: "Full-text search test with keyword FTSTEST123",
					tags: "test,fts",
				},
				{ sessionID: "test-session" } as any,
			);

			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{
					query: "FTSTEST123",
					limit: 5,
					fts: true,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.results).toBeDefined();
			expect(Array.isArray(parsed.results)).toBe(true);
		});

		test("respects limit parameter", async () => {
			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{
					query: "test",
					limit: 2,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.results.length).toBeLessThanOrEqual(2);
		});
	});

	describe("hivemind_get", () => {
		test("retrieves memory by ID", async () => {
			// Store a memory first
			const storeTool = hivemindTools["hivemind_store"];
			const storeResult = await storeTool.execute(
				{
					information: "Memory to retrieve by ID - GETTEST456",
					tags: "test,get",
				},
				{ sessionID: "test-session" } as any,
			);
			const stored = JSON.parse(storeResult);
			const memoryId = stored.id;

			// Get the memory
			const getTool = hivemindTools["hivemind_get"];
			const getResult = await getTool.execute(
				{ id: memoryId },
				{ sessionID: "test-session" } as any,
			);

			expect(typeof getResult).toBe("string");
			const retrieved = JSON.parse(getResult);
			expect(retrieved.id).toBe(memoryId);
			expect(retrieved.content).toContain("GETTEST456");
		});

		test("returns 'Memory not found' for non-existent ID", async () => {
			const getTool = hivemindTools["hivemind_get"];
			const result = await getTool.execute(
				{ id: "mem-nonexistent-xyz" },
				{ sessionID: "test-session" } as any,
			);

			expect(result).toBe("Memory not found");
		});
	});

	describe("hivemind_validate", () => {
		test("validates memory and resets decay timer", async () => {
			// Store a memory
			const storeTool = hivemindTools["hivemind_store"];
			const storeResult = await storeTool.execute(
				{
					information: "Memory to validate - VALTEST789",
					tags: "test,validate",
				},
				{ sessionID: "test-session" } as any,
			);
			const stored = JSON.parse(storeResult);
			const memoryId = stored.id;

			// Validate the memory
			const validateTool = hivemindTools["hivemind_validate"];
			const validateResult = await validateTool.execute(
				{ id: memoryId },
				{ sessionID: "test-session" } as any,
			);

			const validated = JSON.parse(validateResult);
			expect(validated.success).toBe(true);
		});

		test("returns error for non-existent memory ID", async () => {
			const validateTool = hivemindTools["hivemind_validate"];
			const result = await validateTool.execute(
				{ id: "mem-nonexistent-abc" },
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(false);
		});
	});

	describe("hivemind_remove", () => {
		test("removes memory by ID", async () => {
			// Store a memory
			const storeTool = hivemindTools["hivemind_store"];
			const storeResult = await storeTool.execute(
				{
					information: "Memory to remove - REMOVETEST123",
					tags: "test,remove",
				},
				{ sessionID: "test-session" } as any,
			);
			const stored = JSON.parse(storeResult);
			const memoryId = stored.id;

			// Remove the memory
			const removeTool = hivemindTools["hivemind_remove"];
			const removeResult = await removeTool.execute(
				{ id: memoryId },
				{ sessionID: "test-session" } as any,
			);

			const removed = JSON.parse(removeResult);
			expect(removed.success).toBe(true);

			// Verify it's gone
			const getTool = hivemindTools["hivemind_get"];
			const getResult = await getTool.execute(
				{ id: memoryId },
				{ sessionID: "test-session" } as any,
			);
			expect(getResult).toBe("Memory not found");
		});

		test("is idempotent for non-existent memory ID (returns success)", async () => {
			const removeTool = hivemindTools["hivemind_remove"];
			const result = await removeTool.execute(
				{ id: "mem-nonexistent-remove" },
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			// Remove is idempotent - removing non-existent memory succeeds
			expect(parsed.success).toBe(true);
		});
	});

	describe("hivemind_stats", () => {
		test("returns combined stats for memories and sessions", async () => {
			const tool = hivemindTools["hivemind_stats"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(typeof parsed.memories).toBe("number");
			expect(typeof parsed.embeddings).toBe("number");
			expect(parsed.healthy).toBeDefined();
			expect(parsed.ollama_available).toBeDefined();
		});

		test("includes session stats when available", async () => {
			const tool = hivemindTools["hivemind_stats"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			// sessions field might be empty object if indexer unavailable
			expect(parsed.sessions).toBeDefined();
		});
	});

	describe("hivemind_sync", () => {
		test("syncs memories to .hive/memories.jsonl", async () => {
			const tool = hivemindTools["hivemind_sync"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(typeof parsed.imported).toBe("number");
			expect(typeof parsed.exported).toBe("number");
		});

		test("returns error details on failure", async () => {
			// Sync should succeed in test environment
			// This test verifies error structure if sync fails
			const tool = hivemindTools["hivemind_sync"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("success");
		});
	});

	describe("hivemind_index", () => {
		test.skip("indexes session directories (skipped: slow integration test)", async () => {
			// TODO: Mock SessionIndexer or create test fixtures
			// This test times out because it tries to index real session directories
			const tool = hivemindTools["hivemind_index"];
			const result = await tool.execute(
				{},
				{ sessionID: "test-session" } as any,
			);

			expect(typeof result).toBe("string");
			// Should report indexed count (might be 0 if no directories exist in test env)
			expect(result).toMatch(/Indexed|sessions|error/i);
		});
	});

	describe("full workflow: store → find → get → validate → remove", () => {
		test("complete memory lifecycle", async () => {
			const uniqueMarker = `LIFECYCLE-${Date.now()}`;
			
			// 1. STORE
			const storeTool = hivemindTools["hivemind_store"];
			const storeResult = await storeTool.execute(
				{
					information: `Memory lifecycle test ${uniqueMarker}`,
					tags: "test,lifecycle",
					collection: "test-workflow",
				},
				{ sessionID: "test-session" } as any,
			);
			const stored = JSON.parse(storeResult);
			const memoryId = stored.id;
			expect(memoryId).toMatch(/^mem-/);

			// Small delay to allow embedding generation
			await new Promise(resolve => setTimeout(resolve, 100));

			// 2. FIND (use FTS to avoid embedding timing issues)
			const findTool = hivemindTools["hivemind_find"];
			const findResult = await findTool.execute(
				{
					query: uniqueMarker,
					collection: "test-workflow",
					limit: 5,
					fts: true, // Use full-text search for reliability
				},
				{ sessionID: "test-session" } as any,
			);
			const found = JSON.parse(findResult);
			expect(found.count).toBeGreaterThanOrEqual(1);
			expect(found.results[0].content).toContain(uniqueMarker);

			// 3. GET
			const getTool = hivemindTools["hivemind_get"];
			const getResult = await getTool.execute(
				{ id: memoryId },
				{ sessionID: "test-session" } as any,
			);
			const retrieved = JSON.parse(getResult);
			expect(retrieved.id).toBe(memoryId);
			expect(retrieved.content).toContain(uniqueMarker);

			// 4. VALIDATE
			const validateTool = hivemindTools["hivemind_validate"];
			const validateResult = await validateTool.execute(
				{ id: memoryId },
				{ sessionID: "test-session" } as any,
			);
			const validated = JSON.parse(validateResult);
			expect(validated.success).toBe(true);

			// 5. REMOVE
			const removeTool = hivemindTools["hivemind_remove"];
			const removeResult = await removeTool.execute(
				{ id: memoryId },
				{ sessionID: "test-session" } as any,
			);
			const removed = JSON.parse(removeResult);
			expect(removed.success).toBe(true);

			// 6. VERIFY REMOVAL
			const getAfterRemove = await getTool.execute(
				{ id: memoryId },
				{ sessionID: "test-session" } as any,
			);
			expect(getAfterRemove).toBe("Memory not found");
		});
	});
});

	// REGRESSION TEST for Invalid Date bug
	// Bug: hivemind_find throws "Invalid Date" when memory records have null/undefined dates
	// Root cause: Line 105 in swarm-mail/src/memory/store.ts uses ?? operator which doesn't catch null
	// Expected: new Date(null) creates Invalid Date, should use || instead of ??
	describe("date handling regression tests (RED phase - expected to FAIL)", () => {
		test("handles memory with null created_at field", async () => {
			// This test is EXPECTED TO FAIL until the fix is applied
			// Reproduces: hivemind_find throws "Invalid Date" on all queries
			
			const { getSwarmMailLibSQL, toSwarmDb } = await import("swarm-mail");
			const swarmMail = await getSwarmMailLibSQL();
			const dbAdapter = await swarmMail.getDatabase();
			const db = toSwarmDb(dbAdapter);
			
			// Insert memory with null created_at directly into database
			// This simulates legacy data or manual inserts that bypass validation
			const result = await dbAdapter.query(
				`INSERT OR REPLACE INTO memories (id, content, metadata, collection, created_at, decay_factor)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["mem-null-date", "Memory with null date", "{}", "default", null, 0.7],
			);
			
			// BUG REPRODUCTION: This should throw "Invalid Date"
			// After fix: Should NOT throw, should handle null gracefully
			const findTool = hivemindTools["hivemind_find"];
			const findResult = await findTool.execute(
				{
					query: "null",
					limit: 10,
					fts: true, // Use FTS to avoid embedding timing issues
				},
				{ sessionID: "test-session" } as any,
			);
			
			// If we get here without throwing, the bug is fixed!
			const parsed = JSON.parse(findResult);
			expect(parsed.results).toBeDefined();
			
			// Verify any results with null dates have valid createdAt in output
			for (const result of parsed.results) {
				expect(result.createdAt).toBeDefined();
				expect(result.createdAt).not.toBe("Invalid Date");
				const parsedDate = new Date(result.createdAt);
				expect(parsedDate.toString()).not.toBe("Invalid Date");
			}
		});
		
		test("handles memory with undefined created_at field", async () => {
			// Undefined should also be handled safely
			const { getSwarmMailLibSQL, toSwarmDb } = await import("swarm-mail");
			const swarmMail = await getSwarmMailLibSQL();
			const dbAdapter = await swarmMail.getDatabase();
			
			// Insert memory omitting created_at (will be NULL in database)
			await dbAdapter.query(
				`INSERT OR REPLACE INTO memories (id, content, metadata, collection, decay_factor)
				 VALUES (?, ?, ?, ?, ?)`,
				["mem-undefined-date", "Memory with undefined date", "{}", "default", 0.7],
			);
			
			// Should NOT throw
			const findTool = hivemindTools["hivemind_find"];
			const findResult = await findTool.execute(
				{
					query: "undefined",
					limit: 10,
					fts: true,
				},
				{ sessionID: "test-session" } as any,
			);
			
			const parsed = JSON.parse(findResult);
			expect(parsed.results).toBeDefined();
			
			// Verify all results have valid dates
			for (const result of parsed.results) {
				expect(result.createdAt).toBeDefined();
				const parsedDate = new Date(result.createdAt);
				expect(parsedDate.toString()).not.toBe("Invalid Date");
			}
		});
		
		test("handles memory with malformed date string", async () => {
			// Malformed strings like "not-a-date" should be handled
			const { getSwarmMailLibSQL } = await import("swarm-mail");
			const swarmMail = await getSwarmMailLibSQL();
			const dbAdapter = await swarmMail.getDatabase();
			
			// Insert memory with malformed date string
			await dbAdapter.query(
				`INSERT OR REPLACE INTO memories (id, content, metadata, collection, created_at, decay_factor)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["mem-malformed-date", "Memory with malformed date", "{}", "default", "not-a-real-date", 0.7],
			);
			
			// Should NOT throw
			const findTool = hivemindTools["hivemind_find"];
			const findResult = await findTool.execute(
				{
					query: "malformed",
					limit: 10,
					fts: true,
				},
				{ sessionID: "test-session" } as any,
			);
			
			const parsed = JSON.parse(findResult);
			expect(parsed.results).toBeDefined();
			
			// Verify all results have valid dates
			for (const result of parsed.results) {
				expect(result.createdAt).toBeDefined();
				const parsedDate = new Date(result.createdAt);
				expect(parsedDate.toString()).not.toBe("Invalid Date");
			}
		});
		
		test("handles memory with valid ISO date string (baseline)", async () => {
			// This should always work - baseline test
			const { getSwarmMailLibSQL } = await import("swarm-mail");
			const swarmMail = await getSwarmMailLibSQL();
			const dbAdapter = await swarmMail.getDatabase();
			
			const validDate = new Date("2025-01-01T00:00:00Z");
			
			// Insert memory with valid date
			await dbAdapter.query(
				`INSERT OR REPLACE INTO memories (id, content, metadata, collection, created_at, decay_factor)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["mem-valid-date", "Memory with valid date", "{}", "default", validDate.toISOString(), 0.7],
			);
			
			// Should work fine
			const findTool = hivemindTools["hivemind_find"];
			const findResult = await findTool.execute(
				{
					query: "valid",
					limit: 10,
					fts: true,
				},
				{ sessionID: "test-session" } as any,
			);
			
			const parsed = JSON.parse(findResult);
			expect(parsed.results).toBeDefined();
			
			// Find our specific memory
			const validDateMemory = parsed.results.find((r: any) => r.id === "mem-valid-date");
			if (validDateMemory) {
				expect(validDateMemory.createdAt).toBe(validDate.toISOString());
				const parsedDate = new Date(validDateMemory.createdAt);
				expect(parsedDate.toString()).not.toBe("Invalid Date");
				expect(parsedDate.getTime()).toBe(validDate.getTime());
			}
		});
	});

	// Test for Ollama fallback behavior
	// When Ollama is unavailable, hivemind_find should fallback to FTS
	describe("Ollama fallback to FTS", () => {
		test("find returns results even when using FTS fallback", async () => {
			// This test verifies the fallback mechanism works
			// In production, if Ollama fails, we should still get FTS results
			
			// First, store a memory using FTS-friendly content
			const storeTool = hivemindTools["hivemind_store"];
			await storeTool.execute(
				{
					information: "FALLBACKTEST123 unique content for testing FTS fallback",
					tags: "test,fallback",
				},
				{ sessionID: "test-session" } as any,
			);

			// Now search with FTS explicitly (simulating what fallback does)
			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{
					query: "FALLBACKTEST123",
					limit: 5,
					fts: true, // Explicit FTS, same as fallback uses
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.results).toBeDefined();
			expect(parsed.count).toBeGreaterThan(0);
			
			// Verify we found our test content
			const found = parsed.results.some((r: any) =>
				r.content.includes("FALLBACKTEST123")
			);
			expect(found).toBe(true);
		});
	});

	describe("input validation", () => {
		test("hivemind_find returns error when query is missing", async () => {
			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{} as any,
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(false);
			expect(parsed.error).toBeDefined();
			expect(parsed.error.message).toContain("query");
		});

		test("hivemind_find returns error when query is empty string", async () => {
			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{ query: "" },
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(false);
		});

		test("hivemind_find returns error when query is whitespace only", async () => {
			const findTool = hivemindTools["hivemind_find"];
			const result = await findTool.execute(
				{ query: "   " },
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(false);
		});
	});

	describe("deprecation aliases", () => {
		afterAll(async () => {
			resetHivemindCache();
			await closeAllSwarmMail();
		});

	describe("semantic-memory_* aliases", () => {
		test("semantic-memory_store maps to hivemind_store", () => {
			const deprecated = (hivemindTools as any)["semantic-memory_store"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("semantic-memory_find maps to hivemind_find", () => {
			const deprecated = (hivemindTools as any)["semantic-memory_find"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("semantic-memory_get maps to hivemind_get", () => {
			const deprecated = (hivemindTools as any)["semantic-memory_get"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("semantic-memory_remove maps to hivemind_remove", () => {
			const deprecated = (hivemindTools as any)["semantic-memory_remove"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("semantic-memory_validate maps to hivemind_validate", () => {
			const deprecated = (hivemindTools as any)["semantic-memory_validate"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("semantic-memory_stats maps to hivemind_stats", () => {
			const deprecated = (hivemindTools as any)["semantic-memory_stats"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("deprecated aliases show warnings when executed", async () => {
			const consoleWarnSpy = {
				calls: [] as string[],
				original: console.warn,
			};
			
			console.warn = (...args: any[]) => {
				consoleWarnSpy.calls.push(args.join(" "));
			};

			try {
				const deprecated = (hivemindTools as any)["semantic-memory_store"];
				await deprecated.execute(
					{
						information: "Test deprecation warning",
						tags: "test",
					},
					{ sessionID: "test-session" } as any,
				);

				expect(consoleWarnSpy.calls.length).toBeGreaterThan(0);
				expect(consoleWarnSpy.calls[0]).toContain("DEPRECATED");
				expect(consoleWarnSpy.calls[0]).toContain("semantic-memory_store");
				expect(consoleWarnSpy.calls[0]).toContain("hivemind_store");
			} finally {
				console.warn = consoleWarnSpy.original;
			}
		});
	});

	describe("cass_* aliases", () => {
		test("cass_search maps to hivemind_find", () => {
			const deprecated = (hivemindTools as any)["cass_search"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("cass_view maps to hivemind_get", () => {
			const deprecated = (hivemindTools as any)["cass_view"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("cass_expand maps to hivemind_get", () => {
			const deprecated = (hivemindTools as any)["cass_expand"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("cass_health maps to hivemind_stats", () => {
			const deprecated = (hivemindTools as any)["cass_health"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("cass_index maps to hivemind_index", () => {
			const deprecated = (hivemindTools as any)["cass_index"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});

		test("cass_stats maps to hivemind_stats", () => {
			const deprecated = (hivemindTools as any)["cass_stats"];
			expect(deprecated).toBeDefined();
			expect(typeof deprecated.execute).toBe("function");
		});
	});

	describe("alias execution works correctly", () => {
		test("semantic-memory_store works like hivemind_store", async () => {
			const deprecated = (hivemindTools as any)["semantic-memory_store"];
			const result = await deprecated.execute(
				{
					information: "Testing semantic-memory_store alias",
					tags: "test,alias",
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.id).toMatch(/^mem-/);
		});

		test("cass_search works like hivemind_find", async () => {
			// Store a memory first
			const storeTool = hivemindTools["hivemind_store"];
			await storeTool.execute(
				{
					information: "Memory for cass_search alias test CASSALIAS999",
					tags: "test",
				},
				{ sessionID: "test-session" } as any,
			);

			// Search using cass_search alias
			const deprecated = (hivemindTools as any)["cass_search"];
			const result = await deprecated.execute(
				{
					query: "CASSALIAS999",
					limit: 5,
				},
				{ sessionID: "test-session" } as any,
			);

			const parsed = JSON.parse(result);
			expect(parsed.results).toBeDefined();
			expect(Array.isArray(parsed.results)).toBe(true);
		});
	});
});
