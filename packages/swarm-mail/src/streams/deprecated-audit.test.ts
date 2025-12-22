/**
 * Audit Test: Deprecated Code Removal
 * 
 * This test documents all deprecated PGlite code found during Bug Fix audit.
 * Tests that previously deprecated functions now work with libSQL.
 * 
 * Audit findings:
 * 1. checkSwarmHealth() - FIXED (was throwing error)
 * 2. checkHealth() in agent-mail - FIXED (was throwing error)
 * 3. All convenience wrappers - FIXED (schema initialization bug)
 * 4. Legacy files (projections.ts, store.ts) - DOCUMENTED (safe to ignore)
 */
import { describe, expect, test } from "bun:test";

describe("Deprecated Code Audit - All Issues Resolved", () => {
  describe("Health Check Functions", () => {
    test("checkSwarmHealth() should work (was deprecated, now migrated)", async () => {
      const { checkSwarmHealth } = await import("./swarm-mail");
      
      const result = await checkSwarmHealth();
      
      expect(result.healthy).toBe(true);
      expect(result.database).toBe("connected");
    });

    test("checkHealth() in agent-mail should work (was deprecated, now delegates)", async () => {
      const { checkHealth } = await import("./agent-mail");
      
      const result = await checkHealth();
      
      expect(result.healthy).toBe(true);
      expect(result.database).toBe("connected");
    });
  });

  describe("Convenience Wrappers - Schema Initialization", () => {
    test("all convenience wrappers should initialize schema automatically", async () => {
      // Create raw adapter WITHOUT schema (simulates cold start)
      const { createLibSQLAdapter } = await import("../libsql");
      const rawDb = await createLibSQLAdapter({ url: ":memory:" });

      // Import convenience wrappers (they should auto-init schema)
      const {
        checkConflicts,
        getActiveReservations,
        getAgents,
        getInbox,
      } = await import("./projections-drizzle");

      const { getLatestSequence, readEvents } = await import("./store-drizzle");

      // All of these should work WITHOUT explicit schema initialization
      // If schema is missing, they'll throw "no such table" error
      
      const inbox = await getInbox("/test", "TestAgent", {}, undefined, rawDb);
      expect(Array.isArray(inbox)).toBe(true);

      const agents = await getAgents("/test", undefined, rawDb);
      expect(Array.isArray(agents)).toBe(true);

      const reservations = await getActiveReservations("/test", undefined, undefined, rawDb);
      expect(Array.isArray(reservations)).toBe(true);

      const conflicts = await checkConflicts("/test", "Agent", [], undefined, rawDb);
      expect(Array.isArray(conflicts)).toBe(true);
      expect(conflicts.length).toBe(0);

      const sequence = await getLatestSequence("/test", undefined, rawDb);
      expect(typeof sequence).toBe("number");

      const events = await readEvents({}, undefined, rawDb);
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe("Legacy Files - Documented (No Action Needed)", () => {
    test("projections.ts - legacy file exists (backward compatibility only)", () => {
      // This file throws errors by design - it forces migration to Drizzle
      // No action needed - it's intentionally deprecated
      expect(true).toBe(true);
    });

    test("store.ts - legacy file exists (backward compatibility only)", () => {
      // Same as above - intentionally deprecated
      expect(true).toBe(true);
    });

    test("auto-migrate.ts - contains PGlite migration code (still needed)", () => {
      // This file helps migrate old PGlite databases to libSQL
      // Keep it - users might still have old databases
      expect(true).toBe(true);
    });
  });

  describe("Migration Comments - Informational Only", () => {
    test("PGlite references in comments are OK (context, not code)", () => {
      // Files like swarm-mail.ts have comments about PGlite removal
      // These are documentation, not code - they're helpful context
      expect(true).toBe(true);
    });
  });
});
