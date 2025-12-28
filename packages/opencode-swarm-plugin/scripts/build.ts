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

const BUILD_ENTRIES: BuildEntry[] = [
  { input: "./src/index.ts", outdir: "./dist" },
  { input: "./src/plugin.ts", outfile: "./dist/plugin.js" },
  { input: "./src/eval-capture.ts", outfile: "./dist/eval-capture.js" },
  { input: "./src/compaction-prompt-scoring.ts", outfile: "./dist/compaction-prompt-scoring.js" },
  { input: "./src/hive.ts", outfile: "./dist/hive.js" },
  { input: "./src/swarm-prompts.ts", outfile: "./dist/swarm-prompts.js" },
  // CLI - compiled so npm installs work (no ../src/ imports at runtime)
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
  
  // Build all entries in parallel
  const results = await Promise.allSettled(
    BUILD_ENTRIES.map(entry => buildEntry(entry))
  );
  
  // Check for failures
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    console.error("\n❌ Build failed:");
    failures.forEach(f => console.error(`  - ${f.reason}`));
    process.exit(1);
  }
  
  console.log(`\n✅ Built ${BUILD_ENTRIES.length} entries`);
  
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
