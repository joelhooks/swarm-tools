/**
 * Beads Schema Migration (v7-v8)
 *
 * Adds beads-specific tables to the shared libSQL database.
 * This migration extends the existing swarm-mail schema.
 *
 * ## Migration Strategy
 * - Migration v7 adds beads tables to existing swarm-mail schema (v0-v6)
 * - Migration v8 adds cells view for beads→hive rename compatibility
 * - Shares same libSQL database instance and migration system
 * - Uses same schema_version table for tracking
 *
 * ## Tables Created
 * - beads: Core bead records (parallel to steveyegge/beads issues table)
 * - bead_dependencies: Dependency relationships between beads
 * - bead_labels: String tags for categorization
 * - bead_comments: Comments/notes on beads
 * - blocked_beads_cache: Materialized view for fast blocked queries
 * - dirty_beads: Tracks beads that need JSONL export
 *
 * ## Design Notes
 * - Uses BIGINT for timestamps (Unix ms, like swarm-mail events)
 * - Uses TEXT for IDs (like steveyegge/beads)
 * - CASCADE deletes for referential integrity
 * - Indexes for common query patterns
 * - CHECK constraints for data integrity
 *
 * @module beads/migrations
 */

import type { Migration } from "../streams/migrations.js";

/**
 * Migration v6: Add beads tables
 *
 * This migration is designed to be appended to the existing migrations array
 * in src/streams/migrations.ts.
 */
export const beadsMigration: Migration = {
  version: 7,
  description: "Add beads tables for issue tracking",
  up: `
    -- ========================================================================
    -- Core Beads Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS beads (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'task', 'epic', 'chore', 'message')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'closed', 'tombstone')),
      title TEXT NOT NULL CHECK (length(title) <= 500),
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
      parent_id TEXT REFERENCES beads(id) ON DELETE SET NULL,
      assignee TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      closed_at BIGINT,
      closed_reason TEXT,
      deleted_at BIGINT,
      deleted_by TEXT,
      delete_reason TEXT,
      created_by TEXT,
      CHECK ((status = 'closed') = (closed_at IS NOT NULL))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_beads_project ON beads(project_key);
    CREATE INDEX IF NOT EXISTS idx_beads_status ON beads(status);
    CREATE INDEX IF NOT EXISTS idx_beads_type ON beads(type);
    CREATE INDEX IF NOT EXISTS idx_beads_priority ON beads(priority);
    CREATE INDEX IF NOT EXISTS idx_beads_assignee ON beads(assignee);
    CREATE INDEX IF NOT EXISTS idx_beads_parent ON beads(parent_id);
    CREATE INDEX IF NOT EXISTS idx_beads_created ON beads(created_at);
    CREATE INDEX IF NOT EXISTS idx_beads_project_status ON beads(project_key, status);

    -- ========================================================================
    -- Dependencies Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS bead_dependencies (
      cell_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL CHECK (relationship IN ('blocks', 'related', 'parent-child', 'discovered-from', 'replies-to', 'relates-to', 'duplicates', 'supersedes')),
      created_at BIGINT NOT NULL,
      created_by TEXT,
      PRIMARY KEY (cell_id, depends_on_id, relationship)
    );

    CREATE INDEX IF NOT EXISTS idx_bead_deps_bead ON bead_dependencies(cell_id);
    CREATE INDEX IF NOT EXISTS idx_bead_deps_depends_on ON bead_dependencies(depends_on_id);
    CREATE INDEX IF NOT EXISTS idx_bead_deps_relationship ON bead_dependencies(relationship);

    -- ========================================================================
    -- Labels Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS bead_labels (
      cell_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (cell_id, label)
    );

    CREATE INDEX IF NOT EXISTS idx_bead_labels_label ON bead_labels(label);

    -- ========================================================================
    -- Comments Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS bead_comments (
      id SERIAL PRIMARY KEY,
      cell_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      parent_id INTEGER REFERENCES bead_comments(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_bead_comments_bead ON bead_comments(cell_id);
    CREATE INDEX IF NOT EXISTS idx_bead_comments_author ON bead_comments(author);
    CREATE INDEX IF NOT EXISTS idx_bead_comments_created ON bead_comments(created_at);

    -- ========================================================================
    -- Blocked Beads Cache
    -- ========================================================================
    -- Materialized view for fast blocked queries
    -- Updated by projections when dependencies change
    CREATE TABLE IF NOT EXISTS blocked_beads_cache (
      cell_id TEXT PRIMARY KEY REFERENCES beads(id) ON DELETE CASCADE,
      blocker_ids TEXT[] NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocked_beads_updated ON blocked_beads_cache(updated_at);

    -- ========================================================================
    -- Dirty Beads Table
    -- ========================================================================
    -- Tracks beads that need JSONL export (incremental sync)
    CREATE TABLE IF NOT EXISTS dirty_beads (
      cell_id TEXT PRIMARY KEY REFERENCES beads(id) ON DELETE CASCADE,
      marked_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dirty_beads_marked ON dirty_beads(marked_at);
  `,
  down: `
    -- Drop in reverse order to handle foreign key constraints
    DROP TABLE IF EXISTS dirty_beads;
    DROP TABLE IF EXISTS blocked_beads_cache;
    DROP TABLE IF EXISTS bead_comments;
    DROP TABLE IF EXISTS bead_labels;
    DROP TABLE IF EXISTS bead_dependencies;
    DROP TABLE IF EXISTS beads;
  `,
};

/**
 * Migration v7: Add cells view for beads→hive rename compatibility
 *
 * Creates a view called `cells` that points to the `beads` table.
 * This allows code that references `cells` to work with existing `beads` data.
 *
 * The view is updatable via INSTEAD OF triggers for INSERT/UPDATE/DELETE.
 */
export const cellsViewMigration: Migration = {
  version: 8,
  description: "Add cells view for beads→hive rename compatibility",
  up: `
    -- ========================================================================
    -- Cells View (alias for beads table)
    -- ========================================================================
    -- This view allows code to reference "cells" while data lives in "beads"
    CREATE OR REPLACE VIEW cells AS SELECT * FROM beads;

    -- INSTEAD OF INSERT trigger
    CREATE OR REPLACE FUNCTION cells_insert_trigger()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO beads VALUES (NEW.*);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS cells_insert ON cells;
    CREATE TRIGGER cells_insert
      INSTEAD OF INSERT ON cells
      FOR EACH ROW
      EXECUTE FUNCTION cells_insert_trigger();

    -- INSTEAD OF UPDATE trigger
    CREATE OR REPLACE FUNCTION cells_update_trigger()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE beads SET
        project_key = NEW.project_key,
        type = NEW.type,
        status = NEW.status,
        title = NEW.title,
        description = NEW.description,
        priority = NEW.priority,
        parent_id = NEW.parent_id,
        assignee = NEW.assignee,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        closed_at = NEW.closed_at,
        closed_reason = NEW.closed_reason,
        deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by,
        delete_reason = NEW.delete_reason,
        created_by = NEW.created_by
      WHERE id = OLD.id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS cells_update ON cells;
    CREATE TRIGGER cells_update
      INSTEAD OF UPDATE ON cells
      FOR EACH ROW
      EXECUTE FUNCTION cells_update_trigger();

    -- INSTEAD OF DELETE trigger
    CREATE OR REPLACE FUNCTION cells_delete_trigger()
    RETURNS TRIGGER AS $$
    BEGIN
      DELETE FROM beads WHERE id = OLD.id;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS cells_delete ON cells;
    CREATE TRIGGER cells_delete
      INSTEAD OF DELETE ON cells
      FOR EACH ROW
      EXECUTE FUNCTION cells_delete_trigger();
  `,
  down: `
    DROP TRIGGER IF EXISTS cells_delete ON cells;
    DROP TRIGGER IF EXISTS cells_update ON cells;
    DROP TRIGGER IF EXISTS cells_insert ON cells;
    DROP FUNCTION IF EXISTS cells_delete_trigger();
    DROP FUNCTION IF EXISTS cells_update_trigger();
    DROP FUNCTION IF EXISTS cells_insert_trigger();
    DROP VIEW IF EXISTS cells;
  `,
};

/**
 * LibSQL-compatible cells view migration (v8)
 * 
 * SQLite doesn't support CREATE OR REPLACE or stored procedures.
 * Use DROP IF EXISTS + CREATE and inline INSTEAD OF triggers.
 */
export const cellsViewMigrationLibSQL: Migration = {
  version: 8,
  description: "Add cells view for beads→hive rename compatibility (LibSQL)",
  up: `
    -- ========================================================================
    -- Cells View (alias for beads table) - LibSQL version
    -- ========================================================================
    DROP VIEW IF EXISTS cells;
    CREATE VIEW cells AS SELECT * FROM beads;

    -- INSTEAD OF INSERT trigger (inline, no stored procedure)
    DROP TRIGGER IF EXISTS cells_insert;
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
    END;

    -- INSTEAD OF UPDATE trigger
    DROP TRIGGER IF EXISTS cells_update;
    CREATE TRIGGER cells_update
      INSTEAD OF UPDATE ON cells
      FOR EACH ROW
    BEGIN
      UPDATE beads SET
        project_key = NEW.project_key,
        type = NEW.type,
        status = NEW.status,
        title = NEW.title,
        description = NEW.description,
        priority = NEW.priority,
        parent_id = NEW.parent_id,
        assignee = NEW.assignee,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        closed_at = NEW.closed_at,
        closed_reason = NEW.closed_reason,
        deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by,
        delete_reason = NEW.delete_reason,
        created_by = NEW.created_by
      WHERE id = OLD.id;
    END;

    -- INSTEAD OF DELETE trigger
    DROP TRIGGER IF EXISTS cells_delete;
    CREATE TRIGGER cells_delete
      INSTEAD OF DELETE ON cells
      FOR EACH ROW
    BEGIN
      DELETE FROM beads WHERE id = OLD.id;
    END;
  `,
  down: `
    DROP TRIGGER IF EXISTS cells_delete;
    DROP TRIGGER IF EXISTS cells_update;
    DROP TRIGGER IF EXISTS cells_insert;
    DROP VIEW IF EXISTS cells;
  `,
};

/**
 * LibSQL-compatible beads migration (v7)
 * 
 * Differences from PGLite version:
 * - Uses INTEGER PRIMARY KEY AUTOINCREMENT instead of SERIAL
 * - Uses TEXT (JSON string) instead of TEXT[] for arrays
 * - Uses INTEGER instead of BIGINT (SQLite treats both as INTEGER anyway)
 */
export const beadsMigrationLibSQL: Migration = {
  version: 7,
  description: "Add beads tables for issue tracking (LibSQL)",
  up: `
    -- ========================================================================
    -- Core Beads Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS beads (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'task', 'epic', 'chore', 'message')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'closed', 'tombstone')),
      title TEXT NOT NULL CHECK (length(title) <= 500),
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
      created_by TEXT,
      CHECK ((status = 'closed') = (closed_at IS NOT NULL))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_beads_project ON beads(project_key);
    CREATE INDEX IF NOT EXISTS idx_beads_status ON beads(status);
    CREATE INDEX IF NOT EXISTS idx_beads_type ON beads(type);
    CREATE INDEX IF NOT EXISTS idx_beads_priority ON beads(priority);
    CREATE INDEX IF NOT EXISTS idx_beads_assignee ON beads(assignee);
    CREATE INDEX IF NOT EXISTS idx_beads_parent ON beads(parent_id);
    CREATE INDEX IF NOT EXISTS idx_beads_created ON beads(created_at);
    CREATE INDEX IF NOT EXISTS idx_beads_project_status ON beads(project_key, status);

    -- ========================================================================
    -- Dependencies Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS bead_dependencies (
      cell_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL CHECK (relationship IN ('blocks', 'related', 'parent-child', 'discovered-from', 'replies-to', 'relates-to', 'duplicates', 'supersedes')),
      created_at INTEGER NOT NULL,
      created_by TEXT,
      PRIMARY KEY (cell_id, depends_on_id, relationship)
    );

    CREATE INDEX IF NOT EXISTS idx_bead_deps_bead ON bead_dependencies(cell_id);
    CREATE INDEX IF NOT EXISTS idx_bead_deps_depends_on ON bead_dependencies(depends_on_id);
    CREATE INDEX IF NOT EXISTS idx_bead_deps_relationship ON bead_dependencies(relationship);

    -- ========================================================================
    -- Labels Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS bead_labels (
      cell_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (cell_id, label)
    );

    CREATE INDEX IF NOT EXISTS idx_bead_labels_label ON bead_labels(label);

    -- ========================================================================
    -- Comments Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS bead_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cell_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      parent_id INTEGER REFERENCES bead_comments(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_bead_comments_bead ON bead_comments(cell_id);
    CREATE INDEX IF NOT EXISTS idx_bead_comments_author ON bead_comments(author);
    CREATE INDEX IF NOT EXISTS idx_bead_comments_created ON bead_comments(created_at);

    -- ========================================================================
    -- Blocked Beads Cache
    -- ========================================================================
    -- Materialized view for fast blocked queries
    -- Updated by projections when dependencies change
    -- Note: SQLite doesn't support arrays, so blocker_ids is a JSON string
    CREATE TABLE IF NOT EXISTS blocked_beads_cache (
      cell_id TEXT PRIMARY KEY REFERENCES beads(id) ON DELETE CASCADE,
      blocker_ids TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocked_beads_updated ON blocked_beads_cache(updated_at);

    -- ========================================================================
    -- Dirty Beads Table
    -- ========================================================================
    -- Tracks beads that need JSONL export (incremental sync)
    CREATE TABLE IF NOT EXISTS dirty_beads (
      cell_id TEXT PRIMARY KEY REFERENCES beads(id) ON DELETE CASCADE,
      marked_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dirty_beads_marked ON dirty_beads(marked_at);
  `,
  down: `
    -- Drop in reverse order to handle foreign key constraints
    DROP TABLE IF EXISTS dirty_beads;
    DROP TABLE IF EXISTS blocked_beads_cache;
    DROP TABLE IF EXISTS bead_comments;
    DROP TABLE IF EXISTS bead_labels;
    DROP TABLE IF EXISTS bead_dependencies;
    DROP TABLE IF EXISTS beads;
  `,
};

/**
 * Migration v10: Add result and result_at columns to beads table
 *
 * Captures implementation summaries when cells are completed.
 * - result: TEXT - What was actually done (like a PR description)
 * - result_at: INTEGER (Unix ms) - When the result was recorded
 * Both nullable (only set on completion).
 */
export const beadsResultColumnsMigration: Migration = {
  version: 10,
  description: "Add result and result_at columns to beads table",
  up: `
    ALTER TABLE beads ADD COLUMN result TEXT;
    ALTER TABLE beads ADD COLUMN result_at INTEGER;

    -- Recreate cells view triggers to include new columns
    DROP TRIGGER IF EXISTS cells_insert;
    CREATE TRIGGER cells_insert
      INSTEAD OF INSERT ON cells
      FOR EACH ROW
    BEGIN
      INSERT INTO beads (id, project_key, type, status, title,
        description, priority, parent_id, assignee,
        created_at, updated_at, closed_at, closed_reason,
        deleted_at, deleted_by, delete_reason, created_by,
        result, result_at)
      VALUES (
        NEW.id, NEW.project_key, NEW.type, NEW.status, NEW.title,
        NEW.description, NEW.priority, NEW.parent_id, NEW.assignee,
        NEW.created_at, NEW.updated_at, NEW.closed_at, NEW.closed_reason,
        NEW.deleted_at, NEW.deleted_by, NEW.delete_reason, NEW.created_by,
        NEW.result, NEW.result_at
      );
    END;

    DROP TRIGGER IF EXISTS cells_update;
    CREATE TRIGGER cells_update
      INSTEAD OF UPDATE ON cells
      FOR EACH ROW
    BEGIN
      UPDATE beads SET
        project_key = NEW.project_key,
        type = NEW.type,
        status = NEW.status,
        title = NEW.title,
        description = NEW.description,
        priority = NEW.priority,
        parent_id = NEW.parent_id,
        assignee = NEW.assignee,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        closed_at = NEW.closed_at,
        closed_reason = NEW.closed_reason,
        deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by,
        delete_reason = NEW.delete_reason,
        created_by = NEW.created_by,
        result = NEW.result,
        result_at = NEW.result_at
      WHERE id = NEW.id;
    END;
  `,
  down: `
    ALTER TABLE beads DROP COLUMN result;
    ALTER TABLE beads DROP COLUMN result_at;
  `,
};

/**
 * LibSQL-compatible version of v10 migration
 */
export const beadsResultColumnsMigrationLibSQL: Migration = {
  version: 10,
  description: "Add result and result_at columns to beads table (LibSQL)",
  up: `
    ALTER TABLE beads ADD COLUMN result TEXT;
    ALTER TABLE beads ADD COLUMN result_at INTEGER;

    -- Recreate cells view triggers to include new columns
    DROP TRIGGER IF EXISTS cells_insert;
    CREATE TRIGGER cells_insert
      INSTEAD OF INSERT ON cells
      FOR EACH ROW
    BEGIN
      INSERT INTO beads (id, project_key, type, status, title,
        description, priority, parent_id, assignee,
        created_at, updated_at, closed_at, closed_reason,
        deleted_at, deleted_by, delete_reason, created_by,
        result, result_at)
      VALUES (
        NEW.id, NEW.project_key, NEW.type, NEW.status, NEW.title,
        NEW.description, NEW.priority, NEW.parent_id, NEW.assignee,
        NEW.created_at, NEW.updated_at, NEW.closed_at, NEW.closed_reason,
        NEW.deleted_at, NEW.deleted_by, NEW.delete_reason, NEW.created_by,
        NEW.result, NEW.result_at
      );
    END;

    DROP TRIGGER IF EXISTS cells_update;
    CREATE TRIGGER cells_update
      INSTEAD OF UPDATE ON cells
      FOR EACH ROW
    BEGIN
      UPDATE beads SET
        project_key = NEW.project_key,
        type = NEW.type,
        status = NEW.status,
        title = NEW.title,
        description = NEW.description,
        priority = NEW.priority,
        parent_id = NEW.parent_id,
        assignee = NEW.assignee,
        created_at = NEW.created_at,
        updated_at = NEW.updated_at,
        closed_at = NEW.closed_at,
        closed_reason = NEW.closed_reason,
        deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by,
        delete_reason = NEW.delete_reason,
        created_by = NEW.created_by,
        result = NEW.result,
        result_at = NEW.result_at
      WHERE id = NEW.id;
    END;
  `,
  down: `
    -- SQLite doesn't support DROP COLUMN until 3.35.0
    -- Columns can be left as NULL if downgrade is needed
  `,
};

/**
 * Export individual migrations
 */
export const beadsMigrations: Migration[] = [beadsMigration];

/**
 * All hive migrations in order (PGLite version)
 */
export const hiveMigrations: Migration[] = [beadsMigration, cellsViewMigration, beadsResultColumnsMigration];

/**
 * Migration v9: Add sessions table for handoff notes
 *
 * Inspired by Chainlink's session management pattern.
 * Credit: @dollspace-gay (https://github.com/dollspace-gay/chainlink)
 *
 * Enables context preservation across sessions via handoff notes.
 * When a session ends, agents can save notes for the next session.
 * When a new session starts, it shows the previous handoff notes.
 */
export const sessionsMigrationLibSQL: Migration = {
	version: 9,
	description: "Add sessions table for handoff notes (Chainlink pattern)",
	up: `
    -- ========================================================================
    -- Sessions Table
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      active_cell_id TEXT REFERENCES beads(id) ON DELETE SET NULL,
      handoff_notes TEXT,
      created_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_key);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_active_cell ON sessions(active_cell_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project_ended ON sessions(project_key, ended_at);
  `,
	down: `
    DROP TABLE IF EXISTS sessions;
  `,
};

/**
 * All hive migrations in order (LibSQL version)
 */
export const hiveMigrationsLibSQL: Migration[] = [
	beadsMigrationLibSQL,
	cellsViewMigrationLibSQL,
	sessionsMigrationLibSQL,
	beadsResultColumnsMigrationLibSQL,
];
