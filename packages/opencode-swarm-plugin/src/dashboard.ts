/**
 * Dashboard Data Layer
 * 
 * Provides read-only queries for swarm observability dashboard.
 * Data sources:
 * - libSQL events table (event sourcing)
 * - Hive cells (work items)
 * - Agent projections (agent states)
 * - Reservation projections (file locks)
 */

import type { DatabaseAdapter } from "swarm-mail";
import { getSwarmMailLibSQL } from "swarm-mail";

export interface WorkerStatus {
	agent_name: string;
	status: "idle" | "working" | "blocked";
	current_task?: string;
	last_activity: string;
}

export interface SubtaskProgress {
	bead_id: string;
	title: string;
	status: "open" | "in_progress" | "completed" | "blocked";
	progress_percent: number;
}

export interface FileLock {
	path: string;
	agent_name: string;
	reason: string;
	acquired_at: string;
	ttl_seconds: number;
}

export interface RecentMessage {
	id: number;
	from: string;
	to: string[];
	subject: string;
	timestamp: string;
	importance: "low" | "normal" | "high" | "urgent";
}

export interface EpicInfo {
	epic_id: string;
	title: string;
	subtask_count: number;
	completed_count: number;
}

/**
 * Get current status of all worker agents.
 * Derives status from latest events: task_started, progress_reported, task_blocked, etc.
 */
export async function getWorkerStatus(
	projectPath: string,
	options?: { project_key?: string },
): Promise<WorkerStatus[]> {
	const swarmMail = await getSwarmMailLibSQL(projectPath);
	const db = await swarmMail.getDatabase();
	// Query for latest task-related events per agent+bead, then pick primary status
	const query = `
		WITH latest_per_bead AS (
			SELECT 
				json_extract(data, '$.agent_name') as agent_name,
				json_extract(data, '$.bead_id') as bead_id,
				type,
				timestamp,
				ROW_NUMBER() OVER (
					PARTITION BY json_extract(data, '$.agent_name'), json_extract(data, '$.bead_id') 
					ORDER BY timestamp DESC
				) as rn
			FROM events
			WHERE type IN ('task_started', 'progress_reported', 'task_blocked', 'task_completed')
				AND json_extract(data, '$.agent_name') IS NOT NULL
				${options?.project_key ? "AND project_key = ?" : ""}
		),
		agent_latest_task AS (
			SELECT 
				agent_name,
				type,
				bead_id,
				timestamp,
				ROW_NUMBER() OVER (PARTITION BY agent_name ORDER BY 
					CASE 
						WHEN type IN ('task_started', 'progress_reported') THEN timestamp
						ELSE 0
					END DESC, 
					timestamp DESC
				) as priority_rn
			FROM latest_per_bead
			WHERE rn = 1
		)
		SELECT 
			agent_name,
			type,
			bead_id,
			MAX(timestamp) as last_activity
		FROM agent_latest_task
		WHERE priority_rn = 1
		GROUP BY agent_name, type, bead_id
	`;

	const params = options?.project_key ? [options.project_key] : [];
	const result = await db.query<{
		agent_name: string;
		type: string;
		bead_id: string | null;
		last_activity: number;
	}>(query, params);

	return result.rows.map((row) => {
		let status: "idle" | "working" | "blocked" = "idle";
		
		if (row.type === "task_blocked") {
			status = "blocked";
		} else if (row.type === "task_started" || row.type === "progress_reported") {
			status = "working";
		}

		return {
			agent_name: row.agent_name,
			status,
			current_task: row.bead_id ?? undefined,
			last_activity: new Date(row.last_activity).toISOString(),
		};
	});
}

/**
 * Get progress of all subtasks within an epic.
 * Returns completion percentage from progress_reported events.
 */
export async function getSubtaskProgress(
	projectPath: string,
	epic_id: string,
): Promise<SubtaskProgress[]> {
	const swarmMail = await getSwarmMailLibSQL(projectPath);
	const db = await swarmMail.getDatabase();
	// Get all subtasks from any task-related events matching epic prefix
	const query = `
		WITH all_tasks AS (
			SELECT DISTINCT
				json_extract(data, '$.bead_id') as bead_id,
				MIN(timestamp) as first_seen
			FROM events
			WHERE type IN ('task_started', 'progress_reported', 'task_blocked', 'task_completed')
				AND json_extract(data, '$.bead_id') LIKE ? || '.%'
			GROUP BY json_extract(data, '$.bead_id')
		),
		task_titles AS (
			SELECT DISTINCT
				json_extract(data, '$.bead_id') as bead_id,
				json_extract(data, '$.title') as title
			FROM events
			WHERE type IN ('task_started', 'task_blocked')
				AND json_extract(data, '$.bead_id') LIKE ? || '.%'
				AND json_extract(data, '$.title') IS NOT NULL
		),
		latest_status AS (
			SELECT 
				json_extract(data, '$.bead_id') as bead_id,
				type,
				json_extract(data, '$.status') as status,
				json_extract(data, '$.progress_percent') as progress_percent,
				ROW_NUMBER() OVER (PARTITION BY json_extract(data, '$.bead_id') ORDER BY timestamp DESC) as rn
			FROM events
			WHERE type IN ('task_started', 'progress_reported', 'task_blocked', 'task_completed')
				AND json_extract(data, '$.bead_id') LIKE ? || '.%'
		)
		SELECT 
			t.bead_id,
			COALESCE(tt.title, 'Unknown') as title,
			COALESCE(s.status, 'open') as status,
			COALESCE(CAST(s.progress_percent AS INTEGER), 0) as progress_percent
		FROM all_tasks t
		LEFT JOIN task_titles tt ON t.bead_id = tt.bead_id
		LEFT JOIN latest_status s ON t.bead_id = s.bead_id AND s.rn = 1
	`;

	const result = await db.query<{
		bead_id: string;
		title: string;
		status: string;
		progress_percent: number;
	}>(query, [epic_id, epic_id, epic_id]);

	return result.rows.map((row) => ({
		bead_id: row.bead_id,
		title: row.title,
		status: row.status as "open" | "in_progress" | "completed" | "blocked",
		progress_percent: row.progress_percent,
	}));
}

/**
 * Get currently active file reservations.
 * Excludes released reservations.
 */
export async function getFileLocks(
	projectPath: string,
	options?: { project_key?: string },
): Promise<FileLock[]> {
	const swarmMail = await getSwarmMailLibSQL(projectPath);
	const db = await swarmMail.getDatabase();
	// Query for active reservations (acquired but not released)
	const query = `
		WITH acquired AS (
			SELECT 
				json_extract(data, '$.path_pattern') as path,
				json_extract(data, '$.agent_name') as agent_name,
				json_extract(data, '$.reason') as reason,
				timestamp,
				json_extract(data, '$.ttl_seconds') as ttl_seconds
			FROM events
			WHERE type = 'reservation_acquired'
				${options?.project_key ? "AND project_key = ?" : ""}
		),
		released AS (
			SELECT DISTINCT
				json_extract(data, '$.path_pattern') as path,
				json_extract(data, '$.agent_name') as agent_name
			FROM events
			WHERE type = 'reservation_released'
				${options?.project_key ? "AND project_key = ?" : ""}
		)
		SELECT 
			a.path,
			a.agent_name,
			a.reason,
			a.timestamp,
			a.ttl_seconds
		FROM acquired a
		LEFT JOIN released r ON a.path = r.path AND a.agent_name = r.agent_name
		WHERE r.path IS NULL
	`;

	const params = options?.project_key ? [options.project_key, options.project_key] : [];
	const result = await db.query<{
		path: string;
		agent_name: string;
		reason: string;
		timestamp: number;
		ttl_seconds: number;
	}>(query, params);

	return result.rows.map((row) => ({
		path: row.path,
		agent_name: row.agent_name,
		reason: row.reason,
		acquired_at: new Date(row.timestamp).toISOString(),
		ttl_seconds: row.ttl_seconds,
	}));
}

/**
 * Get recent swarm mail messages, ordered by timestamp descending.
 * Defaults to limit of 10.
 */
export async function getRecentMessages(
	projectPath: string,
	options?: {
		limit?: number;
		thread_id?: string;
		importance?: "low" | "normal" | "high" | "urgent";
	},
): Promise<RecentMessage[]> {
	const swarmMail = await getSwarmMailLibSQL(projectPath);
	const db = await swarmMail.getDatabase();
	const limit = options?.limit ?? 10;
	
	// Build WHERE clause dynamically
	const whereClauses = ["type = 'message_sent'", "project_key = ?"];
	const params: (string | number)[] = [projectPath];
	
	if (options?.thread_id) {
		whereClauses.push("json_extract(data, '$.thread_id') = ?");
		params.push(options.thread_id);
	}
	
	if (options?.importance) {
		whereClauses.push("json_extract(data, '$.importance') = ?");
		params.push(options.importance);
	}
	
	params.push(limit);
	
	const query = `
		SELECT 
			id,
			json_extract(data, '$.from') as \`from\`,
			json_extract(data, '$.to') as to_json,
			json_extract(data, '$.subject') as subject,
			timestamp,
			json_extract(data, '$.importance') as importance
		FROM events
		WHERE ${whereClauses.join(" AND ")}
		ORDER BY timestamp DESC
		LIMIT ?
	`;

	const result = await db.query<{
		id: number;
		from: string;
		to_json: string;
		subject: string;
		timestamp: number;
		importance: string;
	}>(query, params);

	return result.rows.map((row) => ({
		id: row.id,
		from: row.from,
		to: JSON.parse(row.to_json),
		subject: row.subject,
		timestamp: new Date(row.timestamp).toISOString(),
		importance: row.importance as "low" | "normal" | "high" | "urgent",
	}));
}

/**
 * Get list of all epics with subtask counts.
 * Used for dashboard tabs/navigation.
 * 
 * Derives epic information from events when beads table doesn't exist (test mode).
 * In production, queries beads table directly.
 */
export async function getEpicList(
	projectPath: string,
	options?: { status?: "open" | "in_progress" | "completed" | "blocked" },
): Promise<EpicInfo[]> {
	const swarmMail = await getSwarmMailLibSQL(projectPath);
	const db = await swarmMail.getDatabase();
	// Check if beads table exists
	const tablesResult = await db.query<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type = ? AND name = ?",
		["table", "beads"]
	);
	
	if (tablesResult.rows.length > 0) {
		// Production path: query beads table
		const whereParts = ["type = 'epic'", "project_key = ?", "deleted_at IS NULL"];
		const params: (string | number)[] = [projectPath];
		if (options?.status) {
			whereParts.push("status = ?");
			params.push(options.status);
		}
		
		const query = `
			WITH epic_subtasks AS (
				SELECT 
					id as epic_id,
					title,
					status,
					(
						SELECT COUNT(*) 
						FROM beads subtasks 
						WHERE subtasks.parent_id = beads.id 
							AND subtasks.deleted_at IS NULL
					) as subtask_count,
					(
						SELECT COUNT(*) 
						FROM beads subtasks 
						WHERE subtasks.parent_id = beads.id 
							AND subtasks.status = 'completed'
							AND subtasks.deleted_at IS NULL
					) as completed_count
				FROM beads
				WHERE ${whereParts.join(" AND ")}
			)
			SELECT epic_id, title, subtask_count, completed_count
			FROM epic_subtasks
		`;

		const result = await db.query<{
			epic_id: string;
			title: string;
			subtask_count: number;
			completed_count: number;
		}>(query, params);

		return result.rows.map((row) => ({
			epic_id: row.epic_id,
			title: row.title,
			subtask_count: row.subtask_count,
			completed_count: row.completed_count,
		}));
	}

	// No beads table found - return empty
	return [];
}
