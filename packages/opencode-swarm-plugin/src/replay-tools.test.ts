/**
 * Replay Tools Tests (RED Phase)
 *
 * TDD: These tests SHOULD FAIL until implementation exists.
 *
 * Tests verify:
 * 1. fetchEpicEvents() - retrieves events for epic_id from libSQL
 * 2. filterEvents() - filters by type/agent/time range
 * 3. replayWithTiming() - yields events with correct delays at different speeds
 * 4. formatReplayEvent() - produces color-coded output with relationships
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
	fetchEpicEvents,
	filterEvents,
	replayWithTiming,
	formatReplayEvent,
	type ReplayEvent,
	type ReplayFilter,
	type ReplaySpeed,
} from "./replay-tools";
import {
	closeSwarmMailLibSQL,
	createInMemorySwarmMailLibSQL,
	type SwarmMailAdapter,
} from "swarm-mail";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("replay-tools (RED phase - tests should FAIL)", () => {
	let swarmMail: SwarmMailAdapter;
	let sessionFile: string;
	const projectPath = "/test/replay-project";
	const epicId = "epic-abc123";
	const testTimestamp = new Date("2025-12-25T12:00:00.000Z");

	beforeAll(async () => {
		// Create in-memory database
		swarmMail = await createInMemorySwarmMailLibSQL(projectPath);

		// Create test session file with sample events
		const sessionDir = join(tmpdir(), "swarm-sessions-test");
		mkdirSync(sessionDir, { recursive: true });
		sessionFile = join(sessionDir, `session-${epicId}.jsonl`);

		// Write test events (JSONL format - one JSON object per line)
		const events = [
			{
				session_id: "session-1",
				epic_id: epicId,
				timestamp: new Date(testTimestamp.getTime()).toISOString(),
				event_type: "DECISION",
				decision_type: "decomposition_complete",
				payload: {
					subtask_count: 2,
					strategy_used: "file-based",
					epic_title: "Test Epic",
				},
			},
			{
				session_id: "session-1",
				epic_id: epicId,
				timestamp: new Date(testTimestamp.getTime() + 1000).toISOString(), // +1s
				event_type: "DECISION",
				decision_type: "worker_spawned",
				payload: {
					agent_name: "AgentA",
					bead_id: `${epicId}.1`,
					files: ["src/a.ts"],
				},
			},
			{
				session_id: "session-1",
				epic_id: epicId,
				timestamp: new Date(testTimestamp.getTime() + 2500).toISOString(), // +2.5s
				event_type: "VIOLATION",
				violation_type: "coordinator_editing_files",
				payload: {
					tool_name: "edit",
					file_path: "src/bad.ts",
				},
			},
			{
				session_id: "session-1",
				epic_id: epicId,
				timestamp: new Date(testTimestamp.getTime() + 5000).toISOString(), // +5s
				event_type: "OUTCOME",
				outcome_type: "subtask_success",
				payload: {
					bead_id: `${epicId}.1`,
					agent_name: "AgentA",
					duration_ms: 3500,
					files_touched: ["src/a.ts"],
				},
			},
		];

		writeFileSync(sessionFile, events.map((e) => JSON.stringify(e)).join("\n"));
	});

	afterAll(async () => {
		await closeSwarmMailLibSQL(projectPath);
	});

	describe("fetchEpicEvents()", () => {
		test("retrieves all events for a given epic_id", async () => {
			// Should read JSONL file and parse events
			const events = await fetchEpicEvents(epicId, sessionFile);

			expect(events).toBeDefined();
			expect(Array.isArray(events)).toBe(true);
			expect(events.length).toBe(4);

			// First event should be decomposition
			expect(events[0].event_type).toBe("DECISION");
			expect(events[0].epic_id).toBe(epicId);
		});

		test("returns events in chronological order", async () => {
			const events = await fetchEpicEvents(epicId, sessionFile);

			// Timestamps should be ascending
			for (let i = 1; i < events.length; i++) {
				const prevTime = new Date(events[i - 1].timestamp).getTime();
				const currTime = new Date(events[i].timestamp).getTime();
				expect(currTime).toBeGreaterThanOrEqual(prevTime);
			}
		});

		test("calculates correct time delta between events", async () => {
			const events = await fetchEpicEvents(epicId, sessionFile);

			// Events have delta_ms property for replay timing
			expect(events[0].delta_ms).toBe(0); // First event has no delta
			expect(events[1].delta_ms).toBe(1000); // +1s from first
			expect(events[2].delta_ms).toBe(1500); // +1.5s from second
			expect(events[3].delta_ms).toBe(2500); // +2.5s from third
		});

		test("handles empty or non-existent files", async () => {
			const events = await fetchEpicEvents("nonexistent-epic", "/tmp/nope.jsonl");
			expect(events).toBeDefined();
			expect(events.length).toBe(0);
		});

		test("preserves all event metadata", async () => {
			const events = await fetchEpicEvents(epicId, sessionFile);

			// Should include session_id, epic_id, timestamp, event_type, payload
			const firstEvent = events[0];
			expect(firstEvent.session_id).toBe("session-1");
			expect(firstEvent.epic_id).toBe(epicId);
			expect(firstEvent.timestamp).toBeTruthy();
			expect(firstEvent.event_type).toBe("DECISION");
			expect(firstEvent.payload).toBeDefined();
		});
	});

	describe("filterEvents()", () => {
		let allEvents: ReplayEvent[];

		beforeAll(async () => {
			allEvents = await fetchEpicEvents(epicId, sessionFile);
		});

		test("filters by event type", () => {
			const filter: ReplayFilter = {
				type: ["DECISION"],
			};

			const filtered = filterEvents(allEvents, filter);
			expect(filtered.length).toBe(2); // 2 DECISION events
			expect(filtered.every((e) => e.event_type === "DECISION")).toBe(true);
		});

		test("filters by multiple event types", () => {
			const filter: ReplayFilter = {
				type: ["DECISION", "OUTCOME"],
			};

			const filtered = filterEvents(allEvents, filter);
			expect(filtered.length).toBe(3); // 2 DECISION + 1 OUTCOME
			expect(
				filtered.every((e) => e.event_type === "DECISION" || e.event_type === "OUTCOME"),
			).toBe(true);
		});

		test("filters by agent name from payload", () => {
			const filter: ReplayFilter = {
				agent: "AgentA",
			};

			const filtered = filterEvents(allEvents, filter);
			// Should match events with agent_name in payload
			expect(filtered.length).toBeGreaterThan(0);
			expect(
				filtered.every((e) => {
					const payload = e.payload as any;
					return payload.agent_name === "AgentA";
				}),
			).toBe(true);
		});

		test("filters by time range (since)", () => {
			const filter: ReplayFilter = {
				since: new Date(testTimestamp.getTime() + 2000), // After +2s
			};

			const filtered = filterEvents(allEvents, filter);
			// Should only include events after +2s (VIOLATION and OUTCOME)
			expect(filtered.length).toBe(2);
		});

		test("filters by time range (until)", () => {
			const filter: ReplayFilter = {
				until: new Date(testTimestamp.getTime() + 2000), // Before +2s
			};

			const filtered = filterEvents(allEvents, filter);
			// Should only include first 2 events (DECISION at 0s and 1s)
			expect(filtered.length).toBe(2);
		});

		test("filters by time range (since + until)", () => {
			const filter: ReplayFilter = {
				since: new Date(testTimestamp.getTime() + 1000), // After +1s
				until: new Date(testTimestamp.getTime() + 3000), // Before +3s
			};

			const filtered = filterEvents(allEvents, filter);
			// Should include events at +1s and +2.5s
			expect(filtered.length).toBe(2);
		});

		test("combines multiple filters (AND logic)", () => {
			const filter: ReplayFilter = {
				type: ["OUTCOME"],
				agent: "AgentA",
			};

			const filtered = filterEvents(allEvents, filter);
			expect(filtered.length).toBe(1);
			expect(filtered[0].event_type).toBe("OUTCOME");
			expect((filtered[0].payload as any).agent_name).toBe("AgentA");
		});

		test("returns all events when no filter provided", () => {
			const filtered = filterEvents(allEvents, {});
			expect(filtered.length).toBe(allEvents.length);
		});
	});

	describe("replayWithTiming()", () => {
		let allEvents: ReplayEvent[];

		beforeAll(async () => {
			allEvents = await fetchEpicEvents(epicId, sessionFile);
		});

		test("yields events at 1x speed with correct delays", async () => {
			const speed: ReplaySpeed = "1x";
			const sleepCalls: number[] = [];
			const mockSleep = async (ms: number) => { sleepCalls.push(ms); };

			const collected: ReplayEvent[] = [];
			const startTime = Date.now();
			for await (const event of replayWithTiming(allEvents, speed, { sleep: mockSleep })) {
				collected.push(event);
			}
			const wallTime = Date.now() - startTime;

			expect(collected.length).toBe(4);
			// Should complete nearly instantly (no real sleeping)
			expect(wallTime).toBeLessThan(100);

			// 3 sleep calls (first event has delta_ms=0, no sleep needed)
			expect(sleepCalls.length).toBe(3);

			// Cumulative targets at 1x: 1000, 2500, 5000
			// Code subtracts 3ms buffer + tiny elapsed, so values are slightly less
			expect(sleepCalls[0]).toBeGreaterThan(900);
			expect(sleepCalls[0]).toBeLessThan(1010);

			expect(sleepCalls[1]).toBeGreaterThan(2400);
			expect(sleepCalls[1]).toBeLessThan(2510);

			expect(sleepCalls[2]).toBeGreaterThan(4900);
			expect(sleepCalls[2]).toBeLessThan(5010);
		});

		test("yields events at 2x speed with half delays", async () => {
			const speed: ReplaySpeed = "2x";
			const sleepCalls: number[] = [];
			const mockSleep = async (ms: number) => { sleepCalls.push(ms); };

			const collected: ReplayEvent[] = [];
			const startTime = Date.now();
			for await (const event of replayWithTiming(allEvents, speed, { sleep: mockSleep })) {
				collected.push(event);
			}
			const wallTime = Date.now() - startTime;

			expect(collected.length).toBe(4);
			// Should complete nearly instantly
			expect(wallTime).toBeLessThan(100);

			// 3 sleep calls (first event has delta_ms=0)
			expect(sleepCalls.length).toBe(3);

			// Cumulative targets at 2x (halved): 500, 1250, 2500
			expect(sleepCalls[0]).toBeGreaterThan(400);
			expect(sleepCalls[0]).toBeLessThan(510);

			expect(sleepCalls[1]).toBeGreaterThan(1150);
			expect(sleepCalls[1]).toBeLessThan(1260);

			expect(sleepCalls[2]).toBeGreaterThan(2400);
			expect(sleepCalls[2]).toBeLessThan(2510);
		});

		test("yields events instantly with no delays", async () => {
			const speed: ReplaySpeed = "instant";
			const startTime = Date.now();

			const events: ReplayEvent[] = [];
			for await (const event of replayWithTiming(allEvents, speed)) {
				events.push(event);
			}

			const totalTime = Date.now() - startTime;

			// All events should complete in <100ms
			expect(totalTime).toBeLessThan(100);
			expect(events.length).toBe(4);
		});

		test("preserves event data through iteration", async () => {
			const collected: ReplayEvent[] = [];
			for await (const event of replayWithTiming(allEvents, "instant")) {
				collected.push(event);
			}

			expect(collected.length).toBe(allEvents.length);
			expect(collected[0].event_type).toBe(allEvents[0].event_type);
			expect(collected[0].payload).toEqual(allEvents[0].payload);
		});

		test("handles empty event array", async () => {
			const events: ReplayEvent[] = [];
			const collected: ReplayEvent[] = [];

			for await (const event of replayWithTiming(events, "instant")) {
				collected.push(event);
			}

			expect(collected.length).toBe(0);
		});
	});

	describe("formatReplayEvent()", () => {
		let sampleEvent: ReplayEvent;

		beforeAll(async () => {
			const events = await fetchEpicEvents(epicId, sessionFile);
			sampleEvent = events[0];
		});

		test("produces color-coded output string", () => {
			const formatted = formatReplayEvent(sampleEvent);

			expect(typeof formatted).toBe("string");
			expect(formatted.length).toBeGreaterThan(0);

			// Should contain ANSI color codes (e.g., \x1b[32m for green)
			expect(formatted).toMatch(/\x1b\[\d+m/);
		});

		test("includes timestamp prefix", () => {
			const formatted = formatReplayEvent(sampleEvent);

			// Should start with timestamp like [12:00:00.000]
			expect(formatted).toMatch(/^\[[\d:\.]+\]/);
		});

		test("shows event type prominently", () => {
			const formatted = formatReplayEvent(sampleEvent);

			// Should contain event type (DECISION)
			expect(formatted).toContain("DECISION");
		});

		test("displays epic_id relationship", () => {
			const formatted = formatReplayEvent(sampleEvent);

			// Should show epic relationship
			expect(formatted).toContain(epicId);
		});

		test("displays bead_id when present in payload", () => {
			const events = [
				{
					session_id: "s1",
					epic_id: epicId,
					timestamp: new Date().toISOString(),
					event_type: "OUTCOME",
					outcome_type: "subtask_success",
					payload: {
						bead_id: `${epicId}.1`,
					},
					delta_ms: 0,
				},
			] as ReplayEvent[];

			const formatted = formatReplayEvent(events[0]);
			expect(formatted).toContain(`${epicId}.1`);
		});

		test("uses box-drawing characters for structure", () => {
			const formatted = formatReplayEvent(sampleEvent);

			// Should contain box-drawing chars: ┌ ─ │ └ ├ ┤ ┬ ┴ ┼
			const boxChars = ["─", "│", "┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼"];
			const hasBoxChars = boxChars.some((char) => formatted.includes(char));
			expect(hasBoxChars).toBe(true);
		});

		test("color codes by event type", () => {
			// DECISION events should use one color (e.g., blue)
			const decisionEvent = sampleEvent;
			const decisionFormatted = formatReplayEvent(decisionEvent);

			// VIOLATION events should use different color (e.g., red)
			const violationEvent: ReplayEvent = {
				session_id: "s1",
				epic_id: epicId,
				timestamp: new Date().toISOString(),
				event_type: "VIOLATION",
				violation_type: "coordinator_editing_files",
				payload: {},
				delta_ms: 0,
			};
			const violationFormatted = formatReplayEvent(violationEvent);

			// Different event types should have different color codes
			// (We can't assert exact codes without knowing implementation,
			// but we can check they're not identical)
			expect(decisionFormatted).not.toBe(violationFormatted);
		});

		test("includes relevant payload fields", () => {
			const formatted = formatReplayEvent(sampleEvent);

			// Should include key payload info (strategy_used, subtask_count)
			const payload = sampleEvent.payload as any;
			if (payload.strategy_used) {
				expect(formatted).toContain(payload.strategy_used);
			}
			if (payload.subtask_count !== undefined) {
				expect(formatted).toContain(String(payload.subtask_count));
			}
		});

		test("handles events without payload gracefully", () => {
			const minimalEvent: ReplayEvent = {
				session_id: "s1",
				epic_id: epicId,
				timestamp: new Date().toISOString(),
				event_type: "DECISION",
				decision_type: "minimal",
				payload: {},
				delta_ms: 0,
			};

			const formatted = formatReplayEvent(minimalEvent);
			expect(formatted).toBeTruthy();
			expect(formatted.length).toBeGreaterThan(0);
		});
	});

	describe("integration - full replay workflow", () => {
		test("fetch -> filter -> replay -> format pipeline", async () => {
			// 1. Fetch events
			const events = await fetchEpicEvents(epicId, sessionFile);
			expect(events.length).toBe(4);

			// 2. Filter to only DECISION events
			const filtered = filterEvents(events, { type: ["DECISION"] });
			expect(filtered.length).toBe(2);

			// 3. Replay at instant speed
			const replayed: ReplayEvent[] = [];
			for await (const event of replayWithTiming(filtered, "instant")) {
				replayed.push(event);
			}
			expect(replayed.length).toBe(2);

			// 4. Format each event
			const formatted = replayed.map(formatReplayEvent);
			expect(formatted.length).toBe(2);
			expect(formatted.every((f) => f.length > 0)).toBe(true);
		});
	});
});
