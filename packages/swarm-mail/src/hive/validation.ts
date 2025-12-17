/**
 * Bead Validation - Port of steveyegge/beads internal/validation/bead.go
 *
 * Implements validation rules from steveyegge/beads internal/types/types.go Validate() method.
 *
 * ## Business Rules
 * - Title required, max 500 chars
 * - Priority 0-4 (0=critical, 4=low)
 * - Valid status: open, in_progress, blocked, closed, tombstone
 * - Valid type: bug, feature, task, epic, chore, message
 * - closed_at only when status=closed
 * - deleted_at required when status=tombstone
 * - Status transitions enforce state machine
 *
 * ## Status Transition Rules
 * - open -> in_progress, blocked, closed
 * - in_progress -> open, blocked, closed
 * - blocked -> open, in_progress, closed
 * - closed -> open (reopen only)
 * - tombstone -> (no transitions, permanent)
 *
 * Direct transitions to tombstone are prohibited - use delete operation instead.
 */

import type { CellStatus, CellType } from "../types/hive-adapter.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface CreateCellOptions {
  title: string;
  type: CellType;
  priority?: number;
  description?: string;
  parent_id?: string;
  assignee?: string;
  created_by?: string;
}

export interface UpdateCellOptions {
  title?: string;
  description?: string;
  priority?: number;
  assignee?: string;
}

/**
 * Validate bead creation options
 *
 * @param options - Bead creation options
 * @returns Validation result with errors if invalid
 */
export function validateCreateBead(
  options: CreateCellOptions,
): ValidationResult {
  const errors: string[] = [];

  // Title validation
  if (!options.title || options.title.trim().length === 0) {
    errors.push("title is required");
  } else if (options.title.length > 500) {
    errors.push(
      `title must be 500 characters or less (got ${options.title.length})`,
    );
  }

  // Priority validation (default to 2 if not provided)
  const priority = options.priority ?? 2;
  if (priority < 0 || priority > 4) {
    errors.push("priority must be between 0 and 4");
  }

  // Type validation
  const validTypes: CellType[] = [
    "bug",
    "feature",
    "task",
    "epic",
    "chore",
    "message",
  ];
  if (!validTypes.includes(options.type)) {
    errors.push(`invalid issue type: ${options.type}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate bead update options
 *
 * @param options - Bead update options
 * @returns Validation result with errors if invalid
 */
export function validateUpdateBead(
  options: UpdateCellOptions,
): ValidationResult {
  const errors: string[] = [];

  // Title validation (if provided)
  if (options.title !== undefined) {
    if (options.title.trim().length === 0) {
      errors.push("title is required");
    } else if (options.title.length > 500) {
      errors.push(
        `title must be 500 characters or less (got ${options.title.length})`,
      );
    }
  }

  // Priority validation (if provided)
  if (options.priority !== undefined) {
    if (options.priority < 0 || options.priority > 4) {
      errors.push("priority must be between 0 and 4");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate status transition
 *
 * Enforces state machine rules:
 * - open -> in_progress, blocked, closed
 * - in_progress -> open, blocked, closed
 * - blocked -> open, in_progress, closed
 * - closed -> open (reopen only)
 * - tombstone -> (no transitions, permanent)
 *
 * Direct transitions to tombstone are prohibited - use delete operation.
 *
 * @param currentStatus - Current bead status
 * @param newStatus - Target status
 * @returns Validation result with errors if invalid
 */
export function validateStatusTransition(
  currentStatus: CellStatus,
  newStatus: CellStatus,
): ValidationResult {
  const errors: string[] = [];

  // No-op transitions are always valid
  if (currentStatus === newStatus) {
    return { valid: true, errors: [] };
  }

  // Tombstone is permanent - no transitions allowed
  if (currentStatus === "tombstone") {
    errors.push(
      "cannot transition from tombstone (deleted beads are permanent)",
    );
    return { valid: false, errors };
  }

  // Define valid transitions
  const validTransitions: Record<CellStatus, CellStatus[]> = {
    open: ["in_progress", "blocked", "closed"],
    in_progress: ["open", "blocked", "closed"],
    blocked: ["open", "in_progress", "closed"],
    closed: ["open", "tombstone"], // reopen or delete
    tombstone: [], // permanent state
  };

  // Check if transition is valid
  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    // Special error messages for common mistakes
    if (newStatus === "tombstone") {
      errors.push(
        "cannot transition directly to tombstone - use delete operation instead",
      );
    } else if (currentStatus === "closed" && newStatus === "in_progress") {
      errors.push(
        "must reopen before changing to in_progress (closed -> open -> in_progress)",
      );
    } else {
      errors.push(
        `invalid status transition: ${currentStatus} -> ${newStatus}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
