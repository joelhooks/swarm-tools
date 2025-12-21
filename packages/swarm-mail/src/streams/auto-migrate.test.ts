/**
 * Auto-Migration Module - TDD Tests
 *
 * Tests database auto-migration from project-local to global DB.
 */

import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibSQLAdapter } from "../libsql.js";
import {
	backupOldDb,
	detectSourceType,
	getGlobalDbPath,
	migrateLibSQLToGlobal,
	migrateProjectToGlobal,
	needsMigration,
} from "./auto-migrate.js";
import { createLibSQLStreamsSchema } from "./libsql-schema.js";

describe("auto-migrate detection", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `auto-migrate-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("needsMigration returns true for libSQL project DB", () => {
    const dbPath = join(testDir, ".opencode", "streams.db");
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    writeFileSync(dbPath, "");
    
    expect(needsMigration(testDir)).toBe(true);
  });

  test("needsMigration returns true for PGlite project DB", () => {
    const pgliteDir = join(testDir, ".opencode", "streams");
    mkdirSync(pgliteDir, { recursive: true });
    writeFileSync(join(pgliteDir, "PG_VERSION"), "16");
    
    expect(needsMigration(testDir)).toBe(true);
  });

  test("needsMigration returns false when no project DB exists", () => {
    expect(needsMigration(testDir)).toBe(false);
  });

  test("getGlobalDbPath returns ~/.config/swarm-tools/swarm.db", () => {
    const path = getGlobalDbPath();
    expect(path).toContain(".config");
    expect(path).toContain("swarm-tools");
    expect(path).toContain("swarm.db");
  });

  test("detectSourceType returns 'libsql' for streams.db", () => {
    const dbPath = join(testDir, ".opencode", "streams.db");
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    writeFileSync(dbPath, "");
    
    expect(detectSourceType(testDir)).toBe("libsql");
  });

  test("detectSourceType returns 'pglite' for streams/ dir", () => {
    const pgliteDir = join(testDir, ".opencode", "streams");
    mkdirSync(pgliteDir, { recursive: true });
    writeFileSync(join(pgliteDir, "PG_VERSION"), "16");
    
    expect(detectSourceType(testDir)).toBe("pglite");
  });

  test("detectSourceType returns 'none' when no DB exists", () => {
    expect(detectSourceType(testDir)).toBe("none");
  });
});

describe("auto-migrate libSQL to global", () => {
  let testDir: string;
  let sourcePath: string;
  let globalDbPath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `auto-migrate-libsql-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    sourcePath = join(testDir, ".opencode", "streams.db");
    globalDbPath = join(testDir, "global-test.db");

    // Create source DB with test data
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    const sourceDb = await createLibSQLAdapter({ url: `file:${sourcePath}` });
    await createLibSQLStreamsSchema(sourceDb);

    // Insert test data
    await sourceDb.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('test_event', '${testDir}', ${Date.now()}, '{"test": true}')
    `);

    await sourceDb.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at)
      VALUES ('${testDir}', 'test-agent', ${Date.now()}, ${Date.now()})
    `);

    await sourceDb.close();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("migrateLibSQLToGlobal copies all tables", async () => {
    // Create global DB
    const globalDb = createClient({ url: `file:${globalDbPath}` });
    await createLibSQLStreamsSchema(await createLibSQLAdapter({ url: `file:${globalDbPath}` }));

    const stats = await migrateLibSQLToGlobal(sourcePath, globalDb);

    expect(stats.events).toBeGreaterThan(0);
    expect(stats.agents).toBeGreaterThan(0);

    // Verify data exists in global DB
    const events = await globalDb.execute("SELECT COUNT(*) as count FROM events");
    expect(Number(events.rows[0].count)).toBeGreaterThan(0);

    const agents = await globalDb.execute("SELECT COUNT(*) as count FROM agents");
    expect(Number(agents.rows[0].count)).toBeGreaterThan(0);

    globalDb.close();
  });

  test("migrateLibSQLToGlobal uses INSERT OR IGNORE (idempotent)", async () => {
    const globalDb = createClient({ url: `file:${globalDbPath}` });
    await createLibSQLStreamsSchema(await createLibSQLAdapter({ url: `file:${globalDbPath}` }));

    // Migrate once
    await migrateLibSQLToGlobal(sourcePath, globalDb);
    
    // Migrate again (should skip duplicates)
    const stats2 = await migrateLibSQLToGlobal(sourcePath, globalDb);

    expect(stats2.events).toBe(0); // Already exists
    expect(stats2.agents).toBe(0);

    globalDb.close();
  });

  test("migrateLibSQLToGlobal handles missing tables gracefully", async () => {
    // Create source DB with only events table (missing others)
    const minimalSourcePath = join(testDir, "minimal.db");
    const minimalDb = createClient({ url: `file:${minimalSourcePath}` });
    await minimalDb.execute(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);
    await minimalDb.execute(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('test', 'proj', ${Date.now()}, '{}')
    `);
    minimalDb.close();

    const globalDb = createClient({ url: `file:${globalDbPath}` });
    await createLibSQLStreamsSchema(await createLibSQLAdapter({ url: `file:${globalDbPath}` }));

    // Should not throw
    const stats = await migrateLibSQLToGlobal(minimalSourcePath, globalDb);
    
    expect(stats.events).toBe(1);
    expect(stats.agents).toBe(0); // Missing table, no error

    globalDb.close();
  });
});

describe("auto-migrate backup", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `auto-migrate-backup-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("backupOldDb renames file with timestamp", () => {
    const dbPath = join(testDir, "streams.db");
    writeFileSync(dbPath, "test data");

    const backupPath = backupOldDb(dbPath);

    expect(existsSync(dbPath)).toBe(false); // Original removed
    expect(existsSync(backupPath)).toBe(true); // Backup exists
    expect(backupPath).toContain(".backup-");
  });

  test("backupOldDb handles directories (PGlite)", () => {
    const pgliteDir = join(testDir, "streams");
    mkdirSync(pgliteDir, { recursive: true });
    writeFileSync(join(pgliteDir, "PG_VERSION"), "16");

    const backupPath = backupOldDb(pgliteDir);

    expect(existsSync(pgliteDir)).toBe(false); // Original removed
    expect(existsSync(backupPath)).toBe(true); // Backup exists
  });
});

describe("auto-migrate end-to-end", () => {
  let testDir: string;
  let globalDbPath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `auto-migrate-e2e-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    globalDbPath = join(testDir, "global-test.db");

    // Create source DB with test data
    const sourcePath = join(testDir, ".opencode", "streams.db");
    mkdirSync(join(testDir, ".opencode"), { recursive: true });
    const sourceDb = await createLibSQLAdapter({ url: `file:${sourcePath}` });
    await createLibSQLStreamsSchema(sourceDb);

    await sourceDb.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('test_event', '${testDir}', ${Date.now()}, '{"test": true}')
    `);

    await sourceDb.close();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("migrateProjectToGlobal orchestrates full migration", async () => {
    const result = await migrateProjectToGlobal(testDir, globalDbPath);

    expect(result.sourceType).toBe("libsql");
    expect(result.stats.events).toBeGreaterThan(0);
    expect(result.backupPath).toContain(".backup-");

    // Verify backup was created
    expect(existsSync(result.backupPath)).toBe(true);

    // Verify global DB has data
    const globalDb = createClient({ url: `file:${globalDbPath}` });
    const events = await globalDb.execute("SELECT COUNT(*) as count FROM events");
    expect(Number(events.rows[0].count)).toBeGreaterThan(0);
    globalDb.close();
  });
});
