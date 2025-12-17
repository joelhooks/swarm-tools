/**
 * Beads Projections Tests
 *
 * Tests projection updates from events and query functions.
 *
 * ## Test Strategy (TDD)
 * 1. Migration creates tables
 * 2. Events update projections correctly
 * 3. Queries return expected results
 * 4. Blocked cache works correctly
 * 5. Dirty tracking works
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../streams/migrations.js";
import { beadsMigration } from "./migrations.js";
import type { DatabaseAdapter } from "../types/database.js";
import {
  getCell,
  getBlockedCells,
  getComments,
  getDependencies,
  getDependents,
  getLabels,
  markBeadDirty,
  queryCells,
  updateProjections,
  getDirtyCells,
  clearDirtyBead,
  isBlocked,
  getBlockers,
  getInProgressCells,
  getNextReadyCell,
} from "./projections.js";
import { rebuildBeadBlockedCache } from "./dependencies.js";

/**
 * Wrap PGLite to match DatabaseAdapter interface
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

describe("Beads Migrations", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;

  beforeEach(async () => {
    pglite = new PGlite();
    db = wrapPGlite(pglite);

    // Run base migrations (v1-v5)
    await runMigrations(pglite);

    // Run beads migration (v6)
    await pglite.exec("BEGIN");
    await pglite.exec(beadsMigration.up);
    await pglite.query(
      `INSERT INTO schema_version (version, applied_at, description) VALUES ($1, $2, $3)`,
      [beadsMigration.version, Date.now(), beadsMigration.description],
    );
    await pglite.exec("COMMIT");
  });

  afterEach(async () => {
    await pglite.close();
  });

  test("migration creates beads table", async () => {
    const result = await pglite.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'beads'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  test("migration creates bead_dependencies table", async () => {
    const result = await pglite.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'cell_dependencies'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  test("migration creates bead_labels table", async () => {
    const result = await pglite.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'cell_labels'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  test("migration creates bead_comments table", async () => {
    const result = await pglite.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'cell_comments'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  test("migration creates blocked_beads_cache table", async () => {
    const result = await pglite.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'blocked_beads_cache'`,
    );
    expect(result.rows).toHaveLength(1);
  });

  test("migration creates dirty_beads table", async () => {
    const result = await pglite.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'dirty_beads'`,
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe("Beads Projections", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  const projectKey = "/test/project";

  beforeEach(async () => {
    pglite = new PGlite();
    db = wrapPGlite(pglite);
    await runMigrations(pglite);

    // Run beads migration
    await pglite.exec("BEGIN");
    await pglite.exec(beadsMigration.up);
    await pglite.query(
      `INSERT INTO schema_version (version, applied_at, description) VALUES ($1, $2, $3)`,
      [beadsMigration.version, Date.now(), beadsMigration.description],
    );
    await pglite.exec("COMMIT");
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe("cell_created event", () => {
    test("creates bead record", async () => {
      const event = {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        description: "Test description",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      };

      await updateProjections(db, event);

      const bead = await getCell(db, projectKey, "bd-123");
      expect(bead).not.toBeNull();
      expect(bead?.title).toBe("Test Bead");
      expect(bead?.type).toBe("task");
      expect(bead?.status).toBe("open");
      expect(bead?.priority).toBe(2);
    });

    test("marks bead as dirty", async () => {
      const event = {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      };

      await updateProjections(db, event);

      const dirtyBeads = await getDirtyCells(db, projectKey);
      expect(dirtyBeads).toContain("bd-123");
    });
  });

  describe("cell_updated event", () => {
    test("updates bead fields", async () => {
      // Create bead
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Original Title",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      // Update title
      await updateProjections(db, {
        type: "cell_updated",
        project_key: projectKey,
        cell_id: "bd-123",
        changes: {
          title: { old: "Original Title", new: "Updated Title" },
        },
        timestamp: Date.now(),
      });

      const bead = await getCell(db, projectKey, "bd-123");
      expect(bead?.title).toBe("Updated Title");
    });
  });

  describe("cell_status_changed event", () => {
    test("updates status", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_status_changed",
        project_key: projectKey,
        cell_id: "bd-123",
        from_status: "open",
        to_status: "in_progress",
        timestamp: Date.now(),
      });

      const bead = await getCell(db, projectKey, "bd-123");
      expect(bead?.status).toBe("in_progress");
    });
  });

  describe("cell_closed event", () => {
    test("closes bead", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      const closedAt = Date.now();
      await updateProjections(db, {
        type: "cell_closed",
        project_key: projectKey,
        cell_id: "bd-123",
        reason: "Completed",
        timestamp: closedAt,
      });

      const bead = await getCell(db, projectKey, "bd-123");
      expect(bead?.status).toBe("closed");
      expect(bead?.closed_at).toBe(closedAt);
      expect(bead?.closed_reason).toBe("Completed");
    });
  });

  describe("dependency events", () => {
    test("adds dependency", async () => {
      // Create two beads
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Bead 1",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-124",
        title: "Bead 2",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      // Add dependency
      await updateProjections(db, {
        type: "cell_dependency_added",
        project_key: projectKey,
        cell_id: "bd-124",
        dependency: { target: "bd-123", type: "blocks" },
        timestamp: Date.now(),
      });

      const deps = await getDependencies(db, projectKey, "bd-124");
      expect(deps).toHaveLength(1);
      expect(deps[0]?.depends_on_id).toBe("bd-123");
      expect(deps[0]?.relationship).toBe("blocks");
    });

    test("rebuilds blocked cache", async () => {
      // Create two beads
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Bead 1",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-124",
        title: "Bead 2",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      // Add blocking dependency
      await updateProjections(db, {
        type: "cell_dependency_added",
        project_key: projectKey,
        cell_id: "bd-124",
        dependency: { target: "bd-123", type: "blocks" },
        timestamp: Date.now(),
      });

      // Rebuild cache
      await rebuildBeadBlockedCache(db, projectKey, "bd-124");

      const blocked = await isBlocked(db, projectKey, "bd-124");
      expect(blocked).toBe(true);

      const blockers = await getBlockers(db, projectKey, "bd-124");
      expect(blockers).toContain("bd-123");
    });
  });

  describe("label events", () => {
    test("adds label", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_label_added",
        project_key: projectKey,
        cell_id: "bd-123",
        label: "urgent",
        timestamp: Date.now(),
      });

      const labels = await getLabels(db, projectKey, "bd-123");
      expect(labels).toContain("urgent");
    });

    test("removes label", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_label_added",
        project_key: projectKey,
        cell_id: "bd-123",
        label: "urgent",
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_label_removed",
        project_key: projectKey,
        cell_id: "bd-123",
        label: "urgent",
        timestamp: Date.now(),
      });

      const labels = await getLabels(db, projectKey, "bd-123");
      expect(labels).not.toContain("urgent");
    });
  });

  describe("comment events", () => {
    test("adds comment", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_comment_added",
        project_key: projectKey,
        cell_id: "bd-123",
        author: "TestAgent",
        body: "Test comment",
        timestamp: Date.now(),
      });

      const comments = await getComments(db, projectKey, "bd-123");
      expect(comments).toHaveLength(1);
      expect(comments[0]?.body).toBe("Test comment");
      expect(comments[0]?.author).toBe("TestAgent");
    });
  });

  describe("query functions", () => {
    test("queryCells filters by status", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Open Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-124",
        title: "In Progress Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_status_changed",
        project_key: projectKey,
        cell_id: "bd-124",
        from_status: "open",
        to_status: "in_progress",
        timestamp: Date.now(),
      });

      const openBeads = await queryCells(db, projectKey, { status: "open" });
      expect(openBeads).toHaveLength(1);
      expect(openBeads[0]?.id).toBe("bd-123");

      const inProgressBeads = await getInProgressCells(db, projectKey);
      expect(inProgressBeads).toHaveLength(1);
      expect(inProgressBeads[0]?.id).toBe("bd-124");
    });

    test("getNextReadyCell returns unblocked high priority bead", async () => {
      // Create high priority bead
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "High Priority",
        issue_type: "task",
        priority: 3,
        timestamp: Date.now(),
      });

      // Create low priority bead
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-124",
        title: "Low Priority",
        issue_type: "task",
        priority: 1,
        timestamp: Date.now() + 1,
      });

      const ready = await getNextReadyCell(db, projectKey);
      expect(ready?.id).toBe("bd-123"); // Higher priority
    });

    test("getBlockedCells returns beads with blockers", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Blocker",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-124",
        title: "Blocked",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await updateProjections(db, {
        type: "cell_dependency_added",
        project_key: projectKey,
        cell_id: "bd-124",
        dependency: { target: "bd-123", type: "blocks" },
        timestamp: Date.now(),
      });

      await rebuildBeadBlockedCache(db, projectKey, "bd-124");

      const blocked = await getBlockedCells(db, projectKey);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.cell.id).toBe("bd-124");
      expect(blocked[0]?.blockers).toContain("bd-123");
    });
  });

  describe("dirty tracking", () => {
    test("marks bead as dirty", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await markBeadDirty(db, projectKey, "bd-123");

      const dirty = await getDirtyCells(db, projectKey);
      expect(dirty).toContain("bd-123");
    });

    test("clears dirty flag", async () => {
      await updateProjections(db, {
        type: "cell_created",
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test Bead",
        issue_type: "task",
        priority: 2,
        timestamp: Date.now(),
      });

      await markBeadDirty(db, projectKey, "bd-123");
      await clearDirtyBead(db, projectKey, "bd-123");

      const dirty = await getDirtyCells(db, projectKey);
      expect(dirty).not.toContain("bd-123");
    });
  });
});
