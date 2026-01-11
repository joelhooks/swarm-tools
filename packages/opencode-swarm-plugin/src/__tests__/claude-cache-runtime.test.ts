/**
 * Claude plugin cache runtime expectations (no runtime deps).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  SWARM_MCP_SERVER_NAME,
  createClaudePluginCacheMcpConfig,
  resolveClaudePluginCacheBundleSpec,
} from "../cache/claude-plugin-cache";

describe("Claude plugin cache runtime", () => {
  test("bundle spec targets the built MCP server", () => {
    const cacheRoot = "/var/tmp/swarm-cache";
    const spec = resolveClaudePluginCacheBundleSpec({ cacheRoot });

    expect(spec.entryPath).toBe(
      join(cacheRoot, "dist", "mcp", "swarm-mcp-server.js"),
    );
    expect(spec.bundlePath).toBe(
      join(cacheRoot, "dist", "mcp", "swarm-mcp-server.js"),
    );
  });

  test("cache config avoids runtime bun dependencies", () => {
    const config = createClaudePluginCacheMcpConfig();
    const server = config.mcpServers[SWARM_MCP_SERVER_NAME];

    expect(server.command).toBe("node");
    expect(server.args).toEqual([
      "${CLAUDE_PLUGIN_ROOT}/dist/mcp/swarm-mcp-server.js",
    ]);
    expect(server.args.join(" ")).not.toContain("bun");
  });
});
