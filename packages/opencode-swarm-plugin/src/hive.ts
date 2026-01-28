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
  syncMemories,
  type HiveAdapter,
  type Cell as AdapterCell,
  getSwarmMailLibSQL,
  resolvePartialId,
  findCellsByPartialId,
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

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    return { exitCode, stdout, stderr };
  } finally {
    // Ensure process is killed if Promise.all or proc.exited fails
    proc.kill();
  }
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
import { safeEmitEvent } from "./utils/event-utils";

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
          `INSERT INTO beads (
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

// ============================================================================
// Process Exit Hook - Safety Net for Dirty Cells
// ============================================================================

/**
 * Track if exit hook is already registered (prevent duplicate registrations)
 */
let exitHookRegistered = false;

/**
 * Track if exit hook is currently running (prevent re-entry)
 */
let exitHookRunning = false;

/**
 * Register process.on('beforeExit') handler to flush dirty cells
 * This is a safety net - catches any dirty cells that weren't explicitly synced
 * 
 * Idempotent - safe to call multiple times (only registers once)
 */
function registerExitHook(): void {
  if (exitHookRegistered) {
    return; // Already registered
  }
  
  exitHookRegistered = true;
  
  process.on('beforeExit', async (code) => {
    // Prevent re-entry if already flushing
    if (exitHookRunning) {
      return;
    }
    
    exitHookRunning = true;
    
    try {
      // Flush all projects that have adapters (and potentially dirty cells)
      const flushPromises: Promise<void>[] = [];
      
      for (const [projectKey, adapter] of adapterCache.entries()) {
        const flushPromise = (async () => {
          try {
            ensureHiveDirectory(projectKey);
            const flushManager = new FlushManager({
              adapter,
              projectKey,
              outputPath: `${projectKey}/.hive/issues.jsonl`,
            });
            await flushManager.flush();
          } catch (error) {
            // Non-fatal - log and continue
            console.warn(
              `[hive exit hook] Failed to flush ${projectKey}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        })();
        
        flushPromises.push(flushPromise);
      }
      
      // Wait for all flushes to complete
      await Promise.all(flushPromises);
    } finally {
      exitHookRunning = false;
    }
  });
}

// Register exit hook immediately when module is imported
registerExitHook();

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

  const swarmMail = await getSwarmMailLibSQL(projectKey);
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
 * Clear the hive adapter cache
 * 
 * Used in tests to ensure clean state between test runs.
 * Clears all cached adapters without closing them (caller should close first).
 */
export function clearHiveAdapterCache(): void {
  adapterCache.clear();
}

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
      // Use stderr to avoid polluting JSON output on stdout
      console.error(
        `[hive] Auto-migrated ${result.created} cells from ${jsonlPath} (${result.skipped} skipped, ${result.errors.length} errors)`
      );
    }

    if (result.errors.length > 0) {
      console.error(
        `[hive] Migration errors:`,
        result.errors.slice(0, 5).map((e) => `${e.cellId}: ${e.error}`)
      );
    }
  } catch (error) {
    // Non-fatal - log and continue
    console.error(
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
    created_at: new Date(Number(adapterCell.created_at)).toISOString(),
    updated_at: new Date(Number(adapterCell.updated_at)).toISOString(),
    closed_at: adapterCell.closed_at
      ? new Date(Number(adapterCell.closed_at)).toISOString()
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

      // Emit cell_created event for observability
      await safeEmitEvent(
        "cell_created",
        {
          cell_id: cell.id,
          title: validated.title,
          description: validated.description,
          issue_type: validated.type || "task",
          priority: validated.priority ?? 2,
          parent_id: validated.parent_id,
        },
        "hive_create",
        projectKey,
      );

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
  description: "Create epic with subtasks atomically. REQUIRED: epic_title, subtasks (array with {title, files?}). Use after swarm_validate_decomposition confirms your decomposition is valid. Each subtask should list files it will modify to enable parallel work without conflicts.",
  args: {
    epic_title: tool.schema.string().describe("Epic title (e.g., 'Implement user auth')"),
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
    // Validate required parameters with helpful error messages
    const missing: string[] = [];
    if (!args.epic_title) missing.push("epic_title");
    if (!args.subtasks || args.subtasks.length === 0) missing.push("subtasks (array of subtask objects)");

    if (missing.length > 0) {
      return JSON.stringify({
        success: false,
        error: `Missing required parameters: ${missing.join(", ")}`,
        hint: "hive_create_epic creates an epic with subtasks atomically.",
        example: {
          epic_title: "Implement user authentication",
          epic_description: "Add login, logout, and session management",
          subtasks: [
            { title: "Create auth service", files: ["src/auth/service.ts"] },
            { title: "Add login endpoint", files: ["src/api/login.ts"] },
            { title: "Add session middleware", files: ["src/middleware/session.ts"] },
          ],
        },
        tip: "Each subtask should have a title and optionally files it will modify. This helps with file reservation and parallel execution.",
      }, null, 2);
    }

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

      // Emit epic_created event for observability
      const effectiveProjectKey = args.project_key || projectKey;
      await safeEmitEvent(
        "epic_created",
        {
          epic_id: epic.id,
          title: validated.epic_title,
          description: validated.epic_description,
          subtask_count: validated.subtasks.length,
          subtask_ids: created.slice(1).map(c => c.id),
        },
        "hive_create_epic",
        effectiveProjectKey,
      );

      // Emit DecompositionGeneratedEvent for learning system
      // Always emit using projectKey (from getHiveWorkingDirectory), not args.project_key
      // This fixes the bug where events weren't emitted when callers didn't pass project_key
      await safeEmitEvent(
        "decomposition_generated",
        {
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
        },
        "hive_create_epic",
        effectiveProjectKey,
      );

      // Emit SwarmStartedEvent for orchestration lifecycle tracking
      const totalFiles = validated.subtasks.reduce(
        (count, st) => count + (st.files?.length || 0),
        0,
      );
      await safeEmitEvent(
        "swarm_started",
        {
          epic_id: epic.id,
          epic_title: validated.epic_title,
          strategy: args.strategy || "feature-based",
          subtask_count: validated.subtasks.length,
          total_files: totalFiles,
          coordinator_agent: "coordinator", // Default coordinator name
        },
        "hive_create_epic",
        effectiveProjectKey,
      );

      // Capture decomposition_complete event for eval scoring
      try {
        const { captureCoordinatorEvent } = await import("./eval-capture.js");
        
        // Build files_per_subtask map (indexed by subtask index)
        const filesPerSubtask: Record<number, string[]> = {};
        validated.subtasks.forEach((subtask, index) => {
          if (subtask.files && subtask.files.length > 0) {
            filesPerSubtask[index] = subtask.files;
          }
        });

          captureCoordinatorEvent({
            session_id: ctx.sessionID || "unknown",
            epic_id: epic.id,
            timestamp: new Date().toISOString(),
            event_type: "DECISION",
            decision_type: "decomposition_complete",
            payload: {
              subtask_count: validated.subtasks.length,
              strategy_used: args.strategy || "feature-based",
              files_per_subtask: filesPerSubtask,
              epic_title: validated.epic_title,
              task: args.task,
            },
          });
      } catch (error) {
        // Non-fatal - log and continue
        console.warn(
          "[hive_create_epic] Failed to capture decomposition_complete event:",
          error,
        );
      }

      // Sync cells to JSONL so spawned workers can see them immediately
      try {
        ensureHiveDirectory(projectKey);
        const flushManager = new FlushManager({
          adapter,
          projectKey,
          outputPath: `${projectKey}/.hive/issues.jsonl`,
        });
        await flushManager.flush();
      } catch (error) {
        // Non-fatal - log and continue
        console.warn(
          "[hive_create_epic] Failed to sync to JSONL:",
          error,
        );
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
    parent_id: tool.schema
      .string()
      .optional()
      .describe("Filter by parent epic ID (returns children of an epic)"),
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
          parent_id: validated.parent_id,
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
    id: tool.schema.string().describe("Cell ID or partial hash"),
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
      // Resolve partial ID to full ID
      const cellId = await resolvePartialId(adapter, projectKey, validated.id) || validated.id;
      
      let cell: AdapterCell;

      // Status changes use changeCellStatus, other fields use updateCell
      if (validated.status) {
        cell = await adapter.changeCellStatus(
          projectKey,
          cellId,
          validated.status,
        );
      }

      // Update other fields if provided
      if (validated.description !== undefined || validated.priority !== undefined) {
        cell = await adapter.updateCell(projectKey, cellId, {
          description: validated.description,
          priority: validated.priority,
        });
      } else if (!validated.status) {
        // No changes requested
        const existingCell = await adapter.getCell(projectKey, cellId);
        if (!existingCell) {
          throw new HiveError(
            `Cell not found: ${validated.id}`,
            "hive_update",
          );
        }
        cell = existingCell;
      }

      await adapter.markDirty(projectKey, cellId);

      // Emit cell_updated event for observability
      const fieldsChanged: string[] = [];
      if (validated.status) fieldsChanged.push("status");
      if (validated.description !== undefined) fieldsChanged.push("description");
      if (validated.priority !== undefined) fieldsChanged.push("priority");

      await safeEmitEvent(
        "cell_updated",
        {
          cell_id: cellId,
          fields_changed: fieldsChanged,
        },
        "hive_update",
        projectKey,
      );

      const formatted = formatCellForOutput(cell!);
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      // Provide helpful error messages
      if (message.includes("Ambiguous hash")) {
        throw new HiveError(
          `Ambiguous ID '${validated.id}': multiple cells match. Please provide more characters.`,
          "hive_update",
        );
      }
      if (message.includes("Bead not found") || message.includes("Cell not found")) {
        throw new HiveError(
          `No cell found matching ID '${validated.id}'`,
          "hive_update",
        );
      }
      
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
    id: tool.schema.string().describe("Cell ID or partial hash"),
    reason: tool.schema.string().describe("Completion reason"),
    result: tool.schema.string().optional().describe("Implementation summary - what was actually done (like a PR description)"),
  },
  async execute(args, ctx) {
    const validated = CellCloseArgsSchema.parse(args);
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      // Resolve partial ID to full ID
      const cellId = await resolvePartialId(adapter, projectKey, validated.id) || validated.id;
      
      // Get cell details before closing to check if it's an epic
      const cellBeforeClose = await adapter.getCell(projectKey, cellId);
      const isEpic = cellBeforeClose?.type === "epic";
      
      const cell = await adapter.closeCell(
        projectKey,
        cellId,
        validated.reason,
        validated.result ? { result: validated.result } : undefined,
      );

      await adapter.markDirty(projectKey, cellId);

      // Emit SwarmCompletedEvent if this was an epic
      if (isEpic && cellBeforeClose) {
        try {
          // Query subtasks to gather metrics
          const subtasks = await adapter.queryCells(projectKey, { parent_id: cellId });
          const completedSubtasks = subtasks.filter(st => st.status === "closed");
          const failedSubtasks = subtasks.filter(st => st.status === "blocked");

          // Gather all unique files from DecompositionGeneratedEvent
          let totalFilesTouched: string[] = [];
          try {
            const { readEvents } = await import("swarm-mail");
            const decompositionEvents = await readEvents({
              projectKey,
              types: ["decomposition_generated"],
            }, projectKey);

            const epicDecomp = decompositionEvents.find((e: any) =>
              e.type === "decomposition_generated" && e.epic_id === cellId
            );

            if (epicDecomp) {
              const allFiles = new Set<string>();
              for (const subtask of (epicDecomp as any).subtasks || []) {
                for (const file of subtask.files || []) {
                  allFiles.add(file);
                }
              }
              totalFilesTouched = Array.from(allFiles);
            }
          } catch (error) {
            console.warn("[hive_close] Failed to gather files from decomposition:", error);
          }

          // Calculate total duration from swarm_started to now
          let totalDurationMs = 0;
          try {
            const { readEvents } = await import("swarm-mail");
            const swarmStartedEvents = await readEvents({
              projectKey,
              types: ["swarm_started"],
            }, projectKey);

            const startEvent = swarmStartedEvents.find((e: any) =>
              e.type === "swarm_started" && e.epic_id === cellId
            );

            if (startEvent) {
              totalDurationMs = Date.now() - (startEvent as any).timestamp;
            }
          } catch (error) {
            console.warn("[hive_close] Failed to calculate duration:", error);
          }

          await safeEmitEvent(
            "swarm_completed",
            {
              epic_id: cellId,
              epic_title: cellBeforeClose.title,
              success: failedSubtasks.length === 0,
              total_duration_ms: totalDurationMs,
              subtasks_completed: completedSubtasks.length,
              subtasks_failed: failedSubtasks.length,
              total_files_touched: totalFilesTouched,
            },
            "hive_close",
            projectKey,
          );
          
          // Run validation hook (fire-and-forget)
          // This validates the swarm event stream and emits validation events
          // Don't block on it - validation is for observability, not a gate
          try {
            const { runPostSwarmValidation } = await import("./swarm-validation");
            const { readEvents } = await import("swarm-mail");
            
            // Query events for this swarm
            const swarmEvents = await readEvents({
              projectKey,
              types: [
                "swarm_started",
                "swarm_completed",
                "worker_spawned",
                "subtask_outcome",
                "decomposition_generated",
              ],
            }, projectKey);
            
            // Fire validation asynchronously
            runPostSwarmValidation(
              {
                project_key: projectKey,
                epic_id: cellId,
                swarm_id: cellId, // Use epic ID as swarm ID
                started_at: new Date(),
                emit: async (event) => {
                  // Use the same event emitter
                  // Cast to any to bypass type checking - validation events are defined in swarm-mail
                  await appendEvent(event as any, projectKey);
                },
              },
              swarmEvents
            ).then(result => {
              if (!result.passed) {
                console.warn(`[Validation] Found ${result.issues.length} issues in swarm ${cellId}`);
              }
            }).catch(err => {
              console.error(`[Validation] Failed:`, err);
            });
          } catch (error) {
            // Non-fatal - validation is observability, not critical path
            console.warn("[hive_close] Validation hook failed (non-fatal):", error);
          }
        } catch (error) {
          // Non-fatal - log and continue
          console.warn("[hive_close] Failed to emit SwarmCompletedEvent:", error);
        }
      }

      // Emit cell_closed event for all cells (including epics)
      await safeEmitEvent(
        "cell_closed",
        {
          cell_id: cellId,
          reason: validated.reason,
        },
        "hive_close",
        projectKey,
      );

      return `Closed ${cell.id}: ${validated.reason}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      // Provide helpful error messages
      if (message.includes("Ambiguous hash")) {
        throw new HiveError(
          `Ambiguous ID '${validated.id}': multiple cells match. Please provide more characters.`,
          "hive_close",
        );
      }
      if (message.includes("Bead not found") || message.includes("Cell not found")) {
        throw new HiveError(
          `No cell found matching ID '${validated.id}'`,
          "hive_close",
        );
      }
      
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
    id: tool.schema.string().describe("Cell ID or partial hash"),
  },
  async execute(args, ctx) {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      // Resolve partial ID to full ID
      const cellId = await resolvePartialId(adapter, projectKey, args.id) || args.id;
      
      const cell = await adapter.changeCellStatus(
        projectKey,
        cellId,
        "in_progress",
      );

      await adapter.markDirty(projectKey, cellId);

      // Emit cell_status_changed event for observability
      try {
        const event = createEvent("cell_status_changed", {
          project_key: projectKey,
          cell_id: cellId,
          old_status: "open",
          new_status: "in_progress",
        });
        await appendEvent(event, projectKey);
      } catch (error) {
        // Non-fatal - log and continue
        console.warn("[hive_start] Failed to emit cell_status_changed event:", error);
      }

      return `Started: ${cell.id}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      // Provide helpful error messages
      if (message.includes("Ambiguous hash")) {
        throw new HiveError(
          `Ambiguous ID '${args.id}': multiple cells match. Please provide more characters.`,
          "hive_start",
        );
      }
      if (message.includes("Bead not found") || message.includes("Cell not found")) {
        throw new HiveError(
          `No cell found matching ID '${args.id}'`,
          "hive_start",
        );
      }
      
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
 * Query cells from the hive database with flexible filtering
 */
export const hive_cells = tool({
  description: `Query cells from the hive database with flexible filtering.

USE THIS TOOL TO:
- List all open cells: hive_cells()
- Find cells by status: hive_cells({ status: "in_progress" })
- Find cells by type: hive_cells({ type: "bug" })
- Get a specific cell by partial ID: hive_cells({ id: "mjkmd" })
- Get the next ready (unblocked) cell: hive_cells({ ready: true })
- Get children of an epic: hive_cells({ parent_id: "epic-id" })
- Combine filters: hive_cells({ status: "open", type: "task" })

RETURNS: Array of cells with id, title, status, priority, type, parent_id, created_at, updated_at

PREFER THIS OVER hive_query when you need to:
- See what work is available
- Check status of multiple cells
- Find cells matching criteria
- Look up a cell by partial ID`,
  args: {
    id: tool.schema.string().optional().describe("Partial or full cell ID to look up"),
    status: tool.schema.enum(["open", "in_progress", "blocked", "closed"]).optional().describe("Filter by status"),
    type: tool.schema.enum(["task", "bug", "feature", "epic", "chore"]).optional().describe("Filter by type"),
    parent_id: tool.schema.string().optional().describe("Filter by parent epic ID (returns children of an epic)"),
    ready: tool.schema.boolean().optional().describe("If true, return only the next unblocked cell"),
    limit: tool.schema.number().optional().describe("Max cells to return (default 20)"),
  },
  async execute(args, ctx) {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);
    
    try {
      // If specific ID requested, find all matching cells (supports partial IDs)
      if (args.id) {
        const matchingCells = await findCellsByPartialId(adapter, projectKey, args.id);
        if (matchingCells.length === 0) {
          throw new HiveError(`No cell found matching ID '${args.id}'`, "hive_cells");
        }
        const formatted = matchingCells.map(c => formatCellForOutput(c));
        return JSON.stringify(formatted, null, 2);
      }
      
      // If ready flag, return next unblocked cell
      if (args.ready) {
        const ready = await adapter.getNextReadyCell(projectKey);
        if (!ready) {
          return JSON.stringify([], null, 2);
        }
        const formatted = formatCellForOutput(ready);
        return JSON.stringify([formatted], null, 2);
      }
      
      // Query with filters
      const cells = await adapter.queryCells(projectKey, {
        status: args.status,
        type: args.type,
        parent_id: args.parent_id,
        limit: args.limit || 20,
      });
      
      const formatted = cells.map(c => formatCellForOutput(c));
      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      // Re-throw HiveErrors as-is
      if (error instanceof HiveError) {
        throw error;
      }
      
      const message = error instanceof Error ? error.message : String(error);
      
      // Provide helpful error messages
      if (message.includes("Bead not found") || message.includes("Cell not found")) {
        throw new HiveError(
          `No cell found matching ID '${args.id || "unknown"}'`,
          "hive_cells",
        );
      }
      
      throw new HiveError(
        `Failed to query cells: ${message}`,
        "hive_cells",
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

    // 2b. Sync memories to JSONL
    const swarmMail = await getSwarmMailLibSQL(projectKey);
    const db = await swarmMail.getDatabase();
    const hivePath = join(projectKey, ".hive");
    let memoriesSynced = 0;
    try {
      const memoryResult = await syncMemories(db, hivePath);
      memoriesSynced = memoryResult.exported;
    } catch (err) {
      // Memory sync is optional - don't fail if it errors
      console.warn("[hive_sync] Memory sync warning:", err);
    }

    if (flushResult.cellsExported === 0 && memoriesSynced === 0) {
      return "No cells or memories to sync";
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
        // Check for unstaged changes that would block pull --rebase
        const statusResult = await runGitCommand(["status", "--porcelain"]);
        const hasUnstagedChanges = statusResult.stdout.trim() !== "";
        let didStash = false;

        if (hasUnstagedChanges) {
          // Stash all changes (including untracked) before pull
          const stashResult = await runGitCommand(["stash", "push", "-u", "-m", "hive_sync: auto-stash before pull"]);
          if (stashResult.exitCode === 0) {
            didStash = true;
          }
          // If stash fails (e.g., nothing to stash), continue anyway
        }

        try {
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
        } finally {
          // Pop stash if we stashed
          if (didStash) {
            const popResult = await runGitCommand(["stash", "pop"]);
            if (popResult.exitCode !== 0) {
              // Stash pop failed - likely a conflict. Log warning but don't fail sync.
              console.warn(`[hive_sync] Warning: stash pop failed. Your changes are in 'git stash list'. Error: ${popResult.stderr}`);
            }
          }
        }
      }
    }

    // 7. Push (check if remote exists first)
    const remoteCheckResult = await runGitCommand(["remote"]);
    const hasRemote = remoteCheckResult.stdout.trim() !== "";

    let pushSuccess = false;
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
      pushSuccess = true;
    }

    // Emit hive_synced event for observability
    try {
      const event = createEvent("hive_synced", {
        project_key: projectKey,
        cells_synced: flushResult.cellsExported,
        push_success: pushSuccess,
      });
      await appendEvent(event, projectKey);
    } catch (error) {
      // Non-fatal - log and continue
      console.warn("[hive_sync] Failed to emit hive_synced event:", error);
    }

    if (hasRemote) {
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

/**
 * Start a work session
 * 
 * Shows previous session's handoff notes if available.
 * Inspired by Chainlink's session management pattern.
 * Credit: @dollspace-gay (https://github.com/dollspace-gay/chainlink)
 */
export const hive_session_start = tool({
  description: "Start a new work session (shows previous handoff notes)",
  args: {
    active_cell_id: tool.schema
      .string()
      .optional()
      .describe("ID of cell being worked on"),
  },
  async execute(args, ctx) {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      const session = await adapter.startSession(projectKey, {
        active_cell_id: args.active_cell_id,
      });

      return JSON.stringify({
        session_id: session.id,
        started_at: new Date(session.started_at).toISOString(),
        active_cell_id: session.active_cell_id,
        previous_handoff_notes: session.previous_handoff_notes,
      }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to start session: ${message}`,
        "hive_session_start",
      );
    }
  },
});

/**
 * End the current work session
 * 
 * Optionally save handoff notes for next session.
 */
export const hive_session_end = tool({
  description: "End current session with optional handoff notes for next session",
  args: {
    handoff_notes: tool.schema
      .string()
      .optional()
      .describe("Notes for next session (e.g., 'Completed X. Next: do Y')"),
  },
  async execute(args, ctx) {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);

    try {
      // Get current session
      const currentSession = await adapter.getCurrentSession(projectKey);

      if (!currentSession) {
        throw new HiveError(
          "No active session to end",
          "hive_session_end",
        );
      }

      // End session
      const endedSession = await adapter.endSession(
        projectKey,
        currentSession.id,
        {
          handoff_notes: args.handoff_notes,
        },
      );

      const duration = endedSession.ended_at! - endedSession.started_at;

      return JSON.stringify({
        session_id: endedSession.id,
        started_at: new Date(endedSession.started_at).toISOString(),
        ended_at: new Date(endedSession.ended_at!).toISOString(),
        duration_ms: duration,
        handoff_notes: endedSession.handoff_notes,
      }, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HiveError(
        `Failed to end session: ${message}`,
        "hive_session_end",
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
  hive_cells,
  hive_sync,
  hive_link_thread,
  hive_session_start,
  hive_session_end,
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
