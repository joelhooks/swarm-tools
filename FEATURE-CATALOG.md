# Feature Catalog: Last 5 Days

```
    ╔══════════════════════════════════════════════════════════════════╗
    ║                                                                  ║
    ║     🐝  SWARM TOOLS FEATURE CATALOG  🐝                          ║
    ║                                                                  ║
    ║     "Events capture WHAT happened.                               ║
    ║      Context graphs explain WHY."                                ║
    ║                                                                  ║
    ╚══════════════════════════════════════════════════════════════════╝
```

## Executive Summary

**What Shipped:**

1. **Swarm Signature Detection** - Events as source of truth for compaction (fixes "0 open epics" bug)
2. **Memory System Wave 1-3** - Smart upsert (Mem0), auto-tagging, linking (Zettelkasten), entity extraction (A-MEM)
3. **Decision Traces Infrastructure** - Context graph architecture for capturing WHY decisions were made
4. **Observability Stack** - CLI tools for debugging swarm coordination (query, dashboard, replay, export)
5. **Dashboard Improvements** - Robust WebSocket with partysocket, React 19 compatibility
6. **Quality Improvements** - `hive_cells` partial ID search, contributor lookup, graceful degradation

**Why It Matters:**

- **Compaction now works** - Coordinators wake up with accurate state from event projection
- **Memory system is production-ready** - LLM decides ADD/UPDATE/DELETE, auto-tags, links knowledge
- **Debugging is first-class** - Query past swarms, replay events, export for analysis
- **Developer experience improved** - Partial ID search, connection status UI, better error messages

---

## 1. Swarm Signature Detection (v0.45.0)

> "Applications that use event sourcing need to take the log of events and transform it into
> application state that is suitable for showing to a user."
> — Martin Kleppmann, _Designing Data-Intensive Applications_

**Commit:** [`f9fd732`](https://github.com/joelhooks/swarm-tools/commit/f9fd73295b0f5c4b4f5230853a165af81a04f806)

### What It Does

Deterministic swarm detection via **event projection**. Instead of querying the hive (which can be stale), we fold over session events to reconstruct ground truth state.

**The Problem:** Compaction was detecting swarms (106 high-confidence tool calls) but finding "0 open epics" because cells were already closed by the time compaction triggered.

**The Solution:** New `projectSwarmState()` function folds over events to produce accurate state, even when hive projections are stale.

```
                  SESSION EVENTS                    HIVE (projection)
                  ═══════════════                   ═════════════════

    ┌─────────────────────────────────┐              ┌─────────────────┐
    │ hive_create_epic(...)           │──────────────│ epic: open      │
    │ swarm_spawn_subtask(bd-123.1)   │              │ bd-123.1: open  │
    │ swarm_spawn_subtask(bd-123.2)   │              │ bd-123.2: open  │
    │ swarm_complete(bd-123.1)        │──────────────│ bd-123.1: closed│
    │ swarm_complete(bd-123.2)        │──────────────│ bd-123.2: closed│
    │ hive_close(epic)                │──────────────│ epic: closed    │
    └─────────────────────────────────┘              └─────────────────┘
                ↑                                               ↑
           SOURCE OF TRUTH                              STALE PROJECTION
           (immutable log)                              (all cells closed)

    ┌──────────────────────────────────────────────────────────────────┐
    │  COMPACTION TRIGGERS HERE                                        │
    │  ════════════════════════                                        │
    │                                                                  │
    │  Old approach: Query hive → "0 open epics" → "No cells found"   │
    │  New approach: Fold events → "Epic with 2 subtasks, completed"  │
    └──────────────────────────────────────────────────────────────────┘
```

### How to Test

```bash
# View swarm signature tests
bun test packages/opencode-swarm-plugin/src/swarm-signature.test.ts

# Run compaction on a session with closed cells
# - Compaction should now show "Epic 'X' with Y/Z subtasks complete" 
# - Instead of "No cells found"
```

### Key Files

- `packages/opencode-swarm-plugin/src/swarm-signature.ts` - Event projection logic
- `packages/opencode-swarm-plugin/src/swarm-signature.test.ts` - Deterministic tests
- `packages/opencode-swarm-plugin/src/compaction-hook.ts` - Integration point

### Key Functions

| Function              | Purpose                            |
| --------------------- | ---------------------------------- |
| `projectSwarmState()` | Fold over events → SwarmProjection |
| `hasSwarmSignature()` | Quick check: epic + spawn present? |
| `isSwarmActive()`     | Any pending work?                  |
| `getSwarmSummary()`   | Human-readable status for prompts  |

---

## 2. Memory System Wave 1-3 (v1.6.1)

> "Our approach draws inspiration from the Zettelkasten method, a sophisticated
> knowledge management system that creates interconnected information networks
> through atomic notes and flexible linking."
> — _A-MEM: Agentic Memory for LLM Agents_

**Commit:** [`ef21ee0`](https://github.com/joelhooks/swarm-tools/commit/ef21ee0d943e0d993865dd44b69b25c025de79ac)

### What It Does

Production-ready semantic memory with **smart operations** (Mem0 pattern), **auto-tagging**, **memory linking** (Zettelkasten), and **entity extraction** (A-MEM).

```
                   .-.
                  (o o)  "Should I ADD, UPDATE, or NOOP?"
                  | O |
                  /   \        ___
                 /     \    .-'   '-.
       _____    /       \  /  .-=-.  \    _____
      /     \  |  ^   ^  ||  /     \  |  /     \
     | () () | |  (o o)  || | () () | | | () () |
      \_____/  |    <    ||  \_____/  |  \_____/
         |      \  ===  /  \    |    /      |
        _|_      '-----'    '--|--'       _|_
       /   \                   |         /   \
      | mem |<----related---->|mem|<--->| mem |
       \___/                   |         \___/
                           supersedes
                               |
                            ___|___
                           /       \
                          | mem-old |
                           \_______/
                               †
```

### Features

**1. Smart Upsert (Mem0 Pattern)**

LLM decides operation: ADD (new info), UPDATE (refines existing), DELETE (contradicts), NOOP (duplicate).

```typescript
const result = await memory.upsert(
  "OAuth tokens need 5min buffer (changed from 3min)",
  { useSmartOps: true }
);

console.log(result.operation); // "UPDATE" - refines existing memory
console.log(result.updatedIds); // ["mem-xyz123"]
console.log(result.reason); // "Refines timing from 3min to 5min"
```

**2. Auto-Tagging**

LLM extracts tags from content automatically.

```typescript
await memory.store(
  "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions",
  { autoTag: true }
);
// Auto-tagged: "auth", "oauth", "tokens", "race-conditions", "timing"
```

**3. Memory Linking (Zettelkasten)**

Interconnect knowledge via related memories.

```typescript
await memory.linkMemories(memA, memB, {
  linkType: "related_to",
  strength: 0.8,
  context: "Both describe token refresh patterns"
});

// Query graph
const related = await memory.getRelatedMemories(memA, {
  maxDepth: 2,
  minStrength: 0.5
});
```

**4. Entity Extraction (A-MEM)**

Automatic knowledge graph from memories.

```typescript
const entities = await memory.extractEntities(memId);
// Returns: { persons: [], organizations: [], concepts: ["OAuth", "token refresh"], ... }

// Query by entity
const memories = await memory.findByEntity("OAuth", { entityType: "concept" });
```

**5. Temporal Queries**

Supersession chains and validity tracking.

```typescript
// Get memory with supersession chain
const mem = await memory.get(id, { includeSuperseded: true });
console.log(mem.supersededBy); // Newer version if exists
console.log(mem.validFrom, mem.validUntil); // Validity window

// Find all versions
const chain = await memory.getSupersessionChain(id);
```

### How to Test

```bash
# Run memory system tests
bun test packages/swarm-mail/src/memory/

# Run smart operations eval
cd packages/opencode-swarm-plugin
bun run eval:smart-operations

# Test auto-tagging (requires Ollama)
bun test packages/swarm-mail/src/memory/auto-tagger.test.ts

# Test entity extraction (requires Ollama)
bun test packages/swarm-mail/src/memory/entity-extractor.test.ts
```

### Key Files

- `packages/swarm-mail/src/memory/auto-tagger.ts` - LLM tag extraction
- `packages/swarm-mail/src/memory/smart-operations.ts` - Mem0 ADD/UPDATE/DELETE/NOOP
- `packages/swarm-mail/src/memory/memory-linker.ts` - Zettelkasten graph
- `packages/swarm-mail/src/memory/entity-extractor.ts` - A-MEM entities
- `packages/swarm-mail/src/memory/temporal-queries.ts` - Supersession tracking
- `packages/opencode-swarm-plugin/evals/smart-operations.eval.ts` - LLM-as-judge eval

### Schema Changes

New tables in libSQL:

- `memory_links` - Zettelkasten graph edges
- `memory_entities` - Entity extraction (persons, orgs, concepts)
- `memory_supersessions` - Temporal validity chains

New columns in `memories`:

- `auto_tags` - JSON array of LLM-extracted tags
- `valid_from`, `valid_until` - Temporal validity window

---

## 3. Decision Traces & Context Graph (v0.45.0)

> "The best way to predict the future is to look at the past. But to understand the past, you need to know not just what happened, but why it happened. That's the difference between data and knowledge."
> — Martin Kleppmann, _Designing Data-Intensive Applications_

**Commit:** [`920f6bc`](https://github.com/joelhooks/swarm-tools/commit/920f6bcbcb2c3687cfe94316d94202903e21fb3a) (ADR)  
**Commit:** [`a259221`](https://github.com/joelhooks/swarm-tools/commit/a2592213252290053d324eb93dd21fbf170d7c71) (Implementation)  
**Commit:** [`463f291`](https://github.com/joelhooks/swarm-tools/commit/463f2916b2f29f55f5d8bbaf0056a2abaf8100c7) (Wiring)  
**Commit:** [`846ef68`](https://github.com/joelhooks/swarm-tools/commit/846ef685b3c1165c73861fa49e69d90646cbffa4) (Learning integration)

### What It Does

Captures **WHY decisions were made**, not just WHAT happened. Stores decision-time context as queryable precedent with entity linking.

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 3: Decision Traces (New)                         │
│  ─────────────────────────────────────────────          │
│  Structured decision context with entity links          │
│  - Why this strategy?                                   │
│  - What precedent applied?                              │
│  - Which alternatives rejected?                         │
│  - How conflicts resolved?                              │
└─────────────────────────────────────────────────────────┘
              ▲
              │ Enriches via projection
              │
┌─────────────────────────────────────────────────────────┐
│  LAYER 2: Events (Current)                              │
│  ──────────────────────────────────────────             │
│  Append-only event log                                  │
│  - worker_spawned, task_completed, etc.                 │
│  - Immutable audit trail                                │
│  - Source of truth for WHAT happened                    │
└─────────────────────────────────────────────────────────┘
              ▲
              │ Writes to
              │
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: Database (libSQL)                             │
│  ───────────────────────────────────────                │
│  - Events table (append-only)                           │
│  - Projections (agents, messages, reservations)         │
│  - Decision traces (new table)                          │
│  - Entity links (new table)                             │
└─────────────────────────────────────────────────────────┘
```

### Features

**Decision Types Captured:**

- `decomposition_strategy` - Why this decomposition approach?
- `file_assignment` - Why these files to this worker?
- `exception_granted` - Why override the guideline?
- `review_approval` - Why approve/reject this work?
- `conflict_resolution` - How was the conflict resolved?

**Each decision trace includes:**

- Decision made (structured JSON)
- Rationale (human-readable WHY)
- Inputs gathered (CASS queries, semantic memory, past outcomes)
- Policy evaluated (guidelines applied, exceptions granted)
- Alternatives considered (what else was on the table)
- Precedent cited (specific epics/patterns referenced)
- Outcome link (FK to events.id for result)

**Entity links enable queries like:**

- "Show all decisions that cited epic mj100 as precedent"
- "What precedent influenced this file assignment?"
- "Which decisions applied the OAuth buffer pattern?"

### How to Test

```bash
# View decision trace schema
cat packages/swarm-mail/src/db/schema/decision-traces.ts

# Run decision trace tests
bun test packages/swarm-mail/src/streams/decision-trace-store.test.ts
bun test packages/opencode-swarm-plugin/src/decision-trace-integration.test.ts

# Query decision traces (once implemented)
swarm query --preset decision_traces_by_precedent --epic <epic-id>
swarm query --preset file_assignment_history --file src/auth.ts
```

### Key Files

- `.hive/analysis/context-graph-architecture.md` - Full ADR with examples
- `packages/swarm-mail/src/db/schema/decision-traces.ts` - Schema definition
- `packages/swarm-mail/src/streams/decision-trace-store.ts` - Store implementation
- `packages/opencode-swarm-plugin/src/swarm-decompose.ts` - Capture at decomposition
- `packages/opencode-swarm-plugin/src/swarm-review.ts` - Capture at review

### Schema

**decision_traces table:**

```typescript
{
  id: string;                   // dt-{nanoid}
  decision_type: string;        // 'decomposition_strategy', 'file_assignment', etc.
  epic_id?: string;
  bead_id?: string;
  agent_name: string;
  project_key: string;
  decision: string;             // JSON: actual decision
  rationale?: string;           // Human-readable WHY
  inputs_gathered?: string;     // JSON: CASS, semantic memory, past outcomes
  policy_evaluated?: string;    // JSON: guidelines, exceptions
  alternatives?: string;        // JSON: what was considered and rejected
  precedent_cited?: string;     // JSON: specific precedent
  outcome_event_id?: number;    // FK to events.id
  timestamp: number;
}
```

**entity_links table:**

```typescript
{
  id: string;
  source_decision_id: string;   // FK to decision_traces.id
  target_entity_type: string;   // 'epic', 'pattern', 'file', 'agent', 'memory'
  target_entity_id: string;
  link_type: string;            // 'cites_precedent', 'applies_pattern', 'similar_to'
  strength: number;             // 0-1
  context?: string;             // Why this link matters
}
```

---

## 4. Observability Stack (v0.43.0)

> "You can't fix what you can't see."
> — Every SRE ever

**Commit:** [`8f812be`](https://github.com/joelhooks/swarm-tools/commit/8f812be2c05ae63f4b3c96f31f6f1d78993dbf80) (CLI tools)  
**Commit:** [`7df6009`](https://github.com/joelhooks/swarm-tools/commit/7df6009) (Export + replay)

### What It Does

First-class debugging tools for swarm coordination: query analytics, live dashboard, event replay, and export.

### 4.1 SwarmError Class

Structured error context for debugging multi-agent failures.

```typescript
import { SwarmError, enrichError } from "opencode-swarm-plugin";

// Throw with context
throw new SwarmError("File reservation failed", {
  file: "src/auth.ts",
  line: 42,
  agent: "DarkHawk",
  epic_id: "mjmas3zxlmg",
  bead_id: "mjmas40ys7g",
  recent_events: [
    { type: "worker_spawned", timestamp: "2025-12-25T10:00:00Z", message: "Worker started" },
    { type: "reservation_attempted", timestamp: "2025-12-25T10:01:00Z", message: "Tried to reserve src/auth.ts" }
  ]
});

// Enrich existing error
try {
  await doWork();
} catch (error) {
  throw enrichError(error, {
    agent: "BlueLake",
    epic_id: "mjmas3zxlmg"
  });
}
```

**Test:**

```bash
bun test packages/opencode-swarm-plugin/src/error-enrichment.test.ts
```

### 4.2 `swarm query` - SQL Analytics

SQL analytics with 10+ presets for common patterns.

```bash
# Execute custom SQL query
swarm query --sql "SELECT * FROM events WHERE type='worker_spawned' LIMIT 10"

# Use preset query
swarm query --preset failed_decompositions
swarm query --preset duration_by_strategy
swarm query --preset file_conflicts
swarm query --preset worker_success_rate

# Output formats
swarm query --preset failed_decompositions --format table  # Default
swarm query --preset duration_by_strategy --format csv
swarm query --preset file_conflicts --format json
```

**Available Presets:**

| Preset | What It Shows |
|--------|---------------|
| `failed_decompositions` | Epics that failed with error details |
| `duration_by_strategy` | Avg duration grouped by decomposition strategy |
| `file_conflicts` | File reservation conflicts between workers |
| `worker_success_rate` | Success rate per worker agent |
| `review_rejections` | Tasks rejected during coordinator review |
| `blocked_tasks` | Tasks currently blocked with reasons |
| `agent_activity` | Agent activity timeline |
| `event_frequency` | Event type distribution |
| `error_patterns` | Common error patterns |
| `compaction_stats` | Context compaction metrics |

**Test:**

```bash
# View query presets
cat packages/opencode-swarm-plugin/src/query-tools.ts

# Run query tests
bun test packages/opencode-swarm-plugin/src/query-tools.test.ts
```

### 4.3 `swarm dashboard` - Real-Time Monitoring

Live terminal UI with worker status, progress bars, file reservations, and messages.

```bash
# Launch dashboard (auto-refresh every 1s)
swarm dashboard

# Focus on specific epic
swarm dashboard --epic mjmas3zxlmg

# Custom refresh rate (milliseconds)
swarm dashboard --refresh 2000
```

**Shows:**

- Active workers and their current tasks
- Progress bars for in-progress work
- File reservations (who owns what)
- Recent messages between agents
- Error alerts

**Test:**

```bash
bun test packages/opencode-swarm-plugin/src/dashboard.test.ts
```

### 4.4 `swarm replay` - Event Debugging

Replay epic events with timing control.

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
```

**Use cases:**

- Debug coordination failures by replaying the sequence
- Understand timing of worker spawns vs completions
- Identify where bottlenecks occurred
- Review coordinator decision points

**Test:**

```bash
bun test packages/opencode-swarm-plugin/src/replay-tools.test.ts
```

### 4.5 `swarm export` - Data Export

Export events for external analysis.

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

**Test:**

```bash
bun test packages/opencode-swarm-plugin/src/export-tools.test.ts
```

### 4.6 `swarm stats` - Health Metrics

Health metrics powered by swarm-insights.

```bash
# Last 7 days (default)
swarm stats

# Custom time period
swarm stats --since 24h
swarm stats --since 30m

# JSON output for scripting
swarm stats --json
```

### 4.7 `swarm history` - Activity Timeline

Recent swarm activity timeline.

```bash
# Last 10 swarms (default)
swarm history

# More results
swarm history --limit 20

# Filter by status
swarm history --status success
swarm history --status failed

# Filter by strategy
swarm history --strategy file-based

# Verbose mode (show subtasks)
swarm history --verbose
```

### Key Files

- `packages/opencode-swarm-plugin/src/error-enrichment.ts` - SwarmError class
- `packages/opencode-swarm-plugin/src/query-tools.ts` - SQL presets
- `packages/opencode-swarm-plugin/src/dashboard.ts` - Real-time UI
- `packages/opencode-swarm-plugin/src/replay-tools.ts` - Event replay
- `packages/opencode-swarm-plugin/src/export-tools.ts` - Data export
- `packages/opencode-swarm-plugin/src/observability-tools.ts` - Stats + history
- `packages/opencode-swarm-plugin/bin/swarm.ts` - CLI entry point

---

## 5. Dashboard Improvements

**Commit:** [`ddde00a`](https://github.com/joelhooks/swarm-tools/commit/ddde00a0bd1a8487e645ecb45f99c2539a0b4be1) (React 19 + partysocket fix)  
**Commit:** [`eedf637`](https://github.com/joelhooks/swarm-tools/commit/eedf6378f14e5d8df14b8f48c42b61ceef1f44a9) (WebSocket + connection status)

### What It Does

**1. Robust WebSocket with partysocket**

Replaced raw WebSocket with `partysocket` library for automatic reconnection, exponential backoff, and connection health monitoring.

```typescript
import usePartySocket from "partysocket/react";

const socket = usePartySocket({
  host: "localhost:4483",
  party: "swarm",
  room: "dashboard",
  onMessage: (event) => {
    const data = JSON.parse(event.data);
    // Handle event...
  },
  onOpen: () => console.log("Connected"),
  onClose: () => console.log("Disconnected"),
  onError: (err) => console.error("Error:", err),
});
```

**2. Connection Status UI**

Visual indicator in dashboard showing WebSocket connection state (connected, disconnecting, reconnecting, disconnected).

**3. React 19 Compatibility**

Fixed duplicate instance error when using React 19's concurrent features with partysocket.

### How to Test

```bash
# Start dashboard
cd packages/swarm-dashboard
bun run dev

# Dashboard should show connection status
# Try disconnecting network to see reconnection
```

### Key Files

- `packages/swarm-dashboard/src/hooks/useWebSocket.ts` - partysocket integration
- `packages/swarm-dashboard/src/components/ConnectionStatus.tsx` - UI indicator
- `packages/swarm-dashboard/PARTYSOCKET-MIGRATION.md` - Migration notes

---

## 6. Quality Improvements

### 6.1 `hive_cells` Partial ID Search

**Commit:** [`d7b39c0`](https://github.com/joelhooks/swarm-tools/commit/d7b39c017454dbaf5d2c240927496845056c1d2d)

Previously, `hive_cells({ id: "mjonid" })` would throw "Ambiguous ID" error when multiple cells matched. Now it returns all matches (query tool, not update tool).

```
     ┌──────────────────────────────────────┐
     │  BEFORE: "Ambiguous ID" error 💀     │
     │                                      │
     │  > hive_cells({ id: "mjonid" })      │
     │  Error: multiple cells match         │
     │                                      │
     ├──────────────────────────────────────┤
     │  AFTER: Returns all matches 🎯       │
     │                                      │
     │  > hive_cells({ id: "mjonid" })      │
     │  [                                   │
     │    { id: "...-mjonidihuyq", ... },   │
     │    { id: "...-mjonidimchs", ... },   │
     │    { id: "...-mjonidioq28", ... },   │
     │    ...13 cells total                 │
     │  ]                                   │
     └──────────────────────────────────────┘
```

**Test:**

```bash
bun test packages/swarm-mail/src/hive/hive-adapter.test.ts
```

### 6.2 `contributor_lookup` Tool

**Commit:** [`01c2c2f`](https://github.com/joelhooks/swarm-tools/commit/01c2c2f)

Automatic credit extraction for changelogs. Fetches GitHub contributor info (name, avatar, company) from commit author.

```typescript
import { contributorLookup } from "opencode-swarm-plugin";

const info = await contributorLookup("sm0ol");
// Returns: { login: "sm0ol", name: "Mool", avatar_url: "...", company: null }
```

**Test:**

```bash
bun test packages/opencode-swarm-plugin/src/contributor-tools.test.ts
```

### 6.3 Graceful Degradation for Semantic Memory

**Commit:** [`823987d`](https://github.com/joelhooks/swarm-tools/commit/823987d)

Semantic memory gracefully degrades when Ollama is unavailable. Features requiring LLM (auto-tagging, smart upsert, entity extraction) return helpful error messages instead of crashing.

```typescript
// Auto-tagging fails gracefully
const result = await memory.store("Some info", { autoTag: true });
if (!result.autoTagsApplied) {
  console.warn(result.warning); // "Auto-tagging requires Ollama with mxbai-embed-large"
}
```

**Test:**

```bash
# Stop Ollama and run tests
bun test packages/swarm-mail/src/memory/auto-tagger.test.ts
# Should skip LLM-dependent tests gracefully
```

### 6.4 Git Worktree Support

**Commit:** [`823987d`](https://github.com/joelhooks/swarm-tools/commit/823987d)

Fixed database sharing between worktrees. Workers in git worktrees now share the main repo's swarm-mail database instead of creating isolated databases.

**Test:**

```bash
# Create worktree
git worktree add ../my-feature feature-branch

# Run swarm command in worktree
cd ../my-feature
swarm stats  # Should use main repo's database
```

---

## Testing the Features

### Observability Stack

```bash
# Query presets
swarm query --preset failed_decompositions
swarm query --preset duration_by_strategy --format csv

# Live dashboard
swarm dashboard --epic <epic-id>

# Replay events
swarm replay <epic-id> --speed 2x --type worker_spawned

# Export data
swarm export --epic <epic-id> --format json | jq '.[] | select(.type=="error")'

# Health metrics
swarm stats --since 24h
swarm history --status failed
```

### Memory System

```bash
# Basic operations
cd packages/swarm-mail
bun test src/memory/

# Smart operations eval
cd ../opencode-swarm-plugin
bun run eval:smart-operations

# Auto-tagging (requires Ollama)
bun test packages/swarm-mail/src/memory/auto-tagger.test.ts

# Entity extraction (requires Ollama)
bun test packages/swarm-mail/src/memory/entity-extractor.test.ts

# Memory linking
bun test packages/swarm-mail/src/memory/memory-linker.test.ts
```

### Swarm Signature Detection

```bash
# Unit tests
bun test packages/opencode-swarm-plugin/src/swarm-signature.test.ts

# Integration test
# 1. Create epic + subtasks via hive
# 2. Close all cells
# 3. Trigger compaction
# 4. Compaction should show "Epic with X/Y subtasks" instead of "No cells found"
```

### Dashboard

```bash
# Start dashboard server
cd packages/swarm-dashboard
bun run dev

# Open http://localhost:4483
# Should show connection status (green = connected)

# Disconnect network → should show reconnecting
# Reconnect network → should auto-reconnect
```

---

## References

### Commits (Last 5 Days)

- [`f9fd732`](https://github.com/joelhooks/swarm-tools/commit/f9fd73295b0f5c4b4f5230853a165af81a04f806) - Swarm signature detection
- [`ef21ee0`](https://github.com/joelhooks/swarm-tools/commit/ef21ee0d943e0d993865dd44b69b25c025de79ac) - Memory Wave 1-3 polish
- [`846ef68`](https://github.com/joelhooks/swarm-tools/commit/846ef685b3c1165c73861fa49e69d90646cbffa4) - Decision traces Phase 4
- [`8f812be`](https://github.com/joelhooks/swarm-tools/commit/8f812be2c05ae63f4b3c96f31f6f1d78993dbf80) - Observability CLI tools
- [`ddde00a`](https://github.com/joelhooks/swarm-tools/commit/ddde00a0bd1a8487e645ecb45f99c2539a0b4be1) - Dashboard React 19 fix
- [`d7b39c0`](https://github.com/joelhooks/swarm-tools/commit/d7b39c017454dbaf5d2c240927496845056c1d2d) - hive_cells partial ID search
- [`01c2c2f`](https://github.com/joelhooks/swarm-tools/commit/01c2c2f) - contributor_lookup tool
- [`823987d`](https://github.com/joelhooks/swarm-tools/commit/823987d) - Worktree + graceful degradation

### Documentation

- `AGENTS.md` - Usage guide for all features
- `packages/opencode-swarm-plugin/CHANGELOG.md` - Version history
- `packages/swarm-mail/CHANGELOG.md` - Core library changes
- `packages/swarm-mail/README.md` - Memory system Wave 1-3 docs
- `.hive/analysis/context-graph-architecture.md` - Decision traces ADR

### Key Files

**Swarm Signature:**
- `src/swarm-signature.ts` - Event projection
- `src/swarm-signature.test.ts` - Tests
- `src/compaction-hook.ts` - Integration

**Memory System:**
- `packages/swarm-mail/src/memory/auto-tagger.ts`
- `packages/swarm-mail/src/memory/smart-operations.ts`
- `packages/swarm-mail/src/memory/memory-linker.ts`
- `packages/swarm-mail/src/memory/entity-extractor.ts`
- `packages/swarm-mail/src/memory/temporal-queries.ts`

**Decision Traces:**
- `packages/swarm-mail/src/db/schema/decision-traces.ts`
- `packages/swarm-mail/src/streams/decision-trace-store.ts`
- `packages/opencode-swarm-plugin/src/swarm-decompose.ts`

**Observability:**
- `src/error-enrichment.ts`
- `src/query-tools.ts`
- `src/dashboard.ts`
- `src/replay-tools.ts`
- `src/export-tools.ts`
- `bin/swarm.ts`

---

```
           🐝
         /   \
        | o o |  "The hive remembers."
         \   /
          | |
         _| |_
        /     \
       |  🍯   |
        \_____/
```

**Shipped with love by the swarm.** 🐝
