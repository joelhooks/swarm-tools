/**
 * @fileoverview Tests for enhanced doctor command
 *
 * Tests each health check individually and the combined doctor runner.
 * Uses in-memory libSQL database for isolation.
 */

import { describe, expect, test, beforeAll, beforeEach, afterAll } from "bun:test";
import { createInMemorySwarmMailLibSQL, createHiveAdapter } from "swarm-mail";
import type { SwarmMailAdapter } from "swarm-mail";
import type { DatabaseAdapter } from "swarm-mail";
import {
  checkDbIntegrity,
  checkOrphanedCells,
  checkDependencyCycles,
  checkStaleReservations,
  checkZombieBlocked,
  checkGhostWorkers,
  detectCycles,
  runDoctor,
  formatDoctorReport,
  parseDoctorArgs,
} from "./doctor.js";

// ============================================================================
// Test Helpers
// ============================================================================

async function createTestDb(testId: string): Promise<{
  swarmMail: SwarmMailAdapter;
  db: DatabaseAdapter;
  projectPath: string;
}> {
  const swarmMail = await createInMemorySwarmMailLibSQL(testId);
  const db = await swarmMail.getDatabase();
  const projectPath = `/tmp/test-doctor-${testId}`;

  // Initialize hive schema
  const adapter = createHiveAdapter(db, projectPath);
  await adapter.runMigrations();

  // Also run swarm-mail migrations (for reservations table)
  await swarmMail.runMigrations();

  return { swarmMail, db, projectPath };
}

// ============================================================================
// checkDbIntegrity
// ============================================================================

describe("checkDbIntegrity", () => {
  let swarmMail: SwarmMailAdapter;
  let db: DatabaseAdapter;

  beforeAll(async () => {
    const setup = await createTestDb("integrity");
    swarmMail = setup.swarmMail;
    db = setup.db;
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("passes on healthy database", async () => {
    const result = await checkDbIntegrity(db);
    expect(result.status).toBe("pass");
    expect(result.message).toBe("OK");
  });
});

// ============================================================================
// checkOrphanedCells
// ============================================================================

describe("checkOrphanedCells", () => {
  let swarmMail: SwarmMailAdapter;
  let db: DatabaseAdapter;
  let projectPath: string;

  beforeAll(async () => {
    const setup = await createTestDb("orphans");
    swarmMail = setup.swarmMail;
    db = setup.db;
    projectPath = setup.projectPath;
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("passes with no orphans", async () => {
    const adapter = createHiveAdapter(db, projectPath);

    // Create epic and child — valid reference
    const epic = await adapter.createCell(projectPath, {
      title: "Valid Epic",
      type: "epic",
      priority: 0,
    });

    await adapter.createCell(projectPath, {
      title: "Valid Child",
      type: "task",
      priority: 1,
      parent_id: epic.id,
    });

    const result = await checkOrphanedCells(db);
    expect(result.status).toBe("pass");
  });

  test("detects orphaned cells", async () => {
    // Disable foreign key checks to insert orphan
    await db.exec("PRAGMA foreign_keys = OFF");
    await db.query(
      `INSERT INTO beads (id, project_key, type, status, title, priority, parent_id, created_at, updated_at)
       VALUES (?, ?, 'task', 'open', 'Orphan Cell', 1, 'nonexistent-parent', ?, ?)`,
      ["orphan-test-1", projectPath, Date.now(), Date.now()]
    );
    await db.exec("PRAGMA foreign_keys = ON");

    const result = await checkOrphanedCells(db);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("orphaned");
    expect(result.fixable).toBe(true);
    expect(result.details).toBeDefined();
    expect(result.details!.length).toBeGreaterThan(0);
  });

  test("fixes orphaned cells with --fix", async () => {
    const result = await checkOrphanedCells(db, { fix: true });
    expect(result.fixed).toBeGreaterThan(0);

    // Verify fix — no more orphans
    const verify = await checkOrphanedCells(db);
    expect(verify.status).toBe("pass");
  });
});

// ============================================================================
// checkDependencyCycles
// ============================================================================

describe("checkDependencyCycles", () => {
  let swarmMail: SwarmMailAdapter;
  let db: DatabaseAdapter;
  let projectPath: string;

  beforeAll(async () => {
    const setup = await createTestDb("cycles");
    swarmMail = setup.swarmMail;
    db = setup.db;
    projectPath = setup.projectPath;
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("passes with no dependencies", async () => {
    const result = await checkDependencyCycles(db);
    expect(result.status).toBe("pass");
  });

  test("passes with acyclic dependencies", async () => {
    const adapter = createHiveAdapter(db, projectPath);

    const cellA = await adapter.createCell(projectPath, {
      title: "Cell A", type: "task", priority: 1,
    });
    const cellB = await adapter.createCell(projectPath, {
      title: "Cell B", type: "task", priority: 2,
    });
    const cellC = await adapter.createCell(projectPath, {
      title: "Cell C", type: "task", priority: 3,
    });

    // A → B → C (no cycle)
    await adapter.addDependency(projectPath, cellA.id, cellB.id, "blocks");
    await adapter.addDependency(projectPath, cellB.id, cellC.id, "blocks");

    const result = await checkDependencyCycles(db);
    expect(result.status).toBe("pass");
  });

  test("detects circular dependencies", async () => {
    const adapter = createHiveAdapter(db, projectPath);

    const cellX = await adapter.createCell(projectPath, {
      title: "Cycle X", type: "task", priority: 1,
    });
    const cellY = await adapter.createCell(projectPath, {
      title: "Cycle Y", type: "task", priority: 2,
    });
    const cellZ = await adapter.createCell(projectPath, {
      title: "Cycle Z", type: "task", priority: 3,
    });

    // The adapter prevents cycles, so we insert the cyclic dependency directly via SQL
    // First create two valid deps via adapter
    await adapter.addDependency(projectPath, cellX.id, cellY.id, "blocks");
    await adapter.addDependency(projectPath, cellY.id, cellZ.id, "blocks");

    // Now force the cycle-closing edge directly in SQL
    const now = Date.now();
    await db.query(
      `INSERT INTO bead_dependencies (cell_id, depends_on_id, relationship, created_at)
       VALUES (?, ?, 'blocks', ?)`,
      [cellZ.id, cellX.id, now]
    );

    const result = await checkDependencyCycles(db);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("cycle");
    expect(result.fixable).toBe(false);
  });

  test("reports cycle is not fixable", async () => {
    // The cycle from previous test should still be present
    const result = await checkDependencyCycles(db);
    expect(result.status).toBe("fail");
    expect(result.fixable).toBe(false);
  });
});

// ============================================================================
// detectCycles (unit test for the DFS algorithm)
// ============================================================================

describe("detectCycles", () => {
  test("empty graph has no cycles", () => {
    const graph = new Map<string, string[]>();
    expect(detectCycles(graph)).toEqual([]);
  });

  test("linear graph has no cycles", () => {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
    ]);
    expect(detectCycles(graph)).toEqual([]);
  });

  test("self-loop is a cycle", () => {
    const graph = new Map<string, string[]>([
      ["A", ["A"]],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBe(1);
    // The cycle should contain A
    expect(cycles[0]).toContain("A");
  });

  test("two-node cycle", () => {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["A"]],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  test("three-node cycle", () => {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  test("diamond shape (no cycle)", () => {
    const graph = new Map<string, string[]>([
      ["A", ["B", "C"]],
      ["B", ["D"]],
      ["C", ["D"]],
    ]);
    expect(detectCycles(graph)).toEqual([]);
  });
});

// ============================================================================
// checkStaleReservations
// ============================================================================

describe("checkStaleReservations", () => {
  let swarmMail: SwarmMailAdapter;
  let db: DatabaseAdapter;
  let projectPath: string;

  beforeAll(async () => {
    const setup = await createTestDb("reservations");
    swarmMail = setup.swarmMail;
    db = setup.db;
    projectPath = setup.projectPath;
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("passes with no reservations", async () => {
    const result = await checkStaleReservations(db);
    expect(result.status).toBe("pass");
  });

  test("detects stale reservations", async () => {
    const pastTime = Date.now() - 3600_000; // 1 hour ago

    // Insert an expired reservation directly
    await db.query(
      `INSERT INTO reservations (project_key, agent_name, path_pattern, exclusive, created_at, expires_at)
       VALUES (?, 'test-agent', 'src/foo.ts', 1, ?, ?)`,
      [projectPath, pastTime - 60000, pastTime]
    );

    const result = await checkStaleReservations(db);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("stale");
    expect(result.fixable).toBe(true);
  });

  test("fixes stale reservations with --fix", async () => {
    const result = await checkStaleReservations(db, { fix: true });
    expect(result.fixed).toBeGreaterThan(0);

    // Verify fix — no more stale reservations
    const verify = await checkStaleReservations(db);
    expect(verify.status).toBe("pass");
  });

  test("ignores active reservations", async () => {
    const futureTime = Date.now() + 3600_000; // 1 hour from now

    await db.query(
      `INSERT INTO reservations (project_key, agent_name, path_pattern, exclusive, created_at, expires_at)
       VALUES (?, 'active-agent', 'src/bar.ts', 1, ?, ?)`,
      [projectPath, Date.now(), futureTime]
    );

    const result = await checkStaleReservations(db);
    expect(result.status).toBe("pass");
  });
});

// ============================================================================
// checkZombieBlocked
// ============================================================================

describe("checkZombieBlocked", () => {
  let swarmMail: SwarmMailAdapter;
  let db: DatabaseAdapter;
  let projectPath: string;

  beforeAll(async () => {
    const setup = await createTestDb("zombies");
    swarmMail = setup.swarmMail;
    db = setup.db;
    projectPath = setup.projectPath;
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("passes with no blocked cells", async () => {
    const result = await checkZombieBlocked(db);
    expect(result.status).toBe("pass");
  });

  test("detects zombie blocked cells", async () => {
    const adapter = createHiveAdapter(db, projectPath);

    // Create a blocker cell and close it
    const blocker = await adapter.createCell(projectPath, {
      title: "Blocker Task", type: "task", priority: 1,
    });
    await adapter.closeCell(projectPath, blocker.id, "Done");

    // Create a cell that depends on the blocker
    const blocked = await adapter.createCell(projectPath, {
      title: "Zombie Blocked Task", type: "task", priority: 2,
    });

    // Set it to blocked status
    await adapter.changeCellStatus(projectPath, blocked.id, "blocked");

    // Add dependency
    await adapter.addDependency(projectPath, blocked.id, blocker.id, "blocks");

    const result = await checkZombieBlocked(db);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("should be unblocked");
    expect(result.fixable).toBe(true);
  });

  test("fixes zombie blocked cells with --fix", async () => {
    const result = await checkZombieBlocked(db, { fix: true });
    expect(result.fixed).toBeGreaterThan(0);

    // Verify fix — no more zombies
    const verify = await checkZombieBlocked(db);
    expect(verify.status).toBe("pass");
  });
});

// ============================================================================
// checkGhostWorkers
// ============================================================================

describe("checkGhostWorkers", () => {
  let swarmMail: SwarmMailAdapter;
  let db: DatabaseAdapter;
  let projectPath: string;

  beforeAll(async () => {
    const setup = await createTestDb("ghosts");
    swarmMail = setup.swarmMail;
    db = setup.db;
    projectPath = setup.projectPath;
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("passes with no in-progress cells", async () => {
    const result = await checkGhostWorkers(db);
    expect(result.status).toBe("pass");
  });

  test("detects ghost in-progress cells with inactive agents", async () => {
    const adapter = createHiveAdapter(db, projectPath);

    // Create a cell and set it to in_progress
    const cell = await adapter.createCell(projectPath, {
      title: "Ghost Task", type: "task", priority: 1, assignee: "ghost-agent",
    });
    await adapter.changeCellStatus(projectPath, cell.id, "in_progress");

    // Insert an agent with stale last_active_at
    const staleTime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    await db.query(
      `INSERT OR REPLACE INTO agents (project_key, name, registered_at, last_active_at)
       VALUES (?, 'ghost-agent', ?, ?)`,
      [projectPath, staleTime, staleTime]
    );

    // Use a very short cutoff to make sure it detects it
    const result = await checkGhostWorkers(db, 1000); // 1 second cutoff
    expect(result.status).toBe("warn");
    expect(result.message).toContain("in-progress");
    expect(result.fixable).toBe(false);
  });
});

// ============================================================================
// runDoctor (combined)
// ============================================================================

describe("runDoctor", () => {
  let swarmMail: SwarmMailAdapter;
  let db: DatabaseAdapter;

  beforeAll(async () => {
    const setup = await createTestDb("combined");
    swarmMail = setup.swarmMail;
    db = setup.db;
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("runs all checks and returns report", async () => {
    const report = await runDoctor(db);

    expect(report.checks.length).toBe(6);
    expect(report.timestamp).toBeTruthy();
    expect(report.passed).toBeGreaterThanOrEqual(0);
    expect(report.passed + report.failed + report.warned).toBe(6);
  });

  test("reports all passing on clean database", async () => {
    const report = await runDoctor(db);

    // On a fresh database, most checks should pass
    expect(report.passed).toBeGreaterThanOrEqual(4);
  });

  test("supports --fix option", async () => {
    const report = await runDoctor(db, { fix: true });
    expect(report.checks.length).toBe(6);
  });
});

// ============================================================================
// formatDoctorReport
// ============================================================================

describe("formatDoctorReport", () => {
  test("formats passing report", () => {
    const report = {
      checks: [
        { name: "Database integrity", status: "pass" as const, message: "OK" },
        { name: "Cell references", status: "pass" as const, message: "OK" },
      ],
      passed: 2,
      failed: 0,
      warned: 0,
      fixed: 0,
      timestamp: new Date().toISOString(),
    };

    const output = formatDoctorReport(report);
    expect(output).toContain("Swarm Doctor");
    expect(output).toContain("Database integrity");
    expect(output).toContain("2/2 checks passed");
  });

  test("formats failing report with fix suggestion", () => {
    const report = {
      checks: [
        { name: "Database integrity", status: "pass" as const, message: "OK" },
        {
          name: "Zombie blocked",
          status: "fail" as const,
          message: "2 cells should be unblocked",
          fixable: true,
          details: ['cell-1 ("Task 1")', 'cell-2 ("Task 2")'],
        },
      ],
      passed: 1,
      failed: 1,
      warned: 0,
      fixed: 0,
      timestamp: new Date().toISOString(),
    };

    const output = formatDoctorReport(report);
    expect(output).toContain("1/2 checks passed");
    expect(output).toContain("1 issue(s) found");
    expect(output).toContain("--fix");
  });

  test("formats report after fix", () => {
    const report = {
      checks: [
        {
          name: "Zombie blocked",
          status: "warn" as const,
          message: "Unblocked 2 zombie cell(s)",
          fixed: 2,
        },
      ],
      passed: 0,
      failed: 0,
      warned: 1,
      fixed: 2,
      timestamp: new Date().toISOString(),
    };

    const output = formatDoctorReport(report, { fix: true });
    expect(output).toContain("2 item(s) fixed");
    expect(output).not.toContain("Run with --fix");
  });

  test("truncates long detail lists", () => {
    const details = Array.from({ length: 10 }, (_, i) => `detail-${i}`);
    const report = {
      checks: [
        {
          name: "Test check",
          status: "fail" as const,
          message: "10 issues",
          details,
        },
      ],
      passed: 0,
      failed: 1,
      warned: 0,
      fixed: 0,
      timestamp: new Date().toISOString(),
    };

    const output = formatDoctorReport(report);
    expect(output).toContain("... and 5 more");
  });
});

// ============================================================================
// parseDoctorArgs
// ============================================================================

describe("parseDoctorArgs", () => {
  test("parses --fix", () => {
    const opts = parseDoctorArgs(["--fix"]);
    expect(opts.fix).toBe(true);
    expect(opts.json).toBeFalsy();
  });

  test("parses --json", () => {
    const opts = parseDoctorArgs(["--json"]);
    expect(opts.json).toBe(true);
    expect(opts.fix).toBeFalsy();
  });

  test("parses both flags", () => {
    const opts = parseDoctorArgs(["--fix", "--json"]);
    expect(opts.fix).toBe(true);
    expect(opts.json).toBe(true);
  });

  test("returns defaults for no args", () => {
    const opts = parseDoctorArgs([]);
    expect(opts.fix).toBe(false);
    expect(opts.json).toBe(false);
  });
});
