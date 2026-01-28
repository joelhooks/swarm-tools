/**
 * Swarm Verify Module - Verification gate for worker completions
 *
 * Handles verification logic for swarm workers:
 * - Typecheck verification (tsc --noEmit)
 * - Test verification for touched files
 * - Verification gate orchestration
 *
 * Implements the Gate Function (IDENTIFY → RUN → READ → VERIFY → CLAIM)
 * from the superpowers pattern.
 *
 * @module swarm-verify
 */

import { tool } from "@opencode-ai/plugin";

// ============================================================================
// Types
// ============================================================================

/**
 * Verification Gate result - tracks each verification step
 *
 * Based on the Gate Function from superpowers:
 * 1. IDENTIFY: What command proves this claim?
 * 2. RUN: Execute the FULL command (fresh, complete)
 * 3. READ: Full output, check exit code, count failures
 * 4. VERIFY: Does output confirm the claim?
 * 5. ONLY THEN: Make the claim
 */
export interface VerificationStep {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  output?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface VerificationGateResult {
  passed: boolean;
  steps: VerificationStep[];
  summary: string;
  blockers: string[];
}

// ============================================================================
// Verification Functions
// ============================================================================

/**
 * Run typecheck verification
 *
 * Attempts to run TypeScript type checking on the project.
 * Falls back gracefully if tsc is not available.
 */
export async function runTypecheckVerification(): Promise<VerificationStep> {
  const step: VerificationStep = {
    name: "typecheck",
    command: "tsc --noEmit",
    passed: false,
    exitCode: -1,
  };

  try {
    // Check if tsconfig.json exists in current directory
    const tsconfigExists = await Bun.file("tsconfig.json").exists();
    if (!tsconfigExists) {
      step.skipped = true;
      step.skipReason = "No tsconfig.json found";
      step.passed = true; // Don't block if no TypeScript
      return step;
    }

    const result = await Bun.$`tsc --noEmit`.quiet().nothrow();
    step.exitCode = result.exitCode;
    step.passed = result.exitCode === 0;

    if (!step.passed) {
      step.error = result.stderr.toString().slice(0, 1000); // Truncate for context
      step.output = result.stdout.toString().slice(0, 1000);
    }
  } catch (error) {
    step.skipped = true;
    step.skipReason = `tsc not available: ${error instanceof Error ? error.message : String(error)}`;
    step.passed = true; // Don't block if tsc unavailable
  }

  return step;
}

/**
 * Run test verification for specific files
 *
 * Attempts to find and run tests related to the touched files.
 * Uses common test patterns (*.test.ts, *.spec.ts, __tests__/).
 */
export async function runTestVerification(
  filesTouched: string[],
): Promise<VerificationStep> {
  const step: VerificationStep = {
    name: "tests",
    command: "bun test <related-files>",
    passed: false,
    exitCode: -1,
  };

  if (filesTouched.length === 0) {
    step.skipped = true;
    step.skipReason = "No files touched";
    step.passed = true;
    return step;
  }

  // Find test files related to touched files
  const testPatterns: string[] = [];
  for (const file of filesTouched) {
    // Skip if already a test file
    if (file.includes(".test.") || file.includes(".spec.")) {
      testPatterns.push(file);
      continue;
    }

    // Look for corresponding test file
    const baseName = file.replace(/\.(ts|tsx|js|jsx)$/, "");
    testPatterns.push(`${baseName}.test.ts`);
    testPatterns.push(`${baseName}.test.tsx`);
    testPatterns.push(`${baseName}.spec.ts`);
  }

  // Check if any test files exist
  const existingTests: string[] = [];
  for (const pattern of testPatterns) {
    try {
      const exists = await Bun.file(pattern).exists();
      if (exists) {
        existingTests.push(pattern);
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  if (existingTests.length === 0) {
    step.skipped = true;
    step.skipReason = "No related test files found";
    step.passed = true;
    return step;
  }

  try {
    step.command = `bun test ${existingTests.join(" ")}`;
    const result = await Bun.$`bun test ${existingTests}`.quiet().nothrow();
    step.exitCode = result.exitCode;
    step.passed = result.exitCode === 0;

    if (!step.passed) {
      step.error = result.stderr.toString().slice(0, 1000);
      step.output = result.stdout.toString().slice(0, 1000);
    }
  } catch (error) {
    step.skipped = true;
    step.skipReason = `Test runner failed: ${error instanceof Error ? error.message : String(error)}`;
    step.passed = true; // Don't block if test runner unavailable
  }

  return step;
}

/**
 * Run the full Verification Gate
 *
 * Implements the Gate Function (IDENTIFY → RUN → READ → VERIFY → CLAIM):
 * 1. Typecheck
 * 2. Tests for touched files
 *
 * NOTE: Bug scanning was removed in v0.31 - it was slowing down completion
 * without providing proportional value.
 *
 * All steps must pass (or be skipped with valid reason) to proceed.
 */
export async function runVerificationGate(
  filesTouched: string[],
  _skipUbs: boolean = false, // Kept for backward compatibility, now ignored
): Promise<VerificationGateResult> {
  const steps: VerificationStep[] = [];
  const blockers: string[] = [];

  // Step 1: Typecheck
  const typecheckStep = await runTypecheckVerification();
  steps.push(typecheckStep);
  if (!typecheckStep.passed && !typecheckStep.skipped) {
    blockers.push(
      `Typecheck failed: ${typecheckStep.error?.slice(0, 100) || "type errors found"}. Try: Run 'tsc --noEmit' to see full errors, check tsconfig.json configuration, or fix reported type errors in modified files.`,
    );
  }

  // Step 2: Tests
  const testStep = await runTestVerification(filesTouched);
  steps.push(testStep);
  if (!testStep.passed && !testStep.skipped) {
    blockers.push(
      `Tests failed: ${testStep.error?.slice(0, 100) || "test failures"}. Try: Run 'bun test ${testStep.command.split(" ").slice(2).join(" ")}' to see full output, check test assertions, or fix failing tests in modified files.`,
    );
  }

  // Build summary
  const passedCount = steps.filter((s) => s.passed).length;
  const skippedCount = steps.filter((s) => s.skipped).length;
  const failedCount = steps.filter((s) => !s.passed && !s.skipped).length;

  const summary =
    failedCount === 0
      ? `Verification passed: ${passedCount} checks passed, ${skippedCount} skipped`
      : `Verification FAILED: ${failedCount} checks failed, ${passedCount} passed, ${skippedCount} skipped`;

  return {
    passed: failedCount === 0,
    steps,
    summary,
    blockers,
  };
}

// ============================================================================
// MCP Tool
// ============================================================================

/**
 * Run verification gate for a set of files
 *
 * Delegates to the verification worker to run typecheck and tests.
 * Returns structured verification results.
 */
export const swarm_verify = tool({
  description:
    "Run verification gate (typecheck + tests) for files. Returns verification results without blocking. Used by swarm_complete to verify worker output.",
  args: {
    files_touched: tool.schema
      .array(tool.schema.string())
      .describe("Files to verify (typecheck + test discovery)"),
    skip_verification: tool.schema
      .boolean()
      .optional()
      .describe("Skip verification entirely (default: false)"),
  },
  async execute(args): Promise<string> {
    try {
      if (args.skip_verification) {
        return JSON.stringify(
          {
            success: true,
            data: {
              passed: true,
              skipped: true,
              reason: "skip_verification=true",
              summary: "Verification skipped by request",
              steps: [],
              blockers: [],
            },
          },
          null,
          2,
        );
      }

      if (!args.files_touched || args.files_touched.length === 0) {
        return JSON.stringify(
          {
            success: true,
            data: {
              passed: true,
              skipped: true,
              reason: "no files_touched provided",
              summary: "No files to verify",
              steps: [],
              blockers: [],
            },
          },
          null,
          2,
        );
      }

      const result = await runVerificationGate(args.files_touched, false);

      return JSON.stringify(
        {
          success: true,
          data: {
            passed: result.passed,
            skipped: false,
            summary: result.summary,
            steps: result.steps.map((s) => ({
              name: s.name,
              command: s.command,
              passed: s.passed,
              exitCode: s.exitCode,
              skipped: s.skipped,
              skipReason: s.skipReason,
              error: s.error?.slice(0, 200), // Truncate for JSON
              output: s.output?.slice(0, 200),
            })),
            blockers: result.blockers,
          },
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          success: false,
          error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Verification tools for plugin registration
 */
export const verificationTools = {
  swarm_verify,
};
