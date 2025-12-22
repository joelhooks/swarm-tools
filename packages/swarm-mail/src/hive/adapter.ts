/**
 * Beads Adapter - Factory for creating HiveAdapter instances
 *
 * This file implements the adapter pattern for beads event sourcing,
 * enabling dependency injection of the database.
 *
 * ## Design Pattern
 * - Accept DatabaseAdapter via factory parameter
 * - Return HiveAdapter interface
 * - Delegate to store.ts for event operations
 * - Delegate to projections.ts for queries
 * - No direct database access (all via adapter)
 *
 * ## Usage
 * ```typescript
 * import { createInMemorySwarmMailLibSQL } from 'swarm-mail';
 * import { createHiveAdapter } from 'swarm-mail';
 *
 * const swarmMail = await createInMemorySwarmMailLibSQL('my-project');
 * const db = await swarmMail.getDatabase();
 * const hive = createHiveAdapter(db, '/path/to/project');
 *
 * // Use the adapter
 * await hive.createCell(projectKey, { title: "Task", type: "task", priority: 2 });
 * const cell = await hive.getCell(projectKey, "cell-123");
 * ```
 */

import type { DatabaseAdapter } from "../types/database.js";
import type { HiveAdapter } from "../types/hive-adapter.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Import implementation functions from store.ts and projections.ts
import {
  appendCellEvent,
  readCellEvents,
  replayCellEvents,
} from "./store.js";

import {
  getCell,
  queryCells,
  getDependencies,
  getDependents,
  isBlocked,
  getBlockers,
  getLabels,
  getComments,
  getNextReadyCell,
  getInProgressCells,
  getBlockedCells,
  markBeadDirty,
  getDirtyCells,
  clearDirtyBead,
} from "./projections.js";

// Import event types (will be from opencode-swarm-plugin)
import type { CellEvent } from "./events.js";

/**
 * Create a HiveAdapter instance
 *
 * @param db - DatabaseAdapter instance (libSQL, SQLite, etc.)
 * @param projectKey - Project identifier (typically the project path)
 * @returns HiveAdapter interface
 */
export function createHiveAdapter(
  db: DatabaseAdapter,
  projectKey: string,
): HiveAdapter {
  return {
    // ============================================================================
    // Core Bead Operations
    // ============================================================================

    async createCell(projectKeyParam, options, projectPath?) {
      // Create bead_created event
      const event: CellEvent = {
        type: "cell_created",
        project_key: projectKeyParam,
        cell_id: generateBeadId(projectKeyParam),
        timestamp: Date.now(),
        title: options.title,
        description: options.description || null,
        issue_type: options.type,
        priority: options.priority ?? 2,
        parent_id: options.parent_id || null,
        created_by: options.created_by || null,
        metadata: options.metadata || null,
      } as any;

      await appendCellEvent(event, projectPath, db);

      // If assignee provided, emit bead_assigned event
      if (options.assignee) {
        const assignEvent: CellEvent = {
          type: "cell_assigned",
          project_key: projectKeyParam,
          cell_id: event.cell_id,
          timestamp: Date.now(),
          assignee: options.assignee,
          assigned_by: options.created_by || null,
        } as any;
        await appendCellEvent(assignEvent, projectPath, db);
      }

      // Return the created bead from projection
      const bead = await getCell(db, projectKeyParam, event.cell_id);
      if (!bead) {
        throw new Error(
          `[HiveAdapter] Failed to create bead - not found after insert`,
        );
      }
      return bead;
    },

    async getCell(projectKeyParam, cellId, projectPath?) {
      return getCell(db, projectKeyParam, cellId);
    },

    async queryCells(projectKeyParam, options?, projectPath?) {
      return queryCells(db, projectKeyParam, options);
    },

    async updateCell(projectKeyParam, cellId, options, projectPath?) {
      const existingBead = await getCell(db, projectKeyParam, cellId);
      if (!existingBead) {
        throw new Error(`[HiveAdapter] Bead not found: ${cellId}`);
      }

      const changes: Record<string, { old: unknown; new: unknown }> = {};

      if (options.title && options.title !== existingBead.title) {
        changes.title = { old: existingBead.title, new: options.title };
      }
      if (options.description !== undefined && options.description !== existingBead.description) {
        changes.description = { old: existingBead.description, new: options.description };
      }
      if (options.priority !== undefined && options.priority !== existingBead.priority) {
        changes.priority = { old: existingBead.priority, new: options.priority };
      }
      if (options.assignee !== undefined && options.assignee !== existingBead.assignee) {
        changes.assignee = { old: existingBead.assignee, new: options.assignee };
      }

      if (Object.keys(changes).length === 0) {
        return existingBead; // No changes
      }

      const event: CellEvent = {
        type: "cell_updated",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        changes,
        updated_by: options.updated_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);

      const updated = await getCell(db, projectKeyParam, cellId);
      if (!updated) {
        throw new Error(`[HiveAdapter] Bead disappeared after update: ${cellId}`);
      }
      return updated;
    },

    async changeCellStatus(projectKeyParam, cellId, toStatus, options?, projectPath?) {
      const existingBead = await getCell(db, projectKeyParam, cellId);
      if (!existingBead) {
        throw new Error(`[HiveAdapter] Bead not found: ${cellId}`);
      }

      const event: CellEvent = {
        type: "cell_status_changed",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        from_status: existingBead.status,
        to_status: toStatus,
        reason: options?.reason || null,
        changed_by: options?.changed_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);

      const updated = await getCell(db, projectKeyParam, cellId);
      if (!updated) {
        throw new Error(`[HiveAdapter] Bead disappeared after status change: ${cellId}`);
      }
      return updated;
    },

    async closeCell(projectKeyParam, cellId, reason, options?, projectPath?) {
      const existingBead = await getCell(db, projectKeyParam, cellId);
      if (!existingBead) {
        throw new Error(`[HiveAdapter] Bead not found: ${cellId}`);
      }

      const event: CellEvent = {
        type: "cell_closed",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        reason,
        closed_by: options?.closed_by || null,
        files_touched: options?.files_touched || null,
        duration_ms: options?.duration_ms || null,
      } as any;

      await appendCellEvent(event, projectPath, db);

      const updated = await getCell(db, projectKeyParam, cellId);
      if (!updated) {
        throw new Error(`[HiveAdapter] Bead disappeared after close: ${cellId}`);
      }
      return updated;
    },

    async reopenCell(projectKeyParam, cellId, options?, projectPath?) {
      const existingBead = await getCell(db, projectKeyParam, cellId);
      if (!existingBead) {
        throw new Error(`[HiveAdapter] Bead not found: ${cellId}`);
      }

      const event: CellEvent = {
        type: "cell_reopened",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        reason: options?.reason || null,
        reopened_by: options?.reopened_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);

      const updated = await getCell(db, projectKeyParam, cellId);
      if (!updated) {
        throw new Error(`[HiveAdapter] Bead disappeared after reopen: ${cellId}`);
      }
      return updated;
    },

    async deleteCell(projectKeyParam, cellId, options?, projectPath?) {
      const existingBead = await getCell(db, projectKeyParam, cellId);
      if (!existingBead) {
        throw new Error(`[HiveAdapter] Bead not found: ${cellId}`);
      }

      const event: CellEvent = {
        type: "cell_deleted",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        reason: options?.reason || null,
        deleted_by: options?.deleted_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);
    },

    // ============================================================================
    // Dependency Operations
    // ============================================================================

    async addDependency(projectKeyParam, cellId, dependsOnId, relationship, options?, projectPath?) {
      // Validate both beads exist
      const sourceBead = await getCell(db, projectKeyParam, cellId);
      if (!sourceBead) {
        throw new Error(`[HiveAdapter] Bead not found: ${cellId}`);
      }
      
      const targetCell = await getCell(db, projectKeyParam, dependsOnId);
      if (!targetCell) {
        throw new Error(`[HiveAdapter] Target bead not found: ${dependsOnId}`);
      }
      
      // Prevent self-dependency
      if (cellId === dependsOnId) {
        throw new Error(`[HiveAdapter] Bead cannot depend on itself`);
      }
      
      // Check for cycles (import at runtime to avoid circular deps)
      const { wouldCreateCycle } = await import("./dependencies.js");
      const hasCycle = await wouldCreateCycle(db, cellId, dependsOnId);
      if (hasCycle) {
        throw new Error(`[HiveAdapter] Adding dependency would create a cycle`);
      }
      
      const event: CellEvent = {
        type: "cell_dependency_added",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        dependency: {
          target: dependsOnId,
          type: relationship,
        },
        reason: options?.reason || null,
        added_by: options?.added_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);

      const deps = await getDependencies(db, projectKeyParam, cellId);
      const dep = deps.find((d) => d.depends_on_id === dependsOnId && d.relationship === relationship);
      if (!dep) {
        throw new Error(`[HiveAdapter] Dependency not found after insert`);
      }
      return dep;
    },

    async removeDependency(projectKeyParam, cellId, dependsOnId, relationship, options?, projectPath?) {
      const event: CellEvent = {
        type: "cell_dependency_removed",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        dependency: {
          target: dependsOnId,
          type: relationship,
        },
        reason: options?.reason || null,
        removed_by: options?.removed_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);
    },

    async getDependencies(projectKeyParam, cellId, projectPath?) {
      return getDependencies(db, projectKeyParam, cellId);
    },

    async getDependents(projectKeyParam, cellId, projectPath?) {
      return getDependents(db, projectKeyParam, cellId);
    },

    async isBlocked(projectKeyParam, cellId, projectPath?) {
      return isBlocked(db, projectKeyParam, cellId);
    },

    async getBlockers(projectKeyParam, cellId, projectPath?) {
      return getBlockers(db, projectKeyParam, cellId);
    },

    // ============================================================================
    // Label Operations
    // ============================================================================

    async addLabel(projectKeyParam, cellId, label, options?, projectPath?) {
      const event: CellEvent = {
        type: "cell_label_added",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        label,
        added_by: options?.added_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);

      return {
        cell_id: cellId,
        label,
        created_at: event.timestamp,
      };
    },

    async removeLabel(projectKeyParam, cellId, label, options?, projectPath?) {
      const event: CellEvent = {
        type: "cell_label_removed",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        label,
        removed_by: options?.removed_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);
    },

    async getLabels(projectKeyParam, cellId, projectPath?) {
      return getLabels(db, projectKeyParam, cellId);
    },

    async getCellsWithLabel(projectKeyParam, label, projectPath?) {
      return queryCells(db, projectKeyParam, { labels: [label] });
    },

    // ============================================================================
    // Comment Operations
    // ============================================================================

    async addComment(projectKeyParam, cellId, author, body, options?, projectPath?) {
      const event: CellEvent = {
        type: "cell_comment_added",
        project_key: projectKeyParam,
        cell_id: cellId,
        timestamp: Date.now(),
        author,
        body,
        parent_comment_id: options?.parent_id || null,
        metadata: options?.metadata || null,
      } as any;

      await appendCellEvent(event, projectPath, db);

      // Get the comment from projection
      const comments = await getComments(db, projectKeyParam, cellId);
      const comment = comments[comments.length - 1]; // Last inserted
      if (!comment) {
        throw new Error(`[HiveAdapter] Comment not found after insert`);
      }
      return comment;
    },

    async updateComment(projectKeyParam, commentId, newBody, updated_by, projectPath?) {
      const event: CellEvent = {
        type: "cell_comment_updated",
        project_key: projectKeyParam,
        cell_id: "", // Not needed for comment update
        timestamp: Date.now(),
        comment_id: commentId,
        new_body: newBody,
        updated_by,
      } as any;

      await appendCellEvent(event, projectPath, db);

      // Would need a getCommentById function in projections
      // For now, return a placeholder
      return {
        id: commentId,
        cell_id: "",
        author: updated_by,
        body: newBody,
        parent_id: null,
        created_at: Date.now(),
        updated_at: event.timestamp,
      };
    },

    async deleteComment(projectKeyParam, commentId, deleted_by, options?, projectPath?) {
      const event: CellEvent = {
        type: "cell_comment_deleted",
        project_key: projectKeyParam,
        cell_id: "", // Not needed for comment delete
        timestamp: Date.now(),
        comment_id: commentId,
        deleted_by,
        reason: options?.reason || null,
      } as any;

      await appendCellEvent(event, projectPath, db);
    },

    async getComments(projectKeyParam, cellId, projectPath?) {
      return getComments(db, projectKeyParam, cellId);
    },

    // ============================================================================
    // Epic Operations
    // ============================================================================

    async addChildToEpic(projectKeyParam, epicId, childId, options?, projectPath?) {
      const event: CellEvent = {
        type: "cell_epic_child_added",
        project_key: projectKeyParam,
        cell_id: epicId,
        timestamp: Date.now(),
        child_id: childId,
        child_index: options?.child_index || null,
        added_by: options?.added_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);
    },

    async removeChildFromEpic(projectKeyParam, epicId, childId, options?, projectPath?) {
      const event: CellEvent = {
        type: "cell_epic_child_removed",
        project_key: projectKeyParam,
        cell_id: epicId,
        timestamp: Date.now(),
        child_id: childId,
        reason: options?.reason || null,
        removed_by: options?.removed_by || null,
      } as any;

      await appendCellEvent(event, projectPath, db);
    },

    async getEpicChildren(projectKeyParam, epicId, projectPath?) {
      return queryCells(db, projectKeyParam, { parent_id: epicId });
    },

    async isEpicClosureEligible(projectKeyParam, epicId, projectPath?) {
      const children = await queryCells(db, projectKeyParam, { parent_id: epicId });
      return children.every((child) => child.status === "closed");
    },

    // ============================================================================
    // Query Helpers
    // ============================================================================

    async getNextReadyCell(projectKeyParam, projectPath?) {
      return getNextReadyCell(db, projectKeyParam);
    },

    async getInProgressCells(projectKeyParam, projectPath?) {
      return getInProgressCells(db, projectKeyParam);
    },

    async getBlockedCells(projectKeyParam, projectPath?) {
      return getBlockedCells(db, projectKeyParam);
    },

    async markDirty(projectKeyParam, cellId, projectPath?) {
      await markBeadDirty(db, projectKeyParam, cellId);
    },

    async getDirtyCells(projectKeyParam, projectPath?) {
      return getDirtyCells(db, projectKeyParam);
    },

    async clearDirty(projectKeyParam, cellId, projectPath?) {
      await clearDirtyBead(db, projectKeyParam, cellId);
    },

    // ============================================================================
    // Schema Operations
    // ============================================================================

    async runMigrations(projectPath?) {
      // Detect database dialect by checking for SQLite/LibSQL-specific features
      // LibSQL and SQLite use sqlite_master, PostgreSQL uses information_schema
      let isLibSQL = false;
      try {
        await db.query("SELECT name FROM sqlite_master LIMIT 1");
        isLibSQL = true;
      } catch {
        isLibSQL = false;
      }
      
      // Ensure schema_version table exists (idempotent)
      if (isLibSQL) {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
          )
        `);
      } else {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at BIGINT NOT NULL,
            description TEXT
          )
        `);
      }
      
      // Import the correct migration set based on dialect
      const { hiveMigrations, hiveMigrationsLibSQL } = await import("./migrations.js");
      const migrations = isLibSQL ? hiveMigrationsLibSQL : hiveMigrations;
      
      // Get current schema version
      const versionResult = await db.query<{ version: number }>(
        "SELECT MAX(version) as version FROM schema_version"
      );
      const currentVersion = versionResult.rows[0]?.version ?? 0;
      
      // Apply pending migrations
      for (const migration of migrations) {
        if (migration.version > currentVersion) {
          // libSQL's executeMultiple handles transactions internally,
          // so we don't wrap in BEGIN/COMMIT for libSQL
          if (isLibSQL) {
            await db.exec(migration.up);
            await db.query(
              `INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)
               ON CONFLICT (version) DO NOTHING`,
              [migration.version, Date.now(), migration.description],
            );
          } else {
            // PGLite needs explicit transaction
            await db.exec("BEGIN");
            try {
              await db.exec(migration.up);
              await db.query(
                `INSERT INTO schema_version (version, applied_at, description) VALUES ($1, $2, $3)
                 ON CONFLICT (version) DO NOTHING`,
                [migration.version, Date.now(), migration.description],
              );
              await db.exec("COMMIT");
            } catch (error) {
              await db.exec("ROLLBACK");
              throw error;
            }
          }
        }
      }
      
      // Force checkpoint after migrations to prevent WAL bloat
      // Critical for embedded PGLite - prevents 930 WAL file accumulation
      if (db.checkpoint) {
        await db.checkpoint();
      }
    },

    async getCellsStats(projectPath?) {
      const [totalResult, openResult, inProgressResult, blockedResult, closedResult] = await Promise.all([
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1", [projectKey]),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1 AND status = 'open'", [projectKey]),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1 AND status = 'in_progress'", [projectKey]),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1 AND status = 'blocked'", [projectKey]),
        db.query<{ count: string }>("SELECT COUNT(*) as count FROM beads WHERE project_key = $1 AND status = 'closed'", [projectKey]),
      ]);

      const byTypeResult = await db.query<{ type: string; count: string }>(
        "SELECT type, COUNT(*) as count FROM beads WHERE project_key = $1 GROUP BY type",
        [projectKey],
      );

      const by_type: Record<string, number> = {};
      for (const row of byTypeResult.rows) {
        by_type[row.type] = parseInt(row.count);
      }

      return {
        total_cells: parseInt(totalResult.rows[0]?.count || "0"),
        open: parseInt(openResult.rows[0]?.count || "0"),
        in_progress: parseInt(inProgressResult.rows[0]?.count || "0"),
        blocked: parseInt(blockedResult.rows[0]?.count || "0"),
        closed: parseInt(closedResult.rows[0]?.count || "0"),
        by_type,
      };
    },

    async rebuildBlockedCache(projectKeyParam, projectPath?) {
      // Rebuild cache for all beads in project (import at runtime)
      const { rebuildAllBlockedCaches } = await import("./dependencies.js");
      await rebuildAllBlockedCaches(db, projectKeyParam);
    },

    // ============================================================================
    // Database Connection Management
    // ============================================================================

    async getDatabase(projectPath?) {
      return db;
    },

    async close(projectPath?) {
      if (db.close) {
        await db.close();
      }
    },

    async closeAll() {
      if (db.close) {
        await db.close();
      }
    },
  };
}

/**
 * Generate a unique cell ID with project-name prefix
 *
 * Format: {project-name}-{project-hash}-{timestamp}{random}
 * Example: swarm-mail-lf2p4u-mjbneh7mqah
 * Fallback: cell-{hash}-{timestamp}{random} (when no package.json or name)
 */
function generateBeadId(projectKey: string): string {
  // Get project name prefix from package.json
  const prefix = getProjectPrefix(projectKey);

  // Simple hash of project key
  const hash = projectKey
    .split("")
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
    .toString(36)
    .slice(0, 6);

  // Use timestamp + random for uniqueness
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 5);

  return `${prefix}-${hash}-${timestamp}${random}`;
}

/**
 * Get project name prefix from package.json
 * Reads package.json from projectKey path and slugifies the name field
 * Falls back to 'cell' if package.json not found or has no name
 */
function getProjectPrefix(projectKey: string): string {
  try {
    // Try to read package.json from the project path
    const packageJsonPath = join(projectKey, "package.json");
    
    if (!existsSync(packageJsonPath)) {
      return "cell";
    }
    
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    
    if (!packageJson.name || typeof packageJson.name !== "string") {
      return "cell";
    }
    
    return slugifyProjectName(packageJson.name);
  } catch (error) {
    // If anything goes wrong (read error, parse error, etc.), fallback to 'cell'
    return "cell";
  }
}

/**
 * Slugify project name for use in cell ID prefix
 * - Lowercase
 * - Replace spaces and special chars with dashes
 * - Remove leading/trailing dashes
 * 
 * Examples:
 * - "My Cool App" -> "my-cool-app"
 * - "app@v2.0" -> "app-v2-0"
 * - "@scope/package" -> "scope-package"
 */
function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[@/]/g, "-") // Replace @ and / with dash
    .replace(/[^a-z0-9-]/g, "-") // Replace any other non-alphanumeric with dash
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing dashes
}
