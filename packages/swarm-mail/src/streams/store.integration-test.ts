/**
 * Integration tests for Event Store
 *
 * Tests the core event sourcing operations:
 * - Append events
 * - Read events with filters
 * - Materialized view updates
 * - Replay functionality
 * 
 * @deprecated This file needs migration from PGlite to libSQL.
 * getDatabase(), closeDatabase(), and getDatabaseStats() no longer exist.
 * Use createLibSQLAdapter() and store-drizzle.ts instead.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendEvent,
  appendEvents,
  readEvents,
  getLatestSequence,
  replayEvents,
  replayEventsBatched,
  registerAgent,
  sendMessage,
  reserveFiles,
} from "./store";
import { createEvent } from "./events";
import { getDatabasePath } from "./index";
import { createLibSQLAdapter } from "../libsql";

const getDatabase = async (path: string) => createLibSQLAdapter({ url: `file:${getDatabasePath(path)}` });
const closeDatabase = async (_path?: string) => {}; // libSQL auto-closes
const getDatabaseStats = async (_path?: string) => ({ events: 0, agents: 0, messages: 0, reservations: 0 });

// Use unique temp directory for each test run
let TEST_PROJECT_PATH: string;

describe("Event Store", () => {
  beforeEach(async () => {
    // Create unique path for each test to ensure isolation
    TEST_PROJECT_PATH = join(
      tmpdir(),
      `streams-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    // Create the directory so getDatabasePath uses it instead of global
    await mkdir(TEST_PROJECT_PATH, { recursive: true });
  });

  afterEach(async () => {
    // Close and clean up
    await closeDatabase(TEST_PROJECT_PATH);
    try {
      await rm(join(TEST_PROJECT_PATH, ".opencode"), { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  describe("appendEvent", () => {
    it("should append an event and return with id and sequence", async () => {
      const event = createEvent("agent_registered", {
        project_key: "test-project",
        agent_name: "TestAgent",
        program: "opencode",
        model: "claude-sonnet-4",
      });

      const result = await appendEvent(event, TEST_PROJECT_PATH);

      expect(result.id).toBeDefined();
      expect(result.sequence).toBeDefined();
      expect(result.type).toBe("agent_registered");
      // Type narrowing for discriminated union
      if (result.type === "agent_registered") {
        expect(result.agent_name).toBe("TestAgent");
      }
    });

    it("should update materialized views for agent_registered", async () => {
      const event = createEvent("agent_registered", {
        project_key: "test-project",
        agent_name: "TestAgent",
        program: "opencode",
        model: "claude-sonnet-4",
        task_description: "Testing the event store",
      });

      await appendEvent(event, TEST_PROJECT_PATH);

      // Check agents table
      const db = await getDatabase(TEST_PROJECT_PATH);
      const agents = await db.query<{ name: string; task_description: string }>(
        "SELECT name, task_description FROM agents WHERE project_key = $1",
        ["test-project"],
      );

      expect(agents.rows.length).toBe(1);
      expect(agents.rows[0]?.name).toBe("TestAgent");
      expect(agents.rows[0]?.task_description).toBe("Testing the event store");
    });
  });

  describe("appendEvents (batch)", () => {
    it("should append multiple events in a transaction", async () => {
      const events = [
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "Agent1",
          program: "opencode",
          model: "claude-sonnet-4",
        }),
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "Agent2",
          program: "opencode",
          model: "claude-haiku",
        }),
      ];

      const results = await appendEvents(events, TEST_PROJECT_PATH);

      expect(results.length).toBe(2);
      expect(results[0]?.sequence).toBeLessThan(results[1]?.sequence ?? 0);
    });
  });

  describe("readEvents", () => {
    it("should read events with filters", async () => {
      // Create some events
      await appendEvent(
        createEvent("agent_registered", {
          project_key: "project-a",
          agent_name: "Agent1",
          program: "opencode",
          model: "claude-sonnet-4",
        }),
        TEST_PROJECT_PATH,
      );

      await appendEvent(
        createEvent("agent_registered", {
          project_key: "project-b",
          agent_name: "Agent2",
          program: "opencode",
          model: "claude-sonnet-4",
        }),
        TEST_PROJECT_PATH,
      );

      // Read only project-a events
      const events = await readEvents(
        { projectKey: "project-a" },
        TEST_PROJECT_PATH,
      );

      expect(events.length).toBe(1);
      expect(events[0]?.project_key).toBe("project-a");
    });

    it("should filter by event type", async () => {
      await appendEvent(
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "Agent1",
          program: "opencode",
          model: "claude-sonnet-4",
        }),
        TEST_PROJECT_PATH,
      );

      await appendEvent(
        createEvent("agent_active", {
          project_key: "test-project",
          agent_name: "Agent1",
        }),
        TEST_PROJECT_PATH,
      );

      const events = await readEvents(
        { types: ["agent_active"] },
        TEST_PROJECT_PATH,
      );

      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe("agent_active");
    });

    it("should support pagination", async () => {
      // Create 5 events
      for (let i = 0; i < 5; i++) {
        await appendEvent(
          createEvent("agent_active", {
            project_key: "test-project",
            agent_name: `Agent${i}`,
          }),
          TEST_PROJECT_PATH,
        );
      }

      const page1 = await readEvents({ limit: 2 }, TEST_PROJECT_PATH);
      const page2 = await readEvents(
        { limit: 2, offset: 2 },
        TEST_PROJECT_PATH,
      );

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0]?.sequence).not.toBe(page2[0]?.sequence);
    });
  });

  describe("getLatestSequence", () => {
    it("should return 0 for empty database", async () => {
      const seq = await getLatestSequence(undefined, TEST_PROJECT_PATH);
      expect(seq).toBe(0);
    });

    it("should return latest sequence number", async () => {
      await appendEvent(
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "Agent1",
          program: "opencode",
          model: "claude-sonnet-4",
        }),
        TEST_PROJECT_PATH,
      );

      await appendEvent(
        createEvent("agent_active", {
          project_key: "test-project",
          agent_name: "Agent1",
        }),
        TEST_PROJECT_PATH,
      );

      const seq = await getLatestSequence(undefined, TEST_PROJECT_PATH);
      expect(seq).toBe(2);
    });
  });

  describe("convenience functions", () => {
    it("registerAgent should create agent_registered event", async () => {
      const result = await registerAgent(
        "test-project",
        "MyAgent",
        {
          program: "opencode",
          model: "claude-sonnet-4",
          taskDescription: "Testing",
        },
        TEST_PROJECT_PATH,
      );

      expect(result.type).toBe("agent_registered");
      expect(result.agent_name).toBe("MyAgent");
      expect(result.task_description).toBe("Testing");
    });

    it("sendMessage should create message_sent event and update views", async () => {
      // Register agents first
      await registerAgent("test-project", "Sender", {}, TEST_PROJECT_PATH);
      await registerAgent("test-project", "Receiver", {}, TEST_PROJECT_PATH);

      const result = await sendMessage(
        "test-project",
        "Sender",
        ["Receiver"],
        "Hello",
        "This is a test message",
        { importance: "high" },
        TEST_PROJECT_PATH,
      );

      expect(result.type).toBe("message_sent");
      expect(result.subject).toBe("Hello");
      expect(result.importance).toBe("high");

      // Check messages table
      const db = await getDatabase(TEST_PROJECT_PATH);
      const messages = await db.query<{ subject: string; importance: string }>(
        "SELECT subject, importance FROM messages WHERE project_key = $1",
        ["test-project"],
      );

      expect(messages.rows.length).toBe(1);
      expect(messages.rows[0]?.subject).toBe("Hello");
    });

    it("reserveFiles should create file_reserved event", async () => {
      await registerAgent("test-project", "Worker", {}, TEST_PROJECT_PATH);

      const result = await reserveFiles(
        "test-project",
        "Worker",
        ["src/**/*.ts", "tests/**/*.ts"],
        { reason: "Refactoring", exclusive: true, ttlSeconds: 1800 },
        TEST_PROJECT_PATH,
      );

      expect(result.type).toBe("file_reserved");
      expect(result.paths).toEqual(["src/**/*.ts", "tests/**/*.ts"]);
      expect(result.exclusive).toBe(true);

      // Check reservations table
      const db = await getDatabase(TEST_PROJECT_PATH);
      const reservations = await db.query<{ path_pattern: string }>(
        "SELECT path_pattern FROM reservations WHERE project_key = $1 AND released_at IS NULL",
        ["test-project"],
      );

      expect(reservations.rows.length).toBe(2);
    });
  });

  describe("replayEvents", () => {
    it("should rebuild materialized views from events", async () => {
      // Create some events
      await registerAgent(
        "test-project",
        "Agent1",
        { taskDescription: "Original" },
        TEST_PROJECT_PATH,
      );

      // Manually corrupt the view
      const db = await getDatabase(TEST_PROJECT_PATH);
      await db.query(
        "UPDATE agents SET task_description = 'Corrupted' WHERE name = 'Agent1'",
      );

      // Verify corruption
      const corrupted = await db.query<{ task_description: string }>(
        "SELECT task_description FROM agents WHERE name = 'Agent1'",
      );
      expect(corrupted.rows[0]?.task_description).toBe("Corrupted");

      // Replay events
      const result = await replayEvents(
        { clearViews: true },
        TEST_PROJECT_PATH,
      );

      expect(result.eventsReplayed).toBe(1);

      // Verify view is restored
      const restored = await db.query<{ task_description: string }>(
        "SELECT task_description FROM agents WHERE name = 'Agent1'",
      );
      expect(restored.rows[0]?.task_description).toBe("Original");
    });
  });

  describe("replayEventsBatched", () => {
    it("should replay events in batches with progress tracking", async () => {
      // Create 50 events
      for (let i = 0; i < 50; i++) {
        await registerAgent(
          "test-project",
          `Agent${i}`,
          { taskDescription: `Agent ${i}` },
          TEST_PROJECT_PATH,
        );
      }

      // Manually corrupt the views
      const db = await getDatabase(TEST_PROJECT_PATH);
      await db.query("DELETE FROM agents WHERE project_key = 'test-project'");

      // Verify views are empty
      const empty = await db.query<{ count: string }>(
        "SELECT COUNT(*) as count FROM agents WHERE project_key = 'test-project'",
      );
      expect(parseInt(empty.rows[0]?.count ?? "0")).toBe(0);

      // Track progress
      const progressUpdates: Array<{
        processed: number;
        total: number;
        percent: number;
      }> = [];

      // Replay in batches of 10
      const result = await replayEventsBatched(
        "test-project",
        async (_events, progress) => {
          progressUpdates.push(progress);
        },
        { batchSize: 10, clearViews: false },
        TEST_PROJECT_PATH,
      );

      // Verify all events replayed
      expect(result.eventsReplayed).toBe(50);

      // Verify progress updates
      expect(progressUpdates.length).toBe(5); // 50 events / 10 per batch = 5 batches
      expect(progressUpdates[0]).toMatchObject({
        processed: 10,
        total: 50,
        percent: 20,
      });
      expect(progressUpdates[4]).toMatchObject({
        processed: 50,
        total: 50,
        percent: 100,
      });

      // Verify views are restored
      const restored = await db.query<{ count: string }>(
        "SELECT COUNT(*) as count FROM agents WHERE project_key = 'test-project'",
      );
      expect(parseInt(restored.rows[0]?.count ?? "0")).toBe(50);
    });

    it("should handle zero events gracefully", async () => {
      const progressUpdates: Array<{
        processed: number;
        total: number;
        percent: number;
      }> = [];

      const result = await replayEventsBatched(
        "test-project",
        async (_events, progress) => {
          progressUpdates.push(progress);
        },
        { batchSize: 10 },
        TEST_PROJECT_PATH,
      );

      expect(result.eventsReplayed).toBe(0);
      expect(progressUpdates.length).toBe(0);
    });

    it("should use custom batch size", async () => {
      // Create 25 events
      for (let i = 0; i < 25; i++) {
        await registerAgent("test-project", `Agent${i}`, {}, TEST_PROJECT_PATH);
      }

      const progressUpdates: Array<{
        processed: number;
        total: number;
        percent: number;
      }> = [];

      // Replay with batch size of 5
      await replayEventsBatched(
        "test-project",
        async (_events, progress) => {
          progressUpdates.push(progress);
        },
        { batchSize: 5, clearViews: false },
        TEST_PROJECT_PATH,
      );

      // Should have 5 batches (25 events / 5 per batch)
      expect(progressUpdates.length).toBe(5);
    });
  });

  describe("getDatabaseStats", () => {
    it("should return correct counts", async () => {
      await registerAgent("test-project", "Agent1", {}, TEST_PROJECT_PATH);
      await sendMessage(
        "test-project",
        "Agent1",
        ["Agent1"],
        "Test",
        "Body",
        {},
        TEST_PROJECT_PATH,
      );
      await reserveFiles(
        "test-project",
        "Agent1",
        ["src/**"],
        {},
        TEST_PROJECT_PATH,
      );

      const stats = await getDatabaseStats(TEST_PROJECT_PATH);

      expect(stats.events).toBe(3); // register + message + reserve
      expect(stats.agents).toBe(1);
      expect(stats.messages).toBe(1);
      expect(stats.reservations).toBe(1);
    });
  });

  describe("SQL Injection Protection", () => {
    it("should handle malicious projectKey in replayEvents with clearViews", async () => {
      // Create a legitimate project first
      await registerAgent("legit-project", "Agent1", {}, TEST_PROJECT_PATH);
      await sendMessage(
        "legit-project",
        "Agent1",
        ["Agent1"],
        "Test",
        "Body",
        {},
        TEST_PROJECT_PATH,
      );

      // Attempt SQL injection via projectKey
      const maliciousKey = "'; DROP TABLE events; --";

      // Should not throw, should not drop tables
      await replayEvents(
        { projectKey: maliciousKey, clearViews: true },
        TEST_PROJECT_PATH,
      );

      // Verify events table still exists and legit data is intact
      const events = await readEvents({}, TEST_PROJECT_PATH);
      expect(events).toBeDefined();
      expect(events.length).toBeGreaterThan(0);

      // Verify legit project data still exists
      const legitEvents = await readEvents(
        { projectKey: "legit-project" },
        TEST_PROJECT_PATH,
      );
      expect(legitEvents.length).toBeGreaterThan(0);
    });

    it("should handle malicious projectKey with UNION injection attempt", async () => {
      await registerAgent("safe-project", "Agent1", {}, TEST_PROJECT_PATH);

      const unionInjection = "' UNION SELECT * FROM agents --";

      // Should treat the entire string as a literal projectKey
      await replayEvents(
        { projectKey: unionInjection, clearViews: true },
        TEST_PROJECT_PATH,
      );

      // Verify safe-project data still exists
      const events = await readEvents(
        { projectKey: "safe-project" },
        TEST_PROJECT_PATH,
      );
      expect(events.length).toBeGreaterThan(0);
    });

    it("should handle malicious projectKey in readEvents", async () => {
      await registerAgent("test-project", "Agent1", {}, TEST_PROJECT_PATH);

      const maliciousKey = "test' OR '1'='1";

      // Should return no results (no project with that exact key)
      const events = await readEvents(
        { projectKey: maliciousKey },
        TEST_PROJECT_PATH,
      );

      // Should not return all events (which would happen if injection succeeded)
      expect(events.length).toBe(0);
    });

    it("should handle malicious projectKey in getLatestSequence", async () => {
      await registerAgent("real-project", "Agent1", {}, TEST_PROJECT_PATH);

      const maliciousKey = "'; DELETE FROM events WHERE '1'='1";

      const seq = await getLatestSequence(maliciousKey, TEST_PROJECT_PATH);

      // Should return 0 (no events for this malicious key)
      expect(seq).toBe(0);

      // Verify events table still has data
      const allEvents = await readEvents({}, TEST_PROJECT_PATH);
      expect(allEvents.length).toBeGreaterThan(0);
    });

    it("should handle special SQL characters in projectKey", async () => {
      const specialCharsKey = "project'; SELECT * FROM events; --";

      await registerAgent(specialCharsKey, "Agent1", {}, TEST_PROJECT_PATH);

      // Should be able to read back with the exact key
      const events = await readEvents(
        { projectKey: specialCharsKey },
        TEST_PROJECT_PATH,
      );

      expect(events.length).toBe(1);
      expect(events[0]?.project_key).toBe(specialCharsKey);
    });

    it("should handle malicious agent names", async () => {
      const maliciousName = "Agent1'; DROP TABLE agents; --";

      await registerAgent("test-project", maliciousName, {}, TEST_PROJECT_PATH);

      // Verify agent was created with the literal name
      const db = await getDatabase(TEST_PROJECT_PATH);
      const agents = await db.query<{ name: string }>(
        "SELECT name FROM agents WHERE project_key = $1",
        ["test-project"],
      );

      expect(agents.rows.length).toBe(1);
      expect(agents.rows[0]?.name).toBe(maliciousName);

      // Verify tables still exist
      const events = await readEvents({}, TEST_PROJECT_PATH);
      expect(events).toBeDefined();
    });

    it("should handle malicious message subjects and bodies", async () => {
      await registerAgent("test-project", "Agent1", {}, TEST_PROJECT_PATH);

      const maliciousSubject = "'; DELETE FROM messages WHERE '1'='1; --";
      const maliciousBody =
        "Body with SQL: '); DROP TABLE message_recipients; --";

      await sendMessage(
        "test-project",
        "Agent1",
        ["Agent1"],
        maliciousSubject,
        maliciousBody,
        {},
        TEST_PROJECT_PATH,
      );

      // Verify message was stored with literal values
      const db = await getDatabase(TEST_PROJECT_PATH);
      const messages = await db.query<{ subject: string; body: string }>(
        "SELECT subject, body FROM messages WHERE project_key = $1",
        ["test-project"],
      );

      expect(messages.rows.length).toBe(1);
      expect(messages.rows[0]?.subject).toBe(maliciousSubject);
      expect(messages.rows[0]?.body).toBe(maliciousBody);
    });

    it("should handle malicious file paths in reservations", async () => {
      await registerAgent("test-project", "Agent1", {}, TEST_PROJECT_PATH);

      const maliciousPath = "src/**'; DELETE FROM reservations WHERE '1'='1";

      await reserveFiles(
        "test-project",
        "Agent1",
        [maliciousPath],
        {},
        TEST_PROJECT_PATH,
      );

      // Verify reservation was created with literal path
      const db = await getDatabase(TEST_PROJECT_PATH);
      const reservations = await db.query<{ path_pattern: string }>(
        "SELECT path_pattern FROM reservations WHERE project_key = $1",
        ["test-project"],
      );

      expect(reservations.rows.length).toBe(1);
      expect(reservations.rows[0]?.path_pattern).toBe(maliciousPath);
    });
  });
});
