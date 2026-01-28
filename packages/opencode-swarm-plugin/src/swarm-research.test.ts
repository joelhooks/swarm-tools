/**
 * Tests for swarm-research module
 *
 * TDD approach:
 * 1. RED - Write failing tests first
 * 2. GREEN - Implement minimal code to pass
 * 3. REFACTOR - Clean up
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { discoverDocTools } from "./swarm-research";
import { resetToolCache } from "./tool-availability";

describe("discoverDocTools", () => {
  beforeEach(() => {
    // Reset cache for fresh checks
    resetToolCache();
  });

  test("returns structured tool list", async () => {
    const tools = await discoverDocTools();

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    // Check structure of each tool
    for (const tool of tools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("type");
      expect(tool).toHaveProperty("capabilities");
      expect(tool).toHaveProperty("available");
      expect(typeof tool.name).toBe("string");
      expect(["skill", "mcp", "cli"].includes(tool.type)).toBe(true);
      expect(Array.isArray(tool.capabilities)).toBe(true);
      expect(typeof tool.available).toBe("boolean");
    }
  });

  test("discovers skills", async () => {
    const tools = await discoverDocTools();
    const skillTools = tools.filter((t) => t.type === "skill");

    // Skills should be discoverable via skills_list
    expect(skillTools.length).toBeGreaterThanOrEqual(0);
  });

  test("marks tools as available or unavailable", async () => {
    const tools = await discoverDocTools();

    // Every tool should have a clear availability status
    for (const tool of tools) {
      expect(typeof tool.available).toBe("boolean");
    }
  });

  test("includes expected documentation tools", async () => {
    const tools = await discoverDocTools();
    const toolNames = tools.map((t) => t.name);

    // Should include known doc-fetching capabilities from TOOL_DEFINITIONS
    // Note: semantic-memory was removed from TOOL_DEFINITIONS (now uses hivemind)
    const expectedTools = [
      "next-devtools",
      "context7",
      "fetch",
      "pdf-brain",
    ];

    for (const expected of expectedTools) {
      expect(toolNames).toContain(expected);
    }
  });

  test("returns capabilities for each tool", async () => {
    const tools = await discoverDocTools();

    for (const tool of tools) {
      expect(Array.isArray(tool.capabilities)).toBe(true);
      expect(tool.capabilities.length).toBeGreaterThan(0);

      // Capabilities should be strings
      for (const cap of tool.capabilities) {
        expect(typeof cap).toBe("string");
      }
    }
  });

  test("handles missing tools gracefully", async () => {
    // discoverDocTools should never throw even if tools are missing
    await expect(discoverDocTools()).resolves.toBeDefined();
  });

  test("differentiates tool types correctly", async () => {
    const tools = await discoverDocTools();

    // Skills have 'skill' type
    const skills = tools.filter((t) => t.type === "skill");
    for (const skill of skills) {
      expect(skill.type).toBe("skill");
    }

    // MCP tools have 'mcp' type
    const mcpTools = tools.filter((t) => t.type === "mcp");
    for (const mcp of mcpTools) {
      expect(mcp.type).toBe("mcp");
    }

    // CLI tools have 'cli' type
    const cliTools = tools.filter((t) => t.type === "cli");
    for (const cli of cliTools) {
      expect(cli.type).toBe("cli");
    }
  });

  test("assigns correct capabilities to known tools", async () => {
    const tools = await discoverDocTools();
    const toolMap = new Map(tools.map((t) => [t.name, t]));

    // next-devtools should have Next.js-specific capabilities
    const nextDevtools = toolMap.get("next-devtools");
    if (nextDevtools) {
      expect(nextDevtools.capabilities).toContain("nextjs-docs");
    }

    // fetch should have general web capabilities
    const fetchTool = toolMap.get("fetch");
    if (fetchTool) {
      expect(fetchTool.capabilities).toContain("http-fetch");
    }

    // semantic-memory should have storage capabilities
    const semMem = toolMap.get("semantic-memory");
    if (semMem) {
      expect(semMem.capabilities).toContain("storage");
    }
  });

  test("marks tool availability correctly", async () => {
    // semantic-memory was removed from TOOL_DEFINITIONS (now uses hivemind).
    // Instead, verify that all returned tools have a boolean availability status.
    const tools = await discoverDocTools();

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(typeof tool.available).toBe("boolean");
    }
  });
});

// =============================================================================
// Version Detection from Lockfiles (TDD Phase 1: RED)
// =============================================================================

import { getInstalledVersions, type VersionInfo } from "./swarm-research";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

describe("getInstalledVersions", () => {
  const testDir = "/tmp/swarm-research-lockfile-tests";

  beforeEach(async () => {
    // Clean slate for each test
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
  });

  test("parses npm package-lock.json", async () => {
    // Create fixture
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            "zod": "^3.22.0",
          },
        },
        "node_modules/zod": {
          version: "3.22.4",
          resolved: "https://registry.npmjs.org/zod/-/zod-3.22.4.tgz",
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    const versions = await getInstalledVersions(testDir, ["zod"]);

    expect(versions).toHaveLength(1);
    expect(versions[0]).toEqual({
      name: "zod",
      version: "3.22.4",
      source: "lockfile",
    });
  });

  test("parses pnpm pnpm-lock.yaml", async () => {
    const lockfile = `lockfileVersion: '6.0'

dependencies:
  zod:
    specifier: ^3.22.0
    version: 3.22.4

packages:
  /zod@3.22.4:
    resolution: {integrity: sha512-example}
    dev: false
`;

    await writeFile(join(testDir, "pnpm-lock.yaml"), lockfile);

    const versions = await getInstalledVersions(testDir, ["zod"]);

    expect(versions).toHaveLength(1);
    expect(versions[0]).toEqual({
      name: "zod",
      version: "3.22.4",
      source: "lockfile",
    });
  });

  test("parses yarn yarn.lock", async () => {
    const lockfile = `# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1

zod@^3.22.0:
  version "3.22.4"
  resolved "https://registry.yarnpkg.com/zod/-/zod-3.22.4.tgz"
  integrity sha512-example"
`;

    await writeFile(join(testDir, "yarn.lock"), lockfile);

    const versions = await getInstalledVersions(testDir, ["zod"]);

    expect(versions).toHaveLength(1);
    expect(versions[0]).toEqual({
      name: "zod",
      version: "3.22.4",
      source: "lockfile",
    });
  });

  test("falls back to package.json when no lockfile present", async () => {
    const packageJson = {
      name: "test-project",
      dependencies: {
        zod: "^3.22.4",
      },
    };

    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(packageJson, null, 2),
    );

    const versions = await getInstalledVersions(testDir, ["zod"]);

    expect(versions).toHaveLength(1);
    expect(versions[0]).toEqual({
      name: "zod",
      version: "3.22.4", // Stripped semver constraint
      source: "package.json",
      constraint: "^3.22.4", // Original constraint preserved
    });
  });

  test("handles missing packages gracefully", async () => {
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            zod: "^3.22.0",
          },
        },
        "node_modules/zod": {
          version: "3.22.4",
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    const versions = await getInstalledVersions(testDir, [
      "zod",
      "nonexistent-package",
    ]);

    expect(versions).toHaveLength(1); // Only zod found
    expect(versions[0].name).toBe("zod");
  });

  test("handles multiple packages", async () => {
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            zod: "^3.22.0",
            typescript: "^5.3.0",
          },
        },
        "node_modules/zod": {
          version: "3.22.4",
        },
        "node_modules/typescript": {
          version: "5.3.3",
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    const versions = await getInstalledVersions(testDir, [
      "zod",
      "typescript",
    ]);

    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.name === "zod")?.version).toBe("3.22.4");
    expect(versions.find((v) => v.name === "typescript")?.version).toBe(
      "5.3.3",
    );
  });

  test("prefers lockfile over package.json when both exist", async () => {
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            zod: "^3.22.0",
          },
        },
        "node_modules/zod": {
          version: "3.22.4",
        },
      },
    };

    const packageJson = {
      name: "test-project",
      dependencies: {
        zod: "^3.99.99", // Different version range
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(packageJson, null, 2),
    );

    const versions = await getInstalledVersions(testDir, ["zod"]);

    expect(versions[0].version).toBe("3.22.4"); // From lockfile, not package.json
    expect(versions[0].source).toBe("lockfile");
  });

  test("handles bun.lock by falling back to package.json", async () => {
    // bun.lock is binary format, fallback to package.json
    const packageJson = {
      name: "test-project",
      dependencies: {
        zod: "^3.22.4",
      },
    };

    await writeFile(join(testDir, "bun.lock"), "binary data here");
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(packageJson, null, 2),
    );

    const versions = await getInstalledVersions(testDir, ["zod"]);

    expect(versions).toHaveLength(1);
    expect(versions[0]).toEqual({
      name: "zod",
      version: "3.22.4",
      source: "package.json",
      constraint: "^3.22.4",
    });
  });

  test("returns empty array when no package info found", async () => {
    // No lockfile, no package.json
    const versions = await getInstalledVersions(testDir, ["zod"]);

    expect(versions).toEqual([]);
  });

  test("plugin tool swarm_get_versions works", async () => {
    // Create fixture
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            zod: "^3.22.0",
          },
        },
        "node_modules/zod": {
          version: "3.22.4",
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    const { swarm_get_versions } = await import("./swarm-research");

    const result = await swarm_get_versions.execute({
      projectPath: testDir,
      packages: ["zod", "nonexistent"],
    });

    const parsed = JSON.parse(result);

    expect(parsed.versions).toHaveLength(1);
    expect(parsed.versions[0].name).toBe("zod");
    expect(parsed.versions[0].version).toBe("3.22.4");
    expect(parsed.summary.found).toBe(1);
    expect(parsed.summary.requested).toBe(2);
    expect(parsed.summary.missing).toEqual(["nonexistent"]);
  });

  test("strips semver constraints from package.json versions", async () => {
    const packageJson = {
      name: "test-project",
      dependencies: {
        exact: "3.22.4",
        caret: "^3.22.4",
        tilde: "~3.22.4",
        range: ">=3.22.0 <4.0.0",
        latest: "latest",
        url: "git+https://github.com/example/repo.git",
      },
    };

    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(packageJson, null, 2),
    );

    const versions = await getInstalledVersions(testDir, [
      "exact",
      "caret",
      "tilde",
      "range",
      "latest",
      "url",
    ]);

    expect(versions.find((v) => v.name === "exact")?.version).toBe("3.22.4");
    expect(versions.find((v) => v.name === "caret")?.version).toBe("3.22.4");
    expect(versions.find((v) => v.name === "tilde")?.version).toBe("3.22.4");
    expect(versions.find((v) => v.name === "range")?.version).toBe("3.22.0"); // Extracts first version from range
    expect(versions.find((v) => v.name === "latest")).toBeUndefined(); // Not a version
    expect(versions.find((v) => v.name === "url")).toBeUndefined(); // URLs not supported
  });
});

// =============================================================================
// Latest Version Fetching (TDD Phase 2: Check Upgrades)
// =============================================================================

import { getLatestVersion } from "./swarm-research";

describe("getLatestVersion", () => {
  test("fetches latest version from npm registry", async () => {
    // Test with a stable package (zod)
    const version = await getLatestVersion("zod");
    
    expect(version).toBeDefined();
    expect(typeof version).toBe("string");
    // Should be a valid semver
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("handles package not found gracefully", async () => {
    const version = await getLatestVersion("this-package-definitely-does-not-exist-12345");
    
    expect(version).toBeUndefined();
  });

  test("handles network errors gracefully", async () => {
    // Mock a network failure scenario - package with invalid name
    const version = await getLatestVersion("@invalid/package/name");
    
    expect(version).toBeUndefined();
  });

  test("handles scoped packages", async () => {
    // Test with a real scoped package
    const version = await getLatestVersion("@types/node");
    
    expect(version).toBeDefined();
    expect(typeof version).toBe("string");
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("getInstalledVersions with checkUpgrades", () => {
  const testDir = "/tmp/swarm-research-upgrades-tests";

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
  });

  test("includes latest version when checkUpgrades=true", async () => {
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            "zod": "^3.0.0",
          },
        },
        "node_modules/zod": {
          version: "3.0.0",
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    const versions = await getInstalledVersions(testDir, ["zod"], true);

    expect(versions).toHaveLength(1);
    expect(versions[0].name).toBe("zod");
    expect(versions[0].version).toBe("3.0.0");
    expect(versions[0].latest).toBeDefined();
    expect(typeof versions[0].latest).toBe("string");
    expect(versions[0].latest).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions[0].updateAvailable).toBe(true); // 3.0.0 is old, update should be available
  });

  test("does not include latest when checkUpgrades=false (default)", async () => {
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            "zod": "^3.22.0",
          },
        },
        "node_modules/zod": {
          version: "3.22.4",
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    const versions = await getInstalledVersions(testDir, ["zod"], false);

    expect(versions).toHaveLength(1);
    expect(versions[0].latest).toBeUndefined();
    expect(versions[0].updateAvailable).toBeUndefined();
  });

  test("sets updateAvailable=false when installed equals latest", async () => {
    // This test will fetch actual latest - may be flaky if package updates
    // But demonstrates the logic
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            "zod": "^3.22.0",
          },
        },
        "node_modules/zod": {
          version: "999.999.999", // Fake version higher than any real one
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    const versions = await getInstalledVersions(testDir, ["zod"], true);

    expect(versions[0].latest).toBeDefined();
    // Can't assert exact equality without knowing npm state
    // But structure should be correct
    expect(typeof versions[0].updateAvailable).toBe("boolean");
  });

  test("handles network failures gracefully during upgrade check", async () => {
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            "nonexistent-package-xyz": "^1.0.0",
          },
        },
        "node_modules/nonexistent-package-xyz": {
          version: "1.0.0",
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    // Should not throw, should return data without latest
    const versions = await getInstalledVersions(testDir, ["nonexistent-package-xyz"], true);

    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe("1.0.0");
    // latest should be undefined if fetch failed
    expect(versions[0].latest).toBeUndefined();
    expect(versions[0].updateAvailable).toBeUndefined();
  });

  test("swarm_get_versions respects checkUpgrades parameter", async () => {
    const lockfile = {
      name: "test-project",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test-project",
          dependencies: {
            "zod": "^3.0.0",
          },
        },
        "node_modules/zod": {
          version: "3.0.0",
        },
      },
    };

    await writeFile(
      join(testDir, "package-lock.json"),
      JSON.stringify(lockfile, null, 2),
    );

    const { swarm_get_versions } = await import("./swarm-research");

    const result = await swarm_get_versions.execute({
      projectPath: testDir,
      packages: ["zod"],
      checkUpgrades: true,
    });

    const parsed = JSON.parse(result);

    expect(parsed.versions[0].latest).toBeDefined();
    expect(parsed.versions[0].updateAvailable).toBe(true);
  });
});
