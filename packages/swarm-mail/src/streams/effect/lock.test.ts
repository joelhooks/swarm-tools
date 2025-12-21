/**
 * DurableLock Tests - Distributed Mutual Exclusion
 *
 * Tests:
 * - Basic acquire/release
 * - Lock expiry (TTL)
 * - Contention handling (retry with backoff)
 * - Concurrent acquisition attempts
 * - withLock helper
 * - Deadlock detection (lock not held)
 */

import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DurableLock,
  DurableLockLive,
  acquireLock,
  releaseLock,
  withLock,
  type LockHandle,
  type LockConfig,
} from "./lock";
import { createInMemorySwarmMailLibSQL } from "../../libsql.convenience";
import type { DatabaseAdapter } from "../../types/database";

// Shared test database adapter
let db: DatabaseAdapter;
let closeDb: () => Promise<void>;

describe("DurableLock", () => {
  beforeEach(async () => {
    const testId = randomUUID().slice(0, 8);
    const swarmMail = await createInMemorySwarmMailLibSQL(testId);
    db = await swarmMail.getDatabase();
    closeDb = () => swarmMail.close();
    
    // Reset locks table
    await db.exec("DELETE FROM locks");
  });

  afterEach(async () => {
    await closeDb();
  });

  // Helper to create config with db
  const config = (overrides?: Partial<Omit<LockConfig, "db">>): LockConfig => ({
    db,
    ...overrides,
  });

  describe("Basic acquire/release", () => {
    it("should acquire and release a lock", async () => {
      const program = Effect.gen(function* (_) {
        const service = yield* _(DurableLock);
        const lock = yield* _(service.acquire("test-resource", config()));

        expect(lock.resource).toBe("test-resource");
        expect(lock.holder).toBeDefined();
        expect(lock.seq).toBe(0);
        expect(lock.acquiredAt).toBeGreaterThan(0);
        expect(lock.expiresAt).toBeGreaterThan(lock.acquiredAt);

        yield* _(lock.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });

    it("should use convenience function acquireLock", async () => {
      const program = Effect.gen(function* (_) {
        const lock = yield* _(acquireLock("test-resource", config()));

        expect(lock.resource).toBe("test-resource");
        expect(lock.seq).toBe(0);

        yield* _(lock.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });

    it("should use convenience function releaseLock", async () => {
      const program = Effect.gen(function* (_) {
        const lock = yield* _(acquireLock("test-resource", config()));
        yield* _(releaseLock(lock.resource, lock.holder, db));
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });
  });

  describe("Lock contention", () => {
    it("should fail when lock is held by another holder", async () => {
      const program = Effect.gen(function* (_) {
        // First lock succeeds
        const lock1 = yield* _(
          acquireLock("test-resource", config({ ttlSeconds: 10 })),
        );

        // Second lock should timeout after retries
        const result2 = yield* _(
          acquireLock("test-resource", config({ maxRetries: 2, baseDelayMs: 10 })).pipe(
            Effect.either,
          ),
        );

        expect(result2._tag).toBe("Left");
        if (result2._tag === "Left") {
          const error = result2.left;
          expect(error._tag).toBe("LockTimeout");
          if (error._tag === "LockTimeout") {
            expect(error.resource).toBe("test-resource");
          }
        }

        // Cleanup
        yield* _(lock1.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });

    it("should allow same holder to re-acquire lock", async () => {
      const program = Effect.gen(function* (_) {
        const holder = "custom-holder-123";
        const lock1 = yield* _(
          acquireLock("test-resource", config({ holderId: holder, ttlSeconds: 10 })),
        );

        expect(lock1.seq).toBe(0);

        // Same holder can re-acquire (increments seq)
        const lock2 = yield* _(
          acquireLock("test-resource", config({ holderId: holder, ttlSeconds: 10 })),
        );

        expect(lock2.seq).toBe(1);
        expect(lock2.holder).toBe(holder);

        // Cleanup
        yield* _(lock2.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });
  });

  describe("Lock expiry (TTL)", () => {
    it("should allow acquisition after lock expires", async () => {
      const program = Effect.gen(function* (_) {
        // Acquire with 1 second TTL
        const lock1 = yield* _(acquireLock("test-resource", config({ ttlSeconds: 1 })));

        expect(lock1.seq).toBe(0);

        // Wait for expiry
        yield* _(Effect.sleep("1100 millis"));

        // Different holder can now acquire
        const lock2 = yield* _(
          acquireLock("test-resource", config({ holderId: "other" })),
        );

        expect(lock2.seq).toBeGreaterThan(0); // Sequence incremented
        expect(lock2.holder).toBe("other");

        // Cleanup
        yield* _(lock2.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    }, 5000);
  });

  describe("withLock helper", () => {
    it("should execute effect with automatic lock/release", async () => {
      const program = Effect.gen(function* (_) {
        let executed = false;

        yield* _(
          withLock(
            "test-resource",
            Effect.sync(() => {
              executed = true;
              return 42;
            }),
            config(),
          ),
        );

        expect(executed).toBe(true);
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });

    it("should release lock even if effect fails", async () => {
      const program = Effect.gen(function* (_) {
        const service = yield* _(DurableLock);

        // withLock with failing effect
        const result = yield* _(
          service
            .withLock(
              "test-resource",
              Effect.fail(new Error("Intentional failure")),
              config(),
            )
            .pipe(Effect.either),
        );

        expect(result._tag).toBe("Left");

        // Lock should be released - we can acquire it again
        const lock = yield* _(service.acquire("test-resource", config()));
        expect(lock.seq).toBe(0); // Lock was deleted, seq resets

        yield* _(lock.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });

    it("should pass through effect result", async () => {
      const program = Effect.gen(function* (_) {
        const result = yield* _(withLock("test-resource", Effect.succeed(42), config()));

        expect(result).toBe(42);
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });
  });

  describe("Concurrent acquisition", () => {
    it("should handle concurrent acquisition attempts", async () => {
      const program = Effect.gen(function* (_) {
        const attempts = Array.from({ length: 5 }, (_, i) =>
          acquireLock("test-resource", config({
            holderId: `holder-${i}`,
            maxRetries: 3,
            baseDelayMs: 10,
          })).pipe(Effect.either),
        );

        // Run all attempts in parallel
        const results = yield* _(
          Effect.all(attempts, { concurrency: "unbounded" }),
        );

        // Exactly one should succeed
        const successes = results.filter((r) => r._tag === "Right");
        const failures = results.filter((r) => r._tag === "Left");

        expect(successes.length).toBe(1);
        expect(failures.length).toBe(4);

        // All failures should be timeout
        for (const failure of failures) {
          if (failure._tag === "Left") {
            expect(failure.left._tag).toBe("LockTimeout");
          }
        }

        // Cleanup
        if (successes[0] && successes[0]._tag === "Right") {
          yield* _(successes[0].right.release());
        }
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    }, 10000);

    it("should handle sequential acquisition after release", async () => {
      const program = Effect.gen(function* (_) {
        const results: LockHandle[] = [];

        // Sequential acquisitions
        for (let i = 0; i < 3; i++) {
          const lock = yield* _(
            acquireLock("test-resource", config({ holderId: `holder-${i}` })),
          );
          results.push(lock);
          yield* _(lock.release());
        }

        // All get seq=0 because lock is deleted after each release
        expect(results[0]?.seq).toBe(0);
        expect(results[1]?.seq).toBe(0);
        expect(results[2]?.seq).toBe(0);
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });
  });

  describe("Error handling", () => {
    it("should fail with LockNotHeld when releasing unowned lock", async () => {
      const program = Effect.gen(function* (_) {
        const lock = yield* _(acquireLock("test-resource", config()));

        // Try to release with wrong holder
        const result = yield* _(
          releaseLock("test-resource", "wrong-holder", db).pipe(Effect.either),
        );

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          const error = result.left;
          expect(error._tag).toBe("LockNotHeld");
          if (error._tag === "LockNotHeld") {
            expect(error.resource).toBe("test-resource");
            expect(error.holder).toBe("wrong-holder");
          }
        }

        // Cleanup
        yield* _(lock.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });

    it("should fail with LockNotHeld when releasing already-released lock", async () => {
      const program = Effect.gen(function* (_) {
        const lock = yield* _(acquireLock("test-resource", config()));

        // First release succeeds
        yield* _(lock.release());

        // Second release fails
        const result = yield* _(lock.release().pipe(Effect.either));

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("LockNotHeld");
        }
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });
  });

  describe("Configuration", () => {
    it("should respect custom TTL", async () => {
      const program = Effect.gen(function* (_) {
        const ttlSeconds = 5;
        const lock = yield* _(acquireLock("test-resource", config({ ttlSeconds })));

        const expectedExpiry = lock.acquiredAt + ttlSeconds * 1000;
        expect(lock.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100);
        expect(lock.expiresAt).toBeLessThanOrEqual(expectedExpiry + 100);

        yield* _(lock.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });

    it("should respect custom holder ID", async () => {
      const program = Effect.gen(function* (_) {
        const holderId = "my-custom-holder-id";
        const lock = yield* _(acquireLock("test-resource", config({ holderId })));

        expect(lock.holder).toBe(holderId);

        yield* _(lock.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });

    it("should respect retry configuration", async () => {
      const program = Effect.gen(function* (_) {
        // Hold lock
        const lock1 = yield* _(acquireLock("test-resource", config()));

        const startTime = Date.now();

        // Try to acquire with quick timeout (2 retries, 10ms each)
        const result = yield* _(
          acquireLock("test-resource", config({ maxRetries: 2, baseDelayMs: 10 })).pipe(
            Effect.either,
          ),
        );

        const elapsed = Date.now() - startTime;

        expect(result._tag).toBe("Left");
        // Should timeout quickly (< 500ms with exponential backoff)
        expect(elapsed).toBeLessThan(500);

        yield* _(lock1.release());
      });

      await Effect.runPromise(program.pipe(Effect.provide(DurableLockLive)));
    });
  });
});
