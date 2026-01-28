/**
 * Full Hive Session Integration Test
 *
 * Validates the complete libSQL flow: create epic with subtasks,
 * mark cells in_progress, close cells, flush to JSONL, verify persistence.
 *
 * This test simulates a real hive session end-to-end to ensure
 * the libSQL migration is working correctly before release.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { convertPlaceholders, type DatabaseAdapter } from "../libsql.js";
import { createHiveAdapter } from "./adapter.js";
import { FlushManager } from "./flush-manager.js";
import { parseJSONL } from "./jsonl.js";
import { beadsMigrationLibSQL, cellsViewMigrationLibSQL, beadsResultColumnsMigrationLibSQL } from "./migrations.js";

/**
 * Wrap libSQL client with DatabaseAdapter interface
 * Uses executeMultiple for exec() to handle multi-statement migrations
 * 
 * IMPORTANT: Includes getClient() method so toDrizzleDb() recognizes this
 * as a LibSQL adapter (not PGlite).
 */
function wrapLibSQL(client: Client): DatabaseAdapter & { getClient: () => Client } {
	return {
		query: async <T>(sql: string, params?: unknown[]) => {
			const converted = convertPlaceholders(sql, params);
			const result = await client.execute({
				sql: converted.sql,
				args: converted.params,
			});
			return { rows: result.rows as T[] };
		},
		exec: async (sql: string) => {
			const converted = convertPlaceholders(sql);
			await client.executeMultiple(converted.sql);
		},
		close: () => client.close(),
		// Required for toDrizzleDb() to recognize this as LibSQL (not PGlite)
		getClient: () => client,
	};
}

describe("Full Hive Session Flow", () => {
	const testDir = join(tmpdir(), `hive-session-test-${Date.now()}`);
	const projectKey = testDir;
	const outputPath = join(testDir, ".hive", "issues.jsonl");

	let client: Client;
	let db: DatabaseAdapter;
	let adapter: ReturnType<typeof createHiveAdapter>;

	beforeAll(async () => {
		// Create test directory structure
		await mkdir(join(testDir, ".hive"), { recursive: true });

		// Create in-memory libSQL database
		client = createClient({ url: ":memory:" });
		db = wrapLibSQL(client);

	// Create base schema (events table, schema_version) - required before migrations
	await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence INTEGER,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT
      )
    `);
		await client.execute(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);

		// Run hive migrations directly (beads tables, cells view, result columns)
		await db.exec(beadsMigrationLibSQL.up);
		await db.exec(cellsViewMigrationLibSQL.up);
		await db.exec(beadsResultColumnsMigrationLibSQL.up);

		adapter = createHiveAdapter(db, projectKey);
	});

	afterAll(async () => {
		// Clean up
		if (existsSync(testDir)) {
			await rm(testDir, { recursive: true, force: true });
		}
		await client.close();
	});

	test("simulate full hive session: create epic → start → close → flush → verify", async () => {
		// ========================================================================
		// ARRANGE: Create epic with 3 subtasks
		// ========================================================================
		const epic = await adapter.createCell(projectKey, {
			title: "Add Authentication",
			type: "epic",
			priority: 1,
			description: "Implement OAuth2 authentication flow",
		});

		const subtask1 = await adapter.createCell(projectKey, {
			title: "Create auth service",
			type: "task",
			priority: 2,
			parent_id: epic.id,
		});

		const subtask2 = await adapter.createCell(projectKey, {
			title: "Add login UI",
			type: "task",
			priority: 2,
			parent_id: epic.id,
		});

		const subtask3 = await adapter.createCell(projectKey, {
			title: "Write auth tests",
			type: "task",
			priority: 2,
			parent_id: epic.id,
		});

		// Verify epic has subtasks
		const epicAfterCreate = await adapter.getCell(projectKey, epic.id);
		expect(epicAfterCreate.status).toBe("open");

		// ========================================================================
		// ACT: Simulate session work
		// ========================================================================

		// 1. Start first subtask
		await adapter.updateCell(projectKey, subtask1.id, {
			status: "in_progress",
		});
		await adapter.markDirty(projectKey, subtask1.id);

		// 2. Complete first subtask
		await adapter.closeCell(projectKey, subtask1.id, "Implemented JWT service");
		await adapter.markDirty(projectKey, subtask1.id);

		// 3. Start second subtask
		await adapter.updateCell(projectKey, subtask2.id, {
			status: "in_progress",
		});
		await adapter.markDirty(projectKey, subtask2.id);

		// 4. Complete second subtask
		await adapter.closeCell(
			projectKey,
			subtask2.id,
			"Login form with OAuth redirect",
		);
		await adapter.markDirty(projectKey, subtask2.id);

		// 5. Leave third subtask open (simulate incomplete work)

		// 6. Mark epic dirty for export
		await adapter.markDirty(projectKey, epic.id);

		// ========================================================================
		// ASSERT: Pre-flush state in database
		// ========================================================================
		const dirtyBefore = await adapter.getDirtyCells(projectKey);
		expect(dirtyBefore.length).toBe(4); // epic + 3 subtasks (1 open, 2 closed)

		const st1 = await adapter.getCell(projectKey, subtask1.id);
		expect(st1.status).toBe("closed");
		expect(st1.closed_reason).toBe("Implemented JWT service");

		const st2 = await adapter.getCell(projectKey, subtask2.id);
		expect(st2.status).toBe("closed");

		const st3 = await adapter.getCell(projectKey, subtask3.id);
		expect(st3.status).toBe("open");

		// ========================================================================
		// ACT: Flush to JSONL
		// ========================================================================
		const flushManager = new FlushManager({
			adapter,
			projectKey,
			outputPath,
		});

		const flushResult = await flushManager.flush();

		// ========================================================================
		// ASSERT: Flush result
		// ========================================================================
		expect(flushResult.cellsExported).toBe(4);
		expect(flushResult.duration).toBeGreaterThanOrEqual(0);

		// ========================================================================
		// ASSERT: JSONL file contents
		// ========================================================================
		expect(existsSync(outputPath)).toBe(true);

		const jsonlContent = await readFile(outputPath, "utf-8");
		const cells = parseJSONL(jsonlContent);

		expect(cells.length).toBe(4);

		// Find cells by title (order not guaranteed)
		const epicCell = cells.find((c) => c.title === "Add Authentication");
		const st1Cell = cells.find((c) => c.title === "Create auth service");
		const st2Cell = cells.find((c) => c.title === "Add login UI");
		const st3Cell = cells.find((c) => c.title === "Write auth tests");

		expect(epicCell).toBeDefined();
		expect(epicCell?.status).toBe("open");
		expect(epicCell?.issue_type).toBe("epic");
		expect(epicCell?.description).toBe("Implement OAuth2 authentication flow");

		expect(st1Cell).toBeDefined();
		expect(st1Cell?.status).toBe("closed");
		// Note: close reason is stored in DB but not exported to JSONL (steveyegge/beads compat)

		expect(st2Cell).toBeDefined();
		expect(st2Cell?.status).toBe("closed");

		expect(st3Cell).toBeDefined();
		expect(st3Cell?.status).toBe("open");

		// ========================================================================
		// ASSERT: Dirty flags cleared after flush
		// ========================================================================
		const dirtyAfter = await adapter.getDirtyCells(projectKey);
		expect(dirtyAfter.length).toBe(0);

		// ========================================================================
		// BONUS: Round-trip verification
		// ========================================================================
		// Verify we can parse the JSONL and reconstruct the session state
		const allCellIds = cells.map((c) => c.id).sort();
		expect(allCellIds).toContain(epic.id);
		expect(allCellIds).toContain(subtask1.id);
		expect(allCellIds).toContain(subtask2.id);
		expect(allCellIds).toContain(subtask3.id);

		// Verify timestamps are valid ISO 8601
		for (const cell of cells) {
			expect(new Date(cell.created_at).getTime()).toBeGreaterThan(0);
			expect(new Date(cell.updated_at).getTime()).toBeGreaterThan(0);
		}
	});

	test("flush merges with existing JSONL from previous session", async () => {
		// This test ensures flush() doesn't overwrite the file from the previous test
		// (simulating multiple sessions)

		// ========================================================================
		// ARRANGE: Previous session left 4 cells in JSONL
		// ========================================================================
		const beforeContent = await readFile(outputPath, "utf-8");
		const beforeCells = parseJSONL(beforeContent);
		expect(beforeCells.length).toBe(4); // From previous test

		// ========================================================================
		// ACT: New session creates additional cell
		// ========================================================================
		const newCell = await adapter.createCell(projectKey, {
			title: "Fix auth bug",
			type: "bug",
			priority: 0,
		});
		await adapter.markDirty(projectKey, newCell.id);

		// ========================================================================
		// ACT: Flush new cell
		// ========================================================================
		const flushManager = new FlushManager({
			adapter,
			projectKey,
			outputPath,
		});

		const flushResult = await flushManager.flush();

		// ========================================================================
		// ASSERT: Merge behavior - should have 5 cells now
		// ========================================================================
		expect(flushResult.cellsExported).toBe(1); // Only the new cell was dirty

		const afterContent = await readFile(outputPath, "utf-8");
		const afterCells = parseJSONL(afterContent);

		expect(afterCells.length).toBe(5); // 4 from before + 1 new

		const newCellInFile = afterCells.find((c) => c.id === newCell.id);
		expect(newCellInFile).toBeDefined();
		expect(newCellInFile?.title).toBe("Fix auth bug");
		expect(newCellInFile?.issue_type).toBe("bug");
	});
});
