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
import type { BeadsAdapter } from "../types/beads-adapter.js";
import {
  getDependencies,
  getLabels,
  getComments,
  getDirtyBeads,
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
export interface BeadExport {
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
  beadIds?: string[];
}

export interface ImportOptions {
  dryRun?: boolean;
  skipExisting?: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ beadId: string; error: string }>;
}

// ============================================================================
// Serialize / Parse
// ============================================================================

/**
 * Serialize a bead to a JSONL line
 */
export function serializeToJSONL(bead: BeadExport): string {
  return JSON.stringify(bead);
}

/**
 * Parse JSONL string to bead exports
 *
 * Skips empty lines. Throws on invalid JSON.
 */
export function parseJSONL(jsonl: string): BeadExport[] {
  if (!jsonl || jsonl.trim() === "") {
    return [];
  }

  const lines = jsonl.split("\n");
  const beads: BeadExport[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    try {
      const bead = JSON.parse(trimmed) as BeadExport;
      beads.push(bead);
    } catch (err) {
      throw new Error(
        `Invalid JSON in JSONL: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return beads;
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
export function computeContentHash(bead: BeadExport): string {
  // Canonical JSON: sort keys for stable hashing
  const canonical = JSON.stringify(bead, Object.keys(bead).sort());
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
  adapter: BeadsAdapter,
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

  if (options.beadIds && options.beadIds.length > 0) {
    conditions.push(`id = ANY($${paramIndex++})`);
    params.push(options.beadIds);
  }

  const query = `
    SELECT * FROM beads
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
    const beadExport: BeadExport = {
      id: bead.id as string,
      title: bead.title as string,
      description: bead.description || undefined,
      status: bead.deleted_at ? "tombstone" : (bead.status as any),
      priority: bead.priority as number,
      issue_type: bead.type as any,
      created_at: new Date(bead.created_at as number).toISOString(),
      updated_at: new Date(bead.updated_at as number).toISOString(),
      closed_at: bead.closed_at
        ? new Date(bead.closed_at as number).toISOString()
        : undefined,
      assignee: bead.assignee || undefined,
      parent_id: bead.parent_id || undefined,
      dependencies,
      labels,
      comments: commentExports,
    };

    lines.push(serializeToJSONL(beadExport));
  }

  return lines.join("\n");
}

/**
 * Export only dirty beads (incremental)
 *
 * Returns JSONL and list of bead IDs that were exported.
 */
export async function exportDirtyBeads(
  adapter: BeadsAdapter,
  projectKey: string
): Promise<{ jsonl: string; beadIds: string[] }> {
  const db = await adapter.getDatabase();
  const dirtyIds = await getDirtyBeads(db, projectKey);

  if (dirtyIds.length === 0) {
    return { jsonl: "", beadIds: [] };
  }

  const jsonl = await exportToJSONL(adapter, projectKey, {
    beadIds: dirtyIds,
  });

  return { jsonl, beadIds: dirtyIds };
}

// ============================================================================
// Import
// ============================================================================

/**
 * Import beads from JSONL string
 *
 * Features:
 * - Creates new beads
 * - Updates existing beads
 * - Hash-based deduplication (skips if content unchanged)
 * - Imports dependencies, labels, comments
 * - Dry run mode for preview
 * - Skip existing mode
 */
export async function importFromJSONL(
  adapter: BeadsAdapter,
  projectKey: string,
  jsonl: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const beads = parseJSONL(jsonl);
  const result: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const beadExport of beads) {
    try {
      await importSingleBead(adapter, projectKey, beadExport, options, result);
    } catch (err) {
      result.errors.push({
        beadId: beadExport.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Import a single bead
 */
async function importSingleBead(
  adapter: BeadsAdapter,
  projectKey: string,
  beadExport: BeadExport,
  options: ImportOptions,
  result: ImportResult
): Promise<void> {
  const existing = await adapter.getBead(projectKey, beadExport.id);

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
    const importHash = computeContentHash(beadExport);

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

  // Import the bead
  if (!existing) {
    // Create new - directly insert with specified ID
    const db = await adapter.getDatabase();
    
    // Determine status and closed_at together to satisfy check constraint
    const status = beadExport.status === "tombstone" ? "closed" : beadExport.status;
    const isClosed = status === "closed";
    
    // For closed beads, use closed_at from export or fall back to updated_at
    const closedAt = isClosed
      ? (beadExport.closed_at 
          ? new Date(beadExport.closed_at).getTime() 
          : new Date(beadExport.updated_at).getTime())
      : null;
    
    await db.query(
      `INSERT INTO beads (
        id, project_key, type, status, title, description, priority,
        parent_id, assignee, created_at, updated_at, closed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        beadExport.id,
        projectKey,
        beadExport.issue_type,
        status,
        beadExport.title,
        beadExport.description || null,
        beadExport.priority,
        beadExport.parent_id || null,
        beadExport.assignee || null,
        new Date(beadExport.created_at).getTime(),
        new Date(beadExport.updated_at).getTime(),
        closedAt,
      ]
    );

    // If it's a tombstone, mark as deleted
    if (beadExport.status === "tombstone") {
      await db.query(
        "UPDATE beads SET deleted_at = $1 WHERE id = $2",
        [Date.now(), beadExport.id]
      );
    }

    result.created++;
  } else {
    // Update existing
    await adapter.updateBead(projectKey, beadExport.id, {
      title: beadExport.title,
      description: beadExport.description,
      priority: beadExport.priority,
      assignee: beadExport.assignee,
    });

    // Update status if changed
    if (existing.status !== beadExport.status) {
      if (beadExport.status === "closed") {
        await adapter.closeBead(
          projectKey,
          beadExport.id,
          "imported"
        );
      } else if (beadExport.status === "in_progress") {
        const db = await adapter.getDatabase();
        await db.query(
          "UPDATE beads SET status = $1, updated_at = $2 WHERE id = $3",
          ["in_progress", Date.now(), beadExport.id]
        );
      }
    }

    result.updated++;
  }

  // Import dependencies
  await importDependencies(adapter, projectKey, beadExport);

  // Import labels
  await importLabels(adapter, projectKey, beadExport);

  // Import comments
  await importComments(adapter, projectKey, beadExport);
}

/**
 * Compute hash for existing bead in database
 */
async function computeBeadHash(
  adapter: BeadsAdapter,
  projectKey: string,
  beadId: string
): Promise<string> {
  const db = await adapter.getDatabase();

  // Get bead
  const beadResult = await db.query<any>(
    "SELECT * FROM beads WHERE project_key = $1 AND id = $2",
    [projectKey, beadId]
  );
  const bead = beadResult.rows[0];
  if (!bead) {
    throw new Error(`Bead not found: ${beadId}`);
  }

  // Get dependencies
  const deps = await getDependencies(db, projectKey, beadId);
  const dependencies = deps.map((d) => ({
    depends_on_id: d.depends_on_id,
    type: d.relationship,
  }));

  // Get labels
  const labels = await getLabels(db, projectKey, beadId);

  // Get comments
  const comments = await getComments(db, projectKey, beadId);
  const commentExports = comments.map((c) => ({
    author: c.author,
    text: c.body,
  }));

  // Build export format
  const beadExport: BeadExport = {
    id: bead.id as string,
    title: bead.title as string,
    description: bead.description || undefined,
    status: bead.deleted_at ? "tombstone" : (bead.status as any),
    priority: bead.priority as number,
    issue_type: bead.type as any,
    created_at: new Date(bead.created_at as number).toISOString(),
    updated_at: new Date(bead.updated_at as number).toISOString(),
    closed_at: bead.closed_at
      ? new Date(bead.closed_at as number).toISOString()
      : undefined,
    assignee: bead.assignee || undefined,
    parent_id: bead.parent_id || undefined,
    dependencies,
    labels,
    comments: commentExports,
  };

  return computeContentHash(beadExport);
}

/**
 * Import dependencies for a bead
 */
async function importDependencies(
  adapter: BeadsAdapter,
  projectKey: string,
  beadExport: BeadExport
): Promise<void> {
  // Skip if no dependencies
  if (!beadExport.dependencies || beadExport.dependencies.length === 0) {
    return;
  }

  const db = await adapter.getDatabase();

  // Clear existing dependencies
  await db.query("DELETE FROM bead_dependencies WHERE bead_id = $1", [
    beadExport.id,
  ]);

  // Add new dependencies
  for (const dep of beadExport.dependencies) {
    await adapter.addDependency(
      projectKey,
      beadExport.id,
      dep.depends_on_id,
      dep.type as any // Type assertion for relationship
    );
  }
}

/**
 * Import labels for a bead
 */
async function importLabels(
  adapter: BeadsAdapter,
  projectKey: string,
  beadExport: BeadExport
): Promise<void> {
  // Skip if no labels
  if (!beadExport.labels || beadExport.labels.length === 0) {
    return;
  }

  const db = await adapter.getDatabase();

  // Clear existing labels
  await db.query("DELETE FROM bead_labels WHERE bead_id = $1", [
    beadExport.id,
  ]);

  // Add new labels
  for (const label of beadExport.labels) {
    await adapter.addLabel(projectKey, beadExport.id, label);
  }
}

/**
 * Import comments for a bead
 */
async function importComments(
  adapter: BeadsAdapter,
  projectKey: string,
  beadExport: BeadExport
): Promise<void> {
  // Skip if no comments
  if (!beadExport.comments || beadExport.comments.length === 0) {
    return;
  }

  const db = await adapter.getDatabase();

  // Clear existing comments (simple approach - could be smarter)
  await db.query("DELETE FROM bead_comments WHERE bead_id = $1", [
    beadExport.id,
  ]);

  // Add new comments
  for (const comment of beadExport.comments) {
    await adapter.addComment(
      projectKey,
      beadExport.id,
      comment.author,
      comment.text
    );
  }
}
