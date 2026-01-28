/**
 * Memory Store - Drizzle-based memory operations
 *
 * Provides CRUD operations and semantic search for memories using Drizzle ORM.
 * Replaces raw SQL adapter detection with Drizzle's unified query interface.
 *
 * ## Design Pattern
 * - Uses Drizzle query builder for all operations (except vector search)
 * - Vector similarity search uses sql`` template for vector_distance_cos()
 * - No adapter type detection needed - Drizzle handles PGlite/libSQL differences
 *
 * ## Key Operations
 * - store: Insert or update memory with embedding (UPSERT via onConflictDoUpdate)
 * - search: Vector similarity search with threshold/limit/collection filters
 * - ftsSearch: Full-text search (uses raw SQL - FTS5 not yet in Drizzle)
 * - list: List all memories, optionally filtered by collection
 * - get: Retrieve single memory by ID
 * - delete: Remove memory and its embedding
 * - getStats: Memory and embedding counts
 *
 * ## Migration Notes
 * - Removed detectAdapterType() - Drizzle abstracts this
 * - Removed PGlite-specific code (separate memory_embeddings table)
 * - libSQL schema has embedding inline in memories table
 * - JSON columns (metadata, tags) stored as TEXT, need JSON.parse/stringify
 * - Timestamps are TEXT (ISO strings)
 */

import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import { memories } from "../db/schema/memory.js";
import { EMBEDDING_DIM } from "./ollama.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Embedding dimension for configured Ollama model.
 * Auto-detected from OLLAMA_MODEL env var or defaults to 1024 (mxbai-embed-large).
 * Can be overridden via OLLAMA_EMBED_DIM env var.
 */
export { EMBEDDING_DIM };

/** Memory data structure */
export interface Memory {
  readonly id: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly collection: string;
  readonly createdAt: Date;
  /** Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7 */
  readonly confidence?: number;
}

/** Search result with similarity score */
export interface SearchResult {
  readonly memory: Memory;
  readonly score: number;
  readonly matchType: "vector" | "fts";
}

/** Search options for queries */
export interface SearchOptions {
  readonly limit?: number;
  readonly threshold?: number;
  readonly collection?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a memory store using Drizzle ORM
 *
 * Uses Drizzle query builder for all operations except vector search
 * (vector_distance_cos requires raw SQL template).
 *
 * @param db - Drizzle database instance (libSQL)
 * @returns Memory store operations
 *
 * @example
 * ```typescript
 * import { createInMemoryDb } from '../db/client.js';
 * const db = await createInMemoryDb();
 * const store = createMemoryStore(db);
 *
 * await store.store(memory, embedding);
 * const results = await store.search(queryEmbedding);
 * ```
 */
export function createMemoryStore(db: SwarmDb) {
  /**
   * Helper to parse memory row from database
   * Handles TEXT storage of JSON (metadata) and timestamps
   */
  const parseMemoryRow = (row: typeof memories.$inferSelect): Memory => {
    // libSQL stores metadata as TEXT (JSON string)
    const metadata =
      typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata ?? {};

    // Parse created_at, falling back to current time if null/undefined/invalid
    //  row.created_at can be: null, undefined, valid ISO string, or malformed string
    // Only use row.created_at if it's a non-empty string that creates a valid Date
    let createdAt: Date;
    if (row.created_at && typeof row.created_at === "string") {
      const parsed = new Date(row.created_at);
      createdAt = isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      createdAt = new Date();
    }

    return {
      id: row.id,
      content: row.content,
      metadata,
      collection: row.collection ?? "default",
      createdAt,
      confidence: row.decay_factor ?? 0.7,
    };
  };

  return {
    /**
     * Store a memory with its embedding
     *
     * Uses Drizzle's onConflictDoUpdate for UPSERT behavior.
     * Vector embedding stored via sql`` template with vector() function.
     *
     * @param memory - Memory to store
     * @param embedding - 1024-dimensional vector
     * @throws Error if database operation fails
     */
    async store(memory: Memory, embedding: number[]): Promise<void> {
      const vectorStr = JSON.stringify(embedding);

      await db
        .insert(memories)
        .values({
          id: memory.id,
          content: memory.content,
          metadata: JSON.stringify(memory.metadata),
          collection: memory.collection,
          created_at: memory.createdAt.toISOString(),
          decay_factor: memory.confidence ?? 0.7,
          embedding: sql`vector(${vectorStr})`,
        })
        .onConflictDoUpdate({
          target: memories.id,
          set: {
            content: memory.content,
            metadata: JSON.stringify(memory.metadata),
            collection: memory.collection,
            decay_factor: memory.confidence ?? 0.7,
            embedding: sql`vector(${vectorStr})`,
          },
        });
    },

    /**
     * Vector similarity search
     *
     * Uses vector_top_k() function with libsql_vector_idx for efficient ANN search.
     * Returns results sorted by similarity (highest first).
     *
     * libSQL vector search requires:
     * 1. A vector index: CREATE INDEX ... ON table(libsql_vector_idx(column))
     * 2. Using vector_top_k() which returns a virtual table with just (id) - the rowid
     * 3. Joining the virtual table back to get full rows
     * 4. Calculating distance separately with vector_distance_cos()
     *
     * @param queryEmbedding - 1024-dimensional query vector
     * @param options - Search options (limit, threshold, collection)
     * @returns Array of search results sorted by similarity (highest first)
     */
    async search(
      queryEmbedding: number[],
      options: SearchOptions = {}
    ): Promise<SearchResult[]> {
      const { limit = 10, threshold = 0.3, collection } = options;
      const vectorStr = JSON.stringify(queryEmbedding);

      // Use vector_top_k for efficient ANN search via the vector index
      // vector_top_k returns a virtual table with just (id) column - the rowid
      // Results are already ordered by distance (nearest first)
      // We calculate distance separately with vector_distance_cos()
      //
      // Note: cosine distance (0 = identical, 2 = opposite)
      // Score = 1 - distance (so 1 = identical, -1 = opposite)
      const collectionFilter = collection
        ? sql`AND m.collection = ${collection}`
        : sql``;

      const results = await db.all<{
        id: string;
        content: string;
        metadata: string;
        collection: string;
        created_at: string;
        decay_factor: number;
        distance: number;
      }>(sql`
        SELECT 
          m.id,
          m.content,
          m.metadata,
          m.collection,
          m.created_at,
          m.decay_factor,
          vector_distance_cos(m.embedding, vector(${vectorStr})) as distance
        FROM vector_top_k('idx_memories_embedding', vector(${vectorStr}), ${limit * 2}) AS v
        JOIN memories m ON m.rowid = v.id
        WHERE (1 - vector_distance_cos(m.embedding, vector(${vectorStr}))) >= ${threshold} ${collectionFilter}
        LIMIT ${limit}
      `);

      return results.map((row) => ({
        memory: parseMemoryRow(row as unknown as typeof memories.$inferSelect),
        score: 1 - row.distance, // Convert distance to similarity score
        matchType: "vector" as const,
      }));
    },

    /**
     * Full-text search
     *
     * Uses FTS5 virtual table (memories_fts) for text search.
     * Falls back to raw SQL since FTS5 isn't yet in Drizzle.
     *
     * @param searchQuery - Text query string
     * @param options - Search options (limit, collection)
     * @returns Array of search results ranked by relevance
     */
    async ftsSearch(
      searchQuery: string,
      options: SearchOptions = {}
    ): Promise<SearchResult[]> {
      const { limit = 10, collection } = options;

      // Defense in depth: graceful degradation at store layer
      if (!searchQuery || typeof searchQuery !== 'string') {
        console.warn('[store] ftsSearch called with invalid query, returning empty results');
        return [];
      }

      // FTS5 requires raw SQL - not yet in Drizzle's type-safe API
      // Quote search query to escape FTS5 operators (hyphens, etc.)
      // Without quotes, "unique-keyword-12345" → "unique" MINUS "keyword" → error
      const quotedQuery = `"${searchQuery.replace(/"/g, '""')}"`;

      // Build query dynamically based on collection filter
      const conditions = collection
        ? sql`fts.content MATCH ${quotedQuery} AND m.collection = ${collection}`
        : sql`fts.content MATCH ${quotedQuery}`;

      const results = await db.all<{
        id: string;
        content: string;
        metadata: string;
        collection: string;
        created_at: string;
        decay_factor: number;
        score: number;
      }>(sql`
        SELECT 
          m.id,
          m.content,
          m.metadata,
          m.collection,
          m.created_at,
          m.decay_factor,
          fts.rank as score
        FROM memories_fts fts
        JOIN memories m ON m.rowid = fts.rowid
        WHERE ${conditions}
        ORDER BY fts.rank
        LIMIT ${limit}
      `);

      return results.map((row) => ({
        memory: parseMemoryRow(row as unknown as typeof memories.$inferSelect),
        score: Math.abs(row.score), // FTS5 rank is negative, normalize
        matchType: "fts" as const,
      }));
    },

    /**
     * List memories
     *
     * @param collection - Optional collection filter
     * @returns Array of memories sorted by created_at DESC
     */
    async list(collection?: string): Promise<Memory[]> {
      const results = collection
        ? await db
            .select()
            .from(memories)
            .where(eq(memories.collection, collection))
            .orderBy(desc(memories.created_at))
        : await db.select().from(memories).orderBy(desc(memories.created_at));

      return results.map(parseMemoryRow);
    },

    /**
     * Get a single memory by ID
     *
     * @param id - Memory ID
     * @returns Memory or null if not found
     */
    async get(id: string): Promise<Memory | null> {
      const results = await db
        .select()
        .from(memories)
        .where(eq(memories.id, id));

      return results.length > 0 ? parseMemoryRow(results[0]) : null;
    },

    /**
     * Delete a memory
     *
     * Embedding stored inline in same table, single DELETE works.
     *
     * @param id - Memory ID
     */
    async delete(id: string): Promise<void> {
      await db.delete(memories).where(eq(memories.id, id));
    },

    /**
     * Get database statistics
     *
     * Counts memories and embeddings (embeddings in same table).
     *
     * @returns Memory and embedding counts
     */
    async getStats(): Promise<{ memories: number; embeddings: number }> {
      const memoryCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(memories);

      const embeddingCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(memories)
        .where(sql`embedding IS NOT NULL`);

      return {
        memories: Number(memoryCount[0].count),
        embeddings: Number(embeddingCount[0].count),
      };
    },
  };
}
