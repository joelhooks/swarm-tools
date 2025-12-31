/**
 * Database module - unified libSQL + Drizzle client
 * 
 * Exports:
 * - Database client (getDb, createInMemoryDb, closeDb)
 * - Database types (SwarmDb)
 * - Drizzle schemas (re-exported from schema/index.ts)
 * - Worktree support (isWorktree, getMainRepoPath, resolveDbPath)
 * - Database consolidation (detectStrayDatabases, consolidateDatabases, etc.)
 * 
 * @example
 * ```typescript
 * import { getDb, createInMemoryDb } from "swarm-mail/db";
 * 
 * // Production
 * const db = await getDb("file:./swarm.db");
 * 
 * // Testing
 * const db = await createInMemoryDb();
 * 
 * // Worktree support
 * import { isWorktree, getMainRepoPath, resolveDbPath } from "swarm-mail/db";
 * if (isWorktree("/path/to/worktree")) {
 *   const mainPath = getMainRepoPath("/path/to/worktree");
 *   const dbPath = resolveDbPath("/path/to/worktree");
 * }
 * 
 * // Database consolidation
 * import { consolidateDatabases } from "swarm-mail/db";
 * const report = await consolidateDatabases(projectPath, globalDbPath, { yes: true });
 * ```
 */

// Client functions
export { closeDb, createInMemoryDb, getDb } from "./client.js";
// Types
export type { SwarmDb } from "./client.js";
// Legacy Drizzle wrapper (keep for backward compatibility)
export { createDrizzleClient } from "./drizzle.js";
export type { DrizzleClient } from "./drizzle.js";
// Schemas (barrel re-export - will be populated by parallel workers)
export * as schema from "./schema/index.js";
// Worktree support
export { getMainRepoPath, isWorktree, resolveDbPath } from "./worktree.js";
// Database consolidation
export {
	analyzeStrayDatabase,
	consolidateDatabases,
	detectStrayDatabases,
	migrateToGlobal,
} from "./consolidate-databases.js";
export type {
	ConsolidationOptions,
	ConsolidationReport,
	DatabaseAnalysis,
	MigrationResult,
	StrayDatabase,
	StrayLocation,
} from "./consolidate-databases.js";
