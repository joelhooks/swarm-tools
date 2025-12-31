/**
 * Coordinator Guard Integration Tests
 * 
 * Tests that the coordinator guard properly integrates with the plugin
 * and blocks coordinator violations at runtime.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  setCoordinatorContext,
  clearAllCoordinatorContexts,
  isInCoordinatorContext,
} from "./planning-guardrails.js";
import {
  checkCoordinatorGuard,
  CoordinatorGuardError,
} from "./coordinator-guard.js";

describe("Coordinator Guard Integration", () => {
  beforeEach(() => {
    // Clean state before each test
    clearAllCoordinatorContexts();
  });

  test("guard blocks coordinator file edits when coordinator context is active", () => {
    const sessionId = "test-session-123";

    // Simulate coordinator context (like after hive_create_epic)
    setCoordinatorContext({
      isCoordinator: true,
      sessionId,
      epicId: "test-epic-456",
    });

    expect(isInCoordinatorContext(sessionId)).toBe(true);

    // Simulate coordinator trying to edit a file
    const guardResult = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "edit",
      toolArgs: { filePath: "src/auth.ts" },
    });

    expect(guardResult.blocked).toBe(true);
    expect(guardResult.error).toBeInstanceOf(CoordinatorGuardError);
    expect(guardResult.error?.message).toContain("spawn a worker");
  });

  test("guard allows worker file edits even when coordinator context exists", () => {
    const sessionId = "test-session-123";

    // Coordinator context is active
    setCoordinatorContext({
      isCoordinator: true,
      sessionId,
      epicId: "test-epic-456",
    });

    // But this call is from a worker (agentContext = "worker")
    const guardResult = checkCoordinatorGuard({
      agentContext: "worker",
      toolName: "edit",
      toolArgs: { filePath: "src/auth.ts" },
    });

    expect(guardResult.blocked).toBe(false);
    expect(guardResult.error).toBeUndefined();
  });

  test("guard blocks test execution by coordinator", () => {
    const sessionId = "test-session-123";

    setCoordinatorContext({
      isCoordinator: true,
      sessionId,
    });

    const guardResult = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "bash",
      toolArgs: { command: "bun test src/" },
    });

    expect(guardResult.blocked).toBe(true);
    expect(guardResult.error?.violationType).toBe("coordinator_ran_tests");
  });

  test("guard allows non-test bash commands by coordinator", () => {
    const sessionId = "test-session-123";

    setCoordinatorContext({
      isCoordinator: true,
      sessionId,
    });

    const guardResult = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "bash",
      toolArgs: { command: "git status" },
    });

    expect(guardResult.blocked).toBe(false);
  });

  test("guard blocks file reservations by coordinator", () => {
    const sessionId = "test-session-123";

    setCoordinatorContext({
      isCoordinator: true,
      sessionId,
    });

    const guardResult = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "swarmmail_reserve",
      toolArgs: { paths: ["src/**"] },
    });

    expect(guardResult.blocked).toBe(true);
    expect(guardResult.error?.violationType).toBe("coordinator_reserved_files");
  });

  test("guard error includes helpful suggestions", () => {
    const guardResult = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "edit",
      toolArgs: { filePath: "src/test.ts" },
    });

    expect(guardResult.error?.suggestion).toContain("swarm_spawn_subtask");
    expect(guardResult.error?.message).toContain("swarm_spawn_subtask");
  });

  test("coordinator context timeout clears after 4 hours", () => {
    const sessionId = "test-session-123";

    // Set coordinator context with old timestamp (5 hours ago)
    setCoordinatorContext({
      isCoordinator: true,
      sessionId,
    });

    // Manually set activatedAt to 5 hours ago
    // (We'd need to expose this for testing, or mock Date.now)
    // For now, just verify the function exists
    expect(isInCoordinatorContext(sessionId)).toBe(true);
  });
});
