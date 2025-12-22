/**
 * Memory Sync Tests - TDD First
 *
 * Tests for JSONL export/import of memories for git sync.
 * Following the same pattern as hive/jsonl.ts
 */

import { describe, test, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestLibSQLDb } from "../test-libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import {
  exportMemories,
  importMemories,
  syncMemories,
  parseMemoryJSONL,
  serializeMemoryToJSONL,
  type MemoryExport,
} from "./sync.js";

// ============================================================================
// Test Setup
// ============================================================================

const TEST_DIR = join(tmpdir(), `test-memory-sync-${Date.now()}`);
const HIVE_DIR = join(TEST_DIR, ".hive");

describe("Memory Sync", () => {
  let db: DatabaseAdapter;

  beforeAll(async () => {
    // Create test directories
    mkdirSync(HIVE_DIR, { recursive: true });
  });

  beforeEach(async () => {
    // Create fresh in-memory database with full schema for each test
    const { adapter } = await createTestLibSQLDb();
    db = adapter;
  });

  afterAll(async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ==========================================================================
  // Serialize / Parse Tests
  // ==========================================================================

  describe("serializeMemoryToJSONL", () => {
    test("serializes memory to JSON line", () => {
      const memory: MemoryExport = {
        id: "mem-abc123",
        information: "OAuth tokens need 5min buffer before expiry",
        metadata: "auth,tokens",
        tags: "oauth,refresh",
        confidence: 0.9,
        created_at: "2024-12-19T00:00:00.000Z",
      };

      const line = serializeMemoryToJSONL(memory);
      const parsed = JSON.parse(line);

      expect(parsed.id).toBe("mem-abc123");
      expect(parsed.information).toBe("OAuth tokens need 5min buffer before expiry");
      expect(parsed.confidence).toBe(0.9);
    });

    test("handles optional fields", () => {
      const memory: MemoryExport = {
        id: "mem-xyz",
        information: "Simple memory",
        created_at: "2024-12-19T00:00:00.000Z",
      };

      const line = serializeMemoryToJSONL(memory);
      const parsed = JSON.parse(line);

      expect(parsed.id).toBe("mem-xyz");
      expect(parsed.metadata).toBeUndefined();
      expect(parsed.tags).toBeUndefined();
      expect(parsed.confidence).toBeUndefined();
    });
  });

  describe("parseMemoryJSONL", () => {
    test("parses empty string to empty array", () => {
      const result = parseMemoryJSONL("");
      expect(result).toEqual([]);
    });

    test("parses single line", () => {
      const jsonl = '{"id":"mem-1","information":"test","created_at":"2024-12-19T00:00:00.000Z"}';
      const result = parseMemoryJSONL(jsonl);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("mem-1");
    });

    test("parses multiple lines", () => {
      const jsonl = [
        '{"id":"mem-1","information":"first","created_at":"2024-12-19T00:00:00.000Z"}',
        '{"id":"mem-2","information":"second","created_at":"2024-12-19T00:00:00.000Z"}',
      ].join("\n");

      const result = parseMemoryJSONL(jsonl);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("mem-1");
      expect(result[1].id).toBe("mem-2");
    });

    test("skips empty lines", () => {
      const jsonl = [
        '{"id":"mem-1","information":"first","created_at":"2024-12-19T00:00:00.000Z"}',
        "",
        '{"id":"mem-2","information":"second","created_at":"2024-12-19T00:00:00.000Z"}',
        "",
      ].join("\n");

      const result = parseMemoryJSONL(jsonl);
      expect(result).toHaveLength(2);
    });

    test("throws on invalid JSON", () => {
      const jsonl = '{"id":"mem-1","information":"test"'; // Missing closing brace

      expect(() => parseMemoryJSONL(jsonl)).toThrow("Invalid JSON");
    });
  });

  // ==========================================================================
  // Export Tests
  // ==========================================================================

  describe("exportMemories", () => {
    test("exports empty database to empty string", async () => {
      const result = await exportMemories(db);
      expect(result).toBe("");
    });

    test("exports memories to JSONL format", async () => {
      // Insert test memory directly
      await db.query(
        `INSERT INTO memories (id, content, metadata, collection, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          "mem-export-1",
          "Test memory for export",
          JSON.stringify({ tags: ["test", "export"], confidence: 0.85 }),
          "default",
          new Date().toISOString(),
        ]
      );

      const result = await exportMemories(db);
      const lines = result.split("\n").filter(Boolean);

      expect(lines.length).toBeGreaterThanOrEqual(1);

      const line = lines.find((l) => l.includes("mem-export-1"));
      expect(line).toBeDefined();
      const parsed = JSON.parse(line as string);
      expect(parsed.id).toBe("mem-export-1");
      expect(parsed.information).toBe("Test memory for export");
      expect(parsed.confidence).toBe(0.85);
    });

    test("exports with collection filter", async () => {
      // Insert memories in different collections
      await db.query(
        `INSERT INTO memories (id, content, metadata, collection, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        ["mem-coll-a", "Collection A memory", "{}", "collection-a", new Date().toISOString()]
      );
      await db.query(
        `INSERT INTO memories (id, content, metadata, collection, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        ["mem-coll-b", "Collection B memory", "{}", "collection-b", new Date().toISOString()]
      );

      const result = await exportMemories(db, { collection: "collection-a" });
      const lines = result.split("\n").filter(Boolean);

      expect(lines.some((l) => l.includes("mem-coll-a"))).toBe(true);
      expect(lines.some((l) => l.includes("mem-coll-b"))).toBe(false);
    });

    test("does NOT include embeddings (too large)", async () => {
      // Insert memory with embedding
      // In libSQL, embedding is stored as F32_BLOB in the memories table itself
      const embedding = new Float32Array(1024).fill(0.1);
      await db.query(
        `INSERT INTO memories (id, content, metadata, collection, created_at, embedding)
         VALUES ($1, $2, $3, $4, $5, vector($6))`,
        ["mem-with-embed", "Memory with embedding", "{}", "default", new Date().toISOString(), JSON.stringify(Array.from(embedding))]
      );

      const result = await exportMemories(db);
      const line = result.split("\n").find((l) => l.includes("mem-with-embed"));
      expect(line).toBeDefined();
      const parsed = JSON.parse(line as string);

      expect(parsed.embedding).toBeUndefined();
    });
  });

  // ==========================================================================
  // Import Tests
  // ==========================================================================

  describe("importMemories", () => {
    test("imports empty string with no changes", async () => {
      const result = await importMemories(db, "");

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test("imports new memory", async () => {
      const jsonl = JSON.stringify({
        id: "mem-import-new",
        information: "Imported memory",
        metadata: "test",
        tags: "import",
        confidence: 0.75,
        created_at: "2024-12-19T00:00:00.000Z",
      });

      const result = await importMemories(db, jsonl);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify in database
      const dbResult = await db.query<{ id: string; content: string }>(
        "SELECT id, content FROM memories WHERE id = $1",
        ["mem-import-new"]
      );
      expect(dbResult.rows).toHaveLength(1);
      expect(dbResult.rows[0].content).toBe("Imported memory");
    });

    test("skips duplicate IDs", async () => {
      // First import
      const jsonl = JSON.stringify({
        id: "mem-dupe-test",
        information: "Original",
        created_at: "2024-12-19T00:00:00.000Z",
      });
      await importMemories(db, jsonl);

      // Second import with same ID
      const jsonl2 = JSON.stringify({
        id: "mem-dupe-test",
        information: "Duplicate",
        created_at: "2024-12-19T00:00:00.000Z",
      });
      const result = await importMemories(db, jsonl2);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);

      // Verify original content preserved
      const dbResult = await db.query<{ content: string }>(
        "SELECT content FROM memories WHERE id = $1",
        ["mem-dupe-test"]
      );
      expect(dbResult.rows[0].content).toBe("Original");
    });

    test("imports multiple memories", async () => {
      const jsonl = [
        '{"id":"mem-multi-1","information":"First","created_at":"2024-12-19T00:00:00.000Z"}',
        '{"id":"mem-multi-2","information":"Second","created_at":"2024-12-19T00:00:00.000Z"}',
        '{"id":"mem-multi-3","information":"Third","created_at":"2024-12-19T00:00:00.000Z"}',
      ].join("\n");

      const result = await importMemories(db, jsonl);

      expect(result.created).toBe(3);
      expect(result.skipped).toBe(0);
    });

    test("handles import errors gracefully", async () => {
      // Mix of valid and invalid
      const jsonl = [
        '{"id":"mem-valid","information":"Valid","created_at":"2024-12-19T00:00:00.000Z"}',
        '{"id":"","information":"Missing ID","created_at":"2024-12-19T00:00:00.000Z"}', // Invalid: empty ID
      ].join("\n");

      const result = await importMemories(db, jsonl);

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].memoryId).toBe("");
    });

    test("preserves metadata and tags on import", async () => {
      const jsonl = JSON.stringify({
        id: "mem-meta-import",
        information: "Memory with metadata",
        metadata: "auth,tokens",
        tags: "oauth,refresh",
        confidence: 0.92,
        created_at: "2024-12-19T00:00:00.000Z",
      });

      await importMemories(db, jsonl);

      const dbResult = await db.query<{ metadata: string }>(
        "SELECT metadata FROM memories WHERE id = $1",
        ["mem-meta-import"]
      );
      // libSQL returns JSON as TEXT string - always parse
      const metadata = JSON.parse(dbResult.rows[0].metadata);

      expect(metadata.tags).toContain("oauth");
      expect(metadata.tags).toContain("refresh");
      expect(metadata.confidence).toBe(0.92);
    });
  });

  // ==========================================================================
  // Sync Tests
  // ==========================================================================

  describe("syncMemories", () => {
    const syncTestDir = join(TEST_DIR, "sync-test");
    const syncHiveDir = join(syncTestDir, ".hive");

    beforeAll(() => {
      mkdirSync(syncHiveDir, { recursive: true });
    });

    test("creates memories.jsonl if not exists", async () => {
      const memoriesPath = join(syncHiveDir, "memories.jsonl");

      // Ensure file doesn't exist
      if (existsSync(memoriesPath)) {
        rmSync(memoriesPath);
      }

      // Insert a memory to export
      await db.query(
        `INSERT INTO memories (id, content, metadata, collection, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        ["mem-sync-create", "Sync test memory", "{}", "default", new Date().toISOString()]
      );

      await syncMemories(db, syncHiveDir);

      expect(existsSync(memoriesPath)).toBe(true);
      const content = readFileSync(memoriesPath, "utf-8");
      expect(content).toContain("mem-sync-create");
    });

    test("imports from existing memories.jsonl", async () => {
      const memoriesPath = join(syncHiveDir, "memories.jsonl");

      // Write a memory to file that doesn't exist in DB
      const jsonl = JSON.stringify({
        id: "mem-from-file",
        information: "Memory from file",
        created_at: "2024-12-19T00:00:00.000Z",
      });
      writeFileSync(memoriesPath, jsonl);

      await syncMemories(db, syncHiveDir);

      // Verify imported
      const dbResult = await db.query<{ id: string }>(
        "SELECT id FROM memories WHERE id = $1",
        ["mem-from-file"]
      );
      expect(dbResult.rows).toHaveLength(1);
    });

    test("bidirectional sync merges both directions", async () => {
      const memoriesPath = join(syncHiveDir, "memories.jsonl");

      // Memory only in DB
      await db.query(
        `INSERT INTO memories (id, content, metadata, collection, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        ["mem-db-only", "Only in database", "{}", "default", new Date().toISOString()]
      );

      // Memory only in file
      const fileMemory = JSON.stringify({
        id: "mem-file-only",
        information: "Only in file",
        created_at: "2024-12-19T00:00:00.000Z",
      });
      writeFileSync(memoriesPath, fileMemory);

      await syncMemories(db, syncHiveDir);

      // Both should now be in DB
      const dbOnlyResult = await db.query("SELECT id FROM memories WHERE id = $1", ["mem-db-only"]);
      const fileOnlyResult = await db.query("SELECT id FROM memories WHERE id = $1", ["mem-file-only"]);
      expect(dbOnlyResult.rows).toHaveLength(1);
      expect(fileOnlyResult.rows).toHaveLength(1);

      // Both should be in file
      const content = readFileSync(memoriesPath, "utf-8");
      expect(content).toContain("mem-db-only");
      expect(content).toContain("mem-file-only");
    });
  });
});
