import { createScorer } from "evalite";
import type { CellTree } from "../../src/schemas/index.js";

/**
 * Custom scorers for evaluating swarm task decomposition quality
 */

/**
 * Checks that no files appear in multiple subtasks
 *
 * Independent subtasks are critical for parallel execution.
 * File conflicts cause merge conflicts and coordination overhead.
 *
 * Score: 1.0 if no conflicts, 0.0 if conflicts found
 */
export const subtaskIndependence = createScorer({
  name: "Subtask Independence",
  description: "Checks that no files appear in multiple subtasks",
  scorer: ({ output }) => {
    try {
      const beadTree = JSON.parse(String(output)) as CellTree;
      const fileMap = new Map<string, number>();

      // Track which files appear in which subtasks
      beadTree.subtasks.forEach((subtask) => {
        subtask.files?.forEach((file) => {
          const count = fileMap.get(file) || 0;
          fileMap.set(file, count + 1);
        });
      });

      // Check for conflicts
      const conflicts = Array.from(fileMap.entries()).filter(
        ([_, count]) => count > 1,
      );

      if (conflicts.length > 0) {
        return {
          score: 0,
          message: `File conflicts found: ${conflicts.map(([f]) => f).join(", ")}`,
        };
      }

      return {
        score: 1,
        message: "No file conflicts - subtasks are independent",
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CellTree: ${error}`,
      };
    }
  },
});

// ============================================================================
// Outcome-based scorers
// ============================================================================

export {
  executionSuccess,
  timeBalance,
  scopeAccuracy,
  scopeDrift,
  noRework,
} from "./outcome-scorers.js";

/**
 * Checks that subtasks cover the full task scope
 *
 * Incomplete coverage means:
 * - Missing functionality
 * - Follow-up work required
 * - Task not actually complete
 *
 * Score: ratio of expected files covered (0.0 to 1.0)
 * If no expected files specified, checks that subtasks exist
 */
export const coverageCompleteness = createScorer({
  name: "Coverage Completeness",
  description: "Checks that subtasks cover the full task scope",
  scorer: ({ output, expected }) => {
    try {
      const beadTree = JSON.parse(String(output)) as CellTree;

      // If expected files specified, check coverage
      const expectedData = expected as Record<string, unknown> | undefined;
      if (expectedData && Array.isArray(expectedData.requiredFiles)) {
        const allFiles = new Set(
          beadTree.subtasks.flatMap((st) => st.files || []),
        );

        const requiredFiles = expectedData.requiredFiles as string[];
        const coveredFiles = requiredFiles.filter((f) => allFiles.has(f));
        const coverage = coveredFiles.length / requiredFiles.length;

        return {
          score: coverage,
          message: `${coveredFiles.length}/${requiredFiles.length} required files covered`,
        };
      }

      // Otherwise, check min/max subtask count
      const minSubtasks = (expectedData?.minSubtasks as number) || 1;
      const maxSubtasks = (expectedData?.maxSubtasks as number) || 10;
      const count = beadTree.subtasks.length;

      if (count < minSubtasks) {
        return {
          score: 0,
          message: `Too few subtasks: ${count} < ${minSubtasks}`,
        };
      }

      if (count > maxSubtasks) {
        return {
          score: 0.5,
          message: `Too many subtasks: ${count} > ${maxSubtasks} (over-decomposed)`,
        };
      }

      return {
        score: 1,
        message: `Good subtask count: ${count} (${minSubtasks}-${maxSubtasks})`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CellTree: ${error}`,
      };
    }
  },
});

/**
 * Checks that each subtask has clear, actionable instructions
 *
 * Vague instructions lead to:
 * - Agent confusion and blocking
 * - Incorrect implementations
 * - Need for coordinator intervention
 *
 * Score: Average of per-subtask instruction quality
 */
export const instructionClarity = createScorer({
  name: "Instruction Clarity",
  description: "Checks that subtasks have clear, actionable instructions",
  scorer: ({ output }) => {
    try {
      const beadTree = JSON.parse(String(output)) as CellTree;

      if (beadTree.subtasks.length === 0) {
        return {
          score: 0,
          message: "No subtasks found",
        };
      }

      // Check each subtask for clarity signals
      const scores = beadTree.subtasks.map((subtask) => {
        let score = 0.5; // baseline

        // Has description?
        if (subtask.description && subtask.description.length > 20) {
          score += 0.2;
        }

        // Has files specified?
        if (subtask.files && subtask.files.length > 0) {
          score += 0.2;
        }

        // Title is specific (not generic)?
        const genericWords = ["update", "fix", "add", "change", "modify"];
        const titleLower = subtask.title.toLowerCase();
        const isGeneric = genericWords.some(
          (word) => titleLower === word || titleLower.startsWith(`${word} `),
        );
        if (!isGeneric) {
          score += 0.1;
        }

        return Math.min(1.0, score);
      });

      const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

      return {
        score: avgScore,
        message: `Average instruction clarity: ${(avgScore * 100).toFixed(0)}%`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CellTree: ${error}`,
      };
    }
  },
});
