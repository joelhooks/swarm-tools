/**
 * Beads Query Functions
 *
 * High-level query functions for common bead operations:
 * - Ready work (unblocked beads with sort policies)
 * - Blocked issues with blockers
 * - Epics eligible for closure
 * - Stale issues
 * - Statistics
 *
 * Based on steveyegge/beads query patterns.
 *
 * @module beads/queries
 */

import type { DatabaseAdapter } from "../types/database.js";
import type { Cell, CellStatus, HiveAdapter } from "../types/hive-adapter.js";

/**
 * Sort policy for ready work queries
 *
 * - hybrid (default): Recent issues (<48h) by priority, older by age
 * - priority: Always priority first, then creation date
 * - oldest: Creation date ascending (backlog clearing)
 */
export type SortPolicy = "hybrid" | "priority" | "oldest";

export interface ReadyWorkOptions {
  limit?: number;
  assignee?: string;
  unassigned?: boolean;
  labels?: string[];
  sortPolicy?: SortPolicy;
}

export interface BlockedCell {
  cell: Cell;
  blockers: string[];
}

export interface EpicStatus {
  epic_id: string;
  title: string;
  total_children: number;
  closed_children: number;
}

export interface StaleOptions {
  status?: CellStatus;
  limit?: number;
}

export interface Statistics {
  total_cells: number;
  open: number;
  in_progress: number;
  closed: number;
  blocked: number;
  ready: number;
  by_type: Record<string, number>;
}

/**
 * Get ready work (unblocked, prioritized)
 *
 * By default returns both 'open' and 'in_progress' beads so epics/tasks
 * ready to close are visible (matching steveyegge/beads behavior).
 */
export async function getReadyWork(
  adapter: HiveAdapter,
  projectKey: string,
  options: ReadyWorkOptions = {},
): Promise<Cell[]> {
  const db = await adapter.getDatabase();

  const conditions: string[] = ["b.project_key = $1"];
  const params: unknown[] = [projectKey];
  let paramIndex = 2;

  // Default to open OR in_progress
  conditions.push("b.status IN ('open', 'in_progress')");

  // Not deleted
  conditions.push("b.deleted_at IS NULL");

  // Not blocked (uses cache)
  conditions.push(`
    NOT EXISTS (
      SELECT 1 FROM blocked_beads_cache bbc WHERE bbc.cell_id = b.id
    )
  `);

  // Assignee filter
  if (options.unassigned) {
    conditions.push(`(b.assignee IS NULL OR b.assignee = '')`);
  } else if (options.assignee) {
    conditions.push(`b.assignee = $${paramIndex++}`);
    params.push(options.assignee);
  }

  // Label filtering (AND semantics)
  if (options.labels && options.labels.length > 0) {
    for (const label of options.labels) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM bead_labels
          WHERE cell_id = b.id AND label = $${paramIndex++}
        )
      `);
      params.push(label);
    }
  }

  // Build ORDER BY clause
  const sortPolicy = options.sortPolicy || "hybrid";
  const orderBySQL = buildOrderByClause(sortPolicy);

  // Build query
  let query = `
    SELECT b.* FROM beads b
    WHERE ${conditions.join(" AND ")}
    ${orderBySQL}
  `;

  if (options.limit) {
    query += ` LIMIT $${paramIndex++}`;
    params.push(options.limit);
  }

  const result = await db.query<Cell>(query, params);
  return result.rows;
}

/**
 * Get all blocked beads with their blockers
 */
export async function getBlockedIssues(
  adapter: HiveAdapter,
  projectKey: string,
): Promise<BlockedCell[]> {
  const db = await adapter.getDatabase();

  const result = await db.query<Cell & { blocker_ids: string[] }>(
    `SELECT b.*, bbc.blocker_ids 
     FROM beads b
     JOIN blocked_beads_cache bbc ON b.id = bbc.cell_id
     WHERE b.project_key = $1 AND b.deleted_at IS NULL
     ORDER BY b.priority ASC, b.created_at ASC`,
    [projectKey],
  );

  return result.rows.map((r) => {
    const { blocker_ids, ...cellData } = r;
    return {
      cell: cellData as Cell,
      blockers: blocker_ids,
    };
  });
}

/**
 * Get epics eligible for closure (all children closed)
 */
export async function getEpicsEligibleForClosure(
  adapter: HiveAdapter,
  projectKey: string,
): Promise<EpicStatus[]> {
  const db = await adapter.getDatabase();

  const result = await db.query<EpicStatus>(
    `SELECT 
       e.id as epic_id,
       e.title,
       COUNT(c.id) as total_children,
       COUNT(CASE WHEN c.status = 'closed' THEN 1 END) as closed_children
     FROM beads e
     JOIN beads c ON c.parent_id = e.id
     WHERE e.project_key = $1 
       AND e.type = 'epic'
       AND e.status != 'closed'
       AND e.deleted_at IS NULL
       AND c.deleted_at IS NULL
     GROUP BY e.id, e.title
     HAVING COUNT(c.id) = COUNT(CASE WHEN c.status = 'closed' THEN 1 END)
     ORDER BY e.created_at ASC`,
    [projectKey],
  );

  return result.rows.map((r) => ({
    epic_id: r.epic_id,
    title: r.title,
    total_children: Number(r.total_children),
    closed_children: Number(r.closed_children),
  }));
}

/**
 * Get stale issues (not updated in N days)
 */
export async function getStaleIssues(
  adapter: HiveAdapter,
  projectKey: string,
  days: number,
  options: StaleOptions = {},
): Promise<Cell[]> {
  const db = await adapter.getDatabase();

  const conditions: string[] = [
    "project_key = $1",
    "status != 'closed'",
    "deleted_at IS NULL",
  ];
  const params: unknown[] = [projectKey];
  let paramIndex = 2;

  // Calculate cutoff timestamp (days ago)
  const cutoffTimestamp = Date.now() - days * 24 * 60 * 60 * 1000;
  conditions.push(`updated_at < $${paramIndex++}`);
  params.push(cutoffTimestamp);

  // Optional status filter
  if (options.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(options.status);
  }

  let query = `
    SELECT * FROM beads
    WHERE ${conditions.join(" AND ")}
    ORDER BY updated_at ASC
  `;

  if (options.limit) {
    query += ` LIMIT $${paramIndex++}`;
    params.push(options.limit);
  }

  const result = await db.query<Cell>(query, params);
  return result.rows;
}

/**
 * Get aggregate statistics
 */
export async function getStatistics(
  adapter: HiveAdapter,
  projectKey: string,
): Promise<Statistics> {
  const db = await adapter.getDatabase();

  // Get counts by status
  const countsResult = await db.query<{
    total: string;
    open: string;
    in_progress: string;
    closed: string;
  }>(
    `SELECT
      COALESCE(COUNT(*), 0) as total,
      COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) as open,
      COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) as in_progress,
      COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) as closed
    FROM beads
    WHERE project_key = $1 AND deleted_at IS NULL`,
    [projectKey],
  );

  const counts = countsResult.rows[0] || {
    total: "0",
    open: "0",
    in_progress: "0",
    closed: "0",
  };

  // Get blocked count
  const blockedResult = await db.query<{ count: string }>(
    `SELECT COUNT(DISTINCT b.id) as count
     FROM beads b
     JOIN blocked_beads_cache bbc ON b.id = bbc.cell_id
     WHERE b.project_key = $1 AND b.deleted_at IS NULL`,
    [projectKey],
  );

  const blockedCount = parseInt(blockedResult.rows[0]?.count || "0");

  // Get ready count (open beads not in blocked cache)
  const readyResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM beads b
     WHERE b.project_key = $1
       AND b.status = 'open'
       AND b.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM blocked_beads_cache bbc WHERE bbc.cell_id = b.id
       )`,
    [projectKey],
  );

  const readyCount = parseInt(readyResult.rows[0]?.count || "0");

  // Get counts by type
  const byTypeResult = await db.query<{ type: string; count: string }>(
    `SELECT type, COUNT(*) as count
     FROM beads
     WHERE project_key = $1 AND deleted_at IS NULL
     GROUP BY type`,
    [projectKey],
  );

  const by_type: Record<string, number> = {};
  for (const row of byTypeResult.rows) {
    by_type[row.type] = parseInt(row.count);
  }

  return {
    total_cells: parseInt(counts.total),
    open: parseInt(counts.open),
    in_progress: parseInt(counts.in_progress),
    closed: parseInt(counts.closed),
    blocked: blockedCount,
    ready: readyCount,
    by_type,
  };
}

/**
 * Build ORDER BY clause based on sort policy
 */
function buildOrderByClause(policy: SortPolicy): string {
  switch (policy) {
    case "priority":
      return `ORDER BY b.priority ASC, b.created_at ASC`;

    case "oldest":
      return `ORDER BY b.created_at ASC`;

    case "hybrid":
    default: {
      // Hybrid: Recent issues (<48h) by priority, older by age
      // PostgreSQL datetime comparison
      const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
      return `ORDER BY
        CASE
          WHEN b.created_at >= ${fortyEightHoursAgo} THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN b.created_at >= ${fortyEightHoursAgo} THEN b.priority
          ELSE NULL
        END ASC,
        CASE
          WHEN b.created_at < ${fortyEightHoursAgo} THEN b.created_at
          ELSE NULL
        END ASC,
        b.created_at ASC`;
    }
  }
}
