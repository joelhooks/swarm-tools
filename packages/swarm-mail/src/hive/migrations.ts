/**
 * Beads Schema Migration (v6)
 *
 * Adds beads-specific tables to the shared PGLite database.
 * This migration extends the existing swarm-mail schema.
 *
 * ## Migration Strategy
 * - Migration v6 adds beads tables to existing swarm-mail schema (v1-v5)
 * - Shares same PGLite database instance and migration system
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
  version: 6,
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
 * Export as array for convenience
 */
export const beadsMigrations: Migration[] = [beadsMigration];
