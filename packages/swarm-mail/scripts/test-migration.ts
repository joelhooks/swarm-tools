#!/usr/bin/env bun
/**
 * Quick migration test script - run directly to see what's happening
 * 
 * Usage: bun run scripts/test-migration.ts
 */

import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratePGliteToLibSQL, pgliteExists } from "../src/migrate-pglite-to-libsql.js";

// Use the actual project temp directory
const projectPath = "/Users/joel/Code/joelhooks/opencode-swarm-plugin";
const crypto = await import("node:crypto");
const hash = crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 8);
const tempDirName = `opencode-${projectPath.split("/").pop()}-${hash}`;
const tempDir = join(tmpdir(), tempDirName);

const pglitePath = join(tempDir, "streams");
const libsqlPath = join(tempDir, "streams.db");

console.log("=== Migration Test ===");
console.log(`Temp dir: ${tempDir}`);
console.log(`PGlite path: ${pglitePath}`);
console.log(`LibSQL path: ${libsqlPath}`);
console.log(`PGlite exists: ${pgliteExists(pglitePath)}`);
console.log(`LibSQL exists: ${existsSync(libsqlPath)}`);
console.log();

if (!pgliteExists(pglitePath)) {
  console.log("No PGlite database found. Nothing to migrate.");
  process.exit(0);
}

// Delete existing libSQL to test fresh migration
if (existsSync(libsqlPath)) {
  console.log("Deleting existing libSQL database...");
  rmSync(libsqlPath, { force: true });
}

console.log("Starting migration...\n");

const result = await migratePGliteToLibSQL({
  pglitePath,
  libsqlPath,
  dryRun: false,
  onProgress: (msg) => console.log(msg),
});

console.log("\n=== Results ===");
console.log(`Memories: ${result.memories.migrated} migrated, ${result.memories.skipped} skipped, ${result.memories.failed} failed`);
console.log(`Beads: ${result.beads.migrated} migrated, ${result.beads.skipped} skipped, ${result.beads.failed} failed`);
console.log(`Messages: ${result.messages.migrated} migrated, ${result.messages.skipped} skipped, ${result.messages.failed} failed`);
console.log(`Agents: ${result.agents.migrated} migrated, ${result.agents.skipped} skipped, ${result.agents.failed} failed`);
console.log(`Events: ${result.events.migrated} migrated, ${result.events.skipped} skipped, ${result.events.failed} failed`);

if (result.errors.length > 0) {
  console.log(`\n=== Errors (${result.errors.length}) ===`);
  for (const err of result.errors) {
    console.log(`  - ${err}`);
  }
}
