/**
 * Swarm Context Schemas
 *
 * These schemas define the structure for storing and recovering swarm execution context.
 * Used for checkpoint/recovery, continuation after crashes, and swarm state management.
 */
import { z } from "zod";

/**
 * Decomposition strategy used for the swarm
 */
export const SwarmStrategySchema = z.enum([
  "file-based",
  "feature-based",
  "risk-based",
]);
export type SwarmStrategy = z.infer<typeof SwarmStrategySchema>;

/**
 * Shared directives and context for all agents in a swarm
 */
export const SwarmDirectivesSchema = z.object({
  /** Context shared with all agents (API contracts, conventions, arch decisions) */
  shared_context: z.string(),
  /** Skills to load in agent context (e.g., ['testing-patterns', 'swarm-coordination']) */
  skills_to_load: z.array(z.string()).default([]),
  /** Notes from coordinator to agents (gotchas, important context) */
  coordinator_notes: z.string().default(""),
});
export type SwarmDirectives = z.infer<typeof SwarmDirectivesSchema>;

/**
 * Recovery state for checkpoint/resume
 */
export const SwarmRecoverySchema = z.object({
  /** Last known checkpoint (ISO-8601 timestamp or checkpoint ID) */
  last_checkpoint: z.string(),
  /** Files modified since checkpoint (for rollback/recovery) */
  files_modified: z.array(z.string()).default([]),
  /** Progress percentage (0-100) */
  progress_percent: z.number().min(0).max(100).default(0),
  /** Last status message from agent */
  last_message: z.string().default(""),
  /** Error context if agent failed (for retry/recovery) */
  error_context: z.string().optional(),
});
export type SwarmRecovery = z.infer<typeof SwarmRecoverySchema>;

/**
 * Complete context for a single bead in a swarm
 *
 * Stored in swarm_contexts table for recovery, continuation, and state management.
 */
export const SwarmBeadContextSchema = z.object({
  /** ID of the swarm context record */
  id: z.string(),
  /** Epic this bead belongs to */
  epic_id: z.string(),
  /** Cell ID being executed */
  bead_id: z.string(),
  /** Decomposition strategy used */
  strategy: SwarmStrategySchema,
  /** Files this bead is responsible for */
  files: z.array(z.string()),
  /** Cell IDs this task depends on */
  dependencies: z.array(z.string()).default([]),
  /** Shared directives and context */
  directives: SwarmDirectivesSchema,
  /** Recovery state */
  recovery: SwarmRecoverySchema,
  /** Creation timestamp (epoch ms) */
  created_at: z.number().int().positive(),
  /** Last update timestamp (epoch ms) */
  updated_at: z.number().int().positive(),
});
export type SwarmBeadContext = z.infer<typeof SwarmBeadContextSchema>;

/**
 * Args for creating a swarm context
 */
export const CreateSwarmContextArgsSchema = SwarmBeadContextSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type CreateSwarmContextArgs = z.infer<
  typeof CreateSwarmContextArgsSchema
>;

/**
 * Args for updating a swarm context
 */
export const UpdateSwarmContextArgsSchema = z.object({
  id: z.string(),
  recovery: SwarmRecoverySchema.partial().optional(),
  files: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  directives: SwarmDirectivesSchema.partial().optional(),
});
export type UpdateSwarmContextArgs = z.infer<
  typeof UpdateSwarmContextArgsSchema
>;

/**
 * Args for querying swarm contexts
 */
export const QuerySwarmContextsArgsSchema = z.object({
  epic_id: z.string().optional(),
  bead_id: z.string().optional(),
  strategy: SwarmStrategySchema.optional(),
  has_errors: z.boolean().optional(), // Filter by presence of error_context
});
export type QuerySwarmContextsArgs = z.infer<
  typeof QuerySwarmContextsArgsSchema
>;
