/**
 * PGLite Convenience Layer - Simple API for PGLite users
 *
 * This file provides a simplified interface for users who just want to use
 * PGLite without manually setting up adapters. For advanced use cases (custom
 * database, connection pooling, etc.), use createSwarmMailAdapter directly.
 *
 * ## Simple API (this file)
 * ```typescript
 * import { getSwarmMail } from '@opencode/swarm-mail';
 *
 * const swarmMail = await getSwarmMail('/path/to/project');
 * await swarmMail.registerAgent(projectKey, 'agent-name');
 * ```
 *
 * ## Advanced API (adapter pattern)
 * ```typescript
 * import { createSwarmMailAdapter } from '@opencode/swarm-mail';
 * import { createCustomDbAdapter } from './my-adapter';
 *
 * const db = createCustomDbAdapter({ path: './custom.db' });
 * const swarmMail = createSwarmMailAdapter(db, '/path/to/project');
 * ```
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createSwarmMailAdapter } from "./adapter";
import { healthCheck, isDaemonRunning, startDaemon, cleanupPidFile, readPidFile } from "./daemon";
import { createSocketAdapter } from "./socket-adapter";
import type { DatabaseAdapter, SwarmMailAdapter } from "./types";

/**
 * Get WAL directory size and file count
 *
 * Recursively scans pg_wal directory to count files and total size.
 * Returns 0 for both if dataDir is not set (in-memory) or pg_wal doesn't exist.
 *
 * @param dataDir - PGLite data directory path
 * @returns Total size in bytes and file count
 */
function getWalDirectoryStats(dataDir?: string): {
	walSize: number;
	walFileCount: number;
} {
	if (!dataDir || dataDir === "memory://") {
		// In-memory database has no WAL files
		return { walSize: 0, walFileCount: 0 };
	}

	const walDir = join(dataDir, "pg_wal");

	if (!existsSync(walDir)) {
		return { walSize: 0, walFileCount: 0 };
	}

	let totalSize = 0;
	let fileCount = 0;

	try {
		const files = readdirSync(walDir);

		for (const file of files) {
			const filePath = join(walDir, file);
			try {
				const stats = statSync(filePath);
				if (stats.isFile()) {
					totalSize += stats.size;
					fileCount++;
				}
			} catch {
				// Skip files we can't stat (permissions, etc.)
				continue;
			}
		}
	} catch {
		// Directory read failed - return zeros
		return { walSize: 0, walFileCount: 0 };
	}

	return { walSize: totalSize, walFileCount: fileCount };
}

/**
 * Wrap PGLite to match DatabaseAdapter interface
 *
 * PGLite has query() and exec() methods that match DatabaseAdapter,
 * but TypeScript needs the explicit wrapper for type safety.
 * PGLite's exec() returns Results[] but DatabaseAdapter expects void.
 */
export function wrapPGlite(pglite: PGlite): DatabaseAdapter {
	return {
		query: <T>(sql: string, params?: unknown[]) =>
			pglite.query<T>(sql, params),
		exec: async (sql: string) => {
			await pglite.exec(sql);
		},
		close: () => pglite.close(),
		checkpoint: async () => {
			await pglite.query("CHECKPOINT");
		},
		getWalStats: async () => {
			// PGLite stores dataDir as a property on the instance
			// Access via type assertion since it's not in TypeScript types
			const dataDir = (pglite as { dataDir?: string }).dataDir;
			return getWalDirectoryStats(dataDir);
		},
		checkWalHealth: async (thresholdMb = 100) => {
			const dataDir = (pglite as { dataDir?: string }).dataDir;
			const { walSize, walFileCount } = getWalDirectoryStats(dataDir);

			const walSizeMb = walSize / 1024 / 1024;
			const healthy = walSizeMb < thresholdMb;

			let message: string;
			if (healthy) {
				message = `WAL healthy: ${walSizeMb.toFixed(2)}MB (${walFileCount} files), threshold: ${thresholdMb}MB`;
			} else {
				message = `WAL size ${walSizeMb.toFixed(2)}MB (${walFileCount} files) exceeds threshold ${thresholdMb}MB. Consider running checkpoint().`;
			}

			return { healthy, message };
		},
	};
}

/**
 * Generate a short hash for a project path
 *
 * Uses SHA256 and takes first 8 characters for uniqueness.
 *
 * @param projectPath - Project root path
 * @returns 8-character hash string
 */
export function hashProjectPath(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 8);
}

/**
 * Get a human-readable project identifier with hash suffix
 *
 * Format: `opencode-<project-name>-<hash>`
 * Example: `opencode-my-project-a1b2c3d4`
 *
 * @param projectPath - Project root path
 * @returns Directory name for the project's temp storage
 */
export function getProjectTempDirName(projectPath: string): string {
  const projectName = basename(projectPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // sanitize for filesystem
    .replace(/-+/g, "-") // collapse multiple dashes
    .slice(0, 32); // limit length
  const hash = hashProjectPath(projectPath);
  return `opencode-${projectName}-${hash}`;
}

/**
 * Get database path in $TMPDIR (ephemeral storage)
 *
 * Streams data is ephemeral coordination state - messages, reservations,
 * agent registrations. It's safe to lose on reboot since:
 * - Beads are git-synced separately in .beads/
 * - Semantic memory is in ~/.opencode/memory/
 * - Agents re-register on session start
 *
 * Path format: `$TMPDIR/opencode-<project-name>-<hash>/streams`
 * Falls back to global `$TMPDIR/opencode-global/streams` if no project path.
 *
 * @param projectPath - Optional project root path
 * @returns Absolute path to database directory
 */
export function getDatabasePath(projectPath?: string): string {
  const tmp = tmpdir();
  
  if (projectPath) {
    const dirName = getProjectTempDirName(projectPath);
    const projectTmpDir = join(tmp, dirName);
    if (!existsSync(projectTmpDir)) {
      mkdirSync(projectTmpDir, { recursive: true });
    }
    return join(projectTmpDir, "streams");
  }
  
  // Global fallback for when no project path is provided
  const globalTmpDir = join(tmp, "opencode-global");
  if (!existsSync(globalTmpDir)) {
    mkdirSync(globalTmpDir, { recursive: true });
  }
  return join(globalTmpDir, "streams");
}

/**
 * Singleton cache for SwarmMail instances
 *
 * Key is database path, value is the adapter + PGLite instance (or socket adapter)
 */
const instances = new Map<
  string,
  { adapter: SwarmMailAdapter; pglite?: PGlite; isSocket?: boolean }
>();

/**
 * Promise cache for in-flight initializations
 *
 * Prevents race conditions when multiple callers try to initialize the same database.
 */
const initPromises = new Map<string, Promise<SwarmMailAdapter>>();

/**
 * Format an error for display in error messages
 *
 * Handles Error objects, strings, and arbitrary values.
 * For objects, attempts JSON serialization with property names.
 *
 * @param error - The error to format
 * @returns Formatted error string
 */
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  } catch {
    return String(error);
  }
}

/**
 * Check if an error is a WASM abort error from PGLite
 *
 * These errors occur when:
 * - A stale postmaster.pid file exists from a crashed session
 * - The database directory is corrupted
 * - WASM memory is in an invalid state
 *
 * @param error - The error to check
 * @returns true if this is a recoverable WASM abort error
 */
function isWasmAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("aborted") ||
      message.includes("unreachable code") ||
      message.includes("runtimeerror")
    );
  }
  return false;
}

/**
 * Create a PGLite instance with automatic recovery from corrupted databases
 *
 * If PGLite fails to initialize due to WASM abort (usually from stale postmaster.pid),
 * this function will:
 * 1. Delete the corrupted database directory
 * 2. Retry creating a fresh PGLite instance
 *
 * This is safe because the streams database is ephemeral coordination state.
 * Persistent data (beads, semantic memory) is stored elsewhere.
 *
 * @param dbPath - Path to the database directory
 * @returns PGLite instance
 * @throws Error if recovery also fails
 */
async function createPGliteWithRecovery(dbPath: string): Promise<PGlite> {
  try {
    const pglite = await PGlite.create({
      dataDir: dbPath,
      extensions: { vector },
    });
    // PGLite initialization is lazy - force it to actually connect
    // by running a simple query. This surfaces WASM errors early.
    await pglite.query("SELECT 1");
    return pglite;
  } catch (error) {
    if (isWasmAbortError(error)) {
      console.warn(
        `[swarm-mail] PGLite WASM abort detected, recovering by deleting corrupted database: ${dbPath}`
      );

      // Delete the corrupted database directory
      // Before deletion, check if another process already cleaned up
      if (!existsSync(dbPath)) {
        console.log("[swarm-mail] Database already cleaned up by another process");
        // Proceed to create fresh instance
      } else {
        rmSync(dbPath, { recursive: true, force: true });
      }

      // Retry with fresh database
      try {
        const pglite = await PGlite.create({
          dataDir: dbPath,
          extensions: { vector },
        });
        await pglite.query("SELECT 1");
        console.log(`[swarm-mail] Successfully recovered from corrupted database: ${dbPath}`);
        return pglite;
      } catch (retryError) {
        throw new Error(
          `Failed to recover PGLite database after deleting corrupted data: ${formatError(retryError)}`
        );
      }
    }

    // Not a WASM abort error - rethrow
    throw error;
  }
}

/**
 * Get or create SwarmMail instance for a project
 *
 * Uses singleton pattern - one instance per database path.
 * Safe to call multiple times for the same project.
 *
 * **Socket Mode (default):**
 * - Checks if daemon is running, starts if needed
 * - Validates health before connecting
 * - Falls back to embedded PGLite on any failure
 * - Set `SWARM_MAIL_SOCKET=false` to opt out
 *
 * **Embedded Mode (opt-out with SWARM_MAIL_SOCKET=false):**
 * - Uses embedded PGLite database
 * - No daemon required
 * - Only use for single-process scenarios
 *
 * @param projectPath - Optional project root path (defaults to global)
 * @returns SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * // Project-local database (daemon mode by default)
 * const swarmMail = await getSwarmMail('/path/to/project');
 *
 * // Opt out of daemon mode (embedded PGLite)
 * process.env.SWARM_MAIL_SOCKET = 'false';
 * const swarmMail = await getSwarmMail('/path/to/project');
 *
 * // Global database (shared across all projects)
 * const swarmMail = await getSwarmMail();
 * ```
 */
export async function getSwarmMail(
  projectPath?: string,
): Promise<SwarmMailAdapter> {
  const dbPath = getDatabasePath(projectPath);
  const projectKey = projectPath || dbPath;

  // Return existing instance
  if (instances.has(dbPath)) {
    return instances.get(dbPath)!.adapter;
  }

  // Return in-flight initialization
  if (initPromises.has(dbPath)) {
    return initPromises.get(dbPath)!;
  }

  // Start new initialization
  const initPromise = (async () => {
    // Check for socket mode via env var (default is socket, opt-out with 'false')
    const useSocket = process.env.SWARM_MAIL_SOCKET !== 'false';

    if (useSocket) {
      try {
        // Try socket mode with auto-daemon management
        console.log('[swarm-mail] Using daemon mode (set SWARM_MAIL_SOCKET=false for embedded)');
        const adapter = await getSwarmMailSocketInternal(projectPath);
        instances.set(dbPath, { adapter, isSocket: true });
        return adapter;
      } catch (error) {
        console.warn(
          `[swarm-mail] Socket mode failed, falling back to embedded PGLite: ${error instanceof Error ? error.message : String(error)}`
        );
        // Fall through to embedded mode
      }
    }

    // Embedded PGlite mode (opt-out or fallback)
    // Use recovery wrapper to handle corrupted databases from crashed sessions
    console.log('[swarm-mail] Using embedded mode (unset SWARM_MAIL_SOCKET to use daemon)');
    const pglite = await createPGliteWithRecovery(dbPath);
    const db = wrapPGlite(pglite);
    const adapter = createSwarmMailAdapter(db, projectKey);
    await adapter.runMigrations();
    instances.set(dbPath, { adapter, pglite });
    return adapter;
  })();

  initPromises.set(dbPath, initPromise);

  try {
    const adapter = await initPromise;
    return adapter;
  } finally {
    initPromises.delete(dbPath);
  }
}

/**
 * Get SwarmMail instance using socket adapter (explicit socket mode)
 *
 * Always uses socket connection to pglite-server daemon.
 * Auto-starts daemon if not running, validates health before connecting.
 *
 * **Port/Path Resolution:**
 * - Checks SWARM_MAIL_SOCKET_PATH env var for Unix socket
 * - Falls back to TCP on SWARM_MAIL_SOCKET_PORT (default: 15433)
 * - Host defaults to 127.0.0.1
 *
 * @param projectPath - Optional project root path
 * @returns SwarmMailAdapter instance using socket connection
 * @throws Error if daemon fails to start or health check fails
 *
 * @example
 * ```typescript
 * // Unix socket (preferred)
 * process.env.SWARM_MAIL_SOCKET_PATH = '/tmp/swarm-mail.sock';
 * const swarmMail = await getSwarmMailSocket('/path/to/project');
 *
 * // TCP socket
 * process.env.SWARM_MAIL_SOCKET_PORT = '15433';
 * const swarmMail = await getSwarmMailSocket('/path/to/project');
 * ```
 */
export async function getSwarmMailSocket(
  projectPath?: string,
): Promise<SwarmMailAdapter> {
  const dbPath = getDatabasePath(projectPath);

  if (!instances.has(dbPath)) {
    const adapter = await getSwarmMailSocketInternal(projectPath);
    instances.set(dbPath, { adapter, isSocket: true });
  }

  return instances.get(dbPath)!.adapter;
}

/**
 * Internal helper for socket mode setup with self-healing
 *
 * Implements robust connection logic:
 * 1. Try health check FIRST (daemon might already be running)
 * 2. If unhealthy, check for stale PID and clean up
 * 3. Try to start daemon with retry on EADDRINUSE
 * 4. Final health check before connecting
 *
 * This prevents the "Failed to listen" error when daemon is already running
 * but PID check failed.
 *
 * @param projectPath - Optional project root path
 * @returns SwarmMailAdapter instance
 * @throws Error if daemon management or connection fails after retries
 */
async function getSwarmMailSocketInternal(
  projectPath?: string,
): Promise<SwarmMailAdapter> {
  const projectKey = projectPath || getDatabasePath(projectPath);
  const dbPath = getDatabasePath(projectPath);

  // Resolve socket path or port from env
  const socketPath = process.env.SWARM_MAIL_SOCKET_PATH;
  const port = process.env.SWARM_MAIL_SOCKET_PORT
    ? Number.parseInt(process.env.SWARM_MAIL_SOCKET_PORT, 10)
    : 15433;
  const host = process.env.SWARM_MAIL_SOCKET_HOST || '127.0.0.1';
  const healthOptions = socketPath ? { path: socketPath } : { port, host };

  // 1. Try health check FIRST - daemon might already be running
  if (await healthCheck(healthOptions)) {
    console.log('[swarm-mail] Daemon already healthy, connecting...');
    const adapterOptions = socketPath ? { path: socketPath } : { host, port };
    const db = await createSocketAdapter(adapterOptions);
    const adapter = createSwarmMailAdapter(db, projectKey);
    await adapter.runMigrations();
    return adapter;
  }

  // 2. Check for stale PID and clean up
  const pid = await readPidFile(projectPath);
  if (pid) {
    try {
      process.kill(pid, 0); // Check if process alive
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === 'ESRCH') {
        // Process doesn't exist - clean up stale PID
        console.log(`[swarm-mail] Cleaning up stale PID file (dead process ${pid})`);
        await cleanupPidFile(projectPath);
      }
    }
  }

  // 3. Try to start daemon with retry
  const daemonOptions = socketPath
    ? { path: socketPath, dbPath, projectPath }
    : { port, host, dbPath, projectPath };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await startDaemon(daemonOptions);
      break;
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      if (err.message?.includes('EADDRINUSE') || err.message?.includes('Failed to listen') || err.code === 'EADDRINUSE') {
        // Port busy - maybe another process started daemon, wait and check health
        console.log(`[swarm-mail] Port busy on attempt ${attempt + 1}, checking if daemon is healthy...`);
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        
        if (await healthCheck(healthOptions)) {
          console.log('[swarm-mail] Daemon started by another process, connecting...');
          break;
        }
      } else {
        // Not a port conflict error - rethrow
        throw error;
      }
    }
  }

  // 4. Final health check
  if (!await healthCheck(healthOptions)) {
    throw new Error(
      `Failed to start or connect to daemon after retries (${socketPath ? `socket: ${socketPath}` : `TCP: ${host}:${port}`})`
    );
  }

  // Create socket adapter
  const adapterOptions = socketPath
    ? { path: socketPath }
    : { host, port };

  const db = await createSocketAdapter(adapterOptions);
  const adapter = createSwarmMailAdapter(db, projectKey);
  await adapter.runMigrations();

  return adapter;
}

/**
 * Create in-memory SwarmMail instance (for testing)
 *
 * Not cached - each call creates a new instance.
 * Data is lost when instance is closed or process exits.
 *
 * @param projectKey - Project identifier (defaults to 'test')
 * @returns SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * const swarmMail = await createInMemorySwarmMail('test-project');
 * await swarmMail.registerAgent('test-project', 'test-agent');
 * // ... test code ...
 * await swarmMail.close();
 * ```
 */
export async function createInMemorySwarmMail(
  projectKey = "test",
): Promise<SwarmMailAdapter> {
  const pglite = await PGlite.create({
    extensions: { vector },
  }); // in-memory with vector extension
  const db = wrapPGlite(pglite);
  const adapter = createSwarmMailAdapter(db, projectKey);
  await adapter.runMigrations();
  return adapter;
}

/**
 * Close specific SwarmMail instance
 *
 * Closes the database connection and removes from cache.
 *
 * @param projectPath - Optional project root path (defaults to global)
 *
 * @example
 * ```typescript
 * await closeSwarmMail('/path/to/project');
 * ```
 */
export async function closeSwarmMail(projectPath?: string): Promise<void> {
  const dbPath = getDatabasePath(projectPath);
  const instance = instances.get(dbPath);
  if (instance) {
    if (instance.pglite) {
      await instance.pglite.close();
    } else {
      // Socket adapter - close via adapter's close method
      await instance.adapter.close();
    }
    instances.delete(dbPath);
  }
}

/**
 * Close all SwarmMail instances
 *
 * Closes all cached database connections.
 * Useful for cleanup in test teardown or process shutdown.
 *
 * @example
 * ```typescript
 * // Test teardown
 * afterAll(async () => {
 *   await closeAllSwarmMail();
 * });
 * ```
 */
export async function closeAllSwarmMail(): Promise<void> {
  for (const [path, instance] of instances) {
    if (instance.pglite) {
      await instance.pglite.close();
    } else {
      // Socket adapter - close via adapter's close method
      await instance.adapter.close();
    }
    instances.delete(path);
  }
}

// Re-export PGlite for consumers who need it
export { PGlite };
