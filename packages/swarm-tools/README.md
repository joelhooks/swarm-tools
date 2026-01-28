# Clawdbot Swarm Plugin

Multi-agent swarm coordination for Clawdbot with hivemind memory, cells, and parallel workflows.

## What It Does

- **Hivemind Memory**: Semantic memory that persists across sessions
- **Cells (Hive)**: Track tasks, bugs, features with status
- **Swarm Coordination**: Decompose tasks, spawn workers, coordinate parallel work
- **Lifecycle Hooks**: Automatic context injection and preservation

## Installation

```bash
# Install swarm CLI (required)
npm install -g @opencode/swarm

# Install plugin
clawdbot plugins install clawdbot-swarm-plugin
```

## Configuration

Add to `~/.clawdbot/clawdbot.json`:

```json
{
  "plugins": {
    "entries": {
      "swarm-tools": {
        "enabled": true,
        "autoQueryHivemind": true,
        "autoStoreOnCompaction": true,
        "truncateToolResults": true,
        "maxToolResultLines": 100
      }
    }
  }
}
```

## Features

### Automatic Context Injection

On every agent start, hivemind is queried for relevant prior learnings:

```
before_agent_start → hivemind_find(session context) → inject into system prompt
```

### Compaction Survival

Before context compaction, important state is saved:

```
before_compaction → hivemind_store(session summary) → persists across sessions
```

### Tool Result Truncation

Large Bash/Read outputs are truncated to save context:

```
tool_result_persist → truncate to maxToolResultLines → keep head + tail
```

## Tools

### Hive (Task Tracking)
- `hive_cells` - List/filter cells
- `hive_create` - Create a cell (task/bug/feature)
- `hive_create_epic` - Create epic with subtasks
- `hive_update` - Update cell status
- `hive_close` - Close cell with reason
- `hive_ready` - Get next unblocked cell

### Hivemind (Memory)
- `hivemind_find` - Semantic search
- `hivemind_store` - Store learning
- `hivemind_get` - Get by ID
- `hivemind_stats` - Memory stats

### Swarmmail (Coordination)
- `swarmmail_init` - Initialize agent session
- `swarmmail_reserve` - Reserve files exclusively
- `swarmmail_release` - Release reservations
- `swarmmail_send` - Message other agents
- `swarmmail_inbox` - Check messages

### Swarm (Orchestration)
- `swarm_decompose` - Get decomposition prompt
- `swarm_spawn_subtask` - Prepare worker prompt
- `swarm_progress` - Report progress
- `swarm_complete` - Mark task complete
- `swarm_review` - Generate review prompt
- `swarm_status` - Swarm status

## CLI Commands

```bash
# Check swarm status
clawdbot swarm status

# List open cells
clawdbot swarm cells

# Search memory
clawdbot swarm memory "auth patterns" --limit 5
```

## Workflow: Running a Swarm

```
User: /swarm "add user auth"
       ↓
Coordinator: swarm_decompose → hive_create_epic
       ↓
Coordinator: swarm_spawn_subtask × N → parallel workers
       ↓
Workers: swarmmail_reserve → work → hivemind_store → swarm_complete
       ↓
Coordinator: swarm_review → merge → ship
```

## Architecture

```
┌─────────────────┐
│    Clawdbot     │
│    Gateway      │
└────────┬────────┘
         │
    ┌────▼────┐
    │ Plugin  │ ← api.registerTool(), api.on(hook)
    └────┬────┘
         │ exec("swarm tool <name> --json")
    ┌────▼────┐
    │  swarm  │ ← CLI (source of truth)
    │   CLI   │
    └────┬────┘
         │
    ┌────▼────────────────┐
    │ ~/.config/swarm.db  │ ← shared global state
    │ ├── Hive (cells)    │
    │ ├── Hivemind (mem)  │
    │ └── Swarmmail       │
    └─────────────────────┘
```

## License

MIT
