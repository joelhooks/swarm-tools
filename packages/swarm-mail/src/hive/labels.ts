/**
 * Label Operations
 *
 * Simple label management for categorizing beads.
 * Labels are string tags that can be queried for grouping and filtering.
 *
 * Reference: steveyegge/beads/internal/storage/sqlite/labels.go
 *
 * @module beads/labels
 */

import type { DatabaseAdapter } from "../types/database.js";
import type { Cell } from "../types/hive-adapter.js";

/**
 * Get all beads with a specific label
 */
export async function getCellsByLabel(
  db: DatabaseAdapter,
  projectKey: string,
  label: string,
): Promise<Cell[]> {
  const result = await db.query<Cell>(
    `SELECT b.* FROM beads b
     JOIN bead_labels bl ON b.id = bl.cell_id
     WHERE b.project_key = $1 AND bl.label = $2 AND b.deleted_at IS NULL
     ORDER BY b.priority DESC, b.created_at ASC`,
    [projectKey, label],
  );
  return result.rows;
}

/**
 * Get all unique labels for a project
 */
export async function getAllLabels(
  db: DatabaseAdapter,
  projectKey: string,
): Promise<string[]> {
  const result = await db.query<{ label: string }>(
    `SELECT DISTINCT bl.label FROM bead_labels bl
     JOIN beads b ON bl.cell_id = b.id
     WHERE b.project_key = $1 AND b.deleted_at IS NULL
     ORDER BY bl.label`,
    [projectKey],
  );
  return result.rows.map(r => r.label);
}
