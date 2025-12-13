/**
 * Tests for Schema Migration System
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  runMigrations,
  getCurrentVersion,
  rollbackTo,
  isMigrationApplied,
  getPendingMigrations,
  getAppliedMigrations,
  migrations,
} from "./migrations";

describe("Schema Migrations", () => {
  let db: PGlite;

  beforeEach(async () => {
    // Use in-memory database for tests
    db = new PGlite();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Fresh Install", () => {
    it("should start with version 0", async () => {
      const version = await getCurrentVersion(db);
      expect(version).toBe(0);
    });

    it("should run all migrations on fresh database", async () => {
      const result = await runMigrations(db);

      expect(result.applied).toEqual([1, 2]);
      expect(result.current).toBe(2);

      const version = await getCurrentVersion(db);
      expect(version).toBe(2);
    });

    it("should create cursors table with correct schema", async () => {
      await runMigrations(db);

      // Verify table exists
      const tableResult = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'cursors'
        ) as exists`,
      );
      expect(tableResult.rows[0]?.exists).toBe(true);

      // Verify columns
      const columnsResult = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'cursors'
         ORDER BY ordinal_position`,
      );
      const columns = columnsResult.rows.map((r) => r.column_name);
      expect(columns).toContain("id");
      expect(columns).toContain("stream");
      expect(columns).toContain("checkpoint");
      expect(columns).toContain("position");
      expect(columns).toContain("updated_at");

      // Verify unique constraint exists
      const constraintsResult = await db.query<{ constraint_name: string }>(
        `SELECT constraint_name FROM information_schema.table_constraints
         WHERE table_name = 'cursors' AND constraint_type = 'UNIQUE'`,
      );
      expect(constraintsResult.rows.length).toBeGreaterThan(0);
    });

    it("should create deferred table with correct schema", async () => {
      await runMigrations(db);

      const tableResult = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'deferred'
        ) as exists`,
      );
      expect(tableResult.rows[0]?.exists).toBe(true);

      const columnsResult = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'deferred'
         ORDER BY ordinal_position`,
      );
      const columns = columnsResult.rows.map((r) => r.column_name);
      expect(columns).toContain("id");
      expect(columns).toContain("url");
      expect(columns).toContain("resolved");
      expect(columns).toContain("value");
      expect(columns).toContain("error");
      expect(columns).toContain("expires_at");
      expect(columns).toContain("created_at");
    });
  });

  describe("Idempotency", () => {
    it("should be safe to run migrations multiple times", async () => {
      // First run
      const result1 = await runMigrations(db);
      expect(result1.applied).toEqual([1, 2]);

      // Second run - should apply nothing
      const result2 = await runMigrations(db);
      expect(result2.applied).toEqual([]);
      expect(result2.current).toBe(2);

      // Version should still be 2
      const version = await getCurrentVersion(db);
      expect(version).toBe(2);
    });
  });

  describe("Incremental Upgrade", () => {
    it("should apply only new migrations", async () => {
      // Manually apply migration 1
      await db.exec(migrations[0]!.up);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at BIGINT NOT NULL,
          description TEXT
        );
      `);
      await db.query(
        `INSERT INTO schema_version (version, applied_at, description)
         VALUES ($1, $2, $3)`,
        [1, Date.now(), migrations[0]!.description],
      );

      // Now run migrations - should only apply 2
      const result = await runMigrations(db);
      expect(result.applied).toEqual([2]);
      expect(result.current).toBe(2);
    });
  });

  describe("Rollback", () => {
    it("should rollback to target version", async () => {
      // Apply all migrations
      await runMigrations(db);
      expect(await getCurrentVersion(db)).toBe(2);

      // Rollback to version 1
      const result = await rollbackTo(db, 1);
      expect(result.rolledBack).toEqual([2]);
      expect(result.current).toBe(1);

      // Version should be 1
      const version = await getCurrentVersion(db);
      expect(version).toBe(1);

      // Cursors table should still exist
      const cursorsExists = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'cursors'
        ) as exists`,
      );
      expect(cursorsExists.rows[0]?.exists).toBe(true);

      // Deferred table should be gone
      const deferredExists = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'deferred'
        ) as exists`,
      );
      expect(deferredExists.rows[0]?.exists).toBe(false);
    });

    it("should rollback to version 0", async () => {
      await runMigrations(db);

      const result = await rollbackTo(db, 0);
      expect(result.rolledBack).toEqual([2, 1]);
      expect(result.current).toBe(0);

      // All tables should be gone
      const cursorsExists = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'cursors'
        ) as exists`,
      );
      expect(cursorsExists.rows[0]?.exists).toBe(false);
    });

    it("should do nothing if target version >= current", async () => {
      await runMigrations(db);

      const result = await rollbackTo(db, 2);
      expect(result.rolledBack).toEqual([]);
      expect(result.current).toBe(2);
    });
  });

  describe("Migration Status", () => {
    it("should check if migration is applied", async () => {
      expect(await isMigrationApplied(db, 1)).toBe(false);

      await runMigrations(db);

      expect(await isMigrationApplied(db, 1)).toBe(true);
      expect(await isMigrationApplied(db, 2)).toBe(true);
    });

    it("should list pending migrations", async () => {
      const pending1 = await getPendingMigrations(db);
      expect(pending1).toHaveLength(2);
      expect(pending1.map((m) => m.version)).toEqual([1, 2]);

      // Apply migration 1
      const migration = migrations[0];
      if (!migration) throw new Error("Migration not found");

      await db.exec(migration.up);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at BIGINT NOT NULL,
          description TEXT
        );
      `);
      await db.query(
        `INSERT INTO schema_version (version, applied_at, description)
         VALUES ($1, $2, $3)`,
        [1, Date.now(), migration.description],
      );

      const pending2 = await getPendingMigrations(db);
      expect(pending2).toHaveLength(1);
      expect(pending2.map((m) => m.version)).toEqual([2]);
    });

    it("should list applied migrations", async () => {
      const applied1 = await getAppliedMigrations(db);
      expect(applied1).toHaveLength(0);

      await runMigrations(db);

      const applied2 = await getAppliedMigrations(db);
      expect(applied2).toHaveLength(2);
      expect(applied2.map((m) => m.version)).toEqual([1, 2]);
      expect(applied2[0]?.description).toBe(
        "Add cursors table for DurableCursor",
      );
    });
  });

  describe("Data Persistence", () => {
    it("should preserve data across migrations", async () => {
      // Apply migration 1 (cursors table)
      await db.exec(migrations[0]!.up);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at BIGINT NOT NULL,
          description TEXT
        );
      `);
      await db.query(
        `INSERT INTO schema_version (version, applied_at, description)
         VALUES ($1, $2, $3)`,
        [1, Date.now(), migrations[0]!.description],
      );

      // Insert test data
      await db.query(
        `INSERT INTO cursors (stream, checkpoint, position, updated_at)
         VALUES ($1, $2, $3, $4)`,
        ["test-stream", "test-checkpoint", 42, Date.now()],
      );

      // Apply remaining migrations
      await runMigrations(db);

      // Data should still be there
      const result = await db.query<{ position: number }>(
        `SELECT position FROM cursors WHERE stream = $1`,
        ["test-stream"],
      );
      expect(result.rows[0]?.position).toBe(42);
    });
  });

  describe("Error Handling", () => {
    it("should rollback failed migrations", async () => {
      // Apply good migration first
      const migration = migrations[0];
      if (!migration) throw new Error("Migration not found");

      await db.exec(migration.up);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at BIGINT NOT NULL,
          description TEXT
        );
      `);
      await db.query(
        `INSERT INTO schema_version (version, applied_at, description)
         VALUES ($1, $2, $3)`,
        [1, Date.now(), migration.description],
      );

      // Try to run invalid SQL in a transaction
      try {
        await db.exec("BEGIN");
        await db.exec("THIS IS INVALID SQL");
        await db.exec("COMMIT");
        throw new Error("Should have thrown");
      } catch {
        await db.exec("ROLLBACK");
        // Expected to fail
      }

      // Version should still be 1
      const version = await getCurrentVersion(db);
      expect(version).toBe(1);
    });
  });

  describe("Schema Version Table", () => {
    it("should record migration metadata", async () => {
      await runMigrations(db);

      const result = await db.query<{
        version: number;
        applied_at: string;
        description: string;
      }>(
        `SELECT version, applied_at, description FROM schema_version ORDER BY version`,
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]?.version).toBe(1);
      expect(result.rows[0]?.description).toBe(
        "Add cursors table for DurableCursor",
      );
      expect(result.rows[1]?.version).toBe(2);

      // Applied_at should be recent
      const appliedAt = parseInt(result.rows[0]?.applied_at as string);
      expect(appliedAt).toBeGreaterThan(Date.now() - 10000);
    });
  });
});
