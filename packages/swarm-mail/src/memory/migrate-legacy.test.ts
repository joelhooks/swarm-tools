/**
 * Tests for Legacy Memory Migration
 * 
 * **KEPT ON PGLITE** - This file tests migration FROM legacy semantic-memory
 * (which was PGLite-based) TO the current swarm-mail schema.
 * 
 * The migrate-legacy.ts tool assumes PostgreSQL schemas:
 * - Source: memories + memory_embeddings tables (PGLite)
 * - Target: memories + memory_embeddings tables (PGLite)
 * - Uses `::vector` cast syntax (PostgreSQL-specific)
 * 
 * LibSQL uses a different schema (embedding column in memories table, no separate
 * memory_embeddings table), so this migration path doesn't apply.
 * 
 * This is a one-time migration tool for users upgrading from standalone
 * semantic-memory MCP server (which was PGlite) to swarm-mail (also PGlite).
 */

// Skip all tests if PGLite is not available (it's a devDependency)
let pgliteAvailable = false;
let PGlite: typeof import("@electric-sql/pglite").PGlite | undefined;
let vector: typeof import("@electric-sql/pglite/vector").vector | undefined;

try {
  const pgliteModule = await import("@electric-sql/pglite");
  const vectorModule = await import("@electric-sql/pglite/vector");
  PGlite = pgliteModule.PGlite;
  vector = vectorModule.vector;
  pgliteAvailable = true;
} catch {
  console.log("PGLite not available, skipping migrate-legacy tests");
}

const describeIf = pgliteAvailable ? describe : describe.skip;

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  migrateLegacyMemories,
  getMigrationStatus,
  legacyDatabaseExists,
  targetHasMemories,
} from "./migrate-legacy.js";
import { runMigrations } from "../streams/migrations.js";
import type { DatabaseAdapter } from "../types/database.js";

/**
 * Wrap a PGlite instance as a DatabaseAdapter (inlined for test use only)
 */
function wrapPGlite(pglite: any): DatabaseAdapter {
  return {
    async query<T = unknown>(sql: string, params?: unknown[]) {
      const result = await pglite.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await pglite.exec(sql);
    },
    async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
      return await fn(this);
    },
    async close() {
      await pglite.close();
    },
  };
}

describeIf("Legacy Memory Migration", () => {
  let legacyDb: PGlite;
  let targetDb: PGlite;
  let legacyPath: string;
  let targetPath: string;

  beforeEach(async () => {
    // Create temp directories for test databases
    legacyPath = mkdtempSync(join(tmpdir(), "legacy-memory-"));
    targetPath = mkdtempSync(join(tmpdir(), "target-memory-"));

    // Create legacy database with old schema (PGLite - source of migration)
    legacyDb = await PGlite.create({
      dataDir: legacyPath,
      extensions: { vector },
    });

    // Initialize legacy schema
    await legacyDb.exec(`
      CREATE EXTENSION IF NOT EXISTS vector;
      
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        collection TEXT DEFAULT 'default',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_validated_at TIMESTAMPTZ
      );
      
      CREATE TABLE memory_embeddings (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        embedding vector(1024) NOT NULL
      );
    `);

    // Create target database with new schema (PGLite - migration destination)
    targetDb = await PGlite.create({
      dataDir: targetPath,
      extensions: { vector },
    });
    await runMigrations(targetDb);
  });

  afterEach(async () => {
    await legacyDb.close();
    await targetDb.close();
    rmSync(legacyPath, { recursive: true, force: true });
    rmSync(targetPath, { recursive: true, force: true });
  });

  describe("legacyDatabaseExists", () => {
    test("returns true for existing database", () => {
      expect(legacyDatabaseExists(legacyPath)).toBe(true);
    });

    test("returns false for non-existent path", () => {
      expect(legacyDatabaseExists("/nonexistent/path")).toBe(false);
    });
    
    test("returns false for directory without PGlite data files", () => {
      // Create an empty directory (no pglite.data file)
      const emptyDir = mkdtempSync(join(tmpdir(), "empty-dir-"));
      try {
        expect(legacyDatabaseExists(emptyDir)).toBe(false);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });

  describe("getMigrationStatus", () => {
    test("returns null for non-existent database", async () => {
      const status = await getMigrationStatus("/nonexistent/path");
      expect(status).toBeNull();
    });

    test("returns counts for existing database", async () => {
      // Insert test data
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory 1", "default"],
      );
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-2", "Test memory 2", "default"],
      );

      // Add embedding for one memory
      const embedding = new Array(1024).fill(0.1);
      await legacyDb.query(
        `INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)`,
        ["mem-1", `[${embedding.join(",")}]`],
      );

      const status = await getMigrationStatus(legacyPath);
      expect(status).not.toBeNull();
      expect(status?.total).toBe(2);
      expect(status?.withEmbeddings).toBe(1);
    });
  });

  describe("migrateLegacyMemories", () => {
    test("migrates memories without embeddings", async () => {
      // Insert test data in legacy database
      await legacyDb.query(
        `INSERT INTO memories (id, content, metadata, collection) VALUES ($1, $2, $3, $4)`,
        ["mem-1", "Test memory content", '{"key": "value"}', "test-collection"],
      );

      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {}, // Suppress output
      });

      expect(result.migrated).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);

      // Verify memory was migrated
      const migrated = await targetDb.query<{ id: string; content: string }>(
        `SELECT id, content FROM memories WHERE id = $1`,
        ["mem-1"],
      );
      expect(migrated.rows.length).toBe(1);
      expect(migrated.rows[0]?.content).toBe("Test memory content");
    });

    test("migrates memories with embeddings", async () => {
      // Insert test data with embedding
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory", "default"],
      );

      const embedding = new Array(1024).fill(0.5);
      await legacyDb.query(
        `INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)`,
        ["mem-1", `[${embedding.join(",")}]`],
      );

      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {},
      });

      expect(result.migrated).toBe(1);

      // Verify embedding was migrated
      const embeddingResult = await targetDb.query<{ memory_id: string }>(
        `SELECT memory_id FROM memory_embeddings WHERE memory_id = $1`,
        ["mem-1"],
      );
      expect(embeddingResult.rows.length).toBe(1);
    });

    test("skips existing memories", async () => {
      // Insert memory in legacy
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Legacy content", "default"],
      );

      // Insert same ID in target with different content
      await targetDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Target content", "default"],
      );

      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {},
      });

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);

      // Verify target content was preserved
      const preserved = await targetDb.query<{ content: string }>(
        `SELECT content FROM memories WHERE id = $1`,
        ["mem-1"],
      );
      expect(preserved.rows[0]?.content).toBe("Target content");
    });

    test("dry run reports without making changes", async () => {
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory", "default"],
      );

      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        dryRun: true,
        onProgress: () => {},
      });

      expect(result.migrated).toBe(1);
      expect(result.dryRun).toBe(true);

      // Verify nothing was actually migrated
      const check = await targetDb.query<{ id: string }>(
        `SELECT id FROM memories WHERE id = $1`,
        ["mem-1"],
      );
      expect(check.rows.length).toBe(0);
    });

    test("handles empty legacy database", async () => {
      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {},
      });

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    test("handles non-existent legacy path", async () => {
      const result = await migrateLegacyMemories({
        legacyPath: "/nonexistent/path",
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {},
      });

      expect(result.migrated).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    test("requires DatabaseAdapter with query method", async () => {
      // Insert test data in legacy database
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory content", "default"],
      );

      // This simulates the bug: passing an object without query() method
      // (like SwarmMailAdapter instead of DatabaseAdapter)
      const invalidAdapter = {
        // SwarmMailAdapter has getDatabase() but not query()
        getDatabase: async () => wrapPGlite(targetDb),
        close: async () => {},
      };

      const result = await migrateLegacyMemories({
        legacyPath,
        // @ts-expect-error - intentionally passing wrong type to test runtime behavior
        targetDb: invalidAdapter,
        onProgress: () => {},
      });

      // Should fail gracefully with error, not crash
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("query");
    });
  });

  describe("targetHasMemories", () => {
    test("returns false for empty database", async () => {
      const hasMemories = await targetHasMemories(wrapPGlite(targetDb));
      expect(hasMemories).toBe(false);
    });

    test("returns true when memories exist", async () => {
      // Insert a memory
      await targetDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory", "default"],
      );

      const hasMemories = await targetHasMemories(wrapPGlite(targetDb));
      expect(hasMemories).toBe(true);
    });

    test("returns false when table exists but is empty", async () => {
      // Just ensure table is empty (it already is from setup)
      const count = await targetDb.query<{ count: string }>(`SELECT COUNT(*) as count FROM memories`);
      expect(parseInt(count.rows[0]?.count || "0")).toBe(0);

      const hasMemories = await targetHasMemories(wrapPGlite(targetDb));
      expect(hasMemories).toBe(false);
    });
  });
});
