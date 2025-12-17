/**
 * Event Types for Cells Event Sourcing
 *
 * These events form an audit trail for all cell operations.
 * Events are NOT replayed for state reconstruction (cells uses hybrid CRUD + audit trail).
 * Events enable:
 * - Full audit history
 * - Debugging distributed swarm operations
 * - Learning from cell lifecycle patterns
 * - Integration with swarm-mail coordination
 *
 * Design notes:
 * - 75% reusable infrastructure from swarm-mail
 * - Events stay local (PGLite/SQLite), not written to JSONL
 * - JSONL export happens from projection snapshots (proven git merge driver)
 * - Follows same BaseEventSchema pattern as swarm-mail
 */
import { z } from "zod";
import {
  CellDependencySchema,
  CellStatusSchema,
  CellTypeSchema,
} from "./cell.js";

// ============================================================================
// Base Event Schema (mirrors swarm-mail pattern)
// ============================================================================

/**
 * Base fields present on all cell events
 */
export const BaseCellEventSchema = z.object({
  /** Auto-generated event ID */
  id: z.number().optional(),
  /** Event type discriminator */
  type: z.string(),
  /** Project key (usually absolute path) */
  project_key: z.string(),
  /** Timestamp when event occurred */
  timestamp: z.number(), // Unix ms
  /** Sequence number for ordering */
  sequence: z.number().optional(),
});

// ============================================================================
// Issue Lifecycle Events
// ============================================================================

/**
 * Cell created
 *
 * Emitted when:
 * - User calls `hive create`
 * - Swarm epic decomposition creates subtasks
 * - Agent spawns new cells during work
 */
export const CellCreatedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_created"),
  cell_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  issue_type: CellTypeSchema,
  priority: z.number().int().min(0).max(3),
  parent_id: z.string().optional(),
  /** Agent/user who created the cell */
  created_by: z.string().optional(),
  /** Metadata for tracking (e.g., epic context, swarm strategy) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Cell updated (generic field changes)
 *
 * Emitted for non-status field updates: title, description, priority
 */
export const CellUpdatedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_updated"),
  cell_id: z.string(),
  /** Agent/user who made the update */
  updated_by: z.string().optional(),
  /** Changed fields with old and new values */
  changes: z.object({
    title: z
      .object({
        old: z.string(),
        new: z.string(),
      })
      .optional(),
    description: z
      .object({
        old: z.string(),
        new: z.string(),
      })
      .optional(),
    priority: z
      .object({
        old: z.number(),
        new: z.number(),
      })
      .optional(),
  }),
});

/**
 * Cell status changed
 *
 * Separate event for status transitions to enable workflow analysis.
 * Tracks state machine: open → in_progress → (blocked | closed)
 */
export const CellStatusChangedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_status_changed"),
  cell_id: z.string(),
  from_status: CellStatusSchema,
  to_status: CellStatusSchema,
  /** Agent/user who changed status */
  changed_by: z.string().optional(),
  /** Optional reason (required for closed status) */
  reason: z.string().optional(),
});

/**
 * Cell closed
 *
 * Explicit close event (subset of status_changed for convenience).
 * Includes closure reason for audit trail.
 */
export const CellClosedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_closed"),
  cell_id: z.string(),
  reason: z.string(),
  /** Agent/user who closed */
  closed_by: z.string().optional(),
  /** Files touched during work (from swarm completion) */
  files_touched: z.array(z.string()).optional(),
  /** Duration in ms (if tracked by agent) */
  duration_ms: z.number().optional(),
});

/**
 * Cell reopened
 *
 * Emitted when closed cell is reopened.
 */
export const CellReopenedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_reopened"),
  cell_id: z.string(),
  reason: z.string().optional(),
  /** Agent/user who reopened */
  reopened_by: z.string().optional(),
});

/**
 * Cell deleted
 *
 * Hard delete event (rare - cells are usually closed, not deleted).
 * Useful for cleaning up spurious/duplicate cells.
 */
export const CellDeletedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_deleted"),
  cell_id: z.string(),
  reason: z.string().optional(),
  /** Agent/user who deleted */
  deleted_by: z.string().optional(),
});

// ============================================================================
// Dependency Events
// ============================================================================

/**
 * Dependency added between cells
 *
 * Supports 4 relationship types:
 * - blocks: This cell blocks the target
 * - blocked-by: This cell is blocked by the target
 * - related: Informational link
 * - discovered-from: Cell spawned from investigation of target
 */
export const CellDependencyAddedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_dependency_added"),
  cell_id: z.string(),
  /** Dependency relationship */
  dependency: CellDependencySchema,
  /** Agent/user who added dependency */
  added_by: z.string().optional(),
  /** Optional reason (e.g., "needs auth service before OAuth implementation") */
  reason: z.string().optional(),
});

/**
 * Dependency removed
 *
 * Emitted when dependency is no longer relevant or was added in error.
 */
export const CellDependencyRemovedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_dependency_removed"),
  cell_id: z.string(),
  /** Dependency being removed */
  dependency: CellDependencySchema,
  /** Agent/user who removed */
  removed_by: z.string().optional(),
  reason: z.string().optional(),
});

// ============================================================================
// Label Events
// ============================================================================

/**
 * Label added to cell
 *
 * Labels are string tags for categorization/filtering.
 * Common labels: "p0", "needs-review", "blocked-external", "tech-debt"
 */
export const CellLabelAddedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_label_added"),
  cell_id: z.string(),
  label: z.string(),
  /** Agent/user who added label */
  added_by: z.string().optional(),
});

/**
 * Label removed from cell
 */
export const CellLabelRemovedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_label_removed"),
  cell_id: z.string(),
  label: z.string(),
  /** Agent/user who removed label */
  removed_by: z.string().optional(),
});

// ============================================================================
// Comment Events
// ============================================================================

/**
 * Comment added to cell
 *
 * Supports agent-to-agent communication, human notes, and progress updates.
 */
export const CellCommentAddedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_comment_added"),
  cell_id: z.string(),
  /** Auto-generated comment ID */
  comment_id: z.number().optional(),
  author: z.string(),
  body: z.string(),
  /** Optional parent comment ID for threading */
  parent_comment_id: z.number().optional(),
  /** Comment metadata (e.g., attachments, mentions) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Comment updated (edit)
 */
export const CellCommentUpdatedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_comment_updated"),
  cell_id: z.string(),
  comment_id: z.number(),
  old_body: z.string(),
  new_body: z.string(),
  updated_by: z.string(),
});

/**
 * Comment deleted
 */
export const CellCommentDeletedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_comment_deleted"),
  cell_id: z.string(),
  comment_id: z.number(),
  deleted_by: z.string(),
  reason: z.string().optional(),
});

// ============================================================================
// Epic Events
// ============================================================================

/**
 * Child cell added to epic
 *
 * Emitted when:
 * - Epic created with subtasks (batch event for each child)
 * - User manually adds child via `hive add-child`
 * - Agent spawns additional subtask during work
 */
export const CellEpicChildAddedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_epic_child_added"),
  /** Epic ID */
  cell_id: z.string(),
  /** Child cell ID */
  child_id: z.string(),
  /** Optional index for ordering */
  child_index: z.number().optional(),
  added_by: z.string().optional(),
});

/**
 * Child cell removed from epic
 *
 * Rare - usually happens when subtask is merged/consolidated.
 */
export const CellEpicChildRemovedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_epic_child_removed"),
  /** Epic ID */
  cell_id: z.string(),
  /** Child cell ID */
  child_id: z.string(),
  removed_by: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * Epic eligible for closure
 *
 * Emitted when all child cells are closed.
 * Triggers coordinator review for epic closure.
 */
export const CellEpicClosureEligibleEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_epic_closure_eligible"),
  cell_id: z.string(),
  /** Child cell IDs (all closed) */
  child_ids: z.array(z.string()),
  /** Total duration across all children */
  total_duration_ms: z.number().optional(),
  /** Aggregate file changes */
  all_files_touched: z.array(z.string()).optional(),
});

// ============================================================================
// Swarm Integration Events (bridge to swarm-mail)
// ============================================================================

/**
 * Cell assigned to agent
 *
 * Links cells to swarm-mail's agent tracking.
 * Emitted when agent calls `cells_start` or swarm spawns worker.
 */
export const CellAssignedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_assigned"),
  cell_id: z.string(),
  agent_name: z.string(),
  /** Agent's task description for context */
  task_description: z.string().optional(),
});

/**
 * Cell work started
 *
 * Separate from status change to track actual work start time.
 * Useful for duration/velocity metrics.
 */
export const CellWorkStartedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_work_started"),
  cell_id: z.string(),
  agent_name: z.string(),
  /** Files reserved for this work */
  reserved_files: z.array(z.string()).optional(),
});

/**
 * Cell compacted
 *
 * Emitted when cell's event history is compressed (rare).
 * Follows steveyegge/beads pattern - old events archived, projection preserved.
 */
export const CellCompactedEventSchema = BaseCellEventSchema.extend({
  type: z.literal("cell_compacted"),
  cell_id: z.string(),
  /** Number of events archived */
  events_archived: z.number(),
  /** New event store start sequence */
  new_start_sequence: z.number(),
});

// ============================================================================
// Union Type
// ============================================================================

export const CellEventSchema = z.discriminatedUnion("type", [
  // Lifecycle
  CellCreatedEventSchema,
  CellUpdatedEventSchema,
  CellStatusChangedEventSchema,
  CellClosedEventSchema,
  CellReopenedEventSchema,
  CellDeletedEventSchema,

  // Dependencies
  CellDependencyAddedEventSchema,
  CellDependencyRemovedEventSchema,

  // Labels
  CellLabelAddedEventSchema,
  CellLabelRemovedEventSchema,

  // Comments
  CellCommentAddedEventSchema,
  CellCommentUpdatedEventSchema,
  CellCommentDeletedEventSchema,

  // Epic
  CellEpicChildAddedEventSchema,
  CellEpicChildRemovedEventSchema,
  CellEpicClosureEligibleEventSchema,

  // Swarm Integration
  CellAssignedEventSchema,
  CellWorkStartedEventSchema,

  // Maintenance
  CellCompactedEventSchema,
]);

export type CellEvent = z.infer<typeof CellEventSchema>;

// ============================================================================
// Individual event types for convenience
// ============================================================================

export type CellCreatedEvent = z.infer<typeof CellCreatedEventSchema>;
export type CellUpdatedEvent = z.infer<typeof CellUpdatedEventSchema>;
export type CellStatusChangedEvent = z.infer<
  typeof CellStatusChangedEventSchema
>;
export type CellClosedEvent = z.infer<typeof CellClosedEventSchema>;
export type CellReopenedEvent = z.infer<typeof CellReopenedEventSchema>;
export type CellDeletedEvent = z.infer<typeof CellDeletedEventSchema>;
export type CellDependencyAddedEvent = z.infer<
  typeof CellDependencyAddedEventSchema
>;
export type CellDependencyRemovedEvent = z.infer<
  typeof CellDependencyRemovedEventSchema
>;
export type CellLabelAddedEvent = z.infer<typeof CellLabelAddedEventSchema>;
export type CellLabelRemovedEvent = z.infer<typeof CellLabelRemovedEventSchema>;
export type CellCommentAddedEvent = z.infer<typeof CellCommentAddedEventSchema>;
export type CellCommentUpdatedEvent = z.infer<
  typeof CellCommentUpdatedEventSchema
>;
export type CellCommentDeletedEvent = z.infer<
  typeof CellCommentDeletedEventSchema
>;
export type CellEpicChildAddedEvent = z.infer<
  typeof CellEpicChildAddedEventSchema
>;
export type CellEpicChildRemovedEvent = z.infer<
  typeof CellEpicChildRemovedEventSchema
>;
export type CellEpicClosureEligibleEvent = z.infer<
  typeof CellEpicClosureEligibleEventSchema
>;
export type CellAssignedEvent = z.infer<typeof CellAssignedEventSchema>;
export type CellWorkStartedEvent = z.infer<typeof CellWorkStartedEventSchema>;
export type CellCompactedEvent = z.infer<typeof CellCompactedEventSchema>;

// ============================================================================
// Event Helpers
// ============================================================================

/**
 * Create a cell event with timestamp and validate
 *
 * Usage:
 * ```typescript
 * const event = createCellEvent("cell_created", {
 *   project_key: "/path/to/repo",
 *   cell_id: "bd-123",
 *   title: "Add auth",
 *   issue_type: "feature",
 *   priority: 2
 * });
 * ```
 */
export function createCellEvent<T extends CellEvent["type"]>(
  type: T,
  data: Omit<
    Extract<CellEvent, { type: T }>,
    "type" | "timestamp" | "id" | "sequence"
  >,
): Extract<CellEvent, { type: T }> {
  const event = {
    type,
    timestamp: Date.now(),
    ...data,
  } as Extract<CellEvent, { type: T }>;

  // Validate
  const result = CellEventSchema.safeParse(event);
  if (!result.success) {
    throw new Error(`Invalid cell event: ${result.error.message}`);
  }

  return result.data as Extract<CellEvent, { type: T }>;
}

/**
 * Type guard for specific cell event types
 *
 * Usage:
 * ```typescript
 * if (isCellEventType(event, "cell_closed")) {
 *   console.log(event.reason); // TypeScript knows this is CellClosedEvent
 * }
 * ```
 */
export function isCellEventType<T extends CellEvent["type"]>(
  event: CellEvent,
  type: T,
): event is Extract<CellEvent, { type: T }> {
  return event.type === type;
}

/**
 * Extract cell ID from event (convenience helper)
 *
 * All cell events have cell_id field (or it's the epic's cell_id for epic events).
 */
export function getCellIdFromEvent(event: CellEvent): string {
  return event.cell_id;
}

/**
 * Check if event represents a state transition
 */
export function isStateTransitionEvent(
  event: CellEvent,
): event is CellStatusChangedEvent | CellClosedEvent | CellReopenedEvent {
  return (
    event.type === "cell_status_changed" ||
    event.type === "cell_closed" ||
    event.type === "cell_reopened"
  );
}

/**
 * Check if event represents an epic operation
 */
export function isEpicEvent(
  event: CellEvent,
): event is
  | CellEpicChildAddedEvent
  | CellEpicChildRemovedEvent
  | CellEpicClosureEligibleEvent {
  return (
    event.type === "cell_epic_child_added" ||
    event.type === "cell_epic_child_removed" ||
    event.type === "cell_epic_closure_eligible"
  );
}

/**
 * Check if event was triggered by an agent (vs human user)
 */
export function isAgentEvent(event: CellEvent): boolean {
  // Agent events have agent_name field or *_by field containing agent signature
  if ("agent_name" in event) return true;

  const actorFields = [
    "created_by",
    "updated_by",
    "changed_by",
    "closed_by",
    "deleted_by",
    "added_by",
    "removed_by",
    "reopened_by",
  ] as const;

  return actorFields.some((field) => {
    if (field in event) {
      const value = (event as Record<string, unknown>)[field];
      // Agent names are typically lowercase or have specific patterns
      return typeof value === "string" && /^[a-z]+$/i.test(value);
    }
    return false;
  });
}

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================

/**
 * @deprecated Use BaseCellEventSchema instead
 */
export const BaseBeadEventSchema = BaseCellEventSchema;

/**
 * @deprecated Use CellCreatedEventSchema instead
 */
export const BeadCreatedEventSchema = CellCreatedEventSchema;

/**
 * @deprecated Use CellUpdatedEventSchema instead
 */
export const BeadUpdatedEventSchema = CellUpdatedEventSchema;

/**
 * @deprecated Use CellStatusChangedEventSchema instead
 */
export const BeadStatusChangedEventSchema = CellStatusChangedEventSchema;

/**
 * @deprecated Use CellClosedEventSchema instead
 */
export const BeadClosedEventSchema = CellClosedEventSchema;

/**
 * @deprecated Use CellReopenedEventSchema instead
 */
export const BeadReopenedEventSchema = CellReopenedEventSchema;

/**
 * @deprecated Use CellDeletedEventSchema instead
 */
export const BeadDeletedEventSchema = CellDeletedEventSchema;

/**
 * @deprecated Use CellDependencyAddedEventSchema instead
 */
export const BeadDependencyAddedEventSchema = CellDependencyAddedEventSchema;

/**
 * @deprecated Use CellDependencyRemovedEventSchema instead
 */
export const BeadDependencyRemovedEventSchema = CellDependencyRemovedEventSchema;

/**
 * @deprecated Use CellLabelAddedEventSchema instead
 */
export const BeadLabelAddedEventSchema = CellLabelAddedEventSchema;

/**
 * @deprecated Use CellLabelRemovedEventSchema instead
 */
export const BeadLabelRemovedEventSchema = CellLabelRemovedEventSchema;

/**
 * @deprecated Use CellCommentAddedEventSchema instead
 */
export const BeadCommentAddedEventSchema = CellCommentAddedEventSchema;

/**
 * @deprecated Use CellCommentUpdatedEventSchema instead
 */
export const BeadCommentUpdatedEventSchema = CellCommentUpdatedEventSchema;

/**
 * @deprecated Use CellCommentDeletedEventSchema instead
 */
export const BeadCommentDeletedEventSchema = CellCommentDeletedEventSchema;

/**
 * @deprecated Use CellEpicChildAddedEventSchema instead
 */
export const BeadEpicChildAddedEventSchema = CellEpicChildAddedEventSchema;

/**
 * @deprecated Use CellEpicChildRemovedEventSchema instead
 */
export const BeadEpicChildRemovedEventSchema = CellEpicChildRemovedEventSchema;

/**
 * @deprecated Use CellEpicClosureEligibleEventSchema instead
 */
export const BeadEpicClosureEligibleEventSchema = CellEpicClosureEligibleEventSchema;

/**
 * @deprecated Use CellAssignedEventSchema instead
 */
export const BeadAssignedEventSchema = CellAssignedEventSchema;

/**
 * @deprecated Use CellWorkStartedEventSchema instead
 */
export const BeadWorkStartedEventSchema = CellWorkStartedEventSchema;

/**
 * @deprecated Use CellCompactedEventSchema instead
 */
export const BeadCompactedEventSchema = CellCompactedEventSchema;

/**
 * @deprecated Use CellEventSchema instead
 */
export const BeadEventSchema = CellEventSchema;

/**
 * @deprecated Use CellEvent instead
 */
export type BeadEvent = CellEvent;

/**
 * @deprecated Use CellCreatedEvent instead
 */
export type BeadCreatedEvent = CellCreatedEvent;

/**
 * @deprecated Use CellUpdatedEvent instead
 */
export type BeadUpdatedEvent = CellUpdatedEvent;

/**
 * @deprecated Use CellStatusChangedEvent instead
 */
export type BeadStatusChangedEvent = CellStatusChangedEvent;

/**
 * @deprecated Use CellClosedEvent instead
 */
export type BeadClosedEvent = CellClosedEvent;

/**
 * @deprecated Use CellReopenedEvent instead
 */
export type BeadReopenedEvent = CellReopenedEvent;

/**
 * @deprecated Use CellDeletedEvent instead
 */
export type BeadDeletedEvent = CellDeletedEvent;

/**
 * @deprecated Use CellDependencyAddedEvent instead
 */
export type BeadDependencyAddedEvent = CellDependencyAddedEvent;

/**
 * @deprecated Use CellDependencyRemovedEvent instead
 */
export type BeadDependencyRemovedEvent = CellDependencyRemovedEvent;

/**
 * @deprecated Use CellLabelAddedEvent instead
 */
export type BeadLabelAddedEvent = CellLabelAddedEvent;

/**
 * @deprecated Use CellLabelRemovedEvent instead
 */
export type BeadLabelRemovedEvent = CellLabelRemovedEvent;

/**
 * @deprecated Use CellCommentAddedEvent instead
 */
export type BeadCommentAddedEvent = CellCommentAddedEvent;

/**
 * @deprecated Use CellCommentUpdatedEvent instead
 */
export type BeadCommentUpdatedEvent = CellCommentUpdatedEvent;

/**
 * @deprecated Use CellCommentDeletedEvent instead
 */
export type BeadCommentDeletedEvent = CellCommentDeletedEvent;

/**
 * @deprecated Use CellEpicChildAddedEvent instead
 */
export type BeadEpicChildAddedEvent = CellEpicChildAddedEvent;

/**
 * @deprecated Use CellEpicChildRemovedEvent instead
 */
export type BeadEpicChildRemovedEvent = CellEpicChildRemovedEvent;

/**
 * @deprecated Use CellEpicClosureEligibleEvent instead
 */
export type BeadEpicClosureEligibleEvent = CellEpicClosureEligibleEvent;

/**
 * @deprecated Use CellAssignedEvent instead
 */
export type BeadAssignedEvent = CellAssignedEvent;

/**
 * @deprecated Use CellWorkStartedEvent instead
 */
export type BeadWorkStartedEvent = CellWorkStartedEvent;

/**
 * @deprecated Use CellCompactedEvent instead
 */
export type BeadCompactedEvent = CellCompactedEvent;

/**
 * @deprecated Use createCellEvent instead
 */
export const createBeadEvent = createCellEvent;

/**
 * @deprecated Use isCellEventType instead
 */
export const isBeadEventType = isCellEventType;

/**
 * @deprecated Use getCellIdFromEvent instead
 */
export const getBeadIdFromEvent = getCellIdFromEvent;
