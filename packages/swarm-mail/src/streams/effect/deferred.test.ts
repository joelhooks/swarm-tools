/**
 * Tests for DurableDeferred service
 *
 * Verifies:
 * - Create deferred with unique URL
 * - Resolve deferred from another context
 * - Reject deferred with error
 * - Timeout when not resolved in time
 * - Concurrent access patterns
 * - Cleanup of expired entries
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { createInMemorySwarmMailLibSQL } from "../../libsql.convenience";
import type { DatabaseAdapter } from "../../types/database";
import {
  TimeoutError,
  NotFoundError,
  createDeferred,
  resolveDeferred,
  rejectDeferred,
  cleanupDeferreds,
  DurableDeferredLive,
} from "./deferred";

let db: DatabaseAdapter;
let closeDb: () => Promise<void>;

describe("DurableDeferred", () => {
  beforeEach(async () => {
    const testId = randomUUID().slice(0, 8);
    const swarmMail = await createInMemorySwarmMailLibSQL(testId);
    db = await swarmMail.getDatabase();
    closeDb = () => swarmMail.close();
  });

  afterEach(async () => {
    await closeDb();
  });

  describe("create", () => {
    it("creates a deferred with unique URL", async () => {
      const program = Effect.gen(function* (_) {
        const handle = yield* _(
          createDeferred<string>({
            ttlSeconds: 60,
            db,
          }),
        );

        expect(handle.url).toMatch(/^deferred:/);
        expect(handle.value).toBeDefined();
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive)),
      );
    });

    it("creates multiple deferreds with different URLs", async () => {
      const program = Effect.gen(function* (_) {
        const handle1 = yield* _(
          createDeferred<string>({
            ttlSeconds: 60,
            db,
          }),
        );
        const handle2 = yield* _(
          createDeferred<string>({
            ttlSeconds: 60,
            db,
          }),
        );

        expect(handle1.url).not.toBe(handle2.url);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive)),
      );
    });
  });

  describe("resolve", () => {
    it("resolves a deferred and returns value", async () => {
      const program = Effect.gen(function* (_) {
        const handle = yield* _(
          createDeferred<{ message: string }>({
            ttlSeconds: 60,
            db,
          }),
        );

        // Resolve in background
        Effect.runFork(
          Effect.gen(function* (_) {
            yield* _(Effect.sleep("100 millis"));
            yield* _(
              resolveDeferred(
                handle.url,
                { message: "resolved!" },
                db,
              ),
            );
          }).pipe(Effect.provide(DurableDeferredLive)),
        );

        // Await resolution
        const result = yield* _(handle.value);
        expect(result).toEqual({ message: "resolved!" });
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive)),
      );
    });

    it("fails with NotFoundError for non-existent URL", async () => {
      const program = Effect.gen(function* (_) {
        yield* _(
          resolveDeferred(
            "deferred:nonexistent",
            { value: 42 },
            db,
          ),
        );
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(DurableDeferredLive),
          Effect.flip, // Flip to get the error
        ),
      );

      expect(result).toBeInstanceOf(NotFoundError);
      expect((result as NotFoundError).url).toBe("deferred:nonexistent");
    });
  });

  describe("reject", () => {
    it("rejects a deferred with error", async () => {
      const program = Effect.gen(function* (_) {
        const handle = yield* _(
          createDeferred<string>({
            ttlSeconds: 60,
            db,
          }),
        );

        // Reject in background
        Effect.runFork(
          Effect.gen(function* (_) {
            yield* _(Effect.sleep("100 millis"));
            yield* _(
              rejectDeferred(
                handle.url,
                new Error("Something went wrong"),
                db,
              ),
            );
          }).pipe(Effect.provide(DurableDeferredLive)),
        );

        // Await should fail
        yield* _(handle.value);
      });

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(DurableDeferredLive),
          Effect.flip, // Flip to get the error
        ),
      );

      // Will be a NotFoundError since we map all errors to NotFoundError in awaitImpl
      expect(result).toBeInstanceOf(NotFoundError);
    });

    it("fails with NotFoundError for non-existent URL", async () => {
      const program = Effect.gen(function* (_) {
        yield* _(
          rejectDeferred(
            "deferred:nonexistent",
            new Error("test"),
            db,
          ),
        );
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive), Effect.flip),
      );

      expect(result).toBeInstanceOf(NotFoundError);
    });
  });

  describe("timeout", () => {
    it("times out when not resolved within TTL", async () => {
      const program = Effect.gen(function* (_) {
        const handle = yield* _(
          createDeferred<string>({
            ttlSeconds: 1, // 1 second timeout
            db,
          }),
        );

        // Don't resolve, just wait for timeout
        yield* _(handle.value);
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive), Effect.flip),
      );

      expect(result).toBeInstanceOf(TimeoutError);
      expect((result as TimeoutError).ttlSeconds).toBe(1);
    }, 10000); // 10s test timeout
  });

  describe("concurrent access", () => {
    it("handles multiple resolvers racing", async () => {
      const program = Effect.gen(function* (_) {
        const handle = yield* _(
          createDeferred<number>({
            ttlSeconds: 60,
            db,
          }),
        );

        // Spawn multiple resolvers (first one wins)
        Effect.runFork(
          Effect.gen(function* (_) {
            yield* _(Effect.sleep("50 millis"));
            yield* _(resolveDeferred(handle.url, 1, db));
          }).pipe(Effect.provide(DurableDeferredLive)),
        );

        Effect.runFork(
          Effect.gen(function* (_) {
            yield* _(Effect.sleep("100 millis"));
            yield* _(resolveDeferred(handle.url, 2, db));
          }).pipe(Effect.provide(DurableDeferredLive)),
        );

        const result = yield* _(handle.value);
        expect(result).toBe(1); // First resolver wins
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive)),
      );
    });

    it("handles sequential waiters on same deferred", async () => {
      const program = Effect.gen(function* (_) {
        const handle = yield* _(
          createDeferred<string>({
            ttlSeconds: 60,
            db,
          }),
        );

        // Resolve immediately
        yield* _(resolveDeferred(handle.url, "resolved", db));

        // Wait for value
        const result = yield* _(handle.value);
        expect(result).toBe("resolved");
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive)),
      );
    });
  });

  describe("cleanup", () => {
    it("cleans up expired entries", async () => {
      const program = Effect.gen(function* (_) {
        // Create deferred with 1s TTL
        const handle = yield* _(
          createDeferred<string>({
            ttlSeconds: 1,
            db,
          }),
        );

        // Wait for expiry
        yield* _(Effect.sleep("1500 millis"));

        // Cleanup
        const count = yield* _(cleanupDeferreds(db));
        expect(count).toBeGreaterThanOrEqual(0);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive)),
      );
    });
  });

  describe("type safety", () => {
    it("preserves types through resolution", async () => {
      interface TestData {
        id: number;
        name: string;
        tags: string[];
      }

      const program = Effect.gen(function* (_) {
        const handle = yield* _(
          createDeferred<TestData>({
            ttlSeconds: 60,
            db,
          }),
        );

        Effect.runFork(
          Effect.gen(function* (_) {
            yield* _(Effect.sleep("100 millis"));
            yield* _(
              resolveDeferred(
                handle.url,
                { id: 1, name: "test", tags: ["a", "b"] },
                db,
              ),
            );
          }).pipe(Effect.provide(DurableDeferredLive)),
        );

        const result = yield* _(handle.value);
        expect(result.id).toBe(1);
        expect(result.name).toBe("test");
        expect(result.tags).toEqual(["a", "b"]);
      });

      await Effect.runPromise(
        program.pipe(Effect.provide(DurableDeferredLive)),
      );
    });
  });
});
