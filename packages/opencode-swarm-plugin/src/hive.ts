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
  importFromJSONL,
  type HiveAdapter,
  type Cell as AdapterCell,
  getSwarmMail,
} from "swarm-mail";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
// Directory Migration (.beads → .hive)
// ============================================================================

/**
 * Result of checking if .beads → .hive migration is needed
 */
export interface MigrationCheckResult {
  /** Whether migration is needed */
  needed: boolean;
  /** Path to .beads directory if it exists */
  beadsPath?: string;
}

/**
 * Result of migrating .beads → .hive
 */
export interface MigrationResult {
  /** Whether migration was performed */
  migrated: boolean;
  /** Reason if migration was skipped */
  reason?: string;
}

/**
 * Check if .beads → .hive migration is needed
 * 
 * Migration is needed when:
 * - .beads directory exists
 * - .hive directory does NOT exist
 * 
 * @param projectPath - Absolute path to the project root
 * @returns MigrationCheckResult indicating if migration is needed
 */
export function checkBeadsMigrationNeeded(projectPath: string): MigrationCheckResult {
  const beadsDir = join(projectPath, ".beads");
  const hiveDir = join(projectPath, ".hive");
  
  // If .hive already exists, no migration needed
  if (existsSync(hiveDir)) {
    return { needed: false };
  }
  
  // If .beads exists but .hive doesn't, migration is needed
  if (existsSync(beadsDir)) {
    return { needed: true, beadsPath: beadsDir };
  }
  
  // Neither exists - no migration needed
  return { needed: false };
}

/**
 * Migrate .beads directory to .hive
 * 
 * This function renames .beads to .hive. It should only be called
 * after user confirmation via CLI prompt.
 * 
 * @param projectPath - Absolute path to the project root
 * @returns MigrationResult indicating success or skip reason
 */
export async function migrateBeadsToHive(projectPath: string): Promise<MigrationResult> {
  const beadsDir = join(projectPath, ".beads");
  const hiveDir = join(projectPath, ".hive");
  
  // Check if .hive already exists - skip migration
  if (existsSync(hiveDir)) {
    return { 
      migrated: false, 
      reason: ".hive directory already exists - skipping migration to avoid data loss" 
    };
  }
  
  // Check if .beads exists
  if (!existsSync(beadsDir)) {
    return { 
      migrated: false, 
      reason: ".beads directory not found - nothing to migrate" 
    };
  }
  
  // Perform the rename
  const { renameSync } = await import("node:fs");
  renameSync(beadsDir, hiveDir);
  
  return { migrated: true };
}

/**
 * Ensure .hive directory exists
 * 
 * Creates .hive directory if it doesn't exist. This is idempotent
 * and safe to call multiple times.
 * 
 * @param projectPath - Absolute path to the project root
 */
export function ensureHiveDirectory(projectPath: string): void {
  const hiveDir = join(projectPath, ".hive");
  
  if (!existsSync(hiveDir)) {
    const { mkdirSync } = require("node:fs");
    mkdirSync(hiveDir, { recursive: true });
  }
}

/**
 * Merge historic beads from beads.base.jsonl into issues.jsonl
 * 
 * This function reads beads.base.jsonl (historic data) and issues.jsonl (current data),
 * merges them by ID (issues.jsonl version wins for duplicates), and writes the result
 * back to issues.jsonl.
 * 
 * Use case: After migrating from .beads to .hive, you may have a beads.base.jsonl file
 * containing old beads that should be merged into the current issues.jsonl.
 * 
 * @param projectPath - Absolute path to the project root
 * @returns Object with merged and skipped counts
 */
export async function mergeHistoricBeads(projectPath: string): Promise<{merged: number, skipped: number}> {
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const hiveDir = join(projectPath, ".hive");
  const basePath = join(hiveDir, "beads.base.jsonl");
  const issuesPath = join(hiveDir, "issues.jsonl");
  
  // If base file doesn't exist, nothing to merge
  if (!existsSync(basePath)) {
    return { merged: 0, skipped: 0 };
  }
  
  // Read base file
  const baseContent = readFileSync(basePath, "utf-8");
  const baseLines = baseContent.trim().split("\n").filter(l => l);
  const baseBeads = baseLines.map(line => JSON.parse(line));
  
  // Read issues file (or create empty if missing)
  let issuesBeads: any[] = [];
  if (existsSync(issuesPath)) {
    const issuesContent = readFileSync(issuesPath, "utf-8");
    const issuesLines = issuesContent.trim().split("\n").filter(l => l);
    issuesBeads = issuesLines.map(line => JSON.parse(line));
  }
  
  // Build set of existing IDs in issues.jsonl
  const existingIds = new Set(issuesBeads.map(b => b.id));
  
  // Merge: add beads from base that aren't in issues
  let merged = 0;
  let skipped = 0;
  
  for (const baseBead of baseBeads) {
    if (existingIds.has(baseBead.id)) {
      skipped++;
    } else {
      issuesBeads.push(baseBead);
      merged++;
    }
  }
  
  // Write merged result back to issues.jsonl
  const mergedContent = issuesBeads.map(b => JSON.stringify(b)).join("\n") + "\n";
  writeFileSync(issuesPath, mergedContent, "utf-8");
  
  return { merged, skipped };
}

/**
 * Import cells from .hive/issues.jsonl into PGLite database
 * 
 * Reads the JSONL file and upserts each record into the cells table
 * using the HiveAdapter. Provides granular error reporting for invalid lines.
 * 
 * This function manually parses JSONL line-by-line to gracefully handle
 * invalid JSON without throwing. Each valid line is imported via the adapter.
 * 
 * @param projectPath - Absolute path to the project root
 * @returns Object with imported, updated, and error counts
 */
export async function importJsonlToPGLite(projectPath: string): Promise<{
  imported: number;
  updated: number;
  errors: number;
}> {
  const jsonlPath = join(projectPath, ".hive", "issues.jsonl");
  
  // Handle missing file gracefully
  if (!existsSync(jsonlPath)) {
    return { imported: 0, updated: 0, errors: 0 };
  }
  
  // Read JSONL content
  const jsonlContent = readFileSync(jsonlPath, "utf-8");
  
  // Handle empty file
  if (!jsonlContent || jsonlContent.trim() === "") {
    return { imported: 0, updated: 0, errors: 0 };
  }
  
  // Get adapter - but we need to prevent auto-migration from running
  // Auto-migration only runs if DB is empty, so we check first
  const adapter = await getHiveAdapter(projectPath);
  
  // Parse JSONL line-by-line, tolerating invalid JSON
  const lines = jsonlContent.split("\n").filter(l => l.trim());
  let imported = 0;
  let updated = 0;
  let errors = 0;
  
  for (const line of lines) {
    try {
      const cellData = JSON.parse(line);
      
      // Check if cell exists
      const existing = await adapter.getCell(projectPath, cellData.id);
      
      if (existing) {
        // Update existing cell
        try {
          await adapter.updateCell(projectPath, cellData.id, {
            title: cellData.title,
            description: cellData.description,
            priority: cellData.priority,
            assignee: cellData.assignee,
          });
          
          // Update status if needed - use closeCell for 'closed' status
          if (existing.status !== cellData.status) {
            if (cellData.status === "closed") {
              await adapter.closeCell(projectPath, cellData.id, "Imported from JSONL");
            } else {
              await adapter.changeCellStatus(projectPath, cellData.id, cellData.status);
            }
          }
          
          updated++;
        } catch (updateError) {
          // Update failed - count as error
          errors++;
        }
      } else {
        // Create new cell - use direct DB insert to preserve ID
        const db = await adapter.getDatabase();
        
        const status = cellData.status === "tombstone" ? "closed" : cellData.status;
        const isClosed = status === "closed";
        const closedAt = isClosed
          ? (cellData.closed_at 
              ? new Date(cellData.closed_at).getTime() 
              : new Date(cellData.updated_at).getTime())
          : null;
        
        await db.query(
          `INSERT INTO cells (
            id, project_key, type, status, title, description, priority,
            parent_id, assignee, created_at, updated_at, closed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            cellData.id,
            projectPath,
            cellData.issue_type,
            status,
            cellData.title,
            cellData.description || null,
            cellData.priority,
            cellData.parent_id || null,
            cellData.assignee || null,
            new Date(cellData.created_at).getTime(),
            new Date(cellData.updated_at).getTime(),
            closedAt,
          ]
        );
        
        imported++;
      }
    } catch (error) {
      // Invalid JSON or import error - count and continue
      errors++;
    }
  }
  
  return { imported, updated, errors };
}

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
 * 
 * On first initialization, checks for .beads/issues.jsonl and imports
 * historical beads if the database is empty.
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

  // Auto-migrate from JSONL if database is empty and file exists
  await autoMigrateFromJSONL(adapter, projectKey);

  adapterCache.set(projectKey, adapter);
  return adapter;
}

// Legacy alias for backward compatibility
export const getBeadsAdapter = getHiveAdapter;

/**
 * Auto-migrate cells from .hive/issues.jsonl if:
 * 1. The JSONL file exists
 * 2. The database has no cells for this project
 * 
 * This enables seamless migration from the old bd CLI to the new PGLite-based system.
 */
async function autoMigrateFromJSONL(adapter: HiveAdapter, projectKey: string): Promise<void> {
  const jsonlPath = join(projectKey, ".hive", "issues.jsonl");
  
  // Check if JSONL file exists
  if (!existsSync(jsonlPath)) {
    return;
  }

  // Check if database already has cells
  const existingCells = await adapter.queryCells(projectKey, { limit: 1 });
  if (existingCells.length > 0) {
    return; // Already have cells, skip migration
  }

  // Read and import JSONL
  try {
    const jsonlContent = readFileSync(jsonlPath, "utf-8");
    const result = await importFromJSONL(adapter, projectKey, jsonlContent, {
      skipExisting: true, // Safety: don't overwrite if somehow cells exist
    });

    if (result.created > 0 || result.updated > 0) {
      console.log(
        `[hive] Auto-migrated ${result.created} cells from ${jsonlPath} (${result.skipped} skipped, ${result.errors.length} errors)`
      );
    }

    if (result.errors.length > 0) {
      console.warn(
        `[hive] Migration errors:`,
        result.errors.slice(0, 5).map((e) => `${e.cellId}: ${e.error}`)
      );
    }
  } catch (error) {
    // Non-fatal - log and continue
    console.warn(
      `[hive] Failed to auto-migrate from ${jsonlPath}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

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

    // 1. Ensure .hive directory exists before writing
    ensureHiveDirectory(projectKey);

    // 2. Flush cells to JSONL using FlushManager
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

    // 3. Check if there are changes to commit
    const hiveStatusResult = await runGitCommand([
      "status",
      "--porcelain",
      ".hive/",
    ]);
    const hasChanges = hiveStatusResult.stdout.trim() !== "";

    if (hasChanges) {
      // 4. Stage .hive changes
      const addResult = await runGitCommand(["add", ".hive/"]);
      if (addResult.exitCode !== 0) {
        throw new HiveError(
          `Failed to stage hive: ${addResult.stderr}`,
          "git add .hive/",
          addResult.exitCode,
        );
      }

      // 5. Commit
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

    // 6. Pull if requested (check if remote exists first)
    if (autoPull) {
      const remoteCheckResult = await runGitCommand(["remote"]);
      const hasRemote = remoteCheckResult.stdout.trim() !== "";

      if (hasRemote) {
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
    }

    // 7. Push (check if remote exists first)
    const remoteCheckResult = await runGitCommand(["remote"]);
    const hasRemote = remoteCheckResult.stdout.trim() !== "";

    if (hasRemote) {
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
    } else {
      return "Hive synced successfully (no remote configured)";
    }
  },
});

/**
 * Link a cell to an Agent Mail thread
 */
export const hive_link_thread = tool({
  description: "Add metadata linking cell to Agent Mail thread",
  args: {
    bead_id: tool.schema.string().describe("Cell ID"),
    thread_id: tool.schema.string().describe("Agent Mail thread ID"),
  },
  async execute(args, ctx) {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      const cell = await adapter.getCell(projectKey, args.bead_id);

      if (!cell) {
        throw new HiveError(
          `Cell not found: ${args.bead_id}`,
          "hive_link_thread",
        );
      }

      const existingDesc = cell.description || "";
      const threadMarker = `[thread:${args.thread_id}]`;

      if (existingDesc.includes(threadMarker)) {
        return `Cell ${args.bead_id} already linked to thread ${args.thread_id}`;
      }

      const newDesc = existingDesc
        ? `${existingDesc}\n\n${threadMarker}`
        : threadMarker;

      await adapter.updateCell(projectKey, args.bead_id, {
        description: newDesc,
      });

      await adapter.markDirty(projectKey, args.bead_id);

      return `Linked cell ${args.bead_id} to thread ${args.thread_id}`;
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

// ============================================================================
// Deprecation Warning System
// ============================================================================

/**
 * Track which deprecated tools have been warned about.
 * Only warn once per tool name to avoid spam.
 */
const warnedTools = new Set<string>();

/**
 * Log a deprecation warning for a renamed tool.
 * Only warns once per tool name per session.
 * 
 * @param oldName - The deprecated tool name (e.g., "hive_create")
 * @param newName - The new tool name to use instead (e.g., "hive_create")
 */
function warnDeprecated(oldName: string, newName: string): void {
  if (warnedTools.has(oldName)) {
    return; // Already warned
  }
  
  warnedTools.add(oldName);
  console.warn(
    `[DEPRECATED] ${oldName} is deprecated, use ${newName} instead. Will be removed in v1.0`
  );
}

// ============================================================================
// Legacy Aliases (DEPRECATED - use hive_* instead)
// ============================================================================

/**
 * @deprecated Use hive_create instead. Will be removed in v1.0
 */
export const beads_create = tool({
  ...hive_create,
  async execute(args, ctx) {
    warnDeprecated('beads_create', 'hive_create');
    return hive_create.execute(args, ctx);
  }
});

/**
 * @deprecated Use hive_create_epic instead. Will be removed in v1.0
 */
export const beads_create_epic = tool({
  ...hive_create_epic,
  async execute(args, ctx) {
    warnDeprecated('beads_create_epic', 'hive_create_epic');
    return hive_create_epic.execute(args, ctx);
  }
});

/**
 * @deprecated Use hive_query instead. Will be removed in v1.0
 */
export const beads_query = tool({
  ...hive_query,
  async execute(args, ctx) {
    warnDeprecated('beads_query', 'hive_query');
    return hive_query.execute(args, ctx);
  }
});

/**
 * @deprecated Use hive_update instead. Will be removed in v1.0
 */
export const beads_update = tool({
  ...hive_update,
  async execute(args, ctx) {
    warnDeprecated('beads_update', 'hive_update');
    return hive_update.execute(args, ctx);
  }
});

/**
 * @deprecated Use hive_close instead. Will be removed in v1.0
 */
export const beads_close = tool({
  ...hive_close,
  async execute(args, ctx) {
    warnDeprecated('beads_close', 'hive_close');
    return hive_close.execute(args, ctx);
  }
});

/**
 * @deprecated Use hive_start instead. Will be removed in v1.0
 */
export const beads_start = tool({
  ...hive_start,
  async execute(args, ctx) {
    warnDeprecated('beads_start', 'hive_start');
    return hive_start.execute(args, ctx);
  }
});

/**
 * @deprecated Use hive_ready instead. Will be removed in v1.0
 */
export const beads_ready = tool({
  ...hive_ready,
  async execute(args, ctx) {
    warnDeprecated('beads_ready', 'hive_ready');
    return hive_ready.execute(args, ctx);
  }
});

/**
 * @deprecated Use hive_sync instead. Will be removed in v1.0
 */
export const beads_sync = tool({
  ...hive_sync,
  async execute(args, ctx) {
    warnDeprecated('beads_sync', 'hive_sync');
    return hive_sync.execute(args, ctx);
  }
});

/**
 * @deprecated Use hive_link_thread instead. Will be removed in v1.0
 */
export const beads_link_thread = tool({
  ...hive_link_thread,
  async execute(args, ctx) {
    warnDeprecated('beads_link_thread', 'hive_link_thread');
    return hive_link_thread.execute(args, ctx);
  }
});

/**
 * @deprecated Use hiveTools instead. Will be removed in v1.0
 */
export const beadsTools = {
  beads_create,
  beads_create_epic,
  beads_query,
  beads_update,
  beads_close,
  beads_start,
  beads_ready,
  beads_sync,
  beads_link_thread,
};
