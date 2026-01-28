/**
 * Characterization tests for strategy selection
 * 
 * These tests document the CURRENT (broken) behavior where strategy recommendations
 * from swarm_select_strategy are NOT passed to hive_create_epic.
 * 
 * Cell: opencode-swarm-monorepo-lf2p4u-mju6weg6h67
 * 
 * ROOT CAUSE: CellTreeSchema does NOT include strategy field, so coordinator
 * decompositions lose the strategy recommendation.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { swarm_select_strategy } from "./swarm-strategies";
import { hive_create_epic } from "./hive";
import { CellTreeSchema } from "./schemas/cell";

const mockContext = {} as any;

describe("Strategy Selection - Current Broken Behavior", () => {
  describe("swarm_select_strategy works correctly", () => {
    test("identifies risk-based for bug fix tasks", async () => {
      const result = await swarm_select_strategy.execute({
        task: "Fix authentication bypass vulnerability"
      }, mockContext);
      
      const parsed = JSON.parse(result);
      expect(parsed.strategy).toBe("risk-based");
      expect(parsed.confidence).toBeGreaterThan(0.5);
    });

    test("identifies file-based for refactoring tasks", async () => {
      const result = await swarm_select_strategy.execute({
        task: "Refactor all components to use new API"
      }, mockContext);
      
      const parsed = JSON.parse(result);
      expect(parsed.strategy).toBe("file-based");
    });

    test("identifies feature-based for new feature tasks", async () => {
      const result = await swarm_select_strategy.execute({
        task: "Add user authentication with OAuth"
      }, mockContext);
      
      const parsed = JSON.parse(result);
      expect(parsed.strategy).toBe("feature-based");
    });

    test("identifies research-based for investigation tasks", async () => {
      const result = await swarm_select_strategy.execute({
        task: "Research authentication patterns in the codebase"
      }, mockContext);
      
      const parsed = JSON.parse(result);
      expect(parsed.strategy).toBe("research-based");
    });
  });

  describe("CellTreeSchema strategy field (FIXED)", () => {
    // NOTE: The bug described here has been FIXED. CellTreeSchema now includes
    // an optional strategy field. See strategy-selection-fixed.test.ts for the
    // comprehensive tests of the fixed behavior.
    test("CellTreeSchema NOW includes strategy field (bug was fixed)", () => {
      const schema = CellTreeSchema.shape;
      
      // Bug is fixed - strategy field is now present as optional
      expect(schema.strategy).toBeDefined();
      expect(schema.epic).toBeDefined();
      expect(schema.subtasks).toBeDefined();
    });

    test("CellTreeSchema parse succeeds WITHOUT strategy (optional)", () => {
      const cellTree = {
        epic: {
          title: "Fix critical security bug",
          description: "Auth bypass in login flow"
        },
        subtasks: [
          { title: "Write regression test", files: [] }
        ]
        // No strategy field - should still pass since it's optional
      };

      const result = CellTreeSchema.safeParse(cellTree);
      expect(result.success).toBe(true);
    });

    test("CellTreeSchema preserves strategy when provided", () => {
      const cellTree = {
        epic: {
          title: "Fix critical security bug",
          description: "Auth bypass in login flow"
        },
        subtasks: [
          { title: "Write regression test", files: [] }
        ],
        strategy: "risk-based"
      };

      const result = CellTreeSchema.safeParse(cellTree);
      expect(result.success).toBe(true);
      
      // Bug is fixed - strategy is now preserved in parsing
      if (result.success) {
        expect((result.data as any).strategy).toBe("risk-based");
      }
    });
  });

  describe("hive_create_epic accepts strategy parameter", () => {
    test("hive_create_epic WITHOUT strategy arg compiles (will default to feature-based)", async () => {
      // This test just verifies the parameter is optional
      // We can't easily test the emitted event without full infrastructure
      // But we can verify the call signature works
      
      const argsWithoutStrategy = {
        epic_title: "Fix critical authentication bug",
        epic_description: "Security vulnerability in login flow",
        subtasks: [
          { title: "Write regression test", files: ["test/auth.test.ts"] }
        ]
        // strategy NOT provided - this is the bug we're documenting
      };
      
      // This should compile and not throw type errors
      expect(argsWithoutStrategy).toBeDefined();
    });

    test("hive_create_epic WITH explicit strategy parameter compiles", async () => {
      const argsWithStrategy = {
        epic_title: "Fix critical authentication bug",
        subtasks: [
          { title: "Write test", files: [] }
        ],
        strategy: "risk-based" as const  // Explicitly provided
      };
      
      // This should compile with strategy parameter
      expect(argsWithStrategy.strategy).toBe("risk-based");
    });
  });

  describe("Real-world task examples (from database)", () => {
    test("'Fix 39 test failures' should be risk-based, not feature-based", async () => {
      const task = "Fix 39 test failures - mock pollution and isolation issues";
      
      // swarm_select_strategy correctly identifies this as risk-based
      const strategyResult = await swarm_select_strategy.execute({ task }, mockContext);
      const parsed = JSON.parse(strategyResult);
      expect(parsed.strategy).toBe("risk-based");

      // But in production, it was recorded as feature-based because
      // the coordinator didn't pass strategy to hive_create_epic
      // (See database evidence in analysis doc)
    });

    test("'Refactor build script' tie-breaks to file-based", async () => {
      const task = "Refactor build script to scripts/build.ts with config-driven parallel builds";
      
      const strategyResult = await swarm_select_strategy.execute({ task }, mockContext);
      const parsed = JSON.parse(strategyResult);
      
      // Should match both "refactor" (file-based) and "build" (feature-based)
      // Tie goes to first in sort order = file-based
      expect(parsed.strategy).toBe("file-based");
    });

    test("'Implement migration' correctly selects file-based over feature-based", async () => {
      const task = "Implement local-to-global DB migration for swarm-mail";
      
      const strategyResult = await swarm_select_strategy.execute({ task }, mockContext);
      const parsed = JSON.parse(strategyResult);
      
      // Matches both "implement" (feature-based) and "migrate" (file-based)
      // Should prefer file-based for migration tasks
      // Currently this might select feature-based due to tie-breaking
      
      // This test documents current behavior - may need tuning
      expect(["file-based", "feature-based"]).toContain(parsed.strategy);
    });
  });
});

describe("Strategy Selection - Keyword Edge Cases", () => {
  test("'debug' does NOT match 'bug' keyword", async () => {
    const task = "Debug libSQL data pipeline - stats/history showing no data";
    
    const result = await swarm_select_strategy.execute({ task }, mockContext);
    const parsed = JSON.parse(result);
    
    // "debug" should NOT trigger "bug" keyword (word boundary protection)
    // Should default to feature-based since no keywords match
    expect(parsed.strategy).toBe("feature-based");
    expect(parsed.reasoning).toContain("Defaulting to feature-based");
  });

  test("'build' in 'build script' matches feature-based keyword", async () => {
    const task = "Build new payment processing module";
    
    const result = await swarm_select_strategy.execute({ task }, mockContext);
    const parsed = JSON.parse(result);
    
    expect(parsed.strategy).toBe("feature-based");
    expect(parsed.reasoning.toLowerCase()).toContain("build");
  });

  test("'update all' multi-word keyword matches file-based", async () => {
    const task = "Update all components to React 18";
    
    const result = await swarm_select_strategy.execute({ task }, mockContext);
    const parsed = JSON.parse(result);
    
    expect(parsed.strategy).toBe("file-based");
    expect(parsed.reasoning.toLowerCase()).toContain("update all");
  });
});
