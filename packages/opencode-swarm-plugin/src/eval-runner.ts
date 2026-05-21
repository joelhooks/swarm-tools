/**
 * Programmatic Evalite Runner
 *
 * Provides a type-safe API for running evalite evals programmatically.
 * Wraps evalite's runEvalite function with structured result parsing.
 *
 * @module eval-runner
 */

import { tool } from "@opencode-ai/plugin";
import { runEvalite } from "evalite/runner";
import { createInMemoryStorage } from "evalite/in-memory-storage";
import type { Evalite } from "evalite/types";
import fs from "node:fs/promises";
import path from "node:path";
import { recordEvalRun, getScoreHistory } from "./eval-history.js";
import { checkGate } from "./eval-gates.js";
import { learnFromEvalFailure } from "./eval-learning.js";
import { getMemoryAdapter } from "./memory-tools.js";

/**
 * Options for running evals programmatically
 */
export interface RunEvalsOptions {
  /**
   * Working directory containing eval files (defaults to process.cwd())
   */
  cwd?: string;
  
  /**
   * Optional filter to run specific eval suites (e.g., "coordinator", "compaction")
   * Matches against eval file paths using substring matching
   */
  suiteFilter?: string;
  
  /**
   * Minimum average score threshold (0-100)
   * If average score falls below this, result.success will be false
   */
  scoreThreshold?: number;
  
  /**
   * Optional path to write raw evalite JSON output
   */
  outputPath?: string;
}

/**
 * Structured suite result with scores
 */
export interface SuiteResult {
  /** Suite name from evalite() call */
  name: string;
  
  /** Absolute path to eval file */
  filepath: string;
  
  /** Suite status: success, fail, or running */
  status: "success" | "fail" | "running";
  
  /** Total duration in milliseconds */
  duration: number;
  
  /** Average score across all evals in suite (0-1 scale) */
  averageScore: number;
  
  /** Number of evals in this suite */
  evalCount: number;
  
  /** Individual eval results (optional, can be large) */
  evals?: Array<{
    input: unknown;
    output: unknown;
    expected?: unknown;
    scores: Array<{
      name: string;
      score: number;
      description?: string;
    }>;
  }>;
}

/**
 * Structured result from running evals
 */
export interface RunEvalsResult {
  /** Whether the run succeeded (all evals passed threshold) */
  success: boolean;
  
  /** Total number of suites executed */
  totalSuites: number;
  
  /** Total number of individual evals executed */
  totalEvals: number;
  
  /** Average score across all suites (0-1 scale) */
  averageScore: number;
  
  /** Individual suite results */
  suites: SuiteResult[];
  
  /** Error message if run failed */
  error?: string;
  
  /** Gate check results per suite */
  gateResults?: Array<{
    suite: string;
    passed: boolean;
    phase: string;
    message: string;
    baseline?: number;
    currentScore: number;
    regressionPercent?: number;
  }>;
}

/**
 * Run evalite evals programmatically
 *
 * @param options - Configuration for eval run
 * @returns Structured results with scores per suite
 *
 * @example
 * ```typescript
 * // Run all evals
 * const result = await runEvals({ cwd: "/path/to/project" });
 * console.log(`Average score: ${result.averageScore}`);
 *
 * // Run specific suite
 * const coordResult = await runEvals({
 *   cwd: "/path/to/project",
 *   suiteFilter: "coordinator"
 * });
 *
 * // Enforce score threshold
 * const gatedResult = await runEvals({
 *   cwd: "/path/to/project",
 *   scoreThreshold: 80
 * });
 * if (!gatedResult.success) {
 *   throw new Error(`Evals failed threshold: ${gatedResult.averageScore}`);
 * }
 * ```
 */
export async function runEvals(
  options: RunEvalsOptions = {}
): Promise<RunEvalsResult> {
  const {
    cwd = process.cwd(),
    suiteFilter,
    scoreThreshold,
    outputPath: userOutputPath,
  } = options;

  try {
    // Resolve to project root. Historically this package looked for evals/
    // inside packages/opencode-swarm-plugin, but the repo moved eval files to
    // the sibling packages/swarm-evals/src package. CI still runs this gate
    // from packages/opencode-swarm-plugin, so discover both locations.
    const projectRoot = cwd.endsWith("src") ? path.dirname(cwd) : cwd;
    const localEvalsDir = path.join(projectRoot, "evals");
    const workspaceRoot = path.resolve(projectRoot, "../..");
    const workspaceEvalsDir = path.join(workspaceRoot, "packages/swarm-evals/src");
    let evaliteCwd = projectRoot;
    const evalsDir = await fs
      .access(localEvalsDir)
      .then(() => localEvalsDir)
      .catch(async () => {
        await fs.access(workspaceEvalsDir);
        // Evalite/Vitest only discovers files under its root. When using the
        // workspace eval package, run from the monorepo root so the path filter
        // is inside root instead of silently producing `Eval Files 0`.
        evaliteCwd = workspaceRoot;
        return workspaceEvalsDir;
      });
    let evalPath: string | undefined;

    if (suiteFilter) {
      // Find matching eval files
      try {
        const files = await fs.readdir(evalsDir);
        const matchingFiles = files.filter((f) =>
          f.toLowerCase().includes(suiteFilter.toLowerCase())
        );

        if (matchingFiles.length === 0) {
          // No matches - return empty result (not an error)
          return {
            success: true,
            totalSuites: 0,
            totalEvals: 0,
            averageScore: 0,
            suites: [],
          };
        }

        // Use first matching file (evalite will discover all via vitest)
        evalPath = path.join(evalsDir, matchingFiles[0]);
      } catch (err) {
        // Directory doesn't exist or can't be read
        return {
          success: false,
          totalSuites: 0,
          totalEvals: 0,
          averageScore: 0,
          suites: [],
          error: `Failed to read evals directory: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } else {
      // No filter - run all evals in evals/
      evalPath = evalsDir;
    }

    // Use temporary output path if user didn't provide one
    const outputPath =
      userOutputPath || path.join(projectRoot, `.evalite-results-${Date.now()}.json`);
    const isTemporaryOutput = !userOutputPath;

    // Run evalite programmatically
    const storage = createInMemoryStorage();
    
    await runEvalite({
      path: evalPath, // undefined = run all
      cwd: evaliteCwd, // Use root that contains the selected eval path
      mode: "run-once-and-exit",
      scoreThreshold,
      outputPath,
      hideTable: true, // Suppress terminal output
      storage,
      disableServer: true, // No UI server needed
    });

    // Parse output file for structured results
    let outputJson: string;
    try {
      outputJson = await fs.readFile(outputPath, "utf-8");
    } catch (err) {
      // Output file wasn't written - evalite crashed or no tests ran
      return {
        success: false,
        totalSuites: 0,
        totalEvals: 0,
        averageScore: 0,
        suites: [],
        error: `No results file generated: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const output: Evalite.Exported.Output = JSON.parse(outputJson);

    // Clean up temporary output file
    if (isTemporaryOutput) {
      await fs.unlink(outputPath).catch(() => {
        /* ignore cleanup errors */
      });
    }

    // Evalite changed its export shape between versions:
    // - <=0.19: { evals: [{ results: [...] }] }
    // - 1.0 beta: { suites: [{ evals: [...] }] }
    // CI currently uses the 1.0 beta shape, so support both instead of
    // silently reporting `Suites: 0 / Evals: 0` after a successful run.
    const exportedSuites = Array.isArray((output as any).suites)
      ? (output as any).suites
      : Array.isArray((output as any).evals)
        ? (output as any).evals
        : [];

    const suites: SuiteResult[] = exportedSuites.map((suiteItem: any) => {
      const evalResults = Array.isArray(suiteItem.evals)
        ? suiteItem.evals
        : Array.isArray(suiteItem.results)
          ? suiteItem.results
          : [];

      return {
        name: suiteItem.name,
        filepath: suiteItem.filepath,
        status: suiteItem.status,
        duration: suiteItem.duration,
        averageScore: suiteItem.averageScore,
        evalCount: evalResults.length,
        // Include evals if user wants detailed results
        evals: evalResults.map((r: any) => ({
          input: r.input,
          output: r.output,
          expected: r.expected,
          scores: (r.scores ?? []).map((s: Evalite.Exported.Score) => ({
            name: s.name,
            score: s.score,
            description: s.description,
          })),
        })),
      };
    });

    // Record eval runs to history
    for (const suite of suites) {
      const history = getScoreHistory(projectRoot, suite.name);
      recordEvalRun(projectRoot, {
        timestamp: new Date().toISOString(),
        eval_name: suite.name,
        score: suite.averageScore,
        run_count: history.length + 1,
      });
    }

    // Check gates for each suite
    const gateResults = [];
    for (const suite of suites) {
      const history = getScoreHistory(projectRoot, suite.name);
      const gate = checkGate(projectRoot, suite.name, suite.averageScore);
      gateResults.push({ suite: suite.name, ...gate });
      
      // If gate failed, trigger learning
      if (!gate.passed) {
        try {
          const memoryAdapter = await getMemoryAdapter();
          await learnFromEvalFailure(suite.name, suite.averageScore, history, memoryAdapter);
        } catch (e) {
          // Learning is best-effort, don't fail the eval run
          console.warn(`Failed to store learning for ${suite.name}:`, e);
        }
      }
    }

    // Calculate overall metrics
    const totalEvals = suites.reduce((sum, s) => sum + s.evalCount, 0);
    const averageScore =
      suites.length > 0
        ? suites.reduce((sum, s) => sum + s.averageScore, 0) / suites.length
        : 0;

    // Determine success based on threshold
    const thresholdPassed =
      scoreThreshold === undefined || averageScore * 100 >= scoreThreshold;

    return {
      success: thresholdPassed,
      totalSuites: suites.length,
      totalEvals,
      averageScore,
      suites,
      gateResults,
    };
  } catch (error) {
    // Return error result
    return {
      success: false,
      totalSuites: 0,
      totalEvals: 0,
      averageScore: 0,
      suites: [],
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

// ============================================================================
// Plugin Tool
// ============================================================================

/**
 * Plugin tool for running evals programmatically
 */
const eval_run = tool({
  description: `Run evalite evals programmatically and get structured results with scores.

Use this to:
- Run all evals in evals/ directory
- Filter by specific eval suite (e.g., "coordinator", "compaction")
- Enforce score thresholds for quality gates
- Get per-suite and per-eval scores

Returns structured JSON with:
- success: boolean (true if all tests passed threshold)
- totalSuites: number of eval suites run
- totalEvals: number of individual test cases
- averageScore: 0-1 score across all suites
- suites: array of suite results with scores

Example usage:
- Run all evals: eval_run()
- Run coordinator evals: eval_run({ suiteFilter: "coordinator" })
- Enforce 80% threshold: eval_run({ scoreThreshold: 80 })`,

  args: {
    suiteFilter: tool.schema
      .string()
      .optional()
      .describe(
        'Optional filter to run specific eval suite (e.g., "coordinator", "compaction"). Matches against eval file paths using substring matching.'
      ),
    scoreThreshold: tool.schema
      .number()
      .optional()
      .describe(
        "Optional minimum average score threshold (0-100). If average score falls below this, result.success will be false. Useful for CI quality gates."
      ),
    includeDetailedResults: tool.schema
      .boolean()
      .optional()
      .describe(
        "Include individual eval results with input/output/scores in response. Set to false (default) for summary only to save token usage."
      ),
  },

  execute: async (args) => {
    const result = await runEvals({
      cwd: process.cwd(),
      suiteFilter: args.suiteFilter as string | undefined,
      scoreThreshold: args.scoreThreshold as number | undefined,
    });

    // Remove detailed evals if not requested (saves tokens)
    const includeDetails = args.includeDetailedResults === true;
    if (!includeDetails) {
      for (const suite of result.suites) {
        delete suite.evals;
      }
    }

    return JSON.stringify(result, null, 2);
  },
});

/**
 * All eval tools exported for registration
 */
export const evalTools = {
  eval_run,
} as const;
