/**
 * Legacy Hive Schema Transformer
 *
 * Converts old .hive/swarm-mail.db schema to modern global swarm.db schema.
 *
 * ## Context
 * The .hive/swarm-mail.db contains 519 historical issues from Dec 7-17 2025 that are NOT
 * in the global database. These have bd-lf2p4u-* IDs and need to be migrated to preserve
 * project history.
 *
 * ## Schema Differences
 *
 * **Old Schema (in .hive/swarm-mail.db):**
 * - `issues` table with ISO8601 timestamps (TEXT)
 * - No project_key, created_by, deleted_at fields
 * - `events` table with issue_id reference
 * - `dependencies` table with issue_id references
 *
 * **New Schema (in global swarm.db):**
 * - `beads` table with epoch milliseconds timestamps (BIGINT)
 * - Requires project_key, has created_by, deleted_at fields
 * - `cell_events` table with cell_id reference (note: cell_id, not bead_id)
 * - `bead_dependencies` table with cell_id references
 *
 * ## Usage Examples
 *
 * ### Transform Individual Records
 * ```typescript
 * import { transformIssue, transformEvent, transformDependency } from 'swarm-mail';
 *
 * // Transform a single issue
 * const legacyIssue = {
 *   id: "bd-lf2p4u-abc123",
 *   title: "Fix auth bug",
 *   type: "bug",
 *   status: "closed",
 *   created_at: "2025-12-15T10:30:00.000Z",
 *   // ... other fields
 * };
 *
 * const newBead = transformIssue(legacyIssue, '/Users/joel/Code/joelhooks/opencode-swarm-plugin');
 * // newBead.created_at is now epoch milliseconds
 * // newBead.project_key is "/Users/joel/Code/joelhooks/opencode-swarm-plugin"
 * // newBead.created_by is "HistoricalImport"
 *
 * // Transform an event
 * const legacyEvent = {
 *   id: 1,
 *   issue_id: "bd-lf2p4u-abc123",
 *   event_type: "status_changed",
 *   payload: JSON.stringify({ old: "open", new: "closed" }),
 *   created_at: "2025-12-15T11:00:00.000Z",
 * };
 *
 * const newEvent = transformEvent(legacyEvent);
 * // newEvent.cell_id is "bd-lf2p4u-abc123" (note: cell_id, not bead_id)
 * // newEvent.created_at is epoch milliseconds
 * ```
 *
 * ### Full Database Migration (Planned)
 * ```typescript
 * import { migrateLegacyHive, getSwarmMailLibSQL } from 'swarm-mail';
 *
 * const globalDb = await getSwarmMailLibSQL();
 * const summary = await migrateLegacyHive(
 *   '/Users/joel/Code/joelhooks/opencode-swarm-plugin/.hive/swarm-mail.db',
 *   globalDb,
 *   '/Users/joel/Code/joelhooks/opencode-swarm-plugin'
 * );
 *
 * console.log(`Migrated ${summary.beads.migrated} beads`);
 * console.log(`Migrated ${summary.events.migrated} events`);
 * console.log(`Migrated ${summary.dependencies.migrated} dependencies`);
 * if (summary.errors.length > 0) {
 *   console.error('Migration errors:', summary.errors);
 * }
 * ```
 *
 * @module migrations/legacy-hive-transformer
 */

import type { NewBead, NewCellEvent, NewBeadDependency } from "../db/schema/hive.js";

/**
 * Legacy issue schema (from .hive/swarm-mail.db)
 */
export interface LegacyIssue {
	id: string; // bd-lf2p4u-* format
	title: string;
	description: string | null;
	type: "task" | "bug" | "feature" | "epic" | "chore";
	status: "open" | "in_progress" | "blocked" | "closed";
	priority: number; // 0-3
	created_at: string; // ISO8601 timestamp
	updated_at: string; // ISO8601 timestamp
	parent_id: string | null;
	closed_at: string | null; // ISO8601 timestamp
	close_reason: string | null;
}

/**
 * Legacy event schema (from .hive/swarm-mail.db)
 */
export interface LegacyEvent {
	id: number; // Autoincrement
	issue_id: string; // References issues.id
	event_type: string;
	payload: string; // JSON string
	created_at: string; // ISO8601 timestamp
}

/**
 * Legacy dependency schema (from .hive/swarm-mail.db)
 */
export interface LegacyDependency {
	issue_id: string; // The blocked issue
	depends_on_id: string; // The blocking issue
	relationship: string; // "blocks", "related", etc.
	created_at: string; // ISO8601 timestamp
}

/**
 * Transform ISO8601 timestamp string to epoch milliseconds
 *
 * @param iso8601 - ISO8601 timestamp string (e.g., "2025-12-15T10:30:00.000Z")
 * @returns Epoch milliseconds (BIGINT)
 */
function iso8601ToEpochMs(iso8601: string): number {
	return new Date(iso8601).getTime();
}

/**
 * Transform legacy issue to modern bead
 *
 * Maps fields from old `issues` table to new `beads` table:
 * - Converts ISO8601 timestamps to epoch milliseconds
 * - Adds project_key (from project path)
 * - Adds created_by = "HistoricalImport"
 * - Preserves original ID (bd-lf2p4u-* format)
 *
 * @param issue - Legacy issue record
 * @param projectPath - Project path to use as project_key
 * @returns Transformed bead ready for insertion
 */
export function transformIssue(issue: LegacyIssue, projectPath: string): NewBead {
	return {
		id: issue.id,
		project_key: projectPath,
		type: issue.type,
		status: issue.status,
		title: issue.title,
		description: issue.description,
		priority: issue.priority,
		parent_id: issue.parent_id,
		assignee: null,
		created_at: iso8601ToEpochMs(issue.created_at),
		updated_at: iso8601ToEpochMs(issue.updated_at),
		closed_at: issue.closed_at ? iso8601ToEpochMs(issue.closed_at) : null,
		closed_reason: issue.close_reason,
		deleted_at: null,
		deleted_by: null,
		delete_reason: null,
		created_by: "HistoricalImport",
	};
}

/**
 * Transform legacy event to modern bead event
 *
 * Maps fields from old `events` table to new `bead_events` table:
 * - Converts ISO8601 timestamp to epoch milliseconds
 * - Maps issue_id → bead_id
 * - Preserves event_type and payload
 *
 * @param event - Legacy event record
 * @returns Transformed bead event ready for insertion
 */
export function transformEvent(event: LegacyEvent): Omit<NewCellEvent, "created_at"> & { created_at: number } {
	return {
		id: event.id,
		cell_id: event.issue_id, // Map issue_id → bead_id
		event_type: event.event_type,
		payload: event.payload,
		created_at: iso8601ToEpochMs(event.created_at),
	};
}

/**
 * Transform legacy dependency to modern bead dependency
 *
 * Maps fields from old `dependencies` table to new `bead_dependencies` table:
 * - Converts ISO8601 timestamp to epoch milliseconds
 * - Maps issue_id → bead_id
 * - Adds created_by = "HistoricalImport"
 *
 * @param dep - Legacy dependency record
 * @returns Transformed bead dependency ready for insertion
 */
export function transformDependency(dep: LegacyDependency): NewBeadDependency {
	return {
		cell_id: dep.issue_id, // Map issue_id → bead_id
		depends_on_id: dep.depends_on_id,
		relationship: dep.relationship,
		created_at: iso8601ToEpochMs(dep.created_at),
		created_by: "HistoricalImport",
	};
}

/**
 * Migration result summary
 */
export interface MigrationSummary {
	beads: { migrated: number; skipped: number; failed: number };
	events: { migrated: number; skipped: number; failed: number };
	dependencies: { migrated: number; skipped: number; failed: number };
	errors: string[];
}

/**
 * Migrate legacy hive database to modern global database
 *
 * **Full migration workflow:**
 * 1. Open legacy database at legacyDbPath (.hive/swarm-mail.db)
 * 2. Read all issues, events, dependencies
 * 3. Transform each to modern schema
 * 4. Insert into global database (passed as parameter)
 * 5. Return migration summary
 *
 * **Note:** This function signature is stubbed. Implementation requires:
 * - libSQL client for reading legacy database
 * - Drizzle ORM for inserting into global database
 * - Transaction handling for atomicity
 * - Error handling for partial failures
 *
 * @param legacyDbPath - Path to legacy .hive/swarm-mail.db
 * @param globalDb - Drizzle database instance for global swarm.db
 * @param projectPath - Project path to use as project_key
 * @returns Migration summary with counts and errors
 *
 * @example
 * ```typescript
 * import { migrateLegacyHive } from './legacy-hive-transformer';
 * import { getSwarmMailLibSQL } from '../libsql';
 *
 * const globalDb = getSwarmMailLibSQL();
 * const summary = await migrateLegacyHive(
 *   '/path/to/.hive/swarm-mail.db',
 *   globalDb,
 *   '/path/to/project'
 * );
 *
 * console.log(`Migrated ${summary.beads.migrated} beads`);
 * ```
 */
export async function migrateLegacyHive(
	legacyDbPath: string,
	// biome-ignore lint/suspicious/noExplicitAny: Database type depends on Drizzle ORM setup
	globalDb: any,
	projectPath: string
): Promise<MigrationSummary> {
	// TODO: Implement database migration
	// This requires:
	// 1. Open legacy database with libSQL client
	// 2. Query all issues, events, dependencies
	// 3. Transform using transformIssue, transformEvent, transformDependency
	// 4. Insert into globalDb using Drizzle ORM
	// 5. Handle transaction rollback on errors
	// 6. Return summary

	throw new Error("migrateLegacyHive not yet implemented - see function JSDoc for design");
}
