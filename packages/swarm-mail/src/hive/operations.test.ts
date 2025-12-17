/**
 * Operations Tests - High-level CRUD operations using HiveAdapter
 *
 * Tests the operations layer that provides convenience functions
 * wrapping the HiveAdapter interface.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import type { DatabaseAdapter } from "../types/database.js";
import { createHiveAdapter } from "./adapter.js";
import {
  createCell,
  getCell,
  updateCell,
  closeCell,
  reopenCell,
  deleteCell,
  searchBeads,
} from "./operations.js";
import type { HiveAdapter } from "../types/hive-adapter.js";

/**
 * Wrap PGlite to match DatabaseAdapter interface
 */
function wrapPGlite(pglite: PGlite): DatabaseAdapter {
  return {
    query: <T>(sql: string, params?: unknown[]) => pglite.query<T>(sql, params),
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

describe("operations", () => {
  let adapter: HiveAdapter;
  const projectKey = "/test/project";

  beforeEach(async () => {
    // In-memory database for testing
    const pglite = new PGlite();
    
    // Initialize core tables (events and schema_version)
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        sequence SERIAL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_events_project_key ON events(project_key);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at BIGINT NOT NULL,
        description TEXT
      );
    `);
    
    const db = wrapPGlite(pglite);
    adapter = createHiveAdapter(db, projectKey);
    await adapter.runMigrations();
  });

  describe("createCell", () => {
    it("creates a bead with all fields", async () => {
      const bead = await createCell(adapter, projectKey, {
        title: "Fix the bug",
        type: "bug",
        priority: 0,
        description: "Details here",
        assignee: "user@example.com",
        created_by: "creator@example.com",
      });

      expect(bead).toBeDefined();
      expect(bead.title).toBe("Fix the bug");
      expect(bead.type).toBe("bug");
      expect(bead.priority).toBe(0);
      expect(bead.description).toBe("Details here");
      expect(bead.assignee).toBe("user@example.com");
      expect(bead.status).toBe("open");
    });

    it("creates a bead with minimal fields", async () => {
      const bead = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      expect(bead.title).toBe("Task");
      expect(bead.type).toBe("task");
      expect(bead.priority).toBe(2);
      expect(bead.description).toBeNull();
      expect(bead.assignee).toBeNull();
    });

    it("throws on empty title", async () => {
      await expect(
        createCell(adapter, projectKey, {
          title: "",
          type: "task",
          priority: 2,
        }),
      ).rejects.toThrow("title is required");
    });

    it("throws on title over 500 chars", async () => {
      await expect(
        createCell(adapter, projectKey, {
          title: "x".repeat(501),
          type: "task",
          priority: 2,
        }),
      ).rejects.toThrow("title must be 500 characters or less");
    });

    it("throws on invalid priority", async () => {
      await expect(
        createCell(adapter, projectKey, {
          title: "Task",
          type: "task",
          priority: 5,
        }),
      ).rejects.toThrow("priority must be between 0 and 4");
    });

    it("throws on invalid type", async () => {
      await expect(
        createCell(adapter, projectKey, {
          title: "Task",
          type: "invalid" as any,
          priority: 2,
        }),
      ).rejects.toThrow("invalid issue type");
    });
  });

  describe("getCell", () => {
    it("returns null for non-existent bead", async () => {
      const bead = await getCell(adapter, projectKey, "non-existent");
      expect(bead).toBeNull();
    });

    it("returns bead by ID", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      const fetched = await getCell(adapter, projectKey, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.title).toBe("Task");
    });
  });

  describe("updateCell", () => {
    it("updates title", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Old title",
        type: "task",
        priority: 2,
      });

      const updated = await updateCell(adapter, projectKey, created.id, {
        title: "New title",
      });

      expect(updated.title).toBe("New title");
      expect(updated.priority).toBe(2); // unchanged
    });

    it("updates priority", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      const updated = await updateCell(adapter, projectKey, created.id, {
        priority: 0,
      });

      expect(updated.priority).toBe(0);
      expect(updated.title).toBe("Task"); // unchanged
    });

    it("updates description", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      const updated = await updateCell(adapter, projectKey, created.id, {
        description: "New description",
      });

      expect(updated.description).toBe("New description");
    });

    it("updates assignee", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      const updated = await updateCell(adapter, projectKey, created.id, {
        assignee: "user@example.com",
      });

      expect(updated.assignee).toBe("user@example.com");
    });

    it("throws on empty title", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      await expect(
        updateCell(adapter, projectKey, created.id, {
          title: "",
        }),
      ).rejects.toThrow("title is required");
    });

    it("throws on invalid priority", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      await expect(
        updateCell(adapter, projectKey, created.id, {
          priority: 5,
        }),
      ).rejects.toThrow("priority must be between 0 and 4");
    });

    it("throws on non-existent bead", async () => {
      await expect(
        updateCell(adapter, projectKey, "non-existent", {
          title: "New title",
        }),
      ).rejects.toThrow("Bead not found");
    });
  });

  describe("closeCell", () => {
    it("closes an open bead", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      const closed = await closeCell(
        adapter,
        projectKey,
        created.id,
        "Done",
        "user@example.com",
      );

      expect(closed.status).toBe("closed");
      expect(closed.closed_at).not.toBeNull();
      expect(closed.closed_reason).toBe("Done");
    });

    it("closes an in_progress bead", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      // Start work
      await adapter.changeCellStatus(projectKey, created.id, "in_progress");

      const closed = await closeCell(
        adapter,
        projectKey,
        created.id,
        "Completed",
      );

      expect(closed.status).toBe("closed");
    });

    it("throws on non-existent bead", async () => {
      await expect(
        closeCell(adapter, projectKey, "non-existent", "Done"),
      ).rejects.toThrow("Bead not found");
    });
  });

  describe("reopenCell", () => {
    it("reopens a closed bead", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      // Close it
      await closeCell(adapter, projectKey, created.id, "Done");

      // Reopen it
      const reopened = await reopenCell(adapter, projectKey, created.id);

      expect(reopened.status).toBe("open");
      expect(reopened.closed_at).toBeNull();
      expect(reopened.closed_reason).toBeNull();
    });

    it("throws on non-existent bead", async () => {
      await expect(
        reopenCell(adapter, projectKey, "non-existent"),
      ).rejects.toThrow("Bead not found");
    });
  });

  describe("deleteCell", () => {
    it("deletes a bead (creates tombstone)", async () => {
      const created = await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      await deleteCell(
        adapter,
        projectKey,
        created.id,
        "No longer needed",
        "user@example.com",
      );

      // Bead should be tombstone
      const fetched = await getCell(adapter, projectKey, created.id);
      expect(fetched).toBeNull(); // tombstones excluded by default
    });

    it("throws on non-existent bead", async () => {
      await expect(
        deleteCell(adapter, projectKey, "non-existent", "Gone"),
      ).rejects.toThrow("Bead not found");
    });
  });

  describe("searchBeads", () => {
    it("searches by title", async () => {
      await createCell(adapter, projectKey, {
        title: "Fix authentication bug",
        type: "bug",
        priority: 0,
      });

      await createCell(adapter, projectKey, {
        title: "Add user profile",
        type: "feature",
        priority: 2,
      });

      const results = await searchBeads(adapter, projectKey, "authentication");

      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Fix authentication bug");
    });

    it("returns empty array for no matches", async () => {
      await createCell(adapter, projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      const results = await searchBeads(adapter, projectKey, "nonexistent");
      expect(results).toEqual([]);
    });

    it("filters by status", async () => {
      const bead1 = await createCell(adapter, projectKey, {
        title: "Open task",
        type: "task",
        priority: 2,
      });

      const bead2 = await createCell(adapter, projectKey, {
        title: "Closed task",
        type: "task",
        priority: 2,
      });

      await closeCell(adapter, projectKey, bead2.id, "Done");

      const results = await searchBeads(adapter, projectKey, "task", {
        status: "open",
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe(bead1.id);
    });

    it("filters by type", async () => {
      await createCell(adapter, projectKey, {
        title: "Bug",
        type: "bug",
        priority: 0,
      });

      await createCell(adapter, projectKey, {
        title: "Feature",
        type: "feature",
        priority: 2,
      });

      const results = await searchBeads(adapter, projectKey, "", {
        type: "bug",
      });

      expect(results.length).toBe(1);
      expect(results[0].type).toBe("bug");
    });
  });
});
