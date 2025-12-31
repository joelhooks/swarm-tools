/**
 * LibSQL Convenience Layer Tests
 *
 * Tests for simplified libSQL API - parallel to pglite.ts convenience layer.
 * Provides singleton management and simple factory for libSQL users.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SwarmMailAdapter } from "./types/adapter.js";
import {
  closeAllSwarmMailLibSQL,
  closeSwarmMailLibSQL,
  createInMemorySwarmMailLibSQL,
  getSwarmMailLibSQL,
} from "./libsql.convenience.js";

/**
 * Shared in-memory instance for tests that just need a working database.
 */
let sharedInstance: SwarmMailAdapter;

beforeAll(async () => {
  sharedInstance = await createInMemorySwarmMailLibSQL("shared-test");
});

afterAll(async () => {
  await sharedInstance.close();
  await closeAllSwarmMailLibSQL();
});

describe("libSQL convenience layer", () => {
  describe("createInMemorySwarmMailLibSQL", () => {
    test("creates working adapter", async () => {
      const adapter = await createInMemorySwarmMailLibSQL("test-basic");
      
      // Should be able to register agent
      const result = await adapter.registerAgent("test-proj", "agent-1");
      expect(result.agent_name).toBe("agent-1");
      
      await adapter.close();
    });

    test("creates isolated instances", async () => {
      const adapter1 = await createInMemorySwarmMailLibSQL("test-isolated-1");
      const adapter2 = await createInMemorySwarmMailLibSQL("test-isolated-2");
      
      await adapter1.registerAgent("proj-1", "agent-1");
      
      // adapter2 should not see agent-1
      const agents = await adapter2.getAgents("proj-1");
      expect(agents).toHaveLength(0);
      
      await adapter1.close();
      await adapter2.close();
    });
  });

  describe("getSwarmMailLibSQL", () => {
    const testProjectPath = join(tmpdir(), `test-libsql-${Date.now()}`);

    afterAll(() => {
      // Clean up test database
      if (existsSync(testProjectPath)) {
        rmSync(testProjectPath, { recursive: true, force: true });
      }
    });

    test("creates file-based database", async () => {
      const adapter = await getSwarmMailLibSQL(testProjectPath);
      
      // Verify it works
      const result = await adapter.registerAgent(testProjectPath, "agent-file");
      expect(result.agent_name).toBe("agent-file");
      
      await adapter.close();
    });

    test("returns singleton for same path", async () => {
      const adapter1 = await getSwarmMailLibSQL(testProjectPath);
      const adapter2 = await getSwarmMailLibSQL(testProjectPath);
      
      // Should be same instance
      expect(adapter1).toBe(adapter2);
      
      await closeSwarmMailLibSQL(testProjectPath);
    });

    test("persists data across sessions", async () => {
      const testPath = join(tmpdir(), `test-persist-${Date.now()}`);
      
      // Session 1: Create data
      const adapter1 = await getSwarmMailLibSQL(testPath);
      await adapter1.registerAgent(testPath, "agent-persist");
      await closeSwarmMailLibSQL(testPath);
      
      // Session 2: Read data
      const adapter2 = await getSwarmMailLibSQL(testPath);
      const agents = await adapter2.getAgents(testPath);
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("agent-persist");
      
      await closeSwarmMailLibSQL(testPath);
      rmSync(testPath, { recursive: true, force: true });
    });
  });

  describe("closeSwarmMailLibSQL", () => {
    test("closes specific instance", async () => {
      const testPath = join(tmpdir(), `test-close-${Date.now()}`);
      
      const adapter = await getSwarmMailLibSQL(testPath);
      await closeSwarmMailLibSQL(testPath);
      
      // Should get new instance
      const adapter2 = await getSwarmMailLibSQL(testPath);
      expect(adapter2).not.toBe(adapter);
      
      await closeSwarmMailLibSQL(testPath);
      rmSync(testPath, { recursive: true, force: true });
    });
  });

  describe("closeAllSwarmMailLibSQL", () => {
    test("closes all instances", async () => {
      const path1 = join(tmpdir(), `test-close-all-1-${Date.now()}`);
      const path2 = join(tmpdir(), `test-close-all-2-${Date.now()}`);
      
      await getSwarmMailLibSQL(path1);
      await getSwarmMailLibSQL(path2);
      
      await closeAllSwarmMailLibSQL();
      
      // Cleanup
      rmSync(path1, { recursive: true, force: true });
      rmSync(path2, { recursive: true, force: true });
    });
  });

  describe("with shared instance", () => {
    test("health check works", async () => {
      const health = await sharedInstance.healthCheck({});
      expect(health.connected).toBe(true);
    });

    test("can store and retrieve events", async () => {
      const event = {
        type: "test_event" as const,
        project_key: "test-proj",
        timestamp: Date.now(),
        data: { message: "test" },
      };

      const result = await sharedInstance.appendEvent(event);
      expect(result.id).toBeGreaterThan(0);
      
      const events = await sharedInstance.readEvents({
        projectKey: "test-proj",
      });
      
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("foreign key constraints", () => {
    test("FK constraints are enforced on connection initialization", async () => {
      // Create an isolated test instance
      const adapter = await createInMemorySwarmMailLibSQL("fk-test");
      const db = await adapter.getDatabase();

      // Verify FK constraints are enabled via PRAGMA
      // NOTE: libSQL enables FK by default, but we set it explicitly for:
      // - Defensive programming (guards against future changes)
      // - Self-documenting code (explicit contract)
      // - Consistency with standard SQLite patterns
      const pragmaResult = await db.query("PRAGMA foreign_keys");
      expect(pragmaResult.rows[0]).toHaveProperty("foreign_keys", 1);

      await adapter.close();
    });

    test("FK violations are prevented to avoid orphaned references", async () => {
      // This test validates the fix for the 208 orphaned message_recipients
      // found in the database integrity audit
      const adapter = await createInMemorySwarmMailLibSQL("fk-violation-test");
      const db = await adapter.getDatabase();

      // Create parent and child tables with FK relationship
      await db.exec(`
        CREATE TABLE parent_test (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      await db.exec(`
        CREATE TABLE child_test (
          id INTEGER PRIMARY KEY,
          parent_id INTEGER NOT NULL,
          value TEXT,
          FOREIGN KEY (parent_id) REFERENCES parent_test(id)
        )
      `);

      // Insert a valid parent
      await db.exec("INSERT INTO parent_test (id, name) VALUES (1, 'parent1')");

      // Attempt to insert child with INVALID FK reference (parent_id=999 doesn't exist)
      // This MUST fail to prevent orphaned references
      let caughtError = false;
      try {
        await db.exec("INSERT INTO child_test (id, parent_id, value) VALUES (1, 999, 'orphan')");
      } catch (error) {
        caughtError = true;
        // Verify it's a FK constraint violation
        expect(error).toBeDefined();
        expect(String(error)).toMatch(/foreign key constraint/i);
      }

      // CRITICAL: FK violation MUST be caught
      // This prevents future orphaned references in production
      expect(caughtError).toBe(true);

      await adapter.close();
    });
  });
});
