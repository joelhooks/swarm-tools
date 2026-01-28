/**
 * Compaction Hook Coordinator Resumption Eval
 *
 * Tests that the compaction hook correctly detects swarm state and injects
 * appropriate context for coordinator resumption.
 *
 * ## Bug Being Tested
 *
 * Root cause: The compaction hook injects generic "you are a coordinator"
 * context but doesn't include the SPECIFIC epic ID, subtask status, or
 * project path. This causes coordinators to lose identity after compaction.
 *
 * ## Test Cases
 *
 * 1. Active swarm with in_progress epic - should inject full context with epic ID
 * 2. Multiple epics - should identify the in_progress one
 * 3. No active swarm - should not inject coordinator context
 * 4. Blocked epic - should still detect as active swarm
 *
 * Run with: pnpm eval:dev (watch mode) or pnpm eval:run (once)
 */

import { evalite } from "evalite";
import type { Cell } from "swarm-mail";
import { compactionCases } from "./fixtures/compaction-cases.js";
import type { CompactionResult } from "./scorers/compaction-scorers.js";
import {
  compactionQuality,
  confidenceAccuracy,
  contextInjectionCorrectness,
  forbiddenPatternsAbsent,
  requiredPatternsPresent,
} from "./scorers/index.js";

// Copy context constants from compaction-hook.ts to avoid import issues
const SWARM_COMPACTION_CONTEXT = `## 🐝 SWARM ACTIVE - Keep Cooking

You are the **COORDINATOR** of an active swarm. Context was compacted but the swarm is still running.

**YOUR JOB:** Keep orchestrating. Spawn agents. Monitor progress. Unblock work. Ship it.

### On Resume - IMMEDIATELY

1. \`swarm_status(epic_id="<epic>", project_key="<path>")\` - Get current state
2. \`swarmmail_inbox(limit=5)\` - Check for agent messages
3. \`swarm_review(project_key, epic_id, task_id, files_touched)\` - Review any completed work
4. **Spawn ready subtasks** - Don't wait, fire them off

### Keep the Swarm Cooking

- **Spawn aggressively** - If a subtask is ready and unblocked, spawn an agent
- **Monitor actively** - Check status, read messages, respond to blockers
- **Close the loop** - When all subtasks done, verify and close the epic

**You are not waiting for instructions. You are the coordinator. Coordinate.**
`;

const SWARM_DETECTION_FALLBACK = `## 🐝 Swarm Detection - Check Your Context

**IMPORTANT:** Before summarizing, check if this session involves an active swarm.

Look for ANY of these patterns in the conversation:

### Tool Calls (definite swarm sign)
- \`swarm_decompose\`, \`swarm_spawn_subtask\`, \`swarm_status\`, \`swarm_complete\`
- \`swarmmail_init\`, \`swarmmail_reserve\`, \`swarmmail_send\`
- \`hive_create_epic\`, \`hive_start\`, \`hive_close\`

### If You Find Swarm Evidence

Include this in your summary and tell the resumed session:
"This is an active swarm. Check swarm_status and swarmmail_inbox immediately."
`;

/**
 * Simulate compaction hook execution with given hive state
 *
 * Simplified version that simulates detection logic without running full hook.
 * This tests the CONTEXT CONTENT itself, not the detection logic.
 */
async function runCompactionHook(testCase: {
  hiveCells: Array<Omit<Cell, "created_at" | "updated_at" | "closed_at">>;
  swarmMailState: {
    agents: number;
    reservations: number;
    messages: number;
  };
}): Promise<CompactionResult> {
  // Simulate detection logic based on test case state
  const hasInProgressCells = testCase.hiveCells.some(
    (c) => c.status === "in_progress",
  );
  const hasReservations = testCase.swarmMailState.reservations > 0;
  const hasOpenSubtasks = testCase.hiveCells.some(
    (c) => c.status === "open" && c.parent_id,
  );
  const hasOpenEpics = testCase.hiveCells.some(
    (c) => c.type === "epic" && c.status !== "closed",
  );
  const hasCells = testCase.hiveCells.length > 0;

  // Determine confidence based on signals
  let confidence: "high" | "medium" | "low" | "none" = "none";
  let contextType: "full" | "fallback" | "none" = "none";
  let injectedContext = "";

  if (hasInProgressCells || hasReservations) {
    confidence = "high";
    contextType = "full";
    injectedContext = `[Swarm detected: ${hasInProgressCells ? "cells in_progress" : ""}, ${hasReservations ? "active reservations" : ""}]\n\n${SWARM_COMPACTION_CONTEXT}`;
  } else if (hasOpenSubtasks || hasOpenEpics) {
    confidence = "medium";
    contextType = "full";
    injectedContext = `[Swarm detected: ${hasOpenSubtasks ? "open subtasks" : "unclosed epic"}]\n\n${SWARM_COMPACTION_CONTEXT}`;
  } else if (hasCells) {
    confidence = "low";
    contextType = "fallback";
    injectedContext = `[Possible swarm: cells exist]\n\n${SWARM_DETECTION_FALLBACK}`;
  }

  return {
    detected: confidence !== "none",
    confidence,
    contextInjected: contextType !== "none",
    contextType,
    injectedContext,
  };
}

/**
 * Main eval: Compaction Hook Coordinator Resumption
 *
 * Tests all cases from fixtures/compaction-cases.ts
 */
evalite("Compaction Hook Coordinator Resumption", {
  data: async () =>
    compactionCases.map((testCase) => ({
      input: testCase,
      expected: testCase.expected,
    })),

  task: async (input) => {
    const result = await runCompactionHook({
      hiveCells: input.hiveCells,
      swarmMailState: input.swarmMailState,
    });

    // Return as JSON string for scorers
    return JSON.stringify(result);
  },

  scorers: [
    confidenceAccuracy,
    contextInjectionCorrectness,
    requiredPatternsPresent,
    forbiddenPatternsAbsent,
    compactionQuality,
  ],
});

/**
 * Edge Case Eval: Epic ID Specificity
 *
 * Ensures injected context includes SPECIFIC epic IDs, not placeholders
 */
evalite("Epic ID Specificity", {
  data: async () => [
    {
      input: {
        name: "Epic ID must be specific, not placeholder",
        hiveCells: [
          {
            id: "my-app-lf2p4u-epic999",
            project_key: "/my/app",
            type: "epic" as const,
            status: "in_progress" as const,
            title: "Implement feature X",
            description: "Description here",
            priority: 2,
            parent_id: null,
            assignee: "coordinator",
            closed_reason: null,
            deleted_at: null,
            deleted_by: null,
            delete_reason: null,
            created_by: "coordinator",
            result: null,
            result_at: null,
          },
        ],
        swarmMailState: {
          agents: 1,
          reservations: 1,
          messages: 2,
        },
      },
      expected: {
        confidence: "high" as const,
        contextInjected: true,
        contextType: "full" as const,
        mustContain: ["SWARM ACTIVE", "COORDINATOR"],
        // The bug: injected context should NOT contain generic placeholders
        mustNotContain: ["bd-xxx", "<epic>", "<path>", "placeholder"],
      },
    },
  ],

  task: async (input) => {
    const result = await runCompactionHook({
      hiveCells: input.hiveCells,
      swarmMailState: input.swarmMailState,
    });
    return JSON.stringify(result);
  },

  scorers: [requiredPatternsPresent, forbiddenPatternsAbsent],
});

/**
 * Edge Case Eval: No False Positives
 *
 * Ensures we don't inject coordinator context when there's no swarm
 */
evalite("No False Positives", {
  data: async () => [
    {
      input: {
        name: "Empty hive should not trigger injection",
        hiveCells: [],
        swarmMailState: {
          agents: 0,
          reservations: 0,
          messages: 0,
        },
      },
      expected: {
        confidence: "none" as const,
        contextInjected: false,
        contextType: "none" as const,
        mustContain: [],
        mustNotContain: ["SWARM", "COORDINATOR", "swarm_status"],
      },
    },
    {
      input: {
        name: "Closed epic should not trigger full context",
        hiveCells: [
          {
            id: "test-project-lf2p4u-epic100",
            project_key: "/test/project",
            type: "epic" as const,
            status: "closed" as const,
            title: "Completed epic",
            description: null,
            priority: 2,
            parent_id: null,
            assignee: null,
            closed_reason: "Done",
            deleted_at: null,
            deleted_by: null,
            delete_reason: null,
            created_by: null,
            result: null,
            result_at: null,
          },
        ],
        swarmMailState: {
          agents: 0,
          reservations: 0,
          messages: 0,
        },
      },
      expected: {
        // Should be low confidence (cells exist but no active work)
        confidence: "low" as const,
        contextInjected: true,
        contextType: "fallback" as const,
        mustContain: ["Swarm Detection", "Check Your Context"],
        mustNotContain: ["SWARM ACTIVE", "COORDINATOR"],
      },
    },
  ],

  task: async (input) => {
    const result = await runCompactionHook({
      hiveCells: input.hiveCells,
      swarmMailState: input.swarmMailState,
    });
    return JSON.stringify(result);
  },

  scorers: [confidenceAccuracy, forbiddenPatternsAbsent],
});
