/**
 * DurableCursor Tests
 *
 * Tests for Effect-TS cursor service with checkpointing
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import type { AgentRegisteredEvent } from "../events";
import { DurableCursor, DurableCursorLayer, type CursorConfig } from "./cursor";
import {
  appendEvent,
  closeDatabase,
  createEvent,
  resetDatabase,
} from "../index";

// ============================================================================
// Test Utilities
// ============================================================================

const TEST_PROJECT = "/tmp/cursor-test";

beforeEach(async () => {
  await resetDatabase(TEST_PROJECT);
});

afterEach(async () => {
  await closeDatabase(TEST_PROJECT);
});

async function cleanup() {
  await closeDatabase(TEST_PROJECT);
}

/**
 * Helper to run Effect programs with DurableCursor service
 */
async function runWithCursor<A, E>(
  effect: Effect.Effect<A, E, DurableCursor>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, DurableCursorLayer));
}

// ============================================================================
// Tests
// ============================================================================

describe("DurableCursor", () => {
  describe("create", () => {
    it("creates a cursor with initial position 0", async () => {
      await cleanup();

      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        const cursor = yield* service.create({
          stream: "test-stream",
          checkpoint: "test-checkpoint",
          projectPath: TEST_PROJECT,
        });

        const position = yield* cursor.getPosition();
        return position;
      });

      const position = await runWithCursor(program);
      expect(position).toBe(0);
    });

    it("resumes from last checkpoint position", async () => {
      await cleanup();

      // First cursor - commit at sequence 5
      const program1 = Effect.gen(function* () {
        const service = yield* DurableCursor;
        const cursor = yield* service.create({
          stream: "test-stream",
          checkpoint: "test-checkpoint",
          projectPath: TEST_PROJECT,
        });

        yield* cursor.commit(5);
        return yield* cursor.getPosition();
      });

      await runWithCursor(program1);

      // Second cursor - should resume at 5
      const program2 = Effect.gen(function* () {
        const service = yield* DurableCursor;
        const cursor = yield* service.create({
          stream: "test-stream",
          checkpoint: "test-checkpoint",
          projectPath: TEST_PROJECT,
        });

        return yield* cursor.getPosition();
      });

      const position = await runWithCursor(program2);
      expect(position).toBe(5);
    });

    it("supports multiple independent checkpoints", async () => {
      await cleanup();

      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;

        const cursor1 = yield* service.create({
          stream: "test-stream",
          checkpoint: "checkpoint-a",
          projectPath: TEST_PROJECT,
        });

        const cursor2 = yield* service.create({
          stream: "test-stream",
          checkpoint: "checkpoint-b",
          projectPath: TEST_PROJECT,
        });

        yield* cursor1.commit(10);
        yield* cursor2.commit(20);

        const pos1 = yield* cursor1.getPosition();
        const pos2 = yield* cursor2.getPosition();

        return { pos1, pos2 };
      });

      const result = await runWithCursor(program);
      expect(result.pos1).toBe(10);
      expect(result.pos2).toBe(20);
    });
  });

  describe("consume", () => {
    it("consumes events from current position", async () => {
      await cleanup();

      // Append test events
      const events = [
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-1",
          program: "test",
          model: "test-model",
        }),
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-2",
          program: "test",
          model: "test-model",
        }),
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-3",
          program: "test",
          model: "test-model",
        }),
      ];

      for (const event of events) {
        await appendEvent(event, TEST_PROJECT);
      }

      // Create cursor and consume outside Effect.gen
      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "test-consumer",
          projectPath: TEST_PROJECT,
          batchSize: 2,
        });
      });

      const cursor = await runWithCursor(program);
      const consumed: string[] = [];

      for await (const msg of cursor.consume<
        AgentRegisteredEvent & { id: number; sequence: number }
      >()) {
        consumed.push(msg.value.agent_name);
        await Effect.runPromise(msg.commit());
      }

      expect(consumed).toHaveLength(3);
      expect(consumed).toEqual(["agent-1", "agent-2", "agent-3"]);
    });

    it("resumes consumption from checkpoint", async () => {
      await cleanup();

      // Append test events
      const events = [
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-1",
          program: "test",
          model: "test-model",
        }),
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-2",
          program: "test",
          model: "test-model",
        }),
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-3",
          program: "test",
          model: "test-model",
        }),
      ];

      for (const event of events) {
        await appendEvent(event, TEST_PROJECT);
      }

      // First consumer - consume first event only
      const program1 = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "resume-test",
          projectPath: TEST_PROJECT,
        });
      });

      const cursor1 = await runWithCursor(program1);
      const first: string[] = [];

      for await (const msg of cursor1.consume<
        AgentRegisteredEvent & { id: number; sequence: number }
      >()) {
        first.push(msg.value.agent_name);
        await Effect.runPromise(msg.commit());
        break; // Consume only first event
      }

      expect(first).toEqual(["agent-1"]);

      // Second consumer - should resume from checkpoint
      const program2 = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "resume-test",
          projectPath: TEST_PROJECT,
        });
      });

      const cursor2 = await runWithCursor(program2);
      const second: string[] = [];

      for await (const msg of cursor2.consume<
        AgentRegisteredEvent & { id: number; sequence: number }
      >()) {
        second.push(msg.value.agent_name);
        await Effect.runPromise(msg.commit());
      }

      expect(second).toEqual(["agent-2", "agent-3"]);
    });

    it("supports event type filtering", async () => {
      await cleanup();

      // Append mixed event types
      await appendEvent(
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-1",
          program: "test",
          model: "test-model",
        }),
        TEST_PROJECT,
      );

      await appendEvent(
        createEvent("message_sent", {
          project_key: "test-project",
          from_agent: "agent-1",
          to_agents: ["agent-2"],
          subject: "test",
          body: "test message",
          importance: "normal",
          ack_required: false,
        }),
        TEST_PROJECT,
      );

      await appendEvent(
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-2",
          program: "test",
          model: "test-model",
        }),
        TEST_PROJECT,
      );

      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "filter-test",
          projectPath: TEST_PROJECT,
          types: ["agent_registered"],
        });
      });

      const cursor = await runWithCursor(program);
      const types: string[] = [];

      for await (const msg of cursor.consume()) {
        types.push(msg.value.type);
        await Effect.runPromise(msg.commit());
      }

      expect(types).toEqual(["agent_registered", "agent_registered"]);
    });

    it("commits update cursor position", async () => {
      await cleanup();

      // Append test events
      await appendEvent(
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-1",
          program: "test",
          model: "test-model",
        }),
        TEST_PROJECT,
      );

      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "commit-test",
          projectPath: TEST_PROJECT,
        });
      });

      const cursor = await runWithCursor(program);
      const initialPos = await Effect.runPromise(cursor.getPosition());

      let afterCommit = 0;
      let sequence = 0;

      for await (const msg of cursor.consume()) {
        await Effect.runPromise(msg.commit());
        afterCommit = await Effect.runPromise(cursor.getPosition());
        sequence = msg.sequence;
        break;
      }

      expect(initialPos).toBe(0);
      expect(afterCommit).toBe(sequence);
      expect(afterCommit).toBeGreaterThan(0);
    });

    it("handles empty streams gracefully", async () => {
      await cleanup();

      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "empty-stream",
          checkpoint: "empty-test",
          projectPath: TEST_PROJECT,
        });
      });

      const cursor = await runWithCursor(program);
      const consumed: unknown[] = [];

      for await (const msg of cursor.consume()) {
        consumed.push(msg);
      }

      expect(consumed).toHaveLength(0);
    });
  });

  describe("commit", () => {
    it("persists position across cursor instances", async () => {
      await cleanup();

      const config: CursorConfig = {
        stream: "test-stream",
        checkpoint: "persist-test",
        projectPath: TEST_PROJECT,
      };

      // First cursor - commit position
      const program1 = Effect.gen(function* () {
        const service = yield* DurableCursor;
        const cursor = yield* service.create(config);
        yield* cursor.commit(42);
      });

      await runWithCursor(program1);

      // Second cursor - verify position persisted
      const program2 = Effect.gen(function* () {
        const service = yield* DurableCursor;
        const cursor = yield* service.create(config);
        return yield* cursor.getPosition();
      });

      const position = await runWithCursor(program2);
      expect(position).toBe(42);
    });
  });
});
