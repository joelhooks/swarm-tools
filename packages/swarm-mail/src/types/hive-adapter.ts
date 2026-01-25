/**
 * HiveAdapter - High-level interface for hive operations
 *
 * This interface abstracts all hive operations (CRUD, dependencies, labels,
 * comments, epic management) to enable different storage backends.
 *
 * ## Design Goals
 * - Database-agnostic (works with libSQL, SQLite, PostgreSQL, etc.)
 * - Parallel to SwarmMailAdapter pattern
 * - Event sourcing with projections for queries
 * - No implementation details leak through interface
 *
 * ## Layering
 * - DatabaseAdapter: Low-level SQL execution (shared with swarm-mail)
 * - HiveAdapter: High-level hive operations (uses DatabaseAdapter internally)
 * - Plugin tools: Type-safe Zod-validated wrappers (use HiveAdapter)
 *
 * ## Relationship to steveyegge/beads
 * This is a TypeScript rewrite of steveyegge/beads internal/storage/storage.go
 * interface, adapted for event sourcing and shared libSQL database.
 */

import type { DatabaseAdapter } from "./database.js";

// Re-export cell types from opencode-swarm-plugin for convenience
// (These are defined in packages/opencode-swarm-plugin/src/schemas/cell.ts)
export type CellStatus = "open" | "in_progress" | "blocked" | "closed" | "tombstone";
export type CellType = "bug" | "feature" | "task" | "epic" | "chore" | "message";
export type DependencyRelationship = 
  | "blocks" 
  | "related" 
  | "parent-child" 
  | "discovered-from" 
  | "replies-to" 
  | "relates-to" 
  | "duplicates" 
  | "supersedes";

// ============================================================================
// Core Bead Operations
// ============================================================================

/**
 * Full cell record (projection)
 */
export interface Cell {
  id: string;
  project_key: string;
  type: CellType;
  status: CellStatus;
  title: string;
  description: string | null;
  priority: number;
  parent_id: string | null;
  assignee: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  closed_reason: string | null;
  deleted_at: number | null;
  deleted_by: string | null;
  delete_reason: string | null;
  created_by: string | null;
  result: string | null;
  result_at: number | null;
}

/**
 * Cell creation options
 */
export interface CreateCellOptions {
  title: string;
  description?: string;
  type: CellType;
  priority?: number;
  parent_id?: string;
  assignee?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Cell update options
 */
export interface UpdateCellOptions {
  title?: string;
  description?: string;
  priority?: number;
  assignee?: string;
  updated_by?: string;
}

/**
 * Cell query filters
 */
export interface QueryCellsOptions {
  status?: CellStatus | CellStatus[];
  type?: CellType | CellType[];
  parent_id?: string;
  assignee?: string;
  labels?: string[];
  limit?: number;
  offset?: number;
  /** Include deleted cells */
  include_deleted?: boolean;
  /** Include children for epics */
  include_children?: boolean;
}

export interface CellAdapter {
  /**
   * Create a new bead
   * 
   * Emits: bead_created event
   */
  createCell(
    projectKey: string,
    options: CreateCellOptions,
    projectPath?: string,
  ): Promise<Cell>;

  /**
   * Get a cell by ID
   */
  getCell(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<Cell | null>;

  /**
   * Query cells with filters
   */
  queryCells(
    projectKey: string,
    options?: QueryCellsOptions,
    projectPath?: string,
  ): Promise<Cell[]>;

  /**
   * Update cell fields
   * 
   * Emits: bead_updated event
   */
  updateCell(
    projectKey: string,
    cellId: string,
    options: UpdateCellOptions,
    projectPath?: string,
  ): Promise<Cell>;

  /**
   * Change cell status
   * 
   * Emits: bead_status_changed event
   */
  changeCellStatus(
    projectKey: string,
    cellId: string,
    toStatus: CellStatus,
    options?: {
      reason?: string;
      changed_by?: string;
    },
    projectPath?: string,
  ): Promise<Cell>;

  /**
   * Close a bead
   * 
   * Emits: bead_closed event
   */
  closeCell(
    projectKey: string,
    cellId: string,
    reason: string,
    options?: {
      closed_by?: string;
      files_touched?: string[];
      duration_ms?: number;
      /** Implementation summary (what was actually done, like a PR description) */
      result?: string;
    },
    projectPath?: string,
  ): Promise<Cell>;

  /**
   * Reopen a closed bead
   * 
   * Emits: bead_reopened event
   */
  reopenCell(
    projectKey: string,
    cellId: string,
    options?: {
      reason?: string;
      reopened_by?: string;
    },
    projectPath?: string,
  ): Promise<Cell>;

  /**
   * Delete a cell (soft delete)
   * 
   * Emits: bead_deleted event
   */
  deleteCell(
    projectKey: string,
    cellId: string,
    options?: {
      reason?: string;
      deleted_by?: string;
    },
    projectPath?: string,
  ): Promise<void>;
}

// ============================================================================
// Dependency Operations
// ============================================================================

/**
 * Dependency between cells
 */
export interface CellDependency {
  cell_id: string;
  depends_on_id: string;
  relationship: DependencyRelationship;
  created_at: number;
  created_by: string | null;
}

export interface DependencyAdapter {
  /**
   * Add a dependency between cells
   * 
   * Emits: bead_dependency_added event
   */
  addDependency(
    projectKey: string,
    cellId: string,
    dependsOnId: string,
    relationship: DependencyRelationship,
    options?: {
      reason?: string;
      added_by?: string;
    },
    projectPath?: string,
  ): Promise<CellDependency>;

  /**
   * Remove a dependency
   * 
   * Emits: bead_dependency_removed event
   */
  removeDependency(
    projectKey: string,
    cellId: string,
    dependsOnId: string,
    relationship: DependencyRelationship,
    options?: {
      reason?: string;
      removed_by?: string;
    },
    projectPath?: string,
  ): Promise<void>;

  /**
   * Get all dependencies for a cell
   */
  getDependencies(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<CellDependency[]>;

  /**
   * Get cells that depend on this bead
   */
  getDependents(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<CellDependency[]>;

  /**
   * Check if a cell is blocked
   * 
   * Uses blocked_cells_cache for fast lookups
   */
  isBlocked(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<boolean>;

  /**
   * Get all blockers for a cell
   */
  getBlockers(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<string[]>;
}

// ============================================================================
// Label Operations
// ============================================================================

/**
 * Label on a cell
 */
export interface CellLabel {
  cell_id: string;
  label: string;
  created_at: number;
}

export interface LabelAdapter {
  /**
   * Add a label to a cell
   * 
   * Emits: bead_label_added event
   */
  addLabel(
    projectKey: string,
    cellId: string,
    label: string,
    options?: {
      added_by?: string;
    },
    projectPath?: string,
  ): Promise<CellLabel>;

  /**
   * Remove a label from a cell
   * 
   * Emits: bead_label_removed event
   */
  removeLabel(
    projectKey: string,
    cellId: string,
    label: string,
    options?: {
      removed_by?: string;
    },
    projectPath?: string,
  ): Promise<void>;

  /**
   * Get all labels for a cell
   */
  getLabels(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<string[]>;

  /**
   * Get all cells with a label
   */
  getCellsWithLabel(
    projectKey: string,
    label: string,
    projectPath?: string,
  ): Promise<Cell[]>;
}

// ============================================================================
// Comment Operations
// ============================================================================

/**
 * Comment on a cell
 */
export interface CellComment {
  id: number;
  cell_id: string;
  author: string;
  body: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number | null;
}

export interface CommentAdapter {
  /**
   * Add a comment to a cell
   * 
   * Emits: bead_comment_added event
   */
  addComment(
    projectKey: string,
    cellId: string,
    author: string,
    body: string,
    options?: {
      parent_id?: number;
      metadata?: Record<string, unknown>;
    },
    projectPath?: string,
  ): Promise<CellComment>;

  /**
   * Update a comment
   * 
   * Emits: bead_comment_updated event
   */
  updateComment(
    projectKey: string,
    commentId: number,
    newBody: string,
    updated_by: string,
    projectPath?: string,
  ): Promise<CellComment>;

  /**
   * Delete a comment
   * 
   * Emits: bead_comment_deleted event
   */
  deleteComment(
    projectKey: string,
    commentId: number,
    deleted_by: string,
    options?: {
      reason?: string;
    },
    projectPath?: string,
  ): Promise<void>;

  /**
   * Get all comments for a cell
   */
  getComments(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<CellComment[]>;
}

// ============================================================================
// Epic Operations
// ============================================================================

export interface EpicAdapter {
  /**
   * Add a child cell to an epic
   * 
   * Emits: bead_epic_child_added event
   */
  addChildToEpic(
    projectKey: string,
    epicId: string,
    childId: string,
    options?: {
      child_index?: number;
      added_by?: string;
    },
    projectPath?: string,
  ): Promise<void>;

  /**
   * Remove a child from an epic
   * 
   * Emits: bead_epic_child_removed event
   */
  removeChildFromEpic(
    projectKey: string,
    epicId: string,
    childId: string,
    options?: {
      reason?: string;
      removed_by?: string;
    },
    projectPath?: string,
  ): Promise<void>;

  /**
   * Get all children of an epic
   */
  getEpicChildren(
    projectKey: string,
    epicId: string,
    projectPath?: string,
  ): Promise<Cell[]>;

  /**
   * Check if epic is eligible for closure
   * 
   * Returns true if all children are closed
   */
  isEpicClosureEligible(
    projectKey: string,
    epicId: string,
    projectPath?: string,
  ): Promise<boolean>;
}

// ============================================================================
// Query Helpers
// ============================================================================

export interface QueryAdapter {
  /**
   * Get next ready cell (unblocked, highest priority)
   * 
   * Implements steveyegge/beads ready_issues view logic
   */
  getNextReadyCell(
    projectKey: string,
    projectPath?: string,
  ): Promise<Cell | null>;

  /**
   * Get all in-progress beads
   */
  getInProgressCells(
    projectKey: string,
    projectPath?: string,
  ): Promise<Cell[]>;

  /**
   * Get all blocked cells with their blockers
   */
  getBlockedCells(
    projectKey: string,
    projectPath?: string,
  ): Promise<Array<{ cell: Cell; blockers: string[] }>>;

  /**
   * Mark cell as dirty for JSONL export
   */
  markDirty(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<void>;

  /**
   * Get all dirty cells (for incremental export)
   */
  getDirtyCells(
    projectKey: string,
    projectPath?: string,
  ): Promise<string[]>;

  /**
   * Clear dirty flag after export
   */
  clearDirty(
    projectKey: string,
    cellId: string,
    projectPath?: string,
  ): Promise<void>;
}

// ============================================================================
// Session Operations (Chainlink-inspired)
// ============================================================================

/**
 * Session for tracking work continuity
 * 
 * Inspired by Chainlink's session management pattern.
 * Credit: @dollspace-gay (https://github.com/dollspace-gay/chainlink)
 */
export interface Session {
	id: number;
	project_key: string;
	started_at: number;
	ended_at: number | null;
	active_cell_id: string | null;
	handoff_notes: string | null;
	created_by: string | null;
	/** Handoff notes from previous session (convenience field) */
	previous_handoff_notes?: string | null;
}

export interface SessionAdapter {
	/**
	 * Start a new session
	 * 
	 * Returns previous session's handoff notes if available
	 */
	startSession(
		projectKey: string,
		options?: {
			active_cell_id?: string;
			created_by?: string;
		},
		projectPath?: string,
	): Promise<Session>;

	/**
	 * End the current session
	 * 
	 * Optionally save handoff notes for next session
	 */
	endSession(
		projectKey: string,
		sessionId: number,
		options?: {
			handoff_notes?: string;
		},
		projectPath?: string,
	): Promise<Session>;

	/**
	 * Get a specific session
	 */
	getSession(
		projectKey: string,
		sessionId: number,
		projectPath?: string,
	): Promise<Session | null>;

	/**
	 * Get current active session (if any)
	 */
	getCurrentSession(
		projectKey: string,
		projectPath?: string,
	): Promise<Session | null>;

	/**
	 * Get session history
	 * 
	 * Returns sessions ordered by start time (newest first)
	 */
	getSessionHistory(
		projectKey: string,
		options?: {
			limit?: number;
			offset?: number;
		},
		projectPath?: string,
	): Promise<Session[]>;
}

// ============================================================================
// Schema Operations
// ============================================================================

export interface HiveSchemaAdapter {
  /**
   * Run beads-specific migrations
   * 
   * Adds cells tables to shared libSQL database
   */
  runMigrations(projectPath?: string): Promise<void>;

  /**
   * Get cells statistics
   */
  getCellsStats(projectPath?: string): Promise<{
    total_cells: number;
    open: number;
    in_progress: number;
    blocked: number;
    closed: number;
    by_type: Record<CellType, number>;
  }>;

  /**
   * Rebuild blocked cells cache
   * 
   * Recalculates all blockers and updates blocked_cells_cache
   */
  rebuildBlockedCache(
    projectKey: string,
    projectPath?: string,
  ): Promise<void>;
}

// ============================================================================
// Combined HiveAdapter Interface
// ============================================================================

/**
 * HiveAdapter - Complete interface for hive operations
 * 
 * Combines all sub-adapters into a single interface.
 * Implementations provide a DatabaseAdapter and implement all operations.
 * 
 * This adapter shares the same PGLite database with SwarmMailAdapter.
 */
export interface HiveAdapter
  extends CellAdapter,
    DependencyAdapter,
    LabelAdapter,
    CommentAdapter,
    EpicAdapter,
    QueryAdapter,
    SessionAdapter,
    HiveSchemaAdapter {
  /**
   * Get the underlying database adapter
   * 
   * Same instance as SwarmMailAdapter uses
   */
  getDatabase(projectPath?: string): Promise<DatabaseAdapter>;

  /**
   * Close the database connection
   * 
   * Note: This is shared with SwarmMailAdapter, so closing should be coordinated
   */
  close(projectPath?: string): Promise<void>;

  /**
   * Close all database connections
   */
  closeAll(): Promise<void>;
}

// ============================================================================
// Factory Function Type
// ============================================================================

/**
 * HiveAdapterFactory - Function that creates a HiveAdapter instance
 * 
 * Adapters export a factory function with this signature.
 * 
 * @example
 * ```typescript
 * import { createLibSQLHiveAdapter } from '@opencode/swarm-mail/adapters/libsql-hive';
 * 
 * const adapter = createLibSQLHiveAdapter({ path: './streams.db' });
 * ```
 */
export type HiveAdapterFactory = (config: {
  path?: string;
  timeout?: number;
}) => HiveAdapter;

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================

/**
 * @deprecated Use Cell instead
 */
export type Bead = Cell;

/**
 * @deprecated Use CellAdapter instead
 */
export type BeadAdapter = CellAdapter;

/**
 * @deprecated Use CellComment instead
 */
export type BeadComment = CellComment;

/**
 * @deprecated Use CellDependency instead
 */
export type BeadDependency = CellDependency;

/**
 * @deprecated Use CellLabel instead
 */
export type BeadLabel = CellLabel;

/**
 * @deprecated Use HiveAdapter instead
 */
export type BeadsAdapter = HiveAdapter;

/**
 * @deprecated Use HiveAdapterFactory instead
 */
export type BeadsAdapterFactory = HiveAdapterFactory;

/**
 * @deprecated Use HiveSchemaAdapter instead
 */
export type BeadsSchemaAdapter = HiveSchemaAdapter;

/**
 * @deprecated Use CellStatus instead
 */
export type BeadStatus = CellStatus;

/**
 * @deprecated Use CellType instead
 */
export type BeadType = CellType;

/**
 * @deprecated Use CreateCellOptions instead
 */
export type CreateBeadOptions = CreateCellOptions;

/**
 * @deprecated Use UpdateCellOptions instead
 */
export type UpdateBeadOptions = UpdateCellOptions;

/**
 * @deprecated Use QueryCellsOptions instead
 */
export type QueryBeadsOptions = QueryCellsOptions;
