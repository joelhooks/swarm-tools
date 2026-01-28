# Swarm Plugin for Claude Code

Multi-agent task decomposition and coordination for Claude Code.

## Prerequisites

The swarm CLI must be installed globally:

```bash
npm install -g opencode-swarm-plugin
# or
bun add -g opencode-swarm-plugin
```

Verify installation:

```bash
swarm version
```

## Installation

### Via Marketplace (Recommended)

Add the marketplace to your Claude Code settings, then install:

```bash
claude /plugin install swarm
```

### Via Plugin Directory (Development)

```bash
claude --plugin-dir /path/to/opencode-swarm-plugin/packages/opencode-swarm-plugin/claude-plugin
```

## Usage

### Start a Swarm

Use the `/swarm:swarm` command to decompose a task into parallel subtasks:

```
/swarm:swarm Add user authentication with OAuth support
```

The coordinator will:
1. Query hivemind for past learnings
2. Clarify scope if needed
3. Decompose into parallel subtasks
4. Spawn workers for each subtask
5. Review completed work
6. Store learnings for future swarms

### Other Commands

| Command | Description |
|---------|-------------|
| `/swarm:swarm <task>` | Decompose and execute a multi-agent task |
| `/swarm:status` | Check worker progress, inbox, reservations |
| `/swarm:inbox` | Review inter-agent messages |
| `/swarm:hive` | Query and manage tasks (cells) |
| `/swarm:handoff` | End session, release locks, sync state |

### Skills (Auto-Invoked)

The plugin includes skills that Claude uses automatically:

- **swarm-coordination** - Multi-agent workflow guidance
- **always-on-guidance** - Model-specific defaults and best practices

## Available Tools

### Coordinator Tools

| Tool | Purpose |
|------|---------|
| `hivemind_find` | Query past learnings before decomposing |
| `hivemind_store` | Store discovered patterns |
| `swarm_decompose` | Break task into subtasks |
| `swarm_spawn_subtask` | Launch worker for subtask |
| `swarm_spawn_researcher` | Launch read-only researcher |
| `swarm_review` | Review worker output |
| `swarm_status` | Check epic progress |
| `hive_create_epic` | Create epic with subtasks |
| `hive_query` | Query task database |
| `swarmmail_*` | Inter-agent messaging |

### Worker Tools

| Tool | Purpose |
|------|---------|
| `hivemind_find` | Query learnings before starting |
| `hivemind_store` | Store what you learn |
| `swarm_progress` | Report progress (25/50/75%) |
| `swarm_checkpoint` | Save context before risky ops |
| `swarm_complete` | Signal task completion |
| `hive_update` | Update task status |
| `hive_close` | Close completed task |
| `swarmmail_reserve` | Reserve files exclusively |
| `swarmmail_send` | Message other agents |

## Architecture

```
Coordinator (Opus)
├── Queries hivemind for past learnings
├── Decomposes task into subtasks
├── Spawns workers (Sonnet)
├── Reviews each worker before spawning next
└── Stores coordination learnings

Workers (Sonnet)
├── Query hivemind before starting
├── Reserve files to prevent conflicts
├── Execute scoped subtask
├── Report progress at 25/50/75%
└── Store domain learnings

Researchers (Opus, read-only)
├── Fetch documentation
├── Analyze dependencies
└── Store findings in hivemind
```

## Troubleshooting

### MCP Server Not Connecting

Ensure swarm is installed globally and in your PATH:

```bash
which swarm
swarm mcp-serve  # Should start without errors
```

### Tools Not Available

Check that the MCP server is running:

```bash
claude mcp list
```

The `swarm-tools` server should show as connected.

### File Conflicts

If multiple agents are editing the same file, use file reservations:

```
swarmmail_reserve(paths: ["src/**/*.ts"], exclusive: true)
```

### Context Exhaustion

Use checkpoints before large operations:

```
swarm_checkpoint(reason: "Before refactor")
```

## Development

### Testing Locally

```bash
# From the plugin directory
claude --plugin-dir .
```

### Building

```bash
cd packages/opencode-swarm-plugin
bun run build
```

### Running Tests

```bash
bun test
```

## License

MIT
