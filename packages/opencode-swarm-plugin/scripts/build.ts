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
}

// Phase 1: Build library entries (can run in parallel)
const LIBRARY_ENTRIES: BuildEntry[] = [
  { input: "./src/index.ts", outdir: "./dist" },
  { input: "./src/plugin.ts", outfile: "./dist/plugin.js" },
  { input: "./src/eval-capture.ts", outfile: "./dist/eval-capture.js" },
  { input: "./src/compaction-prompt-scoring.ts", outfile: "./dist/compaction-prompt-scoring.js" },
  { input: "./src/hive.ts", outfile: "./dist/hive.js" },
  { input: "./src/swarm-prompts.ts", outfile: "./dist/swarm-prompts.js" },
];

// Phase 2: Build CLI (depends on dist/swarm-prompts.js, dist/hive.js, etc.)
const CLI_ENTRIES: BuildEntry[] = [
  { input: "./bin/swarm.ts", outfile: "./dist/bin/swarm.js" },
];

const EXTERNALS = ["@electric-sql/pglite", "swarm-mail", "evalite"];

async function buildEntry(entry: BuildEntry): Promise<void> {
  const externals = EXTERNALS.map(e => `--external ${e}`).join(" ");
  const output = entry.outdir 
    ? `--outdir ${entry.outdir}` 
    : `--outfile ${entry.outfile}`;
  
  const cmd = `bun build ${entry.input} ${output} --target node ${externals}`;
  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdout: "inherit",
    stderr: "inherit",
  });
  
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Build failed for ${entry.input}`);
  }
}

async function main() {
  console.log("🔨 Building opencode-swarm-plugin...\n");
  const start = Date.now();
  
  // Phase 1: Build library entries in parallel
  console.log("📦 Phase 1: Building library entries...");
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
  
  // Phase 2: Build CLI (depends on library outputs)
  console.log("\n🔧 Phase 2: Building CLI...");
  const cliResults = await Promise.allSettled(
    CLI_ENTRIES.map(entry => buildEntry(entry))
  );
  
  // Check for CLI failures
  const cliFailures = cliResults.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (cliFailures.length > 0) {
    console.error("\n❌ CLI build failed:");
    cliFailures.forEach(f => console.error(`  - ${f.reason}`));
    process.exit(1);
  }
  
  const totalEntries = LIBRARY_ENTRIES.length + CLI_ENTRIES.length;
  console.log(`\n✅ Built ${totalEntries} entries`);
  
  // Run tsc for declarations
  console.log("\n📝 Generating type declarations...");
  const tsc = Bun.spawn(["tsc"], { stdout: "inherit", stderr: "inherit" });
  const tscExit = await tsc.exited;
  if (tscExit !== 0) {
    console.error("❌ TypeScript compilation failed");
    process.exit(1);
  }
  
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n✨ Build complete in ${duration}s`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
