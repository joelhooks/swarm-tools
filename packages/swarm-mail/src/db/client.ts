/**
 * Unified database client for swarm-mail.
 * 
 * Wraps libSQL with Drizzle ORM and handles:
 * - Schema initialization (CREATE TABLE IF NOT EXISTS)
 * - Singleton pattern for production use
 * - In-memory instances for testing
 * 
 * @example
 * ```typescript
 * // Production - singleton
 * const db = await getDb("file:./swarm.db");
 * 
 * // Testing - fresh instance
 * const db = await createInMemoryDb();
 * ```
 */

import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema/index.js";

/**
 * Drizzle database instance type with full schema
 */
export type SwarmDb = LibSQLDatabase<typeof schema>;

/**
 * Global singleton instances
 */
let dbInstance: SwarmDb | undefined;
let clientInstance: Client | undefined;

/**
 * Initialize database schema.
 * 
 * Creates tables if they don't exist using both:
 * - Streams schema (events, agents, messages, reservations, etc.)
 * - Memory schema (memories with FTS5 and vector indexes)
 * 
 * @param client - libSQL client
 */
async function initializeSchema(client: Client): Promise<void> {
  // Import libSQL schema creation
  const { createLibSQLStreamsSchema } = await import("../streams/libsql-schema.js");
  const { createLibSQLMemorySchema } = await import("../memory/libsql-schema.js");
  const { createLibSQLAdapter } = await import("../libsql.js");
  
  // Create a database adapter to pass to streams schema creation
  const adapter = await createLibSQLAdapter({ url: ":memory:" });
  // Replace its internal client with ours
  Object.assign(adapter, { client });
  
  // Initialize streams schema (events, agents, messages, etc.)
  await createLibSQLStreamsSchema(adapter);
  
  // Initialize memory schema (memories table with FTS5 and vector indexes)
  await createLibSQLMemorySchema(client);
}

/**
 * Create an in-memory database instance.
 * 
 * Creates a fresh instance on each call - ideal for testing.
 * 
 * @returns Fresh Drizzle database instance
 * 
 * @example
 * ```typescript
 * const db = await createInMemoryDb();
 * await db.insert(messages).values({ ... });
 * ```
 */
export async function createInMemoryDb(): Promise<SwarmDb> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  
  await initializeSchema(client);
  
  return db;
}

/**
 * Get the singleton database instance.
 * 
 * Creates the instance on first call, returns cached instance on subsequent calls.
 * Defaults to in-memory if no path provided.
 * 
 * @param path - Database file path (optional). If omitted, uses in-memory.
 * @returns Singleton Drizzle database instance
 * 
 * @example
 * ```typescript
 * // In-memory (default)
 * const db = await getDb();
 * 
 * // File-based
 * const db = await getDb("file:./swarm.db");
 * ```
 */
export async function getDb(path?: string): Promise<SwarmDb> {
  if (!dbInstance) {
    const url = path || ":memory:";
    clientInstance = createClient({ url });
    dbInstance = drizzle(clientInstance, { schema });
    
    await initializeSchema(clientInstance);
  }
  
  return dbInstance;
}

/**
 * Close and cleanup database connection.
 * 
 * Closes the underlying libSQL client and clears singleton.
 * 
 * @example
 * ```typescript
 * await closeDb();
 * ```
 */
export async function closeDb(): Promise<void> {
  if (clientInstance) {
    clientInstance.close();
  }
  dbInstance = undefined;
  clientInstance = undefined;
}
