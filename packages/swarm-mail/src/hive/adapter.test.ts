/**
 * Beads Adapter Tests
 *
 * Tests the HiveAdapter factory and its interface implementation.
 *
 * ## Test Strategy
 * 1. Factory creation - createHiveAdapter returns valid adapter
 * 2. Core CRUD operations - create, read, update, close beads
 * 3. Dependency management - add, remove, query dependencies
 * 4. Label operations - add, remove, query labels
 * 5. Comment operations - add, update, delete comments
 * 6. Epic operations - add/remove children, closure eligibility
 * 7. Query helpers - ready beads, in-progress, blocked
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { beadsMigration } from "./migrations.js";
import type { DatabaseAdapter } from "../types/database.js";
import { createHiveAdapter } from "./adapter.js";
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

describe("Beads Adapter", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  let adapter: HiveAdapter;
  const projectKey = "/test/project";

  beforeEach(async () => {
    // Create isolated in-memory instance for tests
    pglite = new PGlite();
    
    // Initialize the core events table
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
    
    db = wrapPGlite(pglite);

    // Run beads migration
    await pglite.exec("BEGIN");
    await pglite.exec(beadsMigration.up);
    await pglite.query(
      `INSERT INTO schema_version (version, applied_at, description) VALUES ($1, $2, $3)`,
      [beadsMigration.version, Date.now(), beadsMigration.description],
    );
    await pglite.exec("COMMIT");

    // Create adapter
    adapter = createHiveAdapter(db, projectKey);
  });

  afterEach(async () => {
    await pglite.close();
  });

  // ============================================================================
  // Factory and Interface Tests
  // ============================================================================

  test("createHiveAdapter - returns valid adapter", () => {
    expect(adapter).toBeDefined();
    expect(adapter.createCell).toBeFunction();
    expect(adapter.getCell).toBeFunction();
    expect(adapter.queryCells).toBeFunction();
    expect(adapter.updateCell).toBeFunction();
    expect(adapter.closeCell).toBeFunction();
  });

  // ============================================================================
  // Core CRUD Operations
  // ============================================================================

  test("createCell - creates a new bead", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Test Bead",
      type: "task",
      priority: 2,
    });

    expect(bead).toBeDefined();
    expect(bead.title).toBe("Test Bead");
    expect(bead.type).toBe("task");
    expect(bead.status).toBe("open");
    expect(bead.priority).toBe(2);
  });

  test("getCell - retrieves existing bead", async () => {
    const created = await adapter.createCell(projectKey, {
      title: "Get Test",
      type: "feature",
      priority: 3,
    });

    const retrieved = await adapter.getCell(projectKey, created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.title).toBe("Get Test");
  });

  test("queryCells - returns all beads", async () => {
    await adapter.createCell(projectKey, {
      title: "Bead 1",
      type: "task",
      priority: 2,
    });
    await adapter.createCell(projectKey, {
      title: "Bead 2",
      type: "bug",
      priority: 1,
    });

    const beads = await adapter.queryCells(projectKey);
    expect(beads.length).toBeGreaterThanOrEqual(2);
  });

  test("updateCell - updates bead fields", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Original",
      type: "task",
      priority: 2,
    });

    const updated = await adapter.updateCell(projectKey, bead.id, {
      title: "Updated",
      description: "New description",
      priority: 1,
    });

    expect(updated.title).toBe("Updated");
    expect(updated.description).toBe("New description");
    expect(updated.priority).toBe(1);
  });

  test("changeCellStatus - changes bead status", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Status Test",
      type: "task",
      priority: 2,
    });

    const updated = await adapter.changeCellStatus(projectKey, bead.id, "in_progress");
    expect(updated.status).toBe("in_progress");
  });

  test("closeCell - closes a bead", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Close Test",
      type: "task",
      priority: 2,
    });

    const closed = await adapter.closeCell(projectKey, bead.id, "Completed");
    expect(closed.status).toBe("closed");
    expect(closed.closed_reason).toBe("Completed");
    expect(closed.closed_at).toBeGreaterThan(0);
  });

  test("reopenCell - reopens a closed bead", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Reopen Test",
      type: "task",
      priority: 2,
    });

    await adapter.closeCell(projectKey, bead.id, "Done");
    const reopened = await adapter.reopenCell(projectKey, bead.id);

    expect(reopened.status).toBe("open");
    expect(reopened.closed_at).toBeNull();
    expect(reopened.closed_reason).toBeNull();
  });

  // ============================================================================
  // Dependency Operations
  // ============================================================================

  test("addDependency - adds a dependency", async () => {
    const bead1 = await adapter.createCell(projectKey, {
      title: "Blocker",
      type: "task",
      priority: 2,
    });
    const bead2 = await adapter.createCell(projectKey, {
      title: "Blocked",
      type: "task",
      priority: 2,
    });

    const dep = await adapter.addDependency(projectKey, bead2.id, bead1.id, "blocks");
    expect(dep.depends_on_id).toBe(bead1.id);
    expect(dep.relationship).toBe("blocks");
  });

  test("getDependencies - returns dependencies", async () => {
    const bead1 = await adapter.createCell(projectKey, {
      title: "Blocker",
      type: "task",
      priority: 2,
    });
    const bead2 = await adapter.createCell(projectKey, {
      title: "Blocked",
      type: "task",
      priority: 2,
    });

    await adapter.addDependency(projectKey, bead2.id, bead1.id, "blocks");
    const deps = await adapter.getDependencies(projectKey, bead2.id);

    expect(deps).toHaveLength(1);
    expect(deps[0]?.depends_on_id).toBe(bead1.id);
  });

  test("removeDependency - removes a dependency", async () => {
    const bead1 = await adapter.createCell(projectKey, {
      title: "Blocker",
      type: "task",
      priority: 2,
    });
    const bead2 = await adapter.createCell(projectKey, {
      title: "Blocked",
      type: "task",
      priority: 2,
    });

    await adapter.addDependency(projectKey, bead2.id, bead1.id, "blocks");
    await adapter.removeDependency(projectKey, bead2.id, bead1.id, "blocks");

    const deps = await adapter.getDependencies(projectKey, bead2.id);
    expect(deps).toHaveLength(0);
  });

  // ============================================================================
  // Label Operations
  // ============================================================================

  test("addLabel - adds a label to bead", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Label Test",
      type: "task",
      priority: 2,
    });

    const label = await adapter.addLabel(projectKey, bead.id, "p0");
    expect(label.label).toBe("p0");
  });

  test("getLabels - returns bead labels", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Label Test",
      type: "task",
      priority: 2,
    });

    await adapter.addLabel(projectKey, bead.id, "p0");
    await adapter.addLabel(projectKey, bead.id, "urgent");

    const labels = await adapter.getLabels(projectKey, bead.id);
    expect(labels).toContain("p0");
    expect(labels).toContain("urgent");
  });

  test("removeLabel - removes a label", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Label Test",
      type: "task",
      priority: 2,
    });

    await adapter.addLabel(projectKey, bead.id, "p0");
    await adapter.removeLabel(projectKey, bead.id, "p0");

    const labels = await adapter.getLabels(projectKey, bead.id);
    expect(labels).not.toContain("p0");
  });

  // ============================================================================
  // Comment Operations
  // ============================================================================

  test("addComment - adds a comment to bead", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Comment Test",
      type: "task",
      priority: 2,
    });

    const comment = await adapter.addComment(projectKey, bead.id, "testuser", "Test comment");
    expect(comment.body).toBe("Test comment");
    expect(comment.author).toBe("testuser");
  });

  test("getComments - returns bead comments", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "Comment Test",
      type: "task",
      priority: 2,
    });

    await adapter.addComment(projectKey, bead.id, "user1", "Comment 1");
    await adapter.addComment(projectKey, bead.id, "user2", "Comment 2");

    const comments = await adapter.getComments(projectKey, bead.id);
    expect(comments).toHaveLength(2);
  });

  // ============================================================================
  // Epic Operations
  // ============================================================================

  test("getEpicChildren - returns epic children", async () => {
    const epic = await adapter.createCell(projectKey, {
      title: "Epic",
      type: "epic",
      priority: 3,
    });
    const child = await adapter.createCell(projectKey, {
      title: "Subtask",
      type: "task",
      priority: 2,
      parent_id: epic.id,
    });

    const children = await adapter.getEpicChildren(projectKey, epic.id);
    expect(children.some((c) => c.id === child.id)).toBe(true);
  });

  test("isEpicClosureEligible - returns true when all children closed", async () => {
    const epic = await adapter.createCell(projectKey, {
      title: "Epic",
      type: "epic",
      priority: 3,
    });
    const child = await adapter.createCell(projectKey, {
      title: "Subtask",
      type: "task",
      priority: 2,
      parent_id: epic.id,
    });

    // Not eligible yet
    let eligible = await adapter.isEpicClosureEligible(projectKey, epic.id);
    expect(eligible).toBe(false);

    // Close child
    await adapter.closeCell(projectKey, child.id, "Done");

    // Now eligible
    eligible = await adapter.isEpicClosureEligible(projectKey, epic.id);
    expect(eligible).toBe(true);
  });

  // ============================================================================
  // Query Helpers
  // ============================================================================

  test("getNextReadyCell - returns unblocked bead", async () => {
    await adapter.createCell(projectKey, {
      title: "Ready Bead",
      type: "task",
      priority: 1,
    });

    const ready = await adapter.getNextReadyCell(projectKey);
    expect(ready).not.toBeNull();
    expect(ready?.status).toBe("open");
  });

  test("getInProgressCells - returns in-progress beads", async () => {
    const bead = await adapter.createCell(projectKey, {
      title: "WIP Bead",
      type: "task",
      priority: 2,
    });

    await adapter.changeCellStatus(projectKey, bead.id, "in_progress");

    const inProgress = await adapter.getInProgressCells(projectKey);
    expect(inProgress.some((b) => b.id === bead.id)).toBe(true);
  });
});
