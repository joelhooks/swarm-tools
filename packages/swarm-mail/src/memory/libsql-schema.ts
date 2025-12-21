/**
 * libSQL Memory Schema - FTS5 and Vector Extensions
 *
 * Provides FTS5 full-text search and vector indexes for memories table.
 * 
 * ## Schema Source of Truth
 * - **Table structure**: db/schema/memory.ts (Drizzle schema)
 * - **FTS5/vector DDL**: This file (raw SQL - Drizzle can't create these)
 * 
 * ## Synchronization
 * The memories table definition MUST match db/schema/memory.ts exactly.
 * Changes to table structure should be made in db/schema/memory.ts first,
 * then reflected here.
 *
 * ## Key Differences from PGlite
 *
 * | PGlite (pgvector)        | libSQL                               |
 * |--------------------------|--------------------------------------|
 * | `vector(768)`            | `F32_BLOB(768)`                      |
 * | `$1::vector`             | `vector(?)`                          |
 * | `embedding <=> $1`       | `vector_distance_cos(embedding, vector(?))` |
 * | `CREATE EXTENSION vector`| Not needed (native support)          |
 * | GIN FTS index            | FTS5 virtual table                   |
 * | JSONB                    | TEXT (JSON stored as string)         |
 * | TIMESTAMPTZ              | TEXT (ISO 8601 string)               |
 *
 * ## Vector Search Notes
 * - libSQL returns distance (0 = identical, 2 = opposite)
 * - To get similarity score: similarity = 1 - distance
 * - Lower distance = higher similarity (opposite of pgvector score)
 *
 * @module memory/libsql-schema
 */

import type { Client } from "@libsql/client";

/** Embedding dimension for mxbai-embed-large (matches PGlite schema) */
export const EMBEDDING_DIM = 1024;

/**
 * Create libSQL memory schema with FTS5 and vector support
 *
 * Creates:
 * - memories table (structure from db/schema/memory.ts)
 * - FTS5 virtual table for full-text search (Drizzle can't create this)
 * - Vector index (Drizzle can't create this)
 * - Standard indexes for performance
 *
 * Idempotent - safe to call multiple times.
 *
 * @param db - libSQL client instance
 * @throws Error if schema creation fails
 *
 * @example
 * ```typescript
 * import { createClient } from "@libsql/client";
 * import { createLibSQLMemorySchema } from "./libsql-schema.js";
 *
 * const db = createClient({ url: ":memory:" });
 * await createLibSQLMemorySchema(db);
 * ```
 */
export async function createLibSQLMemorySchema(db: Client): Promise<void> {
  // ========================================================================
  // Memories Table
  // ========================================================================
  // IMPORTANT: This table structure MUST match db/schema/memory.ts (Drizzle schema)
  // Source of truth: db/schema/memory.ts
  // Reason for duplication: Convenience for tests and migrations
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      collection TEXT DEFAULT 'default',
      tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      decay_factor REAL DEFAULT 1.0,
      embedding F32_BLOB(${EMBEDDING_DIM})
    )
  `);

  // ========================================================================
  // Indexes (Drizzle doesn't auto-create these)
  // ========================================================================
  
  // Collection filtering index
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_memories_collection 
    ON memories(collection)
  `);

  // Vector index for cosine similarity search
  // libSQL requires explicit index creation for vector_top_k() queries
  // MUST be raw SQL - Drizzle doesn't support libsql_vector_idx() function
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_memories_embedding 
    ON memories(libsql_vector_idx(embedding))
  `);

  // ========================================================================
  // FTS5 Virtual Table (raw SQL - Drizzle can't create virtual tables)
  // ========================================================================
  
  // FTS5 virtual table for full-text search
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts 
    USING fts5(id UNINDEXED, content, content=memories, content_rowid=rowid)
  `);

  // Triggers to keep FTS5 table in sync with memories table
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert 
    AFTER INSERT ON memories 
    BEGIN
      INSERT INTO memories_fts(rowid, id, content) 
      VALUES (new.rowid, new.id, new.content);
    END
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_delete 
    AFTER DELETE ON memories 
    BEGIN
      DELETE FROM memories_fts WHERE rowid = old.rowid;
    END
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_update 
    AFTER UPDATE ON memories 
    BEGIN
      UPDATE memories_fts 
      SET id = new.id, content = new.content 
      WHERE rowid = new.rowid;
    END
  `);
}

/**
 * Drop libSQL memory schema
 *
 * Removes all tables, indexes, and triggers created by createLibSQLMemorySchema.
 * Useful for tests and cleanup.
 *
 * @param db - libSQL client instance
 */
export async function dropLibSQLMemorySchema(db: Client): Promise<void> {
  // Drop triggers first
  await db.execute("DROP TRIGGER IF EXISTS memories_fts_update");
  await db.execute("DROP TRIGGER IF EXISTS memories_fts_delete");
  await db.execute("DROP TRIGGER IF EXISTS memories_fts_insert");

  // Drop FTS5 table
  await db.execute("DROP TABLE IF EXISTS memories_fts");

  // Drop indexes
  await db.execute("DROP INDEX IF EXISTS idx_memories_collection");

  // Drop main table
  await db.execute("DROP TABLE IF EXISTS memories");
}

/**
 * Verify libSQL memory schema exists and is valid
 *
 * Checks for:
 * - memories table with required columns
 * - FTS5 virtual table
 * - Required indexes
 * - Required triggers
 *
 * @param db - libSQL client instance
 * @returns True if schema is valid, false otherwise
 */
export async function validateLibSQLMemorySchema(db: Client): Promise<boolean> {
  try {
    // Check memories table exists
    const tables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='memories'
    `);
    if (tables.rows.length === 0) return false;

    // Check FTS5 table exists
    const fts = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='memories_fts'
    `);
    if (fts.rows.length === 0) return false;

    // Check required columns exist
    const columns = await db.execute(`
      SELECT name FROM pragma_table_info('memories')
    `);
    const columnNames = columns.rows.map((r) => r.name);
    const required = ["id", "content", "metadata", "collection", "tags", "created_at", "updated_at", "decay_factor", "embedding"];
    
    for (const col of required) {
      if (!columnNames.includes(col)) return false;
    }

    return true;
  } catch {
    return false;
  }
}
