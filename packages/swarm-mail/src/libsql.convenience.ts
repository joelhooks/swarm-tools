/**
 * LibSQL Convenience Layer - Simple API for libSQL users
 *
 * Parallel to pglite.ts - provides simplified interface for users who want
 * libSQL without manually setting up adapters.
 *
 * ## Simple API (this file)
 * ```typescript
 * import { getSwarmMailLibSQL } from '@opencode/swarm-mail';
 *
 * const swarmMail = await getSwarmMailLibSQL('/path/to/project');
 * await swarmMail.registerAgent(projectKey, 'agent-name');
 * ```
 *
 * ## Advanced API (adapter pattern)
 * ```typescript
 * import { createLibSQLAdapter, createSwarmMailAdapter } from '@opencode/swarm-mail';
 *
 * const db = await createLibSQLAdapter({ url: 'libsql://...' });
 * const swarmMail = createSwarmMailAdapter(db, '/path/to/project');
 * ```
 */

import type { Client } from "@libsql/client";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createSwarmMailAdapter } from "./adapter.js";
import { createDrizzleClient } from "./db/drizzle.js";
import type { SwarmDb } from "./db/client.js";
import { createLibSQLAdapter, convertPlaceholders } from "./libsql.js";
import { createLibSQLMemorySchema } from "./memory/libsql-schema.js";
import { createLibSQLStreamsSchema } from "./streams/libsql-schema.js";
import type { SwarmMailAdapter } from "./types/adapter.js";
import type { DatabaseAdapter } from "./types/database.js";

/**
 * Global singleton instances cache
 *
 * Maps project path → SwarmMailAdapter instance.
 * Prevents duplicate connections to the same database.
 */
const instances = new Map<string, SwarmMailAdapter>();

/**
 * Get project-specific temporary directory name
 *
 * Creates a stable directory name based on project path:
 * `opencode-<project-name>-<hash>`
 *
 * @param projectPath - Absolute path to project
 * @returns Directory name (not full path)
 *
 * @example
 * ```typescript
 * getProjectTempDirName("/path/to/my-project");
 * // => "opencode-my-project-a1b2c3d4"
 * ```
 */
export function getProjectTempDirName(projectPath: string): string {
  const projectName = basename(projectPath);
  const hash = hashProjectPath(projectPath);

  // Sanitize project name for filesystem
  const safeName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32); // Prevent excessively long names

  return `opencode-${safeName}-${hash}`;
}

/**
 * Hash project path to 8-character hex string
 *
 * Uses SHA-256 truncated to 8 chars for project path disambiguation.
 *
 * @param projectPath - Path to hash
 * @returns 8-character hex hash
 */
export function hashProjectPath(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 8);
}

/**
 * Get database file path for a project
 *
 * Returns `file:/<tmpdir>/opencode-<project>-<hash>/streams.db`
 * or `file:/<tmpdir>/opencode-global/streams.db` if no project specified.
 *
 * Creates directory if it doesn't exist.
 *
 * @param projectPath - Optional project path (defaults to global)
 * @returns Database file URL for libSQL
 */
export function getDatabasePath(projectPath?: string): string {
  const dirName = projectPath
    ? getProjectTempDirName(projectPath)
    : "opencode-global";

  const dbDir = join(tmpdir(), dirName);

  // Create directory if needed
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  return `file:${join(dbDir, "streams.db")}`;
}

/**
 * Get SwarmMailAdapter for a project (singleton)
 *
 * Creates or returns existing adapter for the project.
 * Uses file-based libSQL database in system temp directory.
 *
 * **Singleton behavior:** Multiple calls with same path return same instance.
 *
 * @param projectPath - Absolute path to project (or undefined for global)
 * @returns SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * const swarmMail = await getSwarmMailLibSQL('/path/to/project');
 * await swarmMail.registerAgent(projectKey, 'agent-1');
 * ```
 */
export async function getSwarmMailLibSQL(
  projectPath?: string,
): Promise<SwarmMailAdapter> {
  const key = projectPath || "__global__";

  // Return existing instance if available
  if (instances.has(key)) {
    return instances.get(key)!;
  }

  // Create new instance
  const dbPath = getDatabasePath(projectPath);
  const db = await createLibSQLAdapter({ url: dbPath });

  // Initialize schemas
  await createLibSQLStreamsSchema(db);
  // Cast to access getClient() - we know this is a LibSQLAdapter
  await createLibSQLMemorySchema((db as any).getClient());

  const projectKey = projectPath || "global";
  const adapter = createSwarmMailAdapter(db, projectKey);

  // Cache instance
  instances.set(key, adapter);

  return adapter;
}

/**
 * Create in-memory SwarmMailAdapter for testing
 *
 * Uses `:memory:` database - no persistence.
 * Each call creates a new isolated instance.
 *
 * @param testId - Unique test identifier
 * @returns SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * const swarmMail = await createInMemorySwarmMailLibSQL('test-123');
 * // ... use for tests ...
 * await swarmMail.close();
 * ```
 */
export async function createInMemorySwarmMailLibSQL(
  testId: string,
): Promise<SwarmMailAdapter> {
  const db = await createLibSQLAdapter({ url: ":memory:" });

  // Initialize schemas
  await createLibSQLStreamsSchema(db);
  // Cast to access getClient() - we know this is a LibSQLAdapter
  await createLibSQLMemorySchema((db as any).getClient());

  return createSwarmMailAdapter(db, `test-${testId}`);
}

/**
 * Close SwarmMailAdapter for specific project
 *
 * Closes database connection and removes from singleton cache.
 *
 * @param projectPath - Project path (or undefined for global)
 */
export async function closeSwarmMailLibSQL(
  projectPath?: string,
): Promise<void> {
  const key = projectPath || "__global__";
  const instance = instances.get(key);

  if (instance) {
    await instance.close();
    instances.delete(key);
  }
}

/**
 * Close all SwarmMailAdapter instances
 *
 * Useful for cleanup in tests or application shutdown.
 */
export async function closeAllSwarmMailLibSQL(): Promise<void> {
  const closePromises = Array.from(instances.values()).map((instance) =>
    instance.close(),
  );

  await Promise.all(closePromises);
  instances.clear();
}

/**
 * Convert a DatabaseAdapter to a SwarmDb (Drizzle database)
 * 
 * This is useful when you have a DatabaseAdapter from getSwarmMailLibSQL()
 * but need a SwarmDb for the memory store.
 * 
 * @param adapter - DatabaseAdapter (must be a LibSQLAdapter internally)
 * @returns SwarmDb (Drizzle database)
 * @throws Error if adapter doesn't have getClient() method
 * 
 * @example
 * ```typescript
 * const swarmMail = await getSwarmMailLibSQL('/path/to/project');
 * const dbAdapter = await swarmMail.getDatabase();
 * const drizzleDb = toSwarmDb(dbAdapter);
 * 
 * // Now use drizzleDb with memory store
 * const store = createMemoryStore(drizzleDb);
 * ```
 */
export function toSwarmDb(adapter: DatabaseAdapter): SwarmDb {
  // LibSQLAdapter has a getClient() method that returns the underlying libSQL client
  const adapterWithClient = adapter as { getClient?: () => Client };
  if (!adapterWithClient.getClient) {
    throw new Error("DatabaseAdapter does not have getClient() method - must be a LibSQLAdapter");
  }
  return createDrizzleClient(adapterWithClient.getClient());
}

/**
 * Convert DatabaseAdapter OR PGlite to SwarmDb (Drizzle client)
 * 
 * Supports both:
 * - LibSQLAdapter (has getClient() method)
 * - PGlite (direct instance)
 * 
 * @param db - DatabaseAdapter or PGlite instance
 * @returns Drizzle client compatible with SwarmDb
 * 
 * @example
 * ```typescript
 * // Works with LibSQLAdapter
 * const adapter = await createLibSQLAdapter();
 * const drizzle = toDrizzleDb(adapter);
 * 
 * // Works with PGlite
 * const pglite = await getDatabase(projectPath);
 * const drizzle = toDrizzleDb(pglite);
 * ```
 */
export function toDrizzleDb(db: any): SwarmDb {
  // Check if it's a LibSQLAdapter (has getClient method)
  if (db && typeof db.getClient === 'function') {
    // LibSQL path - use existing createDrizzleClient
    return createDrizzleClient(db.getClient());
  }
  
  // Check if it's PGlite (has query and exec methods)
  if (db && typeof db.query === 'function' && typeof db.exec === 'function') {
    // PGlite path - use drizzle-orm/pglite adapter
    const { drizzle } = require('drizzle-orm/pglite');
    const { schema } = require('./db/schema/index.js');
    return drizzle(db, { schema });
  }
  
  throw new Error('Database must be either LibSQLAdapter (with getClient()) or PGlite (with query/exec)');
}
