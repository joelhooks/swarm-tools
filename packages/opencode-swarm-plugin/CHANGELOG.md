# opencode-swarm-plugin

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
