/**
 * Beads Module - Type-safe wrappers using BeadsAdapter
 *
 * This module provides validated, type-safe operations for the beads
 * issue tracker using the BeadsAdapter from swarm-mail.
 *
 * Key principles:
 * - Use BeadsAdapter for all operations (no CLI commands)
 * - Validate all inputs with Zod schemas
 * - Throw typed errors on failure
 * - Support atomic epic creation with rollback
 *
 * IMPORTANT: Call setBeadsWorkingDirectory() before using tools to ensure
 * operations run in the correct project directory.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  createBeadsAdapter,
  FlushManager,
  importFromJSONL,
  type BeadsAdapter,
  type Bead as AdapterBead,
  getSwarmMail,
} from "swarm-mail";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Working Directory Configuration
// ============================================================================

/**
 * Module-level working directory for beads commands.
 * Set this via setBeadsWorkingDirectory() before using tools.
 * If not set, commands run in process.cwd() which may be wrong for plugins.
 */
let beadsWorkingDirectory: string | null = null;

/**
 * Set the working directory for all beads commands.
 * Call this from the plugin initialization with the project directory.
 *
 * @param directory - Absolute path to the project directory
 */
export function setBeadsWorkingDirectory(directory: string): void {
  beadsWorkingDirectory = directory;
}

/**
 * Get the current working directory for beads commands.
 * Returns the configured directory or process.cwd() as fallback.
 */
export function getBeadsWorkingDirectory(): string {
  return beadsWorkingDirectory || process.cwd();
}

/**
 * Run a git command in the correct working directory.
 */
async function runGitCommand(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cwd = getBeadsWorkingDirectory();
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
  BeadSchema,
  BeadCreateArgsSchema,
  BeadUpdateArgsSchema,
  BeadCloseArgsSchema,
  BeadQueryArgsSchema,
  EpicCreateArgsSchema,
  EpicCreateResultSchema,
  type Bead,
  type BeadCreateArgs,
  type EpicCreateResult,
} from "./schemas";
import { createEvent, appendEvent } from "swarm-mail";

/**
 * Custom error for bead operations
 */
export class BeadError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "BeadError";
  }
}

/**
 * Custom error for validation failures
 */
export class BeadValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: z.ZodError,
  ) {
    super(message);
    this.name = "BeadValidationError";
  }
}

// ============================================================================
// Adapter Singleton
// ============================================================================

/**
 * Lazy singleton for BeadsAdapter instances
 * Maps projectKey -> BeadsAdapter
 */
const adapterCache = new Map<string, BeadsAdapter>();

/**
 * Get or create a BeadsAdapter instance for a project
 * Exported for testing - allows tests to verify state directly
 * 
 * On first initialization, checks for .beads/issues.jsonl and imports
 * historical beads if the database is empty.
 */
export async function getBeadsAdapter(projectKey: string): Promise<BeadsAdapter> {
  if (adapterCache.has(projectKey)) {
    return adapterCache.get(projectKey)!;
  }

  const swarmMail = await getSwarmMail(projectKey);
  const db = await swarmMail.getDatabase();
  const adapter = createBeadsAdapter(db, projectKey);

  // Run migrations to ensure schema exists
  await adapter.runMigrations();

  // Auto-migrate from JSONL if database is empty and file exists
  await autoMigrateFromJSONL(adapter, projectKey);

  adapterCache.set(projectKey, adapter);
  return adapter;
}

/**
 * Auto-migrate beads from .beads/issues.jsonl if:
 * 1. The JSONL file exists
 * 2. The database has no beads for this project
 * 
 * This enables seamless migration from the old bd CLI to the new PGLite-based system.
 */
async function autoMigrateFromJSONL(adapter: BeadsAdapter, projectKey: string): Promise<void> {
  const jsonlPath = join(projectKey, ".beads", "issues.jsonl");
  
  // Check if JSONL file exists
  if (!existsSync(jsonlPath)) {
    return;
  }

  // Check if database already has beads
  const existingBeads = await adapter.queryBeads(projectKey, { limit: 1 });
  if (existingBeads.length > 0) {
    return; // Already have beads, skip migration
  }

  // Read and import JSONL
  try {
    const jsonlContent = readFileSync(jsonlPath, "utf-8");
    const result = await importFromJSONL(adapter, projectKey, jsonlContent, {
      skipExisting: true, // Safety: don't overwrite if somehow beads exist
    });

    if (result.created > 0 || result.updated > 0) {
      console.log(
        `[beads] Auto-migrated ${result.created} beads from ${jsonlPath} (${result.skipped} skipped, ${result.errors.length} errors)`
      );
    }

    if (result.errors.length > 0) {
      console.warn(
        `[beads] Migration errors:`,
        result.errors.slice(0, 5).map((e) => `${e.beadId}: ${e.error}`)
      );
    }
  } catch (error) {
    // Non-fatal - log and continue
    console.warn(
      `[beads] Failed to auto-migrate from ${jsonlPath}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Format adapter bead for output (map field names)
 * Adapter uses: type, created_at/updated_at (timestamps)
 * Schema expects: issue_type, created_at/updated_at (ISO strings)
 */
function formatBeadForOutput(adapterBead: AdapterBead): Record<string, unknown> {
  return {
    id: adapterBead.id,
    title: adapterBead.title,
    description: adapterBead.description || "",
    status: adapterBead.status,
    priority: adapterBead.priority,
    issue_type: adapterBead.type, // Adapter: type → Schema: issue_type
    created_at: new Date(adapterBead.created_at).toISOString(),
    updated_at: new Date(adapterBead.updated_at).toISOString(),
    closed_at: adapterBead.closed_at
      ? new Date(adapterBead.closed_at).toISOString()
      : undefined,
    parent_id: adapterBead.parent_id || undefined,
    dependencies: [], // TODO: fetch from adapter if needed
    metadata: {},
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create a new bead with type-safe validation
 */
export const beads_create = tool({
  description: "Create a new bead with type-safe validation",
  args: {
    title: tool.schema.string().describe("Bead title"),
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
    description: tool.schema.string().optional().describe("Bead description"),
    parent_id: tool.schema
      .string()
      .optional()
      .describe("Parent bead ID for epic children"),
  },
  async execute(args, ctx) {
    const validated = BeadCreateArgsSchema.parse(args);
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);

    try {
      const bead = await adapter.createBead(projectKey, {
        title: validated.title,
        type: validated.type || "task",
        priority: validated.priority ?? 2,
        description: validated.description,
        parent_id: validated.parent_id,
      });

      // Mark dirty for export
      await adapter.markDirty(projectKey, bead.id);

      const formatted = formatBeadForOutput(bead);
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BeadError(
        `Failed to create bead: ${message}`,
        "beads_create",
      );
    }
  },
});

/**
 * Create an epic with subtasks in one atomic operation
 */
export const beads_create_epic = tool({
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
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);
    const created: AdapterBead[] = [];

    try {
      // 1. Create epic
      const epic = await adapter.createBead(projectKey, {
        title: validated.epic_title,
        type: "epic",
        priority: 1,
        description: validated.epic_description,
      });
      await adapter.markDirty(projectKey, epic.id);
      created.push(epic);

      // 2. Create subtasks
      for (const subtask of validated.subtasks) {
        const subtaskBead = await adapter.createBead(projectKey, {
          title: subtask.title,
          type: "task",
          priority: subtask.priority ?? 2,
          parent_id: epic.id,
        });
        await adapter.markDirty(projectKey, subtaskBead.id);
        created.push(subtaskBead);
      }

      const result: EpicCreateResult = {
        success: true,
        epic: formatBeadForOutput(epic) as Bead,
        subtasks: created.slice(1).map((b) => formatBeadForOutput(b) as Bead),
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
            "[beads_create_epic] Failed to emit DecompositionGeneratedEvent:",
            error,
          );
        }
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      // Partial failure - rollback via deleteBead
      const rollbackErrors: string[] = [];

      for (const bead of created) {
        try {
          await adapter.deleteBead(projectKey, bead.id, {
            reason: "Rollback partial epic",
          });
        } catch (rollbackError) {
          const errMsg =
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          console.error(`Failed to rollback bead ${bead.id}:`, rollbackError);
          rollbackErrors.push(`${bead.id}: ${errMsg}`);
        }
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      let rollbackInfo = `\n\nRolled back ${created.length - rollbackErrors.length} bead(s)`;

      if (rollbackErrors.length > 0) {
        rollbackInfo += `\n\nRollback failures (${rollbackErrors.length}):\n${rollbackErrors.join("\n")}`;
      }

      throw new BeadError(
        `Epic creation failed: ${errorMsg}${rollbackInfo}`,
        "beads_create_epic",
        1,
      );
    }
  },
});

/**
 * Query beads with filters
 */
export const beads_query = tool({
  description: "Query beads with filters (replaces bd list, bd ready, bd wip)",
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
      .describe("Only show unblocked beads (uses bd ready)"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max results to return (default: 20)"),
  },
  async execute(args, ctx) {
    const validated = BeadQueryArgsSchema.parse(args);
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);

    try {
      let beads: AdapterBead[];

      if (validated.ready) {
        const readyBead = await adapter.getNextReadyBead(projectKey);
        beads = readyBead ? [readyBead] : [];
      } else {
        beads = await adapter.queryBeads(projectKey, {
          status: validated.status,
          type: validated.type,
          limit: validated.limit || 20,
        });
      }

      const formatted = beads.map((b) => formatBeadForOutput(b));
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BeadError(
        `Failed to query beads: ${message}`,
        "beads_query",
      );
    }
  },
});

/**
 * Update a bead's status or description
 */
export const beads_update = tool({
  description: "Update bead status/description",
  args: {
    id: tool.schema.string().describe("Bead ID"),
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
    const validated = BeadUpdateArgsSchema.parse(args);
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);

    try {
      let bead: AdapterBead;

      // Status changes use changeBeadStatus, other fields use updateBead
      if (validated.status) {
        bead = await adapter.changeBeadStatus(
          projectKey,
          validated.id,
          validated.status,
        );
      }

      // Update other fields if provided
      if (validated.description !== undefined || validated.priority !== undefined) {
        bead = await adapter.updateBead(projectKey, validated.id, {
          description: validated.description,
          priority: validated.priority,
        });
      } else if (!validated.status) {
        // No changes requested
        const existingBead = await adapter.getBead(projectKey, validated.id);
        if (!existingBead) {
          throw new BeadError(
            `Bead not found: ${validated.id}`,
            "beads_update",
          );
        }
        bead = existingBead;
      }

      await adapter.markDirty(projectKey, validated.id);

      const formatted = formatBeadForOutput(bead!);
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BeadError(
        `Failed to update bead: ${message}`,
        "beads_update",
      );
    }
  },
});

/**
 * Close a bead with reason
 */
export const beads_close = tool({
  description: "Close a bead with reason",
  args: {
    id: tool.schema.string().describe("Bead ID"),
    reason: tool.schema.string().describe("Completion reason"),
  },
  async execute(args, ctx) {
    const validated = BeadCloseArgsSchema.parse(args);
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);

    try {
      const bead = await adapter.closeBead(
        projectKey,
        validated.id,
        validated.reason,
      );

      await adapter.markDirty(projectKey, validated.id);

      return `Closed ${bead.id}: ${validated.reason}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BeadError(
        `Failed to close bead: ${message}`,
        "beads_close",
      );
    }
  },
});

/**
 * Mark a bead as in-progress
 */
export const beads_start = tool({
  description:
    "Mark a bead as in-progress (shortcut for update --status in_progress)",
  args: {
    id: tool.schema.string().describe("Bead ID"),
  },
  async execute(args, ctx) {
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);

    try {
      const bead = await adapter.changeBeadStatus(
        projectKey,
        args.id,
        "in_progress",
      );

      await adapter.markDirty(projectKey, args.id);

      return `Started: ${bead.id}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BeadError(
        `Failed to start bead: ${message}`,
        "beads_start",
      );
    }
  },
});

/**
 * Get the next ready bead
 */
export const beads_ready = tool({
  description: "Get the next ready bead (unblocked, highest priority)",
  args: {},
  async execute(args, ctx) {
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);

    try {
      const bead = await adapter.getNextReadyBead(projectKey);

      if (!bead) {
        return "No ready beads";
      }

      const formatted = formatBeadForOutput(bead);
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BeadError(
        `Failed to get ready beads: ${message}`,
        "beads_ready",
      );
    }
  },
});

/**
 * Sync beads to git and push
 */
export const beads_sync = tool({
  description: "Sync beads to git and push (MANDATORY at session end)",
  args: {
    auto_pull: tool.schema
      .boolean()
      .optional()
      .describe("Pull before sync (default: true)"),
  },
  async execute(args, ctx) {
    const autoPull = args.auto_pull ?? true;
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);
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
              new BeadError(
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

    // 1. Flush beads to JSONL using FlushManager
    const flushManager = new FlushManager({
      adapter,
      projectKey,
      outputPath: `${projectKey}/.beads/issues.jsonl`,
    });

    const flushResult = await withTimeout(
      flushManager.flush(),
      TIMEOUT_MS,
      "flush beads",
    );

    if (flushResult.beadsExported === 0) {
      return "No beads to sync";
    }

    // 2. Check if there are changes to commit
    const beadsStatusResult = await runGitCommand([
      "status",
      "--porcelain",
      ".beads/",
    ]);
    const hasChanges = beadsStatusResult.stdout.trim() !== "";

    if (hasChanges) {
      // 3. Stage .beads changes
      const addResult = await runGitCommand(["add", ".beads/"]);
      if (addResult.exitCode !== 0) {
        throw new BeadError(
          `Failed to stage beads: ${addResult.stderr}`,
          "git add .beads/",
          addResult.exitCode,
        );
      }

      // 4. Commit
      const commitResult = await withTimeout(
        runGitCommand(["commit", "-m", "chore: sync beads"]),
        TIMEOUT_MS,
        "git commit",
      );
      if (
        commitResult.exitCode !== 0 &&
        !commitResult.stdout.includes("nothing to commit")
      ) {
        throw new BeadError(
          `Failed to commit beads: ${commitResult.stderr}`,
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
        throw new BeadError(
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
      throw new BeadError(
        `Failed to push: ${pushResult.stderr}`,
        "git push",
        pushResult.exitCode,
      );
    }

    return "Beads synced and pushed successfully";
  },
});

/**
 * Link a bead to an Agent Mail thread
 */
export const beads_link_thread = tool({
  description: "Add metadata linking bead to Agent Mail thread",
  args: {
    bead_id: tool.schema.string().describe("Bead ID"),
    thread_id: tool.schema.string().describe("Agent Mail thread ID"),
  },
  async execute(args, ctx) {
    const projectKey = getBeadsWorkingDirectory();
    const adapter = await getBeadsAdapter(projectKey);

    try {
      const bead = await adapter.getBead(projectKey, args.bead_id);

      if (!bead) {
        throw new BeadError(
          `Bead not found: ${args.bead_id}`,
          "beads_link_thread",
        );
      }

      const existingDesc = bead.description || "";
      const threadMarker = `[thread:${args.thread_id}]`;

      if (existingDesc.includes(threadMarker)) {
        return `Bead ${args.bead_id} already linked to thread ${args.thread_id}`;
      }

      const newDesc = existingDesc
        ? `${existingDesc}\n\n${threadMarker}`
        : threadMarker;

      await adapter.updateBead(projectKey, args.bead_id, {
        description: newDesc,
      });

      await adapter.markDirty(projectKey, args.bead_id);

      return `Linked bead ${args.bead_id} to thread ${args.thread_id}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BeadError(
        `Failed to link thread: ${message}`,
        "beads_link_thread",
      );
    }
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const beadsTools = {
  beads_create: beads_create,
  beads_create_epic: beads_create_epic,
  beads_query: beads_query,
  beads_update: beads_update,
  beads_close: beads_close,
  beads_start: beads_start,
  beads_ready: beads_ready,
  beads_sync: beads_sync,
  beads_link_thread: beads_link_thread,
};
