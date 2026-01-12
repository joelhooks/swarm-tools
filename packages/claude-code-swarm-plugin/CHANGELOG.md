# claude-code-swarm-plugin

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
