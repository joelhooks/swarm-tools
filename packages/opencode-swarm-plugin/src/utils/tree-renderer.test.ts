/**
 * @fileoverview Tests for tree-renderer.ts
 *
 * TDD approach: Write tests first, then implement.
 * Test pure functions for ASCII tree rendering.
 *
 * Inspired by Chainlink's tree visualization.
 * Credit: https://github.com/dollspace-gay/chainlink
 */

import { describe, expect, test } from "bun:test";
import {
  renderTreeNode,
  renderTree,
  buildTreeStructure,
  formatCellLine,
  getStatusIndicator,
  getStatusMarker,
  getPriorityLabel,
  colorByPriority,
  formatEpicCompletion,
  formatBlockers,
  shortId,
  truncateLine,
  ansi,
  type TreeNode,
  type BlockerMap,
} from "./tree-renderer.js";
import type { Cell } from "swarm-mail";

// Helper to create a minimal Cell for testing
function makeCell(overrides: Partial<Cell> & { id: string; title: string }): Cell {
  return {
    project_key: "test",
    type: "task",
    status: "open",
    priority: 2,
    description: null,
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

// Helper to create a TreeNode
function makeNode(
  cellOverrides: Partial<Cell> & { id: string; title: string },
  children: TreeNode[] = [],
): TreeNode {
  return { cell: makeCell(cellOverrides), children };
}

// ============================================================================
// Status Indicators
// ============================================================================

describe("getStatusIndicator (legacy)", () => {
  test("returns ○ for open", () => {
    expect(getStatusIndicator("open")).toBe("○");
  });
  test("returns ◐ for in_progress", () => {
    expect(getStatusIndicator("in_progress")).toBe("◐");
  });
  test("returns ● for closed", () => {
    expect(getStatusIndicator("closed")).toBe("●");
  });
  test("returns ⊘ for blocked", () => {
    expect(getStatusIndicator("blocked")).toBe("⊘");
  });
});

describe("getStatusMarker", () => {
  test("returns [ ] for open", () => {
    expect(getStatusMarker("open")).toBe("[ ]");
  });
  test("returns [~] for in_progress", () => {
    expect(getStatusMarker("in_progress")).toBe("[~]");
  });
  test("returns [x] for closed", () => {
    expect(getStatusMarker("closed")).toBe("[x]");
  });
  test("returns [!] for blocked", () => {
    expect(getStatusMarker("blocked")).toBe("[!]");
  });
  test("defaults to [ ] for unknown", () => {
    expect(getStatusMarker("whatever")).toBe("[ ]");
  });
});

// ============================================================================
// Priority
// ============================================================================

describe("getPriorityLabel", () => {
  test("returns P0 for priority 0", () => {
    expect(getPriorityLabel(0)).toBe("P0");
  });
  test("returns P1 for priority 1", () => {
    expect(getPriorityLabel(1)).toBe("P1");
  });
  test("returns P2 for priority 2", () => {
    expect(getPriorityLabel(2)).toBe("P2");
  });
  test("returns P3 for priority 3", () => {
    expect(getPriorityLabel(3)).toBe("P3");
  });
  test("returns empty for negative priority", () => {
    expect(getPriorityLabel(-1)).toBe("");
  });
  test("returns empty for priority > 3", () => {
    expect(getPriorityLabel(4)).toBe("");
  });
});

describe("colorByPriority", () => {
  test("P0 gets red color", () => {
    const result = colorByPriority("test", 0);
    expect(result).toContain("\x1b[31m");
    expect(result).toContain("test");
  });
  test("P1 gets red color", () => {
    const result = colorByPriority("test", 1);
    expect(result).toContain("\x1b[31m");
  });
  test("P2 gets yellow color", () => {
    const result = colorByPriority("test", 2);
    expect(result).toContain("\x1b[33m");
  });
  test("P3 gets no color", () => {
    const result = colorByPriority("test", 3);
    expect(result).toBe("test");
  });
  test("P5 gets no color", () => {
    const result = colorByPriority("test", 5);
    expect(result).toBe("test");
  });
});

// ============================================================================
// Utility Helpers
// ============================================================================

describe("shortId", () => {
  test("returns last 5 chars", () => {
    expect(shortId("cell--abc12-xyz45")).toBe("xyz45");
  });
  test("returns full string if <= 5 chars", () => {
    expect(shortId("abc")).toBe("abc");
  });
});

describe("formatBlockers", () => {
  test("returns empty for no blockers", () => {
    expect(formatBlockers([])).toBe("");
  });
  test("formats single blocker", () => {
    expect(formatBlockers(["cell--abc12-def34"])).toBe(" [B: def34]");
  });
  test("formats multiple blockers", () => {
    expect(formatBlockers(["cell--abc12-def34", "cell--abc12-ghi56"])).toBe(
      " [B: def34, ghi56]",
    );
  });
});

// ============================================================================
// Epic Completion
// ============================================================================

describe("formatEpicCompletion", () => {
  test("returns empty for non-epic", () => {
    const node = makeNode({ id: "t1", title: "Task", type: "task" });
    expect(formatEpicCompletion(node)).toBe("");
  });

  test("returns empty for epic with no children", () => {
    const node = makeNode({ id: "e1", title: "Epic", type: "epic" });
    expect(formatEpicCompletion(node)).toBe("");
  });

  test("shows completion for epic with children", () => {
    const children = [
      makeNode({ id: "t1", title: "T1", status: "closed" }),
      makeNode({ id: "t2", title: "T2", status: "open" }),
      makeNode({ id: "t3", title: "T3", status: "closed" }),
    ];
    const node = makeNode({ id: "e1", title: "Epic", type: "epic" }, children);
    expect(formatEpicCompletion(node)).toBe(" (2/3 done)");
  });

  test("shows 0 done for all open children", () => {
    const children = [
      makeNode({ id: "t1", title: "T1", status: "open" }),
      makeNode({ id: "t2", title: "T2", status: "in_progress" }),
    ];
    const node = makeNode({ id: "e1", title: "Epic", type: "epic" }, children);
    expect(formatEpicCompletion(node)).toBe(" (0/2 done)");
  });
});

// ============================================================================
// Line Truncation
// ============================================================================

describe("truncateLine", () => {
  test("returns line as-is when short enough", () => {
    expect(truncateLine("hello", 80)).toBe("hello");
  });

  test("truncates long plain text", () => {
    const long = "a".repeat(100);
    const result = truncateLine(long, 50);
    const stripped = ansi.strip(result);
    expect(stripped.length).toBeLessThanOrEqual(50);
    expect(stripped).toContain("…");
  });

  test("handles ANSI codes correctly during truncation", () => {
    const line = "\x1b[31m" + "a".repeat(100) + "\x1b[0m";
    const result = truncateLine(line, 50);
    // The visible chars should be <= 50
    const stripped = ansi.strip(result);
    expect(stripped.length).toBeLessThanOrEqual(50);
  });
});

describe("ansi.strip", () => {
  test("strips ANSI codes", () => {
    expect(ansi.strip("\x1b[31mhello\x1b[0m")).toBe("hello");
  });
  test("leaves plain text unchanged", () => {
    expect(ansi.strip("hello")).toBe("hello");
  });
});

// ============================================================================
// formatCellLine (new TreeNode-based)
// ============================================================================

describe("formatCellLine", () => {
  test("formats open task with status marker and short ID", () => {
    const node = makeNode({ id: "cell--abc12-xyz45", title: "Test Task", priority: 1 });
    const result = formatCellLine(node);
    const stripped = ansi.strip(result);

    expect(stripped).toContain("[ ]");
    expect(stripped).toContain("xyz45");
    expect(stripped).toContain("Test Task");
    expect(stripped).toContain("(P1)");
  });

  test("formats closed task", () => {
    const node = makeNode({ id: "cell-1", title: "Done", status: "closed", priority: 3 });
    const result = formatCellLine(node);
    const stripped = ansi.strip(result);

    expect(stripped).toContain("[x]");
    expect(stripped).toContain("Done");
    expect(stripped).toContain("(P3)");
  });

  test("formats in_progress task", () => {
    const node = makeNode({ id: "cell-2", title: "Working", status: "in_progress" });
    const stripped = ansi.strip(formatCellLine(node));
    expect(stripped).toContain("[~]");
  });

  test("formats blocked task with blockers", () => {
    const node = makeNode({ id: "cell-3", title: "Stuck", status: "blocked", priority: 1 });
    const blockers: BlockerMap = new Map([["cell-3", ["cell--abc-blocker1", "cell--def-blocker2"]]]);
    const result = formatCellLine(node, { blockers });
    const stripped = ansi.strip(result);

    expect(stripped).toContain("[!]");
    expect(stripped).toContain("[B: cker1, cker2]"); // last 5 chars of blocker IDs
  });

  test("formats epic with completion count", () => {
    const children = [
      makeNode({ id: "c1", title: "C1", status: "closed" }),
      makeNode({ id: "c2", title: "C2", status: "open" }),
    ];
    const node = makeNode({ id: "e1", title: "My Epic", type: "epic" }, children);
    const stripped = ansi.strip(formatCellLine(node));

    expect(stripped).toContain("My Epic");
    expect(stripped).toContain("(1/2 done)");
  });

  test("omits priority label when priority > 3", () => {
    const node = makeNode({ id: "t1", title: "Task", priority: 5 });
    const stripped = ansi.strip(formatCellLine(node));
    expect(stripped).not.toContain("(P5)");
  });

  test("applies red color for P0", () => {
    const node = makeNode({ id: "t1", title: "Critical", priority: 0 });
    const result = formatCellLine(node);
    expect(result).toContain("\x1b[31m"); // red
  });

  test("applies yellow color for P2", () => {
    const node = makeNode({ id: "t1", title: "Medium", priority: 2 });
    const result = formatCellLine(node);
    expect(result).toContain("\x1b[33m"); // yellow
  });
});

// ============================================================================
// buildTreeStructure
// ============================================================================

describe("buildTreeStructure", () => {
  test("builds flat structure when no parent_id", () => {
    const cells = [
      makeCell({ id: "cell-1", title: "Task 1", priority: 1 }),
      makeCell({ id: "cell-2", title: "Task 2", priority: 2 }),
    ];

    const tree = buildTreeStructure(cells);
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toEqual([]);
    expect(tree[1].children).toEqual([]);
  });

  test("nests children under parent", () => {
    const cells = [
      makeCell({ id: "epic-1", title: "Epic", type: "epic", priority: 0 }),
      makeCell({ id: "task-1", title: "Task 1", parent_id: "epic-1", priority: 1 }),
      makeCell({ id: "task-2", title: "Task 2", parent_id: "epic-1", priority: 2 }),
    ];

    const tree = buildTreeStructure(cells);
    expect(tree).toHaveLength(1);
    expect(tree[0].cell.id).toBe("epic-1");
    expect(tree[0].children).toHaveLength(2);
  });

  test("handles multi-level nesting", () => {
    const cells = [
      makeCell({ id: "epic-1", title: "Epic", type: "epic", priority: 0 }),
      makeCell({ id: "task-1", title: "Task 1", parent_id: "epic-1", priority: 1 }),
      makeCell({ id: "sub-1", title: "Subtask", parent_id: "task-1", priority: 2 }),
    ];

    const tree = buildTreeStructure(cells);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].cell.id).toBe("sub-1");
  });

  test("orphans without parent go to root", () => {
    const cells = [
      makeCell({ id: "task-1", title: "Task", parent_id: "nonexistent" }),
    ];

    const tree = buildTreeStructure(cells);
    expect(tree).toHaveLength(1);
    expect(tree[0].cell.id).toBe("task-1");
  });

  test("sorts children by priority", () => {
    const cells = [
      makeCell({ id: "epic-1", title: "Epic", type: "epic", priority: 0 }),
      makeCell({ id: "task-3", title: "Low", parent_id: "epic-1", priority: 3 }),
      makeCell({ id: "task-0", title: "Critical", parent_id: "epic-1", priority: 0 }),
      makeCell({ id: "task-1", title: "High", parent_id: "epic-1", priority: 1 }),
    ];

    const tree = buildTreeStructure(cells);
    expect(tree[0].children[0].cell.priority).toBe(0);
    expect(tree[0].children[1].cell.priority).toBe(1);
    expect(tree[0].children[2].cell.priority).toBe(3);
  });
});

// ============================================================================
// renderTreeNode
// ============================================================================

describe("renderTreeNode", () => {
  test("renders single node without children", () => {
    const node = makeNode({ id: "cell-1", title: "Task", priority: 1 });
    const lines = renderTreeNode(node, "", true);

    expect(lines).toHaveLength(1);
    const stripped = ansi.strip(lines[0]);
    expect(stripped).toContain("[ ]");
    expect(stripped).toContain("Task");
  });

  test("renders parent with single child using └──", () => {
    const child = makeNode({ id: "task-1", title: "Child", parent_id: "epic-1" });
    const node = makeNode({ id: "epic-1", title: "Epic", type: "epic" }, [child]);

    const lines = renderTreeNode(node, "", true);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("└──");
    const stripped = ansi.strip(lines[1]);
    expect(stripped).toContain("Child");
  });

  test("renders parent with multiple children using ├── and └──", () => {
    const children = [
      makeNode({ id: "t1", title: "Task 1", parent_id: "e1", priority: 1 }),
      makeNode({ id: "t2", title: "Task 2", parent_id: "e1", priority: 2 }),
    ];
    const node = makeNode({ id: "e1", title: "Epic", type: "epic" }, children);

    const lines = renderTreeNode(node, "", true);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("├──");
    expect(lines[2]).toContain("└──");
  });

  test("renders deep nesting with correct prefixes", () => {
    const subtask = makeNode({ id: "s1", title: "Subtask", parent_id: "t1" });
    const task = makeNode({ id: "t1", title: "Task", parent_id: "e1" }, [subtask]);
    const node = makeNode({ id: "e1", title: "Epic", type: "epic" }, [task]);

    const lines = renderTreeNode(node, "", true);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain("└──");
    const stripped = ansi.strip(lines[2]);
    expect(stripped).toContain("Subtask");
  });

  test("passes blocker info through rendering", () => {
    const blockers: BlockerMap = new Map([["blocked-1", ["dep-abc12"]]]);
    const node = makeNode({ id: "blocked-1", title: "Blocked", status: "blocked" });

    const lines = renderTreeNode(node, "", true, { blockers });
    const stripped = ansi.strip(lines[0]);
    expect(stripped).toContain("[!]");
    expect(stripped).toContain("[B: abc12]"); // last 5 chars
  });
});

// ============================================================================
// renderTree (integration)
// ============================================================================

describe("renderTree", () => {
  test("renders complete tree matching expected format", () => {
    // Build a tree matching the spec example
    // Use IDs where the last 5 chars are readable short IDs
    const epicId = "cell-abc12";       // shortId = bc12
    const taskAId = "cell-def45";      // shortId = def45
    const subtaskId = "cell-ghi78";    // shortId = ghi78
    const taskBId = "cell-jkl01";      // shortId = jkl01
    const taskCId = "cell-mno34";      // shortId = mno34

    const children = [
      makeNode({ id: taskAId, title: "Implement JWT middleware", status: "in_progress", priority: 1, parent_id: epicId }, [
        makeNode({ id: subtaskId, title: "Add token verification", status: "open", priority: 5, parent_id: taskAId }),
      ]),
      makeNode({ id: taskBId, title: "Setup database schema", status: "closed", priority: 5, parent_id: epicId }),
      makeNode({ id: taskCId, title: "Add password reset", status: "blocked", priority: 5, parent_id: epicId }),
    ];
    const root = makeNode(
      { id: epicId, title: "Add authentication system", type: "epic", priority: 5 },
      children,
    );

    const blockers: BlockerMap = new Map([
      [taskCId, [taskAId]],
    ]);

    const output = renderTree([root], { blockers, terminalWidth: 120 });
    const stripped = ansi.strip(output);

    // Root: epic with completion
    expect(stripped).toContain("[ ] abc12: Add authentication system (1/3 done)");
    // In-progress child with P1
    expect(stripped).toContain("[~] def45: Implement JWT middleware (P1)");
    // Connector characters
    expect(stripped).toContain("├──");
    expect(stripped).toContain("└──");
    expect(stripped).toContain("│");
    // Closed child
    expect(stripped).toContain("[x] jkl01: Setup database schema");
    // Blocked child with blocker
    expect(stripped).toContain("[!] mno34: Add password reset");
    expect(stripped).toContain("[B: def45]"); // last 5 chars of taskAId
  });

  test("adds blank line between root nodes", () => {
    const roots = [
      makeNode({ id: "r1", title: "Root 1" }),
      makeNode({ id: "r2", title: "Root 2" }),
    ];

    const output = renderTree(roots);
    const lines = output.split("\n");
    expect(lines).toHaveLength(3); // root1, blank, root2
    expect(lines[1]).toBe("");
  });
});
