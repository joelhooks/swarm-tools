/**
 * Tests for Legacy Hive Schema Transformer
 *
 * Tests transformation of old .hive/swarm-mail.db schema to modern global swarm.db schema.
 *
 * ## Context
 * The .hive/swarm-mail.db contains 519 historical issues from Dec 7-17 2025 that are NOT
 * in the global database. These have bd-lf2p4u-* IDs and need to be migrated.
 *
 * ## Key Schema Differences
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
 * - `cell_events` table with cell_id reference
 * - `bead_dependencies` table with cell_id references
 *
 * ## Test Strategy
 * These are unit tests for the transformation functions. Integration tests for the
 * full migration will be in legacy-hive-transformer.integration.test.ts once the
 * database operations are implemented.
 */

import { describe, expect, it } from "bun:test";
import {
	transformIssue,
	transformEvent,
	transformDependency,
	type LegacyIssue,
	type LegacyEvent,
	type LegacyDependency,
} from "./legacy-hive-transformer.js";

describe("transformIssue", () => {
	it("should convert ISO8601 timestamps to epoch milliseconds", () => {
		const legacyIssue: LegacyIssue = {
			id: "bd-lf2p4u-abc123",
			title: "Test Issue",
			description: "Test description",
			type: "task",
			status: "open",
			priority: 2,
			created_at: "2025-12-15T10:30:00.000Z",
			updated_at: "2025-12-15T11:00:00.000Z",
			parent_id: null,
			closed_at: null,
			close_reason: null,
		};

		const result = transformIssue(legacyIssue, "/Users/joel/Code/joelhooks/opencode-swarm-plugin");

		// ISO8601 "2025-12-15T10:30:00.000Z" → epoch ms
		expect(result.created_at).toBe(new Date("2025-12-15T10:30:00.000Z").getTime());
		expect(result.updated_at).toBe(new Date("2025-12-15T11:00:00.000Z").getTime());
		expect(result.closed_at).toBeNull();
	});

	it("should add project_key from project path", () => {
		const legacyIssue: LegacyIssue = {
			id: "bd-lf2p4u-abc123",
			title: "Test Issue",
			description: null,
			type: "task",
			status: "open",
			priority: 2,
			created_at: "2025-12-15T10:30:00.000Z",
			updated_at: "2025-12-15T10:30:00.000Z",
			parent_id: null,
			closed_at: null,
			close_reason: null,
		};

		const result = transformIssue(legacyIssue, "/Users/joel/Code/joelhooks/opencode-swarm-plugin");

		expect(result.project_key).toBe("/Users/joel/Code/joelhooks/opencode-swarm-plugin");
	});

	it("should preserve original ID with bd-lf2p4u-* format", () => {
		const legacyIssue: LegacyIssue = {
			id: "bd-lf2p4u-xyz789",
			title: "Test Issue",
			description: null,
			type: "bug",
			status: "closed",
			priority: 0,
			created_at: "2025-12-15T10:30:00.000Z",
			updated_at: "2025-12-15T11:00:00.000Z",
			parent_id: null,
			closed_at: "2025-12-15T12:00:00.000Z",
			close_reason: "Fixed",
		};

		const result = transformIssue(legacyIssue, "/Users/joel/Code/joelhooks/opencode-swarm-plugin");

		expect(result.id).toBe("bd-lf2p4u-xyz789");
	});

	it("should convert closed_at timestamp when present", () => {
		const legacyIssue: LegacyIssue = {
			id: "bd-lf2p4u-closed1",
			title: "Closed Issue",
			description: null,
			type: "task",
			status: "closed",
			priority: 2,
			created_at: "2025-12-15T10:00:00.000Z",
			updated_at: "2025-12-15T11:00:00.000Z",
			parent_id: null,
			closed_at: "2025-12-15T12:00:00.000Z",
			close_reason: "Done",
		};

		const result = transformIssue(legacyIssue, "/Users/joel/Code/joelhooks/opencode-swarm-plugin");

		expect(result.closed_at).toBe(new Date("2025-12-15T12:00:00.000Z").getTime());
		expect(result.closed_reason).toBe("Done");
	});

	it("should preserve parent_id for epic subtasks", () => {
		const legacyIssue: LegacyIssue = {
			id: "bd-lf2p4u-subtask1",
			title: "Subtask",
			description: null,
			type: "task",
			status: "open",
			priority: 2,
			created_at: "2025-12-15T10:30:00.000Z",
			updated_at: "2025-12-15T10:30:00.000Z",
			parent_id: "bd-lf2p4u-epic1",
			closed_at: null,
			close_reason: null,
		};

		const result = transformIssue(legacyIssue, "/Users/joel/Code/joelhooks/opencode-swarm-plugin");

		expect(result.parent_id).toBe("bd-lf2p4u-epic1");
	});

	it("should handle all valid issue types", () => {
		const types: Array<LegacyIssue["type"]> = ["task", "bug", "feature", "epic", "chore"];

		for (const type of types) {
			const legacyIssue: LegacyIssue = {
				id: `bd-lf2p4u-${type}1`,
				title: `${type} Issue`,
				description: null,
				type,
				status: "open",
				priority: 2,
				created_at: "2025-12-15T10:30:00.000Z",
				updated_at: "2025-12-15T10:30:00.000Z",
				parent_id: null,
				closed_at: null,
				close_reason: null,
			};

			const result = transformIssue(legacyIssue, "/Users/joel/Code/joelhooks/opencode-swarm-plugin");
			expect(result.type).toBe(type);
		}
	});

	it("should handle all valid status values", () => {
		const statuses: Array<LegacyIssue["status"]> = ["open", "in_progress", "blocked", "closed"];

		for (const status of statuses) {
			const legacyIssue: LegacyIssue = {
				id: `bd-lf2p4u-${status}1`,
				title: `${status} Issue`,
				description: null,
				type: "task",
				status,
				priority: 2,
				created_at: "2025-12-15T10:30:00.000Z",
				updated_at: "2025-12-15T10:30:00.000Z",
				parent_id: null,
				closed_at: null,
				close_reason: null,
			};

			const result = transformIssue(legacyIssue, "/Users/joel/Code/joelhooks/opencode-swarm-plugin");
			expect(result.status).toBe(status);
		}
	});

	it("should set created_by to 'HistoricalImport' for legacy data", () => {
		const legacyIssue: LegacyIssue = {
			id: "bd-lf2p4u-abc123",
			title: "Test Issue",
			description: null,
			type: "task",
			status: "open",
			priority: 2,
			created_at: "2025-12-15T10:30:00.000Z",
			updated_at: "2025-12-15T10:30:00.000Z",
			parent_id: null,
			closed_at: null,
			close_reason: null,
		};

		const result = transformIssue(legacyIssue, "/Users/joel/Code/joelhooks/opencode-swarm-plugin");

		expect(result.created_by).toBe("HistoricalImport");
	});
});

describe("transformEvent", () => {
	it("should convert ISO8601 timestamp to epoch milliseconds", () => {
		const legacyEvent: LegacyEvent = {
			id: 1,
			issue_id: "bd-lf2p4u-abc123",
			event_type: "created",
			payload: JSON.stringify({ status: "open" }),
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformEvent(legacyEvent);

		expect(result.created_at).toBe(new Date("2025-12-15T10:30:00.000Z").getTime());
	});

	it("should map issue_id to cell_id", () => {
		const legacyEvent: LegacyEvent = {
			id: 1,
			issue_id: "bd-lf2p4u-xyz789",
			event_type: "status_changed",
			payload: JSON.stringify({ old: "open", new: "in_progress" }),
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformEvent(legacyEvent);

		expect(result.cell_id).toBe("bd-lf2p4u-xyz789");
	});

	it("should preserve event_type", () => {
		const legacyEvent: LegacyEvent = {
			id: 1,
			issue_id: "bd-lf2p4u-abc123",
			event_type: "priority_changed",
			payload: JSON.stringify({ old: 2, new: 0 }),
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformEvent(legacyEvent);

		expect(result.event_type).toBe("priority_changed");
	});

	it("should preserve payload as JSON string", () => {
		const payload = { old: "open", new: "closed", reason: "Done" };
		const legacyEvent: LegacyEvent = {
			id: 1,
			issue_id: "bd-lf2p4u-abc123",
			event_type: "status_changed",
			payload: JSON.stringify(payload),
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformEvent(legacyEvent);

		expect(result.payload).toBe(JSON.stringify(payload));
		expect(JSON.parse(result.payload)).toEqual(payload);
	});

	it("should preserve autoincrement ID", () => {
		const legacyEvent: LegacyEvent = {
			id: 42,
			issue_id: "bd-lf2p4u-abc123",
			event_type: "created",
			payload: "{}",
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformEvent(legacyEvent);

		expect(result.id).toBe(42);
	});
});

describe("transformDependency", () => {
	it("should map issue_id to cell_id", () => {
		const legacyDep: LegacyDependency = {
			issue_id: "bd-lf2p4u-blocked1",
			depends_on_id: "bd-lf2p4u-blocker1",
			relationship: "blocks",
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformDependency(legacyDep);

		expect(result.cell_id).toBe("bd-lf2p4u-blocked1");
		expect(result.depends_on_id).toBe("bd-lf2p4u-blocker1");
	});

	it("should convert created_at to epoch milliseconds", () => {
		const legacyDep: LegacyDependency = {
			issue_id: "bd-lf2p4u-blocked1",
			depends_on_id: "bd-lf2p4u-blocker1",
			relationship: "blocks",
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformDependency(legacyDep);

		expect(result.created_at).toBe(new Date("2025-12-15T10:30:00.000Z").getTime());
	});

	it("should preserve relationship type", () => {
		const legacyDep: LegacyDependency = {
			issue_id: "bd-lf2p4u-task1",
			depends_on_id: "bd-lf2p4u-task2",
			relationship: "related",
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformDependency(legacyDep);

		expect(result.relationship).toBe("related");
	});

	it("should set created_by to 'HistoricalImport'", () => {
		const legacyDep: LegacyDependency = {
			issue_id: "bd-lf2p4u-blocked1",
			depends_on_id: "bd-lf2p4u-blocker1",
			relationship: "blocks",
			created_at: "2025-12-15T10:30:00.000Z",
		};

		const result = transformDependency(legacyDep);

		expect(result.created_by).toBe("HistoricalImport");
	});
});

describe("migrateLegacyHive", () => {
	it("should be tested with integration test once database operations are implemented", () => {
		// This will be tested in legacy-hive-transformer.integration.test.ts
		// once we implement the database migration function
		expect(true).toBe(true);
	});
});
