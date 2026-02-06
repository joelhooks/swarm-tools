# claude-code-swarm-plugin

## 0.60.1

### Patch Changes

- [`552ca1a`](https://github.com/joelhooks/swarm-tools/commit/552ca1a4a077bd4f61b0f3568ccf82d01d27bc13) Thanks [@joelhooks](https://github.com/joelhooks)! - fix(hooks): restore swarm claude subcommand tree deleted by 86fab13

  Commit 86fab13 ("support multiple OpenCode installation methods") accidentally
  deleted ~2,070 lines from bin/swarm.ts via a bad rebase, nuking the entire
  `swarm claude` subcommand tree. Every Claude Code hook invocation has been
  hitting "Unknown subcommand" since, most visibly `agent-stop` on every response.

  **Restored from 70d47d5:**

  - `case "claude"` in main CLI switch
  - ClaudeHookInput interface + 3 helper functions (readHookInput,
    resolveClaudeProjectPath, writeClaudeHookOutput)
  - 10 handler functions: session-start, user-prompt, pre-compact, session-end,
    pre-edit, pre-complete, post-complete, track-tool, compliance, skill-reload
  - Claude admin commands: path, install, uninstall, init
  - Required imports: createMemoryAdapter, invalidateSkillsCache, discoverSkills

  **New stub handlers for ed31f5c hooks:**

  - coordinator-start, worker-start (SubagentStart)
  - subagent-stop (SubagentStop), agent-stop (Stop)
  - track-task (PreToolUse:TaskCreate|TaskUpdate)
  - post-task-update (PostToolUse:TaskUpdate)

  **Synced hooks.json** in opencode-swarm-plugin/claude-plugin to include
  SubagentStart, SubagentStop, Stop, and task tracking hooks matching
  the claude-code-swarm-plugin version.

  > "Design fragility: the tendency of software to break in multiple places
  > when a single change is made, often in seemingly unrelated areas."

## 0.60.0

### Minor Changes

- [#163](https://github.com/joelhooks/swarm-tools/pull/163) [`ed31f5c`](https://github.com/joelhooks/swarm-tools/commit/ed31f5c316e1bb9137bb27e824f2fc58b9ba9d46) Thanks [@joelhooks](https://github.com/joelhooks)! - feat(plugin): upgrade for Claude Code 2.1.32 native integration

  Add dual-mode architecture supporting both native agent teams and task
  fallback. Plugin now complements rather than duplicates native features.

  **claude-code-swarm-plugin:**

  - agents: Add permissionMode, memory, disallowedTools, lifecycle hooks
  - swarm.md: Full rewrite with environment detection, mode-aware protocols
  - hooks: Add SubagentStart/Stop, TaskCreate/TaskUpdate tracking
  - skills: Update for TaskCreate/TaskUpdate, TeammateTool awareness
  - README: Add 2.1.32 integration docs, architecture diagram, comparison table

  **opencode-swarm-plugin:**

  - Fix test schema mismatch: add access_count, last_accessed, category, status
  - Fix decay_factor default from 0.7 to 1.0 to match Drizzle schema
  - Update column count assertions (14 → 18 columns)

  Native teams provide: real-time messaging, planning mode, task UI
  Plugin provides: git-backed persistence, semantic memory, file locking

  > "Make the change easy, then make the easy change." — Kent Beck

### Patch Changes

- [`3bbf31d`](https://github.com/joelhooks/swarm-tools/commit/3bbf31d73874d49c319f4b89f51934ae9049622d) Thanks [@joelhooks](https://github.com/joelhooks)! - fix(mcp): inline tool schemas to fix params arriving as undefined

  The MCP server scraped tool definitions from `swarm tool --list --json` at
  startup, but the CLI's `--list` handler never supported `--json`. The fallback
  parsed colored text output and registered every tool with an empty JSON schema
  (`properties: {}`), which converted to a Zod schema with no required fields.
  The MCP SDK then treated all params as optional, delivering `undefined` to
  every handler.

  - **claude-code-swarm-plugin**: Replace runtime CLI scraping with static
    `TOOL_DEFINITIONS` array containing all 25 tools with proper JSON schemas
    (properties, required fields, types, descriptions)
  - **swarm-tools**: Export `SWARM_TOOLS` from index.ts; MCP server imports
    canonical definitions instead of scraping CLI
  - Remove dead `getToolDefinitions()`, `filterTools()`, unused `execSync` import

  > "The most fundamental problem in computer science is problem decomposition:
  > how to take a complex problem and divide it up into pieces that can be solved
  > independently." — John Ousterhout, A Philosophy of Software Design

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
