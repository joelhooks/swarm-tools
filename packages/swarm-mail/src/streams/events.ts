/**
 * Event Types for Swarm Mail Event Sourcing
 *
 * All agent coordination operations are represented as immutable events.
 * Current state is computed by replaying events (projections).
 *
 * Event sourcing benefits:
 * - Full audit trail for debugging
 * - Replay from any point
 * - Events ARE the training data for learning
 * - No lost messages - append-only, durable
 */
import { z } from "zod";

// ============================================================================
// Base Event Schema
// ============================================================================

/**
 * Base fields present on all events
 */
export const BaseEventSchema = z.object({
  /** Auto-generated event ID */
  id: z.number().optional(),
  /** Event type discriminator */
  type: z.string(),
  /** Project key (usually absolute path) */
  project_key: z.string(),
  /** Timestamp when event occurred */
  timestamp: z.number(), // Unix ms
  /** Sequence number for ordering */
  sequence: z.number().optional(),
});

// ============================================================================
// Agent Events
// ============================================================================

export const AgentRegisteredEventSchema = BaseEventSchema.extend({
  type: z.literal("agent_registered"),
  agent_name: z.string(),
  program: z.string().default("opencode"),
  model: z.string().default("unknown"),
  task_description: z.string().optional(),
});

export const AgentActiveEventSchema = BaseEventSchema.extend({
  type: z.literal("agent_active"),
  agent_name: z.string(),
});

// ============================================================================
// Message Events
// ============================================================================

export const MessageSentEventSchema = BaseEventSchema.extend({
  type: z.literal("message_sent"),
  /** Message ID (auto-generated) */
  message_id: z.number().optional(),
  from_agent: z.string(),
  to_agents: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
  thread_id: z.string().optional(),
  importance: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  ack_required: z.boolean().default(false),
});

export const MessageReadEventSchema = BaseEventSchema.extend({
  type: z.literal("message_read"),
  message_id: z.number(),
  agent_name: z.string(),
});

export const MessageAckedEventSchema = BaseEventSchema.extend({
  type: z.literal("message_acked"),
  message_id: z.number(),
  agent_name: z.string(),
});

// ============================================================================
// File Reservation Events
// ============================================================================

export const FileReservedEventSchema = BaseEventSchema.extend({
  type: z.literal("file_reserved"),
  /** Reservation ID (auto-generated) */
  reservation_id: z.number().optional(),
  agent_name: z.string(),
  paths: z.array(z.string()),
  reason: z.string().optional(),
  exclusive: z.boolean().default(true),
  /** TTL in seconds */
  ttl_seconds: z.number().default(3600),
  /** Absolute expiry timestamp */
  expires_at: z.number(),
  /** DurableLock holder IDs (one per path) */
  lock_holder_ids: z.array(z.string()).optional(),
});

export const FileReleasedEventSchema = BaseEventSchema.extend({
  type: z.literal("file_released"),
  agent_name: z.string(),
  /** Specific paths to release, or empty to release all */
  paths: z.array(z.string()).optional(),
  /** Specific reservation IDs to release */
  reservation_ids: z.array(z.number()).optional(),
  /** DurableLock holder IDs to release */
  lock_holder_ids: z.array(z.string()).optional(),
});

// ============================================================================
// Task Events (for swarm integration)
// ============================================================================

export const TaskStartedEventSchema = BaseEventSchema.extend({
  type: z.literal("task_started"),
  agent_name: z.string(),
  bead_id: z.string(),
  epic_id: z.string().optional(),
});

export const TaskProgressEventSchema = BaseEventSchema.extend({
  type: z.literal("task_progress"),
  agent_name: z.string(),
  bead_id: z.string(),
  progress_percent: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  files_touched: z.array(z.string()).optional(),
});

export const TaskCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal("task_completed"),
  agent_name: z.string(),
  bead_id: z.string(),
  summary: z.string(),
  files_touched: z.array(z.string()).optional(),
  success: z.boolean().default(true),
});

export const TaskBlockedEventSchema = BaseEventSchema.extend({
  type: z.literal("task_blocked"),
  agent_name: z.string(),
  bead_id: z.string(),
  reason: z.string(),
});

// ============================================================================
// Eval Capture Events (for learning system)
// ============================================================================

export const DecompositionGeneratedEventSchema = BaseEventSchema.extend({
  type: z.literal("decomposition_generated"),
  epic_id: z.string(),
  task: z.string(),
  context: z.string().optional(),
  strategy: z.enum(["file-based", "feature-based", "risk-based"]),
  epic_title: z.string(),
  subtasks: z.array(
    z.object({
      title: z.string(),
      files: z.array(z.string()),
      priority: z.number().min(0).max(3).optional(),
    }),
  ),
  recovery_context: z
    .object({
      shared_context: z.string().optional(),
      skills_to_load: z.array(z.string()).optional(),
      coordinator_notes: z.string().optional(),
    })
    .optional(),
});

export const SubtaskOutcomeEventSchema = BaseEventSchema.extend({
  type: z.literal("subtask_outcome"),
  epic_id: z.string(),
  bead_id: z.string(),
  planned_files: z.array(z.string()),
  actual_files: z.array(z.string()),
  duration_ms: z.number().min(0),
  error_count: z.number().min(0).default(0),
  retry_count: z.number().min(0).default(0),
  success: z.boolean(),
  /** Contract violation - files touched outside owned scope */
  scope_violation: z.boolean().optional(),
  /** Files that violated the contract */
  violation_files: z.array(z.string()).optional(),
});

export const HumanFeedbackEventSchema = BaseEventSchema.extend({
  type: z.literal("human_feedback"),
  epic_id: z.string(),
  accepted: z.boolean(),
  modified: z.boolean().default(false),
  notes: z.string().optional(),
});

// ============================================================================
// Swarm Checkpoint Events (for recovery and coordination)
// ============================================================================

export const SwarmCheckpointedEventSchema = BaseEventSchema.extend({
  type: z.literal("swarm_checkpointed"),
  epic_id: z.string(),
  bead_id: z.string(),
  strategy: z.enum(["file-based", "feature-based", "risk-based"]),
  files: z.array(z.string()),
  dependencies: z.array(z.string()),
  directives: z.object({
    shared_context: z.string().optional(),
    skills_to_load: z.array(z.string()).optional(),
    coordinator_notes: z.string().optional(),
  }),
  recovery: z.object({
    last_checkpoint: z.number(),
    files_modified: z.array(z.string()),
    progress_percent: z.number().min(0).max(100),
    last_message: z.string().optional(),
    error_context: z.string().optional(),
  }),
});

export const SwarmRecoveredEventSchema = BaseEventSchema.extend({
  type: z.literal("swarm_recovered"),
  epic_id: z.string(),
  bead_id: z.string(),
  recovered_from_checkpoint: z.number(), // timestamp
});

// ============================================================================
// Union Type
// ============================================================================

export const AgentEventSchema = z.discriminatedUnion("type", [
  AgentRegisteredEventSchema,
  AgentActiveEventSchema,
  MessageSentEventSchema,
  MessageReadEventSchema,
  MessageAckedEventSchema,
  FileReservedEventSchema,
  FileReleasedEventSchema,
  TaskStartedEventSchema,
  TaskProgressEventSchema,
  TaskCompletedEventSchema,
  TaskBlockedEventSchema,
  DecompositionGeneratedEventSchema,
  SubtaskOutcomeEventSchema,
  HumanFeedbackEventSchema,
  SwarmCheckpointedEventSchema,
  SwarmRecoveredEventSchema,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// Individual event types for convenience
export type AgentRegisteredEvent = z.infer<typeof AgentRegisteredEventSchema>;
export type AgentActiveEvent = z.infer<typeof AgentActiveEventSchema>;
export type MessageSentEvent = z.infer<typeof MessageSentEventSchema>;
export type MessageReadEvent = z.infer<typeof MessageReadEventSchema>;
export type MessageAckedEvent = z.infer<typeof MessageAckedEventSchema>;
export type FileReservedEvent = z.infer<typeof FileReservedEventSchema>;
export type FileReleasedEvent = z.infer<typeof FileReleasedEventSchema>;
export type TaskStartedEvent = z.infer<typeof TaskStartedEventSchema>;
export type TaskProgressEvent = z.infer<typeof TaskProgressEventSchema>;
export type TaskCompletedEvent = z.infer<typeof TaskCompletedEventSchema>;
export type TaskBlockedEvent = z.infer<typeof TaskBlockedEventSchema>;
export type DecompositionGeneratedEvent = z.infer<
  typeof DecompositionGeneratedEventSchema
>;
export type SubtaskOutcomeEvent = z.infer<typeof SubtaskOutcomeEventSchema>;
export type HumanFeedbackEvent = z.infer<typeof HumanFeedbackEventSchema>;
export type SwarmCheckpointedEvent = z.infer<
  typeof SwarmCheckpointedEventSchema
>;
export type SwarmRecoveredEvent = z.infer<typeof SwarmRecoveredEventSchema>;

// ============================================================================
// Session State Types
// ============================================================================

/**
 * Shared session state for Agent Mail and Swarm Mail
 *
 * Common fields for tracking agent coordination session across both
 * the MCP-based implementation (agent-mail) and the embedded event-sourced
 * implementation (swarm-mail).
 */
export interface MailSessionState {
  /** Project key (usually absolute path) */
  projectKey: string;
  /** Agent name for this session */
  agentName: string;
  /** Active reservation IDs */
  reservations: number[];
  /** Session start timestamp (ISO-8601) */
  startedAt: string;
}

// ============================================================================
// Event Helpers
// ============================================================================

/**
 * Create an event with timestamp and validate
 */
export function createEvent<T extends AgentEvent["type"]>(
  type: T,
  data: Omit<
    Extract<AgentEvent, { type: T }>,
    "type" | "timestamp" | "id" | "sequence"
  >,
): Extract<AgentEvent, { type: T }> {
  const event = {
    type,
    timestamp: Date.now(),
    ...data,
  } as Extract<AgentEvent, { type: T }>;

  // Validate
  const result = AgentEventSchema.safeParse(event);
  if (!result.success) {
    throw new Error(`Invalid event: ${result.error.message}`);
  }

  return result.data as Extract<AgentEvent, { type: T }>;
}

/**
 * Type guard for specific event types
 */
export function isEventType<T extends AgentEvent["type"]>(
  event: AgentEvent,
  type: T,
): event is Extract<AgentEvent, { type: T }> {
  return event.type === type;
}
