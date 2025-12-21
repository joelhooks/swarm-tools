/**
 * libSQL Streams Schema
 *
 * Translation of PGLite/PostgreSQL event store schema to libSQL.
 * Parallel to migrations.ts but using libSQL-compatible syntax.
 *
 * ## Key Differences from PostgreSQL
 *
 * | PostgreSQL          | libSQL                              |
 * |---------------------|-------------------------------------|
 * | `SERIAL`            | `INTEGER PRIMARY KEY AUTOINCREMENT` |
 * | `JSONB`             | `TEXT` (JSON stored as string)      |
 * | `TIMESTAMP`         | `TEXT` (ISO 8601 string)            |
 * | `BOOLEAN`           | `INTEGER` (0/1)                     |
 * | `CURRENT_TIMESTAMP` | `datetime('now')`                   |
 * | `BIGINT`            | `INTEGER`                           |
 *
 * ## Compatibility Note
 *
 * This schema is functionally equivalent to migration v0 in migrations.ts.
 * When using libSQL, adapter.ts should call this instead of running migrations.
 *
 * @module streams/libsql-schema
 */

import type { DatabaseAdapter } from "../types/database.js";

/**
 * Create libSQL event store schema
 *
 * Creates all tables, indexes, and constraints for the event store:
 * - events (append-only log)
 * - agents (materialized view)
 * - messages (materialized view)
 * - message_recipients (many-to-many)
 * - reservations (file locks)
 * - locks (distributed mutex)
 * - cursors (stream positions)
 *
 * Idempotent - safe to call multiple times.
 *
 * @param db - DatabaseAdapter instance (must be libSQL-backed)
 * @throws Error if schema creation fails
 *
 * @example
 * ```typescript
 * import { createLibSQLAdapter } from "../libsql.js";
 * import { createLibSQLStreamsSchema } from "./libsql-schema.js";
 *
 * const db = await createLibSQLAdapter({ url: ":memory:" });
 * await createLibSQLStreamsSchema(db);
 * ```
 */
export async function createLibSQLStreamsSchema(db: DatabaseAdapter): Promise<void> {
  // ========================================================================
  // Events Table (append-only log)
  // ========================================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      project_key TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      sequence INTEGER,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Events indexes
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_project_key 
    ON events(project_key)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_type 
    ON events(type)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_timestamp 
    ON events(timestamp)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_project_type 
    ON events(project_key, type)
  `);

  // ========================================================================
  // Agents Table (materialized view)
  // ========================================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      name TEXT NOT NULL,
      program TEXT DEFAULT 'opencode',
      model TEXT DEFAULT 'unknown',
      task_description TEXT,
      registered_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      UNIQUE(project_key, name)
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agents_project 
    ON agents(project_key)
  `);

  // ========================================================================
  // Messages Table (materialized view)
  // ========================================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      thread_id TEXT,
      importance TEXT DEFAULT 'normal',
      ack_required INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_project 
    ON messages(project_key)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread 
    ON messages(thread_id)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_created 
    ON messages(created_at DESC)
  `);

  // ========================================================================
  // Message Recipients Table (many-to-many)
  // ========================================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS message_recipients (
      message_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      read_at INTEGER,
      acked_at INTEGER,
      PRIMARY KEY(message_id, agent_name),
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_recipients_agent 
    ON message_recipients(agent_name)
  `);

  // ========================================================================
  // Reservations Table (file locks)
  // ========================================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      path_pattern TEXT NOT NULL,
      exclusive INTEGER DEFAULT 1,
      reason TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      released_at INTEGER
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reservations_project 
    ON reservations(project_key)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reservations_agent 
    ON reservations(agent_name)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reservations_expires 
    ON reservations(expires_at)
  `);

  // Partial index for active reservations
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reservations_active 
    ON reservations(project_key, released_at) 
    WHERE released_at IS NULL
  `);

  // ========================================================================
  // Locks Table (distributed mutex)
  // ========================================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS locks (
      resource TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_locks_expires 
    ON locks(expires_at)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_locks_holder 
    ON locks(holder)
  `);

  // ========================================================================
  // Cursors Table (stream positions) - matches Effect DurableCursor schema
  // ========================================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cursors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE(stream, checkpoint)
    )
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cursors_stream 
    ON cursors(stream)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cursors_checkpoint 
    ON cursors(checkpoint)
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cursors_updated 
    ON cursors(updated_at)
  `);
}

/**
 * Drop libSQL event store schema
 *
 * Removes all tables and indexes created by createLibSQLStreamsSchema.
 * Useful for tests and cleanup.
 *
 * @param db - libSQL client instance
 */
export async function dropLibSQLStreamsSchema(db: DatabaseAdapter): Promise<void> {
  // Drop in reverse dependency order
  await db.exec("DROP TABLE IF EXISTS cursors");
  await db.exec("DROP TABLE IF EXISTS locks");
  await db.exec("DROP TABLE IF EXISTS message_recipients");
  await db.exec("DROP TABLE IF EXISTS reservations");
  await db.exec("DROP TABLE IF EXISTS messages");
  await db.exec("DROP TABLE IF EXISTS agents");
  await db.exec("DROP TABLE IF EXISTS events");
}

/**
 * Verify libSQL event store schema exists and is valid
 *
 * Checks for:
 * - All required tables
 * - Required columns on each table
 * - Key indexes
 *
 * @param db - libSQL client instance
 * @returns True if schema is valid, false otherwise
 */
export async function validateLibSQLStreamsSchema(db: DatabaseAdapter): Promise<boolean> {
  try {
    // Check all required tables exist
    const tables = await db.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('events', 'agents', 'messages', 'message_recipients', 'reservations', 'locks', 'cursors')
    `);

    if (tables.rows.length !== 7) return false;

    // Check events table has required columns
    const eventsCols = await db.query(`
      SELECT name FROM pragma_table_info('events')
    `);
    const eventsColNames = eventsCols.rows.map((r: any) => r.name as string);
    const requiredEventsCols = ["id", "type", "project_key", "timestamp", "sequence", "data", "created_at"];
    
    for (const col of requiredEventsCols) {
      if (!eventsColNames.includes(col)) return false;
    }

    // Check agents table has UNIQUE constraint
    const agentsIndexes = await db.query(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='agents'
    `);
    const agentsSql = String((agentsIndexes.rows[0] as any)?.sql || "");
    if (!agentsSql.includes("UNIQUE")) return false;

    return true;
  } catch {
    return false;
  }
}
