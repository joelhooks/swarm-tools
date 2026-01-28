# Claude Code Swarm Plugin

Multi-agent coordination for Claude Code. Enables parallel task decomposition, worker spawning, and agent-to-agent communication.

## Installation

### 1. Install the swarm CLI (required)

The plugin delegates to the `swarm` CLI for all operations:

```bash
bun add -g opencode-swarm-plugin
# or
npm install -g opencode-swarm-plugin
```

Verify installation:

```bash
swarm --version
```

### 2. Install the plugin from marketplace

```bash
# Add the swarm-tools marketplace
claude /plugin add-marketplace https://github.com/joelhooks/opencode-swarm-plugin

# Install the swarm plugin
claude /plugin install swarm@swarm-tools
```

### 3. Restart Claude Code

The plugin's MCP server will start automatically.

## Usage

### Slash Commands

| Command | Description |
|---------|-------------|
| `/swarm <task>` | Decompose task into parallel subtasks and spawn workers |
| `/hive` | Query and manage tasks (cells) in the hive tracker |
| `/inbox` | Check swarm mail inbox for messages from other agents |
| `/status` | Check swarm coordination status |
| `/handoff` | End session with proper cleanup and handoff notes |

### Example: Running a Swarm

```
/swarm refactor the auth module to use JWT tokens
```

This will:
1. Analyze the task and decompose into parallelizable subtasks
2. Create an epic with child tasks in the hive tracker
3. Spawn worker agents for each subtask
4. Coordinate file reservations to prevent conflicts
5. Review worker output before completion

## Tools

The plugin exposes 25 tools via MCP:

### Hive (Task Management)
- `hive_cells` - Query cells with filters
- `hive_create` - Create a new cell
- `hive_create_epic` - Create epic with subtasks
- `hive_close` - Close a cell with reason
- `hive_query` - Query with advanced filters
- `hive_ready` - Get next unblocked cell
- `hive_update` - Update cell status/description

### Hivemind (Memory)
- `hivemind_find` - Semantic search across memories
- `hivemind_store` - Store a memory with embedding
- `hivemind_get` - Retrieve memory by ID
- `hivemind_stats` - Memory system statistics

### Swarmmail (Agent Coordination)
- `swarmmail_init` - Initialize agent session
- `swarmmail_inbox` - Check inbox for messages
- `swarmmail_send` - Send message to other agents
- `swarmmail_reserve` - Reserve files for editing
- `swarmmail_release` - Release file reservations

### Swarm (Orchestration)
- `swarm_decompose` - Generate decomposition prompt
- `swarm_status` - Get swarm status by epic ID
- `swarm_plan_prompt` - Strategy-specific planning
- `swarm_validate_decomposition` - Validate decomposition
- `swarm_spawn_subtask` - Prepare subtask for spawning
- `swarm_review` - Generate review prompt
- `swarm_review_feedback` - Send review feedback
- `swarm_progress` - Report progress
- `swarm_complete` - Mark subtask complete

## Hooks

The plugin registers lifecycle hooks:

| Hook | Action |
|------|--------|
| `SessionStart` | Initialize session context |
| `UserPromptSubmit` | Track user prompts |
| `PreToolUse` | Pre-edit validation and pre-complete checks |
| `PostToolUse` | Track tool usage for hivemind_find, skills_use, swarmmail_init, hivemind_store, swarm_complete |
| `PreCompact` | Save state before context compaction |
| `SessionEnd` | Cleanup and sync |

## Skills

### always-on-guidance
Rule-oriented guidance for Claude Code agents. Loaded automatically.

### swarm-coordination
Multi-agent coordination patterns. Use when spawning workers or coordinating parallel tasks.

## Agents

| Agent | Type | Purpose |
|-------|------|---------|
| `coordinator` | Foreground | Orchestrates swarm decomposition and worker spawning |
| `worker` | Foreground | Executes subtasks with file reservations |
| `background-worker` | Background | Handles tasks without MCP tool access |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code                          │
├─────────────────────────────────────────────────────────┤
│  Plugin (this package)                                  │
│  ├── MCP Server (bin/mcp-server.js)                    │
│  │   └── Shells out to: swarm tool <name> --json       │
│  ├── Commands (/swarm, /hive, /inbox, etc.)            │
│  ├── Skills (always-on-guidance, swarm-coordination)   │
│  ├── Agents (coordinator, worker)                      │
│  └── Hooks (SessionStart, PreCompact, etc.)            │
├─────────────────────────────────────────────────────────┤
│  swarm CLI (globally installed)                         │
│  ├── Hive tracker (.hive/ directory)                   │
│  ├── Hivemind semantic memory (LibSQL + Ollama)        │
│  └── Swarmmail coordination (embedded event store)     │
└─────────────────────────────────────────────────────────┘
```

## Why This Architecture?

The main OpenCode swarm plugin bundles native dependencies (`@libsql/client`) which causes issues when Claude Code copies plugins to its cache. This plugin avoids bundling by delegating all tool execution to the globally installed `swarm` CLI.

Benefits:
- No native dependency issues
- Single source of truth (the CLI)
- Automatic updates when CLI is updated
- Tiny plugin size (~600KB bundled)

## Development

```bash
# Install dependencies
bun install

# Build the MCP server bundle
bun run build

# Type check
bun run typecheck
```

## License

MIT
