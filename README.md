# opencode-swarm-plugin

[![npm version](https://img.shields.io/npm/v/opencode-swarm-plugin.svg)](https://www.npmjs.com/package/opencode-swarm-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-agent swarm coordination for [OpenCode](https://opencode.ai). Break complex tasks into parallel subtasks, spawn agents, coordinate via messaging. The plugin learns from outcomes to improve future decompositions.

## Install

```bash
npm install -g opencode-swarm-plugin
swarm setup
```

That's it. The setup wizard handles everything:

```
┌  opencode-swarm-plugin v0.9.0
│
◇  Checking dependencies...
│
◆  OpenCode
◆  Beads
◆  Go
▲  Agent Mail (optional)
▲  Redis (optional)
│
◆  Install optional dependencies?
│  ◻ Agent Mail - Multi-agent coordination
│  ◻ Redis - Rate limiting
│
◇  Setting up OpenCode integration...
│
◆  Plugin: ~/.config/opencode/plugins/swarm.ts
◆  Command: ~/.config/opencode/commands/swarm.md
◆  Agent: ~/.config/opencode/agents/swarm-planner.md
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
swarm version   Show version
swarm help      Show help
```

### swarm doctor

```
┌  swarm doctor v0.9.0
│
◇  Required dependencies:
│
◆  OpenCode v1.0.134
◆  Beads v0.29.0
│
◇  Optional dependencies:
│
◆  Go v1.25.2 - Required for Agent Mail
▲  Agent Mail - not found
◆  Redis - Rate limiting
│
└  All required dependencies installed. 1 optional missing.
```

### swarm init

```
┌  swarm init v0.9.0
│
◇  Initializing beads...
◆  Created .beads/ directory
│
◆  Create your first bead?
│  ● Yes / ○ No
│
◇  Bead title: Implement user authentication
◇  Type: Feature
│
└  Project initialized!
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

## Dependencies

| Dependency                                                      | Purpose                                     | Required |
| --------------------------------------------------------------- | ------------------------------------------- | -------- |
| [OpenCode](https://opencode.ai)                                 | Plugin host                                 | Yes      |
| [Beads](https://github.com/steveyegge/beads)                    | Git-backed issue tracking                   | Yes      |
| [Go](https://go.dev)                                            | Required for Agent Mail                     | No       |
| [Agent Mail](https://github.com/joelhooks/agent-mail)           | Multi-agent coordination, file reservations | No       |
| [CASS](https://github.com/Dicklesworthstone/cass)               | Historical context from past sessions       | No       |
| [UBS](https://github.com/joelhooks/ubs)                         | Pre-completion bug scanning                 | No       |
| [semantic-memory](https://github.com/joelhooks/semantic-memory) | Learning persistence                        | No       |
| [Redis](https://redis.io)                                       | Rate limiting (SQLite fallback available)   | No       |

All dependencies are checked and can be installed via `swarm setup`.

## Tools Reference

### Swarm

| Tool                           | Description                                                              |
| ------------------------------ | ------------------------------------------------------------------------ |
| `swarm_init`                   | Initialize swarm session                                                 |
| `swarm_select_strategy`        | Analyze task, recommend decomposition strategy (file/feature/risk-based) |
| `swarm_plan_prompt`            | Generate strategy-specific planning prompt with CASS history             |
| `swarm_decompose`              | Generate decomposition prompt                                            |
| `swarm_validate_decomposition` | Validate response, detect file conflicts                                 |
| `swarm_spawn_subtask`          | Generate worker agent prompt with Agent Mail/beads instructions          |
| `swarm_subtask_prompt`         | Alias for spawn_subtask                                                  |
| `swarm_status`                 | Get swarm progress by epic ID                                            |
| `swarm_progress`               | Report subtask progress to coordinator                                   |
| `swarm_complete`               | Complete subtask - runs UBS scan, releases reservations                  |
| `swarm_record_outcome`         | Record outcome for learning (duration, errors, retries)                  |

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
| `beads_link_thread` | Link bead to Agent Mail thread                 |

### Agent Mail

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
| `agentmail_health`           | Check if Agent Mail server is running          |

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
