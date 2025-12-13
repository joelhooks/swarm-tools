/**
 * Ask Pattern Integration Tests
 *
 * Tests request/response communication between agents using
 * DurableMailbox + DurableDeferred pattern.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { ask, respond, askWithMailbox } from "./ask";
import { DurableMailbox } from "./mailbox";
import { DurableDeferred } from "./deferred";
import { DurableAskLive } from "./layers";
import { resetDatabase, closeDatabase } from "../index";
import { randomUUID } from "node:crypto";

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestRequest {
  action: string;
  userId: number;
}

interface TestResponse {
  status: "success" | "error";
  data?: unknown;
  message?: string;
}

// ============================================================================
// Setup/Teardown
// ============================================================================

let testDbPath: string;

beforeEach(async () => {
  testDbPath = `/tmp/ask-test-${randomUUID()}`;
  await resetDatabase(testDbPath);
});

afterEach(async () => {
  await closeDatabase(testDbPath);
});

// ============================================================================
// Tests
// ============================================================================

describe("Ask Pattern", () => {
  it("should send request and receive response via ask()", async () => {
    const program = Effect.gen(function* () {
      const mailboxService = yield* DurableMailbox;

      // Create mailboxes for both agents
      const agentA = yield* mailboxService.create({
        agent: "agent-a",
        projectKey: "test-proj",
        projectPath: testDbPath,
      });

      const agentB = yield* mailboxService.create({
        agent: "agent-b",
        projectKey: "test-proj",
        projectPath: testDbPath,
      });

      // Agent B: Listen for request and respond
      const responder = Effect.promise(async () => {
        for await (const envelope of agentB.receive<TestRequest>()) {
          expect(envelope.payload.action).toBe("getUserData");
          expect(envelope.payload.userId).toBe(123);
          expect(envelope.replyTo).toBeDefined();

          // Send response
          await Effect.runPromise(
            respond<TestResponse>(
              envelope,
              {
                status: "success",
                data: { username: "testuser", id: 123 },
              },
              testDbPath,
            ).pipe(Effect.provide(DurableAskLive)),
          );

          await Effect.runPromise(envelope.commit());
          break; // Exit after first message
        }
      });

      // Start responder in background
      Effect.runFork(responder.pipe(Effect.provide(DurableAskLive)));

      // Agent A: Send request via ask()
      const response = yield* ask<TestRequest, TestResponse>({
        mailbox: agentA,
        to: "agent-b",
        payload: { action: "getUserData", userId: 123 },
        ttlSeconds: 5,
      });

      expect(response.status).toBe("success");
      expect(response.data).toEqual({ username: "testuser", id: 123 });

      return response;
    }).pipe(Effect.provide(DurableAskLive));

    const result = await Effect.runPromise(program);
    expect(result.status).toBe("success");
  });

  it("should timeout when no response received", async () => {
    const program = Effect.gen(function* () {
      const mailboxService = yield* DurableMailbox;

      const agentA = yield* mailboxService.create({
        agent: "agent-a",
        projectKey: "test-proj",
        projectPath: testDbPath,
      });

      // No one listening, should timeout after 1 second
      const response = yield* ask<TestRequest, TestResponse>({
        mailbox: agentA,
        to: "agent-b-nonexistent",
        payload: { action: "getUserData", userId: 123 },
        ttlSeconds: 1,
      });

      return response;
    }).pipe(Effect.provide(DurableAskLive));

    // Expect timeout error
    const result = await Effect.runPromise(Effect.either(program));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toHaveProperty("_tag", "TimeoutError");
    }
  });

  it("should support askWithMailbox for one-off requests", async () => {
    const program = Effect.gen(function* () {
      const mailboxService = yield* DurableMailbox;

      // Agent B: Listen for request
      const agentB = yield* mailboxService.create({
        agent: "agent-b",
        projectKey: "test-proj",
        projectPath: testDbPath,
      });

      const responder = Effect.promise(async () => {
        for await (const envelope of agentB.receive<TestRequest>()) {
          await Effect.runPromise(
            respond<TestResponse>(
              envelope,
              { status: "success", message: "One-off response" },
              testDbPath,
            ).pipe(Effect.provide(DurableAskLive)),
          );
          await Effect.runPromise(envelope.commit());
          break;
        }
      });

      Effect.runFork(responder.pipe(Effect.provide(DurableAskLive)));

      // Use askWithMailbox (creates mailbox automatically)
      const response = yield* askWithMailbox<TestRequest, TestResponse>({
        agent: "agent-a",
        projectKey: "test-proj",
        to: "agent-b",
        payload: { action: "ping", userId: 0 },
        ttlSeconds: 5,
        projectPath: testDbPath,
      });

      expect(response.status).toBe("success");
      expect(response.message).toBe("One-off response");

      return response;
    }).pipe(Effect.provide(DurableAskLive));

    const result = await Effect.runPromise(program);
    expect(result.status).toBe("success");
  });

  it("should handle multiple concurrent asks", async () => {
    const program = Effect.gen(function* () {
      const mailboxService = yield* DurableMailbox;

      const agentA = yield* mailboxService.create({
        agent: "agent-a",
        projectKey: "test-proj",
        projectPath: testDbPath,
      });

      const agentB = yield* mailboxService.create({
        agent: "agent-b",
        projectKey: "test-proj",
        projectPath: testDbPath,
      });

      // Agent B: Respond to all requests (limit to 3)
      const responder = Effect.promise(async () => {
        let count = 0;
        for await (const envelope of agentB.receive<TestRequest>()) {
          await Effect.runPromise(
            respond<TestResponse>(
              envelope,
              {
                status: "success",
                data: { userId: envelope.payload.userId },
              },
              testDbPath,
            ).pipe(Effect.provide(DurableAskLive)),
          );
          await Effect.runPromise(envelope.commit());
          count++;
          if (count >= 3) break; // Exit after 3 responses
        }
      });

      Effect.runFork(responder.pipe(Effect.provide(DurableAskLive)));

      // Send 3 concurrent requests
      const requests = [
        ask<TestRequest, TestResponse>({
          mailbox: agentA,
          to: "agent-b",
          payload: { action: "getData", userId: 1 },
          ttlSeconds: 5,
        }),
        ask<TestRequest, TestResponse>({
          mailbox: agentA,
          to: "agent-b",
          payload: { action: "getData", userId: 2 },
          ttlSeconds: 5,
        }),
        ask<TestRequest, TestResponse>({
          mailbox: agentA,
          to: "agent-b",
          payload: { action: "getData", userId: 3 },
          ttlSeconds: 5,
        }),
      ];

      const responses = yield* Effect.all(requests, { concurrency: 3 });

      expect(responses).toHaveLength(3);
      // Sort by userId to avoid flaky ordering - concurrent responses may arrive in any order
      const sortedData = responses
        .map((r) => r.data)
        .sort((a: any, b: any) => a.userId - b.userId);
      expect(sortedData).toEqual([{ userId: 1 }, { userId: 2 }, { userId: 3 }]);

      return responses;
    }).pipe(Effect.provide(DurableAskLive));

    const results = await Effect.runPromise(program);
    expect(results).toHaveLength(3);
  });

  it("should support thread IDs for conversation tracking", async () => {
    const program = Effect.gen(function* () {
      const mailboxService = yield* DurableMailbox;

      const agentA = yield* mailboxService.create({
        agent: "agent-a",
        projectKey: "test-proj",
        projectPath: testDbPath,
      });

      const agentB = yield* mailboxService.create({
        agent: "agent-b",
        projectKey: "test-proj",
        projectPath: testDbPath,
      });

      const responder = Effect.promise(async () => {
        for await (const envelope of agentB.receive<TestRequest>()) {
          expect(envelope.threadId).toBe("conversation-123");
          await Effect.runPromise(
            respond<TestResponse>(
              envelope,
              { status: "success" },
              testDbPath,
            ).pipe(Effect.provide(DurableAskLive)),
          );
          await Effect.runPromise(envelope.commit());
          break;
        }
      });

      Effect.runFork(responder.pipe(Effect.provide(DurableAskLive)));

      const response = yield* ask<TestRequest, TestResponse>({
        mailbox: agentA,
        to: "agent-b",
        payload: { action: "test", userId: 0 },
        threadId: "conversation-123",
        ttlSeconds: 5,
      });

      expect(response.status).toBe("success");

      return response;
    }).pipe(Effect.provide(DurableAskLive));

    await Effect.runPromise(program);
  });
});
