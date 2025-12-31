/**
 * Database Consolidation Integration Tests
 *
 * End-to-end tests for stray database consolidation workflow.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibSQLAdapter } from "../libsql.js";
import { createLibSQLStreamsSchema } from "../streams/libsql-schema.js";
import { consolidateDatabases } from "./consolidate-databases.js";

describe("Database Consolidation - Integration", () => {
	let testDir: string;
	let globalDbPath: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `consolidate-integration-${Date.now()}`);
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

	test("full consolidation workflow", async () => {
		// Create multiple stray DBs with real data
		const rootDb = join(testDir, ".opencode", "swarm.db");
		const hiveDb = join(testDir, ".hive", "swarm-mail.db");
		const pkgDb = join(testDir, "packages", "foo", ".opencode", "swarm.db");

		mkdirSync(join(testDir, ".opencode"), { recursive: true });
		mkdirSync(join(testDir, ".hive"), { recursive: true });
		mkdirSync(join(testDir, "packages", "foo", ".opencode"), { recursive: true });

		// Populate root DB
		const rootDbAdapter = await createLibSQLAdapter({ url: `file:${rootDb}` });
		await createLibSQLStreamsSchema(rootDbAdapter);
		await rootDbAdapter.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('root_event', '${testDir}', ${Date.now()}, '{"source": "root"}')
    `);
		await rootDbAdapter.close();

		// Populate hive DB
		const hiveDbAdapter = await createLibSQLAdapter({ url: `file:${hiveDb}` });
		await createLibSQLStreamsSchema(hiveDbAdapter);
		await hiveDbAdapter.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('hive_event', '${testDir}', ${Date.now()}, '{"source": "hive"}')
    `);
		await hiveDbAdapter.close();

		// Populate package DB
		const pkgDbAdapter = await createLibSQLAdapter({ url: `file:${pkgDb}` });
		await createLibSQLStreamsSchema(pkgDbAdapter);
		await pkgDbAdapter.exec(`
      INSERT INTO events (type, project_key, timestamp, data)
      VALUES ('pkg_event', '${testDir}', ${Date.now()}, '{"source": "pkg"}')
    `);
		await pkgDbAdapter.close();

		// Run consolidation
		const report = await consolidateDatabases(testDir, globalDbPath, { yes: true });

		// Verify report
		expect(report.straysFound).toBe(3);
		expect(report.straysMigrated).toBe(3);
		expect(report.totalRowsMigrated).toBeGreaterThan(0); // At least 1 event migrated
		expect(report.errors).toHaveLength(0);

		// Verify all data in global DB
		const { createClient } = await import("@libsql/client");
		const globalClient = createClient({ url: `file:${globalDbPath}` });
		const result = await globalClient.execute("SELECT COUNT(*) as count FROM events");
		expect(Number(result.rows[0].count)).toBe(3);
		globalClient.close();

		// Verify strays are gone
		expect(existsSync(rootDb)).toBe(false);
		expect(existsSync(hiveDb)).toBe(false);
		expect(existsSync(pkgDb)).toBe(false);

		// Verify .migrated files exist
		expect(existsSync(`${rootDb}.migrated`)).toBe(true);
		expect(existsSync(`${hiveDb}.migrated`)).toBe(true);
		expect(existsSync(`${pkgDb}.migrated`)).toBe(true);
	});

	test("handles overlapping data correctly", async () => {
		// Create stray DB
		const rootDb = join(testDir, ".opencode", "swarm.db");
		mkdirSync(join(testDir, ".opencode"), { recursive: true });

		const rootDbAdapter = await createLibSQLAdapter({ url: `file:${rootDb}` });
		await createLibSQLStreamsSchema(rootDbAdapter);

		// Insert same agent that will exist in global
		await rootDbAdapter.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at)
      VALUES ('${testDir}', 'duplicate-agent', ${Date.now()}, ${Date.now()})
    `);
		await rootDbAdapter.close();

		// Pre-populate global with same agent
		const globalDbAdapter = await createLibSQLAdapter({ url: `file:${globalDbPath}` });
		await globalDbAdapter.exec(`
      INSERT INTO agents (project_key, name, registered_at, last_active_at)
      VALUES ('${testDir}', 'duplicate-agent', ${Date.now()}, ${Date.now()})
    `);
		await globalDbAdapter.close();

		// Run consolidation
		const report = await consolidateDatabases(testDir, globalDbPath, { yes: true });

		// Verify no duplicate in global DB
		const { createClient } = await import("@libsql/client");
		const globalClient = createClient({ url: `file:${globalDbPath}` });
		const result = await globalClient.execute("SELECT COUNT(*) as count FROM agents");
		expect(Number(result.rows[0].count)).toBe(1); // Still only 1
		globalClient.close();
	});
});
