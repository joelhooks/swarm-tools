/**
 * Ollama Embedding Service
 *
 * Provides embedding generation via local Ollama server.
 * Uses Effect-TS patterns: Context.Tag for DI, Layer for instantiation.
 *
 * @example
 * ```typescript
 * import { Ollama, makeOllamaLive } from './memory/ollama';
 * import { Effect } from 'effect';
 *
 * const config = {
 *   ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
 *   ollamaModel: process.env.OLLAMA_MODEL || 'mxbai-embed-large',
 * };
 *
 * const program = Effect.gen(function* () {
 *   const ollama = yield* Ollama;
 *   const embedding = yield* ollama.embed("hello world");
 *   return embedding;
 * });
 *
 * const layer = makeOllamaLive(config);
 * const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
 * ```
 */

import { Chunk, Context, Duration, Effect, Layer, Schedule, Stream } from "effect";
import { Schema } from "effect";

// ============================================================================
// Types & Errors
// ============================================================================

/**
 * Configuration for Ollama embedding service
 */
export interface MemoryConfig {
	/** Ollama server URL (default: http://localhost:11434) */
	readonly ollamaHost: string;
	/** Ollama model name (default: mxbai-embed-large) */
	readonly ollamaModel: string;
}

/**
 * Known embedding dimensions for Ollama models.
 * Map model name to embedding dimension.
 */
const MODEL_DIMENSIONS: Record<string, number> = {
	"mxbai-embed-large": 1024,
	"nomic-embed-text": 768,
	"all-minilm": 384,
	"snowflake-arctic-embed": 1024,
};

/**
 * Get embedding dimension for a model.
 * Checks env var first (OLLAMA_EMBED_DIM), then MODEL_DIMENSIONS map.
 * Falls back to 1024 (mxbai-embed-large default) for unknown models.
 *
 * @param model - Model name (e.g., "mxbai-embed-large", "nomic-embed-text")
 * @returns Embedding dimension
 *
 * @example
 * ```ts
 * getEmbeddingDimension("mxbai-embed-large") // => 1024
 * getEmbeddingDimension("nomic-embed-text")  // => 768
 * getEmbeddingDimension("unknown-model")     // => 1024 (default)
 * ```
 */
export function getEmbeddingDimension(model: string): number {
	// Env var override
	const envDim = process.env.OLLAMA_EMBED_DIM;
	if (envDim) {
		const parsed = Number.parseInt(envDim, 10);
		if (!Number.isNaN(parsed) && parsed > 0) {
			return parsed;
		}
	}

	// Known model dimensions
	return MODEL_DIMENSIONS[model] ?? 1024;
}

/**
 * Embedding dimension based on configured model.
 * Exported for use in store.ts
 */
export const EMBEDDING_DIM = getEmbeddingDimension(
	process.env.OLLAMA_MODEL || "mxbai-embed-large",
);

/**
 * Ollama operation failure
 */
export class OllamaError extends Schema.TaggedError<OllamaError>()(
	"OllamaError",
	{ reason: Schema.String },
) {}

// ============================================================================
// Service Definition
// ============================================================================

/**
 * Ollama service for generating embeddings from text.
 *
 * @example
 * ```ts
 * const embedding = yield* Ollama.embed("hello world");
 * // => number[] (1024 dims for mxbai-embed-large)
 * ```
 */
export class Ollama extends Context.Tag("swarm-mail/Ollama")<
	Ollama,
	{
		/** Generate embedding for a single text */
		readonly embed: (text: string) => Effect.Effect<number[], OllamaError>;
		/** Generate embeddings for multiple texts with controlled concurrency */
		readonly embedBatch: (
			texts: string[],
			concurrency?: number,
		) => Effect.Effect<number[][], OllamaError>;
		/** Verify Ollama is running and model is available */
		readonly checkHealth: () => Effect.Effect<void, OllamaError>;
	}
>() {}

// ============================================================================
// Implementation
// ============================================================================

interface OllamaEmbeddingResponse {
	embedding: number[];
}

interface OllamaTagsResponse {
	models: Array<{ name: string }>;
}

/**
 * Create Ollama service layer from config.
 *
 * @param config - Memory configuration with ollamaHost and ollamaModel
 * @returns Layer providing the Ollama service
 */
export const makeOllamaLive = (config: MemoryConfig) =>
	Layer.succeed(
		Ollama,
		(() => {
			/**
			 * Generate embedding for a single text.
			 * Retries with exponential backoff on transient failures:
			 * 100ms -> 200ms -> 400ms (3 attempts total)
			 */
			const embedSingle = (text: string): Effect.Effect<number[], OllamaError> =>
				Effect.gen(function* () {
					const response = yield* Effect.tryPromise({
						try: () =>
							fetch(`${config.ollamaHost}/api/embeddings`, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({
									model: config.ollamaModel,
									prompt: text,
								}),
							}),
						catch: (e) => new OllamaError({ reason: `Connection failed: ${e}` }),
					});

					if (!response.ok) {
						const error = yield* Effect.tryPromise({
							try: () => response.text(),
							catch: () => new OllamaError({ reason: "Failed to read error response" }),
						});
						return yield* Effect.fail(new OllamaError({ reason: error }));
					}

					const data = yield* Effect.tryPromise({
						try: () => response.json() as Promise<OllamaEmbeddingResponse>,
						catch: () => new OllamaError({ reason: "Invalid JSON response" }),
					});

					return data.embedding;
				}).pipe(
					// Retry with exponential backoff on transient failures
					// 100ms -> 200ms -> 400ms (3 attempts total)
					Effect.retry(
						Schedule.exponential(Duration.millis(100)).pipe(
							Schedule.compose(Schedule.recurs(3)),
						),
					),
				);

			return {
				embed: embedSingle,

				embedBatch: (texts: string[], concurrency = 5) =>
					Stream.fromIterable(texts).pipe(
						Stream.mapEffect(embedSingle, { concurrency }),
						Stream.runCollect,
						Effect.map(Chunk.toArray),
					),

				checkHealth: () =>
					Effect.gen(function* () {
						const response = yield* Effect.tryPromise({
							try: () => fetch(`${config.ollamaHost}/api/tags`),
							catch: () =>
								new OllamaError({
									reason: `Cannot connect to Ollama at ${config.ollamaHost}`,
								}),
						});

						if (!response.ok) {
							return yield* Effect.fail(
								new OllamaError({ reason: "Ollama not responding" }),
							);
						}

						const data = yield* Effect.tryPromise({
							try: () => response.json() as Promise<OllamaTagsResponse>,
							catch: () => new OllamaError({ reason: "Invalid response from Ollama" }),
						});

						const hasModel = data.models.some(
							(m) =>
								m.name === config.ollamaModel ||
								m.name.startsWith(`${config.ollamaModel}:`),
						);

						if (!hasModel) {
							return yield* Effect.fail(
								new OllamaError({
									reason: `Model ${config.ollamaModel} not found. Run: ollama pull ${config.ollamaModel}`,
								}),
							);
						}
					}),
			};
		})(),
	);

/**
 * Get default Ollama configuration from environment variables.
 * Falls back to sensible defaults if env vars not set.
 */
export const getDefaultConfig = (): MemoryConfig => ({
	ollamaHost: process.env.OLLAMA_HOST || "http://localhost:11434",
	ollamaModel: process.env.OLLAMA_MODEL || "mxbai-embed-large",
});
