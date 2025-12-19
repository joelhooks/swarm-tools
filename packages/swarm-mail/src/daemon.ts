/**
 * Daemon Lifecycle Management for PGLiteSocketServer
 *
 * Provides start/stop/health functionality for in-process PGLiteSocketServer.
 * Uses module-level state to track active server instance.
 *
 * ## Usage
 * ```typescript
 * import { startDaemon, stopDaemon, isDaemonRunning, healthCheck } from 'swarm-mail/daemon';
 *
 * // Start daemon
 * const { pid, port } = await startDaemon({ port: 15433 });
 *
 * // Check health
 * const healthy = await healthCheck({ port: 15433 });
 *
 * // Stop daemon
 * await stopDaemon('/path/to/project');
 * ```
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { getDatabasePath, getProjectTempDirName } from "./pglite";

/**
 * Module-level state tracking for active in-process server
 *
 * The daemon runs in-process using PGLiteSocketServer, not as external process.
 * This state tracks the active server instance to support:
 * - Server reuse (same project calling startDaemon multiple times)
 * - Graceful shutdown (CHECKPOINT → stop → close)
 * - Multi-project isolation (different projects get different servers)
 *
 * @internal
 */
let activeServer: PGLiteSocketServer | null = null;

/**
 * Active PGlite database instance
 * @internal
 */
let activeDb: PGlite | null = null;

/**
 * Project path for the active server (used for reuse detection)
 * @internal
 */
let activeProjectPath: string | undefined = undefined;

/**
 * Daemon start options
 */
export interface DaemonOptions {
  /** TCP port to bind (default: 15433) */
  port?: number;
  /** Host to bind (default: 127.0.0.1) */
  host?: string;
  /** Unix socket path (alternative to port/host) */
  path?: string;
  /** Database path (default: project .opencode/streams or ~/.opencode/streams) */
  dbPath?: string;
  /** Project path for PID file location (default: global ~/.opencode) */
  projectPath?: string;
}

/**
 * Daemon info returned by startDaemon
 */
export interface DaemonInfo {
  /** Process ID */
  pid: number;
  /** TCP port (if using TCP) */
  port?: number;
  /** Unix socket path (if using socket) */
  socketPath?: string;
}

/**
 * Get PID file path for a project
 *
 * Stores PID file in $TMPDIR alongside the streams database.
 * Path format: `$TMPDIR/opencode-<project-name>-<hash>/pglite-server.pid`
 * Falls back to global `$TMPDIR/opencode-global/pglite-server.pid`
 *
 * @param projectPath - Optional project root path
 * @returns Absolute path to PID file
 */
export function getPidFilePath(projectPath?: string): string {
  const tmp = tmpdir();
  
  if (projectPath) {
    const dirName = getProjectTempDirName(projectPath);
    const projectTmpDir = join(tmp, dirName);
    if (!existsSync(projectTmpDir)) {
      mkdirSync(projectTmpDir, { recursive: true });
    }
    return join(projectTmpDir, "pglite-server.pid");
  }
  
  // Global fallback
  const globalTmpDir = join(tmp, "opencode-global");
  if (!existsSync(globalTmpDir)) {
    mkdirSync(globalTmpDir, { recursive: true });
  }
  return join(globalTmpDir, "pglite-server.pid");
}

/**
 * Check if a process is alive
 *
 * Uses kill(pid, 0) which checks if process exists without sending a signal.
 *
 * @param pid - Process ID to check
 * @returns true if process is running
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return false; // No such process
    }
    // EPERM means process exists but we don't have permission to signal it
    // Still counts as "alive" for our purposes
    return true;
  }
}

/**
 * Read PID from PID file
 *
 * @param projectPath - Optional project root path
 * @returns Process ID, or null if file doesn't exist or is invalid
 */
export async function readPidFile(projectPath?: string): Promise<number | null> {
  const pidFilePath = getPidFilePath(projectPath);
  if (!existsSync(pidFilePath)) {
    return null;
  }
  try {
    const content = await readFile(pidFilePath, "utf-8");
    const pid = Number.parseInt(content.trim(), 10);
    if (Number.isNaN(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/**
 * Write PID to PID file
 *
 * @param pid - Process ID
 * @param projectPath - Optional project root path
 */
async function writePidFile(pid: number, projectPath?: string): Promise<void> {
  const pidFilePath = getPidFilePath(projectPath);
  await writeFile(pidFilePath, pid.toString(), "utf-8");
}

/**
 * Delete PID file
 *
 * @param projectPath - Optional project root path
 */
async function deletePidFile(projectPath?: string): Promise<void> {
  const pidFilePath = getPidFilePath(projectPath);
  try {
    await unlink(pidFilePath);
  } catch {
    // Ignore errors - file may not exist
  }
}

/**
 * Clean up stale PID file
 *
 * Removes PID file if it points to a dead process or doesn't exist.
 * Used for self-healing when daemon startup fails due to stale state.
 *
 * @param projectPath - Optional project root path
 *
 * @example
 * ```typescript
 * // Clean up before starting daemon
 * await cleanupPidFile('/path/to/project');
 * await startDaemon({ port: 15433, projectPath: '/path/to/project' });
 * ```
 */
export async function cleanupPidFile(projectPath?: string): Promise<void> {
  const pid = await readPidFile(projectPath);
  if (!pid || !isProcessAlive(pid)) {
    await deletePidFile(projectPath);
  }
}

/**
 * Wait for condition with timeout
 *
 * Polls a condition function until it returns true or timeout is reached.
 *
 * @param condition - Async function that returns true when ready
 * @param timeoutMs - Maximum wait time in milliseconds
 * @param intervalMs - Polling interval in milliseconds
 * @returns true if condition met, false if timeout
 */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/**
 * Check if daemon is running
 *
 * Checks both PID file existence and process liveness.
 *
 * @param projectPath - Optional project root path
 * @returns true if daemon is running
 *
 * @example
 * ```typescript
 * if (!await isDaemonRunning()) {
 *   await startDaemon();
 * }
 * ```
 */
export async function isDaemonRunning(projectPath?: string): Promise<boolean> {
  const pid = await readPidFile(projectPath);
  if (!pid) {
    return false;
  }
  return isProcessAlive(pid);
}

/**
 * Health check - verify daemon is responding
 *
 * Connects to the daemon and runs SELECT 1 query.
 * Times out after 5 seconds.
 *
 * @param options - Connection options (port/host or path)
 * @returns true if daemon is healthy
 *
 * @example
 * ```typescript
 * const healthy = await healthCheck({ port: 5433 });
 * if (!healthy) {
 *   console.error('Daemon not responding');
 * }
 * ```
 */
export async function healthCheck(
  options: Pick<DaemonOptions, "port" | "host" | "path">,
): Promise<boolean> {
  try {
    // Dynamic import to avoid bundling postgres.js in library consumers
    const postgres = await import("postgres").then((m) => m.default);

   const sql = options.path
     ? postgres({ path: options.path })
     : postgres({
         host: options.host || "127.0.0.1",
         port: options.port || 15433,
         max: 1, // Single connection for health check
       });

    try {
      await Promise.race([
        sql`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), 5000),
        ),
      ]);
      return true;
    } finally {
      await sql.end();
    }
  } catch {
    return false;
  }
}

/**
 * Start PGLiteSocketServer daemon in-process
 *
 * Creates PGlite instance and starts PGLiteSocketServer.
 * Writes PID file and waits for server to be ready via health check.
 *
 * If daemon is already running, returns existing daemon info.
 *
 * @param options - Daemon configuration
 * @returns Daemon info (PID and connection details)
 * @throws Error if daemon fails to start
 *
 * @example
 * ```typescript
 * // Start with TCP port
 * const { pid, port } = await startDaemon({ port: 15433 });
 *
 * // Start with Unix socket
 * const { pid, socketPath } = await startDaemon({
 *   path: '/tmp/swarm-mail-pglite.sock'
 * });
 *
 * // Start with custom database path
 * const { pid, port } = await startDaemon({
 *   port: 15433,
 *   dbPath: '/custom/path/to/db'
 * });
 * ```
 */
export async function startDaemon(
  options: DaemonOptions = {},
): Promise<DaemonInfo> {
  const { port = 15433, host = "127.0.0.1", path, dbPath, projectPath } = options;

  // Check if daemon is already running (active server or PID file)
  if (activeServer && activeProjectPath === projectPath) {
    return {
      pid: process.pid,
      port: path ? undefined : port,
      socketPath: path,
    };
  }

  if (await isDaemonRunning(projectPath)) {
    const pid = await readPidFile(projectPath);
    if (!pid) {
      throw new Error("Daemon appears to be running but PID file is invalid");
    }
    return {
      pid,
      port: path ? undefined : port,
      socketPath: path,
    };
  }
  
  // Health check BEFORE starting - detect if port/socket already in use by another daemon
  const healthOptions = path ? { path } : { port, host };
  if (await healthCheck(healthOptions)) {
    // Port/socket is in use and healthy - probably started by another process/project
    // This is not an error - just means we can connect to it
    console.log(`[daemon] Port/socket already in use and healthy, assuming external daemon`);
    // Return info indicating external daemon (PID unknown)
    return {
      pid: process.pid, // Return current process PID since we can't know the real one
      port: path ? undefined : port,
      socketPath: path,
    };
  }

  // Determine database path
  const finalDbPath = dbPath || getDatabasePath(projectPath);

  // Create PGlite instance with vector extension
  const db = await PGlite.create({
    dataDir: finalDbPath,
    extensions: { vector },
  });

  // Create and start PGLiteSocketServer
  const server = path
    ? new PGLiteSocketServer({ db, path })
    : new PGLiteSocketServer({ db, port, host });

  await server.start();

  // Store module-level state
  activeServer = server;
  activeDb = db;
  activeProjectPath = projectPath;

  // Write PID file (use current process PID since it's in-process)
  await writePidFile(process.pid, projectPath);

  // Wait for server to be ready (health check - reuse healthOptions from above)
  const ready = await waitFor(
    () => healthCheck(healthOptions),
    10000, // 10 second timeout
  );

  if (!ready) {
    // Clean up if health check fails
    await server.stop();
    await db.close();
    activeServer = null;
    activeDb = null;
    activeProjectPath = undefined;
    await deletePidFile(projectPath);
    throw new Error(
      "PGLiteSocketServer failed to start - health check timeout after 10s",
    );
  }

  return {
    pid: process.pid,
    port: path ? undefined : port,
    socketPath: path,
  };
}

/**
 * Stop PGLiteSocketServer daemon
 *
 * Performs graceful shutdown: CHECKPOINT → server.stop() → db.close()
 * Cleans up PID file and module-level state.
 *
 * If daemon is not running, this is a no-op (not an error).
 *
 * @param projectPath - Optional project root path
 *
 * @example
 * ```typescript
 * await stopDaemon('/path/to/project');
 * ```
 */
export async function stopDaemon(projectPath?: string): Promise<void> {
  // If active server is for this project, stop it directly
  if (activeServer && activeProjectPath === projectPath) {
    try {
      // MANDATORY: CHECKPOINT before close to flush WAL
      if (activeDb) {
        await activeDb.exec("CHECKPOINT");
      }
      await activeServer.stop();
      if (activeDb) {
        await activeDb.close();
      }
    } catch (error) {
      // Log but don't throw - cleanup should be best-effort
      console.error("Error stopping daemon:", error);
    } finally {
      // Clean up module state
      activeServer = null;
      activeDb = null;
      activeProjectPath = undefined;
      await deletePidFile(projectPath);
    }
    return;
  }

  // Check if PID file exists but server is not active (stale state)
  const pid = await readPidFile(projectPath);
  if (!pid) {
    // No PID file - daemon not running
    return;
  }

  // If PID is current process but server is not active, just clean up
  if (pid === process.pid) {
    await deletePidFile(projectPath);
    return;
  }

  // If PID is different process, check if it's alive
  if (!isProcessAlive(pid)) {
    // Process already dead - just clean up PID file
    await deletePidFile(projectPath);
    return;
  }

  // External process still alive - this shouldn't happen with in-process server
  // but handle gracefully for migration scenarios
  console.warn(
    `PID file points to external process ${pid}, cleaning up file only`,
  );
  await deletePidFile(projectPath);
}
