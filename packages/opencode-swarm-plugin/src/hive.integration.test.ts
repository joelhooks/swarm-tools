/**
 * Hive Integration Tests
 *
 * These tests exercise the HiveAdapter-based tools directly.
 * They validate the tool wrappers work correctly with actual hive operations.
 *
 * Run with: bun test src/hive.integration.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  hive_create,
  hive_create_epic,
  hive_query,
  hive_update,
  hive_close,
  hive_start,
  hive_ready,
  hive_link_thread,
  HiveError,
  getHiveAdapter,
  setHiveWorkingDirectory,
  // Legacy aliases for backward compatibility tests
  hive_create,
  hive_create_epic,
  hive_query,
  hive_update,
  hive_close,
  hive_start,
  hive_ready,
  beads_link_thread,
  BeadError,
  getBeadsAdapter,
  setBeadsWorkingDirectory,
} from "./hive";
import type { Cell, Bead, EpicCreateResult } from "./schemas";
import type { HiveAdapter } from "swarm-mail";

/**
 * Mock tool context for execute functions
 * The real context is provided by OpenCode runtime
 */
const mockContext = {
  sessionID: "test-session-" + Date.now(),
  messageID: "test-message-" + Date.now(),
  agent: "test-agent",
  abort: new AbortController().signal,
};

/**
 * Helper to parse JSON response from tool execute
 */
function parseResponse<T>(response: string): T {
  return JSON.parse(response) as T;
}

/**
 * Track created beads for cleanup
 */
const createdBeadIds: string[] = [];

/**
 * Test project key - use temp directory to isolate tests
 */
const TEST_PROJECT_KEY = `/tmp/beads-integration-test-${Date.now()}`;

/**
 * Adapter instance for verification
 */
let adapter: HiveAdapter;

/**
 * Cleanup helper - close all created beads after tests
 */
async function cleanupBeads() {
  for (const id of createdBeadIds) {
    try {
      await hive_close.execute({ id, reason: "Test cleanup" }, mockContext);
    } catch {
      // Ignore cleanup errors - bead may already be closed
    }
  }
  createdBeadIds.length = 0;
}

describe("beads integration", () => {
  // Initialize adapter before running tests
  beforeAll(async () => {
    // Set working directory for beads commands
    setBeadsWorkingDirectory(TEST_PROJECT_KEY);
    
    // Get adapter instance for verification
    adapter = await getBeadsAdapter(TEST_PROJECT_KEY);
  });

  afterAll(async () => {
    await cleanupBeads();
  });

  describe("hive_create", () => {
    it("creates a bead with minimal args (title only)", async () => {
      const result = await hive_create.execute(
        { title: "Test bead minimal" },
        mockContext,
      );

      const bead = parseResponse<Bead>(result);
      createdBeadIds.push(bead.id);

      expect(bead.title).toBe("Test bead minimal");
      expect(bead.status).toBe("open");
      expect(bead.issue_type).toBe("task"); // default
      expect(bead.priority).toBe(2); // default
      expect(bead.id).toMatch(/^[a-z0-9-]+-[a-z0-9]+$/);
    });

    it("creates a bead with all options", async () => {
      const result = await hive_create.execute(
        {
          title: "Test bug with priority",
          type: "bug",
          priority: 0, // P0 critical
          description: "This is a critical bug",
        },
        mockContext,
      );

      const bead = parseResponse<Bead>(result);
      createdBeadIds.push(bead.id);

      expect(bead.title).toBe("Test bug with priority");
      expect(bead.issue_type).toBe("bug");
      expect(bead.priority).toBe(0);
      expect(bead.description).toContain("critical bug");
    });

    it("creates a feature type bead", async () => {
      const result = await hive_create.execute(
        { title: "New feature request", type: "feature", priority: 1 },
        mockContext,
      );

      const bead = parseResponse<Bead>(result);
      createdBeadIds.push(bead.id);

      expect(bead.issue_type).toBe("feature");
      expect(bead.priority).toBe(1);
    });

    it("creates a chore type bead", async () => {
      const result = await hive_create.execute(
        { title: "Cleanup task", type: "chore", priority: 3 },
        mockContext,
      );

      const bead = parseResponse<Bead>(result);
      createdBeadIds.push(bead.id);

      expect(bead.issue_type).toBe("chore");
      expect(bead.priority).toBe(3);
    });
  });

  describe("hive_query", () => {
    let testBeadId: string;

    beforeEach(async () => {
      // Create a test bead for query tests
      const result = await hive_create.execute(
        { title: "Query test bead", type: "task" },
        mockContext,
      );
      const bead = parseResponse<Bead>(result);
      testBeadId = bead.id;
      createdBeadIds.push(testBeadId);
    });

    it("queries all open beads", async () => {
      const result = await hive_query.execute({ status: "open" }, mockContext);

      const beads = parseResponse<Bead[]>(result);

      expect(Array.isArray(beads)).toBe(true);
      expect(beads.length).toBeGreaterThan(0);
      expect(beads.every((b) => b.status === "open")).toBe(true);
    });

    it("queries beads by type", async () => {
      const result = await hive_query.execute({ type: "task" }, mockContext);

      const beads = parseResponse<Bead[]>(result);

      expect(Array.isArray(beads)).toBe(true);
      expect(beads.every((b) => b.issue_type === "task")).toBe(true);
    });

    it("queries ready beads (unblocked)", async () => {
      const result = await hive_query.execute({ ready: true }, mockContext);

      const beads = parseResponse<Bead[]>(result);

      expect(Array.isArray(beads)).toBe(true);
      // Ready beads should be open (not closed, not blocked)
      for (const bead of beads) {
        expect(["open", "in_progress"]).toContain(bead.status);
      }
    });

    it("limits results", async () => {
      // Create multiple beads first
      for (let i = 0; i < 5; i++) {
        const result = await hive_create.execute(
          { title: `Limit test bead ${i}` },
          mockContext,
        );
        const bead = parseResponse<Bead>(result);
        createdBeadIds.push(bead.id);
      }

      const result = await hive_query.execute({ limit: 3 }, mockContext);

      const beads = parseResponse<Bead[]>(result);
      expect(beads.length).toBeLessThanOrEqual(3);
    });

    it("combines filters", async () => {
      const result = await hive_query.execute(
        { status: "open", type: "task", limit: 5 },
        mockContext,
      );

      const beads = parseResponse<Bead[]>(result);

      expect(Array.isArray(beads)).toBe(true);
      expect(beads.length).toBeLessThanOrEqual(5);
      for (const bead of beads) {
        expect(bead.status).toBe("open");
        expect(bead.issue_type).toBe("task");
      }
    });
  });

  describe("hive_update", () => {
    let testBeadId: string;

    beforeEach(async () => {
      const result = await hive_create.execute(
        { title: "Update test bead", description: "Original description" },
        mockContext,
      );
      const bead = parseResponse<Bead>(result);
      testBeadId = bead.id;
      createdBeadIds.push(testBeadId);
    });

    it("updates bead status", async () => {
      const result = await hive_update.execute(
        { id: testBeadId, status: "in_progress" },
        mockContext,
      );

      const bead = parseResponse<Bead>(result);
      expect(bead.status).toBe("in_progress");
    });

    it("updates bead description", async () => {
      const result = await hive_update.execute(
        { id: testBeadId, description: "Updated description" },
        mockContext,
      );

      const bead = parseResponse<Bead>(result);
      expect(bead.description).toContain("Updated description");
    });

    it("updates bead priority", async () => {
      const result = await hive_update.execute(
        { id: testBeadId, priority: 0 },
        mockContext,
      );

      const bead = parseResponse<Bead>(result);
      expect(bead.priority).toBe(0);
    });

    it("updates multiple fields at once", async () => {
      const result = await hive_update.execute(
        {
          id: testBeadId,
          status: "blocked",
          description: "Blocked on dependency",
          priority: 1,
        },
        mockContext,
      );

      const bead = parseResponse<Bead>(result);
      expect(bead.status).toBe("blocked");
      expect(bead.description).toContain("Blocked on dependency");
      expect(bead.priority).toBe(1);
    });

    it("throws BeadError for invalid bead ID", async () => {
      await expect(
        hive_update.execute(
          { id: "nonexistent-bead-xyz", status: "closed" },
          mockContext,
        ),
      ).rejects.toThrow(BeadError);
    });
  });

  describe("hive_close", () => {
    it("closes a bead with reason", async () => {
      // Create a fresh bead to close
      const createResult = await hive_create.execute(
        { title: "Bead to close" },
        mockContext,
      );
      const created = parseResponse<Bead>(createResult);
      // Don't add to cleanup since we're closing it

      const result = await hive_close.execute(
        { id: created.id, reason: "Task completed successfully" },
        mockContext,
      );

      expect(result).toContain("Closed");
      expect(result).toContain(created.id);

      // Verify it's actually closed using adapter
      const closedBead = await adapter.getCell(TEST_PROJECT_KEY, created.id);
      expect(closedBead).toBeDefined();
      expect(closedBead!.status).toBe("closed");
    });

    it("throws BeadError for invalid bead ID", async () => {
      await expect(
        hive_close.execute(
          { id: "nonexistent-bead-xyz", reason: "Test" },
          mockContext,
        ),
      ).rejects.toThrow(BeadError);
    });
  });

  describe("hive_start", () => {
    it("marks a bead as in_progress", async () => {
      // Create a fresh bead
      const createResult = await hive_create.execute(
        { title: "Bead to start" },
        mockContext,
      );
      const created = parseResponse<Bead>(createResult);
      createdBeadIds.push(created.id);

      expect(created.status).toBe("open");

      const result = await hive_start.execute({ id: created.id }, mockContext);

      expect(result).toContain("Started");
      expect(result).toContain(created.id);

      // Verify status changed using adapter
      const startedBead = await adapter.getCell(TEST_PROJECT_KEY, created.id);
      expect(startedBead).toBeDefined();
      expect(startedBead!.status).toBe("in_progress");
    });

    it("throws BeadError for invalid bead ID", async () => {
      await expect(
        hive_start.execute({ id: "nonexistent-bead-xyz" }, mockContext),
      ).rejects.toThrow(BeadError);
    });
  });

  describe("hive_ready", () => {
    it("returns the highest priority unblocked bead", async () => {
      // Create a high priority bead
      const createResult = await hive_create.execute(
        { title: "High priority ready bead", priority: 0 },
        mockContext,
      );
      const created = parseResponse<Bead>(createResult);
      createdBeadIds.push(created.id);

      const result = await hive_ready.execute({}, mockContext);

      // Should return a bead (or "No ready beads" message)
      if (result !== "No ready beads") {
        const bead = parseResponse<Bead>(result);
        expect(bead.id).toBeDefined();
        expect(bead.status).not.toBe("closed");
        expect(bead.status).not.toBe("blocked");
      }
    });

    it("returns no ready beads message when all are closed", async () => {
      // This test depends on the state of the beads database
      // It may return a bead if there are open ones
      const result = await hive_ready.execute({}, mockContext);

      expect(typeof result).toBe("string");
      // Either a JSON bead or "No ready beads"
      if (result === "No ready beads") {
        expect(result).toBe("No ready beads");
      } else {
        const bead = parseResponse<Bead>(result);
        expect(bead.id).toBeDefined();
      }
    });
  });

  describe("hive_create_epic", () => {
    it("creates an epic with subtasks", async () => {
      const result = await hive_create_epic.execute(
        {
          epic_title: "Integration test epic",
          epic_description: "Testing epic creation",
          subtasks: [
            { title: "Subtask 1", priority: 2 },
            { title: "Subtask 2", priority: 3 },
            { title: "Subtask 3", priority: 1 },
          ],
        },
        mockContext,
      );

      const epicResult = parseResponse<EpicCreateResult>(result);
      createdBeadIds.push(epicResult.epic.id);
      for (const subtask of epicResult.subtasks) {
        createdBeadIds.push(subtask.id);
      }

      expect(epicResult.success).toBe(true);
      expect(epicResult.epic.title).toBe("Integration test epic");
      expect(epicResult.epic.issue_type).toBe("epic");
      expect(epicResult.subtasks).toHaveLength(3);

      // Subtasks should have parent_id pointing to epic
      // Verify via adapter since parent_id may not be in the output schema
      for (const subtask of epicResult.subtasks) {
        const subtaskBead = await adapter.getCell(TEST_PROJECT_KEY, subtask.id);
        expect(subtaskBead).toBeDefined();
        expect(subtaskBead!.parent_id).toBe(epicResult.epic.id);
      }
    });

    it("creates an epic with files metadata in subtasks", async () => {
      const result = await hive_create_epic.execute(
        {
          epic_title: "Epic with file references",
          subtasks: [
            { title: "Edit src/a.ts", priority: 2, files: ["src/a.ts"] },
            {
              title: "Edit src/b.ts",
              priority: 2,
              files: ["src/b.ts", "src/c.ts"],
            },
          ],
        },
        mockContext,
      );

      const epicResult = parseResponse<EpicCreateResult>(result);
      createdBeadIds.push(epicResult.epic.id);
      for (const subtask of epicResult.subtasks) {
        createdBeadIds.push(subtask.id);
      }

      expect(epicResult.success).toBe(true);
      expect(epicResult.subtasks).toHaveLength(2);
    });

    it("creates epic with single subtask", async () => {
      const result = await hive_create_epic.execute(
        {
          epic_title: "Single subtask epic",
          subtasks: [{ title: "Only task", priority: 1 }],
        },
        mockContext,
      );

      const epicResult = parseResponse<EpicCreateResult>(result);
      createdBeadIds.push(epicResult.epic.id);
      createdBeadIds.push(epicResult.subtasks[0].id);

      expect(epicResult.success).toBe(true);
      expect(epicResult.subtasks).toHaveLength(1);
    });

    it("preserves subtask order", async () => {
      const titles = ["First", "Second", "Third", "Fourth"];
      const result = await hive_create_epic.execute(
        {
          epic_title: "Ordered subtasks epic",
          subtasks: titles.map((title, i) => ({ title, priority: 2 })),
        },
        mockContext,
      );

      const epicResult = parseResponse<EpicCreateResult>(result);
      createdBeadIds.push(epicResult.epic.id);
      for (const subtask of epicResult.subtasks) {
        createdBeadIds.push(subtask.id);
      }

      expect(epicResult.success).toBe(true);
      // Subtasks should be in creation order
      for (let i = 0; i < titles.length; i++) {
        expect(epicResult.subtasks[i].title).toBe(titles[i]);
      }
    });
  });

  describe("beads_link_thread", () => {
    let testBeadId: string;

    beforeEach(async () => {
      const result = await hive_create.execute(
        { title: "Thread link test bead" },
        mockContext,
      );
      const bead = parseResponse<Bead>(result);
      testBeadId = bead.id;
      createdBeadIds.push(testBeadId);
    });

    it("links a bead to an Agent Mail thread", async () => {
      const threadId = "test-thread-123";
      const result = await beads_link_thread.execute(
        { cell_id: testBeadId, thread_id: threadId },
        mockContext,
      );

      expect(result).toContain("Linked");
      expect(result).toContain(testBeadId);
      expect(result).toContain(threadId);

      // Verify the thread marker is in the description using adapter
      const linkedBead = await adapter.getCell(TEST_PROJECT_KEY, testBeadId);
      expect(linkedBead).toBeDefined();
      expect(linkedBead!.description).toContain(`[thread:${threadId}]`);
    });

    it("returns message if thread already linked", async () => {
      const threadId = "test-thread-456";

      // Link once
      await beads_link_thread.execute(
        { cell_id: testBeadId, thread_id: threadId },
        mockContext,
      );

      // Try to link again
      const result = await beads_link_thread.execute(
        { cell_id: testBeadId, thread_id: threadId },
        mockContext,
      );

      expect(result).toContain("already linked");
    });

    it("preserves existing description when linking", async () => {
      // Update bead with a description first
      await hive_update.execute(
        { id: testBeadId, description: "Important context here" },
        mockContext,
      );

      const threadId = "test-thread-789";
      await beads_link_thread.execute(
        { cell_id: testBeadId, thread_id: threadId },
        mockContext,
      );

      // Verify both original description and thread marker exist using adapter
      const linkedBead = await adapter.getCell(TEST_PROJECT_KEY, testBeadId);
      expect(linkedBead).toBeDefined();
      expect(linkedBead!.description).toContain("Important context here");
      expect(linkedBead!.description).toContain(`[thread:${threadId}]`);
    });

    it("throws BeadError for invalid bead ID", async () => {
      await expect(
        beads_link_thread.execute(
          { cell_id: "nonexistent-bead-xyz", thread_id: "thread-123" },
          mockContext,
        ),
      ).rejects.toThrow(BeadError);
    });
  });

  describe("error handling", () => {
    it("throws BeadError with command info on adapter failure", async () => {
      try {
        await hive_update.execute(
          { id: "definitely-not-a-real-bead-id", status: "closed" },
          mockContext,
        );
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(BeadError);
        const beadError = error as InstanceType<typeof BeadError>;
        expect(beadError.command).toBeDefined();
      }
    });
  });

  describe("workflow integration", () => {
    it("complete bead lifecycle: create -> start -> update -> close", async () => {
      // 1. Create
      const createResult = await hive_create.execute(
        { title: "Lifecycle test bead", type: "task", priority: 2 },
        mockContext,
      );
      const bead = parseResponse<Bead>(createResult);
      expect(bead.status).toBe("open");

      // 2. Start (in_progress)
      const startResult = await hive_start.execute(
        { id: bead.id },
        mockContext,
      );
      expect(startResult).toContain("Started");

      // 3. Update (add progress note)
      const updateResult = await hive_update.execute(
        { id: bead.id, description: "50% complete" },
        mockContext,
      );
      const updated = parseResponse<Bead>(updateResult);
      expect(updated.description).toContain("50%");

      // 4. Close
      const closeResult = await hive_close.execute(
        { id: bead.id, reason: "Completed successfully" },
        mockContext,
      );
      expect(closeResult).toContain("Closed");

      // Verify final state using adapter
      const finalBead = await adapter.getCell(TEST_PROJECT_KEY, bead.id);
      expect(finalBead).toBeDefined();
      expect(finalBead!.status).toBe("closed");
    });

    it("epic workflow: create epic -> start subtasks -> close subtasks -> close epic", async () => {
      // 1. Create epic with subtasks
      const epicResult = await hive_create_epic.execute(
        {
          epic_title: "Workflow test epic",
          subtasks: [
            { title: "Step 1", priority: 2 },
            { title: "Step 2", priority: 2 },
          ],
        },
        mockContext,
      );
      const epic = parseResponse<EpicCreateResult>(epicResult);
      expect(epic.success).toBe(true);

      // 2. Start and complete first subtask
      await hive_start.execute({ id: epic.subtasks[0].id }, mockContext);
      await hive_close.execute(
        { id: epic.subtasks[0].id, reason: "Step 1 done" },
        mockContext,
      );

      // 3. Start and complete second subtask
      await hive_start.execute({ id: epic.subtasks[1].id }, mockContext);
      await hive_close.execute(
        { id: epic.subtasks[1].id, reason: "Step 2 done" },
        mockContext,
      );

      // 4. Close the epic
      await hive_close.execute(
        { id: epic.epic.id, reason: "All subtasks completed" },
        mockContext,
      );

      // Verify all are closed using adapter
      const epicClosed = await adapter.getCell(TEST_PROJECT_KEY, epic.epic.id);
      expect(epicClosed).toBeDefined();
      expect(epicClosed!.status).toBe("closed");

      for (const subtask of epic.subtasks) {
        const subtaskClosed = await adapter.getCell(TEST_PROJECT_KEY, subtask.id);
        expect(subtaskClosed).toBeDefined();
        expect(subtaskClosed!.status).toBe("closed");
      }
    });
  });
});
