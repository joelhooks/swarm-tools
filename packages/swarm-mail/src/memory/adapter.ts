/**
 * Memory Adapter - High-level API for semantic memory
 *
 * Combines Ollama embeddings + MemoryStore into a simple API matching
 * the semantic-memory MCP tool interface.
 *
 * ## Key Features
 * - Automatic embedding generation via Ollama
 * - Semantic search with vector similarity
 * - FTS fallback when Ollama unavailable
 * - Graceful degradation
 * - Decay calculation (90-day half-life)
 *
 * ## Usage
 * ```typescript
 * import { createMemoryAdapter } from './adapter.js';
 * import { createInMemorySwarmMailLibSQL } from 'swarm-mail';
 *
 * const swarmMail = await createInMemorySwarmMailLibSQL('my-project');
 * const db = swarmMail.getDrizzle();
 * const config = {
 *   ollamaHost: 'http://localhost:11434',
 *   ollamaModel: 'mxbai-embed-large',
 * };
 *
 * const adapter = createMemoryAdapter(db, config);
 *
 * // Store with automatic embedding
 * const { id } = await adapter.store("OAuth tokens need refresh buffer", {
 *   tags: "auth,tokens",
 *   metadata: JSON.stringify({ priority: "high" })
 * });
 *
 * // Semantic search
 * const results = await adapter.find("token refresh");
 *
 * // FTS fallback when Ollama down
 * const results = await adapter.find("token refresh", { fts: true });
 * ```
 */

import { Effect } from "effect";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import { memories } from "../db/schema/memory.js";
import { createMemoryStore, type Memory, type SearchResult } from "./store.js";
import { makeOllamaLive, Ollama, type MemoryConfig } from "./ollama.js";

// ============================================================================
// Types
// ============================================================================

export type { MemoryConfig } from "./ollama.js";
export type { Memory, SearchResult } from "./store.js";

/**
 * Options for storing a memory
 */
export interface StoreOptions {
  /** Collection name (default: "default") */
  readonly collection?: string;
  /** Comma-separated tags (e.g., "auth,tokens,oauth") */
  readonly tags?: string;
  /** JSON string with additional metadata */
  readonly metadata?: string;
  /** Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7 */
  readonly confidence?: number;
}

/**
 * Options for searching memories
 */
export interface FindOptions {
  /** Maximum number of results (default: 10) */
  readonly limit?: number;
  /** Collection filter */
  readonly collection?: string;
  /** Return full content (default: false returns preview) */
  readonly expand?: boolean;
  /** Use full-text search instead of vector search (default: false) */
  readonly fts?: boolean;
}

/**
 * Health check result
 */
export interface HealthStatus {
  /** Whether Ollama is available */
  readonly ollama: boolean;
  /** Ollama model name (if available) */
  readonly model?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a memory adapter with high-level operations
 *
 * @param db - Drizzle database instance (libSQL)
 * @param config - Ollama configuration
 * @returns Memory adapter instance
 */
export function createMemoryAdapter(db: SwarmDb, config: MemoryConfig) {
  const store = createMemoryStore(db);
  const ollamaLayer = makeOllamaLive(config);

  /**
   * Generate embedding for text using Ollama
   * Returns null if Ollama unavailable (graceful degradation)
   */
  const generateEmbedding = async (text: string): Promise<number[] | null> => {
    const program = Effect.gen(function* () {
      const ollama = yield* Ollama;
      return yield* ollama.embed(text);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ollamaLayer), Effect.either)
    );

    if (result._tag === "Left") {
      // Ollama failed - return null for graceful degradation
      return null;
    }

    return result.right;
  };

  /**
   * Clamp confidence to valid range [0.0, 1.0]
   */
  const clampConfidence = (confidence: number | undefined): number => {
    if (confidence === undefined) return 0.7;
    return Math.max(0.0, Math.min(1.0, confidence));
  };

  /**
   * Calculate decay factor based on memory age and confidence
   *
   * Confidence-adjusted half-life formula:
   * - halfLife = 90 * (0.5 + confidence)
   * - High confidence (1.0) = 135 day half-life (slower decay)
   * - Default confidence (0.7) = 108 day half-life
   * - Low confidence (0.0) = 45 day half-life (faster decay)
   *
   * @param createdAt - Memory creation timestamp
   * @param confidence - Confidence level (0.0-1.0)
   * @returns Decay factor (0.0-1.0)
   */
  const calculateDecayFactor = (createdAt: Date, confidence: number): number => {
    const ageInDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const halfLife = 90 * (0.5 + confidence);
    return 0.5 ** (ageInDays / halfLife);
  };

  /**
   * Apply decay to search results
   */
  const applyDecay = (results: SearchResult[]): SearchResult[] => {
    return results.map((result) => {
      const decayFactor = calculateDecayFactor(
        result.memory.createdAt,
        result.memory.confidence ?? 0.7
      );
      return {
        ...result,
        score: result.score * decayFactor,
      };
    });
  };

  /**
   * Parse tags string into array
   */
  const parseTags = (tags?: string): string[] | undefined => {
    if (!tags) return undefined;
    return tags.split(",").map((t) => t.trim()).filter(Boolean);
  };

  /**
   * Generate a unique memory ID
   */
  const generateId = (): string => {
    return `mem-${randomBytes(8).toString("hex")}`;
  };

  return {
    /**
     * Store a memory with automatic embedding generation
     *
     * @param information - Memory content
     * @param options - Store options
     * @returns Memory ID
     * @throws Error if embedding generation fails or database operation fails
     */
    async store(
      information: string,
      options: StoreOptions = {}
    ): Promise<{ id: string }> {
      const { collection = "default", tags, metadata: metadataJson, confidence } = options;

      // Parse metadata
      let metadata: Record<string, unknown> = {};
      if (metadataJson) {
        try {
          metadata = JSON.parse(metadataJson);
        } catch {
          throw new Error("Invalid JSON in metadata field");
        }
      }

      // Add tags to metadata
      const parsedTags = parseTags(tags);
      if (parsedTags) {
        metadata.tags = parsedTags;
      }

      // Generate embedding
      const embedding = await generateEmbedding(information);
      if (!embedding) {
        throw new Error(
          "Failed to generate embedding. Ensure Ollama is running and model is available."
        );
      }

      // Store memory with clamped confidence
      const id = generateId();
      const memory: Memory = {
        id,
        content: information,
        metadata,
        collection,
        createdAt: new Date(),
        confidence: clampConfidence(confidence),
      };

      await store.store(memory, embedding);

      return { id };
    },

    /**
     * Find memories by semantic similarity or full-text search
     *
     * @param query - Search query
     * @param options - Search options
     * @returns Search results with scores
     */
    async find(query: string, options: FindOptions = {}): Promise<SearchResult[]> {
      const { limit = 10, collection, expand = false, fts = false } = options;

      let results: SearchResult[];

      if (fts) {
        // Use full-text search
        results = await store.ftsSearch(query, { limit, collection });
      } else {
        // Try vector search
        const embedding = await generateEmbedding(query);
        if (!embedding) {
          // Fallback to FTS if Ollama unavailable
          results = await store.ftsSearch(query, { limit, collection });
        } else {
          results = await store.search(embedding, { limit, collection });
        }
      }

      // Apply decay to scores
      results = applyDecay(results);

      // Sort by decayed score (descending)
      results.sort((a, b) => b.score - a.score);

      // Apply expand option (truncate content if not expanded)
      if (!expand) {
        results = results.map((r) => ({
          ...r,
          memory: {
            ...r.memory,
            content:
              r.memory.content.length > 200
                ? `${r.memory.content.slice(0, 200)}...`
                : r.memory.content,
          },
        }));
      }

      return results;
    },

    /**
     * Get a specific memory by ID
     *
     * @param id - Memory ID
     * @returns Memory or null if not found
     */
    async get(id: string): Promise<Memory | null> {
      return await store.get(id);
    },

    /**
     * Remove a memory
     *
     * @param id - Memory ID
     */
    async remove(id: string): Promise<void> {
      await store.delete(id);
    },

    /**
     * Validate/refresh a memory (reset decay timer)
     *
     * Updates the created_at timestamp to current time, effectively
     * resetting the 90-day decay timer.
     *
     * @param id - Memory ID
     * @throws Error if memory not found
     */
    async validate(id: string): Promise<void> {
      const memory = await store.get(id);
      if (!memory) {
        throw new Error(`Memory not found: ${id}`);
      }

      // Update created_at directly via Drizzle (store() doesn't update timestamps on conflict)
      const now = new Date();
      await db
        .update(memories)
        .set({ created_at: now.toISOString() })
        .where(eq(memories.id, id));
    },

    /**
     * List all memories
     *
     * @param options - List options
     * @returns Array of memories
     */
    async list(options: { collection?: string } = {}): Promise<Memory[]> {
      return await store.list(options.collection);
    },

    /**
     * Get database statistics
     *
     * @returns Memory and embedding counts
     */
    async stats(): Promise<{ memories: number; embeddings: number }> {
      return await store.getStats();
    },

    /**
     * Check if Ollama is available
     *
     * @returns Health status
     */
    async checkHealth(): Promise<HealthStatus> {
      const program = Effect.gen(function* () {
        const ollama = yield* Ollama;
        yield* ollama.checkHealth();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(ollamaLayer), Effect.either)
      );

      if (result._tag === "Left") {
        return { ollama: false };
      }

      return { ollama: true, model: config.ollamaModel };
    },
  };
}
