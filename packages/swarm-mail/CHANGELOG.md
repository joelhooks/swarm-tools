# swarm-mail

## 0.2.0

### Minor Changes

- [`1a7b02f`](https://github.com/joelhooks/swarm-tools/commit/1a7b02f707a1490f14465467c6024331d5064878) Thanks [@joelhooks](https://github.com/joelhooks)! - Add PGLite socket server adapter with hybrid daemon management and move streams storage to $TMPDIR.

  **Socket Server Adapter:**

  - New `createSocketAdapter()` wrapping postgres.js for DatabaseAdapter interface
  - Daemon lifecycle: `startDaemon()`, `stopDaemon()`, `isDaemonRunning()`, `healthCheck()`
  - Auto-start daemon on first use with `SWARM_MAIL_SOCKET=true` env var
  - Graceful fallback to embedded PGLite on failure
  - CLI: `swarm-mail-daemon start|stop|status`

  **$TMPDIR Storage (BREAKING):**

  - Streams now stored in `$TMPDIR/opencode-<project-name>-<hash>/streams`
  - Eliminates git pollution from `.opencode/streams/`
  - Auto-cleaned on reboot (ephemeral coordination state)
  - New exports: `getProjectTempDirName()`, `hashProjectPath()`

  This fixes the multi-agent PGLite corruption issue by having all agents connect to a single pglite-server daemon via PostgreSQL wire protocol.

## 0.1.4

### Patch Changes

- [`7471fd4`](https://github.com/joelhooks/swarm-tools/commit/7471fd43ef9b16b32e503d7cd4bdc5b7a74537e4) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm_complete tool execution failures and remove debug logging

  **opencode-swarm-plugin:**

  - Fix: Made sendSwarmMessage non-fatal in swarm_complete - failures no longer cause "Tool execution failed" errors
  - Fix: Added message_sent and message_error fields to swarm_complete response for better error visibility
  - Chore: Removed console.log statements from index.ts, swarm-orchestrate.ts, storage.ts, rate-limiter.ts
  - Test: Added integration tests for swarm_complete error handling

  **swarm-mail:**

  - Chore: Cleaned up debug logging and improved migration handling

## 0.1.3

### Patch Changes

- [`22befbf`](https://github.com/joelhooks/opencode-swarm-plugin/commit/22befbfa120a37a585cfec0709597172efda92a4) Thanks [@joelhooks](https://github.com/joelhooks)! - fix: mark @electric-sql/pglite as external in build to fix WASM file resolution

  PGLite requires its WASM data file (pglite.data) at runtime. When bundled into swarm-mail, the path resolution broke because it looked for the file relative to the bundle location instead of the installed @electric-sql/pglite package location.

  This caused "ENOENT: no such file or directory" errors when initializing the database.

## 0.1.2

### Patch Changes

- [`2d0fe9f`](https://github.com/joelhooks/opencode-swarm-plugin/commit/2d0fe9fc6278874ea6c4a92f0395cbdd11c4e994) Thanks [@joelhooks](https://github.com/joelhooks)! - Add repository field for npm provenance verification and ASCII art README

  - Add repository, author, license fields to package.json (required for npm provenance)
  - Add sick ASCII art banner to README

## 0.1.1

### Patch Changes

- [`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm-mail package to include dist folder

  - Add files field to swarm-mail package.json to explicitly include dist/
  - Previous publish was missing build output, causing "Cannot find module" errors
