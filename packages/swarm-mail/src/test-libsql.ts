/**
 * LibSQL Test Database Helper
 *
 * Replaces test-server.ts for libSQL-based tests.
 * Creates in-memory libSQL databases with full schema.
 *
 * ## Performance Impact
 * - libSQL in-memory initialization is faster than PGlite WASM (~10ms vs ~500ms)
 * - Each test gets a fresh database (no shared state concerns)
 * - No TRUNCATE needed between tests (create new instance instead)
 *
 * ## Usage
 * ```typescript
 * import { createTestLibSQLDb } from './test-libsql';
 *
 * test("my test", async () => {
 *   const { client, db } = await createTestLibSQLDb();
 *   // Use client for raw SQL, db for Drizzle queries
 *   await db.query.agents.findMany();
 * });
 * ```
 *
 * ## Schema Coverage
 * - All streams tables (events, agents, messages, reservations, locks)
 * - All hive tables (beads, dependencies, labels, comments)
 * - All durable primitive tables (cursors, deferred)
 * - All memory tables (memories with vector support, FTS5)
 * - Learning system tables (eval_records, swarm_contexts)
 *
 * ## Key Differences from PGlite
 * - SERIAL → INTEGER PRIMARY KEY AUTOINCREMENT
 * - JSONB → TEXT (store JSON.stringify)
 * - TIMESTAMPTZ → TEXT (ISO 8601)
 * - BOOLEAN → INTEGER (0/1)
 * - $1, $2 params → ? params
 * - vector(N) → F32_BLOB(N)
 * - TEXT[] → TEXT (JSON array as string)
 */

import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import type { SwarmDb } from "./db/client.js";
import { createDrizzleClient } from "./db/drizzle.js";
import type { DatabaseAdapter, QueryResult } from "./types/database.js";
import { convertPlaceholders } from "./libsql.js";

/** Embedding dimension for mxbai-embed-large */
const EMBEDDING_DIM = 1024;

/**
 * Test DatabaseAdapter that wraps a libSQL client with automatic $N → ? conversion.
 *
 * Hive source files use PostgreSQL $1, $2 param syntax. This adapter transparently
 * converts them to libSQL's ? placeholders so tests can use the original SQL.
 *
 * @example
 * ```typescript
 * const adapter = createTestDatabaseAdapter(client);
 * // Works with PostgreSQL syntax
 * await adapter.query("SELECT * FROM beads WHERE id = $1", ["bd-123"]);
 * ```
 */
class TestDatabaseAdapter implements DatabaseAdapter {
	constructor(private client: Client) {}

	async query<T = unknown>(
		sql: string,
		params?: unknown[],
	): Promise<QueryResult<T>> {
		const converted = convertPlaceholders(sql, params);
		const result = await this.client.execute({
			sql: converted.sql,
			args: converted.params as any,
		});
		return { rows: result.rows as T[] };
	}

	async exec(sql: string): Promise<void> {
		const converted = convertPlaceholders(sql);
		await this.client.execute(converted.sql);
	}

	async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
		// For tests, we just execute inline without proper transaction isolation
		// This matches the behavior of the test-server.ts implementation
		return await fn(this);
	}

	async close(): Promise<void> {
		this.client.close();
	}

	/**
	 * Get the underlying libSQL client for Drizzle ORM
	 */
	getClient(): Client {
		return this.client;
	}
}

/**
 * Create a test DatabaseAdapter with automatic $N → ? conversion.
 *
 * Wraps a libSQL client to transparently convert PostgreSQL-style parameters
 * to libSQL-style parameters. Use this in tests that need to run hive SQL
 * queries without manual conversion.
 *
 * @param client - libSQL client instance
 * @returns DatabaseAdapter with automatic conversion
 */
export function createTestDatabaseAdapter(client: Client): DatabaseAdapter {
	return new TestDatabaseAdapter(client);
}

/**
 * Create a test libSQL database with full schema.
 *
 * Returns the raw libSQL client, Drizzle-wrapped db instance, and a DatabaseAdapter
 * with automatic $N → ? parameter conversion for hive tests.
 * Schema includes all tables from streams, hive, memory, and learning systems.
 *
 * @returns Object containing client, db, and adapter instances
 *
 * @example
 * ```typescript
 * const { client, db, adapter } = await createTestLibSQLDb();
 * // Use adapter for PostgreSQL-style queries
 * await adapter.query("SELECT * FROM beads WHERE id = $1", ["bd-123"]);
 * // Use db for Drizzle queries
 * await db.query.agents.findMany();
 * ```
 */
export async function createTestLibSQLDb(): Promise<{
  client: Client;
  db: SwarmDb;
  adapter: DatabaseAdapter;
}> {
  const client = createClient({ url: ":memory:" });

  // ========================================================================
  // Core Event Store Tables (streams)
  // ========================================================================

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
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_key)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)
  `);
  
  // Trigger to auto-populate sequence with id value when not provided
  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS events_sequence_trigger
    AFTER INSERT ON events
    WHEN NEW.sequence IS NULL
    BEGIN
      UPDATE events SET sequence = NEW.id WHERE id = NEW.id;
    END
  `);

  // ========================================================================
  // Agents Table
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      name TEXT NOT NULL,
      program TEXT,
      model TEXT,
      task_description TEXT,
      registered_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      UNIQUE(project_key, name)
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_key)
  `);

  // ========================================================================
  // Messages Table
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT,
      thread_id TEXT,
      importance TEXT NOT NULL DEFAULT 'normal',
      ack_required INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_key)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_agent)
  `);

  // ========================================================================
  // Message Recipients
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS message_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      read_at INTEGER,
      acked_at INTEGER,
      UNIQUE(message_id, agent_name),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_message_recipients_agent ON message_recipients(agent_name)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_message_recipients_message ON message_recipients(message_id)
  `);

  // ========================================================================
  // Reservations Table
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      path_pattern TEXT NOT NULL,
      exclusive INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      released_at INTEGER
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_reservations_project ON reservations(project_key)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_reservations_agent ON reservations(agent_name)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_reservations_expires ON reservations(expires_at)
  `);

  // ========================================================================
  // Locks Table
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS locks (
      resource TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_locks_holder ON locks(holder)
  `);

  // ========================================================================
  // Cursors Table (DurableCursor)
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS cursors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE(stream, checkpoint)
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_cursors_checkpoint ON cursors(checkpoint)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_cursors_stream ON cursors(stream)
  `);

  // ========================================================================
  // Deferred Table (DurableDeferred)
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS deferred (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      resolved INTEGER NOT NULL DEFAULT 0,
      value TEXT,
      error TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_deferred_url ON deferred(url)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_deferred_expires ON deferred(expires_at)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_deferred_resolved ON deferred(resolved)
  `);

  // ========================================================================
  // Beads/Hive Tables
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS beads (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'task', 'epic', 'chore', 'message')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'closed', 'tombstone')),
      title TEXT NOT NULL,
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
      parent_id TEXT,
      assignee TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      closed_reason TEXT,
      deleted_at INTEGER,
      deleted_by TEXT,
      delete_reason TEXT,
      created_by TEXT,
      CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
      FOREIGN KEY (parent_id) REFERENCES beads(id) ON DELETE SET NULL
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_beads_project ON beads(project_key)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_beads_status ON beads(status)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_beads_type ON beads(type)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_beads_priority ON beads(priority)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_beads_parent ON beads(parent_id)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_beads_project_status ON beads(project_key, status)
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS bead_dependencies (
      cell_id TEXT NOT NULL,
      depends_on_id TEXT NOT NULL,
      relationship TEXT NOT NULL CHECK (relationship IN ('blocks', 'related', 'parent-child', 'discovered-from', 'replies-to', 'relates-to', 'duplicates', 'supersedes')),
      created_at INTEGER NOT NULL,
      created_by TEXT,
      PRIMARY KEY (cell_id, depends_on_id, relationship),
      FOREIGN KEY (cell_id) REFERENCES beads(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_id) REFERENCES beads(id) ON DELETE CASCADE
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_bead_deps_bead ON bead_dependencies(cell_id)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_bead_deps_depends_on ON bead_dependencies(depends_on_id)
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS bead_labels (
      cell_id TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (cell_id, label),
      FOREIGN KEY (cell_id) REFERENCES beads(id) ON DELETE CASCADE
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_bead_labels_label ON bead_labels(label)
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS bead_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cell_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      parent_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      FOREIGN KEY (cell_id) REFERENCES beads(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES bead_comments(id) ON DELETE CASCADE
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_bead_comments_bead ON bead_comments(cell_id)
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS blocked_beads_cache (
      cell_id TEXT PRIMARY KEY,
      blocker_ids TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (cell_id) REFERENCES beads(id) ON DELETE CASCADE
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS dirty_beads (
      cell_id TEXT PRIMARY KEY,
      marked_at INTEGER NOT NULL,
      FOREIGN KEY (cell_id) REFERENCES beads(id) ON DELETE CASCADE
    )
  `);

  // ========================================================================
  // Cells View (beads → cells compatibility layer)
  // ========================================================================

  await client.execute(`
    CREATE VIEW IF NOT EXISTS cells AS SELECT * FROM beads
  `);

  await client.execute(`
    DROP TRIGGER IF EXISTS cells_insert
  `);

  await client.execute(`
    CREATE TRIGGER cells_insert
      INSTEAD OF INSERT ON cells
      FOR EACH ROW
    BEGIN
      INSERT INTO beads VALUES (
        NEW.id, NEW.project_key, NEW.type, NEW.status, NEW.title,
        NEW.description, NEW.priority, NEW.parent_id, NEW.assignee,
        NEW.created_at, NEW.updated_at, NEW.closed_at, NEW.closed_reason,
        NEW.deleted_at, NEW.deleted_by, NEW.delete_reason, NEW.created_by
      );
    END
  `);

  await client.execute(`
    DROP TRIGGER IF EXISTS cells_update
  `);

  await client.execute(`
    CREATE TRIGGER cells_update
      INSTEAD OF UPDATE ON cells
      FOR EACH ROW
    BEGIN
      UPDATE beads
      SET
        type = NEW.type,
        status = NEW.status,
        title = NEW.title,
        description = NEW.description,
        priority = NEW.priority,
        parent_id = NEW.parent_id,
        assignee = NEW.assignee,
        updated_at = NEW.updated_at,
        closed_at = NEW.closed_at,
        closed_reason = NEW.closed_reason,
        deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by,
        delete_reason = NEW.delete_reason
      WHERE id = OLD.id AND project_key = OLD.project_key;
    END
  `);

  await client.execute(`
    DROP TRIGGER IF EXISTS cells_delete
  `);

  await client.execute(`
    CREATE TRIGGER cells_delete
      INSTEAD OF DELETE ON cells
      FOR EACH ROW
    BEGIN
      DELETE FROM beads WHERE id = OLD.id AND project_key = OLD.project_key;
    END
  `);

  // ========================================================================
  // Learning System Tables
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS eval_records (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      task TEXT NOT NULL,
      context TEXT,
      strategy TEXT NOT NULL,
      epic_title TEXT NOT NULL,
      subtasks TEXT NOT NULL,
      outcomes TEXT,
      overall_success INTEGER,
      total_duration_ms INTEGER,
      total_errors INTEGER,
      human_accepted INTEGER,
      human_modified INTEGER,
      human_notes TEXT,
      file_overlap_count INTEGER,
      scope_accuracy REAL,
      time_balance_ratio REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_eval_records_project ON eval_records(project_key)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_eval_records_strategy ON eval_records(strategy)
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS swarm_contexts (
      id TEXT,
      epic_id TEXT NOT NULL,
      bead_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      files TEXT NOT NULL,
      dependencies TEXT NOT NULL,
      directives TEXT NOT NULL,
      recovery TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      project_key TEXT,
      checkpointed_at INTEGER,
      recovered_at INTEGER,
      recovered_from_checkpoint INTEGER
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_swarm_contexts_project ON swarm_contexts(project_key)
  `);
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_swarm_contexts_unique ON swarm_contexts(project_key, epic_id, bead_id)
  `);

  // ========================================================================
  // Memory Tables (with vector support)
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      collection TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      confidence REAL DEFAULT 0.7,
      embedding F32_BLOB(${EMBEDDING_DIM})
    )
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_memories_collection ON memories(collection)
  `);

  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories(libsql_vector_idx(embedding))
  `);

  // FTS5 virtual table for full-text search
  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts 
    USING fts5(id UNINDEXED, content, content=memories, content_rowid=rowid)
  `);

  // Triggers to keep FTS5 in sync
  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert 
    AFTER INSERT ON memories 
    BEGIN
      INSERT INTO memories_fts(rowid, id, content) 
      VALUES (new.rowid, new.id, new.content);
    END
  `);

  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_update 
    AFTER UPDATE ON memories 
    BEGIN
      UPDATE memories_fts 
      SET content = new.content 
      WHERE rowid = new.rowid;
    END
  `);

  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_delete 
    AFTER DELETE ON memories 
    BEGIN
      DELETE FROM memories_fts WHERE rowid = old.rowid;
    END
  `);

  // ========================================================================
  // Schema Version Table
  // ========================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      description TEXT
    )
  `);

  // Wrap client with Drizzle
  const db = createDrizzleClient(client);

  // Create adapter with automatic $N → ? conversion for hive tests
  const adapter = createTestDatabaseAdapter(client);

  return { client, db, adapter };
}
