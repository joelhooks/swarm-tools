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
// Debug Logging
// ============================================================================

export { log as debugLog } from "./debug";

// ============================================================================
// Core (database-agnostic)
// ============================================================================

export { createSwarmMailAdapter } from "./adapter";
export type {
	AgentAdapter,
	Conflict,
	DatabaseAdapter,
	EventStoreAdapter,
	InboxOptions,
	Message,
	MessagingAdapter,
	ReadEventsOptions,
	Reservation,
	ReservationAdapter,
	SchemaAdapter,
	SwarmMailAdapter,
} from "./types";

// ============================================================================
// LibSQL Adapter
// ============================================================================

export type { LibSQLConfig } from "./libsql";
export { createLibSQLAdapter } from "./libsql";

// LibSQL Convenience Layer
export {
	closeAllSwarmMailLibSQL,
	closeAllSwarmMailLibSQL as closeAllSwarmMail, // Alias for backward compatibility
	closeSwarmMailLibSQL,
	createInMemorySwarmMailLibSQL,
	createInMemorySwarmMailLibSQL as createInMemorySwarmMail, // Alias for backward compatibility
	getDatabasePath as getLibSQLDatabasePath,
	getProjectTempDirName as getLibSQLProjectTempDirName,
	getSwarmMailLibSQL,
	hashProjectPath as hashLibSQLProjectPath,
} from "./libsql.convenience";
export {
	createLibSQLMemorySchema,
	dropLibSQLMemorySchema,
	EMBEDDING_DIM as LIBSQL_EMBEDDING_DIM,
	validateLibSQLMemorySchema,
} from "./memory/libsql-schema";
// LibSQL Schemas
export {
	createLibSQLStreamsSchema,
	dropLibSQLStreamsSchema,
	validateLibSQLStreamsSchema,
} from "./streams/libsql-schema";

// ============================================================================
// Streams Module Exports
// ============================================================================

// Re-export checkSwarmHealth from correct location
export { checkHealth as checkSwarmHealth } from "./streams/agent-mail";

// Auto-migration (project DB → global DB)
export {
	backupOldDb,
	detectSourceType,
	getGlobalDbPath,
	migrateLibSQLToGlobal,
	migratePGLiteToGlobal,
	migrateProjectToGlobal,
	needsMigration,
} from "./streams/auto-migrate";
export type {
	MigrationResult as AutoMigrationResult,
	MigrationStats as AutoMigrationStats,
	SourceType,
} from "./streams/auto-migrate";
export type {
	DecompositionGeneratedEvent,
	MailSessionState,
	SubtaskOutcomeEvent,
} from "./streams/events";
// Event types and creation (from events.ts)
export { createEvent } from "./streams/events";
// Event store primitives (now using Drizzle via wrapper functions)
// Projections (now using Drizzle via wrapper functions)
export {
	appendEvent,
	clearAdapterCache,
	getActiveReservations,
	getAgent,
	getEvalRecords,
	getEvalStats,
	getOldProjectDbPaths,
	readEvents,
} from "./streams/index";
export type { EvalRecord } from "./streams/projections-drizzle";
// Swarm Mail functions
export {
	acknowledgeSwarmMessage,
	checkSwarmHealth as checkSwarmMailHealth,
	getSwarmInbox,
	initSwarmAgent,
	readSwarmMessage,
	releaseSwarmFiles,
	reserveSwarmFiles,
	sendSwarmMessage,
} from "./streams/swarm-mail";

// ============================================================================
// Analytics Module Exports
// ============================================================================

// Event-sourcing analytics (queries 1-10 from analytics/)
export {
	agentActivity,
	checkpointFrequency,
	failedDecompositions,
	formatCSV,
	formatJSON,
	formatJSONL,
	formatTable,
	humanFeedback,
	lockContention,
	messageLatency,
	QueryBuilder,
	recoverySuccess,
	scopeViolations,
	strategySuccessRates,
	taskDuration,
} from "./analytics/index.js";
export type {
	AgentActivityFilters,
	FailedDecompositionsFilters,
	LockContentionFilters,
	MessageLatencyFilters,
	OutputFormat,
	QueryResult,
	StrategySuccessRatesFilters,
} from "./analytics/index.js";

// Four Golden Signals analytics (new root-level module)
export { ANALYTICS_QUERIES, runAnalyticsQuery } from "./analytics.js";

// AnalyticsQuery type (from query-builder module)
export type { AnalyticsQuery } from "./analytics/types.js";

// ============================================================================
// Hive Module Exports (work item tracking)
// ============================================================================

export * from "./hive";

// ============================================================================
// Memory Module Exports (semantic memory store)
// ============================================================================

export { createMemoryAdapter } from "./memory/adapter";
export type {
	MigrationOptions,
	MigrationResult,
} from "./memory/migrate-legacy";
export {
	getDefaultLegacyPath,
	getMigrationStatus,
	legacyDatabaseExists,
	migrateLegacyMemories,
	targetHasMemories,
} from "./memory/migrate-legacy";
export {
	memoryMigration,
	memoryMigrations,
} from "./memory/migrations";
export type { MemoryConfig } from "./memory/ollama";
export {
	getDefaultConfig,
	makeOllamaLive,
	Ollama,
	OllamaError,
} from "./memory/ollama";
export type {
	Memory,
	SearchOptions,
	SearchResult,
} from "./memory/store";
export {
	createMemoryStore,
	EMBEDDING_DIM,
} from "./memory/store";
export type {
	ExportOptions as MemoryExportOptions,
	ImportOptions as MemoryImportOptions,
	MemoryExport,
	MemoryImportResult,
} from "./memory/sync";
// Memory sync (JSONL export/import for git)
export {
	exportMemories,
	importMemories,
	parseMemoryJSONL,
	serializeMemoryToJSONL,
	syncMemories,
} from "./memory/sync";

// Memory test utilities
export { createTestMemoryDb } from "./memory/test-utils";

// ============================================================================
// Drizzle Database Client (for memory store)
// ============================================================================

export type { SwarmDb } from "./db";
export { closeDb, createInMemoryDb, getDb } from "./db";
export { createDrizzleClient } from "./db/drizzle";
export { withSqliteRetry } from "./db/retry";
export { toDrizzleDb, toSwarmDb } from "./libsql.convenience";

// ============================================================================
// PGlite → libSQL Migration
// ============================================================================

export {
	type MigrationOptions as PGliteMigrationOptions,
	type MigrationResult as PGliteMigrationResult,
	migratePGliteToLibSQL,
	pgliteExists,
} from "./migrate-pglite-to-libsql";
