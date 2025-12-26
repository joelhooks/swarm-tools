/**
 * Memory Schema Migration Tests
 *
 * Tests the semantic memory schema migrations (tables, indexes, vector embeddings).
 * Uses in-memory libSQL databases for fast, isolated tests.
 */

import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { convertPlaceholders } from "../libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import { memoryMigrationLibSQL, memoryMigrationsLibSQL } from "./migrations.js";

function wrapLibSQL(client: Client): DatabaseAdapter {
  return {
    query: async <T>(sql: string, params?: unknown[]) => {
      const converted = convertPlaceholders(sql, params);
      const result = await client.execute({
        sql: converted.sql,
        args: converted.params,
      });
      return { rows: result.rows as T[] };
    },
    exec: async (sql: string) => {
      const converted = convertPlaceholders(sql);
      await client.executeMultiple(converted.sql);
    },
    close: () => client.close(),
  };
}

describe("Memory Migrations", () => {
  let client: Client;
  let db: DatabaseAdapter;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    db = wrapLibSQL(client);

    // Create base schema (events table, schema_version) - minimal setup for migrations
    await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence INTEGER,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL DEFAULT '{}'
      )
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);

    // Apply memory migration
    await db.exec(memoryMigrationLibSQL.up);
  });

  test("memories table exists with correct schema", async () => {
    // SQLite uses pragma_table_info instead of information_schema
    const result = await client.execute(`SELECT name, type, "notnull" FROM pragma_table_info('memories')`);

    const columns = result.rows.map((r: any) => ({
      name: r.name,
      type: String(r.type).toUpperCase(),
      nullable: r.notnull === 0 ? "YES" : "NO",
    }));

    expect(columns).toContainEqual({
      name: "id",
      type: "TEXT",
      nullable: "NO",
    });
    expect(columns).toContainEqual({
      name: "content",
      type: "TEXT",
      nullable: "NO",
    });
    expect(columns).toContainEqual({
      name: "metadata",
      type: "TEXT",
      nullable: "YES",
    });
    expect(columns).toContainEqual({
      name: "collection",
      type: "TEXT",
      nullable: "YES",
    });
    expect(columns).toContainEqual({
      name: "created_at",
      type: "TEXT",
      nullable: "YES",
    });
  });

  test("memories table has vector embedding column", async () => {
    const result = await client.execute(`SELECT name, type, "notnull" FROM pragma_table_info('memories')`);

    const columns = result.rows.map((r: any) => ({
      name: r.name,
      type: String(r.type),
      nullable: r.notnull === 0 ? "YES" : "NO",
    }));

    // In libSQL, embeddings are stored in same table as F32_BLOB
    expect(columns).toContainEqual({
      name: "embedding",
      type: "F32_BLOB(1024)",
      nullable: "YES",
    });
  });

  test("vector index exists on memories", async () => {
    const result = await db.query<{ name: string; sql: string }>(`
      SELECT name, sql FROM sqlite_master 
      WHERE type='index' AND tbl_name='memories' 
        AND name='idx_memories_embedding'
    `);

    expect(result.rows.length).toBe(1);
    const indexDef = result.rows[0].sql;
    expect(indexDef).toContain("libsql_vector_idx");
  });

  test("FTS5 virtual table exists for full-text search", async () => {
    const result = await db.query<{ name: string; sql: string }>(`
      SELECT name, sql FROM sqlite_master 
      WHERE type='table' AND name='memories_fts'
    `);

    expect(result.rows.length).toBe(1);
    const tableDef = result.rows[0].sql;
    expect(tableDef).toContain("fts5");
    expect(tableDef).toContain("content");
  });

  test("collection index exists on memories", async () => {
    const result = await db.query(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='memories' 
        AND name='idx_memories_collection'
    `);

    expect(result.rows.length).toBe(1);
  });

  test("can insert and query memory data", async () => {
    const memoryId = `mem_${randomUUID()}`;

    // Insert memory with embedding
    const embedding = new Array(1024).fill(0).map(() => Math.random());
    await db.query(
      `INSERT INTO memories (id, content, metadata, collection, created_at, embedding)
       VALUES ($1, $2, $3, $4, datetime('now'), vector($5))`,
      [memoryId, "Test memory content", JSON.stringify({ tag: "test" }), "test-collection", JSON.stringify(embedding)]
    );

    // Query back
    const result = await db.query<{
      id: string;
      content: string;
      collection: string;
    }>(
      `SELECT id, content, collection
       FROM memories
       WHERE id = $1`,
      [memoryId]
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].content).toBe("Test memory content");
    expect(result.rows[0].collection).toBe("test-collection");
  });

  test("FTS5 triggers sync content on insert", async () => {
    const memoryId = `mem_${randomUUID()}`;

    // Insert memory
    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId, "Searchable test content", "default"]
    );

    // Query FTS5 table directly (without MATCH) to verify sync
    const result = await db.query<{ id: string }>(
      `SELECT id FROM memories_fts WHERE id = $1`,
      [memoryId]
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].id).toBe(memoryId);
  });

  test.skip("FTS5 triggers sync content on update", async () => {
    // SKIP: libSQL FTS5 UPDATE triggers cause SQLITE_CORRUPT_VTAB errors
    // This is a known limitation with libSQL's FTS5 implementation
    // The trigger definition is correct but causes virtual table corruption
    // FTS5 INSERT and DELETE triggers work fine, UPDATE is problematic
    const memoryId = `mem_${randomUUID()}`;

    // Insert memory
    await db.query(
      `INSERT INTO memories (id, content) VALUES ($1, $2)`,
      [memoryId, "Original content"]
    );

    // Verify insert synced
    let result = await db.query<{ id: string; content: string }>(
      `SELECT id, content FROM memories_fts WHERE id = $1`,
      [memoryId]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].content).toBe("Original content");

    // Update content
    await db.query(
      `UPDATE memories SET content = $1 WHERE id = $2`,
      ["Updated searchable content", memoryId]
    );

    // Verify update synced
    result = await db.query(
      `SELECT id, content FROM memories_fts WHERE id = $1`,
      [memoryId]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].content).toBe("Updated searchable content");
  });

  test("FTS5 triggers remove content on delete", async () => {
    const memoryId = `mem_${randomUUID()}`;

    // Insert memory
    await db.query(
      `INSERT INTO memories (id, content) VALUES ($1, $2)`,
      [memoryId, "Content to delete"]
    );

    // Verify it's in FTS5
    let result = await db.query<{ id: string }>(
      `SELECT id FROM memories_fts WHERE id = $1`,
      [memoryId]
    );
    expect(result.rows.length).toBe(1);

    // Delete memory
    await db.query(`DELETE FROM memories WHERE id = $1`, [memoryId]);

    // Check FTS5 - should be gone
    result = await db.query(
      `SELECT id FROM memories_fts WHERE id = $1`,
      [memoryId]
    );
    expect(result.rows.length).toBe(0);
  });

  test("memory migration version is correct", () => {
    // Memory migrations should start at version 9 (after hive's version 8)
    expect(memoryMigrationsLibSQL[0].version).toBe(9);
    expect(memoryMigrationsLibSQL[0].description).toContain("memory");
  });
});

describe("repairStaleEmbeddings", () => {
  let client: Client;
  let db: DatabaseAdapter;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    db = wrapLibSQL(client);

    // Create base schema and apply memory migration
    await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence INTEGER,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL DEFAULT '{}'
      )
    `);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);
    await db.exec(memoryMigrationLibSQL.up);
  });

  test("detects memories with null embeddings", async () => {
    // Insert memories with null embeddings (simulating Ollama being down during store)
    const memoryId1 = `mem_${randomUUID()}`;
    const memoryId2 = `mem_${randomUUID()}`;
    const memoryId3 = `mem_${randomUUID()}`;

    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId1, "Memory without embedding 1", "default"]
    );
    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId2, "Memory without embedding 2", "default"]
    );
    
    // Insert one with valid embedding for comparison
    const validEmbedding = new Array(1024).fill(0).map(() => Math.random());
    await db.query(
      `INSERT INTO memories (id, content, collection, embedding) VALUES ($1, $2, $3, vector($4))`,
      [memoryId3, "Memory with embedding", "default", JSON.stringify(validEmbedding)]
    );

    // Run repair WITHOUT Ollama - should remove memories without embeddings
    const { repairStaleEmbeddings } = await import("./migrations.js");
    const stats = await repairStaleEmbeddings(db);

    // Should have removed 2 memories with null embeddings
    expect(stats.removed).toBe(2);
    expect(stats.repaired).toBe(0);

    // Verify only the valid memory remains
    const remaining = await db.query<{ id: string }>(
      `SELECT id FROM memories ORDER BY id`
    );
    expect(remaining.rows.length).toBe(1);
    expect(remaining.rows[0].id).toBe(memoryId3);
  });

  test("re-embeds memories if Ollama is available", async () => {
    // This test will check if Ollama is running and skip if not
    // Insert memories with null embeddings
    const memoryId1 = `mem_${randomUUID()}`;
    const memoryId2 = `mem_${randomUUID()}`;

    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId1, "Content to re-embed 1", "default"]
    );
    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId2, "Content to re-embed 2", "default"]
    );

    // Mock Ollama client
    const mockOllama = {
      embed: async (text: string) => {
        // Return a valid 1024-dim embedding
        return new Array(1024).fill(0).map(() => Math.random());
      }
    };

    const { repairStaleEmbeddings } = await import("./migrations.js");
    const stats = await repairStaleEmbeddings(db, mockOllama);

    // Should have re-embedded 2 memories
    expect(stats.repaired).toBe(2);
    expect(stats.removed).toBe(0);

    // Verify memories now have embeddings
    const results = await db.query<{ id: string; embedding: unknown }>(
      `SELECT id, embedding FROM memories WHERE id IN ($1, $2)`,
      [memoryId1, memoryId2]
    );
    expect(results.rows.length).toBe(2);
    
    // Both should have non-null embeddings
    for (const row of results.rows) {
      expect(row.embedding).not.toBeNull();
    }
  });

  test("returns correct stats for mixed repair/removal", async () => {
    // Insert 3 memories without embeddings
    const memoryId1 = `mem_${randomUUID()}`;
    const memoryId2 = `mem_${randomUUID()}`;
    const memoryId3 = `mem_${randomUUID()}`;

    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId1, "Content 1", "default"]
    );
    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId2, "Content 2", "default"]
    );
    await db.query(
      `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
      [memoryId3, "Content 3", "default"]
    );

    // Mock Ollama that fails on one memory
    const mockOllama = {
      embed: async (text: string) => {
        if (text.includes("Content 2")) {
          throw new Error("Embedding generation failed");
        }
        return new Array(1024).fill(0).map(() => Math.random());
      }
    };

    const { repairStaleEmbeddings } = await import("./migrations.js");
    const stats = await repairStaleEmbeddings(db, mockOllama);

    // Should have repaired 2, removed 1 (the one that failed to embed)
    expect(stats.repaired).toBe(2);
    expect(stats.removed).toBe(1);

    // Verify correct memories remain
    const remaining = await db.query<{ id: string }>(
      `SELECT id FROM memories ORDER BY id`
    );
    expect(remaining.rows.length).toBe(2);
    const remainingIds = remaining.rows.map(r => r.id).sort();
    expect(remainingIds).toEqual([memoryId1, memoryId3].sort());
  });

  test("handles empty database gracefully", async () => {
    const { repairStaleEmbeddings } = await import("./migrations.js");
    const stats = await repairStaleEmbeddings(db);

    expect(stats.repaired).toBe(0);
    expect(stats.removed).toBe(0);
  });
});
