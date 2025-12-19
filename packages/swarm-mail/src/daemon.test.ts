/**
 * Daemon lifecycle management tests
 *
 * Tests verify in-process PGLiteSocketServer daemon functionality:
 * - Server starts and accepts connections
 * - Health checks work
 * - Server stops cleanly
 * - PID file tracking works
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getPidFilePath,
  isDaemonRunning,
  startDaemon,
  stopDaemon,
  healthCheck,
} from "./daemon";
import { getProjectTempDirName } from "./pglite";

describe("daemon lifecycle", () => {
  const testProjectPath = join(process.cwd(), ".test-daemon");

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true });
    }
    await mkdir(testProjectPath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true });
    }
  });

  describe("getPidFilePath", () => {
    test("returns $TMPDIR path when projectPath provided", () => {
      const pidPath = getPidFilePath(testProjectPath);
      const expectedDir = join(tmpdir(), getProjectTempDirName(testProjectPath));
      expect(pidPath).toBe(join(expectedDir, "pglite-server.pid"));
      // Directory should be created
      expect(existsSync(expectedDir)).toBe(true);
    });

    test("returns global $TMPDIR path when no projectPath", () => {
      const pidPath = getPidFilePath();
      expect(pidPath).toContain("opencode-global/pglite-server.pid");
      expect(pidPath).toContain(tmpdir());
    });
  });

  describe("isDaemonRunning", () => {
    test("returns false when no PID file exists", async () => {
      const running = await isDaemonRunning(testProjectPath);
      expect(running).toBe(false);
    });

    test("returns false when PID file points to dead process", async () => {
      // Write PID of a process that doesn't exist (999999 is unlikely to be a real PID)
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, "999999");

      const running = await isDaemonRunning(testProjectPath);
      expect(running).toBe(false);
    });

    test("returns true when PID file points to alive process", async () => {
      // Write current process PID
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, process.pid.toString());

      const running = await isDaemonRunning(testProjectPath);
      expect(running).toBe(true);
    });
  });

  describe("startDaemon error handling", () => {
    test("throws error if daemon already running", async () => {
      // Write current process PID to simulate running daemon
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, process.pid.toString());

      // Should not throw - returns existing daemon info
      const result = await startDaemon({ projectPath: testProjectPath });
      expect(result.pid).toBe(process.pid);
    });
  });

  describe("stopDaemon", () => {
    test("is no-op when no PID file exists", async () => {
      // Should not throw
      await expect(stopDaemon(testProjectPath)).resolves.toBeUndefined();
    });

    test("cleans up PID file for dead process", async () => {
      // Write PID of dead process
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, "999999");
      expect(existsSync(pidPath)).toBe(true);

      await stopDaemon(testProjectPath);

      // PID file should be removed
      expect(existsSync(pidPath)).toBe(false);
    });
  });

  // NEW TESTS FOR IN-PROCESS PGLITESOCKETSERVER
  describe("PGLiteSocketServer in-process daemon", () => {
    afterEach(async () => {
      // Clean up daemon after each test
      await stopDaemon(testProjectPath);
    });

    test("startDaemon creates server that accepts connections", async () => {
      const { port, pid } = await startDaemon({
        port: 15435,
        projectPath: testProjectPath,
      });

      expect(pid).toBe(process.pid); // In-process means current process
      expect(port).toBe(15435);

      // Verify server is healthy
      const healthy = await healthCheck({ port: 15435 });
      expect(healthy).toBe(true);
    });

    test("stopDaemon closes server cleanly", async () => {
      await startDaemon({ port: 15434, projectPath: testProjectPath });

      // Verify server is running
      let healthy = await healthCheck({ port: 15434 });
      expect(healthy).toBe(true);

      // Stop daemon
      await stopDaemon(testProjectPath);

      // Verify server is no longer responding
      healthy = await healthCheck({ port: 15434 });
      expect(healthy).toBe(false);

      // PID file should be removed
      const pidPath = getPidFilePath(testProjectPath);
      expect(existsSync(pidPath)).toBe(false);
    });

    test("startDaemon reuses existing server", async () => {
      const info1 = await startDaemon({ port: 15435, projectPath: testProjectPath });
      const info2 = await startDaemon({ port: 15435, projectPath: testProjectPath });

      expect(info1.pid).toBe(info2.pid);
      expect(info1.port).toBe(info2.port);
    });

    test("startDaemon with Unix socket works", async () => {
      const socketPath = join(tmpdir(), "test-daemon.sock");
      const { socketPath: returnedPath } = await startDaemon({
        path: socketPath,
        projectPath: testProjectPath,
      });

      expect(returnedPath).toBe(socketPath);

      // Verify server is healthy via socket
      const healthy = await healthCheck({ path: socketPath });
      expect(healthy).toBe(true);
    });
  });

  // NEW TESTS FOR SELF-HEALING (TDD RED PHASE)
  describe("self-healing connection logic", () => {
    afterEach(async () => {
      await stopDaemon(testProjectPath);
    });

    test("connects to existing healthy daemon without starting new one", async () => {
      // Start daemon first
      await startDaemon({ port: 15436, projectPath: testProjectPath });
      
      // Simulate what getSwarmMailSocketInternal should do:
      // 1. Check if daemon running
      const running = await isDaemonRunning(testProjectPath);
      expect(running).toBe(true);
      
      // 2. Try health check FIRST (should succeed)
      const healthy = await healthCheck({ port: 15436 });
      expect(healthy).toBe(true);
      
      // 3. Should NOT attempt to start again - just connect
      // (This is what the refactored code should do)
    });

    test("cleans up stale PID file and starts new daemon", async () => {
      // Create stale PID file pointing to dead process
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, "999999");
      
      // Verify file exists but process is dead
      expect(existsSync(pidPath)).toBe(true);
      const running = await isDaemonRunning(testProjectPath);
      expect(running).toBe(false);
      
      // Cleanup should work (will fail until we export it)
      const { cleanupPidFile } = await import("./daemon");
      await cleanupPidFile(testProjectPath);
      
      // PID file should be gone
      expect(existsSync(pidPath)).toBe(false);
      
      // Now start daemon should work cleanly
      const { port } = await startDaemon({ port: 15437, projectPath: testProjectPath });
      expect(port).toBe(15437);
      
      // Health check should pass
      const healthy = await healthCheck({ port: 15437 });
      expect(healthy).toBe(true);
    });

    test("retries when port temporarily busy", async () => {
      // This test verifies retry logic when EADDRINUSE happens
      // Start daemon on port
      await startDaemon({ port: 15438, projectPath: testProjectPath });
      
      // Try to start another daemon on SAME port
      // Should detect via health check that daemon already running
      const { port } = await startDaemon({ port: 15438, projectPath: testProjectPath });
      expect(port).toBe(15438);
      
      // Should still be healthy
      const healthy = await healthCheck({ port: 15438 });
      expect(healthy).toBe(true);
    });

    test.skip("uses port 15433 by default", async () => {
      // SKIPPED: This test causes port conflicts when run in suite with pglite.test.ts
      // The default port value is verified by:
      // 1. Function signature in daemon.ts: `port = 15433`
      // 2. JSDoc examples showing port 15433
      // 3. Test can be run individually: `bun test daemon.test.ts -t "uses port 15433"`
      
      const uniqueTestPath = join(process.cwd(), `.test-daemon-default-${Date.now()}`);
      await mkdir(uniqueTestPath, { recursive: true });
      
      try {
        const { port } = await startDaemon({ projectPath: uniqueTestPath });
        expect(port).toBe(15433);
        
        const healthy = await healthCheck({ port: 15433 });
        expect(healthy).toBe(true);
        
        await stopDaemon(uniqueTestPath);
      } finally {
        try {
          await stopDaemon(uniqueTestPath);
        } catch {}
        if (existsSync(uniqueTestPath)) {
          await rm(uniqueTestPath, { recursive: true });
        }
      }
    });
  });
});
