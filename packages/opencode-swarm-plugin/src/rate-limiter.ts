/**
 * Rate Limiter Module - Distributed rate limiting for Agent Mail
 *
 * Provides sliding window rate limiting with dual backends:
 * - Redis (primary) - Distributed, uses sorted sets for sliding window
 * - SQLite (fallback) - Local, file-based persistence
 *
 * Features:
 * - Dual window enforcement: per-minute AND per-hour limits
 * - Automatic backend fallback (Redis → SQLite)
 * - Configurable limits per endpoint via env vars
 * - Auto-cleanup of expired entries
 *
 * @example
 * ```typescript
 * // Create rate limiter (auto-selects backend)
 * const limiter = await createRateLimiter();
 *
 * // Check if request is allowed
 * const result = await limiter.checkLimit("BlueLake", "send");
 * if (!result.allowed) {
 *   console.log(`Rate limited. Reset at ${result.resetAt}`);
 * }
 *
 * // Record a request after it completes
 * await limiter.recordRequest("BlueLake", "send");
 * ```
 */

import Redis from "ioredis";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// SQLite is optional - only available in Bun runtime
// We use dynamic import to avoid breaking Node.js environments
interface BunDatabase {
  run(
    sql: string,
    params?: unknown[],
  ): { changes: number; lastInsertRowid: number };
  query<T>(sql: string): {
    get(...params: unknown[]): T | null;
  };
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  };
  close(): void;
}

let sqliteAvailable = false;
let createDatabase: ((path: string) => BunDatabase) | null = null;

// Try to load bun:sqlite at module load time
try {
  if (typeof globalThis.Bun !== "undefined") {
    // We're in Bun runtime - dynamic import will work
    const bunSqlite = await import("bun:sqlite");
    createDatabase = (path: string) =>
      new bunSqlite.Database(path) as unknown as BunDatabase;
    sqliteAvailable = true;
  }
} catch {
  // Not in Bun runtime, SQLite fallback unavailable
  sqliteAvailable = false;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Result of checking a rate limit
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the most restrictive window */
  remaining: number;
  /** Unix timestamp (ms) when the limit resets */
  resetAt: number;
}

/**
 * Rate limiter interface
 */
export interface RateLimiter {
  /**
   * Check if a request is allowed under rate limits
   * Checks BOTH minute and hour windows - both must pass
   *
   * @param agentName - The agent making the request
   * @param endpoint - The endpoint being accessed
   * @returns Rate limit check result
   */
  checkLimit(agentName: string, endpoint: string): Promise<RateLimitResult>;

  /**
   * Record a request against the rate limit
   * Should be called AFTER the request succeeds
   *
   * @param agentName - The agent making the request
   * @param endpoint - The endpoint being accessed
   */
  recordRequest(agentName: string, endpoint: string): Promise<void>;

  /**
   * Close the rate limiter and release resources
   */
  close(): Promise<void>;
}

/**
 * Rate limit configuration for an endpoint
 */
export interface EndpointLimits {
  /** Requests allowed per minute */
  perMinute: number;
  /** Requests allowed per hour */
  perHour: number;
}

// ============================================================================
// Default Limits
// ============================================================================

/**
 * Default rate limits per endpoint
 * Can be overridden via OPENCODE_RATE_LIMIT_{ENDPOINT}_PER_MIN and _PER_HOUR
 */
export const DEFAULT_LIMITS: Record<string, EndpointLimits> = {
  send: { perMinute: 20, perHour: 200 },
  reserve: { perMinute: 10, perHour: 100 },
  release: { perMinute: 10, perHour: 100 },
  ack: { perMinute: 20, perHour: 200 },
  inbox: { perMinute: 60, perHour: 600 },
  read_message: { perMinute: 60, perHour: 600 },
  summarize_thread: { perMinute: 30, perHour: 300 },
  search: { perMinute: 30, perHour: 300 },
};

/**
 * Get rate limits for an endpoint, with env var overrides
 *
 * @param endpoint - The endpoint name
 * @returns Rate limits for the endpoint
 */
export function getLimitsForEndpoint(endpoint: string): EndpointLimits {
  const defaults = DEFAULT_LIMITS[endpoint] || { perMinute: 60, perHour: 600 };
  const upperEndpoint = endpoint.toUpperCase();

  const perMinuteEnv =
    process.env[`OPENCODE_RATE_LIMIT_${upperEndpoint}_PER_MIN`];
  const perHourEnv =
    process.env[`OPENCODE_RATE_LIMIT_${upperEndpoint}_PER_HOUR`];

  // Parse and validate env vars, fall back to defaults on NaN
  const parsedPerMinute = perMinuteEnv ? parseInt(perMinuteEnv, 10) : NaN;
  const parsedPerHour = perHourEnv ? parseInt(perHourEnv, 10) : NaN;

  return {
    perMinute: Number.isNaN(parsedPerMinute)
      ? defaults.perMinute
      : parsedPerMinute,
    perHour: Number.isNaN(parsedPerHour) ? defaults.perHour : parsedPerHour,
  };
}

// ============================================================================
// Redis Rate Limiter
// ============================================================================

/**
 * Redis-backed rate limiter using sorted sets
 *
 * Uses sliding window algorithm:
 * 1. Store each request as a member with timestamp as score
 * 2. Remove expired entries (outside window)
 * 3. Count remaining entries
 *
 * Key format: ratelimit:{agent}:{endpoint}:{window}
 * Window values: "minute" or "hour"
 */
export class RedisRateLimiter implements RateLimiter {
  private redis: Redis;
  private connected: boolean = false;

  constructor(redis: Redis) {
    this.redis = redis;
    this.connected = true;
  }

  /**
   * Build Redis key for rate limiting
   */
  private buildKey(
    agentName: string,
    endpoint: string,
    window: "minute" | "hour",
  ): string {
    return `ratelimit:${agentName}:${endpoint}:${window}`;
  }

  /**
   * Get window duration in milliseconds
   */
  private getWindowDuration(window: "minute" | "hour"): number {
    return window === "minute" ? 60_000 : 3_600_000;
  }

  async checkLimit(
    agentName: string,
    endpoint: string,
  ): Promise<RateLimitResult> {
    const limits = getLimitsForEndpoint(endpoint);
    const now = Date.now();

    // Check both windows
    const [minuteResult, hourResult] = await Promise.all([
      this.checkWindow(agentName, endpoint, "minute", limits.perMinute, now),
      this.checkWindow(agentName, endpoint, "hour", limits.perHour, now),
    ]);

    // Return the most restrictive result (both windows must allow)
    if (!minuteResult.allowed) {
      return minuteResult;
    }
    if (!hourResult.allowed) {
      return hourResult;
    }

    // Both allowed - return the one with fewer remaining
    return minuteResult.remaining <= hourResult.remaining
      ? minuteResult
      : hourResult;
  }

  /**
   * Check a single window's rate limit
   */
  private async checkWindow(
    agentName: string,
    endpoint: string,
    window: "minute" | "hour",
    limit: number,
    now: number,
  ): Promise<RateLimitResult> {
    const key = this.buildKey(agentName, endpoint, window);
    const windowDuration = this.getWindowDuration(window);
    const windowStart = now - windowDuration;

    // Remove expired entries, count current ones, and fetch oldest in a single pipeline
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zrange(key, 0, 0, "WITHSCORES"); // Fetch oldest entry atomically

    const results = await pipeline.exec();
    if (!results) {
      return { allowed: true, remaining: limit, resetAt: now + windowDuration };
    }

    const count = (results[1]?.[1] as number) || 0;
    const remaining = Math.max(0, limit - count);
    const allowed = count < limit;

    // Calculate reset time based on oldest entry in window (fetched atomically)
    let resetAt = now + windowDuration;
    if (!allowed) {
      const oldest = (results[2]?.[1] as string[]) || [];
      if (oldest.length >= 2) {
        const oldestTimestamp = parseInt(oldest[1], 10);
        resetAt = oldestTimestamp + windowDuration;
      }
    }

    return { allowed, remaining, resetAt };
  }

  async recordRequest(agentName: string, endpoint: string): Promise<void> {
    const now = Date.now();
    const memberId = crypto.randomUUID();

    // Record in both windows
    const minuteKey = this.buildKey(agentName, endpoint, "minute");
    const hourKey = this.buildKey(agentName, endpoint, "hour");

    const pipeline = this.redis.pipeline();

    // Add to minute window with TTL
    pipeline.zadd(minuteKey, now, `${memberId}:minute`);
    pipeline.expire(minuteKey, 120); // 2 minutes TTL for safety

    // Add to hour window with TTL
    pipeline.zadd(hourKey, now, `${memberId}:hour`);
    pipeline.expire(hourKey, 7200); // 2 hours TTL for safety

    await pipeline.exec();
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.redis.quit();
      this.connected = false;
    }
  }
}

// ============================================================================
// SQLite Rate Limiter
// ============================================================================

/**
 * SQLite-backed rate limiter for local/fallback use
 *
 * Table schema:
 * - agent_name: TEXT
 * - endpoint: TEXT
 * - window: TEXT ('minute' or 'hour')
 * - timestamp: INTEGER (Unix ms)
 *
 * Uses sliding window via COUNT query with timestamp filter.
 */
export class SqliteRateLimiter implements RateLimiter {
  private db: BunDatabase;

  constructor(dbPath: string) {
    if (!sqliteAvailable || !createDatabase) {
      throw new Error("SQLite is not available in this runtime (requires Bun)");
    }

    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = createDatabase(dbPath);
    this.initialize();
  }

  /**
   * Initialize the database schema and cleanup old entries
   */
  private initialize(): void {
    // Create table if not exists
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_name TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        window TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // Create indexes for fast queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup 
      ON rate_limits (agent_name, endpoint, window, timestamp)
    `);

    // Cleanup old entries (older than 2 hours)
    const cutoff = Date.now() - 7_200_000;
    this.db.run(`DELETE FROM rate_limits WHERE timestamp < ?`, [cutoff]);
  }

  async checkLimit(
    agentName: string,
    endpoint: string,
  ): Promise<RateLimitResult> {
    const limits = getLimitsForEndpoint(endpoint);
    const now = Date.now();

    // Check both windows
    const minuteResult = this.checkWindow(
      agentName,
      endpoint,
      "minute",
      limits.perMinute,
      now,
    );
    const hourResult = this.checkWindow(
      agentName,
      endpoint,
      "hour",
      limits.perHour,
      now,
    );

    // Return the most restrictive result (both windows must allow)
    if (!minuteResult.allowed) {
      return minuteResult;
    }
    if (!hourResult.allowed) {
      return hourResult;
    }

    // Both allowed - return the one with fewer remaining
    return minuteResult.remaining <= hourResult.remaining
      ? minuteResult
      : hourResult;
  }

  /**
   * Check a single window's rate limit
   */
  private checkWindow(
    agentName: string,
    endpoint: string,
    window: "minute" | "hour",
    limit: number,
    now: number,
  ): RateLimitResult {
    const windowDuration = window === "minute" ? 60_000 : 3_600_000;
    const windowStart = now - windowDuration;

    // Count requests in window
    const result = this.db
      .query<{ count: number }>(
        `SELECT COUNT(*) as count FROM rate_limits 
         WHERE agent_name = ? AND endpoint = ? AND window = ? AND timestamp > ?`,
      )
      .get(agentName, endpoint, window, windowStart);

    // Validate result before accessing properties
    if (!result || typeof result.count !== "number") {
      // Query failed or returned invalid data, assume no usage
      return {
        allowed: true,
        remaining: limit,
        resetAt: now + windowDuration,
      };
    }

    const count = result.count;
    const remaining = Math.max(0, limit - count);
    const allowed = count < limit;

    // Calculate reset time based on oldest entry in window
    let resetAt = now + windowDuration;
    if (!allowed) {
      const oldest = this.db
        .query<{ timestamp: number }>(
          `SELECT MIN(timestamp) as timestamp FROM rate_limits 
           WHERE agent_name = ? AND endpoint = ? AND window = ? AND timestamp > ?`,
        )
        .get(agentName, endpoint, window, windowStart);

      // Validate oldest result before accessing properties
      if (oldest && typeof oldest.timestamp === "number") {
        resetAt = oldest.timestamp + windowDuration;
      }
    }

    return { allowed, remaining, resetAt };
  }

  /**
   * Clean up old rate limit entries in bounded batches
   *
   * Limits cleanup to prevent blocking recordRequest on large datasets:
   * - BATCH_SIZE: 1000 rows per iteration
   * - MAX_BATCHES: 10 (max 10k rows per cleanup invocation)
   *
   * Stops early if fewer than BATCH_SIZE rows deleted (no more to clean).
   *
   * @returns Cleanup statistics including total deleted rows
   */
  private cleanup(): { totalDeleted: number; batches: number } {
    const BATCH_SIZE = 1000;
    const MAX_BATCHES = 10;
    const cutoff = Date.now() - 7_200_000; // 2 hours

    let totalDeleted = 0;
    let batches = 0;

    // Run bounded batches
    for (let i = 0; i < MAX_BATCHES; i++) {
      const result = this.db.run(
        `DELETE FROM rate_limits
         WHERE rowid IN (
           SELECT rowid FROM rate_limits
           WHERE timestamp < ?
           LIMIT ?
         )`,
        [cutoff, BATCH_SIZE],
      );

      totalDeleted += result.changes;
      batches++;

      // Stop if we deleted less than batch size (no more to delete)
      if (result.changes < BATCH_SIZE) break;
    }

    return { totalDeleted, batches };
  }

  async recordRequest(agentName: string, endpoint: string): Promise<void> {
    const now = Date.now();

    // Record in both windows
    const stmt = this.db.prepare(
      `INSERT INTO rate_limits (agent_name, endpoint, window, timestamp) VALUES (?, ?, ?, ?)`,
    );

    stmt.run(agentName, endpoint, "minute", now);
    stmt.run(agentName, endpoint, "hour", now);

    // Opportunistic cleanup of old entries (1% chance to avoid overhead)
    // Now bounded to prevent blocking on large datasets
    if (Math.random() < 0.01) {
      this.cleanup();
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// ============================================================================
// In-Memory Rate Limiter (for testing)
// ============================================================================

/**
 * In-memory rate limiter for testing
 *
 * Uses Map storage with timestamp arrays per key.
 * No persistence - resets on process restart.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private storage: Map<string, number[]> = new Map();

  private buildKey(
    agentName: string,
    endpoint: string,
    window: "minute" | "hour",
  ): string {
    return `${agentName}:${endpoint}:${window}`;
  }

  async checkLimit(
    agentName: string,
    endpoint: string,
  ): Promise<RateLimitResult> {
    const limits = getLimitsForEndpoint(endpoint);
    const now = Date.now();

    const minuteResult = this.checkWindow(
      agentName,
      endpoint,
      "minute",
      limits.perMinute,
      now,
    );
    const hourResult = this.checkWindow(
      agentName,
      endpoint,
      "hour",
      limits.perHour,
      now,
    );

    // Return the most restrictive result (both windows must allow)
    if (!minuteResult.allowed) return minuteResult;
    if (!hourResult.allowed) return hourResult;

    return minuteResult.remaining <= hourResult.remaining
      ? minuteResult
      : hourResult;
  }

  private checkWindow(
    agentName: string,
    endpoint: string,
    window: "minute" | "hour",
    limit: number,
    now: number,
  ): RateLimitResult {
    const key = this.buildKey(agentName, endpoint, window);
    const windowDuration = window === "minute" ? 60_000 : 3_600_000;
    const windowStart = now - windowDuration;

    // Get and filter timestamps
    let timestamps = this.storage.get(key) || [];
    timestamps = timestamps.filter((t) => t > windowStart);
    this.storage.set(key, timestamps);

    const count = timestamps.length;
    const remaining = Math.max(0, limit - count);
    const allowed = count < limit;

    let resetAt = now + windowDuration;
    if (!allowed && timestamps.length > 0) {
      resetAt = timestamps[0] + windowDuration;
    }

    return { allowed, remaining, resetAt };
  }

  async recordRequest(agentName: string, endpoint: string): Promise<void> {
    const now = Date.now();

    // Record in both windows
    for (const window of ["minute", "hour"] as const) {
      const key = this.buildKey(agentName, endpoint, window);
      const timestamps = this.storage.get(key) || [];
      timestamps.push(now);
      this.storage.set(key, timestamps);
    }
  }

  async close(): Promise<void> {
    this.storage.clear();
  }

  /**
   * Reset all rate limits (for testing)
   */
  reset(): void {
    this.storage.clear();
  }
}

// ============================================================================
// Factory
// ============================================================================

/** Track if we've warned about fallback (warn only once) */
let hasWarnedAboutFallback = false;

/**
 * Create a rate limiter with automatic backend selection
 *
 * Tries Redis first, falls back to SQLite on connection failure.
 * Warns once when falling back to SQLite.
 *
 * @returns Configured rate limiter instance
 *
 * @example
 * ```typescript
 * // Auto-select backend
 * const limiter = await createRateLimiter();
 *
 * // Force SQLite
 * const limiter = await createRateLimiter({ backend: "sqlite" });
 *
 * // Force in-memory (testing)
 * const limiter = await createRateLimiter({ backend: "memory" });
 * ```
 */
export async function createRateLimiter(options?: {
  backend?: "redis" | "sqlite" | "memory";
  redisUrl?: string;
  sqlitePath?: string;
}): Promise<RateLimiter> {
  const {
    backend,
    redisUrl = process.env.OPENCODE_RATE_LIMIT_REDIS_URL ||
      "redis://localhost:6379",
    sqlitePath = process.env.OPENCODE_RATE_LIMIT_SQLITE_PATH ||
      join(homedir(), ".config", "opencode", "rate-limits.db"),
  } = options || {};

  // Explicit backend selection
  if (backend === "memory") {
    return new InMemoryRateLimiter();
  }

  if (backend === "sqlite") {
    if (!sqliteAvailable) {
      throw new Error(
        "SQLite backend requested but not available (requires Bun runtime)",
      );
    }
    return new SqliteRateLimiter(sqlitePath);
  }

  if (backend === "redis") {
    const redis = new Redis(redisUrl);
    return new RedisRateLimiter(redis);
  }

  // Auto-select: try Redis first with retry, fall back to SQLite
  const maxRetries = 3;
  const retryDelays = [100, 500, 1000]; // exponential backoff

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const redis = new Redis(redisUrl, {
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // Don't retry on failure
        lazyConnect: true,
      });

      // Test connection
      await redis.connect();
      await redis.ping();

      return new RedisRateLimiter(redis);
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;

      if (isLastAttempt) {
        // All retries exhausted, fall back to SQLite or in-memory
        if (!hasWarnedAboutFallback) {
          const fallbackType = sqliteAvailable ? "SQLite" : "in-memory";
          const fallbackLocation = sqliteAvailable ? ` at ${sqlitePath}` : "";
          console.warn(
            `[rate-limiter] Redis connection failed after ${maxRetries} attempts (${redisUrl}), falling back to ${fallbackType}${fallbackLocation}`,
          );
          hasWarnedAboutFallback = true;
        }

        // Use SQLite if available, otherwise fall back to in-memory
        if (sqliteAvailable) {
          return new SqliteRateLimiter(sqlitePath);
        }
        return new InMemoryRateLimiter();
      }

      // Wait before retrying (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
  }

  // Fallback (should never reach here due to return in last attempt)
  if (sqliteAvailable) {
    return new SqliteRateLimiter(sqlitePath);
  }
  return new InMemoryRateLimiter();
}

/**
 * Reset the fallback warning flag (for testing)
 */
export function resetFallbackWarning(): void {
  hasWarnedAboutFallback = false;
}

// ============================================================================
// Global Instance
// ============================================================================

let globalRateLimiter: RateLimiter | null = null;

/**
 * Get or create the global rate limiter instance
 *
 * Uses auto-selection (Redis → SQLite) by default.
 */
export async function getRateLimiter(): Promise<RateLimiter> {
  if (!globalRateLimiter) {
    globalRateLimiter = await createRateLimiter();
  }
  return globalRateLimiter;
}

/**
 * Set the global rate limiter instance
 *
 * Useful for testing or custom configurations.
 */
export function setRateLimiter(limiter: RateLimiter): void {
  globalRateLimiter = limiter;
}

/**
 * Reset the global rate limiter instance
 */
export async function resetRateLimiter(): Promise<void> {
  if (globalRateLimiter) {
    await globalRateLimiter.close();
    globalRateLimiter = null;
  }
}
