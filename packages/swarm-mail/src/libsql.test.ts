import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibSQLAdapter } from "./libsql.js";
import type { DatabaseAdapter } from "./types/database.js";

describe("createLibSQLAdapter URL normalization", () => {
	const testDbPath = join(tmpdir(), `libsql-url-test-${Date.now()}.db`);

	afterEach(() => {
		// Clean up test database file
		if (existsSync(testDbPath)) {
			unlinkSync(testDbPath);
		}
		// Also clean up WAL/SHM files if they exist
		if (existsSync(`${testDbPath}-wal`)) {
			unlinkSync(`${testDbPath}-wal`);
		}
		if (existsSync(`${testDbPath}-shm`)) {
			unlinkSync(`${testDbPath}-shm`);
		}
	});

	test("normalizes bare filesystem paths to file: URLs", async () => {
		// This is the bug: bare paths like "/path/to/db.db" should work
		// libSQL requires "file:/path/to/db.db" format
		const db = await createLibSQLAdapter({ url: testDbPath });
		await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
		await db.exec("INSERT INTO test (id) VALUES (1)");
		const result = await db.query<{ id: number }>("SELECT id FROM test");
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.id).toBe(1);
		await db.close?.();
	});

	test("preserves file: URLs that already have the prefix", async () => {
		const db = await createLibSQLAdapter({ url: `file:${testDbPath}` });
		await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
		const result = await db.query("SELECT 1 as n");
		expect(result.rows).toHaveLength(1);
		await db.close?.();
	});

	test("preserves :memory: special URL", async () => {
		const db = await createLibSQLAdapter({ url: ":memory:" });
		await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
		const result = await db.query("SELECT 1 as n");
		expect(result.rows).toHaveLength(1);
		await db.close?.();
	});
});

describe("LibSQLAdapter", () => {
	let db: DatabaseAdapter;

	beforeEach(async () => {
		db = await createLibSQLAdapter({ url: ":memory:" });
	});

	afterEach(async () => {
		await db.close?.();
	});

	describe("query()", () => {
		test("returns empty rows for SELECT on empty table", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
			const result = await db.query<{ id: number; name: string }>(
				"SELECT * FROM users",
			);
			expect(result.rows).toEqual([]);
		});

		test("returns rows after INSERT", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
			await db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
			const result = await db.query<{ id: number; name: string }>(
				"SELECT * FROM users",
			);
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0]).toEqual({ id: 1, name: "Alice" });
		});

		test("supports parameterized queries with positional placeholders", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
			await db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
			await db.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')");

			const result = await db.query<{ id: number; name: string }>(
				"SELECT * FROM users WHERE name = ?",
				["Bob"],
			);
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0]).toEqual({ id: 2, name: "Bob" });
		});

		test("supports multiple parameters", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
			await db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
			await db.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')");
			await db.exec("INSERT INTO users (id, name) VALUES (3, 'Charlie')");

			const result = await db.query<{ id: number; name: string }>(
				"SELECT * FROM users WHERE id > ? AND name != ?",
				[1, "Charlie"],
			);
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0]).toEqual({ id: 2, name: "Bob" });
		});
	});

	describe("exec()", () => {
		test("executes CREATE TABLE", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
			// Verify table exists by querying it
			const result = await db.query("SELECT * FROM users");
			expect(result.rows).toEqual([]);
		});

		test("executes INSERT", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
			await db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
			const result = await db.query<{ id: number; name: string }>(
				"SELECT * FROM users",
			);
			expect(result.rows).toHaveLength(1);
		});

		test("executes UPDATE", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
			await db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
			await db.exec("UPDATE users SET name = 'Alicia' WHERE id = 1");
			const result = await db.query<{ name: string }>(
				"SELECT name FROM users WHERE id = 1",
			);
			expect(result.rows[0]?.name).toBe("Alicia");
		});

		test("executes DELETE", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
			await db.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
			await db.exec("DELETE FROM users WHERE id = 1");
			const result = await db.query("SELECT * FROM users");
			expect(result.rows).toEqual([]);
		});
	});

	describe("transaction()", () => {
		test("commits on success", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

			const result = await db.transaction?.(async (tx) => {
				await tx.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
				await tx.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')");
				return { inserted: 2 };
			});

			expect(result).toEqual({ inserted: 2 });

			const rows = await db.query<{ id: number }>("SELECT id FROM users");
			expect(rows.rows).toHaveLength(2);
		});

		test("rolls back on error", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

			await expect(
				db.transaction?.(async (tx) => {
					await tx.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
					throw new Error("Intentional error");
				}),
			).rejects.toThrow("Intentional error");

			// Verify rollback - no rows inserted
			const rows = await db.query("SELECT * FROM users");
			expect(rows.rows).toEqual([]);
		});

		test("rolls back on constraint violation", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

			await expect(
				db.transaction?.(async (tx) => {
					await tx.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
					await tx.exec("INSERT INTO users (id, name) VALUES (1, 'Bob')"); // Duplicate PK
				}),
			).rejects.toThrow();

			// Verify rollback - no rows inserted
			const rows = await db.query("SELECT * FROM users");
			expect(rows.rows).toEqual([]);
		});
	});

	describe("vector storage", () => {
		test("stores and retrieves vectors using F32_BLOB", async () => {
			await db.exec(`
				CREATE TABLE embeddings (
					id TEXT PRIMARY KEY,
					content TEXT,
					embedding F32_BLOB(4)
				)
			`);

			const testVector = [0.1, 0.2, 0.3, 0.4];
			await db.query(
				"INSERT INTO embeddings (id, content, embedding) VALUES (?, ?, vector(?))",
				["test", "hello", JSON.stringify(testVector)],
			);

			// Verify insertion by selecting metadata (can't retrieve raw vector)
			const result = await db.query<{ id: string; content: string }>(
				"SELECT id, content FROM embeddings WHERE id = ?",
				["test"],
			);

			expect(result.rows).toHaveLength(1);
			expect(result.rows[0]).toEqual({ id: "test", content: "hello" });
		});

		test("performs cosine similarity search with vector_top_k", async () => {
			await db.exec(`
				CREATE TABLE memories (
					id TEXT PRIMARY KEY,
					content TEXT,
					embedding F32_BLOB(4)
				)
			`);

			// Create vector index for vector_top_k queries
			await db.exec(`
				CREATE INDEX idx_memories_embedding 
				ON memories(libsql_vector_idx(embedding))
			`);

			// Insert test vectors
			const memories = [
				{ id: "1", content: "auth tokens", vector: [1.0, 0.0, 0.0, 0.0] },
				{ id: "2", content: "type safety", vector: [0.0, 1.0, 0.0, 0.0] },
				{ id: "3", content: "auth security", vector: [0.9, 0.1, 0.0, 0.0] },
			];

			for (const memory of memories) {
				await db.query(
					"INSERT INTO memories (id, content, embedding) VALUES (?, ?, vector(?))",
					[memory.id, memory.content, JSON.stringify(memory.vector)],
				);
			}

			// Search for similar to "auth" using vector_top_k
			// vector_top_k returns a virtual table with just (id) where id is rowid
			// Results are already ordered by distance (nearest first)
			// To get distance, we calculate it separately with vector_distance_cos
			const queryVector = [1.0, 0.0, 0.0, 0.0];
			const results = await db.query<{
				id: string;
				content: string;
				distance: number;
			}>(
				`
					SELECT m.id, m.content, 
					       vector_distance_cos(m.embedding, vector(?)) as distance
					FROM vector_top_k('idx_memories_embedding', vector(?), 3) AS v
					JOIN memories m ON m.rowid = v.id
					LIMIT 2
				`,
				[JSON.stringify(queryVector), JSON.stringify(queryVector)],
			);

			expect(results.rows).toHaveLength(2);
			expect(results.rows[0]?.id).toBe("1"); // Exact match
			expect(results.rows[1]?.id).toBe("3"); // Similar
			expect(results.rows[0]?.distance).toBeLessThan(
				results.rows[1]?.distance ?? 0,
			);
		});
	});

	describe("close()", () => {
		test("closes connection", async () => {
			await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
			await db.close?.();
			// After close, operations should fail (implementation dependent)
		});
	});
});
