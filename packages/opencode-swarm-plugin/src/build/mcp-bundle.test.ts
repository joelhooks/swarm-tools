/**
 * Unit tests for MCP bundle helpers.
 */
import { describe, expect, it } from "vitest";
import { join } from "path";
import { resolveMcpBundlePaths } from "./mcp-bundle";

describe("resolveMcpBundlePaths", () => {
  it("builds bundle paths under claude-plugin", () => {
    const packageRoot = "/var/tmp/swarm-plugin";
    const paths = resolveMcpBundlePaths({ packageRoot });

    expect(paths.pluginRoot).toBe(join(packageRoot, "claude-plugin"));
    expect(paths.entryPath).toBe(
      join(paths.pluginRoot, "bin", "swarm-mcp-server.ts"),
    );
    expect(paths.bundlePath).toBe(
      join(paths.pluginRoot, "dist", "mcp", "swarm-mcp-server.js"),
    );
    expect(paths.bundleDir).toBe(join(paths.pluginRoot, "dist", "mcp"));
  });
});
