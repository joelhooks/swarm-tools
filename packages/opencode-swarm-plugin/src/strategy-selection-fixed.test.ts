/**
 * Tests for FIXED strategy selection behavior
 * 
 * These tests verify that strategy flows end-to-end:
 * swarm_select_strategy → CellTree → hive_create_epic
 * 
 * Cell: opencode-swarm-monorepo-lf2p4u-mju6weg6h67
 */

import { describe, test, expect } from "bun:test";
import { swarm_select_strategy } from "./swarm-strategies";
import { CellTreeSchema } from "./schemas/cell";

const mockContext = {} as any;

describe("Strategy Selection - FIXED Behavior", () => {
  describe("CellTreeSchema includes strategy field", () => {
    test("CellTreeSchema has strategy field", () => {
      const schema = CellTreeSchema.shape;
      
      // ✅ FIXED: strategy field now exists
      expect(schema.strategy).toBeDefined();
    });

    test("CellTreeSchema parse succeeds WITH strategy", () => {
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
      
      if (result.success) {
        expect(result.data.strategy).toBe("risk-based");  // ✅ Preserved!
      }
    });

    test("CellTreeSchema allows all valid strategies", () => {
      const strategies = ["file-based", "feature-based", "risk-based", "research-based"] as const;
      
      for (const strategy of strategies) {
        const cellTree = {
          epic: { title: "Test", description: "" },
          subtasks: [{ title: "Task", files: [] }],
          strategy
        };
        
        const result = CellTreeSchema.safeParse(cellTree);
        expect(result.success).toBe(true);
        
        if (result.success) {
          expect(result.data.strategy).toBe(strategy);
        }
      }
    });

    test("CellTreeSchema rejects invalid strategy", () => {
      const cellTree = {
        epic: { title: "Test", description: "" },
        subtasks: [{ title: "Task", files: [] }],
        strategy: "invalid-strategy"
      };

      const result = CellTreeSchema.safeParse(cellTree);
      expect(result.success).toBe(false);
    });

    test("CellTreeSchema allows strategy to be omitted (optional)", () => {
      const cellTree = {
        epic: { title: "Test", description: "" },
        subtasks: [{ title: "Task", files: [] }]
        // No strategy - should be ok (will default to feature-based)
      };

      const result = CellTreeSchema.safeParse(cellTree);
      expect(result.success).toBe(true);
      
      if (result.success) {
        expect(result.data.strategy).toBeUndefined();  // Optional field
      }
    });
  });

  describe("End-to-end strategy flow simulation", () => {
    test("risk-based task → correct strategy in CellTree", async () => {
      const task = "Fix critical authentication vulnerability";
      
      // Step 1: Select strategy
      const strategyResult = await swarm_select_strategy.execute({ task }, mockContext);
      const parsed = JSON.parse(strategyResult);
      expect(parsed.strategy).toBe("risk-based");
      
      // Step 2: Coordinator creates CellTree with strategy
      const cellTree = {
        epic: {
          title: task,
          description: "Security issue in login flow"
        },
        subtasks: [
          { title: "Write regression test", files: ["test/auth.test.ts"] },
          { title: "Fix vulnerability", files: ["src/auth.ts"] }
        ],
        strategy: parsed.strategy  // ✅ Pass it through
      };
      
      // Step 3: Validate
      const validated = CellTreeSchema.safeParse(cellTree);
      expect(validated.success).toBe(true);
      
      if (validated.success) {
        expect(validated.data.strategy).toBe("risk-based");
        
        // Step 4: This would be passed to hive_create_epic
        // hive_create_epic({ ...validated.data.epic, subtasks, strategy: validated.data.strategy })
      }
    });

    test("file-based task → correct strategy in CellTree", async () => {
      const task = "Refactor all components to use new API";
      
      const strategyResult = await swarm_select_strategy.execute({ task }, mockContext);
      const parsed = JSON.parse(strategyResult);
      expect(parsed.strategy).toBe("file-based");
      
      const cellTree = {
        epic: { title: task, description: "" },
        subtasks: [{ title: "Update components", files: [] }],
        strategy: parsed.strategy
      };
      
      const validated = CellTreeSchema.safeParse(cellTree);
      expect(validated.success).toBe(true);
      
      if (validated.success) {
        expect(validated.data.strategy).toBe("file-based");
      }
    });

    test("feature-based task → correct strategy in CellTree", async () => {
      const task = "Add user authentication with OAuth";
      
      const strategyResult = await swarm_select_strategy.execute({ task }, mockContext);
      const parsed = JSON.parse(strategyResult);
      expect(parsed.strategy).toBe("feature-based");
      
      const cellTree = {
        epic: { title: task, description: "" },
        subtasks: [{ title: "OAuth setup", files: [] }],
        strategy: parsed.strategy
      };
      
      const validated = CellTreeSchema.safeParse(cellTree);
      expect(validated.success).toBe(true);
      
      if (validated.success) {
        expect(validated.data.strategy).toBe("feature-based");
      }
    });

    test("research-based task → correct strategy in CellTree", async () => {
      const task = "Research authentication patterns in the codebase";
      
      const strategyResult = await swarm_select_strategy.execute({ task }, mockContext);
      const parsed = JSON.parse(strategyResult);
      expect(parsed.strategy).toBe("research-based");
      
      const cellTree = {
        epic: { title: task, description: "" },
        subtasks: [
          { title: "Search PDFs", files: [] },
          { title: "Search repos", files: [] },
          { title: "Synthesize", files: [] }
        ],
        strategy: parsed.strategy
      };
      
      const validated = CellTreeSchema.safeParse(cellTree);
      expect(validated.success).toBe(true);
      
      if (validated.success) {
        expect(validated.data.strategy).toBe("research-based");
      }
    });
  });

  describe("Backward compatibility", () => {
    test("CellTree without strategy still works (backward compatible)", () => {
      // Old coordinators might not include strategy
      const cellTree = {
        epic: { title: "Some task", description: "" },
        subtasks: [{ title: "Do thing", files: [] }]
        // No strategy field
      };

      const result = CellTreeSchema.safeParse(cellTree);
      expect(result.success).toBe(true);
      
      // hive_create_epic will default to feature-based
    });
  });
});
