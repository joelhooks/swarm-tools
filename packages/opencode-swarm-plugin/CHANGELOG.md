# opencode-swarm-plugin

## 0.30.0

### Minor Changes

- [`f3917ad`](https://github.com/joelhooks/swarm-tools/commit/f3917ad911d3c716a2470a01c66bce3500f644f4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 The Great bd CLI Purge

  The `bd` CLI is officially dead. Long live HiveAdapter!

  **What changed:**

  ### `swarm init` Command Rewritten

  - No longer shells out to `bd init` or `bd create`
  - Uses `ensureHiveDirectory()` and `getHiveAdapter()` directly
  - Supports `.beads` → `.hive` migration with user prompts
  - Creates cells via HiveAdapter, not CLI

  ### Auto-sync Removed from `index.ts`

  - Removed `void $\`bd sync\`.quiet().nothrow()`after`hive_close`
  - Users should call `hive_sync` explicitly at session end
  - This was a fire-and-forget that could race with other operations

  ### Plugin Template Updated

  - `detectSwarm()` now has confidence levels (HIGH/MEDIUM/LOW/NONE)
  - Added `SWARM_DETECTION_FALLBACK` for uncertain cases
  - Compaction hook injects context based on confidence:
    - HIGH/MEDIUM → Full swarm context
    - LOW → Fallback detection prompt
    - NONE → No injection

  ### Error Handling Fixed

  - `execTool()` now handles both string and object error formats
  - Fixes "Tool execution failed" generic error from `swarm_complete`
  - Actual error messages now propagate to the agent

  **Why it matters:**

  - No external CLI dependency for core functionality
  - HiveAdapter is type-safe and testable
  - Plugin works in environments without `bd` installed
  - Better error messages for debugging

  **Migration:** Run `swarm setup` to update your deployed plugin.

## 0.29.0

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

### Patch Changes

- Updated dependencies [[`a2ff1f4`](https://github.com/joelhooks/swarm-tools/commit/a2ff1f4257a2e9857f63abe4e9b941a573f44380)]:
  - swarm-mail@0.4.0

## 0.28.2

### Patch Changes

- Updated dependencies [[`90409ef`](https://github.com/joelhooks/swarm-tools/commit/90409ef4f353844b25fe04221bc80d6f930eced2)]:
  - swarm-mail@0.3.4

## 0.28.1

### Patch Changes

- [`0ee4f65`](https://github.com/joelhooks/swarm-tools/commit/0ee4f656c2fb2cf62d3ef06d329d9e093d124c33) Thanks [@joelhooks](https://github.com/joelhooks)! - Add postinstall hint and update repo URL

  - Show "Run swarm setup" hint after npm install
  - Update repo URL to github.com/joelhooks/swarm-tools
  - Add "Get started" commands to version output

## 0.28.0

### Minor Changes

- [`de2fa62`](https://github.com/joelhooks/swarm-tools/commit/de2fa628524b88511e06164104ff7b5fb93d39e5) Thanks [@joelhooks](https://github.com/joelhooks)! - Add full beads→hive migration pipeline with JSONL import to PGLite

  - Add `mergeHistoricBeads()` to merge beads.base.jsonl into issues.jsonl
  - Add `importJsonlToPGLite()` to import JSONL records into PGLite database
  - Wire both functions into `swarm setup` migration flow
  - Fix closed_at constraint issue when importing closed cells
  - TDD: 12 new integration tests for migration functions

## 0.27.4

### Patch Changes

- [`f23f774`](https://github.com/joelhooks/swarm-tools/commit/f23f774e4b83a3422d8266b6b1ad083daaec03e2) Thanks [@joelhooks](https://github.com/joelhooks)! - Enforce coordinator always spawns workers, never executes work directly

  - Added "Coordinator Role Boundaries" section to /swarm command
  - Coordinators now explicitly forbidden from editing code, running tests, or making "quick fixes"
  - Updated Phase 5 to clarify coordinators NEVER reserve files (workers do)
  - Updated Phase 6 with patterns for both parallel and sequential worker spawning
  - Worker agent template now confirms it was spawned correctly and to report coordinator violations

## 0.27.3

### Patch Changes

- [`ec23d25`](https://github.com/joelhooks/swarm-tools/commit/ec23d25aeca667c0294a6255fecf11dd7d7fd6b3) Thanks [@joelhooks](https://github.com/joelhooks)! - Add .beads → .hive directory migration support

  - Fix migration version collision: beadsMigration now v7, cellsViewMigration now v8 (was conflicting with streams v6)
  - Add `checkBeadsMigrationNeeded()` to detect legacy .beads directories
  - Add `migrateBeadsToHive()` to rename .beads to .hive
  - Add `ensureHiveDirectory()` to create .hive if missing (called by hive_sync)
  - Update hive_sync to ensure .hive directory exists before writing
  - Add migration prompt to `swarm setup` CLI flow

- Updated dependencies [[`ec23d25`](https://github.com/joelhooks/swarm-tools/commit/ec23d25aeca667c0294a6255fecf11dd7d7fd6b3)]:
  - swarm-mail@0.3.3

## 0.27.2

### Patch Changes

- [`50a2bf5`](https://github.com/joelhooks/swarm-tools/commit/50a2bf51c5320c038f202191d7acbfd2179f2cb3) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix cells view migration not being applied

  The v7 migration (cellsViewMigration) that creates the `cells` view was added after
  swarm-mail@0.3.0 was published. This caused `hive_sync` to fail with
  "relation cells does not exist" because the JSONL export queries the `cells` view.

  This patch ensures the v7 migration is included in the published package.

- Updated dependencies [[`50a2bf5`](https://github.com/joelhooks/swarm-tools/commit/50a2bf51c5320c038f202191d7acbfd2179f2cb3)]:
  - swarm-mail@0.3.2

## 0.27.0

### Minor Changes

- [`26fd2ef`](https://github.com/joelhooks/swarm-tools/commit/26fd2ef27562edc39f7db7a9cdbed399a465200d) Thanks [@joelhooks](https://github.com/joelhooks)! - Rename beads → hive across the codebase

  - `createBeadsAdapter` → `createHiveAdapter` (old name still exported as alias)
  - `BeadsAdapter` type → `HiveAdapter` type
  - All internal references updated to use hive terminology
  - Backward compatible: old exports still work but are deprecated

- [`ab23071`](https://github.com/joelhooks/swarm-tools/commit/ab23071cc7509c4fc37e1cac0f38a3812022cdf5) Thanks [@joelhooks](https://github.com/joelhooks)! - Add swarm-aware compaction hook to keep swarms cooking after context compression

  - New `experimental.session.compacting` hook detects active swarms and injects recovery context
  - `hasSwarmSign()` checks for swarm evidence: in-progress beads, subtasks, unclosed epics
  - Compaction prompt instructs coordinator to immediately resume orchestration
  - Fix @types/node conflicts by pinning to 22.19.3 in root overrides

### Patch Changes

- Updated dependencies [[`26fd2ef`](https://github.com/joelhooks/swarm-tools/commit/26fd2ef27562edc39f7db7a9cdbed399a465200d)]:
  - swarm-mail@0.3.0

## 0.26.1

### Patch Changes

- [`b2d4a84`](https://github.com/joelhooks/swarm-tools/commit/b2d4a84748cdef4b9dbca7666dd3d313b6cd2b24) Thanks [@joelhooks](https://github.com/joelhooks)! - Add automatic JSONL migration for beads on first use

  - Auto-migrate from `.beads/issues.jsonl` when database is empty
  - Fix import to handle missing dependencies/labels/comments arrays
  - Fix closed bead import to satisfy check constraint (status + closed_at)
  - Migrates 500+ historical beads seamlessly on first adapter initialization

- Updated dependencies [[`b2d4a84`](https://github.com/joelhooks/swarm-tools/commit/b2d4a84748cdef4b9dbca7666dd3d313b6cd2b24)]:
  - swarm-mail@0.2.1

## 0.26.0

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

### Patch Changes

- Updated dependencies [[`1a7b02f`](https://github.com/joelhooks/swarm-tools/commit/1a7b02f707a1490f14465467c6024331d5064878)]:
  - swarm-mail@0.2.0

## 0.25.3

### Patch Changes

- [`7471fd4`](https://github.com/joelhooks/swarm-tools/commit/7471fd43ef9b16b32e503d7cd4bdc5b7a74537e4) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm_complete tool execution failures and remove debug logging

  **opencode-swarm-plugin:**

  - Fix: Made sendSwarmMessage non-fatal in swarm_complete - failures no longer cause "Tool execution failed" errors
  - Fix: Added message_sent and message_error fields to swarm_complete response for better error visibility
  - Chore: Removed console.log statements from index.ts, swarm-orchestrate.ts, storage.ts, rate-limiter.ts
  - Test: Added integration tests for swarm_complete error handling

  **swarm-mail:**

  - Chore: Cleaned up debug logging and improved migration handling

- Updated dependencies [[`7471fd4`](https://github.com/joelhooks/swarm-tools/commit/7471fd43ef9b16b32e503d7cd4bdc5b7a74537e4)]:
  - swarm-mail@0.1.4

## 0.25.2

### Patch Changes

- [`34a2c3a`](https://github.com/joelhooks/swarm-tools/commit/34a2c3a07f036297db449414ef8dbeb7b39721e2) Thanks [@joelhooks](https://github.com/joelhooks)! - Grant swarm workers autonomy to file beads against the epic

  Workers can now create bugs, tech debt, and follow-up tasks linked to their parent epic via `parent_id`. Prompt explicitly encourages workers to file issues rather than silently ignoring them.

## 0.25.1

### Patch Changes

- [`757f4a6`](https://github.com/joelhooks/swarm-tools/commit/757f4a690721b3f04a414e4c1694660862504e54) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix skills_update tool - add `content` parameter as primary (with `body` as backwards-compat alias)

  The tool was only accepting `body` but users expected `content`. Now both work:

  - `skills_update(name="foo", content="new stuff")` - preferred
  - `skills_update(name="foo", body="new stuff")` - still works for backwards compat

- [`3d619ff`](https://github.com/joelhooks/swarm-tools/commit/3d619ffda78b2e6066491f053e8fad8dac7b5b71) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm_complete failing when bead project doesn't match CWD

  - Use `project_key` as working directory for `bd close` command
  - Improved error messages with context-specific recovery steps
  - Added planning guardrails to warn when todowrite is used for parallel work (should use swarm)

## 0.25.0

### Minor Changes

- [`b70ae35`](https://github.com/joelhooks/swarm-tools/commit/b70ae352876515bdfe68511d72bb472c85b7fdfc) Thanks [@joelhooks](https://github.com/joelhooks)! - Add Socratic planning phase and improved worker prompts to swarm setup

  **SWARM_COMMAND template:**

  - Added Phase 0: Socratic Planning - asks clarifying questions before decomposing
  - Supports `--fast`, `--auto`, `--confirm-only` flags to skip questions
  - ONE question at a time with concrete options and recommendations

  **Worker agent template:**

  - Reinforces the 9-step survival checklist from SUBTASK_PROMPT_V2
  - Explicitly lists all steps with emphasis on non-negotiables
  - Explains WHY skipping steps causes problems (lost work, conflicts, etc.)

  **Agent path consolidation:**

  - Now creates nested paths: `~/.config/opencode/agent/swarm/worker.md`
  - Matches `Task(subagent_type="swarm/worker")` format
  - Cleans up legacy flat files (`swarm-worker.md`) on reinstall

  To get the new prompts, run `swarm setup` and choose "Reinstall everything".

## 0.24.0

### Minor Changes

- [`434f48f`](https://github.com/joelhooks/swarm-tools/commit/434f48f207c3509f6b924caeb47cd6e019dcc0e1) Thanks [@joelhooks](https://github.com/joelhooks)! - Add worker survival checklist and Socratic planning for swarm coordination

  **Worker Survival Checklist (9-step mandatory flow):**

  - Workers now follow a strict initialization sequence: swarmmail_init → semantic-memory_find → skills_use → swarmmail_reserve
  - Workers reserve their own files (coordinators no longer reserve on behalf of workers)
  - Auto-checkpoint at 25/50/75% progress milestones
  - Workers store learnings via semantic-memory before completing

  **Socratic Planning:**

  - New `swarm_plan_interactive` tool with 4 modes: socratic (default), fast, auto, confirm-only
  - Default mode asks clarifying questions before decomposition
  - Escape hatches for experienced users: `--fast`, `--auto`, `--confirm-only` flags on /swarm command

  **Updated Skills:**

  - swarm-coordination skill now documents worker survival patterns and coordinator rules

### Patch Changes

- [#15](https://github.com/joelhooks/swarm-tools/pull/15) [`299f2d3`](https://github.com/joelhooks/swarm-tools/commit/299f2d3305796bcb411f9b90715cda3513d17b54) Thanks [@tayiorbeii](https://github.com/tayiorbeii)! - Sync bundled skills into the global skills directory during `swarm setup` reinstall, fix bundled-skill path resolution, and make AGENTS.md skill-awareness updates work without relying on `opencode run`.

## 0.23.6

### Patch Changes

- Updated dependencies [[`22befbf`](https://github.com/joelhooks/opencode-swarm-plugin/commit/22befbfa120a37a585cfec0709597172efda92a4)]:
  - swarm-mail@0.1.3

## 0.23.5

### Patch Changes

- [`3826c6d`](https://github.com/joelhooks/opencode-swarm-plugin/commit/3826c6d887f937ccb201b7c4322cbc7b46823658) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* resolution by running bun install before pack

  The lockfile was stale, causing bun pack to resolve workspace:\* to old versions.
  Now runs bun install first to ensure lockfile matches current package.json versions.

## 0.23.4

### Patch Changes

- Updated dependencies [[`2d0fe9f`](https://github.com/joelhooks/opencode-swarm-plugin/commit/2d0fe9fc6278874ea6c4a92f0395cbdd11c4e994)]:
  - swarm-mail@0.1.2

## 0.23.3

### Patch Changes

- [`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm-mail package to include dist folder

  - Add files field to swarm-mail package.json to explicitly include dist/
  - Previous publish was missing build output, causing "Cannot find module" errors

- Updated dependencies [[`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7)]:
  - swarm-mail@0.1.1

## 0.23.2

### Patch Changes

- [`7f9ead6`](https://github.com/joelhooks/opencode-swarm-plugin/commit/7f9ead65dab1dd5dc9aff57df0871cc390556fe1) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* protocol resolution using bun pack + npm publish

  Uses bun pack to create tarball (which resolves workspace:\* to actual versions) then npm publish for OIDC trusted publisher support.

## 0.23.1

### Patch Changes

- [`64ad0e4`](https://github.com/joelhooks/opencode-swarm-plugin/commit/64ad0e4fc033597027e3b0614865cfbf955b5983) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* protocol resolution in npm publish

  Use bun publish instead of npm publish to properly resolve workspace:\* protocols to actual versions.

## 0.23.0

### Minor Changes

- [`b66d77e`](https://github.com/joelhooks/opencode-swarm-plugin/commit/b66d77e484e9b7021b3264d1a7e8f54a16ea5204) Thanks [@joelhooks](https://github.com/joelhooks)! - Add changesets workflow and semantic memory test isolation

  - OIDC publish workflow with GitHub Actions
  - Changesets for independent package versioning
  - TEST_SEMANTIC_MEMORY_COLLECTION env var for test isolation
  - Prevents test pollution of production semantic-memory
