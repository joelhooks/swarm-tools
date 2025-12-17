/**
 * Dependencies Tests - Dependency graph operations
 *
 * Tests dependency management including:
 * - Adding/removing dependencies
 * - Cycle detection
 * - Dependency tree traversal (forward and reverse)
 * - Blocked bead detection
 *
 * Reference: steveyegge/beads/internal/storage/sqlite/dependencies_test.go
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { createHiveAdapter } from "./adapter.js";
import type { HiveAdapter } from "../types/hive-adapter.js";
import type { DatabaseAdapter } from "../types/database.js";

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

describe("Dependencies", () => {
  let db: ReturnType<typeof wrapPGlite>;
  let beads: HiveAdapter;
  const projectKey = "/test/project";

  beforeEach(async () => {
    const pglite = new PGlite();
    db = wrapPGlite(pglite);
    
    // Create minimal events table (required by beads event store)
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        sequence SERIAL,
        timestamp BIGINT NOT NULL,
        data JSONB NOT NULL
      );
    `);
    
    // Create beads adapter and run migrations
    beads = createHiveAdapter(db, projectKey);
    await beads.runMigrations();
  });

  describe("addDependency", () => {
    test("adds a blocks dependency", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });

      const dep = await beads.addDependency(projectKey, bead1.id, bead2.id, "blocks");

      expect(dep.cell_id).toBe(bead1.id);
      expect(dep.depends_on_id).toBe(bead2.id);
      expect(dep.relationship).toBe("blocks");
    });

    test("prevents self-dependency", async () => {
      const bead = await beads.createCell(projectKey, { title: "Task", type: "task", priority: 2 });

      await expect(
        beads.addDependency(projectKey, bead.id, bead.id, "blocks")
      ).rejects.toThrow(/cannot depend on itself/i);
    });

    test("prevents direct cycle", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });

      // Add A -> B
      await beads.addDependency(projectKey, bead1.id, bead2.id, "blocks");

      // Try to add B -> A (cycle)
      await expect(
        beads.addDependency(projectKey, bead2.id, bead1.id, "blocks")
      ).rejects.toThrow(/cycle/i);
    });

    test("prevents transitive cycle", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });
      const bead3 = await beads.createCell(projectKey, { title: "Task 3", type: "task", priority: 2 });

      // Add A -> B -> C
      await beads.addDependency(projectKey, bead1.id, bead2.id, "blocks");
      await beads.addDependency(projectKey, bead2.id, bead3.id, "blocks");

      // Try to add C -> A (cycle)
      await expect(
        beads.addDependency(projectKey, bead3.id, bead1.id, "blocks")
      ).rejects.toThrow(/cycle/i);
    });

    test("allows related dependencies (non-blocking)", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });

      const dep = await beads.addDependency(projectKey, bead1.id, bead2.id, "related");

      expect(dep.relationship).toBe("related");
    });

    test("allows multiple dependency types between same beads", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });

      await beads.addDependency(projectKey, bead1.id, bead2.id, "blocks");
      await beads.addDependency(projectKey, bead1.id, bead2.id, "related");

      const deps = await beads.getDependencies(projectKey, bead1.id);
      expect(deps).toHaveLength(2);
    });
  });

  describe("removeDependency", () => {
    test("removes a dependency", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });

      await beads.addDependency(projectKey, bead1.id, bead2.id, "blocks");
      await beads.removeDependency(projectKey, bead1.id, bead2.id, "blocks");

      const deps = await beads.getDependencies(projectKey, bead1.id);
      expect(deps).toHaveLength(0);
    });

    test("removes specific relationship type only", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });

      await beads.addDependency(projectKey, bead1.id, bead2.id, "blocks");
      await beads.addDependency(projectKey, bead1.id, bead2.id, "related");

      await beads.removeDependency(projectKey, bead1.id, bead2.id, "blocks");

      const deps = await beads.getDependencies(projectKey, bead1.id);
      expect(deps).toHaveLength(1);
      expect(deps[0].relationship).toBe("related");
    });
  });

  describe("getDependencies", () => {
    test("returns dependencies for a bead", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });
      const bead3 = await beads.createCell(projectKey, { title: "Task 3", type: "task", priority: 2 });

      await beads.addDependency(projectKey, bead1.id, bead2.id, "blocks");
      await beads.addDependency(projectKey, bead1.id, bead3.id, "related");

      const deps = await beads.getDependencies(projectKey, bead1.id);
      expect(deps).toHaveLength(2);
      expect(deps.map(d => d.depends_on_id).sort()).toEqual([bead2.id, bead3.id].sort());
    });

    test("returns empty array when no dependencies", async () => {
      const bead = await beads.createCell(projectKey, { title: "Task", type: "task", priority: 2 });

      const deps = await beads.getDependencies(projectKey, bead.id);
      expect(deps).toHaveLength(0);
    });
  });

  describe("getDependents", () => {
    test("returns beads that depend on this bead", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });
      const bead3 = await beads.createCell(projectKey, { title: "Task 3", type: "task", priority: 2 });

      // bead2 and bead3 both depend on bead1
      await beads.addDependency(projectKey, bead2.id, bead1.id, "blocks");
      await beads.addDependency(projectKey, bead3.id, bead1.id, "blocks");

      const dependents = await beads.getDependents(projectKey, bead1.id);
      expect(dependents).toHaveLength(2);
      expect(dependents.map(d => d.cell_id).sort()).toEqual([bead2.id, bead3.id].sort());
    });
  });

  describe("isBlocked", () => {
    test("returns false when no blocking dependencies", async () => {
      const bead = await beads.createCell(projectKey, { title: "Task", type: "task", priority: 2 });

      const blocked = await beads.isBlocked(projectKey, bead.id);
      expect(blocked).toBe(false);
    });

    test("returns true when bead has open blocking dependency", async () => {
      const blocker = await beads.createCell(projectKey, { title: "Blocker", type: "task", priority: 2 });
      const blocked = await beads.createCell(projectKey, { title: "Blocked", type: "task", priority: 2 });

      await beads.addDependency(projectKey, blocked.id, blocker.id, "blocks");

      const isBlocked = await beads.isBlocked(projectKey, blocked.id);
      expect(isBlocked).toBe(true);
    });

    test("returns false when blocking dependency is closed", async () => {
      const blocker = await beads.createCell(projectKey, { title: "Blocker", type: "task", priority: 2 });
      const blocked = await beads.createCell(projectKey, { title: "Blocked", type: "task", priority: 2 });

      await beads.addDependency(projectKey, blocked.id, blocker.id, "blocks");
      await beads.closeCell(projectKey, blocker.id, "Done");

      // Need to rebuild blocked cache after status change
      await beads.rebuildBlockedCache(projectKey);

      const isBlocked = await beads.isBlocked(projectKey, blocked.id);
      expect(isBlocked).toBe(false);
    });

    test("returns false for non-blocking dependency types", async () => {
      const bead1 = await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const bead2 = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });

      await beads.addDependency(projectKey, bead2.id, bead1.id, "related");

      const isBlocked = await beads.isBlocked(projectKey, bead2.id);
      expect(isBlocked).toBe(false);
    });
  });

  describe("getBlockers", () => {
    test("returns blocker IDs for a bead", async () => {
      const blocker1 = await beads.createCell(projectKey, { title: "Blocker 1", type: "task", priority: 2 });
      const blocker2 = await beads.createCell(projectKey, { title: "Blocker 2", type: "task", priority: 2 });
      const blocked = await beads.createCell(projectKey, { title: "Blocked", type: "task", priority: 2 });

      await beads.addDependency(projectKey, blocked.id, blocker1.id, "blocks");
      await beads.addDependency(projectKey, blocked.id, blocker2.id, "blocks");

      const blockers = await beads.getBlockers(projectKey, blocked.id);
      expect(blockers.sort()).toEqual([blocker1.id, blocker2.id].sort());
    });

    test("includes transitive blockers", async () => {
      const blocker1 = await beads.createCell(projectKey, { title: "Blocker 1", type: "task", priority: 2 });
      const blocker2 = await beads.createCell(projectKey, { title: "Blocker 2", type: "task", priority: 2 });
      const blocked = await beads.createCell(projectKey, { title: "Blocked", type: "task", priority: 2 });

      // blocker2 blocks blocker1, blocker1 blocks blocked
      await beads.addDependency(projectKey, blocker1.id, blocker2.id, "blocks");
      await beads.addDependency(projectKey, blocked.id, blocker1.id, "blocks");

      const blockers = await beads.getBlockers(projectKey, blocked.id);
      // Should include both direct (blocker1) and transitive (blocker2)
      expect(blockers.sort()).toEqual([blocker1.id, blocker2.id].sort());
    });
  });

  describe("rebuildBlockedCache", () => {
    test("rebuilds blocked cache for all beads", async () => {
      const blocker = await beads.createCell(projectKey, { title: "Blocker", type: "task", priority: 2 });
      const blocked1 = await beads.createCell(projectKey, { title: "Blocked 1", type: "task", priority: 2 });
      const blocked2 = await beads.createCell(projectKey, { title: "Blocked 2", type: "task", priority: 2 });

      await beads.addDependency(projectKey, blocked1.id, blocker.id, "blocks");
      await beads.addDependency(projectKey, blocked2.id, blocker.id, "blocks");

      // Close blocker
      await beads.closeCell(projectKey, blocker.id, "Done");

      // Rebuild cache
      await beads.rebuildBlockedCache(projectKey);

      // Both should now be unblocked
      expect(await beads.isBlocked(projectKey, blocked1.id)).toBe(false);
      expect(await beads.isBlocked(projectKey, blocked2.id)).toBe(false);
    });
  });
});
