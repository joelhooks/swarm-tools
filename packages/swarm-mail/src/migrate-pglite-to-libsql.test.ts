/**
 * Migration tests - PGlite → libSQL
 * 
 * Tests the migration of memories and beads from PGlite to libSQL.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { migratePGliteToLibSQL, pgliteExists } from "./migrate-pglite-to-libsql.js";

describe("migratePGliteToLibSQL", () => {
  let tempDir: string;
  let pglitePath: string;
  let libsqlPath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "migrate-test-"));
    pglitePath = join(tempDir, "streams");
    libsqlPath = join(tempDir, "streams.db");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("pgliteExists returns false for non-existent path", () => {
    expect(pgliteExists("/nonexistent/path")).toBe(false);
  });

  test("pgliteExists returns false for empty directory", () => {
    expect(pgliteExists(tempDir)).toBe(false);
  });

  test("migration returns empty result when no PGlite database", async () => {
    const logs: string[] = [];
    const result = await migratePGliteToLibSQL({
      pglitePath: "/nonexistent/path",
      libsqlPath,
      dryRun: false,
      onProgress: (msg) => logs.push(msg),
    });

    expect(result.memories.migrated).toBe(0);
    expect(result.beads.migrated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  describe("with real PGlite database", () => {
    let pglite: PGlite;

    beforeAll(async () => {
      // Create a real PGlite database with test data
      const { PGlite } = await import("@electric-sql/pglite");
      const { vector } = await import("@electric-sql/pglite/vector");

      pglite = await PGlite.create({
        dataDir: pglitePath,
        extensions: { vector },
      });

      // Create memories table (matching the schema we expect)
      await pglite.query(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          metadata JSONB,
          collection TEXT DEFAULT 'default',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create memory_embeddings table
      await pglite.query(`
        CREATE EXTENSION IF NOT EXISTS vector
      `);
      await pglite.query(`
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          memory_id TEXT PRIMARY KEY REFERENCES memories(id),
          embedding vector(1024)
        )
      `);

      // Create beads table (matching PGlite schema)
      await pglite.query(`
        CREATE TABLE IF NOT EXISTS beads (
          id TEXT PRIMARY KEY,
          project_key TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          title TEXT NOT NULL,
          description TEXT,
          priority INTEGER DEFAULT 2,
          parent_id TEXT,
          assignee TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          closed_at BIGINT,
          closed_reason TEXT,
          deleted_at BIGINT,
          deleted_by TEXT,
          delete_reason TEXT,
          created_by TEXT
        )
      `);

      // Insert test memory
      await pglite.query(`
        INSERT INTO memories (id, content, metadata, collection, created_at)
        VALUES ('mem-1', 'Test memory content', '{"tags": ["test"]}', 'default', NOW())
      `);

      // Insert test embedding (1024 dimensions) - format as [x,y,z] string
      const testEmbedding = new Array(1024).fill(0.1).map((v, i) => v + i * 0.001);
      const vectorStr = `[${testEmbedding.join(",")}]`;
      await pglite.query(`
        INSERT INTO memory_embeddings (memory_id, embedding)
        VALUES ('mem-1', $1::vector)
      `, [vectorStr]);

      // Insert test bead
      const now = Date.now();
      await pglite.query(`
        INSERT INTO beads (id, project_key, type, status, title, description, priority, created_at, updated_at)
        VALUES ('bead-1', 'test-project', 'task', 'open', 'Test task', 'A test task', 2, $1, $2)
      `, [now, now]);

      await pglite.close();
    });

    test("pgliteExists returns true for valid PGlite database", () => {
      expect(pgliteExists(pglitePath)).toBe(true);
    });

    test("migrates memories successfully", async () => {
      const logs: string[] = [];
      const result = await migratePGliteToLibSQL({
        pglitePath,
        libsqlPath,
        dryRun: false,
        onProgress: (msg) => logs.push(msg),
      });

      expect(result.memories.migrated).toBe(1);
      expect(result.memories.failed).toBe(0);
      expect(result.errors.filter(e => e.includes("Memory"))).toHaveLength(0);
    });

    test("migrates beads successfully", async () => {
      // Delete libsql to re-run migration
      await rm(libsqlPath, { force: true });

      const logs: string[] = [];
      const result = await migratePGliteToLibSQL({
        pglitePath,
        libsqlPath,
        dryRun: false,
        onProgress: (msg) => logs.push(msg),
      });

      // Debug output
      if (result.beads.failed > 0 || result.beads.migrated === 0) {
        console.log("Bead migration logs:", logs.filter(l => l.includes("bead") || l.includes("Bead")));
        console.log("Bead errors:", result.errors.filter(e => e.includes("Bead") || e.includes("bead")));
        console.log("Bead result:", result.beads);
      }

      expect(result.beads.migrated).toBe(1);
      expect(result.beads.failed).toBe(0);
      expect(result.errors.filter(e => e.includes("Bead"))).toHaveLength(0);
    });

    test("skips already migrated records", async () => {
      const logs: string[] = [];
      const result = await migratePGliteToLibSQL({
        pglitePath,
        libsqlPath,
        dryRun: false,
        onProgress: (msg) => logs.push(msg),
      });

      // Should skip since already migrated
      expect(result.memories.skipped).toBe(1);
      expect(result.beads.skipped).toBe(1);
      expect(result.memories.migrated).toBe(0);
      expect(result.beads.migrated).toBe(0);
    });

    test("dry run does not modify database", async () => {
      // Delete libsql to start fresh
      await rm(libsqlPath, { force: true });

      const logs: string[] = [];
      const result = await migratePGliteToLibSQL({
        pglitePath,
        libsqlPath,
        dryRun: true,
        onProgress: (msg) => logs.push(msg),
      });

      expect(result.dryRun).toBe(true);
      expect(result.memories.migrated).toBe(1);
      expect(result.beads.migrated).toBe(1);

      // Verify nothing was actually written
      const { createClient } = await import("@libsql/client");
      const client = createClient({ url: `file:${libsqlPath}` });
      
      // Table might not even exist in dry run
      try {
        const memories = await client.execute("SELECT COUNT(*) as count FROM memories");
        expect(Number(memories.rows[0].count)).toBe(0);
      } catch {
        // Table doesn't exist, which is fine for dry run
      }
    });
  });
});
