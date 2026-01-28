/**
 * Memory Module - Semantic Memory Adapter
 *
 * Provides a high-level adapter around swarm-mail's MemoryStore + Ollama.
 * Used by semantic-memory_* tools in the plugin.
 *
 * ## Design
 * - Wraps MemoryStore (vector storage) + Ollama (embeddings)
 * - Handles ID generation, metadata parsing, error handling
 * - Tool-friendly API (string inputs/outputs, no Effect-TS in signatures)
 *
 * ## Usage
 * ```typescript
 * const adapter = await createMemoryAdapter(swarmMail.db);
 *
 * // Store memory
 * const { id } = await adapter.store({
 *   information: "OAuth tokens need 5min buffer",
 *   tags: "auth,tokens",
 * });
 *
 * // Search memories
 * const results = await adapter.find({
 *   query: "token refresh",
 *   limit: 5,
 * });
 * ```
 */

import { Effect } from "effect";
import {
	type DatabaseAdapter,
	createMemoryStore,
	getDefaultConfig,
	makeOllamaLive,
	Ollama,
	type Memory,
	type SearchResult,
	legacyDatabaseExists,
	migrateLegacyMemories,
	toSwarmDb,
	createMemoryAdapter as createSwarmMailAdapter,
	type MemoryConfig,
} from "swarm-mail";

// ============================================================================
// Auto-Migration State
// ============================================================================

/**
 * Module-level flag to track if migration has been checked.
 * After first check, we skip the expensive legacy DB check.
 */
let migrationChecked = false;

/**
 * Reset migration check flag (for testing)
 * @internal
 */
export function resetMigrationCheck(): void {
	migrationChecked = false;
}

// ============================================================================
// Types
// ============================================================================

/** Arguments for store operation */
export interface StoreArgs {
	readonly information: string;
	readonly collection?: string;
	readonly tags?: string;
	readonly metadata?: string;
	/** Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7 */
	readonly confidence?: number;
	/** Auto-generate tags using LLM. Default false */
	readonly autoTag?: boolean;
	/** Auto-link to related memories. Default false */
	readonly autoLink?: boolean;
	/** Extract entities (people, places, technologies). Default false */
	readonly extractEntities?: boolean;
}

/** Arguments for find operation */
export interface FindArgs {
	readonly query: string;
	readonly limit?: number;
	readonly collection?: string;
	readonly expand?: boolean;
	readonly fts?: boolean;
}

/** Arguments for get/remove/validate operations */
export interface IdArgs {
	readonly id: string;
}

/** Arguments for list operation */
export interface ListArgs {
	readonly collection?: string;
}

/** Result from store operation */
export interface StoreResult {
	readonly id: string;
	readonly message: string;
}

/** Result from find operation */
export interface FindResult {
	readonly results: Array<{
		readonly id: string;
		readonly content: string;
		readonly score: number;
		readonly collection: string;
		readonly metadata: Record<string, unknown>;
		readonly createdAt: string;
	}>;
	readonly count: number;
}

/** Result from stats operation */
export interface StatsResult {
	readonly memories: number;
	readonly embeddings: number;
}

/** Result from health check */
export interface HealthResult {
	readonly ollama: boolean;
	readonly message?: string;
}

/** Result from validate/remove operations */
export interface OperationResult {
	readonly success: boolean;
	readonly message?: string;
}

/** Arguments for upsert operation */
export interface UpsertArgs {
	readonly information: string;
	readonly collection?: string;
	readonly tags?: string;
	readonly metadata?: string;
	readonly confidence?: number;
	/** Auto-generate tags using LLM. Default true */
	readonly autoTag?: boolean;
	/** Auto-link to related memories. Default true */
	readonly autoLink?: boolean;
	/** Extract entities (people, places, technologies). Default false */
	readonly extractEntities?: boolean;
}

/** Auto-generated tags result */
export interface AutoTags {
	readonly tags: string[];
	readonly keywords: string[];
	readonly category: string;
}

/** Result from upsert operation */
export interface UpsertResult {
	readonly operation: "ADD" | "UPDATE" | "DELETE" | "NOOP";
	readonly reason: string;
	readonly memoryId?: string;
	readonly affectedMemoryIds?: string[];
	readonly autoTags?: AutoTags;
	readonly linksCreated?: number;
	readonly entitiesExtracted?: number;
}

// ============================================================================
// Auto-Migration Logic
// ============================================================================

/**
 * Check and auto-migrate legacy memories if conditions are met
 *
 * Conditions:
 * 1. Legacy database exists
 * 2. Target database has 0 memories (first use)
 *
 * @param db - Target database adapter (for migration and count check)
 */
async function maybeAutoMigrate(db: DatabaseAdapter): Promise<void> {
	try {
		// Check if legacy database exists
		if (!legacyDatabaseExists()) {
			return;
		}

		// Check if target database is empty using the legacy adapter
		const countResult = await db.query<{ count: string }>(
			"SELECT COUNT(*) as count FROM memories",
		);
		const memoryCount = parseInt(countResult.rows[0]?.count || "0");

		if (memoryCount > 0) {
			// Target already has memories, skip migration
			return;
		}

		// Use stderr to avoid polluting JSON output on stdout
		console.error("[memory] Legacy database detected, starting auto-migration...");

		// Run migration (still uses DatabaseAdapter)
		const result = await migrateLegacyMemories({
			targetDb: db,
			dryRun: false,
			onProgress: (msg) => console.error(msg),
		});

		if (result.migrated > 0) {
			console.error(
				`[memory] Auto-migrated ${result.migrated} memories from legacy database`,
			);
		}

		if (result.failed > 0) {
			console.warn(
				`[memory] ${result.failed} memories failed to migrate. See errors above.`,
			);
		}
	} catch (error) {
		// Graceful degradation - log but don't throw
		console.warn(
			`[memory] Auto-migration failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

// ============================================================================
// Memory Adapter
// ============================================================================

/**
 * Memory Adapter Interface
 *
 * High-level API for semantic memory operations.
 */
export interface MemoryAdapter {
	readonly store: (args: StoreArgs) => Promise<StoreResult>;
	readonly find: (args: FindArgs) => Promise<FindResult>;
	readonly get: (args: IdArgs) => Promise<Memory | null>;
	readonly remove: (args: IdArgs) => Promise<OperationResult>;
	readonly validate: (args: IdArgs) => Promise<OperationResult>;
	readonly list: (args: ListArgs) => Promise<Memory[]>;
	readonly stats: () => Promise<StatsResult>;
	readonly checkHealth: () => Promise<HealthResult>;
	readonly upsert: (args: UpsertArgs) => Promise<UpsertResult>;
}

/**
 * Create Memory Adapter
 *
 * @param db - DatabaseAdapter from swarm-mail's getDatabase()
 * @returns Memory adapter with high-level operations
 *
 * @example
 * ```typescript
 * import { getSwarmMailLibSQL } from 'swarm-mail';
 * import { createMemoryAdapter } from './memory';
 *
 * const swarmMail = await getSwarmMailLibSQL('/path/to/project');
 * const db = await swarmMail.getDatabase();
 * const adapter = await createMemoryAdapter(db);
 *
 * await adapter.store({ information: "Learning X" });
 * const results = await adapter.find({ query: "X" });
 * ```
 */
export async function createMemoryAdapter(
	db: DatabaseAdapter,
): Promise<MemoryAdapter> {
	// Auto-migrate legacy memories on first use
	if (!migrationChecked) {
		migrationChecked = true;
		await maybeAutoMigrate(db);
	}

	// Convert DatabaseAdapter to SwarmDb (Drizzle client) for real swarm-mail adapter
	const drizzleDb = toSwarmDb(db);
	const config = getDefaultConfig();
	
	// Create real swarm-mail adapter with Wave 1-3 features
	const realAdapter = createSwarmMailAdapter(drizzleDb, config);
	
	// DEBUG: Check if upsert exists
	if (!realAdapter || typeof realAdapter.upsert !== 'function') {
		console.warn('[memory] realAdapter.upsert is not available:', {
			hasAdapter: !!realAdapter,
			upsertType: typeof realAdapter?.upsert,
			methods: realAdapter ? Object.keys(realAdapter) : []
		});
	}
	
	// For backward compatibility, keep legacy adapter for methods not yet in real adapter
	const store = createMemoryStore(drizzleDb);
	const ollamaLayer = makeOllamaLive(config);

	/**
	 * Generate unique memory ID
	 */
	const generateId = (): string => {
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substring(2, 9);
		return `mem_${timestamp}_${random}`;
	};

	/**
	 * Parse tags string to metadata object
	 */
	const parseTags = (tags?: string): string[] => {
		if (!tags) return [];
		return tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
	};

	/**
	 * Truncate content for preview
	 */
	const truncateContent = (content: string, maxLength = 200): string => {
		if (content.length <= maxLength) return content;
		return `${content.substring(0, maxLength)}...`;
	};

	return {
		/**
		 * Store a memory with embedding and optional auto-features
		 * 
		 * Delegates to real swarm-mail adapter which supports:
		 * - autoTag: LLM-powered tag generation
		 * - autoLink: Semantic linking to related memories
		 * - extractEntities: Entity extraction and knowledge graph building
		 */
		async store(args: StoreArgs): Promise<StoreResult> {
			// Delegate to real swarm-mail adapter
			const result = await realAdapter.store(args.information, {
				collection: args.collection,
				tags: args.tags,
				metadata: args.metadata,
				confidence: args.confidence,
				autoTag: args.autoTag,
				autoLink: args.autoLink,
				extractEntities: args.extractEntities,
			});

			// Build user-facing message
			let message = `Stored memory ${result.id} in collection: ${args.collection ?? "default"}`;
			
			if (result.autoTags) {
				message += `\nAuto-tags: ${result.autoTags.tags.join(", ")}`;
			}
			
			if (result.links && result.links.length > 0) {
				message += `\nLinked to ${result.links.length} related memor${result.links.length === 1 ? "y" : "ies"}`;
			}

			return {
				id: result.id,
				message,
			};
		},

		/**
		 * Find memories by semantic similarity or full-text search
		 *
		 * When Ollama is unavailable, automatically falls back to FTS.
		 */
		async find(args: FindArgs): Promise<FindResult> {
			// Defense in depth: validate query at adapter layer
			if (!args.query || typeof args.query !== 'string') {
				throw new Error("query is required for find operation");
			}

			const limit = args.limit ?? 10;

			let results: SearchResult[];
			let usedFallback = false;

			if (args.fts) {
				// Full-text search (explicit)
				results = await store.ftsSearch(args.query, {
					limit,
					collection: args.collection,
				});
			} else {
				// Vector search - generate query embedding
				const program = Effect.gen(function* () {
					const ollama = yield* Ollama;
					return yield* ollama.embed(args.query);
				});

				try {
					const queryEmbedding = await Effect.runPromise(
						program.pipe(Effect.provide(ollamaLayer)),
					);

					results = await store.search(queryEmbedding, {
						limit,
						threshold: 0.3,
						collection: args.collection,
					});
				} catch (e) {
					// Ollama unavailable - fallback to FTS
					// This happens when Ollama isn't running or can't be reached
					console.warn(
						"[hivemind] Ollama unavailable, falling back to full-text search",
					);
					usedFallback = true;
					results = await store.ftsSearch(args.query, {
						limit,
						collection: args.collection,
					});
				}
			}

			const response: FindResult & { fallback_used?: boolean } = {
				results: results.map((r) => ({
					id: r.memory.id,
					content: args.expand
						? r.memory.content
						: truncateContent(r.memory.content),
					score: r.score,
					collection: r.memory.collection,
					metadata: r.memory.metadata,
					createdAt: r.memory.createdAt.toISOString(),
				})),
				count: results.length,
			};

			// Include fallback indicator so callers know results are FTS-based
			if (usedFallback) {
				response.fallback_used = true;
			}

			return response;
		},

		/**
		 * Get a single memory by ID
		 */
		async get(args: IdArgs): Promise<Memory | null> {
			return store.get(args.id);
		},

		/**
		 * Remove a memory
		 */
		async remove(args: IdArgs): Promise<OperationResult> {
			await store.delete(args.id);
			return {
				success: true,
				message: `Removed memory ${args.id}`,
			};
		},

		/**
		 * Validate a memory (reset decay timer)
		 *
		 * TODO: Implement decay tracking in MemoryStore
		 * For now, this is a no-op placeholder.
		 */
		async validate(args: IdArgs): Promise<OperationResult> {
			const memory = await store.get(args.id);
			if (!memory) {
				return {
					success: false,
					message: `Memory ${args.id} not found`,
				};
			}

			// TODO: Implement decay reset in MemoryStore
			// For now, just verify it exists
			return {
				success: true,
				message: `Memory ${args.id} validated`,
			};
		},

		/**
		 * List memories
		 */
		async list(args: ListArgs): Promise<Memory[]> {
			return store.list(args.collection);
		},

		/**
		 * Get statistics
		 */
		async stats(): Promise<StatsResult> {
			return store.getStats();
		},

		/**
		 * Check Ollama health
		 */
		async checkHealth(): Promise<HealthResult> {
			const program = Effect.gen(function* () {
				const ollama = yield* Ollama;
				return yield* ollama.checkHealth();
			});

			try {
				await Effect.runPromise(program.pipe(Effect.provide(ollamaLayer)));
				return { ollama: true };
			} catch (error) {
				return {
					ollama: false,
					message:
						error instanceof Error ? error.message : "Ollama not available",
				};
			}
		},

		/**
		 * Smart upsert - uses LLM to decide ADD, UPDATE, DELETE, or NOOP
		 *
		 * Delegates to real swarm-mail adapter with Mem0 pattern:
		 * - Finds semantically similar memories
		 * - LLM analyzes and decides operation
		 * - Executes with graceful degradation on LLM failures
		 */
		async upsert(args: UpsertArgs): Promise<UpsertResult> {
			// Validate required fields
			if (!args.information) {
				throw new Error("information is required for upsert");
			}

			// Delegate to real swarm-mail adapter with useSmartOps enabled
			const result = await realAdapter.upsert(args.information, {
				collection: args.collection,
				tags: args.tags,
				metadata: args.metadata,
				confidence: args.confidence,
				useSmartOps: true, // Enable LLM-powered decision making
				autoTag: args.autoTag,
				autoLink: args.autoLink,
				extractEntities: args.extractEntities,
			});

			// Map real adapter result to plugin UpsertResult format
			return {
				operation: result.operation,
				reason: result.reason,
				memoryId: result.id,
				affectedMemoryIds: [result.id],
				// Note: Real adapter doesn't return autoTags/links from upsert yet
				// Those are only on store(). This is consistent with current behavior.
			};
		},
	};
}
