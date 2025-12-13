/**
 * PGLite Event Store Setup
 *
 * Embedded PostgreSQL database for event sourcing.
 * No external server required - runs in-process.
 *
 * Database location: .opencode/streams.db (project-local)
 * or ~/.opencode/streams.db (global fallback)
 */
import { PGlite } from "@electric-sql/pglite";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================================================================
// Debug Logging
// ============================================================================

const DEBUG_LOG_PATH = join(homedir(), ".opencode", "streams-debug.log");

function debugLog(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const logLine = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}\n`
    : `[${timestamp}] ${message}\n`;
  try {
    appendFileSync(DEBUG_LOG_PATH, logLine);
  } catch {
    // Ignore write errors
  }
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get the database path for a project
 *
 * Prefers project-local .opencode/streams.db
 * Falls back to global ~/.opencode/streams.db
 */
export function getDatabasePath(projectPath?: string): string {
  // Try project-local first
  if (projectPath) {
    const localDir = join(projectPath, ".opencode");
    if (existsSync(localDir) || existsSync(projectPath)) {
      if (!existsSync(localDir)) {
        mkdirSync(localDir, { recursive: true });
      }
      return join(localDir, "streams");
    }
  }

  // Fall back to global
  const globalDir = join(homedir(), ".opencode");
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }
  return join(globalDir, "streams");
}

// ============================================================================
// Database Instance Management
// ============================================================================

/** Singleton database instances keyed by path */
const instances = new Map<string, PGlite>();

/** Pending database initialization promises to prevent race conditions */
const pendingInstances = new Map<string, Promise<PGlite>>();

/** Whether schema has been initialized for each instance */
const schemaInitialized = new Map<string, boolean>();

/** Track degraded instances (path -> error) */
const degradedInstances = new Map<string, Error>();

/** LRU tracking: path -> last access timestamp */
const lastAccess = new Map<string, number>();

/** Maximum number of cached database instances */
const MAX_CACHE_SIZE = 10;

/**
 * Evict least recently used instance if cache is full
 */
function evictLRU(): void {
  if (instances.size < MAX_CACHE_SIZE) {
    return;
  }

  let oldestPath: string | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;

  for (const [path, time] of lastAccess) {
    if (time < oldestTime) {
      oldestTime = time;
      oldestPath = path;
    }
  }

  if (oldestPath) {
    const db = instances.get(oldestPath);
    if (db) {
      db.close().catch((err) => {
        console.error(
          `[swarm-mail] Failed to close evicted database: ${err.message}`,
        );
      });
    }
    instances.delete(oldestPath);
    pendingInstances.delete(oldestPath);
    schemaInitialized.delete(oldestPath);
    degradedInstances.delete(oldestPath);
    lastAccess.delete(oldestPath);
  }
}

/**
 * Get or create a PGLite instance for the given path
 *
 * If initialization fails, falls back to in-memory database and marks instance as degraded.
 *
 * Uses Promise-based caching to prevent race conditions when multiple concurrent
 * calls occur before the first one completes.
 */
export async function getDatabase(projectPath?: string): Promise<PGlite> {
  const dbPath = getDatabasePath(projectPath);

  // Return existing instance if available
  const existingDb = instances.get(dbPath);
  if (existingDb) {
    lastAccess.set(dbPath, Date.now());
    return existingDb;
  }

  // Return pending promise if initialization is in progress (fixes race condition)
  const pendingPromise = pendingInstances.get(dbPath);
  if (pendingPromise) {
    return pendingPromise;
  }

  // Create new initialization promise
  const initPromise = createDatabaseInstance(dbPath);
  pendingInstances.set(dbPath, initPromise);

  try {
    const db = await initPromise;
    instances.set(dbPath, db);
    lastAccess.set(dbPath, Date.now());
    return db;
  } finally {
    // Clean up pending promise once resolved/rejected
    pendingInstances.delete(dbPath);
  }
}

/**
 * Create and initialize a database instance
 *
 * Separated from getDatabase for cleaner Promise-based caching logic
 */
async function createDatabaseInstance(dbPath: string): Promise<PGlite> {
  // Evict LRU if cache is full
  evictLRU();

  debugLog("createDatabaseInstance called", { dbPath, cwd: process.cwd() });

  let db: PGlite;

  // Try to create new instance
  try {
    debugLog("Creating PGlite instance", { dbPath });
    db = new PGlite(dbPath);
    debugLog("PGlite instance created successfully");

    // Initialize schema if needed
    if (!schemaInitialized.get(dbPath)) {
      debugLog("Initializing schema");
      await initializeSchema(db);
      schemaInitialized.set(dbPath, true);
      debugLog("Schema initialized");
    }

    return db;
  } catch (error) {
    const err = error as Error;
    debugLog("Failed to initialize database", {
      dbPath,
      error: err.message,
      stack: err.stack,
    });
    console.error(
      `[swarm-mail] Failed to initialize database at ${dbPath}:`,
      err.message,
    );
    degradedInstances.set(dbPath, err);

    // Fall back to in-memory database
    console.warn(
      `[swarm-mail] Falling back to in-memory database (data will not persist)`,
    );

    try {
      db = new PGlite(); // in-memory mode

      // Initialize schema for in-memory instance
      await initializeSchema(db);
      schemaInitialized.set(dbPath, true);

      return db;
    } catch (fallbackError) {
      const fallbackErr = fallbackError as Error;
      console.error(
        `[swarm-mail] CRITICAL: In-memory fallback failed:`,
        fallbackErr.message,
      );
      throw new Error(
        `Database initialization failed: ${err.message}. Fallback also failed: ${fallbackErr.message}`,
      );
    }
  }
}

/**
 * Close a database instance
 */
export async function closeDatabase(projectPath?: string): Promise<void> {
  const dbPath = getDatabasePath(projectPath);
  const db = instances.get(dbPath);
  if (db) {
    await db.close();
    instances.delete(dbPath);
    pendingInstances.delete(dbPath);
    schemaInitialized.delete(dbPath);
    degradedInstances.delete(dbPath);
    lastAccess.delete(dbPath);
  }
}

/**
 * Close all database instances
 */
export async function closeAllDatabases(): Promise<void> {
  for (const [path, db] of instances) {
    await db.close();
    instances.delete(path);
    schemaInitialized.delete(path);
  }
  pendingInstances.clear();
  degradedInstances.clear();
  lastAccess.clear();
}

/**
 * Reset database for testing - clears all data but keeps schema
 */
export async function resetDatabase(projectPath?: string): Promise<void> {
  const db = await getDatabase(projectPath);
  await db.exec(`
    DELETE FROM message_recipients;
    DELETE FROM messages;
    DELETE FROM reservations;
    DELETE FROM agents;
    DELETE FROM events;
    DELETE FROM locks;
    DELETE FROM cursors;
  `);
}

// ============================================================================
// Schema Initialization
// ============================================================================

/**
 * Initialize the database schema
 *
 * Creates tables for:
 * - events: The append-only event log
 * - agents: Materialized view of registered agents
 * - messages: Materialized view of messages
 * - reservations: Materialized view of file reservations
 * - cursors, deferred: Effect-TS durable primitives (via migrations)
 * - locks: Distributed mutual exclusion (DurableLock)
 */
async function initializeSchema(db: PGlite): Promise<void> {
  // Create core event store tables
  await db.exec(`
    -- Events table: The source of truth (append-only)
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      project_key TEXT NOT NULL,
      timestamp BIGINT NOT NULL,
      sequence SERIAL,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Index for efficient queries
    CREATE INDEX IF NOT EXISTS idx_events_project_key ON events(project_key);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_project_type ON events(project_key, type);

    -- Agents materialized view (rebuilt from events)
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      name TEXT NOT NULL,
      program TEXT DEFAULT 'opencode',
      model TEXT DEFAULT 'unknown',
      task_description TEXT,
      registered_at BIGINT NOT NULL,
      last_active_at BIGINT NOT NULL,
      UNIQUE(project_key, name)
    );

    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_key);

    -- Messages materialized view
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      thread_id TEXT,
      importance TEXT DEFAULT 'normal',
      ack_required BOOLEAN DEFAULT FALSE,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_key);
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

    -- Message recipients (many-to-many)
    CREATE TABLE IF NOT EXISTS message_recipients (
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      read_at BIGINT,
      acked_at BIGINT,
      PRIMARY KEY(message_id, agent_name)
    );

    CREATE INDEX IF NOT EXISTS idx_recipients_agent ON message_recipients(agent_name);

    -- File reservations materialized view
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      path_pattern TEXT NOT NULL,
      exclusive BOOLEAN DEFAULT TRUE,
      reason TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      released_at BIGINT
    );

    CREATE INDEX IF NOT EXISTS idx_reservations_project ON reservations(project_key);
    CREATE INDEX IF NOT EXISTS idx_reservations_agent ON reservations(agent_name);
    CREATE INDEX IF NOT EXISTS idx_reservations_expires ON reservations(expires_at);
    CREATE INDEX IF NOT EXISTS idx_reservations_active ON reservations(project_key, released_at) WHERE released_at IS NULL;

    -- Locks table for distributed mutual exclusion (DurableLock)
    CREATE TABLE IF NOT EXISTS locks (
      resource TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      acquired_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_locks_holder ON locks(holder);
  `);

  // Run schema migrations for Effect-TS durable primitives (cursors, deferred)
  const { runMigrations } = await import("./migrations");
  await runMigrations(db);
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if the database is healthy
 *
 * Returns false if database is in degraded mode (using in-memory fallback)
 */
export async function isDatabaseHealthy(
  projectPath?: string,
): Promise<boolean> {
  const dbPath = getDatabasePath(projectPath);

  // Check if instance is degraded
  if (degradedInstances.has(dbPath)) {
    const err = degradedInstances.get(dbPath);
    console.error(
      `[swarm-mail] Database is in degraded mode (using in-memory fallback). Original error: ${err?.message}`,
    );
    return false;
  }

  try {
    const db = await getDatabase(projectPath);
    const result = await db.query("SELECT 1 as ok");
    return result.rows.length > 0;
  } catch (error) {
    const err = error as Error;
    console.error(`[swarm-mail] Health check failed: ${err.message}`);
    return false;
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(projectPath?: string): Promise<{
  events: number;
  agents: number;
  messages: number;
  reservations: number;
}> {
  const db = await getDatabase(projectPath);

  const [events, agents, messages, reservations] = await Promise.all([
    db.query<{ count: string }>("SELECT COUNT(*) as count FROM events"),
    db.query<{ count: string }>("SELECT COUNT(*) as count FROM agents"),
    db.query<{ count: string }>("SELECT COUNT(*) as count FROM messages"),
    db.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM reservations WHERE released_at IS NULL",
    ),
  ]);

  return {
    events: parseInt(events.rows[0]?.count || "0"),
    agents: parseInt(agents.rows[0]?.count || "0"),
    messages: parseInt(messages.rows[0]?.count || "0"),
    reservations: parseInt(reservations.rows[0]?.count || "0"),
  };
}

// ============================================================================
// Process Exit Handlers
// ============================================================================

/**
 * Close all databases on process exit
 */
function handleExit() {
  // Use sync version if available, otherwise fire-and-forget
  const dbsToClose = Array.from(instances.values());
  for (const db of dbsToClose) {
    try {
      // PGlite doesn't have a sync close, so we just attempt async
      db.close().catch(() => {
        // Ignore errors during shutdown
      });
    } catch {
      // Ignore errors
    }
  }
}

// Register exit handlers
process.on("exit", handleExit);
process.on("SIGINT", () => {
  handleExit();
  process.exit(0);
});
process.on("SIGTERM", () => {
  handleExit();
  process.exit(0);
});

// ============================================================================
// Exports
// ============================================================================

export { PGlite };
export * from "./agent-mail";
export * from "./debug";
export * from "./events";
export * from "./migrations";
export * from "./projections";
export * from "./store";
export * from "./swarm-mail";
