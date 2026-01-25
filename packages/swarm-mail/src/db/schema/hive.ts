/**
 * Drizzle Schema for Hive (Work Item Tracking)
 * 
 * Translates the PGlite beads schema to libSQL/SQLite via Drizzle ORM.
 * 
 * ## Tables
 * - cells: Core work items (formerly beads)
 * - cellEvents: Event sourcing for cells
 * - cellLabels: Tags/labels on cells
 * - cellComments: Comments on cells
 * - cellDependencies: Blocking relationships
 * - schemaVersion: Migration tracking
 * 
 * ## Design Notes
 * - Uses TEXT for timestamps (ISO 8601 strings, SQLite standard)
 * - Uses TEXT for IDs (nanoid-based)
 * - Self-referential FK: cells.parent_id → cells.id
 * - Indexes on common query patterns (status, parent_id)
 * 
 * @module db/schema/hive
 */

import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Core beads table (with cells view alias)
 * 
 * Stores the main work item data including status, priority, and epic hierarchy.
 * Self-referential foreign key enables epic → subtask relationships.
 * 
 * Note: The `cells` view is an alias created by migration v8 for compatibility.
 * This schema defines the underlying `beads` table.
 */
export const beads = sqliteTable(
  "beads",
  {
    id: text("id").primaryKey(),
    project_key: text("project_key").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("open"),
    title: text("title").notNull(),
    description: text("description"),
    priority: integer("priority").notNull().default(2),
    // biome-ignore lint/suspicious/noExplicitAny: Self-referential FK requires `any` in Drizzle
    parent_id: text("parent_id").references((): any => beads.id),
    assignee: text("assignee"),
    created_at: integer("created_at").notNull(), // BIGINT (Unix ms)
    updated_at: integer("updated_at").notNull(), // BIGINT (Unix ms)
    closed_at: integer("closed_at"), // BIGINT (Unix ms)
    closed_reason: text("closed_reason"),
    deleted_at: integer("deleted_at"), // BIGINT (Unix ms)
    deleted_by: text("deleted_by"),
    delete_reason: text("delete_reason"),
    created_by: text("created_by"),
    result: text("result"), // Implementation summary (set on completion)
    result_at: integer("result_at"), // BIGINT (Unix ms) - when result was recorded
  },
  (table) => ({
    projectIdx: index("idx_beads_project").on(table.project_key),
    statusIdx: index("idx_beads_status").on(table.status),
    typeIdx: index("idx_beads_type").on(table.type),
    priorityIdx: index("idx_beads_priority").on(table.priority),
    assigneeIdx: index("idx_beads_assignee").on(table.assignee),
    parentIdx: index("idx_beads_parent").on(table.parent_id),
    createdIdx: index("idx_beads_created").on(table.created_at),
    projectStatusIdx: index("idx_beads_project_status").on(table.project_key, table.status),
  })
);

/**
 * Alias for `beads` table (using view from migration v8)
 * 
 * The `cells` view is created by migration v8 as an updatable view
 * that points to the `beads` table. This allows gradual migration
 * from "beads" terminology to "cells" (hive terminology).
 * 
 * For Drizzle queries, we can use this as an alias.
 */
export const cells = beads;

/**
 * Cell events table - event sourcing for cells
 * 
 * Stores immutable event log for cell state changes.
 * Enables event replay and audit trails.
 */
export const cellEvents = sqliteTable(
  "cell_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cell_id: text("cell_id")
      .notNull()
      .references(() => cells.id),
    event_type: text("event_type").notNull(),
    payload: text("payload").notNull(), // JSON string
    created_at: text("created_at"),
  },
  (table) => ({
    cellIdIdx: index("idx_cell_events_cell_id").on(table.cell_id),
  })
);

/**
 * Bead labels table - tags/labels on beads
 * 
 * Many-to-many relationship between beads and string labels.
 * Primary key on (cell_id, label) prevents duplicates.
 */
export const beadLabels = sqliteTable(
  "bead_labels",
  {
    cell_id: text("cell_id").notNull().references(() => beads.id),
    label: text("label").notNull(),
    created_at: integer("created_at").notNull(), // BIGINT (Unix ms)
  },
  (table) => ({
    pk: unique().on(table.cell_id, table.label),
    labelIdx: index("idx_bead_labels_label").on(table.label),
  })
);

/**
 * Alias for bead_labels
 */
export const cellLabels = beadLabels;

/**
 * Bead comments table - comments on beads
 * 
 * Stores user comments/notes on work items.
 * Supports threaded comments via parent_id.
 */
export const beadComments = sqliteTable(
  "bead_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cell_id: text("cell_id").notNull().references(() => beads.id),
    author: text("author").notNull(),
    body: text("body").notNull(),
    // biome-ignore lint/suspicious/noExplicitAny: Self-referential FK requires `any` in Drizzle
    parent_id: integer("parent_id").references((): any => beadComments.id),
    created_at: integer("created_at").notNull(), // BIGINT (Unix ms)
    updated_at: integer("updated_at"), // BIGINT (Unix ms)
  },
  (table) => ({
    beadIdx: index("idx_bead_comments_bead").on(table.cell_id),
    authorIdx: index("idx_bead_comments_author").on(table.author),
    createdIdx: index("idx_bead_comments_created").on(table.created_at),
  })
);

/**
 * Alias for bead_comments
 */
export const cellComments = beadComments;

/**
 * Bead dependencies table - blocking relationships
 * 
 * Tracks which beads block other beads.
 * cellId: the blocked bead
 * dependsOnId: the blocking bead
 * relationship: type of dependency (blocks, related, etc.)
 * 
 * Primary key on (cell_id, depends_on_id, relationship) prevents duplicates.
 */
export const beadDependencies = sqliteTable(
  "bead_dependencies",
  {
    cell_id: text("cell_id").notNull().references(() => beads.id),
    depends_on_id: text("depends_on_id").notNull().references(() => beads.id),
    relationship: text("relationship").notNull(),
    created_at: integer("created_at").notNull(), // BIGINT (Unix ms)
    created_by: text("created_by"),
  },
  (table) => ({
    pk: unique().on(table.cell_id, table.depends_on_id, table.relationship),
    beadIdx: index("idx_bead_deps_bead").on(table.cell_id),
    dependsOnIdx: index("idx_bead_deps_depends_on").on(table.depends_on_id),
    relationshipIdx: index("idx_bead_deps_relationship").on(table.relationship),
  })
);

/**
 * Alias for bead_dependencies
 */
export const cellDependencies = beadDependencies;

/**
 * Blocked beads cache - materialized view for fast blocked queries
 * 
 * Caches which beads are blocked and what blocks them.
 * Updated by projections when dependencies change.
 */
export const blockedBeadsCache = sqliteTable(
  "blocked_beads_cache",
  {
    cell_id: text("cell_id").primaryKey().references(() => beads.id),
    // SQLite doesn't have array types - need to store as JSON
    blocker_ids: text("blocker_ids").notNull(), // JSON array of bead IDs
    updated_at: integer("updated_at").notNull(), // BIGINT (Unix ms)
  },
  (table) => ({
    updatedIdx: index("idx_blocked_beads_updated").on(table.updated_at),
  })
);

/**
 * Dirty beads table - tracks beads needing JSONL export
 * 
 * Marks beads that have changed and need to be exported to .hive/issues.jsonl.
 * Cleared after successful export.
 */
export const dirtyBeads = sqliteTable(
  "dirty_beads",
  {
    cell_id: text("cell_id").primaryKey().references(() => beads.id),
    marked_at: integer("marked_at").notNull(), // BIGINT (Unix ms)
  },
  (table) => ({
    markedIdx: index("idx_dirty_beads_marked").on(table.marked_at),
  })
);

/**
 * Schema version table - migration tracking
 * 
 * Tracks which migrations have been applied.
 * Used by migration system to determine which migrations to run.
 */
export const schemaVersion = sqliteTable("schema_version", {
  version: integer("version").primaryKey(),
  applied_at: text("applied_at"),
});

/**
 * Type exports for type-safe inserts/selects
 */
export type Bead = typeof beads.$inferSelect;
export type NewBead = typeof beads.$inferInsert;
export type Cell = typeof cells.$inferSelect; // Alias for backward compatibility
export type NewCell = typeof cells.$inferInsert; // Alias for backward compatibility
export type CellEvent = typeof cellEvents.$inferSelect;
export type NewCellEvent = typeof cellEvents.$inferInsert;
export type BeadLabel = typeof beadLabels.$inferSelect;
export type NewBeadLabel = typeof beadLabels.$inferInsert;
export type CellLabel = typeof cellLabels.$inferSelect; // Alias
export type NewCellLabel = typeof cellLabels.$inferInsert; // Alias
export type BeadComment = typeof beadComments.$inferSelect;
export type NewBeadComment = typeof beadComments.$inferInsert;
export type CellComment = typeof cellComments.$inferSelect; // Alias
export type NewCellComment = typeof cellComments.$inferInsert; // Alias
export type BeadDependency = typeof beadDependencies.$inferSelect;
export type NewBeadDependency = typeof beadDependencies.$inferInsert;
export type CellDependency = typeof cellDependencies.$inferSelect; // Alias
export type NewCellDependency = typeof cellDependencies.$inferInsert; // Alias
export type BlockedBeadCache = typeof blockedBeadsCache.$inferSelect;
export type NewBlockedBeadCache = typeof blockedBeadsCache.$inferInsert;
export type DirtyBead = typeof dirtyBeads.$inferSelect;
export type NewDirtyBead = typeof dirtyBeads.$inferInsert;
