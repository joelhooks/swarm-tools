/**
 * 3-Way Merge Driver for Beads JSONL
 *
 * Ported from steveyegge/beads internal/merge/merge.go (MIT License)
 * Original by @neongreen: https://github.com/neongreen/mono/tree/main/beads-merge
 *
 * Features:
 * - 3-way merge of JSONL bead files
 * - Tombstone semantics (soft-delete wins over live, expired allows resurrection)
 * - Field-level merge with updated_at tiebreaker
 * - Deterministic conflict resolution (no manual intervention needed)
 *
 * ## Tombstone Rules
 * - Tombstone always wins over live issue (unless expired)
 * - Expired tombstones allow resurrection (live issue wins)
 * - Two tombstones: later deleted_at wins
 *
 * ## Field Merge Rules
 * - title/description: latest updated_at wins
 * - status: closed wins over open, tombstone wins over all
 * - priority: higher priority wins (lower number = more urgent)
 * - notes: concatenate on conflict
 * - dependencies: union (deduplicated)
 *
 * @module beads/merge
 */

import type { CellExport } from "./jsonl.js";

// ============================================================================
// Constants
// ============================================================================

/** Default TTL for tombstones (30 days) */
export const DEFAULT_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Minimum TTL for tombstones (7 days) - safety limit */
export const MIN_TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Clock skew grace period (1 hour) - added to TTL for distributed systems */
export const CLOCK_SKEW_GRACE_MS = 60 * 60 * 1000;

/** Tombstone status constant */
export const STATUS_TOMBSTONE = "tombstone";

// ============================================================================
// Types
// ============================================================================

/**
 * Issue key for matching across base/left/right
 *
 * Uses ID + created_at + created_by for uniqueness (handles ID collisions)
 */
export interface IssueKey {
  id: string;
  createdAt: string;
  createdBy?: string;
}

/**
 * Merge result
 */
export interface MergeResult {
  /** Successfully merged beads */
  merged: CellExport[];
  /** Conflict markers (for manual resolution if needed) */
  conflicts: string[];
}

/**
 * Merge options
 */
export interface MergeOptions {
  /** Custom tombstone TTL in milliseconds (default: 30 days) */
  tombstoneTtlMs?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Create a unique key for an issue
 *
 * Uses ID + createdAt for uniqueness. CreatedBy is optional but helps
 * disambiguate in edge cases.
 */
function makeKey(cell: CellExport): string {
  // Use JSON for stable key generation
  const key: IssueKey = {
    id: cell.id,
    createdAt: cell.created_at,
    createdBy: undefined, // Not in our CellExport type, but could be added
  };
  return JSON.stringify(key);
}

// ============================================================================
// Tombstone Helpers
// ============================================================================

/**
 * Check if a bead is a tombstone (soft-deleted)
 */
export function isTombstone(cell: CellExport): boolean {
  return cell.status === STATUS_TOMBSTONE;
}

/**
 * Check if a tombstone has expired (resurrection allowed)
 *
 * @param bead - The bead to check
 * @param ttlMs - TTL in milliseconds (default: 30 days)
 * @returns true if tombstone is expired, false otherwise
 */
export function isExpiredTombstone(
  cell: CellExport,
  ttlMs: number = DEFAULT_TOMBSTONE_TTL_MS
): boolean {
  // Non-tombstones never expire
  if (!isTombstone(cell)) {
    return false;
  }

  // Tombstones without closed_at are not expired (safety)
  // Note: In our model, closed_at serves as deleted_at for tombstones
  if (!cell.closed_at) {
    return false;
  }

  // Parse the deleted_at timestamp
  const deletedAt = new Date(cell.closed_at).getTime();
  if (Number.isNaN(deletedAt)) {
    // Invalid timestamp means not expired (safety)
    return false;
  }

  // Add clock skew grace period
  const effectiveTtl = ttlMs + CLOCK_SKEW_GRACE_MS;

  // Check if tombstone has exceeded TTL
  const expirationTime = deletedAt + effectiveTtl;
  return Date.now() > expirationTime;
}

// ============================================================================
// Time Helpers
// ============================================================================

/**
 * Check if t1 is after t2 (ISO 8601 strings)
 *
 * On parse errors or ties, prefers left (t1) for determinism.
 */
function isTimeAfter(t1: string | undefined, t2: string | undefined): boolean {
  if (!t1) return false;
  if (!t2) return true;

  const time1 = new Date(t1).getTime();
  const time2 = new Date(t2).getTime();

  // Handle parse errors
  const err1 = Number.isNaN(time1);
  const err2 = Number.isNaN(time2);

  if (err1 && err2) return true; // Both invalid, prefer left
  if (err1) return false; // t1 invalid, t2 valid
  if (err2) return true; // t1 valid, t2 invalid

  // Both valid - compare. On tie, left wins for determinism
  return time1 >= time2;
}

/**
 * Return the later of two timestamps
 */
function maxTime(
  t1: string | undefined,
  t2: string | undefined
): string | undefined {
  if (!t1 && !t2) return undefined;
  if (!t1) return t2;
  if (!t2) return t1;

  const time1 = new Date(t1).getTime();
  const time2 = new Date(t2).getTime();

  // Handle parse errors
  if (Number.isNaN(time1) && Number.isNaN(time2)) return t2;
  if (Number.isNaN(time1)) return t2;
  if (Number.isNaN(time2)) return t1;

  return time1 > time2 ? t1 : t2;
}

// ============================================================================
// Field Merge Helpers
// ============================================================================

/**
 * Standard 3-way merge for a field
 *
 * - If only left changed: use left
 * - If only right changed: use right
 * - If both changed to same: use that value
 * - If both changed differently: left wins (deterministic)
 */
function mergeField<T>(base: T, left: T, right: T): T {
  if (base === left && base !== right) return right;
  if (base === right && base !== left) return left;
  // Both changed to same, or no change, or conflict - left wins
  return left;
}

/**
 * Merge field by updated_at timestamp (for title, description)
 *
 * On conflict, the side with later updated_at wins.
 */
function mergeFieldByUpdatedAt(
  base: string | undefined,
  left: string | undefined,
  right: string | undefined,
  leftUpdatedAt: string,
  rightUpdatedAt: string
): string | undefined {
  // Standard 3-way for non-conflict cases
  if (base === left && base !== right) return right;
  if (base === right && base !== left) return left;
  if (left === right) return left;

  // True conflict: pick value from side with latest updated_at
  return isTimeAfter(leftUpdatedAt, rightUpdatedAt) ? left : right;
}

/**
 * Merge status with special rules
 *
 * - tombstone wins over all (handled at higher level, but safety here)
 * - closed wins over open
 * - otherwise standard 3-way
 */
function mergeStatus(
  base: string | undefined,
  left: string | undefined,
  right: string | undefined
): string {
  // Safety: tombstone wins (shouldn't reach here normally)
  if (left === STATUS_TOMBSTONE || right === STATUS_TOMBSTONE) {
    return STATUS_TOMBSTONE;
  }

  // Closed wins over open (issues should stay closed)
  if (left === "closed" || right === "closed") {
    return "closed";
  }

  // Standard 3-way
  return mergeField(base ?? "open", left ?? "open", right ?? "open");
}

/**
 * Merge priority with special rules
 *
 * - 0 is treated as "unset" - explicit priority wins over 0
 * - On conflict, higher priority wins (lower number = more urgent)
 */
function mergePriority(base: number, left: number, right: number): number {
  // Standard 3-way for non-conflict cases
  if (base === left && base !== right) return right;
  if (base === right && base !== left) return left;
  if (left === right) return left;

  // True conflict: handle 0 as "unset"
  if (left === 0 && right !== 0) return right;
  if (right === 0 && left !== 0) return left;

  // Both explicit - higher priority wins (lower number)
  return left < right ? left : right;
}

/**
 * Merge dependencies (union, deduplicated)
 */
function mergeDependencies(
  left: CellExport["dependencies"],
  right: CellExport["dependencies"]
): CellExport["dependencies"] {
  const seen = new Set<string>();
  const result: CellExport["dependencies"] = [];

  for (const dep of left) {
    const key = `${dep.depends_on_id}:${dep.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(dep);
    }
  }

  for (const dep of right) {
    const key = `${dep.depends_on_id}:${dep.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(dep);
    }
  }

  return result;
}

/**
 * Merge labels (union, deduplicated)
 */
function mergeLabels(left: string[], right: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const label of left) {
    if (!seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }

  for (const label of right) {
    if (!seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }

  return result;
}

/**
 * Merge comments (union by author+text, preserves order)
 */
function mergeComments(
  left: CellExport["comments"],
  right: CellExport["comments"]
): CellExport["comments"] {
  const seen = new Set<string>();
  const result: CellExport["comments"] = [];

  for (const comment of left) {
    const key = `${comment.author}:${comment.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(comment);
    }
  }

  for (const comment of right) {
    const key = `${comment.author}:${comment.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(comment);
    }
  }

  return result;
}

// ============================================================================
// Tombstone Merge
// ============================================================================

/**
 * Merge two tombstones for the same issue
 *
 * The tombstone with later deleted_at (closed_at) wins.
 */
function mergeTombstones(left: CellExport, right: CellExport): CellExport {
  // Handle empty closed_at
  if (!left.closed_at && !right.closed_at) return left; // Both invalid, left wins
  if (!left.closed_at) return right; // Left invalid, right wins
  if (!right.closed_at) return left; // Right invalid, left wins

  // Both valid - later deleted_at wins
  return isTimeAfter(left.closed_at, right.closed_at) ? left : right;
}

// ============================================================================
// Issue Merge
// ============================================================================

/**
 * Merge a single issue across base/left/right
 *
 * Returns merged issue and optional conflict marker.
 */
function mergeIssue(
  base: CellExport,
  left: CellExport,
  right: CellExport
): { merged: CellExport; conflict: string } {
  const merged: CellExport = {
    id: base.id,
    title: "", // Will be set below
    status: "open", // Will be set below
    priority: 0, // Will be set below
    issue_type: base.issue_type,
    created_at: base.created_at,
    updated_at: "", // Will be set below
    dependencies: [],
    labels: [],
    comments: [],
  };

  // Merge title - latest updated_at wins
  merged.title = mergeFieldByUpdatedAt(
    base.title,
    left.title,
    right.title,
    left.updated_at,
    right.updated_at
  ) ?? left.title;

  // Merge description - latest updated_at wins
  merged.description = mergeFieldByUpdatedAt(
    base.description,
    left.description,
    right.description,
    left.updated_at,
    right.updated_at
  );

  // Merge status - closed wins over open
  merged.status = mergeStatus(base.status, left.status, right.status) as CellExport["status"];

  // Merge priority - higher priority wins (lower number)
  merged.priority = mergePriority(base.priority, left.priority, right.priority);

  // Merge issue_type - left wins on conflict
  merged.issue_type = mergeField(
    base.issue_type,
    left.issue_type,
    right.issue_type
  );

  // Merge updated_at - take the max
  merged.updated_at = maxTime(left.updated_at, right.updated_at) ?? left.updated_at;

  // Merge closed_at - only if status is closed
  if (merged.status === "closed") {
    merged.closed_at = maxTime(left.closed_at, right.closed_at);
  }

  // Merge assignee - left wins on conflict
  merged.assignee = mergeField(base.assignee, left.assignee, right.assignee);

  // Merge parent_id - left wins on conflict
  merged.parent_id = mergeField(base.parent_id, left.parent_id, right.parent_id);

  // Merge dependencies - union
  merged.dependencies = mergeDependencies(left.dependencies, right.dependencies);

  // Merge labels - union
  merged.labels = mergeLabels(left.labels, right.labels);

  // Merge comments - union
  merged.comments = mergeComments(left.comments, right.comments);

  // All conflicts are auto-resolved deterministically
  return { merged, conflict: "" };
}

// ============================================================================
// Main Merge Function
// ============================================================================

/**
 * Perform 3-way merge of JSONL bead arrays
 *
 * @param base - Common ancestor (e.g., git merge-base)
 * @param left - Local changes (e.g., HEAD)
 * @param right - Remote changes (e.g., MERGE_HEAD)
 * @param options - Merge options
 * @returns Merged beads and any conflicts
 */
export function merge3Way(
  base: CellExport[],
  left: CellExport[],
  right: CellExport[],
  options: MergeOptions = {}
): MergeResult {
  const ttl = options.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS;
  const debug = options.debug ?? false;



  // Build maps for quick lookup
  const baseMap = new Map<string, CellExport>();
  for (const bead of base) {
    baseMap.set(makeKey(bead), bead);
  }

  const leftMap = new Map<string, CellExport>();
  for (const bead of left) {
    leftMap.set(makeKey(bead), bead);
  }

  const rightMap = new Map<string, CellExport>();
  for (const bead of right) {
    rightMap.set(makeKey(bead), bead);
  }

  // Collect all unique keys
  const allKeys = new Set<string>();
  for (const key of baseMap.keys()) allKeys.add(key);
  for (const key of leftMap.keys()) allKeys.add(key);
  for (const key of rightMap.keys()) allKeys.add(key);

  const result: CellExport[] = [];
  const conflicts: string[] = [];

  for (const key of allKeys) {
    const baseBead = baseMap.get(key);
    const leftBead = leftMap.get(key);
    const rightBead = rightMap.get(key);

    // Determine tombstone status (safe because we check existence)
    const leftTombstone = leftBead !== undefined && isTombstone(leftBead);
    const rightTombstone = rightBead !== undefined && isTombstone(rightBead);

    // Handle different scenarios based on presence in each version
    if (baseBead && leftBead && rightBead) {
      // All three present

      // CASE: Both are tombstones - merge tombstones
      if (leftTombstone && rightTombstone) {
        result.push(mergeTombstones(leftBead, rightBead));
        continue;
      }

      // CASE: Left is tombstone, right is live
      if (leftTombstone && !rightTombstone) {
        if (isExpiredTombstone(leftBead, ttl)) {
          // Tombstone expired - resurrection allowed
          result.push(rightBead);
        } else {
          // Tombstone wins
          result.push(leftBead);
        }
        continue;
      }

      // CASE: Right is tombstone, left is live
      if (rightTombstone && !leftTombstone) {
        if (isExpiredTombstone(rightBead, ttl)) {
          // Tombstone expired - resurrection allowed
          result.push(leftBead);
        } else {
          // Tombstone wins
          result.push(rightBead);
        }
        continue;
      }

      // CASE: Both are live - standard merge
      const { merged, conflict } = mergeIssue(baseBead, leftBead, rightBead);
      if (conflict) {
        conflicts.push(conflict);
      } else {
        result.push(merged);
      }
    } else if (!baseBead && leftBead && rightBead) {
      // Added in both

      // CASE: Both are tombstones
      if (leftTombstone && rightTombstone) {
        result.push(mergeTombstones(leftBead, rightBead));
        continue;
      }

      // CASE: Left is tombstone, right is live
      if (leftTombstone && !rightTombstone) {
        if (isExpiredTombstone(leftBead, ttl)) {
          result.push(rightBead);
        } else {
          result.push(leftBead);
        }
        continue;
      }

      // CASE: Right is tombstone, left is live
      if (rightTombstone && !leftTombstone) {
        if (isExpiredTombstone(rightBead, ttl)) {
          result.push(leftBead);
        } else {
          result.push(rightBead);
        }
        continue;
      }

      // CASE: Both are live - merge with empty base
      const emptyBase: CellExport = {
        id: leftBead.id,
        title: "",
        status: "open",
        priority: 0,
        issue_type: leftBead.issue_type,
        created_at: leftBead.created_at,
        updated_at: leftBead.created_at,
        dependencies: [],
        labels: [],
        comments: [],
      };
      const { merged } = mergeIssue(emptyBase, leftBead, rightBead);
      result.push(merged);
    } else if (baseBead && leftBead && !rightBead) {
      // Deleted in right, maybe modified in left

      // Tombstones must be preserved
      if (leftTombstone) {
        result.push(leftBead);
      }
      // Otherwise deletion wins over modification (issue not included)
    } else if (baseBead && !leftBead && rightBead) {
      // Deleted in left, maybe modified in right

      // Tombstones must be preserved
      if (rightTombstone) {
        result.push(rightBead);
      }
      // Otherwise deletion wins over modification (issue not included)
    } else if (!baseBead && leftBead && !rightBead) {
      // Added only in left
      result.push(leftBead);
    } else if (!baseBead && !leftBead && rightBead) {
      // Added only in right
      result.push(rightBead);
    }
  }

  if (debug) {
  }

  return { merged: result, conflicts };
}

/**
 * Merge JSONL strings (convenience wrapper)
 *
 * @param baseJsonl - Base JSONL string
 * @param leftJsonl - Left JSONL string
 * @param rightJsonl - Right JSONL string
 * @param options - Merge options
 * @returns Merged JSONL string
 */
export function mergeJsonl(
  baseJsonl: string,
  leftJsonl: string,
  rightJsonl: string,
  options: MergeOptions = {}
): { jsonl: string; conflicts: string[] } {
  // Import parseJSONL dynamically to avoid circular dependency
  const parseJSONL = (jsonl: string): CellExport[] => {
    if (!jsonl || jsonl.trim() === "") return [];
    return jsonl
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as CellExport);
  };

  const base = parseJSONL(baseJsonl);
  const left = parseJSONL(leftJsonl);
  const right = parseJSONL(rightJsonl);

  const { merged, conflicts } = merge3Way(base, left, right, options);

  // Serialize back to JSONL
  const jsonl = merged.map((bead) => JSON.stringify(bead)).join("\n");

  return { jsonl, conflicts };
}
