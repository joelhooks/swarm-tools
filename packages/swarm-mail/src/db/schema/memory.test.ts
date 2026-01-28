import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "bun:test";
import { createDrizzleClient } from "../drizzle.js";
import { memories } from "./memory.js";
import { EMBEDDING_DIM } from "../../memory/ollama.js";

describe("Memory Schema", () => {
  test("creates memories table with correct structure", async () => {
    const libsqlClient = createClient({ url: ":memory:" });

    // Create the table using Drizzle schema
    // IMPORTANT: Must match db/schema/memory.ts Drizzle schema exactly
    await libsqlClient.execute(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        collection TEXT DEFAULT 'default',
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        decay_factor REAL DEFAULT 1.0,
        embedding F32_BLOB(${EMBEDDING_DIM}),
        valid_from TEXT,
        valid_until TEXT,
        superseded_by TEXT REFERENCES memories(id),
        auto_tags TEXT,
        keywords TEXT
      )
    `);

    // Verify table exists
    const tables = await libsqlClient.execute(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='memories'
    `);
    expect(tables.rows).toHaveLength(1);

    // Verify column structure
    const columns = await libsqlClient.execute(`
      SELECT name, type, "notnull", dflt_value FROM pragma_table_info('memories')
    `);

    expect(columns.rows).toHaveLength(14); // 9 original + 5 new columns

    // Check each column
    const columnMap = new Map(
      columns.rows.map((row) => [row.name, row])
    );

    expect(columnMap.get("id")).toMatchObject({
      type: "TEXT",
    });

    expect(columnMap.get("content")).toMatchObject({
      type: "TEXT",
      notnull: 1,
    });

    expect(columnMap.get("metadata")).toMatchObject({
      type: "TEXT",
      dflt_value: "'{}'",
    });

    expect(columnMap.get("collection")).toMatchObject({
      type: "TEXT",
      dflt_value: "'default'",
    });

    expect(columnMap.get("tags")).toMatchObject({
      type: "TEXT",
      dflt_value: "'[]'",
    });

    expect(columnMap.get("created_at")).toBeDefined();
    expect(columnMap.get("updated_at")).toBeDefined();

    expect(columnMap.get("decay_factor")).toMatchObject({
      type: "REAL",
      dflt_value: "1.0",
    });

    expect(columnMap.get("embedding")).toMatchObject({
      type: `F32_BLOB(${EMBEDDING_DIM})`,
    });
  });

  test("can insert and query memories using Drizzle", async () => {
    const libsqlClient = createClient({ url: ":memory:" });
    const db = createDrizzleClient(libsqlClient);

    // Create table
    // IMPORTANT: Must match db/schema/memory.ts Drizzle schema exactly
    await libsqlClient.execute(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        collection TEXT DEFAULT 'default',
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        decay_factor REAL DEFAULT 1.0,
        embedding F32_BLOB(${EMBEDDING_DIM}),
        valid_from TEXT,
        valid_until TEXT,
        superseded_by TEXT REFERENCES memories(id),
        auto_tags TEXT,
        keywords TEXT
      )
    `);

    // Insert using Drizzle
    await db.insert(memories).values({
      id: "test-123",
      content: "Test memory content",
      metadata: JSON.stringify({ key: "value" }),
      collection: "test",
      tags: JSON.stringify(["tag1", "tag2"]),
    });

    // Query using Drizzle
    const results = await db.select().from(memories);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("test-123");
    expect(results[0].content).toBe("Test memory content");
    expect(results[0].collection).toBe("test");

    // Verify defaults are set
    expect(results[0].decay_factor).toBe(1.0);
    expect(results[0].created_at).toBeDefined();
    expect(results[0].updated_at).toBeDefined();
  });

  test("vector column accepts F32_BLOB data", async () => {
    const libsqlClient = createClient({ url: ":memory:" });
    const db = createDrizzleClient(libsqlClient);

    // Create table with vector column
    // IMPORTANT: Must match db/schema/memory.ts Drizzle schema exactly
    await libsqlClient.execute(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        collection TEXT DEFAULT 'default',
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        decay_factor REAL DEFAULT 1.0,
        embedding F32_BLOB(${EMBEDDING_DIM}),
        valid_from TEXT,
        valid_until TEXT,
        superseded_by TEXT REFERENCES memories(id),
        auto_tags TEXT,
        keywords TEXT
      )
    `);

    // Generate test vector (EMBEDDING_DIM dimensions)
    const testVector = Array(EMBEDDING_DIM).fill(0).map((_, i) => i / EMBEDDING_DIM);

    // Insert with vector using libSQL's vector() function
    await libsqlClient.execute({
      sql: `INSERT INTO memories (id, content, embedding) VALUES (?, ?, vector(?))`,
      args: ["vec-test", "Vector test", JSON.stringify(testVector)],
    });

    // Query and verify
    const results = await db.select().from(memories).where(eq(memories.id, "vec-test"));

    expect(results).toHaveLength(1);
    expect(results[0].embedding).toBeDefined();
  });

  test("schema exports match expected types", () => {
    expect(memories).toBeDefined();
    expect(memories.id).toBeDefined();
    expect(memories.content).toBeDefined();
    expect(memories.metadata).toBeDefined();
    expect(memories.collection).toBeDefined();
    expect(memories.tags).toBeDefined();
    expect(memories.created_at).toBeDefined();
    expect(memories.updated_at).toBeDefined();
    expect(memories.decay_factor).toBeDefined();
    expect(memories.embedding).toBeDefined();
  });
});
