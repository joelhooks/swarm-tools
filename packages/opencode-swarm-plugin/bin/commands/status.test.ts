/**
 * @fileoverview Tests for status dashboard command
 *
 * Tests the pure rendering and computation functions.
 * These don't need a database - they operate on plain data structures.
 */

import { describe, expect, test } from "bun:test";
import type { Cell } from "swarm-mail";
import type { WorkerStatus, FileLock, EpicInfo, RecentMessage } from "../../src/dashboard.js";
import {
  computeSummary,
  groupCellsByStatus,
  shortId,
  formatPriority,
  renderSummaryBar,
  renderSectionHeader,
  renderReadySection,
  renderBlockedSection,
  renderActiveSection,
  renderCompletedSection,
  renderWorkersSection,
  renderLocksSection,
  renderEmptyState,
  renderDashboard,
  buildJsonOutput,
  parseStatusArgs,
  SWARM_BANNER,
  type DashboardData,
} from "./status.js";

// ============================================================================
// Test helpers
// ============================================================================

function makeCell(overrides: Partial<Cell> & { id: string; title: string }): Cell {
  return {
    project_key: "/test/project",
    type: "task",
    status: "open",
    description: null,
    priority: 2,
    parent_id: null,
    assignee: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    closed_at: null,
    closed_reason: null,
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
    created_by: null,
    ...overrides,
  };
}

function makeDashboardData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    cells: [],
    epics: [],
    workers: [],
    fileLocks: [],
    recentMessages: [],
    ...overrides,
  };
}

// Strip ANSI escape codes for assertion checks
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ============================================================================
// computeSummary
// ============================================================================

describe("computeSummary", () => {
  test("returns zeros for empty array", () => {
    const result = computeSummary([]);
    expect(result).toEqual({
      total: 0,
      completed: 0,
      ready: 0,
      blocked: 0,
      active: 0,
      percentComplete: 0,
    });
  });

  test("excludes epics from counts", () => {
    const cells: Cell[] = [
      makeCell({ id: "epic-1", title: "Epic", type: "epic", status: "in_progress" }),
      makeCell({ id: "task-1", title: "Task 1", status: "open" }),
      makeCell({ id: "task-2", title: "Task 2", status: "closed" }),
    ];
    const result = computeSummary(cells);
    expect(result.total).toBe(2); // not 3
    expect(result.completed).toBe(1);
    expect(result.percentComplete).toBe(50);
  });

  test("counts all statuses correctly", () => {
    const cells: Cell[] = [
      makeCell({ id: "t-1", title: "Open 1", status: "open" }),
      makeCell({ id: "t-2", title: "Open 2", status: "open" }),
      makeCell({ id: "t-3", title: "Blocked", status: "blocked" }),
      makeCell({ id: "t-4", title: "Active", status: "in_progress" }),
      makeCell({ id: "t-5", title: "Done 1", status: "closed" }),
      makeCell({ id: "t-6", title: "Done 2", status: "closed" }),
      makeCell({ id: "t-7", title: "Done 3", status: "closed" }),
    ];
    const result = computeSummary(cells);
    expect(result.total).toBe(7);
    expect(result.completed).toBe(3);
    expect(result.ready).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.active).toBe(1);
    expect(result.percentComplete).toBe(43); // 3/7 = 42.8 => 43
  });
});

// ============================================================================
// groupCellsByStatus
// ============================================================================

describe("groupCellsByStatus", () => {
  test("groups cells into correct buckets", () => {
    const cells: Cell[] = [
      makeCell({ id: "epic-1", title: "Epic", type: "epic", status: "in_progress" }),
      makeCell({ id: "t-1", title: "Ready", status: "open", priority: 1 }),
      makeCell({ id: "t-2", title: "Blocked", status: "blocked" }),
      makeCell({ id: "t-3", title: "Active", status: "in_progress" }),
      makeCell({ id: "t-4", title: "Done", status: "closed", closed_at: 1000 }),
    ];

    const groups = groupCellsByStatus(cells);
    expect(groups.ready.length).toBe(1);
    expect(groups.blocked.length).toBe(1);
    expect(groups.active.length).toBe(1);
    expect(groups.recentlyCompleted.length).toBe(1);
  });

  test("excludes epics from all groups", () => {
    const cells: Cell[] = [
      makeCell({ id: "epic-1", title: "Epic", type: "epic", status: "open" }),
    ];
    const groups = groupCellsByStatus(cells);
    expect(groups.ready.length).toBe(0);
    expect(groups.blocked.length).toBe(0);
    expect(groups.active.length).toBe(0);
    expect(groups.recentlyCompleted.length).toBe(0);
  });

  test("sorts ready by priority (ascending)", () => {
    const cells: Cell[] = [
      makeCell({ id: "t-1", title: "Low prio", status: "open", priority: 3 }),
      makeCell({ id: "t-2", title: "High prio", status: "open", priority: 0 }),
      makeCell({ id: "t-3", title: "Med prio", status: "open", priority: 1 }),
    ];
    const groups = groupCellsByStatus(cells);
    expect(groups.ready[0].title).toBe("High prio");
    expect(groups.ready[1].title).toBe("Med prio");
    expect(groups.ready[2].title).toBe("Low prio");
  });

  test("limits recently completed to 5", () => {
    const cells: Cell[] = Array.from({ length: 10 }, (_, i) =>
      makeCell({
        id: `t-${i}`,
        title: `Done ${i}`,
        status: "closed",
        closed_at: i * 100,
      }),
    );
    const groups = groupCellsByStatus(cells);
    expect(groups.recentlyCompleted.length).toBe(5);
  });
});

// ============================================================================
// shortId
// ============================================================================

describe("shortId", () => {
  test("extracts last segment of cell ID", () => {
    expect(shortId("cell--al4e8-mkuapgxru3p")).toBe("mkuapgx");
  });

  test("handles short IDs", () => {
    expect(shortId("abc")).toBe("abc");
  });

  test("handles IDs with many segments", () => {
    expect(shortId("a-b-c-defghijkl")).toBe("defghij");
  });
});

// ============================================================================
// formatPriority
// ============================================================================

describe("formatPriority", () => {
  test("formats P0-P3 with different styles", () => {
    expect(stripAnsi(formatPriority(0))).toBe("P0");
    expect(stripAnsi(formatPriority(1))).toBe("P1");
    expect(stripAnsi(formatPriority(2))).toBe("P2");
    expect(stripAnsi(formatPriority(3))).toBe("P3");
    expect(stripAnsi(formatPriority(5))).toBe("P5");
  });
});

// ============================================================================
// Render functions
// ============================================================================

describe("renderSummaryBar", () => {
  test("renders stats with labels", () => {
    const summary = {
      total: 10,
      completed: 5,
      ready: 3,
      blocked: 1,
      active: 1,
      percentComplete: 50,
    };
    const output = stripAnsi(renderSummaryBar(summary));
    expect(output).toContain("50%");
    expect(output).toContain("3");
    expect(output).toContain("1");
    expect(output).toContain("complete");
    expect(output).toContain("ready");
    expect(output).toContain("blocked");
    expect(output).toContain("active");
  });
});

describe("renderSectionHeader", () => {
  test("renders title with count", () => {
    const output = stripAnsi(renderSectionHeader("Ready to Work", 5));
    expect(output).toContain("Ready to Work (5)");
    expect(output).toContain("─");
  });

  test("renders title without count", () => {
    const output = stripAnsi(renderSectionHeader("Workers"));
    expect(output).toContain("Workers");
    expect(output).not.toContain("(");
  });
});

describe("renderReadySection", () => {
  test("shows empty message when no cells", () => {
    const output = stripAnsi(renderReadySection([]));
    expect(output).toContain("Ready to Work (0)");
    expect(output).toContain("No tasks ready");
  });

  test("shows cells with priority", () => {
    const cells: Cell[] = [
      makeCell({ id: "cell--a-bbbbbbb", title: "Do the thing", priority: 1 }),
    ];
    const output = stripAnsi(renderReadySection(cells));
    expect(output).toContain("[ ]");
    expect(output).toContain("Do the thing");
    expect(output).toContain("P1");
  });

  test("truncates at 8 items", () => {
    const cells: Cell[] = Array.from({ length: 12 }, (_, i) =>
      makeCell({ id: `t-${i}`, title: `Task ${i}`, priority: 2 }),
    );
    const output = stripAnsi(renderReadySection(cells));
    expect(output).toContain("... and 4 more");
  });
});

describe("renderBlockedSection", () => {
  test("returns empty string when no blocked cells", () => {
    expect(renderBlockedSection([])).toBe("");
  });

  test("shows blocked cells with blocker reference", () => {
    const cells: Cell[] = [
      makeCell({
        id: "cell--a-blockedone",
        title: "Deploy to prod",
        status: "blocked",
        parent_id: "cell--a-blocker1",
      }),
    ];
    const output = stripAnsi(renderBlockedSection(cells));
    expect(output).toContain("[!]");
    expect(output).toContain("Deploy to prod");
    expect(output).toContain("[B:");
  });
});

describe("renderActiveSection", () => {
  test("returns empty string when no active cells", () => {
    expect(renderActiveSection([])).toBe("");
  });

  test("shows active cells with assignee", () => {
    const cells: Cell[] = [
      makeCell({
        id: "cell--a-active01",
        title: "Implement auth",
        status: "in_progress",
        assignee: "worker-1",
      }),
    ];
    const output = stripAnsi(renderActiveSection(cells));
    expect(output).toContain("▶");
    expect(output).toContain("Implement auth");
    expect(output).toContain("[worker-1]");
  });
});

describe("renderCompletedSection", () => {
  test("returns empty string when no completed cells", () => {
    expect(renderCompletedSection([])).toBe("");
  });

  test("shows completed cells with checkmark", () => {
    const cells: Cell[] = [
      makeCell({ id: "cell--a-done001", title: "Setup schema", status: "closed" }),
    ];
    const output = stripAnsi(renderCompletedSection(cells));
    expect(output).toContain("[✓]");
    expect(output).toContain("Setup schema");
  });
});

describe("renderWorkersSection", () => {
  test("returns empty string when no workers", () => {
    expect(renderWorkersSection([])).toBe("");
  });

  test("shows workers with status icons", () => {
    const workers: WorkerStatus[] = [
      { agent_name: "worker-1", status: "working", current_task: "cell--a-task001", last_activity: new Date().toISOString() },
      { agent_name: "worker-2", status: "idle", last_activity: new Date().toISOString() },
      { agent_name: "worker-3", status: "blocked", current_task: "cell--a-task002", last_activity: new Date().toISOString() },
    ];
    const output = stripAnsi(renderWorkersSection(workers));
    expect(output).toContain("worker-1");
    expect(output).toContain("(working)");
    expect(output).toContain("worker-2");
    expect(output).toContain("(idle)");
    expect(output).toContain("worker-3");
    expect(output).toContain("(blocked)");
  });
});

describe("renderLocksSection", () => {
  test("returns empty string when no locks", () => {
    expect(renderLocksSection([])).toBe("");
  });

  test("shows file locks", () => {
    const locks: FileLock[] = [
      { path: "src/auth.ts", agent_name: "worker-1", reason: "editing", acquired_at: new Date().toISOString(), ttl_seconds: 300 },
    ];
    const output = stripAnsi(renderLocksSection(locks));
    expect(output).toContain("src/auth.ts");
    expect(output).toContain("worker-1");
  });
});

// ============================================================================
// renderEmptyState
// ============================================================================

describe("renderEmptyState", () => {
  test("shows banner and getting-started info", () => {
    const output = stripAnsi(renderEmptyState());
    // ASCII art banner contains "/ __" (the S in SWARM)
    expect(output).toContain("/ __");
    expect(output).toContain("No swarm activity");
    expect(output).toContain("swarm setup");
    expect(output).toContain("swarm init");
  });
});

// ============================================================================
// renderDashboard (integration of all sections)
// ============================================================================

describe("renderDashboard", () => {
  test("shows empty state for no cells", () => {
    const data = makeDashboardData();
    const output = stripAnsi(renderDashboard(data));
    expect(output).toContain("No swarm activity");
  });

  test("renders full dashboard with mixed cells", () => {
    const data = makeDashboardData({
      cells: [
        makeCell({ id: "t-1", title: "Open task", status: "open", priority: 1 }),
        makeCell({ id: "t-2", title: "Blocked task", status: "blocked", priority: 2 }),
        makeCell({ id: "t-3", title: "Active task", status: "in_progress", priority: 2 }),
        makeCell({ id: "t-4", title: "Done task", status: "closed", closed_at: 1000 }),
      ],
      workers: [
        { agent_name: "w-1", status: "working", current_task: "t-3", last_activity: new Date().toISOString() },
      ],
    });

    const output = stripAnsi(renderDashboard(data));

    // Banner (ASCII art)
    expect(output).toContain("/ __");

    // Summary stats
    expect(output).toContain("25%"); // 1 of 4 complete
    expect(output).toContain("complete");

    // Sections
    expect(output).toContain("In Progress");
    expect(output).toContain("Active task");
    expect(output).toContain("Ready to Work");
    expect(output).toContain("Open task");
    expect(output).toContain("Blocked");
    expect(output).toContain("Blocked task");
    expect(output).toContain("Workers");
    expect(output).toContain("Recently Completed");
    expect(output).toContain("Done task");
  });

  test("skips empty sections", () => {
    const data = makeDashboardData({
      cells: [
        makeCell({ id: "t-1", title: "Open task", status: "open" }),
      ],
    });
    const output = stripAnsi(renderDashboard(data));
    // These sections should not appear (no cells in those states)
    expect(output).not.toContain("In Progress");
    expect(output).not.toContain("Blocked");
    expect(output).not.toContain("Workers");
    expect(output).not.toContain("Recently Completed");
  });
});

// ============================================================================
// buildJsonOutput
// ============================================================================

describe("buildJsonOutput", () => {
  test("returns structured JSON with summary", () => {
    const data = makeDashboardData({
      cells: [
        makeCell({ id: "t-1", title: "Open", status: "open", priority: 1 }),
        makeCell({ id: "t-2", title: "Done", status: "closed" }),
      ],
    });

    const json = buildJsonOutput(data) as any;

    expect(json.summary).toBeDefined();
    expect(json.summary.total).toBe(2);
    expect(json.summary.completed).toBe(1);
    expect(json.summary.percentComplete).toBe(50);

    expect(json.ready).toHaveLength(1);
    expect(json.ready[0].id).toBe("t-1");
    expect(json.ready[0].title).toBe("Open");

    expect(json.recentlyCompleted).toHaveLength(1);
    expect(json.recentlyCompleted[0].id).toBe("t-2");
  });

  test("includes workers and file locks", () => {
    const data = makeDashboardData({
      workers: [
        { agent_name: "w-1", status: "working", current_task: "t-1", last_activity: "2024-01-01T00:00:00Z" },
      ],
      fileLocks: [
        { path: "src/auth.ts", agent_name: "w-1", reason: "editing", acquired_at: "2024-01-01T00:00:00Z", ttl_seconds: 300 },
      ],
    });

    const json = buildJsonOutput(data) as any;
    expect(json.workers).toHaveLength(1);
    expect(json.fileLocks).toHaveLength(1);
  });
});

// ============================================================================
// parseStatusArgs
// ============================================================================

describe("parseStatusArgs", () => {
  test("parses --json flag", () => {
    expect(parseStatusArgs(["--json"])).toEqual({ json: true });
  });

  test("returns defaults for no args", () => {
    expect(parseStatusArgs([])).toEqual({});
  });

  test("ignores unknown flags", () => {
    expect(parseStatusArgs(["--foo", "bar"])).toEqual({});
  });
});
