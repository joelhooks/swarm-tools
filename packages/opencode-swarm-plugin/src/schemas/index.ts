/**
 * Schema Definitions - Central export point for all Zod schemas
 *
 * This module re-exports all schema definitions used throughout the plugin.
 * Schemas are organized by domain:
 *
 * ## Cell Schemas (Issue Tracking) - PRIMARY
 * - `CellSchema` - Core cell/issue definition (formerly BeadSchema)
 * - `CellStatusSchema` - Status enum (open, in_progress, blocked, closed)
 * - `CellTypeSchema` - Type enum (bug, feature, task, epic, chore)
 * - `SubtaskSpecSchema` - Subtask specification for epic creation
 * - `CellTreeSchema` - Epic + subtasks structure (formerly BeadTreeSchema)
 *
 * **Backward compatibility:** All Bead* names are exported as deprecated aliases.
 *
 * ## Task Schemas (Swarm Decomposition)
 * - `TaskDecompositionSchema` - Full task breakdown
 * - `DecomposedSubtaskSchema` - Individual subtask definition
 *
 * ## Evaluation Schemas (Agent Self-Assessment)
 * - `EvaluationSchema` - Complete evaluation with criteria
 * - `CriterionEvaluationSchema` - Single criterion result
 *
 * ## Progress Schemas (Swarm Coordination)
 * - `SwarmStatusSchema` - Overall swarm progress
 * - `AgentProgressSchema` - Individual agent status
 * - `SpawnedAgentSchema` - Spawned agent metadata
 *
 * @module schemas
 */

// Cell schemas (primary names)
export {
  CellStatusSchema,
  CellTypeSchema,
  CellDependencySchema,
  CellSchema,
  CellCreateArgsSchema,
  CellUpdateArgsSchema,
  CellCloseArgsSchema,
  CellQueryArgsSchema,
  SubtaskSpecSchema,
  CellTreeSchema,
  EpicCreateArgsSchema,
  EpicCreateResultSchema,
  type CellStatus,
  type CellType,
  type CellDependency,
  type Cell,
  type CellCreateArgs,
  type CellUpdateArgs,
  type CellCloseArgs,
  type CellQueryArgs,
  type SubtaskSpec,
  type CellTree,
  type EpicCreateArgs,
  type EpicCreateResult,
} from "./cell";

// Bead schemas (backward compatibility aliases)
export {
  BeadStatusSchema,
  BeadTypeSchema,
  BeadDependencySchema,
  BeadSchema,
  BeadCreateArgsSchema,
  BeadUpdateArgsSchema,
  BeadCloseArgsSchema,
  BeadQueryArgsSchema,
  BeadTreeSchema,
  type BeadStatus,
  type BeadType,
  type BeadDependency,
  type Bead,
  type BeadCreateArgs,
  type BeadUpdateArgs,
  type BeadCloseArgs,
  type BeadQueryArgs,
  type BeadTree,
} from "./cell";

// Evaluation schemas
export {
  CriterionEvaluationSchema,
  WeightedCriterionEvaluationSchema,
  EvaluationSchema,
  WeightedEvaluationSchema,
  EvaluationRequestSchema,
  SwarmEvaluationResultSchema,
  ValidationResultSchema,
  DEFAULT_CRITERIA,
  type CriterionEvaluation,
  type WeightedCriterionEvaluation,
  type Evaluation,
  type WeightedEvaluation,
  type EvaluationRequest,
  type SwarmEvaluationResult,
  type ValidationResult,
  type DefaultCriterion,
} from "./evaluation";

// Task schemas
export {
  EffortLevelSchema,
  DependencyTypeSchema,
  DecomposedSubtaskSchema,
  SubtaskDependencySchema,
  TaskDecompositionSchema,
  DecomposeArgsSchema,
  SpawnedAgentSchema,
  SwarmSpawnResultSchema,
  AgentProgressSchema,
  SwarmStatusSchema,
  type EffortLevel,
  type DependencyType,
  type DecomposedSubtask,
  type SubtaskDependency,
  type TaskDecomposition,
  type DecomposeArgs,
  type SpawnedAgent,
  type SwarmSpawnResult,
  type AgentProgress,
  type SwarmStatus,
} from "./task";

// Mandate schemas
export {
  MandateContentTypeSchema,
  MandateStatusSchema,
  VoteTypeSchema,
  MandateEntrySchema,
  VoteSchema,
  MandateScoreSchema,
  CreateMandateArgsSchema,
  CastVoteArgsSchema,
  QueryMandatesArgsSchema,
  ScoreCalculationResultSchema,
  DEFAULT_MANDATE_DECAY_CONFIG,
  mandateSchemas,
  type MandateContentType,
  type MandateStatus,
  type VoteType,
  type MandateEntry,
  type Vote,
  type MandateScore,
  type MandateDecayConfig,
  type CreateMandateArgs,
  type CastVoteArgs,
  type QueryMandatesArgs,
  type ScoreCalculationResult,
} from "./mandate";

// Swarm context schemas
export {
  SwarmStrategySchema,
  SwarmDirectivesSchema,
  SwarmRecoverySchema,
  SwarmBeadContextSchema,
  CreateSwarmContextArgsSchema,
  UpdateSwarmContextArgsSchema,
  QuerySwarmContextsArgsSchema,
  type SwarmStrategy,
  type SwarmDirectives,
  type SwarmRecovery,
  type SwarmBeadContext,
  type CreateSwarmContextArgs,
  type UpdateSwarmContextArgs,
  type QuerySwarmContextsArgs,
} from "./swarm-context";

// Cell event schemas (PRIMARY)
export {
  BaseCellEventSchema,
  CellCreatedEventSchema,
  CellUpdatedEventSchema,
  CellStatusChangedEventSchema,
  CellClosedEventSchema,
  CellReopenedEventSchema,
  CellDeletedEventSchema,
  CellDependencyAddedEventSchema,
  CellDependencyRemovedEventSchema,
  CellLabelAddedEventSchema,
  CellLabelRemovedEventSchema,
  CellCommentAddedEventSchema,
  CellCommentUpdatedEventSchema,
  CellCommentDeletedEventSchema,
  CellEpicChildAddedEventSchema,
  CellEpicChildRemovedEventSchema,
  CellEpicClosureEligibleEventSchema,
  CellAssignedEventSchema,
  CellWorkStartedEventSchema,
  CellCompactedEventSchema,
  CellEventSchema,
  createCellEvent,
  isCellEventType,
  getCellIdFromEvent,
  isStateTransitionEvent,
  isEpicEvent,
  isAgentEvent,
  type CellEvent,
  type CellCreatedEvent,
  type CellUpdatedEvent,
  type CellStatusChangedEvent,
  type CellClosedEvent,
  type CellReopenedEvent,
  type CellDeletedEvent,
  type CellDependencyAddedEvent,
  type CellDependencyRemovedEvent,
  type CellLabelAddedEvent,
  type CellLabelRemovedEvent,
  type CellCommentAddedEvent,
  type CellCommentUpdatedEvent,
  type CellCommentDeletedEvent,
  type CellEpicChildAddedEvent,
  type CellEpicChildRemovedEvent,
  type CellEpicClosureEligibleEvent,
  type CellAssignedEvent,
  type CellWorkStartedEvent,
  type CellCompactedEvent,
} from "./cell-events";

// Bead event schemas (DEPRECATED - backward compatibility)
export {
  BaseBeadEventSchema,
  BeadCreatedEventSchema,
  BeadUpdatedEventSchema,
  BeadStatusChangedEventSchema,
  BeadClosedEventSchema,
  BeadReopenedEventSchema,
  BeadDeletedEventSchema,
  BeadDependencyAddedEventSchema,
  BeadDependencyRemovedEventSchema,
  BeadLabelAddedEventSchema,
  BeadLabelRemovedEventSchema,
  BeadCommentAddedEventSchema,
  BeadCommentUpdatedEventSchema,
  BeadCommentDeletedEventSchema,
  BeadEpicChildAddedEventSchema,
  BeadEpicChildRemovedEventSchema,
  BeadEpicClosureEligibleEventSchema,
  BeadAssignedEventSchema,
  BeadWorkStartedEventSchema,
  BeadCompactedEventSchema,
  BeadEventSchema,
  createBeadEvent,
  isBeadEventType,
  getBeadIdFromEvent,
  type BeadEvent,
  type BeadCreatedEvent,
  type BeadUpdatedEvent,
  type BeadStatusChangedEvent,
  type BeadClosedEvent,
  type BeadReopenedEvent,
  type BeadDeletedEvent,
  type BeadDependencyAddedEvent,
  type BeadDependencyRemovedEvent,
  type BeadLabelAddedEvent,
  type BeadLabelRemovedEvent,
  type BeadCommentAddedEvent,
  type BeadCommentUpdatedEvent,
  type BeadCommentDeletedEvent,
  type BeadEpicChildAddedEvent,
  type BeadEpicChildRemovedEvent,
  type BeadEpicClosureEligibleEvent,
  type BeadAssignedEvent,
  type BeadWorkStartedEvent,
  type BeadCompactedEvent,
} from "./cell-events";
