/**
 * Test Utilities for Memory Store
 *
 * Provides shared test setup for in-memory libSQL databases with full memory schema.
 * This ensures consistency across all memory-related tests by centralizing the schema setup.
 *
 * ## Key Features
 * - Creates in-memory libSQL database with full memory schema
 * - Includes vector index for similarity search (required for vector_top_k)
 * - Sets up FTS5 virtual table for full-text search fallback
 * - Creates triggers to keep FTS in sync with memories table
 * - Returns cleanup function for proper test teardown
 *
 * ## Usage
 * ```typescript
 * import { createTestMemoryDb } from 'swarm-mail';
 *
 * let cleanup: () => Promise<void>;
 *
 * beforeEach(async () => {
 *   const setup = await createTestMemoryDb();
 *   db = setup.db;
 *   client = setup.client;
 *   cleanup = setup.cleanup;
 * });
 *
 * afterEach(async () => {
 *   await cleanup();
 * });
 * ```
 *
 * ## Why This Exists
 * The critical piece that's often missed in manual schema setup is the vector index:
 * ```sql
 * CREATE INDEX idx_memories_embedding ON memories(libsql_vector_idx(embedding))
 * ```
 * Without it, vector_top_k() fails with "failed to parse vector index parameters".
 *
 * This utility ensures all memory tests use the same complete schema.
 */

import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import type { SwarmDb } from "../db/client.js";
import { createDrizzleClient } from "../db/drizzle.js";

/**
 * Create in-memory libSQL database with complete memory schema
 *
 * Sets up:
 * - memories table with F32_BLOB(1024) vector column
 * - FTS5 virtual table for full-text search
 * - Triggers to keep FTS in sync
 * - Vector index for similarity search
 *
 * @returns Database client, Drizzle client, and cleanup function
 */
export async function createTestMemoryDb(): Promise<{
  client: Client;
  db: SwarmDb;
  cleanup: () => Promise<void>;
}> {
  const client = createClient({ url: ":memory:" });

  // Create memories table with vector column (libSQL schema)
  // Must match db/schema/memory.ts exactly
  await client.execute(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      collection TEXT DEFAULT 'default',
      tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      decay_factor REAL DEFAULT 1.0,
      embedding F32_BLOB(1024),
      valid_from TEXT,
      valid_until TEXT,
      superseded_by TEXT REFERENCES memories(id),
      auto_tags TEXT,
      keywords TEXT,
      access_count TEXT DEFAULT '0',
      last_accessed TEXT DEFAULT (datetime('now')),
      category TEXT,
      status TEXT DEFAULT 'active'
    )
  `);

  // Create FTS5 virtual table for full-text search
  await client.execute(`
    CREATE VIRTUAL TABLE memories_fts USING fts5(
      content,
      content='memories',
      content_rowid='rowid'
    )
  `);

  // Create triggers to keep FTS in sync
  await client.execute(`
    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END
  `);
  await client.execute(`
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
    END
  `);
  await client.execute(`
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
      INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END
  `);

  // Create vector index for similarity search (CRITICAL - required for vector_top_k)
  await client.execute(`
    CREATE INDEX idx_memories_embedding ON memories(libsql_vector_idx(embedding))
  `);

  const db = createDrizzleClient(client);

  const cleanup = async () => {
    client.close();
  };

  return { client, db, cleanup };
}
