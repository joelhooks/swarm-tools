#!/usr/bin/env bun
/**
 * Sync package version to plugin manifests
 *
 * Reads version from package.json and updates both:
 * - Root marketplace.json
 * - Claude plugin plugin.json
 *
 * Triggered by changesets via the "version" script.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface PackageJson {
  version: string;
  [key: string]: unknown;
}

interface MarketplaceJson {
  name: string;
  owner: { name: string };
  metadata: { description: string };
  plugins: Array<{
    name: string;
    source: string;
    description: string;
    version: string;
    author: { name: string };
  }>;
}

interface PluginJson {
  name: string;
  description: string;
  version: string;
  author: { name: string };
  repository: string;
  keywords: string[];
  mcpServers: Record<string, unknown>;
  license: string;
}

/**
 * Read and parse a JSON file
 */
function readJson<T>(path: string): T {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as T;
}

/**
 * Write JSON with proper formatting
 */
function writeJson(path: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2) + "\n";
  writeFileSync(path, content, "utf-8");
}

function main() {
  console.log("🔄 Syncing plugin versions...\n");

  // Read package.json version
  const packageJsonPath = join(process.cwd(), "package.json");
  const packageJson = readJson<PackageJson>(packageJsonPath);
  const version = packageJson.version;

  console.log(`   Package version: ${version}`);

  // Update root marketplace.json
  const marketplacePath = join(process.cwd(), "../../.claude-plugin/marketplace.json");
  const marketplace = readJson<MarketplaceJson>(marketplacePath);

  const swarmPlugin = marketplace.plugins.find(p => p.name === "swarm");
  if (!swarmPlugin) {
    console.error("❌ Could not find 'swarm' plugin in marketplace.json");
    process.exit(1);
  }

  const oldMarketplaceVersion = swarmPlugin.version;
  swarmPlugin.version = version;
  writeJson(marketplacePath, marketplace);
  console.log(`   Updated marketplace.json: ${oldMarketplaceVersion} → ${version}`);

  // Update claude-plugin plugin.json
  const pluginJsonPath = join(process.cwd(), "claude-plugin/.claude-plugin/plugin.json");
  const pluginJson = readJson<PluginJson>(pluginJsonPath);

  const oldPluginVersion = pluginJson.version;
  pluginJson.version = version;
  writeJson(pluginJsonPath, pluginJson);
  console.log(`   Updated plugin.json: ${oldPluginVersion} → ${version}`);

  console.log("\n✅ Version sync complete");
}

main();
