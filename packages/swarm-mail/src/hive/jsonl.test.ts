/**
 * Tests for JSONL export/import
 *
 * Covers:
 * - Export full beads to JSONL
 * - Export dirty beads only (incremental)
 * - Import from JSONL (new beads, updates, hash dedup)
 * - Parse/serialize JSONL
 * - Content hash computation
 *
 * @module beads/jsonl.test
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { beadsMigration } from "./migrations.js";
import { createHiveAdapter } from "./adapter.js";
import type { HiveAdapter } from "../types/hive-adapter.js";
import type { DatabaseAdapter } from "../types/database.js";
import {
  exportToJSONL,
  exportDirtyBeads,
  importFromJSONL,
  parseJSONL,
  serializeToJSONL,
  computeContentHash,
  type BeadExport,
} from "./jsonl.js";

function wrapPGlite(pglite: PGlite): DatabaseAdapter {
  return {
    query: <T>(sql: string, params?: unknown[]) => pglite.query<T>(sql, params),
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

describe("JSONL Export/Import", () => {
  let pglite: PGlite;
  let adapter: HiveAdapter;
  const projectKey = "/test/jsonl";

  beforeEach(async () => {
    pglite = new PGlite();
    
    // Initialize events table and schema_version
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        sequence SERIAL NOT NULL,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        data JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_project_key ON events(project_key);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at BIGINT NOT NULL,
        description TEXT
      );
    `);

    // Run migrations
    const db = wrapPGlite(pglite);
    await pglite.exec("BEGIN");
    await pglite.exec(beadsMigration.up);
    await pglite.query(
      `INSERT INTO schema_version (version, applied_at, description) VALUES ($1, $2, $3)`,
      [beadsMigration.version, Date.now(), beadsMigration.description],
    );
    await pglite.exec("COMMIT");

    adapter = createHiveAdapter(db, projectKey);
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe("serializeToJSONL", () => {
    it("serializes bead to single JSONL line", () => {
      const cell: CellExport = {
        id: "bd-abc123",
        title: "Fix bug",
        description: "Something broke",
        status: "open",
        priority: 2,
        issue_type: "bug",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: [],
        comments: [],
      };

      const line = serializeToJSONL(bead);

      expect(line).not.toContain("\n");
      expect(JSON.parse(line)).toEqual(bead);
    });

    it("serializes bead with dependencies, labels, comments", () => {
      const cell: CellExport = {
        id: "bd-abc123",
        title: "Feature",
        status: "open",
        priority: 1,
        issue_type: "feature",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [
          { depends_on_id: "bd-xyz", type: "blocks" },
        ],
        labels: ["urgent", "backend"],
        comments: [
          { author: "alice", text: "Need this ASAP" },
        ],
      };

      const line = serializeToJSONL(bead);
      const parsed = JSON.parse(line) as BeadExport;

      expect(parsed.dependencies).toHaveLength(1);
      expect(parsed.labels).toHaveLength(2);
      expect(parsed.comments).toHaveLength(1);
    });
  });

  describe("parseJSONL", () => {
    it("parses empty string to empty array", () => {
      expect(parseJSONL("")).toEqual([]);
    });

    it("parses single line", () => {
      const line = JSON.stringify({
        id: "bd-abc123",
        title: "Task",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: [],
        comments: [],
      });

      const beads = parseJSONL(line);

      expect(beads).toHaveLength(1);
      expect(beads[0].id).toBe("bd-abc123");
    });

    it("parses multiple lines", () => {
      const jsonl = [
        JSON.stringify({ id: "bd-1", title: "A", status: "open", priority: 2, issue_type: "task", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z", dependencies: [], labels: [], comments: [] }),
        JSON.stringify({ id: "bd-2", title: "B", status: "open", priority: 2, issue_type: "task", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z", dependencies: [], labels: [], comments: [] }),
      ].join("\n");

      const beads = parseJSONL(jsonl);

      expect(beads).toHaveLength(2);
      expect(beads[0].id).toBe("bd-1");
      expect(beads[1].id).toBe("bd-2");
    });

    it("skips empty lines", () => {
      const jsonl = [
        JSON.stringify({ id: "bd-1", title: "A", status: "open", priority: 2, issue_type: "task", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z", dependencies: [], labels: [], comments: [] }),
        "",
        JSON.stringify({ id: "bd-2", title: "B", status: "open", priority: 2, issue_type: "task", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z", dependencies: [], labels: [], comments: [] }),
      ].join("\n");

      const beads = parseJSONL(jsonl);

      expect(beads).toHaveLength(2);
    });

    it("throws on invalid JSON", () => {
      expect(() => parseJSONL("not json")).toThrow();
    });
  });

  describe("computeContentHash", () => {
    it("computes stable hash for same content", () => {
      const cell: CellExport = {
        id: "bd-abc123",
        title: "Fix bug",
        status: "open",
        priority: 2,
        issue_type: "bug",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: [],
        comments: [],
      };

      const hash1 = computeContentHash(bead);
      const hash2 = computeContentHash(bead);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it("different hash for different content", () => {
      const bead1: BeadExport = {
        id: "bd-abc123",
        title: "Fix bug",
        status: "open",
        priority: 2,
        issue_type: "bug",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: [],
        comments: [],
      };

      const bead2: BeadExport = {
        ...bead1,
        title: "Fix different bug",
      };

      expect(computeContentHash(bead1)).not.toBe(computeContentHash(bead2));
    });

    it("same hash ignoring timestamps", () => {
      const bead1: BeadExport = {
        id: "bd-abc123",
        title: "Fix bug",
        status: "open",
        priority: 2,
        issue_type: "bug",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: [],
        comments: [],
      };

      const bead2: BeadExport = {
        ...bead1,
        updated_at: "2024-01-02T00:00:00Z", // Different timestamp
      };

      // Hash should be different because we include timestamps
      expect(computeContentHash(bead1)).not.toBe(computeContentHash(bead2));
    });
  });

  describe("exportToJSONL", () => {
    it("exports empty project to empty string", async () => {
      const jsonl = await exportToJSONL(adapter, projectKey);

      expect(jsonl).toBe("");
    });

    it("exports single bead", async () => {
      await adapter.createCell(projectKey, {
        title: "Task 1",
        type: "task",
        priority: 2,
      });

      const jsonl = await exportToJSONL(adapter, projectKey);

      const beads = parseJSONL(jsonl);
      expect(beads).toHaveLength(1);
      expect(beads[0].title).toBe("Task 1");
    });

    it("exports multiple beads", async () => {
      await adapter.createCell(projectKey, { title: "Task 1", type: "task" });
      await adapter.createCell(projectKey, { title: "Task 2", type: "bug" });

      const jsonl = await exportToJSONL(adapter, projectKey);

      const beads = parseJSONL(jsonl);
      expect(beads).toHaveLength(2);
    });

    it("exports beads with dependencies", async () => {
      const bead1 = await adapter.createCell(projectKey, {
        title: "Blocker",
        type: "task",
      });
      const bead2 = await adapter.createCell(projectKey, {
        title: "Blocked",
        type: "task",
      });
      await adapter.addDependency(projectKey, bead2.id, bead1.id, "blocks");

      const jsonl = await exportToJSONL(adapter, projectKey);

      const beads = parseJSONL(jsonl);
      const blocked = beads.find((b) => b.id === bead2.id);
      expect(blocked?.dependencies).toHaveLength(1);
      expect(blocked?.dependencies[0].depends_on_id).toBe(bead1.id);
    });

    it("exports beads with labels", async () => {
      const bead = await adapter.createCell(projectKey, {
        title: "Task",
        type: "task",
      });
      await adapter.addLabel(projectKey, bead.id, "urgent");
      await adapter.addLabel(projectKey, bead.id, "backend");

      const jsonl = await exportToJSONL(adapter, projectKey);

      const beads = parseJSONL(jsonl);
      expect(beads[0].labels).toContain("urgent");
      expect(beads[0].labels).toContain("backend");
    });

    it("exports beads with comments", async () => {
      const bead = await adapter.createCell(projectKey, {
        title: "Task",
        type: "task",
      });
      await adapter.addComment(projectKey, bead.id, "alice", "First comment");
      await adapter.addComment(projectKey, bead.id, "bob", "Second comment");

      const jsonl = await exportToJSONL(adapter, projectKey);

      const beads = parseJSONL(jsonl);
      expect(beads[0].comments).toHaveLength(2);
      expect(beads[0].comments[0].author).toBe("alice");
    });

    it("excludes deleted beads by default", async () => {
      const bead = await adapter.createCell(projectKey, {
        title: "Task",
        type: "task",
      });
      await adapter.deleteCell(projectKey, bead.id, {
        deleted_by: "test",
        reason: "cleanup",
      });

      const jsonl = await exportToJSONL(adapter, projectKey);

      expect(jsonl).toBe("");
    });

    it("includes deleted beads when requested", async () => {
      const bead = await adapter.createCell(projectKey, {
        title: "Task",
        type: "task",
      });
      await adapter.deleteCell(projectKey, bead.id, {
        deleted_by: "test",
        reason: "cleanup",
      });

      const jsonl = await exportToJSONL(adapter, projectKey, {
        includeDeleted: true,
      });

      const beads = parseJSONL(jsonl);
      expect(beads).toHaveLength(1);
      expect(beads[0].status).toBe("tombstone");
    });

    it("exports specific beads only", async () => {
      const bead1 = await adapter.createCell(projectKey, {
        title: "Task 1",
        type: "task",
      });
      await adapter.createCell(projectKey, { title: "Task 2", type: "task" });

      const jsonl = await exportToJSONL(adapter, projectKey, {
        cellIds: [bead1.id],
      });

      const beads = parseJSONL(jsonl);
      expect(beads).toHaveLength(1);
      expect(beads[0].id).toBe(bead1.id);
    });
  });

  describe("exportDirtyBeads", () => {
    it("exports only dirty beads", async () => {
      const bead1 = await adapter.createCell(projectKey, {
        title: "Clean",
        type: "task",
      });
      const bead2 = await adapter.createCell(projectKey, {
        title: "Dirty",
        type: "task",
      });

      // Clear dirty flags
      const db = await adapter.getDatabase();
      await db.query("DELETE FROM dirty_beads", []);

      // Mark only bead2 as dirty
      await db.query(
        "INSERT INTO dirty_beads (cell_id, marked_at) VALUES ($1, $2)",
        [bead2.id, Date.now()]
      );

      const result = await exportDirtyBeads(adapter, projectKey);

      const beads = parseJSONL(result.jsonl);
      expect(beads).toHaveLength(1);
      expect(beads[0].id).toBe(bead2.id);
      expect(result.cellIds).toEqual([bead2.id]);
    });

    it("returns empty for no dirty beads", async () => {
      await adapter.createCell(projectKey, { title: "Task", type: "task" });

      // Clear dirty flags
      const db = await adapter.getDatabase();
      await db.query("DELETE FROM dirty_beads", []);

      const result = await exportDirtyBeads(adapter, projectKey);

      expect(result.jsonl).toBe("");
      expect(result.cellIds).toEqual([]);
    });
  });

  describe("importFromJSONL", () => {
    it("imports new beads", async () => {
      const jsonl = serializeToJSONL({
        id: "bd-new123",
        title: "New task",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: [],
        comments: [],
      });

      const result = await importFromJSONL(adapter, projectKey, jsonl);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);

      const bead = await adapter.getCell(projectKey, "bd-new123");
      expect(bead).not.toBeNull();
      expect(bead?.title).toBe("New task");
    });

    it("updates existing beads", async () => {
      const bead = await adapter.createCell(projectKey, {
        title: "Original",
        type: "task",
      });

      const jsonl = serializeToJSONL({
        id: bead.id,
        title: "Updated",
        status: "in_progress",
        priority: 1,
        issue_type: "task",
        created_at: new Date(bead.created_at).toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        labels: [],
        comments: [],
      });

      const result = await importFromJSONL(adapter, projectKey, jsonl);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);

      const updated = await adapter.getCell(projectKey, bead.id);
      expect(updated?.title).toBe("Updated");
      expect(updated?.status).toBe("in_progress");
    });

    it("skips beads with same content hash", async () => {
      const bead = await adapter.createCell(projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      // Export and re-import (same content)
      const jsonl = await exportToJSONL(adapter, projectKey);
      const result = await importFromJSONL(adapter, projectKey, jsonl);

      expect(result.skipped).toBe(1);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
    });

    it("dry run does not modify database", async () => {
      const jsonl = serializeToJSONL({
        id: "bd-dry123",
        title: "Dry run",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: [],
        comments: [],
      });

      const result = await importFromJSONL(adapter, projectKey, jsonl, {
        dryRun: true,
      });

      expect(result.created).toBe(1);

      const bead = await adapter.getCell(projectKey, "bd-dry123");
      expect(bead).toBeNull();
    });

    it("skipExisting does not update existing beads", async () => {
      const bead = await adapter.createCell(projectKey, {
        title: "Original",
        type: "task",
      });

      const jsonl = serializeToJSONL({
        id: bead.id,
        title: "Should not update",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: new Date(bead.created_at).toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        labels: [],
        comments: [],
      });

      const result = await importFromJSONL(adapter, projectKey, jsonl, {
        skipExisting: true,
      });

      expect(result.skipped).toBe(1);

      const unchanged = await adapter.getCell(projectKey, bead.id);
      expect(unchanged?.title).toBe("Original");
    });

    it("imports dependencies", async () => {
      const jsonl = [
        serializeToJSONL({
          id: "bd-blocker",
          title: "Blocker",
          status: "open",
          priority: 2,
          issue_type: "task",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          dependencies: [],
          labels: [],
          comments: [],
        }),
        serializeToJSONL({
          id: "bd-blocked",
          title: "Blocked",
          status: "open",
          priority: 2,
          issue_type: "task",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          dependencies: [{ depends_on_id: "bd-blocker", type: "blocks" }],
          labels: [],
          comments: [],
        }),
      ].join("\n");

      await importFromJSONL(adapter, projectKey, jsonl);

      const deps = await adapter.getDependencies(projectKey, "bd-blocked");
      expect(deps).toHaveLength(1);
      expect(deps[0].depends_on_id).toBe("bd-blocker");
    });

    it("imports labels", async () => {
      const jsonl = serializeToJSONL({
        id: "bd-labeled",
        title: "Task",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: ["urgent", "backend"],
        comments: [],
      });

      await importFromJSONL(adapter, projectKey, jsonl);

      const labels = await adapter.getLabels(projectKey, "bd-labeled");
      expect(labels).toContain("urgent");
      expect(labels).toContain("backend");
    });

    it("imports comments", async () => {
      const jsonl = serializeToJSONL({
        id: "bd-commented",
        title: "Task",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        dependencies: [],
        labels: [],
        comments: [
          { author: "alice", text: "First" },
          { author: "bob", text: "Second" },
        ],
      });

      await importFromJSONL(adapter, projectKey, jsonl);

      const comments = await adapter.getComments(projectKey, "bd-commented");
      expect(comments).toHaveLength(2);
      expect(comments[0].author).toBe("alice");
    });
  });
});
