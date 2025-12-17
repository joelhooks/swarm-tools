import { describe, it, expect } from "bun:test";
import { analyzeTodoWrite, shouldAnalyzeTool } from "./planning-guardrails";

describe("planning-guardrails", () => {
  describe("shouldAnalyzeTool", () => {
    it("returns true for todowrite", () => {
      expect(shouldAnalyzeTool("todowrite")).toBe(true);
      expect(shouldAnalyzeTool("TodoWrite")).toBe(true);
    });

    it("returns false for other tools", () => {
      expect(shouldAnalyzeTool("hive_create")).toBe(false);
      expect(shouldAnalyzeTool("swarm_decompose")).toBe(false);
      expect(shouldAnalyzeTool("read")).toBe(false);
    });
  });

  describe("analyzeTodoWrite", () => {
    it("returns no warning for small todo lists", () => {
      const result = analyzeTodoWrite({
        todos: [
          { content: "Implement feature A", status: "pending" },
          { content: "Add tests", status: "pending" },
        ],
      });

      expect(result.looksLikeParallelWork).toBe(false);
      expect(result.warning).toBeUndefined();
      expect(result.totalCount).toBe(2);
    });

    it("warns for 6+ file modification todos", () => {
      const result = analyzeTodoWrite({
        todos: [
          { content: "Implement src/auth/login.ts", status: "pending" },
          { content: "Create src/auth/logout.ts", status: "pending" },
          { content: "Add src/auth/types.ts", status: "pending" },
          { content: "Update src/auth/index.ts", status: "pending" },
          { content: "Refactor src/lib/session.ts", status: "pending" },
          { content: "Modify src/middleware/auth.ts", status: "pending" },
        ],
      });

      expect(result.looksLikeParallelWork).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("multi-file implementation plan");
      expect(result.warning).toContain("swarm");
      expect(result.fileModificationCount).toBeGreaterThanOrEqual(4);
    });

    it("does not warn for tracking/coordination todos", () => {
      const result = analyzeTodoWrite({
        todos: [
          { content: "Review PR #123", status: "pending" },
          { content: "Check tests pass", status: "pending" },
          { content: "Verify deployment", status: "pending" },
          { content: "Run integration tests", status: "pending" },
          { content: "Merge to main", status: "pending" },
          { content: "Push to production", status: "pending" },
        ],
      });

      expect(result.looksLikeParallelWork).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    it("does not warn for mixed todos with few file modifications", () => {
      const result = analyzeTodoWrite({
        todos: [
          { content: "Implement src/feature.ts", status: "pending" },
          { content: "Review changes", status: "pending" },
          { content: "Run tests", status: "pending" },
          { content: "Check linting", status: "pending" },
          { content: "Deploy to staging", status: "pending" },
          { content: "Verify in browser", status: "pending" },
        ],
      });

      // Only 1 file modification out of 6 - should not trigger
      expect(result.looksLikeParallelWork).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    it("handles empty or missing todos", () => {
      expect(analyzeTodoWrite({}).looksLikeParallelWork).toBe(false);
      expect(analyzeTodoWrite({ todos: [] }).looksLikeParallelWork).toBe(false);
      expect(analyzeTodoWrite({ todos: undefined as any }).looksLikeParallelWork).toBe(false);
    });

    it("handles malformed todo items", () => {
      const result = analyzeTodoWrite({
        todos: [
          null,
          undefined,
          "string instead of object",
          { noContent: true },
          { content: "Implement src/valid.ts", status: "pending" },
          { content: "Create src/another.ts", status: "pending" },
        ] as any,
      });

      // Should handle gracefully without crashing
      expect(result.totalCount).toBe(6);
    });
  });
});
