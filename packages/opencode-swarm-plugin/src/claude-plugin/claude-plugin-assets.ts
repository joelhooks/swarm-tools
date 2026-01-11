/**
 * Claude plugin runtime asset copy configuration.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

export type ClaudePluginAssetCopyOptions = {
  packageRoot: string;
  distRoot?: string;
  pluginRoot?: string;
};

/**
 * Copy compiled runtime assets into the Claude plugin root.
 */
export function copyClaudePluginRuntimeAssets({
  packageRoot,
  distRoot = join(packageRoot, "dist"),
  pluginRoot = join(packageRoot, "claude-plugin"),
}: ClaudePluginAssetCopyOptions): void {
  if (!existsSync(distRoot)) {
    throw new Error(`Missing runtime dist directory: ${distRoot}`);
  }

  const runtimeEntry = join(distRoot, "index.js");
  if (!existsSync(runtimeEntry)) {
    throw new Error(`Missing runtime bundle: ${runtimeEntry}`);
  }

  const mcpBundle = join(distRoot, "mcp", "swarm-mcp-server.js");
  if (!existsSync(mcpBundle)) {
    throw new Error(`Missing MCP bundle: ${mcpBundle}`);
  }

  mkdirSync(pluginRoot, { recursive: true });

  const pluginDist = join(pluginRoot, "dist");
  rmSync(pluginDist, { recursive: true, force: true });
  mkdirSync(pluginDist, { recursive: true });
  cpSync(distRoot, pluginDist, { recursive: true });
}
