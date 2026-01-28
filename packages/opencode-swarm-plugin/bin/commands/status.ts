/**
 * @fileoverview Status dashboard command
 *
 * Rich status dashboard shown when running `swarm` with no subcommand.
 * Displays a summary of epics, cells, workers, and recent activity.
 *
 * Usage:
 *   swarm                    - Show status dashboard (default)
 *   swarm status             - Same as above
 *   swarm status --json      - Machine-readable JSON output
 *
 * Layout inspired by Dex's status display.
 */

import * as p from "@clack/prompts";
import { getSwarmMailLibSQL, createHiveAdapter } from "swarm-mail";
import type { Cell } from "swarm-mail";
import {
  getWorkerStatus,
  getEpicList,
  getFileLocks,
  getRecentMessages,
  type WorkerStatus,
  type EpicInfo,
  type FileLock,
  type RecentMessage,
} from "../../src/dashboard.js";

// ============================================================================
// Color utilities
// ============================================================================

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const white = (s: string) => `\x1b[37m${s}\x1b[0m`;

// ============================================================================
// ASCII banner
// ============================================================================

export const SWARM_BANNER = `  ___  _    _  _   ___  __  __
 / __|| |  | |/_\\ | _ \\|  \\/  |
 \\__ \\| /| / _ \\|   /| |\\/| |
 |___/|__/_/ \\_\\_|_\\ |_|  |_|`;

// ============================================================================
// Types
// ============================================================================

export interface StatusOptions {
  json?: boolean;
}

export interface DashboardData {
  cells: Cell[];
  epics: EpicInfo[];
  workers: WorkerStatus[];
  fileLocks: FileLock[];
  recentMessages: RecentMessage[];
}

export interface DashboardSummary {
  total: number;
  completed: number;
  ready: number;
  blocked: number;
  active: number;
  percentComplete: number;
}

// ============================================================================
// Data gathering
// ============================================================================

/**
 * Gather all dashboard data from the project
 */
export async function gatherDashboardData(
  projectPath: string,
): Promise<DashboardData> {
  const swarmMail = await getSwarmMailLibSQL(projectPath);
  const db = await swarmMail.getDatabase();
  const adapter = createHiveAdapter(db, projectPath);

  // Ensure schema exists
  await adapter.runMigrations();

  // Gather data in parallel
  const [cells, epics, workers, fileLocks, recentMessages] = await Promise.all([
    adapter.queryCells(projectPath, { limit: 200 }),
    getEpicList(projectPath).catch(() => [] as EpicInfo[]),
    getWorkerStatus(projectPath).catch(() => [] as WorkerStatus[]),
    getFileLocks(projectPath).catch(() => [] as FileLock[]),
    getRecentMessages(projectPath, { limit: 5 }).catch(() => [] as RecentMessage[]),
  ]);

  return { cells, epics, workers, fileLocks, recentMessages };
}

// ============================================================================
// Summary computation (pure, testable)
// ============================================================================

/**
 * Compute summary stats from cells
 */
export function computeSummary(cells: Cell[]): DashboardSummary {
  // Exclude epics from the counts - we care about leaf tasks
  const nonEpicCells = cells.filter((c) => c.type !== "epic");
  const total = nonEpicCells.length;
  const completed = nonEpicCells.filter((c) => c.status === "closed").length;
  const blocked = nonEpicCells.filter((c) => c.status === "blocked").length;
  const active = nonEpicCells.filter((c) => c.status === "in_progress").length;
  const ready = nonEpicCells.filter(
    (c) => c.status === "open" && !c.parent_id || 
           (c.status === "open" && c.parent_id !== null),
  ).length;
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { total, completed, ready, blocked, active, percentComplete };
}

/**
 * Get cells grouped by status for display
 */
export function groupCellsByStatus(cells: Cell[]): {
  ready: Cell[];
  blocked: Cell[];
  active: Cell[];
  recentlyCompleted: Cell[];
} {
  const nonEpicCells = cells.filter((c) => c.type !== "epic");

  const ready = nonEpicCells
    .filter((c) => c.status === "open")
    .sort((a, b) => a.priority - b.priority);

  const blocked = nonEpicCells
    .filter((c) => c.status === "blocked")
    .sort((a, b) => a.priority - b.priority);

  const active = nonEpicCells
    .filter((c) => c.status === "in_progress")
    .sort((a, b) => a.priority - b.priority);

  const recentlyCompleted = nonEpicCells
    .filter((c) => c.status === "closed")
    .sort((a, b) => (b.closed_at ?? b.updated_at) - (a.closed_at ?? a.updated_at))
    .slice(0, 5);

  return { ready, blocked, active, recentlyCompleted };
}

// ============================================================================
// Rendering (pure functions that return strings)
// ============================================================================

/**
 * Truncate a cell ID for display (show first 7 chars)
 */
export function shortId(id: string): string {
  // If it follows "cell--XXXXX-YYYYYY" pattern, show last segment
  const parts = id.split("-");
  if (parts.length >= 3) {
    return parts[parts.length - 1].slice(0, 7);
  }
  return id.slice(0, 7);
}

/**
 * Pad a string to a given visible width, ignoring ANSI escape codes
 */
function padVisible(s: string, width: number): string {
  // Strip ANSI codes to measure visible length
  // eslint-disable-next-line no-control-regex
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - visible.length);
  return s + " ".repeat(padding);
}

/**
 * Render the summary stats bar
 */
export function renderSummaryBar(summary: DashboardSummary): string {
  const lines: string[] = [];

  const COL_WIDTH = 14;

  // Stat line with labels
  const col1 = padVisible(`  ${bold(green(`${summary.percentComplete}%`))}`, COL_WIDTH);
  const col2 = padVisible(bold(cyan(`${summary.ready}`)), COL_WIDTH);
  const col3 = padVisible(bold(red(`${summary.blocked}`)), COL_WIDTH);
  const col4 = bold(yellow(`${summary.active}`));

  lines.push(`${col1}${col2}${col3}${col4}`);

  // Label line
  const lbl1 = padVisible(`  ${dim("complete")}`, COL_WIDTH);
  const lbl2 = padVisible(dim("ready"), COL_WIDTH);
  const lbl3 = padVisible(dim("blocked"), COL_WIDTH);
  const lbl4 = dim("active");

  lines.push(`${lbl1}${lbl2}${lbl3}${lbl4}`);

  return lines.join("\n");
}

/**
 * Render a section header with separator
 */
export function renderSectionHeader(title: string, count?: number): string {
  const countStr = count !== undefined ? ` (${count})` : "";
  const header = `${title}${countStr}`;
  const separator = "─".repeat(40);
  return `\n${bold(header)}\n${dim(separator)}`;
}

/**
 * Format a priority number as a display label
 */
export function formatPriority(priority: number): string {
  if (priority === 0) return magenta("P0");
  if (priority === 1) return red("P1");
  if (priority === 2) return yellow("P2");
  if (priority === 3) return cyan("P3");
  return dim(`P${priority}`);
}

/**
 * Render the ready-to-work section
 */
export function renderReadySection(cells: Cell[]): string {
  if (cells.length === 0) {
    return renderSectionHeader("Ready to Work", 0) + `\n${dim("  No tasks ready")}`;
  }

  const lines: string[] = [renderSectionHeader("Ready to Work", cells.length)];

  for (const cell of cells.slice(0, 8)) {
    const id = dim(shortId(cell.id));
    const prio = formatPriority(cell.priority);
    lines.push(`  [ ] ${id}: ${cell.title} (${prio})`);
  }

  if (cells.length > 8) {
    lines.push(dim(`  ... and ${cells.length - 8} more`));
  }

  return lines.join("\n");
}

/**
 * Render the blocked section
 */
export function renderBlockedSection(cells: Cell[]): string {
  if (cells.length === 0) return "";

  const lines: string[] = [renderSectionHeader("Blocked", cells.length)];

  for (const cell of cells.slice(0, 5)) {
    const id = dim(shortId(cell.id));
    const blocker = cell.parent_id ? dim(` [B: ${shortId(cell.parent_id)}]`) : "";
    lines.push(`  ${red("[!]")} ${id}: ${cell.title}${blocker}`);
  }

  if (cells.length > 5) {
    lines.push(dim(`  ... and ${cells.length - 5} more`));
  }

  return lines.join("\n");
}

/**
 * Render the active (in-progress) section
 */
export function renderActiveSection(cells: Cell[]): string {
  if (cells.length === 0) return "";

  const lines: string[] = [renderSectionHeader("In Progress", cells.length)];

  for (const cell of cells.slice(0, 5)) {
    const id = dim(shortId(cell.id));
    const assignee = cell.assignee ? dim(` [${cell.assignee}]`) : "";
    lines.push(`  ${yellow("▶")} ${id}: ${cell.title}${assignee}`);
  }

  if (cells.length > 5) {
    lines.push(dim(`  ... and ${cells.length - 5} more`));
  }

  return lines.join("\n");
}

/**
 * Render the recently completed section
 */
export function renderCompletedSection(cells: Cell[]): string {
  if (cells.length === 0) return "";

  const lines: string[] = [renderSectionHeader("Recently Completed", cells.length)];

  for (const cell of cells) {
    const id = dim(shortId(cell.id));
    lines.push(`  ${green("[✓]")} ${id}: ${cell.title}`);
  }

  return lines.join("\n");
}

/**
 * Render worker status section
 */
export function renderWorkersSection(workers: WorkerStatus[]): string {
  if (workers.length === 0) return "";

  const lines: string[] = [renderSectionHeader("Workers", workers.length)];

  for (const w of workers) {
    const icon =
      w.status === "working" ? yellow("●") :
      w.status === "blocked" ? red("●") :
      dim("○");
    const task = w.current_task ? dim(` → ${shortId(w.current_task)}`) : "";
    lines.push(`  ${icon} ${w.agent_name} ${dim(`(${w.status})`)}${task}`);
  }

  return lines.join("\n");
}

/**
 * Render file locks section
 */
export function renderLocksSection(locks: FileLock[]): string {
  if (locks.length === 0) return "";

  const lines: string[] = [renderSectionHeader("File Locks", locks.length)];

  for (const lock of locks.slice(0, 5)) {
    lines.push(`  🔒 ${dim(lock.path)} ${dim(`← ${lock.agent_name}`)}`);
  }

  if (locks.length > 5) {
    lines.push(dim(`  ... and ${locks.length - 5} more`));
  }

  return lines.join("\n");
}

/**
 * Render the empty state when no project is initialized
 */
export function renderEmptyState(): string {
  const lines: string[] = [
    "",
    cyan(SWARM_BANNER),
    "",
    dim("  No swarm activity found in this project."),
    "",
    `  Get started:`,
    `    ${cyan("swarm setup")}     ${dim("Install dependencies & configure")}`,
    `    ${cyan("swarm init")}      ${dim("Initialize swarm in current project")}`,
    `    ${cyan("swarm doctor")}    ${dim("Check dependency health")}`,
    "",
    dim("  Run 'swarm help' for all commands."),
  ];
  return lines.join("\n");
}

/**
 * Render the full dashboard as a string
 */
export function renderDashboard(data: DashboardData): string {
  const { cells, workers, fileLocks } = data;

  // Empty state
  if (cells.length === 0) {
    return renderEmptyState();
  }

  const summary = computeSummary(cells);
  const groups = groupCellsByStatus(cells);

  const sections: string[] = [
    "",
    cyan(SWARM_BANNER),
    "",
    renderSummaryBar(summary),
  ];

  // Active first (most urgent)
  const activeSection = renderActiveSection(groups.active);
  if (activeSection) sections.push(activeSection);

  // Ready to work
  sections.push(renderReadySection(groups.ready));

  // Blocked
  const blockedSection = renderBlockedSection(groups.blocked);
  if (blockedSection) sections.push(blockedSection);

  // Workers
  const workersSection = renderWorkersSection(workers);
  if (workersSection) sections.push(workersSection);

  // File locks
  const locksSection = renderLocksSection(fileLocks);
  if (locksSection) sections.push(locksSection);

  // Recently completed
  const completedSection = renderCompletedSection(groups.recentlyCompleted);
  if (completedSection) sections.push(completedSection);

  // Footer
  sections.push("");
  sections.push(dim(`  Run 'swarm help' for all commands.`));

  return sections.join("\n");
}

/**
 * Build JSON output for --json flag
 */
export function buildJsonOutput(data: DashboardData): object {
  const summary = computeSummary(data.cells);
  const groups = groupCellsByStatus(data.cells);

  return {
    summary,
    ready: groups.ready.map((c) => ({
      id: c.id,
      title: c.title,
      priority: c.priority,
      type: c.type,
    })),
    blocked: groups.blocked.map((c) => ({
      id: c.id,
      title: c.title,
      priority: c.priority,
      parent_id: c.parent_id,
    })),
    active: groups.active.map((c) => ({
      id: c.id,
      title: c.title,
      priority: c.priority,
      assignee: c.assignee,
    })),
    recentlyCompleted: groups.recentlyCompleted.map((c) => ({
      id: c.id,
      title: c.title,
    })),
    workers: data.workers,
    fileLocks: data.fileLocks,
    epics: data.epics,
  };
}

// ============================================================================
// Argument parsing
// ============================================================================

/**
 * Parse status command arguments
 */
export function parseStatusArgs(args: string[]): StatusOptions {
  const options: StatusOptions = {};

  for (const arg of args) {
    if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

// ============================================================================
// Main command entry point
// ============================================================================

/**
 * Execute the status dashboard command
 */
export async function status(args: string[] = []) {
  const options = parseStatusArgs(args);
  const projectPath = process.cwd();

  try {
    const data = await gatherDashboardData(projectPath);

    if (options.json) {
      console.log(JSON.stringify(buildJsonOutput(data), null, 2));
      return;
    }

    console.log(renderDashboard(data));
  } catch (error) {
    // If we can't read data, show the empty state
    const message = error instanceof Error ? error.message : String(error);

    // Check if it's just "no data" vs an actual error
    if (
      message.includes("no such table") ||
      message.includes("SQLITE_ERROR") ||
      message.includes("not initialized")
    ) {
      console.log(renderEmptyState());
    } else {
      // For unexpected errors, show empty state with hint
      console.log(renderEmptyState());
      if (process.env.DEBUG) {
        console.error(dim(`\n  Debug: ${message}`));
      }
    }
  }
}
