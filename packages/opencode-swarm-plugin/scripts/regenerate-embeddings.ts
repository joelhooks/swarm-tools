#!/usr/bin/env bun
/**
 * Regenerate embeddings for memories that don't have them.
 * Requires Ollama running with nomic-embed-text model.
 *
 * Usage:
 *   bun run scripts/regenerate-embeddings.ts [--limit <n>] [--batch <n>]
 */

import { parseArgs } from "node:util";
import { getSwarmMailLibSQL } from "swarm-mail";

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "0" }, // 0 = all
    batch: { type: "string", default: "50" },
  },
  strict: true,
  allowPositionals: false,
});

const LIMIT = parseInt(values.limit || "0", 10);
const BATCH_SIZE = parseInt(values.batch || "50", 10);

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch("http://localhost:11434/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mxbai-embed-large",
        prompt: text,
      }),
    });

    if (!response.ok) {
      console.error(`Ollama error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.error("Failed to connect to Ollama:", error);
    return null;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Embedding Regeneration");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Limit: ${LIMIT || "all"}`);
  console.log("");

  // Test Ollama connection
  console.log("Testing Ollama connection...");
  const testEmbed = await generateEmbedding("test");
  if (!testEmbed) {
    console.error("❌ Ollama not available. Make sure it's running with mxbai-embed-large model.");
    console.error("   Run: ollama pull mxbai-embed-large && ollama serve");
    process.exit(1);
  }
  console.log("✓ Ollama connected");
  console.log("");

  // Get database
  const swarmMail = await getSwarmMailLibSQL(process.cwd());
  const db = await swarmMail.getDatabase();

  // Count memories without embeddings
  const countResult = await db.query(
    "SELECT COUNT(*) as count FROM memories WHERE embedding IS NULL"
  );
  const totalWithout = (countResult.rows[0] as any)?.count || 0;
  console.log(`Memories without embeddings: ${totalWithout}`);

  if (totalWithout === 0) {
    console.log("✓ All memories have embeddings!");
    return;
  }

  const toProcess = LIMIT > 0 ? Math.min(LIMIT, totalWithout) : totalWithout;
  console.log(`Will process: ${toProcess}`);
  console.log("");

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  while (processed < toProcess) {
    // Get batch of memories without embeddings
    const batchResult = await db.query(
      `SELECT id, content FROM memories WHERE embedding IS NULL LIMIT ?`,
      [BATCH_SIZE]
    );

    if (batchResult.rows.length === 0) break;

    for (const row of batchResult.rows) {
      const { id, content } = row as { id: string; content: string };

      try {
        const embedding = await generateEmbedding(content);
        if (embedding) {
          // Convert to F32 blob format for libSQL vector
          const float32Array = new Float32Array(embedding);
          const buffer = Buffer.from(float32Array.buffer);

          await db.query(
            "UPDATE memories SET embedding = ? WHERE id = ?",
            [buffer, id]
          );
          processed++;
        } else {
          errors++;
        }
      } catch (error) {
        errors++;
        console.error(`Error processing ${id}:`, error);
      }

      // Progress update
      if (processed % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (toProcess - processed) / rate;
        console.log(
          `Progress: ${processed}/${toProcess} (${((processed / toProcess) * 100).toFixed(1)}%) ` +
          `| ${rate.toFixed(1)}/s | ETA: ${Math.round(remaining)}s`
        );
      }
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Complete");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Processed: ${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time: ${elapsed.toFixed(1)}s`);
  console.log(`Rate: ${(processed / elapsed).toFixed(1)} memories/second`);
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
