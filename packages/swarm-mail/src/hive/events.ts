/**
 * Cell Event Types - Minimal type definitions for swarm-mail
 *
 * These are simplified type definitions that match the cell-events from
 * opencode-swarm-plugin but avoid cross-package TypeScript imports.
 *
 * The actual event schemas with Zod validation live in:
 * packages/opencode-swarm-plugin/src/schemas/cell-events.ts
 *
 * This file provides just enough type information for the store to work.
 */

/**
 * Base cell event (all events extend this)
 */
export interface BaseCellEvent {
  id?: number;
  type: string;
  project_key: string;
  cell_id: string;
  timestamp: number;
  sequence?: number;
}

/**
 * Union of all cell event types
 * 
 * This matches the discriminated union in cell-events.ts but as pure TypeScript
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
// Lifecycle Events
// ============================================================================

export interface CellCreatedEvent extends BaseCellEvent {
  type: "cell_created";
  title: string;
  description?: string;
  issue_type: "bug" | "feature" | "task" | "epic" | "chore";
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
  from_status: "open" | "in_progress" | "blocked" | "closed" | "tombstone";
  to_status: "open" | "in_progress" | "blocked" | "closed" | "tombstone";
  changed_by?: string;
  reason?: string;
}

export interface CellClosedEvent extends BaseCellEvent {
  type: "cell_closed";
  reason: string;
  closed_by?: string;
  files_touched?: string[];
  duration_ms?: number;
  /** Implementation summary - what was actually done (like a PR description) */
  result?: string;
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
  dependency: {
    target: string;
    type: "blocks" | "blocked-by" | "related" | "discovered-from";
  };
  added_by?: string;
  reason?: string;
}

export interface CellDependencyRemovedEvent extends BaseCellEvent {
  type: "cell_dependency_removed";
  dependency: {
    target: string;
    type: "blocks" | "blocked-by" | "related" | "discovered-from";
  };
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
