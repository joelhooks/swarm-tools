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
▲  Agent Mail (optional)
▲  Redis (optional)
│
◆  Install optional dependencies?
│  ◻ Agent Mail - Multi-agent coordination
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

You are a swarm coordinator. Take a complex task, break it into beads,
and unleash parallel agents.

## Usage

/swarm <task description or bead-id>

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

### @swarm-planner Agent

The `@swarm-planner` agent is defined in `~/.config/opencode/agent/swarm-planner.md`:

````markdown
---
name: swarm-planner
description: Strategic task decomposition for swarm coordination
model: claude-sonnet-4-5
---

You are a swarm planner. Decompose tasks into optimal parallel subtasks.

## Workflow

1. Call `swarm_select_strategy` to analyze the task
2. Call `swarm_plan_prompt` to get strategy-specific guidance
3. Create a BeadTree following the guidelines
4. Return ONLY valid JSON - no markdown, no explanation

## Output Format

```json
{
  "epic": { "title": "...", "description": "..." },
  "subtasks": [
    {
      "title": "...",
      "description": "...",
      "files": ["src/..."],
      "dependencies": [],
      "estimated_complexity": 2
    }
  ]
}
```
````

## Rules

- 2-7 subtasks (too few = not parallel, too many = overhead)
- No file overlap between subtasks
- Include tests with the code they test
- Order by dependency (if B needs A, A comes first)

````

Edit these files to customize behavior. Run `swarm setup` to regenerate defaults.

## Dependencies

| Dependency | Purpose | Required |
|------------|---------|----------|
| [OpenCode](https://opencode.ai) | Plugin host | Yes |
| [Beads](https://github.com/steveyegge/beads) | Git-backed issue tracking | Yes |
| [Go](https://go.dev) | Required for Agent Mail | No |
| [Agent Mail](https://github.com/joelhooks/agent-mail) | Multi-agent coordination, file reservations | No |
| [CASS](https://github.com/Dicklesworthstone/cass) | Historical context from past sessions | No |
| [UBS (Ultimate Bug Scanner)](https://github.com/Dicklesworthstone/ultimate_bug_scanner) | Pre-completion bug scanning using AI-powered static analysis | No |
| [semantic-memory](https://github.com/joelhooks/semantic-memory) | Learning persistence | No |
| [Redis](https://redis.io) | Rate limiting (SQLite fallback available) | No |

All dependencies are checked and can be installed via `swarm setup`.

### Installing Optional Dependencies

**UBS (Ultimate Bug Scanner)** - Scans code for bugs before task completion:
```bash
curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/ultimate_bug_scanner/master/install.sh" | bash
```

**CASS** - Cross-agent session search for historical context:
```bash
# See https://github.com/Dicklesworthstone/cass for installation
```

## Tools Reference

### Swarm

| Tool | Description |
|------|-------------|
| `swarm_init` | Initialize swarm session |
| `swarm_select_strategy` | Analyze task, recommend decomposition strategy (file/feature/risk-based) |
| `swarm_plan_prompt` | Generate strategy-specific planning prompt with CASS history |
| `swarm_decompose` | Generate decomposition prompt |
| `swarm_validate_decomposition` | Validate response, detect file conflicts |
| `swarm_spawn_subtask` | Generate worker agent prompt with Agent Mail/beads instructions |
| `swarm_status` | Get swarm progress by epic ID |
| `swarm_progress` | Report subtask progress to coordinator |
| `swarm_complete` | Complete subtask - runs UBS (Ultimate Bug Scanner), releases reservations |
| `swarm_record_outcome` | Record outcome for learning (duration, errors, retries) |

### Beads

| Tool | Description |
|------|-------------|
| `beads_create` | Create bead with type-safe validation |
| `beads_create_epic` | Create epic + subtasks atomically |
| `beads_query` | Query beads with filters (status, type, ready) |
| `beads_update` | Update status/description/priority |
| `beads_close` | Close bead with reason |
| `beads_start` | Mark bead as in-progress |
| `beads_ready` | Get next unblocked bead |
| `beads_sync` | Sync to git and push |
| `beads_link_thread` | Link bead to Agent Mail thread |

### Agent Mail

| Tool | Description |
|------|-------------|
| `agentmail_init` | Initialize session, register agent |
| `agentmail_send` | Send message to agents |
| `agentmail_inbox` | Fetch inbox (max 5, no bodies - context safe) |
| `agentmail_read_message` | Fetch single message body by ID |
| `agentmail_summarize_thread` | Summarize thread (preferred over fetching all) |
| `agentmail_reserve` | Reserve file paths for exclusive editing |
| `agentmail_release` | Release file reservations |
| `agentmail_ack` | Acknowledge message |
| `agentmail_search` | Search messages by keyword |
| `agentmail_health` | Check if Agent Mail server is running |

### Structured Output

| Tool | Description |
|------|-------------|
| `structured_extract_json` | Extract JSON from markdown/text (multiple strategies) |
| `structured_validate` | Validate response against schema |
| `structured_parse_evaluation` | Parse self-evaluation response |
| `structured_parse_decomposition` | Parse task decomposition response |
| `structured_parse_bead_tree` | Parse bead tree for epic creation |

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

| Mechanism | How It Works |
|-----------|--------------|
| Confidence decay | Criteria weights fade unless revalidated (90-day half-life) |
| Implicit feedback | Fast + success = helpful signal, slow + errors = harmful |
| Pattern maturity | candidate → established → proven (or deprecated) |
| Anti-patterns | Patterns with >60% failure rate auto-invert |

## Context Preservation

Hard limits to prevent context exhaustion:

| Constraint | Default | Reason |
|------------|---------|--------|
| Inbox limit | 5 messages | Prevents token burn |
| Bodies excluded | Always | Fetch individually when needed |
| Summarize preferred | Yes | Key points, not raw dump |

## Rate Limiting

Client-side limits (Redis primary, SQLite fallback):

| Endpoint | Per Minute | Per Hour |
|----------|------------|----------|
| send | 20 | 200 |
| reserve | 10 | 100 |
| inbox | 60 | 600 |

Configure via `OPENCODE_RATE_LIMIT_{ENDPOINT}_PER_MIN` env vars.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
````

## License

MIT
