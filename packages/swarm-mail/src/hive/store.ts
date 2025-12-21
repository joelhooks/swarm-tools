/**
 * Beads Event Store - Drizzle ORM Implementation
 *
 * Drizzle-based implementation of cell event store operations.
 * Replaces raw SQL queries with type-safe Drizzle query builder.
 *
 * ## Architecture
 * - Cell events stored in shared `events` table (same as agent/message events)
 * - Events trigger updateProjections() to update materialized views
 * - Events are NOT replayed for state (hybrid model - projections are source of truth)
 * - Event log provides audit trail and debugging for swarm coordination
 *
 * ## Event Flow
 * 1. appendCellEvent() -> INSERT INTO events
 * 2. updateProjections() -> UPDATE materialized views (beads, dependencies, labels, etc.)
 * 3. Query operations read from projections (fast)
 *
 * @module beads/store
 */

import { and, eq, gte, gt, inArray, lte, sql } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import { eventsTable } from "../db/schema/streams.js";
import { withTiming } from "../streams/index.js";
import type { DatabaseAdapter } from "../types/database.js";
import { updateProjectionsDrizzle } from "./projections-drizzle.js";
import type { CellEvent } from "./events.js";

// No type guards needed - CellEvent type is already defined

// ============================================================================
// Timestamp Parsing (same as streams/store.ts)
// ============================================================================

/**
 * Parse timestamp from database row.
 *
 * Timestamps are stored as BIGINT but parsed as JavaScript number.
 * Safe for dates before year 2286 (MAX_SAFE_INTEGER).
 */
function parseTimestamp(timestamp: string | number): number {
  const ts = typeof timestamp === "string" ? parseInt(timestamp, 10) : timestamp;
  if (Number.isNaN(ts)) {
    throw new Error(`[BeadsStore] Invalid timestamp: ${timestamp}`);
  }
  if (ts > Number.MAX_SAFE_INTEGER) {
    console.warn(
      `[BeadsStore] Timestamp ${timestamp} exceeds MAX_SAFE_INTEGER (year 2286+)`,
    );
  }
  return ts;
}

// ============================================================================
// Event Store Operations (Drizzle)
// ============================================================================

/**
 * Options for reading cell events
 */
export interface ReadCellEventsOptions {
  /** Filter by project key */
  projectKey?: string;
  /** Filter by cell ID */
  cellId?: string;
  /** Filter by event types */
  types?: CellEvent["type"][];
  /** Events after this timestamp */
  since?: number;
  /** Events before this timestamp */
  until?: number;
  /** Events after this sequence number */
  afterSequence?: number;
  /** Maximum number of events to return */
  limit?: number;
  /** Skip this many events (pagination) */
  offset?: number;
}

/**
 * Append a cell event using Drizzle
 *
 * @param db - Drizzle database instance
 * @param event - Cell event to append
 * @returns Event with id and sequence
 */
export async function appendCellEventDrizzle(
  db: SwarmDb,
  event: CellEvent,
): Promise<CellEvent & { id: number; sequence: number }> {
  const { type, project_key, timestamp, ...rest } = event;

  // Insert event
  const result = await db
    .insert(eventsTable)
    .values({
      type,
      project_key,
      timestamp,
      data: JSON.stringify(rest),
      // sequence omitted - auto-assigned by database (SERIAL in PGlite, trigger in LibSQL)
    })
    .returning({ id: eventsTable.id, sequence: eventsTable.sequence });

  const row = result[0];
  if (!row) {
    throw new Error("[BeadsStore] Failed to insert event - no row returned");
  }

  let { id, sequence } = row;

  // LibSQL workaround: RETURNING gives pre-trigger value, sequence may be null
  // If sequence is null, fetch it after trigger has run
  if (sequence == null) {
    const seqResult = await db
      .select({ sequence: eventsTable.sequence })
      .from(eventsTable)
      .where(eq(eventsTable.id, id));
    sequence = seqResult[0]?.sequence ?? id; // Fallback to id if still null
  }

  // Update materialized views based on event type
  await updateProjectionsDrizzle(db, { ...event, id, sequence } as any);

  return { ...event, id, sequence };
}

/**
 * Read cell events with optional filters using Drizzle
 *
 * @param db - Drizzle database instance
 * @param options - Filter options
 * @returns Array of cell events with id and sequence
 */
export async function readCellEventsDrizzle(
  db: SwarmDb,
  options: ReadCellEventsOptions = {},
): Promise<Array<CellEvent & { id: number; sequence: number }>> {
  const conditions = [];

  // Always filter for cell events (type starts with "cell_")
  conditions.push(sql`${eventsTable.type} LIKE 'cell_%'`);

  if (options.projectKey) {
    conditions.push(eq(eventsTable.project_key, options.projectKey));
  }

  if (options.cellId) {
    // cell_id is stored in data JSON field
    // Use json_extract for SQLite compatibility
    conditions.push(sql`json_extract(${eventsTable.data}, '$.cell_id') = ${options.cellId}`);
  }

  if (options.types && options.types.length > 0) {
    conditions.push(inArray(eventsTable.type, options.types));
  }

  if (options.since !== undefined) {
    conditions.push(gte(eventsTable.timestamp, options.since));
  }

  if (options.until !== undefined) {
    conditions.push(lte(eventsTable.timestamp, options.until));
  }

  if (options.afterSequence !== undefined) {
    conditions.push(gt(eventsTable.sequence, options.afterSequence));
  }

  let query = db
    .select()
    .from(eventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(eventsTable.sequence)
    .$dynamic();

  if (options.limit) {
    query = query.limit(options.limit);
  }

  if (options.offset) {
    query = query.offset(options.offset);
  }

  const rows = await query;

  return rows.map((row) => {
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    return {
      id: row.id,
      type: row.type as CellEvent["type"],
      project_key: row.project_key,
      timestamp: parseTimestamp(row.timestamp),
      sequence: row.sequence ?? 0,
      ...data,
    } as CellEvent & { id: number; sequence: number };
  });
}

// ============================================================================
// Convenience Wrappers (compatible with old signatures)
// ============================================================================

/**
 * Append a cell event to the shared event store (convenience wrapper)
 *
 * Events are stored in the same `events` table as agent/message events.
 * Triggers updateProjections() to update materialized views.
 *
 * @param event - Cell event to append
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 * @returns Event with id and sequence number
 */
export async function appendCellEvent(
  event: CellEvent,
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<CellEvent & { id: number; sequence: number }> {
  const { toDrizzleDb } = await import("../libsql.convenience.js");

  if (!dbOverride) {
    throw new Error(
      "[hive/store] dbOverride parameter is required. " +
      "PGlite getDatabase() has been removed. " +
      "Use createHiveAdapter() instead of calling appendCellEvent() directly."
    );
  }
  
  const swarmDb = toDrizzleDb(dbOverride);

  return appendCellEventDrizzle(swarmDb, event);
}

/**
 * Read cell events with optional filters (convenience wrapper)
 *
 * Queries the shared events table for cell events (type starts with "cell_").
 *
 * @param options - Filter options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 * @returns Array of cell events with id and sequence
 */
export async function readCellEvents(
  options: ReadCellEventsOptions = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<Array<CellEvent & { id: number; sequence: number }>> {
  return withTiming("readCellEvents", async () => {
    const { toDrizzleDb } = await import("../libsql.convenience.js");

    if (!dbOverride) {
      throw new Error(
        "[hive/store] dbOverride parameter is required. " +
        "PGlite getDatabase() has been removed. " +
        "Use createHiveAdapter() instead of calling readCellEvents() directly."
      );
    }

    const swarmDb = toDrizzleDb(dbOverride);

    return readCellEventsDrizzle(swarmDb, options);
  });
}

/**
 * Replay cell events to rebuild materialized views
 *
 * Useful for:
 * - Recovering from projection corruption
 * - Migrating to new schema
 * - Debugging state issues
 *
 * Note: Unlike swarm-mail agent events, cell projections are NOT rebuilt
 * from events in normal operation (hybrid CRUD + audit trail model).
 * This function is for recovery/debugging only.
 *
 * @param options - Replay options
 * @param projectPath - Optional project path for database location
 * @param dbOverride - Optional database adapter for dependency injection
 * @returns Stats about replay operation
 */
export async function replayCellEvents(
  options: {
    projectKey?: string;
    fromSequence?: number;
    clearViews?: boolean;
  } = {},
  projectPath?: string,
  dbOverride?: DatabaseAdapter,
): Promise<{ eventsReplayed: number; duration: number }> {
  return withTiming("replayCellEvents", async () => {
    const startTime = Date.now();
    const { toDrizzleDb } = await import("../libsql.convenience.js");

    if (!dbOverride) {
      throw new Error(
        "[hive/store] dbOverride parameter is required. " +
        "PGlite getDatabase() has been removed. " +
        "Use createHiveAdapter() instead of calling replayCellEvents() directly."
      );
    }

    const swarmDb = toDrizzleDb(dbOverride);

    // Optionally clear cell-specific materialized views using Drizzle
    if (options.clearViews) {
      const { beads, beadComments, beadLabels, beadDependencies, blockedBeadsCache, dirtyBeads } = 
        await import("../db/schema/hive.js");

      if (options.projectKey) {
        // Clear for specific project using Drizzle
        // Get cell IDs for this project first
        const cellIds = await swarmDb
          .select({ id: beads.id })
          .from(beads)
          .where(eq(beads.project_key, options.projectKey));
        
        const cellIdList = cellIds.map(r => r.id);
        
        if (cellIdList.length > 0) {
          // Delete related data in proper order (foreign keys)
          await swarmDb.delete(beadComments).where(inArray(beadComments.cell_id, cellIdList));
          await swarmDb.delete(beadLabels).where(inArray(beadLabels.cell_id, cellIdList));
          await swarmDb.delete(beadDependencies).where(inArray(beadDependencies.cell_id, cellIdList));
          await swarmDb.delete(blockedBeadsCache).where(inArray(blockedBeadsCache.cell_id, cellIdList));
          await swarmDb.delete(dirtyBeads).where(inArray(dirtyBeads.cell_id, cellIdList));
          await swarmDb.delete(beads).where(eq(beads.project_key, options.projectKey));
        }
      } else {
        // Clear all cell views using Drizzle
        await swarmDb.delete(beadComments);
        await swarmDb.delete(beadLabels);
        await swarmDb.delete(beadDependencies);
        await swarmDb.delete(blockedBeadsCache);
        await swarmDb.delete(dirtyBeads);
        await swarmDb.delete(beads);
      }
    }

    // Read all cell events
    const events = await readCellEventsDrizzle(swarmDb, {
      projectKey: options.projectKey,
      afterSequence: options.fromSequence,
    });

    // Replay each event through projections
    for (const event of events) {
      // Cast to any to match projections' loose event type
      await updateProjectionsDrizzle(swarmDb, event as any);
    }

    return {
      eventsReplayed: events.length,
      duration: Date.now() - startTime,
    };
  });
}
