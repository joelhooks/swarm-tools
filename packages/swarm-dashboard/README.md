# Swarm Dashboard

Real-time visualization for OpenCode Swarm multi-agent coordination.

## What It Does

The Swarm Dashboard provides live monitoring of distributed agent workflows. It connects to the Swarm Mail SSE server and displays:

- **Active Agents** - Currently registered agents with status indicators
- **Event Stream** - Real-time SSE events with filtering (agent/epic/event type)
- **Cell Hierarchy** - Epic and subtask tree visualization with status

Built for debugging parallel agent execution, tracking file reservations, and understanding swarm coordination patterns.

## Quick Start

```bash
# Development
bun run dev

# Build
bun run build

# Preview production build
bun run preview
```

The dashboard expects the Swarm Mail SSE server running on `http://localhost:3333/sse`. Start it with:

```bash
swarm serve --port 3333
```

## Architecture

- **React 19** with TypeScript
- **Vite** for fast dev/build
- **Tailwind CSS 4** for styling
- **SSE (Server-Sent Events)** for real-time updates
- **swarm-mail** package for event types and utilities

### Key Components

- `useSwarmEvents` - SSE connection hook with auto-reconnect
- `AgentsPane` - Active agent cards with registration status
- `EventsPane` - Filterable event stream with timestamps
- `CellsPane` - Tree view of epics/subtasks (hive cells)

## Event Types

The dashboard consumes events from the Swarm Mail protocol:

- `agent_registered`, `agent_active` - Agent lifecycle
- `message_sent`, `message_read`, `message_acked` - Inter-agent messaging
- `file_reserved`, `file_released` - File lock coordination
- `task_started`, `task_progress`, `task_completed`, `task_blocked` - Task execution
- `decomposition_generated`, `subtask_outcome` - Swarm coordination
- `swarm_checkpointed`, `swarm_recovered` - Persistence events

## Development

```bash
# Type checking
bun run typecheck

# Linting
bun run lint
```

## Related Packages

- `swarm-mail` - Event protocol and SSE server
- `opencode-swarm-plugin` - Claude Code plugin with hive/hivemind tools
- `claude-code-swarm-plugin` - Agent coordination primitives
