/**
 * Integration tests for swarm-mail.ts (embedded implementation)
 *
 * These tests run against the embedded PGLite database.
 * No external server required - everything runs in-process.
 *
 * Run with: pnpm test:integration
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, closeDatabase, getDatabase } from "./streams/index";
import {
  swarmmail_init,
  swarmmail_send,
  swarmmail_inbox,
  swarmmail_read_message,
  swarmmail_reserve,
  swarmmail_release,
  swarmmail_ack,
  swarmmail_health,
  clearSessionState,
} from "./swarm-mail";

// ============================================================================
// Test Configuration
// ============================================================================

/** Generate unique test database path per test run */
function testDbPath(prefix = "swarm-mail"): string {
  return `/tmp/${prefix}-${randomUUID()}`;
}

/** Track paths created during test for cleanup */
let testPaths: string[] = [];

function trackPath(path: string): string {
  testPaths.push(path);
  return path;
}

let TEST_DB_PATH: string;

/**
 * Generate a unique test context to avoid state collisions between tests
 */
function createTestContext() {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    sessionID: id,
  };
}

/**
 * Mock tool context
 */
interface MockToolContext {
  sessionID: string;
}

/**
 * Helper to execute tool and parse JSON response
 */
async function executeTool<T>(
  tool: { execute: (args: unknown, ctx: unknown) => Promise<string> },
  args: unknown,
  ctx: MockToolContext,
): Promise<T> {
  const result = await tool.execute(args, ctx);
  return JSON.parse(result) as T;
}

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

beforeEach(async () => {
  testPaths = [];
  TEST_DB_PATH = trackPath(testDbPath());
  await resetDatabase(TEST_DB_PATH);
});

afterEach(async () => {
  // Clean up all test databases
  for (const path of testPaths) {
    try {
      // Wipe all data before closing
      const db = await getDatabase(path);
      await db.exec(`
        DELETE FROM message_recipients;
        DELETE FROM messages;
        DELETE FROM reservations;
        DELETE FROM agents;
        DELETE FROM events;
        DELETE FROM locks;
        DELETE FROM cursors;
        DELETE FROM deferred;
      `);
    } catch {
      // Ignore errors during cleanup
    }
    await closeDatabase(path);
  }
  testPaths = [];
});

// ============================================================================
// Health Check Tests
// ============================================================================

describe("swarm-mail integration (embedded)", () => {
  describe("swarmmail_health", () => {
    it("returns healthy when database is initialized", async () => {
      const ctx = createTestContext();

      const result = await executeTool<{
        healthy: boolean;
        database: string;
        stats: { events: number; agents: number; messages: number };
      }>(swarmmail_health, {}, ctx);

      expect(result.healthy).toBe(true);
      expect(result.database).toBeTruthy();
      expect(result.stats).toBeDefined();
    });

    it("includes session info when initialized", async () => {
      const ctx = createTestContext();

      // Initialize session
      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "HealthAgent" },
        ctx,
      );

      const result = await executeTool<{
        healthy: boolean;
        session: {
          agent_name: string;
          project_key: string;
          reservations: number;
        };
      }>(swarmmail_health, {}, ctx);

      expect(result.healthy).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session.agent_name).toBe("HealthAgent");
      expect(result.session.reservations).toBe(0);

      clearSessionState(ctx.sessionID);
    });
  });

  // ============================================================================
  // Initialization Tests
  // ============================================================================

  describe("swarmmail_init", () => {
    it("creates agent and returns name and project_key", async () => {
      const ctx = createTestContext();

      const result = await executeTool<{
        agent_name: string;
        project_key: string;
        message: string;
      }>(swarmmail_init, { project_path: TEST_DB_PATH }, ctx);

      expect(result.agent_name).toBeTruthy();
      expect(result.project_key).toBe(TEST_DB_PATH);
      expect(result.message).toContain(result.agent_name);

      clearSessionState(ctx.sessionID);
    });

    it("generates unique agent name when not provided", async () => {
      const ctx1 = createTestContext();
      const ctx2 = createTestContext();

      const result1 = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH },
        ctx1,
      );

      const result2 = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH },
        ctx2,
      );

      // Both should have adjective+noun style names
      expect(result1.agent_name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
      expect(result2.agent_name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
      expect(result1.agent_name).not.toBe(result2.agent_name);

      clearSessionState(ctx1.sessionID);
      clearSessionState(ctx2.sessionID);
    });

    it("uses provided agent name when specified", async () => {
      const ctx = createTestContext();
      const customName = "BlueLake";

      const result = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: customName },
        ctx,
      );

      expect(result.agent_name).toBe(customName);

      clearSessionState(ctx.sessionID);
    });

    it("returns existing session if already initialized", async () => {
      const ctx = createTestContext();

      const result1 = await executeTool<{
        agent_name: string;
        already_initialized?: boolean;
      }>(swarmmail_init, { project_path: TEST_DB_PATH }, ctx);

      const result2 = await executeTool<{
        agent_name: string;
        already_initialized?: boolean;
      }>(swarmmail_init, { project_path: TEST_DB_PATH }, ctx);

      expect(result1.agent_name).toBe(result2.agent_name);
      expect(result2.already_initialized).toBe(true);

      clearSessionState(ctx.sessionID);
    });
  });

  // ============================================================================
  // Messaging Tests
  // ============================================================================

  describe("swarmmail_send", () => {
    it("sends message to another agent", async () => {
      const senderCtx = createTestContext();
      const recipientCtx = createTestContext();

      // Initialize both agents
      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "Sender" },
        senderCtx,
      );

      const recipient = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "Recipient" },
        recipientCtx,
      );

      // Send message
      const result = await executeTool<{
        success: boolean;
        message_id: number;
        thread_id?: string;
        recipient_count: number;
      }>(
        swarmmail_send,
        {
          to: [recipient.agent_name],
          subject: "Test message",
          body: "This is a test message body",
          thread_id: "bd-test-123",
          importance: "normal",
        },
        senderCtx,
      );

      expect(result.success).toBe(true);
      expect(result.message_id).toBeGreaterThan(0);
      expect(result.thread_id).toBe("bd-test-123");
      expect(result.recipient_count).toBe(1);

      clearSessionState(senderCtx.sessionID);
      clearSessionState(recipientCtx.sessionID);
    });

    it("sends urgent message with ack_required", async () => {
      const senderCtx = createTestContext();
      const recipientCtx = createTestContext();

      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "UrgentSender" },
        senderCtx,
      );

      const recipient = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "UrgentRecipient" },
        recipientCtx,
      );

      const result = await executeTool<{
        success: boolean;
        message_id: number;
      }>(
        swarmmail_send,
        {
          to: [recipient.agent_name],
          subject: "Urgent: Action required",
          body: "Please acknowledge this message",
          importance: "urgent",
          ack_required: true,
        },
        senderCtx,
      );

      expect(result.success).toBe(true);
      expect(result.message_id).toBeGreaterThan(0);

      clearSessionState(senderCtx.sessionID);
      clearSessionState(recipientCtx.sessionID);
    });

    it("returns error when not initialized", async () => {
      const ctx = createTestContext();

      const result = await executeTool<{ error?: string }>(
        swarmmail_send,
        {
          to: ["SomeAgent"],
          subject: "Test",
          body: "Body",
        },
        ctx,
      );

      expect(result.error).toContain("not initialized");

      clearSessionState(ctx.sessionID);
    });
  });

  // ============================================================================
  // Inbox Tests
  // ============================================================================

  describe("swarmmail_inbox", () => {
    it("fetches messages without bodies by default (context-safe)", async () => {
      const senderCtx = createTestContext();
      const recipientCtx = createTestContext();

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "InboxSender" },
        senderCtx,
      );

      const recipient = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "InboxRecipient" },
        recipientCtx,
      );

      // Send a message
      await executeTool(
        swarmmail_send,
        {
          to: [recipient.agent_name],
          subject: "Inbox test message",
          body: "This body should NOT be included by default",
        },
        senderCtx,
      );

      // Fetch inbox
      const result = await executeTool<{
        messages: Array<{
          id: number;
          from: string;
          subject: string;
          body?: string;
        }>;
        total: number;
        note: string;
      }>(swarmmail_inbox, {}, recipientCtx);

      expect(result.messages.length).toBeGreaterThan(0);
      const testMsg = result.messages.find(
        (m) => m.subject === "Inbox test message",
      );
      expect(testMsg).toBeDefined();
      expect(testMsg?.from).toBe("InboxSender");
      // Body should NOT be included
      expect(testMsg?.body).toBeUndefined();
      expect(result.note).toContain("swarmmail_read_message");

      clearSessionState(senderCtx.sessionID);
      clearSessionState(recipientCtx.sessionID);
    });

    it("enforces MAX_INBOX_LIMIT (5) constraint", async () => {
      const senderCtx = createTestContext();
      const recipientCtx = createTestContext();

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "LimitSender" },
        senderCtx,
      );

      const recipient = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "LimitRecipient" },
        recipientCtx,
      );

      // Send 8 messages (more than limit)
      for (let i = 0; i < 8; i++) {
        await executeTool(
          swarmmail_send,
          {
            to: [recipient.agent_name],
            subject: `Limit test message ${i}`,
            body: `Message body ${i}`,
          },
          senderCtx,
        );
      }

      // Request 10 messages (should be capped at 5)
      const result = await executeTool<{
        messages: Array<{ id: number }>;
      }>(swarmmail_inbox, { limit: 10 }, recipientCtx);

      // Should be capped at 5
      expect(result.messages.length).toBeLessThanOrEqual(5);

      clearSessionState(senderCtx.sessionID);
      clearSessionState(recipientCtx.sessionID);
    });

    it("filters urgent messages when urgent_only is true", async () => {
      const senderCtx = createTestContext();
      const recipientCtx = createTestContext();

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "UrgentFilterSender" },
        senderCtx,
      );

      const recipient = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "UrgentFilterRecipient" },
        recipientCtx,
      );

      // Send normal and urgent messages
      await executeTool(
        swarmmail_send,
        {
          to: [recipient.agent_name],
          subject: "Normal message",
          body: "Not urgent",
          importance: "normal",
        },
        senderCtx,
      );

      await executeTool(
        swarmmail_send,
        {
          to: [recipient.agent_name],
          subject: "Urgent message",
          body: "Very urgent!",
          importance: "urgent",
        },
        senderCtx,
      );

      // Fetch only urgent messages
      const result = await executeTool<{
        messages: Array<{ subject: string; importance: string }>;
      }>(swarmmail_inbox, { urgent_only: true }, recipientCtx);

      // All returned messages should be urgent
      for (const msg of result.messages) {
        expect(msg.importance).toBe("urgent");
      }
      expect(result.messages.some((m) => m.subject === "Urgent message")).toBe(
        true,
      );

      clearSessionState(senderCtx.sessionID);
      clearSessionState(recipientCtx.sessionID);
    });
  });

  // ============================================================================
  // Read Message Tests
  // ============================================================================

  describe("swarmmail_read_message", () => {
    it("returns full message body when reading by ID", async () => {
      const senderCtx = createTestContext();
      const recipientCtx = createTestContext();

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "ReadSender" },
        senderCtx,
      );

      const recipient = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "ReadRecipient" },
        recipientCtx,
      );

      // Send a message
      const sent = await executeTool<{ message_id: number }>(
        swarmmail_send,
        {
          to: [recipient.agent_name],
          subject: "Read test message",
          body: "This message body should be returned",
        },
        senderCtx,
      );

      // Read the message
      const result = await executeTool<{
        id: number;
        from: string;
        subject: string;
        body: string;
      }>(swarmmail_read_message, { message_id: sent.message_id }, recipientCtx);

      expect(result.id).toBe(sent.message_id);
      expect(result.from).toBe("ReadSender");
      expect(result.subject).toBe("Read test message");
      expect(result.body).toBe("This message body should be returned");

      clearSessionState(senderCtx.sessionID);
      clearSessionState(recipientCtx.sessionID);
    });

    it("returns error when message not found", async () => {
      const ctx = createTestContext();

      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "NotFoundAgent" },
        ctx,
      );

      const result = await executeTool<{ error?: string }>(
        swarmmail_read_message,
        { message_id: 99999 },
        ctx,
      );

      expect(result.error).toContain("not found");

      clearSessionState(ctx.sessionID);
    });
  });

  // ============================================================================
  // File Reservation Tests
  // ============================================================================

  describe("swarmmail_reserve", () => {
    it("grants file reservations", async () => {
      const ctx = createTestContext();

      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "ReserveAgent" },
        ctx,
      );

      const result = await executeTool<{
        granted: Array<{
          id: number;
          path_pattern: string;
          exclusive: boolean;
        }>;
        conflicts?: Array<{ path: string; holders: string[] }>;
      }>(
        swarmmail_reserve,
        {
          paths: ["src/auth/**", "src/config.ts"],
          reason: "bd-test-123: Working on auth",
          exclusive: true,
          ttl_seconds: 3600,
        },
        ctx,
      );

      expect(result.granted.length).toBe(2);
      expect(result.conflicts).toBeUndefined();
      expect(result.granted[0].exclusive).toBe(true);

      clearSessionState(ctx.sessionID);
    });

    it("detects conflicts with exclusive reservations", async () => {
      const agent1Ctx = createTestContext();
      const agent2Ctx = createTestContext();

      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "ConflictAgent1" },
        agent1Ctx,
      );

      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "ConflictAgent2" },
        agent2Ctx,
      );

      const conflictPath = "src/conflict.ts";

      // Agent 1 reserves the file
      const result1 = await executeTool<{
        granted: Array<{ id: number }>;
      }>(
        swarmmail_reserve,
        {
          paths: [conflictPath],
          exclusive: true,
        },
        agent1Ctx,
      );

      expect(result1.granted.length).toBe(1);

      // Agent 2 tries to reserve the same file
      const result2 = await executeTool<{
        granted: Array<{ id: number }>;
        conflicts?: Array<{ path: string; holders: string[] }>;
        warning?: string;
      }>(
        swarmmail_reserve,
        {
          paths: [conflictPath],
          exclusive: true,
        },
        agent2Ctx,
      );

      // Should still grant but report conflicts
      expect(result2.granted.length).toBeGreaterThan(0);
      expect(result2.conflicts).toBeDefined();
      expect(result2.conflicts?.length).toBeGreaterThan(0);
      expect(result2.warning).toContain("already reserved");

      clearSessionState(agent1Ctx.sessionID);
      clearSessionState(agent2Ctx.sessionID);
    });

    it("returns error when not initialized", async () => {
      const ctx = createTestContext();

      const result = await executeTool<{ error?: string }>(
        swarmmail_reserve,
        {
          paths: ["src/test.ts"],
        },
        ctx,
      );

      expect(result.error).toContain("not initialized");

      clearSessionState(ctx.sessionID);
    });
  });

  // ============================================================================
  // Release Reservation Tests
  // ============================================================================

  describe("swarmmail_release", () => {
    it("releases all reservations for an agent", async () => {
      const ctx = createTestContext();

      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "ReleaseAgent" },
        ctx,
      );

      // Create reservations
      await executeTool(
        swarmmail_reserve,
        {
          paths: ["src/release-test-1.ts", "src/release-test-2.ts"],
          exclusive: true,
        },
        ctx,
      );

      // Release all
      const result = await executeTool<{
        released: number;
        released_at: string;
      }>(swarmmail_release, {}, ctx);

      expect(result.released).toBe(2);
      expect(result.released_at).toBeTruthy();

      clearSessionState(ctx.sessionID);
    });

    it("releases specific paths only", async () => {
      const ctx = createTestContext();

      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "SpecificReleaseAgent" },
        ctx,
      );

      const path1 = "src/specific-release-1.ts";
      const path2 = "src/specific-release-2.ts";

      // Create reservations
      await executeTool(
        swarmmail_reserve,
        {
          paths: [path1, path2],
          exclusive: true,
        },
        ctx,
      );

      // Release only one path
      const result = await executeTool<{ released: number }>(
        swarmmail_release,
        { paths: [path1] },
        ctx,
      );

      expect(result.released).toBe(1);

      clearSessionState(ctx.sessionID);
    });

    it("releases by reservation IDs", async () => {
      const ctx = createTestContext();

      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "IdReleaseAgent" },
        ctx,
      );

      // Create reservations
      const reserve = await executeTool<{
        granted: Array<{ id: number }>;
      }>(
        swarmmail_reserve,
        {
          paths: ["src/id-release-1.ts", "src/id-release-2.ts"],
          exclusive: true,
        },
        ctx,
      );

      const firstId = reserve.granted[0].id;

      // Release by ID
      const result = await executeTool<{ released: number }>(
        swarmmail_release,
        { reservation_ids: [firstId] },
        ctx,
      );

      expect(result.released).toBe(1);

      clearSessionState(ctx.sessionID);
    });
  });

  // ============================================================================
  // Acknowledge Message Tests
  // ============================================================================

  describe("swarmmail_ack", () => {
    it("acknowledges a message requiring acknowledgement", async () => {
      const senderCtx = createTestContext();
      const recipientCtx = createTestContext();

      const sender = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "AckSender" },
        senderCtx,
      );

      const recipient = await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "AckRecipient" },
        recipientCtx,
      );

      // Send message requiring ack
      const sent = await executeTool<{ message_id: number }>(
        swarmmail_send,
        {
          to: [recipient.agent_name],
          subject: "Please acknowledge",
          body: "This requires acknowledgement",
          ack_required: true,
        },
        senderCtx,
      );

      // Acknowledge
      const result = await executeTool<{
        acknowledged: boolean;
        acknowledged_at: string;
      }>(swarmmail_ack, { message_id: sent.message_id }, recipientCtx);

      expect(result.acknowledged).toBe(true);
      expect(result.acknowledged_at).toBeTruthy();

      clearSessionState(senderCtx.sessionID);
      clearSessionState(recipientCtx.sessionID);
    });
  });

  // ============================================================================
  // Multi-Agent Coordination Tests
  // ============================================================================

  describe("multi-agent coordination", () => {
    it("enables communication between multiple agents", async () => {
      const coordCtx = createTestContext();
      const worker1Ctx = createTestContext();
      const worker2Ctx = createTestContext();

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "Coordinator" },
        coordCtx,
      );

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "Worker1" },
        worker1Ctx,
      );

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "Worker2" },
        worker2Ctx,
      );

      // Coordinator broadcasts to workers
      await executeTool(
        swarmmail_send,
        {
          to: ["Worker1", "Worker2"],
          subject: "Task assignment",
          body: "Please complete your subtasks",
          thread_id: "bd-epic-123",
          importance: "high",
        },
        coordCtx,
      );

      // Verify both workers received the message
      const worker1Inbox = await executeTool<{
        messages: Array<{ subject: string }>;
      }>(swarmmail_inbox, {}, worker1Ctx);

      const worker2Inbox = await executeTool<{
        messages: Array<{ subject: string }>;
      }>(swarmmail_inbox, {}, worker2Ctx);

      expect(
        worker1Inbox.messages.some((m) => m.subject === "Task assignment"),
      ).toBe(true);
      expect(
        worker2Inbox.messages.some((m) => m.subject === "Task assignment"),
      ).toBe(true);

      clearSessionState(coordCtx.sessionID);
      clearSessionState(worker1Ctx.sessionID);
      clearSessionState(worker2Ctx.sessionID);
    });

    it("prevents file conflicts in swarm scenarios", async () => {
      const worker1Ctx = createTestContext();
      const worker2Ctx = createTestContext();

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "SwarmWorker1" },
        worker1Ctx,
      );

      await executeTool<{ agent_name: string }>(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "SwarmWorker2" },
        worker2Ctx,
      );

      const path1 = "src/swarm/file1.ts";
      const path2 = "src/swarm/file2.ts";

      // Worker 1 reserves file 1
      const res1 = await executeTool<{
        granted: Array<{ id: number }>;
        conflicts?: unknown[];
      }>(
        swarmmail_reserve,
        {
          paths: [path1],
          exclusive: true,
          reason: "bd-subtask-1",
        },
        worker1Ctx,
      );

      // Worker 2 reserves file 2
      const res2 = await executeTool<{
        granted: Array<{ id: number }>;
        conflicts?: unknown[];
      }>(
        swarmmail_reserve,
        {
          paths: [path2],
          exclusive: true,
          reason: "bd-subtask-2",
        },
        worker2Ctx,
      );

      // Both should succeed (no conflicts)
      expect(res1.granted.length).toBe(1);
      expect(res1.conflicts).toBeUndefined();
      expect(res2.granted.length).toBe(1);
      expect(res2.conflicts).toBeUndefined();

      // Worker 1 tries to reserve file 2 (should conflict)
      const conflict = await executeTool<{
        granted?: Array<{ id: number }>;
        conflicts?: Array<{ path: string; holders: string[] }>;
        warning?: string;
      }>(
        swarmmail_reserve,
        {
          paths: [path2],
          exclusive: true,
        },
        worker1Ctx,
      );

      expect(conflict.conflicts).toBeDefined();
      expect(conflict.conflicts?.length).toBeGreaterThan(0);
      expect(conflict.warning).toContain("already reserved");

      clearSessionState(worker1Ctx.sessionID);
      clearSessionState(worker2Ctx.sessionID);
    });
  });
});
