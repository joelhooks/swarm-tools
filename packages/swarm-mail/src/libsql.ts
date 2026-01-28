/**
 * LibSQLAdapter - libSQL implementation of DatabaseAdapter
 *
 * Wraps @libsql/client to implement the DatabaseAdapter interface.
 * Supports file-based, in-memory, and remote (Turso) databases.
 *
 * Key differences from PGLite:
 * - Uses ? placeholders instead of $1, $2, etc.
 * - Native vector support with F32_BLOB(N) columns
 * - No extensions needed for vector operations
 * - vector_distance_cos() returns distance (lower = more similar)
 *
 * Based on spike at packages/swarm-mail/scripts/sqlite-vec-spike.ts
 *
 * @example
 * ```typescript
 * // In-memory (for tests)
 * const db = await createLibSQLAdapter({ url: ":memory:" });
 *
 * // File-based
 * const db = await createLibSQLAdapter({ url: "file:./swarm.db" });
 *
 * // Remote (Turso)
 * const db = await createLibSQLAdapter({
 *   url: "libsql://[database].turso.io",
 *   authToken: process.env.TURSO_TOKEN
 * });
 * ```
 */

import type { Client, Config, InArgs, InStatement } from "@libsql/client";
import { createClient } from "@libsql/client";
import type { DatabaseAdapter, QueryResult } from "./types/database.js";

/**
 * LibSQL configuration options
 *
 * Extends @libsql/client Config with type safety.
 */
export interface LibSQLConfig {
	/** Database URL - ":memory:", "file:./path.db", or "libsql://..." */
	url: string;
	/** Auth token for remote Turso databases */
	authToken?: string;
	/** Connection timeout in milliseconds */
	timeout?: number;
}

/**
 * Convert PostgreSQL-style placeholders ($1, $2, ...) to SQLite-style (?)
 * and expand parameters for reused placeholders.
 *
 * PostgreSQL allows reusing placeholders (e.g., $1, $2, $1) but SQLite's ?
 * placeholders are strictly positional. This function:
 * 1. Converts $N to ? in order of appearance
 * 2. Expands the params array to match (duplicating values for reused placeholders)
 *
 * If SQL already uses ? placeholders (native SQLite style), params are passed through unchanged.
 *
 * @param sql - SQL string with PostgreSQL or SQLite placeholders
 * @param params - Original parameters array
 * @returns Object with converted SQL and expanded parameters
 *
 * @example
 * ```typescript
 * // PostgreSQL: VALUES ($1, $2, $1) with params [a, b]
 * // SQLite:     VALUES (?, ?, ?) with params [a, b, a]
 * const result = convertPlaceholders("VALUES ($1, $2, $1)", ["a", "b"]);
 * // result.sql = "VALUES (?, ?, ?)"
 * // result.params = ["a", "b", "a"]
 *
 * // Already SQLite style - pass through unchanged
 * const result2 = convertPlaceholders("VALUES (?, ?, ?)", ["a", "b", "c"]);
 * // result2.sql = "VALUES (?, ?, ?)"
 * // result2.params = ["a", "b", "c"]
 * ```
 */
export function convertPlaceholders(
	sql: string,
	params?: unknown[],
): { sql: string; params: unknown[] | undefined } {
	// Check if SQL contains PostgreSQL-style placeholders ($1, $2, etc.)
	const hasPgPlaceholders = /\$\d+/.test(sql);

	if (!hasPgPlaceholders) {
		// SQL already uses ? placeholders or has no placeholders - pass through unchanged
		return { sql, params };
	}

	if (!params || params.length === 0) {
		// No params, just replace placeholders with ?
		return { sql: sql.replace(/\$\d+/g, "?"), params };
	}

	// Pre-process: Identify which params are arrays used with ANY()
	// Pattern: "= ANY($N)" where $N references an array param
	const anyParamIndices = new Set<number>();
	const anyRegex = /=\s*ANY\(\$(\d+)\)/gi;
	for (const match of sql.matchAll(anyRegex)) {
		const paramIndex = Number.parseInt(match[1], 10) - 1;
		if (paramIndex >= 0 && paramIndex < params.length && Array.isArray(params[paramIndex])) {
			anyParamIndices.add(paramIndex);
		}
	}

	// Build result by processing SQL left-to-right
	let resultSql = "";
	const resultParams: unknown[] = [];
	let lastIndex = 0;

	// Combined regex: match either "= ANY($N)" or standalone "$N"
	const combinedRegex = /(=\s*ANY\(\$(\d+)\))|(\$(\d+))/gi;

	for (const match of sql.matchAll(combinedRegex)) {
		const matchStart = match.index ?? 0;
		const matchEnd = matchStart + match[0].length;

		// Add text before this match
		resultSql += sql.slice(lastIndex, matchStart);

		if (match[1]) {
			// This is an ANY($N) match
			const paramIndex = Number.parseInt(match[2], 10) - 1;
			const paramValue = params[paramIndex];

			if (Array.isArray(paramValue)) {
				if (paramValue.length === 0) {
					// Empty array - replace "= ANY($N)" with "IN (SELECT 1 WHERE 0)" (always false, syntactically valid)
					resultSql += "IN (SELECT 1 WHERE 0)";
					// No params to add
				} else {
					// Non-empty array - expand to "IN (?, ?, ...)"
					const placeholders = paramValue.map(() => "?").join(", ");
					resultSql += `IN (${placeholders})`;
					resultParams.push(...paramValue);
				}
			} else {
				// Not an array - keep original (will likely fail at runtime)
				resultSql += match[0].replace(/\$\d+/, "?");
				resultParams.push(paramValue);
			}
		} else if (match[3]) {
			// This is a standalone $N match
			const paramIndex = Number.parseInt(match[4], 10) - 1;

			// Skip if this param was already handled by ANY() (shouldn't happen with proper SQL)
			if (!anyParamIndices.has(paramIndex)) {
				resultSql += "?";
				if (paramIndex >= 0 && paramIndex < params.length) {
					resultParams.push(params[paramIndex]);
				}
			} else {
				// This $N is part of an ANY() that was already processed - skip
				resultSql += "?";
				if (paramIndex >= 0 && paramIndex < params.length) {
					resultParams.push(params[paramIndex]);
				}
			}
		}

		lastIndex = matchEnd;
	}

	// Add remaining text after last match
	resultSql += sql.slice(lastIndex);

	return { sql: resultSql, params: resultParams };
}

/**
 * LibSQLAdapter implementation
 *
 * Wraps libSQL client to match DatabaseAdapter interface.
 * Automatically converts PostgreSQL-style placeholders ($1, $2) to SQLite-style (?).
 */
class LibSQLAdapter implements DatabaseAdapter {
	constructor(private client: Client) {}

	/**
	 * Get the underlying libSQL client for Drizzle ORM
	 *
	 * Used by modules that need direct Drizzle access (e.g., hive projections).
	 */
	getClient(): Client {
		return this.client;
	}

	async query<T = unknown>(
		sql: string,
		params?: unknown[],
	): Promise<QueryResult<T>> {
		// Convert PostgreSQL placeholders to SQLite placeholders and expand params
		const converted = convertPlaceholders(sql, params);

		const result = await this.client.execute({
			sql: converted.sql,
			args: converted.params as InArgs | undefined,
		});

		// libSQL returns { rows: Row[] } where Row is Record<string, any>
		// Cast to T[] to match interface
		return {
			rows: result.rows as T[],
		};
	}

	async exec(sql: string): Promise<void> {
		// Convert PostgreSQL placeholders to SQLite placeholders
		const converted = convertPlaceholders(sql);
		// Use executeMultiple to handle multi-statement SQL (e.g., migrations)
		await this.client.executeMultiple(converted.sql);
	}

	async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
		// libSQL batch API with "write" mode provides transactional semantics
		// Strategy: collect operations, execute as batch, handle rollback

		let result: T;
		let capturedError: Error | undefined;

		// Create a transaction adapter that collects statements
		const txStatements: InStatement[] = [];

		const txAdapter: DatabaseAdapter = {
			query: async <U = unknown>(
				sql: string,
				params?: unknown[],
			): Promise<QueryResult<U>> => {
				// For queries in transactions, we need to execute immediately
				// because we might need the results for subsequent operations
				// Convert PostgreSQL placeholders to SQLite placeholders and expand params
				const converted = convertPlaceholders(sql, params);
				const res = await this.client.execute({
					sql: converted.sql,
					args: converted.params as InArgs | undefined,
				});
				return { rows: res.rows as U[] };
			},
			exec: async (sql: string): Promise<void> => {
				// Convert PostgreSQL placeholders to SQLite placeholders
				const converted = convertPlaceholders(sql);
				txStatements.push({ sql: converted.sql });
			},
		};

		try {
			// Execute the transaction function
			result = await fn(txAdapter);

			// If there are pending statements, execute them as a batch
			if (txStatements.length > 0) {
				await this.client.batch(txStatements, "write");
			}
		} catch (error) {
			capturedError = error instanceof Error ? error : new Error(String(error));
			throw capturedError;
		}

		return result;
	}

	async close(): Promise<void> {
		this.client.close();
	}

	async checkpoint(): Promise<void> {
		await this.client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
	}
}

/**
 * Create a LibSQLAdapter instance
 *
 * Factory function that creates and initializes a libSQL database connection.
 *
 * @param config - LibSQL configuration (url, authToken, etc.)
 * @returns DatabaseAdapter instance
 *
 * @example
 * ```typescript
 * const db = await createLibSQLAdapter({ url: ":memory:" });
 * await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
 * await db.close();
 * ```
 */
export async function createLibSQLAdapter(
	config: LibSQLConfig,
): Promise<DatabaseAdapter> {
	// Normalize bare filesystem paths to file: URLs
	// libSQL requires URL format - bare paths like "/path/to/db.db" fail with URL_INVALID
	// Valid formats: ":memory:", "file:/path", "file:./path", "libsql://", "http://", "https://"
	let url = config.url;
	if (
		url !== ":memory:" &&
		!url.startsWith("file:") &&
		!url.startsWith("libsql:") &&
		!url.startsWith("http:") &&
		!url.startsWith("https:")
	) {
		url = `file:${url}`;
	}

	const clientConfig: Config = {
		url,
		...(config.authToken && { authToken: config.authToken }),
	};

	const client = createClient(clientConfig);

	// Verify connection with a simple query
	await client.execute("SELECT 1");

	// CRITICAL: Enable incremental auto vacuum to prevent database bloat
	// MUST be set BEFORE any tables are created - it's a one-time setting
	// Incremental mode marks freed pages for reuse without blocking operations
	// (unlike FULL vacuum which requires exclusive lock and rebuilds entire DB)
	await client.execute("PRAGMA auto_vacuum = INCREMENTAL");

	// CRITICAL: Enable foreign key constraints
	// libSQL enables FK by default, but we set it explicitly for:
	// 1. Defensive programming (guards against future libSQL changes)
	// 2. Self-documenting code (explicit contract)
	// 3. Consistency with standard SQLite patterns
	// Prevents orphaned references (e.g., 208 orphaned message_recipients in audit)
	await client.execute("PRAGMA foreign_keys = ON");

	// Set busy_timeout to 5 seconds for automatic retry on SQLITE_BUSY
	// This prevents "database is locked" errors during concurrent access
	await client.execute("PRAGMA busy_timeout = 5000");

	// Enable WAL (Write-Ahead Logging) mode for better concurrent performance
	// WAL allows readers to not block writers and vice versa
	// This is especially beneficial for multi-agent coordination where multiple
	// agents may be reading/writing events simultaneously
	await client.execute("PRAGMA journal_mode = WAL");

	// Checkpoint any abandoned WAL frames from prior process crashes
	// This ensures data written by a previous short-lived process (e.g., swarm CLI)
	// is flushed to the main DB file before we start reading
	await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");

	return new LibSQLAdapter(client);
}
