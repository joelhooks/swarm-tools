/**
 * Database Consolidation Tests - TDD
 *
 * Tests stray database detection and migration to global database.
 *
 * ## Test Coverage
 * - detectStrayDatabases() - finds all .db files in project
 * - analyzeStrayDatabase() - get table stats and unique data
 * - migrateToGlobal() - execute migration with conflict resolution
 * - consolidateDatabases() - orchestrate full consolidation
 */

import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibSQLAdapter } from "../libsql.js";
import { createLibSQLStreamsSchema } from "../streams/libsql-schema.js";
import {
	analyzeStrayDatabase,
	consolidateDatabases,
	detectStrayDatabases,
	migrateToGlobal,
} from "./consolidate-databases.js";

describe("detectStrayDatabases", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `consolidate-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("detects .opencode/swarm.db in project root", async () => {
		const dbPath = join(testDir, ".opencode", "swarm.db");
		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		writeFileSync(dbPath, "");

		const strays = await detectStrayDatabases(testDir);

		expect(strays).toHaveLength(1);
		expect(strays[0].path).toBe(dbPath);
		expect(strays[0].location).toBe("project-root");
	});

	test("detects .hive/swarm-mail.db (legacy)", async () => {
		const dbPath = join(testDir, ".hive", "swarm-mail.db");
		mkdirSync(join(testDir, ".hive"), { recursive: true });
		writeFileSync(dbPath, "");

		const strays = await detectStrayDatabases(testDir);

		expect(strays).toHaveLength(1);
		expect(strays[0].path).toBe(dbPath);
		expect(strays[0].location).toBe("legacy-hive");
	});

	test("detects packages/*/.opencode/swarm.db", async () => {
		const pkgDbPath = join(testDir, "packages", "foo", ".opencode", "swarm.db");
		mkdirSync(join(testDir, "packages", "foo", ".opencode"), {
			recursive: true,
		});
		writeFileSync(pkgDbPath, "");

		const strays = await detectStrayDatabases(testDir);

		expect(strays).toHaveLength(1);
		expect(strays[0].path).toBe(pkgDbPath);
		expect(strays[0].location).toBe("nested-package");
	});

	test("detects multiple strays", async () => {
		// Create multiple stray DBs
		const rootDb = join(testDir, ".opencode", "swarm.db");
		const hiveDb = join(testDir, ".hive", "swarm-mail.db");
		const pkgDb = join(testDir, "packages", "bar", ".opencode", "swarm.db");

		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		mkdirSync(join(testDir, ".hive"), { recursive: true });
		mkdirSync(join(testDir, "packages", "bar", ".opencode"), {
			recursive: true,
		});

		writeFileSync(rootDb, "");
		writeFileSync(hiveDb, "");
		writeFileSync(pkgDb, "");

		const strays = await detectStrayDatabases(testDir);

		expect(strays).toHaveLength(3);
		expect(strays.map((s) => s.location)).toContain("project-root");
		expect(strays.map((s) => s.location)).toContain("legacy-hive");
		expect(strays.map((s) => s.location)).toContain("nested-package");
	});

	test("returns empty array if no strays found", async () => {
		const strays = await detectStrayDatabases(testDir);

		expect(strays).toHaveLength(0);
	});

	test("ignores .db.migrated files", async () => {
		const dbPath = join(testDir, ".opencode", "swarm.db.migrated");
		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		writeFileSync(dbPath, "");

		const strays = await detectStrayDatabases(testDir);

		expect(strays).toHaveLength(0);
	});

	test("ignores .backup- files", async () => {
		const dbPath = join(testDir, ".opencode", "swarm.db.backup-2025-12-31");
		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		writeFileSync(dbPath, "");

		const strays = await detectStrayDatabases(testDir);

		expect(strays).toHaveLength(0);
	});
});

describe("analyzeStrayDatabase", () => {
	let testDir: string;
	let strayDbPath: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `analyze-stray-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		strayDbPath = join(testDir, "stray.db");

		// Create stray DB with test data
		const strayDb = await createLibSQLAdapter({ url: `file:${strayDbPath}` });
		await createLibSQLStreamsSchema(strayDb);

		// Insert test data into multiple tables
		await strayDb.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('test_event', '${testDir}', ${Date.now()}, '{"test": true}')
    `);

		await strayDb.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at)
      VALUES ('${testDir}', 'test-agent', ${Date.now()}, ${Date.now()})
    `);

		await strayDb.exec(`
      INSERT INTO messages (project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at)
      VALUES ('${testDir}', 'test-agent', 'Test', 'Body', 'thread-1', 'normal', 0, ${Date.now()})
    `);

		await strayDb.close();
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("returns table names and row counts", async () => {
		const analysis = await analyzeStrayDatabase(strayDbPath);

		expect(analysis.tables).toContain("events");
		expect(analysis.tables).toContain("agents");
		expect(analysis.tables).toContain("messages");
		expect(analysis.rowCounts.events).toBe(1);
		expect(analysis.rowCounts.agents).toBe(1);
		expect(analysis.rowCounts.messages).toBe(1);
	});

	test("detects schema version (modern vs legacy)", async () => {
		const analysis = await analyzeStrayDatabase(strayDbPath);

		expect(analysis.schemaVersion).toBe("modern");
	});

	test("identifies unique data by ID", async () => {
		// Create global DB with overlapping data
		const globalDbPath = join(testDir, "global.db");
		const globalDb = await createLibSQLAdapter({ url: `file:${globalDbPath}` });
		await createLibSQLStreamsSchema(globalDb);

		// Insert same agent into global DB (will be skipped)
		await globalDb.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at)
      VALUES ('${testDir}', 'test-agent', ${Date.now()}, ${Date.now()})
    `);

		await globalDb.close();

		const analysis = await analyzeStrayDatabase(
			strayDbPath,
			globalDbPath,
		);

		expect(analysis.uniqueData.events).toBe(1); // Unique
		expect(analysis.uniqueData.agents).toBe(0); // Duplicate
		expect(analysis.uniqueData.messages).toBe(1); // Unique
	});

	test("returns migration plan summary", async () => {
		const analysis = await analyzeStrayDatabase(strayDbPath);

		expect(analysis.plan).toBeDefined();
		expect(analysis.plan.action).toBe("migrate");
		expect(analysis.plan.estimatedRows).toBeGreaterThan(0);
	});

	test("handles empty database", async () => {
		const emptyDbPath = join(testDir, "empty.db");
		const emptyDb = await createLibSQLAdapter({ url: `file:${emptyDbPath}` });
		await createLibSQLStreamsSchema(emptyDb);
		await emptyDb.close();

		const analysis = await analyzeStrayDatabase(emptyDbPath);

		expect(analysis.plan.action).toBe("skip");
		expect(analysis.plan.reason).toBe("empty");
	});
});

describe("migrateToGlobal", () => {
	let testDir: string;
	let strayDbPath: string;
	let globalDbPath: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `migrate-to-global-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		strayDbPath = join(testDir, "stray.db");
		globalDbPath = join(testDir, "global.db");

		// Create stray DB with test data
		const strayDb = await createLibSQLAdapter({ url: `file:${strayDbPath}` });
		await createLibSQLStreamsSchema(strayDb);

		await strayDb.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('test_event', '${testDir}', ${Date.now()}, '{"test": true}')
    `);

		await strayDb.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at)
      VALUES ('${testDir}', 'test-agent', ${Date.now()}, ${Date.now()})
    `);

		await strayDb.close();

		// Create global DB
		const globalDb = await createLibSQLAdapter({ url: `file:${globalDbPath}` });
		await createLibSQLStreamsSchema(globalDb);
		await globalDb.close();
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("migrates data from stray to global", async () => {
		const result = await migrateToGlobal(strayDbPath, globalDbPath);

		expect(result.migrated.events).toBe(1);
		expect(result.migrated.agents).toBe(1);

		// Verify data exists in global DB
		const globalDb = createClient({ url: `file:${globalDbPath}` });
		const events = await globalDb.execute("SELECT COUNT(*) as count FROM events");
		expect(Number(events.rows[0].count)).toBe(1);

		const agents = await globalDb.execute("SELECT COUNT(*) as count FROM agents");
		expect(Number(agents.rows[0].count)).toBe(1);

		globalDb.close();
	});

	test("skips duplicates (global wins)", async () => {
		// Pre-populate global DB with same agent
		const globalDb = createClient({ url: `file:${globalDbPath}` });
		await globalDb.execute({
			sql: `INSERT INTO agents (project_key, name, registered_at, last_active_at)
            VALUES (?, ?, ?, ?)`,
			args: [testDir, "test-agent", Date.now(), Date.now()],
		});
		globalDb.close();

		const result = await migrateToGlobal(strayDbPath, globalDbPath);

		expect(result.skipped.agents).toBeGreaterThan(0);
		expect(result.migrated.agents).toBe(0); // Skipped

		// Verify only 1 agent in global DB (not duplicated)
		const globalDbCheck = createClient({ url: `file:${globalDbPath}` });
		const agents = await globalDbCheck.execute(
			"SELECT COUNT(*) as count FROM agents",
		);
		expect(Number(agents.rows[0].count)).toBe(1);
		globalDbCheck.close();
	});

	test("handles foreign key references", async () => {
		// Create message with reference to agent
		const strayDb = createClient({ url: `file:${strayDbPath}` });
		await strayDb.execute({
			sql: `INSERT INTO messages (project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [testDir, "test-agent", "Test", "Body", "thread-1", "normal", 0, Date.now()],
		});
		strayDb.close();

		const result = await migrateToGlobal(strayDbPath, globalDbPath);

		// Both agent and message should migrate
		expect(result.migrated.agents).toBeGreaterThan(0);
		expect(result.migrated.messages).toBeGreaterThan(0);
	});

	test("logs what was migrated", async () => {
		const result = await migrateToGlobal(strayDbPath, globalDbPath);

		expect(result.log).toBeDefined();
		expect(result.log.length).toBeGreaterThan(0);
		expect(result.log).toContain("Migrated 1 events");
		expect(result.log).toContain("Migrated 1 agents");
	});

	test("returns summary with totals", async () => {
		const result = await migrateToGlobal(strayDbPath, globalDbPath);

		expect(result.summary).toBeDefined();
		expect(result.summary.totalMigrated).toBeGreaterThan(0);
		expect(result.summary.totalSkipped).toBeGreaterThanOrEqual(0);
	});

	test("supports skipBackup option", async () => {
		const result = await migrateToGlobal(strayDbPath, globalDbPath, {
			skipBackup: true,
		});

		expect(result.backupPath).toBeUndefined();
	});

	test("creates backup by default", async () => {
		const result = await migrateToGlobal(strayDbPath, globalDbPath);

		expect(result.backupPath).toBeDefined();
		expect(existsSync(result.backupPath!)).toBe(true);
	});
});

describe("consolidateDatabases", () => {
	let testDir: string;
	let globalDbPath: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `consolidate-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		globalDbPath = join(testDir, "global.db");

		// Create global DB
		const globalDb = await createLibSQLAdapter({ url: `file:${globalDbPath}` });
		await createLibSQLStreamsSchema(globalDb);
		await globalDb.close();
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("orchestrates full consolidation", async () => {
		// Create stray DBs
		const rootDb = join(testDir, ".opencode", "swarm.db");
		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		const rootDbAdapter = await createLibSQLAdapter({ url: `file:${rootDb}` });
		await createLibSQLStreamsSchema(rootDbAdapter);
		await rootDbAdapter.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('test', '${testDir}', ${Date.now()}, '{}')
    `);
		await rootDbAdapter.close();

		const report = await consolidateDatabases(testDir, globalDbPath, {
			yes: true,
		});

		expect(report.straysFound).toBe(1);
		expect(report.straysMigrated).toBe(1);
		expect(report.totalRowsMigrated).toBeGreaterThan(0);
	});

	test("prompts for confirmation in interactive mode", async () => {
		// Create stray DB
		const rootDb = join(testDir, ".opencode", "swarm.db");
		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		const rootDbAdapter = await createLibSQLAdapter({ url: `file:${rootDb}` });
		await createLibSQLStreamsSchema(rootDbAdapter);
		await rootDbAdapter.close();

		// In test mode, interactive should auto-confirm (mock needed for real use)
		const report = await consolidateDatabases(testDir, globalDbPath, {
			interactive: true,
		});

		expect(report.straysFound).toBe(1);
	});

	test("skips migration with -y flag when no strays", async () => {
		const report = await consolidateDatabases(testDir, globalDbPath, {
			yes: true,
		});

		expect(report.straysFound).toBe(0);
		expect(report.straysMigrated).toBe(0);
	});

	test("deletes strays after successful migration", async () => {
		// Create stray DB
		const rootDb = join(testDir, ".opencode", "swarm.db");
		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		const rootDbAdapter = await createLibSQLAdapter({ url: `file:${rootDb}` });
		await createLibSQLStreamsSchema(rootDbAdapter);
		await rootDbAdapter.close();

		await consolidateDatabases(testDir, globalDbPath, { yes: true });

		// Original DB should be gone (or renamed to .migrated)
		expect(existsSync(rootDb)).toBe(false);
	});

	test("returns full report with all migrations", async () => {
		// Create multiple stray DBs
		const rootDb = join(testDir, ".opencode", "swarm.db");
		const hiveDb = join(testDir, ".hive", "swarm-mail.db");

		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		mkdirSync(join(testDir, ".hive"), { recursive: true });

		const rootDbAdapter = await createLibSQLAdapter({ url: `file:${rootDb}` });
		await createLibSQLStreamsSchema(rootDbAdapter);
		await rootDbAdapter.close();

		const hiveDbAdapter = await createLibSQLAdapter({ url: `file:${hiveDb}` });
		await createLibSQLStreamsSchema(hiveDbAdapter);
		await hiveDbAdapter.close();

		const report = await consolidateDatabases(testDir, globalDbPath, {
			yes: true,
		});

		expect(report.straysFound).toBe(2);
		expect(report.straysMigrated).toBe(2);
		expect(report.migrations).toHaveLength(2);
	});
});
