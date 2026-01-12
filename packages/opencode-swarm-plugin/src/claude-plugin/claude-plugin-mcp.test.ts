/**
 * Unit tests for Claude plugin MCP configuration.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { loadToolRegistry } from "../../claude-plugin/bin/swarm-mcp-server.ts";

type McpServerConfig = {
  command: string;
  args: string[];
  cwd?: string;
  description?: string;
};

type ClaudePluginManifest = {
  mcpServers?: Record<string, McpServerConfig>;
};

const PLUGIN_ROOT = resolve(__dirname, "..", "..", "claude-plugin");
const PLUGIN_MANIFEST_PATH = resolve(
  PLUGIN_ROOT,
  ".claude-plugin",
  "plugin.json",
);
const MCP_SERVER_PATH = resolve(PLUGIN_ROOT, "bin", "swarm-mcp-server.cjs");

/**
 * Reads the Claude plugin manifest JSON from disk.
 */
function readPluginManifest(): ClaudePluginManifest {
  return JSON.parse(
    readFileSync(PLUGIN_MANIFEST_PATH, "utf-8"),
  ) as ClaudePluginManifest;
}

/**
 * Reads the Claude plugin MCP server entrypoint source.
 */
function readMcpServerSource(): string {
  return readFileSync(MCP_SERVER_PATH, "utf-8");
}


describe("claude-plugin MCP config", () => {
  it("locates the plugin manifest in the plugin root", () => {
    expect(existsSync(PLUGIN_MANIFEST_PATH)).toBe(true);
  });

  it("registers the swarm-tools MCP server", () => {
    const manifest = readPluginManifest();

    expect(manifest).toHaveProperty("mcpServers");
    expect(manifest.mcpServers).toHaveProperty("swarm-tools");

    const server = manifest.mcpServers?.["swarm-tools"];
    expect(server?.command).toBe("node");
    expect(server?.args).toEqual([
      "${CLAUDE_PLUGIN_ROOT}/bin/swarm-mcp-server.cjs",
    ]);
    expect(server?.cwd).toBe("${CLAUDE_PLUGIN_ROOT}");
    expect(server?.description).toBeTruthy();
  });

  it("loads runtime tools from the bundled MCP entrypoint", () => {
    const source = readMcpServerSource();

    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("swarm-mcp");
  });

  it("loads the swarm tool registry from the MCP entrypoint", async () => {
    // Set the plugin root for the test environment
    const originalEnv = process.env.CLAUDE_PLUGIN_ROOT;
    process.env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;

    try {
      const tools = await loadToolRegistry();

      expect(Object.keys(tools).length).toBeGreaterThan(0);
      expect(tools).toHaveProperty("hive_ready");
    } finally {
      // Restore original env
      if (originalEnv === undefined) {
        delete process.env.CLAUDE_PLUGIN_ROOT;
      } else {
        process.env.CLAUDE_PLUGIN_ROOT = originalEnv;
      }
    }
  });
});
