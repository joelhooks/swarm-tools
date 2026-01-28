/**
 * Swarm Decompose Unit Tests
 *
 * Tests for task decomposition, validation, and eval capture integration.
 *
 * TDD: Testing eval capture integration - verifies captureDecomposition() is called
 * after successful validation with correct parameters.
 */
import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { swarm_validate_decomposition } from "./swarm-decompose";
import * as evalCapture from "./eval-capture.js";

// ============================================================================
// Test Setup
// ============================================================================

const mockContext = {
  sessionID: `test-decompose-${Date.now()}`,
  messageID: `test-message-${Date.now()}`,
  agent: "test-agent",
  abort: new AbortController().signal,
};

let testProjectPath: string;

beforeEach(() => {
  testProjectPath = `/tmp/test-swarm-decompose-${Date.now()}`;
  fs.mkdirSync(testProjectPath, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(testProjectPath)) {
    fs.rmSync(testProjectPath, { recursive: true, force: true });
  }
});

// ============================================================================
// Eval Capture Integration Tests
// ============================================================================

describe("captureDecomposition integration", () => {
  test("calls captureDecomposition after successful validation with all params", async () => {
    // Spy on captureDecomposition
    const captureDecompositionSpy = spyOn(evalCapture, "captureDecomposition");

    const validCellTree = JSON.stringify({
      epic: {
        title: "Add OAuth",
        description: "Implement OAuth authentication",
      },
      subtasks: [
        {
          title: "Add OAuth provider config",
          description: "Set up Google OAuth",
          files: ["src/auth/google.ts", "src/auth/config.ts"],
          dependencies: [],
          estimated_complexity: 2,
        },
        {
          title: "Add login UI",
          description: "Create login button component",
          files: ["src/components/LoginButton.tsx"],
          dependencies: [0],
          estimated_complexity: 1,
        },
      ],
    });

    const result = await swarm_validate_decomposition.execute(
      {
        response: validCellTree,
        project_path: testProjectPath,
        task: "Add user authentication",
        context: "Using NextAuth.js",
        strategy: "feature-based" as const,
        epic_id: "test-epic-123",
      },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(true);

    // Verify captureDecomposition was called with correct params
    expect(captureDecompositionSpy).toHaveBeenCalledTimes(1);
    expect(captureDecompositionSpy).toHaveBeenCalledWith({
      epicId: "test-epic-123",
      projectPath: testProjectPath,
      task: "Add user authentication",
      context: "Using NextAuth.js",
      strategy: "feature-based",
      epicTitle: "Add OAuth",
      epicDescription: "Implement OAuth authentication",
      subtasks: [
        {
          title: "Add OAuth provider config",
          description: "Set up Google OAuth",
          files: ["src/auth/google.ts", "src/auth/config.ts"],
          dependencies: [],
          estimated_complexity: 2,
        },
        {
          title: "Add login UI",
          description: "Create login button component",
          files: ["src/components/LoginButton.tsx"],
          dependencies: [0],
          estimated_complexity: 1,
        },
      ],
    });

    captureDecompositionSpy.mockRestore();
  });

  test("does not call captureDecomposition when validation fails", async () => {
    const captureDecompositionSpy = spyOn(evalCapture, "captureDecomposition");

    // Invalid CellTree - missing required fields
    const invalidCellTree = JSON.stringify({
      epic: { title: "Missing subtasks" },
      // No subtasks array
    });

    const result = await swarm_validate_decomposition.execute(
      {
        response: invalidCellTree,
        project_path: testProjectPath,
        task: "Add auth",
        strategy: "auto" as const,
        epic_id: "test-epic-456",
      },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(false);

    // Verify captureDecomposition was NOT called
    expect(captureDecompositionSpy).not.toHaveBeenCalled();

    captureDecompositionSpy.mockRestore();
  });

  test("handles optional context and description fields", async () => {
    const captureDecompositionSpy = spyOn(evalCapture, "captureDecomposition");

    const validCellTree = JSON.stringify({
      epic: {
        title: "Fix bug",
        // No description
      },
      subtasks: [
        {
          title: "Add test",
          files: ["src/test.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    });

    const result = await swarm_validate_decomposition.execute(
      {
        response: validCellTree,
        project_path: testProjectPath,
        task: "Fix the auth bug",
        // No context
        strategy: "risk-based" as const,
        epic_id: "test-epic-789",
      },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(true);

    // Verify captureDecomposition was called without optional fields
    expect(captureDecompositionSpy).toHaveBeenCalledTimes(1);
    const call = captureDecompositionSpy.mock.calls[0];
    expect(call[0].epicId).toBe("test-epic-789");
    expect(call[0].context).toBeUndefined();
    // Schema default makes description empty string instead of undefined
    expect(call[0].epicDescription).toBe("");

    captureDecompositionSpy.mockRestore();
  });
});

// ============================================================================
// Response Parsing Tests
// ============================================================================

describe("swarm_validate_decomposition response parsing", () => {
  test("accepts response as JSON string", async () => {
    const validCellTree = JSON.stringify({
      epic: { title: "Test Epic", description: "Test" },
      subtasks: [
        {
          title: "Subtask 1",
          files: ["src/test.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    });

    const result = await swarm_validate_decomposition.execute(
      { response: validCellTree },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(true);
  });

  test("accepts response as object (MCP double-parse scenario)", async () => {
    // When MCP server receives an object and passes it through,
    // the tool may receive an already-parsed object instead of a string
    const validCellTree = {
      epic: { title: "Test Epic", description: "Test" },
      subtasks: [
        {
          title: "Subtask 1",
          files: ["src/test.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    };

    const result = await swarm_validate_decomposition.execute(
      // Cast to any to simulate the MCP scenario where response might be object
      { response: validCellTree as any },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(true);
  });

  test("handles nested JSON string (triple-encoded edge case)", async () => {
    const cellTree = {
      epic: { title: "Test Epic", description: "Test" },
      subtasks: [
        {
          title: "Subtask 1",
          files: ["src/test.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    };
    // Double-stringified
    const doubleStringified = JSON.stringify(JSON.stringify(cellTree));

    const result = await swarm_validate_decomposition.execute(
      { response: doubleStringified },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.valid).toBe(true);
  });
});
