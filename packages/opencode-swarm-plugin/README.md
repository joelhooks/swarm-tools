# opencode-swarm-plugin

**Multi-agent swarm coordination for OpenCode - break tasks into parallel subtasks, spawn worker agents, learn from outcomes.**

**🌐 Website:** [swarmtools.ai](https://swarmtools.ai)  
**📚 Full Documentation:** [swarmtools.ai/docs](https://swarmtools.ai/docs)

[![Eval Gate](https://github.com/joelhooks/opencode-swarm-plugin/actions/workflows/eval-gate.yml/badge.svg)](https://github.com/joelhooks/opencode-swarm-plugin/actions/workflows/eval-gate.yml)

```
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
```

## Quickstart (<2 minutes)

### 1. Install

```bash
npm install -g opencode-swarm-plugin@latest
swarm setup
```

### 2. Initialize in Your Project

```bash
cd your-project
swarm init
```

### 3. Run Your First Swarm

```bash
# Inside OpenCode
/swarm "Add user authentication with OAuth"
```

**What happens:**
- Task decomposed into parallel subtasks (coordinator queries past similar tasks)
- Worker agents spawn with file reservations
- Progress tracked with auto-checkpoints at 25/50/75%
- Completion runs bug scans, releases file locks, records learnings

Done. You're swarming.

---

## How Swarms Get Smarter Over Time

Swarms learn from outcomes. Every completed subtask records what worked and what failed - then injects that wisdom into future prompts.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SWARM LEARNING LOOP                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐         │
│   │  TASK    │───▶│ DECOMPOSE│───▶│  EXECUTE │───▶│ COMPLETE │         │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘         │
│        ▲               │               │               │                │
│        │               ▼               ▼               ▼                │
│        │         ┌─────────────────────────────────────────┐            │
│        │         │           EVENT STORE                   │            │
│        │         │  subtask_outcome, eval_finalized, ...   │            │
│        │         └─────────────────────────────────────────┘            │
│        │                           │                                    │
│        │                           ▼                                    │
│        │         ┌─────────────────────────────────────────┐            │
│        │         │         INSIGHTS LAYER                  │            │
│        │         │  Strategy | File | Pattern insights     │            │
│        │         └─────────────────────────────────────────┘            │
│        │                           │                                    │
│        └───────────────────────────┘                                    │
│                  (injected into next decomposition)                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Insights Layer

**swarm-insights** (`src/swarm-insights.ts`) is the data aggregation layer that queries historical outcomes and semantic memory to provide context-efficient summaries for coordinator and worker agents.

**Three insight types:**

| Type | What It Tracks | Used By |
|------|----------------|---------|
| **StrategyInsight** | Success rates by decomposition strategy (file-based, feature-based, risk-based) | Coordinators |
| **FileInsight** | File-specific failure patterns and gotchas from past subtasks | Workers |
| **PatternInsight** | Common failure patterns across all subtasks (type errors, timeouts, conflicts) | Coordinators |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐   │
│  │   Event Store   │     │ Semantic Memory │     │  Anti-Patterns  │   │
│  │  (libSQL)       │     │  (Ollama/FTS)   │     │  (Registry)     │   │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘   │
│           │                       │                       │            │
│           ▼                       ▼                       ▼            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    INSIGHTS AGGREGATION                         │   │
│  │                                                                 │   │
│  │  getStrategyInsights()  getFileInsights()  getPatternInsights() │   │
│  │         │                      │                    │           │   │
│  │         └──────────────────────┼────────────────────┘           │   │
│  │                                ▼                                │   │
│  │                    formatInsightsForPrompt()                    │   │
│  │                    (token-budgeted output)                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                   │                                    │
│           ┌───────────────────────┼───────────────────────┐            │
│           ▼                       ▼                       ▼            │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐   │
│  │   Coordinator   │     │     Worker      │     │     Worker      │   │
│  │   (strategy +   │     │  (file-specific │     │  (file-specific │   │
│  │    patterns)    │     │    gotchas)     │     │    gotchas)     │   │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### API Reference

**For coordinators** (strategy selection):
```typescript
import { getStrategyInsights, getPatternInsights, formatInsightsForPrompt } from "opencode-swarm-plugin";

const strategies = await getStrategyInsights(swarmMail, task);
// Returns: [{ strategy: "file-based", successRate: 85.5, totalAttempts: 12, recommendation: "..." }]

const patterns = await getPatternInsights(swarmMail);
// Returns: [{ pattern: "type_error", frequency: 5, recommendation: "Add type annotations" }]

const summary = formatInsightsForPrompt({ strategies, patterns }, { maxTokens: 500 });
// Injected into decomposition prompt
```

**For workers** (file-specific context):
```typescript
import { getFileInsights, formatInsightsForPrompt } from "opencode-swarm-plugin";

const fileInsights = await getFileInsights(swarmMail, ["src/auth.ts", "src/db.ts"]);
// Returns: [{ file: "src/auth.ts", failureCount: 3, lastFailure: "2025-12-20T...", gotchas: [...] }]

const summary = formatInsightsForPrompt({ files: fileInsights }, { maxTokens: 300 });
// Injected into worker prompt
```

**Caching** (5-minute TTL):
```typescript
import { getCachedInsights, clearInsightsCache } from "opencode-swarm-plugin";

const insights = await getCachedInsights(swarmMail, "strategies:auth-task", async () => ({
  strategies: await getStrategyInsights(swarmMail, "add auth"),
}));

clearInsightsCache(); // Force fresh computation
```

### Token Budgets

| Agent Type | Max Tokens | What's Included |
|------------|------------|-----------------|
| Coordinator | 500 | Top 3 strategies + top 3 patterns |
| Worker | 300 | Top 5 files with gotchas |

### Recommendation Thresholds

Strategy success rates map to recommendations:

| Success Rate | Recommendation |
|--------------|----------------|
| ≥80% | "performing well" |
| 60-79% | "moderate - monitor for issues" |
| 40-59% | "low success - consider alternatives" |
| <40% | "AVOID - high failure rate" |

### Data Sources

| Source | What It Provides | Query Pattern |
|--------|------------------|---------------|
| Event Store | `subtask_outcome` events with strategy, success, files_touched, error_type | SQL aggregation |
| Semantic Memory | File-specific learnings from past debugging | Semantic search (TODO) |
| Anti-Pattern Registry | Patterns with >60% failure rate | Direct lookup |

**See [swarmtools.ai/docs/insights](https://swarmtools.ai/docs) for full details.**

---

## Optional But Recommended

### Semantic Memory (for pattern learning)

```bash
brew install ollama
ollama serve &
ollama pull mxbai-embed-large
```

Without Ollama, memory falls back to full-text search (still works, just less semantic).

### Historical Context (CASS)

Queries past AI sessions for similar decompositions:

```bash
git clone https://github.com/Dicklesworthstone/coding_agent_session_search
cd coding_agent_session_search
pip install -e .
cass index  # Run periodically to index new sessions
```

### Bug Scanning (UBS)

Auto-runs on subtask completion:

```bash
git clone https://github.com/Dicklesworthstone/ultimate_bug_scanner
cd ultimate_bug_scanner
pip install -e .
```

Check status: `swarm doctor`

---

## Core Concepts

### The Hive 🐝

Work items (cells) stored in `.hive/` and synced to git. Each cell is a unit of work - think GitHub issue but local-first.

**Cell IDs:** Project-prefixed for clarity (e.g., `swarm-mail-lf2p4u-abc123` not generic `bd-xxx`)

### The Swarm

Parallel agents coordinated via **Swarm Mail** (message passing + file reservations). Coordinator spawns workers → workers reserve files → do work → report progress → complete with verification.

### Learning

- **Pattern maturity** tracks what decomposition strategies work
- **Confidence decay** fades unreliable patterns (90-day half-life)
- **Anti-pattern inversion** auto-marks failing approaches to avoid
- **Outcome tracking** learns from speed, errors, retries

### Checkpoint & Recovery

Auto-saves progress at milestones. Survives context death or crashes. Data stored in embedded libSQL (no external DB needed).

**When checkpoints happen:**
- Auto at 25%, 50%, 75% progress
- Before risky operations (via `swarm_checkpoint`)
- On errors (captures error context for recovery)

**Recovery:** `swarm_recover(project_key, epic_id)` returns full context to resume work.

---

## Tools Reference

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

### Swarm Orchestration

| Tool                           | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `swarm_select_strategy`        | Analyze task, recommend strategy                |
| `swarm_decompose`              | Generate decomposition prompt (queries CASS)    |
| `swarm_validate_decomposition` | Validate response, detect conflicts             |
| `swarm_subtask_prompt`         | Generate worker agent prompt                    |
| `swarm_status`                 | Get swarm progress by epic ID                   |
| `swarm_progress`               | Report subtask progress                         |
| `swarm_complete`               | Complete subtask (releases reservations)        |
| `swarm_checkpoint`             | Save progress snapshot (auto at 25/50/75%)      |
| `swarm_recover`                | Resume from checkpoint                          |
| `swarm_review`                 | Generate review prompt for coordinator          |
| `swarm_review_feedback`        | Send approval/rejection to worker (3-strike)    |

### Semantic Memory (Persistent Learning)

Vector embeddings for persistent agent learnings. Uses **libSQL native vector support via sqlite-vec extension** + **Ollama** for embeddings.

| Tool | Purpose |
|------|---------|
| `semantic-memory_store` | Store learnings (with auto-tag/auto-link/entity extraction) |
| `semantic-memory_find` | Search by semantic similarity |
| `semantic-memory_get` | Get specific memory by ID |
| `semantic-memory_validate` | Validate memory accuracy (resets 90-day decay) |
| `semantic-memory_list` | List stored memories |
| `semantic-memory_remove` | Delete outdated/incorrect memories |

**Wave 1-3 Smart Operations:**

```typescript
// Simple store (always adds new)
semantic-memory_store(information="OAuth tokens need 5min buffer before expiry")

// Store with auto-tagging (LLM extracts tags)
semantic-memory_store(
  information="OAuth tokens need 5min buffer",
  metadata='{"autoTag": true}'
)
// Returns: { id: "mem-abc123", autoTags: { tags: ["auth", "oauth", "tokens"], confidence: 0.85 } }

// Store with auto-linking (links to related memories)
semantic-memory_store(
  information="Token refresh race condition fixed",
  metadata='{"autoLink": true}'
)
// Returns: { id: "mem-def456", links: [{ memory_id: "mem-abc123", link_type: "related", score: 0.82 }] }

// Store with entity extraction (builds knowledge graph)
semantic-memory_store(
  information="Joel prefers TypeScript for Next.js projects",
  metadata='{"extractEntities": true}'
)
// Returns: { id: "mem-ghi789", entities: [{ name: "Joel", type: "person" }, { name: "TypeScript", type: "technology" }] }

// Combine all smart features
semantic-memory_store(
  information="OAuth tokens need 5min buffer to avoid race conditions",
  metadata='{"autoTag": true, "autoLink": true, "extractEntities": true}'
)

// Search memories
semantic-memory_find(query="token refresh issues", limit=5)

// Validate memory (resets 90-day decay timer)
semantic-memory_validate(id="mem-abc123")
```

**Graceful Degradation:** All smart operations fall back to heuristics if LLM/Ollama unavailable:
- Auto-tagging returns `undefined` (no tags added)
- Auto-linking returns `undefined` (no links created)
- Entity extraction returns empty arrays
- Vector search falls back to full-text search (FTS5)

**Requires Ollama for smart operations:**
```bash
brew install ollama
ollama serve &
ollama pull mxbai-embed-large
```

See [swarm-mail README](../swarm-mail/README.md#wave-1-3-smart-operations) for full API details.

### Skills (Knowledge Injection)

| Tool            | Purpose                 |
| --------------- | ----------------------- |
| `skills_list`   | List available skills   |
| `skills_use`    | Load skill into context |
| `skills_read`   | Read skill content      |
| `skills_create` | Create new skill        |

**Bundled skills:**
- **testing-patterns** - 25 dependency-breaking techniques, characterization tests
- **swarm-coordination** - Multi-agent decomposition, file reservations
- **cli-builder** - Argument parsing, help text, subcommands
- **system-design** - Architecture decisions, module boundaries
- **learning-systems** - Confidence decay, pattern maturity
- **skill-creator** - Meta-skill for creating new skills

---

## What's New in v0.33

- **Pino logging infrastructure** - Structured JSON logs with daily rotation to `~/.config/swarm-tools/logs/`
- **Compaction hook instrumented** - 14 log points across all phases (START, GATHER, RENDER, DECIDE, COMPLETE)
- **`swarm log` CLI** - Query/tail logs with module, level, and time filters
- **Analytics queries** - 5 pre-built queries based on Four Golden Signals (latency, traffic, errors, saturation, conflicts)

### v0.32

- **libSQL storage** (embedded SQLite) replaced PGLite - no external DB needed
- **95% integration test coverage** - checkpoint/recovery proven with 9 tests
- **Coordinator review gate** - `swarm_review` + `swarm_review_feedback` with 3-strike rule
- **Smart ID resolution** - partial hashes work like git (`mjhgw0g` matches `opencode-swarm-monorepo-lf2p4u-mjhgw0ggt00`)
- **Auto-sync at key events** - no more forgotten `hive_sync` calls
- **Project-prefixed cell IDs** - `swarm-mail-xxx` instead of generic `bd-xxx`

---

## Architecture

Built on [swarm-mail](../swarm-mail) event sourcing primitives. Data stored in libSQL (embedded SQLite).

```
src/
├── hive.ts                # Work item tracking integration
├── swarm-mail.ts          # Agent coordination tools
├── swarm-orchestrate.ts   # Coordinator logic (spawns workers)
├── swarm-decompose.ts     # Task decomposition strategies
├── swarm-insights.ts      # Historical insights aggregation (strategy/file/pattern)
├── swarm-review.ts        # Review gate for completed work
├── skills.ts              # Knowledge injection system
├── learning.ts            # Pattern maturity, outcomes
├── anti-patterns.ts       # Anti-pattern detection
├── structured.ts          # JSON parsing utilities
└── schemas/               # Zod validation schemas
```

---

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

### Evaluation Pipeline

Test decomposition quality and coordinator discipline with **Evalite** (TypeScript-native eval framework):

```bash
# Run all evals
bun run eval:run

# Run specific suites
bun run eval:decomposition    # Task decomposition quality
bun run eval:coordinator      # Coordinator protocol compliance
bun run eval:compaction       # Compaction prompt quality

# Check eval status (progressive gates)
swarm eval status [eval-name]

# View history with trends
swarm eval history
```

**Progressive Gates:**

```
Phase             Runs    Gate Behavior
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bootstrap         <10     ✅ Always pass (collect data)
Stabilization     10-50   ⚠️  Warn on >10% regression
Production        >50     ❌ Fail on >5% regression
```

**What gets evaluated:**

| Eval Suite            | Measures                                                      | Data Source                                      |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| `swarm-decomposition` | Subtask independence, complexity balance, coverage, clarity   | Fixtures + `.opencode/eval-data.jsonl`           |
| `coordinator-session` | Violation count, spawn efficiency, review thoroughness        | `~/.config/swarm-tools/sessions/*.jsonl`         |
| `compaction-prompt`   | ID specificity, actionability, identity, forbidden tools      | Session compaction events                        |

**Learning Feedback Loop:**

When eval scores drop >15% from baseline, failure context is automatically stored to semantic memory. Future prompts query these learnings for context.

**Data capture locations:**
- Decomposition inputs/outputs: `.opencode/eval-data.jsonl`
- Eval history: `.opencode/eval-history.jsonl`
- Coordinator sessions: `~/.config/swarm-tools/sessions/*.jsonl`
- Subtask outcomes: swarm-mail database

See **[evals/README.md](./evals/README.md)** for full architecture, scorer details, CI integration, and how to write new evals.

---

## CLI Reference

### Setup & Configuration

```bash
swarm setup        # Interactive installer for all dependencies
swarm setup -y     # Non-interactive mode (auto-migrate stray databases)
swarm doctor       # Check dependency health (CASS, UBS, Ollama)
swarm init         # Initialize hive in current project
swarm config       # Show config file paths
swarm update       # Update swarm plugin and bundled skills
swarm migrate      # Migrate from legacy PGLite to libSQL
swarm version      # Show version info
```

**Database Consolidation**: `swarm setup` automatically detects and migrates stray databases (`.opencode/swarm.db`, `.hive/swarm-mail.db`, nested package databases) to the global database at `~/.config/swarm-tools/swarm.db`. Use `-y` flag to migrate without prompting.

### Observability Commands

**swarm query** - SQL analytics with presets

```bash
# Execute custom SQL query against event store
swarm query --sql "SELECT * FROM events WHERE type='worker_spawned' LIMIT 10"

# Use preset query (10+ presets available)
swarm query --preset failed_decompositions
swarm query --preset duration_by_strategy
swarm query --preset file_conflicts
swarm query --preset worker_success_rate
swarm query --preset review_rejections
swarm query --preset blocked_tasks
swarm query --preset agent_activity
swarm query --preset event_frequency
swarm query --preset error_patterns
swarm query --preset compaction_stats

# Output formats
swarm query --preset failed_decompositions --format table  # Default
swarm query --preset duration_by_strategy --format csv
swarm query --preset file_conflicts --format json
```

**swarm dashboard** - Live terminal UI

```bash
# Launch dashboard (auto-refresh every 1s)
swarm dashboard

# Focus on specific epic
swarm dashboard --epic mjmas3zxlmg

# Custom refresh rate (milliseconds)
swarm dashboard --refresh 2000
```

**Dashboard shows:**
- Active workers and their current tasks
- Progress bars for in-progress work
- File reservations (who owns what)
- Recent messages between agents
- Error alerts

**swarm replay** - Event replay with timing

```bash
# Replay epic at normal speed
swarm replay mjmas3zxlmg

# Fast playback
swarm replay mjmas3zxlmg --speed 2x
swarm replay mjmas3zxlmg --speed instant

# Filter by event type
swarm replay mjmas3zxlmg --type worker_spawned,task_completed

# Filter by agent
swarm replay mjmas3zxlmg --agent DarkHawk

# Time range filters
swarm replay mjmas3zxlmg --since "2025-12-25T10:00:00"
swarm replay mjmas3zxlmg --until "2025-12-25T12:00:00"

# Combine filters
swarm replay mjmas3zxlmg --speed 2x --type worker_spawned --agent BlueLake
```

**swarm export** - Data export for analysis

```bash
# Export all events as JSON (stdout)
swarm export

# Export specific epic
swarm export --epic mjmas3zxlmg

# Export formats
swarm export --format json --output events.json
swarm export --format csv --output events.csv
swarm export --format otlp --output events.otlp  # OpenTelemetry Protocol

# Pipe to jq for filtering
swarm export --format json | jq '.[] | select(.type=="worker_spawned")'
```

**swarm stats** - Health metrics

```bash
# Last 7 days (default)
swarm stats

# Custom time period
swarm stats --since 24h
swarm stats --since 30m

# JSON output for scripting
swarm stats --json
```

**swarm history** - Activity timeline

```bash
# Last 10 swarms (default)
swarm history

# More results
swarm history --limit 20

# Filter by status
swarm history --status success
swarm history --status failed
swarm history --status in_progress

# Filter by strategy
swarm history --strategy file-based
swarm history --strategy feature-based

# Verbose mode (show subtasks)
swarm history --verbose
```

**swarm log** - Query/tail logs

```bash
# Recent logs (last 50 lines)
swarm log

# Filter by module
swarm log compaction

# Filter by level
swarm log --level error
swarm log --level warn

# Time filters
swarm log --since 30s
swarm log --since 5m
swarm log --since 2h

# JSON output
swarm log --json

# Limit output
swarm log --limit 100

# Watch mode (live tail)
swarm log --watch
swarm log --watch --interval 500  # Poll every 500ms
```

**swarm log sessions** - View coordinator sessions

```bash
# List all sessions
swarm log sessions

# View specific session
swarm log sessions <session_id>

# Most recent session
swarm log sessions --latest

# Filter by event type
swarm log sessions --type DECISION
swarm log sessions --type VIOLATION
swarm log sessions --type OUTCOME
swarm log sessions --type COMPACTION

# JSON output for jq
swarm log sessions --json
```

### Debug Logging

Use `DEBUG` env var to enable swarm debug logs:

```bash
# All swarm logs
DEBUG=swarm:* swarm dashboard

# Coordinator only
DEBUG=swarm:coordinator swarm replay <epic-id>

# Workers only
DEBUG=swarm:worker swarm export

# Swarm mail only
DEBUG=swarm:mail swarm query --preset agent_activity

# Multiple namespaces (comma-separated)
DEBUG=swarm:coordinator,swarm:worker swarm dashboard
```

**Namespaces:**

| Namespace | What It Logs |
|-----------|--------------|
| `swarm:*` | All swarm activity |
| `swarm:coordinator` | Coordinator decisions (spawn, review, approve/reject) |
| `swarm:worker` | Worker progress, reservations, completions |
| `swarm:mail` | Inter-agent messages, inbox/outbox activity |

## Observability Architecture

Swarm uses **event sourcing** for complete observability. Every coordination action is an event - nothing is lost, everything is queryable.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY FLOW                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────┐                                                         │
│  │   Agent    │  swarmmail_init()                                       │
│  │  (Worker)  │  swarmmail_reserve(paths=["src/auth.ts"])               │
│  │            │  swarm_progress(status="in_progress")                   │
│  │            │  swarm_complete(...)                                    │
│  └─────┬──────┘                                                         │
│        │                                                                │
│        ▼                                                                │
│  ┌────────────────────────────────────────────────────────┐             │
│  │              libSQL Event Store                        │             │
│  │  ┌──────────────────────────────────────────────────┐  │             │
│  │  │ events table (append-only)                       │  │             │
│  │  │ ├─ id, type, timestamp, project_key, data       │  │             │
│  │  │ ├─ agent_registered, message_sent, ...          │  │             │
│  │  │ └─ task_started, task_progress, task_completed  │  │             │
│  │  └──────────────────────────────────────────────────┘  │             │
│  │                                                         │             │
│  │  Automatic Projections (materialized views):            │             │
│  │  ├─ agents (who's registered)                           │             │
│  │  ├─ messages (agent inbox/outbox)                       │             │
│  │  ├─ reservations (file locks)                           │             │
│  │  └─ swarm_contexts (checkpoints)                        │             │
│  └─────────────────┬───────────────────────────────────────┘             │
│                    │                                                    │
│       ┌────────────┼────────────┬────────────┐                          │
│       ▼            ▼            ▼            ▼                          │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐                     │
│  │  swarm  │ │  swarm  │ │  swarm   │ │  swarm   │                     │
│  │  query  │ │  stats  │ │ dashboard│ │  replay  │                     │
│  │  (SQL)  │ │ (counts)│ │   (TUI)  │ │ (time)   │                     │
│  └─────────┘ └─────────┘ └──────────┘ └──────────┘                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────┐            │
│  │  Analytics Layer (Golden Signals)                       │            │
│  │  ├─ Latency: avg task duration, P50/P95/P99             │            │
│  │  ├─ Traffic: events/sec, message rate                   │            │
│  │  ├─ Errors: task failures, violations                   │            │
│  │  ├─ Saturation: file conflicts, blocked tasks           │            │
│  │  └─ Conflicts: reservation collisions, deadlocks        │            │
│  └─────────────────────────────────────────────────────────┘            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Event Types

**Agent Lifecycle:**
| Event Type | When It Fires | Used For |
|------------|---------------|----------|
| `agent_registered` | Agent calls `swarmmail_init()` | Agent discovery, project tracking |
| `agent_active` | Periodic heartbeat | Last-seen tracking |

**Messages:**
| Event Type | When It Fires | Used For |
|------------|---------------|----------|
| `message_sent` | Agent sends swarm mail | Coordination, thread tracking |
| `message_read` | Agent reads message | Read receipts |
| `message_acked` | Agent acknowledges | Confirmation tracking |
| `thread_created` | First message in thread | Thread lifecycle |
| `thread_activity` | Thread stats update | Unread counts, participants |

**File Reservations:**
| Event Type | When It Fires | Used For |
|------------|---------------|----------|
| `file_reserved` | Agent reserves files | Conflict detection, lock management |
| `file_released` | Agent releases files | Lock cleanup, reservation tracking |
| `file_conflict` | Reservation collision | Conflict resolution, deadlock detection |

**Task Tracking:**
| Event Type | When It Fires | Used For |
|------------|---------------|----------|
| `task_started` | Agent starts cell work | Progress tracking, timeline |
| `task_progress` | Agent reports milestone | Real-time monitoring, ETA |
| `task_completed` | Agent calls `swarm_complete()` | Outcome tracking, learning signals |
| `task_blocked` | Agent hits blocker | Dependency tracking, alerts |

**Swarm Coordination:**
| Event Type | When It Fires | Used For |
|------------|---------------|----------|
| `swarm_started` | Coordinator begins epic | Swarm lifecycle tracking |
| `worker_spawned` | Coordinator spawns worker | Worker tracking, spawn order |
| `worker_completed` | Worker finishes subtask | Outcome tracking, duration |
| `review_started` | Coordinator begins review | Review tracking, attempts |
| `review_completed` | Review finishes | Approval/rejection tracking |
| `swarm_completed` | All subtasks done | Epic completion, success rate |
| `decomposition_generated` | Task decomposed | Strategy tracking, subtask planning |
| `subtask_outcome` | Subtask finishes | Learning signals, scope violations |

**Checkpoints & Recovery:**
| Event Type | When It Fires | Used For |
|------------|---------------|----------|
| `swarm_checkpointed` | Auto at 25/50/75% or manual | Recovery, context preservation |
| `swarm_recovered` | Resume from checkpoint | Recovery tracking, checkpoint age |
| `checkpoint_created` | Checkpoint saved | Checkpoint lifecycle |
| `context_compacted` | Context compaction runs | Context compression tracking |

**Validation & Learning:**
| Event Type | When It Fires | Used For |
|------------|---------------|----------|
| `validation_started` | Validation begins | Validation lifecycle |
| `validation_issue` | Validation finds issue | Issue tracking, debugging |
| `validation_completed` | Validation finishes | Pass/fail tracking |
| `human_feedback` | Human accepts/modifies | Human-in-loop learning |

**Full Schema:** See [swarm-mail/src/streams/events.ts](../swarm-mail/src/streams/events.ts) for complete Zod schemas (30+ event types)

### Analytics Queries

Pre-built queries based on **Four Golden Signals** observability framework:

**Latency** (how fast):
```sql
-- Average task duration by type
SELECT 
  json_extract(data, '$.type') as task_type,
  AVG(duration_ms) as avg_duration,
  MAX(duration_ms) as p99_duration
FROM events
WHERE type = 'task_completed'
GROUP BY task_type;
```

**Traffic** (how much):
```sql
-- Events per hour
SELECT 
  strftime('%Y-%m-%d %H:00', datetime(timestamp/1000, 'unixepoch')) as hour,
  COUNT(*) as event_count
FROM events
GROUP BY hour
ORDER BY hour DESC
LIMIT 24;
```

**Errors** (what's broken):
```sql
-- Failed tasks with reasons
SELECT 
  json_extract(data, '$.bead_id') as task,
  json_extract(data, '$.reason') as failure_reason,
  timestamp
FROM events
WHERE type = 'task_completed' 
  AND json_extract(data, '$.success') = 0
ORDER BY timestamp DESC;
```

**Saturation** (resource contention):
```sql
-- File reservation conflicts
SELECT 
  json_extract(data, '$.paths') as file_paths,
  COUNT(*) as conflict_count,
  GROUP_CONCAT(json_extract(data, '$.agent_name')) as agents
FROM events
WHERE type = 'file_reserved'
GROUP BY file_paths
HAVING COUNT(*) > 1;
```

**Conflicts** (deadlocks, collisions):
```sql
-- Reservation wait times (TTL expirations)
SELECT 
  json_extract(data, '$.agent_name') as agent,
  json_extract(data, '$.paths') as paths,
  (expires_at - timestamp) as wait_time_ms
FROM events
WHERE type = 'file_reserved'
  AND (expires_at - timestamp) > 10000 -- >10sec wait
ORDER BY wait_time_ms DESC;
```

Run these via:
```bash
swarm query --preset golden-signals
swarm query --preset compaction-health
swarm query --preset file-conflicts
```

### Getting Started with Debugging

**Scenario 1: Task is stuck "in_progress" forever**

```bash
# 1. Find the task in events
swarm query --sql "SELECT * FROM events WHERE json_extract(data, '$.bead_id') = 'mjmas411jtj' ORDER BY timestamp"

# 2. Check for file reservation conflicts
swarm query --preset file_conflicts

# 3. Replay to see execution timeline
swarm replay mjmas3zxlmg --agent WorkerName

# 4. Check if agent is still registered
swarm stats

# 5. Enable debug logging for live tracking
DEBUG=swarm:worker swarm dashboard --epic mjmas3zxlmg
```

**Scenario 2: High failure rate for a specific epic**

```bash
# 1. Get stats by epic
swarm query --sql "SELECT type, COUNT(*) FROM events WHERE json_extract(data, '$.epic_id') = 'mjmas3zxlmg' GROUP BY type"

# 2. Find failures with reasons
swarm query --sql "SELECT * FROM events WHERE type = 'task_completed' AND json_extract(data, '$.epic_id') = 'mjmas3zxlmg' AND json_extract(data, '$.success') = 0"

# 3. Export for analysis
swarm export --epic mjmas3zxlmg --format csv > failures.csv

# 4. Check coordinator session for violations
swarm log sessions --type VIOLATION --json
```

**Scenario 3: Performance regression (tasks slower than before)**

```bash
# 1. Check latency trends
swarm query --preset duration_by_strategy

# 2. Compare with historical baselines
swarm history --limit 50

# 3. Identify bottlenecks
swarm dashboard --epic mjmas3zxlmg --refresh 2

# 4. Analyze worker spawn efficiency
swarm query --preset worker_success_rate
```

**Scenario 4: File reservation conflicts**

```bash
# 1. Check active locks
swarm query --preset file_conflicts

# 2. See who's holding what
swarm dashboard  # Shows file locks section

# 3. View full conflict history
swarm query --sql "SELECT * FROM events WHERE type = 'file_conflict' ORDER BY timestamp DESC LIMIT 20"

# 4. Replay to see conflict sequence
swarm replay mjmas3zxlmg --type file_reserved,file_released,file_conflict
```

**Scenario 5: Coordinator not spawning workers**

```bash
# 1. Check coordinator session for violations
swarm log sessions --latest --type DECISION,VIOLATION

# 2. Verify decomposition was generated
swarm query --sql "SELECT * FROM events WHERE type = 'decomposition_generated' ORDER BY timestamp DESC LIMIT 5"

# 3. Debug coordinator logic
DEBUG=swarm:coordinator swarm replay mjmas3zxlmg

# 4. Check for blocked tasks
swarm query --preset blocked_tasks
```

### Event Store Schema

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                    -- Event discriminator
  project_key TEXT NOT NULL,             -- Project path (for multi-project filtering)
  timestamp INTEGER NOT NULL,            -- Unix ms
  sequence INTEGER GENERATED ALWAYS AS (id) STORED,
  data TEXT NOT NULL,                    -- JSON payload (event-specific fields)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for fast queries
CREATE INDEX idx_events_project_key ON events(project_key);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_project_type ON events(project_key, type);
```

**Event payload examples:**

```json
// agent_registered event
{
  "type": "agent_registered",
  "project_key": "/path/to/project",
  "timestamp": 1703001234567,
  "data": "{\"agent_name\":\"BlueLake\",\"program\":\"opencode\",\"model\":\"claude-sonnet-4\",\"task_description\":\"mjmas411jtj: Update READMEs\"}"
}

// task_completed event
{
  "type": "task_completed",
  "project_key": "/path/to/project", 
  "timestamp": 1703001299999,
  "data": "{\"agent_name\":\"BlueLake\",\"bead_id\":\"mjmas411jtj\",\"summary\":\"Updated both READMEs with CLI reference and event schema\",\"files_touched\":[\"packages/opencode-swarm-plugin/README.md\",\"packages/swarm-mail/README.md\"],\"success\":true}"
}
```

### Database Location

```bash
# libSQL database path
~/.config/swarm-tools/libsql/<project-hash>/swarm.db

# Find your project's database
swarm config  # Shows database path for current project
```

---

## Further Reading

- **[Full Docs](https://swarmtools.ai/docs)** - Deep dives, patterns, best practices
- **[swarm-mail Package](../swarm-mail)** - Event sourcing primitives, database layer
- **[AGENTS.md](../../AGENTS.md)** - Monorepo guide, testing strategy, TDD workflow

> *"High-variability sequencing of whole-task problems."*  
> — 4C/ID Instructional Design Model

---

## License

MIT
