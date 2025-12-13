/**
 * Tests for DurableMailbox service
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import { DurableMailbox, DurableMailboxLive, type Envelope } from "./mailbox";
import { DurableCursor, DurableCursorLive } from "./cursor";
import { resetDatabase, closeDatabase } from "../index";

describe("DurableMailbox", () => {
  const projectPath = "/tmp/mailbox-test";
  const projectKey = "/test/project";

  beforeEach(async () => {
    await resetDatabase(projectPath);
  });

  afterAll(async () => {
    await closeDatabase(projectPath);
  });

  describe("send/receive cycle", () => {
    it("should send and receive a message", async () => {
      const program = Effect.gen(function* () {
        const mailboxService = yield* DurableMailbox;

        // Create mailboxes for two agents
        const senderMailbox = yield* mailboxService.create({
          agent: "sender",
          projectKey,
          projectPath,
        });

        const receiverMailbox = yield* mailboxService.create({
          agent: "receiver",
          projectKey,
          projectPath,
        });

        // Send message
        yield* senderMailbox.send("receiver", {
          payload: { task: "process-data", value: 42 },
        });

        // Receive message using Effect.promise for async iteration
        const messages = yield* Effect.promise(async () => {
          const results: Envelope<{ task: string; value: number }>[] = [];
          for await (const envelope of receiverMailbox.receive<{
            task: string;
            value: number;
          }>()) {
            results.push(envelope);
            await Effect.runPromise(envelope.commit());
            break;
          }
          return results;
        });

        return messages;
      });

      const layer = Layer.provideMerge(
        DurableMailboxLive,
        Layer.succeed(DurableCursor, DurableCursorLive),
      );
      const messages = await Effect.runPromise(
        program.pipe(Effect.provide(layer)),
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.payload).toEqual({
        task: "process-data",
        value: 42,
      });
      expect(messages[0]?.sender).toBe("sender");
    });

    it("should support replyTo pattern", async () => {
      const program = Effect.gen(function* () {
        const mailboxService = yield* DurableMailbox;

        const senderMailbox = yield* mailboxService.create({
          agent: "sender",
          projectKey,
          projectPath,
        });

        const receiverMailbox = yield* mailboxService.create({
          agent: "receiver",
          projectKey,
          projectPath,
        });

        // Send message with replyTo
        yield* senderMailbox.send("receiver", {
          payload: { request: "ping" },
          replyTo: "deferred:test-123",
        });

        // Receive and check replyTo
        yield* Effect.promise(async () => {
          for await (const envelope of receiverMailbox.receive()) {
            expect(envelope.replyTo).toBe("deferred:test-123");
            await Effect.runPromise(envelope.commit());
            break;
          }
        });
      });

      const layer = Layer.provideMerge(
        DurableMailboxLive,
        Layer.succeed(DurableCursor, DurableCursorLive),
      );
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    });

    it("should filter messages by recipient", async () => {
      const program = Effect.gen(function* () {
        const mailboxService = yield* DurableMailbox;

        const senderMailbox = yield* mailboxService.create({
          agent: "sender",
          projectKey,
          projectPath,
        });

        const agent1Mailbox = yield* mailboxService.create({
          agent: "agent1",
          projectKey,
          projectPath,
        });

        const agent2Mailbox = yield* mailboxService.create({
          agent: "agent2",
          projectKey,
          projectPath,
        });

        // Send to agent1 only
        yield* senderMailbox.send("agent1", {
          payload: { for: "agent1" },
        });

        // Send to agent2 only
        yield* senderMailbox.send("agent2", {
          payload: { for: "agent2" },
        });

        // Agent1 should only see their message
        const agent1Messages = yield* Effect.promise(async () => {
          const results: Envelope<{ for: string }>[] = [];
          for await (const envelope of agent1Mailbox.receive<{
            for: string;
          }>()) {
            results.push(envelope);
            await Effect.runPromise(envelope.commit());
            break;
          }
          return results;
        });

        // Agent2 should only see their message
        const agent2Messages = yield* Effect.promise(async () => {
          const results: Envelope<{ for: string }>[] = [];
          for await (const envelope of agent2Mailbox.receive<{
            for: string;
          }>()) {
            results.push(envelope);
            await Effect.runPromise(envelope.commit());
            break;
          }
          return results;
        });

        return { agent1Messages, agent2Messages };
      });

      const layer = Layer.provideMerge(
        DurableMailboxLive,
        Layer.succeed(DurableCursor, DurableCursorLive),
      );
      const { agent1Messages, agent2Messages } = await Effect.runPromise(
        program.pipe(Effect.provide(layer)),
      );

      expect(agent1Messages).toHaveLength(1);
      expect(agent1Messages[0]?.payload.for).toBe("agent1");

      expect(agent2Messages).toHaveLength(1);
      expect(agent2Messages[0]?.payload.for).toBe("agent2");
    });
  });

  describe("peek", () => {
    it("should return next message without consuming", async () => {
      const program = Effect.gen(function* () {
        const mailboxService = yield* DurableMailbox;

        const senderMailbox = yield* mailboxService.create({
          agent: "sender",
          projectKey,
          projectPath,
        });

        const receiverMailbox = yield* mailboxService.create({
          agent: "receiver",
          projectKey,
          projectPath,
        });

        // Send message
        yield* senderMailbox.send("receiver", {
          payload: { value: 123 },
        });

        // Peek (doesn't consume)
        const peeked = yield* receiverMailbox.peek<{ value: number }>();
        expect(peeked?.payload.value).toBe(123);

        // Receive (should still be there)
        yield* Effect.promise(async () => {
          for await (const envelope of receiverMailbox.receive<{
            value: number;
          }>()) {
            expect(envelope.payload.value).toBe(123);
            await Effect.runPromise(envelope.commit());
            break;
          }
        });
      });

      const layer = Layer.provideMerge(
        DurableMailboxLive,
        Layer.succeed(DurableCursor, DurableCursorLive),
      );
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    });

    it("should return null when no messages", async () => {
      const program = Effect.gen(function* () {
        const mailboxService = yield* DurableMailbox;

        const mailbox = yield* mailboxService.create({
          agent: "receiver",
          projectKey,
          projectPath,
        });

        const peeked = yield* mailbox.peek();
        expect(peeked).toBeNull();
      });

      const layer = Layer.provideMerge(
        DurableMailboxLive,
        Layer.succeed(DurableCursor, DurableCursorLive),
      );
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    });
  });
});
