/**
 * Drizzle ORM implementations for hive query functions
 * 
 * This file contains Drizzle-based implementations of simple queries from queries.ts.
 * Complex queries with CTEs, cache table joins, and JSON operators remain as raw SQL.
 * 
 * @module hive/queries-drizzle
 */

import { and, count, eq, isNull, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { beads } from "../db/schema/hive.js";
import type { Cell, HiveAdapter } from "../types/hive-adapter.js";
import type { StaleOptions } from "./queries.js";
import type { DatabaseAdapter } from "../types/database.js";

/**
 * Create a Drizzle instance with ONLY hive schema
 * 
 * This avoids loading the full swarm-mail schema (streams, memory, etc.)
 * which causes test failures when the test database only has hive tables.
 */
function getHiveDrizzle(db: DatabaseAdapter) {
  // Import only hive schema tables
  const hiveSchema = { beads };
  
  // For LibSQL Client, get the client and wrap with Drizzle
  if (typeof (db as any).getClient === 'function') {
    const client = (db as any).getClient();
    return drizzle(client, { schema: hiveSchema });
  }
  
  // For PGlite or raw client, wrap directly
  return drizzle(db as any, { schema: hiveSchema });
}

/**
 * Resolve partial cell ID hash to full cell ID (Drizzle implementation)
 * 
 * Cell ID format: {prefix}-{hash}-{timestamp}{random}
 * This function matches the hash portion (middle segment) and returns the full ID.
 * 
 * CONVERTED TO DRIZZLE: Simple SELECT with LIKE pattern, no joins
 * 
 * @param adapter - HiveAdapter instance
 * @param projectKey - Project key to filter cells
 * @param partialHash - Full or partial hash to match
 * @returns Full cell ID if found, null if not found
 * @throws Error if multiple cells match (ambiguous)
 */
export async function resolvePartialIdDrizzle(
  adapter: HiveAdapter,
  projectKey: string,
  partialHash: string,
): Promise<string | null> {
  const db = getHiveDrizzle(await adapter.getDatabase());

  // Use LIKE with specific pattern for hash segment
  // Pattern: %-{partialHash}%-% matches hash portion (second segment)
  const pattern = `%-${partialHash}%-%`;
  
  const results = await db
    .select()
    .from(beads)
    .where(
      and(
        eq(beads.project_key, projectKey),
        isNull(beads.deleted_at),
        like(beads.id, pattern)
      )
    );

  if (results.length === 0) {
    return null;
  }

  if (results.length > 1) {
    throw new Error(
      `Ambiguous hash: multiple cells match '${partialHash}' (found ${results.length} matches)`
    );
  }

  return results[0].id;
}

/**
 * Get stale issues (not updated in N days) - Drizzle implementation
 * 
 * CONVERTED TO DRIZZLE: Simple SELECT with WHERE, ORDER BY, LIMIT
 * No complex joins or CTEs
 */
export async function getStaleIssuesDrizzle(
  adapter: HiveAdapter,
  projectKey: string,
  days: number,
  options: StaleOptions = {},
): Promise<Cell[]> {
  const db = getHiveDrizzle(await adapter.getDatabase());

  // Calculate cutoff timestamp (days ago)
  const cutoffTimestamp = Date.now() - days * 24 * 60 * 60 * 1000;

  // Build WHERE conditions
  const conditions = [
    eq(beads.project_key, projectKey),
    sql`${beads.status} != 'closed'`,
    isNull(beads.deleted_at),
    sql`${beads.updated_at} < ${cutoffTimestamp}`,
  ];

  // Optional status filter
  if (options.status) {
    conditions.push(eq(beads.status, options.status));
  }

  // Build and execute query
  const baseQuery = db
    .select()
    .from(beads)
    .where(and(...conditions))
    .orderBy(beads.updated_at);

  // Apply limit if specified
  const results = options.limit
    ? await baseQuery.limit(options.limit)
    : await baseQuery;

  // Cast to Cell[] - Drizzle returns compatible shape
  return results as unknown as Cell[];
}

/**
 * Get counts by type (Drizzle implementation)
 * 
 * CONVERTED TO DRIZZLE: Simple GROUP BY query
 * Used as part of getStatistics
 */
export async function getCountsByTypeDrizzle(
  adapter: HiveAdapter,
  projectKey: string,
): Promise<Record<string, number>> {
  const db = getHiveDrizzle(await adapter.getDatabase());

  const results = await db
    .select({
      type: beads.type,
      count: count(),
    })
    .from(beads)
    .where(
      and(
        eq(beads.project_key, projectKey),
        isNull(beads.deleted_at)
      )
    )
    .groupBy(beads.type);

  const byType: Record<string, number> = {};
  for (const row of results) {
    byType[row.type] = row.count;
  }
  
  return byType;
}

/**
 * Get basic status counts (Drizzle implementation)
 * 
 * CONVERTED TO DRIZZLE: Simple aggregation with CASE
 * Used as part of getStatistics
 */
export async function getStatusCountsDrizzle(
  adapter: HiveAdapter,
  projectKey: string,
): Promise<{
  total: number;
  open: number;
  in_progress: number;
  closed: number;
}> {
  const db = getHiveDrizzle(await adapter.getDatabase());

  const result = await db
    .select({
      total: count(),
      open: count(sql`CASE WHEN ${beads.status} = 'open' THEN 1 END`),
      in_progress: count(sql`CASE WHEN ${beads.status} = 'in_progress' THEN 1 END`),
      closed: count(sql`CASE WHEN ${beads.status} = 'closed' THEN 1 END`),
    })
    .from(beads)
    .where(
      and(
        eq(beads.project_key, projectKey),
        isNull(beads.deleted_at)
      )
    );

  const counts = result[0] || { total: 0, open: 0, in_progress: 0, closed: 0 };
  
  return {
    total: counts.total,
    open: counts.open,
    in_progress: counts.in_progress,
    closed: counts.closed,
  };
}
