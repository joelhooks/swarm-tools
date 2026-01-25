/**
 * @fileoverview Enhanced Doctor Command - Comprehensive health checks with --fix
 *
 * Performs deep health checks on the swarm database:
 * 1. DB integrity - SQLite PRAGMA integrity_check
 * 2. Orphaned cells - parent_id references non-existent cells
 * 3. Dependency cycles - DFS cycle detection on cellDependencies
 * 4. Stale reservations - File reservations past TTL
 * 5. Zombie blocked cells - Blocked cells whose blockers are all closed
 * 6. Ghost in-progress - In-progress cells with no recent agent activity
 *
 * Usage:
 *   swarm doctor --deep           - Run all health checks
 *   swarm doctor --deep --fix     - Auto-repair fixable issues
 *   swarm doctor --deep --json    - JSON output
 */

import type { DatabaseAdapter } from "swarm-mail";

// ============================================================================
// Types
// ============================================================================

export interface DoctorOptions {
  fix?: boolean;
  json?: boolean;
}

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  details?: string[];
  fixable?: boolean;
  fixed?: number;
}

export interface DoctorReport {
  checks: CheckResult[];
  passed: number;
  failed: number;
  warned: number;
  fixed: number;
  timestamp: string;
}

// ============================================================================
// Color utilities (inline to avoid cross-module deps)
// ============================================================================

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

// ============================================================================
// Individual Health Checks
// ============================================================================

/**
 * Check 1: Database integrity via SQLite PRAGMA
 */
export async function checkDbIntegrity(db: DatabaseAdapter): Promise<CheckResult> {
  try {
    const result = await db.query<{ integrity_check: string }>(
      "PRAGMA integrity_check"
    );

    const rows = result.rows;
    if (rows.length === 1 && rows[0].integrity_check === "ok") {
      return {
        name: "Database integrity",
        status: "pass",
        message: "OK",
      };
    }

    const issues = rows.map((r) => r.integrity_check).filter(Boolean);
    return {
      name: "Database integrity",
      status: "fail",
      message: `${issues.length} integrity issue(s) found`,
      details: issues,
      fixable: false,
    };
  } catch (error) {
    return {
      name: "Database integrity",
      status: "fail",
      message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      fixable: false,
    };
  }
}

/**
 * Check 2: Orphaned cells - parent_id references non-existent cells
 */
export async function checkOrphanedCells(
  db: DatabaseAdapter,
  options: DoctorOptions = {}
): Promise<CheckResult> {
  try {
    const result = await db.query<{ id: string; parent_id: string; title: string }>(
      `SELECT b.id, b.parent_id, b.title
       FROM beads b
       LEFT JOIN beads p ON b.parent_id = p.id
       WHERE b.parent_id IS NOT NULL AND p.id IS NULL`
    );

    const orphans = result.rows;
    if (orphans.length === 0) {
      return {
        name: "Cell references",
        status: "pass",
        message: "OK",
      };
    }

    let fixed = 0;
    if (options.fix) {
      // Clear orphan parent_id references
      await db.exec(
        `UPDATE beads SET parent_id = NULL
         WHERE parent_id IS NOT NULL
         AND parent_id NOT IN (SELECT id FROM beads)`
      );
      fixed = orphans.length;
    }

    const details = orphans.map(
      (o) => `${o.id} ("${o.title}") → parent ${o.parent_id} (missing)`
    );

    return {
      name: "Cell references",
      status: options.fix && fixed > 0 ? "warn" : "fail",
      message: options.fix
        ? `Fixed ${fixed} orphaned reference(s)`
        : `${orphans.length} orphaned cell(s) found`,
      details,
      fixable: true,
      fixed,
    };
  } catch (error) {
    return {
      name: "Cell references",
      status: "fail",
      message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      fixable: false,
    };
  }
}

/**
 * Check 3: Dependency cycles - DFS on bead_dependencies table
 */
export async function checkDependencyCycles(db: DatabaseAdapter): Promise<CheckResult> {
  try {
    const result = await db.query<{ cell_id: string; depends_on_id: string }>(
      `SELECT cell_id, depends_on_id FROM bead_dependencies WHERE relationship = 'blocks'`
    );

    const edges = result.rows;
    if (edges.length === 0) {
      return {
        name: "Dependency cycles",
        status: "pass",
        message: "OK (no dependencies)",
      };
    }

    // Build adjacency list: cell_id depends on depends_on_id
    // For cycle detection, we traverse: from depends_on_id → cell_id (blocker → blocked)
    const graph = new Map<string, string[]>();
    for (const edge of edges) {
      const existing = graph.get(edge.cell_id) || [];
      existing.push(edge.depends_on_id);
      graph.set(edge.cell_id, existing);
    }

    // DFS cycle detection
    const cycles = detectCycles(graph);

    if (cycles.length === 0) {
      return {
        name: "Dependency cycles",
        status: "pass",
        message: "OK",
      };
    }

    const details = cycles.map(
      (cycle) => cycle.join("→")
    );

    return {
      name: "Dependency cycles",
      status: "fail",
      message: `Found ${cycles.length} cycle(s)`,
      details,
      fixable: false,
    };
  } catch (error) {
    return {
      name: "Dependency cycles",
      status: "fail",
      message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      fixable: false,
    };
  }
}

/**
 * Detect cycles in a directed graph using DFS
 * Returns an array of cycles, each cycle being an array of node IDs
 */
export function detectCycles(graph: Map<string, string[]>): string[][] {
  const WHITE = 0; // unvisited
  const GRAY = 1;  // in progress
  const BLACK = 2; // finished

  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  // Initialize all nodes as WHITE
  for (const [node, neighbors] of graph) {
    color.set(node, WHITE);
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) {
        color.set(neighbor, WHITE);
      }
    }
  }

  function dfs(u: string): void {
    color.set(u, GRAY);

    for (const v of (graph.get(u) || [])) {
      if (color.get(v) === GRAY) {
        // Back edge found — reconstruct cycle
        const cycle: string[] = [v];
        let curr = u;
        while (curr !== v) {
          cycle.push(curr);
          curr = parent.get(curr) || v;
        }
        cycle.push(v); // close the cycle
        cycle.reverse();
        cycles.push(cycle);
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfs(v);
      }
    }

    color.set(u, BLACK);
  }

  for (const node of color.keys()) {
    if (color.get(node) === WHITE) {
      parent.set(node, null);
      dfs(node);
    }
  }

  return cycles;
}

/**
 * Check 4: Stale reservations - expired file locks
 */
export async function checkStaleReservations(
  db: DatabaseAdapter,
  options: DoctorOptions = {}
): Promise<CheckResult> {
  try {
    const now = Date.now();

    const result = await db.query<{
      id: number;
      agent_name: string;
      path_pattern: string;
      expires_at: number;
    }>(
      `SELECT id, agent_name, path_pattern, expires_at
       FROM reservations
       WHERE released_at IS NULL AND expires_at < ?`,
      [now]
    );

    const stale = result.rows;
    if (stale.length === 0) {
      return {
        name: "Reservations",
        status: "pass",
        message: "OK",
      };
    }

    let fixed = 0;
    if (options.fix) {
      // Delete expired reservations by setting released_at
      await db.query(
        `UPDATE reservations SET released_at = ? WHERE released_at IS NULL AND expires_at < ?`,
        [now, now]
      );
      fixed = stale.length;
    }

    const details = stale.map((r) => {
      const ago = Math.round((now - r.expires_at) / 1000);
      return `${r.path_pattern} (agent: ${r.agent_name}, expired ${ago}s ago)`;
    });

    return {
      name: "Reservations",
      status: options.fix && fixed > 0 ? "warn" : "fail",
      message: options.fix
        ? `Cleaned ${fixed} stale reservation(s)`
        : `${stale.length} stale reservation(s)`,
      details,
      fixable: true,
      fixed,
    };
  } catch (error) {
    // Reservations table might not exist if never used
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no such table")) {
      return {
        name: "Reservations",
        status: "pass",
        message: "OK (no reservations table)",
      };
    }
    return {
      name: "Reservations",
      status: "fail",
      message: `Check failed: ${msg}`,
      fixable: false,
    };
  }
}

/**
 * Check 5: Zombie blocked cells - blocked status but all blockers are closed
 */
export async function checkZombieBlocked(
  db: DatabaseAdapter,
  options: DoctorOptions = {}
): Promise<CheckResult> {
  try {
    // Find cells that are 'blocked' but have NO open blockers
    // (all their dependencies are either closed or don't exist)
    const result = await db.query<{ id: string; title: string }>(
      `SELECT b.id, b.title
       FROM beads b
       WHERE b.status = 'blocked'
       AND NOT EXISTS (
         SELECT 1
         FROM bead_dependencies bd
         JOIN beads blocker ON bd.depends_on_id = blocker.id
         WHERE bd.cell_id = b.id
           AND bd.relationship = 'blocks'
           AND blocker.status != 'closed'
       )`
    );

    const zombies = result.rows;
    if (zombies.length === 0) {
      return {
        name: "Zombie blocked",
        status: "pass",
        message: "OK",
      };
    }

    let fixed = 0;
    if (options.fix) {
      // Unblock zombie cells by setting status to 'open'
      const ids = zombies.map((z) => `'${z.id}'`).join(",");
      await db.exec(
        `UPDATE beads SET status = 'open', updated_at = ${Date.now()} WHERE id IN (${ids})`
      );
      fixed = zombies.length;
    }

    const details = zombies.map(
      (z) => `${z.id} ("${z.title}")`
    );

    return {
      name: "Zombie blocked",
      status: options.fix && fixed > 0 ? "warn" : "fail",
      message: options.fix
        ? `Unblocked ${fixed} zombie cell(s)`
        : `${zombies.length} cell(s) should be unblocked`,
      details,
      fixable: true,
      fixed,
    };
  } catch (error) {
    return {
      name: "Zombie blocked",
      status: "fail",
      message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      fixable: false,
    };
  }
}

/**
 * Check 6: Ghost in-progress - cells with no recent agent activity
 *
 * Checks for cells marked as 'in_progress' where the assigned agent
 * hasn't been active recently (>30 minutes).
 */
export async function checkGhostWorkers(
  db: DatabaseAdapter,
  staleCutoffMs: number = 30 * 60 * 1000 // 30 minutes default
): Promise<CheckResult> {
  try {
    const cutoff = Date.now() - staleCutoffMs;

    // Find in_progress cells where the assigned agent hasn't been active
    // We check agents.last_active_at for the agent assigned to the cell
    const result = await db.query<{
      id: string;
      title: string;
      assignee: string | null;
      last_active_at: number | null;
    }>(
      `SELECT b.id, b.title, b.assignee, a.last_active_at
       FROM beads b
       LEFT JOIN agents a ON b.assignee = a.name AND b.project_key = a.project_key
       WHERE b.status = 'in_progress'
         AND (a.last_active_at IS NULL OR a.last_active_at < ?)`,
      [cutoff]
    );

    const ghosts = result.rows;
    if (ghosts.length === 0) {
      return {
        name: "Ghost workers",
        status: "pass",
        message: "OK",
      };
    }

    const details = ghosts.map((g) => {
      const agoMin = g.last_active_at
        ? Math.round((Date.now() - g.last_active_at) / 60000)
        : null;
      const agentInfo = g.assignee || "unassigned";
      const timeInfo = agoMin !== null ? `, last active ${agoMin}m ago` : ", never active";
      return `${g.id} ("${g.title}") [${agentInfo}${timeInfo}]`;
    });

    return {
      name: "Ghost workers",
      status: "warn",
      message: `${ghosts.length} in-progress cell(s) with inactive agents`,
      details,
      fixable: false, // Ghost detection is informational - human decides action
    };
  } catch (error) {
    // If agents table doesn't exist, just check for in_progress cells
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no such table") || msg.includes("no such column")) {
      try {
        const result = await db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM beads WHERE status = 'in_progress'`
        );
        const count = result.rows[0]?.count ?? 0;
        if (count === 0) {
          return {
            name: "Ghost workers",
            status: "pass",
            message: "OK (no in-progress cells)",
          };
        }
        return {
          name: "Ghost workers",
          status: "warn",
          message: `${count} in-progress cell(s) (agent tracking unavailable)`,
          fixable: false,
        };
      } catch {
        // beads table also doesn't exist
        return {
          name: "Ghost workers",
          status: "pass",
          message: "OK (no cells table)",
        };
      }
    }
    return {
      name: "Ghost workers",
      status: "fail",
      message: `Check failed: ${msg}`,
      fixable: false,
    };
  }
}

// ============================================================================
// Main Doctor Runner
// ============================================================================

/**
 * Run all doctor checks against the database
 */
export async function runDoctor(
  db: DatabaseAdapter,
  options: DoctorOptions = {}
): Promise<DoctorReport> {
  const checks: CheckResult[] = [];

  // Run all checks
  checks.push(await checkDbIntegrity(db));
  checks.push(await checkOrphanedCells(db, options));
  checks.push(await checkDependencyCycles(db));
  checks.push(await checkStaleReservations(db, options));
  checks.push(await checkZombieBlocked(db, options));
  checks.push(await checkGhostWorkers(db));

  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const fixed = checks.reduce((sum, c) => sum + (c.fixed || 0), 0);

  return {
    checks,
    passed,
    failed,
    warned,
    fixed,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format doctor report for terminal output
 */
export function formatDoctorReport(report: DoctorReport, options: DoctorOptions = {}): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold("🏥 Swarm Doctor"));
  lines.push("────────────────────");

  for (const check of report.checks) {
    const icon =
      check.status === "pass"
        ? green("✓")
        : check.status === "warn"
          ? yellow("⚠")
          : red("✗");

    lines.push(`${icon} ${check.name}: ${check.message}`);

    if (check.details && check.details.length > 0) {
      // Show up to 5 details, then summarize
      const shown = check.details.slice(0, 5);
      for (const detail of shown) {
        lines.push(dim(`    ${detail}`));
      }
      if (check.details.length > 5) {
        lines.push(dim(`    ... and ${check.details.length - 5} more`));
      }
    }
  }

  lines.push("");

  const total = report.checks.length;
  const summaryParts: string[] = [];
  summaryParts.push(`${report.passed}/${total} checks passed`);
  if (report.failed > 0) summaryParts.push(`${report.failed} issue(s) found`);
  if (report.warned > 0) summaryParts.push(`${report.warned} warning(s)`);
  if (report.fixed > 0) summaryParts.push(`${report.fixed} item(s) fixed`);

  lines.push(`Summary: ${summaryParts.join(", ")}`);

  // Suggest --fix if there are fixable issues and not already fixing
  if (!options.fix && report.checks.some((c) => c.status === "fail" && c.fixable)) {
    lines.push(cyan("Run with --fix to auto-repair fixable issues"));
  }

  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// CLI Entry Point
// ============================================================================

/**
 * Parse doctor deep-check command arguments
 */
export function parseDoctorArgs(args: string[]): DoctorOptions {
  return {
    fix: args.includes("--fix"),
    json: args.includes("--json"),
  };
}

/**
 * Execute the enhanced doctor command
 * Called from swarm.ts when `swarm doctor --deep` is used
 */
export async function doctorDeep(args: string[] = []) {
  const options = parseDoctorArgs(args);

  // Dynamic import to keep the module testable
  const { getSwarmMailLibSQL, createHiveAdapter } = await import("swarm-mail");

  const projectPath = process.cwd();

  try {
    // Get database connections
    const swarmMail = await getSwarmMailLibSQL(projectPath);
    const db = await swarmMail.getDatabase();

    // Ensure hive schema exists
    const hiveAdapter = createHiveAdapter(db, projectPath);
    await hiveAdapter.runMigrations();

    // Run the doctor
    const report = await runDoctor(db, options);

    // Output
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDoctorReport(report, options));
    }

    // Exit with error code if issues found
    if (report.failed > 0 && !options.fix) {
      process.exit(1);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(red(`Doctor failed: ${msg}`));
    process.exit(1);
  }
}
