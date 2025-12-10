/**
 * Evaluation schemas for structured agent output validation
 *
 * These schemas define the expected format for agent self-evaluations
 * and coordinator evaluations of completed work.
 *
 * Includes support for confidence decay - criteria weights fade over time
 * unless revalidated by successful outcomes.
 *
 * @see src/learning.ts for decay calculations
 */
import { z } from "zod";

/**
 * Single criterion evaluation
 *
 * Each criterion (type_safe, no_bugs, etc.) gets its own evaluation.
 */
export const CriterionEvaluationSchema = z.object({
  passed: z.boolean(),
  feedback: z.string(),
  score: z.number().min(0).max(1).optional(), // 0-1 normalized score
});
export type CriterionEvaluation = z.infer<typeof CriterionEvaluationSchema>;

/**
 * Weighted criterion evaluation with confidence decay
 *
 * Extends CriterionEvaluation with weight information from learning.
 * Lower weights indicate criteria that have been historically unreliable.
 */
export const WeightedCriterionEvaluationSchema =
  CriterionEvaluationSchema.extend({
    /** Current weight after decay (0-1, lower = less reliable) */
    weight: z.number().min(0).max(1).default(1),
    /** Weighted score = score * weight */
    weighted_score: z.number().min(0).max(1).optional(),
    /** Whether this criterion is deprecated due to high failure rate */
    deprecated: z.boolean().default(false),
  });
export type WeightedCriterionEvaluation = z.infer<
  typeof WeightedCriterionEvaluationSchema
>;

/**
 * Full evaluation result
 *
 * Returned by agents after completing a subtask.
 * Used by coordinator to determine if work is acceptable.
 */
export const EvaluationSchema = z.object({
  passed: z.boolean(),
  criteria: z.record(z.string(), CriterionEvaluationSchema),
  overall_feedback: z.string(),
  retry_suggestion: z.string().nullable(),
  timestamp: z.string().datetime({ offset: true }).optional(), // ISO-8601 with timezone
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

/**
 * Default evaluation criteria
 *
 * These are the standard criteria used when none are specified.
 * Can be overridden per-task or per-project.
 */
export const DEFAULT_CRITERIA = [
  "type_safe",
  "no_bugs",
  "patterns",
  "readable",
] as const;
export type DefaultCriterion = (typeof DEFAULT_CRITERIA)[number];

/**
 * Evaluation request arguments
 */
export const EvaluationRequestSchema = z.object({
  subtask_id: z.string(),
  criteria: z.array(z.string()).default([...DEFAULT_CRITERIA]),
  context: z.string().optional(),
});
export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;

/**
 * Weighted evaluation result with confidence-adjusted scores
 *
 * Used when applying learned weights to evaluation criteria.
 */
export const WeightedEvaluationSchema = z.object({
  passed: z.boolean(),
  criteria: z.record(z.string(), WeightedCriterionEvaluationSchema),
  overall_feedback: z.string(),
  retry_suggestion: z.string().nullable(),
  timestamp: z.string().datetime({ offset: true }).optional(), // ISO-8601 with timezone
  /** Average weight across all criteria (indicates overall confidence) */
  average_weight: z.number().min(0).max(1).optional(),
  /** Raw score before weighting */
  raw_score: z.number().min(0).max(1).optional(),
  /** Weighted score after applying criterion weights */
  weighted_score: z.number().min(0).max(1).optional(),
});
export type WeightedEvaluation = z.infer<typeof WeightedEvaluationSchema>;

/**
 * Aggregated evaluation results for a swarm
 */
export const SwarmEvaluationResultSchema = z.object({
  epic_id: z.string(),
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  evaluations: z.array(
    z.object({
      bead_id: z.string(),
      evaluation: EvaluationSchema,
    }),
  ),
  overall_passed: z.boolean(),
  retry_needed: z.array(z.string()), // Bead IDs that need retry
});
export type SwarmEvaluationResult = z.infer<typeof SwarmEvaluationResultSchema>;

/**
 * Validation result with retry info
 */
export const ValidationResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  attempts: z.number().int().min(1),
  errors: z.array(z.string()).optional(),
  extractionMethod: z.string().optional(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * Failure mode taxonomy for task failures
 *
 * Classifies WHY tasks fail, not just that they failed.
 * Used in outcome tracking to learn from failure patterns.
 *
 * @see src/learning.ts OutcomeSignalsSchema
 * @see "Patterns for Building AI Agents" p.46
 */
export const FailureModeSchema = z.enum([
  "timeout", // Task exceeded time limit
  "conflict", // File reservation conflict
  "validation", // Output failed schema validation
  "tool_failure", // Tool call returned error
  "context_overflow", // Ran out of context window
  "dependency_blocked", // Waiting on another subtask
  "user_cancelled", // User interrupted
  "unknown", // Unclassified
]);
export type FailureMode = z.infer<typeof FailureModeSchema>;
