# swarm-mail

## 1.1.1

### Patch Changes

- [`19995a6`](https://github.com/joelhooks/swarm-tools/commit/19995a68dd1283de1d13afa6fc028bd1273d1b27) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Squashed the BigInt Date Bug

  PGLite returns BIGINT columns as JavaScript `bigint` type. The `Date` constructor throws when given a bigint:

  ```javascript
  new Date(1734628445371n); // TypeError: Cannot convert a BigInt value to a number
  ```

  This caused `Invalid Date` errors in all hive operations (`hive_query`, `hive_create`, etc).

  **Fix:** Wrap timestamps in `Number()` before passing to `Date`:

  ```typescript
  // Before (broken)
  new Date(cell.created_at);

  // After (works with both number and bigint)
  new Date(Number(cell.created_at));
  ```

  **Files fixed:**

  - `swarm-mail/src/hive/jsonl.ts` - JSONL export functions
  - `opencode-swarm-plugin/src/hive.ts` - `formatCellForOutput()`

  **Tests added:** 6 new tests covering bigint date handling edge cases.

## 1.1.0

### Minor Changes

- [`39593d7`](https://github.com/joelhooks/swarm-tools/commit/39593d7ee817c683ad1877af52ad5f2ca140c4e2) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Smart ID Resolution: Git-Style Partial Hashes for Hive

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  BEFORE: hive_close(id="opencode-swarm-monorepo-lf2p4u-mjcadqq3fb9")  │
  │  AFTER:  hive_close(id="mjcadqq3fb9")                                 │
  └─────────────────────────────────────────────────────────────┘
  ```

  Cell IDs got long. Now you can use just the hash portion.

  **What changed:**

  ### swarm-mail

  - Added `resolvePartialId(adapter, partialId)` to resolve partial hashes to full cell IDs
  - Supports exact match, prefix match, suffix match, and substring match
  - Returns helpful error messages for ambiguous matches ("Found 3 cells matching 'abc': ...")
  - 36 new tests covering all resolution scenarios

  ### opencode-swarm-plugin

  - `hive_update`, `hive_close`, `hive_start` now accept partial IDs
  - Resolution happens transparently - full ID returned in response
  - Backward compatible - full IDs still work

  **JSONL Fix (bonus):**

  - `serializeToJSONL()` now adds trailing newline for POSIX compliance
  - Prevents parse errors when appending to existing files

  **Why it matters:**

  - Less typing, fewer copy-paste errors
  - Matches git's partial SHA workflow (muscle memory)
  - Ambiguous matches fail fast with actionable error messages

  > "The best interface is no interface" - Golden Krishna
  > (But if you must have one, make it forgive typos)

  ***

  ## Auto-Sync at Key Events

  ```
  ┌─────────────────────────────────────────┐
  │  hive_create_epic  →  auto-sync         │
  │  swarm_complete    →  auto-sync         │
  │  process.exit      →  safety net sync   │
  └─────────────────────────────────────────┘
  ```

  Cells no longer get lost when processes exit unexpectedly.

  **What changed:**

  - `hive_create_epic` syncs after creating epic + subtasks (workers can see them immediately)
  - `swarm_complete` syncs before worker exits (completed work persists)
  - `process.on('beforeExit')` hook catches any remaining dirty cells

  **Why it matters:**

  - Spawned workers couldn't see cells created by coordinator (race condition)
  - Worker crashes could lose completed work
  - Now the lazy-write pattern has strategic checkpoints

  ***

  ## Removed Arbitrary Subtask Limits

  ```
  BEFORE: max_subtasks capped at 10 (why tho?)
  AFTER:  no limit - LLM decides based on task complexity
  ```

  **What changed:**

  - Removed `.max(10)` from `swarm_decompose` and `swarm_plan_prompt`
  - `max_subtasks` is now optional with no default
  - Prompt says "as many as needed" instead of "2-10"

  **Why it matters:**

  - Complex epics need more than 10 subtasks
  - Arbitrary limits force awkward decomposition
  - Trust the coordinator to make good decisions

## 1.0.0

### Major Changes

- [`230e9aa`](https://github.com/joelhooks/swarm-tools/commit/230e9aa91708610183119680cb5f6924c1089552) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 The Daemon Awakens: Multi-Process Safety by Default

  PGlite is single-connection. Multiple processes = corruption. We learned this the hard way.

  **Now it just works.**

  ### What Changed

  **Daemon mode is the default.** When you call `getSwarmMail()`, we:

  1. Start an in-process `PGLiteSocketServer` (no external binary!)
  2. All connections go through this server
  3. Multiple processes? No problem. They all talk to the same daemon.

  ```typescript
  // Before: Each process creates its own PGlite → 💥 corruption
  const swarmMail = await getSwarmMail("/project");

  // After: First process starts daemon, others connect → ✅ safe
  const swarmMail = await getSwarmMail("/project");
  ```

  ### Opt-Out (if you must)

  ```bash
  # Single-process mode (embedded PGlite)
  SWARM_MAIL_SOCKET=false
  ```

  ⚠️ Only use embedded mode when you're **certain** only one process accesses the database.

  ### Bonus: 9x Faster Tests

  We added a shared test server pattern. Instead of creating a new PGlite instance per test (~500ms WASM startup), tests share one instance and TRUNCATE between runs.

  | Metric           | Before | After |
  | ---------------- | ------ | ----- |
  | adapter.test.ts  | 8.63s  | 0.96s |
  | Per-test average | 345ms  | 38ms  |

  ### Breaking Change

  If you were relying on embedded mode being the default, set `SWARM_MAIL_SOCKET=false`.

  ### The Architecture

  ```
  ┌─────────────────────────────────────────┐
  │  Process 1      Process 2      ...      │
  │      │              │                   │
  │      └──────┬───────┘                   │
  │             ▼                           │
  │   ┌───────────────────┐                 │
  │   │ PGLiteSocketServer │ (in-process)   │
  │   │      + PGlite      │                │
  │   └───────────────────┘                 │
  │             │                           │
  │             ▼                           │
  │   ┌───────────────────┐                 │
  │   │   Your Data 🍯    │                 │
  │   └───────────────────┘                 │
  └─────────────────────────────────────────┘
  ```

  No external binaries. No global installs. Just safety.

### Minor Changes

- [`181fdd5`](https://github.com/joelhooks/swarm-tools/commit/181fdd507b957ceb95e069ae71d527d3f7e1b940) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🛡️ WAL Safety: The Checkpoint That Saved the Hive

  PGlite's Write-Ahead Log nearly ate our lunch. 930 WAL files. 930MB of uncommitted transactions.
  One WASM OOM crash later, pdf-brain lost 359 documents.

  **Never again.**

  ### What Changed

  **New DatabaseAdapter methods:**

  ```typescript
  // Force WAL flush to data files
  await db.checkpoint();

  // Monitor WAL health (default 100MB threshold)
  const { healthy, message } = await db.checkWalHealth(100);

  // Get raw stats
  const { walSize, walFileCount } = await db.getWalStats();
  ```

  **Automatic checkpoints after:**

  - Hive migrations complete
  - Streams migrations complete
  - Any batch operation that touches multiple records

  **Health check integration:**

  ```typescript
  const health = await swarmMail.healthCheck();
  // { connected: true, walHealth: { healthy: true, message: "WAL healthy: 2.5MB (3 files)" } }
  ```

  ### Why It Matters

  PGlite in embedded mode accumulates WAL files without explicit CHECKPOINT calls. Each unclean shutdown compounds the problem. Eventually: OOM.

  The fix is simple but critical:

  1. **Checkpoint after batch ops** - forces WAL to data files, allows recycling
  2. **Monitor WAL size** - warn at 100MB, not 930MB
  3. **Prefer daemon mode** - single long-lived process handles its own WAL

  ### Deployment Recommendation

  **Use daemon mode in production.** Multiple short-lived PGlite instances compound WAL accumulation. A single daemon process:

  - Owns the database connection
  - Checkpoints naturally during operation
  - Cleans up properly on shutdown

  See README.md "Deployment Modes" section for details.

  ### The Lesson

  > "The database doesn't forget. It just waits."

  WAL is a feature, not a bug. But like any feature, it needs care and feeding.
  Now swarm-mail feeds it automatically.

## 0.5.0

### Minor Changes

- [`1e41c9b`](https://github.com/joelhooks/swarm-tools/commit/1e41c9b42ae468761f813d406171d182fb9948e0) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Semantic Memory Consolidation

  > _"Simplicity is the ultimate sophistication."_
  > — Leonardo da Vinci

  The semantic memory system has moved into swarm-mail, bringing persistent learning to the hive.

  ### What's New

  **Semantic Memory in swarm-mail:**

  - `createSemanticMemory()` - Initialize memory store with PGLite + Ollama embeddings
  - `getMigrationStatus()` - Check if legacy memory needs migration
  - `migrateLegacyMemory()` - Migrate from old semantic-memory-mcp format
  - Automatic migration on first use (no manual intervention needed)

  **Legacy Migration:**

  - Detects old `~/.semantic-memory/` databases
  - Migrates memories, embeddings, and metadata
  - Preserves all tags and timestamps
  - Creates backup before migration

  **Worker Handoff Protocol:**

  - Agents can now hand off work mid-task
  - State preserved via swarm mail messages
  - Enables long-running tasks across context limits

  ### Breaking Changes

  None - this is additive. The old semantic-memory-mcp still works but is deprecated.

  ### Files Added/Changed

  - `packages/swarm-mail/src/memory/` - New memory subsystem
  - `packages/swarm-mail/src/memory/migrate-legacy.ts` - Migration tooling
  - `packages/opencode-swarm-plugin/bin/swarm.ts` - Uses new exports

## 0.4.0

### Minor Changes

- [`a2ff1f4`](https://github.com/joelhooks/swarm-tools/commit/a2ff1f4257a2e9857f63abe4e9b941a573f44380) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Cell IDs Now Wear Their Project Colors

  > _"We may fantasize about being International Men of Mystery, but our code needs to be mundane and clear. One of the most important parts of clear code is good names."_
  > — Martin Fowler, _Refactoring_

  Cell IDs finally know where they came from. Instead of anonymous `bd-xxx` prefixes,
  new cells proudly display their project name: `swarm-mail-lf2p4u-abc123`.

  ### What Changed

  **swarm-mail:**

  - `generateBeadId()` now reads `package.json` name field from project directory
  - Added `slugifyProjectName()` for safe ID generation (lowercase, special chars → dashes)
  - Falls back to `cell-` prefix if no package.json or no name field

  **opencode-swarm-plugin:**

  - Removed all `bd` CLI usage from `swarm-orchestrate.ts` - now uses HiveAdapter
  - Improved compaction hook swarm detection with confidence levels (high/medium/low)
  - Added fallback detection prompt for uncertain swarm states

  ### Examples

  | Before                  | After                           |
  | ----------------------- | ------------------------------- |
  | `bd-lf2p4u-mjbneh7mqah` | `swarm-mail-lf2p4u-mjbneh7mqah` |
  | `bd-abc123-xyz`         | `my-cool-app-abc123-xyz`        |
  | (no package.json)       | `cell-abc123-xyz`               |

  ### Why It Matters

  - **Identifiable at a glance** - Know which project a cell belongs to without looking it up
  - **Multi-project workspaces** - Filter/search cells by project prefix
  - **Terminology cleanup** - Removes legacy "bead" (`bd-`) from user-facing IDs

  ### Backward Compatible

  Existing `bd-*` IDs still work fine. No migration needed - only NEW cells get project prefixes.

  ### Compaction: Keeping the Swarm Alive

  > _"Intelligent and structured group dynamics that emerge not from a leader, but from the local interactions of the elements themselves."_
  > — Daniel Shiffman, _The Nature of Code_

  The compaction hook now uses multi-signal detection to keep swarms cooking through context compression:

  - **HIGH confidence:** Active reservations, in_progress cells → full swarm context
  - **MEDIUM confidence:** Open subtasks, unclosed epics → full swarm context
  - **LOW confidence:** Any cells exist → fallback detection prompt

  Philosophy: Err on the side of continuation. A false positive costs context space. A false negative loses the swarm.

## 0.3.4

### Patch Changes

- [`90409ef`](https://github.com/joelhooks/swarm-tools/commit/90409ef4f353844b25fe04221bc80d6f930eced2) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix table name mismatches and SQL alias typo in hive module

  - jsonl.ts: Fixed DELETE queries using wrong table names (cell*\* → bead*\*)
  - projections.ts: Fixed SQL alias typo (bcc.cell_id → bbc.cell_id)

## 0.3.3

### Patch Changes

- [`ec23d25`](https://github.com/joelhooks/swarm-tools/commit/ec23d25aeca667c0294a6255fecf11dd7d7fd6b3) Thanks [@joelhooks](https://github.com/joelhooks)! - Add .beads → .hive directory migration support

  - Fix migration version collision: beadsMigration now v7, cellsViewMigration now v8 (was conflicting with streams v6)
  - Add `checkBeadsMigrationNeeded()` to detect legacy .beads directories
  - Add `migrateBeadsToHive()` to rename .beads to .hive
  - Add `ensureHiveDirectory()` to create .hive if missing (called by hive_sync)
  - Update hive_sync to ensure .hive directory exists before writing
  - Add migration prompt to `swarm setup` CLI flow

## 0.3.2

### Patch Changes

- [`50a2bf5`](https://github.com/joelhooks/swarm-tools/commit/50a2bf51c5320c038f202191d7acbfd2179f2cb3) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix cells view migration not being applied

  The v7 migration (cellsViewMigration) that creates the `cells` view was added after
  swarm-mail@0.3.0 was published. This caused `hive_sync` to fail with
  "relation cells does not exist" because the JSONL export queries the `cells` view.

  This patch ensures the v7 migration is included in the published package.

## 0.3.0

### Minor Changes

- [`26fd2ef`](https://github.com/joelhooks/swarm-tools/commit/26fd2ef27562edc39f7db7a9cdbed399a465200d) Thanks [@joelhooks](https://github.com/joelhooks)! - Rename beads → hive across the codebase

  - `createBeadsAdapter` → `createHiveAdapter` (old name still exported as alias)
  - `BeadsAdapter` type → `HiveAdapter` type
  - All internal references updated to use hive terminology
  - Backward compatible: old exports still work but are deprecated

## 0.2.1

### Patch Changes

- [`b2d4a84`](https://github.com/joelhooks/swarm-tools/commit/b2d4a84748cdef4b9dbca7666dd3d313b6cd2b24) Thanks [@joelhooks](https://github.com/joelhooks)! - Add automatic JSONL migration for beads on first use

  - Auto-migrate from `.beads/issues.jsonl` when database is empty
  - Fix import to handle missing dependencies/labels/comments arrays
  - Fix closed bead import to satisfy check constraint (status + closed_at)
  - Migrates 500+ historical beads seamlessly on first adapter initialization

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
