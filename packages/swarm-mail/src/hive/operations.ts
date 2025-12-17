/**
 * Cell Operations - High-level CRUD operations using HiveAdapter
 *
 * Convenience functions that wrap HiveAdapter with validation.
 * Plugin tools should use these operations instead of calling adapter directly.
 *
 * ## Layering
 * - HiveAdapter: Low-level event sourcing operations
 * - operations.ts: High-level validated CRUD (THIS FILE)
 * - Plugin tools: Type-safe Zod-validated wrappers
 */

import type {
  HiveAdapter,
  Cell,
  QueryCellsOptions,
} from "../types/hive-adapter.js";
import {
  validateCreateBead,
  validateUpdateBead,
  type CreateCellOptions,
  type UpdateCellOptions,
} from "./validation.js";

/**
 * Create a new bead with validation
 *
 * @throws {Error} If validation fails
 */
export async function createCell(
  adapter: HiveAdapter,
  projectKey: string,
  options: CreateCellOptions,
): Promise<Cell> {
  // Validate options
  const validation = validateCreateBead(options);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Create bead via adapter
  return adapter.createCell(projectKey, {
    title: options.title,
    type: options.type,
    priority: options.priority ?? 2,
    description: options.description,
    parent_id: options.parent_id,
    assignee: options.assignee,
    created_by: options.created_by,
  });
}

/**
 * Get a bead by ID
 *
 * @returns Cell or null if not found
 */
export async function getCell(
  adapter: HiveAdapter,
  projectKey: string,
  cellId: string,
): Promise<Cell | null> {
  return adapter.getCell(projectKey, cellId);
}

/**
 * Update a bead with validation
 *
 * @throws {Error} If validation fails or bead not found
 */
export async function updateCell(
  adapter: HiveAdapter,
  projectKey: string,
  cellId: string,
  updates: UpdateCellOptions,
): Promise<Cell> {
  // Validate updates
  const validation = validateUpdateBead(updates);
  if (!validation.valid) {
    throw new Error(validation.errors.join(", "));
  }

  // Update via adapter
  return adapter.updateCell(projectKey, cellId, updates);
}

/**
 * Close a bead
 *
 * @throws {Error} If bead not found
 */
export async function closeCell(
  adapter: HiveAdapter,
  projectKey: string,
  cellId: string,
  reason: string,
  closedBy?: string,
): Promise<Cell> {
  return adapter.closeCell(projectKey, cellId, reason, {
    closed_by: closedBy,
  });
}

/**
 * Reopen a closed bead
 *
 * @throws {Error} If bead not found or invalid transition
 */
export async function reopenCell(
  adapter: HiveAdapter,
  projectKey: string,
  cellId: string,
  reopenedBy?: string,
): Promise<Cell> {
  return adapter.reopenCell(projectKey, cellId, {
    reopened_by: reopenedBy,
  });
}

/**
 * Delete a bead (soft delete - creates tombstone)
 *
 * @throws {Error} If bead not found
 */
export async function deleteCell(
  adapter: HiveAdapter,
  projectKey: string,
  cellId: string,
  reason: string,
  deletedBy?: string,
): Promise<void> {
  await adapter.deleteCell(projectKey, cellId, {
    reason,
    deleted_by: deletedBy,
  });
}

/**
 * Search beads by title
 *
 * Simple text search across bead titles with optional filters.
 */
export async function searchBeads(
  adapter: HiveAdapter,
  projectKey: string,
  query: string,
  filter?: QueryCellsOptions,
): Promise<Cell[]> {
  // Get all beads matching filter
  const allBeads = await adapter.queryCells(projectKey, filter);

  // Filter by query string if provided
  if (!query || query.trim().length === 0) {
    return allBeads;
  }

  const lowerQuery = query.toLowerCase();
  return allBeads.filter(
    (bead) =>
      bead.title.toLowerCase().includes(lowerQuery) ||
      bead.description?.toLowerCase().includes(lowerQuery),
  );
}
