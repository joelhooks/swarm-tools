/**
 * Memory Schema Migration
 *
 * Adds semantic memory tables to the shared PGLite database.
 * This migration extends the existing swarm-mail schema.
 *
 * ## Migration Strategy
 * - Migration v9 adds memory tables to existing swarm-mail schema (v0-v8)
 * - Shares same PGLite database instance and migration system
 * - Uses same schema_version table for tracking
 *
 * ## Tables Created
 * - memories: Core memory records with content, metadata, collection
 * - memory_embeddings: Vector embeddings for semantic search (pgvector)
 *
 * ## Indexes
 * - HNSW index on embeddings for fast approximate nearest neighbor search
 * - GIN index on content for full-text search
 * - B-tree index on collection for filtering
 *
 * ## Design Notes
 * - Uses TEXT for IDs (like hive/beads)
 * - Uses TIMESTAMPTZ for timestamps (Postgres standard)
 * - Uses JSONB for metadata (flexible key-value storage)
 * - Uses vector(1024) for embeddings (mxbai-embed-large dimension)
 * - CASCADE deletes for referential integrity
 *
 * @module memory/migrations
 */

import type { Migration } from "../streams/migrations.js";

/**
 * Migration v9: Add memory tables
 *
 * This migration is designed to be appended to the existing migrations array
 * in src/streams/migrations.ts.
 */
export const memoryMigration: Migration = {
  version: 9,
  description: "Add semantic memory tables (memories, memory_embeddings)",
  up: `
    -- ========================================================================
    -- Enable pgvector extension (required for vector type)
    -- ========================================================================
    CREATE EXTENSION IF NOT EXISTS vector;

    -- ========================================================================
    -- Memories Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      collection TEXT DEFAULT 'default',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      confidence REAL DEFAULT 0.7
    );

    -- Collection filtering index
    CREATE INDEX IF NOT EXISTS idx_memories_collection ON memories(collection);

    -- Full-text search index
    CREATE INDEX IF NOT EXISTS memories_content_idx 
    ON memories 
    USING gin (to_tsvector('english', content));

    -- ========================================================================
    -- Memory Embeddings Table (pgvector)
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      embedding vector(1024) NOT NULL
    );

    -- HNSW index for fast approximate nearest neighbor search
    CREATE INDEX IF NOT EXISTS memory_embeddings_hnsw_idx 
    ON memory_embeddings 
    USING hnsw (embedding vector_cosine_ops);
  `,
  down: `
    -- Drop in reverse order to handle foreign key constraints
    DROP INDEX IF EXISTS memory_embeddings_hnsw_idx;
    DROP TABLE IF EXISTS memory_embeddings;
    DROP INDEX IF EXISTS memories_content_idx;
    DROP INDEX IF EXISTS idx_memories_collection;
    DROP TABLE IF EXISTS memories;
  `,
};

/**
 * Migration v9 (libSQL): Add memory tables
 *
 * LibSQL-compatible version using:
 * - F32_BLOB for vector embeddings (instead of pgvector)
 * - TEXT for metadata (instead of JSONB)
 * - TEXT for timestamps (instead of TIMESTAMPTZ)
 * - FTS5 virtual table (instead of PostgreSQL GIN index)
 */
export const memoryMigrationLibSQL: Migration = {
  version: 9,
  description: "Add semantic memory tables (memories with vector support, FTS5)",
  up: `
    -- ========================================================================
    -- Memories Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      collection TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      confidence REAL DEFAULT 0.7,
      embedding F32_BLOB(1024)
    );

    -- Collection filtering index
    CREATE INDEX IF NOT EXISTS idx_memories_collection ON memories(collection);

    -- Vector embedding index for fast similarity search
    CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories(libsql_vector_idx(embedding));

    -- ========================================================================
    -- FTS5 virtual table for full-text search
    -- ========================================================================
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts 
    USING fts5(id UNINDEXED, content, content=memories, content_rowid=rowid);

    -- Triggers to keep FTS5 in sync
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert 
    AFTER INSERT ON memories 
    BEGIN
      INSERT INTO memories_fts(rowid, id, content) 
      VALUES (new.rowid, new.id, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_update 
    AFTER UPDATE ON memories 
    BEGIN
      UPDATE memories_fts 
      SET content = new.content 
      WHERE rowid = new.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_delete 
    AFTER DELETE ON memories 
    BEGIN
      DELETE FROM memories_fts WHERE rowid = old.rowid;
    END;
  `,
  down: `
    -- Drop in reverse order
    DROP TRIGGER IF EXISTS memories_fts_delete;
    DROP TRIGGER IF EXISTS memories_fts_update;
    DROP TRIGGER IF EXISTS memories_fts_insert;
    DROP TABLE IF EXISTS memories_fts;
    DROP INDEX IF EXISTS idx_memories_embedding;
    DROP INDEX IF EXISTS idx_memories_collection;
    DROP TABLE IF EXISTS memories;
  `,
};

/**
 * Migration v10 (libSQL): Schema overhaul - Memory links, entities, relationships, temporal fields
 *
 * Implements features from Mem0/A-MEM research:
 * 1. Memory Linking (Zettelkasten-style bidirectional connections)
 * 2. Entity/Relationship Extraction (knowledge graph)
 * 3. Temporal Validity Windows
 * 4. Auto-generated metadata (auto_tags, keywords)
 *
 * New tables:
 * - memory_links: Bidirectional links between memories
 * - entities: Named entities extracted from memories
 * - relationships: Subject-predicate-object triples
 * - memory_entities: Junction table linking memories to entities
 *
 * New columns on memories:
 * - valid_from, valid_until: Temporal validity
 * - superseded_by: Memory supersession chains
 * - auto_tags: LLM-generated tags
 * - keywords: Space-separated keywords for FTS boost
 */
export const memorySchemaOverhaulLibSQL: Migration = {
  version: 10,
  description: "Memory schema overhaul: links, entities, relationships, temporal fields",
  up: `
    -- ========================================================================
    -- Add temporal and metadata columns to memories table
    -- ========================================================================
    ALTER TABLE memories ADD COLUMN valid_from TEXT;
    ALTER TABLE memories ADD COLUMN valid_until TEXT;
    ALTER TABLE memories ADD COLUMN superseded_by TEXT REFERENCES memories(id);
    ALTER TABLE memories ADD COLUMN auto_tags TEXT;
    ALTER TABLE memories ADD COLUMN keywords TEXT;

    -- ========================================================================
    -- Memory Links Table (Zettelkasten-style bidirectional connections)
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL,
      strength REAL DEFAULT 1.0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_id, target_id, link_type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_id);

    -- ========================================================================
    -- Entities Table (Named entities extracted from memories)
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(name, entity_type)
    );

    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);

    -- ========================================================================
    -- Relationships Table (Entity-entity triples)
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      predicate TEXT NOT NULL,
      object_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
      confidence REAL DEFAULT 1.0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(subject_id, predicate, object_id)
    );

    CREATE INDEX IF NOT EXISTS idx_relationships_subject ON relationships(subject_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_object ON relationships(object_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_predicate ON relationships(predicate);

    -- ========================================================================
    -- Memory-Entities Junction Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS memory_entities (
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      role TEXT,
      PRIMARY KEY(memory_id, entity_id)
    );
  `,
  down: `
    -- Drop tables in dependency order
    DROP TABLE IF EXISTS memory_entities;
    DROP TABLE IF EXISTS relationships;
    DROP INDEX IF EXISTS idx_memory_links_source;
    DROP INDEX IF EXISTS idx_memory_links_target;
    DROP TABLE IF EXISTS memory_links;
    DROP INDEX IF EXISTS idx_entities_type;
    DROP INDEX IF EXISTS idx_entities_name;
    DROP TABLE IF EXISTS entities;

    -- Remove columns from memories table (SQLite doesn't support DROP COLUMN until 3.35.0)
    -- In production, these columns can be left as NULL if downgrade is needed
    -- Or recreate table without these columns
  `,
};

/**
 * Export memory migrations array
 */
export const memoryMigrations: Migration[] = [memoryMigration];
export const memoryMigrationsLibSQL: Migration[] = [memoryMigrationLibSQL, memorySchemaOverhaulLibSQL];

/**
 * Repair stats returned by repairStaleEmbeddings
 */
export interface RepairStats {
  /** Number of memories that were re-embedded */
  repaired: number;
  /** Number of memories that were removed (couldn't be re-embedded) */
  removed: number;
}

/**
 * Simple Ollama-compatible interface for embedding
 */
export interface OllamaEmbedder {
  embed(text: string): Promise<number[]>;
}

/**
 * Repair stale embeddings in the database
 *
 * Fixes the "dimensions are different: 0 != 1024" error that occurs when:
 * - Memories were stored without embeddings (Ollama was down)
 * - User tries to search with a valid 1024-dim query vector
 *
 * Strategy:
 * - Finds memories with NULL or empty embeddings
 * - If Ollama is available: re-embeds the content and updates
 * - If Ollama is unavailable: deletes the memory (can't search without embedding)
 *
 * @param db - Database adapter instance
 * @param ollama - Optional Ollama embedder for re-embedding
 * @returns Stats about repaired and removed memories
 *
 * @example
 * ```typescript
 * // Without Ollama - removes memories without embeddings
 * const stats = await repairStaleEmbeddings(db);
 * console.log(`Removed ${stats.removed} memories without embeddings`);
 *
 * // With Ollama - re-embeds memories
 * const ollama = { embed: async (text) => [...] };
 * const stats = await repairStaleEmbeddings(db, ollama);
 * console.log(`Repaired ${stats.repaired}, removed ${stats.removed}`);
 * ```
 */
export async function repairStaleEmbeddings(
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  ollama?: OllamaEmbedder
): Promise<RepairStats> {
  const stats: RepairStats = { repaired: 0, removed: 0 };

  // Find memories with null embeddings
  // In libSQL, F32_BLOB can be NULL when not set
  const staleMemories = await db.query<{ id: string; content: string }>(
    `SELECT id, content FROM memories WHERE embedding IS NULL`
  );

  if (staleMemories.rows.length === 0) {
    return stats; // No stale memories to repair
  }

  // If Ollama is available, try to re-embed
  if (ollama) {
    for (const memory of staleMemories.rows) {
      try {
        // Generate new embedding
        const embedding = await ollama.embed(memory.content);
        
        // Update memory with new embedding
        await db.query(
          `UPDATE memories SET embedding = vector($1) WHERE id = $2`,
          [JSON.stringify(embedding), memory.id]
        );
        
        stats.repaired++;
      } catch (error) {
        // If embedding fails, remove the memory
        await db.query(`DELETE FROM memories WHERE id = $1`, [memory.id]);
        stats.removed++;
      }
    }
  } else {
    // No Ollama - remove all memories without embeddings
    // They can't be searched anyway, so keeping them would just cause errors
    for (const memory of staleMemories.rows) {
      await db.query(`DELETE FROM memories WHERE id = $1`, [memory.id]);
      stats.removed++;
    }
  }

  return stats;
}
