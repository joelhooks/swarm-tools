/**
 * Migration runner tests - TDD approach
 * 
 * Tests schema validation and migration application for libSQL/Drizzle.
 * 
 * Test coverage:
 * 1. Detect missing columns in existing tables
 * 2. Detect wrong column types
 * 3. Apply ALTER TABLE for missing columns
 * 4. Recreate empty table with wrong schema
 * 5. Preserve data when altering tables
 * 6. Handle multiple schema mismatches in one migration
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { createDrizzleClient } from "./drizzle.js";
import { eventsTable, messagesTable, agentsTable } from "./schema/index.js";
import { validateSchema, migrateDatabase, type SchemaValidationResult } from "./migrate.js";

describe("Migration Runner - Schema Validation", () => {
  let client: Client;
  let db: ReturnType<typeof createDrizzleClient>;

  beforeEach(() => {
    client = createClient({ url: ":memory:" });
    db = createDrizzleClient(client);
  });

  afterEach(async () => {
    await client.close();
  });

  test("RED: detects table with missing column", async () => {
    // Create old schema without project_key column
    await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);

    const result = await validateSchema(client, { eventsTable });

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    
    // Should include project_key as missing
    const projectKeyIssue = result.issues.find(
      i => i.type === "missing_column" && i.column === "project_key"
    );
    expect(projectKeyIssue).toBeDefined();
    expect(projectKeyIssue?.table).toBe("events");
  });

  test("RED: detects table with wrong column type", async () => {
    // Create table with project_key as INTEGER instead of TEXT
    await client.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key INTEGER NOT NULL,
        from_agent TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    const result = await validateSchema(client, { messagesTable });

    expect(result.valid).toBe(false);
    
    // Should include the type mismatch
    const typeIssue = result.issues.find(
      i => i.type === "wrong_column_type" && i.column === "project_key"
    );
    expect(typeIssue).toBeDefined();
    expect(typeIssue?.table).toBe("messages");
    expect(typeIssue?.expected).toBe("TEXT");
    expect(typeIssue?.actual).toBe("INTEGER");
  });

  test("RED: detects multiple schema mismatches", async () => {
    // Create table missing multiple columns
    await client.execute(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        registered_at INTEGER NOT NULL
      )
    `);

    const result = await validateSchema(client, { agentsTable });

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(1);
    
    const missingColumns = result.issues
      .filter(i => i.type === "missing_column")
      .map(i => i.column);
    
    expect(missingColumns).toContain("project_key");
    expect(missingColumns).toContain("last_active_at");
  });

  test("RED: validates schema matches when correct", async () => {
    // Create table with correct schema
    await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        project_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        sequence INTEGER,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    const result = await validateSchema(client, { eventsTable });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe("Migration Runner - Schema Fixes", () => {
  let client: Client;
  let db: ReturnType<typeof createDrizzleClient>;

  beforeEach(() => {
    client = createClient({ url: ":memory:" });
    db = createDrizzleClient(client);
  });

  afterEach(async () => {
    await client.close();
  });

  test("RED: applies ALTER TABLE for missing column", async () => {
    // Create old schema
    await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);

    // Migrate should add missing columns
    await migrateDatabase(client, { eventsTable });

    // Verify column was added
    const validation = await validateSchema(client, { eventsTable });
    expect(validation.valid).toBe(true);

    // Verify we can insert with new column
    await db.insert(eventsTable).values({
      type: "test",
      project_key: "test-project",
      timestamp: Date.now(),
      data: "{}",
    });

    const rows = await db.select().from(eventsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].project_key).toBe("test-project");
  });

  test("RED: recreates empty table with wrong type", async () => {
    // Create table with wrong type
    await client.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key INTEGER NOT NULL,
        from_agent TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Migrate should recreate table
    await migrateDatabase(client, { messagesTable });

    // Verify schema is correct
    const validation = await validateSchema(client, { messagesTable });
    expect(validation.valid).toBe(true);

    // Verify we can insert with correct type
    await db.insert(messagesTable).values({
      project_key: "test-project",
      from_agent: "agent1",
      subject: "test",
      body: "test body",
      created_at: Date.now(),
    });

    const rows = await db.select().from(messagesTable);
    expect(rows).toHaveLength(1);
    expect(typeof rows[0].project_key).toBe("string");
  });

  test("RED: preserves data when adding columns", async () => {
    // Create old schema with data
    await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);

    // Insert existing data
    await client.execute(`
      INSERT INTO events (type, timestamp, data) 
      VALUES ('existing', 123456789, '{"foo":"bar"}')
    `);

    // Migrate should preserve existing data
    await migrateDatabase(client, { eventsTable });

    const rows = await db.select().from(eventsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("existing");
    expect(rows[0].timestamp).toBe(123456789);
    expect(rows[0].data).toBe('{"foo":"bar"}');
  });

  test("RED: refuses to recreate table with existing data", async () => {
    // Create table with wrong type and data
    await client.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key INTEGER NOT NULL,
        from_agent TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    await client.execute(`
      INSERT INTO messages (project_key, from_agent, subject, body, created_at)
      VALUES (999, 'agent1', 'test', 'body', 123456789)
    `);

    // Migration should fail with error - can't recreate table with data
    await expect(
      migrateDatabase(client, { messagesTable })
    ).rejects.toThrow(/Cannot recreate table.*has.*row/i);
  });

  test("RED: handles multiple tables in one migration", async () => {
    // Create multiple tables with issues
    await client.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        registered_at INTEGER NOT NULL
      )
    `);

    // Migrate both
    await migrateDatabase(client, { 
      eventsTable,
      agentsTable 
    });

    // Verify both schemas are correct
    const eventsValidation = await validateSchema(client, { eventsTable });
    const agentsValidation = await validateSchema(client, { agentsTable });

    expect(eventsValidation.valid).toBe(true);
    expect(agentsValidation.valid).toBe(true);
  });
});

describe("Migration Runner - Cursors Table Migration (stream_id → stream)", () => {
  let client: Client;

  beforeEach(() => {
    client = createClient({ url: ":memory:" });
  });

  afterEach(async () => {
    await client.close();
  });

  test("RED: migrates cursors table from stream_id to stream column", async () => {
    // Create old cursors schema (PGLite format with stream_id)
    await client.execute(`
      CREATE TABLE cursors (
        stream_id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Insert legacy data
    await client.execute(`
      INSERT INTO cursors (stream_id, position, updated_at)
      VALUES ('test-stream', 42, ${Date.now()})
    `);

    const { cursorsTable } = await import("./schema/streams.js");

    // Migrate should detect old schema and recreate table
    await migrateDatabase(client, { cursorsTable });

    // Verify new schema is correct
    const validation = await validateSchema(client, { cursorsTable });
    expect(validation.valid).toBe(true);

    // Verify table has new columns
    const columns = await client.execute(`PRAGMA table_info(cursors)`);
    const columnNames = columns.rows.map(r => r.name as string);
    
    expect(columnNames).toContain("stream");
    expect(columnNames).toContain("checkpoint");
    expect(columnNames).not.toContain("stream_id");

    // Note: Data is lost during DROP TABLE recreate
    // This is acceptable as cursors are ephemeral stream positions
  });

  test("RED: leaves cursors table unchanged if already migrated", async () => {
    const { cursorsTable } = await import("./schema/streams.js");

    // Create new cursors schema
    await client.execute(`
      CREATE TABLE cursors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(stream, checkpoint)
      )
    `);

    // Insert data with new schema
    await client.execute(`
      INSERT INTO cursors (stream, checkpoint, position, updated_at)
      VALUES ('test-stream', 'main', 42, ${Date.now()})
    `);

    // Migrate should be a no-op
    await migrateDatabase(client, { cursorsTable });

    // Verify data is preserved
    const rows = await client.execute(`SELECT * FROM cursors`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].stream).toBe("test-stream");
    expect(rows.rows[0].checkpoint).toBe("main");
    expect(rows.rows[0].position).toBe(42);
  });
});
