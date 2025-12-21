/**
 * PGlite → libSQL Migration Tool
 *
 * Migrates all data from PGlite (streams/) to libSQL (streams.db):
 * - memories + embeddings
 * - beads (cells)
 * - messages
 * - agents
 * - reservations
 * - events
 *
 * ## Usage
 *
 * ```typescript
 * import { migratePGliteToLibSQL } from 'swarm-mail';
 *
 * const result = await migratePGliteToLibSQL({
 *   pglitePath: '/path/to/streams',
 *   libsqlPath: '/path/to/streams.db',
 *   dryRun: false,
 * });
 * ```
 *
 * @module migrate-pglite-to-libsql
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { createLibSQLMemorySchema } from "./memory/libsql-schema.js";

export interface MigrationOptions {
  /** Path to PGlite data directory (contains PG_VERSION) */
  pglitePath: string;
  /** Path to libSQL database file */
  libsqlPath: string;
  /** If true, only report what would be migrated */
  dryRun?: boolean;
  /** Callback for progress updates */
  onProgress?: (message: string) => void;
}

export interface MigrationResult {
  memories: { migrated: number; skipped: number; failed: number };
  beads: { migrated: number; skipped: number; failed: number };
  messages: { migrated: number; skipped: number; failed: number };
  agents: { migrated: number; skipped: number; failed: number };
  events: { migrated: number; skipped: number; failed: number };
  errors: string[];
  dryRun: boolean;
}

/**
 * Check if PGlite database exists at path
 */
export function pgliteExists(path: string): boolean {
  const pgVersionPath = join(path, "PG_VERSION");
  return existsSync(pgVersionPath);
}

/**
 * Migrate all data from PGlite to libSQL
 */
export async function migratePGliteToLibSQL(
  options: MigrationOptions
): Promise<MigrationResult> {
  const {
    pglitePath,
    libsqlPath,
    dryRun = false,
    onProgress = console.log,
  } = options;

  const result: MigrationResult = {
    memories: { migrated: 0, skipped: 0, failed: 0 },
    beads: { migrated: 0, skipped: 0, failed: 0 },
    messages: { migrated: 0, skipped: 0, failed: 0 },
    agents: { migrated: 0, skipped: 0, failed: 0 },
    events: { migrated: 0, skipped: 0, failed: 0 },
    errors: [],
    dryRun,
  };

  // Check PGlite exists
  if (!pgliteExists(pglitePath)) {
    onProgress(`[migrate] No PGlite database found at ${pglitePath}`);
    return result;
  }

  onProgress(`[migrate] Opening PGlite database at ${pglitePath}`);

  // Import PGlite dynamically
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");

  let pglite: any;
  let libsql: Client;

  try {
    pglite = await PGlite.create({
      dataDir: pglitePath,
      extensions: { vector },
    });

    libsql = createClient({ url: `file:${libsqlPath}` });

    // Ensure libSQL schema exists
    onProgress(`[migrate] Ensuring libSQL schema exists...`);
    await ensureLibSQLSchema(libsql, onProgress);

    // Migrate each table
    await migrateMemories(pglite, libsql, result, dryRun, onProgress);
    await migrateBeads(pglite, libsql, result, dryRun, onProgress);
    await migrateMessages(pglite, libsql, result, dryRun, onProgress);
    await migrateAgents(pglite, libsql, result, dryRun, onProgress);
    await migrateEvents(pglite, libsql, result, dryRun, onProgress);

    onProgress(`\n[migrate] Migration complete!`);
    onProgress(`  Memories: ${result.memories.migrated} migrated, ${result.memories.skipped} skipped, ${result.memories.failed} failed`);
    onProgress(`  Beads: ${result.beads.migrated} migrated, ${result.beads.skipped} skipped, ${result.beads.failed} failed`);
    onProgress(`  Messages: ${result.messages.migrated} migrated, ${result.messages.skipped} skipped, ${result.messages.failed} failed`);
    onProgress(`  Agents: ${result.agents.migrated} migrated, ${result.agents.skipped} skipped, ${result.agents.failed} failed`);
    onProgress(`  Events: ${result.events.migrated} migrated, ${result.events.skipped} skipped, ${result.events.failed} failed`);

    if (result.errors.length > 0) {
      onProgress(`\n  Errors (${result.errors.length}):`);
      for (const err of result.errors.slice(0, 10)) {
        onProgress(`    - ${err}`);
      }
      if (result.errors.length > 10) {
        onProgress(`    ... and ${result.errors.length - 10} more`);
      }
    }

  } finally {
    if (pglite) await pglite.close();
  }

  return result;
}

async function migrateMemories(
  pglite: any,
  libsql: Client,
  result: MigrationResult,
  dryRun: boolean,
  onProgress: (msg: string) => void
) {
  onProgress(`[migrate] Checking memories table...`);

  // Check if table exists
  const tableCheck = await pglite.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'memories'
    ) as exists
  `);

  if (!tableCheck.rows[0]?.exists) {
    onProgress(`[migrate] No memories table found`);
    return;
  }

  // Get memories - PGlite schema: id, content, metadata (jsonb), collection, created_at
  const memories = await pglite.query(`
    SELECT id, content, metadata, collection, created_at
    FROM memories
  `);

  onProgress(`[migrate] Found ${memories.rows.length} memories`);

  // Get embeddings - PGlite has separate memory_embeddings table
  const embeddings = await pglite.query(`
    SELECT memory_id, embedding::text as embedding
    FROM memory_embeddings
  `);

  const embeddingMap = new Map<string, string>();
  for (const row of embeddings.rows) {
    embeddingMap.set(row.memory_id, row.embedding);
  }

  onProgress(`[migrate] Found ${embeddingMap.size} embeddings`);

  for (const row of memories.rows) {
    try {
      // Check if exists in libSQL
      const existing = await libsql.execute({
        sql: "SELECT id FROM memories WHERE id = ?",
        args: [row.id],
      });

      if (existing.rows.length > 0) {
        result.memories.skipped++;
        continue;
      }

      if (dryRun) {
        const preview = row.content.slice(0, 50).replace(/\n/g, " ");
        onProgress(`[migrate] Would migrate memory: ${row.id} - "${preview}..."`);
        result.memories.migrated++;
        continue;
      }

      // Get embedding
      const embeddingStr = embeddingMap.get(row.id);
      const embedding = embeddingStr ? parseVector(embeddingStr) : null;

      // Convert metadata - PGlite stores as JSONB object, libSQL needs TEXT
      const metadata = typeof row.metadata === "object" 
        ? JSON.stringify(row.metadata) 
        : row.metadata || "{}";

      // Convert timestamp - PGlite uses timestamptz, libSQL uses TEXT
      const createdAt = row.created_at instanceof Date 
        ? row.created_at.toISOString() 
        : row.created_at;

      // Insert with or without embedding
      if (embedding) {
        await libsql.execute({
          sql: `INSERT INTO memories (id, content, metadata, collection, created_at, decay_factor, embedding)
                VALUES (?, ?, ?, ?, ?, ?, vector(?))`,
          args: [
            row.id,
            row.content,
            metadata,
            row.collection || "default",
            createdAt,
            1.0, // default decay_factor
            JSON.stringify(embedding),
          ],
        });
      } else {
        await libsql.execute({
          sql: `INSERT INTO memories (id, content, metadata, collection, created_at, decay_factor)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            row.id,
            row.content,
            metadata,
            row.collection || "default",
            createdAt,
            1.0,
          ],
        });
      }

      result.memories.migrated++;
    } catch (err) {
      result.memories.failed++;
      result.errors.push(`Memory ${row.id}: ${(err as Error).message}`);
    }
  }
}

async function migrateBeads(
  pglite: any,
  libsql: Client,
  result: MigrationResult,
  dryRun: boolean,
  onProgress: (msg: string) => void
) {
  onProgress(`[migrate] Checking beads table...`);

  const tableCheck = await pglite.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'beads'
    ) as exists
  `);

  if (!tableCheck.rows[0]?.exists) {
    onProgress(`[migrate] No beads table found`);
    return;
  }

  // PGlite beads schema: id, project_key, type, status, title, description, priority, 
  // parent_id, assignee, created_at (bigint), updated_at (bigint), closed_at (bigint),
  // closed_reason, deleted_at, deleted_by, delete_reason, created_by
  const beads = await pglite.query(`
    SELECT id, project_key, type, status, title, description, priority, 
           parent_id, assignee, created_at, updated_at, closed_at, closed_reason
    FROM beads
    WHERE deleted_at IS NULL
    ORDER BY parent_id NULLS FIRST, created_at ASC
  `);
  onProgress(`[migrate] Found ${beads.rows.length} beads`);

  for (const row of beads.rows) {
    try {
      const existing = await libsql.execute({
        sql: "SELECT id FROM beads WHERE id = ?",
        args: [row.id],
      });

      if (existing.rows.length > 0) {
        result.beads.skipped++;
        continue;
      }

      if (dryRun) {
        onProgress(`[migrate] Would migrate bead: ${row.id} - ${row.title}`);
        result.beads.migrated++;
        continue;
      }

      // Keep timestamps as integers (bigint) - schema expects INTEGER
      const createdAt = row.created_at ? Number(row.created_at) : Date.now();
      const updatedAt = row.updated_at ? Number(row.updated_at) : createdAt;
      const closedAt = row.closed_at ? Number(row.closed_at) : null;

      await libsql.execute({
        sql: `INSERT INTO beads (id, project_key, type, status, title, description, priority, parent_id, assignee, created_at, updated_at, closed_at, closed_reason)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          row.project_key || "default",
          row.type || "task",
          row.status,
          row.title,
          row.description || "",
          row.priority ?? 2,
          row.parent_id,
          row.assignee,
          createdAt,
          updatedAt,
          closedAt,
          row.closed_reason,
        ],
      });

      result.beads.migrated++;
    } catch (err) {
      result.beads.failed++;
      result.errors.push(`Bead ${row.id}: ${(err as Error).message}`);
    }
  }
}

async function migrateMessages(
  pglite: any,
  libsql: Client,
  result: MigrationResult,
  dryRun: boolean,
  onProgress: (msg: string) => void
) {
  onProgress(`[migrate] Checking messages table...`);

  const tableCheck = await pglite.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'messages'
    ) as exists
  `);

  if (!tableCheck.rows[0]?.exists) {
    onProgress(`[migrate] No messages table found`);
    return;
  }

  const messages = await pglite.query(`SELECT * FROM messages`);
  onProgress(`[migrate] Found ${messages.rows.length} messages`);

  for (const row of messages.rows) {
    try {
      const existing = await libsql.execute({
        sql: "SELECT id FROM messages WHERE id = ?",
        args: [row.id],
      });

      if (existing.rows.length > 0) {
        result.messages.skipped++;
        continue;
      }

      if (dryRun) {
        onProgress(`[migrate] Would migrate message: ${row.id}`);
        result.messages.migrated++;
        continue;
      }

      await libsql.execute({
        sql: `INSERT INTO messages (id, from_agent, subject, body, thread_id, importance, ack_required, created_at, read_at, acked_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          row.from_agent,
          row.subject,
          row.body,
          row.thread_id,
          row.importance,
          row.ack_required ? 1 : 0,
          row.created_at,
          row.read_at,
          row.acked_at,
        ],
      });

      result.messages.migrated++;
    } catch (err) {
      result.messages.failed++;
      result.errors.push(`Message ${row.id}: ${(err as Error).message}`);
    }
  }
}

async function migrateAgents(
  pglite: any,
  libsql: Client,
  result: MigrationResult,
  dryRun: boolean,
  onProgress: (msg: string) => void
) {
  onProgress(`[migrate] Checking agents table...`);

  const tableCheck = await pglite.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'agents'
    ) as exists
  `);

  if (!tableCheck.rows[0]?.exists) {
    onProgress(`[migrate] No agents table found`);
    return;
  }

  const agents = await pglite.query(`SELECT * FROM agents`);
  onProgress(`[migrate] Found ${agents.rows.length} agents`);

  for (const row of agents.rows) {
    try {
      const existing = await libsql.execute({
        sql: "SELECT id FROM agents WHERE id = ?",
        args: [row.id],
      });

      if (existing.rows.length > 0) {
        result.agents.skipped++;
        continue;
      }

      if (dryRun) {
        onProgress(`[migrate] Would migrate agent: ${row.name}`);
        result.agents.migrated++;
        continue;
      }

      await libsql.execute({
        sql: `INSERT INTO agents (id, name, project_key, status, registered_at, last_seen_at, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          row.name,
          row.project_key,
          row.status,
          row.registered_at,
          row.last_seen_at,
          typeof row.metadata === "string" ? row.metadata : JSON.stringify(row.metadata || {}),
        ],
      });

      result.agents.migrated++;
    } catch (err) {
      result.agents.failed++;
      result.errors.push(`Agent ${row.id}: ${(err as Error).message}`);
    }
  }
}

async function migrateEvents(
  pglite: any,
  libsql: Client,
  result: MigrationResult,
  dryRun: boolean,
  onProgress: (msg: string) => void
) {
  onProgress(`[migrate] Checking events table...`);

  // Check if PGlite has events table
  const tableCheck = await pglite.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'events'
    ) as exists
  `);

  if (!tableCheck.rows[0]?.exists) {
    onProgress(`[migrate] No events table found in PGlite`);
    return;
  }

  // Check PGlite events schema first
  const pgliteColumns = await pglite.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'events'
  `);
  const pgliteColumnNames = pgliteColumns.rows.map((r: { column_name: string }) => r.column_name);
  
  // If PGlite uses streams schema (project_key, data, sequence), skip migration
  // We only migrate event-sourcing schema (aggregate_id, aggregate_type, payload, sequence_number)
  if (pgliteColumnNames.includes("project_key") && !pgliteColumnNames.includes("aggregate_id")) {
    onProgress(`[migrate] PGlite events table uses streams schema - skipping events migration`);
    onProgress(`[migrate] Note: Events will be regenerated from other data sources`);
    return;
  }
  
  // Check if PGlite has sequence_number column
  if (!pgliteColumnNames.includes("sequence_number")) {
    onProgress(`[migrate] PGlite events table missing sequence_number - skipping events migration`);
    return;
  }

  // Check if libSQL events table has compatible schema
  const libsqlColumns = await libsql.execute(`PRAGMA table_info(events)`);
  const columnNames = libsqlColumns.rows.map((r) => r.name as string);
  
  // If libSQL has 'project_key', it's the streams schema - skip migration
  if (columnNames.includes("project_key") && !columnNames.includes("aggregate_id")) {
    onProgress(`[migrate] libSQL events table uses streams schema (incompatible) - skipping events migration`);
    return;
  }

  const events = await pglite.query(`SELECT * FROM events ORDER BY sequence_number`);
  onProgress(`[migrate] Found ${events.rows.length} events`);

  for (const row of events.rows) {
    try {
      const existing = await libsql.execute({
        sql: "SELECT id FROM events WHERE id = ?",
        args: [row.id],
      });

      if (existing.rows.length > 0) {
        result.events.skipped++;
        continue;
      }

      if (dryRun) {
        onProgress(`[migrate] Would migrate event: ${row.id} (${row.type})`);
        result.events.migrated++;
        continue;
      }

      await libsql.execute({
        sql: `INSERT INTO events (id, type, aggregate_id, aggregate_type, payload, metadata, timestamp, sequence_number)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          row.type,
          row.aggregate_id,
          row.aggregate_type,
          typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload),
          typeof row.metadata === "string" ? row.metadata : JSON.stringify(row.metadata || {}),
          row.timestamp,
          row.sequence_number,
        ],
      });

      result.events.migrated++;
    } catch (err) {
      result.events.failed++;
      result.errors.push(`Event ${row.id}: ${(err as Error).message}`);
    }
  }
}

function parseVector(vectorStr: string): number[] | null {
  try {
    const cleaned = vectorStr.replace(/^\[|\]$/g, "");
    if (!cleaned) return null;
    const values = cleaned.split(",").map((v) => parseFloat(v.trim()));
    if (values.some(Number.isNaN)) return null;
    return values;
  } catch {
    return null;
  }
}

/**
 * Ensure all required libSQL tables exist
 */
async function ensureLibSQLSchema(
  libsql: Client,
  onProgress: (msg: string) => void
): Promise<void> {
  // Create memories table with vector support
  await createLibSQLMemorySchema(libsql);
  
  // Handle schema migrations for existing databases
  // Add decay_factor column if missing (added in later version)
  try {
    const columns = await libsql.execute(`PRAGMA table_info(memories)`);
    const hasDecayFactor = columns.rows.some((row: any) => row.name === "decay_factor");
    if (!hasDecayFactor) {
      await libsql.execute(`ALTER TABLE memories ADD COLUMN decay_factor REAL DEFAULT 1.0`);
      onProgress(`[migrate] Added decay_factor column to memories table`);
    }
    
    // Add tags column if missing
    const hasTags = columns.rows.some((row: any) => row.name === "tags");
    if (!hasTags) {
      await libsql.execute(`ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT '[]'`);
      onProgress(`[migrate] Added tags column to memories table`);
    }
    
    // Add updated_at column if missing
    const hasUpdatedAt = columns.rows.some((row: any) => row.name === "updated_at");
    if (!hasUpdatedAt) {
      await libsql.execute(`ALTER TABLE memories ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`);
      onProgress(`[migrate] Added updated_at column to memories table`);
    }
  } catch (err) {
    // Table might not exist yet, that's fine - createLibSQLMemorySchema will create it
    onProgress(`[migrate] Note: Could not check for schema migrations: ${(err as Error).message}`);
  }
  
  onProgress(`[migrate] Created/verified memories table`);

  // Create beads table (matching hive/migrations.ts schema)
  await libsql.execute(`
    CREATE TABLE IF NOT EXISTS beads (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'task', 'epic', 'chore', 'message')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'closed', 'tombstone')),
      title TEXT NOT NULL,
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
      parent_id TEXT REFERENCES beads(id) ON DELETE SET NULL,
      assignee TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      closed_reason TEXT,
      deleted_at INTEGER,
      deleted_by TEXT,
      delete_reason TEXT,
      created_by TEXT
    )
  `);
  await libsql.execute(`CREATE INDEX IF NOT EXISTS idx_beads_project ON beads(project_key)`);
  await libsql.execute(`CREATE INDEX IF NOT EXISTS idx_beads_status ON beads(status)`);
  onProgress(`[migrate] Created/verified beads table`);

  // Create messages table
  await libsql.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      thread_id TEXT,
      importance TEXT DEFAULT 'normal',
      ack_required INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      read_at TEXT,
      acked_at TEXT
    )
  `);
  onProgress(`[migrate] Created/verified messages table`);

  // Create agents table
  await libsql.execute(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      project_key TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      registered_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT,
      metadata TEXT DEFAULT '{}'
    )
  `);
  onProgress(`[migrate] Created/verified agents table`);

  // Check if events table already exists with different schema
  // The swarm-mail streams module uses a different events schema
  const eventsCheck = await libsql.execute(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='events'
  `);
  
  if (eventsCheck.rows.length === 0) {
    // Create events table only if it doesn't exist
    // Note: swarm-mail streams module creates its own events table with different schema
    await libsql.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        timestamp TEXT DEFAULT (datetime('now')),
        sequence_number INTEGER
      )
    `);
    await libsql.execute(`
      CREATE INDEX IF NOT EXISTS idx_events_aggregate 
      ON events(aggregate_id, aggregate_type)
    `);
    await libsql.execute(`
      CREATE INDEX IF NOT EXISTS idx_events_sequence 
      ON events(sequence_number)
    `);
    onProgress(`[migrate] Created events table`);
  } else {
    onProgress(`[migrate] Events table already exists (using existing schema)`);
  }
}
