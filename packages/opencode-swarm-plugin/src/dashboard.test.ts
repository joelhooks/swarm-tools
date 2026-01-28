/**
 * Dashboard Data Layer - RED Phase Tests
 * 
 * Following TDD RED → GREEN → REFACTOR:
 * - RED: These tests MUST fail (implementation doesn't exist yet)
 * - GREEN: Next phase will implement minimal code to pass
 * - REFACTOR: Clean up while tests stay green
 * 
 * Data Sources:
 * - libSQL events table (swarm-mail event sourcing)
 * - agents projection (agent registration/activity)
 * - messages projection (swarm mail)
 * - reservations projection (file locks)
 * - hive cells (work items)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SwarmMailAdapter } from "swarm-mail";
import { getSwarmMailLibSQL } from "swarm-mail";
import {
	getWorkerStatus,
	getSubtaskProgress,
	getFileLocks,
	getRecentMessages,
	getEpicList,
} from "./dashboard.js";

describe("Dashboard Data Layer - RED Phase", () => {
	let swarmMail: SwarmMailAdapter;
	let testProjectPath: string;

	beforeAll(async () => {
		// Create real temp directory for libSQL
		testProjectPath = mkdtempSync(join(tmpdir(), "dashboard-test-"));
		swarmMail = await getSwarmMailLibSQL(testProjectPath);
		const db = await swarmMail.getDatabase();

		// Seed test data for dashboard queries
		const events = [
			// Agent registration events
			{
				type: "agent_registered",
				data: { agent_name: "AlphaAgent", project_key: testProjectPath },
				timestamp: 1000,
			},
			{
				type: "agent_registered",
				data: { agent_name: "BetaAgent", project_key: testProjectPath },
				timestamp: 1100,
			},

			// Task lifecycle events
			{
				type: "task_started",
				data: { bead_id: "epic-1.1", agent_name: "AlphaAgent", title: "Setup auth" },
				timestamp: 2000,
			},
			{
				type: "task_started",
				data: { bead_id: "epic-1.2", agent_name: "BetaAgent", title: "Add tests" },
				timestamp: 2100,
			},

			// Progress events
			{
				type: "progress_reported",
				data: {
					bead_id: "epic-1.1",
					agent_name: "AlphaAgent",
					progress_percent: 50,
					status: "in_progress",
				},
				timestamp: 3000,
			},
			{
				type: "progress_reported",
				data: {
					bead_id: "epic-1.2",
					agent_name: "BetaAgent",
					progress_percent: 75,
					status: "in_progress",
				},
				timestamp: 3100,
			},

			// Task blocked
			{
				type: "task_blocked",
				data: {
					bead_id: "epic-1.3",
					agent_name: "AlphaAgent",
					reason: "Waiting for schema",
				},
				timestamp: 4000,
			},

			// File reservation events
			{
				type: "reservation_acquired",
				data: {
					path_pattern: "src/auth/**",
					agent_name: "AlphaAgent",
					reason: "epic-1.1: Auth implementation",
					exclusive: true,
					ttl_seconds: 3600,
				},
				timestamp: 2000,
			},
			{
				type: "reservation_acquired",
				data: {
					path_pattern: "src/auth/auth.test.ts",
					agent_name: "BetaAgent",
					reason: "epic-1.2: Test suite",
					exclusive: false,
					ttl_seconds: 1800,
				},
				timestamp: 2100,
			},

			// Swarm mail messages
			{
				type: "message_sent",
				data: {
					from: "AlphaAgent",
					to: ["coordinator"],
					subject: "Progress: epic-1.1",
					body: "Auth service 50% complete",
					importance: "normal",
					thread_id: "epic-1",
				},
				timestamp: 3000,
			},
			{
				type: "message_sent",
				data: {
					from: "BetaAgent",
					to: ["coordinator"],
					subject: "BLOCKED: epic-1.3",
					body: "Need database schema from epic-1.1",
					importance: "high",
					thread_id: "epic-1",
				},
				timestamp: 4000,
			},
			{
				type: "message_sent",
				data: {
					from: "coordinator",
					to: ["AlphaAgent"],
					subject: "Re: Progress",
					body: "Good progress, continue",
					importance: "normal",
					thread_id: "epic-1",
				},
				timestamp: 3500,
			},
		];

		// Insert events using parameterized queries
		for (const event of events) {
			await db.query(
				"INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)",
				[event.type, testProjectPath, event.timestamp, JSON.stringify(event.data)],
			);
		}

		// Seed hive cells (work items) - using direct INSERT for test simplicity
		// In reality, these would come from HiveAdapter via swarm-mail
		const cells = [
			{
				id: "epic-1",
				title: "Authentication System",
				type: "epic",
				status: "in_progress",
				priority: 2,
				created_at: new Date(1000).toISOString(),
			},
			{
				id: "epic-1.1",
				parent_id: "epic-1",
				title: "Setup auth service",
				type: "task",
				status: "in_progress",
				priority: 2,
				created_at: new Date(1100).toISOString(),
			},
			{
				id: "epic-1.2",
				parent_id: "epic-1",
				title: "Add auth tests",
				type: "task",
				status: "in_progress",
				priority: 2,
				created_at: new Date(1200).toISOString(),
			},
			{
				id: "epic-1.3",
				parent_id: "epic-1",
				title: "Database schema",
				type: "task",
				status: "blocked",
				priority: 2,
				created_at: new Date(1300).toISOString(),
			},
			{
				id: "epic-2",
				title: "Performance Optimization",
				type: "epic",
				status: "open",
				priority: 1,
				created_at: new Date(2000).toISOString(),
			},
		];

		// Insert beads (cells) into the beads table for getEpicList queries
		// The beads table should already exist from swarm-mail schema init
		// Use INSERT OR REPLACE to handle stale rows from previous test runs
		// (global DB may already have these IDs with a different project_key)
		for (const cell of cells) {
			const parentId = (cell as any).parent_id ?? null;
			const ts = new Date((cell as any).created_at).getTime() || Date.now();
			await db.query(
				"INSERT OR REPLACE INTO beads (id, project_key, type, status, title, priority, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				[cell.id, testProjectPath, cell.type, cell.status, cell.title, cell.priority, parentId, ts, ts]
			);
		}
	});

	afterAll(async () => {
		await swarmMail.close();
		// Clean up temp directory
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	describe("getWorkerStatus()", () => {
		test("should return array of WorkerStatus objects", async () => {
			const result = await getWorkerStatus(testProjectPath);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);
		});

		test("should include agent_name, status, and last_activity", async () => {
			const result = await getWorkerStatus(testProjectPath);

			const worker = result[0];
			expect(worker).toHaveProperty("agent_name");
			expect(worker).toHaveProperty("status");
			expect(worker).toHaveProperty("last_activity");

			// Status must be valid enum
			expect(["idle", "working", "blocked"]).toContain(worker.status);

			// last_activity should be ISO timestamp
			expect(typeof worker.last_activity).toBe("string");
			expect(() => new Date(worker.last_activity)).not.toThrow();
		});

		test("should include current_task when agent is working", async () => {
			const result = await getWorkerStatus(testProjectPath);

			// Find a working agent
			const workingAgent = result.find((w) => w.status === "working");
			if (workingAgent) {
				expect(workingAgent.current_task).toBeDefined();
				expect(typeof workingAgent.current_task).toBe("string");
			}
		});

		test("should derive status from latest events", async () => {
			const result = await getWorkerStatus(testProjectPath);

			// AlphaAgent has task_started + progress_reported → working
			const alpha = result.find((w) => w.agent_name === "AlphaAgent");
			expect(alpha?.status).toBe("working");

			// BetaAgent has task_started + progress_reported → working
			const beta = result.find((w) => w.agent_name === "BetaAgent");
			expect(beta?.status).toBe("working");
		});

		test("should filter by project_key when provided", async () => {
			const result = await getWorkerStatus(testProjectPath, { project_key: testProjectPath });

			expect(result.length).toBeGreaterThan(0);
			// All results should be from our test project
		});

		test("should return empty array when no agents found", async () => {
			const result = await getWorkerStatus(testProjectPath + "-nonexistent", { project_key: "/nonexistent" });

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(0);
		});
	});

	describe("getSubtaskProgress()", () => {
		test("should return array of SubtaskProgress objects", async () => {
			const result = await getSubtaskProgress(testProjectPath, "epic-1");

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);
		});

		test("should include bead_id, title, status, and progress_percent", async () => {
			const result = await getSubtaskProgress(testProjectPath, "epic-1");

			const subtask = result[0];
			expect(subtask).toHaveProperty("bead_id");
			expect(subtask).toHaveProperty("title");
			expect(subtask).toHaveProperty("status");
			expect(subtask).toHaveProperty("progress_percent");

			// Status must be valid enum
			expect(["open", "in_progress", "completed", "blocked"]).toContain(
				subtask.status,
			);

			// Progress percent should be 0-100
			expect(subtask.progress_percent).toBeGreaterThanOrEqual(0);
			expect(subtask.progress_percent).toBeLessThanOrEqual(100);
		});

		test("should return subtasks for specified epic only", async () => {
			const result = await getSubtaskProgress(testProjectPath, "epic-1");

			// Should have epic-1.1, epic-1.2, epic-1.3
			const beadIds = result.map((s) => s.bead_id);
			expect(beadIds).toContain("epic-1.1");
			expect(beadIds).toContain("epic-1.2");
			expect(beadIds).toContain("epic-1.3");

			// Should NOT have epic-2 subtasks
			expect(beadIds.every((id) => id.startsWith("epic-1"))).toBe(true);
		});

		test("should derive progress from progress_reported events", async () => {
			const result = await getSubtaskProgress(testProjectPath, "epic-1");

			// epic-1.1 reported 50% progress
			const task1 = result.find((s) => s.bead_id === "epic-1.1");
			expect(task1?.progress_percent).toBe(50);

			// epic-1.2 reported 75% progress
			const task2 = result.find((s) => s.bead_id === "epic-1.2");
			expect(task2?.progress_percent).toBe(75);
		});

		test("should default to 0% progress when no progress events exist", async () => {
			const result = await getSubtaskProgress(testProjectPath, "epic-1");

			// epic-1.3 is blocked but has no progress events
			const task3 = result.find((s) => s.bead_id === "epic-1.3");
			expect(task3?.progress_percent).toBe(0);
		});

		test("should return empty array when epic has no subtasks", async () => {
			const result = await getSubtaskProgress(testProjectPath, "nonexistent-epic");

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(0);
		});
	});

	describe("getFileLocks()", () => {
		test("should return array of FileLock objects", async () => {
			const result = await getFileLocks(testProjectPath);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);
		});

		test("should include path, agent_name, reason, acquired_at, and ttl_seconds", async () => {
			const result = await getFileLocks(testProjectPath);

			const lock = result[0];
			expect(lock).toHaveProperty("path");
			expect(lock).toHaveProperty("agent_name");
			expect(lock).toHaveProperty("reason");
			expect(lock).toHaveProperty("acquired_at");
			expect(lock).toHaveProperty("ttl_seconds");

			// acquired_at should be ISO timestamp
			expect(typeof lock.acquired_at).toBe("string");
			expect(() => new Date(lock.acquired_at)).not.toThrow();

			// ttl_seconds should be positive number
			expect(lock.ttl_seconds).toBeGreaterThan(0);
		});

		test("should return current reservations from events", async () => {
			const result = await getFileLocks(testProjectPath);

			// Should have src/auth/** reserved by AlphaAgent
			const authLock = result.find((l) => l.path === "src/auth/**");
			expect(authLock).toBeDefined();
			expect(authLock?.agent_name).toBe("AlphaAgent");
			expect(authLock?.reason).toContain("epic-1.1");

			// Should have src/auth/auth.test.ts reserved by BetaAgent
			const testLock = result.find((l) => l.path === "src/auth/auth.test.ts");
			expect(testLock).toBeDefined();
			expect(testLock?.agent_name).toBe("BetaAgent");
			expect(testLock?.reason).toContain("epic-1.2");
		});

		test("should filter by project_key when provided", async () => {
			const result = await getFileLocks(testProjectPath, { project_key: testProjectPath });

			expect(result.length).toBeGreaterThan(0);
		});

		test("should exclude released reservations", async () => {
			const db = await swarmMail.getDatabase();

			// Add a released reservation event
			await db.query(
				"INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?)",
				[
					"reservation_released",
					testProjectPath,
					5000,
					JSON.stringify({
						path_pattern: "src/old-reservation",
						agent_name: "AlphaAgent",
					}),
				],
			);

			const result = await getFileLocks(testProjectPath);

			// Should NOT include released reservation
			const releasedLock = result.find((l) => l.path === "src/old-reservation");
			expect(releasedLock).toBeUndefined();
		});

		test("should return empty array when no active reservations", async () => {
			const result = await getFileLocks(testProjectPath + "-no-locks", { project_key: "/no-locks" });

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(0);
		});
	});

	describe("getRecentMessages()", () => {
		test("should return array of RecentMessage objects", async () => {
			const result = await getRecentMessages(testProjectPath);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);
		});

		test("should include id, from, to, subject, timestamp, and importance", async () => {
			const result = await getRecentMessages(testProjectPath);

			const message = result[0];
			expect(message).toHaveProperty("id");
			expect(message).toHaveProperty("from");
			expect(message).toHaveProperty("to");
			expect(message).toHaveProperty("subject");
			expect(message).toHaveProperty("timestamp");
			expect(message).toHaveProperty("importance");

			// to should be array
			expect(Array.isArray(message.to)).toBe(true);

			// importance must be valid enum
			expect(["low", "normal", "high", "urgent"]).toContain(message.importance);

			// timestamp should be ISO string
			expect(typeof message.timestamp).toBe("string");
			expect(() => new Date(message.timestamp)).not.toThrow();
		});

		test("should return messages ordered by timestamp descending (newest first)", async () => {
			const result = await getRecentMessages(testProjectPath);

			// First message should be the latest (timestamp 4000)
			expect(result[0].subject).toContain("BLOCKED");

			// Check ordering
			for (let i = 1; i < result.length; i++) {
				const prev = new Date(result[i - 1].timestamp).getTime();
				const curr = new Date(result[i].timestamp).getTime();
				expect(prev).toBeGreaterThanOrEqual(curr);
			}
		});

		test("should limit results to specified count", async () => {
			const result = await getRecentMessages(testProjectPath, { limit: 2 });

			expect(result.length).toBeLessThanOrEqual(2);
		});

		test("should default to limit of 10 when not specified", async () => {
			const result = await getRecentMessages(testProjectPath);

			// Even if we have fewer messages, should not exceed 10
			expect(result.length).toBeLessThanOrEqual(10);
		});

		test("should filter by thread_id when provided", async () => {
			const result = await getRecentMessages(testProjectPath, { thread_id: "epic-1" });

			expect(result.length).toBeGreaterThan(0);
			// All messages should be from epic-1 thread
		});

		test("should filter by importance when provided", async () => {
			const result = await getRecentMessages(testProjectPath, { importance: "high" });

			// Should only include high importance messages
			expect(result.every((m) => m.importance === "high")).toBe(true);
		});

		test("should return empty array when no messages found", async () => {
			const result = await getRecentMessages(testProjectPath, { thread_id: "nonexistent" });

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(0);
		});
	});

	describe("getEpicList()", () => {
		test("should return array of EpicInfo objects", async () => {
			const result = await getEpicList(testProjectPath);

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);
		});

		test("should include epic_id, title, subtask_count, and completed_count", async () => {
			const result = await getEpicList(testProjectPath);

			const epic = result[0];
			expect(epic).toHaveProperty("epic_id");
			expect(epic).toHaveProperty("title");
			expect(epic).toHaveProperty("subtask_count");
			expect(epic).toHaveProperty("completed_count");

			// Counts should be non-negative integers
			expect(epic.subtask_count).toBeGreaterThanOrEqual(0);
			expect(epic.completed_count).toBeGreaterThanOrEqual(0);
			expect(Number.isInteger(epic.subtask_count)).toBe(true);
			expect(Number.isInteger(epic.completed_count)).toBe(true);
		});

		test("should include all epics from hive", async () => {
			const result = await getEpicList(testProjectPath);

			const epicIds = result.map((e) => e.epic_id);
			expect(epicIds).toContain("epic-1");
			expect(epicIds).toContain("epic-2");
		});

		test("should calculate subtask_count correctly", async () => {
			const result = await getEpicList(testProjectPath);

			// epic-1 has 3 subtasks (epic-1.1, epic-1.2, epic-1.3)
			const epic1 = result.find((e) => e.epic_id === "epic-1");
			expect(epic1?.subtask_count).toBe(3);

			// epic-2 has 0 subtasks
			const epic2 = result.find((e) => e.epic_id === "epic-2");
			expect(epic2?.subtask_count).toBe(0);
		});

		test("should calculate completed_count correctly", async () => {
			const result = await getEpicList(testProjectPath);

			// epic-1 has 0 completed subtasks (all in_progress or blocked)
			const epic1 = result.find((e) => e.epic_id === "epic-1");
			expect(epic1?.completed_count).toBe(0);
		});

		test("should filter by status when provided", async () => {
			const result = await getEpicList(testProjectPath, { status: "in_progress" });

			// Should only include epics with in_progress status
			expect(result.some((e) => e.epic_id === "epic-1")).toBe(true);
			expect(result.every((e) => e.epic_id !== "epic-2")).toBe(true); // epic-2 is open
		});

		test("should return empty array when no epics found", async () => {
			const result = await getEpicList(testProjectPath, { status: "completed" });

			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBe(0);
		});
	});
});
