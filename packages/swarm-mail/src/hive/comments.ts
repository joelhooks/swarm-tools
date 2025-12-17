/**
 * Comment Operations
 *
 * Comment management with threading support.
 * Comments can have parent_id for nested discussions.
 *
 * Reference: steveyegge/beads/internal/storage/sqlite/comments.go
 *
 * @module beads/comments
 */

import type { DatabaseAdapter } from "../types/database.js";
import type { CellComment } from "../types/hive-adapter.js";

/**
 * Get a specific comment by ID
 */
export async function getCommentById(
  db: DatabaseAdapter,
  commentId: number,
): Promise<CellComment | null> {
  const result = await db.query<CellComment>(
    `SELECT * FROM bead_comments WHERE id = $1`,
    [commentId],
  );
  return result.rows[0] ?? null;
}

/**
 * Get comment thread (comment + all replies)
 */
export async function getCommentThread(
  db: DatabaseAdapter,
  rootCommentId: number,
): Promise<CellComment[]> {
  const result = await db.query<CellComment>(
    `WITH RECURSIVE thread AS (
       -- Root comment
       SELECT * FROM bead_comments WHERE id = $1
       
       UNION
       
       -- Replies
       SELECT c.* FROM bead_comments c
       JOIN thread t ON c.parent_id = t.id
     )
     SELECT * FROM thread ORDER BY created_at ASC`,
    [rootCommentId],
  );
  return result.rows;
}
