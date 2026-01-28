# swarm-mail

```
                                _.------._
                               .'   .--.   '.        🐝
                              /   .'    '.   \    🐝
                             |   /   __   \   |      🐝
       🐝                    |  |   (  )   |  |  🐝
            🐝    _  _       |  |   |__|   |  |
                 ( \/ )       \  '.      .'  /    🐝
       🐝    ____/    \____    '.  '----'  .'
           /    \    /    \     '-._____.-'           🐝
          /  ()  \  /  ()  \
         |   /\   ||   /\   |     ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
         |  /__\  ||  /__\  |     ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
          \      /  \      /      ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
       🐝  '----'    '----'       ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
                                  ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
             🐝                   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
                    🐝
       🐝                         ███╗   ███╗ █████╗ ██╗██╗
                                  ████╗ ████║██╔══██╗██║██║         🐝
            🐝                    ██╔████╔██║███████║██║██║
                                  ██║╚██╔╝██║██╔══██║██║██║    🐝
       🐝        🐝               ██║ ╚═╝ ██║██║  ██║██║███████╗
                                  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝       🐝
                 🐝
                             ⚡ Event Sourcing + Actor Model Primitives ⚡
```

Event sourcing and actor-model primitives for multi-agent coordination. Built on **libSQL** (embedded SQLite) with **Drizzle ORM**. Local-first, no external servers.

**[🌐 swarmtools.ai](https://swarmtools.ai)** | **[📖 Full Documentation](https://swarmtools.ai/docs)**

## What is swarm-mail?

A TypeScript library providing:

1. **Event Store** - Append-only log with automatic projection updates (agents, messages, file reservations)
2. **Actor Primitives** - DurableMailbox, DurableLock, DurableCursor, DurableDeferred (Effect-TS based)
3. **Hive** - Git-synced work item tracker (cells, epics, dependencies)
4. **Semantic Memory** - Vector embeddings for persistent agent learnings (Ollama + libSQL native vector support via sqlite-vec)

```
┌─────────────────────────────────────────────────────────────┐
│                     SWARM MAIL STACK                        │
├─────────────────────────────────────────────────────────────┤
│  COORDINATION                                               │
│  ├── HiveAdapter - Work item tracking (cells, epics)       │
│  └── ask<Req, Res>() - Request/Response (RPC-style)        │
│                                                             │
│  PATTERNS                                                   │
│  ├── DurableMailbox - Actor inbox with typed envelopes     │
│  └── DurableLock - CAS-based mutual exclusion              │
│                                                             │
│  PRIMITIVES                                                 │
│  ├── DurableCursor - Checkpointed stream reader            │
│  └── DurableDeferred - Distributed promise                 │
│                                                             │
│  MEMORY                                                     │
│  └── Semantic Memory - Vector embeddings (Ollama/sqlite-vec) │
│                                                             │
│  STORAGE                                                    │
│  └── libSQL (Embedded SQLite via Drizzle ORM)              │
└─────────────────────────────────────────────────────────────┘
```

## Event Flow Architecture

Shows how agent actions flow from tool calls → libSQL events → CLI queries/dashboards.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    EVENT FLOW: Agent → libSQL → CLI                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ╔═══════════════════╗                                                   │
│  ║ AGENT (Worker)    ║  Tool Calls via OpenCode MCP:                    │
│  ╚═══════════════════╝  ┌────────────────────────────────────┐          │
│           │             │ swarmmail_init()                   │          │
│           │             │ swarmmail_reserve(["src/auth.ts"]) │          │
│           │             │ swarm_progress(progress=50)        │          │
│           │             │ swarm_complete(...)                │          │
│           │             └────────────────────────────────────┘          │
│           ▼                                                              │
│  ╔═══════════════════════════════════════════════════════════════╗       │
│  ║ ADAPTER LAYER (swarm-mail)                                   ║       │
│  ║ packages/swarm-mail/src/adapter.ts                           ║       │
│  ╠═══════════════════════════════════════════════════════════════╣       │
│  ║ appendEvent(event: SwarmMailEvent)                           ║       │
│  ║  1. Validate with Zod schemas (56 event types)               ║       │
│  ║  2. Serialize event.data to JSON                             ║       │
│  ║  3. INSERT into events table                                 ║       │
│  ║                                                              ║       │
│  ║ Query Helpers (read from projections):                       ║       │
│  ║  ├─ getInbox() → messages table                             ║       │
│  ║  ├─ getReservations() → reservations table                  ║       │
│  ║  └─ getSwarmContext() → swarm_contexts table                ║       │
│  ╚═══════════════════════════════════════════════════════════════╝       │
│           │                                                              │
│           ▼                                                              │
│  ╔═══════════════════════════════════════════════════════════════╗       │
│  ║ libSQL DATABASE (SQLite embedded, no server)                ║       │
│  ║ ~/.config/swarm-tools/libsql/<project-hash>/swarm.db         ║       │
│  ╠═══════════════════════════════════════════════════════════════╣       │
│  ║ events (append-only log)                                     ║       │
│  ║ ┌──────┬──────────┬───────────┬──────────┬──────────┐        ║       │
│  ║ │  id  │   type   │ timestamp │project_key│  data   │        ║       │
│  ║ ├──────┼──────────┼───────────┼──────────┼──────────┤        ║       │
│  ║ │  1   │agent_reg │1703001234 │/proj/path│{"..."}  │        ║       │
│  ║ │  2   │file_res  │1703001240 │/proj/path│{"..."}  │        ║       │
│  ║ │  3   │task_start│1703001299 │/proj/path│{"..."}  │        ║       │
│  ║ └──────┴──────────┴───────────┴──────────┴──────────┘        ║       │
│  ║                                                              ║       │
│  ║ PROJECTIONS (auto-updated via triggers):                     ║       │
│  ║ ├─ agents          ← agent_registered, agent_active         ║       │
│  ║ ├─ messages        ← message_sent                           ║       │
│  ║ ├─ reservations    ← file_reserved, file_released           ║       │
│  ║ ├─ swarm_contexts  ← swarm_checkpointed                     ║       │
│  ║ └─ eval_records    ← eval_captured, eval_scored             ║       │
│  ╚═══════════════════════════════════════════════════════════════╝       │
│           │                                                              │
│    ┌──────┼─────┬──────────┬──────────┬──────────┐                      │
│    ▼      ▼     ▼          ▼          ▼          ▼                      │
│  ┌────┐┌────┐┌─────────┐┌────────┐┌────────┐┌────────┐                 │
│  │query││stats││dashboard││replay  ││export  ││log     │                 │
│  │(SQL)││(cnt)││  (TUI)  ││(time)  ││(JSONL) ││(tail)  │                 │
│  └────┘└────┘└─────────┘└────────┘└────────┘└────────┘                 │
│    │     │       │          │         │         │                       │
│    └─────┴───────┴──────────┴─────────┴─────────┘                       │
│                        ▼                                                 │
│  ╔═══════════════════════════════════════════════════════════════╗       │
│  ║ CLI OUTPUT                                                    ║       │
│  ╠═══════════════════════════════════════════════════════════════╣       │
│  ║ 📊 Analytics      📈 Dashboards     🔍 Debugging              ║       │
│  ║ ├─ Event counts   ├─ Live progress  ├─ Event replay          ║       │
│  ║ ├─ Duration P95   ├─ Agent status   ├─ Agent timeline        ║       │
│  ║ ├─ Failure rate   ├─ File locks     ├─ Conflict detection    ║       │
│  ║ └─ Conflict rate  └─ Auto-refresh   └─ Checkpoint history    ║       │
│  ╚═══════════════════════════════════════════════════════════════╝       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Flow Summary:**

1. **Agent Tool Call** → Agent calls `swarmmail_init()`, `swarm_progress()`, etc.
2. **Adapter Layer** → Validates with Zod (56 event types), serializes to JSON, appends to `events` table
3. **libSQL Storage** → Events stored in append-only log, projections auto-updated via triggers
4. **CLI Tools** → Query events/projections for analytics, monitoring, debugging
5. **Observability** → Full audit trail, replay capabilities, real-time dashboards

## Install

```bash
bun add swarm-mail
```

## Quick Start

```typescript
import { getSwarmMailLibSQL } from "swarm-mail";

// Create swarm mail instance (libSQL + Drizzle)
const swarmMail = await getSwarmMailLibSQL("/my/project");

// Append events
await swarmMail.appendEvent({
  type: "agent_registered",
  agent_name: "WorkerA",
  task_description: "Implementing auth",
  timestamp: Date.now(),
});

// Query projections
const agents = await swarmMail.getAgents();
const messages = await swarmMail.getInbox("WorkerA", { limit: 5 });

// Clean shutdown
await swarmMail.close();
```

## Core APIs

### Event Store

Append-only event log with automatic projection updates:

```typescript
import { getSwarmMailLibSQL } from "swarm-mail";

const swarmMail = await getSwarmMailLibSQL("/my/project");

// Append events
await swarmMail.appendEvent({
  type: "message_sent",
  from: "WorkerA",
  to: ["WorkerB"],
  subject: "Task complete",
  body: "Auth flow implemented",
  timestamp: Date.now(),
});

// Query inbox
const messages = await swarmMail.getInbox("WorkerB", { 
  limit: 5,
  unreadOnly: true 
});

// Get thread
const thread = await swarmMail.getThread("epic-123");

// Check file reservations
const conflicts = await swarmMail.checkConflicts([
  "src/auth.ts"
], "WorkerA");
```

### Hive (Work Item Tracker)

Git-synced work item tracking with cells and epics:

```typescript
import { createHiveAdapter } from "swarm-mail";

const hive = await createHiveAdapter({ 
  projectPath: "/my/project" 
});

// Create cell
const cell = await hive.createCell({
  title: "Add OAuth",
  type: "feature",
  priority: 2,
});

// Query cells
const open = await hive.queryCells({ status: "open" });
const ready = await hive.queryCells({ ready: true });

// Update cell
await hive.updateCell(cell.id, { 
  status: "in_progress",
  description: "Implementing Google OAuth flow"
});

// Close cell
await hive.closeCell(cell.id, "Completed: OAuth implemented");
```

### Semantic Memory

Vector embeddings for persistent agent learnings. Uses **libSQL native vector support via sqlite-vec extension** + **Ollama** for embeddings. Includes **Wave 1-3 smart operations** (Mem0 pattern, auto-tagging, linking, entity extraction).

#### Basic Usage

```typescript
import { createSemanticMemory } from "swarm-mail";

const memory = await createSemanticMemory("/my/project");

// Simple store (backward compatible - always adds new)
const { id } = await memory.store(
  "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions"
);

// Store with manual metadata
const { id } = await memory.store(
  "OAuth tokens need 5min buffer before expiry",
  { tags: "auth,tokens,debugging" }
);

// Search by semantic similarity (vector search)
const results = await memory.find("token refresh issues", { limit: 5 });

// Get specific memory
const mem = await memory.get(id);

// Validate (resets 90-day decay timer)
await memory.validate(id);

// Check Ollama health
const health = await memory.checkHealth();
// { ollama: true, model: "mxbai-embed-large" }
```

#### Wave 1-3 Smart Operations

**Smart Upsert (Mem0 Pattern)**

LLM analyzes new information and decides: ADD (new), UPDATE (refines), DELETE (contradicts), or NOOP (duplicate):

```typescript
// LLM decides operation intelligently
const result = await memory.upsert(
  "OAuth tokens need 5min buffer (changed from 3min)",
  { useSmartOps: true }
);

console.log(result.operation); // "UPDATE" - refines existing memory
console.log(result.reason);    // "Refines existing memory with updated timing"
console.log(result.id);        // Memory ID (existing for UPDATE/DELETE/NOOP, new for ADD)

// Examples of each operation:
// ADD: Completely new information not in memory
// UPDATE: Refines/updates existing memory with additional detail
// DELETE: New info contradicts existing memory (supersedes it)
// NOOP: Duplicate - already stored
```

**Auto-Tagging**

LLM extracts relevant tags from content automatically:

```typescript
const { id, autoTags } = await memory.store(
  "OAuth tokens need 5min buffer before expiry",
  { autoTag: true }
);

console.log(autoTags); 
// { tags: ["auth", "oauth", "tokens", "timing"], confidence: 0.85 }
```

**Memory Linking (Zettelkasten Pattern)**

Auto-link to semantically related memories:

```typescript
const { id, links } = await memory.store(
  "Token refresh race condition fixed in auth service",
  { autoLink: true }
);

console.log(links); 
// [{ memory_id: "mem-abc123", link_type: "related", score: 0.82 }]

// Query linked memories
const related = await memory.getLinkedMemories("mem-abc123", "related");
```

**Entity Extraction (A-MEM Pattern)**

Build knowledge graph from natural language automatically:

```typescript
const { id, entities } = await memory.store(
  "Joel prefers TypeScript for Next.js projects",
  { extractEntities: true }
);

console.log(entities);
// {
//   entities: [
//     { name: "Joel", type: "person" },
//     { name: "TypeScript", type: "technology" },
//     { name: "Next.js", type: "technology" }
//   ],
//   relationships: [
//     { from: "Joel", to: "TypeScript", type: "prefers" }
//   ]
// }

// Query by entity
const joelMemories = await memory.findByEntity("Joel", "person");

// Get knowledge graph for a memory
const graph = await memory.getKnowledgeGraph("mem-abc123");
// { entities: [...], relationships: [...] }
```

**Combine All Smart Features**

```typescript
const result = await memory.store(
  "OAuth tokens need 5min buffer before expiry to avoid race conditions",
  { 
    autoTag: true,        // LLM extracts tags
    autoLink: true,       // Links to related memories
    extractEntities: true // Builds knowledge graph
  }
);

// Returns: { id, autoTags, links, entities }
```

#### Temporal Queries (Wave 2)

Query memories valid at specific timestamps for time-travel debugging:

```typescript
// Find memories valid on January 1, 2024
const pastMemories = await memory.findValidAt(
  "authentication patterns",
  new Date("2024-01-01")
);

// Track supersession chains (version history)
const chain = await memory.getSupersessionChain("mem-v1");
// Returns: [mem-v1, mem-v2, mem-v3] (chronological evolution)

// Mark memory as superseded (when updating)
await memory.supersede("mem-old-auth", "mem-new-auth");
```

#### Schema Extensions (Wave 1-3)

New tables and columns added for smart operations:

**Tables:**
- `memory_links` - Semantic relationships between memories (Zettelkasten)
- `entities` - Extracted entities (people, places, concepts)
- `relationships` - Entity relationships (subject-predicate-object triples)
- `memory_entities` - Join table linking memories to entities

**Columns:**
- `memories.valid_from` - Temporal validity start (UTC timestamp)
- `memories.valid_until` - Temporal validity end (NULL = current)
- `memories.superseded_by` - Points to newer version (version chains)
- `memories.auto_tags` - JSON array of LLM-extracted tags
- `memories.keywords` - Searchable keyword index

#### Graceful Degradation

All smart operations use **fallback heuristics** if LLM/Ollama unavailable:

- **Smart ops**: Falls back to simple ADD operation
- **Auto-tagging**: Returns `undefined` (no auto-tags added)
- **Auto-linking**: Returns `undefined` (no links created)
- **Entity extraction**: Returns empty `entities`/`relationships` arrays
- **Vector search**: Falls back to full-text search (FTS5)

**No crashes, no exceptions** - degraded functionality, not broken functionality.

#### ID Prefix Convention

Memory IDs use `mem-` prefix (not `mem_`):

```typescript
const { id } = await memory.store("Content");
console.log(id); // "mem-abc123def456" (16 hex chars after prefix)
```

#### Wave 1-3 Service Exports

For advanced use cases, you can access the underlying services directly:

```typescript
import {
  // Smart Operations (Mem0 pattern)
  analyzeMemoryOperation,
  
  // Auto-tagging
  generateTags,
  
  // Memory Linking (Zettelkasten)
  autoLinkMemory,
  createLink,
  findRelatedMemories,
  
  // Entity Extraction (A-MEM)
  extractEntitiesAndRelationships,
  storeEntities,
} from "swarm-mail";

// Example: Manual smart operation
const analysis = await analyzeMemoryOperation(
  "OAuth tokens need 5min buffer",
  existingMemories,
  aiGatewayKey
);
console.log(analysis.operation); // "ADD" | "UPDATE" | "DELETE" | "NOOP"

// Example: Manual tag generation
const tags = await generateTags(
  "OAuth tokens need 5min buffer before expiry",
  aiGatewayKey
);
console.log(tags); // { tags: ["auth", "oauth", "tokens"], confidence: 0.85 }

// Example: Manual entity extraction
const extracted = await extractEntitiesAndRelationships(
  "Joel prefers TypeScript for Next.js projects",
  aiGatewayKey
);
console.log(extracted.entities); // [{ name: "Joel", type: "person" }, ...]
console.log(extracted.relationships); // [{ from: "Joel", to: "TypeScript", type: "prefers" }]
```

> **Note:** Requires [Ollama](https://ollama.ai/) for vector embeddings and smart operations. Falls back to full-text search if unavailable.
>
> ```bash
> ollama pull mxbai-embed-large
> ```

### Custom Database Setup

Bring your own libSQL database:

```typescript
import { createLibSQLAdapter } from "swarm-mail";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

// Create libSQL client
const client = createClient({
  url: "file:///my/custom/path/swarm.db"
});

const db = drizzle(client);

// Create adapter
const swarmMail = createLibSQLAdapter(db, "/my/project");

// Use as normal
await swarmMail.appendEvent({
  type: "agent_registered",
  agent_name: "CustomAgent",
  timestamp: Date.now(),
});
```

## Event Schema

All swarm coordination is recorded as immutable events in libSQL. Events are **append-only** - nothing is deleted, everything is auditable.

### Event Store Table

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                    -- Event type discriminator
  project_key TEXT NOT NULL,             -- Project path (for multi-project isolation)
  timestamp INTEGER NOT NULL,            -- Unix ms
  sequence INTEGER GENERATED ALWAYS AS (id) STORED,
  data TEXT NOT NULL,                    -- JSON payload (event-specific fields)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Fast queries via composite indexes
CREATE INDEX idx_events_project_key ON events(project_key);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_project_type ON events(project_key, type);
```

### Event Types

All events extend `BaseEventSchema` with common fields:
```typescript
{
  id?: number;              // Auto-generated
  type: string;             // Event discriminator
  project_key: string;      // Project path
  timestamp: number;        // Unix ms
  sequence?: number;        // Auto-generated ordering
}
```

**Agent Lifecycle (2 types):**
```typescript
{ type: "agent_registered"; agent_name: string; program?: string; model?: string; task_description?: string }
{ type: "agent_active"; agent_name: string }
```

**Messages (5 types):**
```typescript
{ type: "message_sent"; message_id?: number; from_agent: string; to_agents: string[]; subject: string; body: string; thread_id?: string; importance?: "low" | "normal" | "high" | "urgent"; ack_required?: boolean; epic_id?: string; bead_id?: string; message_type?: "progress" | "blocked" | "question" | "status" | "general"; body_length?: number; recipient_count?: number; is_broadcast?: boolean }
{ type: "message_read"; message_id: number; agent_name: string }
{ type: "message_acked"; message_id: number; agent_name: string }
{ type: "thread_created"; thread_id: string; epic_id?: string; initial_subject: string; creator_agent: string }
{ type: "thread_activity"; thread_id: string; message_count: number; participant_count: number; last_message_agent: string; has_unread: boolean }
```

**File Reservations (3 types):**
```typescript
{ type: "file_reserved"; reservation_id?: number; agent_name: string; paths: string[]; reason?: string; exclusive?: boolean; ttl_seconds?: number; expires_at: number; lock_holder_ids?: string[]; epic_id?: string; bead_id?: string; file_count?: number; is_retry?: boolean; conflict_agent?: string }
{ type: "file_released"; agent_name: string; paths?: string[]; reservation_ids?: number[]; lock_holder_ids?: string[]; epic_id?: string; bead_id?: string; file_count?: number; hold_duration_ms?: number; files_modified?: number }
{ type: "file_conflict"; requesting_agent: string; holding_agent: string; paths: string[]; epic_id?: string; bead_id?: string; resolution?: "wait" | "force" | "abort" }
```

**Task Tracking (4 types):**
```typescript
{ type: "task_started"; agent_name: string; bead_id: string; epic_id?: string }
{ type: "task_progress"; agent_name: string; bead_id: string; progress_percent?: number; message?: string; files_touched?: string[] }
{ type: "task_completed"; agent_name: string; bead_id: string; summary: string; files_touched?: string[]; success: boolean }
{ type: "task_blocked"; agent_name: string; bead_id: string; reason: string }
```

**Swarm Coordination (8 types):**
```typescript
{ type: "swarm_started"; epic_id: string; epic_title: string; strategy: "file-based" | "feature-based" | "risk-based"; subtask_count: number; total_files: number; coordinator_agent: string }
{ type: "worker_spawned"; epic_id: string; bead_id: string; worker_agent: string; subtask_title: string; files_assigned: string[]; spawn_order: number; is_parallel: boolean }
{ type: "worker_completed"; epic_id: string; bead_id: string; worker_agent: string; success: boolean; duration_ms: number; files_touched: string[]; error_message?: string }
{ type: "review_started"; epic_id: string; bead_id: string; attempt: number }
{ type: "review_completed"; epic_id: string; bead_id: string; status: "approved" | "needs_changes" | "blocked"; attempt: number; duration_ms?: number }
{ type: "swarm_completed"; epic_id: string; epic_title: string; success: boolean; total_duration_ms: number; subtasks_completed: number; subtasks_failed: number; total_files_touched: string[] }
{ type: "decomposition_generated"; epic_id: string; task: string; context?: string; strategy: "file-based" | "feature-based" | "risk-based"; epic_title: string; subtasks: Array<{ title: string; files: string[]; priority?: number }>; recovery_context?: object }
{ type: "subtask_outcome"; epic_id: string; bead_id: string; planned_files: string[]; actual_files: string[]; duration_ms: number; error_count?: number; retry_count?: number; success: boolean; scope_violation?: boolean; violation_files?: string[] }
```

**Checkpoints & Recovery (4 types):**
```typescript
{ type: "swarm_checkpointed"; epic_id: string; bead_id: string; strategy: "file-based" | "feature-based" | "risk-based"; files: string[]; dependencies: string[]; directives: object; recovery: object; checkpoint_size_bytes?: number; trigger?: "manual" | "auto" | "progress" | "error"; context_tokens_before?: number; context_tokens_after?: number }
{ type: "swarm_recovered"; epic_id: string; bead_id: string; recovered_from_checkpoint: number; recovery_duration_ms?: number; checkpoint_age_ms?: number; files_restored?: string[]; context_restored_tokens?: number }
{ type: "checkpoint_created"; epic_id: string; bead_id: string; agent_name: string; checkpoint_id: string; trigger: "manual" | "auto" | "progress" | "error"; progress_percent: number; files_snapshot: string[] }
{ type: "context_compacted"; epic_id?: string; bead_id?: string; agent_name: string; tokens_before: number; tokens_after: number; compression_ratio: number; summary_length: number }
```

**Validation & Learning (4 types):**
```typescript
{ type: "validation_started"; epic_id: string; swarm_id: string; started_at: number }
{ type: "validation_issue"; epic_id: string; severity: "error" | "warning" | "info"; category: "schema_mismatch" | "missing_event" | "undefined_value" | "dashboard_render" | "websocket_delivery"; message: string; location?: object }
{ type: "validation_completed"; epic_id: string; swarm_id: string; passed: boolean; issue_count: number; duration_ms: number }
{ type: "human_feedback"; epic_id: string; accepted: boolean; modified?: boolean; notes?: string }
```

**Total: 56 event types** - Full Zod schemas in [src/streams/events.ts](src/streams/events.ts)

## libSQL Query Examples

All state is derived from events via **projections** (materialized views). Query the event store directly or use projections for common patterns.

### Agent Queries

```typescript
// Who's registered in this project?
const agents = await swarmMail.getAgents();
// SELECT * FROM agents WHERE project_key = ? ORDER BY registered_at

// Get specific agent details
const agent = await swarmMail.getAgent("WorkerBee");
// SELECT * FROM agents WHERE project_key = ? AND name = ?

// Debug agent activity
const debug = await swarmMail.debugAgent("WorkerBee");
// Returns: { agent, messages_sent, messages_received, reservations, recent_events }
```

**Raw SQL examples:**

```sql
-- All agents in project
SELECT name, program, model, task_description, registered_at
FROM agents
WHERE project_key = '/path/to/project'
ORDER BY last_active_at DESC;

-- Agents active in last hour
SELECT name, last_active_at
FROM agents
WHERE project_key = '/path/to/project'
  AND last_active_at > (strftime('%s', 'now') - 3600) * 1000;
```

### Message Queries

```typescript
// Get inbox (materialized view)
const messages = await swarmMail.getInbox("WorkerBee", { 
  limit: 5, 
  unreadOnly: true 
});
// SELECT * FROM messages WHERE ... ORDER BY sent_at DESC LIMIT 5

// Get thread (all messages with same thread_id)
const thread = await swarmMail.getThread("epic-123");
// SELECT * FROM messages WHERE thread_id = ? ORDER BY sent_at

// Mark as read
await swarmMail.appendEvent({
  type: "message_read",
  message_id: 42,
  agent_name: "WorkerBee",
  timestamp: Date.now(),
});
```

**Raw SQL examples:**

```sql
-- Unread messages for agent
SELECT m.id, m.subject, m.from_agent, m.sent_at, m.importance
FROM messages m
LEFT JOIN message_reads mr 
  ON mr.message_id = m.id AND mr.agent_name = 'WorkerBee'
WHERE m.project_key = '/path/to/project'
  AND EXISTS (
    SELECT 1 FROM message_recipients 
    WHERE message_id = m.id AND recipient_name = 'WorkerBee'
  )
  AND mr.id IS NULL
ORDER BY m.sent_at DESC;

-- Thread view with participants
SELECT m.id, m.subject, m.from_agent, m.body, m.sent_at,
       GROUP_CONCAT(mr.recipient_name) as recipients
FROM messages m
LEFT JOIN message_recipients mr ON mr.message_id = m.id
WHERE m.thread_id = 'epic-123'
GROUP BY m.id
ORDER BY m.sent_at;

-- Message traffic by importance
SELECT importance, COUNT(*) as count
FROM messages
WHERE project_key = '/path/to/project'
  AND sent_at > (strftime('%s', 'now') - 86400) * 1000  -- last 24h
GROUP BY importance;
```

### File Reservation Queries

```typescript
// Check for conflicts before reserving
const conflicts = await swarmMail.checkConflicts(
  ["src/auth.ts", "src/db.ts"], 
  "WorkerBee"
);
// Returns: [{ path, holder, expires_at, exclusive }]

// Get all active reservations
const reservations = await swarmMail.getReservations();
// SELECT * FROM reservations WHERE expires_at > ? ORDER BY created_at

// Get agent's reservations
const myReservations = await swarmMail.getReservationsForAgent("WorkerBee");
// SELECT * FROM reservations WHERE agent_name = ? AND expires_at > ?
```

**Raw SQL examples:**

```sql
-- Active file locks
SELECT agent_name, path_pattern, exclusive, 
       datetime(created_at/1000, 'unixepoch') as locked_at,
       datetime(expires_at/1000, 'unixepoch') as expires
FROM reservations
WHERE project_key = '/path/to/project'
  AND expires_at > (strftime('%s', 'now') * 1000)
ORDER BY created_at;

-- Conflict detection (who holds this path?)
SELECT agent_name, exclusive, expires_at
FROM reservations
WHERE project_key = '/path/to/project'
  AND path_pattern LIKE '%src/auth.ts%'
  AND expires_at > (strftime('%s', 'now') * 1000);

-- Expired reservations (cleanup candidates)
SELECT agent_name, path_pattern, 
       (strftime('%s', 'now') * 1000 - expires_at) / 1000 as expired_seconds_ago
FROM reservations
WHERE project_key = '/path/to/project'
  AND expires_at < (strftime('%s', 'now') * 1000)
ORDER BY expires_at;

-- Reservation timeline (who locked what when?)
SELECT 
  datetime(timestamp/1000, 'unixepoch') as time,
  json_extract(data, '$.agent_name') as agent,
  json_extract(data, '$.paths') as paths,
  json_extract(data, '$.exclusive') as exclusive,
  CASE type
    WHEN 'file_reserved' THEN '🔒 LOCK'
    WHEN 'file_released' THEN '🔓 RELEASE'
  END as action
FROM events
WHERE project_key = '/path/to/project'
  AND type IN ('file_reserved', 'file_released')
ORDER BY timestamp DESC
LIMIT 20;
```

### Task Progress Queries

```typescript
// Get swarm checkpoint for recovery
const context = await swarmMail.getSwarmContext("epic-123");
// SELECT * FROM swarm_contexts WHERE epic_id = ? ORDER BY version DESC LIMIT 1

// Query events for timeline
const events = await swarmMail.getEvents({ 
  limit: 100, 
  after: lastSequence 
});
// SELECT * FROM events WHERE sequence > ? ORDER BY sequence LIMIT 100
```

**Raw SQL examples:**

```sql
-- Task timeline (start → progress → complete)
SELECT 
  datetime(timestamp/1000, 'unixepoch') as time,
  type,
  json_extract(data, '$.agent_name') as agent,
  json_extract(data, '$.bead_id') as task,
  json_extract(data, '$.progress_percent') as progress,
  json_extract(data, '$.message') as status
FROM events
WHERE project_key = '/path/to/project'
  AND type IN ('task_started', 'task_progress', 'task_completed', 'task_blocked')
  AND json_extract(data, '$.epic_id') = 'epic-123'
ORDER BY timestamp;

-- Task outcomes (success vs failure)
SELECT 
  json_extract(data, '$.bead_id') as task,
  json_extract(data, '$.success') as success,
  json_extract(data, '$.duration_ms') as duration,
  json_extract(data, '$.error_count') as errors,
  datetime(timestamp/1000, 'unixepoch') as completed_at
FROM events
WHERE type = 'task_completed'
  AND json_extract(data, '$.epic_id') = 'epic-123'
ORDER BY timestamp;

-- Checkpoint history (resume points)
SELECT version, progress, 
       datetime(created_at/1000, 'unixepoch') as checkpoint_time,
       json_extract(state, '$.files_touched') as files
FROM swarm_contexts
WHERE epic_id = 'epic-123'
ORDER BY version DESC;
```

### Analytics Queries

**Four Golden Signals** for observability:

```sql
-- 1. LATENCY - Task duration distribution
SELECT 
  CAST(json_extract(data, '$.duration_ms') / 1000.0 AS INT) as seconds,
  COUNT(*) as tasks,
  ROUND(AVG(json_extract(data, '$.duration_ms')), 0) as avg_ms
FROM events
WHERE type = 'task_completed'
  AND json_extract(data, '$.success') = 1
GROUP BY seconds
ORDER BY seconds;

-- 2. TRAFFIC - Events per hour
SELECT 
  strftime('%Y-%m-%d %H:00', datetime(timestamp/1000, 'unixepoch')) as hour,
  type,
  COUNT(*) as count
FROM events
WHERE timestamp > (strftime('%s', 'now') - 86400) * 1000  -- last 24h
GROUP BY hour, type
ORDER BY hour DESC, count DESC;

-- 3. ERRORS - Failure analysis
SELECT 
  json_extract(data, '$.bead_id') as task,
  json_extract(data, '$.error_count') as errors,
  json_extract(data, '$.retry_count') as retries,
  json_extract(data, '$.files_touched') as files,
  datetime(timestamp/1000, 'unixepoch') as failed_at
FROM events
WHERE type = 'task_completed'
  AND json_extract(data, '$.success') = 0
ORDER BY timestamp DESC
LIMIT 10;

-- 4. SATURATION - File contention
SELECT 
  json_extract(data, '$.paths') as file_path,
  COUNT(DISTINCT json_extract(data, '$.agent_name')) as agent_count,
  COUNT(*) as reservation_attempts,
  GROUP_CONCAT(json_extract(data, '$.agent_name')) as competing_agents
FROM events
WHERE type = 'file_reserved'
  AND timestamp > (strftime('%s', 'now') - 3600) * 1000  -- last hour
GROUP BY file_path
HAVING agent_count > 1
ORDER BY reservation_attempts DESC;
```

### Debugging Queries

```sql
-- Agent activity timeline (comprehensive view)
SELECT 
  datetime(timestamp/1000, 'unixepoch') as time,
  type,
  CASE 
    WHEN type = 'agent_registered' THEN 'Registered: ' || json_extract(data, '$.task_description')
    WHEN type = 'message_sent' THEN 'Sent: ' || json_extract(data, '$.subject')
    WHEN type = 'file_reserved' THEN 'Locked: ' || json_extract(data, '$.paths')
    WHEN type = 'file_released' THEN 'Released: ' || json_extract(data, '$.file_count') || ' files'
    WHEN type = 'task_started' THEN 'Started: ' || json_extract(data, '$.bead_id')
    WHEN type = 'task_progress' THEN 'Progress: ' || json_extract(data, '$.progress_percent') || '%'
    WHEN type = 'task_completed' THEN 'Completed: ' || json_extract(data, '$.bead_id') || ' (' || CASE WHEN json_extract(data, '$.success') = 1 THEN 'success' ELSE 'failed' END || ')'
    WHEN type = 'task_blocked' THEN 'Blocked: ' || json_extract(data, '$.reason')
    ELSE type
  END as activity
FROM events
WHERE json_extract(data, '$.agent_name') = 'WorkerBee'
ORDER BY timestamp DESC
LIMIT 50;

-- Find stuck tasks (started but not completed)
WITH task_events AS (
  SELECT 
    json_extract(data, '$.bead_id') as task_id,
    json_extract(data, '$.agent_name') as agent,
    MIN(CASE WHEN type = 'task_started' THEN timestamp END) as started_at,
    MAX(CASE WHEN type IN ('task_completed', 'task_blocked') THEN timestamp END) as ended_at
  FROM events
  WHERE type IN ('task_started', 'task_completed', 'task_blocked')
  GROUP BY task_id, agent
)
SELECT 
  task_id,
  agent,
  datetime(started_at/1000, 'unixepoch') as started,
  ROUND((strftime('%s', 'now') * 1000 - started_at) / 60000.0, 1) as minutes_stuck
FROM task_events
WHERE ended_at IS NULL
ORDER BY started_at DESC;

-- Message response times (high/urgent only)
WITH message_timings AS (
  SELECT 
    json_extract(sent.data, '$.message_id') as msg_id,
    json_extract(sent.data, '$.subject') as subject,
    json_extract(sent.data, '$.from_agent') as sender,
    json_extract(sent.data, '$.importance') as importance,
    sent.timestamp as sent_at,
    read.timestamp as read_at
  FROM events sent
  LEFT JOIN events read 
    ON read.type = 'message_read' 
    AND json_extract(read.data, '$.message_id') = json_extract(sent.data, '$.message_id')
  WHERE sent.type = 'message_sent'
    AND json_extract(sent.data, '$.importance') IN ('high', 'urgent')
)
SELECT 
  msg_id,
  subject,
  sender,
  importance,
  datetime(sent_at/1000, 'unixepoch') as sent,
  CASE 
    WHEN read_at IS NULL THEN 'UNREAD'
    ELSE ROUND((read_at - sent_at) / 1000.0, 1) || 's'
  END as response_time
FROM message_timings
ORDER BY sent_at DESC
LIMIT 20;

-- Swarm execution summary (epic overview)
WITH epic_events AS (
  SELECT 
    json_extract(data, '$.epic_id') as epic_id,
    type,
    timestamp,
    data
  FROM events
  WHERE json_extract(data, '$.epic_id') = 'mjmas3zxlmg'
)
SELECT 
  'Epic' as metric,
  json_extract((SELECT data FROM epic_events WHERE type = 'swarm_started' LIMIT 1), '$.epic_title') as value
UNION ALL
SELECT 
  'Strategy',
  json_extract((SELECT data FROM epic_events WHERE type = 'swarm_started' LIMIT 1), '$.strategy')
UNION ALL
SELECT 
  'Workers Spawned',
  CAST(COUNT(*) AS TEXT)
FROM epic_events WHERE type = 'worker_spawned'
UNION ALL
SELECT 
  'Tasks Completed',
  CAST(COUNT(*) AS TEXT)
FROM epic_events WHERE type = 'worker_completed' AND json_extract(data, '$.success') = 1
UNION ALL
SELECT 
  'Tasks Failed',
  CAST(COUNT(*) AS TEXT)
FROM epic_events WHERE type = 'worker_completed' AND json_extract(data, '$.success') = 0
UNION ALL
SELECT 
  'File Conflicts',
  CAST(COUNT(*) AS TEXT)
FROM epic_events WHERE type = 'file_conflict'
UNION ALL
SELECT 
  'Checkpoints',
  CAST(COUNT(*) AS TEXT)
FROM epic_events WHERE type = 'checkpoint_created';

-- Worker performance comparison
SELECT 
  json_extract(data, '$.worker_agent') as worker,
  COUNT(*) as tasks_completed,
  SUM(CASE WHEN json_extract(data, '$.success') = 1 THEN 1 ELSE 0 END) as successful,
  ROUND(AVG(json_extract(data, '$.duration_ms')) / 1000.0, 1) as avg_duration_sec,
  ROUND(AVG(CAST(json_length(json_extract(data, '$.files_touched')) AS REAL)), 1) as avg_files_touched
FROM events
WHERE type = 'worker_completed'
  AND json_extract(data, '$.epic_id') = 'mjmas3zxlmg'
GROUP BY worker
ORDER BY successful DESC, avg_duration_sec ASC;

## Dashboard Data Layer (Programmatic Access)

For building custom dashboards or monitoring tools, use the dashboard data layer from `opencode-swarm-plugin`:

```typescript
import { 
  getWorkerStatus, 
  getSubtaskProgress, 
  getFileLocks, 
  getRecentMessages,
  getEpicList 
} from "opencode-swarm-plugin";
import { getSwarmMailLibSQL } from "swarm-mail";

const db = await getSwarmMailLibSQL("/my/project");

// Get worker statuses (idle/working/blocked)
const workers = await getWorkerStatus(db, { project_key: "/my/project" });
// Returns: [{ agent_name: "Worker1", status: "working", current_task: "bd-123", last_activity: "2025-12-26T..." }]

// Get subtask progress for an epic
const progress = await getSubtaskProgress(db, "mjmas3zxlmg");
// Returns: [{ bead_id: "bd-123", title: "Add auth", status: "in_progress", progress_percent: 50 }]

// Get active file locks
const locks = await getFileLocks(db);
// Returns: [{ path: "src/auth.ts", agent_name: "Worker1", reason: "bd-123: Auth", acquired_at: "...", ttl_seconds: 3600 }]

// Get recent messages
const messages = await getRecentMessages(db, { limit: 10, importance: "high" });
// Returns: [{ id: 1, from: "Worker1", to: ["Coordinator"], subject: "BLOCKED", timestamp: "...", importance: "high" }]

// List all epics
const epics = await getEpicList(db);
// Returns: [{ epic_id: "mjmas3zxlmg", title: "Feature X", subtask_count: 5, completed_count: 3 }]
```

**Use cases:**
- Build custom TUI dashboards (see `swarm dashboard` implementation)
- Export to monitoring systems (Prometheus, Datadog)
- Real-time web dashboards (WebSocket + React)
- Alerting (detect stuck tasks, file conflicts)

## Projections

Materialized views automatically updated from events via triggers:

| Projection          | Description                        | Updated By |
| ------------------- | ---------------------------------- | ---------- |
| `agents`            | Active agents per project          | `agent_registered`, `agent_active` |
| `messages`          | Agent inbox/outbox with recipients | `message_sent` |
| `message_recipients`| Many-to-many message targets       | `message_sent` |
| `message_reads`     | Read receipts                      | `message_read` |
| `reservations`      | Current file locks with TTL        | `file_reserved`, `file_released` |
| `swarm_contexts`    | Checkpoint state for recovery      | `swarm_checkpointed` |
| `eval_records`      | Outcome data for learning          | `eval_captured`, `eval_scored`, `eval_finalized` |

## Testing

For tests, use in-memory instances:

```typescript
import { createInMemorySwarmMail } from "swarm-mail";

describe("my feature", () => {
  let swarmMail: SwarmMailAdapter;

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMail("test");
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("appends events", async () => {
    const result = await swarmMail.appendEvent({
      type: "agent_registered",
      agent_name: "TestAgent",
      timestamp: Date.now(),
    });
    
    expect(result.id).toBeGreaterThan(0);
  });
});
```

## Architecture

- **Event Sourcing** - Append-only log, projections are derived
- **Local-first** - libSQL embedded SQLite, no external servers
- **Type-safe** - TypeScript with Zod validation and Drizzle ORM
- **Effect-TS** - Composable, testable actor primitives
- **Git-synced** - Hive cells stored as JSON + git for team coordination

## Migration from v0.31

If you're migrating from PGLite-based swarm-mail:

```typescript
// OLD (v0.31)
import { getSwarmMail } from "swarm-mail";
const swarmMail = await getSwarmMail("/my/project");

// NEW (v0.32+)
import { getSwarmMailLibSQL } from "swarm-mail";
const swarmMail = await getSwarmMailLibSQL("/my/project");
```

**Key changes:**
- Storage backend: PGLite → libSQL (SQLite-compatible)
- ORM: Raw SQL → Drizzle ORM
- Main export: `getSwarmMailLibSQL` (was `getSwarmMail`)
- Semantic memory: Embedded (was standalone MCP server)

See [CHANGELOG.md](./CHANGELOG.md) for full migration guide.

## API Reference

For complete API documentation, see [swarmtools.ai/docs](https://swarmtools.ai/docs).

### SwarmMailAdapter

```typescript
interface SwarmMailAdapter {
  // Events
  appendEvent(event: AgentEvent, projectPath?: string): Promise<AgentEvent & { id: number; sequence: number }>;
  appendEvents(events: AgentEvent[], projectPath?: string): Promise<Array<AgentEvent & { id: number; sequence: number }>>;
  readEvents(options?: ReadEventsOptions, projectPath?: string): Promise<Array<AgentEvent & { id: number; sequence: number }>>;
  getLatestSequence(projectKey?: string, projectPath?: string): Promise<number>;
  replayEvents(options?: { projectKey?: string; fromSequence?: number; clearViews?: boolean }, projectPath?: string): Promise<{ eventsReplayed: number; duration: number }>;

  // Agents
  registerAgent(projectKey: string, agentName: string, options?: RegisterOptions, projectPath?: string): Promise<AgentRegisteredEvent & { id: number; sequence: number }>;
  getAgents(projectKey: string, projectPath?: string): Promise<Agent[]>;
  getAgent(projectKey: string, agentName: string, projectPath?: string): Promise<Agent | null>;

  // Messages
  sendMessage(projectKey: string, fromAgent: string, toAgents: string[], subject: string, body: string, options?: SendOptions, projectPath?: string): Promise<MessageSentEvent & { id: number; sequence: number }>;
  getInbox(projectKey: string, agentName: string, options?: InboxOptions, projectPath?: string): Promise<Message[]>;
  getMessage(projectKey: string, messageId: number, projectPath?: string): Promise<Message | null>;
  getThreadMessages(projectKey: string, threadId: string, projectPath?: string): Promise<Message[]>;
  markMessageAsRead(projectKey: string, messageId: number, agentName: string, projectPath?: string): Promise<void>;
  acknowledgeMessage(projectKey: string, messageId: number, agentName: string, projectPath?: string): Promise<void>;

  // Reservations
  reserveFiles(projectKey: string, agentName: string, paths: string[], options?: ReserveOptions, projectPath?: string): Promise<FileReservedEvent & { id: number; sequence: number }>;
  releaseFiles(projectKey: string, agentName: string, options?: ReleaseOptions, projectPath?: string): Promise<void>;
  getActiveReservations(projectKey: string, projectPath?: string, agentName?: string): Promise<Reservation[]>;
  checkConflicts(projectKey: string, agentName: string, paths: string[], projectPath?: string): Promise<Conflict[]>;

  // Schema & Health
  runMigrations(projectPath?: string): Promise<void>;
  healthCheck(options?: { walThresholdMb?: number }, projectPath?: string): Promise<{ connected: boolean; walHealth?: { healthy: boolean; message: string } }>;
  getDatabaseStats(projectPath?: string): Promise<{ events: number; agents: number; messages: number; reservations: number; wal?: { size: number; fileCount: number } }>;
  resetDatabase(projectPath?: string): Promise<void>;

  // Database
  getDatabase(projectPath?: string): Promise<DatabaseAdapter>;
  close(projectPath?: string): Promise<void>;
  closeAll(): Promise<void>;
}
```

## Session Indexing

Cross-agent session search and indexing layer for multi-agent conversation history.

**Inspired by [CASS (coding_agent_session_search)](https://github.com/Dicklesworthstone/coding_agent_session_search) by Dicklesworthstone** - we've adapted the session indexing concepts for TypeScript + libSQL.

```
┌─────────────────────────────────────────────────────────────┐
│              SESSION INDEXING ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐                                           │
│  │ Agent Logs   │  (OpenCode, Cursor, Claude, etc.)        │
│  │  ~/.config/  │                                           │
│  │  *.jsonl     │                                           │
│  └──────┬───────┘                                           │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────────────────────────────────┐               │
│  │ SessionParser (JSONL → Normalized)       │               │
│  │  ├─ Line-by-line parsing                │               │
│  │  └─ Multi-agent format detection        │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│                 ▼                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ ChunkProcessor (Message-level chunks)    │               │
│  │  ├─ Sliding window (512 token chunks)    │               │
│  │  ├─ Ollama embeddings (mxbai-embed-large)│               │
│  │  └─ Store in semantic-memory             │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│                 ▼                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ libSQL Storage (via semantic-memory)     │               │
│  │  ├─ memories table (vector search)       │               │
│  │  ├─ metadata (agent, session, timestamp) │               │
│  │  └─ libSQL vec extension similarity      │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│                 ▼                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ StalenessDetector (index freshness)      │               │
│  │  ├─ Track indexed sessions + mtimes      │               │
│  │  ├─ Detect new/modified files            │               │
│  │  └─ Trigger re-indexing when needed      │               │
│  └──────────────┬───────────────────────────┘               │
│                 │                                           │
│                 ▼                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ Search API (cass_* plugin tools)         │               │
│  │  ├─ Semantic search (vector similarity)  │               │
│  │  ├─ Full-text search (FTS5)              │               │
│  │  ├─ Pagination + field projection        │               │
│  │  └─ Session viewer (expand context)      │               │
│  └──────────────────────────────────────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | Purpose | Key Methods |
|-----------|---------|-------------|
| **ChunkProcessor** | Message-level chunking + embedding | `processMessage()`, `generateEmbedding()` |
| **SessionParser** | JSONL → NormalizedMessage | `parseLine()`, `detectAgent()` |
| **SessionViewer** | Line-by-line JSONL reader | `readLines()`, `expandContext()` |
| **StalenessDetector** | Index freshness tracking | `recordIndexed()`, `checkStaleness()` |
| **Pagination** | Field projection for compact output | `projectSearchResult()`, `FIELD_SETS` |

### Usage

```typescript
import { ChunkProcessor, StalenessDetector } from "swarm-mail";
import { createSemanticMemory } from "swarm-mail";

// 1. Initialize semantic memory (vector store)
const memory = await createSemanticMemory("/my/project");

// 2. Create chunk processor
const processor = new ChunkProcessor(memory);

// 3. Process a session message
const chunks = await processor.processMessage({
  session_id: "abc123",
  agent: "opencode",
  timestamp: Date.now(),
  role: "assistant",
  content: "Message text...",
});

// 4. Search across indexed sessions
const results = await memory.find("authentication error", { limit: 5 });

// 5. Check if re-indexing needed
const detector = new StalenessDetector(memory);
await detector.recordIndexed("/path/to/session.jsonl", Date.now());
const isStale = await detector.checkStaleness("/path/to/session.jsonl");
```

### Plugin Integration

The session indexing layer powers the `cass_*` plugin tools (see AGENTS.md):

- `cass_search` - Search across all agent histories
- `cass_view` - View specific session
- `cass_expand` - Expand context around line
- `cass_index` - Build/rebuild index
- `cass_health` - Check index readiness
- `cass_stats` - Show index statistics

**Before solving problems from scratch, query the index** - another agent may have already solved it.

## Resources

- **Documentation:** [swarmtools.ai/docs](https://swarmtools.ai/docs)
- **Architecture:** [SWARM-CONTEXT.md](../../SWARM-CONTEXT.md)
- **Examples:** [examples/](../../examples/)
- **Changelog:** [CHANGELOG.md](./CHANGELOG.md)

## License

MIT
