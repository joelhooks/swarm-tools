/**
 * Unit tests for Claude plugin cache helpers.
 */
import { describe, expect, it } from "vitest";
import { join } from "path";
import {
  CLAUDE_PLUGIN_ROOT_TOKEN,
  SWARM_MCP_SERVER_NAME,
  createClaudePluginCacheMcpConfig,
  resolveClaudePluginCachePaths,
} from "./claude-plugin-cache";

describe("resolveClaudePluginCachePaths", () => {
  it("builds cache paths from the cache root", () => {
    const cacheRoot = "/var/tmp/swarm-cache";
    const paths = resolveClaudePluginCachePaths({ cacheRoot });

    expect(paths.cacheRoot).toBe(cacheRoot);
    expect(paths.mcpServerPath).toBe(
      join(cacheRoot, "dist", "mcp", "swarm-mcp-server.js"),
    );
    expect(paths.mcpConfigPath).toBe(join(cacheRoot, ".mcp.json"));
  });
});

describe("createClaudePluginCacheMcpConfig", () => {
  it("targets the bundled MCP server path", () => {
    const config = createClaudePluginCacheMcpConfig();
    const server = config.mcpServers[SWARM_MCP_SERVER_NAME];

    expect(server.command).toBe("node");
    expect(server.args).toEqual([
      "${CLAUDE_PLUGIN_ROOT}/dist/mcp/swarm-mcp-server.js",
    ]);
    expect(server.cwd).toBe(CLAUDE_PLUGIN_ROOT_TOKEN);
  });
});
