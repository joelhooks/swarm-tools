/**
 * Hivemind Tools - Unified Memory System
 *
 * Unifies semantic-memory and CASS tools under the hivemind namespace.
 * Sessions and learnings are both memories with different sources.
 *
 * Key design decisions (ADR-011):
 * - 8 tools instead of 15 (merged duplicates)
 * - Collection filter: "default" for learnings, "claude" for Claude sessions, etc.
 * - Unified search across learnings + sessions
 * - No more naming collision with external semantic-memory MCP
 *
 * Tool mapping:
 * - semantic-memory_store → hivemind_store
 * - semantic-memory_find + cass_search → hivemind_find
 * - semantic-memory_get + cass_view → hivemind_get
 * - semantic-memory_remove → hivemind_remove
 * - semantic-memory_validate → hivemind_validate
 * - semantic-memory_stats + cass_stats + cass_health → hivemind_stats
 * - cass_index → hivemind_index
 * - NEW: hivemind_sync (sync to .hive/memories.jsonl)
 */

import { tool } from "@opencode-ai/plugin";
import { Effect, Layer } from "effect";
import {
	getSwarmMailLibSQL,
	SessionIndexer,
	syncMemories,
	type SessionSearchOptions,
	type IndexDirectoryOptions,
	toSwarmDb,
	makeOllamaLive,
	type Ollama,
} from "swarm-mail";
import { safeEmitEvent } from "./utils/event-utils";
import {
	createMemoryAdapter,
	type MemoryAdapter,
	type StoreArgs,
	type FindArgs,
	type IdArgs,
	type StoreResult,
	type FindResult,
	type StatsResult,
	type OperationResult,
} from "./memory";
import * as os from "node:os";
import * as path from "node:path";
import { join } from "node:path";

// ============================================================================
// Type Re-exports (for backward compatibility with memory-tools.ts)
// ============================================================================

export type {
	MemoryAdapter,
	StoreArgs,
	FindArgs,
	IdArgs,
	StoreResult,
	FindResult,
	StatsResult,
	OperationResult,
};

// ============================================================================
// Types
// ============================================================================

/** Tool execution context from OpenCode plugin */
interface ToolContext {
	sessionID: string;
}

// ============================================================================
// Memory Adapter Cache
// ============================================================================

let cachedAdapter: MemoryAdapter | null = null;
let cachedIndexer: SessionIndexer | null = null;
let cachedProjectPath: string | null = null;

/**
 * Get or create memory adapter for the current project
 */
async function getMemoryAdapter(
	projectPath?: string,
): Promise<MemoryAdapter> {
	const path = projectPath || process.cwd();

	if (cachedAdapter && cachedProjectPath === path) {
		return cachedAdapter;
	}

	const swarmMail = await getSwarmMailLibSQL(path);
	const dbAdapter = await swarmMail.getDatabase();
	
	cachedAdapter = await createMemoryAdapter(dbAdapter);
	cachedProjectPath = path;

	return cachedAdapter;
}

/**
 * Get or create session indexer
 */
async function getSessionIndexer(
	projectPath?: string,
): Promise<SessionIndexer> {
	const path = projectPath || process.cwd();

	if (cachedIndexer && cachedProjectPath === path) {
		return cachedIndexer;
	}

	// Create SessionIndexer manually
	const swarmMail = await getSwarmMailLibSQL(path);
	const dbAdapter = await swarmMail.getDatabase();
	const db = toSwarmDb(dbAdapter);
	
	const ollamaLayer = makeOllamaLive({
		ollamaHost: process.env.OLLAMA_HOST || "http://localhost:11434",
		ollamaModel: process.env.OLLAMA_MODEL || "mxbai-embed-large",
	});

	cachedIndexer = new SessionIndexer(db, ollamaLayer);
	cachedProjectPath = path;

	return cachedIndexer;
}

/**
 * Get or create hivemind adapter (alias for getMemoryAdapter)
 */
export const getHivemindAdapter = getMemoryAdapter;

/**
 * Reset adapter cache (for testing)
 */
export function resetHivemindCache(): void {
	cachedAdapter = null;
	cachedIndexer = null;
	cachedProjectPath = null;
}

/**
 * Emit event to swarm-mail event store (deprecated - use safeEmitEvent directly)
 * @deprecated Use safeEmitEvent from utils/event-utils instead
 */
async function emitEvent(
	eventType: string,
	data: Record<string, unknown>,
): Promise<void> {
	const projectPath = cachedProjectPath || process.cwd();
	// Call safeEmitEvent with "hivemind" as default tool name for backward compat
	await safeEmitEvent(eventType, data, "hivemind", projectPath);
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Agent session directories to index
 */
const AGENT_DIRECTORIES = [
	path.join(os.homedir(), ".config", "swarm-tools", "sessions"),
	path.join(os.homedir(), ".opencode"),
	path.join(os.homedir(), "Cursor", "User", "History"),
	path.join(os.homedir(), ".local", "share", "Claude"),
	path.join(os.homedir(), ".aider"),
] as const;

// ============================================================================
// Core Tools
// ============================================================================

/**
 * hivemind_store - Store a memory with semantic embedding
 */
export const hivemind_store = tool({
	description:
		"Store a memory (learning, decision, pattern) with semantic embedding. Memories are searchable by semantic similarity and organized into collections. Use collection='default' for manual learnings.",
	args: {
		information: tool.schema
			.string()
			.describe("The information to store (required)"),
		collection: tool.schema
			.string()
			.optional()
			.describe("Collection name (defaults to 'default')"),
		tags: tool.schema
			.string()
			.optional()
			.describe("Comma-separated tags (e.g., 'auth,tokens,oauth')"),
		metadata: tool.schema
			.string()
			.optional()
			.describe("JSON string with additional metadata"),
		confidence: tool.schema
			.number()
			.optional()
			.describe("Confidence level (0.0-1.0) affecting decay rate. Default 0.7"),
		autoTag: tool.schema
			.boolean()
			.optional()
			.describe("Auto-generate tags using LLM. Default false"),
		autoLink: tool.schema
			.boolean()
			.optional()
			.describe("Auto-link to related memories. Default false"),
		extractEntities: tool.schema
			.boolean()
			.optional()
			.describe("Extract entities (people, places, technologies). Default false"),
	},
	async execute(args: StoreArgs, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.store(args);

		// Emit event
		await emitEvent("memory_stored", {
			memory_id: result.id,
			content_preview: args.information.slice(0, 100),
			tags: args.tags ? args.tags.split(",").map(t => t.trim()) : [],
			collection: args.collection || "default",
		});

		return JSON.stringify(result, null, 2);
	},
});

/**
 * hivemind_find - Search all memories (learnings + sessions)
 */
export const hivemind_find = tool({
	description:
		"Search all memories (manual learnings + AI session history) by semantic similarity or full-text search. Filter by collection to search specific sources (e.g., collection='claude' for Claude sessions, collection='default' for learnings).",
	args: {
		query: tool.schema.string().describe("Search query (required)"),
		limit: tool.schema
			.number()
			.optional()
			.describe("Maximum number of results (default: 10)"),
		collection: tool.schema
			.string()
			.optional()
			.describe("Filter by collection (e.g., 'default', 'claude', 'cursor')"),
		expand: tool.schema
			.boolean()
			.optional()
			.describe("Return full content instead of truncated preview (default: false)"),
		fts: tool.schema
			.boolean()
			.optional()
			.describe("Use full-text search instead of vector search (default: false)"),
	},
	async execute(args: FindArgs, ctx: ToolContext) {
		// Validate query parameter
		if (!args.query || typeof args.query !== 'string' || args.query.trim() === '') {
			return JSON.stringify({
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "query parameter is required and must be a non-empty string"
				}
			});
		}

		const startTime = Date.now();
		const adapter = await getMemoryAdapter();
		const result = await adapter.find(args);
		const duration = Date.now() - startTime;

		// Emit event
		await emitEvent("memory_found", {
			query: args.query,
			result_count: result.results.length,
			top_score: result.results.length > 0 ? result.results[0].score : undefined,
			search_duration_ms: duration,
			collection_filter: args.collection,
		});

		return JSON.stringify(result, null, 2);
	},
});

/**
 * hivemind_get - Get a specific memory by ID
 */
export const hivemind_get = tool({
	description: "Retrieve a specific memory by its ID. Works for both learnings and session memories.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args: IdArgs, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const memory = await adapter.get(args);
		return memory ? JSON.stringify(memory, null, 2) : "Memory not found";
	},
});

/**
 * hivemind_remove - Delete a memory
 */
export const hivemind_remove = tool({
	description: "Delete a memory by ID. Use this to remove outdated or incorrect memories.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args: IdArgs, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.remove(args);

		if (result.success) {
			await emitEvent("memory_deleted", {
				memory_id: args.id,
			});
		}

		return JSON.stringify(result, null, 2);
	},
});

/**
 * hivemind_validate - Validate a memory (reset decay timer)
 */
export const hivemind_validate = tool({
	description:
		"Validate that a memory is still accurate and reset its decay timer (90-day half-life). Use when you confirm a memory is correct.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args: IdArgs, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.validate(args);

		if (result.success) {
			await emitEvent("memory_validated", {
				memory_id: args.id,
				decay_reset: true,
			});
		}

		return JSON.stringify(result, null, 2);
	},
});

/**
 * hivemind_stats - Combined statistics and health check
 */
export const hivemind_stats = tool({
	description:
		"Get statistics about stored memories, embeddings, and system health. Shows counts by collection (learnings vs sessions) and Ollama availability.",
	args: {},
	async execute(args: {}, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const stats = await adapter.stats();
		const health = await adapter.checkHealth();

		// Get session indexer stats too
		let sessionStats = {};
		try {
			const indexer = await getSessionIndexer();
			sessionStats = await Effect.runPromise(indexer.getStats());
		} catch {
			// SessionIndexer might not be available
		}

		return JSON.stringify({
			...stats,
			healthy: health.ollama,
			ollama_available: health.ollama,
			sessions: sessionStats,
		}, null, 2);
	},
});

/**
 * hivemind_index - Index AI session directories
 */
export const hivemind_index = tool({
	description:
		"Index AI coding agent session directories (Claude, Cursor, OpenCode, etc.) for searchable history. Run this to pick up new sessions or rebuild the index.",
	args: {
		full: tool.schema
			.boolean()
			.optional()
			.describe("Force full rebuild (default: incremental)"),
	},
	async execute(args: { full?: boolean }, ctx: ToolContext) {
		const startTime = Date.now();

		try {
			const indexer = await getSessionIndexer();
			const allResults = [];

			// Index all agent directories
			for (const dir of AGENT_DIRECTORIES) {
				try {
					const options: IndexDirectoryOptions = {
						recursive: true,
					};

					const results = await Effect.runPromise(
						indexer.indexDirectory(dir, options).pipe(
							Effect.catchAll((error) => {
								// Directory might not exist - that's OK
								return Effect.succeed([]);
							}),
						),
					);

					allResults.push(...results);
				} catch {
					// Continue with next directory
				}
			}

			const totalIndexed = allResults.reduce(
				(sum, r) => sum + r.indexed,
				0,
			);
			const totalSkipped = allResults.reduce(
				(sum, r) => sum + r.skipped,
				0,
			);

			// Emit event
			await emitEvent("sessions_indexed", {
				sessions_indexed: allResults.length,
				messages_indexed: totalIndexed,
				duration_ms: Date.now() - startTime,
				full_rebuild: args.full ?? false,
			});

			return `Indexed ${allResults.length} sessions with ${totalIndexed} chunks (${totalSkipped} skipped) in ${Date.now() - startTime}ms`;
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * hivemind_sync - Sync memories to .hive/memories.jsonl
 */
export const hivemind_sync = tool({
	description:
		"Sync memories to .hive/memories.jsonl for git-based sharing. Team members can sync their local databases from the JSONL file.",
	args: {},
	async execute(args: {}, ctx: ToolContext) {
		try {
			const projectPath = cachedProjectPath || process.cwd();
			const swarmMail = await getSwarmMailLibSQL(projectPath);
			const dbAdapter = await swarmMail.getDatabase();
			
			// Use syncMemories from swarm-mail
			const hiveDir = join(projectPath, ".hive");
			const result = await syncMemories(dbAdapter, hiveDir);

			await emitEvent("memories_synced", {
				imported: result.imported.created,
				exported: result.exported,
			});

			return JSON.stringify({
				success: true,
				imported: result.imported.created,
				exported: result.exported,
				message: `Synced: imported ${result.imported.created}, exported ${result.exported} memories`,
			}, null, 2);
		} catch (error) {
			return JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

// ============================================================================
// Deprecation Aliases (TEMPORARY - remove in v2.0)
// ============================================================================

function createDeprecatedAlias(newToolName: string, oldToolName: string, tool: any) {
	return {
		...tool,
		execute: async (args: any, ctx: any) => {
			console.warn(
				`[DEPRECATED] ${oldToolName} is deprecated. Use ${newToolName} instead.`,
			);
			return tool.execute(args, ctx);
		},
	};
}

// semantic-memory_* aliases
const semantic_memory_store = createDeprecatedAlias("hivemind_store", "semantic-memory_store", hivemind_store);
const semantic_memory_find = createDeprecatedAlias("hivemind_find", "semantic-memory_find", hivemind_find);
const semantic_memory_get = createDeprecatedAlias("hivemind_get", "semantic-memory_get", hivemind_get);
const semantic_memory_remove = createDeprecatedAlias("hivemind_remove", "semantic-memory_remove", hivemind_remove);
const semantic_memory_validate = createDeprecatedAlias("hivemind_validate", "semantic-memory_validate", hivemind_validate);
const semantic_memory_list = createDeprecatedAlias("hivemind_find", "semantic-memory_list", hivemind_find);
const semantic_memory_stats = createDeprecatedAlias("hivemind_stats", "semantic-memory_stats", hivemind_stats);
const semantic_memory_check = createDeprecatedAlias("hivemind_stats", "semantic-memory_check", hivemind_stats);
const semantic_memory_upsert = createDeprecatedAlias("hivemind_store", "semantic-memory_upsert", hivemind_store);

// cass_* aliases
const cass_search = createDeprecatedAlias("hivemind_find", "cass_search", hivemind_find);
const cass_view = createDeprecatedAlias("hivemind_get", "cass_view", hivemind_get);
const cass_expand = createDeprecatedAlias("hivemind_get", "cass_expand", hivemind_get);
const cass_health = createDeprecatedAlias("hivemind_stats", "cass_health", hivemind_stats);
const cass_index = createDeprecatedAlias("hivemind_index", "cass_index", hivemind_index);
const cass_stats = createDeprecatedAlias("hivemind_stats", "cass_stats", hivemind_stats);

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All hivemind tools + deprecation aliases
 *
 * Register these in the plugin with spread operator: { ...hivemindTools }
 */
export const hivemindTools = {
	// Core hivemind tools
	hivemind_store,
	hivemind_find,
	hivemind_get,
	hivemind_remove,
	hivemind_validate,
	hivemind_stats,
	hivemind_index,
	hivemind_sync,

	// Deprecation aliases (remove in v2.0)
	"semantic-memory_store": semantic_memory_store,
	"semantic-memory_find": semantic_memory_find,
	"semantic-memory_get": semantic_memory_get,
	"semantic-memory_remove": semantic_memory_remove,
	"semantic-memory_validate": semantic_memory_validate,
	"semantic-memory_list": semantic_memory_list,
	"semantic-memory_stats": semantic_memory_stats,
	"semantic-memory_check": semantic_memory_check,
	"semantic-memory_upsert": semantic_memory_upsert,
	cass_search,
	cass_view,
	cass_expand,
	cass_health,
	cass_index,
	cass_stats,
} as const;

// ============================================================================
// Individual Exports (for backward compatibility with direct imports)
// ============================================================================

export {
	semantic_memory_store,
	semantic_memory_find,
	semantic_memory_get,
	semantic_memory_remove,
	semantic_memory_validate,
	semantic_memory_list,
	semantic_memory_stats,
	semantic_memory_check,
	semantic_memory_upsert,
	cass_search,
	cass_view,
	cass_expand,
	cass_health,
	cass_index,
	cass_stats,
};

// Re-export createMemoryAdapter from memory module
export { createMemoryAdapter } from "./memory";

// Deprecated tool collection exports (aliases to hivemindTools)
export const memoryTools = hivemindTools;
export const cassTools = hivemindTools;

// resetMemoryCache alias
export const resetMemoryCache = resetHivemindCache;
