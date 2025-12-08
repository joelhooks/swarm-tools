# opencode-swarm-plugin

[![npm version](https://img.shields.io/npm/v/opencode-swarm-plugin.svg)](https://www.npmjs.com/package/opencode-swarm-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-agent swarm coordination for [OpenCode](https://opencode.ai) with learning capabilities, beads integration, and Agent Mail.

## Overview

This plugin provides intelligent, self-improving tools for multi-agent workflows in OpenCode:

- **Type-safe beads operations** - Zod-validated wrappers around the `bd` CLI with proper error handling
- **Agent Mail integration** - File reservations, async messaging, and thread coordination between agents
- **Structured outputs** - Reliable JSON responses with schema validation and retry support
- **Swarm primitives** - Task decomposition, status tracking, and parallel agent coordination
- **Learning from outcomes** - Confidence decay, implicit feedback scoring, and pattern maturity tracking
- **Anti-pattern detection** - Automatically learns what decomposition strategies fail and avoids them
- **Pre-completion validation** - UBS bug scanning before marking tasks complete
- **History-informed decomposition** - Queries CASS for similar past tasks to inform strategy
- **Graceful degradation** - Works with whatever tools are available, degrades features when tools missing
- **Swarm discipline** - Enforces beads tracking, aggressive planning, and agent communication

## Installation

```bash
npm install opencode-swarm-plugin
# or
bun add opencode-swarm-plugin
# or
pnpm add opencode-swarm-plugin
```

Copy the plugin to your OpenCode plugins directory:

```bash
cp node_modules/opencode-swarm-plugin/dist/plugin.js ~/.config/opencode/plugin/swarm.js
```

Plugins are automatically loaded from `~/.config/opencode/plugin/` - no config file changes needed.

> **Note:** The package has two entry points:
>
> - `dist/index.js` - Full library exports (schemas, errors, utilities, learning modules)
> - `dist/plugin.js` - Plugin entry point that only exports the `plugin` function for OpenCode

## Prerequisites

| Requirement      | Purpose                                     |
| ---------------- | ------------------------------------------- |
| OpenCode 1.0+    | Plugin host                                 |
| Agent Mail MCP   | Multi-agent coordination (`localhost:8765`) |
| Beads CLI (`bd`) | Git-backed issue tracking                   |

### Verify Agent Mail is running

```bash
curl http://127.0.0.1:8765/health/liveness
```

### Verify beads is installed

```bash
bd --version
```

## Tools Reference

### Beads Tools

| Tool                | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `beads_create`      | Create a new bead with type-safe validation                         |
| `beads_create_epic` | Create epic with subtasks in one atomic operation                   |
| `beads_query`       | Query beads with filters (replaces `bd list`, `bd ready`, `bd wip`) |
| `beads_update`      | Update bead status/description/priority                             |
| `beads_close`       | Close a bead with reason                                            |
| `beads_start`       | Mark bead as in-progress (shortcut)                                 |
| `beads_ready`       | Get next ready bead (unblocked, highest priority)                   |
| `beads_sync`        | Sync beads to git and push (MANDATORY at session end)               |
| `beads_link_thread` | Link bead to Agent Mail thread                                      |

### Agent Mail Tools

| Tool                         | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `agentmail_init`             | Initialize session (ensure project + register agent) |
| `agentmail_send`             | Send message to other agents                         |
| `agentmail_inbox`            | Fetch inbox (CONTEXT-SAFE: bodies excluded, limit 5) |
| `agentmail_read_message`     | Fetch ONE message body by ID                         |
| `agentmail_summarize_thread` | Summarize thread (PREFERRED over fetching all)       |
| `agentmail_reserve`          | Reserve file paths for exclusive editing             |
| `agentmail_release`          | Release file reservations                            |
| `agentmail_ack`              | Acknowledge a message                                |
| `agentmail_search`           | Search messages (FTS5 syntax)                        |
| `agentmail_health`           | Check if Agent Mail server is running                |

## Rate Limiting

Client-side, per-agent rate limits prevent abuse and ensure fair resource usage across agents. Uses Redis as primary store (`localhost:6379`) with automatic SQLite fallback (`~/.config/opencode/rate-limits.db`).

### Default Limits

| Endpoint           | Per Minute | Per Hour |
| ------------------ | ---------- | -------- |
| `send`             | 20         | 200      |
| `reserve`          | 10         | 100      |
| `release`          | 10         | 100      |
| `ack`              | 20         | 200      |
| `inbox`            | 60         | 600      |
| `read_message`     | 60         | 600      |
| `summarize_thread` | 30         | 300      |
| `search`           | 30         | 300      |

### Configuration

| Environment Variable                      | Description                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `OPENCODE_RATE_LIMIT_REDIS_URL`           | Redis connection URL (default: `redis://localhost:6379`)                    |
| `OPENCODE_RATE_LIMIT_SQLITE_PATH`         | SQLite database path (default: `~/.config/opencode/rate-limits.db`)         |
| `OPENCODE_RATE_LIMIT_{ENDPOINT}_PER_MIN`  | Per-minute limit for endpoint (e.g., `OPENCODE_RATE_LIMIT_SEND_PER_MIN=30`) |
| `OPENCODE_RATE_LIMIT_{ENDPOINT}_PER_HOUR` | Per-hour limit for endpoint (e.g., `OPENCODE_RATE_LIMIT_SEND_PER_HOUR=300`) |

### Troubleshooting

- **Rate limit exceeded errors** - Adjust limits via environment variables for your workload
- **Redis unavailable** - Automatic SQLite fallback with warning logged; no action needed
- **SQLite cleanup** - Expired entries cleaned automatically on init

### Swarm Tools

| Tool                           | Description                                                              |
| ------------------------------ | ------------------------------------------------------------------------ |
| `swarm_init`                   | Check tool availability, report degraded features                        |
| `swarm_decompose`              | Generate decomposition prompt, optionally queries CASS for similar tasks |
| `swarm_validate_decomposition` | Validate decomposition response, detect instruction conflicts            |
| `swarm_status`                 | Get swarm status by epic ID                                              |
| `swarm_progress`               | Report progress on a subtask                                             |
| `swarm_complete`               | Mark subtask complete with UBS bug scan, release reservations            |
| `swarm_record_outcome`         | Record outcome for implicit feedback (duration, errors, retries)         |
| `swarm_subtask_prompt`         | Generate prompt for spawned subtask agent (V1 - includes coordination)   |
| `swarm_spawn_subtask`          | Generate V2 prompt with Agent Mail/beads instructions for subagents      |
| `swarm_complete_subtask`       | Handle subtask completion: close bead, create issue beads                |
| `swarm_evaluation_prompt`      | Generate self-evaluation prompt                                          |

### Structured Output Tools

| Tool                             | Description                                              |
| -------------------------------- | -------------------------------------------------------- |
| `structured_extract_json`        | Extract JSON from markdown/text with multiple strategies |
| `structured_validate`            | Validate response against named schema                   |
| `structured_parse_evaluation`    | Parse and validate evaluation response                   |
| `structured_parse_decomposition` | Parse and validate task decomposition                    |
| `structured_parse_bead_tree`     | Parse and validate bead tree for epic creation           |

### Schemas (for structured outputs)

The plugin exports Zod schemas for validated agent responses:

| Schema                       | Purpose                                      |
| ---------------------------- | -------------------------------------------- |
| `TaskDecompositionSchema`    | Decompose task into parallelizable subtasks  |
| `EvaluationSchema`           | Agent self-evaluation of completed work      |
| `WeightedEvaluationSchema`   | Evaluation with confidence-weighted criteria |
| `SwarmStatusSchema`          | Swarm progress tracking                      |
| `SwarmSpawnResultSchema`     | Result of spawning agent swarm               |
| `BeadSchema`                 | Validated bead data                          |
| `EpicCreateResultSchema`     | Atomic epic creation result                  |
| `FeedbackEventSchema`        | Feedback event for learning                  |
| `OutcomeSignalsSchema`       | Implicit feedback from task outcomes         |
| `DecompositionPatternSchema` | Tracked decomposition pattern                |
| `PatternMaturitySchema`      | Pattern maturity state tracking              |

## Usage Examples

### Basic Bead Creation

```typescript
// Create a bug report with priority
await tools["beads_create"]({
  title: "Fix login redirect loop",
  type: "bug",
  priority: 1,
  description: "Users stuck in redirect after OAuth callback",
});
```

### Atomic Epic with Subtasks

```typescript
// Create epic and all subtasks atomically (with rollback hints on failure)
const result = await tools["beads_create_epic"]({
  epic_title: "Implement user dashboard",
  epic_description: "New dashboard with metrics and activity feed",
  subtasks: [
    {
      title: "Create dashboard layout",
      priority: 2,
      files: ["src/components/Dashboard.tsx"],
    },
    {
      title: "Add metrics API endpoint",
      priority: 2,
      files: ["src/api/metrics.ts"],
    },
    {
      title: "Build activity feed component",
      priority: 3,
      files: ["src/components/ActivityFeed.tsx"],
    },
  ],
});
```

### Agent Mail Coordination

```typescript
// 1. Initialize session
await tools["agentmail_init"]({
  project_path: "/Users/you/project",
  task_description: "Working on auth refactor",
});
// Returns: { agent: { name: "BlueLake", ... } }

// 2. Reserve files before editing
await tools["agentmail_reserve"]({
  paths: ["src/auth/**", "src/middleware/auth.ts"],
  reason: "bd-abc123: Auth refactor",
  ttl_seconds: 3600,
});

// 3. Check inbox (bodies excluded by default)
const messages = await tools["agentmail_inbox"]({ limit: 5 });

// 4. Send status update to other agents
await tools["agentmail_send"]({
  to: ["RedStone", "GreenCastle"],
  subject: "Auth refactor complete",
  body: "Finished updating the auth middleware. Ready for review.",
  thread_id: "bd-abc123",
});

// 5. Release reservations when done
await tools["agentmail_release"]({});
```

### Swarm Workflow

```typescript
// 1. Create epic for the work
const epic = await tools["beads_create_epic"]({
  epic_title: "Add export feature",
  subtasks: [
    { title: "Export to CSV", files: ["src/export/csv.ts"] },
    { title: "Export to JSON", files: ["src/export/json.ts"] },
    { title: "Export to PDF", files: ["src/export/pdf.ts"] },
  ],
});

// 2. Each parallel agent reserves its files
// Agent 1 (BlueLake):
await tools["agentmail_reserve"]({
  paths: ["src/export/csv.ts"],
  reason: `${epic.subtasks[0].id}: Export to CSV`,
});

// 3. Agents communicate via thread
await tools["agentmail_send"]({
  to: ["Coordinator"],
  subject: "CSV export complete",
  body: "Implemented CSV export with streaming support.",
  thread_id: epic.epic.id,
});

// 4. Coordinator uses summarize_thread (not fetch all)
const summary = await tools["agentmail_summarize_thread"]({
  thread_id: epic.epic.id,
  include_examples: true,
});
```

## Learning Capabilities

The plugin learns from swarm outcomes to improve future decompositions.

### Confidence Decay

Evaluation criteria weights decay over time unless revalidated. If a criterion (e.g., `type_safe`) has been historically unreliable, its weight decreases.

```typescript
import {
  calculateDecayedValue,
  calculateCriterionWeight,
} from "opencode-swarm-plugin";

// Value decays by 50% every 90 days (configurable half-life)
const weight = calculateDecayedValue(timestamp, now, halfLifeDays);

// Calculate criterion weight from feedback history
const criterionWeight = calculateCriterionWeight(feedbackEvents);
// { criterion: "type_safe", weight: 0.85, helpful_count: 10, harmful_count: 2 }
```

### Implicit Feedback Scoring

The `swarm_record_outcome` tool tracks task outcomes and infers feedback:

- **Fast completion + success** → helpful signal
- **Slow completion + errors + retries** → harmful signal

```typescript
// Record outcome after completing a subtask
await tools["swarm_record_outcome"]({
  bead_id: "bd-abc123.1",
  duration_ms: 60000,
  error_count: 0,
  retry_count: 0,
  success: true,
  files_touched: ["src/auth.ts"],
});
// Returns feedback events for each criterion
```

### Anti-Pattern Learning

Failed decomposition patterns are automatically inverted to anti-patterns:

```typescript
import {
  recordPatternObservation,
  formatAntiPatternsForPrompt,
} from "opencode-swarm-plugin";

// Record pattern failure
const result = recordPatternObservation(pattern, false, beadId);
if (result.inversion) {
  // Pattern was inverted: "Split by file type" → "AVOID: Split by file type. Failed 4/5 times (80% failure rate)"
}

// Include anti-patterns in decomposition prompts
const antiPatternContext = formatAntiPatternsForPrompt(patterns);
```

### Pattern Maturity

Patterns progress through maturity states: `candidate` → `established` → `proven` (or `deprecated`).

```typescript
import {
  calculateMaturityState,
  getMaturityMultiplier,
} from "opencode-swarm-plugin";

// Calculate state from feedback
const state = calculateMaturityState(feedbackEvents);
// "candidate" | "established" | "proven" | "deprecated"

// Get weight multiplier for pattern ranking
const multiplier = getMaturityMultiplier("proven"); // 1.5
```

### UBS Pre-Completion Scan

The `swarm_complete` tool runs UBS (Ultimate Bug Scanner) on modified files before marking complete:

```typescript
await tools["swarm_complete"]({
  project_key: "/path/to/project",
  agent_name: "BlueLake",
  bead_id: "bd-abc123.1",
  summary: "Implemented auth flow",
  files_touched: ["src/auth.ts", "src/middleware.ts"],
  // skip_ubs_scan: true  // Optional: bypass scan
});
// Blocks completion if critical bugs found
```

### CASS History Context

The `swarm_decompose` tool queries CASS (Cross-Agent Session Search) for similar past tasks:

```typescript
await tools["swarm_decompose"]({
  task: "Add user authentication with OAuth",
  max_subtasks: 5,
  query_cass: true, // Default: true
  cass_limit: 3, // Max results to include
});
// Includes successful patterns from past decompositions in context
```

## Context Preservation

**CRITICAL**: This plugin enforces context-safe defaults to prevent session exhaustion.

### Why These Constraints Exist

| Constraint           | Default                      | Reason                                             |
| -------------------- | ---------------------------- | -------------------------------------------------- |
| Inbox limit          | 5 messages                   | Fetching 20+ messages with bodies exhausts context |
| Bodies excluded      | `include_bodies: false`      | Message bodies can be huge; fetch individually     |
| Summarize over fetch | `summarize_thread` preferred | Get key points, not raw message dump               |

### The Pattern

```typescript
// WRONG: This can dump thousands of tokens into context
const messages = await tools["agentmail_inbox"]({
  limit: 20,
  include_bodies: true, // Plugin prevents this
});

// RIGHT: Headers only, then fetch specific messages
const headers = await tools["agentmail_inbox"]({ limit: 5 });
const importantMessage = await tools["agentmail_read_message"]({
  message_id: headers[0].id,
});

// BEST: Summarize threads instead of fetching all messages
const summary = await tools["agentmail_summarize_thread"]({
  thread_id: "bd-abc123",
});
```

### Hard Caps

The plugin enforces these limits regardless of input:

- `agentmail_inbox` - Max 5 messages, bodies always excluded
- Thread summaries use LLM mode for concise output
- File reservations auto-track for cleanup

## Custom Commands

This plugin provides tools that work with OpenCode's [custom commands](https://opencode.ai/docs/commands). Create a `/swarm` command to orchestrate multi-agent work.

### Setup /swarm Command

Copy the example command to your OpenCode config:

```bash
cp examples/commands/swarm.md ~/.config/opencode/command/
```

### Usage

```
/swarm "Add user authentication with OAuth providers"
```

### How It Works

1. **Decompose** - `swarm_decompose` breaks task into subtasks with file assignments
2. **Create beads** - `beads_create_epic` creates epic + subtasks atomically
3. **Spawn agents** - `swarm_spawn_subtask` generates prompts WITH Agent Mail/beads instructions
4. **Parallel work** - Subagents use Agent Mail to communicate, beads to track progress
5. **Coordination** - Agents report progress, ask questions, announce blockers via Agent Mail
6. **Completion** - Agents use `swarm_complete` when done
7. **Cleanup** - `beads_sync` pushes to git

### Subagent Capabilities

Spawned subagents have **full access** to all plugin tools:

- **Agent Mail** - `agentmail_send`, `agentmail_inbox`, `agentmail_reserve`, etc.
- **Beads** - `beads_update`, `beads_create`, `swarm_complete`
- All standard OpenCode tools

The prompts tell agents to actively communicate and coordinate.

## Error Handling

The plugin provides typed errors for robust error handling:

```typescript
import {
  BeadError,
  BeadValidationError,
  AgentMailError,
  AgentMailNotInitializedError,
  FileReservationConflictError,
} from "opencode-swarm-plugin";

try {
  await tools["agentmail_reserve"]({ paths: ["src/index.ts"] });
} catch (error) {
  if (error instanceof FileReservationConflictError) {
    console.log("Conflicts:", error.conflicts);
    // [{ path: "src/index.ts", holders: ["RedStone"] }]
  }
}
```

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Run tests
bun test

# Build for distribution
bun run build

# Clean build artifacts
bun run clean
```

## License

MIT
