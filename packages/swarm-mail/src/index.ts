/**
 * Swarm Mail - Actor-model primitives for multi-agent coordination
 *
 * ## Simple API (PGLite convenience layer)
 * ```typescript
 * import { getSwarmMail } from '@opencode/swarm-mail';
 * const swarmMail = await getSwarmMail('/path/to/project');
 * ```
 *
 * ## Advanced API (database-agnostic adapter)
 * ```typescript
 * import { createSwarmMailAdapter } from '@opencode/swarm-mail';
 * const db = createCustomDbAdapter({ path: './custom.db' });
 * const swarmMail = createSwarmMailAdapter(db, '/path/to/project');
 * ```
 */

export const SWARM_MAIL_VERSION = "0.1.0";

// ============================================================================
// Core (database-agnostic)
// ============================================================================

export { createSwarmMailAdapter } from "./adapter";
export type {
  DatabaseAdapter,
  SwarmMailAdapter,
  EventStoreAdapter,
  AgentAdapter,
  MessagingAdapter,
  ReservationAdapter,
  SchemaAdapter,
  ReadEventsOptions,
  InboxOptions,
  Message,
  Reservation,
  Conflict,
} from "./types";

// ============================================================================
// PGLite Convenience Layer
// ============================================================================

export {
  getSwarmMail,
  createInMemorySwarmMail,
  closeSwarmMail,
  closeAllSwarmMail,
  getDatabasePath,
  PGlite,
} from "./pglite";

// ============================================================================
// Re-export everything from streams for backward compatibility
// ============================================================================

export * from "./streams";

// ============================================================================
// Hive Module Exports (work item tracking)
// ============================================================================

export * from "./hive";
