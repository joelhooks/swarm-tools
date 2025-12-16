/**
 * Schema Migration System
 *
 * Handles database schema evolution for the PGLite event store.
 *
 * ## How It Works
 *
 * 1. Each migration has a unique version number (incrementing integer)
 * 2. On startup, `runMigrations()` checks current schema version
 * 3. Migrations are applied in order until schema is current
 * 4. Version is stored in `schema_version` table
 *
 * ## Adding a New Migration
 *
 * ```typescript
 * // In migrations.ts
 * export const migrations: Migration[] = [
 *   // ... existing migrations
 *   {
 *     version: 3,
 *     description: "add_new_column",
 *     up: `ALTER TABLE events ADD COLUMN new_col TEXT`,
 *     down: `ALTER TABLE events DROP COLUMN new_col`,
 *   },
 * ];
 * ```
 *
 * ## Rollback
 *
 * Rollback is supported via `rollbackTo(db, targetVersion)`.
 * Note: Some migrations may not be fully reversible (data loss).
 *
 * ## Best Practices
 *
 * - Always test migrations on a copy of production data
 * - Keep migrations small and focused
 * - Include both `up` and `down` SQL
 * - Use transactions for multi-statement migrations
 * - Document any data transformations
 *
 * @module migrations
 */
import type { PGlite } from "@electric-sql/pglite";

// ============================================================================
// Types
// ============================================================================

/**
 * A database migration definition.
 */
export interface Migration {
  /** Unique version number (must be sequential) */
  version: number;
  /** Human-readable migration description */
  description: string;
  /** SQL to apply the migration */
  up: string;
  /** SQL to rollback the migration (best effort) */
  down: string;
}

interface SchemaVersion {
  version: number;
  applied_at: number;
  description: string | null;
}

// ============================================================================
// Migration Definitions
// ============================================================================

export const migrations: Migration[] = [
  {
    version: 1,
    description: "Add cursors table for DurableCursor",
    up: `
      CREATE TABLE IF NOT EXISTS cursors (
        id SERIAL PRIMARY KEY,
        stream TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        position BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        UNIQUE(stream, checkpoint)
      );
      CREATE INDEX IF NOT EXISTS idx_cursors_checkpoint ON cursors(checkpoint);
      CREATE INDEX IF NOT EXISTS idx_cursors_stream ON cursors(stream);
    `,
    down: `DROP TABLE IF EXISTS cursors;`,
  },
  {
    version: 2,
    description: "Add deferred table for DurableDeferred",
    up: `
      CREATE TABLE IF NOT EXISTS deferred (
        id SERIAL PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        resolved BOOLEAN NOT NULL DEFAULT FALSE,
        value JSONB,
        error TEXT,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deferred_url ON deferred(url);
      CREATE INDEX IF NOT EXISTS idx_deferred_expires ON deferred(expires_at);
      CREATE INDEX IF NOT EXISTS idx_deferred_resolved ON deferred(resolved);
    `,
    down: `DROP TABLE IF EXISTS deferred;`,
  },
  {
    version: 3,
    description: "Add eval_records table for learning system",
    up: `
      CREATE TABLE IF NOT EXISTS eval_records (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        task TEXT NOT NULL,
        context TEXT,
        strategy TEXT NOT NULL,
        epic_title TEXT NOT NULL,
        subtasks JSONB NOT NULL,
        outcomes JSONB,
        overall_success BOOLEAN,
        total_duration_ms INTEGER,
        total_errors INTEGER,
        human_accepted BOOLEAN,
        human_modified BOOLEAN,
        human_notes TEXT,
        file_overlap_count INTEGER,
        scope_accuracy REAL,
        time_balance_ratio REAL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_eval_records_project ON eval_records(project_key);
      CREATE INDEX IF NOT EXISTS idx_eval_records_strategy ON eval_records(strategy);
    `,
    down: `DROP TABLE IF EXISTS eval_records;`,
  },
  {
    version: 4,
    description: "Add swarm_contexts table for context recovery",
    up: `
      CREATE TABLE IF NOT EXISTS swarm_contexts (
        id TEXT PRIMARY KEY,
        epic_id TEXT NOT NULL,
        bead_id TEXT NOT NULL,
        strategy TEXT NOT NULL,
        files JSONB NOT NULL,
        dependencies JSONB NOT NULL,
        directives JSONB NOT NULL,
        recovery JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_swarm_contexts_epic ON swarm_contexts(epic_id);
      CREATE INDEX IF NOT EXISTS idx_swarm_contexts_bead ON swarm_contexts(bead_id);
    `,
    down: `DROP TABLE IF EXISTS swarm_contexts;`,
  },
  {
    version: 5,
    description: "Add project_key and checkpointed_at to swarm_contexts, change primary key",
    up: `
      -- Add new columns
      ALTER TABLE swarm_contexts ADD COLUMN IF NOT EXISTS project_key TEXT;
      ALTER TABLE swarm_contexts ADD COLUMN IF NOT EXISTS checkpointed_at BIGINT;
      ALTER TABLE swarm_contexts ADD COLUMN IF NOT EXISTS recovered_at BIGINT;
      ALTER TABLE swarm_contexts ADD COLUMN IF NOT EXISTS recovered_from_checkpoint BIGINT;
      
      -- Drop old primary key constraint on id
      ALTER TABLE swarm_contexts DROP CONSTRAINT IF EXISTS swarm_contexts_pkey;
      
      -- Make id nullable since we're switching to composite key
      ALTER TABLE swarm_contexts ALTER COLUMN id DROP NOT NULL;
      
      -- Create new indexes
      CREATE INDEX IF NOT EXISTS idx_swarm_contexts_project ON swarm_contexts(project_key);
      DROP INDEX IF EXISTS idx_swarm_contexts_epic;
      DROP INDEX IF EXISTS idx_swarm_contexts_bead;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_swarm_contexts_unique ON swarm_contexts(project_key, epic_id, bead_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_swarm_contexts_unique;
      DROP INDEX IF EXISTS idx_swarm_contexts_project;
      ALTER TABLE swarm_contexts DROP COLUMN IF EXISTS project_key;
      ALTER TABLE swarm_contexts DROP COLUMN IF EXISTS checkpointed_at;
      ALTER TABLE swarm_contexts DROP COLUMN IF EXISTS recovered_at;
      ALTER TABLE swarm_contexts DROP COLUMN IF EXISTS recovered_from_checkpoint;
      ALTER TABLE swarm_contexts ALTER COLUMN id SET NOT NULL;
      ALTER TABLE swarm_contexts ADD CONSTRAINT swarm_contexts_pkey PRIMARY KEY (id);
      CREATE INDEX IF NOT EXISTS idx_swarm_contexts_epic ON swarm_contexts(epic_id);
      CREATE INDEX IF NOT EXISTS idx_swarm_contexts_bead ON swarm_contexts(bead_id);
    `,
  },
];

// ============================================================================
// Migration Execution
// ============================================================================

/**
 * Initialize schema_version table if it doesn't exist
 */
async function ensureVersionTable(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at BIGINT NOT NULL,
      description TEXT
    );
  `);
}

/**
 * Get the current schema version
 *
 * Returns 0 if no migrations have been applied
 */
export async function getCurrentVersion(db: PGlite): Promise<number> {
  await ensureVersionTable(db);

  const result = await db.query<{ version: number }>(
    `SELECT MAX(version) as version FROM schema_version`,
  );

  return result.rows[0]?.version ?? 0;
}

/**
 * Get all applied migrations
 */
export async function getAppliedMigrations(
  db: PGlite,
): Promise<SchemaVersion[]> {
  await ensureVersionTable(db);

  const result = await db.query<{
    version: number;
    applied_at: string;
    description: string | null;
  }>(
    `SELECT version, applied_at, description FROM schema_version ORDER BY version ASC`,
  );

  return result.rows.map((row) => ({
    version: row.version,
    applied_at: parseInt(row.applied_at as string),
    description: row.description,
  }));
}

/**
 * Run all pending migrations
 *
 * Idempotent - safe to run multiple times.
 * Only runs migrations that haven't been applied yet.
 */
export async function runMigrations(db: PGlite): Promise<{
  applied: number[];
  current: number;
}> {
  await ensureVersionTable(db);

  const currentVersion = await getCurrentVersion(db);
  const applied: number[] = [];

  // Find migrations that need to be applied
  const pendingMigrations = migrations.filter(
    (m) => m.version > currentVersion,
  );

  if (pendingMigrations.length === 0) {
    return { applied: [], current: currentVersion };
  }

  // Sort by version to ensure correct order
  pendingMigrations.sort((a, b) => a.version - b.version);

  // Apply each migration in a transaction
  for (const migration of pendingMigrations) {
    await db.exec("BEGIN");
    try {
      // Run the migration SQL
      await db.exec(migration.up);

      // Record the migration
      await db.query(
        `INSERT INTO schema_version (version, applied_at, description)
         VALUES ($1, $2, $3)`,
        [migration.version, Date.now(), migration.description],
      );

      await db.exec("COMMIT");
      applied.push(migration.version);

      console.log(
        `[migrations] Applied migration ${migration.version}: ${migration.description}`,
      );
    } catch (error) {
      await db.exec("ROLLBACK");
      const err = error as Error;
      console.error(
        `[migrations] Failed to apply migration ${migration.version}: ${err.message}`,
      );
      throw new Error(`Migration ${migration.version} failed: ${err.message}`);
    }
  }

  const finalVersion = await getCurrentVersion(db);
  return { applied, current: finalVersion };
}

/**
 * Rollback to a specific version
 *
 * WARNING: This will DROP tables and LOSE DATA.
 * Only use for testing or emergency recovery.
 */
export async function rollbackTo(
  db: PGlite,
  targetVersion: number,
): Promise<{
  rolledBack: number[];
  current: number;
}> {
  const currentVersion = await getCurrentVersion(db);
  const rolledBack: number[] = [];

  if (targetVersion >= currentVersion) {
    return { rolledBack: [], current: currentVersion };
  }

  // Find migrations to rollback (in reverse order)
  const migrationsToRollback = migrations
    .filter((m) => m.version > targetVersion && m.version <= currentVersion)
    .sort((a, b) => b.version - a.version); // Descending order

  for (const migration of migrationsToRollback) {
    await db.exec("BEGIN");
    try {
      // Run the down migration
      await db.exec(migration.down);

      // Remove from version table
      await db.query(`DELETE FROM schema_version WHERE version = $1`, [
        migration.version,
      ]);

      await db.exec("COMMIT");
      rolledBack.push(migration.version);

      console.log(
        `[migrations] Rolled back migration ${migration.version}: ${migration.description}`,
      );
    } catch (error) {
      await db.exec("ROLLBACK");
      const err = error as Error;
      console.error(
        `[migrations] Failed to rollback migration ${migration.version}: ${err.message}`,
      );
      throw new Error(
        `Rollback of migration ${migration.version} failed: ${err.message}`,
      );
    }
  }

  const finalVersion = await getCurrentVersion(db);
  return { rolledBack, current: finalVersion };
}

/**
 * Check if a specific migration has been applied
 */
export async function isMigrationApplied(
  db: PGlite,
  version: number,
): Promise<boolean> {
  await ensureVersionTable(db);

  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM schema_version WHERE version = $1`,
    [version],
  );

  return parseInt(result.rows[0]?.count || "0") > 0;
}

/**
 * Get pending migrations (not yet applied)
 */
export async function getPendingMigrations(db: PGlite): Promise<Migration[]> {
  const currentVersion = await getCurrentVersion(db);
  return migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);
}
