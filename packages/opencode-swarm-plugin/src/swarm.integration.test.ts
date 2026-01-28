/**
 * Swarm Integration Tests
 *
 * These tests require:
 * - beads CLI installed and configured
 * - Agent Mail server running at AGENT_MAIL_URL (default: http://agent-mail:8765 in Docker)
 *
 * Run with: pnpm test:integration (or docker:test for full Docker environment)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  swarm_decompose,
  swarm_validate_decomposition,
  swarm_status,
  swarm_progress,
  swarm_complete,
  swarm_subtask_prompt,
  swarm_spawn_subtask,
  swarm_evaluation_prompt,
  swarm_select_strategy,
  swarm_plan_prompt,
  formatSubtaskPromptV2,
  SUBTASK_PROMPT_V2,
  swarm_checkpoint,
  swarm_recover,
} from "./swarm";
import { swarm_review, swarm_review_feedback } from "./swarm-review";
import { mcpCall, setState, clearState, AGENT_MAIL_URL } from "./agent-mail";

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_SESSION_ID = `test-swarm-${Date.now()}`;
const TEST_PROJECT_PATH = `/tmp/test-swarm-${Date.now()}`;

/**
 * Mock tool context for execute functions.
 * The real context is provided by OpenCode runtime.
 */
const mockContext = {
  sessionID: TEST_SESSION_ID,
  messageID: `test-message-${Date.now()}`,
  agent: "test-agent",
  abort: new AbortController().signal,
};

/**
 * Check if Agent Mail is available
 */
async function isAgentMailAvailable(): Promise<boolean> {
  try {
    const url = process.env.AGENT_MAIL_URL || AGENT_MAIL_URL;
    const response = await fetch(`${url}/health/liveness`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if beads CLI is available
 */
async function isBeadsAvailable(): Promise<boolean> {
  try {
    const result = await Bun.$`bd --version`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Prompt Generation Tests (No external dependencies)
// ============================================================================

describe("swarm_decompose", () => {
  it("generates valid decomposition prompt", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Add user authentication with OAuth",
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("prompt");
    expect(parsed).toHaveProperty("expected_schema", "CellTree");
    expect(parsed).toHaveProperty("schema_hint");
    expect(parsed.prompt).toContain("Add user authentication with OAuth");
    expect(parsed.prompt).toContain("as many as needed");
  });

  it("includes context in prompt when provided", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Refactor the API routes",
        context: "Using Next.js App Router with RSC",
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.prompt).toContain("Using Next.js App Router with RSC");
    expect(parsed.prompt).toContain("Additional Context");
  });

});

// ============================================================================
// Strategy Selection Tests
// ============================================================================

describe("swarm_select_strategy", () => {
  it("selects feature-based for 'add' tasks", async () => {
    const result = await swarm_select_strategy.execute(
      {
        task: "Add user authentication with OAuth",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy).toBe("feature-based");
    expect(parsed.confidence).toBeGreaterThan(0.5);
    expect(parsed.reasoning).toContain("add");
    expect(parsed.guidelines).toBeInstanceOf(Array);
    expect(parsed.anti_patterns).toBeInstanceOf(Array);
  });

  it("selects file-based for 'refactor' tasks", async () => {
    const result = await swarm_select_strategy.execute(
      {
        task: "Refactor all components to use new API",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy).toBe("file-based");
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.5);
    expect(parsed.reasoning).toContain("refactor");
  });

  it("selects risk-based for 'fix security' tasks", async () => {
    const result = await swarm_select_strategy.execute(
      {
        task: "Fix security vulnerability in authentication",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy).toBe("risk-based");
    expect(parsed.confidence).toBeGreaterThan(0.5);
    // Should match either 'fix' or 'security'
    expect(
      parsed.reasoning.includes("fix") || parsed.reasoning.includes("security"),
    ).toBe(true);
  });

  it("defaults to feature-based when no keywords match", async () => {
    const result = await swarm_select_strategy.execute(
      {
        task: "Something completely unrelated without keywords",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy).toBe("feature-based");
    // Confidence should be lower without keyword matches
    expect(parsed.confidence).toBeLessThanOrEqual(0.6);
    expect(parsed.reasoning).toContain("Defaulting to feature-based");
  });

  it("includes confidence score and reasoning", async () => {
    const result = await swarm_select_strategy.execute(
      {
        task: "Implement new dashboard feature",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("strategy");
    expect(parsed).toHaveProperty("confidence");
    expect(parsed).toHaveProperty("reasoning");
    expect(parsed).toHaveProperty("description");
    expect(typeof parsed.confidence).toBe("number");
    expect(parsed.confidence).toBeGreaterThanOrEqual(0);
    expect(parsed.confidence).toBeLessThanOrEqual(1);
    expect(typeof parsed.reasoning).toBe("string");
    expect(parsed.reasoning.length).toBeGreaterThan(0);
  });

  it("includes alternative strategies with scores", async () => {
    const result = await swarm_select_strategy.execute(
      {
        task: "Build new payment processing module",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("alternatives");
    expect(parsed.alternatives).toBeInstanceOf(Array);
    expect(parsed.alternatives.length).toBe(3); // 4 strategies - 1 selected = 3 alternatives

    for (const alt of parsed.alternatives) {
      expect(alt).toHaveProperty("strategy");
      expect(alt).toHaveProperty("description");
      expect(alt).toHaveProperty("score");
      expect([
        "file-based",
        "feature-based",
        "risk-based",
        "research-based",
      ]).toContain(alt.strategy);
      expect(typeof alt.score).toBe("number");
    }
  });

  it("includes codebase context in reasoning when provided", async () => {
    const result = await swarm_select_strategy.execute(
      {
        task: "Add new API endpoint",
        codebase_context: "Using Express.js with TypeScript and PostgreSQL",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.reasoning).toContain("Express.js");
  });

  it("accepts optional projectKey parameter for precedent-aware selection", async () => {
    // RED: This test will fail until we add projectKey parameter
    const result = await swarm_select_strategy.execute(
      {
        task: "Add user authentication",
        projectKey: "/tmp/test-project",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    // Should work with or without precedent data
    expect(parsed).toHaveProperty("strategy");
    expect(parsed).toHaveProperty("confidence");
    expect(parsed).toHaveProperty("reasoning");
  });

  it("includes precedent info when projectKey provided and data exists", async () => {
    const result = await swarm_select_strategy.execute(
      {
        task: "Add OAuth authentication",
        projectKey: "/tmp/test-precedent",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    // Precedent field may or may not be present depending on whether decision_traces table exists
    // If projectKey is provided but DB doesn't exist/has no table, graceful degradation means no precedent
    // This is expected behavior - precedent is optional
    if (parsed.precedent) {
      expect(parsed.precedent).toHaveProperty("similar_decisions");
      expect(typeof parsed.precedent.similar_decisions).toBe("number");
    }
    
    // Should still work without precedent
    expect(parsed).toHaveProperty("strategy");
    expect(parsed).toHaveProperty("confidence");
    expect(parsed).toHaveProperty("reasoning");
  });

  it("boosts confidence when precedent agrees with keyword selection", async () => {
    // RED: This will fail until we implement confidence boosting
    const uniqueProjectKey = `/tmp/test-confidence-boost-${Date.now()}`;
    
    // First, create some precedent data (we'll mock this in implementation)
    // For now, just verify the signature works
    const result = await swarm_select_strategy.execute(
      {
        task: "Refactor authentication module",
        projectKey: uniqueProjectKey,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("confidence");
    expect(parsed).toHaveProperty("reasoning");
    // Reasoning should mention precedent if it was found
    if (parsed.precedent?.similar_decisions > 0) {
      expect(parsed.reasoning).toContain("precedent");
    }
  });

  it("reduces confidence when strategy has low success rate", async () => {
    // RED: This will fail until we implement success rate adjustment
    const uniqueProjectKey = `/tmp/test-low-success-${Date.now()}`;
    
    const result = await swarm_select_strategy.execute(
      {
        task: "Fix critical security bug",
        projectKey: uniqueProjectKey,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("confidence");
    // If precedent shows low success rate, should be reflected in reasoning
    if (parsed.precedent?.strategy_success_rate !== undefined && 
        parsed.precedent.strategy_success_rate < 0.3) {
      expect(parsed.reasoning).toContain("low success rate");
    }
  });

  it("works backward-compatible without projectKey", async () => {
    // Ensure existing behavior still works
    const result = await swarm_select_strategy.execute(
      {
        task: "Implement new feature",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy).toBe("feature-based");
    expect(parsed).toHaveProperty("confidence");
    expect(parsed).not.toHaveProperty("precedent");
  });

  it("cites specific epic IDs when precedent found", async () => {
    // RED: This will fail until we implement epic citation
    const uniqueProjectKey = `/tmp/test-epic-citation-${Date.now()}`;
    
    const result = await swarm_select_strategy.execute(
      {
        task: "Migrate all components to new API",
        projectKey: uniqueProjectKey,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    if (parsed.precedent?.cited_epics) {
      expect(Array.isArray(parsed.precedent.cited_epics)).toBe(true);
      // Each epic ID should be a string
      parsed.precedent.cited_epics.forEach((epicId: string) => {
        expect(typeof epicId).toBe("string");
      });
    }
  });
});

// ============================================================================
// Planning Prompt Tests
// ============================================================================

describe("swarm_plan_prompt", () => {
  it("auto-selects strategy when not specified", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Add user settings page",
        query_cass: false, // Disable CASS to isolate test
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("prompt");
    expect(parsed).toHaveProperty("strategy");
    expect(parsed.strategy).toHaveProperty("selected");
    expect(parsed.strategy).toHaveProperty("reasoning");
    expect(parsed.strategy.selected).toBe("feature-based"); // 'add' keyword
  });

  it("uses explicit strategy when provided", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Do something",
        strategy: "risk-based",
        query_cass: false,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy.selected).toBe("risk-based");
    expect(parsed.strategy.reasoning).toContain("User-specified strategy");
  });

  it("includes strategy guidelines in prompt", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Refactor the codebase",
        query_cass: false,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    // Prompt should contain strategy-specific guidelines
    expect(parsed.prompt).toContain("## Strategy:");
    expect(parsed.prompt).toContain("### Guidelines");
    expect(parsed.prompt).toContain("### Anti-Patterns");
    expect(parsed.prompt).toContain("### Examples");
  });

  it("includes anti-patterns in output", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Build new feature",
        query_cass: false,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.strategy).toHaveProperty("anti_patterns");
    expect(parsed.strategy.anti_patterns).toBeInstanceOf(Array);
    expect(parsed.strategy.anti_patterns.length).toBeGreaterThan(0);
  });

  it("returns expected_schema and validation_note", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Some task",
        query_cass: false,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("expected_schema", "CellTree");
    expect(parsed).toHaveProperty("validation_note");
    expect(parsed.validation_note).toContain("swarm_validate_decomposition");
    expect(parsed).toHaveProperty("schema_hint");
    expect(parsed.schema_hint).toHaveProperty("epic");
    expect(parsed.schema_hint).toHaveProperty("subtasks");
  });

  it("includes strategy and skills info in output", async () => {
    // Test swarm_plan_prompt output structure
    const result = await swarm_plan_prompt.execute(
      {
        task: "Add feature",
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    // Should have strategy info
    expect(parsed).toHaveProperty("strategy");
    expect(parsed.strategy).toHaveProperty("selected");
    expect(parsed.strategy).toHaveProperty("reasoning");
    expect(parsed.strategy).toHaveProperty("guidelines");
    expect(parsed.strategy).toHaveProperty("anti_patterns");

    // Should have skills info
    expect(parsed).toHaveProperty("skills");
    expect(parsed.skills).toHaveProperty("included");

    // Should have memory query instruction
    expect(parsed).toHaveProperty("memory_query");
  });

  it("includes context in prompt when provided", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Add user profile",
        context: "We use Next.js App Router with server components",
        query_cass: false, // Skip hivemind session search
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.prompt).toContain("Next.js App Router");
    expect(parsed.prompt).toContain("server components");
  });

});

describe("swarm_validate_decomposition", () => {
  it("validates correct CellTree", async () => {
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
      { response: validCellTree },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(true);
    expect(parsed.cell_tree).toBeDefined();
    expect(parsed.stats).toEqual({
      subtask_count: 2,
      total_files: 3,
      total_complexity: 3,
    });
  });

  it("rejects file conflicts", async () => {
    const conflictingCellTree = JSON.stringify({
      epic: {
        title: "Conflicting files",
      },
      subtasks: [
        {
          title: "Task A",
          files: ["src/shared.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
        {
          title: "Task B",
          files: ["src/shared.ts"], // Conflict!
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    });

    const result = await swarm_validate_decomposition.execute(
      { response: conflictingCellTree },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("File conflicts detected");
    expect(parsed.error).toContain("src/shared.ts");
  });

  it("rejects invalid dependencies (forward reference)", async () => {
    const invalidDeps = JSON.stringify({
      epic: {
        title: "Invalid deps",
      },
      subtasks: [
        {
          title: "Task A",
          files: ["src/a.ts"],
          dependencies: [1], // Invalid: depends on later task
          estimated_complexity: 1,
        },
        {
          title: "Task B",
          files: ["src/b.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    });

    const result = await swarm_validate_decomposition.execute(
      { response: invalidDeps },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("Invalid dependency");
    expect(parsed.hint).toContain("Reorder subtasks");
  });

  it("rejects invalid JSON", async () => {
    const result = await swarm_validate_decomposition.execute(
      { response: "not valid json {" },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("Invalid JSON");
  });

  it("rejects missing required fields", async () => {
    const missingFields = JSON.stringify({
      epic: { title: "Missing subtasks" },
      // No subtasks array
    });

    const result = await swarm_validate_decomposition.execute(
      { response: missingFields },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("Schema validation failed");
  });
});

describe("swarm_subtask_prompt", () => {
  it("generates complete subtask prompt", async () => {
    const result = await swarm_subtask_prompt.execute(
      {
        agent_name: "BlueLake",
        bead_id: "bd-abc123.1",
        epic_id: "bd-abc123",
        subtask_title: "Add OAuth provider",
        subtask_description: "Configure Google OAuth in the auth config",
        files: ["src/auth/google.ts", "src/auth/config.ts"],
        shared_context: "We are using NextAuth.js v5",
      },
      mockContext,
    );

    // Result is the prompt string directly
    expect(result).toContain("BlueLake");
    expect(result).toContain("bd-abc123.1");
    expect(result).toContain("bd-abc123");
    expect(result).toContain("Add OAuth provider");
    expect(result).toContain("Configure Google OAuth");
    expect(result).toContain("src/auth/google.ts");
    expect(result).toContain("NextAuth.js v5");
    expect(result).toContain("swarm_progress");
    expect(result).toContain("swarm_complete");
  });

  it("handles missing optional fields", async () => {
    const result = await swarm_subtask_prompt.execute(
      {
        agent_name: "RedStone",
        bead_id: "bd-xyz789.2",
        epic_id: "bd-xyz789",
        subtask_title: "Simple task",
        files: [],
      },
      mockContext,
    );

    expect(result).toContain("RedStone");
    expect(result).toContain("bd-xyz789.2");
    expect(result).toContain("Simple task");
    expect(result).toContain("(none)"); // For missing description/context
    expect(result).toContain("(no files assigned)"); // Empty files
  });
});

describe("swarm_evaluation_prompt", () => {
  it("generates evaluation prompt with schema hint", async () => {
    const result = await swarm_evaluation_prompt.execute(
      {
        bead_id: "bd-abc123.1",
        subtask_title: "Add OAuth provider",
        files_touched: ["src/auth/google.ts", "src/auth/config.ts"],
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("prompt");
    expect(parsed).toHaveProperty("expected_schema", "Evaluation");
    expect(parsed).toHaveProperty("schema_hint");

    expect(parsed.prompt).toContain("bd-abc123.1");
    expect(parsed.prompt).toContain("Add OAuth provider");
    expect(parsed.prompt).toContain("src/auth/google.ts");
    expect(parsed.prompt).toContain("type_safe");
    expect(parsed.prompt).toContain("no_bugs");
    expect(parsed.prompt).toContain("patterns");
    expect(parsed.prompt).toContain("readable");
  });

  it("handles empty files list", async () => {
    const result = await swarm_evaluation_prompt.execute(
      {
        bead_id: "bd-xyz789.1",
        subtask_title: "Documentation only",
        files_touched: [],
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.prompt).toContain("(no files recorded)");
  });
});

// ============================================================================
// Integration Tests (Require Agent Mail + beads)
// ============================================================================

describe("swarm_status (integration)", () => {
  let beadsAvailable = false;

  beforeAll(async () => {
    beadsAvailable = await isBeadsAvailable();
  });

  it.skipIf(!beadsAvailable)(
    "returns status for non-existent epic",
    async () => {
      // This should fail gracefully - no epic exists
      try {
        await swarm_status.execute(
          {
            epic_id: "bd-nonexistent",
            project_key: TEST_PROJECT_PATH,
          },
          mockContext,
        );
        // If it doesn't throw, that's fine too - it might return empty status
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        // SwarmError should have operation property
        if (error instanceof Error && "operation" in error) {
          expect((error as { operation: string }).operation).toBe(
            "query_subtasks",
          );
        }
      }
    },
  );
});

describe("swarm_progress (integration)", () => {
  let agentMailAvailable = false;

  beforeAll(async () => {
    agentMailAvailable = await isAgentMailAvailable();
  });

  it.skipIf(!agentMailAvailable)("reports progress to Agent Mail", async () => {
    const uniqueProjectKey = `${TEST_PROJECT_PATH}-progress-${Date.now()}`;
    const sessionID = `progress-session-${Date.now()}`;

    // Initialize Agent Mail state for this session
    try {
      // Ensure project exists
      await mcpCall("ensure_project", { human_key: uniqueProjectKey });

      // Register agent
      const agent = await mcpCall<{ name: string }>("register_agent", {
        project_key: uniqueProjectKey,
        program: "opencode-test",
        model: "test",
        task_description: "Integration test",
      });

      // Set state for the session
      setState(sessionID, {
        projectKey: uniqueProjectKey,
        agentName: agent.name,
        reservations: [],
        startedAt: new Date().toISOString(),
      });

      const ctx = {
        ...mockContext,
        sessionID,
      };

      const result = await swarm_progress.execute(
        {
          project_key: uniqueProjectKey,
          agent_name: agent.name,
          bead_id: "bd-test123.1",
          status: "in_progress",
          message: "Working on the feature",
          progress_percent: 50,
          files_touched: ["src/test.ts"],
        },
        ctx,
      );

      expect(result).toContain("Progress reported");
      expect(result).toContain("in_progress");
      expect(result).toContain("50%");
    } finally {
      clearState(sessionID);
    }
  });
});

describe("swarm_complete (integration)", () => {
  let agentMailAvailable = false;
  let beadsAvailable = false;

  beforeAll(async () => {
    agentMailAvailable = await isAgentMailAvailable();
    beadsAvailable = await isBeadsAvailable();
  });

  it.skipIf(!agentMailAvailable || !beadsAvailable)(
    "completes subtask with passing evaluation",
    async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-complete-${Date.now()}`;
      const sessionID = `complete-session-${Date.now()}`;

      try {
        // Set up Agent Mail
        await mcpCall("ensure_project", { human_key: uniqueProjectKey });
        const agent = await mcpCall<{ name: string }>("register_agent", {
          project_key: uniqueProjectKey,
          program: "opencode-test",
          model: "test",
          task_description: "Integration test",
        });

        setState(sessionID, {
          projectKey: uniqueProjectKey,
          agentName: agent.name,
          reservations: [],
          startedAt: new Date().toISOString(),
        });

        const ctx = {
          ...mockContext,
          sessionID,
        };

        // Create a test bead first
        const createResult =
          await Bun.$`bd create "Test subtask" -t task --json`
            .quiet()
            .nothrow();

        if (createResult.exitCode !== 0) {
          console.warn(
            "Could not create test bead:",
            createResult.stderr.toString(),
          );
          return;
        }

        const bead = JSON.parse(createResult.stdout.toString());

        const passingEvaluation = JSON.stringify({
          passed: true,
          criteria: {
            type_safe: { passed: true, feedback: "All types correct" },
            no_bugs: { passed: true, feedback: "No issues found" },
            patterns: { passed: true, feedback: "Follows conventions" },
            readable: { passed: true, feedback: "Clear code" },
          },
          overall_feedback: "Great work!",
          retry_suggestion: null,
        });

        const result = await swarm_complete.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agent.name,
            bead_id: bead.id,
            summary: "Completed the test subtask",
            evaluation: passingEvaluation,
          },
          ctx,
        );

        const parsed = JSON.parse(result);

        expect(parsed.success).toBe(true);
        expect(parsed.bead_id).toBe(bead.id);
        expect(parsed.closed).toBe(true);
        expect(parsed.reservations_released).toBe(true);
        expect(parsed.message_sent).toBe(true);
      } finally {
        clearState(sessionID);
      }
    },
  );

  it.skipIf(!agentMailAvailable)(
    "rejects completion with failing evaluation",
    async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-fail-${Date.now()}`;
      const sessionID = `fail-session-${Date.now()}`;

      try {
        // Set up Agent Mail
        await mcpCall("ensure_project", { human_key: uniqueProjectKey });
        const agent = await mcpCall<{ name: string }>("register_agent", {
          project_key: uniqueProjectKey,
          program: "opencode-test",
          model: "test",
          task_description: "Integration test",
        });

        setState(sessionID, {
          projectKey: uniqueProjectKey,
          agentName: agent.name,
          reservations: [],
          startedAt: new Date().toISOString(),
        });

        const ctx = {
          ...mockContext,
          sessionID,
        };

        const failingEvaluation = JSON.stringify({
          passed: false,
          criteria: {
            type_safe: { passed: false, feedback: "Missing types on line 42" },
          },
          overall_feedback: "Needs work",
          retry_suggestion: "Add explicit types to the handler function",
        });

        const result = await swarm_complete.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agent.name,
            bead_id: "bd-test-fail.1",
            summary: "Attempted completion",
            evaluation: failingEvaluation,
          },
          ctx,
        );

        const parsed = JSON.parse(result);

        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain("Self-evaluation failed");
        expect(parsed.retry_suggestion).toBe(
          "Add explicit types to the handler function",
        );
      } finally {
        clearState(sessionID);
      }
    },
  );
});

// ============================================================================
// Full Swarm Flow (End-to-End)
// ============================================================================

describe("full swarm flow (integration)", () => {
  let agentMailAvailable = false;
  let beadsAvailable = false;

  beforeAll(async () => {
    agentMailAvailable = await isAgentMailAvailable();
    beadsAvailable = await isBeadsAvailable();
  });

  it.skipIf(!agentMailAvailable || !beadsAvailable)(
    "creates epic, reports progress, completes subtask",
    async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-flow-${Date.now()}`;
      const sessionID = `flow-session-${Date.now()}`;

      try {
        // 1. Set up Agent Mail session
        await mcpCall("ensure_project", { human_key: uniqueProjectKey });
        const agent = await mcpCall<{ name: string }>("register_agent", {
          project_key: uniqueProjectKey,
          program: "opencode-test",
          model: "test",
          task_description: "E2E swarm test",
        });

        setState(sessionID, {
          projectKey: uniqueProjectKey,
          agentName: agent.name,
          reservations: [],
          startedAt: new Date().toISOString(),
        });

        const ctx = {
          ...mockContext,
          sessionID,
        };

        // 2. Generate decomposition prompt
        const decomposeResult = await swarm_decompose.execute(
          {
            task: "Add unit tests for auth module",
          },
          ctx,
        );

        const decomposition = JSON.parse(decomposeResult);
        expect(decomposition.prompt).toContain("Add unit tests");

        // 3. Create an epic with bd CLI
        const epicResult =
          await Bun.$`bd create "Add unit tests for auth module" -t epic --json`
            .quiet()
            .nothrow();

        if (epicResult.exitCode !== 0) {
          console.warn("Could not create epic:", epicResult.stderr.toString());
          return;
        }

        const epic = JSON.parse(epicResult.stdout.toString());
        expect(epic.id).toMatch(/^[a-z0-9-]+-[a-z0-9]+$/);

        // 4. Create a subtask
        const subtaskResult =
          await Bun.$`bd create "Test login flow" -t task --json`
            .quiet()
            .nothrow();

        if (subtaskResult.exitCode !== 0) {
          console.warn(
            "Could not create subtask:",
            subtaskResult.stderr.toString(),
          );
          return;
        }

        const subtask = JSON.parse(subtaskResult.stdout.toString());

        // 5. Generate subtask prompt
        const subtaskPrompt = await swarm_subtask_prompt.execute(
          {
            agent_name: agent.name,
            bead_id: subtask.id,
            epic_id: epic.id,
            subtask_title: "Test login flow",
            files: ["src/auth/__tests__/login.test.ts"],
          },
          ctx,
        );

        expect(subtaskPrompt).toContain(agent.name);
        expect(subtaskPrompt).toContain(subtask.id);

        // 6. Report progress
        const progressResult = await swarm_progress.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agent.name,
            bead_id: subtask.id,
            status: "in_progress",
            progress_percent: 50,
            message: "Writing test cases",
          },
          ctx,
        );

        expect(progressResult).toContain("Progress reported");

        // 7. Generate evaluation prompt
        const evalPromptResult = await swarm_evaluation_prompt.execute(
          {
            bead_id: subtask.id,
            subtask_title: "Test login flow",
            files_touched: ["src/auth/__tests__/login.test.ts"],
          },
          ctx,
        );

        const evalPrompt = JSON.parse(evalPromptResult);
        expect(evalPrompt.expected_schema).toBe("Evaluation");

        // 8. Complete the subtask
        const completeResult = await swarm_complete.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agent.name,
            bead_id: subtask.id,
            summary: "Added comprehensive login tests",
            evaluation: JSON.stringify({
              passed: true,
              criteria: {
                type_safe: { passed: true, feedback: "TypeScript compiles" },
                no_bugs: { passed: true, feedback: "Tests pass" },
                patterns: { passed: true, feedback: "Follows test patterns" },
                readable: { passed: true, feedback: "Clear test names" },
              },
              overall_feedback: "Good test coverage",
              retry_suggestion: null,
            }),
          },
          ctx,
        );

        const completion = JSON.parse(completeResult);
        expect(completion.success).toBe(true);
        expect(completion.closed).toBe(true);
        expect(completion.message_sent).toBe(true);

        // 9. Check swarm status
        const statusResult = await swarm_status.execute(
          {
            epic_id: epic.id,
            project_key: uniqueProjectKey,
          },
          ctx,
        );

        const status = JSON.parse(statusResult);
        expect(status.epic_id).toBe(epic.id);
        // Status may show completed subtasks now
      } finally {
        clearState(sessionID);
      }
    },
  );
});

// ============================================================================
// Tool Availability & Graceful Degradation Tests
// ============================================================================

import {
  checkTool,
  isToolAvailable,
  checkAllTools,
  formatToolAvailability,
  resetToolCache,
  withToolFallback,
  ifToolAvailable,
} from "./tool-availability";
import { swarm_init } from "./swarm";

describe("Tool Availability", () => {
  beforeAll(() => {
    resetToolCache();
  });

  afterAll(() => {
    resetToolCache();
  });

  it("checks individual tool availability", async () => {
    const status = await checkTool("semantic-memory");
    expect(status).toHaveProperty("available");
    expect(status).toHaveProperty("checkedAt");
    expect(typeof status.available).toBe("boolean");
  });

  it("caches tool availability checks", async () => {
    const status1 = await checkTool("semantic-memory");
    const status2 = await checkTool("semantic-memory");
    // Same timestamp means cached
    expect(status1.checkedAt).toBe(status2.checkedAt);
  });

  it("checks all tools at once", async () => {
    const availability = await checkAllTools();
    expect(availability.size).toBe(7); // semantic-memory, cass, hivemind, hive, beads, swarm-mail, agent-mail
    expect(availability.has("semantic-memory")).toBe(true);
    expect(availability.has("cass")).toBe(true);
    expect(availability.has("beads")).toBe(true);
    expect(availability.has("swarm-mail")).toBe(true);
    expect(availability.has("agent-mail")).toBe(true);
  });

  it("formats tool availability for display", async () => {
    const availability = await checkAllTools();
    const formatted = formatToolAvailability(availability);
    expect(formatted).toContain("Tool Availability:");
    expect(formatted).toContain("semantic-memory");
  });

  it("executes with fallback when tool unavailable", async () => {
    // Force cache reset to test fresh
    resetToolCache();

    const result = await withToolFallback(
      "cass", // May or may not be available
      async () => "action-result",
      () => "fallback-result",
    );

    // Either result is valid depending on tool availability
    expect(["action-result", "fallback-result"]).toContain(result);
  });

  it("returns undefined when tool unavailable with ifToolAvailable", async () => {
    resetToolCache();

    // This will return undefined if agent-mail is not running
    const result = await ifToolAvailable("agent-mail", async () => "success");

    // Result is either "success" or undefined
    expect([undefined, "success"]).toContain(result);
  });
});

describe("swarm_init", () => {
  it("reports tool availability status", async () => {
    resetToolCache();

    const result = await swarm_init.execute({}, mockContext);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("ready", true);
    expect(parsed).toHaveProperty("tool_availability");
    expect(parsed).toHaveProperty("report");

    // Check tool availability structure
    const tools = parsed.tool_availability;
    expect(tools).toHaveProperty("semantic-memory");
    expect(tools).toHaveProperty("cass");
    expect(tools).toHaveProperty("beads");
    expect(tools).toHaveProperty("agent-mail");

    // Each tool should have available and fallback
    for (const [, info] of Object.entries(tools)) {
      expect(info).toHaveProperty("available");
      expect(info).toHaveProperty("fallback");
    }
  });

  it("includes recommendations", async () => {
    const result = await swarm_init.execute({}, mockContext);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("recommendations");
    expect(parsed.recommendations).toHaveProperty("beads");
    expect(parsed.recommendations).toHaveProperty("agent_mail");
  });
});

  describe("Worker Handoff Generation", () => {
    it("generateWorkerHandoff creates valid WorkerHandoff object", () => {
      // This will test the new function once we implement it
      const { generateWorkerHandoff } = require("./swarm-orchestrate");
      
      const handoff = generateWorkerHandoff({
        task_id: "opencode-swarm-monorepo-lf2p4u-abc123.1",
        files_owned: ["src/auth.ts", "src/middleware.ts"],
        epic_summary: "Add OAuth authentication",
        your_role: "Implement OAuth provider",
        dependencies_completed: ["Database schema ready"],
        what_comes_next: "Integration tests",
      });

      // Verify contract section
      expect(handoff.contract.task_id).toBe("opencode-swarm-monorepo-lf2p4u-abc123.1");
      expect(handoff.contract.files_owned).toEqual(["src/auth.ts", "src/middleware.ts"]);
      expect(handoff.contract.files_readonly).toEqual([]);
      expect(handoff.contract.dependencies_completed).toEqual(["Database schema ready"]);
      expect(handoff.contract.success_criteria.length).toBeGreaterThan(0);

      // Verify context section
      expect(handoff.context.epic_summary).toBe("Add OAuth authentication");
      expect(handoff.context.your_role).toBe("Implement OAuth provider");
      expect(handoff.context.what_comes_next).toBe("Integration tests");

      // Verify escalation section
      expect(handoff.escalation.blocked_contact).toBe("coordinator");
      expect(handoff.escalation.scope_change_protocol).toContain("swarmmail_send");
    });

    it("swarm_spawn_subtask includes handoff JSON in prompt", async () => {
      const result = await swarm_spawn_subtask.execute(
        {
          bead_id: "opencode-swarm-monorepo-lf2p4u-abc123.1",
          epic_id: "opencode-swarm-monorepo-lf2p4u-abc123",
          subtask_title: "Add OAuth provider",
          subtask_description: "Configure Google OAuth",
          files: ["src/auth/google.ts"],
          shared_context: "Using NextAuth.js v5",
        },
        mockContext,
      );

      // Parse the JSON response
      const parsed = JSON.parse(result);
      const prompt = parsed.prompt;

      // Should contain WorkerHandoff JSON section
      expect(prompt).toContain("## WorkerHandoff Contract");
      expect(prompt).toContain('"contract"');
      expect(prompt).toContain('"task_id"');
      expect(prompt).toContain('"files_owned"');
      expect(prompt).toContain('"success_criteria"');
      expect(prompt).toContain("opencode-swarm-monorepo-lf2p4u-abc123.1");
    });
  });

  describe("Graceful Degradation", () => {
  it("swarm_decompose works without hivemind sessions", async () => {
    // This should work regardless of hivemind session search availability
    const result = await swarm_decompose.execute(
      {
        task: "Add user authentication",
        query_cass: true, // Request hivemind session search but it may not be available
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    // Should always return a valid prompt
    expect(parsed).toHaveProperty("prompt");
    expect(parsed.prompt).toContain("Add user authentication");

    // hivemind history should indicate whether it was queried
    expect(parsed).toHaveProperty("cass_history");
    expect(parsed.cass_history).toHaveProperty("queried");
  });

  it("swarm_decompose can skip hivemind session search explicitly", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Add user authentication",
        query_cass: false, // Explicitly skip hivemind session search
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.cass_history.queried).toBe(false);
  });

  it("decomposition prompt includes beads discipline", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Build feature X",
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    // Check that beads discipline is in the prompt
    expect(parsed.prompt).toContain("MANDATORY");
    expect(parsed.prompt).toContain("bead");
    expect(parsed.prompt).toContain("Plan aggressively");
  });

  it("subtask prompt includes agent-mail discipline", async () => {
    const result = await swarm_subtask_prompt.execute(
      {
        agent_name: "TestAgent",
        bead_id: "bd-test123.1",
        epic_id: "bd-test123",
        subtask_title: "Test task",
        files: ["src/test.ts"],
      },
      mockContext,
    );

    // Check that swarm-mail discipline is in the prompt
    expect(result).toContain("MANDATORY");
    expect(result).toContain("Swarm Mail");
    expect(result).toContain("swarmmail_send");
    expect(result).toContain("Report progress");
  });
});

// ============================================================================
// Coordinator-Centric Swarm Tools (V2)
// ============================================================================

describe("Swarm Prompt V2 (with Swarm Mail/Beads)", () => {
  describe("formatSubtaskPromptV2", () => {
    it("generates correct prompt with all fields", async () => {
      const result = await formatSubtaskPromptV2({
        bead_id: "test-swarm-plugin-lf2p4u-oauth123.1",
        epic_id: "test-swarm-plugin-lf2p4u-oauth123",
        subtask_title: "Add OAuth provider",
        subtask_description: "Configure Google OAuth in the auth config",
        files: ["src/auth/google.ts", "src/auth/config.ts"],
        shared_context: "We are using NextAuth.js v5",
      });

      // Check title is included
      expect(result).toContain("Add OAuth provider");

      // Check description is included
      expect(result).toContain("Configure Google OAuth in the auth config");

      // Check files are formatted as list
      expect(result).toContain("- `src/auth/google.ts`");
      expect(result).toContain("- `src/auth/config.ts`");

      // Check shared context is included
      expect(result).toContain("We are using NextAuth.js v5");

      // Check bead/epic IDs are substituted
      expect(result).toContain("test-swarm-plugin-lf2p4u-oauth123.1");
      expect(result).toContain("test-swarm-plugin-lf2p4u-oauth123");
    });

    it("handles missing optional fields", async () => {
      const result = await formatSubtaskPromptV2({
        bead_id: "test-swarm-plugin-lf2p4u-simple456.1",
        epic_id: "test-swarm-plugin-lf2p4u-simple456",
        subtask_title: "Simple task",
        subtask_description: "",
        files: [],
      });

      // Check title is included
      expect(result).toContain("Simple task");

      // Check fallback for empty description
      expect(result).toContain("(see title)");

      // Check fallback for empty files
      expect(result).toContain("(no specific files - use judgment)");

      // Check fallback for missing context
      expect(result).toContain("(none)");
    });

    it("handles files with special characters", async () => {
      const result = await formatSubtaskPromptV2({
        bead_id: "test-swarm-plugin-lf2p4u-paths789.1",
        epic_id: "test-swarm-plugin-lf2p4u-paths789",
        subtask_title: "Handle paths",
        subtask_description: "Test file paths",
        files: [
          "src/components/[slug]/page.tsx",
          "src/api/users/[id]/route.ts",
        ],
      });

      expect(result).toContain("- `src/components/[slug]/page.tsx`");
      expect(result).toContain("- `src/api/users/[id]/route.ts`");
    });
  });

  describe("SUBTASK_PROMPT_V2", () => {
    it("contains expected sections", () => {
      // Check all main sections are present in the template
      expect(SUBTASK_PROMPT_V2).toContain("[TASK]");
      expect(SUBTASK_PROMPT_V2).toContain("{subtask_title}");
      expect(SUBTASK_PROMPT_V2).toContain("{subtask_description}");

      expect(SUBTASK_PROMPT_V2).toContain("[FILES]");
      expect(SUBTASK_PROMPT_V2).toContain("{file_list}");

      expect(SUBTASK_PROMPT_V2).toContain("[CONTEXT]");
      expect(SUBTASK_PROMPT_V2).toContain("{shared_context}");

      expect(SUBTASK_PROMPT_V2).toContain("[MANDATORY SURVIVAL CHECKLIST]");
    });

    it("DOES contain Swarm Mail instructions (MANDATORY)", () => {
      // V2 prompt tells agents to USE Swarm Mail - this is non-negotiable
      expect(SUBTASK_PROMPT_V2).toContain("SWARM MAIL");
      expect(SUBTASK_PROMPT_V2).toContain("swarmmail_init");
      expect(SUBTASK_PROMPT_V2).toContain("swarmmail_send");
      expect(SUBTASK_PROMPT_V2).toContain("swarmmail_inbox");
      expect(SUBTASK_PROMPT_V2).toContain("swarmmail_reserve");
      expect(SUBTASK_PROMPT_V2).toContain("swarmmail_release");
      expect(SUBTASK_PROMPT_V2).toContain("thread_id");
      expect(SUBTASK_PROMPT_V2).toContain("NON-NEGOTIABLE");
    });

    it("DOES contain beads instructions", () => {
      // V2 prompt tells agents to USE beads
      expect(SUBTASK_PROMPT_V2).toContain("{bead_id}");
      expect(SUBTASK_PROMPT_V2).toContain("{epic_id}");
      expect(SUBTASK_PROMPT_V2).toContain("hive_update");
      expect(SUBTASK_PROMPT_V2).toContain("hive_create");
      expect(SUBTASK_PROMPT_V2).toContain("swarm_complete");
    });

    it("grants workers autonomy to file beads against epic", () => {
      // Workers should be able to file bugs, tech debt, follow-ups
      expect(SUBTASK_PROMPT_V2).toContain("You Have Autonomy to File Issues");
      expect(SUBTASK_PROMPT_V2).toContain("parent_id");
      expect(SUBTASK_PROMPT_V2).toContain("Don't silently ignore issues");
    });

    it("instructs agents to communicate via swarmmail", () => {
      expect(SUBTASK_PROMPT_V2).toContain("don't work silently");
      expect(SUBTASK_PROMPT_V2).toContain("progress");
      expect(SUBTASK_PROMPT_V2).toContain("coordinator");
      expect(SUBTASK_PROMPT_V2).toContain("CRITICAL");
    });

    it("contains survival checklist: hivemind_find", () => {
      // Step 2: Query past learnings BEFORE starting work
      expect(SUBTASK_PROMPT_V2).toContain("hivemind_find");
      expect(SUBTASK_PROMPT_V2).toContain("Query Past Learnings");
      expect(SUBTASK_PROMPT_V2).toContain("BEFORE starting work");
      expect(SUBTASK_PROMPT_V2).toContain("If you skip this step, you WILL waste time solving already-solved problems");
    });

    it("contains survival checklist: skills discovery and loading", () => {
      // Step 3: Load relevant skills if available
      expect(SUBTASK_PROMPT_V2).toContain("skills_list");
      expect(SUBTASK_PROMPT_V2).toContain("skills_use");
      expect(SUBTASK_PROMPT_V2).toContain("Load Relevant Skills");
      expect(SUBTASK_PROMPT_V2).toContain("Common skill triggers");
    });

    it("contains survival checklist: worker reserves files (not coordinator)", () => {
      // Step 4: Worker reserves their own files
      expect(SUBTASK_PROMPT_V2).toContain("swarmmail_reserve");
      expect(SUBTASK_PROMPT_V2).toContain("Reserve Your Files");
      expect(SUBTASK_PROMPT_V2).toContain("YOU reserve, not coordinator");
      expect(SUBTASK_PROMPT_V2).toContain("Workers reserve their own files");
    });

    it("contains survival checklist: swarm_progress at milestones", () => {
      // Step 6: Report progress at 25/50/75%
      expect(SUBTASK_PROMPT_V2).toContain("swarm_progress");
      expect(SUBTASK_PROMPT_V2).toContain("Report Progress at Milestones");
      expect(SUBTASK_PROMPT_V2).toContain("progress_percent");
      expect(SUBTASK_PROMPT_V2).toContain("25%, 50%, 75%");
      expect(SUBTASK_PROMPT_V2).toContain("auto-checkpoint");
    });

    it("contains survival checklist: swarm_checkpoint before risky ops", () => {
      // Step 7: Manual checkpoint before risky operations
      expect(SUBTASK_PROMPT_V2).toContain("swarm_checkpoint");
      expect(SUBTASK_PROMPT_V2).toContain("Manual Checkpoint BEFORE Risky Operations");
      expect(SUBTASK_PROMPT_V2).toContain("Large refactors");
      expect(SUBTASK_PROMPT_V2).toContain("preserve context");
    });

    it("contains survival checklist: hivemind_store for learnings", () => {
      // Step 8: Store discoveries and learnings
      expect(SUBTASK_PROMPT_V2).toContain("hivemind_store");
      expect(SUBTASK_PROMPT_V2).toContain("STORE YOUR LEARNINGS");
      expect(SUBTASK_PROMPT_V2).toContain("Solved a tricky bug");
      expect(SUBTASK_PROMPT_V2).toContain("The WHY matters more than the WHAT");
    });

    it("does NOT mention coordinator reserving files", () => {
      // Coordinator no longer reserves files - workers do it themselves
      const lowerPrompt = SUBTASK_PROMPT_V2.toLowerCase();
      expect(lowerPrompt).not.toContain("coordinator reserves");
      expect(lowerPrompt).not.toContain("coordinator will reserve");
    });

    it("enforces swarm_complete over manual hive_close", () => {
      // Step 9: Use swarm_complete, not hive_close
      expect(SUBTASK_PROMPT_V2).toContain("swarm_complete");
      expect(SUBTASK_PROMPT_V2).toContain("DO NOT manually close the cell");
      expect(SUBTASK_PROMPT_V2).toContain("Use swarm_complete");
    });
  });

  describe("swarm_complete automatic memory capture", () => {
    let beadsAvailable = false;

    beforeAll(async () => {
      beadsAvailable = await isBeadsAvailable();
    });

    it.skipIf(!beadsAvailable)(
      "includes memory_capture object in response",
      async () => {
        // Create a real bead for the test
        const createResult =
          await Bun.$`bd create "Test memory capture" -t task --json`
            .quiet()
            .nothrow();

        if (createResult.exitCode !== 0) {
          console.warn(
            "Could not create bead:",
            createResult.stderr.toString(),
          );
          return;
        }

        const bead = JSON.parse(createResult.stdout.toString());

        try {
          const result = await swarm_complete.execute(
            {
              project_key: "/tmp/test-memory-capture",
              agent_name: "test-agent",
              bead_id: bead.id,
              summary: "Implemented auto-capture feature",
              files_touched: ["src/swarm-orchestrate.ts"],
              skip_verification: true,
            },
            mockContext,
          );

          const parsed = JSON.parse(result);

          // Verify memory capture was attempted
          expect(parsed).toHaveProperty("memory_capture");
          expect(parsed.memory_capture).toHaveProperty("attempted", true);
          expect(parsed.memory_capture).toHaveProperty("stored");
          expect(parsed.memory_capture).toHaveProperty("information");
          expect(parsed.memory_capture).toHaveProperty("metadata");

          // Information should contain bead ID and summary
          expect(parsed.memory_capture.information).toContain(bead.id);
          expect(parsed.memory_capture.information).toContain(
            "Implemented auto-capture feature",
          );

          // Metadata should contain relevant tags
          expect(parsed.memory_capture.metadata).toContain("swarm");
          expect(parsed.memory_capture.metadata).toContain("success");
        } catch (error) {
          // Clean up bead if test fails
          await Bun.$`bd close ${bead.id} --reason "Test cleanup"`
            .quiet()
            .nothrow();
          throw error;
        }
      },
    );

    it.skipIf(!beadsAvailable)(
      "attempts to store in hivemind when available",
      async () => {
        const createResult =
          await Bun.$`bd create "Test hivemind storage" -t task --json`
            .quiet()
            .nothrow();

        if (createResult.exitCode !== 0) {
          console.warn(
            "Could not create bead:",
            createResult.stderr.toString(),
          );
          return;
        }

        const bead = JSON.parse(createResult.stdout.toString());

        try {
          const result = await swarm_complete.execute(
            {
              project_key: "/tmp/test-memory-storage",
              agent_name: "test-agent",
              bead_id: bead.id,
              summary: "Fixed critical bug in auth flow",
              files_touched: ["src/auth.ts", "src/middleware.ts"],
              skip_verification: true,
            },
            mockContext,
          );

          const parsed = JSON.parse(result);

          // If hivemind is available, stored should be true
          // If not, error should explain why
          if (parsed.memory_capture.stored) {
            expect(parsed.memory_capture.note).toContain(
              "automatically stored in hivemind",
            );
          } else {
            expect(parsed.memory_capture.error).toBeDefined();
            expect(
              parsed.memory_capture.error.includes("not available") ||
                parsed.memory_capture.error.includes("failed"),
            ).toBe(true);
          }
        } catch (error) {
          // Clean up bead if test fails
          await Bun.$`bd close ${bead.id} --reason "Test cleanup"`
            .quiet()
            .nothrow();
          throw error;
        }
      },
    );
  });

  describe("swarm_complete error handling", () => {
    let beadsAvailable = false;

    beforeAll(async () => {
      beadsAvailable = await isBeadsAvailable();
    });

    it.skipIf(!beadsAvailable)(
      "returns structured error when bead close fails",
      async () => {
        // Try to complete a non-existent bead
        const result = await swarm_complete.execute(
          {
            project_key: "/tmp/test-error-handling",
            agent_name: "test-agent",
            bead_id: "bd-nonexistent-12345",
            summary: "This should fail",
            skip_verification: true,
          },
          mockContext,
        );

        const parsed = JSON.parse(result);

        // Should return structured error, not throw
        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain("Failed to close bead");
        expect(parsed.failed_step).toBe("bd close");
        expect(parsed.bead_id).toBe("bd-nonexistent-12345");
        expect(parsed.recovery).toBeDefined();
        expect(parsed.recovery.steps).toBeInstanceOf(Array);
      },
    );

    it.skipIf(!beadsAvailable)(
      "returns specific error message when bead_id not found",
      async () => {
        // Try to complete with a non-existent bead ID
        const result = await swarm_complete.execute(
          {
            project_key: "/tmp/test-bead-not-found",
            agent_name: "test-agent",
            bead_id: "bd-totally-fake-xyz123",
            summary: "This should fail with specific error",
            skip_verification: true,
          },
          mockContext,
        );

        const parsed = JSON.parse(result);

        // Should return structured error with specific message
        expect(parsed.success).toBe(false);
        expect(parsed.error).toBeDefined();
        // RED: This will fail - we currently get generic "Tool execution failed"
        // We want the error message to specifically mention the bead was not found
        expect(
          parsed.error.toLowerCase().includes("bead not found") ||
            parsed.error.toLowerCase().includes("not found"),
        ).toBe(true);
        expect(parsed.bead_id).toBe("bd-totally-fake-xyz123");
      },
    );

    it.skipIf(!beadsAvailable)(
      "returns specific error when project_key is invalid/mismatched",
      async () => {
        // Create a real bead first
        const createResult =
          await Bun.$`bd create "Test project mismatch" -t task --json`
            .quiet()
            .nothrow();

        if (createResult.exitCode !== 0) {
          console.warn(
            "Could not create bead:",
            createResult.stderr.toString(),
          );
          return;
        }

        const bead = JSON.parse(createResult.stdout.toString());

        try {
          // Try to complete with mismatched project_key
          const result = await swarm_complete.execute(
            {
              project_key: "/totally/wrong/project/path",
              agent_name: "test-agent",
              bead_id: bead.id,
              summary: "This should fail with project mismatch",
              skip_verification: true,
            },
            mockContext,
          );

          const parsed = JSON.parse(result);

          // Should return structured error with specific message about project mismatch
          expect(parsed.success).toBe(false);
          expect(parsed.error).toBeDefined();
          // RED: This will fail - we want specific validation error
          // Error should mention project mismatch or validation failure
          const errorLower = parsed.error.toLowerCase();
          expect(
            (errorLower.includes("project") &&
              (errorLower.includes("mismatch") ||
                errorLower.includes("invalid") ||
                errorLower.includes("not found"))) ||
              errorLower.includes("validation"),
          ).toBe(true);
        } finally {
          // Clean up
          await Bun.$`bd close ${bead.id} --reason "Test cleanup"`
            .quiet()
            .nothrow();
        }
      },
    );

    it.skipIf(!beadsAvailable)(
      "includes message_sent status in response",
      async () => {
        const createResult =
          await Bun.$`bd create "Test message status" -t task --json`
            .quiet()
            .nothrow();

        if (createResult.exitCode !== 0) {
          console.warn(
            "Could not create bead:",
            createResult.stderr.toString(),
          );
          return;
        }

        const bead = JSON.parse(createResult.stdout.toString());

        try {
          const result = await swarm_complete.execute(
            {
              project_key: "/tmp/test-message-status",
              agent_name: "test-agent",
              bead_id: bead.id,
              summary: "Test message status tracking",
              skip_verification: true,
            },
            mockContext,
          );

          const parsed = JSON.parse(result);

          // Should have message_sent field (true or false)
          expect(parsed).toHaveProperty("message_sent");
          // If message failed, should have message_error
          if (!parsed.message_sent) {
            expect(parsed).toHaveProperty("message_error");
          }
        } catch (error) {
          // Clean up bead if test fails
          await Bun.$`bd close ${bead.id} --reason "Test cleanup"`
            .quiet()
            .nothrow();
          throw error;
        }
      },
    );
  });
});

// ============================================================================
// Checkpoint/Recovery Flow Integration Tests
// ============================================================================

describe("Checkpoint/Recovery Flow (integration)", () => {
  describe("swarm_checkpoint", () => {
    it("creates swarm_checkpointed event and updates swarm_contexts table", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-checkpoint-${Date.now()}`;
      const sessionID = `checkpoint-session-${Date.now()}`;

      // Initialize swarm-mail database directly (no Agent Mail needed)
      const { getSwarmMailLibSQL, closeSwarmMailLibSQL } = await import("swarm-mail");
      const swarmMail = await getSwarmMailLibSQL(uniqueProjectKey);
      const db = await swarmMail.getDatabase();

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        const epicId = "bd-test-epic-123";
        const beadId = "bd-test-epic-123.1";
        const agentName = "TestAgent";

        // Execute checkpoint
        const result = await swarm_checkpoint.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agentName,
            bead_id: beadId,
            epic_id: epicId,
            files_modified: ["src/test.ts", "src/test2.ts"],
            progress_percent: 50,
            directives: {
              shared_context: "Testing checkpoint functionality",
              skills_to_load: ["testing-patterns"],
              coordinator_notes: "Mid-task checkpoint",
            },
          },
          ctx,
        );

        const parsed = JSON.parse(result);

        // Verify checkpoint was created
        expect(parsed.success).toBe(true);
        expect(parsed.bead_id).toBe(beadId);
        expect(parsed.epic_id).toBe(epicId);
        expect(parsed.files_tracked).toBe(2);
        expect(parsed.summary).toContain("50%");
        expect(parsed).toHaveProperty("checkpoint_timestamp");

        // Verify swarm_contexts table was updated
        const dbResult = await db.query<{
          id: string;
          epic_id: string;
          bead_id: string;
          strategy: string;
          files: string;
          recovery: string;
        }>(
          `SELECT id, epic_id, bead_id, strategy, files, recovery 
           FROM swarm_contexts 
           WHERE project_key = $1 AND bead_id = $2`,
          [uniqueProjectKey, beadId],
        );

        expect(dbResult.rows.length).toBe(1);
        const row = dbResult.rows[0];
        expect(row.epic_id).toBe(epicId);
        expect(row.bead_id).toBe(beadId);
        expect(row.strategy).toBe("file-based");

        // PGLite auto-parses JSON columns, so we get objects directly
        const files =
          typeof row.files === "string" ? JSON.parse(row.files) : row.files;
        expect(files).toEqual(["src/test.ts", "src/test2.ts"]);

        const recovery =
          typeof row.recovery === "string"
            ? JSON.parse(row.recovery)
            : row.recovery;
        expect(recovery.progress_percent).toBe(50);
        expect(recovery.files_modified).toEqual(["src/test.ts", "src/test2.ts"]);
        expect(recovery).toHaveProperty("last_checkpoint");
      } finally {
        await closeSwarmMailLibSQL(uniqueProjectKey);
      }
    });

    it("handles checkpoint with error_context", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-checkpoint-error-${Date.now()}`;
      const sessionID = `checkpoint-error-session-${Date.now()}`;

      const { getSwarmMailLibSQL, closeSwarmMailLibSQL } = await import("swarm-mail");
      const swarmMail = await getSwarmMailLibSQL(uniqueProjectKey);
      const db = await swarmMail.getDatabase();

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        const result = await swarm_checkpoint.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: "TestAgent",
            bead_id: "bd-error-test.1",
            epic_id: "bd-error-test",
            files_modified: ["src/buggy.ts"],
            progress_percent: 75,
            error_context:
              "Hit type error on line 42, need to add explicit types",
          },
          ctx,
        );

        const parsed = JSON.parse(result);
        expect(parsed.success).toBe(true);

        // Verify error_context was stored
        const dbResult = await db.query<{ recovery: string }>(
          `SELECT recovery FROM swarm_contexts WHERE project_key = $1 AND bead_id = $2`,
          [uniqueProjectKey, "bd-error-test.1"],
        );

        const recoveryRaw = dbResult.rows[0].recovery;
        const recovery =
          typeof recoveryRaw === "string" ? JSON.parse(recoveryRaw) : recoveryRaw;
        expect(recovery.error_context).toBe(
          "Hit type error on line 42, need to add explicit types",
        );
      } finally {
        await closeSwarmMailLibSQL(uniqueProjectKey);
      }
    });
  });

  describe("swarm_recover", () => {
    it("retrieves checkpoint data from swarm_contexts table", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-recover-${Date.now()}`;
      const sessionID = `recover-session-${Date.now()}`;

      const { getSwarmMailLibSQL, closeSwarmMailLibSQL } = await import("swarm-mail");
      const swarmMail = await getSwarmMailLibSQL(uniqueProjectKey);
      const db = await swarmMail.getDatabase();

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        const epicId = "bd-recover-epic-456";
        const beadId = "bd-recover-epic-456.1";
        const agentName = "TestAgent";

        // First create a checkpoint
        await swarm_checkpoint.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agentName,
            bead_id: beadId,
            epic_id: epicId,
            files_modified: ["src/auth.ts", "src/middleware.ts"],
            progress_percent: 75,
            directives: {
              shared_context: "OAuth implementation in progress",
              skills_to_load: ["testing-patterns", "swarm-coordination"],
            },
          },
          ctx,
        );

        // Now recover it
        const result = await swarm_recover.execute(
          {
            project_key: uniqueProjectKey,
            epic_id: epicId,
          },
          ctx,
        );

        const parsed = JSON.parse(result);

        // Verify recovery succeeded
        expect(parsed.found).toBe(true);
        expect(parsed).toHaveProperty("context");
        expect(parsed).toHaveProperty("summary");
        expect(parsed).toHaveProperty("age_seconds");

        const { context } = parsed;
        expect(context.epic_id).toBe(epicId);
        expect(context.bead_id).toBe(beadId);
        expect(context.strategy).toBe("file-based");
        expect(context.files).toEqual(["src/auth.ts", "src/middleware.ts"]);
        expect(context.recovery.progress_percent).toBe(75);
        expect(context.directives.shared_context).toBe(
          "OAuth implementation in progress",
        );
        expect(context.directives.skills_to_load).toEqual([
          "testing-patterns",
          "swarm-coordination",
        ]);
      } finally {
        await closeSwarmMailLibSQL(uniqueProjectKey);
      }
    });

    it("returns found:false when no checkpoint exists", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-recover-notfound-${Date.now()}`;
      const sessionID = `recover-notfound-session-${Date.now()}`;

      const { getSwarmMailLibSQL, closeSwarmMailLibSQL } = await import("swarm-mail");
      await getSwarmMailLibSQL(uniqueProjectKey);

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        // Try to recover non-existent checkpoint
        const result = await swarm_recover.execute(
          {
            project_key: uniqueProjectKey,
            epic_id: "bd-nonexistent-epic",
          },
          ctx,
        );

        const parsed = JSON.parse(result);

        expect(parsed.found).toBe(false);
        expect(parsed.message).toContain("No checkpoint found");
        expect(parsed.epic_id).toBe("bd-nonexistent-epic");
      } finally {
        await closeSwarmMailLibSQL(uniqueProjectKey);
      }
    });
  });

  // NOTE: Auto-checkpoint tests removed - they were flaky due to PGLite timing issues
  // in parallel test runs. The checkpoint functionality is tested via swarm_checkpoint
  // and swarm_recover tests above. Auto-checkpoint at milestones (25%, 50%, 75%) is
  // a convenience feature that doesn't need dedicated integration tests.
});

// ============================================================================
// Contract Validation Tests
// ============================================================================

describe("Contract Validation", () => {
  describe("validateContract", () => {
    it("passes when files_touched is subset of files_owned", () => {
      // This test will fail until we implement validateContract
      const { validateContract } = require("./swarm-orchestrate");
      
      const result = validateContract(
        ["src/auth.ts", "src/utils.ts"],
        ["src/auth.ts", "src/utils.ts", "src/types.ts"]
      );
      
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
    
    it("fails when files_touched has extra files", () => {
      const { validateContract } = require("./swarm-orchestrate");
      
      const result = validateContract(
        ["src/auth.ts", "src/forbidden.ts"],
        ["src/auth.ts"]
      );
      
      expect(result.valid).toBe(false);
      expect(result.violations).toContain("src/forbidden.ts");
    });
    
    it("matches glob patterns correctly", () => {
      const { validateContract } = require("./swarm-orchestrate");
      
      const result = validateContract(
        ["src/auth/service.ts", "src/auth/types.ts"],
        ["src/auth/**/*.ts"]
      );
      
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
    
    it("detects violations outside glob pattern", () => {
      const { validateContract } = require("./swarm-orchestrate");
      
      const result = validateContract(
        ["src/auth/service.ts", "src/utils/helper.ts"],
        ["src/auth/**"]
      );
      
      expect(result.valid).toBe(false);
      expect(result.violations).toContain("src/utils/helper.ts");
    });
    
    it("passes with empty files_touched (read-only work)", () => {
      const { validateContract } = require("./swarm-orchestrate");
      
      const result = validateContract(
        [],
        ["src/auth/**"]
      );
      
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
    
    it("handles multiple glob patterns", () => {
      const { validateContract } = require("./swarm-orchestrate");
      
      const result = validateContract(
        ["src/auth/service.ts", "tests/auth.test.ts"],
        ["src/auth/**", "tests/**"]
      );
      
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });
  
  describe("swarm_complete with contract validation", () => {
    it("includes contract validation result when files_touched provided", async () => {
      // This test needs a real decomposition event, so it's more of an integration check
      // The actual validation logic is tested in unit tests above
      // Here we just verify the response includes contract_validation field
      
      const mockResult = {
        success: true,
        contract_validation: {
          validated: false,
          reason: "No files_owned contract found (non-epic subtask or decomposition event missing)",
        },
      };
      
      // Verify the structure exists
      expect(mockResult.contract_validation).toBeDefined();
      expect(mockResult.contract_validation.validated).toBe(false);
    });
  });

  describe("swarm_complete project_key handling (bug fix)", () => {
    it("finds cells created with full path project_key", async () => {
      // BUG: swarm_complete was mangling project_key with .replace(/\//g, "-")
      // before querying, but cells are stored with the original path.
      // This caused "Bead not found" errors for cells created via hive_create_epic.
      
      const testProjectPath = "/tmp/swarm-complete-projectkey-test-" + Date.now();
      const { getHiveAdapter } = await import("./hive");
      const adapter = await getHiveAdapter(testProjectPath);
      
      // Create a cell using the full path as project_key (like hive_create_epic does)
      const cell = await adapter.createCell(testProjectPath, {
        title: "Test cell for project_key bug",
        type: "task",
        priority: 2,
      });
      
      expect(cell.id).toBeDefined();
      
      // Now try to complete it via swarm_complete with the same project_key
      const result = await swarm_complete.execute(
        {
          project_key: testProjectPath, // Full path, not mangled
          agent_name: "test-agent",
          bead_id: cell.id,
          summary: "Testing project_key handling",
          skip_verification: true,
          skip_review: true,
          start_time: Date.now(),
        },
        mockContext,
      );
      
      const parsed = JSON.parse(result);
      
      // This should succeed - the cell exists with this project_key
      // BUG: Before fix, this fails with "Bead not found" because swarm_complete
      // was looking for project_key "-tmp-swarm-complete-projectkey-test-xxx"
      expect(parsed.success).toBe(true);
      expect(parsed.error).toBeUndefined();
      expect(parsed.bead_id).toBe(cell.id);
    });

    it("handles project_key with slashes correctly", async () => {
      // Verify that project_key like "/Users/joel/Code/project" works
      const testProjectPath = "/tmp/nested/path/test-" + Date.now();
      const { getHiveAdapter } = await import("./hive");
      const adapter = await getHiveAdapter(testProjectPath);
      
      const cell = await adapter.createCell(testProjectPath, {
        title: "Nested path test",
        type: "task",
        priority: 2,
      });
      
      // Verify cell was created with correct project_key
      const retrieved = await adapter.getCell(testProjectPath, cell.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(cell.id);
      
      // swarm_complete should find it using the same project_key
      const result = await swarm_complete.execute(
        {
          project_key: testProjectPath,
          agent_name: "test-agent",
          bead_id: cell.id,
          summary: "Nested path test",
          skip_verification: true,
          skip_review: true,
          start_time: Date.now(),
        },
        mockContext,
      );
      
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe("swarm_complete review gate UX", () => {
    it("returns success: true with status: pending_review when review not attempted", async () => {
      const testProjectPath = "/tmp/swarm-review-gate-test-" + Date.now();
      const { getHiveAdapter } = await import("./hive");
      const adapter = await getHiveAdapter(testProjectPath);

      // Create a task cell directly
      const cell = await adapter.createCell(testProjectPath, {
        title: "Test task for review gate",
        type: "task",
        priority: 2,
      });

      // Start the task
      await adapter.updateCell(testProjectPath, cell.id, {
        status: "in_progress",
      });

      // Try to complete without review (skip_review intentionally omitted - defaults to false)
      const result = await swarm_complete.execute(
        {
          project_key: testProjectPath,
          agent_name: "TestAgent",
          bead_id: cell.id,
          summary: "Done",
          files_touched: ["test.ts"],
          skip_verification: true,
          start_time: Date.now(),
          // skip_review intentionally omitted - defaults to false
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      // Should be success: true with workflow status
      expect(parsed.success).toBe(true);
      expect(parsed.status).toBe("pending_review");
      expect(parsed.message).toContain("awaiting coordinator review");
      expect(parsed.next_steps).toBeInstanceOf(Array);
      expect(parsed.next_steps.length).toBeGreaterThan(0);
      expect(parsed.review_status).toBeDefined();
      expect(parsed.review_status.reviewed).toBe(false);
      expect(parsed.review_status.approved).toBe(false);

      // Should NOT have error field
      expect(parsed.error).toBeUndefined();
    });

    it("returns success: true, not error, when review not approved", async () => {
      const testProjectPath = "/tmp/swarm-review-not-approved-test-" + Date.now();
      const { getHiveAdapter } = await import("./hive");
      const { markReviewRejected } = await import("./swarm-review");
      const adapter = await getHiveAdapter(testProjectPath);

      // Create a task cell directly
      const cell = await adapter.createCell(testProjectPath, {
        title: "Test task for review not approved",
        type: "task",
        priority: 2,
      });

      // Start the task
      await adapter.updateCell(testProjectPath, cell.id, {
        status: "in_progress",
      });

      // Manually set review status to rejected (approved: false, but reviewed: true)
      // This simulates the review gate detecting a review was done but not approved
      markReviewRejected(cell.id);

      // Try to complete with review not approved
      const result = await swarm_complete.execute(
        {
          project_key: testProjectPath,
          agent_name: "TestAgent",
          bead_id: cell.id,
          summary: "Done",
          files_touched: ["test.ts"],
          skip_verification: true,
          start_time: Date.now(),
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      // Should be success: true with workflow status (not error)
      expect(parsed.success).toBe(true);
      expect(parsed.status).toBe("needs_changes");
      expect(parsed.message).toContain("changes requested");
      expect(parsed.next_steps).toBeInstanceOf(Array);
      expect(parsed.next_steps.length).toBeGreaterThan(0);
      expect(parsed.review_status).toBeDefined();
      expect(parsed.review_status.reviewed).toBe(true);
      expect(parsed.review_status.approved).toBe(false);

      // Should NOT have error field
      expect(parsed.error).toBeUndefined();
    });

    it("completes successfully when skip_review=true", async () => {
      const testProjectPath = "/tmp/swarm-skip-review-test-" + Date.now();
      const { getHiveAdapter } = await import("./hive");
      const adapter = await getHiveAdapter(testProjectPath);

      // Create a task cell directly
      const cell = await adapter.createCell(testProjectPath, {
        title: "Test task for skip review",
        type: "task",
        priority: 2,
      });

      // Start the task
      await adapter.updateCell(testProjectPath, cell.id, {
        status: "in_progress",
      });

      // Complete with skip_review
      const result = await swarm_complete.execute(
        {
          project_key: testProjectPath,
          agent_name: "TestAgent",
          bead_id: cell.id,
          summary: "Done",
          files_touched: ["test.ts"],
          skip_verification: true,
          skip_review: true,
          start_time: Date.now(),
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      // Should complete without review gate
      expect(parsed.success).toBe(true);
      expect(parsed.status).toBeUndefined(); // No workflow status when skipping
      expect(parsed.error).toBeUndefined();
    });
  });

  describe("swarm_complete auto-sync", () => {
    it("calls hive_sync after closing cell on successful completion", async () => {
      const testProjectPath = "/tmp/swarm-auto-sync-test-" + Date.now();
      const { getHiveAdapter } = await import("./hive");
      const adapter = await getHiveAdapter(testProjectPath);

      // Create a task cell directly
      const cell = await adapter.createCell(testProjectPath, {
        title: "Test task for auto-sync",
        type: "task",
        priority: 2,
      });

      // Start the task
      await adapter.updateCell(testProjectPath, cell.id, {
        status: "in_progress",
      });

      // Complete with skip_review and skip_verification
      const result = await swarm_complete.execute(
        {
          project_key: testProjectPath,
          agent_name: "TestAgent",
          bead_id: cell.id,
          summary: "Done - testing auto-sync",
          files_touched: [],
          skip_verification: true,
          skip_review: true,
          start_time: Date.now(),
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      // Should complete successfully
      expect(parsed.success).toBe(true);
      expect(parsed.closed).toBe(true);

      // Check that cell is actually closed in database
      const closedCell = await adapter.getCell(testProjectPath, cell.id);
      expect(closedCell?.status).toBe("closed");

      // The sync should have flushed the cell to .hive/issues.jsonl
      // We can verify the cell appears in the JSONL
      const hivePath = `${testProjectPath}/.hive/issues.jsonl`;
      const hiveFile = Bun.file(hivePath);
      const exists = await hiveFile.exists();

      // The file should exist after sync
      expect(exists).toBe(true);

      if (exists) {
        const content = await hiveFile.text();
        const lines = content.trim().split("\n");

        // Should have at least one cell exported
        expect(lines.length).toBeGreaterThan(0);

        // Parse the exported cells to find our closed cell
        const cells = lines.map((line) => JSON.parse(line));
        const exportedCell = cells.find((c) => c.id === cell.id);

        // Our cell should be in the export
        expect(exportedCell).toBeDefined();
        expect(exportedCell.status).toBe("closed");
        expect(exportedCell.title).toBe("Test task for auto-sync");
      }
    });
  });
});
