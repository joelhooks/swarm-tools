/**
 * Beads Module - Event-sourced issue tracking
 *
 * Exports:
 * - HiveAdapter interface and types
 * - Migration definitions
 * - Projection functions
 * - Store operations (append, read, replay)
 * - Event type definitions
 *
 * @module beads
 */

// Types
export type {
  Cell,
  CellAdapter,
  CellComment,
  CellDependency,
  CellLabel,
  HiveAdapter,
  HiveAdapterFactory,
  HiveSchemaAdapter,
  CellStatus,
  CellType,
  CommentAdapter,
  CreateCellOptions,
  DependencyAdapter,
  DependencyRelationship,
  EpicAdapter,
  LabelAdapter,
  QueryAdapter,
  QueryCellsOptions,
  UpdateCellOptions,
  // Backward compatibility aliases
  Bead,
  BeadAdapter,
  BeadComment,
  BeadDependency,
  BeadLabel,
  BeadsAdapter,
  BeadsAdapterFactory,
  BeadsSchemaAdapter,
  BeadStatus,
  BeadType,
  CreateBeadOptions,
  UpdateBeadOptions,
  QueryBeadsOptions,
} from "../types/hive-adapter.js";

// Event types
export type {
  CellEvent,
  BaseCellEvent,
  CellCreatedEvent,
  CellUpdatedEvent,
  CellStatusChangedEvent,
  CellClosedEvent,
  CellReopenedEvent,
  CellDeletedEvent,
  CellDependencyAddedEvent,
  CellDependencyRemovedEvent,
  CellLabelAddedEvent,
  CellLabelRemovedEvent,
  CellCommentAddedEvent,
  CellCommentUpdatedEvent,
  CellCommentDeletedEvent,
  CellEpicChildAddedEvent,
  CellEpicChildRemovedEvent,
  CellEpicClosureEligibleEvent,
  CellAssignedEvent,
  CellWorkStartedEvent,
  CellCompactedEvent,
} from "./events.js";

// Adapter factory
export { createHiveAdapter } from "./adapter.js";

// Backward compatibility alias
export { createHiveAdapter as createBeadsAdapter } from "./adapter.js";

// Migrations
export { beadsMigration, beadsMigrations } from "./migrations.js";

// Store operations
export {
  appendCellEvent,
  readCellEvents,
  replayCellEvents,
  type ReadCellEventsOptions,
} from "./store.js";

// Projections
export {
  clearAllDirtyBeads,
  clearDirtyBead,
  getCell,
  getBlockedCells,
  getBlockers,
  getComments,
  getDependencies,
  getDependents,
  getDirtyCells,
  getInProgressCells,
  getLabels,
  getNextReadyCell,
  isBlocked,
  markBeadDirty,
  queryCells,
  updateProjections,
} from "./projections.js";

// Dependency operations
export {
  wouldCreateCycle,
  getOpenBlockers,
  rebuildBeadBlockedCache,
  rebuildAllBlockedCaches,
  invalidateBlockedCache,
} from "./dependencies.js";

// Label operations
export {
  getCellsByLabel,
  getAllLabels,
} from "./labels.js";

// Comment operations
export {
  getCommentById,
  getCommentThread,
} from "./comments.js";

// JSONL export/import
export {
  exportToJSONL,
  exportDirtyBeads,
  importFromJSONL,
  parseJSONL,
  serializeToJSONL,
  computeContentHash,
  type CellExport,
  type ExportOptions,
  type ImportOptions,
  type ImportResult,
} from "./jsonl.js";

// FlushManager for auto-sync
export {
  FlushManager,
  type FlushManagerOptions,
  type FlushResult,
} from "./flush-manager.js";

// 3-Way Merge Driver
export {
  merge3Way,
  mergeJsonl,
  isTombstone,
  isExpiredTombstone,
  DEFAULT_TOMBSTONE_TTL_MS,
  MIN_TOMBSTONE_TTL_MS,
  CLOCK_SKEW_GRACE_MS,
  STATUS_TOMBSTONE,
  type IssueKey,
  type MergeResult,
  type MergeOptions,
} from "./merge.js";
