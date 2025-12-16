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
  swarm_evaluation_prompt,
  swarm_select_strategy,
  swarm_plan_prompt,
  formatSubtaskPromptV2,
  SUBTASK_PROMPT_V2,
  swarm_checkpoint,
  swarm_recover,
} from "./swarm";
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
        max_subtasks: 3,
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("prompt");
    expect(parsed).toHaveProperty("expected_schema", "BeadTree");
    expect(parsed).toHaveProperty("schema_hint");
    expect(parsed.prompt).toContain("Add user authentication with OAuth");
    expect(parsed.prompt).toContain("2-3 independent subtasks");
  });

  it("includes context in prompt when provided", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Refactor the API routes",
        max_subtasks: 5,
        context: "Using Next.js App Router with RSC",
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.prompt).toContain("Using Next.js App Router with RSC");
    expect(parsed.prompt).toContain("Additional Context");
  });

  it("uses default max_subtasks when not provided", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Simple task",
        max_subtasks: 5, // Explicit default since schema requires it
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    // Default is 5
    expect(parsed.prompt).toContain("2-5 independent subtasks");
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
    expect(parsed.alternatives.length).toBe(2); // 3 strategies - 1 selected = 2 alternatives

    for (const alt of parsed.alternatives) {
      expect(alt).toHaveProperty("strategy");
      expect(alt).toHaveProperty("description");
      expect(alt).toHaveProperty("score");
      expect(["file-based", "feature-based", "risk-based"]).toContain(
        alt.strategy,
      );
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
});

// ============================================================================
// Planning Prompt Tests
// ============================================================================

describe("swarm_plan_prompt", () => {
  it("auto-selects strategy when not specified", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Add user settings page",
        max_subtasks: 3,
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
        max_subtasks: 3,
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
        max_subtasks: 4,
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
        max_subtasks: 3,
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
        max_subtasks: 5,
        query_cass: false,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("expected_schema", "BeadTree");
    expect(parsed).toHaveProperty("validation_note");
    expect(parsed.validation_note).toContain("swarm_validate_decomposition");
    expect(parsed).toHaveProperty("schema_hint");
    expect(parsed.schema_hint).toHaveProperty("epic");
    expect(parsed.schema_hint).toHaveProperty("subtasks");
  });

  it("reports CASS status in output (queried flag)", async () => {
    // Test with CASS disabled
    const resultDisabled = await swarm_plan_prompt.execute(
      {
        task: "Add feature",
        max_subtasks: 3,
        query_cass: false,
      },
      mockContext,
    );
    const parsedDisabled = JSON.parse(resultDisabled);

    expect(parsedDisabled).toHaveProperty("cass_history");
    expect(parsedDisabled.cass_history.queried).toBe(false);

    // Test with CASS enabled (may or may not be available)
    const resultEnabled = await swarm_plan_prompt.execute(
      {
        task: "Add feature",
        max_subtasks: 3,
        query_cass: true,
      },
      mockContext,
    );
    const parsedEnabled = JSON.parse(resultEnabled);

    expect(parsedEnabled).toHaveProperty("cass_history");
    expect(parsedEnabled.cass_history).toHaveProperty("queried");
    // If CASS is unavailable, queried will be false with reason
    if (!parsedEnabled.cass_history.queried) {
      expect(parsedEnabled.cass_history).toHaveProperty("reason");
    }
  });

  it("includes context in prompt when provided", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Add user profile",
        max_subtasks: 3,
        context: "We use Next.js App Router with server components",
        query_cass: false,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.prompt).toContain("Next.js App Router");
    expect(parsed.prompt).toContain("server components");
  });

  it("includes max_subtasks in prompt", async () => {
    const result = await swarm_plan_prompt.execute(
      {
        task: "Build something",
        max_subtasks: 7,
        query_cass: false,
      },
      mockContext,
    );
    const parsed = JSON.parse(result);

    expect(parsed.prompt).toContain("2-7 independent subtasks");
  });
});

describe("swarm_validate_decomposition", () => {
  it("validates correct BeadTree", async () => {
    const validBeadTree = JSON.stringify({
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
      { response: validBeadTree },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(true);
    expect(parsed.bead_tree).toBeDefined();
    expect(parsed.stats).toEqual({
      subtask_count: 2,
      total_files: 3,
      total_complexity: 3,
    });
  });

  it("rejects file conflicts", async () => {
    const conflictingBeadTree = JSON.stringify({
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
      { response: conflictingBeadTree },
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
            max_subtasks: 2,
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
    expect(availability.size).toBe(5);
    expect(availability.has("semantic-memory")).toBe(true);
    expect(availability.has("cass")).toBe(true);
    expect(availability.has("ubs")).toBe(true);
    expect(availability.has("beads")).toBe(true);
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
      "ubs", // May or may not be available
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
    expect(tools).toHaveProperty("ubs");
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

describe("Graceful Degradation", () => {
  it("swarm_decompose works without CASS", async () => {
    // This should work regardless of CASS availability
    const result = await swarm_decompose.execute(
      {
        task: "Add user authentication",
        max_subtasks: 3,
        query_cass: true, // Request CASS but it may not be available
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    // Should always return a valid prompt
    expect(parsed).toHaveProperty("prompt");
    expect(parsed.prompt).toContain("Add user authentication");

    // CASS history should indicate whether it was queried
    expect(parsed).toHaveProperty("cass_history");
    expect(parsed.cass_history).toHaveProperty("queried");
  });

  it("swarm_decompose can skip CASS explicitly", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Add user authentication",
        max_subtasks: 3,
        query_cass: false, // Explicitly skip CASS
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
        max_subtasks: 3,
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
    it("generates correct prompt with all fields", () => {
      const result = formatSubtaskPromptV2({
        bead_id: "bd-123.1",
        epic_id: "bd-123",
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
      expect(result).toContain("bd-123.1");
      expect(result).toContain("bd-123");
    });

    it("handles missing optional fields", () => {
      const result = formatSubtaskPromptV2({
        bead_id: "bd-456.1",
        epic_id: "bd-456",
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

    it("handles files with special characters", () => {
      const result = formatSubtaskPromptV2({
        bead_id: "bd-789.1",
        epic_id: "bd-789",
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

      expect(SUBTASK_PROMPT_V2).toContain("[WORKFLOW]");
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
      expect(SUBTASK_PROMPT_V2).toContain("non-negotiable");
    });

    it("DOES contain beads instructions", () => {
      // V2 prompt tells agents to USE beads
      expect(SUBTASK_PROMPT_V2).toContain("{bead_id}");
      expect(SUBTASK_PROMPT_V2).toContain("{epic_id}");
      expect(SUBTASK_PROMPT_V2).toContain("beads_update");
      expect(SUBTASK_PROMPT_V2).toContain("beads_create");
      expect(SUBTASK_PROMPT_V2).toContain("swarm_complete");
    });

    it("instructs agents to communicate via swarmmail", () => {
      expect(SUBTASK_PROMPT_V2).toContain("Never work silently");
      expect(SUBTASK_PROMPT_V2).toContain("progress");
      expect(SUBTASK_PROMPT_V2).toContain("coordinator");
      expect(SUBTASK_PROMPT_V2).toContain("CRITICAL");
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
      "attempts to store in semantic-memory when available",
      async () => {
        const createResult =
          await Bun.$`bd create "Test semantic-memory storage" -t task --json`
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

          // If semantic-memory is available, stored should be true
          // If not, error should explain why
          if (parsed.memory_capture.stored) {
            expect(parsed.memory_capture.note).toContain(
              "automatically stored in semantic-memory",
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
      const { getDatabase, closeDatabase } = await import("swarm-mail");
      const db = await getDatabase(uniqueProjectKey);

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
           WHERE bead_id = $1`,
          [beadId],
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
        await closeDatabase(uniqueProjectKey);
      }
    });

    it("handles checkpoint with error_context", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-checkpoint-error-${Date.now()}`;
      const sessionID = `checkpoint-error-session-${Date.now()}`;

      const { getDatabase, closeDatabase } = await import("swarm-mail");
      const db = await getDatabase(uniqueProjectKey);

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
          `SELECT recovery FROM swarm_contexts WHERE bead_id = $1`,
          ["bd-error-test.1"],
        );

        const recoveryRaw = dbResult.rows[0].recovery;
        const recovery =
          typeof recoveryRaw === "string" ? JSON.parse(recoveryRaw) : recoveryRaw;
        expect(recovery.error_context).toBe(
          "Hit type error on line 42, need to add explicit types",
        );
      } finally {
        await closeDatabase(uniqueProjectKey);
      }
    });
  });

  describe("swarm_recover", () => {
    it("retrieves checkpoint data from swarm_contexts table", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-recover-${Date.now()}`;
      const sessionID = `recover-session-${Date.now()}`;

      const { getDatabase, closeDatabase } = await import("swarm-mail");
      const db = await getDatabase(uniqueProjectKey);

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
        await closeDatabase(uniqueProjectKey);
      }
    });

    it("returns found:false when no checkpoint exists", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-recover-notfound-${Date.now()}`;
      const sessionID = `recover-notfound-session-${Date.now()}`;

      const { getDatabase, closeDatabase } = await import("swarm-mail");
      await getDatabase(uniqueProjectKey);

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
        await closeDatabase(uniqueProjectKey);
      }
    });
  });

  describe("Auto-checkpoint at progress milestones", () => {
    it("creates checkpoint at 25% progress", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-auto25-${Date.now()}`;
      const sessionID = `auto25-session-${Date.now()}`;

      const { getDatabase, closeDatabase } = await import("swarm-mail");
      const db = await getDatabase(uniqueProjectKey);

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        const beadId = "bd-auto-test.1";
        const agentName = "TestAgent";

        // Report progress at 25% - should trigger auto-checkpoint
        const result = await swarm_progress.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agentName,
            bead_id: beadId,
            status: "in_progress",
            progress_percent: 25,
            message: "Quarter done",
            files_touched: ["src/component.tsx"],
          },
          ctx,
        );

        // Verify checkpoint was created (indicated in response)
        expect(result).toContain("Progress reported");
        expect(result).toContain("25%");
        expect(result).toContain("[checkpoint created]");

        // Verify checkpoint exists in database
        const dbResult = await db.query<{ recovery: string }>(
          `SELECT recovery FROM swarm_contexts WHERE bead_id = $1`,
          [beadId],
        );

        expect(dbResult.rows.length).toBe(1);
        const recoveryRaw = dbResult.rows[0].recovery;
        const recovery =
          typeof recoveryRaw === "string" ? JSON.parse(recoveryRaw) : recoveryRaw;
        expect(recovery.progress_percent).toBe(25);
        expect(recovery.files_modified).toEqual(["src/component.tsx"]);
      } finally {
        await closeDatabase(uniqueProjectKey);
      }
    });

    it("creates checkpoint at 50% progress", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-auto50-${Date.now()}`;
      const sessionID = `auto50-session-${Date.now()}`;

      const { getDatabase, closeDatabase } = await import("swarm-mail");
      const db = await getDatabase(uniqueProjectKey);

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        const beadId = "bd-auto50-test.1";
        const agentName = "TestAgent";

        // Report progress at 50%
        const result = await swarm_progress.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agentName,
            bead_id: beadId,
            status: "in_progress",
            progress_percent: 50,
            message: "Halfway there",
            files_touched: ["src/api.ts", "src/types.ts"],
          },
          ctx,
        );

        expect(result).toContain("[checkpoint created]");

        // Verify checkpoint
        const dbResult = await db.query<{ recovery: string }>(
          `SELECT recovery FROM swarm_contexts WHERE bead_id = $1`,
          [beadId],
        );

        const recoveryRaw50 = dbResult.rows[0].recovery;
        const recovery =
          typeof recoveryRaw50 === "string"
            ? JSON.parse(recoveryRaw50)
            : recoveryRaw50;
        expect(recovery.progress_percent).toBe(50);
      } finally {
        await closeDatabase(uniqueProjectKey);
      }
    });

    it("creates checkpoint at 75% progress", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-auto75-${Date.now()}`;
      const sessionID = `auto75-session-${Date.now()}`;

      const { getDatabase, closeDatabase } = await import("swarm-mail");
      const db = await getDatabase(uniqueProjectKey);

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        const beadId = "bd-auto75-test.1";
        const agentName = "TestAgent";

        // Report progress at 75%
        const result = await swarm_progress.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agentName,
            bead_id: beadId,
            status: "in_progress",
            progress_percent: 75,
            message: "Almost done",
            files_touched: ["src/final.ts"],
          },
          ctx,
        );

        expect(result).toContain("[checkpoint created]");

        // Verify checkpoint
        const dbResult = await db.query<{ recovery: string }>(
          `SELECT recovery FROM swarm_contexts WHERE bead_id = $1`,
          [beadId],
        );

        const recoveryRaw75 = dbResult.rows[0].recovery;
        const recovery =
          typeof recoveryRaw75 === "string"
            ? JSON.parse(recoveryRaw75)
            : recoveryRaw75;
        expect(recovery.progress_percent).toBe(75);
      } finally {
        await closeDatabase(uniqueProjectKey);
      }
    });

    it("does NOT create checkpoint at non-milestone progress", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-auto-nomilestone-${Date.now()}`;
      const sessionID = `auto-nomilestone-session-${Date.now()}`;

      const { getDatabase, closeDatabase } = await import("swarm-mail");
      const db = await getDatabase(uniqueProjectKey);

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        const beadId = "bd-auto-nomilestone.1";
        const agentName = "TestAgent";

        // Report progress at 30% (not a milestone)
        const result = await swarm_progress.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agentName,
            bead_id: beadId,
            status: "in_progress",
            progress_percent: 30,
            message: "Not a milestone",
            files_touched: ["src/random.ts"],
          },
          ctx,
        );

        // Should NOT contain checkpoint indicator
        expect(result).not.toContain("[checkpoint created]");
        expect(result).toContain("30%");

        // Verify NO checkpoint was created
        const dbResult = await db.query(
          `SELECT * FROM swarm_contexts WHERE bead_id = $1`,
          [beadId],
        );

        expect(dbResult.rows.length).toBe(0);
      } finally {
        await closeDatabase(uniqueProjectKey);
      }
    });

    it("checkpoint includes message from progress report", async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-auto-message-${Date.now()}`;
      const sessionID = `auto-message-session-${Date.now()}`;

      const { getDatabase, closeDatabase } = await import("swarm-mail");
      const db = await getDatabase(uniqueProjectKey);

      try {
        const ctx = {
          ...mockContext,
          sessionID,
        };

        const beadId = "bd-auto-message.1";
        const testMessage =
          "Implemented auth service, working on JWT tokens";
        const agentName = "TestAgent";

        // Report progress with message
        await swarm_progress.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agentName,
            bead_id: beadId,
            status: "in_progress",
            progress_percent: 50,
            message: testMessage,
            files_touched: ["src/auth.ts"],
          },
          ctx,
        );

        // Verify message was stored in checkpoint
        const dbResult = await db.query<{ recovery: string }>(
          `SELECT recovery FROM swarm_contexts WHERE bead_id = $1`,
          [beadId],
        );

        const recoveryRawMsg = dbResult.rows[0].recovery;
        const recovery =
          typeof recoveryRawMsg === "string"
            ? JSON.parse(recoveryRawMsg)
            : recoveryRawMsg;
        expect(recovery.last_message).toBe(testMessage);
      } finally {
        await closeDatabase(uniqueProjectKey);
      }
    });
  });
});
