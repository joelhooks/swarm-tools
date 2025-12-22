/**
 * PGLite Remnant Regression Tests
 *
 * Tests that verify array parameter handling works correctly in libSQL.
 * These catch P0 bugs from PGLite → libSQL migration where PostgreSQL
 * ANY() syntax was used instead of SQLite-compatible IN().
 *
 * ## Issues Covered
 *
 * ### P0 Issue #1: Array parameters in event queries
 * Filtering events by multiple types must use IN() not ANY().
 *
 * ### P0 Issue #2: Array parameters in hive queries
 * Filtering cells by status/type arrays must use IN() not ANY().
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { createInMemorySwarmMailLibSQL, closeAllSwarmMailLibSQL } from "../libsql.convenience.js";
import type { SwarmMailAdapter } from "../types/adapter.js";
import { createHiveAdapter } from "../hive/adapter.js";
import { createTestLibSQLDb } from "../test-libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import type { CellStatus, CellType } from "../types/hive-adapter.js";
import type { Client } from "@libsql/client";

describe("PGLite Remnant Regression Tests", () => {
  let swarmMail: SwarmMailAdapter;

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("regression-test");
  });

  afterAll(async () => {
    await swarmMail.close();
    await closeAllSwarmMailLibSQL();
  });

  describe("P0 Issue #1: Array parameter handling in event store", () => {
    test("readEvents with types filter should work", async () => {
      const projectKey = "event-test-1";

      // Insert test events
      await swarmMail.appendEvent({
        type: "AgentRegistered",
        project_key: projectKey,
        timestamp: Date.now(),
        data: { name: "TestAgent" },
      });

      await swarmMail.appendEvent({
        type: "MessageSent",
        project_key: projectKey,
        timestamp: Date.now(),
        data: { subject: "Test" },
      });

      await swarmMail.appendEvent({
        type: "FileReserved",
        project_key: projectKey,
        timestamp: Date.now(),
        data: { path: "/test" },
      });

      // Read events with types filter - this uses IN() in libSQL
      const events = await swarmMail.readEvents({
        projectKey,
        types: ["MessageSent", "AgentRegistered"], // Array of types
      });

      // Should find both AgentRegistered and MessageSent, not FileReserved
      expect(events.length).toBe(2);

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("AgentRegistered");
      expect(eventTypes).toContain("MessageSent");
      expect(eventTypes).not.toContain("FileReserved");
    });

    test("readEvents with single type should work", async () => {
      const projectKey = "event-test-2";

      await swarmMail.appendEvent({
        type: "AgentRegistered",
        project_key: projectKey,
        timestamp: Date.now(),
        data: { name: "TestAgent" },
      });

      await swarmMail.appendEvent({
        type: "MessageSent",
        project_key: projectKey,
        timestamp: Date.now(),
        data: { subject: "Test" },
      });

      const events = await swarmMail.readEvents({
        projectKey,
        types: ["AgentRegistered"], // Single type in array
      });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("AgentRegistered");
    });

    test("readEvents without types filter should return all events", async () => {
      const projectKey = "event-test-3";

      await swarmMail.appendEvent({
        type: "AgentRegistered",
        project_key: projectKey,
        timestamp: Date.now(),
        data: { name: "TestAgent" },
      });

      await swarmMail.appendEvent({
        type: "MessageSent",
        project_key: projectKey,
        timestamp: Date.now(),
        data: { subject: "Test" },
      });

      const events = await swarmMail.readEvents({
        projectKey,
        // No types filter
      });

      expect(events.length).toBe(2);
    });
  });

  describe("P0 Issue #2: Array parameter handling in hive projections", () => {
    let hiveDb: DatabaseAdapter;
    let hiveClient: Client;

    beforeEach(async () => {
      const { adapter, client } = await createTestLibSQLDb();
      hiveDb = adapter;
      hiveClient = client;
    });

    test("queryCells with status array should work in libSQL", async () => {
      const projectKey = "hive-test-1";
      const hive = createHiveAdapter(hiveDb, projectKey);

      // Create cells with different statuses
      await hive.createCell(projectKey, {
        title: "Open Task",
        type: "task",
        priority: 2,
      });

      const inProgressCell = await hive.createCell(projectKey, {
        title: "In Progress Task",
        type: "task",
        priority: 2,
      });

      await hive.changeCellStatus(projectKey, inProgressCell.id, "in_progress");

      const closedCell = await hive.createCell(projectKey, {
        title: "Closed Task",
        type: "task",
        priority: 2,
      });

      await hive.closeCell(projectKey, closedCell.id, "Done");

      // Query with array of statuses - this triggers the IN() code path
      const openAndInProgress = await hive.queryCells(projectKey, {
        status: ["open", "in_progress"] as CellStatus[],
      });

      expect(openAndInProgress.length).toBe(2);
      const statuses = openAndInProgress.map((c) => c.status);
      expect(statuses).toContain("open");
      expect(statuses).toContain("in_progress");
      expect(statuses).not.toContain("closed");
    });

    test("queryCells with type array should work in libSQL", async () => {
      const projectKey = "hive-test-2";
      const hive = createHiveAdapter(hiveDb, projectKey);

      // Create cells with different types
      await hive.createCell(projectKey, {
        title: "Bug",
        type: "bug",
        priority: 0,
      });

      await hive.createCell(projectKey, {
        title: "Feature",
        type: "feature",
        priority: 1,
      });

      await hive.createCell(projectKey, {
        title: "Task",
        type: "task",
        priority: 2,
      });

      // Query with array of types
      const bugsAndFeatures = await hive.queryCells(projectKey, {
        type: ["bug", "feature"] as CellType[],
      });

      expect(bugsAndFeatures.length).toBe(2);
      const types = bugsAndFeatures.map((c) => c.type);
      expect(types).toContain("bug");
      expect(types).toContain("feature");
      expect(types).not.toContain("task");
    });

    test("queryCells with single status should work in libSQL", async () => {
      const projectKey = "hive-test-3";
      const hive = createHiveAdapter(hiveDb, projectKey);

      await hive.createCell(projectKey, {
        title: "Open Task",
        type: "task",
        priority: 2,
      });

      const closedCell = await hive.createCell(projectKey, {
        title: "Closed Task",
        type: "task",
        priority: 2,
      });

      await hive.closeCell(projectKey, closedCell.id, "Done");

      // Single status (not array) - should still work
      const openCells = await hive.queryCells(projectKey, {
        status: "open",
      });

      expect(openCells.length).toBe(1);
      expect(openCells[0].status).toBe("open");
    });

    test("queryCells with combined filters (status + type arrays) should work", async () => {
      const projectKey = "hive-test-4";
      const hive = createHiveAdapter(hiveDb, projectKey);

      // Create various combinations
      await hive.createCell(projectKey, {
        title: "Open Bug",
        type: "bug",
        priority: 0,
      });

      const inProgressBug = await hive.createCell(projectKey, {
        title: "In Progress Bug",
        type: "bug",
        priority: 0,
      });
      await hive.changeCellStatus(projectKey, inProgressBug.id, "in_progress");

      await hive.createCell(projectKey, {
        title: "Open Feature",
        type: "feature",
        priority: 1,
      });

      await hive.createCell(projectKey, {
        title: "Open Task",
        type: "task",
        priority: 2,
      });

      // Both filters are arrays
      const results = await hive.queryCells(projectKey, {
        status: ["open", "in_progress"] as CellStatus[],
        type: ["bug", "feature"] as CellType[],
      });

      expect(results.length).toBe(3);

      // Verify all results match filters
      for (const cell of results) {
        expect(["open", "in_progress"]).toContain(cell.status);
        expect(["bug", "feature"]).toContain(cell.type);
      }
    });
  });

  describe("Documentation: Known Issues", () => {
    test("legacy store.ts has ANY() bugs (DEPRECATED)", () => {
      /**
       * LEGACY FILE DOCUMENTATION:
       *
       * packages/swarm-mail/src/streams/store.ts contains PostgreSQL ANY() syntax:
       * - Line 255: `type = ANY($${paramIndex++})`
       * - Line 737: Similar ANY() usage
       * - Line 761: Similar ANY() usage
       * - Line 768: Similar ANY() usage
       *
       * STATUS: This file is DEPRECATED. Use store-drizzle.ts or the adapter layer.
       * The adapter layer (libsql.convenience.ts) handles this correctly.
       */
      expect(true).toBe(true);
    });

    test("hive/projections.ts has fallback assumption (FIXED)", () => {
      /**
       * ISSUE DOCUMENTATION:
       *
       * In hive/projections.ts, there was code that assumed:
       * - If isLibSQL() returns true → use IN()
       * - If isLibSQL() returns false → use ANY() (PostgreSQL)
       *
       * PROBLEM: If detection failed, it would use ANY() on libSQL.
       *
       * STATUS: Fixed by always using IN() syntax which works on both.
       */
      expect(true).toBe(true);
    });
  });
});
