/**
 * Memory Operations Tests - TDD for Mem0 pattern
 *
 * Tests the LLM-driven memory operation decision system:
 * - ADD: New information, no existing memory covers this
 * - UPDATE: Existing memory needs refinement
 * - DELETE: Information contradicts existing memory
 * - NOOP: Information already captured
 *
 * NOTE: analyzeMemoryOperation tests require AI_GATEWAY_API_KEY
 * NOTE: executeMemoryOperation tests require Ollama running locally
 */

import { createClient, type Client } from "@libsql/client";
import { beforeEach, describe, expect, test } from "bun:test";
import type { SwarmDb } from "../db/client.js";
import { createDrizzleClient } from "../db/drizzle.js";
import {
  analyzeMemoryOperation,
  executeMemoryOperation,
  type MemoryOperation,
} from "./memory-operations.js";
import type { Memory } from "./store.js";

// ============================================================================
// Environment Detection
// ============================================================================

const HAS_API_KEY = Boolean(process.env.AI_GATEWAY_API_KEY);
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

// Check if Ollama is running (cached result)
let ollamaAvailable: boolean | null = null;
async function isOllamaAvailable(): Promise<boolean> {
  if (ollamaAvailable !== null) return ollamaAvailable;
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    ollamaAvailable = response.ok;
  } catch {
    ollamaAvailable = false;
  }
  return ollamaAvailable;
}

// ============================================================================
// Test Data
// ============================================================================

const sampleMemories: Memory[] = [
  {
    id: "mem-1",
    content: "OAuth tokens expire after 1 hour",
    metadata: { tags: ["auth", "oauth"] },
    collection: "default",
    createdAt: new Date("2025-01-01"),
    confidence: 0.8,
  },
  {
    id: "mem-2",
    content: "User preferences stored in localStorage",
    metadata: { tags: ["frontend", "storage"] },
    collection: "default",
    createdAt: new Date("2025-01-02"),
    confidence: 0.7,
  },
];

const testConfig = {
  model: "anthropic/claude-haiku-4-5",
  apiKey: process.env.AI_GATEWAY_API_KEY || "",
};

// ============================================================================
// analyzeMemoryOperation Tests (require LLM)
// ============================================================================

describe("analyzeMemoryOperation", () => {
  test.skipIf(!HAS_API_KEY)(
    "should decide ADD when no similar memories exist",
    async () => {
      const result = await analyzeMemoryOperation(
        "JWT tokens use RS256 signing algorithm for cryptographic verification",
        [], // No existing memories
        testConfig
      );

      expect(result.type).toBe("ADD");
      expect(result.reason).toBeTruthy();
    }
  );

  test.skipIf(!HAS_API_KEY)(
    "should decide UPDATE when similar memory exists but info is additive",
    async () => {
      const result = await analyzeMemoryOperation(
        "OAuth refresh tokens need 5-minute buffer before expiry to avoid race conditions",
        sampleMemories, // Has OAuth token memory
        testConfig
      );

      // LLM should recognize this adds to existing OAuth knowledge
      expect(["ADD", "UPDATE"]).toContain(result.type);
      expect(result.reason).toBeTruthy();
    }
  );

  test.skipIf(!HAS_API_KEY)(
    "should decide DELETE when info contradicts existing memory",
    async () => {
      const result = await analyzeMemoryOperation(
        "User preferences are now stored server-side in the database, localStorage is no longer used",
        sampleMemories, // Has localStorage memory
        testConfig
      );

      // LLM should recognize this contradicts localStorage claim
      expect(["DELETE", "UPDATE"]).toContain(result.type);
      expect(result.reason).toBeTruthy();
    }
  );

  test.skipIf(!HAS_API_KEY)(
    "should decide NOOP when info already captured",
    async () => {
      const result = await analyzeMemoryOperation(
        "OAuth tokens have an expiration time of one hour",
        sampleMemories, // Already has this info
        testConfig
      );

      // LLM should recognize this is redundant
      expect(["NOOP", "UPDATE"]).toContain(result.type);
      expect(result.reason).toBeTruthy();
    }
  );

  test.skipIf(!HAS_API_KEY)(
    "should handle empty existing memories",
    async () => {
      const result = await analyzeMemoryOperation(
        "First piece of information about the system",
        [],
        testConfig
      );

      expect(result.type).toBe("ADD");
      expect(result.reason).toBeTruthy();
    }
  );
});

// ============================================================================
// executeMemoryOperation Tests (require Ollama)
// ============================================================================

describe("executeMemoryOperation", () => {
  let db: SwarmDb;
  let client: Client;
  let hasOllama: boolean;

  beforeEach(async () => {
    hasOllama = await isOllamaAvailable();

    client = createClient({ url: ":memory:" });

    // Create memories table with vector column (libSQL schema)
    // IMPORTANT: Must match db/schema/memory.ts Drizzle schema exactly
    await client.execute(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        collection TEXT DEFAULT 'default',
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        decay_factor REAL DEFAULT 1.0,
        embedding F32_BLOB(1024),
        valid_from TEXT,
        valid_until TEXT,
        superseded_by TEXT,
        auto_tags TEXT,
        keywords TEXT,
        access_count TEXT DEFAULT '0',
        last_accessed TEXT DEFAULT (datetime('now')),
        category TEXT,
        status TEXT DEFAULT 'active'
      )
    `);

    // Create FTS5 virtual table for full-text search
    await client.execute(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content,
        content='memories',
        content_rowid='rowid'
      )
    `);

    // Create vector index
    await client.execute(`
      CREATE INDEX memories_vector_idx ON memories(libsql_vector_idx(embedding))
    `);

    db = createDrizzleClient(client);
  });

  test("should execute ADD operation", async () => {
    if (!hasOllama) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const operation: MemoryOperation = {
      type: "ADD",
      content: "New memory content",
      reason: "Test ADD",
    };

    const result = await executeMemoryOperation(operation, db, {
      ollamaHost: OLLAMA_HOST,
      ollamaModel: "mxbai-embed-large",
    });

    expect(result.operation.type).toBe("ADD");
    expect(result.affectedMemoryIds.length).toBe(1);
    expect(result.affectedMemoryIds[0]).toMatch(/^mem-/);
  });

  test("should execute UPDATE operation", async () => {
    if (!hasOllama) {
      console.log("Skipping: Ollama not available");
      return;
    }

    // First add a memory
    const { createMemoryAdapter } = await import("./adapter.js");
    const adapter = createMemoryAdapter(db, {
      ollamaHost: OLLAMA_HOST,
      ollamaModel: "mxbai-embed-large",
    });

    const { id } = await adapter.store("Original content", {
      collection: "default",
    });

    const operation: MemoryOperation = {
      type: "UPDATE",
      memoryId: id,
      newContent: "Updated content with more details",
      reason: "Test UPDATE",
    };

    const result = await executeMemoryOperation(operation, db, {
      ollamaHost: OLLAMA_HOST,
      ollamaModel: "mxbai-embed-large",
    });

    expect(result.operation.type).toBe("UPDATE");
    expect(result.affectedMemoryIds).toContain(id);

    // Verify update
    const updated = await adapter.get(id);
    expect(updated?.content).toBe("Updated content with more details");
  });

  test("should execute DELETE operation", async () => {
    if (!hasOllama) {
      console.log("Skipping: Ollama not available");
      return;
    }

    // First add a memory
    const { createMemoryAdapter } = await import("./adapter.js");
    const adapter = createMemoryAdapter(db, {
      ollamaHost: OLLAMA_HOST,
      ollamaModel: "mxbai-embed-large",
    });

    const { id } = await adapter.store("To be deleted", {
      collection: "default",
    });

    const operation: MemoryOperation = {
      type: "DELETE",
      memoryId: id,
      reason: "Test DELETE",
    };

    const result = await executeMemoryOperation(operation, db, {
      ollamaHost: OLLAMA_HOST,
      ollamaModel: "mxbai-embed-large",
    });

    expect(result.operation.type).toBe("DELETE");
    expect(result.affectedMemoryIds).toContain(id);

    // Verify deletion
    const deleted = await adapter.get(id);
    expect(deleted).toBeNull();
  });

  test("should execute NOOP operation", async () => {
    // NOOP doesn't need Ollama - no embeddings generated
    const operation: MemoryOperation = {
      type: "NOOP",
      reason: "Test NOOP",
    };

    const result = await executeMemoryOperation(operation, db, {
      ollamaHost: OLLAMA_HOST,
      ollamaModel: "mxbai-embed-large",
    });

    expect(result.operation.type).toBe("NOOP");
    expect(result.affectedMemoryIds).toEqual([]);
  });

  test("should handle UPDATE for non-existent memory", async () => {
    if (!hasOllama) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const operation: MemoryOperation = {
      type: "UPDATE",
      memoryId: "mem-nonexistent",
      newContent: "Updated content",
      reason: "Test UPDATE non-existent",
    };

    await expect(
      executeMemoryOperation(operation, db, {
        ollamaHost: OLLAMA_HOST,
        ollamaModel: "mxbai-embed-large",
      })
    ).rejects.toThrow("Memory not found");
  });

  test("should handle DELETE for non-existent memory", async () => {
    if (!hasOllama) {
      console.log("Skipping: Ollama not available");
      return;
    }

    const operation: MemoryOperation = {
      type: "DELETE",
      memoryId: "mem-nonexistent",
      reason: "Test DELETE non-existent",
    };

    await expect(
      executeMemoryOperation(operation, db, {
        ollamaHost: OLLAMA_HOST,
        ollamaModel: "mxbai-embed-large",
      })
    ).rejects.toThrow("Memory not found");
  });
});
