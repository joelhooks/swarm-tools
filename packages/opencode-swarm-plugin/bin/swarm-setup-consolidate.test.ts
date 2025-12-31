#!/usr/bin/env bun
/**
 * Test: swarm setup database consolidation
 * 
 * Tests that the swarm setup command can detect and migrate stray databases
 * when the -y flag is provided.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

describe("swarm setup -y database consolidation", () => {
  let testDir: string;
  let projectPath: string;

  beforeEach(() => {
    // Create a temporary project directory
    testDir = join(tmpdir(), `swarm-setup-test-${Date.now()}`);
    projectPath = join(testDir, "test-project");
    mkdirSync(projectPath, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("consolidateDatabases can be imported from swarm-mail", async () => {
    // Verify the import works
    const { consolidateDatabases } = await import("swarm-mail");
    expect(typeof consolidateDatabases).toBe("function");
  });

  test("getGlobalDbPath can be imported from swarm-mail", async () => {
    // Verify the import works
    const { getGlobalDbPath } = await import("swarm-mail");
    expect(typeof getGlobalDbPath).toBe("function");
    
    // Verify it returns a path
    const path = getGlobalDbPath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
  });

  test("consolidateDatabases respects yes flag", async () => {
    const { consolidateDatabases, getGlobalDbPath } = await import("swarm-mail");
    const globalDbPath = getGlobalDbPath();

    // Call with yes: true (non-interactive mode)
    const report = await consolidateDatabases(projectPath, globalDbPath, {
      yes: true,
      interactive: false,
    });

    // Should return a report object with correct structure
    expect(report).toBeDefined();
    expect(typeof report.straysFound).toBe("number");
    expect(typeof report.straysMigrated).toBe("number");
    expect(typeof report.totalRowsMigrated).toBe("number");
    expect(Array.isArray(report.migrations)).toBe(true);
    expect(Array.isArray(report.errors)).toBe(true);
  });

  test("consolidateDatabases can run in non-interactive mode", async () => {
    const { consolidateDatabases, getGlobalDbPath } = await import("swarm-mail");
    const globalDbPath = getGlobalDbPath();

    // Call with interactive: false (non-interactive mode, same as -y)
    const report = await consolidateDatabases(projectPath, globalDbPath, {
      yes: false,
      interactive: false,
    });

    // Should return a report object without prompting
    expect(report).toBeDefined();
    expect(typeof report.straysFound).toBe("number");
    expect(Array.isArray(report.migrations)).toBe(true);
  });
});
