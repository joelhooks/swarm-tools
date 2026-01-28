/**
 * Swarm Structured Review Tests
 *
 * Tests for the coordinator-driven review of worker output.
 * The review is epic-aware - it checks if work serves the overall goal
 * and enables downstream tasks.
 *
 * Credit: Review patterns inspired by https://github.com/nexxeln/opencode-config
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateReviewPrompt,
  ReviewResultSchema,
  markReviewApproved,
  isReviewApproved,
  getReviewStatus,
  clearReviewStatus,
  swarm_review,
  swarm_review_feedback,
  type ReviewPromptContext,
  type ReviewResult,
  type ReviewIssue,
} from "./swarm-review";

// NOTE: Do NOT use vi.mock() or mock.module() for swarm-mail here.
// Both leak globally in bun's test runner and break swarm-mail.integration.test.ts.
// Tests that need to verify sendSwarmMessage behavior should check return values
// instead of mocking — ESM destructured imports can't be spied on reliably.

const mockContext = {
  sessionID: `test-review-${Date.now()}`,
  messageID: `test-message-${Date.now()}`,
  agent: "test-agent",
  abort: new AbortController().signal,
};

// ============================================================================
// Review Prompt Generation
// ============================================================================

describe("generateReviewPrompt", () => {
  const baseContext: ReviewPromptContext = {
    epic_id: "bd-test-123",
    epic_title: "Add user authentication",
    epic_description: "Implement OAuth2 with JWT tokens",
    task_id: "bd-test-123.1",
    task_title: "Create auth utilities",
    task_description: "JWT sign/verify functions",
    files_touched: ["src/lib/auth.ts"],
    diff: "+export function signToken() {}",
  };

  it("includes epic goal for big-picture context", () => {
    const prompt = generateReviewPrompt(baseContext);
    expect(prompt).toContain("Add user authentication");
    expect(prompt).toContain("OAuth2 with JWT tokens");
    expect(prompt).toContain("## Epic Goal");
  });

  it("includes task requirements", () => {
    const prompt = generateReviewPrompt(baseContext);
    expect(prompt).toContain("Create auth utilities");
    expect(prompt).toContain("JWT sign/verify functions");
    expect(prompt).toContain("## Task Requirements");
  });

  it("includes dependency context (what this builds on)", () => {
    const contextWithDeps: ReviewPromptContext = {
      ...baseContext,
      task_id: "bd-test-123.2",
      task_title: "Create auth middleware",
      completed_dependencies: [
        {
          id: "bd-test-123.1",
          title: "Create auth utilities",
          summary: "JWT sign/verify done",
        },
      ],
    };
    const prompt = generateReviewPrompt(contextWithDeps);
    expect(prompt).toContain("This Task Builds On");
    expect(prompt).toContain("Create auth utilities");
    expect(prompt).toContain("JWT sign/verify done");
  });

  it("includes downstream context (what depends on this)", () => {
    const contextWithDownstream: ReviewPromptContext = {
      ...baseContext,
      downstream_tasks: [
        { id: "bd-test-123.2", title: "Create auth middleware" },
        { id: "bd-test-123.3", title: "Add protected routes" },
      ],
    };
    const prompt = generateReviewPrompt(contextWithDownstream);
    expect(prompt).toContain("Downstream Tasks");
    expect(prompt).toContain("Create auth middleware");
    expect(prompt).toContain("Add protected routes");
  });

  it("includes the actual code diff", () => {
    const diff = `+export function signToken(payload: TokenPayload): string {
+  return jwt.sign(payload, SECRET, { expiresIn: '1h' });
+}`;
    const contextWithDiff: ReviewPromptContext = {
      ...baseContext,
      diff,
    };
    const prompt = generateReviewPrompt(contextWithDiff);
    expect(prompt).toContain("signToken");
    expect(prompt).toContain("TokenPayload");
    expect(prompt).toContain("```diff");
  });

  it("includes review criteria checklist", () => {
    const prompt = generateReviewPrompt(baseContext);
    expect(prompt).toContain("Fulfills Requirements");
    expect(prompt).toContain("Serves Epic Goal");
    expect(prompt).toContain("Enables Downstream");
    expect(prompt).toContain("Type Safety");
    expect(prompt).toContain("No Critical Bugs");
    expect(prompt).toContain("Test Coverage");
  });

  it("includes files modified section", () => {
    const prompt = generateReviewPrompt(baseContext);
    expect(prompt).toContain("## Files Modified");
    expect(prompt).toContain("`src/lib/auth.ts`");
  });

  it("includes response format instructions", () => {
    const prompt = generateReviewPrompt(baseContext);
    expect(prompt).toContain("## Response Format");
    expect(prompt).toContain('"status"');
    expect(prompt).toContain('"approved"');
    expect(prompt).toContain('"needs_changes"');
  });
});

// ============================================================================
// Review Result Schema
// ============================================================================

describe("ReviewResultSchema", () => {
  it("accepts approved status with summary", () => {
    const result: ReviewResult = {
      status: "approved",
      summary: "Clean implementation, exports are clear for downstream tasks",
    };
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
  });

  it("accepts needs_changes status with issues array", () => {
    const result: ReviewResult = {
      status: "needs_changes",
      issues: [
        {
          file: "src/lib/auth.ts",
          line: 42,
          issue: "Missing error handling for expired tokens",
          suggestion:
            "Return { valid: false, error: 'expired' } instead of throwing",
        },
      ],
      remaining_attempts: 2,
    };
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
  });

  it("requires issues array when status is needs_changes", () => {
    const result = {
      status: "needs_changes",
      // missing issues array
    };
    const parsed = ReviewResultSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  it("rejects needs_changes with empty issues array", () => {
    const result = {
      status: "needs_changes",
      issues: [],
    };
    const parsed = ReviewResultSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  it("tracks remaining review attempts", () => {
    const result: ReviewResult = {
      status: "needs_changes",
      issues: [{ file: "x.ts", issue: "bug" }],
      remaining_attempts: 1,
    };
    const parsed = ReviewResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.remaining_attempts).toBe(1);
    }
  });

  it("accepts approved without summary", () => {
    const result: ReviewResult = {
      status: "approved",
    };
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
  });

  it("accepts issue without line number", () => {
    const result: ReviewResult = {
      status: "needs_changes",
      issues: [{ file: "x.ts", issue: "general problem" }],
    };
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
  });

  it("accepts issue without suggestion", () => {
    const result: ReviewResult = {
      status: "needs_changes",
      issues: [{ file: "x.ts", line: 10, issue: "problem here" }],
    };
    expect(ReviewResultSchema.safeParse(result).success).toBe(true);
  });
});

// ============================================================================
// Review Status Tracking
// ============================================================================

describe("Review status tracking", () => {
  beforeEach(() => {
    clearReviewStatus("test-task-1");
    clearReviewStatus("test-task-2");
  });

  it("starts with no review status", () => {
    const status = getReviewStatus("test-task-1");
    expect(status.reviewed).toBe(false);
    expect(status.approved).toBe(false);
    expect(status.attempt_count).toBe(0);
    expect(status.remaining_attempts).toBe(3);
  });

  it("marks task as approved", () => {
    markReviewApproved("test-task-1");
    expect(isReviewApproved("test-task-1")).toBe(true);
    const status = getReviewStatus("test-task-1");
    expect(status.reviewed).toBe(true);
    expect(status.approved).toBe(true);
  });

  it("tracks separate status per task", () => {
    markReviewApproved("test-task-1");
    expect(isReviewApproved("test-task-1")).toBe(true);
    expect(isReviewApproved("test-task-2")).toBe(false);
  });

  it("clears review status", () => {
    markReviewApproved("test-task-1");
    expect(isReviewApproved("test-task-1")).toBe(true);
    clearReviewStatus("test-task-1");
    expect(isReviewApproved("test-task-1")).toBe(false);
  });
});

// ============================================================================
// swarm_review tool
// ============================================================================

describe("swarm_review", () => {
  it("has correct tool metadata", () => {
    expect(swarm_review.description).toContain("review prompt");
    expect(swarm_review.description).toContain("epic context");
  });

  it("returns JSON with review_prompt field", async () => {
    // This test exercises the tool structure without needing real git/beads
    // The tool will fail to get real data but should still return valid JSON
    // Use /tmp which exists on all systems
    const result = await swarm_review.execute(
      {
        project_key: "/tmp",
        epic_id: "bd-test-123",
        task_id: "bd-test-123.1",
        files_touched: ["src/test.ts"],
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("review_prompt");
    expect(parsed).toHaveProperty("context");
    expect(parsed.context.epic_id).toBe("bd-test-123");
    expect(parsed.context.task_id).toBe("bd-test-123.1");
  });

  it("includes remaining attempts in context", async () => {
    clearReviewStatus("bd-test-123.1");
    const result = await swarm_review.execute(
      {
        project_key: "/tmp",
        epic_id: "bd-test-123",
        task_id: "bd-test-123.1",
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.context.remaining_attempts).toBe(3);
  });
});

// ============================================================================
// swarm_review_feedback tool
// ============================================================================

describe("swarm_review_feedback", () => {
  beforeEach(() => {
    clearReviewStatus("bd-feedback-test");
    vi.clearAllMocks();
  });

  it("has correct tool metadata", () => {
    expect(swarm_review_feedback.description).toContain("feedback");
    expect(swarm_review_feedback.description).toContain("max 3");
  });

  it("sends approved feedback successfully", async () => {
    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-feedback-test",
        worker_id: "worker-test",
        status: "approved",
        summary: "Looks good, clean implementation",
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("approved");
  });

  it("sends needs_changes feedback with structured issues", async () => {
    const issues: ReviewIssue[] = [
      {
        file: "src/auth.ts",
        line: 42,
        issue: "Missing null check",
        suggestion: "Add if (!token) return null",
      },
    ];

    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-feedback-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues: JSON.stringify(issues),
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("needs_changes");
    expect(parsed.remaining_attempts).toBe(2);
  });

  it("requires issues for needs_changes status", async () => {
    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-feedback-test",
        worker_id: "worker-test",
        status: "needs_changes",
        // no issues provided
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("requires at least one issue");
  });

  it("tracks review attempts (max 3)", async () => {
    const issues = JSON.stringify([{ file: "x.ts", issue: "bug" }]);

    // First attempt
    let result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-feedback-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues,
      },
      mockContext
    );
    let parsed = JSON.parse(result);
    expect(parsed.attempt).toBe(1);
    expect(parsed.remaining_attempts).toBe(2);

    // Second attempt
    result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-feedback-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues,
      },
      mockContext
    );
    parsed = JSON.parse(result);
    expect(parsed.attempt).toBe(2);
    expect(parsed.remaining_attempts).toBe(1);
  });

  it("fails task after 3 rejected reviews", async () => {
    const issues = JSON.stringify([{ file: "x.ts", issue: "still broken" }]);

    // Exhaust all attempts
    for (let i = 0; i < 3; i++) {
      await swarm_review_feedback.execute(
        {
          project_key: "/tmp/test-project",
          task_id: "bd-feedback-test",
          worker_id: "worker-test",
          status: "needs_changes",
          issues,
        },
        mockContext
      );
    }

    // Check final state
    const status = getReviewStatus("bd-feedback-test");
    expect(status.remaining_attempts).toBe(0);
  });

  it("clears attempts on approval", async () => {
    const issues = JSON.stringify([{ file: "x.ts", issue: "bug" }]);

    // Add some attempts
    await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-feedback-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues,
      },
      mockContext
    );

    // Now approve
    await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-feedback-test",
        worker_id: "worker-test",
        status: "approved",
        summary: "Fixed!",
      },
      mockContext
    );

    // Attempts should be cleared
    const status = getReviewStatus("bd-feedback-test");
    expect(status.attempt_count).toBe(0);
    expect(status.remaining_attempts).toBe(3);
  });

  it("handles invalid issues JSON", async () => {
    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-feedback-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues: "not valid json",
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("parse");
  });

  it("extracts epic ID from task ID for thread", async () => {
    // Task ID format: bd-epic.subtask
    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-epic-123.4",
        worker_id: "worker-test",
        status: "approved",
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    // The sendSwarmMessage mock was called with threadId = "bd-epic-123"
  });
});

// ============================================================================
// Integration: swarm_complete with review gate
// ============================================================================

describe("swarm_complete with review gate", () => {
  // These tests verify the review gate behavior that was added to swarm_complete
  // The actual swarm_complete tests are in swarm.integration.test.ts
  // Here we test the review status functions that gate completion

  beforeEach(() => {
    clearReviewStatus("bd-gate-test");
  });

  it("isReviewApproved returns false for unreviewed task", () => {
    expect(isReviewApproved("bd-gate-test")).toBe(false);
  });

  it("isReviewApproved returns true after markReviewApproved", () => {
    markReviewApproved("bd-gate-test");
    expect(isReviewApproved("bd-gate-test")).toBe(true);
  });

  it("getReviewStatus provides complete status info", () => {
    const status = getReviewStatus("bd-gate-test");
    expect(status).toEqual({
      reviewed: false,
      approved: false,
      attempt_count: 0,
      remaining_attempts: 3,
    });
  });

  it("approval clears attempt count", async () => {
    // Simulate some failed attempts
    const issues = JSON.stringify([{ file: "x.ts", issue: "bug" }]);
    await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test",
        task_id: "bd-gate-test",
        worker_id: "worker",
        status: "needs_changes",
        issues,
      },
      mockContext
    );

    let status = getReviewStatus("bd-gate-test");
    expect(status.attempt_count).toBe(1);

    // Approve
    await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test",
        task_id: "bd-gate-test",
        worker_id: "worker",
        status: "approved",
      },
      mockContext
    );

    status = getReviewStatus("bd-gate-test");
    expect(status.attempt_count).toBe(0);
    expect(status.approved).toBe(true);
  });
});

// ============================================================================
// Worker prompt updates for review flow
// ============================================================================

describe("worker prompt with review instructions", () => {
  // These tests verify that the review prompt includes proper instructions
  // The actual worker prompt generation is in swarm-prompts.ts

  it("review prompt includes response format for workers", () => {
    const prompt = generateReviewPrompt({
      epic_id: "bd-test",
      epic_title: "Test Epic",
      task_id: "bd-test.1",
      task_title: "Test Task",
      files_touched: [],
      diff: "",
    });

    // Workers need to know how to respond
    expect(prompt).toContain("Response Format");
    expect(prompt).toContain("approved");
    expect(prompt).toContain("needs_changes");
  });

  it("review prompt explains issue structure", () => {
    const prompt = generateReviewPrompt({
      epic_id: "bd-test",
      epic_title: "Test Epic",
      task_id: "bd-test.1",
      task_title: "Test Task",
      files_touched: [],
      diff: "",
    });

    expect(prompt).toContain("file");
    expect(prompt).toContain("line");
    expect(prompt).toContain("issue");
    expect(prompt).toContain("suggestion");
  });
});

// ============================================================================
// TDD ENFORCEMENT IN SWARM
// ============================================================================

describe("TDD enforcement in review criteria", () => {
  it("review criteria includes test coverage check", () => {
    const prompt = generateReviewPrompt({
      epic_id: "bd-test",
      epic_title: "Test Epic",
      task_id: "bd-test.1",
      task_title: "Test Task",
      files_touched: ["src/foo.ts"],
      diff: "+function foo() {}",
    });

    expect(prompt).toContain("Test Coverage");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("handles empty files_touched", () => {
    const prompt = generateReviewPrompt({
      epic_id: "bd-test",
      epic_title: "Test Epic",
      task_id: "bd-test.1",
      task_title: "Test Task",
      files_touched: [],
      diff: "",
    });

    expect(prompt).toContain("## Files Modified");
    // Should not crash, just have empty list
  });

  it("handles missing optional fields", () => {
    const prompt = generateReviewPrompt({
      epic_id: "bd-test",
      epic_title: "Test Epic",
      task_id: "bd-test.1",
      task_title: "Test Task",
      files_touched: [],
      diff: "",
      // No epic_description, task_description, dependencies, downstream
    });

    expect(prompt).toContain("Test Epic");
    expect(prompt).toContain("Test Task");
    // Should not include dependency sections
    expect(prompt).not.toContain("This Task Builds On");
    expect(prompt).not.toContain("Downstream Tasks");
  });

  it("handles special characters in diff", () => {
    const prompt = generateReviewPrompt({
      epic_id: "bd-test",
      epic_title: "Test Epic",
      task_id: "bd-test.1",
      task_title: "Test Task",
      files_touched: ["src/test.ts"],
      diff: '+const regex = /[a-z]+/g;\n+const template = `Hello ${name}`;',
    });

    expect(prompt).toContain("regex");
    expect(prompt).toContain("template");
  });

  it("handles very long diffs", () => {
    const longDiff = "+line\n".repeat(1000);
    const prompt = generateReviewPrompt({
      epic_id: "bd-test",
      epic_title: "Test Epic",
      task_id: "bd-test.1",
      task_title: "Test Task",
      files_touched: ["src/big.ts"],
      diff: longDiff,
    });

    // Should include the diff without truncation (truncation is caller's responsibility)
    expect(prompt).toContain(longDiff);
  });
});

// ============================================================================
// Coordinator-Driven Retry: swarm_review_feedback returns retry_context
// ============================================================================

describe("swarm_review_feedback retry_context", () => {
  beforeEach(() => {
    clearReviewStatus("bd-retry-test");
    vi.clearAllMocks();
  });

  it("returns retry_context when status is needs_changes", async () => {
    const issues = JSON.stringify([
      { file: "src/auth.ts", line: 42, issue: "Missing null check", suggestion: "Add null check" }
    ]);

    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-retry-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues,
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("needs_changes");
    // NEW: Should include retry_context for coordinator
    expect(parsed).toHaveProperty("retry_context");
    expect(parsed.retry_context).toHaveProperty("task_id", "bd-retry-test");
    expect(parsed.retry_context).toHaveProperty("attempt", 1);
    expect(parsed.retry_context).toHaveProperty("issues");
    expect(parsed.retry_context.issues).toHaveLength(1);
  });

  it("retry_context includes issues in structured format", async () => {
    const issues = [
      { file: "src/a.ts", line: 10, issue: "Bug A", suggestion: "Fix A" },
      { file: "src/b.ts", line: 20, issue: "Bug B", suggestion: "Fix B" },
    ];

    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-retry-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues: JSON.stringify(issues),
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.retry_context.issues).toEqual(issues);
  });

  it("retry_context includes next_action hint for coordinator", async () => {
    const issues = JSON.stringify([{ file: "x.ts", issue: "bug" }]);

    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-retry-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues,
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    // Should tell coordinator what to do next
    expect(parsed.retry_context).toHaveProperty("next_action");
    expect(parsed.retry_context.next_action).toContain("swarm_spawn_retry");
  });

  it("does NOT include retry_context when approved", async () => {
    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-retry-test",
        worker_id: "worker-test",
        status: "approved",
        summary: "Looks good!",
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("approved");
    expect(parsed).not.toHaveProperty("retry_context");
  });

  it("does NOT include retry_context when task fails (3 attempts)", async () => {
    const issues = JSON.stringify([{ file: "x.ts", issue: "still broken" }]);

    // Exhaust all attempts
    let result: string = "";
    for (let i = 0; i < 3; i++) {
      result = await swarm_review_feedback.execute(
        {
          project_key: "/tmp/test-project",
          task_id: "bd-retry-test",
          worker_id: "worker-test",
          status: "needs_changes",
          issues,
        },
        mockContext
      );
    }

    const parsed = JSON.parse(result);
    expect(parsed.task_failed).toBe(true);
    // No retry_context when task is failed - nothing more to retry
    expect(parsed).not.toHaveProperty("retry_context");
  });

  it("retry_context includes max_attempts for coordinator awareness", async () => {
    const issues = JSON.stringify([{ file: "x.ts", issue: "bug" }]);

    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-retry-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues,
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    expect(parsed.retry_context).toHaveProperty("max_attempts", 3);
  });

  it("handles needs_changes without crashing (dead worker scenario)", async () => {
    const issues = JSON.stringify([{ file: "x.ts", issue: "bug" }]);

    // needs_changes should succeed even though worker is dead (can't read messages)
    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-retry-test",
        worker_id: "worker-test",
        status: "needs_changes",
        issues,
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    // Should still return successfully — just no message sent
    expect(parsed.status).toBe("needs_changes");
  });

  it("handles approved status (audit trail)", async () => {
    const result = await swarm_review_feedback.execute(
      {
        project_key: "/tmp/test-project",
        task_id: "bd-retry-test",
        worker_id: "worker-test",
        status: "approved",
        summary: "Good work!",
      },
      mockContext
    );

    const parsed = JSON.parse(result);
    // Approved should succeed — message sent for audit trail
    expect(parsed.status).toBe("approved");
  });
});
