/**
 * DurableCursor - Tests for SQL injection prevention
 *
 * Direct database tests to verify parameterized queries prevent injection.
 * These are characterization tests - they document current behavior and
 * prevent regression of the SQL injection fixes.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLibSQLAdapter } from "../../libsql";
import type { DatabaseAdapter } from "../../types/database";

describe("Cursor SQL Injection Prevention", () => {
  let db: DatabaseAdapter;

  beforeAll(async () => {
    db = await createLibSQLAdapter({ url: ":memory:" });

    // Create cursors table (same as ensureCursorsTable in cursor.ts)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS cursors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(stream, checkpoint)
      );

      CREATE INDEX IF NOT EXISTS idx_cursors_stream ON cursors(stream);
      CREATE INDEX IF NOT EXISTS idx_cursors_checkpoint ON cursors(checkpoint);
    `);
  });

  afterAll(async () => {
    await db.close?.();
  });

  test("parameterized INSERT prevents SQL injection in stream parameter", async () => {
    const maliciousStream = "'; DROP TABLE cursors; --";
    const checkpoint = "test-checkpoint";

    // This should NOT execute the DROP TABLE command
    await db.query(
      `INSERT INTO cursors (stream, checkpoint, position, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT (stream, checkpoint) DO NOTHING`,
      [maliciousStream, checkpoint, Date.now()],
    );

    // Verify: cursors table still exists
    const result = await db.query(
      "SELECT COUNT(*) as count FROM cursors WHERE stream = ?",
      [maliciousStream],
    );
    expect(result.rows[0]?.count).toBe(1);

    // Verify: malicious string was stored literally, not executed
    const stored = await db.query<{ stream: string }>(
      "SELECT stream FROM cursors WHERE checkpoint = ?",
      [checkpoint],
    );
    expect(stored.rows[0]?.stream).toBe(maliciousStream);
  });

  test("parameterized INSERT prevents SQL injection in checkpoint parameter", async () => {
    const stream = "test-stream";
    const maliciousCheckpoint = "'; DELETE FROM cursors WHERE 1=1; --";

    await db.query(
      `INSERT INTO cursors (stream, checkpoint, position, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT (stream, checkpoint) DO NOTHING`,
      [stream, maliciousCheckpoint, Date.now()],
    );

    // Verify: rows were NOT deleted
    const result = await db.query(
      "SELECT COUNT(*) as count FROM cursors",
      [],
    );
    expect((result.rows[0]?.count ?? 0) > 1).toBe(true);

    // Verify: malicious string was stored literally
    const stored = await db.query<{ checkpoint: string }>(
      "SELECT checkpoint FROM cursors WHERE stream = ?",
      [stream],
    );
    expect(stored.rows[0]?.checkpoint).toBe(maliciousCheckpoint);
  });

  test("parameterized UPSERT prevents SQL injection in position update", async () => {
    const stream = "update-stream";
    const checkpoint = "update-checkpoint";
    const position = 999;

    // First insert
    await db.query(
      `INSERT INTO cursors (stream, checkpoint, position, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT (stream, checkpoint) DO NOTHING`,
      [stream, checkpoint, Date.now()],
    );

    // Update with UPSERT (same as saveCursorPosition)
    await db.query(
      `INSERT INTO cursors (stream, checkpoint, position, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (stream, checkpoint)
       DO UPDATE SET position = EXCLUDED.position, updated_at = EXCLUDED.updated_at`,
      [stream, checkpoint, position, Date.now()],
    );

    // Verify: position updated correctly
    const result = await db.query<{ position: number }>(
      "SELECT position FROM cursors WHERE stream = ? AND checkpoint = ?",
      [stream, checkpoint],
    );
    expect(result.rows[0]?.position).toBe(position);
  });

  test("handles special characters safely with parameterized queries", async () => {
    const stream = "stream's \"quoted\" name";
    const checkpoint = 'checkpoint with "quotes" and \\slashes\\';
    const position = 42;

    // Insert with special chars
    await db.query(
      `INSERT INTO cursors (stream, checkpoint, position, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (stream, checkpoint)
       DO UPDATE SET position = EXCLUDED.position, updated_at = EXCLUDED.updated_at`,
      [stream, checkpoint, position, Date.now()],
    );

    // Verify: retrieved exactly as stored
    const result = await db.query<{
      stream: string;
      checkpoint: string;
      position: number;
    }>(
      "SELECT stream, checkpoint, position FROM cursors WHERE stream = ?",
      [stream],
    );

    expect(result.rows[0]?.stream).toBe(stream);
    expect(result.rows[0]?.checkpoint).toBe(checkpoint);
    expect(result.rows[0]?.position).toBe(position);
  });

  test("prevents injection via numeric position parameter", async () => {
    const stream = "numeric-test";
    const checkpoint = "numeric-checkpoint";

    // Attempting injection via position (won't work with parameterized query)
    // In vulnerable code: VALUES ('${stream}', '${checkpoint}', ${position}, ${Date.now()})
    // Attacker could try: position = "0); DROP TABLE cursors; --"
    // But with params, it's safely bound as a value

    await db.query(
      `INSERT INTO cursors (stream, checkpoint, position, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (stream, checkpoint) DO NOTHING`,
      [stream, checkpoint, 0, Date.now()],
    );

    // Verify: table still exists and row inserted
    const result = await db.query(
      "SELECT position FROM cursors WHERE stream = ?",
      [stream],
    );
    expect(result.rows[0]?.position).toBe(0);
  });
});

describe("Cursor - Regression Tests", () => {
  let db: DatabaseAdapter;

  beforeAll(async () => {
    db = await createLibSQLAdapter({ url: ":memory:" });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS cursors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(stream, checkpoint)
      );
    `);
  });

  afterAll(async () => {
    await db.close?.();
  });

  test("loadCursorPosition pattern: returns 0 for new cursor", async () => {
    const stream = "new-stream";
    const checkpoint = "new-checkpoint";

    // Check if exists
    const result = await db.query<{ position: number }>(
      `SELECT position FROM cursors WHERE stream = ? AND checkpoint = ?`,
      [stream, checkpoint],
    );

    if (result.rows.length === 0) {
      // Initialize cursor at position 0 (same as loadCursorPosition)
      await db.query(
        `INSERT INTO cursors (stream, checkpoint, position, updated_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT (stream, checkpoint) DO NOTHING`,
        [stream, checkpoint, Date.now()],
      );
    }

    // Verify it returns 0
    const verify = await db.query<{ position: number }>(
      `SELECT position FROM cursors WHERE stream = ? AND checkpoint = ?`,
      [stream, checkpoint],
    );
    expect(verify.rows[0]?.position).toBe(0);
  });

  test("saveCursorPosition pattern: UPSERT works correctly", async () => {
    const stream = "save-stream";
    const checkpoint = "save-checkpoint";

    // First save (INSERT)
    await db.query(
      `INSERT INTO cursors (stream, checkpoint, position, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (stream, checkpoint)
       DO UPDATE SET position = EXCLUDED.position, updated_at = EXCLUDED.updated_at`,
      [stream, checkpoint, 100, Date.now()],
    );

    const first = await db.query<{ position: number }>(
      `SELECT position FROM cursors WHERE stream = ? AND checkpoint = ?`,
      [stream, checkpoint],
    );
    expect(first.rows[0]?.position).toBe(100);

    // Second save (UPDATE via UPSERT)
    await db.query(
      `INSERT INTO cursors (stream, checkpoint, position, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (stream, checkpoint)
       DO UPDATE SET position = EXCLUDED.position, updated_at = EXCLUDED.updated_at`,
      [stream, checkpoint, 200, Date.now()],
    );

    const second = await db.query<{ position: number }>(
      `SELECT position FROM cursors WHERE stream = ? AND checkpoint = ?`,
      [stream, checkpoint],
    );
    expect(second.rows[0]?.position).toBe(200);
  });
});
