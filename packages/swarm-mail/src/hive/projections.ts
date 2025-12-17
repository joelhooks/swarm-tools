/**
 * Beads Projections Layer - Update and query materialized views
 *
 * Projections are the read-side of CQRS. They update denormalized
 * materialized views when events are appended, and provide query methods.
 *
 * ## Architecture
 * - Event store is source of truth (write side)
 * - Projections are cached views (read side)
 * - Events trigger projection updates
 * - Queries read from projections (fast)
 *
 * ## Key projections:
 * - beads table: Main bead records
 * - bead_dependencies: Dependency relationships
 * - bead_labels: String tags
 * - bead_comments: Comments/notes
 * - blocked_beads_cache: Cached blocker lookups
 * - dirty_beads: Tracks changes for export
 *
 * @module beads/projections
 */

import type { DatabaseAdapter } from "../types/database.js";
import type {
  Cell,
  CellComment,
  CellDependency,
  CellLabel,
  CellStatus,
  CellType,
  QueryCellsOptions,
} from "../types/hive-adapter.js";

// Re-import event types (will be from opencode-swarm-plugin)
// For now, define minimal types for projection updates
type CellEvent = {
  type: string;
  project_key: string;
  cell_id: string;
  timestamp: number;
  [key: string]: unknown;
};

// ============================================================================
// Event Handler - Main entry point for updating projections
// ============================================================================

/**
 * Update projections based on an event
 *
 * This is called by the event store after appending an event.
 * Routes to specific handlers based on event type.
 */
export async function updateProjections(
  db: DatabaseAdapter,
  event: CellEvent,
): Promise<void> {


  switch (event.type) {
    case "cell_created":
      await handleBeadCreated(db, event);
      break;
    case "cell_updated":
      await handleBeadUpdated(db, event);
      break;
    case "cell_status_changed":
      await handleCellStatusChanged(db, event);
      break;
    case "cell_closed":
      await handleBeadClosed(db, event);
      break;
    case "cell_reopened":
      await handleBeadReopened(db, event);
      break;
    case "cell_deleted":
      await handleBeadDeleted(db, event);
      break;
    case "cell_dependency_added":
      await handleDependencyAdded(db, event);
      break;
    case "cell_dependency_removed":
      await handleDependencyRemoved(db, event);
      break;
    case "cell_label_added":
      await handleLabelAdded(db, event);
      break;
    case "cell_label_removed":
      await handleLabelRemoved(db, event);
      break;
    case "cell_comment_added":
      await handleCommentAdded(db, event);
      break;
    case "cell_comment_updated":
      await handleCommentUpdated(db, event);
      break;
    case "cell_comment_deleted":
      await handleCommentDeleted(db, event);
      break;
    case "cell_epic_child_added":
      await handleEpicChildAdded(db, event);
      break;
    case "cell_epic_child_removed":
      await handleEpicChildRemoved(db, event);
      break;
    case "cell_assigned":
      await handleBeadAssigned(db, event);
      break;
    case "cell_work_started":
      await handleWorkStarted(db, event);
      break;
    default:
      console.warn(`[beads/projections] Unknown event type: ${event.type}`);
  }

  // Mark bead as dirty for JSONL export
  await markBeadDirty(db, event.project_key, event.cell_id);
}

// ============================================================================
// Event Handlers - Individual handlers for each event type
// ============================================================================

async function handleBeadCreated(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `INSERT INTO beads (
      id, project_key, type, status, title, description, priority,
      parent_id, assignee, created_at, updated_at, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      event.cell_id,
      event.project_key,
      event.issue_type,
      "open",
      event.title,
      event.description || null,
      event.priority ?? 2,
      event.parent_id || null,
      null, // assignee (set later via bead_assigned)
      event.timestamp,
      event.timestamp,
      event.created_by || null,
    ],
  );
}

async function handleBeadUpdated(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  const changes = event.changes as Record<string, { old: unknown; new: unknown }>;
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (changes.title) {
    updates.push(`title = $${paramIndex++}`);
    params.push(changes.title.new);
  }
  if (changes.description) {
    updates.push(`description = $${paramIndex++}`);
    params.push(changes.description.new);
  }
  if (changes.priority) {
    updates.push(`priority = $${paramIndex++}`);
    params.push(changes.priority.new);
  }
  if (changes.assignee) {
    updates.push(`assignee = $${paramIndex++}`);
    params.push(changes.assignee.new);
  }

  if (updates.length > 0) {
    updates.push(`updated_at = $${paramIndex++}`);
    params.push(event.timestamp);
    params.push(event.cell_id);

    await db.query(
      `UPDATE beads SET ${updates.join(", ")} WHERE id = $${paramIndex}`,
      params,
    );
  }
}

async function handleCellStatusChanged(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `UPDATE beads SET status = $1, updated_at = $2 WHERE id = $3`,
    [event.to_status, event.timestamp, event.cell_id],
  );
}

async function handleBeadClosed(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `UPDATE beads SET 
      status = 'closed', 
      closed_at = $1, 
      closed_reason = $2, 
      updated_at = $3 
    WHERE id = $4`,
    [event.timestamp, event.reason, event.timestamp, event.cell_id],
  );

  // Invalidate blocked cache for dependents (beads that were blocked by this one)
  const { invalidateBlockedCache } = await import("./dependencies.js");
  await invalidateBlockedCache(db, event.project_key, event.cell_id);
}

async function handleBeadReopened(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `UPDATE beads SET 
      status = 'open', 
      closed_at = NULL, 
      closed_reason = NULL, 
      updated_at = $1 
    WHERE id = $2`,
    [event.timestamp, event.cell_id],
  );
}

async function handleBeadDeleted(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `UPDATE beads SET 
      deleted_at = $1, 
      deleted_by = $2, 
      delete_reason = $3, 
      updated_at = $4 
    WHERE id = $5`,
    [event.timestamp, event.deleted_by || null, event.reason || null, event.timestamp, event.cell_id],
  );
}

async function handleDependencyAdded(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  const dep = event.dependency as { target: string; type: string };
  await db.query(
    `INSERT INTO bead_dependencies (cell_id, depends_on_id, relationship, created_at, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cell_id, depends_on_id, relationship) DO NOTHING`,
    [event.cell_id, dep.target, dep.type, event.timestamp, event.added_by || null],
  );

  // Invalidate blocked cache (import at runtime)
  const { invalidateBlockedCache: invalidate } = await import("./dependencies.js");
  await invalidate(db, event.project_key, event.cell_id);
}

async function handleDependencyRemoved(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  const dep = event.dependency as { target: string; type: string };
  await db.query(
    `DELETE FROM bead_dependencies 
     WHERE cell_id = $1 AND depends_on_id = $2 AND relationship = $3`,
    [event.cell_id, dep.target, dep.type],
  );

  // Invalidate blocked cache (import at runtime)
  const { invalidateBlockedCache: invalidate } = await import("./dependencies.js");
  await invalidate(db, event.project_key, event.cell_id);
}

async function handleLabelAdded(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `INSERT INTO bead_labels (cell_id, label, created_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (cell_id, label) DO NOTHING`,
    [event.cell_id, event.label, event.timestamp],
  );
}

async function handleLabelRemoved(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `DELETE FROM bead_labels WHERE cell_id = $1 AND label = $2`,
    [event.cell_id, event.label],
  );
}

async function handleCommentAdded(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `INSERT INTO bead_comments (cell_id, author, body, parent_id, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [event.cell_id, event.author, event.body, event.parent_comment_id || null, event.timestamp],
  );
}

async function handleCommentUpdated(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `UPDATE bead_comments SET body = $1, updated_at = $2 WHERE id = $3`,
    [event.new_body, event.timestamp, event.comment_id],
  );
}

async function handleCommentDeleted(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `DELETE FROM bead_comments WHERE id = $1`,
    [event.comment_id],
  );
}

async function handleEpicChildAdded(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  // Update parent_id on child bead
  await db.query(
    `UPDATE beads SET parent_id = $1, updated_at = $2 WHERE id = $3`,
    [event.cell_id, event.timestamp, event.child_id],
  );
}

async function handleEpicChildRemoved(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  // Clear parent_id on child bead
  await db.query(
    `UPDATE beads SET parent_id = NULL, updated_at = $1 WHERE id = $2`,
    [event.timestamp, event.child_id],
  );
}

async function handleBeadAssigned(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `UPDATE beads SET assignee = $1, updated_at = $2 WHERE id = $3`,
    [event.assignee, event.timestamp, event.cell_id],
  );
}

async function handleWorkStarted(db: DatabaseAdapter, event: CellEvent): Promise<void> {
  await db.query(
    `UPDATE beads SET status = 'in_progress', updated_at = $1 WHERE id = $2`,
    [event.timestamp, event.cell_id],
  );
}

// ============================================================================
// Query Functions - Read from projections
// ============================================================================

/**
 * Get a bead by ID
 */
export async function getCell(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<Cell | null> {
  const result = await db.query<Cell>(
    `SELECT * FROM beads WHERE project_key = $1 AND id = $2 AND deleted_at IS NULL`,
    [projectKey, cellId],
  );
  return result.rows[0] ?? null;
}

/**
 * Query beads with filters
 */
export async function queryCells(
  db: DatabaseAdapter,
  projectKey: string,
  options: QueryCellsOptions = {},
): Promise<Cell[]> {
  const conditions: string[] = ["project_key = $1"];
  const params: unknown[] = [projectKey];
  let paramIndex = 2;

  if (!options.include_deleted) {
    conditions.push("deleted_at IS NULL");
  }

  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    conditions.push(`status = ANY($${paramIndex++})`);
    params.push(statuses);
  }

  if (options.type) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    conditions.push(`type = ANY($${paramIndex++})`);
    params.push(types);
  }

  if (options.parent_id) {
    conditions.push(`parent_id = $${paramIndex++}`);
    params.push(options.parent_id);
  }

  if (options.assignee) {
    conditions.push(`assignee = $${paramIndex++}`);
    params.push(options.assignee);
  }

  let query = `SELECT * FROM beads WHERE ${conditions.join(" AND ")} ORDER BY priority DESC, created_at ASC`;

  if (options.limit) {
    query += ` LIMIT $${paramIndex++}`;
    params.push(options.limit);
  }

  if (options.offset) {
    query += ` OFFSET $${paramIndex++}`;
    params.push(options.offset);
  }

  const result = await db.query<Cell>(query, params);
  return result.rows;
}

/**
 * Get dependencies for a bead
 */
export async function getDependencies(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<CellDependency[]> {
  const result = await db.query<CellDependency>(
    `SELECT * FROM bead_dependencies WHERE cell_id = $1`,
    [cellId],
  );
  return result.rows;
}

/**
 * Get beads that depend on this bead
 */
export async function getDependents(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<CellDependency[]> {
  const result = await db.query<CellDependency>(
    `SELECT * FROM bead_dependencies WHERE depends_on_id = $1`,
    [cellId],
  );
  return result.rows;
}

/**
 * Check if bead is blocked
 */
export async function isBlocked(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM blocked_beads_cache WHERE cell_id = $1) as exists`,
    [cellId],
  );
  return result.rows[0]?.exists ?? false;
}

/**
 * Get blockers for a bead
 */
export async function getBlockers(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<string[]> {
  const result = await db.query<{ blocker_ids: string[] }>(
    `SELECT blocker_ids FROM blocked_beads_cache WHERE cell_id = $1`,
    [cellId],
  );
  return result.rows[0]?.blocker_ids ?? [];
}

/**
 * Get labels for a bead
 */
export async function getLabels(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<string[]> {
  const result = await db.query<{ label: string }>(
    `SELECT label FROM bead_labels WHERE cell_id = $1 ORDER BY label`,
    [cellId],
  );
  return result.rows.map((r) => r.label);
}

/**
 * Get comments for a bead
 */
export async function getComments(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<CellComment[]> {
  const result = await db.query<CellComment>(
    `SELECT * FROM bead_comments WHERE cell_id = $1 ORDER BY created_at ASC`,
    [cellId],
  );
  return result.rows;
}

/**
 * Get next ready bead (unblocked, highest priority)
 */
export async function getNextReadyCell(
  db: DatabaseAdapter,
  projectKey: string,
): Promise<Cell | null> {
  const result = await db.query<Cell>(
    `SELECT b.* FROM beads b
     WHERE b.project_key = $1 
       AND b.status = 'open'
       AND b.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM blocked_beads_cache bbc WHERE bbc.cell_id = b.id
       )
     ORDER BY b.priority DESC, b.created_at ASC
     LIMIT 1`,
    [projectKey],
  );
  return result.rows[0] ?? null;
}

/**
 * Get all in-progress beads
 */
export async function getInProgressCells(
  db: DatabaseAdapter,
  projectKey: string,
): Promise<Cell[]> {
  const result = await db.query<Cell>(
    `SELECT * FROM beads 
     WHERE project_key = $1 AND status = 'in_progress' AND deleted_at IS NULL
     ORDER BY priority DESC, created_at ASC`,
    [projectKey],
  );
  return result.rows;
}

/**
 * Get all blocked beads with their blockers
 */
export async function getBlockedCells(
  db: DatabaseAdapter,
  projectKey: string,
): Promise<Array<{ cell: Cell; blockers: string[] }>> {
  const result = await db.query<Cell & { blocker_ids: string[] }>(
    `SELECT b.*, bbc.blocker_ids 
     FROM beads b
     JOIN blocked_beads_cache bbc ON b.id = bcc.cell_id
     WHERE b.project_key = $1 AND b.deleted_at IS NULL
     ORDER BY b.priority DESC, b.created_at ASC`,
    [projectKey],
  );
  return result.rows.map((r) => {
    const { blocker_ids, ...cellData } = r;
    return { cell: cellData as Cell, blockers: blocker_ids };
  });
}

// ============================================================================
// Cache Management
// ============================================================================

// Cache management is now handled in dependencies.ts

// ============================================================================
// Dirty Tracking
// ============================================================================

/**
 * Mark bead as dirty for JSONL export
 */
export async function markBeadDirty(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO dirty_beads (cell_id, marked_at)
     VALUES ($1, $2)
     ON CONFLICT (cell_id) DO UPDATE SET marked_at = $2`,
    [cellId, Date.now()],
  );
}

/**
 * Get all dirty beads
 */
export async function getDirtyCells(
  db: DatabaseAdapter,
  projectKey: string,
): Promise<string[]> {
  const result = await db.query<{ cell_id: string }>(
    `SELECT db.cell_id FROM dirty_beads db
     JOIN beads b ON db.cell_id = b.id
     WHERE b.project_key = $1
     ORDER BY db.marked_at ASC`,
    [projectKey],
  );
  return result.rows.map((r) => r.cell_id);
}

/**
 * Clear dirty flag after export
 */
export async function clearDirtyBead(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<void> {
  await db.query(
    `DELETE FROM dirty_beads WHERE cell_id = $1`,
    [cellId],
  );
}

/**
 * Clear all dirty flags
 */
export async function clearAllDirtyBeads(
  db: DatabaseAdapter,
  projectKey: string,
): Promise<void> {
  await db.query(
    `DELETE FROM dirty_beads WHERE cell_id IN (
       SELECT id FROM beads WHERE project_key = $1
     )`,
    [projectKey],
  );
}
