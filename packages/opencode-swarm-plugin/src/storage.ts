/**
 * Storage Module - Pluggable persistence for learning data
 *
 * Provides a unified storage interface with multiple backends:
 * - semantic-memory (default) - Persistent with semantic search
 * - in-memory - For testing and ephemeral sessions
 *
 * The semantic-memory backend uses collections:
 * - `swarm-feedback` - Criterion feedback events
 * - `swarm-patterns` - Decomposition patterns and anti-patterns
 * - `swarm-maturity` - Pattern maturity tracking
 *
 * @example
 * ```typescript
 * // Use default semantic-memory storage
 * const storage = createStorage();
 *
 * // Or configure explicitly
 * const storage = createStorage({
 *   backend: "semantic-memory",
 *   collections: {
 *     feedback: "my-feedback",
 *     patterns: "my-patterns",
 *     maturity: "my-maturity",
 *   },
 * });
 *
 * // Or use in-memory for testing
 * const storage = createStorage({ backend: "memory" });
 * ```
 */

import type { FeedbackEvent } from "./learning";
import type { DecompositionPattern } from "./anti-patterns";
import type { PatternMaturity, MaturityFeedback } from "./pattern-maturity";
import { InMemoryFeedbackStorage } from "./learning";
import { InMemoryPatternStorage } from "./anti-patterns";
import { InMemoryMaturityStorage } from "./pattern-maturity";

// ============================================================================
// Command Resolution
// ============================================================================

/**
 * Cached semantic-memory command (native or bunx fallback)
 */
let cachedCommand: string[] | null = null;

/**
 * Resolve the semantic-memory command
 *
 * Checks for native install first, falls back to bunx.
 * Result is cached for the session.
 */
async function resolveSemanticMemoryCommand(): Promise<string[]> {
  if (cachedCommand) return cachedCommand;

  // Try native install first
  const nativeResult = await Bun.$`which semantic-memory`.quiet().nothrow();
  if (nativeResult.exitCode === 0) {
    cachedCommand = ["semantic-memory"];
    return cachedCommand;
  }

  // Fall back to bunx
  cachedCommand = ["bunx", "semantic-memory"];
  return cachedCommand;
}

/**
 * Execute semantic-memory command with args
 */
async function execSemanticMemory(
  args: string[],
): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
  try {
    const cmd = await resolveSemanticMemoryCommand();
    const fullCmd = [...cmd, ...args];

    // Use Bun.spawn for dynamic command arrays
    const proc = Bun.spawn(fullCmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const TIMEOUT_MS = 30_000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Process timed out after 30s")), TIMEOUT_MS)
      );

      const stdout = Buffer.from(await new Response(proc.stdout).arrayBuffer());
      const stderr = Buffer.from(await new Response(proc.stderr).arrayBuffer());
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);

      return { exitCode, stdout, stderr };
    } finally {
      // Ensure process cleanup
      proc.kill();
    }
  } catch (error) {
    // Return structured error result on exceptions
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from(`Error executing semantic-memory: ${errorMessage}`),
    };
  }
}

/**
 * Reset the cached command (for testing)
 */
export function resetCommandCache(): void {
  cachedCommand = null;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Storage backend type
 */
export type StorageBackend = "semantic-memory" | "memory";

/**
 * Collection names for semantic-memory
 */
export interface StorageCollections {
  feedback: string;
  patterns: string;
  maturity: string;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Backend to use (default: "semantic-memory") */
  backend: StorageBackend;
  /** Collection names for semantic-memory backend */
  collections: StorageCollections;
  /** Whether to use semantic search for queries (default: true) */
  useSemanticSearch: boolean;
}

/**
 * Generate unique test collection name
 *
 * Creates a timestamp-based suffix for test collections to ensure complete isolation.
 * Each test run gets its own collections that don't pollute production semantic-memory.
 *
 * @returns Unique suffix like "test-1734567890123"
 *
 * @example
 * ```typescript
 * // In test setup:
 * process.env.TEST_SEMANTIC_MEMORY_COLLECTION = getTestCollectionName();
 * // Results in collections like: swarm-feedback-test-1734567890123
 * ```
 */
export function getTestCollectionName(): string {
  return `test-${Date.now()}`;
}

/**
 * Get collection names with optional test suffix
 *
 * Supports two test isolation modes:
 * 1. TEST_MEMORY_COLLECTIONS=true - appends "-test" (shared across test run)
 * 2. TEST_SEMANTIC_MEMORY_COLLECTION=<suffix> - appends custom suffix (unique per test run)
 *
 * Mode 2 is preferred for full isolation - prevents test pollution of production
 * semantic-memory collections.
 *
 * @example
 * ```typescript
 * // Production
 * getCollectionNames()
 * // => { feedback: "swarm-feedback", patterns: "swarm-patterns", maturity: "swarm-maturity" }
 *
 * // Test mode 1 (legacy)
 * process.env.TEST_MEMORY_COLLECTIONS = "true"
 * getCollectionNames()
 * // => { feedback: "swarm-feedback-test", patterns: "swarm-patterns-test", ... }
 *
 * // Test mode 2 (preferred - full isolation)
 * process.env.TEST_SEMANTIC_MEMORY_COLLECTION = "test-1734567890123"
 * getCollectionNames()
 * // => { feedback: "swarm-feedback-test-1734567890123", patterns: "swarm-patterns-test-1734567890123", ... }
 * ```
 */
function getCollectionNames(): StorageCollections {
  const base = {
    feedback: "swarm-feedback",
    patterns: "swarm-patterns",
    maturity: "swarm-maturity",
  };

  // Test isolation mode 2 (preferred): unique suffix per test run
  const testSuffix = process.env.TEST_SEMANTIC_MEMORY_COLLECTION;
  if (testSuffix) {
    return {
      feedback: `${base.feedback}-${testSuffix}`,
      patterns: `${base.patterns}-${testSuffix}`,
      maturity: `${base.maturity}-${testSuffix}`,
    };
  }

  // Test isolation mode 1 (legacy): shared "-test" suffix
  if (process.env.TEST_MEMORY_COLLECTIONS === "true") {
    return {
      feedback: `${base.feedback}-test`,
      patterns: `${base.patterns}-test`,
      maturity: `${base.maturity}-test`,
    };
  }

  return base;
}

/**
 * Get default storage configuration
 *
 * Returns a fresh config object on each call to ensure env vars (like
 * TEST_SEMANTIC_MEMORY_COLLECTION) are read at runtime, not module load time.
 *
 * @returns Default storage configuration
 */
export function getDefaultStorageConfig(): StorageConfig {
  return {
    backend: "semantic-memory",
    collections: getCollectionNames(),
    useSemanticSearch: true,
  };
}

/**
 * @deprecated Use getDefaultStorageConfig() instead. This static export
 * captures collections at module load time, breaking test isolation.
 */
export const DEFAULT_STORAGE_CONFIG: StorageConfig = getDefaultStorageConfig();

// ============================================================================
// Unified Storage Interface
// ============================================================================

/**
 * Unified storage interface for all learning data
 */
export interface LearningStorage {
  // Feedback operations
  storeFeedback(event: FeedbackEvent): Promise<void>;
  getFeedbackByCriterion(criterion: string): Promise<FeedbackEvent[]>;
  getFeedbackByBead(beadId: string): Promise<FeedbackEvent[]>;
  getAllFeedback(): Promise<FeedbackEvent[]>;
  findSimilarFeedback(query: string, limit?: number): Promise<FeedbackEvent[]>;

  // Pattern operations
  storePattern(pattern: DecompositionPattern): Promise<void>;
  getPattern(id: string): Promise<DecompositionPattern | null>;
  getAllPatterns(): Promise<DecompositionPattern[]>;
  getAntiPatterns(): Promise<DecompositionPattern[]>;
  getPatternsByTag(tag: string): Promise<DecompositionPattern[]>;
  findSimilarPatterns(
    query: string,
    limit?: number,
  ): Promise<DecompositionPattern[]>;

  // Maturity operations
  storeMaturity(maturity: PatternMaturity): Promise<void>;
  getMaturity(patternId: string): Promise<PatternMaturity | null>;
  getAllMaturity(): Promise<PatternMaturity[]>;
  getMaturityByState(state: string): Promise<PatternMaturity[]>;
  storeMaturityFeedback(feedback: MaturityFeedback): Promise<void>;
  getMaturityFeedback(patternId: string): Promise<MaturityFeedback[]>;

  // Lifecycle
  close(): Promise<void>;
}

// ============================================================================
// Session Stats Tracking
// ============================================================================

interface SessionStats {
  storesCount: number;
  queriesCount: number;
  sessionStart: number;
  lastAlertCheck: number;
}

let sessionStats: SessionStats = {
  storesCount: 0,
  queriesCount: 0,
  sessionStart: Date.now(),
  lastAlertCheck: Date.now(),
};

/**
 * Reset session stats (for testing)
 */
export function resetSessionStats(): void {
  sessionStats = {
    storesCount: 0,
    queriesCount: 0,
    sessionStart: Date.now(),
    lastAlertCheck: Date.now(),
  };
}

/**
 * Get current session stats
 */
export function getSessionStats(): Readonly<SessionStats> {
  return { ...sessionStats };
}

// ============================================================================
// Semantic Memory Storage Implementation
// ============================================================================

/**
 * Semantic-memory backed storage
 *
 * Uses the semantic-memory CLI for persistence with semantic search.
 * Data survives across sessions and can be searched by meaning.
 */
export class SemanticMemoryStorage implements LearningStorage {
  private config: StorageConfig;

  constructor(config: Partial<StorageConfig> = {}) {
    // Use getDefaultStorageConfig() to ensure env vars are read at runtime
    this.config = { ...getDefaultStorageConfig(), ...config };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Check if low usage alert should be sent
   *
   * Sends alert via agentmail if:
   * - More than 10 minutes have elapsed since session start
   * - Less than 1 store operation has occurred
   * - Alert hasn't been sent in the last 10 minutes
   */
  private async checkLowUsageAlert(): Promise<void> {
    const TEN_MINUTES = 10 * 60 * 1000;
    const now = Date.now();
    const sessionDuration = now - sessionStats.sessionStart;
    const timeSinceLastAlert = now - sessionStats.lastAlertCheck;

    if (
      sessionDuration >= TEN_MINUTES &&
      sessionStats.storesCount < 1 &&
      timeSinceLastAlert >= TEN_MINUTES
    ) {
      console.warn(
        `[storage] LOW USAGE ALERT: ${sessionStats.storesCount} stores after ${Math.floor(sessionDuration / 60000)} minutes`,
      );
      sessionStats.lastAlertCheck = now;

      // Send alert via Agent Mail if available
      // Note: This requires agentmail to be initialized, which may not always be the case
      // We'll log the alert and let the coordinator detect it in logs
    }
  }

  private async store(
    collection: string,
    data: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const content = typeof data === "string" ? data : JSON.stringify(data);
    const args = ["store", content, "--collection", collection];

    if (metadata) {
      args.push("--metadata", JSON.stringify(metadata));
    }

    sessionStats.storesCount++;

    const result = await execSemanticMemory(args);

    if (result.exitCode !== 0) {
      console.warn(
        `[storage] semantic-memory store() failed with exit code ${result.exitCode}: ${result.stderr.toString().trim()}`,
      );
    }

    // Alert check: if 10+ minutes elapsed with < 1 store, send alert
    await this.checkLowUsageAlert();
  }

  private async find<T>(
    collection: string,
    query: string,
    limit: number = 10,
    useFts: boolean = false,
  ): Promise<T[]> {
    const args = [
      "find",
      query,
      "--collection",
      collection,
      "--limit",
      String(limit),
      "--json",
    ];

    if (useFts) {
      args.push("--fts");
    }

    sessionStats.queriesCount++;

    const result = await execSemanticMemory(args);

    if (result.exitCode !== 0) {
      console.warn(
        `[storage] semantic-memory find() failed with exit code ${result.exitCode}: ${result.stderr.toString().trim()}`,
      );
      return [];
    }

    try {
      const output = result.stdout.toString().trim();
      if (!output) return [];

      const parsed = JSON.parse(output);
      // semantic-memory returns { results: [...] } or just [...]
      const results = Array.isArray(parsed) ? parsed : parsed.results || [];

      // Extract the stored content from each result
      return results.map((r: { content?: string; information?: string }) => {
        const content = r.content || r.information || "";
        try {
          return JSON.parse(content);
        } catch {
          return content;
        }
      });
    } catch (error) {
      console.warn(
        `[storage] Failed to parse semantic-memory find() output: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async list<T>(collection: string): Promise<T[]> {
    sessionStats.queriesCount++;

    const result = await execSemanticMemory([
      "list",
      "--collection",
      collection,
      "--json",
    ]);

    if (result.exitCode !== 0) {
      console.warn(
        `[storage] semantic-memory list() failed with exit code ${result.exitCode}: ${result.stderr.toString().trim()}`,
      );
      return [];
    }

    try {
      const output = result.stdout.toString().trim();
      if (!output) return [];

      const parsed = JSON.parse(output);
      const items = Array.isArray(parsed) ? parsed : parsed.items || [];

      return items.map((item: { content?: string; information?: string }) => {
        const content = item.content || item.information || "";
        try {
          return JSON.parse(content);
        } catch {
          return content;
        }
      });
    } catch (error) {
      console.warn(
        `[storage] Failed to parse semantic-memory list() output: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Feedback Operations
  // -------------------------------------------------------------------------

  async storeFeedback(event: FeedbackEvent): Promise<void> {
    await this.store(this.config.collections.feedback, event, {
      criterion: event.criterion,
      type: event.type,
      bead_id: event.bead_id || "",
      timestamp: event.timestamp,
    });
  }

  async getFeedbackByCriterion(criterion: string): Promise<FeedbackEvent[]> {
    // Use FTS for exact criterion match
    return this.find<FeedbackEvent>(
      this.config.collections.feedback,
      criterion,
      100,
      true, // FTS for exact match
    );
  }

  async getFeedbackByBead(beadId: string): Promise<FeedbackEvent[]> {
    return this.find<FeedbackEvent>(
      this.config.collections.feedback,
      beadId,
      100,
      true,
    );
  }

  async getAllFeedback(): Promise<FeedbackEvent[]> {
    return this.list<FeedbackEvent>(this.config.collections.feedback);
  }

  async findSimilarFeedback(
    query: string,
    limit: number = 10,
  ): Promise<FeedbackEvent[]> {
    return this.find<FeedbackEvent>(
      this.config.collections.feedback,
      query,
      limit,
      !this.config.useSemanticSearch,
    );
  }

  // -------------------------------------------------------------------------
  // Pattern Operations
  // -------------------------------------------------------------------------

  async storePattern(pattern: DecompositionPattern): Promise<void> {
    await this.store(this.config.collections.patterns, pattern, {
      id: pattern.id,
      kind: pattern.kind,
      is_negative: pattern.is_negative,
      tags: pattern.tags.join(","),
    });
  }

  async getPattern(id: string): Promise<DecompositionPattern | null> {
    // List all and filter by ID - FTS search by ID is unreliable
    const all = await this.list<DecompositionPattern>(
      this.config.collections.patterns,
    );
    return all.find((p) => p.id === id) || null;
  }

  async getAllPatterns(): Promise<DecompositionPattern[]> {
    return this.list<DecompositionPattern>(this.config.collections.patterns);
  }

  async getAntiPatterns(): Promise<DecompositionPattern[]> {
    const all = await this.getAllPatterns();
    return all.filter((p) => p.kind === "anti_pattern");
  }

  async getPatternsByTag(tag: string): Promise<DecompositionPattern[]> {
    const results = await this.find<DecompositionPattern>(
      this.config.collections.patterns,
      tag,
      100,
      true,
    );
    return results.filter((p) => p.tags.includes(tag));
  }

  async findSimilarPatterns(
    query: string,
    limit: number = 10,
  ): Promise<DecompositionPattern[]> {
    return this.find<DecompositionPattern>(
      this.config.collections.patterns,
      query,
      limit,
      !this.config.useSemanticSearch,
    );
  }

  // -------------------------------------------------------------------------
  // Maturity Operations
  // -------------------------------------------------------------------------

  async storeMaturity(maturity: PatternMaturity): Promise<void> {
    await this.store(this.config.collections.maturity, maturity, {
      pattern_id: maturity.pattern_id,
      state: maturity.state,
    });
  }

  async getMaturity(patternId: string): Promise<PatternMaturity | null> {
    // List all and filter by pattern_id - FTS search by ID is unreliable
    const all = await this.list<PatternMaturity>(
      this.config.collections.maturity,
    );
    return all.find((m) => m.pattern_id === patternId) || null;
  }

  async getAllMaturity(): Promise<PatternMaturity[]> {
    return this.list<PatternMaturity>(this.config.collections.maturity);
  }

  async getMaturityByState(state: string): Promise<PatternMaturity[]> {
    const all = await this.getAllMaturity();
    return all.filter((m) => m.state === state);
  }

  async storeMaturityFeedback(feedback: MaturityFeedback): Promise<void> {
    await this.store(this.config.collections.maturity + "-feedback", feedback, {
      pattern_id: feedback.pattern_id,
      type: feedback.type,
      timestamp: feedback.timestamp,
    });
  }

  async getMaturityFeedback(patternId: string): Promise<MaturityFeedback[]> {
    // List all and filter by pattern_id - FTS search by ID is unreliable
    const all = await this.list<MaturityFeedback>(
      this.config.collections.maturity + "-feedback",
    );
    return all.filter((f) => f.pattern_id === patternId);
  }

  async close(): Promise<void> {
    // No cleanup needed for CLI-based storage
  }
}

// ============================================================================
// In-Memory Storage Implementation
// ============================================================================

/**
 * In-memory storage adapter
 *
 * Wraps the existing in-memory implementations into the unified interface.
 * Useful for testing and ephemeral sessions.
 */
export class InMemoryStorage implements LearningStorage {
  private feedback: InMemoryFeedbackStorage;
  private patterns: InMemoryPatternStorage;
  private maturity: InMemoryMaturityStorage;

  constructor() {
    this.feedback = new InMemoryFeedbackStorage();
    this.patterns = new InMemoryPatternStorage();
    this.maturity = new InMemoryMaturityStorage();
  }

  // Feedback
  async storeFeedback(event: FeedbackEvent): Promise<void> {
    return this.feedback.store(event);
  }

  async getFeedbackByCriterion(criterion: string): Promise<FeedbackEvent[]> {
    return this.feedback.getByCriterion(criterion);
  }

  async getFeedbackByBead(beadId: string): Promise<FeedbackEvent[]> {
    return this.feedback.getByBead(beadId);
  }

  async getAllFeedback(): Promise<FeedbackEvent[]> {
    return this.feedback.getAll();
  }

  async findSimilarFeedback(
    query: string,
    limit: number = 10,
  ): Promise<FeedbackEvent[]> {
    // In-memory doesn't support semantic search, filter by query string match
    const all = await this.feedback.getAll();
    const lowerQuery = query.toLowerCase();
    const filtered = all.filter(
      (event) =>
        event.criterion.toLowerCase().includes(lowerQuery) ||
        (event.bead_id && event.bead_id.toLowerCase().includes(lowerQuery)) ||
        (event.context && event.context.toLowerCase().includes(lowerQuery)),
    );
    return filtered.slice(0, limit);
  }

  // Patterns
  async storePattern(pattern: DecompositionPattern): Promise<void> {
    return this.patterns.store(pattern);
  }

  async getPattern(id: string): Promise<DecompositionPattern | null> {
    return this.patterns.get(id);
  }

  async getAllPatterns(): Promise<DecompositionPattern[]> {
    return this.patterns.getAll();
  }

  async getAntiPatterns(): Promise<DecompositionPattern[]> {
    return this.patterns.getAntiPatterns();
  }

  async getPatternsByTag(tag: string): Promise<DecompositionPattern[]> {
    return this.patterns.getByTag(tag);
  }

  async findSimilarPatterns(
    query: string,
    limit: number = 10,
  ): Promise<DecompositionPattern[]> {
    const results = await this.patterns.findByContent(query);
    return results.slice(0, limit);
  }

  // Maturity
  async storeMaturity(maturity: PatternMaturity): Promise<void> {
    return this.maturity.store(maturity);
  }

  async getMaturity(patternId: string): Promise<PatternMaturity | null> {
    return this.maturity.get(patternId);
  }

  async getAllMaturity(): Promise<PatternMaturity[]> {
    return this.maturity.getAll();
  }

  async getMaturityByState(state: string): Promise<PatternMaturity[]> {
    return this.maturity.getByState(state as any);
  }

  async storeMaturityFeedback(feedback: MaturityFeedback): Promise<void> {
    return this.maturity.storeFeedback(feedback);
  }

  async getMaturityFeedback(patternId: string): Promise<MaturityFeedback[]> {
    return this.maturity.getFeedback(patternId);
  }

  async close(): Promise<void> {
    // No cleanup needed
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a storage instance
 *
 * @param config - Storage configuration (default: semantic-memory)
 * @returns Configured storage instance
 *
 * @example
 * ```typescript
 * // Default semantic-memory storage
 * const storage = createStorage();
 *
 * // In-memory for testing
 * const storage = createStorage({ backend: "memory" });
 *
 * // Custom collections
 * const storage = createStorage({
 *   backend: "semantic-memory",
 *   collections: {
 *     feedback: "my-project-feedback",
 *     patterns: "my-project-patterns",
 *     maturity: "my-project-maturity",
 *   },
 * });
 * ```
 */
export function createStorage(
  config: Partial<StorageConfig> = {},
): LearningStorage {
  // Use getDefaultStorageConfig() to ensure env vars are read at runtime
  const fullConfig = { ...getDefaultStorageConfig(), ...config };

  switch (fullConfig.backend) {
    case "semantic-memory":
      return new SemanticMemoryStorage(fullConfig);
    case "memory":
      return new InMemoryStorage();
    default:
      throw new Error(`Unknown storage backend: ${fullConfig.backend}`);
  }
}

/**
 * Cached result of semantic-memory availability check.
 * The CLI binary doesn't appear/disappear during a process lifetime,
 * so we cache the result after the first check.
 */
let _availabilityCache: boolean | null = null;
let _availabilityPromise: Promise<boolean> | null = null;

/**
 * Check if semantic-memory is available (native or via bunx)
 *
 * Result is cached for the lifetime of the process since CLI availability
 * doesn't change at runtime. Use resetAvailabilityCache() in tests.
 */
export async function isSemanticMemoryAvailable(): Promise<boolean> {
  if (_availabilityCache !== null) return _availabilityCache;
  if (_availabilityPromise) return _availabilityPromise;

  _availabilityPromise = (async () => {
    try {
      const result = await execSemanticMemory(["stats"]);
      _availabilityCache = result.exitCode === 0;
    } catch {
      _availabilityCache = false;
    }
    _availabilityPromise = null;
    return _availabilityCache;
  })();
  return _availabilityPromise;
}

/**
 * Reset the availability cache (for testing)
 */
export function resetAvailabilityCache(): void {
  _availabilityCache = null;
  _availabilityPromise = null;
}

/**
 * Get the resolved semantic-memory command (for debugging/logging)
 */
export async function getResolvedCommand(): Promise<string[]> {
  return resolveSemanticMemoryCommand();
}

/**
 * Create storage with automatic fallback
 *
 * Uses semantic-memory if available, otherwise falls back to in-memory.
 *
 * @param config - Storage configuration
 * @returns Storage instance
 */
export async function createStorageWithFallback(
  config: Partial<StorageConfig> = {},
): Promise<LearningStorage> {
  if (config.backend === "memory") {
    return new InMemoryStorage();
  }

  const available = await isSemanticMemoryAvailable();
  if (available) {
    return new SemanticMemoryStorage(config);
  }

  console.warn(
    "semantic-memory not available, falling back to in-memory storage",
  );
  return new InMemoryStorage();
}

// ============================================================================
// Global Storage Instance
// ============================================================================

let globalStorage: LearningStorage | null = null;
let globalStoragePromise: Promise<LearningStorage> | null = null;

/**
 * Get or create the global storage instance
 *
 * Uses semantic-memory by default, with automatic fallback to in-memory.
 * Prevents race conditions by storing the initialization promise.
 */
export async function getStorage(): Promise<LearningStorage> {
  if (!globalStoragePromise) {
    globalStoragePromise = createStorageWithFallback().then((storage) => {
      globalStorage = storage;
      return storage;
    });
  }
  return globalStoragePromise;
}

/**
 * Set the global storage instance
 *
 * Useful for testing or custom configurations.
 */
export function setStorage(storage: LearningStorage): void {
  globalStorage = storage;
  globalStoragePromise = Promise.resolve(storage);
}

/**
 * Reset the global storage instance
 */
export async function resetStorage(): Promise<void> {
  if (globalStorage) {
    await globalStorage.close();
    globalStorage = null;
  }
  globalStoragePromise = null;
}
