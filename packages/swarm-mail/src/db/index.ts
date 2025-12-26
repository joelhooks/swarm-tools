/**
 * Database module - unified libSQL + Drizzle client
 * 
 * Exports:
 * - Database client (getDb, createInMemoryDb, closeDb)
 * - Database types (SwarmDb)
 * - Drizzle schemas (re-exported from schema/index.ts)
 * - Worktree support (isWorktree, getMainRepoPath, resolveDbPath)
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
