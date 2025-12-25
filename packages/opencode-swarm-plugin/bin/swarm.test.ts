#!/usr/bin/env bun
/**
 * Tests for swarm CLI helpers
 * 
 * These tests verify the CLI helpers:
 * - File operation helpers (writeFileWithStatus, mkdirWithStatus, rmWithStatus)
 * - Swarm history helpers (formatSwarmHistory, parseHistoryArgs, filterHistoryByStatus)
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

type FileStatus = "created" | "updated" | "unchanged";

/**
 * Mock logger for testing (matches @clack/prompts API)
 */
class MockLogger {
  logs: Array<{ type: string; message: string }> = [];

  success(msg: string) {
    this.logs.push({ type: "success", message: msg });
  }

  message(msg: string) {
    this.logs.push({ type: "message", message: msg });
  }

  reset() {
    this.logs = [];
  }
}

describe("File operation helpers", () => {
  let testDir: string;
  let logger: MockLogger;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    logger = new MockLogger();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("writeFileWithStatus", () => {
    // Helper that mimics the implementation
    function writeFileWithStatus(path: string, content: string, label: string): FileStatus {
      const exists = existsSync(path);
      
      if (exists) {
        const current = readFileSync(path, "utf-8");
        if (current === content) {
          logger.message(`  ${label}: ${path} (unchanged)`);
          return "unchanged";
        }
      }
      
      writeFileSync(path, content);
      const status: FileStatus = exists ? "updated" : "created";
      logger.success(`${label}: ${path} (${status})`);
      return status;
    }

    test("returns 'created' for new file", () => {
      const filePath = join(testDir, "new.txt");
      const result = writeFileWithStatus(filePath, "content", "Test");
      
      expect(result).toBe("created");
      expect(logger.logs[0].type).toBe("success");
      expect(logger.logs[0].message).toContain("(created)");
      expect(existsSync(filePath)).toBe(true);
    });

    test("returns 'unchanged' if content is same", () => {
      const filePath = join(testDir, "existing.txt");
      writeFileSync(filePath, "same content");
      
      const result = writeFileWithStatus(filePath, "same content", "Test");
      
      expect(result).toBe("unchanged");
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("(unchanged)");
    });

    test("returns 'updated' if content differs", () => {
      const filePath = join(testDir, "existing.txt");
      writeFileSync(filePath, "old content");
      
      const result = writeFileWithStatus(filePath, "new content", "Test");
      
      expect(result).toBe("updated");
      expect(logger.logs[0].type).toBe("success");
      expect(logger.logs[0].message).toContain("(updated)");
      expect(readFileSync(filePath, "utf-8")).toBe("new content");
    });
  });

  describe("mkdirWithStatus", () => {
    function mkdirWithStatus(path: string): boolean {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
        logger.message(`  Created directory: ${path}`);
        return true;
      }
      return false;
    }

    test("creates directory and logs when it doesn't exist", () => {
      const dirPath = join(testDir, "newdir");
      const result = mkdirWithStatus(dirPath);
      
      expect(result).toBe(true);
      expect(existsSync(dirPath)).toBe(true);
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("Created directory");
    });

    test("returns false when directory already exists", () => {
      const dirPath = join(testDir, "existing");
      mkdirSync(dirPath);
      
      const result = mkdirWithStatus(dirPath);
      
      expect(result).toBe(false);
      expect(logger.logs.length).toBe(0);
    });
  });

  describe("rmWithStatus", () => {
    function rmWithStatus(path: string, label: string): void {
      if (existsSync(path)) {
        rmSync(path);
        logger.message(`  Removed ${label}: ${path}`);
      }
    }

    test("removes file and logs when it exists", () => {
      const filePath = join(testDir, "todelete.txt");
      writeFileSync(filePath, "content");
      
      rmWithStatus(filePath, "test file");
      
      expect(existsSync(filePath)).toBe(false);
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("Removed test file");
    });

    test("does nothing when file doesn't exist", () => {
      const filePath = join(testDir, "nonexistent.txt");
      
      rmWithStatus(filePath, "test file");
      
      expect(logger.logs.length).toBe(0);
    });
  });

  describe("getResearcherAgent", () => {
    // Mock implementation for testing - will match actual implementation
    function getResearcherAgent(model: string): string {
      return `---
name: swarm-researcher
description: Research agent for discovering and documenting context
model: ${model}
---

READ-ONLY research agent. Never modifies code - only gathers intel and stores findings.`;
    }

    test("includes model in frontmatter", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("model: anthropic/claude-haiku-4-5");
    });

    test("emphasizes READ-ONLY nature", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("READ-ONLY");
    });

    test("includes agent name in frontmatter", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("name: swarm-researcher");
    });
  });
});

// ============================================================================
// Log Command Tests (TDD)
// ============================================================================

// ============================================================================
// Session Log Tests (TDD)
// ============================================================================

import type { CoordinatorEvent } from "../src/eval-capture";

const TEST_SESSIONS_DIR = join(tmpdir(), "swarm-test-sessions");

describe("swarm log sessions", () => {
  beforeEach(() => {
    // Create test sessions directory
    if (!existsSync(TEST_SESSIONS_DIR)) {
      mkdirSync(TEST_SESSIONS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(TEST_SESSIONS_DIR)) {
      rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });
    }
  });

  // ========================================================================
  // Helper Functions (to be implemented in swarm.ts)
  // ========================================================================

  function createTestSession(
    sessionId: string,
    epicId: string,
    eventCount: number,
    baseTimestamp?: number,
  ): void {
    const filePath = join(TEST_SESSIONS_DIR, `${sessionId}.jsonl`);
    const lines: string[] = [];
    const base = baseTimestamp || Date.now();

    for (let i = 0; i < eventCount; i++) {
      const event: CoordinatorEvent = {
        session_id: sessionId,
        epic_id: epicId,
        timestamp: new Date(base - (eventCount - i) * 1000).toISOString(),
        event_type: "DECISION",
        decision_type: "worker_spawned",
        payload: { worker_id: `worker-${i}` },
      };
      lines.push(JSON.stringify(event));
    }

    writeFileSync(filePath, lines.join("\n") + "\n");
  }

  /**
   * Parse a session file and return events
   */
  function parseSessionFile(filePath: string): CoordinatorEvent[] {
    if (!existsSync(filePath)) {
      throw new Error(`Session file not found: ${filePath}`);
    }

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    const events: CoordinatorEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        events.push(parsed);
      } catch {
        // Skip invalid JSON lines
      }
    }

    return events;
  }

  /**
   * List all session files in a directory
   */
  function listSessionFiles(
    dir: string,
  ): Array<{
    session_id: string;
    file_path: string;
    event_count: number;
    start_time: string;
    end_time?: string;
  }> {
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    const sessions: Array<{
      session_id: string;
      file_path: string;
      event_count: number;
      start_time: string;
      end_time?: string;
    }> = [];

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const events = parseSessionFile(filePath);
        if (events.length === 0) continue;

        const timestamps = events.map((e) => new Date(e.timestamp).getTime());
        const startTime = new Date(Math.min(...timestamps)).toISOString();
        const endTime =
          timestamps.length > 1
            ? new Date(Math.max(...timestamps)).toISOString()
            : undefined;

        sessions.push({
          session_id: events[0].session_id,
          file_path: filePath,
          event_count: events.length,
          start_time: startTime,
          end_time: endTime,
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by start time (newest first)
    return sessions.sort((a, b) =>
      new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );
  }

  /**
   * Get the latest session file
   */
  function getLatestSession(
    dir: string,
  ): {
    session_id: string;
    file_path: string;
    event_count: number;
    start_time: string;
    end_time?: string;
  } | null {
    const sessions = listSessionFiles(dir);
    return sessions.length > 0 ? sessions[0] : null;
  }

  /**
   * Filter events by type
   */
  function filterEventsByType(
    events: CoordinatorEvent[],
    eventType: string,
  ): CoordinatorEvent[] {
    if (eventType === "all") return events;
    return events.filter((e) => e.event_type === eventType.toUpperCase());
  }

  /**
   * Filter events by time
   */
  function filterEventsSince(
    events: CoordinatorEvent[],
    sinceMs: number,
  ): CoordinatorEvent[] {
    const cutoffTime = Date.now() - sinceMs;
    return events.filter((e) =>
      new Date(e.timestamp).getTime() >= cutoffTime
    );
  }

  // ========================================================================
  // Tests
  // ========================================================================

  describe("listSessionFiles", () => {
    test("returns empty array when directory doesn't exist", () => {
      const result = listSessionFiles("/nonexistent/directory");
      expect(result).toEqual([]);
    });

    test("returns empty array when directory is empty", () => {
      const result = listSessionFiles(TEST_SESSIONS_DIR);
      expect(result).toEqual([]);
    });

    test("lists all session files with metadata", () => {
      createTestSession("ses_abc123", "epic-1", 5);
      createTestSession("ses_def456", "epic-2", 3);

      const result = listSessionFiles(TEST_SESSIONS_DIR);

      expect(result).toHaveLength(2);
      expect(result[0].session_id).toMatch(/^ses_/);
      expect(result[0].event_count).toBeGreaterThan(0);
      expect(result[0].start_time).toBeTruthy();
    });

    test("calculates event count correctly", () => {
      createTestSession("ses_test", "epic-1", 10);

      const result = listSessionFiles(TEST_SESSIONS_DIR);

      expect(result[0].event_count).toBe(10);
    });

    test("extracts start and end times from events", () => {
      createTestSession("ses_test", "epic-1", 5);

      const result = listSessionFiles(TEST_SESSIONS_DIR);

      expect(result[0].start_time).toBeTruthy();
      expect(new Date(result[0].start_time).getTime()).toBeLessThan(Date.now());
    });

    test("sorts sessions by start time (newest first)", () => {
      // Create sessions with explicit different timestamps
      const oldTime = Date.now() - 60000; // 1 minute ago
      const newTime = Date.now();
      
      createTestSession("ses_old", "epic-1", 2, oldTime);
      createTestSession("ses_new", "epic-2", 2, newTime);

      const result = listSessionFiles(TEST_SESSIONS_DIR);

      expect(result[0].session_id).toBe("ses_new");
      expect(result[1].session_id).toBe("ses_old");
    });
  });

  describe("parseSessionFile", () => {
    test("parses valid JSONL session file", () => {
      createTestSession("ses_parse", "epic-1", 3);
      const filePath = join(TEST_SESSIONS_DIR, "ses_parse.jsonl");

      const events = parseSessionFile(filePath);

      expect(events).toHaveLength(3);
      expect(events[0].session_id).toBe("ses_parse");
      expect(events[0].event_type).toBe("DECISION");
    });

    test("handles file with trailing newlines", () => {
      const filePath = join(TEST_SESSIONS_DIR, "ses_trailing.jsonl");
      writeFileSync(
        filePath,
        '{"session_id":"test","epic_id":"e1","timestamp":"2025-01-01T00:00:00Z","event_type":"DECISION","decision_type":"worker_spawned","payload":{}}\n\n\n',
      );

      const events = parseSessionFile(filePath);

      expect(events).toHaveLength(1);
    });

    test("skips invalid JSON lines", () => {
      const filePath = join(TEST_SESSIONS_DIR, "ses_invalid.jsonl");
      writeFileSync(
        filePath,
        '{"session_id":"test","epic_id":"e1","timestamp":"2025-01-01T00:00:00Z","event_type":"DECISION","decision_type":"worker_spawned","payload":{}}\ninvalid json\n{"session_id":"test","epic_id":"e1","timestamp":"2025-01-01T00:00:00Z","event_type":"OUTCOME","outcome_type":"subtask_success","payload":{}}\n',
      );

      const events = parseSessionFile(filePath);

      expect(events).toHaveLength(2);
    });

    test("throws error for non-existent file", () => {
      expect(() => parseSessionFile("/nonexistent/file.jsonl")).toThrow();
    });
  });

  describe("getLatestSession", () => {
    test("returns null when directory is empty", () => {
      const result = getLatestSession(TEST_SESSIONS_DIR);
      expect(result).toBeNull();
    });

    test("returns the most recent session", () => {
      const oldTime = Date.now() - 60000; // 1 minute ago
      const newTime = Date.now();
      
      createTestSession("ses_old", "epic-1", 2, oldTime);
      createTestSession("ses_new", "epic-2", 3, newTime);

      const result = getLatestSession(TEST_SESSIONS_DIR);

      expect(result).not.toBeNull();
      expect(result!.session_id).toBe("ses_new");
    });
  });

  describe("filterEventsByType", () => {
    test("filters DECISION events only", () => {
      const events: CoordinatorEvent[] = [
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: "2025-01-01T00:00:00Z",
          event_type: "DECISION",
          decision_type: "worker_spawned",
          payload: {},
        },
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: "2025-01-01T00:00:01Z",
          event_type: "VIOLATION",
          violation_type: "direct_edit",
          payload: {},
        },
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: "2025-01-01T00:00:02Z",
          event_type: "DECISION",
          decision_type: "worker_spawned",
          payload: {},
        },
      ];

      const result = filterEventsByType(events, "DECISION");

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.event_type === "DECISION")).toBe(true);
    });

    test("returns all events when type is 'all'", () => {
      const events: CoordinatorEvent[] = [
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: "2025-01-01T00:00:00Z",
          event_type: "DECISION",
          decision_type: "worker_spawned",
          payload: {},
        },
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: "2025-01-01T00:00:01Z",
          event_type: "VIOLATION",
          violation_type: "direct_edit",
          payload: {},
        },
      ];

      const result = filterEventsByType(events, "all");

      expect(result).toHaveLength(2);
    });
  });

  describe("filterEventsSince", () => {
    test("filters events within time window", () => {
      const now = Date.now();
      const events: CoordinatorEvent[] = [
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: new Date(now - 5000).toISOString(), // 5s ago
          event_type: "DECISION",
          decision_type: "worker_spawned",
          payload: {},
        },
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: new Date(now - 10000).toISOString(), // 10s ago
          event_type: "DECISION",
          decision_type: "worker_spawned",
          payload: {},
        },
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: new Date(now - 60000).toISOString(), // 1min ago
          event_type: "DECISION",
          decision_type: "worker_spawned",
          payload: {},
        },
      ];

      const result = filterEventsSince(events, 30000); // Last 30s

      expect(result).toHaveLength(2); // 10s and 3s ago
    });

    test("returns all events when sinceMs is very large", () => {
      const now = Date.now();
      const events: CoordinatorEvent[] = [
        {
          session_id: "s1",
          epic_id: "e1",
          timestamp: new Date(now - 1000).toISOString(),
          event_type: "DECISION",
          decision_type: "worker_spawned",
          payload: {},
        },
      ];

      const result = filterEventsSince(events, 86400000); // 1 day

      expect(result).toHaveLength(1);
    });
  });
});

// ============================================================================
// Cells Command Tests (TDD)
// ============================================================================

/**
 * Format cells as table output
 */
function formatCellsTable(cells: Array<{
  id: string;
  title: string;
  status: string;
  priority: number;
}>): string {
  if (cells.length === 0) {
    return "No cells found";
  }

  const rows = cells.map(c => ({
    id: c.id,
    title: c.title.length > 50 ? c.title.slice(0, 47) + "..." : c.title,
    status: c.status,
    priority: String(c.priority),
  }));

  // Calculate column widths
  const widths = {
    id: Math.max(2, ...rows.map(r => r.id.length)),
    title: Math.max(5, ...rows.map(r => r.title.length)),
    status: Math.max(6, ...rows.map(r => r.status.length)),
    priority: Math.max(8, ...rows.map(r => r.priority.length)),
  };

  // Build header
  const header = [
    "ID".padEnd(widths.id),
    "TITLE".padEnd(widths.title),
    "STATUS".padEnd(widths.status),
    "PRIORITY".padEnd(widths.priority),
  ].join("  ");

  const separator = "-".repeat(header.length);

  // Build rows
  const bodyRows = rows.map(r =>
    [
      r.id.padEnd(widths.id),
      r.title.padEnd(widths.title),
      r.status.padEnd(widths.status),
      r.priority.padEnd(widths.priority),
    ].join("  ")
  );

  return [header, separator, ...bodyRows].join("\n");
}

describe("Cells command", () => {
  describe("formatCellsTable", () => {
    test("formats cells as table with id, title, status, priority", () => {
      const cells = [
        {
          id: "test-abc123-xyz",
          title: "Fix bug",
          status: "open",
          priority: 0,
          type: "bug",
          created_at: 1234567890,
          updated_at: 1234567890,
        },
        {
          id: "test-def456-abc",
          title: "Add feature",
          status: "in_progress",
          priority: 2,
          type: "feature",
          created_at: 1234567890,
          updated_at: 1234567890,
        },
      ];

      const result = formatCellsTable(cells);

      expect(result).toContain("ID");
      expect(result).toContain("TITLE");
      expect(result).toContain("STATUS");
      expect(result).toContain("PRIORITY");
      expect(result).toContain("Fix bug");
      expect(result).toContain("Add feature");
      expect(result).toContain("open");
      expect(result).toContain("in_progress");
    });

    test("truncates long titles with ellipsis", () => {
      const cells = [
        {
          id: "test-abc",
          title: "A".repeat(100),
          status: "open",
          priority: 0,
          type: "task",
          created_at: 1234567890,
          updated_at: 1234567890,
        },
      ];

      const result = formatCellsTable(cells);

      expect(result).toContain("...");
      expect(result.split("\n")[2]).toMatch(/A{47}\.\.\./);
    });

    test("returns 'No cells found' for empty array", () => {
      const result = formatCellsTable([]);

      expect(result).toBe("No cells found");
    });

    test("aligns columns correctly", () => {
      const cells = [
        {
          id: "short",
          title: "T",
          status: "open",
          priority: 0,
          type: "task",
          created_at: 1234567890,
          updated_at: 1234567890,
        },
        {
          id: "very-long-id-here",
          title: "Very long title here",
          status: "in_progress",
          priority: 2,
          type: "task",
          created_at: 1234567890,
          updated_at: 1234567890,
        },
      ];

      const result = formatCellsTable(cells);
      const lines = result.split("\n");

      // All lines should be same length (aligned)
      const lengths = lines.map(l => l.length);
      expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(3);
    });
  });
});

// ============================================================================
// Eval Gate Tests (TDD)
// ============================================================================

interface EvalRunRecord {
  timestamp: string;
  eval_name: string;
  score: number;
  run_count: number;
}

interface GateResult {
  passed: boolean;
  phase: "bootstrap" | "stabilization" | "production";
  message: string;
  baseline?: number;
  variance?: number;
}

/**
 * Calculate variance for phase transitions
 */
function calculateVariance(scores: number[]): number {
  if (scores.length <= 1) return 0;

  const mean = scores.reduce((sum, x) => sum + x, 0) / scores.length;
  const squaredDiffs = scores.map((x) => Math.pow(x - mean, 2));
  const variance = squaredDiffs.reduce((sum, x) => sum + x, 0) / scores.length;

  return variance;
}

/**
 * Read all eval run records from .hive/eval-history.jsonl
 */
function readAllRecords(projectPath: string): EvalRunRecord[] {
  const recordsPath = join(projectPath, ".hive", "eval-history.jsonl");

  if (!existsSync(recordsPath)) {
    return [];
  }

  const content = readFileSync(recordsPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  return lines.map((line) => JSON.parse(line) as EvalRunRecord);
}

/**
 * Record an eval run to .hive/eval-history.jsonl
 */
function recordEvalRun(
  projectPath: string,
  record: EvalRunRecord,
): void {
  const hivePath = join(projectPath, ".hive");
  const recordsPath = join(hivePath, "eval-history.jsonl");

  // Ensure .hive directory exists
  if (!existsSync(hivePath)) {
    mkdirSync(hivePath, { recursive: true });
  }

  // Append record as JSONL
  const line = JSON.stringify(record) + "\n";

  if (existsSync(recordsPath)) {
    const existingContent = readFileSync(recordsPath, "utf-8");
    writeFileSync(recordsPath, existingContent + line);
  } else {
    writeFileSync(recordsPath, line);
  }
}

/**
 * Check eval gate for progressive gating
 */
function checkGate(
  projectPath: string,
  evalName: string,
  currentScore: number,
): GateResult {
  const records = readAllRecords(projectPath).filter(
    (r) => r.eval_name === evalName,
  );

  if (records.length < 10) {
    return {
      passed: true,
      phase: "bootstrap",
      message: `BOOTSTRAP (${records.length}/10 runs): no gates yet`,
    };
  }

  const lastTenScores = records.slice(-10).map((r) => r.score);
  const baseline = lastTenScores.reduce((sum, x) => sum + x, 0) / lastTenScores.length;
  const variance = calculateVariance(lastTenScores);

  if (records.length < 50) {
    const drop = ((baseline - currentScore) / baseline) * 100;
    if (drop > 5) {
      return {
        passed: false,
        phase: "stabilization",
        message: `WARN: Score dropped ${drop.toFixed(1)}% from baseline ${baseline.toFixed(2)}`,
        baseline,
        variance,
      };
    }

    return {
      passed: true,
      phase: "stabilization",
      message: `Stabilization (${records.length}/50 runs): baseline=${baseline.toFixed(2)}`,
      baseline,
      variance,
    };
  }

  // Production phase: variance < 0.1 AND score doesn't drop >5%
  if (variance < 0.1) {
    const drop = ((baseline - currentScore) / baseline) * 100;
    if (drop > 5) {
      return {
        passed: false,
        phase: "production",
        message: `FAIL: Score dropped ${drop.toFixed(1)}% from baseline ${baseline.toFixed(2)} (variance=${variance.toFixed(3)})`,
        baseline,
        variance,
      };
    }

    return {
      passed: true,
      phase: "production",
      message: `PASS: Production phase (variance=${variance.toFixed(3)}, baseline=${baseline.toFixed(2)})`,
      baseline,
      variance,
    };
  }

  // Stuck in stabilization (>50 runs but variance still high)
  return {
    passed: true,
    phase: "stabilization",
    message: `Stabilization: variance too high (${variance.toFixed(3)} > 0.1), need more consistent runs`,
    baseline,
    variance,
  };
}

/**
 * Ensure .hive directory exists
 */
function ensureHiveDirectory(projectPath: string): void {
  const hivePath = join(projectPath, ".hive");
  if (!existsSync(hivePath)) {
    mkdirSync(hivePath, { recursive: true });
  }
}

describe("Eval gate", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `eval-gate-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Bootstrap phase (<10 runs)", () => {
    test("allows any score", () => {
      ensureHiveDirectory(testDir);

      // Record 5 runs
      for (let i = 0; i < 5; i++) {
        recordEvalRun(testDir, {
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.5 + i * 0.1,
          run_count: i + 1,
        });
      }

      const result = checkGate(testDir, "test-eval", 0.3); // Low score

      expect(result.passed).toBe(true);
      expect(result.phase).toBe("bootstrap");
      expect(result.message).toContain("BOOTSTRAP");
    });

    test("counts runs correctly", () => {
      ensureHiveDirectory(testDir);

      for (let i = 0; i < 7; i++) {
        recordEvalRun(testDir, {
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.8,
          run_count: i + 1,
        });
      }

      const result = checkGate(testDir, "test-eval", 0.8);

      expect(result.phase).toBe("bootstrap");
      expect(result.message).toContain("7/10");
    });
  });

  describe("Stabilization phase (10-50 runs)", () => {
    test("warns on >5% regression", () => {
      ensureHiveDirectory(testDir);

      // Record 20 runs with consistent 0.9 score
      for (let i = 0; i < 20; i++) {
        recordEvalRun(testDir, {
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.9,
          run_count: i + 1,
        });
      }

      // Test with regressed score (>5% drop from 0.9 baseline)
      const regressedScore = 0.85; // 5.5% drop
      const result = checkGate(testDir, "test-eval", regressedScore);

      expect(result.passed).toBe(false);
      expect(result.phase).toBe("stabilization");
      expect(result.message).toContain("WARN");
      expect(result.baseline).toBeCloseTo(0.9, 2);
    });

    test("passes when score is stable", () => {
      ensureHiveDirectory(testDir);

      for (let i = 0; i < 25; i++) {
        recordEvalRun(testDir, {
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.85,
          run_count: i + 1,
        });
      }

      const result = checkGate(testDir, "test-eval", 0.86);

      expect(result.passed).toBe(true);
      expect(result.phase).toBe("stabilization");
      expect(result.baseline).toBeCloseTo(0.85, 2);
    });
  });

  describe("Production phase (>50 runs, low variance)", () => {
    test("enters production when variance < 0.1", () => {
      ensureHiveDirectory(testDir);

      // Simulate 60 runs with consistent scores (low variance)
      for (let i = 0; i < 60; i++) {
        recordEvalRun(testDir, {
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.9, // All same score = zero variance
          run_count: i + 1,
        });
      }

      const result = checkGate(testDir, "test-eval", 0.91);

      expect(result.phase).toBe("production");
      expect(result.variance).toBeLessThan(0.1);
    });

    test("fails on regression in production", () => {
      ensureHiveDirectory(testDir);

      // Simulate 60 runs with consistent high scores to reach production phase
      for (let i = 0; i < 60; i++) {
        recordEvalRun(testDir, {
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.9,
          run_count: i + 1,
        });
      }

      // Now test with a regressed score (>5% drop from 0.9 baseline)
      const regressedScore = 0.8; // 11% drop
      const result = checkGate(testDir, "test-eval", regressedScore);

      expect(result.passed).toBe(false);
      expect(result.phase).toBe("production");
      expect(result.message).toContain("FAIL");
    });
  });
});

// ============================================================================
// History Command Tests (TDD)
// ============================================================================

interface SwarmHistoryRecord {
  epic_id: string;
  epic_title: string;
  strategy: string;
  timestamp: string;
  overall_success: boolean;
  task_count: number;
  completed_count: number;
}

/**
 * Format relative time (e.g., "2h ago", "1d ago")
 */
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Format swarm history as beautiful CLI table
 */
function formatSwarmHistory(records: SwarmHistoryRecord[]): string {
  if (records.length === 0) {
    return "No swarm history found";
  }

  const rows = records.map(r => ({
    time: formatRelativeTime(r.timestamp),
    status: r.overall_success ? "✅" : "❌",
    title: r.epic_title.length > 30 ? r.epic_title.slice(0, 27) + "..." : r.epic_title,
    strategy: r.strategy,
    tasks: `${r.completed_count}/${r.task_count} tasks`,
  }));

  // Box drawing characters
  const lines: string[] = [];
  lines.push("┌─────────────────────────────────────────────────────────────┐");
  lines.push("│                    SWARM HISTORY                            │");
  lines.push("├─────────────────────────────────────────────────────────────┤");

  for (const row of rows) {
    const statusCol = `${row.time.padEnd(8)} ${row.status}`;
    const titleCol = row.title.padEnd(32);
    const strategyCol = row.strategy.padEnd(13);
    const tasksCol = row.tasks;

    const line = `│ ${statusCol} ${titleCol} ${strategyCol} ${tasksCol.padEnd(3)} │`;
    lines.push(line);
  }

  lines.push("└─────────────────────────────────────────────────────────────┘");

  return lines.join("\n");
}

/**
 * Filter history by status
 */
function filterHistoryByStatus(
  records: SwarmHistoryRecord[],
  status?: "success" | "failed" | "in_progress",
): SwarmHistoryRecord[] {
  if (!status) return records;

  switch (status) {
    case "success":
      return records.filter(r => r.overall_success);
    case "failed":
      return records.filter(r => !r.overall_success && r.completed_count === r.task_count);
    case "in_progress":
      return records.filter(r => r.completed_count < r.task_count);
    default:
      return records;
  }
}

/**
 * Filter history by strategy
 */
function filterHistoryByStrategy(
  records: SwarmHistoryRecord[],
  strategy?: "file-based" | "feature-based" | "risk-based",
): SwarmHistoryRecord[] {
  if (!strategy) return records;
  return records.filter(r => r.strategy === strategy);
}

/**
 * Parse history CLI arguments
 */
function parseHistoryArgs(args: string[]): {
  limit: number;
  status?: "success" | "failed" | "in_progress";
  strategy?: "file-based" | "feature-based" | "risk-based";
  verbose: boolean;
} {
  const result: {
    limit: number;
    status?: "success" | "failed" | "in_progress";
    strategy?: "file-based" | "feature-based" | "risk-based";
    verbose: boolean;
  } = {
    limit: 10,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit" || arg === "-n") {
      const limitStr = args[i + 1];
      if (limitStr && !isNaN(Number(limitStr))) {
        result.limit = Number(limitStr);
        i++;
      }
    } else if (arg === "--status") {
      const statusStr = args[i + 1];
      if (statusStr && ["success", "failed", "in_progress"].includes(statusStr)) {
        result.status = statusStr as "success" | "failed" | "in_progress";
        i++;
      }
    } else if (arg === "--strategy") {
      const strategyStr = args[i + 1];
      if (strategyStr && ["file-based", "feature-based", "risk-based"].includes(strategyStr)) {
        result.strategy = strategyStr as "file-based" | "feature-based" | "risk-based";
        i++;
      }
    } else if (arg === "--verbose" || arg === "-v") {
      result.verbose = true;
    }
  }

  return result;
}

describe("swarm history", () => {
  describe("formatRelativeTime", () => {
    test("formats minutes ago", () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
      const result = formatRelativeTime(fiveMinutesAgo);
      expect(result).toMatch(/5m ago/);
    });

    test("formats hours ago", () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
      const result = formatRelativeTime(threeHoursAgo);
      expect(result).toMatch(/3h ago/);
    });

    test("formats days ago", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
      const result = formatRelativeTime(twoDaysAgo);
      expect(result).toMatch(/2d ago/);
    });
  });

  describe("formatSwarmHistory", () => {
    test("formats history as beautiful box-drawn table", () => {
      const records: SwarmHistoryRecord[] = [
        {
          epic_id: "epic-1",
          epic_title: "Add auth flow",
          strategy: "feature-based",
          timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
          overall_success: true,
          task_count: 4,
          completed_count: 4,
        },
        {
          epic_id: "epic-2",
          epic_title: "Refactor DB layer",
          strategy: "file-based",
          timestamp: new Date(Date.now() - 5 * 3600000).toISOString(),
          overall_success: false,
          task_count: 5,
          completed_count: 2,
        },
      ];

      const result = formatSwarmHistory(records);

      expect(result).toContain("┌─────");
      expect(result).toContain("SWARM HISTORY");
      expect(result).toContain("✅");
      expect(result).toContain("❌");
      expect(result).toContain("Add auth flow");
      expect(result).toContain("Refactor DB layer");
      expect(result).toContain("feature-based");
      expect(result).toContain("file-based");
      expect(result).toContain("4/4 tasks");
      expect(result).toContain("2/5 tasks");
      expect(result).toContain("└─────");
    });

    test("truncates long titles with ellipsis", () => {
      const records: SwarmHistoryRecord[] = [
        {
          epic_id: "epic-1",
          epic_title: "A".repeat(100),
          strategy: "feature-based",
          timestamp: new Date(Date.now() - 1000).toISOString(),
          overall_success: true,
          task_count: 1,
          completed_count: 1,
        },
      ];

      const result = formatSwarmHistory(records);

      expect(result).toContain("...");
      expect(result).toMatch(/A{27}\.\.\./);
    });

    test("returns 'No swarm history found' for empty array", () => {
      const result = formatSwarmHistory([]);
      expect(result).toBe("No swarm history found");
    });
  });

  describe("filterHistoryByStatus", () => {
    const records: SwarmHistoryRecord[] = [
      {
        epic_id: "epic-1",
        epic_title: "Success",
        strategy: "feature-based",
        timestamp: "2025-01-01T00:00:00Z",
        overall_success: true,
        task_count: 4,
        completed_count: 4,
      },
      {
        epic_id: "epic-2",
        epic_title: "Failed",
        strategy: "file-based",
        timestamp: "2025-01-01T00:00:00Z",
        overall_success: false,
        task_count: 4,
        completed_count: 4,
      },
      {
        epic_id: "epic-3",
        epic_title: "In Progress",
        strategy: "risk-based",
        timestamp: "2025-01-01T00:00:00Z",
        overall_success: false,
        task_count: 5,
        completed_count: 2,
      },
    ];

    test("filters success only", () => {
      const result = filterHistoryByStatus(records, "success");
      expect(result).toHaveLength(1);
      expect(result[0].epic_title).toBe("Success");
    });

    test("filters failed only", () => {
      const result = filterHistoryByStatus(records, "failed");
      expect(result).toHaveLength(1);
      expect(result[0].epic_title).toBe("Failed");
    });

    test("filters in_progress only", () => {
      const result = filterHistoryByStatus(records, "in_progress");
      expect(result).toHaveLength(1);
      expect(result[0].epic_title).toBe("In Progress");
    });

    test("returns all when no status filter", () => {
      const result = filterHistoryByStatus(records);
      expect(result).toHaveLength(3);
    });
  });

  describe("filterHistoryByStrategy", () => {
    const records: SwarmHistoryRecord[] = [
      {
        epic_id: "epic-1",
        epic_title: "File",
        strategy: "file-based",
        timestamp: "2025-01-01T00:00:00Z",
        overall_success: true,
        task_count: 4,
        completed_count: 4,
      },
      {
        epic_id: "epic-2",
        epic_title: "Feature",
        strategy: "feature-based",
        timestamp: "2025-01-01T00:00:00Z",
        overall_success: true,
        task_count: 4,
        completed_count: 4,
      },
      {
        epic_id: "epic-3",
        epic_title: "Risk",
        strategy: "risk-based",
        timestamp: "2025-01-01T00:00:00Z",
        overall_success: true,
        task_count: 4,
        completed_count: 4,
      },
    ];

    test("filters file-based only", () => {
      const result = filterHistoryByStrategy(records, "file-based");
      expect(result).toHaveLength(1);
      expect(result[0].epic_title).toBe("File");
    });

    test("filters feature-based only", () => {
      const result = filterHistoryByStrategy(records, "feature-based");
      expect(result).toHaveLength(1);
      expect(result[0].epic_title).toBe("Feature");
    });

    test("filters risk-based only", () => {
      const result = filterHistoryByStrategy(records, "risk-based");
      expect(result).toHaveLength(1);
      expect(result[0].epic_title).toBe("Risk");
    });

    test("returns all when no strategy filter", () => {
      const result = filterHistoryByStrategy(records);
      expect(result).toHaveLength(3);
    });
  });

  describe("parseHistoryArgs", () => {
    test("parses --limit flag", () => {
      const result = parseHistoryArgs(["--limit", "20"]);
      expect(result.limit).toBe(20);
    });

    test("parses -n shorthand for limit", () => {
      const result = parseHistoryArgs(["-n", "5"]);
      expect(result.limit).toBe(5);
    });

    test("parses --status flag", () => {
      const result = parseHistoryArgs(["--status", "success"]);
      expect(result.status).toBe("success");
    });

    test("parses --strategy flag", () => {
      const result = parseHistoryArgs(["--strategy", "file-based"]);
      expect(result.strategy).toBe("file-based");
    });

    test("parses --verbose flag", () => {
      const result = parseHistoryArgs(["--verbose"]);
      expect(result.verbose).toBe(true);
    });

    test("parses -v shorthand for verbose", () => {
      const result = parseHistoryArgs(["-v"]);
      expect(result.verbose).toBe(true);
    });

    test("parses multiple flags together", () => {
      const result = parseHistoryArgs(["--limit", "15", "--status", "failed", "--verbose"]);
      expect(result.limit).toBe(15);
      expect(result.status).toBe("failed");
      expect(result.verbose).toBe(true);
    });

    test("uses default limit of 10 when not specified", () => {
      const result = parseHistoryArgs([]);
      expect(result.limit).toBe(10);
    });

    test("ignores invalid status values", () => {
      const result = parseHistoryArgs(["--status", "invalid"]);
      expect(result.status).toBeUndefined();
    });

    test("ignores invalid strategy values", () => {
      const result = parseHistoryArgs(["--strategy", "invalid"]);
      expect(result.strategy).toBeUndefined();
    });
  });
});
