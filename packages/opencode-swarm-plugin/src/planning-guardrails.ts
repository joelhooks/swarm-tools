/**
 * Planning Guardrails
 *
 * Detects when agents are about to make planning mistakes and warns them.
 * Non-blocking - just emits warnings to help agents self-correct.
 *
 * @module planning-guardrails
 */

/**
 * Patterns that suggest file modification work
 * These indicate the todo is about implementation, not tracking
 */
const FILE_MODIFICATION_PATTERNS = [
  /\bimplement\b/i,
  /\bcreate\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /\badd\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /\bupdate\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /\bmodify\b/i,
  /\brefactor\b/i,
  /\bextract\b/i,
  /\bmigrate\b/i,
  /\bconvert\b/i,
  /\brewrite\b/i,
  /\bfix\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /\bwrite\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /src\//i,
  /lib\//i,
  /packages?\//i,
  /components?\//i,
];

/**
 * Patterns that suggest this is tracking/coordination work (OK for todowrite)
 */
const TRACKING_PATTERNS = [
  /\breview\b/i,
  /\bcheck\b/i,
  /\bverify\b/i,
  /\btest\b.*pass/i,
  /\brun\b.*test/i,
  /\bdeploy\b/i,
  /\bmerge\b/i,
  /\bpr\b/i,
  /\bpush\b/i,
  /\bcommit\b/i,
];

/**
 * Result of analyzing todowrite args
 */
export interface TodoWriteAnalysis {
  /** Whether this looks like parallel work that should use swarm */
  looksLikeParallelWork: boolean;

  /** Number of todos that look like file modifications */
  fileModificationCount: number;

  /** Total number of todos */
  totalCount: number;

  /** Warning message if applicable */
  warning?: string;
}

/**
 * Analyze todowrite args to detect potential planning mistakes
 *
 * Triggers warning when:
 * - 6+ todos created in one call
 * - Most todos match file modification patterns
 * - Few todos match tracking patterns
 *
 * @param args - The todowrite tool arguments
 * @returns Analysis result with optional warning
 */
export function analyzeTodoWrite(args: { todos?: unknown[] }): TodoWriteAnalysis {
  const todos = args.todos;

  // Not enough todos to analyze
  if (!todos || !Array.isArray(todos) || todos.length < 6) {
    return {
      looksLikeParallelWork: false,
      fileModificationCount: 0,
      totalCount: todos?.length ?? 0,
    };
  }

  // Count todos that look like file modifications
  let fileModificationCount = 0;

  for (const todo of todos) {
    if (typeof todo !== "object" || todo === null) continue;

    const content = (todo as { content?: string }).content ?? "";

    // Check if it matches file modification patterns
    const isFileModification = FILE_MODIFICATION_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    // Check if it matches tracking patterns
    const isTracking = TRACKING_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (isFileModification && !isTracking) {
      fileModificationCount++;
    }
    // trackingCount not currently used but kept for future ratio analysis
  }

  // Trigger warning if most todos look like file modifications
  const ratio = fileModificationCount / todos.length;
  const looksLikeParallelWork = ratio >= 0.5 && fileModificationCount >= 4;

  if (looksLikeParallelWork) {
    return {
      looksLikeParallelWork: true,
      fileModificationCount,
      totalCount: todos.length,
      warning: `⚠️  This looks like a multi-file implementation plan (${fileModificationCount}/${todos.length} items are file modifications).

Consider using swarm instead:
  swarm_decompose → hive_create_epic → parallel task spawns

TodoWrite is for tracking progress, not parallelizable implementation work.
Swarm workers can complete these ${fileModificationCount} tasks in parallel.

(Continuing with todowrite - this is just a suggestion)`,
    };
  }

  return {
    looksLikeParallelWork: false,
    fileModificationCount,
    totalCount: todos.length,
  };
}

/**
 * Check if a tool call should trigger planning guardrails
 *
 * @param toolName - Name of the tool being called
 * @returns Whether this tool should be analyzed
 */
export function shouldAnalyzeTool(toolName: string): boolean {
  return toolName === "todowrite" || toolName === "TodoWrite";
}
