/**
 * JSONL Export/Import for Beads
 *
 * Implements git sync via JSONL format compatible with steveyegge/beads.
 * Features:
 * - Full export to JSONL string
 * - Incremental dirty bead export
 * - Import with hash-based deduplication
 * - Parse/serialize individual lines
 *
 * @module beads/jsonl
 */

import { createHash } from "node:crypto";
import type { HiveAdapter } from "../types/hive-adapter.js";
import {
  getDependencies,
  getLabels,
  getComments,
  getDirtyCells,
  clearDirtyBead,
} from "./projections.js";

// ============================================================================
// Types
// ============================================================================

/**
 * JSONL export format matching steveyegge/beads
 *
 * One JSON object per line. Field names match the Go struct tags.
 */
export interface CellExport {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "blocked" | "closed" | "tombstone";
  priority: number;
  issue_type: "bug" | "feature" | "task" | "epic" | "chore";
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  closed_at?: string;
  assignee?: string;
  parent_id?: string;
  dependencies: Array<{
    depends_on_id: string;
    type: string;
  }>;
  labels: string[];
  comments: Array<{
    author: string;
    text: string;
  }>;
}

export interface ExportOptions {
  includeDeleted?: boolean;
  cellIds?: string[];
}

export interface ImportOptions {
  dryRun?: boolean;
  skipExisting?: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ cellId: string; error: string }>;
}

// ============================================================================
// Serialize / Parse
// ============================================================================

/**
 * Serialize a bead to a JSONL line
 *
 * Returns JSON with trailing newline for proper JSONL format.
 */
export function serializeToJSONL(cell: CellExport): string {
  return JSON.stringify(cell) + "\n";
}

/**
 * Parse JSONL string to bead exports
 *
 * Skips empty lines. Throws on invalid JSON.
 */
export function parseJSONL(jsonl: string): CellExport[] {
  if (!jsonl || jsonl.trim() === "") {
    return [];
  }

  const lines = jsonl.split("\n");
  const cells: CellExport[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    try {
      const cell = JSON.parse(trimmed) as CellExport;
      cells.push(cell);
    } catch (err) {
      throw new Error(
        `Invalid JSON in JSONL: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return cells;
}

// ============================================================================
// Content Hash
// ============================================================================

/**
 * Compute SHA-256 content hash for deduplication
 *
 * Uses canonical JSON encoding (sorted keys) for stability.
 * Includes timestamps to detect any change.
 */
export function computeContentHash(cell: CellExport): string {
  // Canonical JSON: sort keys for stable hashing
  const canonical = JSON.stringify(cell, Object.keys(cell).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export all beads to JSONL string
 *
 * By default excludes deleted beads (tombstones).
 * Includes dependencies, labels, and comments.
 */
export async function exportToJSONL(
  adapter: HiveAdapter,
  projectKey: string,
  options: ExportOptions = {}
): Promise<string> {
  const db = await adapter.getDatabase();

  // Build query
  const conditions: string[] = ["project_key = $1"];
  const params: unknown[] = [projectKey];
  let paramIndex = 2;

  if (!options.includeDeleted) {
    conditions.push("deleted_at IS NULL");
  }

  if (options.cellIds && options.cellIds.length > 0) {
    // SQLite uses IN instead of ANY
    const placeholders = options.cellIds.map(() => `$${paramIndex++}`).join(", ");
    conditions.push(`id IN (${placeholders})`);
    params.push(...options.cellIds);
  }

  const query = `
    SELECT * FROM cells
    WHERE ${conditions.join(" AND ")}
    ORDER BY id ASC
  `;

  const result = await db.query<any>(query, params);
  const beads = result.rows;

  if (beads.length === 0) {
    return "";
  }

  // Convert each bead to export format
  const lines: string[] = [];

  for (const bead of beads) {
    // Get dependencies
    const deps = await getDependencies(db, projectKey, bead.id as string);
    const dependencies = deps.map((d) => ({
      depends_on_id: d.depends_on_id,
      type: d.relationship,
    }));

    // Get labels
    const labels = await getLabels(db, projectKey, bead.id as string);

    // Get comments
    const comments = await getComments(db, projectKey, bead.id as string);
    const commentExports = comments.map((c) => ({
      author: c.author,
      text: c.body,
    }));

    // Build export
    const cellExport: CellExport = {
      id: bead.id as string,
      title: bead.title as string,
      description: bead.description || undefined,
      status: bead.deleted_at ? "tombstone" : (bead.status as any),
      priority: bead.priority as number,
      issue_type: bead.type as any,
      created_at: new Date(Number(bead.created_at)).toISOString(),
      updated_at: new Date(Number(bead.updated_at)).toISOString(),
      closed_at: bead.closed_at
        ? new Date(Number(bead.closed_at)).toISOString()
        : undefined,
      assignee: bead.assignee || undefined,
      parent_id: bead.parent_id || undefined,
      dependencies,
      labels,
      comments: commentExports,
    };

    lines.push(serializeToJSONL(cellExport));
  }

  // serializeToJSONL already adds \n, so just join without separator
  return lines.join("");
}

/**
 * Export only dirty beads (incremental)
 *
 * Returns JSONL and list of bead IDs that were exported.
 */
export async function exportDirtyBeads(
  adapter: HiveAdapter,
  projectKey: string
): Promise<{ jsonl: string; cellIds: string[] }> {
  const db = await adapter.getDatabase();
  const dirtyIds = await getDirtyCells(db, projectKey);

  if (dirtyIds.length === 0) {
    return { jsonl: "", cellIds: [] };
  }

  const jsonl = await exportToJSONL(adapter, projectKey, {
    cellIds: dirtyIds,
  });

  return { jsonl, cellIds: dirtyIds };
}

// ============================================================================
// Import
// ============================================================================

/**
 * Import cells from JSONL string
 *
 * Features:
 * - Creates new cells
 * - Updates existing cells
 * - Hash-based deduplication (skips if content unchanged)
 * - Imports dependencies, labels, comments
 * - Dry run mode for preview
 * - Skip existing mode
 */
export async function importFromJSONL(
  adapter: HiveAdapter,
  projectKey: string,
  jsonl: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const cells = parseJSONL(jsonl);
  const result: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const cellExport of cells) {
    try {
      await importSingleCell(adapter, projectKey, cellExport, options, result);
    } catch (err) {
      result.errors.push({
        cellId: cellExport.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Import a single cell
 */
async function importSingleCell(
  adapter: HiveAdapter,
  projectKey: string,
  cellExport: CellExport,
  options: ImportOptions,
  result: ImportResult
): Promise<void> {
  const existing = await adapter.getCell(projectKey, cellExport.id);

  // Skip existing if requested
  if (existing && options.skipExisting) {
    result.skipped++;
    return;
  }

  // Hash-based deduplication
  if (existing) {
    const existingHash = await computeBeadHash(
      adapter,
      projectKey,
      existing.id
    );
    const importHash = computeContentHash(cellExport);

    if (existingHash === importHash) {
      result.skipped++;
      return;
    }
  }

  // Dry run - just count
  if (options.dryRun) {
    if (existing) {
      result.updated++;
    } else {
      result.created++;
    }
    return;
  }

  // Import the cell
  if (!existing) {
    // Create new - directly insert with specified ID
    const db = await adapter.getDatabase();
    
    // Determine status and closed_at together to satisfy check constraint
    const status = cellExport.status === "tombstone" ? "closed" : cellExport.status;
    const isClosed = status === "closed";
    
    // For closed cells, use closed_at from export or fall back to updated_at
    const closedAt = isClosed
      ? (cellExport.closed_at 
          ? new Date(cellExport.closed_at).getTime() 
          : new Date(cellExport.updated_at).getTime())
      : null;
    
    await db.query(
      `INSERT INTO beads (
        id, project_key, type, status, title, description, priority,
        parent_id, assignee, created_at, updated_at, closed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        cellExport.id,
        projectKey,
        cellExport.issue_type,
        status,
        cellExport.title,
        cellExport.description || null,
        cellExport.priority,
        cellExport.parent_id || null,
        cellExport.assignee || null,
        new Date(cellExport.created_at).getTime(),
        new Date(cellExport.updated_at).getTime(),
        closedAt,
      ]
    );

    // If it's a tombstone, mark as deleted
    if (cellExport.status === "tombstone") {
      await db.query(
        "UPDATE beads SET deleted_at = $1 WHERE id = $2",
        [Date.now(), cellExport.id]
      );
    }

    result.created++;
  } else {
    // Update existing
    await adapter.updateCell(projectKey, cellExport.id, {
      title: cellExport.title,
      description: cellExport.description,
      priority: cellExport.priority,
      assignee: cellExport.assignee,
    });

    // Update status if changed
    if (existing.status !== cellExport.status) {
      if (cellExport.status === "closed") {
        await adapter.closeCell(
          projectKey,
          cellExport.id,
          "imported"
        );
      } else if (cellExport.status === "in_progress") {
        const db = await adapter.getDatabase();
        await db.query(
          "UPDATE beads SET status = $1, updated_at = $2 WHERE id = $3",
          ["in_progress", Date.now(), cellExport.id]
        );
      }
    }

    result.updated++;
  }

  // Import dependencies
  await importDependencies(adapter, projectKey, cellExport);

  // Import labels
  await importLabels(adapter, projectKey, cellExport);

  // Import comments
  await importComments(adapter, projectKey, cellExport);
}

/**
 * Compute hash for existing bead in database
 */
async function computeBeadHash(
  adapter: HiveAdapter,
  projectKey: string,
  cellId: string
): Promise<string> {
  const db = await adapter.getDatabase();

  // Get bead
  const beadResult = await db.query<any>(
    "SELECT * FROM beads WHERE project_key = $1 AND id = $2",
    [projectKey, cellId]
  );
  const cell = beadResult.rows[0];
  if (!cell) {
    throw new Error(`Cell not found: ${cellId}`);
  }

  // Get dependencies
  const deps = await getDependencies(db, projectKey, cellId);
  const dependencies = deps.map((d) => ({
    depends_on_id: d.depends_on_id,
    type: d.relationship,
  }));

  // Get labels
  const labels = await getLabels(db, projectKey, cellId);

  // Get comments
  const comments = await getComments(db, projectKey, cellId);
  const commentExports = comments.map((c) => ({
    author: c.author,
    text: c.body,
  }));

  // Build export format
  const cellExport: CellExport = {
    id: cell.id as string,
    title: cell.title as string,
    description: cell.description || undefined,
    status: cell.deleted_at ? "tombstone" : (cell.status as any),
    priority: cell.priority as number,
    issue_type: cell.type as any,
    created_at: new Date(Number(cell.created_at)).toISOString(),
    updated_at: new Date(Number(cell.updated_at)).toISOString(),
    closed_at: cell.closed_at
      ? new Date(Number(cell.closed_at)).toISOString()
      : undefined,
    assignee: cell.assignee || undefined,
    parent_id: cell.parent_id || undefined,
    dependencies,
    labels,
    comments: commentExports,
  };

  return computeContentHash(cellExport);
}

/**
 * Import dependencies for a cell
 */
async function importDependencies(
  adapter: HiveAdapter,
  projectKey: string,
  cellExport: CellExport
): Promise<void> {
  // Skip if no dependencies
  if (!cellExport.dependencies || cellExport.dependencies.length === 0) {
    return;
  }

  const db = await adapter.getDatabase();

  // Clear existing dependencies
  await db.query("DELETE FROM bead_dependencies WHERE cell_id = $1", [
    cellExport.id,
  ]);

  // Add new dependencies
  for (const dep of cellExport.dependencies) {
    await adapter.addDependency(
      projectKey,
      cellExport.id,
      dep.depends_on_id,
      dep.type as any // Type assertion for relationship
    );
  }
}

/**
 * Import labels for a bead
 */
async function importLabels(
  adapter: HiveAdapter,
  projectKey: string,
  cellExport: CellExport
): Promise<void> {
  // Skip if no labels
  if (!cellExport.labels || cellExport.labels.length === 0) {
    return;
  }

  const db = await adapter.getDatabase();

  // Clear existing labels
  await db.query("DELETE FROM bead_labels WHERE cell_id = $1", [
    cellExport.id,
  ]);

  // Add new labels
  for (const label of cellExport.labels) {
    await adapter.addLabel(projectKey, cellExport.id, label);
  }
}

/**
 * Import comments for a cell
 */
async function importComments(
  adapter: HiveAdapter,
  projectKey: string,
  cellExport: CellExport
): Promise<void> {
  // Skip if no comments
  if (!cellExport.comments || cellExport.comments.length === 0) {
    return;
  }

  const db = await adapter.getDatabase();

  // Clear existing comments (simple approach - could be smarter)
  await db.query("DELETE FROM bead_comments WHERE cell_id = $1", [
    cellExport.id,
  ]);

  // Add new comments
  for (const comment of cellExport.comments) {
    await adapter.addComment(
      projectKey,
      cellExport.id,
      comment.author,
      comment.text
    );
  }
}
