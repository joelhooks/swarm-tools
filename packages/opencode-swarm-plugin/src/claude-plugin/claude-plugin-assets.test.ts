/**
 * Unit tests for Claude plugin runtime asset copying.
 */
import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  assertClaudePluginMcpEntrypointSynced,
  copyClaudePluginRuntimeAssets,
} from "./claude-plugin-assets";

type PackageManifest = {
  files?: string[];
};

// Resolve paths relative to this test file's location in the package
const PACKAGE_ROOT = join(__dirname, "..", "..");
const BUILD_SCRIPT_PATH = join(PACKAGE_ROOT, "scripts", "build.ts");

/**
 * Reads the package manifest for published file assertions.
 */
function readPackageManifest(): PackageManifest {
  const manifestPath = join(PACKAGE_ROOT, "package.json");
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as PackageManifest;
}

/**
 * Reads the build script source for packaging checks.
 */
function readBuildScript(): string {
  return readFileSync(BUILD_SCRIPT_PATH, "utf-8");
}

describe("claude-plugin runtime assets", () => {
  it("publishes the claude-plugin runtime dist", () => {
    const manifest = readPackageManifest();

    expect(manifest.files).toContain("claude-plugin/dist");
    expect(manifest.files).toContain("claude-plugin/dist/mcp");
    expect(manifest.files).toContain("dist/mcp");
    expect(manifest.files).toContain("claude-plugin");
  });

  it("syncs claude-plugin runtime assets during build", () => {
    const source = readBuildScript();

    expect(source).toContain("copyClaudePluginRuntimeAssets");
    expect(source).toContain("assertClaudePluginMcpEntrypointSynced");
    expect(source).toContain("claude-plugin/dist");
    expect(source).toContain("swarm-mcp-server");
    expect(source).toContain("dist/mcp");
  });

  it("throws if the runtime bundle is missing", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const distRoot = join(workspaceRoot, "dist");
      mkdirSync(distRoot, { recursive: true });

      expect(() =>
        copyClaudePluginRuntimeAssets({ packageRoot: workspaceRoot }),
      ).toThrowError(/Missing marketplace bundle/);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("throws if the marketplace bundle is missing", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const distRoot = join(workspaceRoot, "dist");
      mkdirSync(distRoot, { recursive: true });

      writeFileSync(join(distRoot, "index.js"), "runtime-bundle");

      expect(() =>
        copyClaudePluginRuntimeAssets({ packageRoot: workspaceRoot }),
      ).toThrowError(/Missing marketplace bundle/);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("throws when the claude-plugin MCP entrypoint is stale", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const distRoot = join(workspaceRoot, "dist");
      const pluginRoot = join(workspaceRoot, "claude-plugin");
      const pluginDist = join(pluginRoot, "dist", "mcp");

      mkdirSync(join(distRoot, "mcp"), { recursive: true });
      mkdirSync(pluginDist, { recursive: true });

      writeFileSync(join(distRoot, "mcp", "swarm-mcp-server.cjs"), "latest");
      writeFileSync(join(pluginDist, "swarm-mcp-server.cjs"), "stale");

      expect(() =>
        assertClaudePluginMcpEntrypointSynced({ packageRoot: workspaceRoot }),
      ).toThrowError(/MCP entrypoint is out of sync/);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("accepts matching claude-plugin MCP entrypoints", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const distRoot = join(workspaceRoot, "dist");
      const pluginRoot = join(workspaceRoot, "claude-plugin");
      const pluginDist = join(pluginRoot, "dist", "mcp");

      mkdirSync(join(distRoot, "mcp"), { recursive: true });
      mkdirSync(pluginDist, { recursive: true });

      writeFileSync(join(distRoot, "mcp", "swarm-mcp-server.cjs"), "matched");
      writeFileSync(join(pluginDist, "swarm-mcp-server.cjs"), "matched");

      expect(() =>
        assertClaudePluginMcpEntrypointSynced({ packageRoot: workspaceRoot }),
      ).not.toThrow();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("copies the runtime bundle into claude-plugin/dist", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const distRoot = join(workspaceRoot, "dist");
      const pluginRoot = join(workspaceRoot, "claude-plugin");
      const pluginDist = join(pluginRoot, "dist");

      mkdirSync(distRoot, { recursive: true });
      mkdirSync(pluginRoot, { recursive: true });
      mkdirSync(join(distRoot, "marketplace"), { recursive: true });
      mkdirSync(join(distRoot, "schemas"), { recursive: true });
      mkdirSync(join(distRoot, "mcp"), { recursive: true });

      writeFileSync(join(distRoot, "marketplace", "index.js"), "marketplace-bundle");
      writeFileSync(join(distRoot, "schemas", "tools.json"), "{}");
      writeFileSync(
        join(distRoot, "mcp", "swarm-mcp-server.cjs"),
        "mcp-bundle",
      );

      mkdirSync(pluginDist, { recursive: true });
      writeFileSync(join(pluginDist, "stale.txt"), "old");

      copyClaudePluginRuntimeAssets({ packageRoot: workspaceRoot });

      expect(existsSync(join(pluginRoot, "dist", "index.js"))).toBe(true);
      expect(readFileSync(join(pluginRoot, "dist", "index.js"), "utf-8")).toBe(
        "marketplace-bundle",
      );
      expect(existsSync(join(pluginRoot, "dist", "schemas", "tools.json"))).toBe(
        true,
      );
      expect(
        readFileSync(
          join(pluginRoot, "dist", "mcp", "swarm-mcp-server.cjs"),
          "utf-8",
        ),
      ).toBe("mcp-bundle");
      expect(existsSync(join(pluginRoot, "dist", "stale.txt"))).toBe(false);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
