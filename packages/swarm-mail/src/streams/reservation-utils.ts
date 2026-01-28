/**
 * Reservation utility functions
 *
 * Extracted common patterns for reservation management to reduce duplication.
 */

import { and, eq, sql } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import { reservationsTable } from "../db/schema/streams.js";

/**
 * Clean up expired reservations by marking them as released.
 *
 * DEFENSIVE: Auto-releases expired reservations to prevent stale locks.
 * This is idempotent and safe to call multiple times.
 *
 * @param db - Drizzle database instance
 * @param projectKey - Project key to filter reservations
 * @returns Number of expired reservations cleaned up
 */
export async function cleanupExpiredReservations(
  db: SwarmDb,
  projectKey: string,
): Promise<number> {
  const now = Date.now();

  const result = await db
    .update(reservationsTable)
    .set({ released_at: now })
    .where(
      and(
        eq(reservationsTable.project_key, projectKey),
        sql`${reservationsTable.released_at} IS NULL`,
        sql`${reservationsTable.expires_at} < ${now}`,
      ),
    );

  // Drizzle update returns the number of affected rows
  return result.rowsAffected ?? 0;
}
