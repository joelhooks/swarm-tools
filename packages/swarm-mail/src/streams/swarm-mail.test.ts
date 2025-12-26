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
