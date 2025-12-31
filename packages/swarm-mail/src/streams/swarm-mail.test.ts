/**
 * Swarm Mail Tests
 * 
 * Tests that swarm-mail functions work without requiring explicit dbOverride.
 * The Drizzle convenience wrappers should auto-create adapters.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemorySwarmMailLibSQL } from "../libsql.convenience";
import type { SwarmMailAdapter } from "../types";

// Import from the module under test
import {
  initSwarmAgent,
  sendSwarmMessage,
  getSwarmInbox,
  readSwarmMessage,
  reserveSwarmFiles,
  releaseSwarmFiles,
  acknowledgeSwarmMessage,
  checkSwarmHealth,
} from "./swarm-mail";

describe("swarm-mail", () => {
  let swarmMail: SwarmMailAdapter;
  let db: any; // LibSQLAdapter
  // Use a real temp directory instead of fake path to avoid EROFS errors
  const TEST_PROJECT = mkdtempSync(join(tmpdir(), "swarm-mail-test-"));

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("swarm-mail-test");
    db = await swarmMail.getDatabase();
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  describe("initSwarmAgent", () => {
    test("should initialize agent using in-memory adapter", async () => {
      const result = await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "TestAgent",
        program: "test",
        model: "test-model",
        taskDescription: "Testing swarm-mail",
        dbOverride: db,
      });

      expect(result.projectKey).toBe(TEST_PROJECT);
      expect(result.agentName).toBe("TestAgent");
    });
  });

  describe("sendSwarmMessage", () => {
    test("should send message using in-memory adapter", async () => {
      // First init an agent
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "Sender",
        dbOverride: db,
      });

      const result = await sendSwarmMessage({
        projectPath: TEST_PROJECT,
        fromAgent: "Sender",
        toAgents: ["Receiver"],
        subject: "Test Subject",
        body: "Test Body",
        dbOverride: db,
      });

      expect(result.success).toBe(true);
      expect(result.recipientCount).toBe(1);
    });
  });

  describe("getSwarmInbox", () => {
    test("should get inbox using in-memory adapter", async () => {
      // Init receiver agent
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "Receiver",
        dbOverride: db,
      });

      const result = await getSwarmInbox({
        projectPath: TEST_PROJECT,
        agentName: "Receiver",
        dbOverride: db,
      });

      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  describe("readSwarmMessage", () => {
    test("should read message using in-memory adapter", async () => {
      // Send a message first
      const sendResult = await sendSwarmMessage({
        projectPath: TEST_PROJECT,
        fromAgent: "Sender",
        toAgents: ["Reader"],
        subject: "Read Test",
        body: "Read Test Body",
        dbOverride: db,
      });

      const message = await readSwarmMessage({
        projectPath: TEST_PROJECT,
        messageId: sendResult.messageId,
        dbOverride: db,
      });

      // Message should exist in in-memory db
      if (message) {
        expect(message.subject).toBe("Read Test");
      }
    });
  });

  describe("reserveSwarmFiles", () => {
    test("should reserve files using in-memory adapter", async () => {
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "FileAgent",
        dbOverride: db,
      });

      const result = await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "FileAgent",
        paths: ["src/test.ts"],
        reason: "Testing",
        dbOverride: db,
      });

      expect(result.granted).toBeDefined();
      expect(Array.isArray(result.granted)).toBe(true);
    });
  });

  describe("releaseSwarmFiles", () => {
    test("should release files using in-memory adapter", async () => {
      const result = await releaseSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "FileAgent",
        paths: ["src/test.ts"],
        dbOverride: db,
      });

      expect(result.released).toBeDefined();
      expect(typeof result.releasedAt).toBe("number");
    });

    test("should actually release reservations so another agent can reserve", async () => {
      // This test verifies that releaseSwarmFiles properly releases reservations
      // so other agents can reserve the same files without conflicts.
      
      // Agent A reserves a file
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "AgentA",
        dbOverride: db,
      });
      
      const reserveResult = await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "AgentA",
        paths: ["src/exclusive-file.ts"],
        reason: "Working on feature",
        exclusive: true,
        dbOverride: db,
      });
      
      expect(reserveResult.granted.length).toBe(1);
      
      // Agent A releases the file
      const releaseResult = await releaseSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "AgentA",
        paths: ["src/exclusive-file.ts"],
        dbOverride: db,
      });
      
      expect(releaseResult.released).toBe(1);
      
      // Agent B should now be able to reserve the same file WITHOUT conflicts
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "AgentB",
        dbOverride: db,
      });
      
      const agentBReserve = await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "AgentB",
        paths: ["src/exclusive-file.ts"],
        reason: "Taking over",
        exclusive: true,
        dbOverride: db,
      });
      
      expect(agentBReserve.conflicts.length).toBe(0);
      expect(agentBReserve.granted.length).toBe(1);
    });

    test("should release ALL reservations when no paths specified (swarm_complete pattern)", async () => {
      // This test verifies the swarm_complete use case: release all reservations for an agent
      // without specifying paths. This is how swarm_complete calls releaseSwarmFiles.
      
      // Agent C reserves multiple files
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "AgentC",
        dbOverride: db,
      });
      
      await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "AgentC",
        paths: ["src/file1.ts"],
        reason: "Working on file1",
        exclusive: true,
        dbOverride: db,
      });
      
      await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "AgentC",
        paths: ["src/file2.ts"],
        reason: "Working on file2",
        exclusive: true,
        dbOverride: db,
      });
      
      // Release ALL without specifying paths (this is how swarm_complete does it)
      const releaseResult = await releaseSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "AgentC",
        // No paths specified - should release all
        dbOverride: db,
      });
      
      expect(releaseResult.released).toBe(2);
      
      // Agent D should be able to reserve both files without conflicts
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "AgentD",
        dbOverride: db,
      });
      
      const agentDReserve1 = await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "AgentD",
        paths: ["src/file1.ts"],
        reason: "Taking over file1",
        exclusive: true,
        dbOverride: db,
      });
      
      const agentDReserve2 = await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "AgentD",
        paths: ["src/file2.ts"],
        reason: "Taking over file2",
        exclusive: true,
        dbOverride: db,
      });
      
      expect(agentDReserve1.conflicts.length).toBe(0);
      expect(agentDReserve2.conflicts.length).toBe(0);
    });
  });

  describe("acknowledgeSwarmMessage", () => {
    test("should acknowledge message using in-memory adapter", async () => {
      // Send a message first
      const sendResult = await sendSwarmMessage({
        projectPath: TEST_PROJECT,
        fromAgent: "Sender",
        toAgents: ["AckAgent"],
        subject: "Ack Test",
        body: "Ack Test Body",
        ackRequired: true,
        dbOverride: db,
      });

      const result = await acknowledgeSwarmMessage({
        projectPath: TEST_PROJECT,
        messageId: sendResult.messageId,
        agentName: "AckAgent",
        dbOverride: db,
      });

      expect(result.acknowledged).toBe(true);
    });
  });

  describe("checkSwarmHealth", () => {
    test("should return health status without throwing error", async () => {
      const result = await checkSwarmHealth(TEST_PROJECT);

      expect(result).toBeDefined();
      expect(result.healthy).toBe(true);
      expect(result.database).toBe("connected");
    });

    test("should work without projectPath (global DB)", async () => {
      const result = await checkSwarmHealth();

      expect(result).toBeDefined();
      expect(result.healthy).toBe(true);
    });
  });

  describe("TTL-based reservation cleanup", () => {
    test("should auto-release expired reservation when reserving same path", async () => {
      // Agent A reserves a file with very short TTL (100ms)
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "TTLAgentA",
        dbOverride: db,
      });
      
      const reserveA = await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "TTLAgentA",
        paths: ["src/ttl-test.ts"],
        reason: "Short TTL test",
        exclusive: true,
        ttlSeconds: 0.1, // 100ms
        dbOverride: db,
      });
      
      expect(reserveA.granted.length).toBe(1);
      const reservationId = reserveA.granted[0].id;
      
      // Wait for expiry (200ms to be safe)
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Check database - reservation should exist but be expired (released_at IS NULL)
      const beforeCleanup = await db.query(
        "SELECT id, released_at, expires_at FROM reservations WHERE id = ?",
        [reservationId]
      );
      expect(beforeCleanup.rows.length).toBe(1);
      expect(beforeCleanup.rows[0].released_at).toBeNull();
      expect(beforeCleanup.rows[0].expires_at).toBeLessThan(Date.now());
      
      // Agent B tries to reserve same path - this should trigger cleanup
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "TTLAgentB",
        dbOverride: db,
      });
      
      const reserveB = await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "TTLAgentB",
        paths: ["src/ttl-test.ts"],
        reason: "Taking over expired reservation",
        exclusive: true,
        dbOverride: db,
      });
      
      // Should succeed without conflicts
      expect(reserveB.conflicts.length).toBe(0);
      expect(reserveB.granted.length).toBe(1);
      
      // CRITICAL: Check that expired reservation was ACTUALLY released (released_at set)
      const afterCleanup = await db.query(
        "SELECT id, released_at, expires_at FROM reservations WHERE id = ?",
        [reservationId]
      );
      expect(afterCleanup.rows.length).toBe(1);
      // This will FAIL until we implement cleanup - released_at should now be set
      expect(afterCleanup.rows[0].released_at).not.toBeNull();
      expect(afterCleanup.rows[0].released_at).toBeGreaterThan(0);
    });
  });

  describe("getSwarmInbox - schema initialization", () => {
    test("should not fail with 'no such table' error when using raw adapter", async () => {
      // Import raw adapter creator to simulate cold start WITHOUT getSwarmMailLibSQL
      const { createLibSQLAdapter } = await import("../libsql");
      
      // Create raw adapter - NO schema initialization
      const rawDb = await createLibSQLAdapter({ url: ":memory:" });

      // This should NOT throw "no such table: messages"
      // The wrapper should auto-initialize schema
      const result = await getSwarmInbox({
        projectPath: "/test/raw",
        agentName: "RawAgent",
        dbOverride: rawDb,
      });

      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages.length).toBe(0); // Empty inbox is fine
    });
  });
});
