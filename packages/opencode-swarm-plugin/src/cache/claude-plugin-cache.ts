/**
 * Claude plugin cache helpers for MCP runtime execution.
 */
import { join } from "path";
import { MCP_BUNDLE_RELATIVE_PATH } from "../build/mcp-bundle";

export type McpServerConfig = {
  command: string;
  args: string[];
  cwd?: string;
  description?: string;
};

export type McpConfig = {
  mcpServers: Record<string, McpServerConfig>;
};

export type ClaudePluginCachePaths = {
  cacheRoot: string;
  mcpServerPath: string;
  mcpConfigPath: string;
};

export const CLAUDE_PLUGIN_ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}";
export const SWARM_MCP_SERVER_NAME = "swarm-tools";

/**
 * Resolve where cached Claude plugin assets should live.
 */
export function resolveClaudePluginCachePaths({
  cacheRoot = join(process.cwd(), "claude-plugin"),
}: {
  cacheRoot?: string;
} = {}): ClaudePluginCachePaths {
  const mcpServerPath = join(cacheRoot, MCP_BUNDLE_RELATIVE_PATH);
  const mcpConfigPath = join(cacheRoot, ".mcp.json");

  return {
    cacheRoot,
    mcpServerPath,
    mcpConfigPath,
  };
}

/**
 * Create the MCP config for a cached Claude plugin bundle.
 */
export function createClaudePluginCacheMcpConfig({
  pluginRootToken = CLAUDE_PLUGIN_ROOT_TOKEN,
  command = "node",
  description = "Swarm multi-agent coordination tools",
}: {
  pluginRootToken?: string;
  command?: string;
  description?: string;
} = {}): McpConfig {
  const mcpServerPath = `${pluginRootToken}/${
    MCP_BUNDLE_RELATIVE_PATH.replace(/\\/g, "/")
  }`;
  const args = command === "bun" ? ["run", mcpServerPath] : [mcpServerPath];

  return {
    mcpServers: {
      [SWARM_MCP_SERVER_NAME]: {
        command,
        args,
        cwd: pluginRootToken,
        description,
      },
    },
  };
}

/**
 * Describe the cached Claude plugin entrypoints for bundling.
 */
export function resolveClaudePluginCacheBundleSpec({
  cacheRoot = join(process.cwd(), "claude-plugin"),
  pluginRoot = cacheRoot,
}: {
  cacheRoot?: string;
  pluginRoot?: string;
} = {}): { entryPath: string; bundlePath: string } {
  const bundlePath = join(cacheRoot, MCP_BUNDLE_RELATIVE_PATH);

  return {
    entryPath: join(pluginRoot, MCP_BUNDLE_RELATIVE_PATH),
    bundlePath,
  };
}

