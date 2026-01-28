/**
 * Rate Limiter Integration Tests
 *
 * Tests the rate limiting functionality with both Redis and SQLite backends.
 * Requires Redis to be running for Redis tests (skipped if unavailable).
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createRateLimiter,
  InMemoryRateLimiter,
  SqliteRateLimiter,
  RedisRateLimiter,
  resetFallbackWarning,
  getLimitsForEndpoint,
  DEFAULT_LIMITS,
  type RateLimiter,
} from "./rate-limiter";
import Redis from "ioredis";

// ============================================================================
// Test Utilities
// ============================================================================

const TEST_AGENT = "TestAgent";
const TEST_ENDPOINT = "send";

/**
 * Create a temporary directory for SQLite tests
 */
function createTempDir(): string {
  const dir = join(tmpdir(), `rate-limiter-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Check if Redis is available
 */
async function isRedisAvailable(): Promise<boolean> {
  try {
    const redis = new Redis({
      connectTimeout: 1000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    // Also verify write access — read-only replicas respond to ping but reject writes
    const testKey = `ratelimit:__write_test__:${Date.now()}`;
    await redis.set(testKey, "1", "EX", 5);
    await redis.del(testKey);
    await redis.quit();
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// InMemoryRateLimiter Tests
// ============================================================================

describe("InMemoryRateLimiter", () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  afterEach(async () => {
    await limiter.close();
  });

  test("allows requests under limit", async () => {
    const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  test("blocks requests over per-minute limit", async () => {
    const limits = getLimitsForEndpoint(TEST_ENDPOINT);

    // Record requests up to the limit
    for (let i = 0; i < limits.perMinute; i++) {
      await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);
    }

    // Next request should be blocked
    const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test("tracks per-agent limits separately", async () => {
    const limits = getLimitsForEndpoint(TEST_ENDPOINT);

    // Fill up Agent1's limit
    for (let i = 0; i < limits.perMinute; i++) {
      await limiter.recordRequest("Agent1", TEST_ENDPOINT);
    }

    // Agent1 should be blocked
    const result1 = await limiter.checkLimit("Agent1", TEST_ENDPOINT);
    expect(result1.allowed).toBe(false);

    // Agent2 should still be allowed
    const result2 = await limiter.checkLimit("Agent2", TEST_ENDPOINT);
    expect(result2.allowed).toBe(true);
  });

  test("tracks per-endpoint limits separately", async () => {
    const sendLimits = getLimitsForEndpoint("send");

    // Fill up send limit
    for (let i = 0; i < sendLimits.perMinute; i++) {
      await limiter.recordRequest(TEST_AGENT, "send");
    }

    // send should be blocked
    const sendResult = await limiter.checkLimit(TEST_AGENT, "send");
    expect(sendResult.allowed).toBe(false);

    // inbox should still be allowed
    const inboxResult = await limiter.checkLimit(TEST_AGENT, "inbox");
    expect(inboxResult.allowed).toBe(true);
  });

  test("reset clears all limits", async () => {
    // Record some requests
    await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);
    await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);

    // Reset
    limiter.reset();

    // Should have full limit available
    const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
    const limits = getLimitsForEndpoint(TEST_ENDPOINT);
    expect(result.remaining).toBe(limits.perMinute);
  });

  test("returns correct resetAt timestamp", async () => {
    const limits = getLimitsForEndpoint(TEST_ENDPOINT);
    const now = Date.now();

    // Fill up limit
    for (let i = 0; i < limits.perMinute; i++) {
      await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);
    }

    const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
    expect(result.allowed).toBe(false);

    // resetAt should be approximately 1 minute from the first request
    expect(result.resetAt).toBeGreaterThan(now);
    expect(result.resetAt).toBeLessThanOrEqual(now + 60_000 + 1000); // Allow 1s tolerance
  });
});

// ============================================================================
// SqliteRateLimiter Tests
// ============================================================================

describe("SqliteRateLimiter", () => {
  let limiter: SqliteRateLimiter;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    const dbPath = join(tempDir, "rate-limits.db");
    limiter = new SqliteRateLimiter(dbPath);
  });

  afterEach(async () => {
    await limiter.close();
    cleanupTempDir(tempDir);
  });

  test("allows requests under limit", async () => {
    const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  test("blocks requests over per-minute limit", async () => {
    const limits = getLimitsForEndpoint(TEST_ENDPOINT);

    // Record requests up to the limit
    for (let i = 0; i < limits.perMinute; i++) {
      await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);
    }

    // Next request should be blocked
    const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test("creates database directory if not exists", () => {
    const nestedDir = join(tempDir, "nested", "path");
    const dbPath = join(nestedDir, "rate-limits.db");

    // Should not throw
    const nestedLimiter = new SqliteRateLimiter(dbPath);
    expect(existsSync(nestedDir)).toBe(true);
    nestedLimiter.close();
  });

  test("persists data across instances", async () => {
    const dbPath = join(tempDir, "persistent.db");

    // First instance - record some requests
    const limiter1 = new SqliteRateLimiter(dbPath);
    await limiter1.recordRequest(TEST_AGENT, TEST_ENDPOINT);
    await limiter1.recordRequest(TEST_AGENT, TEST_ENDPOINT);
    await limiter1.close();

    // Second instance - should see the recorded requests
    const limiter2 = new SqliteRateLimiter(dbPath);
    const result = await limiter2.checkLimit(TEST_AGENT, TEST_ENDPOINT);
    const limits = getLimitsForEndpoint(TEST_ENDPOINT);
    expect(result.remaining).toBe(limits.perMinute - 2);
    await limiter2.close();
  });
});

// ============================================================================
// RedisRateLimiter Tests (skipped if Redis unavailable)
// ============================================================================

describe("RedisRateLimiter", async () => {
  const redisAvailable = await isRedisAvailable();

  test.skipIf(!redisAvailable)("allows requests under limit", async () => {
    const redis = new Redis();
    const limiter = new RedisRateLimiter(redis);

    try {
      // Clean up any existing keys
      await redis.del(`ratelimit:${TEST_AGENT}:${TEST_ENDPOINT}:minute`);
      await redis.del(`ratelimit:${TEST_AGENT}:${TEST_ENDPOINT}:hour`);

      const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    } finally {
      await limiter.close();
    }
  });

  test.skipIf(!redisAvailable)(
    "blocks requests over per-minute limit",
    async () => {
      const redis = new Redis();
      const limiter = new RedisRateLimiter(redis);

      try {
        // Clean up any existing keys
        await redis.del(`ratelimit:${TEST_AGENT}:${TEST_ENDPOINT}:minute`);
        await redis.del(`ratelimit:${TEST_AGENT}:${TEST_ENDPOINT}:hour`);

        const limits = getLimitsForEndpoint(TEST_ENDPOINT);

        // Record requests up to the limit
        for (let i = 0; i < limits.perMinute; i++) {
          await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);
        }

        // Next request should be blocked
        const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
      } finally {
        await limiter.close();
      }
    },
  );

  test.skipIf(!redisAvailable)("sets TTL on keys", async () => {
    const redis = new Redis();
    const limiter = new RedisRateLimiter(redis);

    try {
      // Clean up any existing keys
      const minuteKey = `ratelimit:${TEST_AGENT}:${TEST_ENDPOINT}:minute`;
      const hourKey = `ratelimit:${TEST_AGENT}:${TEST_ENDPOINT}:hour`;
      await redis.del(minuteKey);
      await redis.del(hourKey);

      // Record a request
      await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);

      // Check TTL is set
      const minuteTTL = await redis.ttl(minuteKey);
      const hourTTL = await redis.ttl(hourKey);

      expect(minuteTTL).toBeGreaterThan(0);
      expect(minuteTTL).toBeLessThanOrEqual(120); // 2 minutes
      expect(hourTTL).toBeGreaterThan(0);
      expect(hourTTL).toBeLessThanOrEqual(7200); // 2 hours
    } finally {
      await limiter.close();
    }
  });
});

// ============================================================================
// createRateLimiter Factory Tests
// ============================================================================

describe("createRateLimiter", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    resetFallbackWarning();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test("creates InMemoryRateLimiter when backend is memory", async () => {
    const limiter = await createRateLimiter({ backend: "memory" });
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    await limiter.close();
  });

  test("creates SqliteRateLimiter when backend is sqlite", async () => {
    const dbPath = join(tempDir, "test.db");
    const limiter = await createRateLimiter({
      backend: "sqlite",
      sqlitePath: dbPath,
    });
    expect(limiter).toBeInstanceOf(SqliteRateLimiter);
    await limiter.close();
  });

  test("falls back to SQLite when Redis unavailable", async () => {
    const dbPath = join(tempDir, "fallback.db");
    const limiter = await createRateLimiter({
      redisUrl: "redis://localhost:59999", // Non-existent port
      sqlitePath: dbPath,
    });

    // Should fall back to SQLite
    expect(limiter).toBeInstanceOf(SqliteRateLimiter);
    await limiter.close();
  });
});

// ============================================================================
// Configuration Tests
// ============================================================================

describe("Configuration", () => {
  test("DEFAULT_LIMITS has all expected endpoints", () => {
    const expectedEndpoints = [
      "send",
      "reserve",
      "release",
      "ack",
      "inbox",
      "read_message",
      "summarize_thread",
      "search",
    ];

    for (const endpoint of expectedEndpoints) {
      expect(DEFAULT_LIMITS[endpoint]).toBeDefined();
      expect(DEFAULT_LIMITS[endpoint].perMinute).toBeGreaterThan(0);
      expect(DEFAULT_LIMITS[endpoint].perHour).toBeGreaterThan(0);
    }
  });

  test("getLimitsForEndpoint returns defaults for known endpoints", () => {
    const limits = getLimitsForEndpoint("send");
    expect(limits.perMinute).toBe(DEFAULT_LIMITS.send.perMinute);
    expect(limits.perHour).toBe(DEFAULT_LIMITS.send.perHour);
  });

  test("getLimitsForEndpoint returns fallback for unknown endpoints", () => {
    const limits = getLimitsForEndpoint("unknown_endpoint");
    expect(limits.perMinute).toBe(60);
    expect(limits.perHour).toBe(600);
  });

  test("env vars override default limits", () => {
    const originalMin = process.env.OPENCODE_RATE_LIMIT_SEND_PER_MIN;
    const originalHour = process.env.OPENCODE_RATE_LIMIT_SEND_PER_HOUR;

    try {
      process.env.OPENCODE_RATE_LIMIT_SEND_PER_MIN = "100";
      process.env.OPENCODE_RATE_LIMIT_SEND_PER_HOUR = "1000";

      const limits = getLimitsForEndpoint("send");
      expect(limits.perMinute).toBe(100);
      expect(limits.perHour).toBe(1000);
    } finally {
      // Restore original values
      if (originalMin !== undefined) {
        process.env.OPENCODE_RATE_LIMIT_SEND_PER_MIN = originalMin;
      } else {
        delete process.env.OPENCODE_RATE_LIMIT_SEND_PER_MIN;
      }
      if (originalHour !== undefined) {
        process.env.OPENCODE_RATE_LIMIT_SEND_PER_HOUR = originalHour;
      } else {
        delete process.env.OPENCODE_RATE_LIMIT_SEND_PER_HOUR;
      }
    }
  });
});

// ============================================================================
// Dual Window Tests
// ============================================================================

describe("Dual Window Enforcement", () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  afterEach(async () => {
    await limiter.close();
  });

  test("enforces both minute and hour limits", async () => {
    // Use an endpoint with low limits for testing
    // inbox has 60/min, 600/hour
    const endpoint = "inbox";
    const limits = getLimitsForEndpoint(endpoint);

    // Record requests up to minute limit
    for (let i = 0; i < limits.perMinute; i++) {
      await limiter.recordRequest(TEST_AGENT, endpoint);
    }

    // Should be blocked by minute limit
    const result = await limiter.checkLimit(TEST_AGENT, endpoint);
    expect(result.allowed).toBe(false);
  });

  test("returns most restrictive remaining count", async () => {
    // Record a few requests
    await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);
    await limiter.recordRequest(TEST_AGENT, TEST_ENDPOINT);

    const result = await limiter.checkLimit(TEST_AGENT, TEST_ENDPOINT);
    const limits = getLimitsForEndpoint(TEST_ENDPOINT);

    // Remaining should be based on minute window (more restrictive)
    expect(result.remaining).toBe(limits.perMinute - 2);
  });
});
