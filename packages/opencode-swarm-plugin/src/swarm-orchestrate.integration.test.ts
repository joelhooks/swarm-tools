/**
 * Integration tests for swarm-orchestrate.ts runtime
 * 
 * Tests that plugin tools work end-to-end without "dbOverride required" errors.
 * These tests verify Worker 1's fix (auto-adapter creation) works in plugin context.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type SwarmMailAdapter,
	clearAdapterCache,
	createInMemorySwarmMailLibSQL,
} from "swarm-mail";
import { clearHiveAdapterCache } from "./hive";
import { swarm_complete } from "./swarm-orchestrate";

describe("swarm_complete integration", () => {
	let testProjectPath: string;
	let swarmMail: SwarmMailAdapter;

	beforeEach(async () => {
		// Create temp project directory
		testProjectPath = join(tmpdir(), `swarm-test-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });

		// Initialize swarm-mail for this project
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
		
		// Register a test agent
		await swarmMail.registerAgent(testProjectPath, "TestWorker", {
			program: "test",
			model: "test-model",
		});
	});

	afterEach(async () => {
		// Clean up
		await swarmMail.close();
		clearAdapterCache();
		clearHiveAdapterCache();
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("swarm_complete accesses database without dbOverride error", async () => {
		const beadId = "test-bead-123";
		
		// Call swarm_complete - the key test is that it doesn't throw "dbOverride required"
		// when trying to access the database for deferred resolution
		// The deferred won't exist (table not in schema yet), but that's expected and non-fatal
		const result = await swarm_complete.execute({
			project_key: testProjectPath,
			agent_name: "TestWorker",
			bead_id: beadId,
			summary: "Test task completed",
			files_touched: ["test.ts"],
			start_time: Date.now() - 1000, // 1 second ago
			skip_verification: true,
		});

		// Should complete successfully (even without deferred table)
		expect(result).toBeDefined();
		expect(result).toContain("Task completed");
	});

	test("swarm_complete handles missing deferred gracefully", async () => {
		// Call swarm_complete without creating deferred first
		// Should NOT throw "dbOverride required" - should complete normally
		const result = await swarm_complete.execute({
			project_key: testProjectPath,
			agent_name: "TestWorker",
			bead_id: "no-deferred-bead",
			summary: "Task without deferred",
			files_touched: ["test.ts"],
			start_time: Date.now() - 1000,
			skip_verification: true,
		});

		// Should complete successfully even without deferred
		expect(result).toBeDefined();
		expect(result).toContain("Task completed");
	});
});

describe("swarm_recover integration", () => {
	let testProjectPath: string;
	let swarmMail: SwarmMailAdapter;

	beforeEach(async () => {
		testProjectPath = join(tmpdir(), `swarm-test-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
	});

	afterEach(async () => {
		await swarmMail.close();
		clearAdapterCache();
		clearHiveAdapterCache();
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("swarm_recover accesses database without dbOverride error", async () => {
		const { swarm_recover } = await import("./swarm-orchestrate");
		
		const epicId = "epic-123";
		
		// Call swarm_recover - the key test is that it doesn't throw "dbOverride required"
		// when trying to query swarm_contexts table
		// The table doesn't exist yet (not in schema), so it should return { found: false }
		const result = await swarm_recover.execute({
			project_key: testProjectPath,
			epic_id: epicId,
		});

		// Should return graceful fallback (not throw error)
		const parsed = JSON.parse(result);
		expect(parsed.found).toBe(false);
	});

	test("checkpoint recovery returns not found for missing checkpoint", async () => {
		const { swarm_recover } = await import("./swarm-orchestrate");
		
		// Query non-existent epic - should return { found: false }, not error
		const result = await swarm_recover.execute({
			project_key: testProjectPath,
			epic_id: "non-existent-epic",
		});

		const parsed = JSON.parse(result);
		expect(parsed.found).toBe(false);
	});
});

describe("E2E swarm coordination", () => {
	let testProjectPath: string;
	let swarmMail: SwarmMailAdapter;

	beforeEach(async () => {
		// Create temp project directory
		testProjectPath = join(tmpdir(), `swarm-e2e-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });

		// Initialize swarm-mail for this project
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
		
		// Set working directory so hive and swarm tools use this project
		const { setHiveWorkingDirectory } = await import("./hive");
		setHiveWorkingDirectory(testProjectPath);
	});

	afterEach(async () => {
		// Clean up
		await swarmMail.close();
		clearAdapterCache();
		clearHiveAdapterCache();
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("full multi-worker coordination flow", async () => {
		// Import all necessary tools
		const { hive_create_epic } = await import("./hive");
		
		// Step 1: Create epic with 2 subtasks using hive_create_epic
		const epicResult = await hive_create_epic.execute({
			epic_title: "E2E Test Epic",
			epic_description: "Full coordination flow test",
			subtasks: [
				{
					title: "Subtask 1: Setup",
					priority: 2,
					files: ["src/setup.ts"],
				},
				{
					title: "Subtask 2: Implementation",
					priority: 2,
					files: ["src/impl.ts"],
				},
			],
		});

		// Parse the JSON result to get epic and subtask IDs
		const epicData = JSON.parse(epicResult);
		expect(epicData.success).toBe(true);
		expect(epicData.epic).toBeDefined();
		expect(epicData.subtasks).toBeDefined();
		expect(epicData.subtasks.length).toBe(2);

		const epicId = epicData.epic.id;
		const subtask1Id = epicData.subtasks[0].id;
		const subtask2Id = epicData.subtasks[1].id;

		// Step 2: Register 2 workers in swarm-mail
		await swarmMail.registerAgent(testProjectPath, "Worker1", {
			program: "test",
			model: "test-model-1",
		});
		await swarmMail.registerAgent(testProjectPath, "Worker2", {
			program: "test",
			model: "test-model-2",
		});

		// Step 3: Simulate workers reserving files (parallel coordination)
		await swarmMail.reserveFiles(
			testProjectPath,
			"Worker1",
			["src/setup.ts"],
			{
				reason: `${subtask1Id}: Setup work`,
				exclusive: true,
			},
		);

		await swarmMail.reserveFiles(
			testProjectPath,
			"Worker2",
			["src/impl.ts"],
			{
				reason: `${subtask2Id}: Implementation work`,
				exclusive: true,
			},
		);

		// Verify both workers have active reservations
		const db = await swarmMail.getDatabase();
		const activeReservationsResult = await db.query<{ path_pattern: string; agent_name: string }>(
			"SELECT path_pattern, agent_name FROM reservations WHERE agent_name IN (?, ?) AND released_at IS NULL",
			["Worker1", "Worker2"],
		);
		const activeReservations = activeReservationsResult.rows;
		expect(activeReservations.length).toBe(2);
		expect(activeReservations.some(r => r.agent_name === "Worker1" && r.path_pattern === "src/setup.ts")).toBe(true);
		expect(activeReservations.some(r => r.agent_name === "Worker2" && r.path_pattern === "src/impl.ts")).toBe(true);

		// Step 4: Both workers complete their tasks (using swarm_complete)
		const { swarm_complete } = await import("./swarm-orchestrate");
		
		const worker1CompleteResult = await swarm_complete.execute({
			project_key: testProjectPath,
			agent_name: "Worker1",
			bead_id: subtask1Id,
			summary: "Setup completed",
			files_touched: ["src/setup.ts"],
			start_time: Date.now() - 2000,
			skip_verification: true,
			skip_review: true,
		});

		const worker1Complete = JSON.parse(worker1CompleteResult);
		expect(worker1Complete.success).toBe(true);
		expect(worker1Complete.closed).toBe(true);

		const worker2CompleteResult = await swarm_complete.execute({
			project_key: testProjectPath,
			agent_name: "Worker2",
			bead_id: subtask2Id,
			summary: "Implementation completed",
			files_touched: ["src/impl.ts"],
			start_time: Date.now() - 3000,
			skip_verification: true,
			skip_review: true,
		});

		const worker2Complete = JSON.parse(worker2CompleteResult);
		expect(worker2Complete.success).toBe(true);
		expect(worker2Complete.closed).toBe(true);

		// Step 5: Verify completion results
		// Both workers should have successfully completed their tasks
		expect(worker1Complete.success).toBe(true);
		expect(worker1Complete.closed).toBe(true);
		expect(worker1Complete.bead_id).toBe(subtask1Id);
		
		expect(worker2Complete.success).toBe(true);
		expect(worker2Complete.closed).toBe(true);
		expect(worker2Complete.bead_id).toBe(subtask2Id);
		
		// Step 6: Verify coordination flow completed
		// SUCCESS CRITERIA MET:
		// ✅ Epic created with 2 subtasks (hive_create_epic)
		// ✅ 2 workers registered in swarm-mail
		// ✅ Workers reserved their respective files (parallel coordination)
		// ✅ Workers completed tasks (swarm_complete)
		// ✅ Cells marked as closed (verified via completion response)
		
		// This test demonstrates full E2E swarm coordination without
		// requiring external database or filesystem access
	});
});
