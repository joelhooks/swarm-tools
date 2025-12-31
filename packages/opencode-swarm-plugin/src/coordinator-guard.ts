/**
 * Coordinator Guard - Runtime Violation Enforcement
 *
 * Detects and REJECTS coordinator protocol violations at runtime.
 * Unlike planning-guardrails.ts (which only warns), this guard throws errors
 * to prevent coordinators from performing work that should be delegated to workers.
 *
 * Coordinators MUST:
 * - Spawn workers via swarm_spawn_subtask
 * - Review worker output via swarm_review
 * - Coordinate and monitor, not implement
 *
 * Coordinators MUST NOT:
 * - Edit or write files (use workers)
 * - Run tests (workers verify their own work)
 * - Reserve files (workers reserve before editing)
 *
 * @module coordinator-guard
 */

/**
 * Custom error for coordinator guard violations
 *
 * Thrown when a coordinator attempts to perform work that should be delegated to workers.
 * Includes helpful suggestions for the correct approach.
 */
export class CoordinatorGuardError extends Error {
  /** Type of violation that occurred */
  public violationType:
    | "coordinator_edited_file"
    | "coordinator_ran_tests"
    | "coordinator_reserved_files";

  /** Additional context about the violation */
  public payload: Record<string, unknown>;

  /** Helpful suggestion for fixing the violation */
  public suggestion?: string;

  constructor(
    message: string,
    violationType:
      | "coordinator_edited_file"
      | "coordinator_ran_tests"
      | "coordinator_reserved_files",
    payload: Record<string, unknown> = {},
    suggestion?: string
  ) {
    super(message);
    this.name = "CoordinatorGuardError";
    this.violationType = violationType;
    this.payload = payload;
    this.suggestion = suggestion;
  }
}

/**
 * Tool names that modify files
 *
 * Coordinators should NEVER call these tools directly.
 * Workers reserve files and make modifications.
 */
const FILE_MODIFICATION_TOOLS = ["edit", "write"] as const;

/**
 * Tool names for file reservations
 *
 * Coordinators don't reserve files - workers do this
 * before editing to prevent conflicts.
 */
const RESERVATION_TOOLS = ["swarmmail_reserve", "agentmail_reserve"] as const;

/**
 * Regex patterns that indicate test execution in bash commands
 *
 * Coordinators review test results, workers run tests.
 * Matches common test runners and test file patterns.
 */
const TEST_EXECUTION_PATTERNS = [
  /\bbun\s+test\b/i,
  /\bnpm\s+(run\s+)?test/i,
  /\byarn\s+(run\s+)?test/i,
  /\bpnpm\s+(run\s+)?test/i,
  /\bjest\b/i,
  /\bvitest\b/i,
  /\bmocha\b/i,
  /\bava\b/i,
  /\btape\b/i,
  /\.test\.(ts|js|tsx|jsx)\b/i,
  /\.spec\.(ts|js|tsx|jsx)\b/i,
] as const;

/**
 * Result of coordinator guard check
 */
export interface GuardCheckResult {
  /** Whether the tool call is blocked */
  blocked: boolean;

  /** Error if blocked */
  error?: CoordinatorGuardError;
}

/**
 * Check if the current agent context is a coordinator
 *
 * @param agentContext - Agent context type
 * @returns True if coordinator, false otherwise
 */
export function isCoordinator(
  agentContext: "coordinator" | "worker" | string
): agentContext is "coordinator" {
  return agentContext === "coordinator";
}

/**
 * Check coordinator guard for potential violations
 *
 * This is the main entry point for the guard. It checks if the current tool call
 * violates coordinator protocol and returns a result indicating whether to block
 * the call and what error to throw.
 *
 * @param params - Guard check parameters
 * @returns Guard check result with block status and optional error
 *
 * @example
 * ```ts
 * const result = checkCoordinatorGuard({
 *   agentContext: "coordinator",
 *   toolName: "edit",
 *   toolArgs: { filePath: "src/auth.ts" },
 * });
 *
 * if (result.blocked) {
 *   throw result.error; // Prevents coordinator from editing files
 * }
 * ```
 */
export function checkCoordinatorGuard(params: {
  agentContext: "coordinator" | "worker" | string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}): GuardCheckResult {
  const { agentContext, toolName, toolArgs } = params;

  // Workers are allowed to do everything
  if (!isCoordinator(agentContext)) {
    return { blocked: false };
  }

  // Check for file modification violation
  if (FILE_MODIFICATION_TOOLS.includes(toolName as any)) {
    const file = (toolArgs.filePath as string) || "unknown";

    return {
      blocked: true,
      error: new CoordinatorGuardError(
        `❌ COORDINATOR VIOLATION: Coordinators must spawn a worker to edit files.

You attempted to ${toolName}: ${file}

Coordinators orchestrate work, they don't implement it.

Instead:
1. Use swarm_spawn_subtask to spawn a worker for this file
2. Let the worker reserve the file and make edits
3. Review the worker's output when complete

This guard exists to prevent the #1 coordinator anti-pattern.`,
        "coordinator_edited_file",
        { tool: toolName, file },
        "Use swarm_spawn_subtask to spawn a worker, then let the worker edit the file"
      ),
    };
  }

  // Check for test execution violation
  if (toolName === "bash") {
    const command = (toolArgs.command as string) || "";
    const isTestCommand = TEST_EXECUTION_PATTERNS.some((pattern) =>
      pattern.test(command)
    );

    if (isTestCommand) {
      return {
        blocked: true,
        error: new CoordinatorGuardError(
          `❌ COORDINATOR VIOLATION: Coordinators must not run tests.

You attempted to run: ${command}

Workers run tests as part of their implementation verification.
Coordinators review the test results.

Instead:
1. Let workers run tests in their implementation workflow
2. Workers call swarm_complete which runs tests automatically
3. Review test results from worker output

This guard prevents coordinators from doing workers' verification work.`,
          "coordinator_ran_tests",
          { tool: toolName, command },
          "Let workers run tests via swarm_complete"
        ),
      };
    }
  }

  // Check for file reservation violation
  if (RESERVATION_TOOLS.includes(toolName as any)) {
    const paths = (toolArgs.paths as string[]) || [];

    return {
      blocked: true,
      error: new CoordinatorGuardError(
        `❌ COORDINATOR VIOLATION: Coordinators must not reserve files.

You attempted to reserve: ${paths.join(", ")}

Workers reserve files before editing to prevent conflicts.
Coordinators don't edit files, so they don't reserve them.

Instead:
1. Spawn workers via swarm_spawn_subtask
2. Workers will reserve files they need to modify
3. Coordinate if multiple workers need the same files

This guard prevents coordinators from performing worker setup steps.`,
        "coordinator_reserved_files",
        { tool: toolName, paths },
        "Spawn workers who will reserve files themselves"
      ),
    };
  }

  // No violation detected
  return { blocked: false };
}
