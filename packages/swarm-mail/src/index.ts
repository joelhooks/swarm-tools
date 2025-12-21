/**
 * Swarm Mail - Actor-model primitives for multi-agent coordination
 *
 * ## Simple API (libSQL convenience layer)
 * ```typescript
 * import { getSwarmMailLibSQL } from '@opencode/swarm-mail';
 * const swarmMail = await getSwarmMailLibSQL('/path/to/project');
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
// LibSQL Adapter
// ============================================================================

export { createLibSQLAdapter } from "./libsql";
export type { LibSQLConfig } from "./libsql";

// LibSQL Convenience Layer
export {
  getSwarmMailLibSQL,
  createInMemorySwarmMailLibSQL,
  createInMemorySwarmMailLibSQL as createInMemorySwarmMail, // Alias for backward compatibility
  closeSwarmMailLibSQL,
  closeAllSwarmMailLibSQL,
  closeAllSwarmMailLibSQL as closeAllSwarmMail, // Alias for backward compatibility
  getDatabasePath as getLibSQLDatabasePath,
  getProjectTempDirName as getLibSQLProjectTempDirName,
  hashProjectPath as hashLibSQLProjectPath,
} from "./libsql.convenience";

// LibSQL Schemas
export {
  createLibSQLStreamsSchema,
  dropLibSQLStreamsSchema,
  validateLibSQLStreamsSchema,
} from "./streams/libsql-schema";
export {
  createLibSQLMemorySchema,
  dropLibSQLMemorySchema,
  validateLibSQLMemorySchema,
  EMBEDDING_DIM as LIBSQL_EMBEDDING_DIM,
} from "./memory/libsql-schema";

// ============================================================================
// Streams Module Exports (selective - avoid PGlite WASM loading)
// ============================================================================

// NOTE: We import from specific files under streams/, NOT from streams/index.ts
// to avoid triggering PGlite WASM loading at import time.

// Swarm Mail functions (legacy PGlite-based, deprecated - use adapter instead)
export {
  initSwarmAgent,
  sendSwarmMessage,
  getSwarmInbox,
  readSwarmMessage,
  reserveSwarmFiles,
  releaseSwarmFiles,
  acknowledgeSwarmMessage,
  checkSwarmHealth as checkSwarmMailHealth,
} from "./streams/swarm-mail";

// Event types and creation (from events.ts)
export { createEvent } from "./streams/events";
export type {
  MailSessionState,
  DecompositionGeneratedEvent,
  SubtaskOutcomeEvent,
} from "./streams/events";

// Event store primitives (now using Drizzle via wrapper functions)
export { appendEvent, readEvents } from "./streams/index";

// Projections (now using Drizzle via wrapper functions)
export {
  getAgent,
  getActiveReservations,
  getEvalRecords,
  getEvalStats,
} from "./streams/index";
export type { EvalRecord } from "./streams/projections-drizzle";

// Database management - LAZY LOADED via dynamic import to avoid WASM loading
// Users should call these functions, not import PGlite directly
export async function getDatabase(projectPath?: string) {
  const { getDatabase: getDb } = await import("./streams/index.js");
  return getDb(projectPath);
}

export async function closeDatabase(projectPath?: string) {
  const { closeDatabase: closeDb } = await import("./streams/index.js");
  return closeDb(projectPath);
}

export async function closeAllDatabases() {
  const { closeAllDatabases: closeAll } = await import("./streams/index.js");
  return closeAll();
}

export async function resetDatabase(projectPath?: string) {
  const { resetDatabase: reset } = await import("./streams/index.js");
  return reset(projectPath);
}

// Re-export checkSwarmHealth from correct location
export { checkHealth as checkSwarmHealth } from "./streams/agent-mail";

// ============================================================================
// Hive Module Exports (work item tracking)
// ============================================================================

export * from "./hive";



// ============================================================================
// Memory Module Exports (semantic memory store)
// ============================================================================

export {
  createMemoryStore,
  EMBEDDING_DIM,
} from "./memory/store";
export type {
  Memory,
  SearchResult,
  SearchOptions,
} from "./memory/store";

export { createMemoryAdapter } from "./memory/adapter";

export {
  Ollama,
  OllamaError,
  getDefaultConfig,
  makeOllamaLive,
} from "./memory/ollama";
export type { MemoryConfig } from "./memory/ollama";

export {
  memoryMigration,
  memoryMigrations,
} from "./memory/migrations";

export {
  legacyDatabaseExists,
  migrateLegacyMemories,
  getMigrationStatus,
  getDefaultLegacyPath,
  targetHasMemories,
} from "./memory/migrate-legacy";
export type {
  MigrationOptions,
  MigrationResult,
} from "./memory/migrate-legacy";

// Memory sync (JSONL export/import for git)
export {
  exportMemories,
  importMemories,
  syncMemories,
  parseMemoryJSONL,
  serializeMemoryToJSONL,
} from "./memory/sync";
export type {
  MemoryExport,
  MemoryImportResult,
  ExportOptions as MemoryExportOptions,
  ImportOptions as MemoryImportOptions,
} from "./memory/sync";

// Memory test utilities
export { createTestMemoryDb } from "./memory/test-utils";

// ============================================================================
// Drizzle Database Client (for memory store)
// ============================================================================

export { getDb, createInMemoryDb, closeDb } from "./db";
export { createDrizzleClient } from "./db/drizzle";
export type { SwarmDb } from "./db";
export { toSwarmDb, toDrizzleDb } from "./libsql.convenience";


// ============================================================================
// PGlite → libSQL Migration
// ============================================================================

export {
  migratePGliteToLibSQL,
  pgliteExists,
  type MigrationOptions as PGliteMigrationOptions,
  type MigrationResult as PGliteMigrationResult,
} from "./migrate-pglite-to-libsql";
