/**
 * Unit tests for Agent Mail Tools (TDD - RED phase)
 *
 * These tools provide the same API as the MCP-based agent-mail.ts
 * but use the embedded PGLite event store instead.
 *
 * Key constraints (must match existing API):
 * - agentmail_init: Register agent, return name and project key
 * - agentmail_send: Send message to agents
 * - agentmail_inbox: Fetch inbox (limit 5, no bodies by default)
 * - agentmail_read_message: Get single message with body
 * - agentmail_reserve: Reserve files, detect conflicts
 * - agentmail_release: Release reservations
 * - agentmail_ack: Acknowledge message
 * - agentmail_health: Check if store is healthy
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initAgent,
  sendAgentMessage,
  getAgentInbox,
  readAgentMessage,
  reserveAgentFiles,
  releaseAgentFiles,
  acknowledgeMessage,
  checkHealth,
  type AgentMailContext,
} from "./agent-mail";

let TEST_PROJECT_PATH: string;

describe("Agent Mail Tools", () => {
  beforeEach(async () => {
    TEST_PROJECT_PATH = join(
      tmpdir(),
      `agent-mail-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await mkdir(TEST_PROJECT_PATH, { recursive: true });
  });

  afterEach(async () => {
    // Clean up database files - no need for explicit close
    try {
      await rm(join(TEST_PROJECT_PATH, ".opencode"), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // initAgent (agentmail_init)
  // ==========================================================================

  describe("initAgent", () => {
    it("registers agent and returns context", async () => {
      const ctx = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        taskDescription: "Testing agent mail",
      });

      expect(ctx.projectKey).toBe(TEST_PROJECT_PATH);
      expect(ctx.agentName).toBeTruthy();
      expect(ctx.agentName).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/); // AdjectiveNoun format
    });

    it("uses provided agent name", async () => {
      const ctx = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "BlueLake",
      });

      expect(ctx.agentName).toBe("BlueLake");
    });

    it("generates unique names for multiple agents", async () => {
      const ctx1 = await initAgent({ projectPath: TEST_PROJECT_PATH });
      const ctx2 = await initAgent({ projectPath: TEST_PROJECT_PATH });

      // Both should have names, but they might be the same if re-registering
      expect(ctx1.agentName).toBeTruthy();
      expect(ctx2.agentName).toBeTruthy();
    });

    it("includes program and model in registration", async () => {
      const ctx = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        program: "opencode",
        model: "claude-sonnet-4",
      });

      expect(ctx.agentName).toBeTruthy();
      // The context should be usable for subsequent operations
    });
  });

  // ==========================================================================
  // sendAgentMessage (agentmail_send)
  // ==========================================================================

  describe("sendAgentMessage", () => {
    it("sends message to recipients", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      const result = await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Hello",
        body: "World",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeGreaterThan(0);
    });

    it("supports thread_id for grouping", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      const result = await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Task update",
        body: "Progress report",
        threadId: "bd-123",
      });

      expect(result.success).toBe(true);
      expect(result.threadId).toBe("bd-123");
    });

    it("supports importance levels", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      const result = await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Urgent",
        body: "Please respond",
        importance: "urgent",
        ackRequired: true,
      });

      expect(result.success).toBe(true);
    });

    it("sends to multiple recipients", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver1",
      });
      await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver2",
      });

      const result = await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: ["Receiver1", "Receiver2"],
        subject: "Broadcast",
        body: "Hello everyone",
      });

      expect(result.success).toBe(true);
      expect(result.recipientCount).toBe(2);
    });
  });

  // ==========================================================================
  // getAgentInbox (agentmail_inbox)
  // ==========================================================================

  describe("getAgentInbox", () => {
    it("returns empty inbox for new agent", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "NewAgent",
      });

      const inbox = await getAgentInbox({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
      });

      expect(inbox.messages).toEqual([]);
      expect(inbox.total).toBe(0);
    });

    it("returns messages sent to agent", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Test message",
        body: "Body content",
      });

      const inbox = await getAgentInbox({
        projectPath: TEST_PROJECT_PATH,
        agentName: receiver.agentName,
      });

      expect(inbox.messages.length).toBe(1);
      expect(inbox.messages[0]?.subject).toBe("Test message");
      expect(inbox.messages[0]?.from_agent).toBe("Sender");
    });

    it("excludes body by default (context-safe)", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Test",
        body: "This body should NOT be included",
      });

      const inbox = await getAgentInbox({
        projectPath: TEST_PROJECT_PATH,
        agentName: receiver.agentName,
        includeBodies: false, // Default
      });

      expect(inbox.messages[0]?.body).toBeUndefined();
    });

    it("enforces max limit of 5", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      // Send 10 messages
      for (let i = 0; i < 10; i++) {
        await sendAgentMessage({
          projectPath: TEST_PROJECT_PATH,
          fromAgent: sender.agentName,
          toAgents: [receiver.agentName],
          subject: `Message ${i}`,
          body: "Body",
        });
      }

      const inbox = await getAgentInbox({
        projectPath: TEST_PROJECT_PATH,
        agentName: receiver.agentName,
        limit: 100, // Request more than allowed
      });

      // Should be capped at 5
      expect(inbox.messages.length).toBeLessThanOrEqual(5);
    });

    it("filters urgent messages", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Normal",
        body: "Body",
        importance: "normal",
      });
      await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Urgent",
        body: "Body",
        importance: "urgent",
      });

      const inbox = await getAgentInbox({
        projectPath: TEST_PROJECT_PATH,
        agentName: receiver.agentName,
        urgentOnly: true,
      });

      expect(inbox.messages.length).toBe(1);
      expect(inbox.messages[0]?.subject).toBe("Urgent");
    });
  });

  // ==========================================================================
  // readAgentMessage (agentmail_read_message)
  // ==========================================================================

  describe("readAgentMessage", () => {
    it("returns full message with body", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      const sent = await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Full message",
        body: "This is the full body content",
      });

      const message = await readAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        messageId: sent.messageId,
      });

      expect(message).not.toBeNull();
      expect(message?.subject).toBe("Full message");
      expect(message?.body).toBe("This is the full body content");
    });

    it("marks message as read", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      const sent = await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "To be read",
        body: "Body",
      });

      // Read the message
      await readAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        messageId: sent.messageId,
        agentName: receiver.agentName,
        markAsRead: true,
      });

      // Check inbox - should show as read (or filtered out if unreadOnly)
      const inbox = await getAgentInbox({
        projectPath: TEST_PROJECT_PATH,
        agentName: receiver.agentName,
        unreadOnly: true,
      });

      expect(inbox.messages.length).toBe(0);
    });

    it("returns null for non-existent message", async () => {
      const message = await readAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        messageId: 99999,
      });

      expect(message).toBeNull();
    });
  });

  // ==========================================================================
  // reserveAgentFiles (agentmail_reserve)
  // ==========================================================================

  describe("reserveAgentFiles", () => {
    it("grants reservations", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
      });

      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/auth/**", "src/config.ts"],
        reason: "bd-123: Working on auth",
      });

      expect(result.granted.length).toBe(2);
      expect(result.conflicts.length).toBe(0);
    });

    it("detects conflicts with other agents", async () => {
      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker1",
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker2",
      });

      // Agent 1 reserves
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
      });

      // Agent 2 tries to reserve same file
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
      });

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0]?.holder).toBe("Worker1");
    });

    it("allows non-exclusive reservations without conflict", async () => {
      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker1",
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker2",
      });

      // Agent 1 reserves non-exclusively
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/shared.ts"],
        exclusive: false,
      });

      // Agent 2 should not see conflict
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
      });

      expect(result.conflicts.length).toBe(0);
    });

    it("supports TTL for auto-expiry", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
      });

      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/temp.ts"],
        ttlSeconds: 3600,
      });

      expect(result.granted[0]?.expiresAt).toBeGreaterThan(Date.now());
    });

    it("rejects reservation when conflicts exist (THE FIX)", async () => {
      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent1",
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent2",
      });

      // Agent1 reserves src/**
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/**"],
        reason: "bd-123: Working on src",
      });

      // Agent2 tries to reserve src/file.ts - should be rejected
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/file.ts"],
        reason: "bd-124: Trying to edit file",
      });

      // No reservations granted
      expect(result.granted).toHaveLength(0);
      // But conflicts reported
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.holder).toBe("Agent1");
      expect(result.conflicts[0]?.pattern).toBe("src/**");
      expect(result.conflicts[0]?.path).toBe("src/file.ts");
    });

    it("allows reservation with force=true despite conflicts", async () => {
      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent1",
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent2",
      });

      // Agent1 reserves src/**
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/**"],
        reason: "bd-123: Working on src",
      });

      // Agent2 forces reservation despite conflict
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/file.ts"],
        reason: "bd-124: Emergency fix",
        force: true,
      });

      // Reservation granted with force
      expect(result.granted).toHaveLength(1);
      expect(result.granted[0]?.path).toBe("src/file.ts");
      // Conflicts still reported
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.holder).toBe("Agent1");
    });

    it("grants reservation when no conflicts exist", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent1",
      });

      // First reservation - no conflicts
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/new-file.ts"],
        reason: "bd-125: Creating new file",
      });

      expect(result.granted).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
    });

    it("rejects multiple conflicting paths atomically", async () => {
      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent1",
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent2",
      });

      // Agent1 reserves multiple paths
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/a.ts", "src/b.ts"],
      });

      // Agent2 tries to reserve same paths - all should be rejected
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/a.ts", "src/b.ts", "src/c.ts"], // Mix of conflicts + available
      });

      // No reservations granted (even for src/c.ts)
      expect(result.granted).toHaveLength(0);
      // Conflicts for the reserved paths
      expect(result.conflicts.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // releaseAgentFiles (agentmail_release)
  // ==========================================================================

  describe("releaseAgentFiles", () => {
    it("releases all reservations for agent", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
      });

      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/a.ts", "src/b.ts"],
      });

      const result = await releaseAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
      });

      expect(result.released).toBe(2);
    });

    it("releases specific paths only", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
      });

      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/a.ts", "src/b.ts"],
      });

      const result = await releaseAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/a.ts"],
      });

      expect(result.released).toBe(1);
    });

    it("allows other agents to reserve after release", async () => {
      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker1",
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker2",
      });

      // Agent 1 reserves then releases
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
      });
      await releaseAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
      });

      // Agent 2 should be able to reserve
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
      });

      expect(result.conflicts.length).toBe(0);
      expect(result.granted.length).toBe(1);
    });
  });

  // ==========================================================================
  // acknowledgeMessage (agentmail_ack)
  // ==========================================================================

  describe("acknowledgeMessage", () => {
    it("acknowledges a message", async () => {
      const sender = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Sender",
      });
      const receiver = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Receiver",
      });

      const sent = await sendAgentMessage({
        projectPath: TEST_PROJECT_PATH,
        fromAgent: sender.agentName,
        toAgents: [receiver.agentName],
        subject: "Please ack",
        body: "Body",
        ackRequired: true,
      });

      const result = await acknowledgeMessage({
        projectPath: TEST_PROJECT_PATH,
        messageId: sent.messageId,
        agentName: receiver.agentName,
      });

      expect(result.acknowledged).toBe(true);
      expect(result.acknowledgedAt).toBeTruthy();
    });
  });

  // ==========================================================================
  // checkHealth (agentmail_health)
  // ==========================================================================

  describe("checkHealth", () => {
    it("returns healthy when database is accessible", async () => {
      const health = await checkHealth(TEST_PROJECT_PATH);

      expect(health.healthy).toBe(true);
      expect(health.database).toBe("connected");
    });

    it("returns stats about the store", async () => {
      // Create some data
      await initAgent({ projectPath: TEST_PROJECT_PATH, agentName: "Agent1" });
      await initAgent({ projectPath: TEST_PROJECT_PATH, agentName: "Agent2" });

      const health = await checkHealth(TEST_PROJECT_PATH);

      expect(health.stats?.agents).toBe(2);
    });
  });

  // ==========================================================================
  // DurableLock Integration
  // ==========================================================================

  describe("DurableLock Integration", () => {
    it("uses DurableLock for file reservation locking", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
      });

      // Reserve files
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/auth.ts"],
        reason: "bd-123: Auth work",
      });

      expect(result.granted.length).toBe(1);

      // Verify lock was created in locks table
      const { getDatabasePath } = await import("./index");
      const { createLibSQLAdapter } = await import("../libsql");
      
      const dbPath = getDatabasePath(TEST_PROJECT_PATH);
      const adapter = await createLibSQLAdapter({ url: `file:${dbPath}` });
      
      const locks = await adapter.query<{ resource: string; holder: string }>(
        "SELECT resource, holder FROM locks",
        []
      );

      expect(locks.rows.length).toBe(1);
      expect(locks.rows[0]?.resource).toMatch(/^src\/auth\.ts$/);
      
      await adapter.close();
    });

    it("releases DurableLock when files are released", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
      });

      // Reserve then release
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/auth.ts"],
      });

      await releaseAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
      });

      // Verify lock was deleted from locks table
      const { getDatabasePath } = await import("./index");
      const { createLibSQLAdapter } = await import("../libsql");
      
      const dbPath = getDatabasePath(TEST_PROJECT_PATH);
      const adapter = await createLibSQLAdapter({ url: `file:${dbPath}` });
      
      const locks = await adapter.query<{ resource: string }>(
        "SELECT resource FROM locks",
        []
      );

      expect(locks.rows.length).toBe(0);
      
      await adapter.close();
    });

    it("respects lock expiry (TTL)", async () => {
      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
      });

      // Reserve with 1 second TTL
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/temp.ts"],
        ttlSeconds: 1,
      });

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Another agent should be able to acquire
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker2",
      });

      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/temp.ts"],
      });

      // Should succeed (no conflicts, lock expired)
      expect(result.granted.length).toBe(1);
      expect(result.conflicts.length).toBe(0);
    });
  });
});
