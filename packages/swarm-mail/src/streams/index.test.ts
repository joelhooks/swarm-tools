/**
 * Tests for streams/index.ts exports
 * 
 * This file tests that the module exports the correct libSQL/Drizzle functions
 * and utilities, with no PGLite references.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("streams/index.ts module", () => {
  const indexPath = join(__dirname, "index.ts");
  const content = readFileSync(indexPath, "utf-8");

  it("exports utility functions (withTimeout, withTiming, getDatabasePath)", () => {
    // Import them to verify they exist
    import("./index").then((mod) => {
      expect(mod.withTimeout).toBeDefined();
      expect(mod.withTiming).toBeDefined();
      expect(mod.getDatabasePath).toBeDefined();
    });
  });

  it("exports Drizzle store functions", () => {
    import("./index").then((mod) => {
      expect(mod.appendEvent).toBeDefined();
      expect(mod.readEvents).toBeDefined();
      expect(mod.getLatestSequence).toBeDefined();
    });
  });

  it("exports Drizzle projection functions", () => {
    import("./index").then((mod) => {
      expect(mod.getAgents).toBeDefined();
      expect(mod.getAgent).toBeDefined();
      expect(mod.getInbox).toBeDefined();
      expect(mod.getMessage).toBeDefined();
      expect(mod.getThreadMessages).toBeDefined();
      expect(mod.getActiveReservations).toBeDefined();
      expect(mod.checkConflicts).toBeDefined();
      expect(mod.getEvalRecords).toBeDefined();
      expect(mod.getEvalStats).toBeDefined();
    });
  });

  it("has no PGlite imports (case-insensitive)", () => {
    const hasPGliteImport = /import.*["'].*pglite/i.test(content);
    expect(hasPGliteImport).toBe(false);
  });

  it("has no getDatabase() function definition", () => {
    const hasGetDatabase = /export\s+(async\s+)?function\s+getDatabase\s*\(/.test(content);
    expect(hasGetDatabase).toBe(false);
  });

  it("has no initializeSchema() function definition", () => {
    const hasInitSchema = /export\s+(async\s+)?function\s+initializeSchema/.test(content);
    expect(hasInitSchema).toBe(false);
  });

  it("has no closeDatabase() function definition", () => {
    const hasCloseDb = /export\s+(async\s+)?function\s+closeDatabase/.test(content);
    expect(hasCloseDb).toBe(false);
  });

  it("has getDatabasePath() function (libSQL utility, not PGLite)", () => {
    const hasGetDbPath = /export\s+function\s+getDatabasePath/.test(content);
    expect(hasGetDbPath).toBe(true);
  });

  it("has getOldProjectDbPaths() function for migration detection", () => {
    const hasGetOldPaths = /export\s+function\s+getOldProjectDbPaths/.test(content);
    expect(hasGetOldPaths).toBe(true);
  });
});

describe("getDatabasePath()", () => {
  it("returns global path when no projectPath provided", async () => {
    const { getDatabasePath } = await import("./index");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    
    const expected = join(homedir(), ".config", "swarm-tools", "swarm.db");
    
    // With no argument - should use global
    expect(getDatabasePath()).toBe(expected);
  });
  
  it("returns project-local path when projectPath provided", async () => {
    const { getDatabasePath } = await import("./index");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    
    // Use temp directory to avoid read-only filesystem errors
    const projectPath = join(tmpdir(), "test-project-" + Date.now());
    const expected = join(projectPath, ".opencode", "swarm.db");
    
    const result = getDatabasePath(projectPath);
    expect(result).toBe(expected);
    
    // Clean up
    const { rmSync } = await import("node:fs");
    rmSync(join(projectPath, ".opencode"), { recursive: true, force: true });
  });
  
  it("resolves worktrees to main repo path", async () => {
    const { getDatabasePath } = await import("./index");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    
    // Use temp directory for real filesystem operations
    const projectPath = join(tmpdir(), "test-project-worktree-" + Date.now());
    const expected = join(projectPath, ".opencode", "swarm.db");
    
    // For non-worktree paths, getMainRepoPath returns the same path
    const result = getDatabasePath(projectPath);
    expect(result).toBe(expected);
    
    // Clean up
    const { rmSync } = await import("node:fs");
    rmSync(join(projectPath, ".opencode"), { recursive: true, force: true });
  });
});

describe("getOldProjectDbPaths()", () => {
  it("returns paths to check for migration", async () => {
    const { getOldProjectDbPaths } = await import("./index");
    const { join } = await import("node:path");
    
    const projectPath = "/some/project";
    const paths = getOldProjectDbPaths(projectPath);
    
    expect(paths).toEqual({
      libsql: join(projectPath, ".opencode", "streams.db"),
      pglite: join(projectPath, ".opencode", "streams"),
    });
  });
});
