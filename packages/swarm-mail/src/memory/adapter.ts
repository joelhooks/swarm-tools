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
 * - **Wave 1**: Smart upsert (Mem0 pattern), temporal queries, graph queries
 *
 * ## Basic Usage
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
 *
 * ## Wave 1 Features
 *
 * ### Smart Upsert (Mem0 Pattern)
 * ```typescript
 * // LLM analyzes and decides: ADD, UPDATE, DELETE, or NOOP
 * const result = await adapter.upsert("OAuth tokens need 5min buffer", {
 *   useSmartOps: true
 * });
 * console.log(result.operation); // "UPDATE" (refines existing memory)
 * console.log(result.reason); // "Refines existing memory with additional detail"
 * ```
 *
 * ### Temporal Queries
 * ```typescript
 * // Find memories valid at specific timestamp
 * const pastMemories = await adapter.findValidAt(
 *   "authentication",
 *   new Date("2024-01-01")
 * );
 *
 * // Track supersession chains
 * const chain = await adapter.getSupersessionChain("mem-v1");
 * // Returns: [v1, v2, v3] (chronological)
 *
 * // Mark memory as superseded
 * await adapter.supersede("old-id", "new-id");
 * ```
 *
 * ### Graph Queries
 * ```typescript
 * // Get linked memories
 * const links = await adapter.getLinkedMemories("mem-id", "related");
 *
 * // Find by entity
 * const joelMemories = await adapter.findByEntity("Joel", "person");
 *
 * // Get knowledge graph
 * const graph = await adapter.getKnowledgeGraph("mem-id");
 * // Returns: { entities: [...], relationships: [...] }
 * ```
 *
 * ### Enhanced Store
 * ```typescript
 * const result = await adapter.store("Content", {
 *   autoTag: true,        // LLM extracts tags
 *   autoLink: true,       // Auto-link to related memories
 *   extractEntities: true // Extract and link entities
 * });
 * console.log(result.autoTags); // { tags: ["auth", "oauth"], confidence: 0.8 }
 * console.log(result.links);    // [{ memory_id: "...", link_type: "related" }]
 * ```
 */

import { Effect } from "effect";
import { randomBytes } from "node:crypto";
import { eq, and, lte, gte, or, isNull, sql } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import { memories, memoryLinks, entities, relationships, memoryEntities, type MemoryLink, type Entity, type Relationship } from "../db/schema/memory.js";
import { createMemoryStore, type Memory, type SearchResult } from "./store.js";
import { makeOllamaLive, Ollama, type MemoryConfig } from "./ollama.js";
import type { LinkType } from "./memory-linking.js";
import type { EntityType } from "./entity-extraction.js";
import type { AutoTagResult as AutoTagServiceResult } from "./auto-tagger.js";
import { projectSearchResults, type FieldSelection } from "../sessions/pagination.js";

// ============================================================================
// Types
// ============================================================================

export type { MemoryConfig } from "./ollama.js";
export type { Memory, SearchResult } from "./store.js";

// ============================================================================
// Wave 1-2 Types (now imported from real services, not stubs)
// ============================================================================

/** Smart operation result from memory-operations service */
export interface SmartOpResult {
  readonly operation: "ADD" | "UPDATE" | "DELETE" | "NOOP";
  readonly reason: string;
  readonly targetId?: string; // For UPDATE/DELETE
}

/**
 * Auto-tagging result returned from store() method
 * Re-exports AutoTagResult from auto-tagger service
 */
export type AutoTagResult = AutoTagServiceResult;

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
  /** Use smart operations (Mem0 pattern) - default false */
  readonly useSmartOps?: boolean;
  /** Auto-generate tags from content */
  readonly autoTag?: boolean;
  /** Auto-link to related memories */
  readonly autoLink?: boolean;
  /** Extract and link entities */
  readonly extractEntities?: boolean;
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
  /** Field selection for compact output (default: 'full') */
  readonly fields?: FieldSelection;
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
 * Maximum characters per chunk (conservative for ~6k tokens with mxbai-embed-large)
 * mxbai-embed-large has ~512 token limit, but we use a more conservative 24k chars
 * to handle various content types safely.
 */
const MAX_CHARS_PER_CHUNK = 24000;

/**
 * Chunk overlap for context continuity
 */
const CHUNK_OVERLAP = 200;

/**
 * Split text into chunks with overlap
 *
 * @param text - Text to chunk
 * @param maxChars - Maximum characters per chunk
 * @param overlap - Characters to overlap between chunks
 * @returns Array of text chunks
 */
function chunkText(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));

    // Move forward by (maxChars - overlap) to create overlapping chunks
    start += maxChars - overlap;
  }

  return chunks;
}

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
   *
   * For long text, automatically chunks and averages embeddings.
   */
  const generateEmbedding = async (text: string): Promise<number[] | null> => {
    // Check if text needs chunking
    if (text.length > MAX_CHARS_PER_CHUNK) {
      console.warn(
        `⚠️  Text length (${text.length} chars) exceeds limit (${MAX_CHARS_PER_CHUNK} chars). ` +
        `Auto-chunking into smaller segments for embedding.`
      );

      const chunks = chunkText(text, MAX_CHARS_PER_CHUNK, CHUNK_OVERLAP);
      const embeddings: number[][] = [];

      // Generate embedding for each chunk
      for (const chunk of chunks) {
        const program = Effect.gen(function* () {
          const ollama = yield* Ollama;
          return yield* ollama.embed(chunk);
        });

        const result = await Effect.runPromise(
          program.pipe(Effect.provide(ollamaLayer), Effect.either)
        );

        if (result._tag === "Left") {
          // Ollama failed - return null for graceful degradation
          return null;
        }

        embeddings.push(result.right);
      }

      // Average the embeddings
      const avgEmbedding = embeddings[0].map((_, i) => {
        const sum = embeddings.reduce((acc, emb) => acc + emb[i], 0);
        return sum / embeddings.length;
      });

      return avgEmbedding;
    }

    // Short text - no chunking needed
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

  /**
   * Stub for smart operations service (implementation in smart-operations.ts)
   * TODO: Replace with actual service when parallel worker completes
   */
  const analyzeSmartOperation = async (
    information: string,
    existingMemories: SearchResult[]
  ): Promise<SmartOpResult> => {
    try {
      // Dynamic import to avoid circular dependencies
      const { analyzeMemoryOperation } = await import("./memory-operations.js");

      // Convert SearchResult[] to Memory[] for real service
      const memories = existingMemories.map((r) => r.memory);

      // Use real LLM-powered analysis
      // Note: apiKey will come from env (AI_GATEWAY_API_KEY)
      const result = await analyzeMemoryOperation(information, memories, {
        model: "anthropic/claude-haiku-4-5",
        apiKey: process.env.AI_GATEWAY_API_KEY || "",
      });

      // Map MemoryOperation to SmartOpResult
      switch (result.type) {
        case "ADD":
          return { operation: "ADD", reason: result.reason };
        case "UPDATE":
          return { operation: "UPDATE", reason: result.reason, targetId: result.memoryId };
        case "DELETE":
          return { operation: "DELETE", reason: result.reason, targetId: result.memoryId };
        case "NOOP":
          return { operation: "NOOP", reason: result.reason };
      }
    } catch (error) {
      // Graceful degradation: fallback to simple heuristics on error
      console.warn("analyzeMemoryOperation failed, using fallback heuristics:", error);

      if (existingMemories.length === 0) {
        return { operation: "ADD", reason: "No similar memories found - adding as new" };
      }

      const exactMatch = existingMemories.find((r) => r.memory.content === information);
      if (exactMatch) {
        return {
          operation: "NOOP",
          reason: "Information already captured in existing memory",
          targetId: exactMatch.memory.id,
        };
      }

      return { operation: "ADD", reason: "New information to store" };
    }
  };

  /**
   * Auto-generate tags using LLM-powered analysis
   * Uses real service from auto-tagger.ts
   */
  const autoGenerateTags = async (
    content: string,
    existingTags?: string[]
  ): Promise<AutoTagServiceResult | undefined> => {
    try {
      // Dynamic import to avoid circular dependencies
      const { generateTags } = await import("./auto-tagger.js");

      // Use real LLM-powered tag generation
      // Note: apiKey will come from env (AI_GATEWAY_API_KEY)
      const result = await generateTags(content, existingTags, {
        model: "anthropic/claude-haiku-4-5",
        apiKey: process.env.AI_GATEWAY_API_KEY || "",
      });

      return result;
    } catch (error) {
      // Graceful degradation: return undefined on error (no auto-tags)
      console.warn("generateTags failed, auto-tagging disabled:", error);
      return undefined;
    }
  };

  /**
   * Auto-link memories using semantic similarity
   * Uses real service from memory-linking.ts
   */
  const autoLinkMemories = async (
    memoryId: string,
    content: string
  ): Promise<Array<{ memory_id: string; link_type: LinkType }> | undefined> => {
    try {
      // Dynamic import to avoid circular dependencies
      const { autoLinkMemory } = await import("./memory-linking.js");

      // Generate embedding for the content
      const embedding = await generateEmbedding(content);
      if (!embedding) return undefined;

      // Use real service to create links
      const links = await autoLinkMemory(memoryId, embedding, db, {
        similarityThreshold: 0.7,
        maxLinks: 5,
      });

      if (links.length === 0) return undefined;

      // Map MemoryLink[] to expected format
      return links.map((link) => ({
        memory_id: link.targetId,
        link_type: link.linkType,
      }));
    } catch (error) {
      // Graceful degradation: return undefined on error (no auto-links)
      console.warn("autoLinkMemory failed, auto-linking disabled:", error);
      return undefined;
    }
  };

  /**
   * Extract entities and relationships from content, then store and link them
   * 
   * Implements proactive extraction: automatically builds knowledge graph as memories are stored.
   * Uses entity-extraction service (extractEntitiesAndRelationships, storeEntities, etc.)
   * 
   * Graceful degradation: LLM failures return empty results, never throw.
   */
  const extractAndLinkEntities = async (
    memoryId: string,
    content: string
  ): Promise<void> => {
    try {
      // Import extraction functions (dynamic to avoid circular deps)
      const { 
        extractEntitiesAndRelationships,
        storeEntities,
        storeRelationships,
        linkMemoryToEntities
      } = await import("./entity-extraction.js");

      // Get raw libSQL client for entity-extraction functions
      const client = db.run(sql`SELECT 1`); // Access underlying client
      // @ts-expect-error - accessing internal client for entity-extraction
      const libsqlClient = db.$client;

      if (!libsqlClient) {
        console.warn("No libSQL client available for entity extraction");
        return;
      }

      // Extract entities and relationships using LLM
      // Uses AI_GATEWAY_API_KEY from env
      const extraction = await extractEntitiesAndRelationships(content, {
        model: "anthropic/claude-haiku-4-5",
      });

      // Graceful degradation: if LLM returns empty, just return (no crash)
      if (extraction.entities.length === 0) {
        return;
      }

      // Store entities (with deduplication)
      const storedEntities = await storeEntities(
        extraction.entities.map((e) => ({
          name: e.name,
          entityType: e.entityType,
        })),
        libsqlClient
      );

      // Link memory to extracted entities via junction table
      await linkMemoryToEntities(
        memoryId,
        storedEntities.map((e) => e.id),
        libsqlClient
      );

      // Build entity ID lookup map (name -> id)
      const entityIdMap = new Map(storedEntities.map((e) => [e.name.toLowerCase(), e.id]));

      // Store relationships (need to resolve names to IDs first)
      const relationshipsToStore = extraction.relationships
        .map((rel) => {
          const subjectId = entityIdMap.get(rel.subjectName.toLowerCase());
          const objectId = entityIdMap.get(rel.objectName.toLowerCase());

          if (!subjectId || !objectId) {
            // Skip relationships where entities weren't extracted
            return null;
          }

          return {
            subjectId,
            predicate: rel.predicate,
            objectId,
            confidence: rel.confidence,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (relationshipsToStore.length > 0) {
        await storeRelationships(relationshipsToStore, memoryId, libsqlClient);
      }
    } catch (error) {
      // Graceful degradation: log error but don't throw (keeps store() working)
      console.error("Entity extraction failed:", error);
    }
  };

  return {
    /**
     * Store a memory with automatic embedding generation and optional auto-features
     *
     * @param information - Memory content
     * @param options - Store options
     * @returns Memory ID and optional auto-generated metadata
     * @throws Error if embedding generation fails or database operation fails
     */
    async store(
      information: string,
      options: StoreOptions = {}
    ): Promise<{ id: string; autoTags?: AutoTagResult; links?: Array<{ memory_id: string; link_type: LinkType }> }> {
      const { 
        collection = "default", 
        tags, 
        metadata: metadataJson, 
        confidence,
        autoTag,
        autoLink,
        extractEntities,
      } = options;

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

      // Optional auto-features (gracefully degrade on failure)
      let autoTagsResult: AutoTagResult | undefined;
      let linksResult: Array<{ memory_id: string; link_type: LinkType }> | undefined;

      if (autoTag) {
        autoTagsResult = await autoGenerateTags(information, parsedTags);
        if (autoTagsResult) {
          // Store auto_tags in database
          await db
            .update(memories)
            .set({ auto_tags: JSON.stringify(autoTagsResult) })
            .where(eq(memories.id, id));
        }
      }

      if (autoLink) {
        linksResult = await autoLinkMemories(id, information);
        if (linksResult && linksResult.length > 0) {
          // Create memory_links entries using Drizzle ORM
          for (const link of linksResult) {
            const linkId = `link-${randomBytes(8).toString("hex")}`;
            await db.insert(memoryLinks).values({
              id: linkId,
              source_id: id,
              target_id: link.memory_id,
              link_type: link.link_type,
            }).onConflictDoNothing();
          }
        }
      }

      if (extractEntities) {
        await extractAndLinkEntities(id, information);
      }

      return { id, autoTags: autoTagsResult, links: linksResult };
    },

    /**
     * Find memories by semantic similarity or full-text search
     *
     * @param query - Search query
     * @param options - Search options
     * @returns Search results with scores
     */
    async find(query: string, options: FindOptions = {}): Promise<SearchResult[]> {
      const { limit = 10, collection, expand = false, fts = false, fields = "full" } = options;

      let results: SearchResult[];

      if (fts) {
        // Use full-text search (explicit user choice - no warning needed)
        results = await store.ftsSearch(query, { limit, collection });
      } else {
        // Try vector search
        const embedding = await generateEmbedding(query);
        if (!embedding) {
          // Graceful degradation: Ollama unavailable, fallback to FTS
          console.warn(
            "⚠️  Ollama unavailable - falling back to FTS (full-text search). " +
            "Semantic search disabled. To restore vector search, ensure Ollama is running."
          );
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

      // Apply field projection for compact output
      return projectSearchResults(results, fields) as SearchResult[];
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

    /**
     * Smart upsert using Mem0 pattern (ADD/UPDATE/DELETE/NOOP)
     *
     * Analyzes new information against existing memories using LLM to decide:
     * - ADD: genuinely new information
     * - UPDATE: refines/elaborates existing memory
     * - DELETE: contradicts existing memory
     * - NOOP: already captured
     *
     * @param information - Memory content
     * @param options - Store options with useSmartOps flag
     * @returns Operation result with ID and reason
     */
    async upsert(
      information: string,
      options: StoreOptions = {}
    ): Promise<{ id: string; operation: "ADD" | "UPDATE" | "DELETE" | "NOOP"; reason: string }> {
      const { useSmartOps = false } = options;

      // Without smart ops, default to simple ADD behavior
      if (!useSmartOps) {
        const result = await this.store(information, options);
        return { id: result.id, operation: "ADD", reason: "Smart operations disabled" };
      }

      // Search for similar memories
      const embedding = await generateEmbedding(information);
      if (!embedding) {
        // Fallback to ADD if embedding unavailable
        const result = await this.store(information, options);
        return { id: result.id, operation: "ADD", reason: "Embedding unavailable, defaulting to ADD" };
      }

      const similar = await store.search(embedding, { limit: 5, threshold: 0.6 });

      // Analyze what operation to perform
      const decision = await analyzeSmartOperation(information, similar);

      switch (decision.operation) {
        case "ADD": {
          const result = await this.store(information, options);
          return { id: result.id, operation: "ADD", reason: decision.reason };
        }

        case "UPDATE": {
          if (!decision.targetId) {
            throw new Error("UPDATE operation requires targetId");
          }

          // Update existing memory in-place
          const embedding = await generateEmbedding(information);
          if (!embedding) {
            throw new Error("Failed to generate embedding for UPDATE");
          }

          // Parse metadata
          let metadata: Record<string, unknown> = {};
          if (options.metadata) {
            try {
              metadata = JSON.parse(options.metadata);
            } catch {
              throw new Error("Invalid JSON in metadata field");
            }
          }

          const parsedTags = parseTags(options.tags);
          if (parsedTags) {
            metadata.tags = parsedTags;
          }

          const vectorStr = JSON.stringify(embedding);
          await db
            .update(memories)
            .set({
              content: information,
              metadata: JSON.stringify(metadata),
              updated_at: new Date().toISOString(),
              embedding: sql`vector(${vectorStr})`,
            })
            .where(eq(memories.id, decision.targetId));

          return { id: decision.targetId, operation: "UPDATE", reason: decision.reason };
        }

        case "DELETE": {
          if (!decision.targetId) {
            throw new Error("DELETE operation requires targetId");
          }

          await this.remove(decision.targetId);
          return { id: decision.targetId, operation: "DELETE", reason: decision.reason };
        }

        case "NOOP": {
          return {
            id: decision.targetId || "unknown",
            operation: "NOOP",
            reason: decision.reason,
          };
        }
      }
    },

    /**
     * Find memories valid at a specific timestamp
     *
     * Filters by temporal validity window (valid_from, valid_until).
     * Useful for historical queries and temporal debugging.
     *
     * @param query - Search query
     * @param timestamp - Target timestamp
     * @param options - Search options
     * @returns Memories valid at the given time
     */
    async findValidAt(
      query: string,
      timestamp: Date,
      options: FindOptions = {}
    ): Promise<SearchResult[]> {
      const { limit = 10, collection } = options;

      // Get embedding
      const embedding = await generateEmbedding(query);
      if (!embedding) {
        // Fallback to FTS
        return await store.ftsSearch(query, { limit, collection });
      }

      // Raw SQL query with temporal filter
      const isoTimestamp = timestamp.toISOString();
      const collectionFilter = collection ? sql`AND collection = ${collection}` : sql``;

      const rows = await db.all<any>(sql`
        SELECT *,
          vector_distance_cos(embedding, vector(${JSON.stringify(embedding)})) AS distance
        FROM memories
        WHERE (valid_from IS NULL OR valid_from <= ${isoTimestamp})
          AND (valid_until IS NULL OR valid_until > ${isoTimestamp})
          ${collectionFilter}
        ORDER BY distance ASC
        LIMIT ${limit}
      `);

      const results: SearchResult[] = rows.map((row: any) => {
        const metadata =
          typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata ?? {};

        // Parse created_at, handling null/undefined/invalid dates
        let createdAt: Date;
        if (row.created_at && typeof row.created_at === "string") {
          const parsed = new Date(row.created_at);
          createdAt = isNaN(parsed.getTime()) ? new Date() : parsed;
        } else {
          createdAt = new Date();
        }

        const memory: Memory = {
          id: row.id,
          content: row.content,
          metadata,
          collection: row.collection ?? "default",
          createdAt,
          confidence: row.decay_factor ?? 0.7,
        };

        return {
          memory,
          score: 1 - (row.distance as number),
          matchType: "vector" as const,
        };
      });

      return applyDecay(results);
    },

    /**
     * Get supersession chain for a memory
     *
     * Follows superseded_by links to find all versions.
     * Returns chronological chain from oldest to newest.
     *
     * @param memoryId - Starting memory ID
     * @returns Array of memories in supersession chain
     */
    async getSupersessionChain(memoryId: string): Promise<Memory[]> {
      const chain: Memory[] = [];
      let currentId: string | null = memoryId;

      while (currentId) {
        const memory = await this.get(currentId);
        if (!memory) break;

        chain.push(memory);

        // Get superseded_by link
        const row = await db
          .select({ superseded_by: memories.superseded_by })
          .from(memories)
          .where(eq(memories.id, currentId))
          .limit(1);

        currentId = row[0]?.superseded_by || null;
      }

      return chain;
    },

    /**
     * Mark one memory as superseding another
     *
     * Updates both memories:
     * - Old: sets superseded_by link and valid_until
     * - New: sets valid_from timestamp
     *
     * @param oldMemoryId - Memory being superseded
     * @param newMemoryId - Superseding memory
     */
    async supersede(oldMemoryId: string, newMemoryId: string): Promise<void> {
      const now = new Date().toISOString();

      // Update old memory: set superseded_by and expiry
      await db
        .update(memories)
        .set({
          superseded_by: newMemoryId,
          valid_until: now,
        })
        .where(eq(memories.id, oldMemoryId));

      // Update new memory: set valid_from
      await db
        .update(memories)
        .set({
          valid_from: now,
        })
        .where(eq(memories.id, newMemoryId));
    },

    /**
     * Get memories linked to a given memory
     *
     * Returns linked memories with link metadata (type, strength).
     * Optionally filters by link type.
     *
     * @param memoryId - Source memory ID
     * @param linkType - Optional link type filter
     * @returns Array of linked memories with link metadata
     */
    async getLinkedMemories(
      memoryId: string,
      linkType?: LinkType
    ): Promise<Array<{ memory: Memory; link: { link_type: string; strength?: number } }>> {
      const linkTypeFilter = linkType ? sql`AND ml.link_type = ${linkType}` : sql``;

      const rows = await db.all<any>(sql`
        SELECT m.*, ml.link_type, ml.strength
        FROM memories m
        JOIN memory_links ml ON ml.target_id = m.id
        WHERE ml.source_id = ${memoryId}
          ${linkTypeFilter}
        ORDER BY ml.strength DESC
      `);

      return rows.map((row: any) => {
        const metadata =
          typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata ?? {};

        // Parse created_at, handling null/undefined/invalid dates
        let createdAt: Date;
        if (row.created_at && typeof row.created_at === "string") {
          const parsed = new Date(row.created_at);
          createdAt = isNaN(parsed.getTime()) ? new Date() : parsed;
        } else {
          createdAt = new Date();
        }

        const memory: Memory = {
          id: row.id,
          content: row.content,
          metadata,
          collection: row.collection ?? "default",
          createdAt,
          confidence: row.decay_factor ?? 0.7,
        };

        return {
          memory,
          link: {
            link_type: row.link_type,
            strength: row.strength,
          },
        };
      });
    },

    /**
     * Find memories by entity name/type
     *
     * Searches through entity graph to find memories linked to entities.
     * Useful for "show me everything about Joel" queries.
     *
     * @param entityName - Entity name to search for
     * @param entityType - Optional entity type filter
     * @returns Search results for memories linked to the entity
     */
    async findByEntity(
      entityName: string,
      entityType?: EntityType
    ): Promise<SearchResult[]> {
      const typeFilter = entityType ? sql`AND e.entity_type = ${entityType}` : sql``;

      const rows = await db.all<any>(sql`
        SELECT DISTINCT m.*
        FROM memories m
        JOIN memory_entities me ON me.memory_id = m.id
        JOIN entities e ON e.id = me.entity_id
        WHERE e.name = ${entityName}
          ${typeFilter}
        ORDER BY m.created_at DESC
      `);

      return rows.map((row: any) => {
        const metadata =
          typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata ?? {};

        // Parse created_at, handling null/undefined/invalid dates
        let createdAt: Date;
        if (row.created_at && typeof row.created_at === "string") {
          const parsed = new Date(row.created_at);
          createdAt = isNaN(parsed.getTime()) ? new Date() : parsed;
        } else {
          createdAt = new Date();
        }

        const memory: Memory = {
          id: row.id,
          content: row.content,
          metadata,
          collection: row.collection ?? "default",
          createdAt,
          confidence: row.decay_factor ?? 0.7,
        };

        return {
          memory,
          score: 1.0, // Entity queries don't have similarity scores
          matchType: "fts" as const,
        };
      });
    },

    /**
     * Get knowledge graph for a memory
     *
     * Returns entities and relationships extracted from/linked to a memory.
     * Useful for visualizing semantic connections.
     *
     * @param memoryId - Memory ID
     * @returns Entities and relationships in the knowledge graph
     */
    async getKnowledgeGraph(
      memoryId: string
    ): Promise<{ entities: Array<{ id: string; name: string; entity_type: string }>; relationships: Array<{ subject_id: string; predicate: string; object_id: string }> }> {
      // Get entities linked to this memory
      const entitiesRows = await db.all<any>(sql`
        SELECT e.id, e.name, e.entity_type
        FROM entities e
        JOIN memory_entities me ON me.entity_id = e.id
        WHERE me.memory_id = ${memoryId}
      `);

      const entityIds = entitiesRows.map((r: any) => r.id);

      // Get relationships between these entities
      const relationshipsRows =
        entityIds.length > 0
          ? await db.all<any>(sql`
              SELECT r.subject_id, r.predicate, r.object_id
              FROM relationships r
              WHERE r.subject_id IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})
                OR r.object_id IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})
            `)
          : [];

      return {
        entities: entitiesRows.map((r: any) => ({
          id: r.id,
          name: r.name,
          entity_type: r.entity_type,
        })),
        relationships: relationshipsRows.map((r: any) => ({
          subject_id: r.subject_id,
          predicate: r.predicate,
          object_id: r.object_id,
        })),
      };
    },
  };
}
