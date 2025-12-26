/**
 * Tests for decomposition scorers
 *
 * Uses Vitest (evalite's test runner), not Bun's test runner.
 *
 * Note: evalite's Score type only exposes `score`, not `message`.
 * We test scores only - message testing requires accessing internal scorer.
 */
import { describe, expect, test } from "vitest";
import {
  coverageCompleteness,
  decompositionCoherence,
  instructionClarity,
  subtaskIndependence,
} from "./index.js";

describe("Heuristic Scorers", () => {
  const goodDecomposition = JSON.stringify({
    epic: { title: "Add auth", description: "Add authentication" },
    subtasks: [
      {
        title: "Add login form component",
        description: "Create React component for login with email/password",
        files: ["src/components/LoginForm.tsx"],
      },
      {
        title: "Add auth API routes",
        description: "Create API endpoints for login/logout/session",
        files: ["src/api/auth.ts"],
      },
      {
        title: "Add auth middleware",
        description: "Create middleware to protect routes",
        files: ["src/middleware/auth.ts"],
      },
    ],
  });

  const conflictingDecomposition = JSON.stringify({
    epic: { title: "Add auth", description: "Add authentication" },
    subtasks: [
      {
        title: "Add login",
        files: ["src/auth.ts"],
      },
      {
        title: "Add logout",
        files: ["src/auth.ts"], // Same file - conflict!
      },
    ],
  });

  test("subtaskIndependence scores 1.0 for no conflicts", async () => {
    const result = await subtaskIndependence({
      output: goodDecomposition,
      expected: undefined,
      input: {},
    });
    expect(result.score).toBe(1);
  });

  test("subtaskIndependence scores 0 for file conflicts", async () => {
    const result = await subtaskIndependence({
      output: conflictingDecomposition,
      expected: undefined,
      input: {},
    });
    expect(result.score).toBe(0);
  });

  test("instructionClarity scores higher for detailed subtasks", async () => {
    const result = await instructionClarity({
      output: goodDecomposition,
      expected: undefined,
      input: {},
    });
    expect(result.score).toBeGreaterThan(0.7);
  });

  test("coverageCompleteness checks subtask count", async () => {
    const result = await coverageCompleteness({
      output: goodDecomposition,
      expected: { minSubtasks: 2, maxSubtasks: 5 },
      input: {},
    });
    expect(result.score).toBe(1);
  });
});

describe("LLM-as-Judge Scorer", () => {
  // Skip LLM test in CI - requires API key
  const hasApiKey = !!process.env.AI_GATEWAY_API_KEY;

  test(
    "decompositionCoherence returns valid score",
    async () => {
      if (!hasApiKey) {
        console.log("Skipping LLM test - no AI_GATEWAY_API_KEY");
        return;
      }

      const decomposition = JSON.stringify({
        epic: { title: "Add auth", description: "Add authentication" },
        subtasks: [
          {
            title: "Add login form",
            description: "Create login UI",
            files: ["src/LoginForm.tsx"],
          },
          {
            title: "Add auth API",
            description: "Create auth endpoints",
            files: ["src/api/auth.ts"],
          },
        ],
      });

      const result = await decompositionCoherence({
        output: decomposition,
        expected: undefined,
        input: { task: "Add user authentication with login/logout" },
      });

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    },
    30000,
  );

  test("decompositionCoherence scores invalid decomposition low", async () => {
    if (!process.env.AI_GATEWAY_API_KEY) {
      console.log("Skipping LLM test - no AI_GATEWAY_API_KEY");
      return;
    }

    const result = await decompositionCoherence({
      output: "not valid json at all {{{",
      expected: undefined,
      input: {},
    });

    // LLM should recognize garbage input and score it very low
    // (0 or close to 0, not 0.5 fallback)
    expect(result.score).toBeLessThanOrEqual(0.2);
  }, 30000);
});
