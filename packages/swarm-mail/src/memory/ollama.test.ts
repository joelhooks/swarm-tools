/**
 * Ollama Embedding Service Tests
 *
 * Tests the Ollama Effect-TS service with mocked fetch calls.
 * Following TDD: write tests first, then implementation.
 *
 * IMPORTANT: We save and restore global.fetch to avoid breaking other tests.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { Ollama, makeOllamaLive } from "./ollama.js";
import type { MemoryConfig } from "../types/index.js";

// Save original fetch to restore after each test
const originalFetch = global.fetch;

// ============================================================================
// Test Fixtures
// ============================================================================

const mockConfig: MemoryConfig = {
	ollamaHost: "http://localhost:11434",
	ollamaModel: "mxbai-embed-large",
};

const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);

const mockSuccessResponse = (embedding: number[]) =>
	Promise.resolve({
		ok: true,
		json: async () => ({ embedding }),
	} as Response);

const mockErrorResponse = (status: number, message: string) =>
	Promise.resolve({
		ok: false,
		status,
		text: async () => message,
	} as Response);

const mockHealthResponse = (models: Array<{ name: string }>) =>
	Promise.resolve({
		ok: true,
		json: async () => ({ models }),
	} as Response);

// ============================================================================
// Tests
// ============================================================================

describe("Ollama Service", () => {
	// Restore fetch after each test to avoid breaking other tests
	afterEach(() => {
		global.fetch = originalFetch;
	});

	describe("embed (single text)", () => {
		test("generates embedding for text", async () => {
			const mockFetch = mock(() => mockSuccessResponse(mockEmbedding));
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				const embedding = yield* ollama.embed("hello world");
				return embedding;
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

			expect(result).toEqual(mockEmbedding);
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0][0]).toBe(
				"http://localhost:11434/api/embeddings",
			);
		});

		test("sends correct payload to Ollama", async () => {
			let capturedBody: string | undefined;
			const mockFetch = mock((url, options) => {
				if (options?.body) {
					capturedBody = options.body as string;
				}
				return mockSuccessResponse(mockEmbedding);
			});
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				yield* ollama.embed("test text");
			});

			const layer = makeOllamaLive(mockConfig);
			await Effect.runPromise(program.pipe(Effect.provide(layer)));

			expect(capturedBody).toBeDefined();
			const parsed = JSON.parse(capturedBody!);
			expect(parsed).toEqual({
				model: "mxbai-embed-large",
				prompt: "test text",
			});
		});

		test("retries on transient failures", async () => {
			let attempts = 0;
			const mockFetch = mock(() => {
				attempts++;
				if (attempts < 3) {
					return mockErrorResponse(500, "Server temporarily unavailable");
				}
				return mockSuccessResponse(mockEmbedding);
			});
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embed("retry test");
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

			expect(result).toEqual(mockEmbedding);
			expect(attempts).toBe(3);
		});

		test("fails after max retries", async () => {
			const mockFetch = mock(() =>
				mockErrorResponse(500, "Permanent server error"),
			);
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embed("fail test");
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(
				program.pipe(Effect.provide(layer), Effect.flip),
			);

			expect(result._tag).toBe("OllamaError");
			expect(result.reason).toContain("Permanent server error");
		});

		test("handles connection errors", async () => {
			const mockFetch = mock(() =>
				Promise.reject(new Error("ECONNREFUSED")),
			);
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embed("connection test");
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(
				program.pipe(Effect.provide(layer), Effect.flip),
			);

			expect(result._tag).toBe("OllamaError");
			expect(result.reason).toContain("Connection failed");
		});

		test("handles invalid JSON responses", async () => {
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: true,
					json: async () => {
						throw new Error("Invalid JSON");
					},
				} as Response),
			);
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embed("json test");
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(
				program.pipe(Effect.provide(layer), Effect.flip),
			);

			expect(result._tag).toBe("OllamaError");
			expect(result.reason).toContain("Invalid JSON response");
		});
	});

	describe("embedBatch (multiple texts)", () => {
		test("generates embeddings for multiple texts", async () => {
			const mockFetch = mock(() => mockSuccessResponse(mockEmbedding));
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embedBatch(["text1", "text2", "text3"]);
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual(mockEmbedding);
			expect(result[1]).toEqual(mockEmbedding);
			expect(result[2]).toEqual(mockEmbedding);
			expect(mockFetch).toHaveBeenCalledTimes(3);
		});

		test("respects concurrency limit", async () => {
			let concurrentCalls = 0;
			let maxConcurrent = 0;

			const mockFetch = mock(async () => {
				concurrentCalls++;
				maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
				await new Promise((resolve) => setTimeout(resolve, 10));
				concurrentCalls--;
				return mockSuccessResponse(mockEmbedding);
			});
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embedBatch(
					["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"],
					2, // concurrency = 2
				);
			});

			const layer = makeOllamaLive(mockConfig);
			await Effect.runPromise(program.pipe(Effect.provide(layer)));

			expect(maxConcurrent).toBeLessThanOrEqual(2);
		});

		test("handles persistent failures in batch", async () => {
			// Track which text we're on by checking request body
			const mockFetch = mock((url, options) => {
				const body = JSON.parse(options?.body as string);
				// Always fail on "t2" text
				if (body.prompt === "t2") {
					return mockErrorResponse(500, "Persistent failure on t2");
				}
				return mockSuccessResponse(mockEmbedding);
			});
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.embedBatch(["t1", "t2", "t3"]);
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(
				program.pipe(Effect.provide(layer), Effect.flip),
			);

			expect(result._tag).toBe("OllamaError");
			expect(result.reason).toContain("Persistent failure on t2");
		});
	});

	describe("checkHealth", () => {
		test("succeeds when model is available", async () => {
			const mockFetch = mock(() =>
				mockHealthResponse([
					{ name: "mxbai-embed-large:latest" },
					{ name: "llama2:7b" },
				]),
			);
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				yield* ollama.checkHealth();
			});

			const layer = makeOllamaLive(mockConfig);
			await Effect.runPromise(program.pipe(Effect.provide(layer)));

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:11434/api/tags");
		});

		test("matches model with version suffix", async () => {
			const mockFetch = mock(() =>
				mockHealthResponse([
					{ name: "mxbai-embed-large:latest" },
				]),
			);
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				yield* ollama.checkHealth();
			});

			const layer = makeOllamaLive(mockConfig);
			await Effect.runPromise(program.pipe(Effect.provide(layer)));

			// Should succeed because mxbai-embed-large matches mxbai-embed-large:latest
		});

		test("fails when model not found", async () => {
			const mockFetch = mock(() =>
				mockHealthResponse([{ name: "different-model" }]),
			);
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				yield* ollama.checkHealth();
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(
				program.pipe(Effect.provide(layer), Effect.flip),
			);

			expect(result._tag).toBe("OllamaError");
			expect(result.reason).toContain("Model mxbai-embed-large not found");
			expect(result.reason).toContain("ollama pull");
		});

		test("fails when Ollama not running", async () => {
			const mockFetch = mock(() =>
				Promise.reject(new Error("ECONNREFUSED")),
			);
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				yield* ollama.checkHealth();
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(
				program.pipe(Effect.provide(layer), Effect.flip),
			);

			expect(result._tag).toBe("OllamaError");
			expect(result.reason).toContain("Cannot connect to Ollama");
		});

		test("fails when Ollama returns non-200", async () => {
			const mockFetch = mock(() =>
				Promise.resolve({
					ok: false,
					status: 503,
				} as Response),
			);
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				yield* ollama.checkHealth();
			});

			const layer = makeOllamaLive(mockConfig);
			const result = await Effect.runPromise(
				program.pipe(Effect.provide(layer), Effect.flip),
			);

			expect(result._tag).toBe("OllamaError");
			expect(result.reason).toContain("Ollama not responding");
		});
	});

	describe("configuration", () => {
		test("uses custom host from config", async () => {
			const customConfig = {
				...mockConfig,
				ollamaHost: "http://custom-host:8080",
			};

			const mockFetch = mock(() => mockSuccessResponse(mockEmbedding));
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				yield* ollama.embed("test");
			});

			const layer = makeOllamaLive(customConfig);
			await Effect.runPromise(program.pipe(Effect.provide(layer)));

			expect(mockFetch.mock.calls[0][0]).toBe(
				"http://custom-host:8080/api/embeddings",
			);
		});

		test("uses custom model from config", async () => {
			const customConfig = {
				...mockConfig,
				ollamaModel: "custom-model",
			};

			let capturedBody: string | undefined;
			const mockFetch = mock((url, options) => {
				if (options?.body) {
					capturedBody = options.body as string;
				}
				return mockSuccessResponse(mockEmbedding);
			});
			global.fetch = mockFetch as typeof fetch;

			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				yield* ollama.embed("test");
			});

			const layer = makeOllamaLive(customConfig);
			await Effect.runPromise(program.pipe(Effect.provide(layer)));

			expect(capturedBody).toBeDefined();
			const parsed = JSON.parse(capturedBody!);
			expect(parsed.model).toBe("custom-model");
		});
	});

	describe("getEmbeddingDimension", () => {
		test("returns 1024 for mxbai-embed-large", () => {
			const { getEmbeddingDimension } = require("./ollama.js");
			expect(getEmbeddingDimension("mxbai-embed-large")).toBe(1024);
		});

		test("returns 768 for nomic-embed-text", () => {
			const { getEmbeddingDimension } = require("./ollama.js");
			expect(getEmbeddingDimension("nomic-embed-text")).toBe(768);
		});

		test("returns 1024 for unknown model (default)", () => {
			const { getEmbeddingDimension } = require("./ollama.js");
			expect(getEmbeddingDimension("unknown-model")).toBe(1024);
		});

		test("OLLAMA_EMBED_DIM env var overrides model detection", () => {
			const originalEnv = process.env.OLLAMA_EMBED_DIM;
			process.env.OLLAMA_EMBED_DIM = "512";

			// Re-import to pick up env var change
			delete require.cache[require.resolve("./ollama.js")];
			const { getEmbeddingDimension } = require("./ollama.js");

			expect(getEmbeddingDimension("mxbai-embed-large")).toBe(512);

			// Restore
			if (originalEnv !== undefined) {
				process.env.OLLAMA_EMBED_DIM = originalEnv;
			} else {
				delete process.env.OLLAMA_EMBED_DIM;
			}
			delete require.cache[require.resolve("./ollama.js")];
		});
	});
});
