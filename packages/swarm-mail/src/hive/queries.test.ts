/**
 * Tests for beads query functions
 *
 * @module beads/queries.test
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { wrapPGlite } from "../pglite.js";
import { createHiveAdapter } from "./adapter.js";
import type { DatabaseAdapter } from "../types/database.js";
import type { HiveAdapter } from "../types/hive-adapter.js";
import {
  getReadyWork,
  getBlockedIssues,
  getEpicsEligibleForClosure,
  getStaleIssues,
  getStatistics,
} from "./queries.js";

describe("beads/queries", () => {
  let db: DatabaseAdapter;
  let beads: HiveAdapter;
  let pglite: PGlite;
  const projectKey = "/test/project";

  beforeEach(async () => {
    // Create in-memory PGlite instance
    pglite = new PGlite();
   db = wrapPGlite(pglite);

    // Initialize core schema (creates events table)
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
    `);

    // Run swarm-mail migrations
    const { runMigrations } = await import("../streams/migrations.js");
    await runMigrations(pglite);

    // Create beads adapter and run beads migrations
    beads = createHiveAdapter(db, projectKey);
    await beads.runMigrations();
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe("getReadyWork", () => {
    test("returns empty array when no beads exist", async () => {
      const ready = await getReadyWork(beads, projectKey);
      expect(ready).toEqual([]);
    });

    test("returns unblocked open bead", async () => {
      const bead = await beads.createCell(projectKey, {
        title: "Ready task",
        type: "task",
        priority: 2,
      });

      const ready = await getReadyWork(beads, projectKey);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(bead.id);
    });

    test("excludes blocked beads", async () => {
      const blocker = await beads.createCell(projectKey, {
        title: "Blocker",
        type: "task",
        priority: 2,
      });

      const blocked = await beads.createCell(projectKey, {
        title: "Blocked task",
        type: "task",
        priority: 2,
      });

      await beads.addDependency(projectKey, blocked.id, blocker.id, "blocks");

      const ready = await getReadyWork(beads, projectKey);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(blocker.id);
    });

    test("includes in_progress beads by default", async () => {
      const openBead = await beads.createCell(projectKey, {
        title: "Open task",
        type: "task",
        priority: 2,
      });

      const inProgress = await beads.createCell(projectKey, {
        title: "In progress task",
        type: "task",
        priority: 2,
      });
      await beads.changeCellStatus(projectKey, inProgress.id, "in_progress");

      const ready = await getReadyWork(beads, projectKey);
      expect(ready).toHaveLength(2);
      expect(ready.map(b => b.id).sort()).toEqual([openBead.id, inProgress.id].sort());
    });

    test("excludes closed beads", async () => {
      const open = await beads.createCell(projectKey, {
        title: "Open task",
        type: "task",
        priority: 2,
      });

      const closed = await beads.createCell(projectKey, {
        title: "Closed task",
        type: "task",
        priority: 2,
      });
      await beads.closeCell(projectKey, closed.id, "Done");

      const ready = await getReadyWork(beads, projectKey);
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(open.id);
    });

    test("filters by assignee", async () => {
      await beads.createCell(projectKey, {
        title: "Task 1",
        type: "task",
        priority: 2,
        assignee: "alice",
      });

      const bead2 = await beads.createCell(projectKey, {
        title: "Task 2",
        type: "task",
        priority: 2,
        assignee: "bob",
      });

      const ready = await getReadyWork(beads, projectKey, {
        assignee: "bob",
      });

      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(bead2.id);
    });

    test("filters unassigned beads", async () => {
      const unassigned = await beads.createCell(projectKey, {
        title: "Unassigned task",
        type: "task",
        priority: 2,
      });

      await beads.createCell(projectKey, {
        title: "Assigned task",
        type: "task",
        priority: 2,
        assignee: "alice",
      });

      const ready = await getReadyWork(beads, projectKey, {
        unassigned: true,
      });

      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe(unassigned.id);
    });

    test("limits results", async () => {
      await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });
      await beads.createCell(projectKey, { title: "Task 3", type: "task", priority: 2 });

      const ready = await getReadyWork(beads, projectKey, { limit: 2 });
      expect(ready).toHaveLength(2);
    });

    test("sort policy: priority - highest priority first", async () => {
      const low = await beads.createCell(projectKey, {
        title: "Low priority",
        type: "task",
        priority: 2,
      });

      const high = await beads.createCell(projectKey, {
        title: "High priority",
        type: "task",
        priority: 0,
      });

      const medium = await beads.createCell(projectKey, {
        title: "Medium priority",
        type: "task",
        priority: 1,
      });

      const ready = await getReadyWork(beads, projectKey, {
        sortPolicy: "priority",
      });

      expect(ready.map(b => b.id)).toEqual([high.id, medium.id, low.id]);
    });

    test("sort policy: oldest - creation date ascending", async () => {
      // Sleep to ensure different timestamps
      const first = await beads.createCell(projectKey, {
        title: "First",
        type: "task",
        priority: 2,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const second = await beads.createCell(projectKey, {
        title: "Second",
        type: "task",
        priority: 2,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const third = await beads.createCell(projectKey, {
        title: "Third",
        type: "task",
        priority: 2,
      });

      const ready = await getReadyWork(beads, projectKey, {
        sortPolicy: "oldest",
      });

      expect(ready.map(b => b.id)).toEqual([first.id, second.id, third.id]);
    });

    test("sort policy: hybrid - recent by priority, old by age", async () => {
      // Create old bead (low priority)
      const old = await beads.createCell(projectKey, {
        title: "Old task",
        type: "task",
        priority: 2,
      });

      // Make it appear old (update created_at directly)
      await db.query(
        `UPDATE beads SET created_at = $1 WHERE id = $2`,
        [Date.now() - 3 * 24 * 60 * 60 * 1000, old.id] // 3 days ago
      );

      // Create recent beads with different priorities
      const recentLow = await beads.createCell(projectKey, {
        title: "Recent low",
        type: "task",
        priority: 2,
      });

      const recentHigh = await beads.createCell(projectKey, {
        title: "Recent high",
        type: "task",
        priority: 0,
      });

      const ready = await getReadyWork(beads, projectKey, {
        sortPolicy: "hybrid",
      });

      // Hybrid: recent issues (high priority first), then old issues by age
      expect(ready.map(b => b.id)).toEqual([recentHigh.id, recentLow.id, old.id]);
    });
  });

  describe("getBlockedIssues", () => {
    test("returns empty array when no blocked beads", async () => {
      await beads.createCell(projectKey, {
        title: "Unblocked",
        type: "task",
        priority: 2,
      });

      const blocked = await getBlockedIssues(beads, projectKey);
      expect(blocked).toEqual([]);
    });

    test("returns blocked bead with blockers", async () => {
      const blocker = await beads.createCell(projectKey, {
        title: "Blocker",
        type: "task",
        priority: 2,
      });

      const blocked = await beads.createCell(projectKey, {
        title: "Blocked task",
        type: "task",
        priority: 2,
      });

      await beads.addDependency(projectKey, blocked.id, blocker.id, "blocks");

      const result = await getBlockedIssues(beads, projectKey);
      expect(result).toHaveLength(1);
      expect(result[0].cell.id).toBe(blocked.id);
      expect(result[0].blockers).toEqual([blocker.id]);
    });

    test("includes multiple blockers", async () => {
      const blocker1 = await beads.createCell(projectKey, {
        title: "Blocker 1",
        type: "task",
        priority: 2,
      });

      const blocker2 = await beads.createCell(projectKey, {
        title: "Blocker 2",
        type: "task",
        priority: 2,
      });

      const blocked = await beads.createCell(projectKey, {
        title: "Blocked task",
        type: "task",
        priority: 2,
      });

      await beads.addDependency(projectKey, blocked.id, blocker1.id, "blocks");
      await beads.addDependency(projectKey, blocked.id, blocker2.id, "blocks");

      const result = await getBlockedIssues(beads, projectKey);
      expect(result).toHaveLength(1);
      expect(result[0].blockers.sort()).toEqual([blocker1.id, blocker2.id].sort());
    });

    test("excludes beads where blockers are closed", async () => {
      const blocker = await beads.createCell(projectKey, {
        title: "Blocker",
        type: "task",
        priority: 2,
      });

      const blocked = await beads.createCell(projectKey, {
        title: "Blocked task",
        type: "task",
        priority: 2,
      });

      await beads.addDependency(projectKey, blocked.id, blocker.id, "blocks");
      await beads.closeCell(projectKey, blocker.id, "Done");

      const result = await getBlockedIssues(beads, projectKey);
      expect(result).toEqual([]);
    });
  });

  describe("getEpicsEligibleForClosure", () => {
    test("returns empty array when no epics", async () => {
      await beads.createCell(projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      const eligible = await getEpicsEligibleForClosure(beads, projectKey);
      expect(eligible).toEqual([]);
    });

    test("returns epic when all children closed", async () => {
      const epic = await beads.createCell(projectKey, {
        title: "Epic",
        type: "epic",
        priority: 2,
      });

      const child1 = await beads.createCell(projectKey, {
        title: "Child 1",
        type: "task",
        priority: 2,
      });

      const child2 = await beads.createCell(projectKey, {
        title: "Child 2",
        type: "task",
        priority: 2,
      });

      await beads.addChildToEpic(projectKey, epic.id, child1.id);
      await beads.addChildToEpic(projectKey, epic.id, child2.id);

      await beads.closeCell(projectKey, child1.id, "Done");
      await beads.closeCell(projectKey, child2.id, "Done");

      const eligible = await getEpicsEligibleForClosure(beads, projectKey);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].epic_id).toBe(epic.id);
      expect(eligible[0].total_children).toBe(2);
      expect(eligible[0].closed_children).toBe(2);
    });

    test("excludes epic when children still open", async () => {
      const epic = await beads.createCell(projectKey, {
        title: "Epic",
        type: "epic",
        priority: 2,
      });

      const child1 = await beads.createCell(projectKey, {
        title: "Child 1",
        type: "task",
        priority: 2,
      });

      const child2 = await beads.createCell(projectKey, {
        title: "Child 2",
        type: "task",
        priority: 2,
      });

      await beads.addChildToEpic(projectKey, epic.id, child1.id);
      await beads.addChildToEpic(projectKey, epic.id, child2.id);

      await beads.closeCell(projectKey, child1.id, "Done");
      // child2 still open

      const eligible = await getEpicsEligibleForClosure(beads, projectKey);
      expect(eligible).toEqual([]);
    });

    test("excludes already closed epics", async () => {
      const epic = await beads.createCell(projectKey, {
        title: "Epic",
        type: "epic",
        priority: 2,
      });

      await beads.closeCell(projectKey, epic.id, "Done");

      const eligible = await getEpicsEligibleForClosure(beads, projectKey);
      expect(eligible).toEqual([]);
    });
  });

  describe("getStaleIssues", () => {
    test("returns empty array when no stale issues", async () => {
      await beads.createCell(projectKey, {
        title: "Recent",
        type: "task",
        priority: 2,
      });

      const stale = await getStaleIssues(beads, projectKey, 7);
      expect(stale).toEqual([]);
    });

    test("returns issues not updated in N days", async () => {
      const recent = await beads.createCell(projectKey, {
        title: "Recent",
        type: "task",
        priority: 2,
      });

      const old = await beads.createCell(projectKey, {
        title: "Old",
        type: "task",
        priority: 2,
      });

      // Make old bead appear stale (update updated_at directly)
      await db.query(
        `UPDATE beads SET updated_at = $1 WHERE id = $2`,
        [Date.now() - 10 * 24 * 60 * 60 * 1000, old.id] // 10 days ago
      );

      const stale = await getStaleIssues(beads, projectKey, 7);
      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe(old.id);
    });

    test("excludes closed issues", async () => {
      const closedOld = await beads.createCell(projectKey, {
        title: "Closed old",
        type: "task",
        priority: 2,
      });

      await db.query(
        `UPDATE beads SET updated_at = $1 WHERE id = $2`,
        [Date.now() - 10 * 24 * 60 * 60 * 1000, closedOld.id]
      );

      await beads.closeCell(projectKey, closedOld.id, "Done");

      const stale = await getStaleIssues(beads, projectKey, 7);
      expect(stale).toEqual([]);
    });

    test("filters by status", async () => {
      const openOld = await beads.createCell(projectKey, {
        title: "Open old",
        type: "task",
        priority: 2,
      });

      const inProgressOld = await beads.createCell(projectKey, {
        title: "In progress old",
        type: "task",
        priority: 2,
      });

      await beads.changeCellStatus(projectKey, inProgressOld.id, "in_progress");

      // Make both old
      await db.query(
        `UPDATE beads SET updated_at = $1 WHERE id = ANY($2)`,
        [Date.now() - 10 * 24 * 60 * 60 * 1000, [openOld.id, inProgressOld.id]]
      );

      const stale = await getStaleIssues(beads, projectKey, 7, {
        status: "in_progress",
      });

      expect(stale).toHaveLength(1);
      expect(stale[0].id).toBe(inProgressOld.id);
    });

    test("limits results", async () => {
      const old1 = await beads.createCell(projectKey, { title: "Old 1", type: "task", priority: 2 });
      const old2 = await beads.createCell(projectKey, { title: "Old 2", type: "task", priority: 2 });
      const old3 = await beads.createCell(projectKey, { title: "Old 3", type: "task", priority: 2 });

      await db.query(
        `UPDATE beads SET updated_at = $1 WHERE id = ANY($2)`,
        [Date.now() - 10 * 24 * 60 * 60 * 1000, [old1.id, old2.id, old3.id]]
      );

      const stale = await getStaleIssues(beads, projectKey, 7, { limit: 2 });
      expect(stale).toHaveLength(2);
    });

    test("orders by oldest first", async () => {
      const old1 = await beads.createCell(projectKey, { title: "Old 1", type: "task", priority: 2 });
      const old2 = await beads.createCell(projectKey, { title: "Old 2", type: "task", priority: 2 });

      // old1 is older
      await db.query(`UPDATE beads SET updated_at = $1 WHERE id = $2`, [
        Date.now() - 20 * 24 * 60 * 60 * 1000,
        old1.id,
      ]);

      // old2 is less old
      await db.query(`UPDATE beads SET updated_at = $1 WHERE id = $2`, [
        Date.now() - 10 * 24 * 60 * 60 * 1000,
        old2.id,
      ]);

      const stale = await getStaleIssues(beads, projectKey, 7);
      expect(stale.map(b => b.id)).toEqual([old1.id, old2.id]);
    });
  });

  describe("getStatistics", () => {
    test("returns zeros for empty database", async () => {
      const stats = await getStatistics(beads, projectKey);
      
      expect(stats.total_cells).toBe(0);
      expect(stats.open).toBe(0);
      expect(stats.in_progress).toBe(0);
      expect(stats.closed).toBe(0);
      expect(stats.blocked).toBe(0);
      expect(stats.ready).toBe(0);
      expect(stats.by_type).toEqual({});
    });

    test("counts beads by status", async () => {
      await beads.createCell(projectKey, { title: "Open 1", type: "task", priority: 2 });
      await beads.createCell(projectKey, { title: "Open 2", type: "task", priority: 2 });

      const inProgress = await beads.createCell(projectKey, { title: "In Progress", type: "task", priority: 2 });
      await beads.changeCellStatus(projectKey, inProgress.id, "in_progress");

      const closed = await beads.createCell(projectKey, { title: "Closed", type: "task", priority: 2 });
      await beads.closeCell(projectKey, closed.id, "Done");

      const stats = await getStatistics(beads, projectKey);
      
      expect(stats.total_cells).toBe(4);
      expect(stats.open).toBe(2);
      expect(stats.in_progress).toBe(1);
      expect(stats.closed).toBe(1);
    });

    test("counts blocked beads", async () => {
      const blocker = await beads.createCell(projectKey, { title: "Blocker", type: "task", priority: 2 });
      const blocked = await beads.createCell(projectKey, { title: "Blocked", type: "task", priority: 2 });

      await beads.addDependency(projectKey, blocked.id, blocker.id, "blocks");

      const stats = await getStatistics(beads, projectKey);
      expect(stats.blocked).toBe(1);
    });

    test("counts ready beads", async () => {
      const blocker = await beads.createCell(projectKey, { title: "Blocker", type: "task", priority: 2 });
      const blocked = await beads.createCell(projectKey, { title: "Blocked", type: "task", priority: 2 });
      await beads.createCell(projectKey, { title: "Ready", type: "task", priority: 2 });

      await beads.addDependency(projectKey, blocked.id, blocker.id, "blocks");

      const stats = await getStatistics(beads, projectKey);
      expect(stats.ready).toBe(2); // blocker + ready (blocked is not ready)
    });

    test("groups by type", async () => {
      await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });
      await beads.createCell(projectKey, { title: "Bug", type: "bug", priority: 0 });
      await beads.createCell(projectKey, { title: "Epic", type: "epic", priority: 2 });

      const stats = await getStatistics(beads, projectKey);
      
      expect(stats.by_type).toEqual({
        task: 2,
        bug: 1,
        epic: 1,
      });
    });

    test("excludes deleted beads", async () => {
      await beads.createCell(projectKey, { title: "Task 1", type: "task", priority: 2 });
      const deleted = await beads.createCell(projectKey, { title: "Task 2", type: "task", priority: 2 });
      
      await beads.deleteCell(projectKey, deleted.id);

      const stats = await getStatistics(beads, projectKey);
      expect(stats.total_cells).toBe(1);
    });
  });
});
