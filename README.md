# opencode-swarm-plugin

[![npm version](https://img.shields.io/npm/v/opencode-swarm-plugin.svg)](https://www.npmjs.com/package/opencode-swarm-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

```
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝

    \ ` - ' /
   - .(o o). -
    (  >.<  )        Multi-agent coordination for OpenCode
     /|   |\         Break complex tasks into parallel subtasks,
    (_|   |_)        spawn agents, coordinate via messaging.
      bzzzz...       The plugin learns from outcomes.
```

## Install

```bash
npm install -g opencode-swarm-plugin@latest
swarm setup
```

The setup wizard handles everything:

```
┌  opencode-swarm-plugin v0.10.0
│
◇  Checking dependencies...
│
◆  OpenCode
◆  Beads
◆  Go
▲  Swarm Mail (optional)
▲  Redis (optional)
│
◆  Install optional dependencies?
│  ◻ Swarm Mail - Multi-agent coordination
│  ◻ Redis - Rate limiting
│
◇  Setting up OpenCode integration...
│
◆  Plugin: ~/.config/opencode/plugin/swarm.ts
◆  Command: ~/.config/opencode/command/swarm.md
◆  Agent: ~/.config/opencode/agent/swarm-planner.md
│
└  Setup complete!
```

Then in your project:

```bash
cd your-project
swarm init
```

## CLI

```
swarm setup     Interactive installer - checks and installs all dependencies
swarm doctor    Health check - shows status of all dependencies
swarm init      Initialize beads in current project
swarm config    Show paths to generated config files
swarm version   Show version and banner
swarm help      Show help
```

## Usage

In OpenCode:

```
/swarm "Add user authentication with OAuth"
```

Or invoke the planner directly:

```
@swarm-planner "Refactor all components to use hooks"
```

## Customization

Run `swarm config` to see your config file paths:

```
🔌 Plugin loader
   ~/.config/opencode/plugin/swarm.ts

📜 /swarm command prompt
   ~/.config/opencode/command/swarm.md

🤖 @swarm-planner agent
   ~/.config/opencode/agent/swarm-planner.md
```

### /swarm Command

The `/swarm` command is defined in `~/.config/opencode/command/swarm.md`:

```markdown
---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Decompose the task into beads and spawn parallel agents.

## Task

$ARGUMENTS

## Workflow

1. **Initialize**: `agentmail_init` with project_path and task_description
2. **Decompose**: Use `swarm_select_strategy` then `swarm_plan_prompt`
3. **Create beads**: `beads_create_epic` with subtasks and file assignments
4. **Reserve files**: `agentmail_reserve` for each subtask's files
5. **Spawn agents**: Use Task tool with `swarm_spawn_subtask` prompts
6. **Monitor**: Check `agentmail_inbox` for progress
7. **Complete**: `swarm_complete` when done, then `beads_sync` to push

## Strategy Selection

| Strategy      | Best For                | Keywords                              |
| ------------- | ----------------------- | ------------------------------------- |
| file-based    | Refactoring, migrations | refactor, migrate, rename, update all |
| feature-based | New features            | add, implement, build, create         |
| risk-based    | Bug fixes, security     | fix, bug, security, critical, urgent  |

Begin decomposition now.
```

> **Note**: The `$ARGUMENTS` placeholder captures everything you type after `/swarm`. This is how your task description gets passed to the agent.

### Agents

The setup wizard creates two agents with your chosen models:

**@swarm-planner** (`~/.config/opencode/agent/swarm-planner.md`) - Coordinator that decomposes tasks:

```yaml
---
name: swarm-planner
description: Strategic task decomposition for swarm coordination
model: anthropic/claude-sonnet-4-5 # Your chosen coordinator model
---
```

**@swarm-worker** (`~/.config/opencode/agent/swarm-worker.md`) - Fast executor for subtasks:

```yaml
---
name: swarm-worker
description: Executes subtasks in a swarm - fast, focused, cost-effective
model: anthropic/claude-haiku-4-5 # Your chosen worker model
---
```

### Decomposition Rules

- **2-7 subtasks** - Too few = not parallel, too many = coordination overhead
- **No file overlap** - Each file appears in exactly one subtask
- **Include tests** - Put test files with the code they test
- **Order by dependency** - If B needs A's output, A comes first (lower index)

Edit these files to customize behavior. Run `swarm setup` to regenerate defaults.

## Skills

Skills are reusable knowledge packages that agents can load on-demand. They contain domain expertise, workflows, and patterns that help agents perform specialized tasks.

### Using Skills

```bash
# List available skills
swarm tool skills_list

# Read a skill's content
swarm tool skills_read --json '{"name": "debugging"}'

# Use a skill (get formatted for context injection)
swarm tool skills_use --json '{"name": "code-review", "context": "reviewing a PR"}'
```

In OpenCode, agents can use skills directly:

```
skills_list()                           # See what's available
skills_use(name="debugging")            # Load debugging patterns
skills_use(name="swarm-coordination")   # Load swarm workflow
```

### Bundled Skills

| Skill                | Tags                 | Description                                                                          |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `cli-builder`        | cli, typescript, bun | Building TypeScript CLIs with Bun - argument parsing, subcommands, output formatting |
| `learning-systems`   | learning, feedback   | Implicit feedback scoring, confidence decay, anti-pattern detection                  |
| `mcp-tool-authoring` | mcp, tools           | Building MCP tools - schema definition, context passing, error handling              |
| `skill-creator`      | meta, skills         | Guide for creating effective skills                                                  |
| `swarm-coordination` | swarm, multi-agent   | Complete swarm playbook - strategies, coordinator patterns, failure recovery         |
| `system-design`      | design, architecture | Building reusable systems - deep modules, complexity management, design red flags    |

### Skill Locations

Skills are loaded from three locations (in order):

1. **Project skills**: `.opencode/skills/`, `.claude/skills/`, or `skills/`
2. **Global skills**: `~/.config/opencode/skills/`
3. **Bundled skills**: Included with the plugin

### Creating Skills

```bash
# Initialize project skills directory
swarm tool skills_init

# Create a new skill
swarm tool skills_create --json '{"name": "my-skill", "description": "What it does", "tags": ["tag1", "tag2"]}'
```

Or use the `skill-creator` skill for guidance:

```
skills_use(name="skill-creator")
```

Each skill is a directory containing:

```
my-skill/
  SKILL.md           # Main content (required)
  references/        # Optional supporting files
    patterns.md
    examples.md
```

### SKILL.md Format

```markdown
---
name: my-skill
description: Brief description for discovery
tags:
  - tag1
  - tag2
---

# My Skill

## When to Use

- Trigger condition 1
- Trigger condition 2

## Patterns

### Pattern Name

Description and examples...

## Anti-Patterns

What NOT to do...
```

## Dependencies

| Dependency                                                                                             | Purpose                                                                                                | Required |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------- |
| [OpenCode](https://opencode.ai)                                                                        | Plugin host                                                                                            | Yes      |
| [Beads](https://github.com/steveyegge/beads)                                                           | Git-backed issue tracking                                                                              | Yes      |
| [Go](https://go.dev)                                                                                   | Required for Swarm Mail                                                                                | No       |
| [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail) ⭐                               | **The original** - Multi-agent coordination, file reservations. Swarm Mail is built on these patterns. | No       |
| [CASS (Coding Agent Session Search)](https://github.com/Dicklesworthstone/coding_agent_session_search) | Historical context from past sessions                                                                  | No       |
| [UBS (Ultimate Bug Scanner)](https://github.com/Dicklesworthstone/ultimate_bug_scanner)                | Pre-completion bug scanning using AI-powered static analysis                                           | No       |
| [semantic-memory](https://github.com/joelhooks/semantic-memory)                                        | Learning persistence                                                                                   | No       |
| [Redis](https://redis.io)                                                                              | Rate limiting (SQLite fallback available)                                                              | No       |

All dependencies are checked and can be installed via `swarm setup`.

### Installing Optional Dependencies

**UBS (Ultimate Bug Scanner)** - Scans code for bugs before task completion:

```bash
curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/ultimate_bug_scanner/master/install.sh" | bash
```

**CASS (Coding Agent Session Search)** - Indexes and searches AI coding agent history:

```bash
curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/coding_agent_session_search/main/install.sh | bash -s -- --easy-mode
```

**MCP Agent Mail** ⭐ - The original multi-agent coordination system. Swarm Mail's embedded implementation is inspired by and compatible with MCP Agent Mail's protocol:

```bash
curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/mcp_agent_mail/main/scripts/install.sh" | bash -s -- --yes
```

> **Note:** The embedded Swarm Mail (PGLite in-process) is now the primary option and works out of the box with no external dependencies. MCP Agent Mail (external Go server) is still supported for advanced use cases requiring a separate server process.

## Tools Reference

### Swarm

| Tool                           | Description                                                               |
| ------------------------------ | ------------------------------------------------------------------------- |
| `swarm_init`                   | Initialize swarm session                                                  |
| `swarm_select_strategy`        | Analyze task, recommend decomposition strategy (file/feature/risk-based)  |
| `swarm_plan_prompt`            | Generate strategy-specific planning prompt with CASS history              |
| `swarm_decompose`              | Generate decomposition prompt                                             |
| `swarm_validate_decomposition` | Validate response, detect file conflicts                                  |
| `swarm_spawn_subtask`          | Generate worker agent prompt with Swarm Mail/beads instructions           |
| `swarm_status`                 | Get swarm progress by epic ID                                             |
| `swarm_progress`               | Report subtask progress to coordinator                                    |
| `swarm_complete`               | Complete subtask - runs UBS (Ultimate Bug Scanner), releases reservations |
| `swarm_record_outcome`         | Record outcome for learning (duration, errors, retries)                   |

### Beads

| Tool                | Description                                    |
| ------------------- | ---------------------------------------------- |
| `beads_create`      | Create bead with type-safe validation          |
| `beads_create_epic` | Create epic + subtasks atomically              |
| `beads_query`       | Query beads with filters (status, type, ready) |
| `beads_update`      | Update status/description/priority             |
| `beads_close`       | Close bead with reason                         |
| `beads_start`       | Mark bead as in-progress                       |
| `beads_ready`       | Get next unblocked bead                        |
| `beads_sync`        | Sync to git and push                           |
| `beads_link_thread` | Link bead to Swarm Mail thread                 |

### Swarm Mail (Embedded - Primary)

| Tool                     | Description                                   |
| ------------------------ | --------------------------------------------- |
| `swarmmail_init`         | Initialize session, register agent            |
| `swarmmail_send`         | Send message to agents                        |
| `swarmmail_inbox`        | Fetch inbox (max 5, no bodies - context safe) |
| `swarmmail_read_message` | Fetch single message body by ID               |
| `swarmmail_reserve`      | Reserve file paths for exclusive editing      |
| `swarmmail_release`      | Release file reservations                     |
| `swarmmail_ack`          | Acknowledge message                           |
| `swarmmail_health`       | Check embedded database health                |

### Agent Mail (Legacy MCP - Optional)

| Tool                         | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `agentmail_init`             | Initialize session, register agent             |
| `agentmail_send`             | Send message to agents                         |
| `agentmail_inbox`            | Fetch inbox (max 5, no bodies - context safe)  |
| `agentmail_read_message`     | Fetch single message body by ID                |
| `agentmail_summarize_thread` | Summarize thread (preferred over fetching all) |
| `agentmail_reserve`          | Reserve file paths for exclusive editing       |
| `agentmail_release`          | Release file reservations                      |
| `agentmail_ack`              | Acknowledge message                            |
| `agentmail_search`           | Search messages by keyword                     |
| `agentmail_health`           | Check if MCP Agent Mail server is running      |

## Event-Sourced Architecture (Embedded)

> **🙏 Built on the shoulders of giants**
>
> The Swarm Mail system is deeply inspired by and builds upon [**MCP Agent Mail**](https://github.com/Dicklesworthstone/mcp_agent_mail) by [@Dicklesworthstone](https://github.com/Dicklesworthstone). The original MCP Agent Mail pioneered multi-agent coordination patterns including file reservations, thread-based messaging, and agent registration - concepts that form the foundation of this embedded implementation.
>
> If you need a production-ready, battle-tested solution with a full Go server, **use MCP Agent Mail directly**. This embedded version is an experimental alternative that trades the external server for in-process PGLite, optimized for single-machine development workflows.
>
> **Key contributions from MCP Agent Mail:**
>
> - File reservation protocol with conflict detection
> - Agent registration and heartbeat patterns
> - Thread-based message organization
> - Importance levels and acknowledgment tracking
>
> Thank you to the MCP Agent Mail team for open-sourcing such a well-designed system.

The plugin includes an embedded event-sourced Swarm Mail implementation as an alternative to the external MCP server. This provides the same multi-agent coordination capabilities without requiring a separate server process.

### Architecture Comparison

**MCP-based (external):**

```
plugin tools → HTTP → MCP Server (Go process) → SQLite
```

**Event-sourced (embedded):**

```
plugin tools → streams/agent-mail.ts → streams/store.ts → PGLite (in-process)
                                             ↓
                                    streams/projections.ts
                                             ↓
                              Materialized views (agents, messages, reservations)
                                             ↓
                                        Fast reads
```

### Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Plugin Tools Layer                        │
│  (agentmail_init, agentmail_send, agentmail_reserve, etc.)      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     streams/agent-mail.ts                        │
│                    (High-level API wrapper)                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       streams/events.ts                          │
│        11 event types: agent_registered, message_sent,          │
│     file_reserved, message_read, message_acked, etc.            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        streams/store.ts                          │
│              Append-only event log (PGLite storage)             │
│       appendEvent() • readEvents() • replayEvents()             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     streams/projections.ts                       │
│                  Build materialized views from events            │
│    getAgents() • getInbox() • getActiveReservations()           │
│              checkConflicts() • threadStats()                    │
└─────────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Materialized Tables (Derived State)                │
│     agents • messages • reservations • message_reads            │
│              (Rebuilt by replaying event log)                   │
└─────────────────────────────────────────────────────────────────┘
```

### Module Descriptions

| Module                     | Responsibility                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| **streams/events.ts**      | Zod schemas for 11 event types (agent_registered, message_sent, file_reserved, task_progress, etc) |
| **streams/store.ts**       | Append-only event log with PGLite backend (appendEvent, readEvents, replayEvents)                  |
| **streams/projections.ts** | Materialize views from events (getAgents, getInbox, checkConflicts, threadStats)                   |
| **streams/agent-mail.ts**  | High-level API matching MCP interface (initAgent, sendAgentMessage, reserveAgentFiles)             |
| **streams/debug.ts**       | Debugging utilities (debugEvents, debugAgent, debugMessage, inspectState)                          |

### Key Benefits

- **No external dependencies** - Runs in-process with PGLite (Postgres compiled to WASM)
- **Full audit trail** - Every state change is an immutable event
- **Crash recovery** - Rebuild state by replaying events from log
- **Time-travel debugging** - Replay events up to any point in time
- **Testability** - 127 tests passing across streams module
- **Durable Streams protocol** - Inspired by Electric SQL's event sourcing patterns

### Event Types

The system emits 11 event types tracked in `streams/events.ts`:

| Event              | Triggered By                          |
| ------------------ | ------------------------------------- |
| `agent_registered` | Agent initialization                  |
| `message_sent`     | Sending inter-agent message           |
| `file_reserved`    | Reserving files for exclusive editing |
| `file_released`    | Releasing file reservations           |
| `message_read`     | Reading a message                     |
| `message_acked`    | Acknowledging a message               |
| `task_started`     | Starting work on a bead               |
| `task_progress`    | Reporting progress update             |
| `task_completed`   | Completing a bead                     |
| `task_blocked`     | Marking a task as blocked             |
| `agent_active`     | Agent heartbeat/keep-alive            |

### Materialized Views

Projections build these derived tables from the event log:

| View            | Contains                                               |
| --------------- | ------------------------------------------------------ |
| `agents`        | Registered agents with metadata and last activity      |
| `messages`      | All inter-agent messages with thread/importance        |
| `reservations`  | Active file reservations with TTL and exclusivity flag |
| `message_reads` | Read receipts for message tracking                     |

State is always derived - delete the tables and replay events to rebuild.

### Structured Output

| Tool                             | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
| `structured_extract_json`        | Extract JSON from markdown/text (multiple strategies) |
| `structured_validate`            | Validate response against schema                      |
| `structured_parse_evaluation`    | Parse self-evaluation response                        |
| `structured_parse_decomposition` | Parse task decomposition response                     |
| `structured_parse_bead_tree`     | Parse bead tree for epic creation                     |

## Decomposition Strategies

### File-Based

Best for: refactoring, migrations, pattern changes

- Group files by directory or type
- Handle shared types/utilities first
- Minimize cross-directory dependencies

**Keywords**: refactor, migrate, rename, update all, replace

### Feature-Based

Best for: new features, adding functionality

- Each subtask is a complete vertical slice
- Start with data layer, then logic, then UI
- Keep related components together

**Keywords**: add, implement, build, create, feature

### Risk-Based

Best for: bug fixes, security issues

- Write tests FIRST
- Isolate risky changes
- Audit similar code for same issue

**Keywords**: fix, bug, security, critical, urgent

## Learning

The plugin learns from outcomes:

| Mechanism         | How It Works                                                |
| ----------------- | ----------------------------------------------------------- |
| Confidence decay  | Criteria weights fade unless revalidated (90-day half-life) |
| Implicit feedback | Fast + success = helpful signal, slow + errors = harmful    |
| Pattern maturity  | candidate → established → proven (or deprecated)            |
| Anti-patterns     | Patterns with >60% failure rate auto-invert                 |

## Context Preservation

Hard limits to prevent context exhaustion:

| Constraint          | Default    | Reason                         |
| ------------------- | ---------- | ------------------------------ |
| Inbox limit         | 5 messages | Prevents token burn            |
| Bodies excluded     | Always     | Fetch individually when needed |
| Summarize preferred | Yes        | Key points, not raw dump       |

## Rate Limiting

Client-side limits (Redis primary, SQLite fallback):

| Endpoint | Per Minute | Per Hour |
| -------- | ---------- | -------- |
| send     | 20         | 200      |
| reserve  | 10         | 100      |
| inbox    | 60         | 600      |

Configure via `OPENCODE_RATE_LIMIT_{ENDPOINT}_PER_MIN` env vars.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

MIT
