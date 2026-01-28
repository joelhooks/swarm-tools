/**
 * Semantic Memory Plugin Tools - Embedded implementation
 *
 * Provides semantic memory operations using swarm-mail's MemoryStore + Ollama.
 * Replaces external MCP-based semantic-memory calls with embedded storage.
 *
 * Key features:
 * - Vector similarity search with Ollama embeddings
 * - Full-text search fallback
 * - Memory decay tracking (TODO: implement in MemoryStore)
 * - Collection-based organization
 *
 * Tool signatures maintained for backward compatibility with existing prompts.
 */

import { tool } from "@opencode-ai/plugin";
import { getSwarmMailLibSQL, createEvent, appendEvent } from "swarm-mail";
import { AdapterCache } from "./utils/adapter-cache";
import {
	createMemoryAdapter,
	type MemoryAdapter,
	type StoreArgs,
	type FindArgs,
	type IdArgs,
	type ListArgs,
	type StoreResult,
	type FindResult,
	type StatsResult,
	type HealthResult,
	type OperationResult,
	type UpsertArgs,
	type UpsertResult,
	type AutoTags,
} from "./memory";

// Re-export types for external use
export type {
	MemoryAdapter,
	StoreArgs,
	FindArgs,
	IdArgs,
	ListArgs,
	StoreResult,
	FindResult,
	StatsResult,
	HealthResult,
	OperationResult,
	UpsertArgs,
	UpsertResult,
	AutoTags,
} from "./memory";

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

const memoryAdapterCache = new AdapterCache<MemoryAdapter>();

/**
 * Get or create memory adapter for the current project
 *
 * @param projectPath - Project path (uses CWD if not provided)
 * @returns Memory adapter instance
 */
export async function getMemoryAdapter(
	projectPath?: string,
): Promise<MemoryAdapter> {
	const path = projectPath || process.cwd();

	return memoryAdapterCache.get(path, async (projectPath) => {
		const swarmMail = await getSwarmMailLibSQL(projectPath);
		const dbAdapter = await swarmMail.getDatabase();

		// createMemoryAdapter now accepts DatabaseAdapter directly and converts internally
		return await createMemoryAdapter(dbAdapter);
	});
}

/**
 * Reset adapter cache (for testing)
 */
export function resetMemoryCache(): void {
	memoryAdapterCache.clear();
}

// Re-export createMemoryAdapter for external use
export { createMemoryAdapter };

// ============================================================================
// Plugin Tools
// ============================================================================

/**
 * Store a memory with semantic embedding
 */
export const semantic_memory_store = tool({
	description:
		"Store a memory with semantic embedding. Memories are searchable by semantic similarity and can be organized into collections. Confidence affects decay rate: high confidence (1.0) = 135 day half-life, low confidence (0.0) = 45 day half-life. Supports auto-tagging, auto-linking, and entity extraction via LLM.",
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
			.describe("Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7"),
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
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.store(args);

		// Emit memory_stored event for observability
		try {
			const projectKey = memoryAdapterCache.getCachedPath() || process.cwd();
			const tags = args.tags ? args.tags.split(",").map(t => t.trim()) : [];
			const event = createEvent("memory_stored", {
				project_key: projectKey,
				memory_id: result.id,
				content_preview: args.information.slice(0, 100),
				tags,
				auto_tagged: args.autoTag,
				collection: args.collection,
			});
			await appendEvent(event, projectKey);
		} catch (error) {
			// Non-fatal - log and continue
			console.warn("[semantic_memory_store] Failed to emit memory_stored event:", error);
		}

		return JSON.stringify(result, null, 2);
	},
});

/**
 * Find memories by semantic similarity or full-text search
 */
export const semantic_memory_find = tool({
	description:
		"Search memories by semantic similarity (vector search) or full-text search. Returns results ranked by relevance score.",
	args: {
		query: tool.schema.string().describe("Search query (required)"),
		limit: tool.schema
			.number()
			.optional()
			.describe("Maximum number of results (default: 10)"),
		collection: tool.schema
			.string()
			.optional()
			.describe("Filter by collection name"),
		expand: tool.schema
			.boolean()
			.optional()
			.describe("Return full content instead of truncated preview (default: false)"),
		fts: tool.schema
			.boolean()
			.optional()
			.describe("Use full-text search instead of vector search (default: false)"),
	},
	async execute(args, ctx: ToolContext) {
		const startTime = Date.now();
		const adapter = await getMemoryAdapter();
		const result = await adapter.find(args);
		const duration = Date.now() - startTime;

		// Emit memory_found event for observability
		try {
			const projectKey = memoryAdapterCache.getCachedPath() || process.cwd();
			const topScore = result.results.length > 0 ? result.results[0].score : undefined;
			const event = createEvent("memory_found", {
				project_key: projectKey,
				query: args.query,
				result_count: result.results.length,
				top_score: topScore,
				search_duration_ms: duration,
				used_fts: args.fts,
			});
			await appendEvent(event, projectKey);
		} catch (error) {
			// Non-fatal - log and continue
			console.warn("[semantic_memory_find] Failed to emit memory_found event:", error);
		}

		return JSON.stringify(result, null, 2);
	},
});

/**
 * Get a single memory by ID
 */
export const semantic_memory_get = tool({
	description: "Retrieve a specific memory by its ID.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const memory = await adapter.get(args);
		return memory ? JSON.stringify(memory, null, 2) : "Memory not found";
	},
});

/**
 * Remove a memory
 */
export const semantic_memory_remove = tool({
	description: "Delete a memory by ID. Use this to remove outdated or incorrect memories.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.remove(args);

		// Emit memory_deleted event for observability
		if (result.success) {
			try {
				const projectKey = memoryAdapterCache.getCachedPath() || process.cwd();
				const event = createEvent("memory_deleted", {
					project_key: projectKey,
					memory_id: args.id,
				});
				await appendEvent(event, projectKey);
			} catch (error) {
				// Non-fatal - log and continue
				console.warn("[semantic_memory_remove] Failed to emit memory_deleted event:", error);
			}
		}

		return JSON.stringify(result, null, 2);
	},
});

/**
 * Validate a memory (reset decay timer)
 */
export const semantic_memory_validate = tool({
	description:
		"Validate that a memory is still accurate and reset its decay timer. Use when you confirm a memory is correct.",
	args: {
		id: tool.schema.string().describe("Memory ID (required)"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.validate(args);

		// Emit memory_validated event for observability
		if (result.success) {
			try {
				const projectKey = memoryAdapterCache.getCachedPath() || process.cwd();
				const event = createEvent("memory_validated", {
					project_key: projectKey,
					memory_id: args.id,
					decay_reset: true,
				});
				await appendEvent(event, projectKey);
			} catch (error) {
				// Non-fatal - log and continue
				console.warn("[semantic_memory_validate] Failed to emit memory_validated event:", error);
			}
		}

		return JSON.stringify(result, null, 2);
	},
});

/**
 * List memories
 */
export const semantic_memory_list = tool({
	description: "List all stored memories, optionally filtered by collection.",
	args: {
		collection: tool.schema
			.string()
			.optional()
			.describe("Filter by collection name"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const memories = await adapter.list(args);
		return JSON.stringify(memories, null, 2);
	},
});

/**
 * Get memory statistics
 */
export const semantic_memory_stats = tool({
	description: "Get statistics about stored memories and embeddings.",
	args: {},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const stats = await adapter.stats();
		return JSON.stringify(stats, null, 2);
	},
});

/**
 * Check Ollama health
 */
export const semantic_memory_check = tool({
	description:
		"Check if Ollama is running and available for embedding generation.",
	args: {},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const health = await adapter.checkHealth();
		return JSON.stringify(health, null, 2);
	},
});

/**
 * Smart upsert - ADD, UPDATE, DELETE, or NOOP based on existing memories
 */
export const semantic_memory_upsert = tool({
	description:
		"Smart memory storage that decides whether to ADD, UPDATE, DELETE, or skip (NOOP) based on existing memories. Uses LLM to detect duplicates, refinements, and contradictions. Auto-generates tags, links, and entities when enabled.",
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
			.describe("Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7"),
		autoTag: tool.schema
			.boolean()
			.optional()
			.describe("Auto-generate tags using LLM. Default true"),
		autoLink: tool.schema
			.boolean()
			.optional()
			.describe("Auto-link to related memories. Default true"),
		extractEntities: tool.schema
			.boolean()
			.optional()
			.describe("Extract entities (people, places, technologies). Default false"),
	},
	async execute(args, ctx: ToolContext) {
		const adapter = await getMemoryAdapter();
		const result = await adapter.upsert(args);

		// Emit memory_updated event for observability (covers ADD, UPDATE, DELETE, NOOP)
		try {
			const projectKey = memoryAdapterCache.getCachedPath() || process.cwd();
			const event = createEvent("memory_updated", {
				project_key: projectKey,
				memory_id: result.memoryId || "unknown",
				operation: result.operation,
				reason: result.reason,
			});
			await appendEvent(event, projectKey);
		} catch (error) {
			// Non-fatal - log and continue
			console.warn("[semantic_memory_upsert] Failed to emit memory_updated event:", error);
		}

		return JSON.stringify(result, null, 2);
	},
});

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All semantic memory tools
 *
 * Register these in the plugin with spread operator: { ...memoryTools }
 */
export const memoryTools = {
	"semantic-memory_store": semantic_memory_store,
	"semantic-memory_find": semantic_memory_find,
	"semantic-memory_get": semantic_memory_get,
	"semantic-memory_remove": semantic_memory_remove,
	"semantic-memory_validate": semantic_memory_validate,
	"semantic-memory_list": semantic_memory_list,
	"semantic-memory_stats": semantic_memory_stats,
	"semantic-memory_check": semantic_memory_check,
	"semantic-memory_upsert": semantic_memory_upsert,
} as const;
