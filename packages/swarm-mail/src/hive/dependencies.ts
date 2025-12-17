/**
 * Dependency Graph Operations
 *
 * Provides dependency management with cycle detection and blocked bead tracking.
 *
 * ## Dependency Types
 * - **blocks**: Hard dependency - target must be closed before source can start
 * - **blocked-by**: Inverse of blocks (computed, not stored)
 * - **related**: Soft relationship - doesn't affect ready state
 * - **discovered-from**: Tracking relationship - found while working on another bead
 *
 * ## Cycle Prevention
 * All dependency types are checked for cycles to maintain a DAG (Directed Acyclic Graph).
 * This ensures:
 * - Ready work calculation works correctly
 * - Dependency traversal doesn't loop
 * - Semantic clarity (no circular dependencies)
 *
 * Reference: steveyegge/beads/internal/storage/sqlite/dependencies.go
 *
 * @module beads/dependencies
 */

import type { DatabaseAdapter } from "../types/database.js";

const MAX_DEPENDENCY_DEPTH = 100;

/**
 * Check if adding a dependency would create a cycle
 *
 * Uses recursive CTE to traverse from dependsOnId to see if we can reach cellId.
 * If yes, adding "cellId depends on dependsOnId" would complete a cycle.
 */
export async function wouldCreateCycle(
  db: DatabaseAdapter,
  cellId: string,
  dependsOnId: string,
): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `WITH RECURSIVE paths AS (
       -- Start from the target (what we want to depend on)
       SELECT
         cell_id,
         depends_on_id,
         1 as depth
       FROM bead_dependencies
       WHERE cell_id = $2
       
       UNION
       
       -- Follow dependencies transitively
       SELECT
         bd.cell_id,
         bd.depends_on_id,
         p.depth + 1
       FROM bead_dependencies bd
       JOIN paths p ON bd.cell_id = p.depends_on_id
       WHERE p.depth < $3
     )
     SELECT EXISTS(
       SELECT 1 FROM paths WHERE depends_on_id = $1
     ) as exists`,
    [cellId, dependsOnId, MAX_DEPENDENCY_DEPTH],
  );

  return result.rows[0]?.exists ?? false;
}

/**
 * Get all open blockers for a bead (including transitive)
 *
 * Returns bead IDs of all beads blocking this one that aren't closed.
 * Only considers "blocks" relationship type.
 */
export async function getOpenBlockers(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<string[]> {
  const result = await db.query<{ blocker_id: string }>(
    `WITH RECURSIVE blockers AS (
       -- Direct blockers
       SELECT depends_on_id as blocker_id, 1 as depth
       FROM bead_dependencies
       WHERE cell_id = $1 AND relationship = 'blocks'
       
       UNION
       
       -- Transitive blockers
       SELECT bd.depends_on_id, b.depth + 1
       FROM bead_dependencies bd
       JOIN blockers b ON bd.cell_id = b.blocker_id
       WHERE bd.relationship = 'blocks' AND b.depth < $3
     )
     SELECT DISTINCT b.blocker_id
     FROM blockers b
     JOIN beads bead ON b.blocker_id = bead.id
     WHERE bead.project_key = $2 AND bead.status != 'closed' AND bead.deleted_at IS NULL`,
    [cellId, projectKey, MAX_DEPENDENCY_DEPTH],
  );

  return result.rows.map(r => r.blocker_id);
}

/**
 * Rebuild blocked cache for a specific bead
 *
 * Finds all open blockers and updates the cache.
 * If no open blockers, removes from cache (bead is unblocked).
 */
export async function rebuildBeadBlockedCache(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<void> {
  const blockerIds = await getOpenBlockers(db, projectKey, cellId);

  if (blockerIds.length > 0) {
    // Has open blockers - insert or update cache
    await db.query(
      `INSERT INTO blocked_beads_cache (cell_id, blocker_ids, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (cell_id) 
       DO UPDATE SET blocker_ids = $2, updated_at = $3`,
      [cellId, blockerIds, Date.now()],
    );
  } else {
    // No open blockers - remove from cache
    await db.query(
      `DELETE FROM blocked_beads_cache WHERE cell_id = $1`,
      [cellId],
    );
  }
}

/**
 * Rebuild blocked cache for all beads in a project
 *
 * Used after bulk operations or status changes that affect blocking.
 */
export async function rebuildAllBlockedCaches(
  db: DatabaseAdapter,
  projectKey: string,
): Promise<void> {
  // Get all beads with blocking dependencies
  const result = await db.query<{ id: string }>(
    `SELECT DISTINCT b.id FROM beads b
     JOIN bead_dependencies bd ON b.id = bd.cell_id
     WHERE b.project_key = $1 AND bd.relationship = 'blocks' AND b.deleted_at IS NULL`,
    [projectKey],
  );

  // Rebuild cache for each bead
  for (const row of result.rows) {
    await rebuildBeadBlockedCache(db, projectKey, row.id);
  }
}

/**
 * Invalidate blocked cache when dependencies change
 *
 * Marks beads as needing cache rebuild.
 * In this simple implementation, we just rebuild immediately.
 */
export async function invalidateBlockedCache(
  db: DatabaseAdapter,
  projectKey: string,
  cellId: string,
): Promise<void> {
  await rebuildBeadBlockedCache(db, projectKey, cellId);
  
  // Also invalidate dependents (beads that depend on this one)
  const dependents = await db.query<{ cell_id: string }>(
    `SELECT cell_id FROM bead_dependencies WHERE depends_on_id = $1`,
    [cellId],
  );
  
  for (const row of dependents.rows) {
    await rebuildBeadBlockedCache(db, projectKey, row.cell_id);
  }
}
