/**
 * Pagination API Tests - Field Selection for Compact Output
 *
 * Tests field projection for memory queries to optimize token usage.
 */

import { createClient, type Client } from "@libsql/client";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createDrizzleClient } from "../db/drizzle.js";
import type { SwarmDb } from "../db/client.js";
import { createMemoryAdapter, type FindOptions } from "../memory/adapter.js";

/**
 * Create in-memory libSQL database with memory schema
 */
async function createTestDb(): Promise<{ client: Client; db: SwarmDb }> {
  const client = createClient({ url: ":memory:" });

  // Create memories table with vector column
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

describe("Field Selection", () => {
  let client: Client;
  let db: SwarmDb;
  let adapter: ReturnType<typeof createMemoryAdapter>;

  beforeAll(async () => {
    const testDb = await createTestDb();
    client = testDb.client;
    db = testDb.db;
    
    adapter = createMemoryAdapter(db, {
      ollamaHost: "http://localhost:11434",
      ollamaModel: "mxbai-embed-large",
    });

    // Store test memories
    await adapter.store("OAuth tokens need 5min refresh buffer", {
      tags: "auth,tokens",
      metadata: JSON.stringify({ priority: "high" }),
    });

    await adapter.store("Next.js 16 Cache Components require Suspense boundaries", {
      tags: "nextjs,caching",
      metadata: JSON.stringify({ version: "16" }),
    });
  });

  afterAll(async () => {
    await client.close();
  });

  test("minimal fields - returns only id, content preview, created_at", async () => {
    const results = await adapter.find("tokens", { 
      fields: "minimal",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    const result = results[0];
    
    // Should have minimal fields
    expect(result.memory).toHaveProperty("id");
    expect(result.memory).toHaveProperty("content");
    expect(result.memory).toHaveProperty("createdAt");
    
    // Should NOT have these fields in minimal mode
    expect(result.memory).not.toHaveProperty("metadata");
    expect(result.memory).not.toHaveProperty("collection");
    expect(result.memory).not.toHaveProperty("confidence");
  });

  test("summary fields - includes score and match_type", async () => {
    const results = await adapter.find("tokens", {
      fields: "summary",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    const result = results[0];

    // Should have summary fields
    expect(result.memory).toHaveProperty("id");
    expect(result.memory).toHaveProperty("content");
    expect(result.memory).toHaveProperty("createdAt");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("matchType");
    
    // Should NOT have metadata in summary mode
    expect(result.memory).not.toHaveProperty("metadata");
  });

  test("full fields - returns all columns (default)", async () => {
    const results = await adapter.find("tokens", {
      fields: "full",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    const result = results[0];

    // Should have ALL fields
    expect(result.memory).toHaveProperty("id");
    expect(result.memory).toHaveProperty("content");
    expect(result.memory).toHaveProperty("createdAt");
    expect(result.memory).toHaveProperty("metadata");
    expect(result.memory).toHaveProperty("collection");
    expect(result.memory).toHaveProperty("confidence");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("matchType");
  });

  test("custom field array - supports arbitrary field selection", async () => {
    const results = await adapter.find("tokens", {
      fields: ["id", "content"],
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    const result = results[0];

    // Should have only requested fields
    expect(result.memory).toHaveProperty("id");
    expect(result.memory).toHaveProperty("content");
    
    // Should NOT have unrequested fields
    expect(result.memory).not.toHaveProperty("createdAt");
    expect(result.memory).not.toHaveProperty("metadata");
    expect(result.memory).not.toHaveProperty("collection");
  });

  test("omitting fields parameter defaults to 'full'", async () => {
    const results = await adapter.find("tokens", { limit: 5 });

    expect(results.length).toBeGreaterThan(0);

    const result = results[0];

    // Should have all fields (default behavior)
    expect(result.memory).toHaveProperty("id");
    expect(result.memory).toHaveProperty("content");
    expect(result.memory).toHaveProperty("metadata");
    expect(result.memory).toHaveProperty("collection");
  });
});
