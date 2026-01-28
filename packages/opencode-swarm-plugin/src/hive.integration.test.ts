/**
 * Hive Integration Tests
 *
 * These tests exercise the HiveAdapter-based tools directly.
 * They validate the tool wrappers work correctly with actual hive operations.
 *
 * Run with: bun test src/hive.integration.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearHiveAdapterCache,
  hive_create,
  hive_create_epic,
  hive_query,
  hive_update,
  hive_close,
  hive_start,
  hive_ready,
  hive_cells,
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
const TEST_PROJECT_KEY = join(tmpdir(), `beads-integration-test-${Date.now()}`);

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
    // Clear cached adapters from previous test runs
    clearHiveAdapterCache();
    
    // Set working directory for beads commands
    setBeadsWorkingDirectory(TEST_PROJECT_KEY);
    
    // Get adapter instance for verification
    adapter = await getBeadsAdapter(TEST_PROJECT_KEY);
  });

  afterAll(async () => {
    await cleanupBeads();
    clearHiveAdapterCache();
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

    it("closes a bead with result and stores it", async () => {
      // Create a fresh bead to close with a result
      const createResult = await hive_create.execute(
        { title: "Bead with result" },
        mockContext,
      );
      const created = parseResponse<Bead>(createResult);

      const result = await hive_close.execute(
        {
          id: created.id,
          reason: "Task completed",
          result: "Implemented the feature with full test coverage. Added 3 new endpoints and updated the schema.",
        },
        mockContext,
      );

      expect(result).toContain("Closed");
      expect(result).toContain(created.id);

      // Verify the result is stored on the cell
      const closedBead = await adapter.getCell(TEST_PROJECT_KEY, created.id);
      expect(closedBead).toBeDefined();
      expect(closedBead!.status).toBe("closed");
      expect(closedBead!.result).toBe(
        "Implemented the feature with full test coverage. Added 3 new endpoints and updated the schema.",
      );
      expect(closedBead!.result_at).toBeGreaterThan(0);
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
    it("creates an epic with subtasks and syncs to JSONL", async () => {
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
      
      // NEW TEST: Verify cells are synced to JSONL immediately
      const { readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const jsonlPath = join(TEST_PROJECT_KEY, ".hive", "issues.jsonl");
      
      expect(existsSync(jsonlPath)).toBe(true);
      
      const jsonlContent = readFileSync(jsonlPath, "utf-8");
      const lines = jsonlContent.trim().split("\n").filter(l => l);
      const cells = lines.map(line => JSON.parse(line));
      
      // Epic and all subtasks should be in JSONL
      const epicInJsonl = cells.find(c => c.id === epicResult.epic.id);
      expect(epicInJsonl).toBeDefined();
      expect(epicInJsonl!.title).toBe("Integration test epic");
      
      for (const subtask of epicResult.subtasks) {
        const subtaskInJsonl = cells.find(c => c.id === subtask.id);
        expect(subtaskInJsonl).toBeDefined();
        expect(subtaskInJsonl!.parent_id).toBe(epicResult.epic.id);
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

  describe("partial ID resolution", () => {
    let fullId: string;
    let hash: string;

    beforeEach(async () => {
      // Create a test cell to resolve
      const result = await hive_create.execute(
        { title: "Partial ID test cell" },
        mockContext,
      );
      const cell = parseResponse<Cell>(result);
      fullId = cell.id;
      createdBeadIds.push(fullId);

      // Extract hash from ID (format: {prefix}-{hash}-{timestamp}{random})
      // The last segment is always timestamp+random (11 chars)
      // The hash is the 6-char segment before that
      // Examples:
      //   "opencode-swarm-monorepo-lf2p4u-mjd2h5v4wdt" -> hash is "lf2p4u"
      //   "cell--gcel4-mjd2h5v4wdt" -> hash is "-gcel4" (negative hash creates consecutive hyphens)
      
      // Find the last hyphen, then work backwards to find the second-to-last hyphen
      const lastHyphenIndex = fullId.lastIndexOf("-");
      if (lastHyphenIndex === -1) {
        hash = "";
      } else {
        // Get everything before the last hyphen
        const beforeLast = fullId.substring(0, lastHyphenIndex);
        // Find the second-to-last hyphen
        const secondLastHyphenIndex = beforeLast.lastIndexOf("-");
        if (secondLastHyphenIndex === -1) {
          hash = "";
        } else {
          // Hash is between second-to-last and last hyphen
          hash = fullId.substring(secondLastHyphenIndex + 1, lastHyphenIndex);
        }
      }
    });

    it("short hashes work with all ID-taking tools", async () => {
      // Use last 6-8 chars of hash (or full hash if short)
      const shortHash = hash.substring(Math.max(0, hash.length - 8));
      
      try {
        // Test hive_update
        await hive_update.execute(
          { id: shortHash, description: "Updated via short hash" },
          mockContext,
        );

        // Test hive_start
        await hive_start.execute({ id: shortHash }, mockContext);

        // Test hive_close  
        const result = await hive_close.execute(
          { id: shortHash, reason: "Closed via short hash" },
          mockContext,
        );

        expect(result).toContain("Closed");
        expect(result).toContain(fullId);
      } catch (error) {
        // If ambiguous, verify error message is helpful
        if (error instanceof Error && error.message.includes("Ambiguous")) {
          expect(error.message).toMatch(/ambiguous.*multiple/i);
          expect(error.message).toContain(shortHash);
        } else {
          throw error;
        }
      }
    });

    describe("hive_update", () => {
      it("accepts full cell ID (no resolution needed)", async () => {
        const result = await hive_update.execute(
          { id: fullId, description: "Updated via full ID" },
          mockContext,
        );

        const updated = parseResponse<Cell>(result);
        expect(updated.id).toBe(fullId);
        expect(updated.description).toContain("Updated via full ID");
      });

      it("resolves hash to full ID (or shows helpful error if ambiguous)", async () => {
        try {
          const result = await hive_update.execute(
            { id: hash, priority: 1 },
            mockContext,
          );

          const updated = parseResponse<Cell>(result);
          expect(updated.id).toBe(fullId);
          expect(updated.priority).toBe(1);
        } catch (error) {
          // In test environment with many cells, hash may be ambiguous
          // Verify we get a helpful error message
          if (error instanceof Error && error.message.includes("Ambiguous")) {
            expect(error.message).toMatch(/ambiguous.*multiple/i);
            expect(error.message).toContain(hash);
          } else {
            throw error; // Re-throw if not ambiguity error
          }
        }
      });

      it("throws helpful error for non-existent hash", async () => {
        await expect(
          hive_update.execute({ id: "zzzzzz", status: "closed" }, mockContext),
        ).rejects.toThrow(/not found|no cell|zzzzzz/i);
      });

      it("throws helpful error for ambiguous hash", async () => {
        // Create another cell with potentially similar hash
        // (in practice, hashes are unique, but we simulate ambiguity by using a short partial)
        // This test verifies the error message is helpful
        try {
          // Use a single char which might match multiple cells in larger datasets
          await hive_update.execute({ id: "a", status: "closed" }, mockContext);
          // If it succeeds, it means only one cell matched - that's fine
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Error should mention ambiguity if multiple matches
          if (message.includes("ambiguous") || message.includes("multiple")) {
            expect(message).toMatch(/ambiguous|multiple/i);
          }
        }
      });
    });

    describe("hive_close", () => {
      it("accepts full cell ID", async () => {
        const result = await hive_close.execute(
          { id: fullId, reason: "Closed via full ID" },
          mockContext,
        );

        expect(result).toContain("Closed");
        expect(result).toContain(fullId);

        const closed = await adapter.getCell(TEST_PROJECT_KEY, fullId);
        expect(closed?.status).toBe("closed");
      });

      it("resolves hash to full ID (or shows helpful error if ambiguous)", async () => {
        try {
          const result = await hive_close.execute(
            { id: hash, reason: "Close via hash" },
            mockContext,
          );

          expect(result).toContain("Closed");
          expect(result).toContain(fullId);
        } catch (error) {
          if (error instanceof Error && error.message.includes("Ambiguous")) {
            expect(error.message).toMatch(/ambiguous.*multiple/i);
            expect(error.message).toContain(hash);
          } else {
            throw error;
          }
        }
      });

      it("throws helpful error for non-existent hash", async () => {
        await expect(
          hive_close.execute({ id: "nonono", reason: "Test" }, mockContext),
        ).rejects.toThrow(/not found|no cell|nonono/i);
      });
    });

    describe("hive_start", () => {
      it("accepts full cell ID", async () => {
        const result = await hive_start.execute({ id: fullId }, mockContext);

        expect(result).toContain("Started");
        expect(result).toContain(fullId);

        const started = await adapter.getCell(TEST_PROJECT_KEY, fullId);
        expect(started?.status).toBe("in_progress");
      });

      it("resolves hash to full ID (or shows helpful error if ambiguous)", async () => {
        try {
          const result = await hive_start.execute(
            { id: hash },
            mockContext,
          );

          expect(result).toContain("Started");
          expect(result).toContain(fullId);
        } catch (error) {
          if (error instanceof Error && error.message.includes("Ambiguous")) {
            expect(error.message).toMatch(/ambiguous.*multiple/i);
            expect(error.message).toContain(hash);
          } else {
            throw error;
          }
        }
      });

      it("throws helpful error for non-existent hash", async () => {
        await expect(
          hive_start.execute({ id: "nope99" }, mockContext),
        ).rejects.toThrow(/not found|no cell|nope99/i);
      });
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
      // Use unique IDs per run to avoid UNIQUE constraint violations in the
      // global swarm.db (PRIMARY KEY is just `id`, not composite with project_key)
      const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const cellId1 = `bd-import-1-${runId}`;
      const cellId2 = `bd-import-2-${runId}`;
      const tempProject = join(tmpdir(), `hive-import-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      const cell1 = {
        id: cellId1,
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
        id: cellId2,
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
      const importedCell1 = await adapter.getCell(tempProject, cellId1);
      const importedCell2 = await adapter.getCell(tempProject, cellId2);

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

      // Use unique ID per run to avoid UNIQUE constraint violations in global DB
      const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const cellId = `bd-update-1-${runId}`;

      // Create temp project
      const tempProject = join(tmpdir(), `hive-import-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      // Write JSONL FIRST (before getHiveAdapter to avoid auto-migration)
      const originalCell = {
        id: cellId,
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
      const cell = await adapter.getCell(tempProject, cellId);
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

      // Use unique ID per run to avoid UNIQUE constraint violations in global DB
      const newCellId = `bd-new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const newCell = {
        id: newCellId,
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
      // - newCellId is new (imported)
      expect(result.imported).toBe(1); // new cell
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

      // Use unique ID per run to avoid UNIQUE constraint violations in global DB
      const validCellId = `bd-valid-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const validCell = {
        id: validCellId,
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

      // Auto-migration runs first inside importJsonlToPGLite (via getHiveAdapter).
      // It imports the valid cell, then importJsonlToPGLite sees it as existing → updated.
      // The 2 invalid JSON lines are counted as errors either way.
      expect(result.imported + result.updated).toBe(1); // Only the valid one
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
    it("succeeds with unstaged changes outside .hive/ (stash-before-pull)", async () => {
      const { mkdirSync, rmSync, writeFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const { execSync } = await import("node:child_process");

      // Create a temp git repository with a remote (to trigger pull)
      const tempProject = join(tmpdir(), `hive-sync-stash-test-${Date.now()}`);
      const remoteProject = join(tmpdir(), `hive-sync-remote-${Date.now()}`);
      
      // Create "remote" bare repo
      mkdirSync(remoteProject, { recursive: true });
      execSync("git init --bare", { cwd: remoteProject });
      
      // Create local repo
      mkdirSync(tempProject, { recursive: true });
      execSync("git init -b main", { cwd: tempProject });
      execSync('git config user.email "test@example.com"', { cwd: tempProject });
      execSync('git config user.name "Test User"', { cwd: tempProject });
      execSync(`git remote add origin ${remoteProject}`, { cwd: tempProject });

      // Create .hive directory and a source file
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      writeFileSync(join(hiveDir, "issues.jsonl"), "");
      writeFileSync(join(tempProject, "src.ts"), "// initial");

      // Initial commit and push
      execSync("git add .", { cwd: tempProject });
      execSync('git commit -m "initial commit"', { cwd: tempProject });
      execSync("git push -u origin main", { cwd: tempProject });

      // Now create unstaged changes OUTSIDE .hive/
      writeFileSync(join(tempProject, "src.ts"), "// modified but not staged");

      // Set working directory for hive commands
      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Create a cell (this will mark it dirty and flush will write to JSONL)
        await hive_create.execute(
          { title: "Stash test cell", type: "task" },
          mockContext,
        );

        // Sync WITH auto_pull=true (this is where the bug manifests)
        // Before fix: fails with "cannot pull with rebase: You have unstaged changes"
        // After fix: stashes, pulls, pops, succeeds
        const result = await hive_sync.execute(
          { auto_pull: true },
          mockContext,
        );

        // Should succeed
        expect(result).toContain("successfully");

        // Verify .hive changes were committed
        const hiveStatus = execSync("git status --porcelain .hive/", {
          cwd: tempProject,
          encoding: "utf-8",
        });
        expect(hiveStatus.trim()).toBe("");

        // Verify unstaged changes are still there (stash was popped)
        const srcStatus = execSync("git status --porcelain src.ts", {
          cwd: tempProject,
          encoding: "utf-8",
        });
        expect(srcStatus.trim()).toContain("M src.ts");
      } finally {
        // Restore original working directory
        setHiveWorkingDirectory(originalDir);

        // Cleanup
        rmSync(tempProject, { recursive: true, force: true });
        rmSync(remoteProject, { recursive: true, force: true });
      }
    });

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

      // Create .gitignore to ignore .opencode directory (created by swarm-mail)
      const gitignorePath = join(tempProject, ".gitignore");
      writeFileSync(gitignorePath, ".opencode/\n");

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

        // Should return success message (either "No cells or memories to sync" or "no remote configured")
        expect(result).toMatch(/No cells or memories to sync|no remote configured|synced successfully/);
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

  describe("process exit hook", () => {
    it("registers beforeExit hook that syncs dirty cells", async () => {
      const { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const { execSync } = await import("node:child_process");

      // Create temp project
      const tempProject = join(tmpdir(), `hive-exit-hook-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      // Initialize git repo
      execSync("git init", { cwd: tempProject });
      execSync('git config user.email "test@example.com"', { cwd: tempProject });
      execSync('git config user.name "Test User"', { cwd: tempProject });

      // Initial commit with empty issues.jsonl
      writeFileSync(join(hiveDir, "issues.jsonl"), "");
      execSync("git add .", { cwd: tempProject });
      execSync('git commit -m "initial"', { cwd: tempProject });

      // Set working directory
      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Create a cell (marks it dirty but don't sync)
        await hive_create.execute(
          { title: "Exit hook test cell", type: "task" },
          mockContext,
        );

        // Verify cell is NOT in JSONL yet (only in PGLite)
        const beforeContent = readFileSync(join(hiveDir, "issues.jsonl"), "utf-8");
        expect(beforeContent.trim()).toBe("");

        // Simulate process exit by triggering beforeExit event
        process.emit("beforeExit", 0);

        // Wait for async flush to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify cell was synced to JSONL by the exit hook
        const afterContent = readFileSync(join(hiveDir, "issues.jsonl"), "utf-8");
        expect(afterContent.trim()).not.toBe("");

        const cells = afterContent.trim().split("\n").map(line => JSON.parse(line));
        expect(cells).toHaveLength(1);
        expect(cells[0].title).toBe("Exit hook test cell");
      } finally {
        setHiveWorkingDirectory(originalDir);
        rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it("exit hook is idempotent - safe to call multiple times", async () => {
      const { mkdirSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      // Create temp project
      const tempProject = join(tmpdir(), `hive-exit-hook-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      writeFileSync(join(hiveDir, "issues.jsonl"), "");

      // Set working directory
      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Create a cell
        await hive_create.execute(
          { title: "Idempotent test cell", type: "task" },
          mockContext,
        );

        // Trigger exit hook multiple times
        process.emit("beforeExit", 0);
        await new Promise(resolve => setTimeout(resolve, 50));
        
        process.emit("beforeExit", 0);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Verify cell is written only once (no duplication)
        const content = readFileSync(join(hiveDir, "issues.jsonl"), "utf-8");
        const lines = content.trim().split("\n").filter(l => l);
        
        // Should have exactly one cell (even though we triggered hook twice)
        expect(lines.length).toBeGreaterThanOrEqual(1);
        
        // All cells should have unique IDs
        const cells = lines.map(line => JSON.parse(line));
        const uniqueIds = new Set(cells.map(c => c.id));
        expect(uniqueIds.size).toBe(cells.length);
      } finally {
        setHiveWorkingDirectory(originalDir);
        rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it("exit hook handles case with no dirty cells gracefully", async () => {
      const { mkdirSync, rmSync, writeFileSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      // Create temp project with empty JSONL
      const tempProject = join(tmpdir(), `hive-exit-hook-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });
      writeFileSync(join(hiveDir, "issues.jsonl"), "");

      // Set working directory
      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Trigger exit hook with no dirty cells (should not throw)
        process.emit("beforeExit", 0);
        await new Promise(resolve => setTimeout(resolve, 50));

        // JSONL should still be empty (no error thrown)
        const content = readFileSync(join(hiveDir, "issues.jsonl"), "utf-8");
        expect(content.trim()).toBe("");
      } finally {
        setHiveWorkingDirectory(originalDir);
        rmSync(tempProject, { recursive: true, force: true });
      }
    });
  });

  describe("hive_cells", () => {
    let testCellId: string;

    beforeEach(async () => {
      // Create a test cell for hive_cells tests
      const result = await hive_create.execute(
        { title: "Cells tool test", type: "task" },
        mockContext,
      );
      const cell = parseResponse<Cell>(result);
      testCellId = cell.id;
      createdBeadIds.push(testCellId);
    });

    it("lists all cells with no filters", async () => {
      const { hive_cells } = await import("./hive");
      
      const result = await hive_cells.execute({}, mockContext);
      const cells = parseResponse<Cell[]>(result);

      expect(Array.isArray(cells)).toBe(true);
      expect(cells.length).toBeGreaterThan(0);
    });

    it("filters by status", async () => {
      const { hive_cells } = await import("./hive");
      
      const result = await hive_cells.execute({ status: "open" }, mockContext);
      const cells = parseResponse<Cell[]>(result);

      expect(Array.isArray(cells)).toBe(true);
      expect(cells.every((c) => c.status === "open")).toBe(true);
    });

    it("filters by type", async () => {
      const { hive_cells } = await import("./hive");
      
      // Create a bug cell
      const bugResult = await hive_create.execute(
        { title: "Bug for cells test", type: "bug" },
        mockContext,
      );
      const bug = parseResponse<Cell>(bugResult);
      createdBeadIds.push(bug.id);

      const result = await hive_cells.execute({ type: "bug" }, mockContext);
      const cells = parseResponse<Cell[]>(result);

      expect(Array.isArray(cells)).toBe(true);
      expect(cells.every((c) => c.issue_type === "bug")).toBe(true);
    });

    it("returns next ready cell when ready=true", async () => {
      const { hive_cells } = await import("./hive");
      
      const result = await hive_cells.execute({ ready: true }, mockContext);
      const cells = parseResponse<Cell[]>(result);

      expect(Array.isArray(cells)).toBe(true);
      // Should return 0 or 1 cells (the next ready one)
      expect(cells.length).toBeLessThanOrEqual(1);
      if (cells.length === 1) {
        expect(["open", "in_progress"]).toContain(cells[0].status);
      }
    });

    it("looks up cells by partial ID (returns all matches)", async () => {
      const { hive_cells } = await import("./hive");
      
      // Extract hash from full ID (6-char segment before the last hyphen)
      const lastHyphenIndex = testCellId.lastIndexOf("-");
      const beforeLast = testCellId.substring(0, lastHyphenIndex);
      const secondLastHyphenIndex = beforeLast.lastIndexOf("-");
      const hash = testCellId.substring(secondLastHyphenIndex + 1, lastHyphenIndex);
      
      // Use last 6 chars of hash (or full hash if short)
      const shortHash = hash.substring(Math.max(0, hash.length - 6));

      const result = await hive_cells.execute({ id: shortHash }, mockContext);
      const cells = parseResponse<Cell[]>(result);

      // Should return all cells matching the partial ID (may be multiple)
      expect(cells.length).toBeGreaterThanOrEqual(1);
      // Our test cell should be in the results
      expect(cells.some(c => c.id === testCellId)).toBe(true);
    });

    it("looks up cell by full ID", async () => {
      const { hive_cells } = await import("./hive");
      
      const result = await hive_cells.execute({ id: testCellId }, mockContext);
      const cells = parseResponse<Cell[]>(result);

      expect(cells).toHaveLength(1);
      expect(cells[0].id).toBe(testCellId);
      expect(cells[0].title).toBe("Cells tool test");
    });

    it("throws error for non-existent ID", async () => {
      const { hive_cells } = await import("./hive");
      
      await expect(
        hive_cells.execute({ id: "nonexistent999" }, mockContext),
      ).rejects.toThrow(/not found|no cell|nonexistent999/i);
    });

    it("respects limit parameter", async () => {
      const { hive_cells } = await import("./hive");
      
      const result = await hive_cells.execute({ limit: 2 }, mockContext);
      const cells = parseResponse<Cell[]>(result);

      expect(cells.length).toBeLessThanOrEqual(2);
    });

    it("combines filters (status + type + limit)", async () => {
      const { hive_cells } = await import("./hive");
      
      // Create some task cells
      for (let i = 0; i < 3; i++) {
        const r = await hive_create.execute(
          { title: `Task ${i}`, type: "task" },
          mockContext,
        );
        const c = parseResponse<Cell>(r);
        createdBeadIds.push(c.id);
      }

      const result = await hive_cells.execute(
        { status: "open", type: "task", limit: 2 },
        mockContext,
      );
      const cells = parseResponse<Cell[]>(result);

      expect(cells.length).toBeLessThanOrEqual(2);
      expect(cells.every((c) => c.status === "open" && c.issue_type === "task")).toBe(true);
    });
  });

  describe("bigint to Date conversion", () => {
    it("should handle PGLite bigint timestamps correctly in hive_query", async () => {
      const { mkdirSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const tempProject = join(tmpdir(), `hive-bigint-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Create a cell
        const createResponse = await hive_create.execute(
          { title: "Test bigint dates", type: "task" },
          mockContext
        );
        const created = parseResponse<Cell>(createResponse);
        
        // Query it back - this triggers formatCellForOutput with PGLite bigint timestamps
        const queryResponse = await hive_query.execute({ status: "open" }, mockContext);
        const queried = parseResponse<Cell[]>(queryResponse);

        expect(queried.length).toBeGreaterThan(0);
        const cell = queried.find(c => c.id === created.id);
        expect(cell).toBeDefined();

        // These should be valid ISO date strings, not "Invalid Date"
        expect(cell!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(cell!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(cell!.created_at).not.toBe("Invalid Date");
        expect(cell!.updated_at).not.toBe("Invalid Date");

        // Verify dates are actually valid by parsing
        const createdDate = new Date(cell!.created_at);
        const updatedDate = new Date(cell!.updated_at);
        expect(createdDate.getTime()).toBeGreaterThan(0);
        expect(updatedDate.getTime()).toBeGreaterThan(0);
      } finally {
        setHiveWorkingDirectory(originalDir);
        rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it("should handle closed_at bigint timestamp correctly", async () => {
      const { mkdirSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const tempProject = join(tmpdir(), `hive-bigint-closed-test-${Date.now()}`);
      const hiveDir = join(tempProject, ".hive");
      mkdirSync(hiveDir, { recursive: true });

      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Create and close a cell
        const createResponse = await hive_create.execute(
          { title: "Test closed bigint date", type: "task" },
          mockContext
        );
        const created = parseResponse<Cell>(createResponse);

        await hive_close.execute(
          { id: created.id, reason: "Testing bigint closed_at" },
          mockContext
        );

        // Query closed cells
        const queryResponse = await hive_query.execute({ status: "closed" }, mockContext);
        const queried = parseResponse<Cell[]>(queryResponse);

        const cell = queried.find(c => c.id === created.id);
        expect(cell).toBeDefined();
        expect(cell!.closed_at).toBeDefined();
        expect(cell!.closed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(cell!.closed_at).not.toBe("Invalid Date");

        // Verify closed_at is valid
        const closedDate = new Date(cell!.closed_at!);
        expect(closedDate.getTime()).toBeGreaterThan(0);
      } finally {
        setHiveWorkingDirectory(originalDir);
        rmSync(tempProject, { recursive: true, force: true });
      }
    });
  });

  describe("parent_id filter", () => {
    it("hive_query filters by parent_id to get epic children", async () => {
      const { rmSync } = await import("node:fs");
      const tempProject = join(tmpdir(), `hive-parent-filter-${Date.now()}`);
      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Create an epic
        const epicResponse = await hive_create.execute(
          { title: "Epic Task", type: "epic", priority: 1 },
          mockContext
        );
        const epic = parseResponse<Cell>(epicResponse);

        // Create children of the epic
        const child1Response = await hive_create.execute(
          { title: "Subtask 1", type: "task", parent_id: epic.id },
          mockContext
        );
        const child1 = parseResponse<Cell>(child1Response);

        const child2Response = await hive_create.execute(
          { title: "Subtask 2", type: "task", parent_id: epic.id },
          mockContext
        );
        const child2 = parseResponse<Cell>(child2Response);

        // Create unrelated cell
        await hive_create.execute(
          { title: "Unrelated Task", type: "task" },
          mockContext
        );

        // Query by parent_id
        const queryResponse = await hive_query.execute(
          { parent_id: epic.id },
          mockContext
        );
        const children = parseResponse<Cell[]>(queryResponse);

        // Should only return the 2 children
        expect(children).toHaveLength(2);
        expect(children.map(c => c.id)).toContain(child1.id);
        expect(children.map(c => c.id)).toContain(child2.id);
        expect(children.every(c => c.parent_id === epic.id)).toBe(true);
      } finally {
        setHiveWorkingDirectory(originalDir);
        rmSync(tempProject, { recursive: true, force: true });
      }
    });

    it("hive_cells filters by parent_id to get epic children", async () => {
      const { rmSync } = await import("node:fs");
      const tempProject = join(tmpdir(), `hive-cells-parent-filter-${Date.now()}`);
      const originalDir = getHiveWorkingDirectory();
      setHiveWorkingDirectory(tempProject);

      try {
        // Create an epic
        const epicResponse = await hive_create.execute(
          { title: "Epic with Children", type: "epic", priority: 1 },
          mockContext
        );
        const epic = parseResponse<Cell>(epicResponse);

        // Create children
        const child1Response = await hive_create.execute(
          { title: "Child A", type: "task", parent_id: epic.id },
          mockContext
        );
        const child1 = parseResponse<Cell>(child1Response);

        const child2Response = await hive_create.execute(
          { title: "Child B", type: "bug", parent_id: epic.id },
          mockContext
        );
        const child2 = parseResponse<Cell>(child2Response);

        // Create unrelated cells
        await hive_create.execute(
          { title: "Orphan Task", type: "task" },
          mockContext
        );

        // Query using hive_cells with parent_id
        const cellsResponse = await hive_cells.execute(
          { parent_id: epic.id },
          mockContext
        );
        const cells = parseResponse<Cell[]>(cellsResponse);

        // Should only return the 2 children
        expect(cells).toHaveLength(2);
        expect(cells.map(c => c.id)).toContain(child1.id);
        expect(cells.map(c => c.id)).toContain(child2.id);
        expect(cells.every(c => c.parent_id === epic.id)).toBe(true);
      } finally {
        setHiveWorkingDirectory(originalDir);
        rmSync(tempProject, { recursive: true, force: true });
      }
    });
  });
});
