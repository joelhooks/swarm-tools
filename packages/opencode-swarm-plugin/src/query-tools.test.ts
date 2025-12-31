/**
 * RED PHASE: Failing tests for query-tools
 * 
 * These tests define the contract for:
 * - 10 preset queries (SQL string generation)
 * - executeQuery() (custom SQL execution against libSQL)
 * - formatAsTable() (aligned box-drawing output)
 * - formatAsCSV() (proper escaping)
 * - formatAsJSON() (valid JSON array)
 * 
 * Implementation comes in GREEN phase (query-tools.ts doesn't exist yet).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
	createInMemorySwarmMailLibSQL,
	type SwarmMailAdapter,
	type DatabaseAdapter,
	getGlobalDbPath,
} from "swarm-mail";

// Import from non-existent file (will fail until GREEN phase)
import {
	presetQueries,
	executeQuery,
	formatAsTable,
	formatAsCSV,
	formatAsJSON,
	getDbPath,
	type PresetQueryName,
	type QueryResult,
} from "./query-tools";

describe("Query Tools - RED Phase Tests", () => {
	let swarmMail: SwarmMailAdapter;
	let db: DatabaseAdapter;

	beforeAll(async () => {
		swarmMail = await createInMemorySwarmMailLibSQL("query-tools-test");
		db = await swarmMail.getDatabase();

		// Insert test data for queries
		await db.query(
			`INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)`,
			[
				"subtask_outcome",
				"/test/project",
				Date.now(),
				JSON.stringify({ 
					agent_name: "AgentA",
					epic_id: "epic1",
					bead_id: "bead1",
					success: false, 
					strategy: "file-based", 
					durationMs: 5000 
				}),
			],
		);

		await db.query(
			`INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)`,
			[
				"subtask_outcome",
				"/test/project",
				Date.now() + 1000,
				JSON.stringify({ 
					agent_name: "AgentB",
					epic_id: "epic1",
					bead_id: "bead2",
					success: true, 
					strategy: "feature-based", 
					durationMs: 3000 
				}),
			],
		);

		await db.query(
			`INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)`,
			[
				"reservation_created",
				"/test/project",
				Date.now() + 2000,
				JSON.stringify({ 
					agent_name: "AgentA",
					epic_id: "epic1",
					bead_id: "bead1",
					paths: ["src/file.ts"], 
					exclusive: true 
				}),
			],
		);

		await db.query(
			`INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)`,
			[
				"reservation_created",
				"/test/project",
				Date.now() + 3000,
				JSON.stringify({ 
					agent_name: "AgentB",
					epic_id: "epic1",
					bead_id: "bead2",
					paths: ["src/file.ts"], 
					exclusive: true 
				}),
			],
		);

		await db.query(
			`INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)`,
			[
				"review_feedback",
				"/test/project",
				Date.now() + 4000,
				JSON.stringify({ 
					agent_name: "Coordinator",
					epic_id: "epic1",
					bead_id: "bead1",
					status: "needs_changes", 
					issues: ["Type error"] 
				}),
			],
		);

		await db.query(
			`INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)`,
			[
				"decomposition_failed",
				"/test/project",
				Date.now() + 5000,
				JSON.stringify({ 
					agent_name: "Planner",
					epic_id: "epic2",
					error: "Invalid JSON", 
					strategy: "risk-based" 
				}),
			],
		);

		await db.query(
			`INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)`,
			[
				"compaction",
				"/test/project",
				Date.now() + 6000,
				JSON.stringify({ 
					agent_name: "System",
					beforeSize: 100000, 
					afterSize: 50000, 
					ratio: 0.5 
				}),
			],
		);
	});

	afterAll(async () => {
		await swarmMail.close();
	});

	describe("Preset Queries - SQL Generation", () => {
		test("failed_decompositions query returns valid SQL string", () => {
			const sql = presetQueries.failed_decompositions;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql).toContain("decomposition_failed");
			expect(sql.toLowerCase()).toContain("group by");
		});

		test("duration_by_strategy query returns valid SQL string", () => {
			const sql = presetQueries.duration_by_strategy;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql).toContain("subtask_outcome");
			expect(sql.toLowerCase()).toContain("avg");
			expect(sql.toLowerCase()).toContain("group by");
		});

		test("file_conflicts query returns valid SQL string", () => {
			const sql = presetQueries.file_conflicts;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql).toContain("reservation_created");
			expect(sql.toLowerCase()).toContain("json_each");
		});

		test("worker_success_rate query returns valid SQL string", () => {
			const sql = presetQueries.worker_success_rate;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql).toContain("subtask_outcome");
			expect(sql.toLowerCase()).toContain("cast");
			expect(sql.toLowerCase()).toContain("group by");
		});

		test("review_rejections query returns valid SQL string", () => {
			const sql = presetQueries.review_rejections;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql).toContain("review_feedback");
			expect(sql).toContain("needs_changes");
		});

		test("blocked_tasks query returns valid SQL string", () => {
			const sql = presetQueries.blocked_tasks;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql.toLowerCase()).toContain("where");
			expect(sql.toLowerCase()).toContain("status");
		});

		test("agent_activity query returns valid SQL string", () => {
			const sql = presetQueries.agent_activity;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql.toLowerCase()).toContain("count");
			expect(sql.toLowerCase()).toContain("group by");
			expect(sql.toLowerCase()).toContain("agent_name");
		});

		test("event_frequency query returns valid SQL string", () => {
			const sql = presetQueries.event_frequency;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql.toLowerCase()).toContain("strftime");
			expect(sql.toLowerCase()).toContain("group by");
		});

		test("error_patterns query returns valid SQL string", () => {
			const sql = presetQueries.error_patterns;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql.toLowerCase()).toContain("json_extract");
			expect(sql.toLowerCase()).toContain("group by");
		});

		test("compaction_stats query returns valid SQL string", () => {
			const sql = presetQueries.compaction_stats;
			
			expect(typeof sql).toBe("string");
			expect(sql).toContain("SELECT");
			expect(sql).toContain("compaction");
			expect(sql.toLowerCase()).toContain("avg");
		});

		test("all preset query names are valid PresetQueryName types", () => {
			const validNames: PresetQueryName[] = [
				"failed_decompositions",
				"duration_by_strategy",
				"file_conflicts",
				"worker_success_rate",
				"review_rejections",
				"blocked_tasks",
				"agent_activity",
				"event_frequency",
				"error_patterns",
				"compaction_stats",
			];

			for (const name of validNames) {
				expect(presetQueries[name]).toBeDefined();
				expect(typeof presetQueries[name]).toBe("string");
			}
		});
	});

	describe("executeQuery - Custom SQL Execution", () => {
		test("executes custom SQL and returns QueryResult", async () => {
			const sql = "SELECT COUNT(*) as total FROM events";
			const result = await executeQuery(db, sql);

			expect(result).toHaveProperty("rows");
			expect(result).toHaveProperty("columns");
			expect(result).toHaveProperty("rowCount");
			expect(result).toHaveProperty("executionTimeMs");
			expect(Array.isArray(result.rows)).toBe(true);
			expect(result.rows.length).toBeGreaterThan(0);
		});

		test("executes parameterized query safely", async () => {
			const sql = "SELECT * FROM events WHERE type = ?";
			const result = await executeQuery(db, sql, ["subtask_outcome"]);

			expect(result.rows.length).toBe(2);
			expect(result.rowCount).toBe(2);
		});

		test("returns execution time in milliseconds", async () => {
			const sql = "SELECT * FROM events LIMIT 1";
			const result = await executeQuery(db, sql);

			expect(typeof result.executionTimeMs).toBe("number");
			expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
		});

		test("returns column names from query", async () => {
			const sql = "SELECT id, type, timestamp FROM events LIMIT 1";
			const result = await executeQuery(db, sql);

			expect(Array.isArray(result.columns)).toBe(true);
			expect(result.columns).toContain("id");
			expect(result.columns).toContain("type");
			expect(result.columns).toContain("timestamp");
		});

		test("handles empty result set", async () => {
			const sql = "SELECT * FROM events WHERE type = 'nonexistent'";
			const result = await executeQuery(db, sql);

			expect(result.rows).toEqual([]);
			expect(result.rowCount).toBe(0);
		});

		test("prevents SQL injection via parameterization", async () => {
			// Malicious input that would drop table if not parameterized
			const maliciousInput = "'; DROP TABLE events; --";
			const sql = "SELECT * FROM events WHERE type = ?";
			
			// Should treat as literal string, not execute SQL
			const result = await executeQuery(db, sql, [maliciousInput]);
			
			expect(result.rows).toEqual([]);
			
			// Verify table still exists by querying it
			const tableCheck = await executeQuery(db, "SELECT COUNT(*) as count FROM events");
			expect(tableCheck.rows[0].count).toBeGreaterThan(0);
		});
	});

	describe("formatAsTable - Box-Drawing Alignment", () => {
		test("formats result as aligned table with box-drawing characters", () => {
			const result: QueryResult = {
				columns: ["name", "count", "percent"],
				rows: [
					{ name: "AgentA", count: 5, percent: 50.0 },
					{ name: "AgentB", count: 3, percent: 30.0 },
					{ name: "LongAgentName", count: 2, percent: 20.0 },
				],
				rowCount: 3,
				executionTimeMs: 12.5,
			};

			const table = formatAsTable(result);

			expect(table).toContain("┌");
			expect(table).toContain("┐");
			expect(table).toContain("└");
			expect(table).toContain("┘");
			expect(table).toContain("│");
			expect(table).toContain("─");
			expect(table).toContain("name");
			expect(table).toContain("count");
			expect(table).toContain("percent");
			expect(table).toContain("AgentA");
			expect(table).toContain("LongAgentName");
		});

		test("aligns columns properly with varying widths", () => {
			const result: QueryResult = {
				columns: ["short", "verylongcolumnname"],
				rows: [
					{ short: "a", verylongcolumnname: "value1" },
					{ short: "bb", verylongcolumnname: "val" },
				],
				rowCount: 2,
				executionTimeMs: 5,
			};

			const table = formatAsTable(result);
			const lines = table.split("\n");

			// All lines should have same width (proper alignment)
			const widths = lines.map((line) => line.length);
			const uniqueWidths = new Set(widths.filter((w) => w > 0));
			expect(uniqueWidths.size).toBe(1); // All non-empty lines same width
		});

		test("handles empty result set gracefully", () => {
			const result: QueryResult = {
				columns: ["name", "count"],
				rows: [],
				rowCount: 0,
				executionTimeMs: 1,
			};

			const table = formatAsTable(result);

			expect(table).toContain("name");
			expect(table).toContain("count");
			expect(table).toContain("0 rows"); // Should indicate no results
		});

		test("handles null and undefined values", () => {
			const result: QueryResult = {
				columns: ["name", "value"],
				rows: [
					{ name: "test", value: null },
					{ name: "another", value: undefined },
				],
				rowCount: 2,
				executionTimeMs: 2,
			};

			const table = formatAsTable(result);

			expect(table).toContain("NULL"); // null values shown as NULL
		});

		test("includes execution time in footer", () => {
			const result: QueryResult = {
				columns: ["id"],
				rows: [{ id: 1 }],
				rowCount: 1,
				executionTimeMs: 42.123,
			};

			const table = formatAsTable(result);

			expect(table).toContain("42.1"); // Should show execution time
			expect(table).toContain("ms");
		});
	});

	describe("formatAsCSV - Proper Escaping", () => {
		test("formats result as CSV with headers", () => {
			const result: QueryResult = {
				columns: ["name", "count"],
				rows: [
					{ name: "AgentA", count: 5 },
					{ name: "AgentB", count: 3 },
				],
				rowCount: 2,
				executionTimeMs: 5,
			};

			const csv = formatAsCSV(result);

			expect(csv).toContain("name,count");
			expect(csv).toContain("AgentA,5");
			expect(csv).toContain("AgentB,3");
		});

		test("escapes fields containing commas", () => {
			const result: QueryResult = {
				columns: ["name", "description"],
				rows: [{ name: "Test", description: "Has, a comma" }],
				rowCount: 1,
				executionTimeMs: 1,
			};

			const csv = formatAsCSV(result);

			expect(csv).toContain('"Has, a comma"');
		});

		test("escapes fields containing quotes", () => {
			const result: QueryResult = {
				columns: ["name", "message"],
				rows: [{ name: "Test", message: 'She said "hello"' }],
				rowCount: 1,
				executionTimeMs: 1,
			};

			const csv = formatAsCSV(result);

			// Quotes should be doubled and field wrapped
			expect(csv).toContain('She said ""hello""');
		});

		test("escapes fields containing newlines", () => {
			const result: QueryResult = {
				columns: ["name", "text"],
				rows: [{ name: "Test", text: "Line1\nLine2" }],
				rowCount: 1,
				executionTimeMs: 1,
			};

			const csv = formatAsCSV(result);

			expect(csv).toContain('"Line1\nLine2"');
		});

		test("handles null and undefined values as empty strings", () => {
			const result: QueryResult = {
				columns: ["name", "value"],
				rows: [
					{ name: "test1", value: null },
					{ name: "test2", value: undefined },
				],
				rowCount: 2,
				executionTimeMs: 1,
			};

			const csv = formatAsCSV(result);
			const lines = csv.split("\n");

			expect(lines[1]).toContain("test1,");
			expect(lines[2]).toContain("test2,");
		});

		test("handles empty result set", () => {
			const result: QueryResult = {
				columns: ["name", "count"],
				rows: [],
				rowCount: 0,
				executionTimeMs: 1,
			};

			const csv = formatAsCSV(result);

			expect(csv).toBe("name,count"); // Headers only, no rows
		});
	});

	describe("formatAsJSON - Valid JSON Array", () => {
		test("formats result as valid JSON array", () => {
			const result: QueryResult = {
				columns: ["name", "count"],
				rows: [
					{ name: "AgentA", count: 5 },
					{ name: "AgentB", count: 3 },
				],
				rowCount: 2,
				executionTimeMs: 5,
			};

			const json = formatAsJSON(result);

			// Should be parseable
			const parsed = JSON.parse(json);
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed.length).toBe(2);
			expect(parsed[0]).toEqual({ name: "AgentA", count: 5 });
			expect(parsed[1]).toEqual({ name: "AgentB", count: 3 });
		});

		test("handles empty result set as empty array", () => {
			const result: QueryResult = {
				columns: ["name"],
				rows: [],
				rowCount: 0,
				executionTimeMs: 1,
			};

			const json = formatAsJSON(result);
			const parsed = JSON.parse(json);

			expect(parsed).toEqual([]);
		});

		test("preserves null values correctly", () => {
			const result: QueryResult = {
				columns: ["name", "value"],
				rows: [{ name: "test", value: null }],
				rowCount: 1,
				executionTimeMs: 1,
			};

			const json = formatAsJSON(result);
			const parsed = JSON.parse(json);

			expect(parsed[0].value).toBeNull();
		});

		test("handles nested objects in rows", () => {
			const result: QueryResult = {
				columns: ["id", "data"],
				rows: [{ id: 1, data: { nested: "value", count: 42 } }],
				rowCount: 1,
				executionTimeMs: 1,
			};

			const json = formatAsJSON(result);
			const parsed = JSON.parse(json);

			expect(parsed[0].data).toEqual({ nested: "value", count: 42 });
		});

		test("pretty prints with indentation", () => {
			const result: QueryResult = {
				columns: ["name"],
				rows: [{ name: "test" }],
				rowCount: 1,
				executionTimeMs: 1,
			};

			const json = formatAsJSON(result);

			// Should have newlines and indentation
			expect(json).toContain("\n");
			expect(json).toContain("  "); // 2-space indent
		});
	});

	describe("Type Safety", () => {
		test("PresetQueryName type includes all 10 queries", () => {
			// This is a compile-time check, but we can verify at runtime
			const names: PresetQueryName[] = [
				"failed_decompositions",
				"duration_by_strategy",
				"file_conflicts",
				"worker_success_rate",
				"review_rejections",
				"blocked_tasks",
				"agent_activity",
				"event_frequency",
				"error_patterns",
				"compaction_stats",
			];

			// TypeScript should accept all these without error
			expect(names.length).toBe(10);
		});

		test("QueryResult type has required fields", () => {
			const result: QueryResult = {
				columns: ["test"],
				rows: [{ test: "value" }],
				rowCount: 1,
				executionTimeMs: 5,
			};

			// Should compile without type errors
			expect(result.columns).toBeDefined();
			expect(result.rows).toBeDefined();
			expect(result.rowCount).toBeDefined();
			expect(result.executionTimeMs).toBeDefined();
		});
	});

	describe("getDbPath - Global Database Path", () => {
		test("returns correct global database path from swarm-mail", () => {
			const expectedPath = getGlobalDbPath();
			const actualPath = getDbPath();

			expect(actualPath).toBe(expectedPath);
			expect(actualPath).toContain(".config/swarm-tools/swarm.db");
		});

		test("does not use legacy .swarm-tools path", () => {
			const path = getDbPath();

			expect(path).not.toContain(".swarm-tools");
		});
	});
});
