/**
 * Cell schemas for type-safe cell operations
 *
 * These schemas validate all data from the `bd` CLI to ensure
 * type safety and catch malformed responses early.
 *
 * Cells are work items in the Hive (honeycomb metaphor).
 * Backward compatibility: Bead* aliases provided for gradual migration.
 */
import { z } from "zod";

/** Valid cell statuses */
export const CellStatusSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "closed",
]);
export type CellStatus = z.infer<typeof CellStatusSchema>;

/** Valid cell types */
export const CellTypeSchema = z.enum([
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
]);
export type CellType = z.infer<typeof CellTypeSchema>;

/** Dependency relationship between cells */
export const CellDependencySchema = z.object({
  id: z.string(),
  type: z.enum(["blocks", "blocked-by", "related", "discovered-from"]),
});
export type CellDependency = z.infer<typeof CellDependencySchema>;

/**
 * Core cell schema - validates bd CLI JSON output
 *
 * ID format:
 * - Standard: `{project}-{hash}` (e.g., `opencode-swarm-plugin-1i8`)
 * - Subtask: `{project}-{hash}.{index}` (e.g., `opencode-swarm-plugin-1i8.1`)
 * - Custom: `{project}-{custom-id}` (e.g., `migrate-egghead-phase-0`)
 * - Custom subtask: `{project}-{custom-id}.{suffix}` (e.g., `migrate-egghead-phase-0.e2e-test`)
 */
export const CellSchema = z.object({
  /**
   * Cell ID format: project-slug-hash with optional subtask index.
   *
   * Pattern: `project-name-xxxxx` or `project-name-xxxxx.N`
   * Examples:
   * - `my-project-abc12` (main cell)
   * - `my-project-abc12.1` (first subtask)
   * - `my-project-abc12.2` (second subtask)
   */
  id: z
    .string()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)+(\.[\w-]+)?$/,
      "Invalid cell ID format (expected: project-slug-hash or project-slug-hash.N)",
    ),
  title: z.string().min(1, "Title required"),
  description: z.string().optional().default(""),
  status: CellStatusSchema.default("open"),
  priority: z.number().int().min(0).max(3).default(2),
  issue_type: CellTypeSchema.default("task"),
  created_at: z.string().datetime({
    offset: true,
    message:
      "Must be ISO-8601 datetime with timezone (e.g., 2024-01-15T10:30:00Z)",
  }),
  updated_at: z
    .string()
    .datetime({
      offset: true,
      message:
        "Must be ISO-8601 datetime with timezone (e.g., 2024-01-15T10:30:00Z)",
    })
    .optional(),
  closed_at: z.string().datetime({ offset: true }).optional(),
  parent_id: z.string().optional(),
  dependencies: z.array(CellDependencySchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Cell = z.infer<typeof CellSchema>;

/** Arguments for creating a cell */
export const CellCreateArgsSchema = z.object({
  title: z.string().min(1, "Title required"),
  type: CellTypeSchema.default("task"),
  priority: z.number().int().min(0).max(3).default(2),
  description: z.string().optional(),
  parent_id: z.string().optional(),
  /**
   * Custom ID for human-readable cell names.
   * MUST include project prefix (e.g., 'migrate-egghead-phase-0', not just 'phase-0').
   * For subtasks, use dot notation: 'migrate-egghead-phase-0.e2e-test'
   */
  id: z.string().optional(),
});
export type CellCreateArgs = z.infer<typeof CellCreateArgsSchema>;

/** Arguments for updating a cell */
export const CellUpdateArgsSchema = z.object({
  id: z.string(),
  status: CellStatusSchema.optional(),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(3).optional(),
});
export type CellUpdateArgs = z.infer<typeof CellUpdateArgsSchema>;

/** Arguments for closing a cell */
export const CellCloseArgsSchema = z.object({
  id: z.string(),
  reason: z.string().min(1, "Reason required"),
});
export type CellCloseArgs = z.infer<typeof CellCloseArgsSchema>;

/** Arguments for querying cells */
export const CellQueryArgsSchema = z.object({
  status: CellStatusSchema.optional(),
  type: CellTypeSchema.optional(),
  ready: z.boolean().optional(),
  parent_id: z.string().optional(),
  limit: z.number().int().positive().default(20),
});
export type CellQueryArgs = z.infer<typeof CellQueryArgsSchema>;

/**
 * Subtask specification for epic decomposition
 *
 * Used when creating an epic with subtasks in one operation.
 * The `files` array is used for Agent Mail file reservations.
 */
export const SubtaskSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  files: z.array(z.string()).default([]),
  dependencies: z.array(z.number().int().min(0)).default([]), // Indices of other subtasks
  /**
   * Complexity estimate on 1-5 scale:
   * 1 = trivial (typo fix, simple rename)
   * 2 = simple (single function change)
   * 3 = moderate (multi-file, some coordination)
   * 4 = complex (significant refactoring)
   * 5 = very complex (architectural change)
   */
  estimated_complexity: z.number().int().min(1).max(5).default(3),
});
export type SubtaskSpec = z.infer<typeof SubtaskSpecSchema>;

/**
 * Cell tree for swarm decomposition
 *
 * Represents an epic with its subtasks, ready for spawning agents.
 */
export const CellTreeSchema = z.object({
  epic: z.object({
    title: z.string().min(1),
    description: z.string().optional().default(""),
  }),
  subtasks: z.array(SubtaskSpecSchema).min(1),
  strategy: z
    .enum(["file-based", "feature-based", "risk-based", "research-based"])
    .optional()
    .describe(
      "Decomposition strategy from swarm_select_strategy. If not provided, defaults to feature-based.",
    ),
});
export type CellTree = z.infer<typeof CellTreeSchema>;

/** Arguments for creating an epic with subtasks */
export const EpicCreateArgsSchema = z.object({
  epic_title: z.string().min(1),
  epic_description: z.string().optional(),
  /**
   * Custom ID for the epic. MUST include project prefix.
   * Example: 'migrate-egghead-phase-0' (not just 'phase-0')
   * If not provided, bd generates a random ID.
   */
  epic_id: z.string().optional(),
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1),
        priority: z.number().int().min(0).max(3).default(2),
        files: z.array(z.string()).optional().default([]),
        /**
         * Custom ID suffix for subtask. Combined with epic_id using dot notation.
         * Example: epic_id='migrate-egghead-phase-0', id_suffix='e2e-test'
         *          → subtask ID: 'migrate-egghead-phase-0.e2e-test'
         */
        id_suffix: z.string().optional(),
      }),
    )
    .min(1),
});
export type EpicCreateArgs = z.infer<typeof EpicCreateArgsSchema>;

/**
 * Result of epic creation
 *
 * Contains the created epic and all subtasks with their IDs.
 */
export const EpicCreateResultSchema = z.object({
  success: z.boolean(),
  epic: CellSchema,
  subtasks: z.array(CellSchema),
  rollback_hint: z.string().optional(),
});
export type EpicCreateResult = z.infer<typeof EpicCreateResultSchema>;

// ============================================================================
// BACKWARD COMPATIBILITY ALIASES
// These aliases maintain compatibility with existing code using Bead* names.
// Gradually migrate to Cell* names in new code.
// ============================================================================

/** @deprecated Use CellStatusSchema instead */
export const BeadStatusSchema = CellStatusSchema;
/** @deprecated Use CellStatus instead */
export type BeadStatus = CellStatus;

/** @deprecated Use CellTypeSchema instead */
export const BeadTypeSchema = CellTypeSchema;
/** @deprecated Use CellType instead */
export type BeadType = CellType;

/** @deprecated Use CellDependencySchema instead */
export const BeadDependencySchema = CellDependencySchema;
/** @deprecated Use CellDependency instead */
export type BeadDependency = CellDependency;

/** @deprecated Use CellSchema instead */
export const BeadSchema = CellSchema;
/** @deprecated Use Cell instead */
export type Bead = Cell;

/** @deprecated Use CellCreateArgsSchema instead */
export const BeadCreateArgsSchema = CellCreateArgsSchema;
/** @deprecated Use CellCreateArgs instead */
export type BeadCreateArgs = CellCreateArgs;

/** @deprecated Use CellUpdateArgsSchema instead */
export const BeadUpdateArgsSchema = CellUpdateArgsSchema;
/** @deprecated Use CellUpdateArgs instead */
export type BeadUpdateArgs = CellUpdateArgs;

/** @deprecated Use CellCloseArgsSchema instead */
export const BeadCloseArgsSchema = CellCloseArgsSchema;
/** @deprecated Use CellCloseArgs instead */
export type BeadCloseArgs = CellCloseArgs;

/** @deprecated Use CellQueryArgsSchema instead */
export const BeadQueryArgsSchema = CellQueryArgsSchema;
/** @deprecated Use CellQueryArgs instead */
export type BeadQueryArgs = CellQueryArgs;

/** @deprecated Use CellTreeSchema instead */
export const BeadTreeSchema = CellTreeSchema;
/** @deprecated Use CellTree instead */
export type BeadTree = CellTree;
