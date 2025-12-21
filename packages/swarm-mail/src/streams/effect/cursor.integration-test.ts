/**
 * DurableCursor Tests
 *
 * Tests for Effect-TS cursor service with checkpointing
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import type { AgentRegisteredEvent } from "../events";
import { DurableCursor, DurableCursorLayer, type CursorConfig } from "./cursor";
import { createEvent } from "../index";
import { createInMemorySwarmMailLibSQL } from "../../libsql.convenience";
import type { DatabaseAdapter } from "../../types/database";
import type { SwarmMailAdapter } from "../../types/adapter";

// ============================================================================
// Test Utilities
// ============================================================================

// Shared test database adapter
let db: DatabaseAdapter;
let swarmMail: SwarmMailAdapter;
let closeDb: () => Promise<void>;

beforeEach(async () => {
  const testId = randomUUID().slice(0, 8);
  swarmMail = await createInMemorySwarmMailLibSQL(testId);
  db = await swarmMail.getDatabase();
  closeDb = () => swarmMail.close();
  
  // Reset cursors table
  await db.exec("DELETE FROM cursors");
});

afterEach(async () => {
  await closeDb();
});

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
      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        const cursor = yield* service.create({
          stream: "test-stream",
          checkpoint: "test-checkpoint",
          db,
        });

        const position = yield* cursor.getPosition();
        return position;
      });

      const position = await runWithCursor(program);
      expect(position).toBe(0);
    });

    it("resumes from last checkpoint position", async () => {
      // First cursor - commit at sequence 5
      const program1 = Effect.gen(function* () {
        const service = yield* DurableCursor;
        const cursor = yield* service.create({
          stream: "test-stream",
          checkpoint: "test-checkpoint",
          db,
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
          db,
        });

        return yield* cursor.getPosition();
      });

      const position = await runWithCursor(program2);
      expect(position).toBe(5);
    });

    it("supports multiple independent checkpoints", async () => {
      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;

        const cursor1 = yield* service.create({
          stream: "test-stream",
          checkpoint: "checkpoint-a",
          db,
        });

        const cursor2 = yield* service.create({
          stream: "test-stream",
          checkpoint: "checkpoint-b",
          db,
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
        await swarmMail.appendEvent(event);
      }

      // Create cursor and consume outside Effect.gen
      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "test-consumer",
          db,
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
        await swarmMail.appendEvent(event);
      }

      // First consumer - consume first event only
      const program1 = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "resume-test",
          db,
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
          db,
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
      // Append mixed event types
      await swarmMail.appendEvent(
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-1",
          program: "test",
          model: "test-model",
        }),
      );

      await swarmMail.appendEvent(
        createEvent("message_sent", {
          project_key: "test-project",
          from_agent: "agent-1",
          to_agents: ["agent-2"],
          subject: "test",
          body: "test message",
          importance: "normal",
          ack_required: false,
        }),
      );

      await swarmMail.appendEvent(
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-2",
          program: "test",
          model: "test-model",
        }),
      );

      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "filter-test",
          db,
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
      // Append test events
      await swarmMail.appendEvent(
        createEvent("agent_registered", {
          project_key: "test-project",
          agent_name: "agent-1",
          program: "test",
          model: "test-model",
        }),
      );

      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "test-stream",
          checkpoint: "commit-test",
          db,
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
      const program = Effect.gen(function* () {
        const service = yield* DurableCursor;
        return yield* service.create({
          stream: "empty-stream",
          checkpoint: "empty-test",
          db,
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
      const config: CursorConfig = {
        stream: "test-stream",
        checkpoint: "persist-test",
        db,
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
