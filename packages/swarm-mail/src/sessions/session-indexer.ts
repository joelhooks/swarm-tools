/**
 * SessionIndexer - Main orchestrator for session indexing
 *
 * Ties together all session components:
 * - SessionParser (T1) - Parse JSONL
 * - ChunkProcessor (T2) - Chunk + embed
 * - AgentDiscovery (T3) - Detect agent type (TODO: not yet implemented)
 * - FileWatcher (T4) - Watch for changes (optional)
 * - StalenessDetector (T5) - Track freshness (TODO: integrate when needed)
 * - SessionViewer (T6) - View specific lines
 * - Pagination (T7) - Field selection
 *
 * @module sessions/session-indexer
 *
 * @example
 * ```typescript
 * import { SessionIndexer } from './sessions/session-indexer';
 * import { createInMemoryDb } from '../db/client';
 * import { makeOllamaLive } from '../memory/ollama';
 *
 * const db = await createInMemoryDb();
 * const ollamaLayer = makeOllamaLive({
 *   ollamaHost: 'http://localhost:11434',
 *   ollamaModel: 'mxbai-embed-large'
 * });
 *
 * const indexer = new SessionIndexer(db, ollamaLayer);
 *
 * // Index a single file
 * await Effect.runPromise(indexer.indexFile('/path/to/session.jsonl'));
 *
 * // Index a directory
 * await Effect.runPromise(indexer.indexDirectory('~/.config/swarm-tools/sessions'));
 *
 * // Search
 * const results = await Effect.runPromise(
 *   indexer.search('authentication error', { limit: 5 })
 * );
 * ```
 */

import { Effect, Layer } from "effect";
import type { SwarmDb } from "../db/client.js";
import { SessionParser } from "./session-parser.js";
import { ChunkProcessor } from "./chunk-processor.js";
import {
	projectSearchResults,
	type FieldSelection,
} from "./pagination.js";
import { createMemoryStore, type SearchResult } from "../memory/store.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Ollama } from "../memory/ollama.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Result from indexing a single file
 */
export interface IndexFileResult {
	/** Path that was indexed */
	readonly path: string;
	/** Agent type detected */
	readonly agent_type: string;
	/** Number of chunks indexed */
	readonly indexed: number;
	/** Number of lines skipped (malformed JSON) */
	readonly skipped: number;
	/** Duration in milliseconds */
	readonly duration_ms: number;
}

/**
 * Options for indexing a directory
 */
export interface IndexDirectoryOptions {
	/** Whether to recurse into subdirectories */
	readonly recursive?: boolean;
	/** File pattern to match (default: *.jsonl) */
	readonly pattern?: string;
}

/**
 * Search options
 */
export interface SearchOptions {
	/** Maximum number of results */
	readonly limit?: number;
	/** Similarity threshold (0-1) */
	readonly threshold?: number;
	/** Filter by agent type */
	readonly agent_type?: string;
	/** Field selection for compact output */
	readonly fields?: FieldSelection;
}

/**
 * Session statistics by agent type
 */
export interface SessionStats {
	/** Total number of sessions indexed */
	readonly total_sessions: number;
	/** Total number of chunks indexed */
	readonly total_chunks: number;
	/** Statistics grouped by agent type */
	readonly by_agent: Record<
		string,
		{
			sessions: number;
			chunks: number;
		}
	>;
}

/**
 * Index health status
 */
export interface IndexHealth {
	/** Total number of indexed files */
	readonly total_indexed: number;
	/** Number of stale files (need reindexing) */
	readonly stale_count: number;
	/** Number of fresh files */
	readonly fresh_count: number;
	/** Oldest indexed timestamp */
	readonly oldest_indexed?: Date;
	/** Newest indexed timestamp */
	readonly newest_indexed?: Date;
}

/**
 * Staleness check result
 */
export interface StalenessResult {
	/** Whether the file is stale */
	readonly isStale: boolean;
	/** Last indexed timestamp */
	readonly lastIndexed?: Date;
	/** File modification timestamp */
	readonly fileModified?: Date;
}

// ============================================================================
// SessionIndexer
// ============================================================================

/**
 * Main orchestrator for session indexing
 *
 * Coordinates all session components to provide a unified API for:
 * - Indexing individual files or directories
 * - Searching indexed sessions
 * - Tracking index health and staleness
 */
export class SessionIndexer {
	private db: SwarmDb;
	private ollamaLayer: Layer.Layer<Ollama>;
	private parser: SessionParser;
	private processor: ChunkProcessor;
	private memoryStore: ReturnType<typeof createMemoryStore>;
	private indexedFiles: Map<string, { timestamp: Date; chunks: number }> =
		new Map();

	constructor(db: SwarmDb, ollamaLayer: Layer.Layer<Ollama>) {
		this.db = db;
		this.ollamaLayer = ollamaLayer;

		// Initialize components
		// For now, default to "opencode-swarm" agent type
		// TODO: Integrate AgentDiscovery when implemented
		this.parser = new SessionParser("opencode-swarm");
		this.processor = new ChunkProcessor();
		this.memoryStore = createMemoryStore(db);
	}

	/**
	 * Index a single session file
	 *
	 * @param filePath - Absolute path to the JSONL session file
	 * @returns Effect with indexing result
	 *
	 * @example
	 * ```typescript
	 * const result = await Effect.runPromise(
	 *   indexer.indexFile('/path/to/session.jsonl')
	 * );
	 * console.log(`Indexed ${result.indexed} chunks`);
	 * ```
	 */
	indexFile(filePath: string): Effect.Effect<IndexFileResult, Error> {
		const self = this;
		return Effect.gen(function* (_) {
			const startTime = Date.now();
			let skipped = 0;

			// Read file
			const content = yield* _(
				Effect.tryPromise({
					try: () => fs.readFile(filePath, "utf-8"),
					catch: (error: unknown) =>
						new Error(`Failed to read file: ${error}`),
				}),
			);

			// Parse JSONL
			const messages = yield* _(
				Effect.tryPromise({
					try: () =>
						self.parser.parse(content, {
							filePath,
						}),
					catch: (error: unknown) =>
						new Error(`Failed to parse JSONL: ${error}`),
				}),
			);

			// Count skipped lines (total lines - parsed messages - empty lines)
			const totalLines = content.split("\n").filter((l: string) => l.trim())
				.length;
			skipped = Math.max(0, totalLines - messages.length);

			// Chunk messages
			const chunks = self.processor.chunk(messages);

			// Embed chunks
			const embedded = yield* _(
				self.processor.embed(chunks).pipe(Effect.provide(self.ollamaLayer)),
			);

			// Store in memory store
			// Use session_id as collection for grouping
			let indexed = 0;
			for (const chunk of embedded) {
				if (chunk.embedding) {
					const memory = {
						id: `${chunk.session_id}-${chunk.message_idx}`,
						content: chunk.content,
						metadata: {
							session_id: chunk.session_id,
							agent_type: chunk.agent_type,
							message_idx: chunk.message_idx,
							timestamp: chunk.timestamp,
							role: chunk.role,
							source_path: filePath,
							...chunk.metadata,
						},
						collection: chunk.agent_type, // Group by agent type
						createdAt: new Date(),
					};

					yield* _(
						Effect.tryPromise({
							try: () => self.memoryStore.store(memory, chunk.embedding!),
							catch: (error: unknown) =>
								new Error(`Failed to store chunk: ${error}`),
						}),
					);

					indexed++;
				}
			}

			// Track indexed file (simple in-memory tracking for now)
			self.indexedFiles.set(filePath, {
				timestamp: new Date(),
				chunks: indexed,
			});

			const duration_ms = Date.now() - startTime;

			return {
				path: filePath,
				agent_type: "opencode-swarm", // TODO: Use AgentDiscovery
				indexed,
				skipped,
				duration_ms,
			};
		});
	}

	/**
	 * Index all JSONL files in a directory
	 *
	 * @param dirPath - Directory to scan
	 * @param options - Indexing options
	 * @returns Effect with array of index results
	 *
	 * @example
	 * ```typescript
	 * const results = await Effect.runPromise(
	 *   indexer.indexDirectory('~/.config/swarm-tools/sessions', {
	 *     recursive: true
	 *   })
	 * );
	 * ```
	 */
	indexDirectory(
		dirPath: string,
		options: IndexDirectoryOptions = {},
	): Effect.Effect<IndexFileResult[], Error> {
		const self = this;
		return Effect.gen(function* (_) {
			const { recursive = false } = options;

			// Find all JSONL files
			const files = yield* _(
				Effect.tryPromise({
					try: () => self.findJsonlFiles(dirPath, recursive),
					catch: (error: unknown) =>
						new Error(`Failed to scan directory: ${error}`),
				}),
			);

			// Index each file
			const results: IndexFileResult[] = [];
			for (const file of files) {
				const result = yield* _(self.indexFile(file));
				results.push(result);
			}

			return results;
		});
	}

	/**
	 * Search indexed sessions
	 *
	 * @param query - Search query
	 * @param options - Search options
	 * @returns Effect with search results
	 *
	 * @example
	 * ```typescript
	 * const results = await Effect.runPromise(
	 *   indexer.search('authentication error', { limit: 5 })
	 * );
	 * ```
	 */
	search(
		query: string,
		options: SearchOptions = {},
	): Effect.Effect<SearchResult[], Error> {
		const self = this;
		return Effect.gen(function* (_) {
			const { limit = 10, threshold = 0.5, agent_type, fields } = options;

			// Get query embedding
			const queryEmbedding = yield* _(
				Effect.tryPromise({
					try: () =>
						Effect.runPromise(
							self.processor
								.embedQuery(query)
								.pipe(Effect.provide(self.ollamaLayer)),
						),
					catch: (error: unknown) =>
						new Error(`Failed to embed query: ${error}`),
				}),
			);

			// Search memory store
			const results = yield* _(
				Effect.tryPromise({
					try: () =>
						self.memoryStore.search(queryEmbedding, {
							limit,
							threshold,
							collection: agent_type, // Filter by agent type if specified
						}),
					catch: (error: unknown) => new Error(`Search failed: ${error}`),
				}),
			);

			// Apply field projection if requested
			if (fields) {
				return projectSearchResults(results, fields) as unknown as SearchResult[];
			}

			return results;
		});
	}

	/**
	 * Get session statistics grouped by agent type
	 *
	 * @returns Effect with statistics
	 */
	getStats(): Effect.Effect<SessionStats, Error> {
		const self = this;
		return Effect.gen(function* (_) {
			const stats = yield* _(
				Effect.tryPromise({
					try: () => self.memoryStore.getStats(),
					catch: (error: unknown) =>
						new Error(`Failed to get stats: ${error}`),
				}),
			);

			// Group by collection (agent_type)
			// This is a simplified version - full implementation would
			// query the database to count unique sessions
			const by_agent: Record<string, { sessions: number; chunks: number }> =
				{};

			// For now, use a simplified approach
			// TODO: Enhance with proper session counting
			by_agent["opencode-swarm"] = {
				sessions: 0, // Would need to count unique session_ids
				chunks: stats.memories,
			};

			return {
				total_sessions: 0, // Would count unique session_ids
				total_chunks: stats.memories,
				by_agent,
			};
		});
	}

	/**
	 * Check index health and staleness
	 *
	 * @returns Effect with health status
	 */
	checkHealth(): Effect.Effect<IndexHealth, Error> {
		const self = this;
		return Effect.gen(function* (_) {
			// Simple implementation using in-memory tracking
			const total_indexed = self.indexedFiles.size;
			const timestamps = Array.from(self.indexedFiles.values()).map(
				(v) => v.timestamp,
			);

			const oldest_indexed =
				timestamps.length > 0
					? new Date(Math.min(...timestamps.map((d) => d.getTime())))
					: undefined;

			const newest_indexed =
				timestamps.length > 0
					? new Date(Math.max(...timestamps.map((d) => d.getTime())))
					: undefined;

			return {
				total_indexed,
				stale_count: 0, // TODO: Implement staleness checking
				fresh_count: total_indexed,
				oldest_indexed,
				newest_indexed,
			};
		});
	}

	/**
	 * Check if a file is stale (needs reindexing)
	 *
	 * @param filePath - Path to check
	 * @returns Effect with staleness result
	 */
	checkStaleness(filePath: string): Effect.Effect<StalenessResult, Error> {
		const self = this;
		return Effect.gen(function* (_) {
			const indexInfo = self.indexedFiles.get(filePath);

			// Simple implementation: file is stale if never indexed
			const isStale = !indexInfo;

			return {
				isStale,
				lastIndexed: indexInfo?.timestamp,
				fileModified: undefined, // Would need fs.stat to get this
			};
		});
	}

	// ========================================================================
	// Private Helpers
	// ========================================================================

	/**
	 * Find all JSONL files in a directory
	 */
	private async findJsonlFiles(
		dir: string,
		recursive: boolean,
	): Promise<string[]> {
		const files: string[] = [];
		const entries = await fs.readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory() && recursive) {
				const subFiles = await this.findJsonlFiles(fullPath, recursive);
				files.push(...subFiles);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				files.push(fullPath);
			}
		}

		return files;
	}
}
