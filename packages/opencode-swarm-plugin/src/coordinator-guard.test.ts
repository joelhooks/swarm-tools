/**
 * Coordinator Guard Tests
 * 
 * Tests for runtime enforcement of coordinator protocol violations.
 * Coordinators must NOT edit files, run tests, or reserve files.
 * These actions must be delegated to workers via swarm_spawn_subtask.
 */

import { describe, test, expect } from "bun:test";
import {
  checkCoordinatorGuard,
  CoordinatorGuardError,
  isCoordinator,
} from "./coordinator-guard.js";

describe("isCoordinator", () => {
  test("returns true when agent context is 'coordinator'", () => {
    expect(isCoordinator("coordinator")).toBe(true);
  });

  test("returns false when agent context is 'worker'", () => {
    expect(isCoordinator("worker")).toBe(false);
  });

  test("returns false for unknown context", () => {
    expect(isCoordinator("unknown" as any)).toBe(false);
  });
});

describe("checkCoordinatorGuard", () => {
  test("allows workers to edit files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "worker",
      toolName: "edit",
      toolArgs: { filePath: "src/test.ts" },
    });

    expect(result.blocked).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test("blocks coordinators from editing files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "edit",
      toolArgs: { filePath: "src/test.ts" },
    });

    expect(result.blocked).toBe(true);
    expect(result.error).toBeInstanceOf(CoordinatorGuardError);
    expect(result.error?.message).toContain("must spawn a worker");
    expect(result.error?.violationType).toBe("coordinator_edited_file");
  });

  test("blocks coordinators from writing files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "write",
      toolArgs: { filePath: "src/new.ts", content: "code" },
    });

    expect(result.blocked).toBe(true);
    expect(result.error).toBeInstanceOf(CoordinatorGuardError);
    expect(result.error?.violationType).toBe("coordinator_edited_file");
  });

  test("blocks coordinators from running tests via bash", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "bash",
      toolArgs: { command: "bun test src/" },
    });

    expect(result.blocked).toBe(true);
    expect(result.error).toBeInstanceOf(CoordinatorGuardError);
    expect(result.error?.violationType).toBe("coordinator_ran_tests");
    expect(result.error?.message).toContain("Workers run tests");
  });

  test("allows coordinators to run non-test bash commands", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "bash",
      toolArgs: { command: "git status" },
    });

    expect(result.blocked).toBe(false);
  });

  test("blocks coordinators from reserving files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "swarmmail_reserve",
      toolArgs: { paths: ["src/auth/**"] },
    });

    expect(result.blocked).toBe(true);
    expect(result.error).toBeInstanceOf(CoordinatorGuardError);
    expect(result.error?.violationType).toBe("coordinator_reserved_files");
  });

  test("allows workers to reserve files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "worker",
      toolName: "swarmmail_reserve",
      toolArgs: { paths: ["src/auth/**"] },
    });

    expect(result.blocked).toBe(false);
  });

  test("allows coordinators to use swarm_spawn_subtask", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "swarm_spawn_subtask",
      toolArgs: { bead_id: "bd-123.1", epic_id: "bd-123" },
    });

    expect(result.blocked).toBe(false);
  });

  test("allows coordinators to use hive_create_epic", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "hive_create_epic",
      toolArgs: { epic_title: "Add auth", subtasks: [] },
    });

    expect(result.blocked).toBe(false);
  });

  test("error contains helpful suggestion", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "edit",
      toolArgs: { filePath: "src/auth.ts" },
    });

    expect(result.error?.message).toContain("swarm_spawn_subtask");
    expect(result.error?.suggestion).toBeDefined();
  });

  test("test execution patterns match various test runners", () => {
    const testCommands = [
      "bun test",
      "npm test",
      "npm run test",
      "yarn test",
      "pnpm test",
      "jest",
      "vitest run",
      "mocha spec/",
      "ava tests/",
    ];

    for (const command of testCommands) {
      const result = checkCoordinatorGuard({
        agentContext: "coordinator",
        toolName: "bash",
        toolArgs: { command },
      });

      expect(result.blocked).toBe(true);
      expect(result.error?.violationType).toBe("coordinator_ran_tests");
    }
  });
});

describe("CoordinatorGuardError", () => {
  test("includes violation type and payload", () => {
    const error = new CoordinatorGuardError(
      "Test message",
      "coordinator_edited_file",
      { file: "test.ts" },
      "Use swarm_spawn_subtask instead"
    );

    expect(error.violationType).toBe("coordinator_edited_file");
    expect(error.payload).toEqual({ file: "test.ts" });
    expect(error.suggestion).toBe("Use swarm_spawn_subtask instead");
    expect(error.name).toBe("CoordinatorGuardError");
  });
});
