/**
 * Event Utilities - Safe event emission for swarm-mail
 *
 * Provides a standardized way to emit events with error handling across all tools.
 * Events are emitted to the swarm-mail event store for observability and learning.
 *
 * Pattern extracted from 21+ identical try-catch blocks across tool files.
 */

import { createEvent, appendEvent } from "swarm-mail";

/**
 * Safely emit an event to the swarm-mail event store.
 *
 * Wraps event creation and emission in a try-catch to prevent tool failures
 * from event system issues. Logs warnings on failure but continues execution.
 *
 * @param eventType - The type of event to emit (e.g., "cell_created", "memory_stored")
 * @param data - Event data (project_key is added automatically if not present)
 * @param toolName - Name of the calling tool for logging (e.g., "hive_create", "hivemind_store")
 * @param projectPath - Project path for event storage (defaults to process.cwd())
 *
 * @example
 * ```typescript
 * await safeEmitEvent(
 *   "cell_created",
 *   { cell_id: cell.id, title: "Fix bug" },
 *   "hive_create",
 *   "/path/to/project"
 * );
 * ```
 */
export async function safeEmitEvent(
	eventType: string,
	data: Record<string, unknown>,
	toolName: string,
	projectPath?: string,
): Promise<void> {
	try {
		const effectiveProjectPath = projectPath || process.cwd();

		const event = createEvent(eventType as any, {
			project_key: effectiveProjectPath,
			...data,
		});

		await appendEvent(event, effectiveProjectPath);
	} catch (error) {
		// Non-fatal - log and continue
		console.warn(`[${toolName}] Failed to emit ${eventType} event:`, error);
	}
}
