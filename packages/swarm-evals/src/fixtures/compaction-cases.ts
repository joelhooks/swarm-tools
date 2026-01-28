/**
 * Test cases for compaction hook coordinator resumption
 *
 * Each case simulates a different swarm state and verifies that
 * the compaction hook injects the correct context for resumption.
 */

import type { Cell } from "swarm-mail";

/**
 * Compaction test case structure
 */
export interface CompactionTestCase {
  name: string;
  description: string;
  /**
   * Simulated hive state (cells to create)
   */
  hiveCells: Array<Omit<Cell, "created_at" | "updated_at" | "closed_at">>;
  /**
   * Simulated swarm-mail state
   */
  swarmMailState: {
    agents: number;
    reservations: number;
    messages: number;
  };
  /**
   * Expected detection confidence
   */
  expected: {
    confidence: "high" | "medium" | "low" | "none";
    contextInjected: boolean;
    contextType: "full" | "fallback" | "none";
    /**
     * Patterns that MUST appear in injected context (if injected)
     */
    mustContain?: string[];
    /**
     * Patterns that MUST NOT appear
     */
    mustNotContain?: string[];
  };
}

export const compactionCases: CompactionTestCase[] = [
  // ============================================================================
  // HIGH CONFIDENCE: Active swarm with in_progress epic
  // ============================================================================
  {
    name: "Active swarm with in_progress epic",
    description:
      "Compaction happens mid-swarm with an active epic and subtasks. Should inject full context with specific epic ID.",
    hiveCells: [
      {
        id: "test-project-lf2p4u-epic123",
        project_key: "/test/project",
        type: "epic",
        status: "in_progress",
        title: "Add user authentication",
        description: "Implement OAuth with NextAuth.js",
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
      {
        id: "test-project-lf2p4u-epic123.1",
        project_key: "/test/project",
        type: "task",
        status: "closed",
        title: "OAuth provider config",
        description: "Configure GitHub OAuth provider",
        priority: 2,
        parent_id: "test-project-lf2p4u-epic123",
        assignee: "BlueLake",
        closed_reason: "Done: configured GitHub provider",
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
        created_by: "coordinator",
        result: null,
        result_at: null,
      },
      {
        id: "test-project-lf2p4u-epic123.2",
        project_key: "/test/project",
        type: "task",
        status: "in_progress",
        title: "Auth middleware",
        description: "Create middleware for protecting routes",
        priority: 2,
        parent_id: "test-project-lf2p4u-epic123",
        assignee: "RedMountain",
        closed_reason: null,
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
        created_by: "coordinator",
        result: null,
        result_at: null,
      },
      {
        id: "test-project-lf2p4u-epic123.3",
        project_key: "/test/project",
        type: "task",
        status: "open",
        title: "Session management",
        description: "Implement session persistence with Redis",
        priority: 2,
        parent_id: "test-project-lf2p4u-epic123",
        assignee: null,
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
      agents: 2,
      reservations: 1,
      messages: 5,
    },
    expected: {
      confidence: "high",
      contextInjected: true,
      contextType: "full",
      mustContain: [
        "SWARM ACTIVE",
        "COORDINATOR",
        "swarm_status",
        "swarmmail_inbox",
        "Keep Cooking",
      ],
      mustNotContain: [
        "bd-xxx", // Should NOT contain placeholder IDs
        "Check Your Context", // Should NOT be fallback detection
      ],
    },
  },

  // ============================================================================
  // MEDIUM CONFIDENCE: Multiple epics, need to identify active one
  // ============================================================================
  {
    name: "Multiple epics with one in_progress",
    description:
      "Multiple epics exist, but only one is in_progress. Should detect and inject context for the active one.",
    hiveCells: [
      {
        id: "test-project-lf2p4u-epic100",
        project_key: "/test/project",
        type: "epic",
        status: "closed",
        title: "Refactor auth system",
        description: "Old completed epic",
        priority: 2,
        parent_id: null,
        assignee: null,
        closed_reason: "Done",
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
        created_by: "coordinator",
        result: null,
        result_at: null,
      },
      {
        id: "test-project-lf2p4u-epic200",
        project_key: "/test/project",
        type: "epic",
        status: "in_progress",
        title: "Add rate limiting",
        description: "Implement Redis-based rate limiting",
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
      {
        id: "test-project-lf2p4u-epic200.1",
        project_key: "/test/project",
        type: "task",
        status: "open",
        title: "Rate limit middleware",
        description: "Create Express middleware",
        priority: 2,
        parent_id: "test-project-lf2p4u-epic200",
        assignee: null,
        closed_reason: null,
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
        created_by: "coordinator",
        result: null,
        result_at: null,
      },
      {
        id: "test-project-lf2p4u-epic300",
        project_key: "/test/project",
        type: "epic",
        status: "open",
        title: "Future epic",
        description: "Not started yet",
        priority: 1,
        parent_id: null,
        assignee: null,
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
      reservations: 0,
      messages: 2,
    },
    expected: {
      confidence: "medium",
      contextInjected: true,
      contextType: "full",
      mustContain: ["SWARM ACTIVE", "COORDINATOR"],
      mustNotContain: ["bd-xxx"],
    },
  },

  // ============================================================================
  // LOW CONFIDENCE: Cells exist but no active work
  // ============================================================================
  {
    name: "Cells exist but no active swarm",
    description:
      "Hive has some cells but no in_progress work. Should inject fallback detection prompt.",
    hiveCells: [
      {
        id: "test-project-lf2p4u-task001",
        project_key: "/test/project",
        type: "task",
        status: "open",
        title: "Fix typo in README",
        description: null,
        priority: 0,
        parent_id: null,
        assignee: null,
        closed_reason: null,
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
    expected: {
      confidence: "low",
      contextInjected: true,
      contextType: "fallback",
      mustContain: [
        "Swarm Detection",
        "Check Your Context",
        "swarm_decompose",
        "swarmmail_init",
      ],
      mustNotContain: ["SWARM ACTIVE", "COORDINATOR"],
    },
  },

  // ============================================================================
  // NONE: Empty hive, no swarm activity
  // ============================================================================
  {
    name: "Empty hive - no swarm activity",
    description:
      "No cells, no swarm-mail activity. Should NOT inject any context.",
    hiveCells: [],
    swarmMailState: {
      agents: 0,
      reservations: 0,
      messages: 0,
    },
    expected: {
      confidence: "none",
      contextInjected: false,
      contextType: "none",
      mustContain: [],
      mustNotContain: ["SWARM", "COORDINATOR", "swarm_status"],
    },
  },

  // ============================================================================
  // EDGE CASE: Blocked epic (should still detect as active swarm)
  // ============================================================================
  {
    name: "Blocked epic with subtasks",
    description:
      "Epic is blocked but has in_progress subtasks. Should detect as active swarm.",
    hiveCells: [
      {
        id: "test-project-lf2p4u-epic400",
        project_key: "/test/project",
        type: "epic",
        status: "blocked",
        title: "Migration to TypeScript",
        description: "Full codebase migration",
        priority: 3,
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
      {
        id: "test-project-lf2p4u-epic400.1",
        project_key: "/test/project",
        type: "task",
        status: "in_progress",
        title: "Migrate utils",
        description: "Convert utils to TypeScript",
        priority: 2,
        parent_id: "test-project-lf2p4u-epic400",
        assignee: "GreenValley",
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
      messages: 3,
    },
    expected: {
      confidence: "high",
      contextInjected: true,
      contextType: "full",
      mustContain: ["SWARM ACTIVE", "COORDINATOR"],
      mustNotContain: ["bd-xxx"],
    },
  },
];
