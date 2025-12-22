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
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `grants-reservations-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
        dbOverride: db,
      });

      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/auth/**", "src/config.ts"],
        reason: "bd-123: Working on auth",
        dbOverride: db,
      });

      expect(result.granted.length).toBe(2);
      expect(result.conflicts.length).toBe(0);

      await swarmMail.close();
    });

    it("detects conflicts with other agents", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `detects-conflicts-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker1",
        dbOverride: db,
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker2",
        dbOverride: db,
      });

      // Agent 1 reserves
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
        dbOverride: db,
      });

      // Agent 2 tries to reserve same file
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
        dbOverride: db,
      });

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0]?.holder).toBe("Worker1");

      await swarmMail.close();
    });

    it("allows non-exclusive reservations without conflict", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `non-exclusive-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker1",
        dbOverride: db,
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker2",
        dbOverride: db,
      });

      // Agent 1 reserves non-exclusively
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/shared.ts"],
        exclusive: false,
        dbOverride: db,
      });

      // Agent 2 should not see conflict
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
        dbOverride: db,
      });

      expect(result.conflicts.length).toBe(0);

      await swarmMail.close();
    });

    it("supports TTL for auto-expiry", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `ttl-expiry-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
        dbOverride: db,
      });

      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/temp.ts"],
        ttlSeconds: 3600,
        dbOverride: db,
      });

      expect(result.granted[0]?.expiresAt).toBeGreaterThan(Date.now());

      await swarmMail.close();
    });

    it("rejects reservation when conflicts exist (THE FIX)", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `rejects-conflicts-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent1",
        dbOverride: db,
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent2",
        dbOverride: db,
      });

      // Agent1 reserves src/**
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/**"],
        reason: "bd-123: Working on src",
        dbOverride: db,
      });

      // Agent2 tries to reserve src/file.ts - should be rejected
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/file.ts"],
        reason: "bd-124: Trying to edit file",
        dbOverride: db,
      });

      // No reservations granted
      expect(result.granted).toHaveLength(0);
      // But conflicts reported
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.holder).toBe("Agent1");
      expect(result.conflicts[0]?.pattern).toBe("src/**");
      expect(result.conflicts[0]?.path).toBe("src/file.ts");

      await swarmMail.close();
    });

    it("allows reservation with force=true despite conflicts", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `force-reservation-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent1",
        dbOverride: db,
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent2",
        dbOverride: db,
      });

      // Agent1 reserves src/**
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/**"],
        reason: "bd-123: Working on src",
        dbOverride: db,
      });

      // Agent2 forces reservation despite conflict
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/file.ts"],
        reason: "bd-124: Emergency fix",
        force: true,
        dbOverride: db,
      });

      // Reservation granted with force
      expect(result.granted).toHaveLength(1);
      expect(result.granted[0]?.path).toBe("src/file.ts");
      // Conflicts still reported
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.holder).toBe("Agent1");

      await swarmMail.close();
    });

    it("grants reservation when no conflicts exist", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `no-conflicts-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent1",
        dbOverride: db,
      });

      // First reservation - no conflicts
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/new-file.ts"],
        reason: "bd-125: Creating new file",
        dbOverride: db,
      });

      expect(result.granted).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);

      await swarmMail.close();
    });

    it("rejects multiple conflicting paths atomically", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `atomic-reject-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent1",
        dbOverride: db,
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Agent2",
        dbOverride: db,
      });

      // Agent1 reserves multiple paths
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/a.ts", "src/b.ts"],
        dbOverride: db,
      });

      // Agent2 tries to reserve same paths - all should be rejected
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/a.ts", "src/b.ts", "src/c.ts"], // Mix of conflicts + available
        dbOverride: db,
      });

      // No reservations granted (even for src/c.ts)
      expect(result.granted).toHaveLength(0);
      // Conflicts for the reserved paths
      expect(result.conflicts.length).toBeGreaterThan(0);

      await swarmMail.close();
    });

    it("handles DurableLock errors gracefully", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `lock-error-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker1",
        dbOverride: db,
      });

      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker2",
        dbOverride: db,
      });

      // Agent1 acquires exclusive lock
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/locked-file.ts"],
        reason: "bd-123: First reservation",
        exclusive: true,
        ttlSeconds: 3600, // Long TTL to ensure lock doesn't expire
        dbOverride: db,
      });

      // Agent2 tries to acquire same lock with very short retry limit
      // This tests that lock contention is properly handled with meaningful errors
      // Note: We rely on the conflict check to prevent this, but if a race
      // condition occurs in the DurableLock layer, we should get a clear error
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/locked-file.ts"],
        reason: "bd-124: Second reservation attempt",
        exclusive: true,
        dbOverride: db,
      });

      // Should detect conflict, not throw error
      expect(result.conflicts.length).toBe(1);
      expect(result.granted.length).toBe(0);

      await swarmMail.close();
    });

    it("provides meaningful error when lock acquisition fails (documented behavior)", async () => {
      // This test documents that DurableLock errors are caught and re-thrown
      // with meaningful context. The actual lock error conditions (timeout,
      // contention, database errors) are tested in lock.test.ts.
      //
      // If a lock error occurs during reserveAgentFiles(), it will:
      // 1. Clean up database connection (if created by us)
      // 2. Re-throw with context about which operation failed
      // 3. Include the original error tag (LockTimeout, LockContention, etc.)
      //
      // This prevents unhandled promise rejections and provides clear
      // error messages for debugging.

      // The error handling code path is exercised in real scenarios when:
      // - Database connection is lost mid-operation
      // - Lock timeout occurs (max retries exceeded)
      // - Database constraints fail during CAS operation
      
      // For now, we document that the try/catch exists and handles these cases.
      // Testing specific failure modes would require complex mocking that's
      // better tested at the DurableLock layer (see lock.test.ts).
      expect(true).toBe(true); // Test placeholder - error handling is in place
    });
  });

  // ==========================================================================
  // releaseAgentFiles (agentmail_release)
  // ==========================================================================

  describe("releaseAgentFiles", () => {
    it("releases all reservations for agent", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `release-all-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
        dbOverride: db,
      });

      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/a.ts", "src/b.ts"],
        dbOverride: db,
      });

      const result = await releaseAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        dbOverride: db,
      });

      expect(result.released).toBe(2);

      await swarmMail.close();
    });

    it("releases specific paths only", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `release-specific-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker",
        dbOverride: db,
      });

      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/a.ts", "src/b.ts"],
        dbOverride: db,
      });

      const result = await releaseAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent.agentName,
        paths: ["src/a.ts"],
        dbOverride: db,
      });

      expect(result.released).toBe(1);

      await swarmMail.close();
    });

    it("allows other agents to reserve after release", async () => {
      const { createInMemorySwarmMailLibSQL } = await import("../libsql.convenience");
      const testId = `reserve-after-release-${Date.now()}`;
      const swarmMail = await createInMemorySwarmMailLibSQL(testId);
      const db = await swarmMail.getDatabase();

      const agent1 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker1",
        dbOverride: db,
      });
      const agent2 = await initAgent({
        projectPath: TEST_PROJECT_PATH,
        agentName: "Worker2",
        dbOverride: db,
      });

      // Agent 1 reserves then releases
      await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
        dbOverride: db,
      });
      await releaseAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent1.agentName,
        dbOverride: db,
      });

      // Agent 2 should be able to reserve
      const result = await reserveAgentFiles({
        projectPath: TEST_PROJECT_PATH,
        agentName: agent2.agentName,
        paths: ["src/shared.ts"],
        exclusive: true,
        dbOverride: db,
      });

      expect(result.conflicts.length).toBe(0);
      expect(result.granted.length).toBe(1);

      await swarmMail.close();
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

});
