/**
 * Hive Module - Type-safe wrappers using HiveAdapter
 *
 * This module provides validated, type-safe operations for the Hive
 * issue tracker using the HiveAdapter from swarm-mail.
 *
 * Key principles:
 * - Use HiveAdapter for all operations (no CLI commands)
 * - Validate all inputs with Zod schemas
 * - Throw typed errors on failure
 * - Support atomic epic creation with rollback
 *
 * IMPORTANT: Call setHiveWorkingDirectory() before using tools to ensure
 * operations run in the correct project directory.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  createHiveAdapter,
  FlushManager,
  type HiveAdapter,
  type Cell as AdapterCell,
  getSwarmMail,
} from "swarm-mail";

// ============================================================================
// Working Directory Configuration
// ============================================================================

/**
 * Module-level working directory for hive commands.
 * Set this via setHiveWorkingDirectory() before using tools.
 * If not set, commands run in process.cwd() which may be wrong for plugins.
 */
let hiveWorkingDirectory: string | null = null;

/**
 * Set the working directory for all hive commands.
 * Call this from the plugin initialization with the project directory.
 *
 * @param directory - Absolute path to the project directory
 */
export function setHiveWorkingDirectory(directory: string): void {
  hiveWorkingDirectory = directory;
}

/**
 * Get the current working directory for hive commands.
 * Returns the configured directory or process.cwd() as fallback.
 */
export function getHiveWorkingDirectory(): string {
  return hiveWorkingDirectory || process.cwd();
}

// Legacy aliases for backward compatibility
export const setBeadsWorkingDirectory = setHiveWorkingDirectory;
export const getBeadsWorkingDirectory = getHiveWorkingDirectory;

/**
 * Run a git command in the correct working directory.
 */
async function runGitCommand(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cwd = getHiveWorkingDirectory();
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

import {
  CellSchema,
  CellCreateArgsSchema,
  CellUpdateArgsSchema,
  CellCloseArgsSchema,
  CellQueryArgsSchema,
  EpicCreateArgsSchema,
  EpicCreateResultSchema,
  type Cell,
  type CellCreateArgs,
  type EpicCreateResult,
} from "./schemas";
import { createEvent, appendEvent } from "swarm-mail";

/**
 * Custom error for hive operations
 */
export class HiveError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "HiveError";
  }
}

// Legacy alias for backward compatibility
export const BeadError = HiveError;

/**
 * Custom error for validation failures
 */
export class HiveValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: z.ZodError,
  ) {
    super(message);
    this.name = "HiveValidationError";
  }
}

// Legacy alias for backward compatibility
export const BeadValidationError = HiveValidationError;

// ============================================================================
// Adapter Singleton
// ============================================================================

/**
 * Lazy singleton for HiveAdapter instances
 * Maps projectKey -> HiveAdapter
 */
const adapterCache = new Map<string, HiveAdapter>();

/**
 * Get or create a HiveAdapter instance for a project
 * Exported for testing - allows tests to verify state directly
 */
export async function getHiveAdapter(projectKey: string): Promise<HiveAdapter> {
  if (adapterCache.has(projectKey)) {
    return adapterCache.get(projectKey)!;
  }

  const swarmMail = await getSwarmMail(projectKey);
  const db = await swarmMail.getDatabase();
  const adapter = createHiveAdapter(db, projectKey);

  // Run migrations to ensure schema exists
  await adapter.runMigrations();

  adapterCache.set(projectKey, adapter);
  return adapter;
}

// Legacy alias for backward compatibility
export const getBeadsAdapter = getHiveAdapter;

/**
 * Format adapter cell for output (map field names)
 * Adapter uses: type, created_at/updated_at (timestamps)
 * Schema expects: issue_type, created_at/updated_at (ISO strings)
 */
function formatCellForOutput(adapterCell: AdapterCell): Record<string, unknown> {
  return {
    id: adapterCell.id,
    title: adapterCell.title,
    description: adapterCell.description || "",
    status: adapterCell.status,
    priority: adapterCell.priority,
    issue_type: adapterCell.type, // Adapter: type → Schema: issue_type
    created_at: new Date(adapterCell.created_at).toISOString(),
    updated_at: new Date(adapterCell.updated_at).toISOString(),
    closed_at: adapterCell.closed_at
      ? new Date(adapterCell.closed_at).toISOString()
      : undefined,
    parent_id: adapterCell.parent_id || undefined,
    dependencies: [], // TODO: fetch from adapter if needed
    metadata: {},
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create a new cell with type-safe validation
 */
export const hive_create = tool({
  description: "Create a new cell in the hive with type-safe validation",
  args: {
    title: tool.schema.string().describe("Cell title"),
    type: tool.schema
      .enum(["bug", "feature", "task", "epic", "chore"])
      .optional()
      .describe("Issue type (default: task)"),
    priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("Priority 0-3 (default: 2)"),
    description: tool.schema.string().optional().describe("Cell description"),
    parent_id: tool.schema
      .string()
      .optional()
      .describe("Parent cell ID for epic children"),
  },
  async execute(args, ctx) {
    const validated = CellCreateArgsSchema.parse(args);
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      const cell = await adapter.createCell(projectKey, {
        title: validated.title,
        type: validated.type || "task",
        priority: validated.priority ?? 2,
        description: validated.description,
        parent_id: validated.parent_id,
      });

      // Mark dirty for export
      await adapter.markDirty(projectKey, cell.id);

      const formatted = formatCellForOutput(cell);
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to create cell: ${message}`,
        "hive_create",
      );
    }
  },
});

/**
 * Create an epic with subtasks in one atomic operation
 */
export const hive_create_epic = tool({
  description: "Create epic with subtasks in one atomic operation",
  args: {
    epic_title: tool.schema.string().describe("Epic title"),
    epic_description: tool.schema
      .string()
      .optional()
      .describe("Epic description"),
    epic_id: tool.schema
      .string()
      .optional()
      .describe("Custom ID for the epic (e.g., 'phase-0')"),
    subtasks: tool.schema
      .array(
        tool.schema.object({
          title: tool.schema.string(),
          priority: tool.schema.number().min(0).max(3).optional(),
          files: tool.schema.array(tool.schema.string()).optional(),
          id_suffix: tool.schema
            .string()
            .optional()
            .describe(
              "Custom ID suffix (e.g., 'e2e-test' becomes 'phase-0.e2e-test')",
            ),
        }),
      )
      .describe("Subtasks to create under the epic"),
    strategy: tool.schema
      .enum(["file-based", "feature-based", "risk-based"])
      .optional()
      .describe("Decomposition strategy used (default: feature-based)"),
    task: tool.schema
      .string()
      .optional()
      .describe("Original task description that was decomposed"),
    project_key: tool.schema
      .string()
      .optional()
      .describe("Project path for event emission"),
    recovery_context: tool.schema
      .object({
        shared_context: tool.schema.string().optional(),
        skills_to_load: tool.schema.array(tool.schema.string()).optional(),
        coordinator_notes: tool.schema.string().optional(),
      })
      .optional()
      .describe("Recovery context from checkpoint compaction"),
  },
  async execute(args, ctx) {
    const validated = EpicCreateArgsSchema.parse(args);
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);
    const created: AdapterCell[] = [];

    try {
      // 1. Create epic
      const epic = await adapter.createCell(projectKey, {
        title: validated.epic_title,
        type: "epic",
        priority: 1,
        description: validated.epic_description,
      });
      await adapter.markDirty(projectKey, epic.id);
      created.push(epic);

      // 2. Create subtasks
      for (const subtask of validated.subtasks) {
        const subtaskCell = await adapter.createCell(projectKey, {
          title: subtask.title,
          type: "task",
          priority: subtask.priority ?? 2,
          parent_id: epic.id,
        });
        await adapter.markDirty(projectKey, subtaskCell.id);
        created.push(subtaskCell);
      }

      const result: EpicCreateResult = {
        success: true,
        epic: formatCellForOutput(epic) as Cell,
        subtasks: created.slice(1).map((c) => formatCellForOutput(c) as Cell),
      };

      // Emit DecompositionGeneratedEvent for learning system
      if (args.project_key) {
        try {
          const event = createEvent("decomposition_generated", {
            project_key: args.project_key,
            epic_id: epic.id,
            task: args.task || validated.epic_title,
            context: validated.epic_description,
            strategy: args.strategy || "feature-based",
            epic_title: validated.epic_title,
            subtasks: validated.subtasks.map((st) => ({
              title: st.title,
              files: st.files || [],
              priority: st.priority,
            })),
            recovery_context: args.recovery_context,
          });
          await appendEvent(event, args.project_key);
        } catch (error) {
          // Non-fatal - log and continue
          console.warn(
            "[hive_create_epic] Failed to emit DecompositionGeneratedEvent:",
            error,
          );
        }
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      // Partial failure - rollback via deleteCell
      const rollbackErrors: string[] = [];

      for (const cell of created) {
        try {
          await adapter.deleteCell(projectKey, cell.id, {
            reason: "Rollback partial epic",
          });
        } catch (rollbackError) {
          const errMsg =
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          console.error(`Failed to rollback cell ${cell.id}:`, rollbackError);
          rollbackErrors.push(`${cell.id}: ${errMsg}`);
        }
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      let rollbackInfo = `\n\nRolled back ${created.length - rollbackErrors.length} cell(s)`;

      if (rollbackErrors.length > 0) {
        rollbackInfo += `\n\nRollback failures (${rollbackErrors.length}):\n${rollbackErrors.join("\n")}`;
      }

      throw new HiveError(
        `Epic creation failed: ${errorMsg}${rollbackInfo}`,
        "hive_create_epic",
        1,
      );
    }
  },
});

/**
 * Query cells with filters
 */
export const hive_query = tool({
  description: "Query hive cells with filters (replaces bd list, bd ready, bd wip)",
  args: {
    status: tool.schema
      .enum(["open", "in_progress", "blocked", "closed"])
      .optional()
      .describe("Filter by status"),
    type: tool.schema
      .enum(["bug", "feature", "task", "epic", "chore"])
      .optional()
      .describe("Filter by type"),
    ready: tool.schema
      .boolean()
      .optional()
      .describe("Only show unblocked cells"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max results to return (default: 20)"),
  },
  async execute(args, ctx) {
    const validated = CellQueryArgsSchema.parse(args);
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      let cells: AdapterCell[];

      if (validated.ready) {
        const readyCell = await adapter.getNextReadyCell(projectKey);
        cells = readyCell ? [readyCell] : [];
      } else {
        cells = await adapter.queryCells(projectKey, {
          status: validated.status,
          type: validated.type,
          limit: validated.limit || 20,
        });
      }

      const formatted = cells.map((c) => formatCellForOutput(c));
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to query cells: ${message}`,
        "hive_query",
      );
    }
  },
});

/**
 * Update a cell's status or description
 */
export const hive_update = tool({
  description: "Update cell status/description",
  args: {
    id: tool.schema.string().describe("Cell ID"),
    status: tool.schema
      .enum(["open", "in_progress", "blocked", "closed"])
      .optional()
      .describe("New status"),
    description: tool.schema.string().optional().describe("New description"),
    priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("New priority"),
  },
  async execute(args, ctx) {
    const validated = CellUpdateArgsSchema.parse(args);
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      let cell: AdapterCell;

      // Status changes use changeCellStatus, other fields use updateCell
      if (validated.status) {
        cell = await adapter.changeCellStatus(
          projectKey,
          validated.id,
          validated.status,
        );
      }

      // Update other fields if provided
      if (validated.description !== undefined || validated.priority !== undefined) {
        cell = await adapter.updateCell(projectKey, validated.id, {
          description: validated.description,
          priority: validated.priority,
        });
      } else if (!validated.status) {
        // No changes requested
        const existingCell = await adapter.getCell(projectKey, validated.id);
        if (!existingCell) {
          throw new HiveError(
            `Cell not found: ${validated.id}`,
            "hive_update",
          );
        }
        cell = existingCell;
      }

      await adapter.markDirty(projectKey, validated.id);

      const formatted = formatCellForOutput(cell!);
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to update cell: ${message}`,
        "hive_update",
      );
    }
  },
});

/**
 * Close a cell with reason
 */
export const hive_close = tool({
  description: "Close a cell with reason",
  args: {
    id: tool.schema.string().describe("Cell ID"),
    reason: tool.schema.string().describe("Completion reason"),
  },
  async execute(args, ctx) {
    const validated = CellCloseArgsSchema.parse(args);
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      const cell = await adapter.closeCell(
        projectKey,
        validated.id,
        validated.reason,
      );

      await adapter.markDirty(projectKey, validated.id);

      return `Closed ${cell.id}: ${validated.reason}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to close cell: ${message}`,
        "hive_close",
      );
    }
  },
});

/**
 * Mark a cell as in-progress
 */
export const hive_start = tool({
  description:
    "Mark a cell as in-progress (shortcut for update --status in_progress)",
  args: {
    id: tool.schema.string().describe("Cell ID"),
  },
  async execute(args, ctx) {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      const cell = await adapter.changeCellStatus(
        projectKey,
        args.id,
        "in_progress",
      );

      await adapter.markDirty(projectKey, args.id);

      return `Started: ${cell.id}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to start cell: ${message}`,
        "hive_start",
      );
    }
  },
});

/**
 * Get the next ready cell
 */
export const hive_ready = tool({
  description: "Get the next ready cell (unblocked, highest priority)",
  args: {},
  async execute(args, ctx) {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      const cell = await adapter.getNextReadyCell(projectKey);

      if (!cell) {
        return "No ready cells";
      }

      const formatted = formatCellForOutput(cell);
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to get ready cells: ${message}`,
        "hive_ready",
      );
    }
  },
});

/**
 * Sync hive to git and push
 */
export const hive_sync = tool({
  description: "Sync hive to git and push (MANDATORY at session end)",
  args: {
    auto_pull: tool.schema
      .boolean()
      .optional()
      .describe("Pull before sync (default: true)"),
  },
  async execute(args, ctx) {
    const autoPull = args.auto_pull ?? true;
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);
    const TIMEOUT_MS = 30000; // 30 seconds

    /**
     * Helper to run a command with timeout
     */
    const withTimeout = async <T>(
      promise: Promise<T>,
      timeoutMs: number,
      operation: string,
    ): Promise<T> => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new HiveError(
                `Operation timed out after ${timeoutMs}ms`,
                operation,
              ),
            ),
          timeoutMs,
        );
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    };

    // 1. Flush cells to JSONL using FlushManager
    const flushManager = new FlushManager({
      adapter,
      projectKey,
      outputPath: `${projectKey}/.hive/issues.jsonl`,
    });

    const flushResult = await withTimeout(
      flushManager.flush(),
      TIMEOUT_MS,
      "flush hive",
    );

    if (flushResult.cellsExported === 0) {
      return "No cells to sync";
    }

    // 2. Check if there are changes to commit
    const hiveStatusResult = await runGitCommand([
      "status",
      "--porcelain",
      ".hive/",
    ]);
    const hasChanges = hiveStatusResult.stdout.trim() !== "";

    if (hasChanges) {
      // 3. Stage .hive changes
      const addResult = await runGitCommand(["add", ".hive/"]);
      if (addResult.exitCode !== 0) {
        throw new HiveError(
          `Failed to stage hive: ${addResult.stderr}`,
          "git add .hive/",
          addResult.exitCode,
        );
      }

      // 4. Commit
      const commitResult = await withTimeout(
        runGitCommand(["commit", "-m", "chore: sync hive"]),
        TIMEOUT_MS,
        "git commit",
      );
      if (
        commitResult.exitCode !== 0 &&
        !commitResult.stdout.includes("nothing to commit")
      ) {
        throw new HiveError(
          `Failed to commit hive: ${commitResult.stderr}`,
          "git commit",
          commitResult.exitCode,
        );
      }
    }

    // 5. Pull if requested
    if (autoPull) {
      const pullResult = await withTimeout(
        runGitCommand(["pull", "--rebase"]),
        TIMEOUT_MS,
        "git pull --rebase",
      );

      if (pullResult.exitCode !== 0) {
        throw new HiveError(
          `Failed to pull: ${pullResult.stderr}`,
          "git pull --rebase",
          pullResult.exitCode,
        );
      }
    }

    // 6. Push
    const pushResult = await withTimeout(
      runGitCommand(["push"]),
      TIMEOUT_MS,
      "git push",
    );
    if (pushResult.exitCode !== 0) {
      throw new HiveError(
        `Failed to push: ${pushResult.stderr}`,
        "git push",
        pushResult.exitCode,
      );
    }

    return "Hive synced and pushed successfully";
  },
});

/**
 * Link a cell to an Agent Mail thread
 */
export const hive_link_thread = tool({
  description: "Add metadata linking cell to Agent Mail thread",
  args: {
    cell_id: tool.schema.string().describe("Cell ID"),
    thread_id: tool.schema.string().describe("Agent Mail thread ID"),
  },
  async execute(args, ctx) {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      const cell = await adapter.getCell(projectKey, args.cell_id);

      if (!cell) {
        throw new HiveError(
          `Cell not found: ${args.cell_id}`,
          "hive_link_thread",
        );
      }

      const existingDesc = cell.description || "";
      const threadMarker = `[thread:${args.thread_id}]`;

      if (existingDesc.includes(threadMarker)) {
        return `Cell ${args.cell_id} already linked to thread ${args.thread_id}`;
      }

      const newDesc = existingDesc
        ? `${existingDesc}\n\n${threadMarker}`
        : threadMarker;

      await adapter.updateCell(projectKey, args.cell_id, {
        description: newDesc,
      });

      await adapter.markDirty(projectKey, args.cell_id);

      return `Linked cell ${args.cell_id} to thread ${args.thread_id}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to link thread: ${message}`,
        "hive_link_thread",
      );
    }
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const hiveTools = {
  hive_create,
  hive_create_epic,
  hive_query,
  hive_update,
  hive_close,
  hive_start,
  hive_ready,
  hive_sync,
  hive_link_thread,
};

// Legacy aliases for backward compatibility
export const beads_create = hive_create;
export const beads_create_epic = hive_create_epic;
export const beads_query = hive_query;
export const beads_update = hive_update;
export const beads_close = hive_close;
export const beads_start = hive_start;
export const beads_ready = hive_ready;
export const beads_sync = hive_sync;
export const beads_link_thread = hive_link_thread;

export const beadsTools = {
  beads_create: hive_create,
  beads_create_epic: hive_create_epic,
  beads_query: hive_query,
  beads_update: hive_update,
  beads_close: hive_close,
  beads_start: hive_start,
  beads_ready: hive_ready,
  beads_sync: hive_sync,
  beads_link_thread: hive_link_thread,
};
