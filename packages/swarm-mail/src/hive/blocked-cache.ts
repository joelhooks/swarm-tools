/**
 * Blocked Beads Cache Management
 *
 * Convenience re-exports for blocked cache operations.
 * The actual implementation is in dependencies.ts to avoid circular dependencies.
 *
 * ## Cache Strategy
 * - blocked_beads_cache table stores cell_id → blocker_ids[]
 * - Rebuilt when dependencies change or bead status changes
 * - Enables fast "ready work" queries without recursive CTEs
 *
 * ## Performance
 * - Cache rebuild: <50ms for typical projects
 * - Ready work query: 25x faster with cache (752ms → 29ms on 10K beads)
 *
 * Reference: steveyegge/beads/internal/storage/sqlite/blocked_cache.go
 *
 * @module beads/blocked-cache
 */

export {
  rebuildBeadBlockedCache,
  rebuildAllBlockedCaches,
  invalidateBlockedCache,
} from "./dependencies.js";
