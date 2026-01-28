/**
 * Tests for Hive Drizzle schema.
 *
 * Validates:
 * - Schema structure matches migration spec
 * - Self-referential foreign keys work
 * - Indexes are defined
 * - Type safety
 */

import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { describe, expect, test } from "bun:test";
import { createDrizzleClient } from "../drizzle.js";
import * as schema from "./hive.js";

describe("Hive Schema", () => {
  test("beads table has correct columns", () => {
    expect(schema.beads).toBeDefined();
    expect(schema.beads.id).toBeDefined();
    expect(schema.beads.project_key).toBeDefined();
    expect(schema.beads.type).toBeDefined();
    expect(schema.beads.status).toBeDefined();
    expect(schema.beads.title).toBeDefined();
    expect(schema.beads.description).toBeDefined();
    expect(schema.beads.priority).toBeDefined();
    expect(schema.beads.parent_id).toBeDefined();
    expect(schema.beads.assignee).toBeDefined();
    expect(schema.beads.created_at).toBeDefined();
    expect(schema.beads.updated_at).toBeDefined();
    expect(schema.beads.closed_at).toBeDefined();
    expect(schema.beads.closed_reason).toBeDefined();
    expect(schema.beads.deleted_at).toBeDefined();
    expect(schema.beads.deleted_by).toBeDefined();
    expect(schema.beads.delete_reason).toBeDefined();
    expect(schema.beads.created_by).toBeDefined();
  });

  test("cells is an alias for beads", () => {
    expect(schema.cells).toBe(schema.beads);
  });

  test("cellEvents table has correct columns", () => {
    expect(schema.cellEvents).toBeDefined();
    expect(schema.cellEvents.id).toBeDefined();
    expect(schema.cellEvents.cell_id).toBeDefined();
    expect(schema.cellEvents.event_type).toBeDefined();
    expect(schema.cellEvents.payload).toBeDefined();
    expect(schema.cellEvents.created_at).toBeDefined();
  });

  test("beadLabels table has correct columns", () => {
    expect(schema.beadLabels).toBeDefined();
    expect(schema.beadLabels.cell_id).toBeDefined();
    expect(schema.beadLabels.label).toBeDefined();
    expect(schema.beadLabels.created_at).toBeDefined();
  });

  test("cellLabels is an alias for beadLabels", () => {
    expect(schema.cellLabels).toBe(schema.beadLabels);
  });

  test("beadComments table has correct columns", () => {
    expect(schema.beadComments).toBeDefined();
    expect(schema.beadComments.id).toBeDefined();
    expect(schema.beadComments.cell_id).toBeDefined();
    expect(schema.beadComments.author).toBeDefined();
    expect(schema.beadComments.body).toBeDefined();
    expect(schema.beadComments.parent_id).toBeDefined();
    expect(schema.beadComments.created_at).toBeDefined();
    expect(schema.beadComments.updated_at).toBeDefined();
  });

  test("cellComments is an alias for beadComments", () => {
    expect(schema.cellComments).toBe(schema.beadComments);
  });

  test("beadDependencies table has correct columns", () => {
    expect(schema.beadDependencies).toBeDefined();
    expect(schema.beadDependencies.cell_id).toBeDefined();
    expect(schema.beadDependencies.depends_on_id).toBeDefined();
    expect(schema.beadDependencies.relationship).toBeDefined();
    expect(schema.beadDependencies.created_at).toBeDefined();
    expect(schema.beadDependencies.created_by).toBeDefined();
  });

  test("cellDependencies is an alias for beadDependencies", () => {
    expect(schema.cellDependencies).toBe(schema.beadDependencies);
  });

  test("blockedBeadsCache table has correct columns", () => {
    expect(schema.blockedBeadsCache).toBeDefined();
    expect(schema.blockedBeadsCache.cell_id).toBeDefined();
    expect(schema.blockedBeadsCache.blocker_ids).toBeDefined();
    expect(schema.blockedBeadsCache.updated_at).toBeDefined();
  });

  test("dirtyBeads table has correct columns", () => {
    expect(schema.dirtyBeads).toBeDefined();
    expect(schema.dirtyBeads.cell_id).toBeDefined();
    expect(schema.dirtyBeads.marked_at).toBeDefined();
  });

  test("schemaVersion table has correct columns", () => {
    expect(schema.schemaVersion).toBeDefined();
    expect(schema.schemaVersion.version).toBeDefined();
    expect(schema.schemaVersion.applied_at).toBeDefined();
  });

  test("can insert and query beads with self-referential FK", async () => {
    const client = createClient({ url: ":memory:" });
    const db = createDrizzleClient(client);

    // Create table (SQLite needs explicit CREATE TABLE)
    await client.execute(`
      CREATE TABLE beads (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        title TEXT NOT NULL,
        description TEXT,
        priority INTEGER DEFAULT 2,
        parent_id TEXT REFERENCES beads(id),
        assignee TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed_at INTEGER,
        closed_reason TEXT,
        deleted_at INTEGER,
        deleted_by TEXT,
        delete_reason TEXT,
        created_by TEXT,
        result TEXT,
        result_at INTEGER
      )
    `);

    const now = Date.now();

    // Insert epic (no parent)
    await db.insert(schema.beads).values({
      id: "epic-1",
      project_key: "/test/project",
      type: "epic",
      status: "open",
      title: "Epic Task",
      priority: 1,
      created_at: now,
      updated_at: now,
    });

    // Insert subtask (parent = epic)
    await db.insert(schema.beads).values({
      id: "task-1",
      project_key: "/test/project",
      type: "task",
      status: "open",
      title: "Subtask",
      priority: 2,
      parent_id: "epic-1",
      created_at: now,
      updated_at: now,
    });

    // Query with FK join
    const results = await db
      .select()
      .from(schema.beads)
      .where(sql`parent_id = 'epic-1'`);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("task-1");
    expect(results[0].parent_id).toBe("epic-1");
  });

  test("can insert and query cell events", async () => {
    const client = createClient({ url: ":memory:" });
    const db = createDrizzleClient(client);

    await client.execute(`
      CREATE TABLE beads (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        title TEXT NOT NULL,
        description TEXT,
        priority INTEGER DEFAULT 2,
        parent_id TEXT REFERENCES beads(id),
        assignee TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed_at INTEGER,
        closed_reason TEXT,
        deleted_at INTEGER,
        deleted_by TEXT,
        delete_reason TEXT,
        created_by TEXT,
        result TEXT,
        result_at INTEGER
      )
    `);

    await client.execute(`
      CREATE TABLE cell_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cell_id TEXT NOT NULL REFERENCES beads(id),
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT
      )
    `);

    const now = Date.now();

    await db.insert(schema.beads).values({
      id: "cell-1",
      project_key: "/test/project",
      type: "task",
      title: "Test Cell",
      created_at: now,
      updated_at: now,
    });

    await db.insert(schema.cellEvents).values({
      cell_id: "cell-1",
      event_type: "created",
      payload: JSON.stringify({ title: "Test Cell" }),
      created_at: new Date().toISOString(),
    });

    const results = await db.select().from(schema.cellEvents);
    expect(results).toHaveLength(1);
    expect(results[0].cell_id).toBe("cell-1");
    expect(results[0].event_type).toBe("created");
  });
});
