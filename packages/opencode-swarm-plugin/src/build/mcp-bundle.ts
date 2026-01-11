/**
 * MCP bundle helpers for Claude plugin caching.
 */
import { dirname, join } from "path";

export const MCP_ENTRY_RELATIVE_PATH = join("bin", "swarm-mcp-server.ts");
export const MCP_BUNDLE_RELATIVE_PATH = join(
  "dist",
  "mcp",
  "swarm-mcp-server.js",
);

export type McpBundlePaths = {
  pluginRoot: string;
  entryPath: string;
  bundlePath: string;
  bundleDir: string;
};

/**
 * Resolve the entry + output paths for the bundled MCP server.
 */
export function resolveMcpBundlePaths({
  packageRoot = process.cwd(),
  pluginRoot = join(packageRoot, "claude-plugin"),
}: {
  packageRoot?: string;
  pluginRoot?: string;
} = {}): McpBundlePaths {
  const entryPath = join(pluginRoot, MCP_ENTRY_RELATIVE_PATH);
  const bundlePath = join(pluginRoot, MCP_BUNDLE_RELATIVE_PATH);

  return {
    pluginRoot,
    entryPath,
    bundlePath,
    bundleDir: dirname(bundlePath),
  };
}

