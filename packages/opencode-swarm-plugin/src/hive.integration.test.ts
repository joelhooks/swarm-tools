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
  hive_sync,
  HiveError,
  getHiveAdapter,
  setHiveWorkingDirectory,
  getHiveWorkingDirectory,
  // Legacy aliases for backward compatibility tests
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
        { bead_id: testBeadId, thread_id: threadId },
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
        { bead_id: testBeadId, thread_id: threadId },
        mockContext,
      );

      // Try to link again
      const result = await beads_link_thread.execute(
        { bead_id: testBeadId, thread_id: threadId },
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
        { bead_id: testBeadId, thread_id: threadId },
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
          { bead_id: "nonexistent-bead-xyz", thread_id: "thread-123" },
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

  describe("Directory Migration (.beads → .hive)", () => {
    it("checkBeadsMigrationNeeded detects .beads without .hive", async () => {
      const { checkBeadsMigrationNeeded } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project with .beads directory only
      const tempProject = join(tmpdir(), `hive-migration-test-${Date.now()}`);
      const beadsDir = join(tempProject, ".beads");
      
      mkdirSync(beadsDir, { recursive: true });
      writeFileSync(join(beadsDir, "issues.jsonl"), '{"id":"bd-test","title":"Test"}');
      
      const result = checkBeadsMigrationNeeded(tempProject);
      
      expect(result.needed).toBe(true);
      expect(result.beadsPath).toBe(beadsDir);
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("checkBeadsMigrationNeeded returns false if .hive exists", async () => {
      const { checkBeadsMigrationNeeded } = await import("./hive");
      const { mkdirSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project with .hive directory
      const tempProject = join(tmpdir(), `hive-migration-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      
      mkdirSync(hiveDir, { recursive: true });
      
      const result = checkBeadsMigrationNeeded(tempProject);
      
      expect(result.needed).toBe(false);
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("migrateBeadsToHive renames .beads to .hive", async () => {
      const { migrateBeadsToHive } = await import("./hive");
      const { mkdirSync, existsSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project with .beads directory
      const tempProject = join(tmpdir(), `hive-migration-test-${Date.now()}`);
      const beadsDir = join(tempProject, ".beads");
      const hiveDir = join(tempProject, ".hive");
      
      mkdirSync(beadsDir, { recursive: true });
      writeFileSync(join(beadsDir, "issues.jsonl"), '{"id":"bd-test","title":"Test"}');
      writeFileSync(join(beadsDir, "config.yaml"), "version: 1");
      
      // Run migration (called after user confirms in CLI)
      const result = await migrateBeadsToHive(tempProject);
      
      // Verify .beads renamed to .hive
      expect(result.migrated).toBe(true);
      expect(existsSync(hiveDir)).toBe(true);
      expect(existsSync(beadsDir)).toBe(false);
      expect(existsSync(join(hiveDir, "issues.jsonl"))).toBe(true);
      expect(existsSync(join(hiveDir, "config.yaml"))).toBe(true);
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("migrateBeadsToHive skips if .hive already exists", async () => {
      const { migrateBeadsToHive } = await import("./hive");
      const { mkdirSync, existsSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project with BOTH .beads and .hive
      const tempProject = join(tmpdir(), `hive-migration-test-${Date.now()}`);
      const beadsDir = join(tempProject, ".beads");
      const hiveDir = join(tempProject, ".hive");
      
      mkdirSync(beadsDir, { recursive: true });
      mkdirSync(hiveDir, { recursive: true });
      writeFileSync(join(beadsDir, "issues.jsonl"), '{"id":"bd-old"}');
      writeFileSync(join(hiveDir, "issues.jsonl"), '{"id":"bd-new"}');
      
      // Run migration - should skip
      const result = await migrateBeadsToHive(tempProject);
      
      // Verify both still exist (no migration)
      expect(result.migrated).toBe(false);
      expect(result.reason).toContain("already exists");
      expect(existsSync(beadsDir)).toBe(true);
      expect(existsSync(hiveDir)).toBe(true);
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("ensureHiveDirectory creates .hive if missing", async () => {
      const { ensureHiveDirectory } = await import("./hive");
      const { mkdirSync, existsSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create empty temp project
      const tempProject = join(tmpdir(), `hive-ensure-test-${Date.now()}`);
      mkdirSync(tempProject, { recursive: true });
      
      const hiveDir = join(tempProject, ".hive");
      expect(existsSync(hiveDir)).toBe(false);
      
      // Ensure creates it
      ensureHiveDirectory(tempProject);
      
      expect(existsSync(hiveDir)).toBe(true);
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("ensureHiveDirectory is idempotent", async () => {
      const { ensureHiveDirectory } = await import("./hive");
      const { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project with existing .hive
      const tempProject = join(tmpdir(), `hive-ensure-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      writeFileSync(join(hiveDir, "issues.jsonl"), '{"id":"existing"}');
      
      // Ensure doesn't overwrite
      ensureHiveDirectory(tempProject);
      
      expect(existsSync(hiveDir)).toBe(true);
      expect(readFileSync(join(hiveDir, "issues.jsonl"), "utf-8")).toBe('{"id":"existing"}');
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });
  });

  describe("importJsonlToPGLite", () => {
    it("imports empty JSONL - no-op", async () => {
      const { importJsonlToPGLite } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      // Create temp project with empty JSONL
      const tempProject = join(tmpdir(), `hive-import-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      writeFileSync(join(hiveDir, "issues.jsonl"), "");

      const result = await importJsonlToPGLite(tempProject);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toBe(0);

      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("imports new records - all inserted", async () => {
      const { importJsonlToPGLite, getHiveAdapter } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync, unlinkSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      // Create temp project with new cells
      const tempProject = join(tmpdir(), `hive-import-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      const cell1 = {
        id: "bd-import-1",
        title: "Import test 1",
        status: "open" as const,
        priority: 2,
        issue_type: "task" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        labels: [],
        comments: [],
      };

      const cell2 = {
        id: "bd-import-2",
        title: "Import test 2",
        status: "in_progress" as const,
        priority: 1,
        issue_type: "bug" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        labels: [],
        comments: [],
      };

      writeFileSync(
        join(hiveDir, "issues.jsonl"),
        JSON.stringify(cell1) + "\n" + JSON.stringify(cell2) + "\n"
      );

      // CRITICAL: Call importJsonlToPGLite() which will call getHiveAdapter()
      // The auto-migration will import cells, so we expect 0 imported here
      // because auto-migration already did it
      const result = await importJsonlToPGLite(tempProject);

      // Auto-migration runs on first getHiveAdapter() call and imports cells
      // So when importJsonlToPGLite() runs, cells are already there
      // This is expected behavior - the function is idempotent
      expect(result.imported + result.updated).toBe(2);
      expect(result.errors).toBe(0);

      // Verify cells exist in database
      const adapter = await getHiveAdapter(tempProject);
      const importedCell1 = await adapter.getCell(tempProject, "bd-import-1");
      const importedCell2 = await adapter.getCell(tempProject, "bd-import-2");

      expect(importedCell1).toBeDefined();
      expect(importedCell1!.title).toBe("Import test 1");
      expect(importedCell2).toBeDefined();
      expect(importedCell2!.title).toBe("Import test 2");

      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("updates existing records", async () => {
      const { importJsonlToPGLite, getHiveAdapter } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync, unlinkSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      // Create temp project
      const tempProject = join(tmpdir(), `hive-import-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      // Write JSONL FIRST (before getHiveAdapter to avoid auto-migration)
      const originalCell = {
        id: "bd-update-1",
        title: "Original title",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        labels: [],
        comments: [],
      };

      writeFileSync(
        join(hiveDir, "issues.jsonl"),
        JSON.stringify(originalCell) + "\n"
      );

      // Get adapter - this will auto-migrate the original cell
      const adapter = await getHiveAdapter(tempProject);

      // Now update the JSONL with new data
      const updatedCell = {
        ...originalCell,
        title: "Updated title",
        description: "New description",
        status: "in_progress" as const,
        priority: 0,
        updated_at: new Date().toISOString(),
      };

      writeFileSync(
        join(hiveDir, "issues.jsonl"),
        JSON.stringify(updatedCell) + "\n"
      );

      const result = await importJsonlToPGLite(tempProject);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.errors).toBe(0);

      // Verify update
      const cell = await adapter.getCell(tempProject, "bd-update-1");
      expect(cell).toBeDefined();
      expect(cell!.title).toBe("Updated title");
      expect(cell!.description).toContain("New description");
      expect(cell!.status).toBe("in_progress");

      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("handles mixed new and existing records", async () => {
      const { importJsonlToPGLite, getHiveAdapter } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      // Create temp project with NO initial JSONL (avoid auto-migration)
      const tempProject = join(tmpdir(), `hive-import-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      // Get adapter first (no auto-migration since no JSONL exists)
      const adapter = await getHiveAdapter(tempProject);

      // Create existing cell directly via adapter
      await adapter.createCell(tempProject, {
        title: "Existing",
        type: "task",
        priority: 2,
      });

      // Get the created cell to find its ID
      const cells = await adapter.queryCells(tempProject, { limit: 1 });
      const existingId = cells[0].id;

      // Now write JSONL with updated existing + new cell
      const existingUpdated = {
        id: existingId,
        title: "Existing updated",
        status: "closed" as const,
        priority: 2,
        issue_type: "task" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: new Date().toISOString(),
        dependencies: [],
        labels: [],
        comments: [],
      };

      const newCell = {
        id: "bd-new",
        title: "Brand new",
        status: "open" as const,
        priority: 1,
        issue_type: "feature" as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        labels: [],
        comments: [],
      };

      writeFileSync(
        join(hiveDir, "issues.jsonl"),
        JSON.stringify(existingUpdated) + "\n" + JSON.stringify(newCell) + "\n"
      );

      const result = await importJsonlToPGLite(tempProject);

      // importJsonlToPGLite() finds:
      // - existingId already exists (updated)
      // - bd-new is new (imported)
      expect(result.imported).toBe(1); // bd-new
      expect(result.updated).toBe(1); // existing cell
      expect(result.errors).toBe(0);

      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("skips invalid JSON lines and counts errors", async () => {
      const { importJsonlToPGLite } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      // Create temp project
      const tempProject = join(tmpdir(), `hive-import-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      const validCell = {
        id: "bd-valid",
        title: "Valid",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dependencies: [],
        labels: [],
        comments: [],
      };

      // Mix valid and invalid JSON
      writeFileSync(
        join(hiveDir, "issues.jsonl"),
        JSON.stringify(validCell) + "\n" +
        "{ invalid json \n" +
        '{"id":"incomplete"\n'
      );

      const result = await importJsonlToPGLite(tempProject);

      expect(result.imported).toBe(1); // Only the valid one
      expect(result.errors).toBe(2); // Two invalid lines

      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("handles missing JSONL file gracefully", async () => {
      const { importJsonlToPGLite } = await import("./hive");
      const { mkdirSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      // Create temp project without issues.jsonl
      const tempProject = join(tmpdir(), `hive-import-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      const result = await importJsonlToPGLite(tempProject);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toBe(0);

      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });
  });

  describe("hive_sync", () => {
    it("commits .hive changes before pulling (regression test for unstaged changes error)", async () => {
      const { mkdirSync, rmSync, writeFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const { execSync } = await import("node:child_process");

      // Create a temp git repository
      const tempProject = join(tmpdir(), `hive-sync-test-${Date.now()}`);
      mkdirSync(tempProject, { recursive: true });

      // Initialize git repo
      execSync("git init", { cwd: tempProject });
      execSync('git config user.email "test@example.com"', { cwd: tempProject });
      execSync('git config user.name "Test User"', { cwd: tempProject });

      // Create .hive directory and issues.jsonl
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      const issuesPath = join(hiveDir, "issues.jsonl");
      writeFileSync(issuesPath, "");

      // Initial commit
      execSync("git add .", { cwd: tempProject });
      execSync('git commit -m "initial commit"', { cwd: tempProject });

      // Set working directory for hive commands
      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Create a cell (this will mark it dirty and flush will write to JSONL)
        await hive_create.execute(
          { title: "Sync test cell", type: "task" },
          mockContext,
        );

        // Sync with auto_pull=false (skip pull since no remote configured)
        const result = await hive_sync.execute(
          { auto_pull: false },
          mockContext,
        );

        // Should succeed
        expect(result).toContain("successfully");

        // Verify .hive changes were committed (working tree should be clean)
        const status = execSync("git status --porcelain", {
          cwd: tempProject,
          encoding: "utf-8",
        });
        expect(status.trim()).toBe("");

        // Verify commit exists
        const log = execSync("git log --oneline", {
          cwd: tempProject,
          encoding: "utf-8",
        });
        expect(log).toContain("chore: sync hive");
      } finally {
        // Restore original working directory
        setHiveWorkingDirectory(originalDir);

        // Cleanup
        rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it("handles case with no changes to commit", async () => {
      const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const { execSync } = await import("node:child_process");

      // Create temp git repo
      const tempProject = join(tmpdir(), `hive-sync-test-${Date.now()}`);
      mkdirSync(tempProject, { recursive: true });

      // Initialize git
      execSync("git init", { cwd: tempProject });
      execSync('git config user.email "test@example.com"', { cwd: tempProject });
      execSync('git config user.name "Test User"', { cwd: tempProject });

      // Create .hive directory with committed issues.jsonl
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      writeFileSync(join(hiveDir, "issues.jsonl"), "");

      // Commit everything
      execSync("git add .", { cwd: tempProject });
      execSync('git commit -m "initial"', { cwd: tempProject });

      // Set working directory
      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Sync with no changes (should handle gracefully)
        const result = await hive_sync.execute(
          { auto_pull: false },
          mockContext,
        );

        // Should return "No cells to sync" since no dirty cells
        expect(result).toContain("No cells to sync");
      } finally {
        setHiveWorkingDirectory(originalDir);
        rmSync(tempProject, { recursive: true, force: true });
      }
    });
  });

  describe("mergeHistoricBeads", () => {
    it("merges empty base file - no changes", async () => {
      const { mergeHistoricBeads } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project with .hive directory
      const tempProject = join(tmpdir(), `hive-merge-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      
      // Create empty base file
      writeFileSync(join(hiveDir, "beads.base.jsonl"), "");
      
      // Create issues.jsonl with one bead
      const existingBead = { id: "bd-existing", title: "Existing bead" };
      writeFileSync(join(hiveDir, "issues.jsonl"), JSON.stringify(existingBead) + "\n");
      
      const result = await mergeHistoricBeads(tempProject);
      
      expect(result.merged).toBe(0);
      expect(result.skipped).toBe(0);
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("merges empty issues file - all base records imported", async () => {
      const { mergeHistoricBeads } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project
      const tempProject = join(tmpdir(), `hive-merge-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      
      // Create base file with 2 beads
      const baseBead1 = { id: "bd-base-1", title: "Historic bead 1" };
      const baseBead2 = { id: "bd-base-2", title: "Historic bead 2" };
      writeFileSync(
        join(hiveDir, "beads.base.jsonl"),
        JSON.stringify(baseBead1) + "\n" + JSON.stringify(baseBead2) + "\n"
      );
      
      // Empty issues file
      writeFileSync(join(hiveDir, "issues.jsonl"), "");
      
      const result = await mergeHistoricBeads(tempProject);
      
      expect(result.merged).toBe(2);
      expect(result.skipped).toBe(0);
      
      // Verify issues.jsonl now has both beads
      const issuesContent = readFileSync(join(hiveDir, "issues.jsonl"), "utf-8");
      const lines = issuesContent.trim().split("\n").filter(l => l);
      expect(lines).toHaveLength(2);
      
      const beads = lines.map(line => JSON.parse(line));
      expect(beads.find(b => b.id === "bd-base-1")).toBeDefined();
      expect(beads.find(b => b.id === "bd-base-2")).toBeDefined();
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("overlapping IDs - issues.jsonl wins (more recent)", async () => {
      const { mergeHistoricBeads } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project
      const tempProject = join(tmpdir(), `hive-merge-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      
      // Base has old version of bd-overlap
      const baseOldVersion = { id: "bd-overlap", title: "Old title", status: "open" };
      writeFileSync(
        join(hiveDir, "beads.base.jsonl"),
        JSON.stringify(baseOldVersion) + "\n"
      );
      
      // Issues has new version (updated)
      const issuesNewVersion = { id: "bd-overlap", title: "New title", status: "closed" };
      writeFileSync(
        join(hiveDir, "issues.jsonl"),
        JSON.stringify(issuesNewVersion) + "\n"
      );
      
      const result = await mergeHistoricBeads(tempProject);
      
      expect(result.merged).toBe(0); // Nothing new to merge
      expect(result.skipped).toBe(1); // Skipped the old version
      
      // Verify issues.jsonl still has new version (unchanged)
      const issuesContent = readFileSync(join(hiveDir, "issues.jsonl"), "utf-8");
      const bead = JSON.parse(issuesContent.trim());
      expect(bead.title).toBe("New title");
      expect(bead.status).toBe("closed");
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("no overlap - all records combined", async () => {
      const { mergeHistoricBeads } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project
      const tempProject = join(tmpdir(), `hive-merge-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      
      // Base has 2 beads
      const baseBead1 = { id: "bd-base-1", title: "Historic 1" };
      const baseBead2 = { id: "bd-base-2", title: "Historic 2" };
      writeFileSync(
        join(hiveDir, "beads.base.jsonl"),
        JSON.stringify(baseBead1) + "\n" + JSON.stringify(baseBead2) + "\n"
      );
      
      // Issues has 2 different beads
      const issuesBead1 = { id: "bd-current-1", title: "Current 1" };
      const issuesBead2 = { id: "bd-current-2", title: "Current 2" };
      writeFileSync(
        join(hiveDir, "issues.jsonl"),
        JSON.stringify(issuesBead1) + "\n" + JSON.stringify(issuesBead2) + "\n"
      );
      
      const result = await mergeHistoricBeads(tempProject);
      
      expect(result.merged).toBe(2); // Added 2 from base
      expect(result.skipped).toBe(0);
      
      // Verify issues.jsonl now has all 4 beads
      const issuesContent = readFileSync(join(hiveDir, "issues.jsonl"), "utf-8");
      const lines = issuesContent.trim().split("\n").filter(l => l);
      expect(lines).toHaveLength(4);
      
      const beads = lines.map(line => JSON.parse(line));
      expect(beads.find(b => b.id === "bd-base-1")).toBeDefined();
      expect(beads.find(b => b.id === "bd-base-2")).toBeDefined();
      expect(beads.find(b => b.id === "bd-current-1")).toBeDefined();
      expect(beads.find(b => b.id === "bd-current-2")).toBeDefined();
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("missing base file - graceful handling", async () => {
      const { mergeHistoricBeads } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project with .hive but NO base file
      const tempProject = join(tmpdir(), `hive-merge-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      
      // Issues exists, base doesn't
      const issuesBead = { id: "bd-current", title: "Current" };
      writeFileSync(join(hiveDir, "issues.jsonl"), JSON.stringify(issuesBead) + "\n");
      
      const result = await mergeHistoricBeads(tempProject);
      
      // Should return zeros, not throw
      expect(result.merged).toBe(0);
      expect(result.skipped).toBe(0);
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });

    it("missing issues file - creates it from base", async () => {
      const { mergeHistoricBeads } = await import("./hive");
      const { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      
      // Create temp project with base but NO issues file
      const tempProject = join(tmpdir(), `hive-merge-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      
      // Base exists, issues doesn't
      const baseBead = { id: "bd-base", title: "Historic" };
      writeFileSync(
        join(hiveDir, "beads.base.jsonl"),
        JSON.stringify(baseBead) + "\n"
      );
      
      const issuesPath = join(hiveDir, "issues.jsonl");
      expect(existsSync(issuesPath)).toBe(false);
      
      const result = await mergeHistoricBeads(tempProject);
      
      expect(result.merged).toBe(1);
      expect(result.skipped).toBe(0);
      
      // Verify issues.jsonl was created
      expect(existsSync(issuesPath)).toBe(true);
      const content = readFileSync(issuesPath, "utf-8");
      const bead = JSON.parse(content.trim());
      expect(bead.id).toBe("bd-base");
      
      // Cleanup
      rmSync(tempProject, { recursive: true, force: true });
    });
  });
});
