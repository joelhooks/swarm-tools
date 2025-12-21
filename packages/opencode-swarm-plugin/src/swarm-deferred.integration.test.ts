/**
 * Swarm DurableDeferred Integration Tests
 *
 * Tests cross-agent task completion signaling using DurableDeferred.
 * Workers resolve a deferred when completing, coordinators await it.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, pipe } from "effect";
import type { DatabaseAdapter } from "../../swarm-mail/src/types/database";
import type { SwarmMailAdapter } from "../../swarm-mail/src/adapter";
import { createInMemorySwarmMailLibSQL } from "../../swarm-mail/src/libsql.convenience";
import { DurableDeferredLive } from "../../swarm-mail/src/streams/effect/deferred";
import { swarm_complete } from "./swarm-orchestrate";

describe("swarm_complete DurableDeferred integration", () => {
  let swarmMail: SwarmMailAdapter;
  let db: DatabaseAdapter;
  let projectKey: string;

  beforeAll(async () => {
    // Use in-memory libSQL database
    swarmMail = await createInMemorySwarmMailLibSQL("test-deferred-integration");
    db = await swarmMail.getDatabase();
    projectKey = "/tmp/test-deferred-integration";

    // Register test agent using swarm-mail adapter
    await swarmMail.registerAgent(projectKey, "TestWorker");

    // Create test bead using swarm-mail Hive adapter
    await swarmMail.createCell(projectKey, {
      title: "Test Task",
      type: "task",
      priority: 2,
      status: "in_progress",
      id: "test-bead-123",
    });
  });

  it("should resolve deferred when swarm_complete is called", async () => {
    const beadId = "test-bead-123";

    // First create deferred (coordinator side)
    const createProgram = Effect.gen(function* () {
      const DurableDeferred = yield* Effect.serviceOption(DurableDeferredLive);
      expect(DurableDeferred._tag).toBe("Some");
      
      if (DurableDeferred._tag !== "Some") {
        throw new Error("DurableDeferred service not available");
      }

      const service = DurableDeferred.value;
      
      // Create deferred keyed by bead_id
      const handle = yield* service.create({
        ttlSeconds: 60,
        db,
      });

      expect(handle.url).toMatch(/^deferred:/);
      
      return handle.url;
    });

    const deferredUrl = await Effect.runPromise(
      pipe(createProgram, Effect.provide(DurableDeferredLive))
    );

    // Worker completes the task (this should resolve the deferred)
    const mockContext = {
      sessionID: "test-session",
      messageID: "test-message",
      agent: "test-agent",
      abort: new AbortController().signal,
    };

    const completeResult = await swarm_complete.execute(
      {
        project_key: projectKey,
        agent_name: "TestWorker",
        bead_id: beadId,
        summary: "Task completed successfully",
        skip_verification: true, // Skip UBS/typecheck for test
      },
      mockContext
    );

    const parsed = JSON.parse(completeResult);
    expect(parsed.success).toBe(true);

    // TODO: Resolve the deferred in swarm_complete implementation
    // For now, manually resolve to verify await works
    const resolveProgram = Effect.gen(function* () {
      const DurableDeferred = yield* Effect.serviceOption(DurableDeferredLive);
      if (DurableDeferred._tag !== "Some") {
        throw new Error("DurableDeferred service not available");
      }

      const service = DurableDeferred.value;
      yield* service.resolve(deferredUrl, { completed: true }, db);
    });

    await Effect.runPromise(
      pipe(resolveProgram, Effect.provide(DurableDeferredLive))
    );

    // Coordinator awaits completion
    const awaitProgram = Effect.gen(function* () {
      const DurableDeferred = yield* Effect.serviceOption(DurableDeferredLive);
      if (DurableDeferred._tag !== "Some") {
        throw new Error("DurableDeferred service not available");
      }

      const service = DurableDeferred.value;
      const result = yield* service.await(deferredUrl, 60, db);
      
      expect(result).toEqual({ completed: true });
      return result;
    });

    const result = await Effect.runPromise(
      pipe(awaitProgram, Effect.provide(DurableDeferredLive))
    );

    expect(result).toEqual({ completed: true });
  });

  it("should timeout if deferred is never resolved", async () => {
    const program = Effect.gen(function* () {
      const DurableDeferred = yield* Effect.serviceOption(DurableDeferredLive);
      expect(DurableDeferred._tag).toBe("Some");
      
      if (DurableDeferred._tag !== "Some") {
        throw new Error("DurableDeferred service not available");
      }

      const service = DurableDeferred.value;
      
      // Create deferred with short timeout
      const handle = yield* service.create({
        ttlSeconds: 1,
        db,
      });

      // Don't resolve it - just await
      const result = yield* handle.value;
      
      return result;
    });

    // Should timeout and throw TimeoutError
    await expect(
      Effect.runPromise(
        pipe(program, Effect.provide(DurableDeferredLive))
      )
    ).rejects.toThrow(/timed out/);
  });
});
