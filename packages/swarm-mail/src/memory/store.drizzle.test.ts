/**
 * Memory Store Drizzle Integration Test
 *
 * Tests the Drizzle-based memory store implementation.
 * Verifies CRUD operations work with the new Drizzle query builder.
 */

import { createClient } from "@libsql/client";
import { beforeEach, describe, expect, test } from "bun:test";
import { createDrizzleClient } from "../db/drizzle.js";
import { type Memory, createMemoryStore } from "./store.js";

/**
 * Generate a mock embedding vector (1024 dimensions for mxbai-embed-large)
 */
function mockEmbedding(seed = 0): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < 1024; i++) {
    embedding.push(Math.sin(seed + i * 0.1) * 0.5 + 0.5);
  }
  return embedding;
}

describe("Memory Store (Drizzle) - Basic Operations", () => {
  let db: ReturnType<typeof createDrizzleClient>;
  let store: ReturnType<typeof createMemoryStore>;

  beforeEach(async () => {
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

    db = createDrizzleClient(client);
    store = createMemoryStore(db);
  });

  test("store() inserts a new memory with embedding", async () => {
    const memory: Memory = {
      id: "mem-1",
      content: "Test memory content",
      metadata: { tag: "test" },
      collection: "default",
      createdAt: new Date(),
    };
    const embedding = mockEmbedding(1);

    await store.store(memory, embedding);

    const retrieved = await store.get("mem-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("mem-1");
    expect(retrieved?.content).toBe("Test memory content");
    expect(retrieved?.metadata).toEqual({ tag: "test" });
    expect(retrieved?.collection).toBe("default");
  });

  test("store() updates existing memory (UPSERT)", async () => {
    const memory: Memory = {
      id: "mem-1",
      content: "Original content",
      metadata: { version: 1 },
      collection: "default",
      createdAt: new Date(),
    };
    const embedding = mockEmbedding(1);

    await store.store(memory, embedding);

    // Update with new content
    const updated: Memory = {
      ...memory,
      content: "Updated content",
      metadata: { version: 2 },
    };
    const newEmbedding = mockEmbedding(2);

    await store.store(updated, newEmbedding);

    const retrieved = await store.get("mem-1");
    expect(retrieved?.content).toBe("Updated content");
    expect(retrieved?.metadata).toEqual({ version: 2 });
  });

  test("get() returns null for non-existent memory", async () => {
    const retrieved = await store.get("non-existent");
    expect(retrieved).toBeNull();
  });

  test("list() returns all memories sorted by created_at DESC", async () => {
    const mem1: Memory = {
      id: "mem-1",
      content: "First memory",
      metadata: {},
      collection: "default",
      createdAt: new Date(Date.now() - 1000),
    };
    const mem2: Memory = {
      id: "mem-2",
      content: "Second memory",
      metadata: {},
      collection: "default",
      createdAt: new Date(),
    };

    await store.store(mem1, mockEmbedding(1));
    await store.store(mem2, mockEmbedding(2));

    const memories = await store.list();
    expect(memories).toHaveLength(2);
    // Most recent first
    expect(memories[0].id).toBe("mem-2");
    expect(memories[1].id).toBe("mem-1");
  });

  test("list() filters by collection", async () => {
    const mem1: Memory = {
      id: "mem-1",
      content: "First memory",
      metadata: {},
      collection: "collection-a",
      createdAt: new Date(),
    };
    const mem2: Memory = {
      id: "mem-2",
      content: "Second memory",
      metadata: {},
      collection: "collection-b",
      createdAt: new Date(),
    };

    await store.store(mem1, mockEmbedding(1));
    await store.store(mem2, mockEmbedding(2));

    const memoriesA = await store.list("collection-a");
    expect(memoriesA).toHaveLength(1);
    expect(memoriesA[0].id).toBe("mem-1");

    const memoriesB = await store.list("collection-b");
    expect(memoriesB).toHaveLength(1);
    expect(memoriesB[0].id).toBe("mem-2");
  });

  test("delete() removes memory", async () => {
    const memory: Memory = {
      id: "mem-1",
      content: "Test memory",
      metadata: {},
      collection: "default",
      createdAt: new Date(),
    };

    await store.store(memory, mockEmbedding(1));
    expect(await store.get("mem-1")).not.toBeNull();

    await store.delete("mem-1");
    expect(await store.get("mem-1")).toBeNull();
  });

  test("getStats() returns correct counts", async () => {
    const stats = await store.getStats();
    expect(stats.memories).toBe(0);
    expect(stats.embeddings).toBe(0);

    const memory: Memory = {
      id: "mem-1",
      content: "Test memory",
      metadata: {},
      collection: "default",
      createdAt: new Date(),
    };

    await store.store(memory, mockEmbedding(1));

    const updatedStats = await store.getStats();
    expect(updatedStats.memories).toBe(1);
    expect(updatedStats.embeddings).toBe(1);
  });

  test("store() handles complex metadata", async () => {
    const memory: Memory = {
      id: "mem-1",
      content: "Test",
      metadata: {
        tags: ["tag1", "tag2"],
        nested: { key: "value" },
        number: 42,
        bool: true,
      },
      collection: "default",
      createdAt: new Date(),
    };

    await store.store(memory, mockEmbedding(1));

    const retrieved = await store.get("mem-1");
    expect(retrieved?.metadata).toEqual({
      tags: ["tag1", "tag2"],
      nested: { key: "value" },
      number: 42,
      bool: true,
    });
  });
});

describe("Memory Store (Drizzle) - Vector Search", () => {
  let db: ReturnType<typeof createDrizzleClient>;
  let store: ReturnType<typeof createMemoryStore>;

  beforeEach(async () => {
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

    // Create vector index for vector_top_k queries
    await client.execute(`
      CREATE INDEX idx_memories_embedding 
      ON memories(libsql_vector_idx(embedding))
    `);

    db = createDrizzleClient(client);
    store = createMemoryStore(db);

    // Insert test memories with different embeddings
    const memories = [
      {
        id: "mem-1",
        content: "This is about TypeScript",
        collection: "tech",
        embedding: mockEmbedding(1),
      },
      {
        id: "mem-2",
        content: "This is about JavaScript",
        collection: "tech",
        embedding: mockEmbedding(1.1), // Similar to mem-1
      },
      {
        id: "mem-3",
        content: "This is about cooking",
        collection: "food",
        embedding: mockEmbedding(50), // Very different
      },
    ];

    for (const mem of memories) {
      await store.store(
        {
          id: mem.id,
          content: mem.content,
          metadata: {},
          collection: mem.collection,
          createdAt: new Date(),
        },
        mem.embedding
      );
    }
  });

  test("search() finds similar embeddings", async () => {
    const queryEmbedding = mockEmbedding(1.05); // Similar to mem-1 and mem-2
    const results = await store.search(queryEmbedding);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe("vector");
    // mem-1 and mem-2 should score higher than mem-3
    const topIds = results.slice(0, 2).map((r) => r.memory.id);
    expect(topIds).toContain("mem-1");
    expect(topIds).toContain("mem-2");
  });

  test("search() respects limit", async () => {
    const queryEmbedding = mockEmbedding(1);
    const results = await store.search(queryEmbedding, { limit: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("search() respects threshold", async () => {
    const queryEmbedding = mockEmbedding(1);
    const results = await store.search(queryEmbedding, { threshold: 0.99 });

    // High threshold should filter out dissimilar results
    results.forEach((r) => {
      expect(r.score).toBeGreaterThanOrEqual(0.99);
    });
  });

  test("search() filters by collection", async () => {
    const queryEmbedding = mockEmbedding(1);
    const results = await store.search(queryEmbedding, { collection: "tech" });

    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => {
      expect(r.memory.collection).toBe("tech");
    });
  });

  test("search() returns scores in descending order", async () => {
    const queryEmbedding = mockEmbedding(1);
    const results = await store.search(queryEmbedding);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("search() returns empty array when no memories", async () => {
    await store.delete("mem-1");
    await store.delete("mem-2");
    await store.delete("mem-3");

    const results = await store.search(mockEmbedding(1));
    expect(results).toEqual([]);
  });
});
