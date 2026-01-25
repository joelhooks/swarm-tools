/**
 * @fileoverview Tree visualization utilities for cell hierarchies
 *
 * Inspired by Chainlink's tree command.
 * Credit: https://github.com/dollspace-gay/chainlink
 *
 * Renders cell/epic hierarchies with box-drawing characters and rich indicators:
 * - [x] closed, [ ] open, [~] in_progress, [!] blocked
 * - Priority coloring: P0/P1 = red, P2 = yellow, P3+ = default
 * - Blocker IDs: [B: abc12, def34] for blocked cells
 * - Epic completion: (3/5 done)
 * - Proper tree connectors: ├──, └──, │
 */

import type { Cell } from "swarm-mail";

// ============================================================================
// ANSI Color Helpers
// ============================================================================

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

export const ansi = {
  red: (s: string) => `${RED}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  /**
   * Strip ANSI escape codes for length calculation
   */
  strip: (s: string) => s.replace(/\x1b\[[0-9;]*m/g, ""),
};

// ============================================================================
// Types
// ============================================================================

export interface TreeNode {
  cell: Cell;
  children: TreeNode[];
}

export interface CellDisplay {
  title: string;
  type: string;
  status: string;
  priority: number;
  blocked: boolean;
}

/**
 * Blocker info map: cell_id -> array of blocker cell IDs
 */
export type BlockerMap = Map<string, string[]>;

/**
 * Options for rendering the tree
 */
export interface TreeRenderOptions {
  /** Map of cell_id -> blocker IDs */
  blockers?: BlockerMap;
  /** Terminal width for truncation (default: process.stdout.columns || 80) */
  terminalWidth?: number;
}

// ============================================================================
// Status Indicators
// ============================================================================

/**
 * Get status marker in checkbox style
 */
export function getStatusMarker(status: string): string {
  switch (status) {
    case "open":
      return "[ ]";
    case "in_progress":
      return "[~]";
    case "closed":
      return "[x]";
    case "blocked":
      return "[!]";
    default:
      return "[ ]";
  }
}

/**
 * Get status indicator character (legacy, kept for compatibility)
 */
export function getStatusIndicator(status: string): string {
  switch (status) {
    case "open":
      return "○";
    case "in_progress":
      return "◐";
    case "closed":
      return "●";
    case "blocked":
      return "⊘";
    default:
      return "○";
  }
}

// ============================================================================
// Priority Helpers
// ============================================================================

/**
 * Get priority label (P0-P3)
 */
export function getPriorityLabel(priority: number): string {
  if (priority < 0 || priority > 3) {
    return "";
  }
  return `P${priority}`;
}

/**
 * Apply priority coloring to a string
 * P0/P1 = red, P2 = yellow, P3+ = default
 */
export function colorByPriority(text: string, priority: number): string {
  if (priority <= 1) {
    return ansi.red(text);
  }
  if (priority === 2) {
    return ansi.yellow(text);
  }
  return text;
}

// ============================================================================
// Epic Completion
// ============================================================================

/**
 * Count closed children for epic completion display
 */
export function getEpicCompletion(node: TreeNode): { done: number; total: number } {
  const total = node.children.length;
  const done = node.children.filter((c) => c.cell.status === "closed").length;
  return { done, total };
}

/**
 * Format epic completion string: (3/5 done)
 */
export function formatEpicCompletion(node: TreeNode): string {
  if (node.cell.type !== "epic" || node.children.length === 0) {
    return "";
  }
  const { done, total } = getEpicCompletion(node);
  return ` (${done}/${total} done)`;
}

// ============================================================================
// Cell Line Formatting
// ============================================================================

/**
 * Shorten a cell ID to last 5 characters for display
 */
export function shortId(id: string): string {
  return id.slice(-5);
}

/**
 * Format blocker suffix: [B: abc12, def34]
 */
export function formatBlockers(blockerIds: string[]): string {
  if (blockerIds.length === 0) return "";
  return ` [B: ${blockerIds.map(shortId).join(", ")}]`;
}

/**
 * Format a single cell line with status marker, ID, title, priority, epic completion, and blockers
 */
export function formatCellLine(
  node: TreeNode,
  options: TreeRenderOptions = {},
): string {
  const cell = node.cell;
  const marker = getStatusMarker(cell.status);
  const id = shortId(cell.id);
  const priorityLabel = getPriorityLabel(cell.priority);
  const epicSuffix = formatEpicCompletion(node);

  // Build blocker suffix
  const blockerIds = options.blockers?.get(cell.id) ?? [];
  const blockerSuffix = formatBlockers(blockerIds);

  // Assemble the line
  // Format: [x] abc12: Title (2/5 done) (P1) [B: def34]
  let line = `${marker} ${id}: ${cell.title}`;

  if (epicSuffix) {
    line += epicSuffix;
  }

  if (priorityLabel) {
    const coloredPriority = colorByPriority(`(${priorityLabel})`, cell.priority);
    line += ` ${coloredPriority}`;
  }

  if (blockerSuffix) {
    line += ansi.red(blockerSuffix);
  }

  return line;
}

/**
 * Truncate a line to fit terminal width, accounting for ANSI codes
 */
export function truncateLine(line: string, maxWidth: number): string {
  const stripped = ansi.strip(line);
  if (stripped.length <= maxWidth) {
    return line;
  }

  // We need to truncate. Walk through the original string, tracking visible chars.
  const ellipsis = "…";
  const targetVisibleLen = maxWidth - 1; // Leave room for ellipsis
  let visibleCount = 0;
  let i = 0;

  while (i < line.length && visibleCount < targetVisibleLen) {
    // Check if we're at an ANSI escape sequence
    if (line[i] === "\x1b" && line[i + 1] === "[") {
      // Skip the entire escape sequence
      const end = line.indexOf("m", i);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    visibleCount++;
    i++;
  }

  return line.slice(0, i) + ellipsis + RESET;
}

// ============================================================================
// Legacy formatCellLine (kept for backward compat)
// ============================================================================

// The old interface is preserved since formatCellLine now takes TreeNode.
// If external code calls with CellDisplay, the new function won't match,
// but since this is an internal utility, we control all call sites.

// ============================================================================
// Tree Building
// ============================================================================

/**
 * Build tree structure from flat cell list
 *
 * Algorithm:
 * 1. Create map of id -> TreeNode
 * 2. For each cell, find parent and attach as child
 * 3. Return nodes without parents as roots
 */
export function buildTreeStructure(cells: Cell[]): TreeNode[] {
  // Create map of all nodes
  const nodeMap = new Map<string, TreeNode>();
  for (const cell of cells) {
    nodeMap.set(cell.id, { cell, children: [] });
  }

  // Build parent-child relationships
  const roots: TreeNode[] = [];
  for (const node of nodeMap.values()) {
    const parentId = node.cell.parent_id;
    if (parentId && nodeMap.has(parentId)) {
      const parent = nodeMap.get(parentId)!;
      parent.children.push(node);
    } else {
      // No parent or parent not found = root
      roots.push(node);
    }
  }

  // Sort children by priority (lower = higher priority = first)
  function sortChildren(nodes: TreeNode[]) {
    nodes.sort((a, b) => a.cell.priority - b.cell.priority);
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortChildren(node.children);
      }
    }
  }
  for (const root of roots) {
    sortChildren(root.children);
  }

  return roots;
}

// ============================================================================
// Tree Rendering
// ============================================================================

/**
 * Render a tree node with box-drawing characters
 *
 * @param node - The node to render
 * @param prefix - Prefix string for indentation (tree connectors for parent levels)
 * @param isLast - Whether this is the last child of its parent
 * @param options - Rendering options (blockers, terminal width)
 * @returns Array of output lines
 */
export function renderTreeNode(
  node: TreeNode,
  prefix: string,
  isLast: boolean,
  options: TreeRenderOptions = {},
): string[] {
  const lines: string[] = [];
  const termWidth = options.terminalWidth ?? (process.stdout.columns || 80);

  // Format this node's line
  const line = formatCellLine(node, options);
  lines.push(truncateLine(line, termWidth));

  // Render children with proper tree connectors
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const isLastChild = i === node.children.length - 1;
    const connector = isLastChild ? "└── " : "├── ";
    const childPrefix = isLastChild ? "    " : "│   ";

    const childLines = renderTreeNode(
      child,
      prefix + childPrefix,
      isLastChild,
      options,
    );

    // Add connector to first line of child
    childLines[0] = truncateLine(
      prefix + connector + childLines[0],
      termWidth,
    );

    // Remaining lines (sub-children) already have the full prefix baked in
    // from the recursive call — do NOT prepend again.

    lines.push(...childLines);
  }

  return lines;
}

/**
 * Render full tree from multiple root nodes
 */
export function renderTree(
  roots: TreeNode[],
  options: TreeRenderOptions = {},
): string {
  const allLines: string[] = [];

  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    const lines = renderTreeNode(root, "", true, options);
    allLines.push(...lines);

    // Add blank line between root nodes (except after last)
    if (i < roots.length - 1) {
      allLines.push("");
    }
  }

  return allLines.join("\n");
}
