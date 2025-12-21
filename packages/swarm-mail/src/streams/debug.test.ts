/**
 * Debug Tools Tests - TDD RED phase
 *
 * These tests define the expected behavior for debug/inspection tools.
 * Run these first to see them fail, then implement to make them pass.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDatabase } from "./index";
import { initAgent, sendAgentMessage, reserveAgentFiles } from "./agent-mail";
import {
  debugEvents,
  debugAgent,
  debugMessage,
  debugReservations,
  getEventTimeline,
  inspectState,
} from "./debug";

describe("Debug Tools", () => {
  // Use temp directory instead of hardcoded /test path
  const testDir = join(tmpdir(), `debug-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const projectPath = testDir;

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(async () => {
    await resetDatabase(projectPath);
  });

  afterEach(async () => {
    await resetDatabase(projectPath);
  });

  // ============================================================================
  // debugEvents - Show recent events with filtering
  // ============================================================================

  describe("debugEvents", () => {
    it("returns recent events in reverse chronological order", async () => {
      // Setup: create some events
      await initAgent({ projectPath, agentName: "Agent1" });
      await initAgent({ projectPath, agentName: "Agent2" });

      const result = await debugEvents({ projectPath });

      expect(result.events).toHaveLength(2);
      expect(result.events[0].type).toBe("agent_registered");
      // Most recent first
      expect(result.events[0].agent_name).toBe("Agent2");
      expect(result.events[1].agent_name).toBe("Agent1");
    });

    it("filters by event type", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Test",
        body: "Hello",
      });

      const result = await debugEvents({
        projectPath,
        types: ["message_sent"],
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("message_sent");
    });

    it("filters by agent name", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await initAgent({ projectPath, agentName: "Agent2" });
      await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Test",
        body: "Hello",
      });

      const result = await debugEvents({
        projectPath,
        agentName: "Agent1",
      });

      // Should include Agent1's registration and message
      expect(result.events.length).toBeGreaterThanOrEqual(2);
      expect(
        result.events.every(
          (e) =>
            e.agent_name === "Agent1" ||
            e.from_agent === "Agent1" ||
            e.to_agents?.includes("Agent1"),
        ),
      ).toBe(true);
    });

    it("limits results", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await initAgent({ projectPath, agentName: "Agent2" });
      await initAgent({ projectPath, agentName: "Agent3" });

      const result = await debugEvents({ projectPath, limit: 2 });

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    it("includes human-readable timestamps", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });

      const result = await debugEvents({ projectPath });

      expect(result.events[0]).toHaveProperty("timestamp_human");
      expect(typeof result.events[0].timestamp_human).toBe("string");
      // Should be ISO format or similar
      expect(result.events[0].timestamp_human).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  // ============================================================================
  // debugAgent - Detailed agent state dump
  // ============================================================================

  describe("debugAgent", () => {
    it("returns agent details with activity summary", async () => {
      await initAgent({
        projectPath,
        agentName: "TestAgent",
        program: "opencode",
        model: "claude-sonnet",
        taskDescription: "Testing debug tools",
      });

      const result = await debugAgent({ projectPath, agentName: "TestAgent" });

      expect(result.agent).not.toBeNull();
      expect(result.agent!.name).toBe("TestAgent");
      expect(result.agent!.program).toBe("opencode");
      expect(result.agent!.model).toBe("claude-sonnet");
      expect(result.agent!.task_description).toBe("Testing debug tools");
    });

    it("includes message counts", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await initAgent({ projectPath, agentName: "Agent2" });

      await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Test 1",
        body: "Hello",
      });
      await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Test 2",
        body: "World",
      });

      const result = await debugAgent({ projectPath, agentName: "Agent1" });

      expect(result.stats.messagesSent).toBe(2);
      expect(result.stats.messagesReceived).toBe(0);
    });

    it("includes active reservations", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await reserveAgentFiles({
        projectPath,
        agentName: "Agent1",
        paths: ["src/a.ts", "src/b.ts"],
        reason: "Testing",
      });

      const result = await debugAgent({ projectPath, agentName: "Agent1" });

      expect(result.reservations).toHaveLength(2);
      expect(result.reservations.map((r) => r.path)).toContain("src/a.ts");
      expect(result.reservations.map((r) => r.path)).toContain("src/b.ts");
    });

    it("includes recent events for the agent", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Test",
        body: "Hello",
      });

      const result = await debugAgent({
        projectPath,
        agentName: "Agent1",
        includeEvents: true,
      });

      expect(result.recentEvents).toBeDefined();
      expect(result.recentEvents!.length).toBeGreaterThan(0);
    });

    it("returns null for non-existent agent", async () => {
      const result = await debugAgent({
        projectPath,
        agentName: "NonExistent",
      });

      expect(result.agent).toBeNull();
    });
  });

  // ============================================================================
  // debugMessage - Full message audit trail
  // ============================================================================

  describe("debugMessage", () => {
    it("returns message with full audit trail", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await initAgent({ projectPath, agentName: "Agent2" });

      const sendResult = await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Important",
        body: "Please review",
        importance: "high",
        threadId: "thread-123",
      });

      const result = await debugMessage({
        projectPath,
        messageId: sendResult.messageId,
      });

      expect(result.message).not.toBeNull();
      expect(result.message!.from_agent).toBe("Agent1");
      expect(result.message!.subject).toBe("Important");
      expect(result.message!.body).toBe("Please review");
      expect(result.message!.importance).toBe("high");
      expect(result.message!.thread_id).toBe("thread-123");
    });

    it("includes recipient status", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await initAgent({ projectPath, agentName: "Agent2" });
      await initAgent({ projectPath, agentName: "Agent3" });

      const sendResult = await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2", "Agent3"],
        subject: "Test",
        body: "Hello",
      });

      const result = await debugMessage({
        projectPath,
        messageId: sendResult.messageId,
      });

      expect(result.recipients).toHaveLength(2);
      expect(result.recipients.map((r) => r.agent_name)).toContain("Agent2");
      expect(result.recipients.map((r) => r.agent_name)).toContain("Agent3");
      // Initially unread
      expect(result.recipients.every((r) => r.read_at === null)).toBe(true);
    });

    it("includes related events", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });

      const sendResult = await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Test",
        body: "Hello",
      });

      const result = await debugMessage({
        projectPath,
        messageId: sendResult.messageId,
        includeEvents: true,
      });

      expect(result.events).toBeDefined();
      expect(result.events!.some((e) => e.type === "message_sent")).toBe(true);
    });

    it("returns null for non-existent message", async () => {
      const result = await debugMessage({
        projectPath,
        messageId: 99999,
      });

      expect(result.message).toBeNull();
    });
  });

  // ============================================================================
  // debugReservations - Current reservation state
  // ============================================================================

  describe("debugReservations", () => {
    it("returns all active reservations", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await initAgent({ projectPath, agentName: "Agent2" });

      await reserveAgentFiles({
        projectPath,
        agentName: "Agent1",
        paths: ["src/a.ts"],
        reason: "Working on A",
      });
      await reserveAgentFiles({
        projectPath,
        agentName: "Agent2",
        paths: ["src/b.ts"],
        reason: "Working on B",
      });

      const result = await debugReservations({ projectPath });

      expect(result.reservations).toHaveLength(2);
      expect(result.byAgent).toHaveProperty("Agent1");
      expect(result.byAgent).toHaveProperty("Agent2");
    });

    it("groups reservations by agent", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });

      await reserveAgentFiles({
        projectPath,
        agentName: "Agent1",
        paths: ["src/a.ts", "src/b.ts", "src/c.ts"],
        reason: "Working",
      });

      const result = await debugReservations({ projectPath });

      expect(result.byAgent.Agent1).toHaveLength(3);
    });

    it("includes expiration info", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });

      await reserveAgentFiles({
        projectPath,
        agentName: "Agent1",
        paths: ["src/a.ts"],
        ttlSeconds: 3600,
      });

      const result = await debugReservations({ projectPath });

      expect(result.reservations[0]).toHaveProperty("expires_at");
      expect(result.reservations[0]).toHaveProperty("expires_in_human");
      expect(typeof result.reservations[0].expires_in_human).toBe("string");
    });

    it("detects potential conflicts", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await initAgent({ projectPath, agentName: "Agent2" });

      // Agent1 reserves src/**
      await reserveAgentFiles({
        projectPath,
        agentName: "Agent1",
        paths: ["src/**"],
        reason: "Broad reservation",
      });

      // Agent2 forces reservation of src/specific.ts (to test conflict detection)
      await reserveAgentFiles({
        projectPath,
        agentName: "Agent2",
        paths: ["src/specific.ts"],
        reason: "Specific file",
        force: true, // Force to create overlapping reservation for conflict test
      });

      const result = await debugReservations({
        projectPath,
        checkConflicts: true,
      });

      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // getEventTimeline - Visual timeline of events
  // ============================================================================

  describe("getEventTimeline", () => {
    it("returns events formatted for timeline display", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Test",
        body: "Hello",
      });

      const result = await getEventTimeline({ projectPath });

      expect(result.timeline).toBeDefined();
      expect(Array.isArray(result.timeline)).toBe(true);
      expect(result.timeline.length).toBeGreaterThan(0);

      // Each entry should have display-friendly format
      const entry = result.timeline[0];
      expect(entry).toHaveProperty("time");
      expect(entry).toHaveProperty("type");
      expect(entry).toHaveProperty("summary");
      expect(entry).toHaveProperty("agent");
    });

    it("filters by time range", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });

      // Wait to ensure timestamp separation
      await new Promise((r) => setTimeout(r, 5));
      const afterFirst = Date.now();

      // Wait a bit more
      await new Promise((r) => setTimeout(r, 5));

      await initAgent({ projectPath, agentName: "Agent2" });

      const result = await getEventTimeline({
        projectPath,
        since: afterFirst,
      });

      // Should only include Agent2's registration
      expect(result.timeline).toHaveLength(1);
      expect(result.timeline[0].agent).toBe("Agent2");
    });
  });

  // ============================================================================
  // inspectState - Full state dump for debugging
  // ============================================================================

  describe("inspectState", () => {
    it("returns complete state snapshot", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });
      await sendAgentMessage({
        projectPath,
        fromAgent: "Agent1",
        toAgents: ["Agent2"],
        subject: "Test",
        body: "Hello",
      });
      await reserveAgentFiles({
        projectPath,
        agentName: "Agent1",
        paths: ["src/a.ts"],
      });

      const result = await inspectState({ projectPath });

      expect(result).toHaveProperty("agents");
      expect(result).toHaveProperty("messages");
      expect(result).toHaveProperty("reservations");
      expect(result).toHaveProperty("eventCount");
      expect(result).toHaveProperty("latestSequence");

      expect(result.agents).toHaveLength(1);
      expect(result.messages).toHaveLength(1);
      expect(result.reservations).toHaveLength(1);
    });

    it("includes database stats", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });

      const result = await inspectState({ projectPath });

      expect(result.stats).toBeDefined();
      expect(result.stats).toHaveProperty("events");
      expect(result.stats).toHaveProperty("agents");
      expect(result.stats).toHaveProperty("messages");
      expect(result.stats).toHaveProperty("reservations");
    });

    it("can export as JSON string", async () => {
      await initAgent({ projectPath, agentName: "Agent1" });

      const result = await inspectState({ projectPath, format: "json" });

      expect(typeof result.json).toBe("string");
      const parsed = JSON.parse(result.json!);
      expect(parsed).toHaveProperty("agents");
    });
  });
});
