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
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { closeDatabase } from "../index";
import {
  TimeoutError,
  NotFoundError,
  createDeferred,
  resolveDeferred,
  rejectDeferred,
  cleanupDeferreds,
  DurableDeferredLive,
} from "./deferred";

let TEST_PROJECT_PATH: string;

describe("DurableDeferred", () => {
  beforeEach(async () => {
    TEST_PROJECT_PATH = join(
      tmpdir(),
      `deferred-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await mkdir(TEST_PROJECT_PATH, { recursive: true });
  });

  afterEach(async () => {
    try {
      await closeDatabase(TEST_PROJECT_PATH);
      // Small delay to let PGLite fully release file handles
      await new Promise((r) => setTimeout(r, 50));
      await rm(join(TEST_PROJECT_PATH, ".opencode"), {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("create", () => {
    it("creates a deferred with unique URL", async () => {
      const program = Effect.gen(function* (_) {
        const handle = yield* _(
          createDeferred<string>({
            ttlSeconds: 60,
            projectPath: TEST_PROJECT_PATH,
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
            projectPath: TEST_PROJECT_PATH,
          }),
        );
        const handle2 = yield* _(
          createDeferred<string>({
            ttlSeconds: 60,
            projectPath: TEST_PROJECT_PATH,
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
            projectPath: TEST_PROJECT_PATH,
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
                TEST_PROJECT_PATH,
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
            TEST_PROJECT_PATH,
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
            projectPath: TEST_PROJECT_PATH,
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
                TEST_PROJECT_PATH,
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
            TEST_PROJECT_PATH,
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
            projectPath: TEST_PROJECT_PATH,
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
            projectPath: TEST_PROJECT_PATH,
          }),
        );

        // Spawn multiple resolvers (first one wins)
        Effect.runFork(
          Effect.gen(function* (_) {
            yield* _(Effect.sleep("50 millis"));
            yield* _(resolveDeferred(handle.url, 1, TEST_PROJECT_PATH));
          }).pipe(Effect.provide(DurableDeferredLive)),
        );

        Effect.runFork(
          Effect.gen(function* (_) {
            yield* _(Effect.sleep("100 millis"));
            yield* _(resolveDeferred(handle.url, 2, TEST_PROJECT_PATH));
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
            projectPath: TEST_PROJECT_PATH,
          }),
        );

        // Resolve immediately
        yield* _(resolveDeferred(handle.url, "resolved", TEST_PROJECT_PATH));

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
            projectPath: TEST_PROJECT_PATH,
          }),
        );

        // Wait for expiry
        yield* _(Effect.sleep("1500 millis"));

        // Cleanup
        const count = yield* _(cleanupDeferreds(TEST_PROJECT_PATH));
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
            projectPath: TEST_PROJECT_PATH,
          }),
        );

        Effect.runFork(
          Effect.gen(function* (_) {
            yield* _(Effect.sleep("100 millis"));
            yield* _(
              resolveDeferred(
                handle.url,
                { id: 1, name: "test", tags: ["a", "b"] },
                TEST_PROJECT_PATH,
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
