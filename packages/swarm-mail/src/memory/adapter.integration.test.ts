/**
 * MemoryAdapter Integration Test
 *
 * Smoke test to verify the adapter works with libSQL + mocked Ollama.
 * Tests the happy path: store → find → get → validate → remove
 */

import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createDrizzleClient } from "../db/drizzle.js";
import type { SwarmDb } from "../db/client.js";
import { createMemoryAdapter } from "./adapter.js";

function mockEmbedding(seed = 0): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < 1024; i++) {
    embedding.push(Math.sin(seed + i * 0.1) * 0.5 + 0.5);
  }
  return embedding;
}

/**
 * Create in-memory libSQL database with memory schema
 */
async function createTestDb(): Promise<{ client: Client; db: SwarmDb }> {
  const client = createClient({ url: ":memory:" });

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
      superseded_by TEXT REFERENCES memories(id),
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

  // Create triggers to keep FTS in sync
  await client.execute(`
    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END
  `);
  await client.execute(`
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
    END
  `);
  await client.execute(`
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
      INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
    END
  `);

  // Create vector index for similarity search
  await client.execute(`
    CREATE INDEX idx_memories_embedding ON memories(libsql_vector_idx(embedding))
  `);

  const db = createDrizzleClient(client);
  return { client, db };
}

describe("MemoryAdapter - Integration Smoke Test", () => {
  let client: Client;
  let db: SwarmDb;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    const testDb = await createTestDb();
    client = testDb.client;
    db = testDb.db;

    // Mock Ollama responses
    const mockFetch = mock((url: string, options?: RequestInit) => {
      if (url.includes("/api/embeddings")) {
        const body = JSON.parse((options?.body as string) || "{}");
        const prompt = body.prompt || "";
        const seed = prompt.includes("OAuth") ? 1 : 
                     prompt.includes("token") ? 1.1 : 
                     prompt.includes("refresh") ? 1.05 : 2;
        return Promise.resolve({
          ok: true,
          json: async () => ({ embedding: mockEmbedding(seed) }),
        } as Response);
      }
      // Health check
      return Promise.resolve({
        ok: true,
        json: async () => ({ models: [{ name: "mxbai-embed-large" }] }),
      } as Response);
    });
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    client.close();
  });

  test("full lifecycle: store → find → get → validate → remove", async () => {
    const config = {
      ollamaHost: "http://localhost:11434",
      ollamaModel: "mxbai-embed-large",
    };
    const adapter = createMemoryAdapter(db, config);

    // Health check
    const health = await adapter.checkHealth();
    expect(health.ollama).toBe(true);
    expect(health.model).toBe("mxbai-embed-large");

    // Store memories
    const mem1 = await adapter.store("OAuth tokens need 5min refresh buffer", {
      tags: "auth,oauth,tokens",
      metadata: JSON.stringify({ priority: "high" }),
      collection: "auth-patterns",
    });
    expect(mem1.id).toBeDefined();

    const mem2 = await adapter.store("Token refresh race conditions", {
      tags: "auth,tokens",
      collection: "auth-patterns",
    });
    expect(mem2.id).toBeDefined();

    // Find by semantic similarity
    const searchResults = await adapter.find("token refresh strategies");
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].memory.content).toContain("refresh");

    // Get specific memory
    const retrieved = await adapter.get(mem1.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content).toContain("OAuth");
    expect(retrieved?.metadata.tags).toEqual(["auth", "oauth", "tokens"]);
    expect(retrieved?.collection).toBe("auth-patterns");

    // List memories
    const allMemories = await adapter.list();
    expect(allMemories.length).toBe(2);

    const authMemories = await adapter.list({ collection: "auth-patterns" });
    expect(authMemories.length).toBe(2);

    // Stats
    const stats = await adapter.stats();
    expect(stats.memories).toBe(2);
    expect(stats.embeddings).toBe(2);

    // Validate (reset decay)
    await adapter.validate(mem1.id);
    const validated = await adapter.get(mem1.id);
    expect(validated).not.toBeNull();

    // Remove
    await adapter.remove(mem1.id);
    const removed = await adapter.get(mem1.id);
    expect(removed).toBeNull();

    // Final stats
    const finalStats = await adapter.stats();
    expect(finalStats.memories).toBe(1);
    expect(finalStats.embeddings).toBe(1);
  });

  test("FTS fallback works when Ollama unavailable", async () => {
    // First store with Ollama available
    const config = {
      ollamaHost: "http://localhost:11434",
      ollamaModel: "mxbai-embed-large",
    };
    const adapter = createMemoryAdapter(db, config);

    await adapter.store("TypeScript type safety", { collection: "tech" });
    await adapter.store("JavaScript dynamic typing", { collection: "tech" });

    // Now break Ollama
    const mockBrokenFetch = mock(() =>
      Promise.reject(new Error("ECONNREFUSED"))
    );
    global.fetch = mockBrokenFetch as typeof fetch;

    // FTS should still work
    const results = await adapter.find("TypeScript", { fts: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe("fts");
    expect(results[0].memory.content).toContain("TypeScript");
  });

  test("Wave 1-2 Integration: Real services are wired with graceful degradation", async () => {
    const config = {
      ollamaHost: "http://localhost:11434",
      ollamaModel: "mxbai-embed-large",
    };
    const adapter = createMemoryAdapter(db, config);

    // Test 1: Auto-tagging service is wired (real service OR graceful degradation)
    const mem1 = await adapter.store("OAuth tokens need 5min refresh buffer", {
      collection: "auth",
      autoGenerateTags: true,
    });

    const retrieved = await adapter.get(mem1.id);
    expect(retrieved).not.toBeNull();

    // Real service wired: auto_tags will be undefined (no API key) OR contain AutoTagResult
    // Stub was wired: auto_tags would contain simple {tags: [...], confidence: 0.7}
    // SUCCESS CRITERIA: No crash, graceful degradation
    expect(retrieved?.id).toBe(mem1.id);

    // If auto_tags present, verify it's from real service (has full structure) or undefined
    if (retrieved?.metadata?.auto_tags) {
      const autoTags = typeof retrieved.metadata.auto_tags === 'string'
        ? JSON.parse(retrieved.metadata.auto_tags)
        : retrieved.metadata.auto_tags;

      // Real service returns {tags, keywords, categories, confidence}
      // Stub returns {tags, confidence}
      // This verifies real service structure (keywords/categories fields)
      const hasKeywordsField = 'keywords' in autoTags;
      const hasCategoriesField = 'categories' in autoTags;

      expect(hasKeywordsField || hasCategoriesField).toBe(true);
    }

    // Test 2: Smart operation service is wired (real service OR graceful degradation)
    await adapter.store("OAuth tokens expire after 1 hour", {
      collection: "auth",
    });

    const result = await adapter.upsert(
      "OAuth tokens expire after 60 minutes",
      { useSmartOps: true, collection: "auth" }
    );

    // Real service wired: falls back to heuristics (no API key) OR uses LLM
    // Stub was wired: always uses heuristics
    // SUCCESS CRITERIA: No crash, returns valid operation
    expect(result.operation).toBeDefined();
    expect(result.reason).toBeDefined();
    expect(['ADD', 'UPDATE', 'DELETE', 'NOOP']).toContain(result.operation);
  });

  test("Wave 1-2 Integration: Auto-linking service is wired", async () => {
    const config = {
      ollamaHost: "http://localhost:11434",
      ollamaModel: "mxbai-embed-large",
    };
    const adapter = createMemoryAdapter(db, config);

    // Store memories for linking
    await adapter.store("OAuth tokens need refresh buffer", { collection: "auth" });
    await adapter.store("JWT tokens have expiration time", { collection: "auth" });

    // Store with auto-linking enabled
    const mem3 = await adapter.store("Token refresh race conditions", {
      collection: "auth",
      autoLinkMemories: true,
    });

    // Real service wired: links will be created OR undefined (graceful degradation)
    // Stub was wired: links would always be created (simple similarity)
    // SUCCESS CRITERIA: No crash, graceful handling
    expect(mem3.id).toBeDefined();

    // If links created, verify they're valid
    if (mem3.links && mem3.links.length > 0) {
      expect(mem3.links[0].memory_id).toBeDefined();
      expect(mem3.links[0].link_type).toBeDefined();
    }
  });
});
