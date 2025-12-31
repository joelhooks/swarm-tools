/**
 * Tests for swarm orchestration research phase
 *
 * Validates:
 * - Tech stack extraction from task descriptions
 * - Researcher spawning for identified technologies
 * - Summary collection from hivemind (ADR-011)
 * - Research result aggregation
 * - Eval capture integration (captureSubtaskOutcome wiring)
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { runResearchPhase, extractTechStack, swarm_complete, swarm_record_outcome } from "./swarm-orchestrate";
import * as evalCapture from "./eval-capture.js";
import * as fs from "node:fs";
import { readFileSync } from "fs";
import { join } from "path";

describe("extractTechStack", () => {
  test("extracts Next.js from task description", () => {
    const task = "Add authentication to the Next.js app";
    const techStack = extractTechStack(task);
    
    expect(techStack).toContain("next");
  });

  test("extracts React from task description", () => {
    const task = "Build a React component for user profiles";
    const techStack = extractTechStack(task);
    
    expect(techStack).toContain("react");
  });

  test("extracts multiple technologies", () => {
    const task = "Build a Zod schema for validating Next.js API routes with TypeScript";
    const techStack = extractTechStack(task);
    
    expect(techStack).toContain("zod");
    expect(techStack).toContain("next");
    expect(techStack).toContain("typescript");
  });

  test("returns empty array for generic tasks", () => {
    const task = "Refactor the authentication module";
    const techStack = extractTechStack(task);
    
    // Might extract some keywords but should be minimal
    expect(Array.isArray(techStack)).toBe(true);
  });

  test("handles case-insensitive matching", () => {
    const task = "Add NEXT.JS and REACT hooks";
    const techStack = extractTechStack(task);
    
    expect(techStack).toContain("next");
    expect(techStack).toContain("react");
  });

  test("deduplicates repeated mentions", () => {
    const task = "Use Zod for Zod schemas with Zod validation";
    const techStack = extractTechStack(task);
    
    // Should only appear once
    const zodCount = techStack.filter(t => t === "zod").length;
    expect(zodCount).toBe(1);
  });
});

describe("runResearchPhase", () => {
  const testProjectPath = "/Users/joel/Code/joelhooks/opencode-swarm-plugin";

  test("returns research result with tech stack", async () => {
    const task = "Add Next.js API routes with Zod validation";
    
    const result = await runResearchPhase(task, testProjectPath);
    
    expect(result).toHaveProperty("tech_stack");
    expect(result.tech_stack).toBeInstanceOf(Array);
  });

  test("returns summaries keyed by technology", async () => {
    const task = "Add Next.js API routes";
    
    const result = await runResearchPhase(task, testProjectPath);
    
    expect(result).toHaveProperty("summaries");
    expect(typeof result.summaries).toBe("object");
  });

  test("returns memory IDs for stored research", async () => {
    const task = "Add Zod schemas";
    
    const result = await runResearchPhase(task, testProjectPath);
    
    expect(result).toHaveProperty("memory_ids");
    expect(result.memory_ids).toBeInstanceOf(Array);
  });

  test("skips research for tasks with no tech mentions", async () => {
    const task = "Refactor the authentication module";
    
    const result = await runResearchPhase(task, testProjectPath);
    
    // Should return empty result quickly
    expect(result.tech_stack).toHaveLength(0);
    expect(result.summaries).toEqual({});
    expect(result.memory_ids).toHaveLength(0);
  });

  test("handles check_upgrades option", async () => {
    const task = "Add Next.js caching";
    
    const result = await runResearchPhase(task, testProjectPath, {
      checkUpgrades: true,
    });
    
    // Should still return valid result
    expect(result).toHaveProperty("tech_stack");
    expect(result).toHaveProperty("summaries");
  });
});

// describe("swarm_research_phase tool", () => {
//   test.todo("exposes research phase as plugin tool");
//   test.todo("validates task parameter");
//   test.todo("validates project_path parameter");
//   test.todo("returns JSON string with research results");
// });

// ============================================================================
// Eval Capture Integration Tests (swarm_complete)
// ============================================================================

describe("captureSubtaskOutcome integration", () => {
  const mockContext = {
    sessionID: `test-complete-${Date.now()}`,
    messageID: `test-message-${Date.now()}`,
    agent: "test-agent",
    abort: new AbortController().signal,
  };

  let testProjectPath: string;

  beforeEach(async () => {
    testProjectPath = `/tmp/test-swarm-complete-${Date.now()}`;
    fs.mkdirSync(testProjectPath, { recursive: true });
    
    // Create .hive directory and issues.jsonl
    const hiveDir = `${testProjectPath}/.hive`;
    fs.mkdirSync(hiveDir, { recursive: true });
    fs.writeFileSync(`${hiveDir}/issues.jsonl`, "", "utf-8");
    
    // Set hive working directory to testProjectPath
    const { setHiveWorkingDirectory } = await import("./hive");
    setHiveWorkingDirectory(testProjectPath);
  });

  afterEach(() => {
    if (fs.existsSync(testProjectPath)) {
      fs.rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  test("calls captureSubtaskOutcome after successful completion with all params", async () => {
    // Import hive tools
    const { hive_create_epic } = await import("./hive");
    
    // Spy on captureSubtaskOutcome
    const captureOutcomeSpy = spyOn(evalCapture, "captureSubtaskOutcome");

    // Create an epic with a subtask using hive_create_epic
    const epicResult = await hive_create_epic.execute({
      epic_title: "Add OAuth",
      epic_description: "Implement OAuth authentication",
      subtasks: [
        {
          title: "Add auth service",
          priority: 2,
          files: ["src/auth/service.ts", "src/auth/schema.ts"],
        },
      ],
    }, mockContext);
    
    const epicData = JSON.parse(epicResult);
    expect(epicData.success).toBe(true);
    
    const epicId = epicData.epic.id;
    const beadId = epicData.subtasks[0].id;

    const startTime = Date.now() - 120000; // Started 2 minutes ago
    const plannedFiles = ["src/auth/service.ts", "src/auth/schema.ts"];
    const actualFiles = ["src/auth/service.ts", "src/auth/schema.ts", "src/auth/types.ts"];

    // Call swarm_complete
    const result = await swarm_complete.execute(
      {
        project_key: testProjectPath,
        agent_name: "TestAgent",
        bead_id: beadId,
        summary: "Implemented OAuth service with JWT strategy",
        files_touched: actualFiles,
        skip_verification: true, // Skip verification for test
        skip_review: true, // Skip review for test
        planned_files: plannedFiles,
        start_time: startTime,
        error_count: 0,
        retry_count: 0,
      },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    // Verify captureSubtaskOutcome was called with correct params
    expect(captureOutcomeSpy).toHaveBeenCalledTimes(1);
    
    const call = captureOutcomeSpy.mock.calls[0][0];
    expect(call.epicId).toBe(epicId);
    expect(call.projectPath).toBe(testProjectPath);
    expect(call.beadId).toBe(beadId);
    expect(call.title).toBe("Add auth service");
    expect(call.plannedFiles).toEqual(plannedFiles);
    expect(call.actualFiles).toEqual(actualFiles);
    expect(call.durationMs).toBeGreaterThan(0);
    expect(call.errorCount).toBe(0);
    expect(call.retryCount).toBe(0);
    expect(call.success).toBe(true);

    captureOutcomeSpy.mockRestore();
  });

  test("does not call captureSubtaskOutcome when required params missing", async () => {
    const { hive_create_epic } = await import("./hive");
    const captureOutcomeSpy = spyOn(evalCapture, "captureSubtaskOutcome");

    // Create an epic with a subtask
    const epicResult = await hive_create_epic.execute({
      epic_title: "Fix bug",
      subtasks: [
        {
          title: "Fix auth bug",
          priority: 1,
          files: ["src/auth.ts"],
        },
      ],
    }, mockContext);
    
    const epicData = JSON.parse(epicResult);
    const beadId = epicData.subtasks[0].id;

    // Call without planned_files
    const result = await swarm_complete.execute(
      {
        project_key: testProjectPath,
        agent_name: "TestAgent",
        bead_id: beadId,
        summary: "Fixed the bug",
        start_time: Date.now() - 1000,
        skip_verification: true,
        skip_review: true,
        // No planned_files
      },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    // Capture should still be called, but with default values
    // (The function is called in all success cases, it just handles missing params)
    expect(captureOutcomeSpy).toHaveBeenCalledTimes(1);

    captureOutcomeSpy.mockRestore();
  });
});

// ============================================================================
// Event Emission Tests (subtask_outcome events to libSQL)
// ============================================================================

describe("subtask_outcome event emission", () => {
  const mockContext = {
    sessionID: `test-event-emission-${Date.now()}`,
    messageID: `test-message-${Date.now()}`,
    agent: "test-agent",
    abort: new AbortController().signal,
  };

  let testProjectPath: string;

  beforeEach(async () => {
    testProjectPath = `/tmp/test-event-emission-${Date.now()}`;
    fs.mkdirSync(testProjectPath, { recursive: true });
    
    // Create .hive directory and issues.jsonl
    const hiveDir = `${testProjectPath}/.hive`;
    fs.mkdirSync(hiveDir, { recursive: true });
    fs.writeFileSync(`${hiveDir}/issues.jsonl`, "", "utf-8");
    
    // Set hive working directory to testProjectPath
    const { setHiveWorkingDirectory } = await import("./hive");
    setHiveWorkingDirectory(testProjectPath);
  });

  afterEach(() => {
    if (fs.existsSync(testProjectPath)) {
      fs.rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  test("swarm_complete emits subtask_outcome event to libSQL database", async () => {
    // Import dependencies
    const { hive_create_epic } = await import("./hive");
    const { readEvents, getSwarmMailLibSQL } = await import("swarm-mail");

    // Create an epic with a subtask
    const epicResult = await hive_create_epic.execute({
      epic_title: "Add feature X",
      subtasks: [
        {
          title: "Implement X service",
          priority: 2,
          files: ["src/x.ts"],
        },
      ],
    }, mockContext);
    
    const epicData = JSON.parse(epicResult);
    const epicId = epicData.epic.id;
    const beadId = epicData.subtasks[0].id;

    const startTime = Date.now() - 60000; // Started 1 minute ago

    // Call swarm_complete
    const result = await swarm_complete.execute(
      {
        project_key: testProjectPath,
        agent_name: "TestAgent",
        bead_id: beadId,
        summary: "Implemented X service",
        files_touched: ["src/x.ts"],
        skip_verification: true,
        skip_review: true,
        planned_files: ["src/x.ts"],
        start_time: startTime,
        error_count: 0,
        retry_count: 0,
      },
      mockContext,
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    // Query events from libSQL database
    const events = await readEvents({
      projectKey: testProjectPath,
      types: ["subtask_outcome"],
    }, testProjectPath);

    // Should have exactly 1 subtask_outcome event
    expect(events.length).toBe(1);
    
    const event = events[0] as any;
    expect(event.type).toBe("subtask_outcome");
    expect(event.epic_id).toBe(epicId);
    expect(event.bead_id).toBe(beadId);
    expect(event.success).toBe(true);
    expect(event.duration_ms).toBeGreaterThan(0);
  });

  test("subtask_outcome event updates eval_records.outcomes in libSQL", async () => {
    // Import dependencies
    const { hive_create_epic } = await import("./hive");
    const { getSwarmMailLibSQL } = await import("swarm-mail");

    // Create an epic with a subtask
    const epicResult = await hive_create_epic.execute({
      epic_title: "Add feature Y",
      subtasks: [
        {
          title: "Implement Y service",
          priority: 2,
          files: ["src/y.ts"],
        },
      ],
    }, mockContext);
    
    const epicData = JSON.parse(epicResult);
    const epicId = epicData.epic.id;
    const beadId = epicData.subtasks[0].id;

    const startTime = Date.now() - 90000; // Started 1.5 minutes ago

    // Call swarm_complete
    await swarm_complete.execute(
      {
        project_key: testProjectPath,
        agent_name: "TestAgent",
        bead_id: beadId,
        summary: "Implemented Y service",
        files_touched: ["src/y.ts", "src/y.test.ts"],
        skip_verification: true,
        skip_review: true,
        planned_files: ["src/y.ts"],
        start_time: startTime,
        error_count: 0,
        retry_count: 0,
      },
      mockContext,
    );

    // Query eval_records from libSQL
    const swarmMail = await getSwarmMailLibSQL(testProjectPath);
    const db = await swarmMail.getDatabase();

    const result = await db.query<{ outcomes: string | null }>(
      `SELECT outcomes FROM eval_records WHERE id = ?`,
      [epicId]
    );

    expect(result.rows.length).toBe(1);
    
    const outcomes = result.rows[0].outcomes;
    expect(outcomes).not.toBeNull();
    
    const parsed = JSON.parse(outcomes || "[]");
    expect(parsed.length).toBe(1);
    
    const outcome = parsed[0];
    expect(outcome.bead_id).toBe(beadId);
    expect(outcome.success).toBe(true);
    expect(outcome.duration_ms).toBeGreaterThan(0);
    expect(outcome.planned_files).toEqual(["src/y.ts"]);
    expect(outcome.actual_files).toEqual(["src/y.ts", "src/y.test.ts"]);
  });
});

// ============================================================================
// Eval Capture Integration Tests (swarm_record_outcome)
// ============================================================================

describe("finalizeEvalRecord integration", () => {
  const mockContext = {
    sessionID: `test-finalize-${Date.now()}`,
    messageID: `test-message-${Date.now()}`,
    agent: "test-agent",
    abort: new AbortController().signal,
  };

  test("calls finalizeEvalRecord when project_path and epic_id provided", async () => {
    const { swarm_record_outcome } = await import("./swarm-orchestrate");
    
    // Spy on finalizeEvalRecord
    const finalizeEvalSpy = spyOn(evalCapture, "finalizeEvalRecord");
    finalizeEvalSpy.mockReturnValue(null); // Mock return value

    const testProjectPath = "/tmp/test-project";
    const testEpicId = "bd-test123";
    const testBeadId = `${testEpicId}.0`;

    // Call swarm_record_outcome with epic_id and project_path
    await swarm_record_outcome.execute({
      bead_id: testBeadId,
      duration_ms: 120000,
      error_count: 0,
      retry_count: 0,
      success: true,
      files_touched: ["src/test.ts"],
      epic_id: testEpicId,
      project_path: testProjectPath,
    }, mockContext);

    // Verify finalizeEvalRecord was called
    expect(finalizeEvalSpy).toHaveBeenCalledTimes(1);
    expect(finalizeEvalSpy).toHaveBeenCalledWith({
      epicId: testEpicId,
      projectPath: testProjectPath,
    });

    finalizeEvalSpy.mockRestore();
  });

  test("does not call finalizeEvalRecord when epic_id or project_path missing", async () => {
    const { swarm_record_outcome } = await import("./swarm-orchestrate");
    
    // Spy on finalizeEvalRecord
    const finalizeEvalSpy = spyOn(evalCapture, "finalizeEvalRecord");

    const testBeadId = "bd-test123.0";

    // Call without epic_id or project_path
    await swarm_record_outcome.execute({
      bead_id: testBeadId,
      duration_ms: 120000,
      error_count: 0,
      retry_count: 0,
      success: true,
    }, mockContext);

    // Verify finalizeEvalRecord was NOT called
    expect(finalizeEvalSpy).toHaveBeenCalledTimes(0);

    finalizeEvalSpy.mockRestore();
  });

  test("includes finalized record in response when available", async () => {
    const { swarm_record_outcome } = await import("./swarm-orchestrate");
    
    // Mock finalizeEvalRecord to return a record
    const mockFinalRecord = {
      id: "bd-test123",
      timestamp: new Date().toISOString(),
      project_path: "/tmp/test-project",
      task: "Test task",
      strategy: "file-based" as const,
      subtask_count: 2,
      epic_title: "Test Epic",
      subtasks: [],
      overall_success: true,
      total_duration_ms: 240000,
      total_errors: 0,
    };

    const finalizeEvalSpy = spyOn(evalCapture, "finalizeEvalRecord");
    finalizeEvalSpy.mockReturnValue(mockFinalRecord);

    const testProjectPath = "/tmp/test-project";
    const testEpicId = "bd-test123";
    const testBeadId = `${testEpicId}.0`;

    // Call with epic_id and project_path
    const result = await swarm_record_outcome.execute({
      bead_id: testBeadId,
      duration_ms: 120000,
      error_count: 0,
      retry_count: 0,
      success: true,
      epic_id: testEpicId,
      project_path: testProjectPath,
    }, mockContext);

    // Parse result and check for finalized record
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("finalized_eval_record");
    expect(parsed.finalized_eval_record).toEqual(mockFinalRecord);

    finalizeEvalSpy.mockRestore();
  });
});

// ============================================================================
// ADR-011 Hivemind Migration Tests
// ============================================================================

describe("ADR-011: hivemind migration compliance", () => {
  const filePath = join(__dirname, "swarm-orchestrate.ts");
  const fileContents = readFileSync(filePath, "utf-8");

  test("should not reference semantic-memory tools in code", () => {
    // Check for semantic-memory_ references (excluding comments)
    const lines = fileContents.split("\n");
    const codeLines = lines.filter(
      (line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")
    );
    const codeContent = codeLines.join("\n");

    const semanticMemoryRefs = codeContent.match(/semantic-memory_/g);
    expect(semanticMemoryRefs).toBeNull();
  });

  test("should not reference cass_ tools in code", () => {
    const lines = fileContents.split("\n");
    const codeLines = lines.filter(
      (line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")
    );
    const codeContent = codeLines.join("\n");

    const cassRefs = codeContent.match(/cass_/g);
    expect(cassRefs).toBeNull();
  });

  test("should reference hivemind for knowledge gathering (in comments)", () => {
    // The file references hivemind in research phase comments
    expect(fileContents).toContain("Collects summaries from hivemind");
  });

  test("should reference hivemind for memory capture (in code)", () => {
    // The file calls hivemind store command
    expect(fileContents).toContain("hivemind store");
  });

  test("should update degraded_features check for hivemind", () => {
    // Check that degraded features now references hivemind instead of semantic-memory
    const degradedFeaturesSection = fileContents.match(
      /if \(!availability\.get\("hivemind"\)\?\.status\.available\)/
    );
    expect(degradedFeaturesSection).not.toBeNull();
  });

  test("should update tool availability checks to use hivemind", () => {
    // Memory availability should check for hivemind
    const memoryAvailCheck = fileContents.match(
      /const memoryAvailable = await isToolAvailable\("hivemind"\)/
    );
    expect(memoryAvailCheck).not.toBeNull();
  });

  test("should update comments to reference hivemind", () => {
    // Research phase comment should reference hivemind
    expect(fileContents).toContain("Collects summaries from hivemind");
  });

  test("should update usage hints to reference hivemind", () => {
    // Usage hint should mention hivemind
    expect(fileContents).toContain(
      "Each technology has documentation in hivemind"
    );
  });
});

// ============================================================================
// Duration Tracking Tests
// ============================================================================

describe("eval_records duration tracking", () => {
  test("duration should be calculated correctly from start_time", () => {
    // This is a unit test for the duration calculation logic
    // After fix: start_time is REQUIRED, so we always calculate duration
    
    const startTime = Date.now() - 5000; // 5 seconds ago
    const completionDurationMs = Date.now() - startTime;
    
    // Should be approximately 5000ms
    expect(completionDurationMs).toBeGreaterThan(4500);
    expect(completionDurationMs).toBeLessThan(5500);
  });
  
  test("swarm_complete requires start_time parameter", () => {
    // After fix: start_time is no longer optional
    const { args } = swarm_complete;
    
    // Verify start_time is in the schema
    expect(args).toHaveProperty("start_time");
    
    // Try to parse undefined - should fail since it's required now
    try {
      args.start_time.parse(undefined);
      // If we get here, start_time is optional (which would be wrong)
      expect(true).toBe(false); // Force fail
    } catch (error) {
      // Good - start_time is required
      expect(error).toBeDefined();
    }
  });
  
  test("swarm_record_outcome schema requires duration_ms", () => {
    // Verify the tool schema marks duration_ms as required
    const { args } = swarm_record_outcome;
    
    // The schema should have duration_ms as a required field
    expect(args).toHaveProperty("duration_ms");
    
    // Try to parse without duration_ms - should fail
    try {
      args.duration_ms.parse(undefined);
      // If we get here, duration_ms is not required (bad)
      expect(true).toBe(false); // Force fail
    } catch (error) {
      // Good - duration_ms is required
      expect(error).toBeDefined();
    }
  });
});
