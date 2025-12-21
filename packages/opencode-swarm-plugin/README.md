# opencode-swarm-plugin

OpenCode plugin for multi-agent swarm coordination with learning capabilities.

**🌐 Website:** [swarmtools.ai](https://swarmtools.ai)  
**📚 Full Documentation:** [swarmtools.ai/docs](https://swarmtools.ai/docs)

```
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
```

## Install

```bash
# Install
npm install -g opencode-swarm-plugin@latest
swarm setup

# For semantic memory (optional but recommended)
brew install ollama
ollama serve &
ollama pull mxbai-embed-large
```

> *"High-variability sequencing of whole-task problems."*  
> — 4C/ID Instructional Design Model

## Features

- **Swarm Coordination** - Break tasks into parallel subtasks, spawn worker agents
- **Hive Integration** - Git-backed work item tracking with atomic epic creation
- **Agent Mail** - Inter-agent messaging with file reservations
- **Learning System** - Pattern maturity, anti-pattern detection, confidence decay
- **Skills System** - Knowledge injection with bundled and custom skills
- **Checkpoint & Recovery** - Auto-checkpoint at 25/50/75%, survive context death (9 integration tests ✅)

## Usage

```bash
/swarm "Add user authentication with OAuth"
```

## Tools Provided

### Hive (Work Item Tracking)

| Tool               | Purpose                               |
| ------------------ | ------------------------------------- |
| `hive_create`      | Create cell with type-safe validation |
| `hive_create_epic` | Atomic epic + subtasks creation       |
| `hive_query`       | Query with filters                    |
| `hive_update`      | Update status/description/priority    |
| `hive_close`       | Close with reason                     |
| `hive_start`       | Mark in-progress                      |
| `hive_ready`       | Get next unblocked cell               |
| `hive_sync`        | Sync to git                           |

> **Migration Note:** `beads_*` tools still work but show deprecation warnings. Update to `hive_*` tools.

### Swarm Mail (Agent Coordination)

| Tool                     | Purpose                          |
| ------------------------ | -------------------------------- |
| `swarmmail_init`         | Initialize session               |
| `swarmmail_send`         | Send message to agents           |
| `swarmmail_inbox`        | Fetch inbox (context-safe)       |
| `swarmmail_read_message` | Fetch one message body           |
| `swarmmail_reserve`      | Reserve files for exclusive edit |
| `swarmmail_release`      | Release reservations             |

### Swarm (Task Orchestration)

| Tool                           | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `swarm_select_strategy`        | Analyze task, recommend strategy                |
| `swarm_decompose`              | Generate decomposition prompt (queries CASS)    |
| `swarm_delegate_planning`      | Delegate planning to planner subagent           |
| `swarm_validate_decomposition` | Validate response, detect conflicts             |
| `swarm_plan_prompt`            | Generate strategy-specific decomposition prompt |
| `swarm_subtask_prompt`         | Generate worker agent prompt                    |
| `swarm_spawn_subtask`          | Prepare subtask for Task tool spawning          |
| `swarm_evaluation_prompt`      | Generate self-evaluation prompt                 |
| `swarm_init`                   | Initialize swarm session                        |
| `swarm_status`                 | Get swarm progress by epic ID                   |
| `swarm_progress`               | Report subtask progress to coordinator          |
| `swarm_complete`               | Complete subtask (releases reservations)        |
| `swarm_record_outcome`         | Record outcome for learning                     |
| `swarm_checkpoint`             | Save progress snapshot (auto at 25/50/75%)      |
| `swarm_recover`                | Resume from checkpoint (returns full context)   |
| `swarm_learn`                  | Extract learnings from outcome                  |
| `swarm_broadcast`              | Send message to all active agents               |
| `swarm_accumulate_error`       | Track recurring errors (3-strike system)        |
| `swarm_check_strikes`          | Check if error threshold reached                |
| `swarm_get_error_context`      | Get context for error pattern                   |
| `swarm_resolve_error`          | Mark error pattern as resolved                  |

### Skills (Knowledge Injection)

| Tool            | Purpose                 |
| --------------- | ----------------------- |
| `skills_list`   | List available skills   |
| `skills_use`    | Load skill into context |
| `skills_read`   | Read skill content      |
| `skills_create` | Create new skill        |

## Checkpoint & Recovery

Ensures work survives context compaction or crashes. Proven by 9 integration tests.

### Auto-Checkpoint Milestones

When `swarm_progress` reports 25%, 50%, or 75% completion, a checkpoint is automatically saved to libSQL:

```typescript
// Stored in system temp directory (no external database needed)
{
  epic_id: "hv-123",
  cell_id: "hv-123.1",
  strategy: "file-based",
  files: ["src/auth.ts", "src/middleware.ts"],
  progress_percent: 50,
  directives: {
    shared_context: "OAuth implementation notes",
    skills_to_load: ["testing-patterns"],
    coordinator_notes: "Watch for race conditions"
  },
  recovery: {
    last_checkpoint: 1234567890,
    files_modified: ["src/auth.ts"],
    error_context: "Optional: error details if checkpoint during error"
  }
}
```

### Tools

**swarm_checkpoint** - Manually save a checkpoint:
```typescript
swarm_checkpoint({
  project_key: "/abs/path",
  agent_name: "WorkerA",
  cell_id: "hv-123.1",
  epic_id: "hv-123",
  files_modified: ["src/auth.ts"],
  progress_percent: 30,
  directives: { shared_context: "..." },
  error_context: "Optional"
})
```

**swarm_recover** - Resume from last checkpoint:
```typescript
swarm_recover({
  project_key: "/abs/path",
  epic_id: "hv-123"
})
// Returns:
// {
//   found: true,
//   context: { epic_id, cell_id, files, strategy, directives, recovery },
//   age_seconds: 120
// }
```

### Failure Handling

Checkpoint failures are **non-fatal**—work continues even if checkpointing fails. Prevents infrastructure from blocking actual work.

## Bundled Skills

Located in `global-skills/`:

- **testing-patterns** - 25 dependency-breaking techniques, characterization tests
- **swarm-coordination** - Multi-agent decomposition, file reservations
- **cli-builder** - Argument parsing, help text, subcommands
- **system-design** - Architecture decisions, module boundaries
- **learning-systems** - Confidence decay, pattern maturity
- **skill-creator** - Meta-skill for creating new skills

## Architecture

```
src/
├── hive.ts            # Hive integration (work item tracking)
├── agent-mail.ts      # Agent Mail tools (legacy MCP wrapper)
├── swarm-mail.ts      # Swarm Mail tools (new, uses swarm-mail package)
├── swarm.ts           # Swarm orchestration tools
├── swarm-orchestrate.ts # Coordinator logic
├── swarm-decompose.ts # Decomposition strategies
├── swarm-strategies.ts # Strategy selection
├── skills.ts          # Skills system
├── learning.ts        # Pattern maturity, outcomes
├── anti-patterns.ts   # Anti-pattern detection
├── structured.ts      # JSON parsing utilities
├── mandates.ts        # Mandate system
└── schemas/           # Zod schemas
```

## Dependencies

### Required

| Dependency | Purpose |
|------------|---------|
| [OpenCode](https://opencode.ai) | AI coding agent (the plugin runs inside OpenCode) |

### Required for Semantic Memory

| Dependency | Purpose | Install |
|------------|---------|---------|
| [Ollama](https://ollama.ai) | Embedding model for semantic memory | `brew install ollama && ollama serve & && ollama pull mxbai-embed-large` |

### Optional (Highly Recommended)

These tools significantly enhance the swarm experience:

| Tool | Purpose | Install |
|------|---------|---------|
| [CASS](https://github.com/Dicklesworthstone/coding_agent_session_search) | Historical context - queries past sessions for similar decompositions | See below |
| [UBS](https://github.com/Dicklesworthstone/ultimate_bug_scanner) | Bug scanning - runs on subtask completion to catch issues | See below |

> **Note:** Semantic memory is now embedded in the plugin. No separate installation needed - just install Ollama for vector embeddings.

#### Installing CASS

```bash
# Clone and install
git clone https://github.com/Dicklesworthstone/coding_agent_session_search
cd coding_agent_session_search
pip install -e .

# Build the index (run periodically to index new sessions)
cass index
```

#### Installing UBS

```bash
# Clone and install
git clone https://github.com/Dicklesworthstone/ultimate_bug_scanner
cd ultimate_bug_scanner
pip install -e .
```

**Why install these?**

- **CASS** - When you run `/swarm "Add OAuth"`, the coordinator queries CASS for similar past tasks. Without it, decomposition is based only on the current task description.
- **UBS** - Run manually on code to catch bugs before commit. Not integrated into swarm workflow but recommended for pre-commit validation.
- **Ollama** - Enables vector similarity search for semantic memory. Without it, memory falls back to full-text search (still functional, less semantic).

Run `swarm doctor` to check which dependencies are installed.

### npm Dependencies

- [swarm-mail](../swarm-mail) - Event sourcing primitives (workspace dependency)
- [@opencode-ai/plugin](https://www.npmjs.com/package/@opencode-ai/plugin) - OpenCode plugin API
- [effect](https://effect.website) - Effect-TS for type-safe composition
- [zod](https://zod.dev) - Schema validation

## Development

```bash
# From monorepo root
bun turbo build --filter=opencode-swarm-plugin
bun turbo test --filter=opencode-swarm-plugin
bun turbo typecheck --filter=opencode-swarm-plugin

# Or from this directory
bun run build
bun test
bun run typecheck
```

## CLI

```bash
swarm setup     # Install and configure
swarm doctor    # Check dependencies
swarm init      # Initialize hive in project
swarm config    # Show config file paths
```

## Roadmap

### Planned Features

- **Enhanced Learning** - Pattern extraction from successful/failed decompositions
- **Swarm Observability** - Real-time visualization of agent coordination
- **Advanced Strategies** - Risk-based decomposition, critical path optimization
- **Multi-Project Coordination** - Cross-repo dependencies and shared context
- **Learning Export/Import** - Share pattern maturity across teams

### Experimental

- **Auto-healing Swarms** - Agents detect and recover from blockers autonomously
- **Semantic Code Search** - Vector-based codebase exploration for decomposition context
- **Prevention Pipeline Integration** - Auto-generate prevention patterns from debug sessions

See [swarmtools.ai/docs](https://swarmtools.ai/docs) for latest updates and detailed guides.

## License

MIT
