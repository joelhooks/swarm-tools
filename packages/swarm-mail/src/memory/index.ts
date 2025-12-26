/**
 * Memory Module - Semantic memory with vector embeddings
 *
 * Provides Ollama-based embedding generation and memory storage.
 */

// High-level adapter (primary API)
export {
	createMemoryAdapter,
	type FindOptions,
	type HealthStatus,
	type Memory,
	type MemoryConfig,
	type SearchResult,
	type StoreOptions,
} from "./adapter.js";

// Low-level services (advanced usage)
export {
	getDefaultConfig,
	makeOllamaLive,
	Ollama,
	OllamaError,
} from "./ollama.js";

export { createMemoryStore, EMBEDDING_DIM } from "./store.js";

// Auto-tagging (LLM-based tag generation)
export {
	generateTags,
	type AutoTagConfig,
	type AutoTagResult,
} from "./auto-tagger.js";

// Migrations
export { 
	memoryMigration, 
	memoryMigrations,
	repairStaleEmbeddings,
	type RepairStats,
	type OllamaEmbedder,
} from "./migrations.js";

// Legacy migration tool
export {
	getDefaultLegacyPath,
	getMigrationStatus,
	legacyDatabaseExists,
	migrateLegacyMemories,
	type MigrationOptions,
	type MigrationResult,
} from "./migrate-legacy.js";

// Git sync (JSONL export/import)
export {
	exportMemories,
	importMemories,
	syncMemories,
	parseMemoryJSONL,
	serializeMemoryToJSONL,
	type ExportOptions as MemoryExportOptions,
	type ImportOptions as MemoryImportOptions,
	type MemoryExport,
	type MemoryImportResult,
} from "./sync.js";
