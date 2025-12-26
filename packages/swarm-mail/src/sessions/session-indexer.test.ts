/**
 * SessionIndexer Tests
 *
 * Tests for the main orchestrator that ties all session components together.
 * Following TDD: RED → GREEN → REFACTOR
 *
 * @module sessions/session-indexer.test
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { SessionIndexer } from "./session-indexer.js";
import { createInMemoryDb, type SwarmDb } from "../db/client.js";
import { Effect } from "effect";
import { makeOllamaLive } from "../memory/ollama.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("SessionIndexer", () => {
	let db: SwarmDb;
	let indexer: SessionIndexer;
	let tmpDir: string;

	beforeAll(async () => {
		db = await createInMemoryDb();

		// Create Ollama layer for embeddings
		const ollamaLayer = makeOllamaLive({
			ollamaHost: "http://localhost:11434",
			ollamaModel: "mxbai-embed-large",
		});

		indexer = new SessionIndexer(db, ollamaLayer);

		// Create temp directory for test files
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-indexer-test-"));
	});

	afterAll(async () => {
		// Clean up temp directory
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	describe("indexFile", () => {
		test("indexes a valid session file", async () => {
			// Arrange: Create a test session file
			const sessionPath = path.join(tmpDir, "test-session.jsonl");
			const sessionData = [
				{
					session_id: "test-1",
					event_type: "tool_use",
					timestamp: "2025-12-25T10:00:00Z",
					payload: {
						tool: "bash",
						input: { command: "ls" },
					},
				},
				{
					session_id: "test-1",
					event_type: "tool_result",
					timestamp: "2025-12-25T10:00:01Z",
					payload: {
						tool: "bash",
						output: "file1.txt file2.txt",
					},
				},
			];

			await fs.writeFile(
				sessionPath,
				sessionData.map((e) => JSON.stringify(e)).join("\n"),
			);

			// Act: Index the file
			const result = await Effect.runPromise(indexer.indexFile(sessionPath));

			// Assert: Should return count of indexed chunks
			expect(result.indexed).toBeGreaterThan(0);
			expect(result.path).toBe(sessionPath);
			expect(result.agent_type).toBe("opencode-swarm"); // Default for now
		});

		test("handles malformed JSONL gracefully", async () => {
			// Arrange: Create file with some malformed lines
			const sessionPath = path.join(tmpDir, "malformed.jsonl");
			const content = [
				'{"session_id":"test-2","event_type":"foo","timestamp":"2025-12-25T10:00:00Z","payload":{}}',
				"NOT JSON",
				'{"session_id":"test-2","event_type":"bar","timestamp":"2025-12-25T10:00:01Z","payload":{}}',
			].join("\n");

			await fs.writeFile(sessionPath, content);

			// Act: Index the file
			const result = await Effect.runPromise(indexer.indexFile(sessionPath));

			// Assert: Should skip malformed lines but index valid ones
			expect(result.indexed).toBe(2);
			expect(result.skipped).toBe(1);
		});

		test("updates staleness tracker", async () => {
			// Arrange: Create a session file
			const sessionPath = path.join(tmpDir, "staleness-test.jsonl");
			const sessionData = {
				session_id: "test-3",
				event_type: "tool_use",
				timestamp: "2025-12-25T10:00:00Z",
				payload: { tool: "bash" },
			};

			await fs.writeFile(sessionPath, JSON.stringify(sessionData));

			// Act: Index the file
			await Effect.runPromise(indexer.indexFile(sessionPath));

			// Assert: Should record indexing
			const staleness = await Effect.runPromise(
				indexer.checkStaleness(sessionPath),
			);
			expect(staleness.isStale).toBe(false);
		});
	});

	describe("indexDirectory", () => {
		test("indexes all JSONL files in directory", async () => {
			// Arrange: Create multiple session files
			const dir = path.join(tmpDir, "multi-session");
			await fs.mkdir(dir, { recursive: true });

			const files = ["session1.jsonl", "session2.jsonl", "session3.jsonl"];

			for (const file of files) {
				const sessionData = {
					session_id: `multi-${file}`,
					event_type: "test",
					timestamp: "2025-12-25T10:00:00Z",
					payload: {},
				};
				await fs.writeFile(
					path.join(dir, file),
					JSON.stringify(sessionData),
				);
			}

			// Act: Index the directory
			const results = await Effect.runPromise(indexer.indexDirectory(dir));

			// Assert: Should index all 3 files
			expect(results.length).toBe(3);
			expect(results.every((r) => r.indexed > 0)).toBe(true);
		});

		test("skips non-JSONL files", async () => {
			// Arrange: Create directory with mixed file types
			const dir = path.join(tmpDir, "mixed-files");
			await fs.mkdir(dir, { recursive: true });

			await fs.writeFile(path.join(dir, "session.jsonl"), '{"test":1}');
			await fs.writeFile(path.join(dir, "README.md"), "# Sessions");
			await fs.writeFile(path.join(dir, "data.json"), "{}");

			// Act: Index the directory
			const results = await Effect.runPromise(indexer.indexDirectory(dir));

			// Assert: Should only index .jsonl files
			expect(results.length).toBe(1);
			expect(results[0].path).toContain("session.jsonl");
		});

		test("handles nested directories", async () => {
			// Arrange: Create nested directory structure
			const dir = path.join(tmpDir, "nested");
			const subdir = path.join(dir, "subdir");
			await fs.mkdir(subdir, { recursive: true });

			await fs.writeFile(
				path.join(dir, "root.jsonl"),
				'{"session_id":"root","event_type":"test","timestamp":"2025-12-25T10:00:00Z","payload":{}}',
			);
			await fs.writeFile(
				path.join(subdir, "sub.jsonl"),
				'{"session_id":"sub","event_type":"test","timestamp":"2025-12-25T10:00:00Z","payload":{}}',
			);

			// Act: Index with recursive option
			const results = await Effect.runPromise(
				indexer.indexDirectory(dir, { recursive: true }),
			);

			// Assert: Should find both files
			expect(results.length).toBe(2);
		});
	});

	describe("search", () => {
		test("searches indexed sessions", async () => {
			// Arrange: Index a session with known content
			const sessionPath = path.join(tmpDir, "search-test.jsonl");
			const sessionData = {
				session_id: "search-1",
				event_type: "tool_use",
				timestamp: "2025-12-25T10:00:00Z",
				payload: {
					tool: "bash",
					input: { command: "authentication debugging session" },
				},
			};

			await fs.writeFile(sessionPath, JSON.stringify(sessionData));
			await Effect.runPromise(indexer.indexFile(sessionPath));

			// Act: Search for related content
			const results = await Effect.runPromise(
				indexer.search("authentication errors", { limit: 5 }),
			);

			// Assert: Should find the indexed content
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].memory.content).toContain("authentication");
		});

		test("supports field projection", async () => {
			// Arrange: Index a session
			const sessionPath = path.join(tmpDir, "projection-test.jsonl");
			await fs.writeFile(
				sessionPath,
				'{"session_id":"proj-1","event_type":"test","timestamp":"2025-12-25T10:00:00Z","payload":{}}',
			);
			await Effect.runPromise(indexer.indexFile(sessionPath));

			// Act: Search with minimal field projection
			const results = await Effect.runPromise(
				indexer.search("test", { fields: "minimal" }),
			);

			// Assert: Should return only core fields (nested in memory object)
			// minimal preset: ["id", "content", "createdAt"] - no score
			const firstResult = results[0] as { memory: { id: string; content: string; createdAt: Date } };
			expect(firstResult).toHaveProperty("memory");
			expect(firstResult.memory).toHaveProperty("id");
			expect(firstResult.memory).toHaveProperty("content");
			// Should NOT have metadata in minimal mode
			expect(firstResult.memory).not.toHaveProperty("metadata");
		});
	});

	describe("getStats", () => {
		test("returns session statistics", async () => {
			// Arrange: Index sessions from different agent types
			const opencodeSession = path.join(tmpDir, "stats-opencode.jsonl");
			const claudeSession = path.join(tmpDir, "stats-claude.jsonl");

			await fs.writeFile(
				opencodeSession,
				'{"session_id":"oc-1","event_type":"test","timestamp":"2025-12-25T10:00:00Z","payload":{}}',
			);
			await fs.writeFile(
				claudeSession,
				'{"session_id":"cl-1","event_type":"test","timestamp":"2025-12-25T10:00:00Z","payload":{}}',
			);

			await Effect.runPromise(indexer.indexFile(opencodeSession));
			await Effect.runPromise(indexer.indexFile(claudeSession));

			// Act: Get statistics
			const stats = await Effect.runPromise(indexer.getStats());

			// Assert: Should return chunk counts
			// Note: total_sessions is 0 (TODO: needs unique session_id counting)
			expect(stats.total_chunks).toBeGreaterThan(0);
			expect(stats.by_agent).toBeDefined();
			expect(stats.by_agent["opencode-swarm"]).toBeDefined();
		});
	});

	describe("checkHealth", () => {
		test("reports index health", async () => {
			// Act: Check health
			const health = await Effect.runPromise(indexer.checkHealth());

			// Assert: Should return status
			expect(health).toHaveProperty("total_indexed");
			expect(health).toHaveProperty("stale_count");
			expect(health).toHaveProperty("fresh_count");
		});
	});
});
