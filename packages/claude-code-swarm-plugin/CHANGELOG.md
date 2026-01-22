# claude-code-swarm-plugin

## 0.59.5

### Patch Changes

- fix(swarmmail): auto-normalize escaped paths in reserve/release tools
- feat(swarm): require user confirmation for branch/PR creation
- Sync with opencode-swarm-plugin 0.59.5

## 0.59.4

### Patch Changes

- docs(swarm): add mandatory hivemind steps for custom worker prompts

## 0.59.3

### Patch Changes

- feat(swarm): require user confirmation for branch/PR creation

## 0.59.2

### Patch Changes

- fix(swarmmail): auto-normalize escaped paths in reserve/release tools

## 0.58.5

### Patch Changes

- docs(swarm): comprehensive coordinator instructions with mandatory hivemind usage

  - Added visual boxes for GOOD/BAD coordinator behavior patterns
  - FORBIDDEN EXCUSES box prevents "too small for swarm" refusals
  - Mandatory hivemind_find before decomposition, hivemind_store after
  - Context preservation rules (delegate planning to subagent)
  - Inbox monitoring every 5-10 min requirement
  - ASCII art session summary required
  - Planning modes: --fast, --auto, --confirm-only

## 0.58.4

### Patch Changes

- [`7d9bf32`](https://github.com/joelhooks/swarm-tools/commit/7d9bf320a6cc5fea03c66f79e9bb61023af16d99) Thanks [@joelhooks](https://github.com/joelhooks)! - fix: add defensive validation with helpful error hints to swarm tools

  - Add null checks to swarm_complete, swarm_progress, swarm_decompose, swarm_validate_decomposition, hive_create_epic
  - Return friendly error messages with examples when required params are missing
  - Improve tool descriptions with workflow hints and required param lists
  - Fix subprocess cleanup with try-finally patterns in hive.ts, skills.ts, storage.ts, tool-availability.ts
  - Add 30s timeout to execSemanticMemory to prevent hanging
  - Add error state tracking to FlushManager

- [`ef6d21d`](https://github.com/joelhooks/swarm-tools/commit/ef6d21de5ae445bb5070f279e5559f1d2499eb49) Thanks [@joelhooks](https://github.com/joelhooks)! - fix(decompose): handle object and double-stringified response in swarm_validate_decomposition

  MCP server may pass response as already-parsed object (not string) when Claude provides the decomposition. Now handles both string and object inputs, plus the edge case of double-stringified JSON.

## 0.58.1

### Patch Changes

- [`f0aa875`](https://github.com/joelhooks/swarm-tools/commit/f0aa875136801dad649456733ab2d1de4e9c6341) Thanks [@joelhooks](https://github.com/joelhooks)! - fix: sync plugin.json version with package.json

## 0.58.0

### Minor Changes

- [`8ea6ce7`](https://github.com/joelhooks/swarm-tools/commit/8ea6ce760256951d83985eb6871b99b5f6e6083d) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Initial Release: Claude Code Swarm Plugin

  Lightweight Claude Code plugin that delegates to the globally installed `swarm` CLI.

  **Why a separate package:**

  - The main `opencode-swarm-plugin` bundles native dependencies (`@libsql/client`) that cause issues when Claude Code copies plugins to its cache
  - This thin wrapper (~600KB) shells out to the CLI, avoiding native module problems

  **Includes:**

  - MCP server with 25 tools (hive, hivemind, swarmmail, swarm orchestration)
  - Slash commands: `/swarm`, `/hive`, `/inbox`, `/status`, `/handoff`
  - Skills: `always-on-guidance`, `swarm-coordination`
  - Agents: `coordinator`, `worker`, `background-worker`
  - Lifecycle hooks for session management

  **Prerequisites:**
  Install the swarm CLI globally: `npm install -g opencode-swarm-plugin`
