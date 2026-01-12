/**
 * Claude plugin runtime asset copy configuration.
 */
import { createHash } from "crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

export type ClaudePluginAssetCopyOptions = {
  packageRoot: string;
  distRoot?: string;
  pluginRoot?: string;
};

const MCP_BUNDLE_RELATIVE_PATH = join("mcp", "swarm-mcp-server.cjs");

/**
 * Create a stable SHA-256 hash for a file on disk.
 */
function hashFile(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Ensure the committed MCP entrypoint matches the latest build output.
 */
export function assertClaudePluginMcpEntrypointSynced({
  packageRoot,
  distRoot = join(packageRoot, "dist"),
  pluginRoot = join(packageRoot, "claude-plugin"),
}: ClaudePluginAssetCopyOptions): void {
  const sourceBundle = join(distRoot, MCP_BUNDLE_RELATIVE_PATH);
  const targetBundle = join(pluginRoot, "dist", MCP_BUNDLE_RELATIVE_PATH);

  if (!existsSync(sourceBundle)) {
    throw new Error(`Missing MCP bundle: ${sourceBundle}`);
  }

  if (!existsSync(targetBundle)) {
    throw new Error(`Missing claude-plugin MCP entrypoint: ${targetBundle}`);
  }

  if (hashFile(sourceBundle) !== hashFile(targetBundle)) {
    throw new Error(
      `Claude plugin MCP entrypoint is out of sync: ${targetBundle}`,
    );
  }
}

/**
 * Copy compiled runtime assets into the Claude plugin root.
 *
 * For the marketplace plugin, we use dist/marketplace/index.js which bundles
 * swarm-mail since the marketplace has no node_modules.
 */
export function copyClaudePluginRuntimeAssets({
  packageRoot,
  distRoot = join(packageRoot, "dist"),
  pluginRoot = join(packageRoot, "claude-plugin"),
}: ClaudePluginAssetCopyOptions): void {
  if (!existsSync(distRoot)) {
    throw new Error(`Missing runtime dist directory: ${distRoot}`);
  }

  // Use marketplace bundle which has swarm-mail bundled
  const marketplaceBundle = join(distRoot, "marketplace", "index.js");
  if (!existsSync(marketplaceBundle)) {
    throw new Error(`Missing marketplace bundle: ${marketplaceBundle}`);
  }

  const mcpBundle = join(distRoot, MCP_BUNDLE_RELATIVE_PATH);
  if (!existsSync(mcpBundle)) {
    throw new Error(`Missing MCP bundle: ${mcpBundle}`);
  }

  mkdirSync(pluginRoot, { recursive: true });

  const pluginDist = join(pluginRoot, "dist");
  rmSync(pluginDist, { recursive: true, force: true });
  mkdirSync(pluginDist, { recursive: true });

  // Copy marketplace bundle as the main index.js
  cpSync(marketplaceBundle, join(pluginDist, "index.js"));

  // Copy other needed assets from dist (excluding the regular index.js)
  const assetsToCopy = ["mcp", "schemas", "utils"];
  for (const asset of assetsToCopy) {
    const src = join(distRoot, asset);
    if (existsSync(src)) {
      cpSync(src, join(pluginDist, asset), { recursive: true });
    }
  }
}
