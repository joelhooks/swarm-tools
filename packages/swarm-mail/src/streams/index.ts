/**
 * SwarmMail Streams - Utility functions and re-exports
 *
 * This module provides utility functions (withTimeout, withTiming, getDatabasePath)
 * and re-exports from other modules for backward compatibility.
 *
 * For database access, use:
 * - createLibSQLAdapter() for libSQL databases
 * - createSwarmMailAdapter() for SwarmMail operations
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ============================================================================
// Query Timeout Wrapper
// ============================================================================

/**
 * Wrap a promise with a timeout
 *
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param operation - Operation name for error message
 * @returns The result of the promise
 * @throws Error if timeout is reached
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	operation: string,
): Promise<T> {
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(
			() => reject(new Error(`${operation} timed out after ${ms}ms`)),
			ms,
		),
	);
	return Promise.race([promise, timeout]);
}

// ============================================================================
// Performance Monitoring
// ============================================================================

/** Threshold for slow query warnings in milliseconds */
const SLOW_QUERY_THRESHOLD_MS = 100;

/**
 * Execute a database operation with timing instrumentation.
 * Logs a warning if the operation exceeds SLOW_QUERY_THRESHOLD_MS.
 *
 * @param operation - Name of the operation for logging
 * @param fn - Async function to execute
 * @returns Result of the function
 */
export async function withTiming<T>(
	operation: string,
	fn: () => Promise<T>,
): Promise<T> {
	const start = performance.now();
	try {
		return await fn();
	} finally {
		const duration = performance.now() - start;
		if (duration > SLOW_QUERY_THRESHOLD_MS) {
			console.warn(
				`[SwarmMail] Slow operation: ${operation} took ${duration.toFixed(1)}ms`,
			);
		}
	}
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the database path for SwarmMail
 *
 * Always returns global ~/.config/swarm-tools/swarm.db
 * The projectPath parameter is kept for backward compatibility but ignored.
 *
 * @param projectPath - Deprecated, kept for backward compatibility but ignored
 * @returns Path to global swarm-tools database
 */
export function getDatabasePath(projectPath?: string): string {
	const globalDir = join(homedir(), ".config", "swarm-tools");
	if (!existsSync(globalDir)) {
		mkdirSync(globalDir, { recursive: true });
	}
	return join(globalDir, "swarm.db");
}

/**
 * Get paths to old project-local databases for migration detection
 *
 * Returns paths that should be checked for existing data that needs migration:
 * - libsql: Old libSQL database at {projectPath}/.opencode/streams.db
 * - pglite: Old PGlite database directory at {projectPath}/.opencode/streams/
 *
 * @param projectPath - Project directory path
 * @returns Object with paths to check for migration
 */
export function getOldProjectDbPaths(projectPath: string): {
	libsql: string;
	pglite: string;
} {
	const localDir = join(projectPath, ".opencode");
	return {
		libsql: join(localDir, "streams.db"),
		pglite: join(localDir, "streams"),
	};
}

// ============================================================================
// Exports
// ============================================================================

export * from "./agent-mail";
export * from "./events";
export * from "./migrations";
export type {
	Agent,
	Conflict,
	EvalRecord,
	EvalStats,
	InboxOptions,
	Message,
	Reservation,
} from "./projections-drizzle";

export {
	checkConflicts,
	getActiveReservations,
	getAgent,
	getAgents,
	getEvalRecords,
	getEvalStats,
	getInbox,
	getMessage,
	getThreadMessages,
} from "./projections-drizzle";
// Export adapter cache management
export { clearAdapterCache } from "./store";

// Export Drizzle wrapper functions (they match old signatures)
export {
	appendEvent,
	getLatestSequence,
	readEvents,
} from "./store-drizzle";

// Legacy exports for backward compatibility (still used by some high-level functions)
export * from "./swarm-mail";
