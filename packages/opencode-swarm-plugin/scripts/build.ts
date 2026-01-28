#!/usr/bin/env bun
/**
 * Build script for opencode-swarm-plugin
 * 
 * Config-driven parallel builds with shared externals.
 * Turborepo-friendly: exits 0 on success, non-zero on failure.
 */

interface BuildEntry {
  input: string;
  outdir?: string;  // Use outdir for index.ts
  outfile?: string; // Use outfile for single-file outputs
  format?: "cjs" | "esm";
}

// Phase 1: Build library entries (can run in parallel)
const LIBRARY_ENTRIES: BuildEntry[] = [
  { input: "./src/index.ts", outdir: "./dist" },
  { input: "./src/plugin.ts", outfile: "./dist/plugin.js" },
  { input: "./src/eval-capture.ts", outfile: "./dist/eval-capture.js" },
  { input: "./src/compaction-prompt-scoring.ts", outfile: "./dist/compaction-prompt-scoring.js" },
  { input: "./src/hive.ts", outfile: "./dist/hive.js" },
  { input: "./src/swarm-prompts.ts", outfile: "./dist/swarm-prompts.js" },
  {
    input: "./claude-plugin/bin/swarm-mcp-server.ts",
    outfile: "./dist/mcp/swarm-mcp-server.cjs",
    format: "cjs",
  },
];

// Phase 1.5: Marketplace-specific bundle (bundles swarm-mail since no node_modules)
interface MarketplaceBuildEntry extends BuildEntry {
  bundleSwarmMail: true;
}
const MARKETPLACE_ENTRIES: MarketplaceBuildEntry[] = [
  { input: "./src/index.ts", outfile: "./dist/marketplace/index.js", bundleSwarmMail: true },
];

// Phase 2: Build CLI (depends on dist/swarm-prompts.js, dist/hive.js, etc.)
const CLI_ENTRIES: BuildEntry[] = [
  { input: "./bin/swarm.ts", outfile: "./dist/bin/swarm.js" },
];

// Externals: modules that must be resolved at runtime, not bundled
// NOTE: swarm-mail is bundled into CLI to avoid version mismatch issues with global install
const EXTERNALS = [
  "@electric-sql/pglite",
  "swarm-mail",
  "evalite",  // dev-only, shouldn't be in production bundle
  "@clack/prompts",  // unicode detection must happen at runtime, not bundle time
  "@clack/core",
  "picocolors",
  "sisteransi",
];

// CLI externals - swarm-mail is BUNDLED to avoid global install version issues
const CLI_EXTERNALS = [
  "@electric-sql/pglite",
  "evalite",
  "@clack/prompts",
  "@clack/core",
  "picocolors",
  "sisteransi",
  "@libsql/client",  // Native module, must be external
];

// Marketplace externals - swarm-mail is BUNDLED since marketplace has no node_modules
const MARKETPLACE_EXTERNALS = [
  "@electric-sql/pglite",
  "evalite",
  "@clack/prompts",
  "@clack/core",
  "picocolors",
  "sisteransi",
  "@libsql/client",
];

type ExternalsType = "library" | "cli" | "marketplace";

async function buildEntry(entry: BuildEntry, externalsType: ExternalsType = "library"): Promise<void> {
  const externalsList = externalsType === "cli"
    ? CLI_EXTERNALS
    : externalsType === "marketplace"
      ? MARKETPLACE_EXTERNALS
      : EXTERNALS;
  
  // Build args array for cross-platform compatibility (no shell needed)
  const args = [
    "build",
    entry.input,
    entry.outdir ? "--outdir" : "--outfile",
    entry.outdir || entry.outfile || "",
    "--target",
    "node",
  ];
  
  if (entry.format) {
    args.push("--format", entry.format);
  }
  
  // Add externals as separate args
  for (const ext of externalsList) {
    args.push("--external", ext);
  }

  const proc = Bun.spawn(["bun", ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Build failed for ${entry.input}`);
  }
}

import { cpSync, mkdirSync } from "fs";
import { join } from "path";
import {
  assertClaudePluginMcpEntrypointSynced,
  copyClaudePluginRuntimeAssets,
} from "../src/claude-plugin/claude-plugin-assets";

/**
 * Sync compiled runtime assets into the Claude plugin dist folder.
 */
function syncClaudePluginRuntimeAssets(packageRoot: string): void {
  console.log("\n🧰 Syncing Claude plugin runtime bundle...");
  copyClaudePluginRuntimeAssets({ packageRoot });
  const mcpBundleSource = join(packageRoot, "dist", "mcp", "swarm-mcp-server.cjs");
  const mcpBundleTargetDir = join(packageRoot, "claude-plugin", "bin");
  mkdirSync(mcpBundleTargetDir, { recursive: true });
  cpSync(mcpBundleSource, join(mcpBundleTargetDir, "swarm-mcp-server.cjs"));
  console.log("   Copied dist to claude-plugin/dist");
  console.log("   Copied MCP bundle to claude-plugin/bin");
}

async function main() {
  console.log("🔨 Building opencode-swarm-plugin...\n");
  const start = Date.now();
  
  // Phase 0: Copy examples to dist (for CLI to find templates)
  console.log("📋 Copying examples to dist...");
  mkdirSync("./dist/examples", { recursive: true });
  cpSync("./examples/plugin-wrapper-template.ts", "./dist/examples/plugin-wrapper-template.ts");
  console.log("   Copied plugin-wrapper-template.ts");
  
  // Phase 1: Build library entries in parallel
  console.log("\n📦 Phase 1: Building library entries...");
  const libraryResults = await Promise.allSettled(
    LIBRARY_ENTRIES.map(entry => buildEntry(entry))
  );
  
  // Check for library failures
  const libraryFailures = libraryResults.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (libraryFailures.length > 0) {
    console.error("\n❌ Library build failed:");
    libraryFailures.forEach(f => console.error(`  - ${f.reason}`));
    process.exit(1);
  }
  
  // Phase 1.5: Build marketplace-specific bundle (bundles swarm-mail)
  console.log("\n📦 Phase 1.5: Building marketplace bundle (bundling swarm-mail)...");
  mkdirSync("./dist/marketplace", { recursive: true });
  const marketplaceResults = await Promise.allSettled(
    MARKETPLACE_ENTRIES.map(entry => buildEntry(entry, "marketplace"))
  );

  const marketplaceFailures = marketplaceResults.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (marketplaceFailures.length > 0) {
    console.error("\n❌ Marketplace build failed:");
    marketplaceFailures.forEach(f => console.error(`  - ${f.reason}`));
    process.exit(1);
  }

  // Phase 2: Build CLI (depends on library outputs)
  // CLI uses CLI_EXTERNALS which bundles swarm-mail to avoid version mismatch
  console.log("\n🔧 Phase 2: Building CLI (bundling swarm-mail)...");
  const cliResults = await Promise.allSettled(
    CLI_ENTRIES.map(entry => buildEntry(entry, "cli"))
  );

  // Check for CLI failures
  const cliFailures = cliResults.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (cliFailures.length > 0) {
    console.error("\n❌ CLI build failed:");
    cliFailures.forEach(f => console.error(`  - ${f.reason}`));
    process.exit(1);
  }

  const totalEntries = LIBRARY_ENTRIES.length + MARKETPLACE_ENTRIES.length + CLI_ENTRIES.length;
  console.log(`\n✅ Built ${totalEntries} entries`);
  
  // Run tsc for declarations
  console.log("\n📝 Generating type declarations...");
  const tsc = Bun.spawn(["bunx", "tsc"], { stdout: "inherit", stderr: "inherit" });
  const tscExit = await tsc.exited;
  if (tscExit !== 0) {
    console.error("❌ TypeScript compilation failed");
    process.exit(1);
  }

  syncClaudePluginRuntimeAssets(process.cwd());

  const duration = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\n✨ Build complete in ${duration}s`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
