/**
 * CASS Tools - Cross-Agent Session Search
 *
 * Provides tools for searching across AI coding agent histories.
 * Uses inhouse SessionIndexer from swarm-mail package.
 *
 * Events emitted:
 * - cass_searched: When a search is performed
 * - cass_viewed: When a session is viewed
 * - cass_indexed: When the index is built/rebuilt
 */

import { tool } from "@opencode-ai/plugin";
import { Effect } from "effect";
import {
	getDb,
	makeOllamaLive,
	viewSessionLine,
	SessionIndexer,
	createEvent,
	getSwarmMailLibSQL,
	type SessionViewerOpts,
	type SessionSearchOptions,
	type IndexDirectoryOptions,
} from "swarm-mail";
import * as os from "node:os";
import * as path from "node:path";
import { AdapterCache } from "./utils/adapter-cache";

// ============================================================================
// Types
// ============================================================================

interface CassSearchArgs {
	query: string;
	agent?: string;
	days?: number;
	limit?: number;
	fields?: string;
}

interface CassViewArgs {
	path: string;
	line?: number;
}

interface CassExpandArgs {
	path: string;
	line: number;
	context?: number;
}

interface CassIndexArgs {
	full?: boolean;
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
// Helper Functions
// ============================================================================

const sessionIndexerCache = new AdapterCache<SessionIndexer>();

/**
 * Get or create SessionIndexer instance
 */
async function getSessionIndexer(): Promise<SessionIndexer> {
	// Use a singleton key since SessionIndexer isn't project-scoped
	const globalKey = "global-session-indexer";

	return sessionIndexerCache.get(globalKey, async () => {
		const db = await getDb();
		const ollamaLayer = makeOllamaLive({
			ollamaHost: process.env.OLLAMA_HOST || "http://localhost:11434",
			ollamaModel: process.env.OLLAMA_MODEL || "mxbai-embed-large",
		});

		return new SessionIndexer(db, ollamaLayer);
	});
}

/**
 * Emit event to swarm-mail event store
 */
async function emitEvent(
	eventType: string,
	data: Record<string, unknown>,
): Promise<void> {
	try {
		const projectPath = process.cwd();
		const swarmMail = await getSwarmMailLibSQL(projectPath);

		const event = createEvent(eventType as any, {
			project_key: projectPath,
			...data,
		});

		await swarmMail.appendEvent(event);
	} catch {
		// Silently fail event emission - don't break the tool
	}
}

/**
 * Detect agent type from file path
 */
function detectAgentType(filePath: string): string | undefined {
	if (filePath.includes("claude")) return "claude";
	if (filePath.includes("cursor")) return "cursor";
	if (filePath.includes("opencode")) return "opencode";
	if (filePath.includes("swarm-tools")) return "opencode-swarm";
	if (filePath.includes("codex")) return "codex";
	if (filePath.includes("aider")) return "aider";
	return undefined;
}

// ============================================================================
// Tools
// ============================================================================

/**
 * cass_search - Search across all AI coding agent histories
 */
const cass_search = tool({
	description:
		"Search across all AI coding agent histories (Claude, Codex, Cursor, Gemini, Aider, ChatGPT, Cline, OpenCode). Query BEFORE solving problems from scratch - another agent may have already solved it.",
	args: {
		query: tool.schema
			.string()
			.describe("Search query (e.g., 'authentication error Next.js')"),
		agent: tool.schema
			.string()
			.optional()
			.describe("Filter by agent name (e.g., 'claude', 'cursor')"),
		days: tool.schema
			.number()
			.optional()
			.describe("Only search sessions from last N days"),
		limit: tool.schema
			.number()
			.optional()
			.describe("Max results to return (default: 5)"),
		fields: tool.schema
			.string()
			.optional()
			.describe(
				"Field selection: 'minimal' for compact output (path, line, agent only)",
			),
	},
	async execute(args: CassSearchArgs): Promise<string> {
		const startTime = Date.now();

		try {
			const indexer = await getSessionIndexer();

			const searchOptions: SessionSearchOptions = {
				limit: args.limit || 5,
				agent_type: args.agent,
				fields: args.fields === "minimal" ? "minimal" : undefined,
			};

			// Run search with Effect
			const results = await Effect.runPromise(
				indexer.search(args.query, searchOptions).pipe(
					Effect.catchAll((error) => {
						// Graceful degradation: try FTS5 fallback
						console.warn(
							`Vector search failed, falling back to FTS5: ${error.message}`,
						);
						return Effect.succeed([]);
					}),
				),
			);

			// Emit event
			await emitEvent("cass_searched", {
				query: args.query,
				agent_filter: args.agent,
				days_filter: args.days,
				result_count: results.length,
				search_duration_ms: Date.now() - startTime,
			});

			// Format output
			if (results.length === 0) {
				return "No results found. Try:\n- Broader search terms\n- Different agent filter\n- Running cass_index to refresh";
			}

			// Return formatted results
			return results
				.map((result, idx) => {
					const metadata = result.memory.metadata as any;
					const agentType = metadata?.agent_type || "unknown";
					const sourcePath = metadata?.source_path || "unknown";
					const lineNumber = metadata?.message_idx || 0;

					if (args.fields === "minimal") {
						return `${idx + 1}. ${sourcePath}:${lineNumber} (${agentType})`;
					}

					return `${idx + 1}. [${agentType}] ${sourcePath}:${lineNumber}
   Score: ${result.score?.toFixed(3)}
   ${result.memory.content.slice(0, 200)}...
   `;
				})
				.join("\n");
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * cass_view - View a specific session from search results
 */
const cass_view = tool({
	description:
		"View a specific conversation/session from search results. Use source_path from cass_search output.",
	args: {
		path: tool.schema
			.string()
			.describe("Path to session file (from cass_search results)"),
		line: tool.schema
			.number()
			.optional()
			.describe("Jump to specific line number"),
	},
	async execute(args: CassViewArgs): Promise<string> {
		try {
			const opts: SessionViewerOpts = {
				path: args.path,
				line: args.line,
				context: 3,
			};

			const output = viewSessionLine(opts);

			// Emit event
			await emitEvent("cass_viewed", {
				session_path: args.path,
				line_number: args.line,
				agent_type: detectAgentType(args.path),
			});

			return output;
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * cass_expand - Expand context around a specific line
 */
const cass_expand = tool({
	description:
		"Expand context around a specific line in a session. Shows messages before/after.",
	args: {
		path: tool.schema.string().describe("Path to session file"),
		line: tool.schema.number().describe("Line number to expand around"),
		context: tool.schema
			.number()
			.optional()
			.describe("Number of lines before/after to show (default: 5)"),
	},
	async execute(args: CassExpandArgs): Promise<string> {
		try {
			const opts: SessionViewerOpts = {
				path: args.path,
				line: args.line,
				context: args.context || 5,
			};

			const output = viewSessionLine(opts);

			// Emit event
			await emitEvent("cass_viewed", {
				session_path: args.path,
				line_number: args.line,
			});

			return output;
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * cass_health - Check if cass index is healthy
 */
const cass_health = tool({
	description:
		"Check if cass index is healthy. Exit 0 = ready, Exit 1 = needs indexing. Run this before searching.",
	args: {},
	async execute(): Promise<string> {
		try {
			const indexer = await getSessionIndexer();

			const health = await Effect.runPromise(indexer.checkHealth());

			const isHealthy = health.total_indexed > 0 && health.stale_count === 0;

			return JSON.stringify({
				healthy: isHealthy,
				message: isHealthy
					? "Index is ready"
					: "Index needs rebuilding. Run cass_index()",
				...health,
			});
		} catch (error) {
			return JSON.stringify({
				healthy: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * cass_index - Build or rebuild the search index
 */
const cass_index = tool({
	description:
		"Build or rebuild the search index. Run this if health check fails or to pick up new sessions.",
	args: {
		full: tool.schema
			.boolean()
			.optional()
			.describe("Force full rebuild (default: incremental)"),
	},
	async execute(args: CassIndexArgs): Promise<string> {
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
								console.warn(`Skipping ${dir}: ${error.message}`);
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
			await emitEvent("cass_indexed", {
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
 * cass_stats - Show index statistics
 */
const cass_stats = tool({
	description:
		"Show index statistics - how many sessions, messages, agents indexed.",
	args: {},
	async execute(): Promise<string> {
		try {
			const indexer = await getSessionIndexer();

			const stats = await Effect.runPromise(indexer.getStats());

			return JSON.stringify(stats, null, 2);
		} catch (error) {
			return JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

// ============================================================================
// Exports
// ============================================================================

export const cassTools = {
	cass_search,
	cass_view,
	cass_expand,
	cass_health,
	cass_index,
	cass_stats,
};
