/**
 * Shared type definitions for opencode-swarm packages
 *
 * These types are used by both swarm-mail and opencode-swarm-plugin
 * to ensure consistency across the monorepo.
 *
 * Pure TypeScript definitions - no runtime validation.
 * For Zod schemas, see opencode-swarm-plugin/src/schemas/
 */

// ============================================================================
// Cell Core Types
// ============================================================================

/** Valid cell statuses */
export type CellStatus = "open" | "in_progress" | "blocked" | "closed";

/** Valid cell types (issue_type in events) */
export type CellType = "bug" | "feature" | "task" | "epic" | "chore";

/**
 * Cell priority levels (0-3)
 * 0 = highest priority
 * 3 = lowest priority
 */
export type CellPriority = 0 | 1 | 2 | 3;

/** Dependency relationship types */
export type DependencyType = "blocks" | "blocked-by" | "related" | "discovered-from";

/** Dependency between cells */
export interface CellDependency {
  target: string;
  type: DependencyType;
}

// ============================================================================
// Event Base Types
// ============================================================================

/**
 * Base cell event - all events extend this
 */
export interface BaseCellEvent {
  id?: number;
  type: string;
  project_key: string;
  cell_id: string;
  timestamp: number;
  sequence?: number;
}

// ============================================================================
// Lifecycle Events
// ============================================================================

export interface CellCreatedEvent extends BaseCellEvent {
  type: "cell_created";
  title: string;
  description?: string;
  issue_type: CellType;
  priority: number;
  parent_id?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

export interface CellUpdatedEvent extends BaseCellEvent {
  type: "cell_updated";
  updated_by?: string;
  changes: {
    title?: { old: string; new: string };
    description?: { old: string; new: string };
    priority?: { old: number; new: number };
  };
}

export interface CellStatusChangedEvent extends BaseCellEvent {
  type: "cell_status_changed";
  from_status: CellStatus | "tombstone";
  to_status: CellStatus | "tombstone";
  changed_by?: string;
  reason?: string;
}

export interface CellClosedEvent extends BaseCellEvent {
  type: "cell_closed";
  reason: string;
  closed_by?: string;
  files_touched?: string[];
  duration_ms?: number;
}

export interface CellReopenedEvent extends BaseCellEvent {
  type: "cell_reopened";
  reason?: string;
  reopened_by?: string;
}

export interface CellDeletedEvent extends BaseCellEvent {
  type: "cell_deleted";
  reason?: string;
  deleted_by?: string;
}

// ============================================================================
// Dependency Events
// ============================================================================

export interface CellDependencyAddedEvent extends BaseCellEvent {
  type: "cell_dependency_added";
  dependency: CellDependency;
  added_by?: string;
  reason?: string;
}

export interface CellDependencyRemovedEvent extends BaseCellEvent {
  type: "cell_dependency_removed";
  dependency: CellDependency;
  removed_by?: string;
  reason?: string;
}

// ============================================================================
// Label Events
// ============================================================================

export interface CellLabelAddedEvent extends BaseCellEvent {
  type: "cell_label_added";
  label: string;
  added_by?: string;
}

export interface CellLabelRemovedEvent extends BaseCellEvent {
  type: "cell_label_removed";
  label: string;
  removed_by?: string;
}

// ============================================================================
// Comment Events
// ============================================================================

export interface CellCommentAddedEvent extends BaseCellEvent {
  type: "cell_comment_added";
  comment_id?: number;
  author: string;
  body: string;
  parent_comment_id?: number;
  metadata?: Record<string, unknown>;
}

export interface CellCommentUpdatedEvent extends BaseCellEvent {
  type: "cell_comment_updated";
  comment_id: number;
  old_body: string;
  new_body: string;
  updated_by: string;
}

export interface CellCommentDeletedEvent extends BaseCellEvent {
  type: "cell_comment_deleted";
  comment_id: number;
  deleted_by: string;
  reason?: string;
}

// ============================================================================
// Epic Events
// ============================================================================

export interface CellEpicChildAddedEvent extends BaseCellEvent {
  type: "cell_epic_child_added";
  child_id: string;
  child_index?: number;
  added_by?: string;
}

export interface CellEpicChildRemovedEvent extends BaseCellEvent {
  type: "cell_epic_child_removed";
  child_id: string;
  removed_by?: string;
  reason?: string;
}

export interface CellEpicClosureEligibleEvent extends BaseCellEvent {
  type: "cell_epic_closure_eligible";
  child_ids: string[];
  total_duration_ms?: number;
  all_files_touched?: string[];
}

// ============================================================================
// Swarm Integration Events
// ============================================================================

export interface CellAssignedEvent extends BaseCellEvent {
  type: "cell_assigned";
  agent_name: string;
  task_description?: string;
}

export interface CellWorkStartedEvent extends BaseCellEvent {
  type: "cell_work_started";
  agent_name: string;
  reserved_files?: string[];
}

// ============================================================================
// Maintenance Events
// ============================================================================

export interface CellCompactedEvent extends BaseCellEvent {
  type: "cell_compacted";
  events_archived: number;
  new_start_sequence: number;
}

// ============================================================================
// Event Union Type
// ============================================================================

/**
 * Union of all cell event types
 *
 * This is a discriminated union - the `type` field determines
 * which specific event interface applies.
 */
export type CellEvent =
  // Lifecycle
  | CellCreatedEvent
  | CellUpdatedEvent
  | CellStatusChangedEvent
  | CellClosedEvent
  | CellReopenedEvent
  | CellDeletedEvent
  // Dependencies
  | CellDependencyAddedEvent
  | CellDependencyRemovedEvent
  // Labels
  | CellLabelAddedEvent
  | CellLabelRemovedEvent
  // Comments
  | CellCommentAddedEvent
  | CellCommentUpdatedEvent
  | CellCommentDeletedEvent
  // Epic
  | CellEpicChildAddedEvent
  | CellEpicChildRemovedEvent
  | CellEpicClosureEligibleEvent
  // Swarm Integration
  | CellAssignedEvent
  | CellWorkStartedEvent
  // Maintenance
  | CellCompactedEvent;

// ============================================================================
// Cell Data Structures
// ============================================================================

/**
 * Core cell structure
 *
 * ID format:
 * - Standard: `{project}-{hash}` (e.g., `opencode-swarm-plugin-1i8`)
 * - Subtask: `{project}-{hash}.{index}` (e.g., `opencode-swarm-plugin-1i8.1`)
 * - Custom: `{project}-{custom-id}` (e.g., `migrate-egghead-phase-0`)
 * - Custom subtask: `{project}-{custom-id}.{suffix}` (e.g., `migrate-egghead-phase-0.e2e-test`)
 */
export interface Cell {
  id: string;
  title: string;
  description?: string;
  status: CellStatus;
  priority: number;
  issue_type: CellType;
  created_at: string;
  updated_at?: string;
  closed_at?: string;
  parent_id?: string;
  dependencies?: CellDependency[];
  metadata?: Record<string, unknown>;
}

/**
 * Subtask specification for epic decomposition
 *
 * Used when creating an epic with subtasks in one operation.
 * The `files` array is used for Agent Mail file reservations.
 */
export interface SubtaskSpec {
  title: string;
  description?: string;
  files?: string[];
  dependencies?: number[]; // Indices of other subtasks
  /**
   * Complexity estimate on 1-5 scale:
   * 1 = trivial (typo fix, simple rename)
   * 2 = simple (single function change)
   * 3 = moderate (multi-file, some coordination)
   * 4 = complex (significant refactoring)
   * 5 = very complex (architectural change)
   */
  estimated_complexity?: number;
}

/**
 * Cell tree for swarm decomposition
 *
 * Represents an epic with its subtasks, ready for spawning agents.
 */
export interface CellTree {
  epic: {
    title: string;
    description?: string;
  };
  subtasks: SubtaskSpec[];
  strategy?: "file-based" | "feature-based" | "risk-based" | "research-based";
}
