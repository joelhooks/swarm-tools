/**
 * Tests for database singleton management
 *
 * Each test uses isolated database paths to prevent cross-test pollution.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeAllDatabases,
  closeDatabase,
  getDatabase,
  getDatabasePath,
  getDatabaseStats,
  isDatabaseHealthy,
  resetDatabase,
} from "./index";

// ============================================================================
// Test Isolation Helpers
// ============================================================================

/** Generate unique test database path */
function testDbPath(prefix = "test"): string {
  return `/tmp/streams-${prefix}-${randomUUID()}`;
}

/** Track paths created during test for cleanup */
let testPaths: string[] = [];

function trackPath(path: string): string {
  testPaths.push(path);
  return path;
}

// ============================================================================
// Global Cleanup
// ============================================================================

beforeEach(async () => {
  testPaths = [];
  // Nuclear cleanup - close everything before each test
  await closeAllDatabases();
});

afterEach(async () => {
  // Clean up all test databases
  for (const path of testPaths) {
    try {
      // Wipe all data before closing
      const db = await getDatabase(path);
      await db.exec(`
        DELETE FROM message_recipients;
        DELETE FROM messages;
        DELETE FROM reservations;
        DELETE FROM agents;
        DELETE FROM events;
        DELETE FROM locks;
        DELETE FROM cursors;
        DELETE FROM deferred;
      `);
    } catch {
      // Ignore errors during cleanup
    }
    await closeDatabase(path);
  }
  testPaths = [];
  // Nuclear cleanup after each test too
  await closeAllDatabases();
});

// ============================================================================
// Tests
// ============================================================================

describe("getDatabasePath", () => {
  it("returns project-local path when .opencode exists", () => {
    const path = getDatabasePath(process.cwd());
    expect(path).toMatch(/\.opencode\/streams$/);
  });

  it("falls back to global path when projectPath is undefined", () => {
    const path = getDatabasePath();
    expect(path).toMatch(/\.opencode\/streams$/);
    expect(path).toContain(require("node:os").homedir());
  });
});

describe("getDatabase singleton", () => {
  it("returns same instance for same path", async () => {
    const path = trackPath(testDbPath("same-instance"));
    const db1 = await getDatabase(path);
    const db2 = await getDatabase(path);
    expect(db1).toBe(db2);
  });

  it("caches instances by path", async () => {
    // This test verifies the caching behavior - same path returns same instance
    // Different paths may or may not return different instances depending on
    // whether file-based storage works or falls back to in-memory
    const path1 = trackPath(testDbPath("cache-1"));
    const path2 = trackPath(testDbPath("cache-2"));

    const db1a = await getDatabase(path1);
    const db1b = await getDatabase(path1);
    const db2 = await getDatabase(path2);

    // Same path MUST return same instance (this is the cache contract)
    expect(db1a).toBe(db1b);

    // Both should be functional
    const r1 = await db1a.query("SELECT 1 as ok");
    const r2 = await db2.query("SELECT 1 as ok");
    expect(r1.rows[0]).toEqual({ ok: 1 });
    expect(r2.rows[0]).toEqual({ ok: 1 });
  });

  it("initializes schema on first access", async () => {
    const path = trackPath(testDbPath("schema-init"));
    const db = await getDatabase(path);
    const result = await db.query("SELECT COUNT(*) FROM events");
    expect(result.rows).toBeDefined();
  });

  it("does not reinitialize schema on subsequent access", async () => {
    const path = trackPath(testDbPath("no-reinit"));
    const db1 = await getDatabase(path);

    await db1.exec(
      "INSERT INTO events (type, project_key, timestamp, data) VALUES ('test', 'test', 123, '{}')",
    );

    const db2 = await getDatabase(path);
    const result = await db2.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM events",
    );
    expect(parseInt(result.rows[0].count)).toBe(1);
  });

  it("concurrent calls return the same instance (no race condition)", async () => {
    const path = trackPath(testDbPath("race"));
    const promises = Array.from({ length: 10 }, () => getDatabase(path));
    const results = await Promise.all(promises);

    const firstInstance = results[0];
    const allSame = results.every((db) => db === firstInstance);
    expect(allSame).toBe(true);
  });
});

describe("closeDatabase", () => {
  it("removes instance from cache", async () => {
    const path = trackPath(testDbPath("close"));
    const db1 = await getDatabase(path);
    await closeDatabase(path);
    const db2 = await getDatabase(path);
    expect(db1).not.toBe(db2);
  });

  it("handles closing non-existent database gracefully", async () => {
    const path = testDbPath("non-existent");
    // Should not throw
    await closeDatabase(path);
    expect(true).toBe(true);
  });
});

describe("closeAllDatabases", () => {
  it("closes all cached instances", async () => {
    const path1 = trackPath(testDbPath("all-1"));
    const path2 = trackPath(testDbPath("all-2"));
    const db1 = await getDatabase(path1);
    const db2 = await getDatabase(path2);

    await closeAllDatabases();

    const db3 = await getDatabase(path1);
    const db4 = await getDatabase(path2);

    expect(db3).not.toBe(db1);
    expect(db4).not.toBe(db2);
  });
});

describe("isDatabaseHealthy", () => {
  it("returns true for healthy database", async () => {
    const path = trackPath(testDbPath("healthy"));
    await getDatabase(path);
    const healthy = await isDatabaseHealthy(path);
    expect(healthy).toBe(true);
  });
});

describe("resetDatabase", () => {
  it("clears all data but keeps schema", async () => {
    const path = trackPath(testDbPath("reset"));
    const db = await getDatabase(path);
    await db.exec(
      "INSERT INTO events (type, project_key, timestamp, data) VALUES ('test', 'test', 123, '{}')",
    );

    await resetDatabase(path);

    const result = await db.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM events",
    );
    expect(parseInt(result.rows[0].count)).toBe(0);

    // Schema should still exist
    await expect(
      db.query("SELECT 1 FROM events LIMIT 0"),
    ).resolves.toBeDefined();
  });
});

describe("getDatabaseStats", () => {
  it("returns counts for all tables", async () => {
    const path = trackPath(testDbPath("stats"));
    await resetDatabase(path);
    const stats = await getDatabaseStats(path);

    expect(stats).toEqual({
      events: 0,
      agents: 0,
      messages: 0,
      reservations: 0,
    });
  });
});
