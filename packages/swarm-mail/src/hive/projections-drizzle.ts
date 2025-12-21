/**
 * Hive Projections Layer - Drizzle Implementation
 *
 * Drizzle-based write operations for materialized views.
 * These are the write-side of CQRS - updating denormalized data from events.
 *
 * Key operations:
 * - Event handlers for cell lifecycle (created, updated, closed, etc.)
 * - Dependency management (add/remove)
 * - Label and comment operations
 * - Dirty tracking for JSONL export
 *
 * @module hive/projections-drizzle
 */

import { and, eq, inArray } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import {
  beadComments,
  beadDependencies,
  beadLabels,
  beads,
  dirtyBeads,
} from "../db/schema/hive.js";

// ============================================================================
// Event Type Definitions
// ============================================================================

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
 * Update projections based on an event using Drizzle
 *
 * This is called by the event store after appending an event.
 * Routes to specific handlers based on event type.
 */
export async function updateProjectionsDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  switch (event.type) {
    case "cell_created":
      await handleBeadCreatedDrizzle(db, event);
      break;
    case "cell_updated":
      await handleBeadUpdatedDrizzle(db, event);
      break;
    case "cell_status_changed":
      await handleCellStatusChangedDrizzle(db, event);
      break;
    case "cell_closed":
      await handleBeadClosedDrizzle(db, event);
      break;
    case "cell_reopened":
      await handleBeadReopenedDrizzle(db, event);
      break;
    case "cell_deleted":
      await handleBeadDeletedDrizzle(db, event);
      break;
    case "cell_dependency_added":
      await handleDependencyAddedDrizzle(db, event);
      break;
    case "cell_dependency_removed":
      await handleDependencyRemovedDrizzle(db, event);
      break;
    case "cell_label_added":
      await handleLabelAddedDrizzle(db, event);
      break;
    case "cell_label_removed":
      await handleLabelRemovedDrizzle(db, event);
      break;
    case "cell_comment_added":
      await handleCommentAddedDrizzle(db, event);
      break;
    case "cell_comment_updated":
      await handleCommentUpdatedDrizzle(db, event);
      break;
    case "cell_comment_deleted":
      await handleCommentDeletedDrizzle(db, event);
      break;
    case "cell_epic_child_added":
      await handleEpicChildAddedDrizzle(db, event);
      break;
    case "cell_epic_child_removed":
      await handleEpicChildRemovedDrizzle(db, event);
      break;
    case "cell_assigned":
      await handleBeadAssignedDrizzle(db, event);
      break;
    case "cell_work_started":
      await handleWorkStartedDrizzle(db, event);
      break;
    default:
      console.warn(`[beads/projections] Unknown event type: ${event.type}`);
  }

  // Mark bead as dirty for JSONL export
  await markBeadDirtyDrizzle(db, event.project_key, event.cell_id);
}

// ============================================================================
// Event Handlers - Individual handlers for each event type
// ============================================================================

async function handleBeadCreatedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db.insert(beads).values({
    id: event.cell_id,
    project_key: event.project_key,
    type: event.issue_type as string,
    status: "open",
    title: event.title as string,
    description: (event.description as string | null | undefined) ?? null,
    priority: (event.priority as number | undefined) ?? 2,
    parent_id: (event.parent_id as string | null | undefined) ?? null,
    assignee: null,
    created_at: event.timestamp,
    updated_at: event.timestamp,
    closed_at: null,
    closed_reason: null,
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
    created_by: (event.created_by as string | null | undefined) ?? null,
  });
}

async function handleBeadUpdatedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  const changes = event.changes as Record<
    string,
    { old: unknown; new: unknown }
  >;
  const updates: Partial<typeof beads.$inferInsert> = {};

  if (changes.title) {
    updates.title = changes.title.new as string;
  }
  if (changes.description) {
    updates.description = changes.description.new as string | null;
  }
  if (changes.priority) {
    updates.priority = changes.priority.new as number;
  }
  if (changes.assignee) {
    updates.assignee = changes.assignee.new as string | null;
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = event.timestamp;

    await db
      .update(beads)
      .set(updates)
      .where(eq(beads.id, event.cell_id));
  }
}

async function handleCellStatusChangedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  const toStatus = event.to_status as string;
  const updates: Partial<typeof beads.$inferInsert> = {
    status: toStatus,
    updated_at: event.timestamp,
  };

  // FIX: Set closed_at when status changes to 'closed'
  // This satisfies CHECK constraint: ((status = 'closed') = (closed_at IS NOT NULL))
  if (toStatus === "closed") {
    updates.closed_at = event.timestamp;
    updates.closed_reason = (event.reason as string | null | undefined) ?? null;
  } else {
    // Clear closed_at when status changes away from 'closed'
    updates.closed_at = null;
    updates.closed_reason = null;
  }

  await db
    .update(beads)
    .set(updates)
    .where(eq(beads.id, event.cell_id));
}

async function handleBeadClosedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .update(beads)
    .set({
      status: "closed",
      closed_at: event.timestamp,
      closed_reason: event.reason as string,
      updated_at: event.timestamp,
    })
    .where(eq(beads.id, event.cell_id));

  // Invalidate blocked cache for dependents (beads that were blocked by this one)
  const { invalidateBlockedCacheDrizzle } = await import(
    "./dependencies-drizzle.js"
  );
  await invalidateBlockedCacheDrizzle(db, event.project_key, event.cell_id);
}

async function handleBeadReopenedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .update(beads)
    .set({
      status: "open",
      closed_at: null,
      closed_reason: null,
      updated_at: event.timestamp,
    })
    .where(eq(beads.id, event.cell_id));
}

async function handleBeadDeletedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .update(beads)
    .set({
      deleted_at: event.timestamp,
      deleted_by: (event.deleted_by as string | null | undefined) ?? null,
      delete_reason: (event.reason as string | null | undefined) ?? null,
      updated_at: event.timestamp,
    })
    .where(eq(beads.id, event.cell_id));
}

async function handleDependencyAddedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  const dep = event.dependency as { target: string; type: string };

  await db
    .insert(beadDependencies)
    .values({
      cell_id: event.cell_id,
      depends_on_id: dep.target,
      relationship: dep.type,
      created_at: event.timestamp,
      created_by: (event.added_by as string | null | undefined) ?? null,
    })
    .onConflictDoNothing();

  // Invalidate blocked cache (import at runtime)
  const { invalidateBlockedCacheDrizzle } = await import(
    "./dependencies-drizzle.js"
  );
  await invalidateBlockedCacheDrizzle(db, event.project_key, event.cell_id);
}

async function handleDependencyRemovedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  const dep = event.dependency as { target: string; type: string };

  await db
    .delete(beadDependencies)
    .where(
      and(
        eq(beadDependencies.cell_id, event.cell_id),
        eq(beadDependencies.depends_on_id, dep.target),
        eq(beadDependencies.relationship, dep.type),
      ),
    );

  // Invalidate blocked cache (import at runtime)
  const { invalidateBlockedCacheDrizzle } = await import(
    "./dependencies-drizzle.js"
  );
  await invalidateBlockedCacheDrizzle(db, event.project_key, event.cell_id);
}

async function handleLabelAddedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .insert(beadLabels)
    .values({
      cell_id: event.cell_id,
      label: event.label as string,
      created_at: event.timestamp,
    })
    .onConflictDoNothing();
}

async function handleLabelRemovedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .delete(beadLabels)
    .where(
      and(
        eq(beadLabels.cell_id, event.cell_id),
        eq(beadLabels.label, event.label as string),
      ),
    );
}

async function handleCommentAddedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db.insert(beadComments).values({
    cell_id: event.cell_id,
    author: event.author as string,
    body: event.body as string,
    parent_id: (event.parent_comment_id as number | null | undefined) ?? null,
    created_at: event.timestamp,
    updated_at: null,
  });
}

async function handleCommentUpdatedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .update(beadComments)
    .set({
      body: event.new_body as string,
      updated_at: event.timestamp,
    })
    .where(eq(beadComments.id, event.comment_id as number));
}

async function handleCommentDeletedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .delete(beadComments)
    .where(eq(beadComments.id, event.comment_id as number));
}

async function handleEpicChildAddedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  // Update parent_id on child bead
  await db
    .update(beads)
    .set({
      parent_id: event.cell_id,
      updated_at: event.timestamp,
    })
    .where(eq(beads.id, event.child_id as string));
}

async function handleEpicChildRemovedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  // Clear parent_id on child bead
  await db
    .update(beads)
    .set({
      parent_id: null,
      updated_at: event.timestamp,
    })
    .where(eq(beads.id, event.child_id as string));
}

async function handleBeadAssignedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .update(beads)
    .set({
      assignee: event.assignee as string,
      updated_at: event.timestamp,
    })
    .where(eq(beads.id, event.cell_id));
}

async function handleWorkStartedDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<void> {
  await db
    .update(beads)
    .set({
      status: "in_progress",
      updated_at: event.timestamp,
    })
    .where(eq(beads.id, event.cell_id));
}

// ============================================================================
// Dirty Tracking - Drizzle Implementation
// ============================================================================

/**
 * Mark bead as dirty for JSONL export using Drizzle
 */
export async function markBeadDirtyDrizzle(
  db: SwarmDb,
  projectKey: string,
  cellId: string,
): Promise<void> {
  await db
    .insert(dirtyBeads)
    .values({
      cell_id: cellId,
      marked_at: Date.now(),
    })
    .onConflictDoUpdate({
      target: dirtyBeads.cell_id,
      set: {
        marked_at: Date.now(),
      },
    });
}

/**
 * Clear dirty flag after export using Drizzle
 */
export async function clearDirtyBeadDrizzle(
  db: SwarmDb,
  projectKey: string,
  cellId: string,
): Promise<void> {
  await db.delete(dirtyBeads).where(eq(dirtyBeads.cell_id, cellId));
}

/**
 * Clear all dirty flags using Drizzle
 */
export async function clearAllDirtyBeadsDrizzle(
  db: SwarmDb,
  projectKey: string,
): Promise<void> {
  // Get all cell IDs for the project
  const cells = await db
    .select({ id: beads.id })
    .from(beads)
    .where(eq(beads.project_key, projectKey));

  const cellIds = cells.map((c) => c.id);

  if (cellIds.length === 0) {
    return;
  }

  await db.delete(dirtyBeads).where(inArray(dirtyBeads.cell_id, cellIds));
}
