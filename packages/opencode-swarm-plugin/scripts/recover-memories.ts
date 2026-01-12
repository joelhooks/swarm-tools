#!/usr/bin/env bun
/**
 * Recover memories from .hive/memories.jsonl to libSQL
 *
 * Usage:
 *   bun run scripts/recover-memories.ts [--dry-run] [--file <path>]
 *
 * This script:
 * 1. Reads memories from .hive/memories.jsonl
 * 2. Inserts them into the global swarm.db (without embeddings)
 * 3. Embeddings can be regenerated later with `swarm hivemind refresh`
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getSwarmMailLibSQL } from "swarm-mail";

interface JSONLMemory {
  id: string;
  information: string;
  tags?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

const { values, positionals } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    file: { type: "string" },
  },
  strict: true,
  allowPositionals: true,
});

const DRY_RUN = values["dry-run"] ?? false;
const MEMORIES_FILE = values.file ?? join(process.cwd(), ".hive", "memories.jsonl");

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Memory Recovery");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Source: ${MEMORIES_FILE}`);
  console.log("");

  // Read JSONL file
  const content = readFileSync(MEMORIES_FILE, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  console.log(`Found ${lines.length} memories in JSONL`);

  // Parse memories
  const memories: JSONLMemory[] = [];
  let parseErrors = 0;

  for (const line of lines) {
    try {
      const memory = JSON.parse(line) as JSONLMemory;
      if (memory.id && memory.information) {
        memories.push(memory);
      } else {
        parseErrors++;
      }
    } catch {
      parseErrors++;
    }
  }

  console.log(`Parsed ${memories.length} valid memories (${parseErrors} errors)`);
  console.log("");

  if (DRY_RUN) {
    console.log("DRY RUN: Would import these memories:");
    console.log(`  ${memories.length} memories`);
    console.log("");

    // Show sample
    console.log("Sample memories:");
    for (const m of memories.slice(0, 3)) {
      console.log(`  - ${m.id}: ${m.information.slice(0, 80)}...`);
    }
    return;
  }

  // Get database
  console.log("Connecting to libSQL...");
  const swarmMail = await getSwarmMailLibSQL(process.cwd());
  const db = await swarmMail.getDatabase();
  console.log("✓ Connected");
  console.log("");

  // Check for existing memories
  const existingResult = await db.query("SELECT id FROM memories LIMIT 1");
  const existingCount = await db.query("SELECT COUNT(*) as count FROM memories");
  console.log(`Existing memories in database: ${(existingCount.rows[0] as any)?.count || 0}`);

  // Insert memories
  console.log("Inserting memories...");
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const memory of memories) {
    try {
      // Check if already exists
      const exists = await db.query(
        "SELECT id FROM memories WHERE id = ?",
        [memory.id]
      );

      if (exists.rows.length > 0) {
        skipped++;
        continue;
      }

      // Parse tags - handle both string and array formats
      let tagsArray: string[] = [];
      if (memory.tags) {
        if (typeof memory.tags === "string") {
          tagsArray = memory.tags.split(",").map(t => t.trim()).filter(Boolean);
        } else if (Array.isArray(memory.tags)) {
          tagsArray = memory.tags;
        }
      }

      await db.query(
        `INSERT INTO memories (id, content, tags, metadata, created_at, collection)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          memory.id,
          memory.information,
          JSON.stringify(tagsArray),
          JSON.stringify(memory.metadata || {}),
          memory.created_at || new Date().toISOString(),
          "recovered", // Mark as recovered for easy identification
        ]
      );

      inserted++;

      if (inserted % 100 === 0) {
        console.log(`  Inserted ${inserted} memories...`);
      }
    } catch (error) {
      errors++;
      if (errors < 5) {
        console.error(`  Error inserting ${memory.id}:`, error);
      }
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Recovery Complete");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Total memories: ${memories.length}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped (already exist): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log("");
  console.log("Note: Memories were imported without embeddings.");
  console.log("Run 'swarm hivemind refresh' to generate embeddings with Ollama.");
}

main().catch((error) => {
  console.error("Recovery failed:");
  console.error(error);
  process.exit(1);
});
