/**
 * MCP bundle expectations for the Claude plugin runtime.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveMcpBundlePaths } from "../build/mcp-bundle";
import {
  SWARM_MCP_SERVER_NAME,
  createClaudePluginCacheMcpConfig,
  resolveClaudePluginCacheBundleSpec,
} from "../cache/claude-plugin-cache";

describe("Claude MCP server bundle", () => {
  test("bundles the MCP entrypoint under claude-plugin/dist/mcp", () => {
    const packageRoot = "/var/tmp/swarm-plugin";
    const paths = resolveMcpBundlePaths({ packageRoot });

    expect(paths.entryPath).toBe(
      join(packageRoot, "claude-plugin", "bin", "swarm-mcp-server.ts"),
    );
    expect(paths.bundlePath).toBe(
      join(packageRoot, "claude-plugin", "dist", "mcp", "swarm-mcp-server.js"),
    );
  });

  test("cache bundle spec targets the built MCP server", () => {
    const cacheRoot = "/var/tmp/swarm-cache";
    const spec = resolveClaudePluginCacheBundleSpec({ cacheRoot });

    expect(spec.entryPath).toBe(
      join(cacheRoot, "dist", "mcp", "swarm-mcp-server.js"),
    );
    expect(spec.bundlePath).toBe(
      join(cacheRoot, "dist", "mcp", "swarm-mcp-server.js"),
    );
  });

  test("cache MCP config runs bundled server with node", () => {
    const config = createClaudePluginCacheMcpConfig();
    const server = config.mcpServers[SWARM_MCP_SERVER_NAME];

    expect(server.command).toBe("node");
    expect(server.args).toEqual([
      "${CLAUDE_PLUGIN_ROOT}/dist/mcp/swarm-mcp-server.js",
    ]);
    expect(server.args.join(" ")).not.toContain("bin/swarm-mcp-server.ts");
  });
});
