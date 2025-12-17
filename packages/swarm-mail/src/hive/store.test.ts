/**
 * Beads Event Store Tests
 *
 * Tests event store operations (append, read, replay) for bead events.
 *
 * ## Test Strategy (TDD)
 * 1. appendCellEvent - append events to shared event store
 * 2. readCellEvents - read with filters (type, cell_id, timestamp)
 * 3. replayCellEvents - rebuild projections from events
 * 4. Integration with projections - events update materialized views
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { getDatabase } from "../streams/index.js";
import { beadsMigration } from "./migrations.js";
import type { DatabaseAdapter } from "../types/database.js";
import { appendCellEvent, readCellEvents, replayCellEvents } from "./store.js";
import { getCell, queryCells, getDependencies, getLabels, getComments } from "./projections.js";
import type { CellEvent } from "./events.js";

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

/**
 * Helper to create bead events without importing from plugin package
 */
function createCellEvent<T extends CellEvent["type"]>(
  type: T,
  data: Omit<Extract<CellEvent, { type: T }>, "type" | "timestamp" | "id" | "sequence">,
): Extract<CellEvent, { type: T }> {
  return {
    type,
    timestamp: Date.now(),
    ...data,
  } as Extract<CellEvent, { type: T }>;
}

describe("Bead Event Store", () => {
  let pglite: PGlite;
  let db: DatabaseAdapter;
  const projectKey = "/test/project";

  beforeEach(async () => {
    // Create isolated in-memory instance for tests to avoid singleton conflicts
    // getDatabase() uses a singleton that persists across tests and causes "PGlite is closed" errors
    pglite = new PGlite(); // In-memory, isolated instance
    
    // Initialize the core events table (same as getDatabase() does via initializeSchema())
    // This is the base schema needed before beads migration
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

  // ============================================================================
  // appendCellEvent
  // ============================================================================

  test("appendCellEvent - appends bead_created event", async () => {
    const event = createCellEvent("cell_created", {
      project_key: projectKey,
      cell_id: "bd-test-001",
      title: "Test Bead",
      issue_type: "task",
      priority: 2,
    });

    const result = await appendCellEvent(event, undefined, db);

    expect(result.id).toBeGreaterThan(0);
    expect(result.sequence).toBeGreaterThan(0);
    expect(result.type).toBe("cell_created");
    expect(result.cell_id).toBe("bd-test-001");

    // Verify event was persisted
    const events = await readCellEvents({}, undefined, db);
    expect(events).toHaveLength(1);
    expect(events[0]?.cell_id).toBe("bd-test-001");
  });

  test("appendCellEvent - updates projection for bead_created", async () => {
    const event = createCellEvent("cell_created", {
      project_key: projectKey,
      cell_id: "bd-test-002",
      title: "Test Projection",
      issue_type: "feature",
      priority: 3,
    });

    await appendCellEvent(event, undefined, db);

    // Check projection was updated
    const bead = await getCell(db, projectKey, "bd-test-002");
    expect(bead).not.toBeNull();
    expect(bead?.title).toBe("Test Projection");
    expect(bead?.type).toBe("feature");
    expect(bead?.status).toBe("open");
  });

  test("appendCellEvent - handles bead_updated event", async () => {
    // Create bead first
    const createEvent = createCellEvent("cell_created", {
      project_key: projectKey,
      cell_id: "bd-test-003",
      title: "Original Title",
      issue_type: "bug",
      priority: 1,
    });
    await appendCellEvent(createEvent, undefined, db);

    // Update it
    const updateEvent = createCellEvent("cell_updated", {
      project_key: projectKey,
      cell_id: "bd-test-003",
      changes: {
        title: { old: "Original Title", new: "Updated Title" },
      },
    });
    await appendCellEvent(updateEvent, undefined, db);

    // Check projection
    const bead = await getCell(db, projectKey, "bd-test-003");
    expect(bead?.title).toBe("Updated Title");
  });

  test("appendCellEvent - handles bead_status_changed event", async () => {
    const createEvent = createCellEvent("cell_created", {
      project_key: projectKey,
      cell_id: "bd-test-004",
      title: "Status Test",
      issue_type: "task",
      priority: 2,
    });
    await appendCellEvent(createEvent, undefined, db);

    const statusEvent = createCellEvent("cell_status_changed", {
      project_key: projectKey,
      cell_id: "bd-test-004",
      from_status: "open",
      to_status: "in_progress",
    });
    await appendCellEvent(statusEvent, undefined, db);

    const bead = await getCell(db, projectKey, "bd-test-004");
    expect(bead?.status).toBe("in_progress");
  });

  test("appendCellEvent - handles bead_closed event", async () => {
    const createEvent = createCellEvent("cell_created", {
      project_key: projectKey,
      cell_id: "bd-test-005",
      title: "Close Test",
      issue_type: "task",
      priority: 2,
    });
    await appendCellEvent(createEvent, undefined, db);

    const closeEvent = createCellEvent("cell_closed", {
      project_key: projectKey,
      cell_id: "bd-test-005",
      reason: "Completed successfully",
    });
    await appendCellEvent(closeEvent, undefined, db);

    const bead = await getCell(db, projectKey, "bd-test-005");
    expect(bead?.status).toBe("closed");
    expect(bead?.closed_reason).toBe("Completed successfully");
    expect(bead?.closed_at).toBeGreaterThan(0);
  });

  test("appendCellEvent - handles dependency events", async () => {
    // Create two beads
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-006",
        title: "Blocker",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-007",
        title: "Blocked",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    // Add dependency
    const depEvent = createCellEvent("cell_dependency_added", {
      project_key: projectKey,
      cell_id: "bd-test-007",
      dependency: {
        target: "bd-test-006",
        type: "blocks",
      },
    });
    await appendCellEvent(depEvent, undefined, db);

    // Check dependency
    const deps = await getDependencies(db, projectKey, "bd-test-007");
    expect(deps).toHaveLength(1);
    expect(deps[0]?.depends_on_id).toBe("bd-test-006");
  });

  test("appendCellEvent - handles label events", async () => {
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-008",
        title: "Label Test",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const labelEvent = createCellEvent("cell_label_added", {
      project_key: projectKey,
      cell_id: "bd-test-008",
      label: "p0",
    });
    await appendCellEvent(labelEvent, undefined, db);

    const labels = await getLabels(db, projectKey, "bd-test-008");
    expect(labels).toContain("p0");
  });

  test("appendCellEvent - handles comment events", async () => {
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-009",
        title: "Comment Test",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const commentEvent = createCellEvent("cell_comment_added", {
      project_key: projectKey,
      cell_id: "bd-test-009",
      author: "testuser",
      body: "Test comment",
    });
    await appendCellEvent(commentEvent, undefined, db);

    const comments = await getComments(db, projectKey, "bd-test-009");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("Test comment");
  });

  // ============================================================================
  // readCellEvents
  // ============================================================================

  test("readCellEvents - returns all events", async () => {
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-010",
        title: "Event 1",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-011",
        title: "Event 2",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const events = await readCellEvents({}, undefined, db);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test("readCellEvents - filters by projectKey", async () => {
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: "/project-a",
        cell_id: "bd-test-012",
        title: "Project A",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: "/project-b",
        cell_id: "bd-test-013",
        title: "Project B",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const events = await readCellEvents({ projectKey: "/project-a" }, undefined, db);
    expect(events.every((e: CellEvent) => e.project_key === "/project-a")).toBe(true);
  });

  test("readCellEvents - filters by cell_id", async () => {
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-014",
        title: "Specific Bead",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendCellEvent(
      createCellEvent("cell_updated", {
        project_key: projectKey,
        cell_id: "bd-test-014",
        changes: {
          title: { old: "Specific Bead", new: "Updated Bead" },
        },
      }),
      undefined,
      db,
    );

    const events = await readCellEvents({ cellId: "bd-test-014" }, undefined, db);
    expect(events.every((e: CellEvent) => e.cell_id === "bd-test-014")).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  test("readCellEvents - filters by types", async () => {
    const cellId = "bd-test-015";
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: cellId,
        title: "Type Filter",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendCellEvent(
      createCellEvent("cell_label_added", {
        project_key: projectKey,
        cell_id: cellId,
        label: "test",
      }),
      undefined,
      db,
    );

    const events = await readCellEvents({ types: ["cell_label_added", "cell_label_removed"] }, undefined, db);
    expect(events.every((e: CellEvent) => e.type === "cell_label_added" || e.type === "cell_label_removed")).toBe(true);
  });

  test("readCellEvents - supports pagination", async () => {
    // Create multiple events
    for (let i = 0; i < 5; i++) {
      await appendCellEvent(
        createCellEvent("cell_created", {
          project_key: projectKey,
          cell_id: `bd-test-page-${i}`,
          title: `Page ${i}`,
          issue_type: "task",
          priority: 2,
        }),
        undefined,
        db,
      );
    }

    const page1 = await readCellEvents({ projectKey, limit: 2, offset: 0 }, undefined, db);
    const page2 = await readCellEvents({ projectKey, limit: 2, offset: 2 }, undefined, db);

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  // ============================================================================
  // replayCellEvents
  // ============================================================================

  test("replayCellEvents - rebuilds projections", async () => {
    // Create events
    const cellId = "bd-test-016";
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: cellId,
        title: "Replay Test",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendCellEvent(
      createCellEvent("cell_label_added", {
        project_key: projectKey,
        cell_id: cellId,
        label: "replay",
      }),
      undefined,
      db,
    );

    // Clear projections
    await db.exec("DELETE FROM bead_labels");
    await db.exec("DELETE FROM beads");

    // Verify cleared
    const beadBefore = await getCell(db, projectKey, cellId);
    expect(beadBefore).toBeNull();

    // Replay
    const result = await replayCellEvents({ projectKey, clearViews: false }, undefined, db);
    expect(result.eventsReplayed).toBeGreaterThanOrEqual(2);

    // Verify restored
    const beadAfter = await getCell(db, projectKey, cellId);
    expect(beadAfter).not.toBeNull();
    expect(beadAfter?.title).toBe("Replay Test");

    const labels = await getLabels(db, projectKey, cellId);
    expect(labels).toContain("replay");
  });

  test("replayCellEvents - clears views if requested", async () => {
    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-017",
        title: "Clear Test",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    const result = await replayCellEvents({ projectKey, clearViews: true }, undefined, db);
    expect(result.eventsReplayed).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);

    // Projections should be rebuilt
    const beads = await queryCells(db, projectKey);
    expect(beads.length).toBeGreaterThan(0);
  });

  test("replayCellEvents - filters by fromSequence", async () => {
    const bead1Event = await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-018",
        title: "First",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    await appendCellEvent(
      createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-test-019",
        title: "Second",
        issue_type: "task",
        priority: 2,
      }),
      undefined,
      db,
    );

    // Clear and replay only after first event
    await db.exec("DELETE FROM beads");

    const result = await replayCellEvents(
      { projectKey, fromSequence: bead1Event.sequence, clearViews: false },
      undefined,
      db,
    );

    // Should only replay second event
    expect(result.eventsReplayed).toBe(1);

    const beads = await queryCells(db, projectKey);
    expect(beads).toHaveLength(1);
    expect(beads[0]?.id).toBe("bd-test-019");
  });
});
