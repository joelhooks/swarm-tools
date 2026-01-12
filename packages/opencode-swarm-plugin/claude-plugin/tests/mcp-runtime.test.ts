/**
 * Unit tests for Claude MCP runtime packaging.
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
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import {
  copyClaudePluginRuntimeAssets,
  resolveClaudePluginPackageRoot,
  assertClaudePluginDistExists,
} from "../scripts/copyClaudePluginRuntimeAssets";
import { resolveToolRegistryPath } from "../bin/swarm-mcp-server";

type PackageManifest = {
  files?: string[];
};

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(TEST_DIR, "../..");
const MANIFEST_PATH = join(PACKAGE_ROOT, "package.json");
const MCP_ENTRYPOINT_PATH = join(
  PACKAGE_ROOT,
  "claude-plugin",
  "bin",
  "swarm-mcp-server.cjs",
);

/**
 * Reads the package manifest used for marketplace packaging.
 */
function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as PackageManifest;
}

/**
 * Reads the bundled MCP entrypoint shipped in the plugin bin.
 */
function readBundledMcpEntrypoint(): string {
  return readFileSync(MCP_ENTRYPOINT_PATH, "utf-8");
}

describe("claude-plugin MCP runtime assets", () => {
  it("publishes the claude-plugin runtime dist", () => {
    const manifest = readPackageManifest();

    expect(manifest.files).toContain("claude-plugin");
    expect(manifest.files).toContain("claude-plugin/dist");
  });

  it("ships a bundled MCP entrypoint with no runtime deps", () => {
    expect(existsSync(MCP_ENTRYPOINT_PATH)).toBe(true);

    const source = readBundledMcpEntrypoint();

    expect(source).not.toContain("from \"swarm-mail\"");
    expect(source).toContain("swarm-mcp");
  });

  it("resolves the package root from built claude-plugin scripts", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const pluginRoot = join(workspaceRoot, "claude-plugin");
      const builtScripts = join(workspaceRoot, "dist", "claude-plugin", "scripts");

      mkdirSync(pluginRoot, { recursive: true });
      mkdirSync(builtScripts, { recursive: true });
      writeFileSync(join(workspaceRoot, "package.json"), "{}\n");

      expect(
        resolveClaudePluginPackageRoot({
          currentDir: builtScripts,
          cwd: builtScripts,
        }),
      ).toBe(workspaceRoot);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("prefers claude-plugin/dist for the MCP runtime bundle", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const pluginRoot = join(workspaceRoot, "claude-plugin");
      const pluginBin = join(pluginRoot, "bin");
      const pluginDist = join(pluginRoot, "dist");

      mkdirSync(pluginBin, { recursive: true });
      mkdirSync(pluginDist, { recursive: true });
      writeFileSync(join(workspaceRoot, "package.json"), "{}\n");
      writeFileSync(join(pluginDist, "index.js"), "bundle");

      expect(
        resolveToolRegistryPath({
          currentDir: pluginBin,
        }),
      ).toBe(join(pluginDist, "index.js"));
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("throws when claude-plugin/dist is missing", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const pluginBin = join(workspaceRoot, "claude-plugin", "bin");
      const rootDist = join(workspaceRoot, "dist");

      mkdirSync(pluginBin, { recursive: true });
      mkdirSync(rootDist, { recursive: true });
      writeFileSync(join(workspaceRoot, "package.json"), "{}\n");
      writeFileSync(join(rootDist, "index.js"), "bundle");

      expect(() =>
        resolveToolRegistryPath({
          currentDir: pluginBin,
        }),
      ).toThrowError(/claude-plugin[\\/]+dist/);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("throws when claude-plugin/dist is missing for runtime copy", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      writeFileSync(join(workspaceRoot, "package.json"), "{}\n");
      mkdirSync(join(workspaceRoot, "claude-plugin"), { recursive: true });

      expect(() =>
        assertClaudePluginDistExists({ packageRoot: workspaceRoot }),
      ).toThrowError(/claude-plugin[\\/]+dist/);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("throws when the runtime dist directory is missing", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      expect(() =>
        copyClaudePluginRuntimeAssets({ packageRoot: workspaceRoot }),
      ).toThrowError(/Missing runtime dist directory/);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("throws when the runtime bundle is missing", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const distRoot = join(workspaceRoot, "dist");
      mkdirSync(distRoot, { recursive: true });

      expect(() =>
        copyClaudePluginRuntimeAssets({ packageRoot: workspaceRoot }),
      ).toThrowError(/Missing runtime bundle/);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("copies runtime assets into claude-plugin/dist", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "swarm-plugin-"));

    try {
      const distRoot = join(workspaceRoot, "dist");
      const pluginRoot = join(workspaceRoot, "claude-plugin");
      const pluginDist = join(pluginRoot, "dist");

      mkdirSync(distRoot, { recursive: true });
      mkdirSync(pluginRoot, { recursive: true });
      mkdirSync(join(distRoot, "schemas"), { recursive: true });
      mkdirSync(join(distRoot, "mcp"), { recursive: true });

      writeFileSync(join(distRoot, "index.js"), "runtime-bundle");
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
        "runtime-bundle",
      );
      expect(existsSync(join(pluginRoot, "dist", "schemas", "tools.json"))).toBe(
        true,
      );
      expect(existsSync(join(pluginRoot, "dist", "stale.txt"))).toBe(false);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
