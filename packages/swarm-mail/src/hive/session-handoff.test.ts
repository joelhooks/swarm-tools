/**
 * Session Handoff Notes Tests
 *
 * RED phase: Tests for Chainlink-inspired session management
 * with handoff notes for context preservation across sessions.
 *
 * Inspired by: https://github.com/dollspace-gay/chainlink
 * Credit: @dollspace-gay for the session handoff pattern
 *
 * @module hive/session-handoff.test
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { convertPlaceholders, type DatabaseAdapter } from "../libsql.js";
import { createHiveAdapter } from "./adapter.js";
import { beadsMigrationLibSQL, cellsViewMigrationLibSQL, sessionsMigrationLibSQL, beadsResultColumnsMigrationLibSQL } from "./migrations.js";

/**
 * Wrap libSQL client with DatabaseAdapter interface
 * (Copied from session.integration.test.ts)
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
		getClient: () => client,
	};
}

describe("Session Handoff Notes", () => {
	const projectKey = "/test/project";

	let client: Client;
	let db: DatabaseAdapter;
	let adapter: ReturnType<typeof createHiveAdapter>;

	beforeAll(async () => {
		// Create in-memory libSQL database
		client = createClient({ url: ":memory:" });
		db = wrapLibSQL(client);

		// Create base schema (events table, schema_version)
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

		// Run hive migrations
		await db.exec(beadsMigrationLibSQL.up);
		await db.exec(cellsViewMigrationLibSQL.up);
		await db.exec(sessionsMigrationLibSQL.up);
		await db.exec(beadsResultColumnsMigrationLibSQL.up);

		adapter = createHiveAdapter(db, projectKey);
	});

	afterAll(async () => {
		await client.close();
	});

	describe("startSession()", () => {
		test("RED: creates new session with cell reference", async () => {
			// ARRANGE: Create a cell to work on
			const cell = await adapter.createCell(projectKey, {
				title: "Implement feature",
				type: "task",
				priority: 2,
			});

			// ACT: Start session with active cell
			const session = await adapter.startSession(projectKey, {
				active_cell_id: cell.id,
			});

			// ASSERT: Session created
			expect(session.id).toBeDefined();
			expect(session.started_at).toBeDefined();
			expect(session.active_cell_id).toBe(cell.id);
			expect(session.ended_at).toBeNull();
			expect(session.handoff_notes).toBeNull();
		});

		test("RED: returns previous session's handoff notes", async () => {
			// ARRANGE: Previous session with handoff notes
			const cell = await adapter.createCell(projectKey, {
				title: "Fix bug",
				type: "bug",
				priority: 1,
			});

			const previousSession = await adapter.startSession(projectKey, {
				active_cell_id: cell.id,
			});
			await adapter.endSession(projectKey, previousSession.id, {
				handoff_notes:
					"Found root cause in auth service. Need to refactor token refresh logic next session.",
			});

			// ACT: Start new session
			const newSession = await adapter.startSession(projectKey, {
				active_cell_id: cell.id,
			});

			// ASSERT: New session shows previous handoff notes
			expect(newSession.previous_handoff_notes).toBe(
				"Found root cause in auth service. Need to refactor token refresh logic next session.",
			);
		});

		test("RED: shows null if no previous session exists", async () => {
			// ARRANGE: New project with no previous sessions
			const freshProjectKey = "/fresh/project";
			const cell = await adapter.createCell(freshProjectKey, {
				title: "First task",
				type: "task",
				priority: 2,
			});

			// ACT: Start first session
			const session = await adapter.startSession(freshProjectKey, {
				active_cell_id: cell.id,
			});

			// ASSERT: No previous notes
			expect(session.previous_handoff_notes).toBeNull();
		});
	});

	describe("endSession()", () => {
		test("RED: saves handoff notes for next session", async () => {
			// ARRANGE: Active session (unique project key to isolate)
			const testProjectKey = `${projectKey}/end-session-1`;
			const cell = await adapter.createCell(testProjectKey, {
				title: "Add feature",
				type: "feature",
				priority: 2,
			});
			const session = await adapter.startSession(testProjectKey, {
				active_cell_id: cell.id,
			});

			// ACT: End session with notes
			await adapter.endSession(testProjectKey, session.id, {
				handoff_notes:
					"Completed API integration. Next: add error handling and retry logic.",
			});

			// ASSERT: Session closed
			const endedSession = await adapter.getSession(testProjectKey, session.id);
			expect(endedSession?.ended_at).toBeDefined();
			expect(endedSession?.handoff_notes).toBe(
				"Completed API integration. Next: add error handling and retry logic.",
			);
		});

		test("RED: allows ending session without notes", async () => {
			// ARRANGE: Active session (unique project key)
			const testProjectKey = `${projectKey}/end-session-2`;
			const cell = await adapter.createCell(testProjectKey, {
				title: "Quick fix",
				type: "chore",
				priority: 3,
			});
			const session = await adapter.startSession(testProjectKey, {
				active_cell_id: cell.id,
			});

			// ACT: End session without notes
			await adapter.endSession(testProjectKey, session.id);

			// ASSERT: Session closed, notes null
			const endedSession = await adapter.getSession(testProjectKey, session.id);
			expect(endedSession?.ended_at).toBeDefined();
			expect(endedSession?.handoff_notes).toBeNull();
		});

		test("RED: throws if session already ended", async () => {
			// ARRANGE: Ended session (unique project key)
			const testProjectKey = `${projectKey}/end-session-3`;
			const cell = await adapter.createCell(testProjectKey, {
				title: "Task",
				type: "task",
				priority: 2,
			});
			const session = await adapter.startSession(testProjectKey, {
				active_cell_id: cell.id,
			});
			await adapter.endSession(testProjectKey, session.id);

			// ACT & ASSERT: Cannot end twice
			await expect(
				adapter.endSession(testProjectKey, session.id),
			).rejects.toThrow("Session already ended");
		});
	});

	describe("getCurrentSession()", () => {
		test("RED: returns active session if exists", async () => {
			// ARRANGE: Active session
			const cell = await adapter.createCell(projectKey, {
				title: "Work item",
				type: "task",
				priority: 2,
			});
			const session = await adapter.startSession(projectKey, {
				active_cell_id: cell.id,
			});

			// ACT: Get current session
			const current = await adapter.getCurrentSession(projectKey);

			// ASSERT: Returns the active session
			expect(current).toBeDefined();
			expect(current?.id).toBe(session.id);
			expect(current?.ended_at).toBeNull();
		});

		test("RED: returns null if no active session", async () => {
			// ARRANGE: No active session (new project or all ended)
			const freshProjectKey = "/another/project";

			// ACT: Get current session
			const current = await adapter.getCurrentSession(freshProjectKey);

			// ASSERT: No active session
			expect(current).toBeNull();
		});
	});

	describe("getSessionHistory()", () => {
		test("RED: returns sessions ordered by start time (newest first)", async () => {
			// ARRANGE: Multiple sessions
			const cell = await adapter.createCell(projectKey, {
				title: "Work",
				type: "task",
				priority: 2,
			});

			const session1 = await adapter.startSession(projectKey, {
				active_cell_id: cell.id,
			});
			await adapter.endSession(projectKey, session1.id, {
				handoff_notes: "Session 1 notes",
			});

			// Wait 1ms to ensure different timestamps
			await new Promise((resolve) => setTimeout(resolve, 1));

			const session2 = await adapter.startSession(projectKey, {
				active_cell_id: cell.id,
			});
			await adapter.endSession(projectKey, session2.id, {
				handoff_notes: "Session 2 notes",
			});

			// ACT: Get history
			const history = await adapter.getSessionHistory(projectKey);

			// ASSERT: Newest first
			expect(history.length).toBeGreaterThanOrEqual(2);
			expect(history[0].id).toBe(session2.id);
			expect(history[1].id).toBe(session1.id);
		});

		test("RED: limits results when specified", async () => {
			// ACT: Get limited history
			const history = await adapter.getSessionHistory(projectKey, { limit: 2 });

			// ASSERT: Returns at most 2
			expect(history.length).toBeLessThanOrEqual(2);
		});
	});
});
