/**
 * Learning Module - Confidence decay, feedback scoring, and outcome tracking
 *
 * Implements patterns from cass-memory for learning from swarm outcomes:
 * - Confidence decay: evaluation criteria weights fade unless revalidated
 * - Feedback events: track helpful/harmful signals from task outcomes
 * - Outcome scoring: implicit feedback from duration, errors, retries
 *
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/scoring.ts
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/outcome.ts
 */
import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

/**
 * Feedback event types
 */
export const FeedbackTypeSchema = z.enum(["helpful", "harmful", "neutral"]);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

/**
 * A feedback event records whether a criterion evaluation was accurate
 *
 * When an evaluation criterion (e.g., "type_safe") is later proven correct
 * or incorrect, we record that as feedback to adjust future weights.
 */
export const FeedbackEventSchema = z.object({
  /** Unique ID for this feedback event */
  id: z.string(),
  /** The criterion this feedback applies to */
  criterion: z.string(),
  /** Whether this feedback indicates the criterion was helpful or harmful */
  type: FeedbackTypeSchema,
  /** When this feedback was recorded */
  timestamp: z.string(), // ISO-8601
  /** Context about why this feedback was given */
  context: z.string().optional(),
  /** The bead ID this feedback relates to */
  bead_id: z.string().optional(),
  /** Raw value before decay (1.0 = full weight) */
  raw_value: z.number().min(0).max(1).default(1),
});
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;

/**
 * Criterion weight with decay tracking
 */
export const CriterionWeightSchema = z.object({
  /** The criterion name (e.g., "type_safe") */
  criterion: z.string(),
  /** Current weight after decay (0-1) */
  weight: z.number().min(0).max(1),
  /** Number of helpful feedback events */
  helpful_count: z.number().int().min(0),
  /** Number of harmful feedback events */
  harmful_count: z.number().int().min(0),
  /** Last time this criterion was validated */
  last_validated: z.string().optional(), // ISO-8601
  /** Decay half-life in days */
  half_life_days: z.number().positive().default(90),
});
export type CriterionWeight = z.infer<typeof CriterionWeightSchema>;

/**
 * Error types that can occur during subtask execution
 */
export const ErrorTypeSchema = z.enum([
  "validation",
  "timeout",
  "conflict",
  "tool_failure",
  "unknown",
]);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

/**
 * An error entry in the error accumulator
 *
 * Errors are accumulated during subtask execution and can be fed
 * into retry prompts to help agents learn from past failures.
 */
export const ErrorEntrySchema = z.object({
  /** Unique ID for this error entry */
  id: z.string(),
  /** The bead ID this error relates to */
  bead_id: z.string(),
  /** Type of error encountered */
  error_type: ErrorTypeSchema,
  /** Human-readable error message */
  message: z.string(),
  /** Optional stack trace for debugging */
  stack_trace: z.string().optional(),
  /** Tool that failed, if applicable */
  tool_name: z.string().optional(),
  /** When this error occurred */
  timestamp: z.string(), // ISO-8601
  /** Whether this error was resolved */
  resolved: z.boolean().default(false),
  /** Context about what was happening when error occurred */
  context: z.string().optional(),
});
export type ErrorEntry = z.infer<typeof ErrorEntrySchema>;

/**
 * Decomposition strategies for tracking which approach was used
 */
export const DecompositionStrategySchema = z.enum([
  "file-based",
  "feature-based",
  "risk-based",
  "research-based",
]);
export type DecompositionStrategy = z.infer<typeof DecompositionStrategySchema>;

/**
 * Failure mode taxonomy (imported from evaluation.ts)
 */
export const FailureModeSchema = z.enum([
  "timeout",
  "conflict",
  "validation",
  "tool_failure",
  "context_overflow",
  "dependency_blocked",
  "user_cancelled",
  "unknown",
]);
export type FailureMode = z.infer<typeof FailureModeSchema>;

/**
 * Outcome signals from a completed subtask
 *
 * These implicit signals help score decomposition quality without
 * explicit feedback from the user.
 */
export const OutcomeSignalsSchema = z.object({
  /** Subtask bead ID */
  bead_id: z.string(),
  /** Duration in milliseconds */
  duration_ms: z.number().int().min(0),
  /** Number of errors encountered */
  error_count: z.number().int().min(0),
  /** Number of retry attempts */
  retry_count: z.number().int().min(0),
  /** Whether the subtask ultimately succeeded */
  success: z.boolean(),
  /** Files that were modified */
  files_touched: z.array(z.string()).default([]),
  /** Timestamp when outcome was recorded */
  timestamp: z.string(), // ISO-8601
  /** Decomposition strategy used for this task */
  strategy: DecompositionStrategySchema.optional(),
  /** Failure classification (only when success=false) */
  failure_mode: FailureModeSchema.optional(),
  /** Detailed failure context */
  failure_details: z.string().optional(),
});
export type OutcomeSignals = z.infer<typeof OutcomeSignalsSchema>;

/**
 * Scored outcome with implicit feedback type
 */
export const ScoredOutcomeSchema = z.object({
  /** The outcome signals */
  signals: OutcomeSignalsSchema,
  /** Inferred feedback type */
  type: FeedbackTypeSchema,
  /** Decayed value (0-1) */
  decayed_value: z.number().min(0).max(1),
  /** Explanation of the scoring */
  reasoning: z.string(),
});
export type ScoredOutcome = z.infer<typeof ScoredOutcomeSchema>;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default configuration for learning
 */
export interface LearningConfig {
  /** Half-life for confidence decay in days */
  halfLifeDays: number;
  /** Minimum feedback events before adjusting weights */
  minFeedbackForAdjustment: number;
  /** Maximum harmful ratio before deprecating a criterion */
  maxHarmfulRatio: number;
  /** Threshold duration (ms) for "fast" completion */
  fastCompletionThresholdMs: number;
  /** Threshold duration (ms) for "slow" completion */
  slowCompletionThresholdMs: number;
  /** Maximum errors before considering harmful */
  maxErrorsForHelpful: number;
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  halfLifeDays: 90,
  minFeedbackForAdjustment: 3,
  maxHarmfulRatio: 0.3,
  fastCompletionThresholdMs: 5 * 60 * 1000, // 5 minutes
  slowCompletionThresholdMs: 30 * 60 * 1000, // 30 minutes
  maxErrorsForHelpful: 2,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate decayed value using half-life formula
 *
 * Value decays by 50% every `halfLifeDays` days.
 * Formula: value * 0.5^(age/halfLife)
 *
 * @param timestamp - When the event occurred (ISO-8601)
 * @param now - Current time
 * @param halfLifeDays - Half-life in days (default: 90)
 * @returns Decayed value between 0 and 1
 *
 * @example
 * // Event from 90 days ago with 90-day half-life
 * calculateDecayedValue("2024-09-08T00:00:00Z", new Date("2024-12-07"), 90)
 * // Returns ~0.5
 */
export function calculateDecayedValue(
  timestamp: string,
  now: Date = new Date(),
  halfLifeDays: number = 90,
): number {
  // Prevent division by zero
  const safeHalfLife = halfLifeDays <= 0 ? 1 : halfLifeDays;

  const eventTime = new Date(timestamp).getTime();
  const nowTime = now.getTime();
  const ageDays = Math.max(0, (nowTime - eventTime) / (24 * 60 * 60 * 1000));

  return Math.pow(0.5, ageDays / safeHalfLife);
}

/**
 * Calculate weighted criterion score from feedback events
 *
 * Applies decay to each feedback event and aggregates them.
 * Helpful events increase the score, harmful events decrease it.
 *
 * @param events - Feedback events for this criterion
 * @param config - Learning configuration
 * @returns Weight between 0 and 1
 */
export function calculateCriterionWeight(
  events: FeedbackEvent[],
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): CriterionWeight {
  // Return early with default weight if events array is empty
  if (events.length === 0) {
    return {
      criterion: "unknown",
      weight: 1.0,
      helpful_count: 0,
      harmful_count: 0,
      last_validated: undefined,
      half_life_days: config.halfLifeDays,
    };
  }

  const now = new Date();
  let helpfulSum = 0;
  let harmfulSum = 0;
  let helpfulCount = 0;
  let harmfulCount = 0;
  let lastValidated: string | undefined;

  for (const event of events) {
    const decayed = calculateDecayedValue(
      event.timestamp,
      now,
      config.halfLifeDays,
    );
    const value = event.raw_value * decayed;

    if (event.type === "helpful") {
      helpfulSum += value;
      helpfulCount++;
      if (!lastValidated || event.timestamp > lastValidated) {
        lastValidated = event.timestamp;
      }
    } else if (event.type === "harmful") {
      harmfulSum += value;
      harmfulCount++;
    }
  }

  // Calculate weight: helpful / (helpful + harmful), with minimum of 0.1
  const total = helpfulSum + harmfulSum;
  const weight = total > 0 ? Math.max(0.1, helpfulSum / total) : 1.0;

  return {
    criterion: events[0].criterion,
    weight,
    helpful_count: helpfulCount,
    harmful_count: harmfulCount,
    last_validated: lastValidated,
    half_life_days: config.halfLifeDays,
  };
}

/**
 * Score implicit feedback from task outcome signals
 *
 * Infers whether a decomposition/subtask was helpful or harmful based on:
 * - Duration: fast completion = helpful, slow = harmful
 * - Errors: few errors = helpful, many = harmful
 * - Retries: no retries = helpful, many = harmful
 * - Success: success = helpful, failure = harmful
 *
 * @param signals - Outcome signals from completed subtask
 * @param config - Learning configuration
 * @returns Scored outcome with feedback type and reasoning
 */
export function scoreImplicitFeedback(
  signals: OutcomeSignals,
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): ScoredOutcome {
  const now = new Date();
  const decayed = calculateDecayedValue(
    signals.timestamp,
    now,
    config.halfLifeDays,
  );

  // Score components (each 0-1, higher = better)
  const durationScore =
    signals.duration_ms < config.fastCompletionThresholdMs
      ? 1.0
      : signals.duration_ms > config.slowCompletionThresholdMs
        ? 0.2
        : 0.6;

  const errorScore =
    signals.error_count === 0
      ? 1.0
      : signals.error_count <= config.maxErrorsForHelpful
        ? 0.6
        : 0.2;

  const retryScore =
    signals.retry_count === 0 ? 1.0 : signals.retry_count === 1 ? 0.7 : 0.3;

  const successScore = signals.success ? 1.0 : 0.0;

  // Weighted average (success matters most)
  const rawScore =
    successScore * 0.4 +
    durationScore * 0.2 +
    errorScore * 0.2 +
    retryScore * 0.2;

  // Determine feedback type
  let type: FeedbackType;
  let reasoning: string;

  if (rawScore >= 0.7) {
    type = "helpful";
    reasoning =
      `Fast completion (${Math.round(signals.duration_ms / 1000)}s), ` +
      `${signals.error_count} errors, ${signals.retry_count} retries, ` +
      `${signals.success ? "succeeded" : "failed"}`;
  } else if (rawScore <= 0.4) {
    type = "harmful";
    reasoning =
      `Slow completion (${Math.round(signals.duration_ms / 1000)}s), ` +
      `${signals.error_count} errors, ${signals.retry_count} retries, ` +
      `${signals.success ? "succeeded" : "failed"}`;
  } else {
    type = "neutral";
    reasoning =
      `Mixed signals: ${Math.round(signals.duration_ms / 1000)}s, ` +
      `${signals.error_count} errors, ${signals.retry_count} retries`;
  }

  return {
    signals,
    type,
    decayed_value: rawScore * decayed,
    reasoning,
  };
}

/**
 * Create a feedback event from a scored outcome
 *
 * Converts implicit outcome scoring into an explicit feedback event
 * that can be stored and used for criterion weight calculation.
 *
 * @param outcome - Scored outcome
 * @param criterion - Which criterion this feedback applies to
 * @returns Feedback event
 */
export function outcomeToFeedback(
  outcome: ScoredOutcome,
  criterion: string,
): FeedbackEvent {
  return {
    id: `${outcome.signals.bead_id}-${criterion}-${Date.now()}`,
    criterion,
    type: outcome.type,
    timestamp: outcome.signals.timestamp,
    context: outcome.reasoning,
    bead_id: outcome.signals.bead_id,
    raw_value: outcome.decayed_value,
  };
}

/**
 * Apply criterion weights to evaluation scores
 *
 * Adjusts raw evaluation scores by their learned weights.
 * Criteria with low confidence (due to past failures) have reduced impact.
 *
 * @param criteria - Map of criterion name to raw score (0-1)
 * @param weights - Map of criterion name to weight
 * @returns Weighted scores
 */
export function applyWeights(
  criteria: Record<string, number>,
  weights: Record<string, CriterionWeight>,
): Record<string, { raw: number; weighted: number; weight: number }> {
  const result: Record<
    string,
    { raw: number; weighted: number; weight: number }
  > = {};

  for (const [name, rawScore] of Object.entries(criteria)) {
    const weight = weights[name]?.weight ?? 1.0;
    result[name] = {
      raw: rawScore,
      weighted: rawScore * weight,
      weight,
    };
  }

  return result;
}

/**
 * Check if a criterion should be deprecated based on feedback
 *
 * A criterion is deprecated if it has enough feedback and the
 * harmful ratio exceeds the threshold.
 *
 * @param weight - Criterion weight with feedback counts
 * @param config - Learning configuration
 * @returns Whether the criterion should be deprecated
 */
export function shouldDeprecateCriterion(
  weight: CriterionWeight,
  config: LearningConfig = DEFAULT_LEARNING_CONFIG,
): boolean {
  const total = weight.helpful_count + weight.harmful_count;
  if (total < config.minFeedbackForAdjustment) {
    return false;
  }

  const harmfulRatio = weight.harmful_count / total;
  return harmfulRatio > config.maxHarmfulRatio;
}

// ============================================================================
// Storage Helpers
// ============================================================================

/**
 * Storage interface for feedback events
 *
 * Implementations can use file system, SQLite, or other backends.
 */
export interface FeedbackStorage {
  /** Store a feedback event */
  store(event: FeedbackEvent): Promise<void>;
  /** Get all feedback events for a criterion */
  getByCriterion(criterion: string): Promise<FeedbackEvent[]>;
  /** Get all feedback events for a bead */
  getByBead(beadId: string): Promise<FeedbackEvent[]>;
  /** Get all feedback events */
  getAll(): Promise<FeedbackEvent[]>;
}

/**
 * In-memory feedback storage (for testing and short-lived sessions)
 *
 * Uses LRU eviction to prevent unbounded memory growth.
 */
export class InMemoryFeedbackStorage implements FeedbackStorage {
  private events: FeedbackEvent[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  async store(event: FeedbackEvent): Promise<void> {
    this.events.push(event);

    // Evict oldest events if we exceed max size (LRU)
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(this.events.length - this.maxSize);
    }
  }

  async getByCriterion(criterion: string): Promise<FeedbackEvent[]> {
    return this.events.filter((e) => e.criterion === criterion);
  }

  async getByBead(beadId: string): Promise<FeedbackEvent[]> {
    return this.events.filter((e) => e.bead_id === beadId);
  }

  async getAll(): Promise<FeedbackEvent[]> {
    return [...this.events];
  }
}

// ============================================================================
// 3-Strike Detection
// ============================================================================

/**
 * Strike record for a bead
 *
 * Tracks consecutive fix failures to detect architectural problems.
 * After 3 strikes, the system should STOP and question the architecture
 * rather than attempting Fix #4.
 */
export const StrikeRecordSchema = z.object({
  /** The bead ID */
  bead_id: z.string(),
  /** Number of consecutive failures */
  strike_count: z.number().int().min(0).max(3),
  /** Failure descriptions for each strike */
  failures: z.array(
    z.object({
      /** What fix was attempted */
      attempt: z.string(),
      /** Why it failed */
      reason: z.string(),
      /** When it failed */
      timestamp: z.string(), // ISO-8601
    }),
  ),
  /** When strikes were recorded */
  first_strike_at: z.string().optional(), // ISO-8601
  last_strike_at: z.string().optional(), // ISO-8601
});
export type StrikeRecord = z.infer<typeof StrikeRecordSchema>;

/**
 * Storage interface for strike records
 */
export interface StrikeStorage {
  /** Store a strike record */
  store(record: StrikeRecord): Promise<void>;
  /** Get strike record for a bead */
  get(beadId: string): Promise<StrikeRecord | null>;
  /** Get all strike records */
  getAll(): Promise<StrikeRecord[]>;
  /** Clear strikes for a bead */
  clear(beadId: string): Promise<void>;
}

/**
 * In-memory strike storage
 */
export class InMemoryStrikeStorage implements StrikeStorage {
  private strikes: Map<string, StrikeRecord> = new Map();

  async store(record: StrikeRecord): Promise<void> {
    this.strikes.set(record.bead_id, record);
  }

  async get(beadId: string): Promise<StrikeRecord | null> {
    return this.strikes.get(beadId) ?? null;
  }

  async getAll(): Promise<StrikeRecord[]> {
    return Array.from(this.strikes.values());
  }

  async clear(beadId: string): Promise<void> {
    this.strikes.delete(beadId);
  }
}

/**
 * Add a strike to a bead's record
 *
 * Records a failure attempt and increments the strike count.
 *
 * @param beadId - Cell ID
 * @param attempt - Description of what was attempted
 * @param reason - Why it failed
 * @param storage - Strike storage (defaults to in-memory)
 * @returns Updated strike record
 */
export async function addStrike(
  beadId: string,
  attempt: string,
  reason: string,
  storage: StrikeStorage = new InMemoryStrikeStorage(),
): Promise<StrikeRecord> {
  const existing = await storage.get(beadId);
  const now = new Date().toISOString();

  const record: StrikeRecord = existing ?? {
    bead_id: beadId,
    strike_count: 0,
    failures: [],
  };

  record.strike_count = Math.min(3, record.strike_count + 1);
  record.failures.push({ attempt, reason, timestamp: now });
  record.last_strike_at = now;

  if (!record.first_strike_at) {
    record.first_strike_at = now;
  }

  await storage.store(record);
  return record;
}

/**
 * Get strike count for a bead
 *
 * @param beadId - Cell ID
 * @param storage - Strike storage
 * @returns Strike count (0-3)
 */
export async function getStrikes(
  beadId: string,
  storage: StrikeStorage = new InMemoryStrikeStorage(),
): Promise<number> {
  const record = await storage.get(beadId);
  return record?.strike_count ?? 0;
}

/**
 * Check if a bead has struck out (3 strikes)
 *
 * @param beadId - Cell ID
 * @param storage - Strike storage
 * @returns True if bead has 3 strikes
 */
export async function isStrikedOut(
  beadId: string,
  storage: StrikeStorage = new InMemoryStrikeStorage(),
): Promise<boolean> {
  const count = await getStrikes(beadId, storage);
  return count >= 3;
}

/**
 * Generate architecture review prompt for a struck-out bead
 *
 * When a bead hits 3 strikes, this generates a prompt that forces
 * the human to question the architecture instead of attempting Fix #4.
 *
 * @param beadId - Cell ID
 * @param storage - Strike storage
 * @returns Architecture review prompt
 */
export async function getArchitecturePrompt(
  beadId: string,
  storage: StrikeStorage = new InMemoryStrikeStorage(),
): Promise<string> {
  const record = await storage.get(beadId);

  if (!record || record.strike_count < 3) {
    return "";
  }

  const failuresList = record.failures
    .map((f, i) => `${i + 1}. **${f.attempt}** - Failed: ${f.reason}`)
    .join("\n");

  return `## Architecture Review Required

This bead (\`${beadId}\`) has failed 3 consecutive fix attempts:

${failuresList}

This pattern suggests an **architectural problem**, not a bug.

**Questions to consider:**
- Is the current approach fundamentally sound?
- Should we refactor the architecture instead?
- Are we fixing symptoms instead of root cause?

**Options:**
1. **Refactor architecture** (describe new approach)
2. **Continue with Fix #4** (explain why this time is different)
3. **Abandon this approach entirely**

**DO NOT attempt Fix #4 without answering these questions.**
`;
}

/**
 * Clear strikes for a bead (e.g., after successful fix)
 *
 * @param beadId - Cell ID
 * @param storage - Strike storage
 */
export async function clearStrikes(
  beadId: string,
  storage: StrikeStorage = new InMemoryStrikeStorage(),
): Promise<void> {
  await storage.clear(beadId);
}

// ============================================================================
// Error Accumulator
// ============================================================================

/**
 * Storage interface for error entries
 *
 * Similar to FeedbackStorage but for tracking errors during execution.
 */
export interface ErrorStorage {
  /** Store an error entry */
  store(entry: ErrorEntry): Promise<void>;
  /** Get all errors for a bead */
  getByBead(beadId: string): Promise<ErrorEntry[]>;
  /** Get unresolved errors for a bead */
  getUnresolvedByBead(beadId: string): Promise<ErrorEntry[]>;
  /** Mark an error as resolved */
  markResolved(id: string): Promise<void>;
  /** Get all errors */
  getAll(): Promise<ErrorEntry[]>;
}

/**
 * In-memory error storage
 *
 * Accumulates errors during subtask execution for feeding into retry prompts.
 */
export class InMemoryErrorStorage implements ErrorStorage {
  private errors: ErrorEntry[] = [];

  async store(entry: ErrorEntry): Promise<void> {
    this.errors.push(entry);
  }

  async getByBead(beadId: string): Promise<ErrorEntry[]> {
    return this.errors.filter((e) => e.bead_id === beadId);
  }

  async getUnresolvedByBead(beadId: string): Promise<ErrorEntry[]> {
    return this.errors.filter((e) => e.bead_id === beadId && !e.resolved);
  }

  async markResolved(id: string): Promise<void> {
    const error = this.errors.find((e) => e.id === id);
    if (error) {
      error.resolved = true;
    }
  }

  async getAll(): Promise<ErrorEntry[]> {
    return [...this.errors];
  }
}

/**
 * Error accumulator for tracking errors during subtask execution
 *
 * Implements patterns from "Patterns for Building AI Agents" p.40:
 * - Examines and corrects errors when something goes wrong
 * - Feeds error context into retry prompts
 * - Tracks error patterns for learning
 */
export class ErrorAccumulator {
  private storage: ErrorStorage;

  constructor(storage?: ErrorStorage) {
    this.storage = storage ?? new InMemoryErrorStorage();
  }

  /**
   * Record an error during subtask execution
   *
   * @param beadId - Cell ID where error occurred
   * @param errorType - Category of error
   * @param message - Human-readable error message
   * @param options - Additional context (stack trace, tool name, etc.)
   * @returns The created error entry
   */
  async recordError(
    beadId: string,
    errorType: ErrorType,
    message: string,
    options?: {
      stack_trace?: string;
      tool_name?: string;
      context?: string;
    },
  ): Promise<ErrorEntry> {
    const entry: ErrorEntry = {
      id: `${beadId}-${errorType}-${Date.now()}`,
      bead_id: beadId,
      error_type: errorType,
      message,
      stack_trace: options?.stack_trace,
      tool_name: options?.tool_name,
      timestamp: new Date().toISOString(),
      resolved: false,
      context: options?.context,
    };

    const validated = ErrorEntrySchema.parse(entry);
    await this.storage.store(validated);

    return validated;
  }

  /**
   * Get all errors for a bead (resolved and unresolved)
   */
  async getErrors(beadId: string): Promise<ErrorEntry[]> {
    return this.storage.getByBead(beadId);
  }

  /**
   * Get only unresolved errors for a bead
   */
  async getUnresolvedErrors(beadId: string): Promise<ErrorEntry[]> {
    return this.storage.getUnresolvedByBead(beadId);
  }

  /**
   * Mark an error as resolved
   */
  async resolveError(errorId: string): Promise<void> {
    await this.storage.markResolved(errorId);
  }

  /**
   * Format errors as context for retry prompts
   *
   * Groups errors by type and provides structured feedback
   * for the agent to learn from.
   *
   * @param beadId - Bead to get error context for
   * @param includeResolved - Include resolved errors (default: false)
   * @returns Formatted error context string
   */
  async getErrorContext(
    beadId: string,
    includeResolved = false,
  ): Promise<string> {
    const errors = includeResolved
      ? await this.getErrors(beadId)
      : await this.getUnresolvedErrors(beadId);

    if (errors.length === 0) {
      return "";
    }

    // Group errors by type
    const byType = errors.reduce(
      (acc, err) => {
        const type = err.error_type;
        if (!acc[type]) {
          acc[type] = [];
        }
        acc[type].push(err);
        return acc;
      },
      {} as Record<ErrorType, ErrorEntry[]>,
    );

    // Format as structured feedback
    const lines = [
      "## Previous Errors",
      "",
      "The following errors were encountered during execution:",
      "",
    ];

    for (const [type, typeErrors] of Object.entries(byType)) {
      lines.push(
        `### ${type} (${typeErrors.length} error${typeErrors.length > 1 ? "s" : ""})`,
      );
      lines.push("");

      for (const err of typeErrors) {
        lines.push(`- **${err.message}**`);
        if (err.context) {
          lines.push(`  - Context: ${err.context}`);
        }
        if (err.tool_name) {
          lines.push(`  - Tool: ${err.tool_name}`);
        }
        if (err.stack_trace) {
          lines.push(`  - Stack: \`${err.stack_trace.slice(0, 100)}...\``);
        }
        lines.push(
          `  - Time: ${new Date(err.timestamp).toLocaleString()}${err.resolved ? " (resolved)" : ""}`,
        );
        lines.push("");
      }
    }

    lines.push(
      "**Action Required**: Address these errors before proceeding. Consider:",
    );
    lines.push("- What caused each error?");
    lines.push("- How can you prevent similar errors?");
    lines.push("- Are there patterns across error types?");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Get error statistics for outcome tracking
   *
   * @param beadId - Bead to get stats for
   * @returns Error counts and patterns
   */
  async getErrorStats(beadId: string): Promise<{
    total: number;
    unresolved: number;
    by_type: Record<ErrorType, number>;
  }> {
    const allErrors = await this.getErrors(beadId);
    const unresolved = await this.getUnresolvedErrors(beadId);

    const byType = allErrors.reduce(
      (acc, err) => {
        acc[err.error_type] = (acc[err.error_type] || 0) + 1;
        return acc;
      },
      {} as Record<ErrorType, number>,
    );

    return {
      total: allErrors.length,
      unresolved: unresolved.length,
      by_type: byType,
    };
  }
}

// ============================================================================
// Semantic Memory Integration Helpers
// ============================================================================

/**
 * Format memory store instruction for successful task completion
 *
 * @param beadId - Cell ID that completed
 * @param summary - Completion summary
 * @param filesTouched - Files modified
 * @param strategy - Decomposition strategy used (if applicable)
 * @returns Memory store instruction object
 */
export function formatMemoryStoreOnSuccess(
  beadId: string,
  summary: string,
  filesTouched: string[],
  strategy?: DecompositionStrategy,
): {
  information: string;
  metadata: string;
  instruction: string;
} {
  const strategyInfo = strategy ? ` using ${strategy} strategy` : "";

  return {
    information: `Task "${beadId}" completed successfully${strategyInfo}.
Key insight: ${summary}
Files touched: ${filesTouched.join(", ") || "none"}`,
    metadata: `swarm, success, ${beadId}, ${strategy || "completion"}`,
    instruction:
      "Store this successful completion in semantic-memory for future reference",
  };
}

/**
 * Format memory store instruction for architectural problems (3-strike)
 *
 * @param beadId - Cell ID that struck out
 * @param failures - Array of failure attempts
 * @returns Memory store instruction object
 */
export function formatMemoryStoreOn3Strike(
  beadId: string,
  failures: Array<{ attempt: string; reason: string }>,
): {
  information: string;
  metadata: string;
  instruction: string;
} {
  const failuresList = failures
    .map((f, i) => `${i + 1}. ${f.attempt} - Failed: ${f.reason}`)
    .join("\n");

  return {
    information: `Architecture problem detected in ${beadId}: Task failed after 3 attempts.
Attempts:
${failuresList}

This indicates a structural issue requiring human decision, not another fix attempt.`,
    metadata: `architecture, 3-strike, ${beadId}, failure`,
    instruction:
      "Store this architectural problem in semantic-memory to avoid similar patterns in future",
  };
}

/**
 * Format memory query instruction for task decomposition
 *
 * @param task - Task description
 * @param limit - Max results to return
 * @returns Memory query instruction object
 */
export function formatMemoryQueryForDecomposition(
  task: string,
  limit: number = 3,
): {
  query: string;
  limit: number;
  instruction: string;
} {
  return {
    query: task,
    limit,
    instruction:
      "Query semantic-memory for relevant past learnings about similar tasks before decomposition",
  };
}

/**
 * Format memory validation hint when CASS history helped
 *
 * @param beadId - Cell ID that benefited from CASS
 * @returns Memory validation hint
 */
export function formatMemoryValidationHint(beadId: string): {
  instruction: string;
  context: string;
} {
  return {
    instruction:
      "If any semantic-memory entries helped with this task, validate them to reset decay timer",
    context: `Task ${beadId} completed successfully with assistance from past learnings`,
  };
}

// ============================================================================
// Exports
// ============================================================================

export const learningSchemas = {
  FeedbackTypeSchema,
  FeedbackEventSchema,
  CriterionWeightSchema,
  OutcomeSignalsSchema,
  ScoredOutcomeSchema,
  DecompositionStrategySchema,
  ErrorTypeSchema,
  ErrorEntrySchema,
  StrikeRecordSchema,
};
