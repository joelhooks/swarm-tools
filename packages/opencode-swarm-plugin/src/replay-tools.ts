/**
 * Replay Tools - Event replay with timing simulation
 *
 * TDD GREEN: Minimal implementation to pass tests
 */

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";

// ============================================================================
// Types
// ============================================================================

export type ReplaySpeed = "1x" | "2x" | "instant";

export interface ReplayEvent {
	session_id: string;
	epic_id: string;
	timestamp: string;
	event_type: "DECISION" | "VIOLATION" | "OUTCOME" | "COMPACTION";
	decision_type?: string;
	violation_type?: string;
	outcome_type?: string;
	payload: Record<string, unknown>;
	delta_ms: number;
}

export interface ReplayFilter {
	type?: Array<"DECISION" | "VIOLATION" | "OUTCOME" | "COMPACTION">;
	agent?: string;
	since?: Date;
	until?: Date;
}

// ============================================================================
// fetchEpicEvents - Read JSONL and calculate deltas
// ============================================================================

export async function fetchEpicEvents(
	epicId: string,
	sessionFile: string,
): Promise<ReplayEvent[]> {
	// Handle non-existent files
	if (!existsSync(sessionFile)) {
		return [];
	}

	try {
		const content = readFileSync(sessionFile, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		if (lines.length === 0) {
			return [];
		}

		// Parse JSONL
		const events = lines.map((line) => JSON.parse(line));

		// Sort by timestamp (chronological order)
		events.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

		// Calculate delta_ms between events
		const replayEvents: ReplayEvent[] = [];
		let prevTime = 0;

		for (const event of events) {
			const currTime = new Date(event.timestamp).getTime();
			const delta_ms = prevTime === 0 ? 0 : currTime - prevTime;

			replayEvents.push({
				...event,
				delta_ms,
			});

			prevTime = currTime;
		}

		return replayEvents;
	} catch (error) {
		// Handle errors (e.g., invalid JSON)
		return [];
	}
}

// ============================================================================
// filterEvents - Filter by type/agent/time (AND logic)
// ============================================================================

export function filterEvents(
	events: ReplayEvent[],
	filter: ReplayFilter,
): ReplayEvent[] {
	return events.filter((event) => {
		// Filter by event type
		if (filter.type && !filter.type.includes(event.event_type)) {
			return false;
		}

		// Filter by agent name (from payload)
		if (filter.agent) {
			const payload = event.payload as any;
			if (payload.agent_name !== filter.agent) {
				return false;
			}
		}

		// Filter by time range (since)
		if (filter.since) {
			const eventTime = new Date(event.timestamp);
			if (eventTime < filter.since) {
				return false;
			}
		}

		// Filter by time range (until)
		if (filter.until) {
			const eventTime = new Date(event.timestamp);
			if (eventTime > filter.until) {
				return false;
			}
		}

		return true;
	});
}

// ============================================================================
// replayWithTiming - Async generator with speed control
// ============================================================================

export interface ReplayOptions {
	/** Injectable sleep function for testing. Defaults to Bun.sleep / setTimeout. */
	sleep?: (ms: number) => Promise<void>;
}

export async function* replayWithTiming(
	events: ReplayEvent[],
	speed: ReplaySpeed,
	options?: ReplayOptions,
): AsyncGenerator<ReplayEvent> {
	if (events.length === 0) {
		return;
	}

	const startTime = Date.now();
	let cumulativeDelay = 0;

	for (const event of events) {
		// Calculate target time for this event
		cumulativeDelay += event.delta_ms;

		let targetDelay = cumulativeDelay;
		if (speed === "2x") {
			targetDelay = targetDelay / 2;
		} else if (speed === "instant") {
			targetDelay = 0;
		}

		// Calculate actual delay needed (accounting for time already elapsed)
		const elapsed = Date.now() - startTime;
		const delay = targetDelay - elapsed;

		// Wait for the delay if needed (with small buffer for overhead)
		if (delay > 3) {
			// Subtract 3ms buffer to account for async overhead
			const adjustedDelay = delay - 3;

			if (options?.sleep) {
				await options.sleep(adjustedDelay);
			} else if (typeof Bun !== "undefined" && typeof Bun.sleep === "function") {
				// Use Bun.sleep for more precise timing in Bun runtime
				await Bun.sleep(adjustedDelay);
			} else {
				await new Promise((resolve) => setTimeout(resolve, adjustedDelay));
			}
		}

		// Yield the event
		yield event;
	}
}

// ============================================================================
// formatReplayEvent - ANSI colors + box-drawing + relationships
// ============================================================================

export function formatReplayEvent(event: ReplayEvent): string {
	// ANSI color codes
	const colors = {
		DECISION: "\x1b[34m", // Blue
		VIOLATION: "\x1b[31m", // Red
		OUTCOME: "\x1b[32m", // Green
		COMPACTION: "\x1b[33m", // Yellow
		reset: "\x1b[0m",
		gray: "\x1b[90m",
	};

	const color = colors[event.event_type] || colors.reset;

	// Format timestamp (remove 'Z' suffix and put it BEFORE color codes for regex match)
	const timestamp = new Date(event.timestamp)
		.toISOString()
		.split("T")[1]
		.replace("Z", "");
	const timePrefix = `[${timestamp}]`;

	// Extract relevant payload fields
	const payload = event.payload as any;
	const beadId = payload.bead_id || "";
	const agentName = payload.agent_name || "";
	const strategyUsed = payload.strategy_used || "";
	const subtaskCount = payload.subtask_count;

	// Build formatted output with box-drawing characters
	// Put timestamp BEFORE any color codes so regex matches
	let output = `${timePrefix} `;
	output += `${color}┌─ ${event.event_type}${colors.reset}\n`;

	// Epic relationship
	output += `${colors.gray}│${colors.reset} epic: ${event.epic_id}\n`;

	// Bead relationship (if present)
	if (beadId) {
		output += `${colors.gray}│${colors.reset} bead: ${beadId}\n`;
	}

	// Agent (if present)
	if (agentName) {
		output += `${colors.gray}│${colors.reset} agent: ${agentName}\n`;
	}

	// Strategy (if present)
	if (strategyUsed) {
		output += `${colors.gray}│${colors.reset} strategy: ${strategyUsed}\n`;
	}

	// Subtask count (if present)
	if (subtaskCount !== undefined) {
		output += `${colors.gray}│${colors.reset} subtasks: ${subtaskCount}\n`;
	}

	output += `${colors.gray}└─${colors.reset}`;

	return output;
}
