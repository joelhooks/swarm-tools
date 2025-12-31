/**
 * Auto-Migration Module - Project DB → Global DB
 *
 * Automatically migrates project-local databases (.opencode/streams.db or .opencode/streams/)
 * to the global database (~/.config/swarm-tools/swarm.db).
 *
 * ## Detection Functions
 * - needsMigration() - fast fs.existsSync check for project DB
 * - getGlobalDbPath() - returns ~/.config/swarm-tools/swarm.db
 * - detectSourceType() - returns 'libsql' | 'pglite' | 'none'
 *
 * ## Migration Functions
 * - migrateProjectToGlobal() - orchestrates full migration
 * - migrateLibSQLToGlobal() - migrates libSQL → global DB
 * - migratePGLiteToGlobal() - migrates PGlite → global DB (delegates to existing migrator)
 * - backupOldDb() - renames old DB with timestamp
 *
 * ## Tables Migrated
 * Streams: events, agents, messages, message_recipients, reservations, cursors, locks
 * Hive: beads, bead_dependencies, bead_labels, bead_comments, blocked_beads_cache, dirty_beads
 * Learning: eval_records, swarm_contexts, deferred
 *
 * ## Error Handling
 * - Handles missing tables gracefully (old DBs may not have all tables)
 * - Uses INSERT OR IGNORE for idempotency
 * - Atomic operations where possible
 *
 * @module streams/auto-migrate
 */

import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLibSQLAdapter } from "../libsql.js";
import { migratePGliteToLibSQL } from "../migrate-pglite-to-libsql.js";
import { createLibSQLStreamsSchema } from "./libsql-schema.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Source database type
 */
export type SourceType = "libsql" | "pglite" | "none";

/**
 * Migration statistics for a single table
 */
export interface TableMigrationStats {
	/** Number of rows migrated */
	migrated: number;
	/** Number of rows skipped (already exist) */
	skipped: number;
	/** Number of rows that failed */
	failed: number;
}

/**
 * Migration statistics for all tables
 */
export interface MigrationStats {
	// Streams subsystem
	events: number;
	agents: number;
	messages: number;
	messageRecipients: number;
	reservations: number;
	cursors: number;
	locks: number;

	// Hive subsystem
	beads: number;
	beadDependencies: number;
	beadLabels: number;
	beadComments: number;
	blockedBeadsCache: number;
	dirtyBeads: number;

	// Learning subsystem
	evalRecords: number;
	swarmContexts: number;
	deferred: number;

	/** Any errors encountered during migration */
	errors: string[];
}

/**
 * Result of full project migration
 */
export interface MigrationResult {
	/** Source database type */
	sourceType: SourceType;
	/** Migration statistics */
	stats: MigrationStats;
	/** Path to backup of old database */
	backupPath: string;
	/** Path to global database */
	globalDbPath: string;
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Check if project needs migration
 *
 * Fast fs.existsSync check for project-local database.
 *
 * @param projectPath - absolute path to project root
 * @returns true if project has local DB (libSQL or PGlite)
 *
 * @example
 * ```typescript
 * if (needsMigration("/path/to/project")) {
 *   await migrateProjectToGlobal("/path/to/project");
 * }
 * ```
 */
export function needsMigration(projectPath: string): boolean {
	const libsqlPath = join(projectPath, ".opencode", "streams.db");
	const pglitePath = join(projectPath, ".opencode", "streams");

	return existsSync(libsqlPath) || existsSync(pglitePath);
}

/**
 * Get global database path
 *
 * @returns ~/.config/swarm-tools/swarm.db
 */
export function getGlobalDbPath(): string {
	return join(homedir(), ".config", "swarm-tools", "swarm.db");
}

/**
 * Detect source database type
 *
 * @param projectPath - absolute path to project root
 * @returns 'libsql' | 'pglite' | 'none'
 */
export function detectSourceType(projectPath: string): SourceType {
	const libsqlPath = join(projectPath, ".opencode", "streams.db");
	const pglitePath = join(projectPath, ".opencode", "streams");

	if (existsSync(libsqlPath)) {
		return "libsql";
	}

	if (existsSync(pglitePath)) {
		// Check for PG_VERSION file to confirm it's PGlite
		const pgVersionPath = join(pglitePath, "PG_VERSION");
		if (existsSync(pgVersionPath)) {
			return "pglite";
		}
	}

	return "none";
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Migrate project database to global database
 *
 * Orchestrates full migration:
 * 1. Detect source type
 * 2. Call appropriate migrator
 * 3. Backup old DB
 * 4. Return stats
 *
 * @param projectPath - absolute path to project root
 * @param globalDbPath - path to global database (defaults to ~/.config/swarm-tools/swarm.db)
 * @returns migration result with stats and backup path
 *
 * @throws Error if migration fails
 *
 * @example
 * ```typescript
 * const result = await migrateProjectToGlobal("/path/to/project");
 * console.log(`Migrated ${result.stats.events} events`);
 * console.log(`Backup at ${result.backupPath}`);
 * ```
 */
export async function migrateProjectToGlobal(
	projectPath: string,
	globalDbPath: string = getGlobalDbPath(),
): Promise<MigrationResult> {
	const sourceType = detectSourceType(projectPath);

	if (sourceType === "none") {
		throw new Error(`No database found at ${projectPath}/.opencode`);
	}

	// Ensure global DB schema exists
	const globalAdapter = await createLibSQLAdapter({ url: `file:${globalDbPath}` });
	await createLibSQLStreamsSchema(globalAdapter);
	if (globalAdapter.close) {
		await globalAdapter.close();
	}

	// Create global DB client for migration
	const globalDb = createClient({ url: `file:${globalDbPath}` });

	let stats: MigrationStats;
	let sourcePath: string;

	if (sourceType === "libsql") {
		sourcePath = join(projectPath, ".opencode", "streams.db");
		stats = await migrateLibSQLToGlobal(sourcePath, globalDb);
	} else {
		// PGlite
		sourcePath = join(projectPath, ".opencode", "streams");
		stats = await migratePGLiteToGlobal(sourcePath, globalDb);
	}

	globalDb.close();

	// Backup old DB
	const backupPath = backupOldDb(sourcePath);

	return {
		sourceType,
		stats,
		backupPath,
		globalDbPath,
	};
}

/**
 * Migrate libSQL database to global database
 *
 * Migrates all tables from source libSQL DB to global DB using INSERT OR IGNORE.
 * Handles missing tables gracefully (old DBs may not have all tables).
 *
 * ## Tables Migrated
 * - Streams: events, agents, messages, message_recipients, reservations, cursors, locks
 * - Hive: beads, bead_dependencies, bead_labels, bead_comments, blocked_beads_cache, dirty_beads
 * - Learning: eval_records, swarm_contexts, deferred
 *
 * @param sourcePath - absolute path to source streams.db
 * @param globalDb - libSQL client for global database
 * @returns migration statistics
 *
 * @example
 * ```typescript
 * const globalDb = createClient({ url: "file:~/.config/swarm-tools/swarm.db" });
 * const stats = await migrateLibSQLToGlobal("/project/.opencode/streams.db", globalDb);
 * ```
 */
export async function migrateLibSQLToGlobal(
	sourcePath: string,
	globalDb: Client,
): Promise<MigrationStats> {
	const stats: MigrationStats = {
		events: 0,
		agents: 0,
		messages: 0,
		messageRecipients: 0,
		reservations: 0,
		cursors: 0,
		locks: 0,
		beads: 0,
		beadDependencies: 0,
		beadLabels: 0,
		beadComments: 0,
		blockedBeadsCache: 0,
		dirtyBeads: 0,
		evalRecords: 0,
		swarmContexts: 0,
		deferred: 0,
		errors: [],
	};

	// Open source DB
	const sourceDb = createClient({ url: `file:${sourcePath}` });

	// Get list of tables in source DB
	const tablesResult = await sourceDb.execute(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `);

	const tableNames = new Set(
		tablesResult.rows.map((row) => row.name as string),
	);

	// Migrate each table if it exists
	// Streams subsystem
	if (tableNames.has("events")) {
		stats.events = await migrateTable(
			sourceDb,
			globalDb,
			"events",
			"id, type, project_key, timestamp, data, created_at", // Exclude 'sequence' - it's GENERATED
			stats.errors,
		);
	}

	if (tableNames.has("agents")) {
		stats.agents = await migrateTable(
			sourceDb,
			globalDb,
			"agents",
			"id, project_key, name, program, model, task_description, registered_at, last_active_at",
			stats.errors,
		);
	}

	if (tableNames.has("messages")) {
		stats.messages = await migrateTable(
			sourceDb,
			globalDb,
			"messages",
			"id, project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at",
			stats.errors,
		);
	}

	if (tableNames.has("message_recipients")) {
		stats.messageRecipients = await migrateTable(
			sourceDb,
			globalDb,
			"message_recipients",
			"message_id, agent_name, read_at, acked_at",
			stats.errors,
		);
	}

	if (tableNames.has("reservations")) {
		stats.reservations = await migrateTable(
			sourceDb,
			globalDb,
			"reservations",
			"id, project_key, agent_name, path_pattern, exclusive, reason, created_at, expires_at, released_at, lock_holder_id",
			stats.errors,
		);
	}

	if (tableNames.has("cursors")) {
		stats.cursors = await migrateTable(
			sourceDb,
			globalDb,
			"cursors",
			"id, stream, checkpoint, position, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("locks")) {
		stats.locks = await migrateTable(
			sourceDb,
			globalDb,
			"locks",
			"resource, holder, seq, acquired_at, expires_at",
			stats.errors,
		);
	}

	// Hive subsystem
	if (tableNames.has("beads")) {
		stats.beads = await migrateTable(
			sourceDb,
			globalDb,
			"beads",
			"id, project_key, type, status, title, description, priority, parent_id, assignee, created_at, updated_at, closed_at, closed_reason, deleted_at, deleted_by, delete_reason, created_by",
			stats.errors,
		);
	}

	if (tableNames.has("bead_dependencies")) {
		stats.beadDependencies = await migrateTable(
			sourceDb,
			globalDb,
			"bead_dependencies",
			"cell_id, depends_on_id, relationship, created_at, created_by",
			stats.errors,
		);
	}

	if (tableNames.has("bead_labels")) {
		stats.beadLabels = await migrateTable(
			sourceDb,
			globalDb,
			"bead_labels",
			"cell_id, label, created_at",
			stats.errors,
		);
	}

	if (tableNames.has("bead_comments")) {
		stats.beadComments = await migrateTable(
			sourceDb,
			globalDb,
			"bead_comments",
			"id, cell_id, author, body, parent_id, created_at, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("blocked_beads_cache")) {
		stats.blockedBeadsCache = await migrateTable(
			sourceDb,
			globalDb,
			"blocked_beads_cache",
			"cell_id, blocker_ids, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("dirty_beads")) {
		stats.dirtyBeads = await migrateTable(
			sourceDb,
			globalDb,
			"dirty_beads",
			"cell_id, marked_at",
			stats.errors,
		);
	}

	// Learning subsystem
	if (tableNames.has("eval_records")) {
		stats.evalRecords = await migrateTable(
			sourceDb,
			globalDb,
			"eval_records",
			"id, project_key, task, context, strategy, epic_title, subtasks, outcomes, overall_success, total_duration_ms, total_errors, human_accepted, human_modified, human_notes, file_overlap_count, scope_accuracy, time_balance_ratio, created_at, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("swarm_contexts")) {
		stats.swarmContexts = await migrateTable(
			sourceDb,
			globalDb,
			"swarm_contexts",
			"id, project_key, epic_id, bead_id, strategy, files, dependencies, directives, recovery, created_at, checkpointed_at, recovered_at, recovered_from_checkpoint, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("deferred")) {
		stats.deferred = await migrateTable(
			sourceDb,
			globalDb,
			"deferred",
			"id, url, resolved, value, error, expires_at, created_at",
			stats.errors,
		);
	}

	sourceDb.close();

	return stats;
}

/**
 * Migrate PGlite database to global database
 *
 * Delegates to existing migratePGliteToLibSQL() implementation.
 * Converts PGlite types (JSONB → JSON, SERIAL → INTEGER) automatically.
 *
 * @param sourcePath - absolute path to PGlite data directory
 * @param _globalDb - libSQL client for global database (unused - delegated to migrator)
 * @returns migration statistics
 */
export async function migratePGLiteToGlobal(
	sourcePath: string,
	_globalDb: Client,
): Promise<MigrationStats> {
	// Get global DB path from client (hacky but works)
	const globalDbPath = getGlobalDbPath();

	// Use existing PGlite migrator
	const result = await migratePGliteToLibSQL({
		pglitePath: sourcePath,
		libsqlPath: globalDbPath,
		dryRun: false,
	});

	// Convert to MigrationStats format
	return {
		events: result.events.migrated,
		agents: result.agents.migrated,
		messages: result.messages.migrated,
		messageRecipients: 0, // Not tracked separately in old migrator
		reservations: 0,
		cursors: 0,
		locks: 0,
		beads: result.beads.migrated,
		beadDependencies: 0,
		beadLabels: 0,
		beadComments: 0,
		blockedBeadsCache: 0,
		dirtyBeads: 0,
		evalRecords: 0,
		swarmContexts: 0,
		deferred: 0,
		errors: result.errors,
	};
}

/**
 * Migrate local libSQL database to global database
 *
 * Migrates all tables from local libSQL DB to global DB using INSERT OR IGNORE.
 * After successful migration, renames local DB to .migrated suffix.
 *
 * ## Idempotency
 * - Skips if .migrated file already exists
 * - Skips if local DB doesn't exist
 * - Safe to call multiple times
 *
 * ## Tables Migrated
 * - Streams: events, agents, messages, message_recipients, reservations, cursors, locks
 * - Hive: beads, bead_dependencies, bead_labels, bead_comments, blocked_beads_cache, dirty_beads
 * - Learning: eval_records, swarm_contexts, deferred
 *
 * @param localDbPath - absolute path to local database file
 * @param globalDbPath - absolute path to global database file
 * @returns migration statistics
 *
 * @example
 * ```typescript
 * const stats = await migrateLocalDbToGlobal(
 *   "/project/.opencode/streams.db",
 *   "~/.config/swarm-tools/swarm.db"
 * );
 * // Local DB renamed to /project/.opencode/streams.db.migrated
 * ```
 */
export async function migrateLocalDbToGlobal(
	localDbPath: string,
	globalDbPath: string,
): Promise<MigrationStats> {
	const stats: MigrationStats = {
		events: 0,
		agents: 0,
		messages: 0,
		messageRecipients: 0,
		reservations: 0,
		cursors: 0,
		locks: 0,
		beads: 0,
		beadDependencies: 0,
		beadLabels: 0,
		beadComments: 0,
		blockedBeadsCache: 0,
		dirtyBeads: 0,
		evalRecords: 0,
		swarmContexts: 0,
		deferred: 0,
		errors: [],
	};

	// Check if .migrated file already exists (skip if so)
	const migratedPath = `${localDbPath}.migrated`;
	if (existsSync(migratedPath)) {
		return stats; // Skip - already migrated
	}

	// Check if local DB exists (skip if not)
	if (!existsSync(localDbPath)) {
		return stats; // Skip - no local DB to migrate
	}

	// Open local and global databases
	const localDb = createClient({ url: `file:${localDbPath}` });
	const globalDb = createClient({ url: `file:${globalDbPath}` });

	// Get list of tables in local DB
	const tablesResult = await localDb.execute(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `);

	const tableNames = new Set(
		tablesResult.rows.map((row) => row.name as string),
	);

	// Migrate each table if it exists
	// Streams subsystem
	if (tableNames.has("events")) {
		stats.events = await migrateTable(
			localDb,
			globalDb,
			"events",
			"id, type, project_key, timestamp, data, created_at", // Exclude 'sequence' - it's GENERATED
			stats.errors,
		);
	}

	if (tableNames.has("agents")) {
		stats.agents = await migrateTable(
			localDb,
			globalDb,
			"agents",
			"id, project_key, name, program, model, task_description, registered_at, last_active_at",
			stats.errors,
		);
	}

	if (tableNames.has("messages")) {
		stats.messages = await migrateTable(
			localDb,
			globalDb,
			"messages",
			"id, project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at",
			stats.errors,
		);
	}

	if (tableNames.has("message_recipients")) {
		stats.messageRecipients = await migrateTable(
			localDb,
			globalDb,
			"message_recipients",
			"message_id, agent_name, read_at, acked_at",
			stats.errors,
		);
	}

	if (tableNames.has("reservations")) {
		stats.reservations = await migrateTable(
			localDb,
			globalDb,
			"reservations",
			"id, project_key, agent_name, path_pattern, exclusive, reason, created_at, expires_at, released_at, lock_holder_id",
			stats.errors,
		);
	}

	if (tableNames.has("cursors")) {
		stats.cursors = await migrateTable(
			localDb,
			globalDb,
			"cursors",
			"id, stream, checkpoint, position, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("locks")) {
		stats.locks = await migrateTable(
			localDb,
			globalDb,
			"locks",
			"resource, holder, seq, acquired_at, expires_at",
			stats.errors,
		);
	}

	// Hive subsystem
	if (tableNames.has("beads")) {
		stats.beads = await migrateTable(
			localDb,
			globalDb,
			"beads",
			"id, project_key, type, status, title, description, priority, parent_id, assignee, created_at, updated_at, closed_at, closed_reason, deleted_at, deleted_by, delete_reason, created_by",
			stats.errors,
		);
	}

	if (tableNames.has("bead_dependencies")) {
		stats.beadDependencies = await migrateTable(
			localDb,
			globalDb,
			"bead_dependencies",
			"cell_id, depends_on_id, relationship, created_at, created_by",
			stats.errors,
		);
	}

	if (tableNames.has("bead_labels")) {
		stats.beadLabels = await migrateTable(
			localDb,
			globalDb,
			"bead_labels",
			"cell_id, label, created_at",
			stats.errors,
		);
	}

	if (tableNames.has("bead_comments")) {
		stats.beadComments = await migrateTable(
			localDb,
			globalDb,
			"bead_comments",
			"id, cell_id, author, body, parent_id, created_at, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("blocked_beads_cache")) {
		stats.blockedBeadsCache = await migrateTable(
			localDb,
			globalDb,
			"blocked_beads_cache",
			"cell_id, blocker_ids, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("dirty_beads")) {
		stats.dirtyBeads = await migrateTable(
			localDb,
			globalDb,
			"dirty_beads",
			"cell_id, marked_at",
			stats.errors,
		);
	}

	// Learning subsystem
	if (tableNames.has("eval_records")) {
		stats.evalRecords = await migrateTable(
			localDb,
			globalDb,
			"eval_records",
			"id, project_key, task, context, strategy, epic_title, subtasks, outcomes, overall_success, total_duration_ms, total_errors, human_accepted, human_modified, human_notes, file_overlap_count, scope_accuracy, time_balance_ratio, created_at, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("swarm_contexts")) {
		stats.swarmContexts = await migrateTable(
			localDb,
			globalDb,
			"swarm_contexts",
			"id, project_key, epic_id, bead_id, strategy, files, dependencies, directives, recovery, created_at, checkpointed_at, recovered_at, recovered_from_checkpoint, updated_at",
			stats.errors,
		);
	}

	if (tableNames.has("deferred")) {
		stats.deferred = await migrateTable(
			localDb,
			globalDb,
			"deferred",
			"id, url, resolved, value, error, expires_at, created_at",
			stats.errors,
		);
	}

	localDb.close();
	globalDb.close();

	// After successful migration, rename local DB to .migrated
	renameSync(localDbPath, migratedPath);

	return stats;
}

/**
 * Backup old database
 *
 * Renames database file or directory with .backup-<ISO-timestamp> suffix.
 *
 * @param path - path to database file or directory
 * @returns path to backup
 *
 * @example
 * ```typescript
 * const backupPath = backupOldDb("/project/.opencode/streams.db");
 * // => "/project/.opencode/streams.db.backup-2025-12-21T10:30:00.000Z"
 * ```
 */
export function backupOldDb(path: string): string {
	if (!existsSync(path)) {
		throw new Error(`Database not found: ${path}`);
	}

	const timestamp = new Date().toISOString().replace(/:/g, "-"); // Windows-safe
	const backupPath = `${path}.backup-${timestamp}`;

	renameSync(path, backupPath);

	return backupPath;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Migrate a single table using INSERT OR IGNORE
 *
 * Dynamically queries source schema to handle missing columns gracefully.
 *
 * @param sourceDb - source database client
 * @param globalDb - global database client
 * @param tableName - name of table to migrate
 * @param targetColumns - comma-separated column names expected in global DB
 * @param errors - error accumulator
 * @returns number of rows migrated
 */
async function migrateTable(
	sourceDb: Client,
	globalDb: Client,
	tableName: string,
	targetColumns: string,
	errors: string[],
): Promise<number> {
	try {
		// Query source schema to see which columns actually exist
		const schemaResult = await sourceDb.execute(`PRAGMA table_info(${tableName})`);
		const sourceColumnNames = new Set(
			schemaResult.rows.map((row) => row.name as string),
		);

		// Filter target columns to only those that exist in source
		const targetColumnList = targetColumns.split(",").map((c) => c.trim());
		const columnList = targetColumnList.filter((col) =>
			sourceColumnNames.has(col),
		);

		if (columnList.length === 0) {
			// No compatible columns found - schema mismatch
			errors.push(
				`${tableName}: No compatible columns between source and target`,
			);
			return 0;
		}

		const columns = columnList.join(", ");

		// Read all rows from source (only columns that exist)
		const rows = await sourceDb.execute(`SELECT ${columns} FROM ${tableName}`);

		if (rows.rows.length === 0) {
			return 0;
		}

		// Generate placeholders for INSERT
		const placeholders = columnList.map(() => "?").join(", ");

		let migrated = 0;

		// Insert each row with INSERT OR IGNORE
		for (const row of rows.rows) {
			try {
				const values = columnList.map((col) => row[col]);

				const result = await globalDb.execute({
					sql: `INSERT OR IGNORE INTO ${tableName} (${columns}) VALUES (${placeholders})`,
					args: values,
				});

				// Only count as migrated if row was actually inserted
				// rowsAffected will be 0 if INSERT OR IGNORE skipped due to duplicate
				if (result.rowsAffected > 0) {
					migrated++;
				}
			} catch (err) {
				errors.push(
					`${tableName}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		return migrated;
	} catch (err) {
		// Table might not exist or have schema differences - that's OK
		errors.push(
			`${tableName} (table): ${err instanceof Error ? err.message : String(err)}`,
		);
		return 0;
	}
}
