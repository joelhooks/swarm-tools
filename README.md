# opencode-swarm-plugin

[![npm version](https://img.shields.io/npm/v/opencode-swarm-plugin.svg)](https://www.npmjs.com/package/opencode-swarm-plugin)
[![Documentation](https://img.shields.io/badge/docs-swarmtools.ai-blue)](https://swarmtools.ai/docs)
[![Website](https://img.shields.io/badge/website-swarmtools.ai-orange)](https://swarmtools.ai)

```
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝

    \ ` - ' /
   - .(o o). -
    (  >.<  )        Break big tasks into small ones.
     /|   |\         Spawn agents to work in parallel.
    (_|   |_)        Learn from what works.
      bzzzz...
```

**AI agents that coordinate, learn, and survive context death.**

> **[🐝 swarmtools.ai](https://swarmtools.ai)** | **[📚 Documentation](https://swarmtools.ai/docs)**

---

_Note: You will need Bun installed to run this plugin. You can follow the instructions [here](https://bun.com/docs/installation)._

## 30-Second Start

```bash
# Install
npm install -g opencode-swarm-plugin@latest

# Set up (one-time)
swarm setup

# Use it
/swarm "Add OAuth authentication"
```

That's it. The coordinator breaks the task into pieces, spawns parallel workers, tracks progress, and learns what works.

---

## Your First Swarm

In any OpenCode session:

```
/swarm "Add user authentication with OAuth"
```

**What happens:**

1. **Coordinator analyzes** - queries CASS (past agent sessions) for similar work
2. **Picks a strategy** - file-based, feature-based, or risk-based decomposition
3. **Creates cells** - git-backed work items in the hive:
   ```
   Epic: Add OAuth
   ├─ Cell 1: OAuth provider integration (src/auth/oauth.ts)
   ├─ Cell 2: Session management (src/auth/session.ts)
   └─ Cell 3: Integration tests (tests/auth/)
   ```
4. **Spawns workers** - parallel agents with file reservations (no conflicts)
5. **Coordinates via Swarm Mail** - agents message each other through actor-model primitives
6. **Checkpoints progress** - survives context compaction at 25%, 50%, 75%
7. **Reviews work** - coordinator validates each subtask before approval
8. **Records outcome** - fast+success = good signal, slow+errors = bad signal

**Next time you ask for something similar, it remembers what worked.**

---

## What You Get

### 🔄 Parallel Execution
Workers don't wait for each other. File reservations prevent conflicts. Swarm Mail coordinates dependencies.

### 🧠 Learning System
Every outcome feeds back into strategy selection. Patterns that fail >60% get auto-inverted to anti-patterns. Confidence decays over 90 days unless revalidated.

### 💾 Survives Context Death
Checkpoints capture state in libSQL (embedded SQLite). When OpenCode compacts context, swarms resume from last checkpoint. No external servers.

### 📬 Actor-Model Messaging
Swarm Mail: DurableMailbox, DurableLock, DurableDeferred built on event sourcing. Full audit trail, exactly-once processing, type-safe with Effect-TS.

### 📋 Git-Backed Work Items
The "hive" is a `.hive/` directory in your repo. Work items (cells) sync via git. Distributed coordination without a server.

### 🧩 Knowledge Injection
Skills are packages of domain knowledge. Load `testing-patterns` for Feathers seams, `swarm-coordination` for multi-agent workflows, or create your own.

### 🔍 Cross-Agent Search
CASS indexes all your AI coding sessions (Claude, Cursor, Aider, etc). Query before solving - someone might've solved it already.

### 🛡️ Verification Gates
Coordinator reviews worker output before approval. 3-strike rule: after 3 rejections, task is blocked (signals architectural problem).

---

## How It Works

```
                            "Add OAuth"
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │      COORDINATOR       │
                    │                        │
                    │  1. Query CASS:        │
                    │     "How did we solve  │
                    │      this before?"     │
                    │                        │
                    │  2. Pick strategy:     │
                    │     file-based?        │
                    │     feature-based?     │
                    │     risk-based?        │
                    │                        │
                    │  3. Break into pieces  │
                    └────────────────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
    ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
    │  Worker A   │       │  Worker B   │       │  Worker C   │
    │             │       │             │       │             │
    │ auth/oauth  │       │ auth/session│       │ auth/tests  │
    │   🔒 files  │       │   🔒 files  │       │   🔒 files  │
    │             │       │             │       │             │
    │ "I need     │──────►│ "Got it,    │       │ "Running    │
    │  session    │       │  here's the │       │  tests..."  │
    │  types"     │       │  interface" │       │             │
    └─────────────┘       └─────────────┘       └─────────────┘
           │                     │                     │
           │                     │                     │
           └─────────────────────┼─────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │    LEARNING SYSTEM     │
                    │                        │
                    │  "File-based split     │
                    │   worked well for      │
                    │   auth - 3 workers,    │
                    │   15 min, 0 conflicts" │
                    │                        │
                    │  Next time: use this   │
                    │  pattern again         │
                    └────────────────────────┘
```

---

## CLI Commands

```bash
swarm setup     # Install and configure (one-time)
swarm doctor    # Check dependencies (CASS, UBS, Ollama)
swarm init      # Initialize hive in current project
swarm config    # Show config file paths
```

---

## Docs & Architecture

Want to understand the internals? Here's the deep dive:

- **[📚 Full Documentation](https://swarmtools.ai/docs)** - complete guides
- **[🏗️ Architecture](#architecture-deep-dive)** - event sourcing, durable primitives
- **[🐝 Swarm Mail](#swarm-mail-actor-model-coordination)** - actor-model coordination
- **[🧠 Learning System](#learning-from-outcomes)** - confidence decay, pattern maturity
- **[🧪 Eval System](#eval-driven-development)** - progressive gates, automatic learning
- **[🔧 Monorepo Guide](./AGENTS.md)** - for contributors

---

## Architecture Deep Dive

Everything runs in-process. No external servers.

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOUR TASK                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  DECOMPOSITION         strategy selection, subtask creation     │
│                        (queries CASS, semantic memory)          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  HIVE                  git-backed work items for each subtask   │
│                        (atomic epic + cell creation)            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  SWARM MAIL            actor-model coordination (local-first)   │
│                        (DurableMailbox, DurableLock, libSQL)    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  LIBSQL                embedded SQLite, event-sourced state     │
│                        (append-only log, materialized views)    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  LEARNING              outcomes feed back into decomposition    │
│                        (confidence decay, pattern maturity)     │
└─────────────────────────────────────────────────────────────────┘
```

### Event Sourcing

All state is stored as an append-only event log:

```
Event Log (libSQL)
├─ agent_registered      → Agent joins swarm
├─ message_sent          → Agent-to-agent communication
├─ file_reserved         → Exclusive file lock acquired
├─ file_released         → Lock released
├─ swarm_checkpointed    → Progress snapshot saved
├─ decomposition_generated → Task broken into subtasks
└─ subtask_outcome       → Worker completion result

Materialized Views (derived from events)
├─ agents                → Active agents per project
├─ messages              → Agent inbox/outbox
├─ file_reservations     → Current file locks
└─ eval_records          → Outcome data for learning
```

**Why event sourcing?**

- **Audit trail** - full history of what happened
- **Replay** - reconstruct state from events
- **Debugging** - see exactly what went wrong
- **Learning** - analyze outcomes over time

---

## Swarm Mail: Actor-Model Coordination

Workers coordinate via **Swarm Mail**, an event-sourced actor model built on local-first primitives.

**What makes it different:**

- **Actor model over durable streams** - DurableMailbox, DurableLock, DurableDeferred
- **Local-first with libSQL** - embedded SQLite, no external servers, survives across sessions
- **Event-sourced coordination** - append-only log, materialized views, full audit trail
- **Context-safe by design** - hard caps on inbox (max 5 messages), thread summarization, body-on-demand

```
┌──────────────────────────────────────────────────────────────┐
│                      SWARM MAIL                              │
│                                                              │
│  Worker A: "I need the SessionUser type"                    │
│            ↓                                                 │
│  Worker B: "Here's the interface:"                          │
│            interface SessionUser {                           │
│              id: string                                      │
│              email: string                                   │
│              roles: string[]                                 │
│            }                                                 │
│            ↓                                                 │
│  Worker A: "Got it, implementing OAuth flow now"            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**File reservations** prevent conflicts:

- Worker A reserves `src/auth/oauth.ts` (exclusive via DurableLock)
- Worker B tries to reserve it → blocked
- Worker B waits or works on something else

**Inbox limits** prevent context bloat:

- Max 5 messages per fetch (headers only)
- Read individual message bodies on demand
- Thread summarization for long conversations

All coordination state survives context compaction and session restarts.

### 3-Tier Stack

Swarm Mail is built on **Durable Streams primitives** (inspired by Kyle Matthews' [Electric SQL patterns](https://x.com/kylemathews/status/1999896667030700098)):

```
┌─────────────────────────────────────────────────────────────┐
│                     SWARM MAIL STACK                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TIER 3: COORDINATION                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ask<Req, Res>() - Request/Response (RPC-style)       │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│  TIER 2: PATTERNS        ▼                                  │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ DurableMailbox  │  │  DurableLock    │                  │
│  │ Actor Inbox     │  │  File Mutex     │                  │
│  └─────────────────┘  └─────────────────┘                  │
│          │                    │                             │
│  TIER 1: PRIMITIVES           ▼                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ DurableCursor   │  │ DurableDeferred │                  │
│  │ Checkpointed    │  │ Distributed     │                  │
│  │ Reader          │  │ Promise         │                  │
│  └─────────────────┘  └─────────────────┘                  │
│                          │                                  │
│  STORAGE                 ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │      libSQL (Embedded SQLite) + Migrations            │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Tier 1 - Primitives:**

- **DurableCursor** - Positioned event stream consumption with checkpointing (exactly-once)
- **DurableDeferred** - URL-addressable distributed promises for async coordination
- **DurableLock** - CAS-based mutual exclusion for file reservations (TTL + retry/backoff)

**Tier 2 - Patterns:**

- **DurableMailbox** - Actor inbox with typed envelopes (sender, replyTo, payload)
- File reservation protocol built on DurableLock

**Tier 3 - Coordination:**

- **ask()** pattern - Synchronous-style RPC over async streams (creates DurableDeferred, appends to mailbox, returns promise)

### Message Flow Example

```
Agent A                    Event Stream                Agent B
   │                            │                         │
   │  ask("get SessionUser")    │                         │
   ├───────────────────────────>│                         │
   │  (creates deferred)        │                         │
   │                            │   consume event         │
   │                            ├────────────────────────>│
   │                            │                         │
   │                            │   reply to deferred     │
   │                            │<────────────────────────┤
   │  await deferred.value      │                         │
   │<───────────────────────────┤                         │
   │                            │                         │
   │  SessionUser interface     │                         │
   │                            │                         │
```

**Why this matters:**

- No external servers (Redis, Kafka, NATS) - just libSQL
- Full audit trail - every message is an event
- Resumable - cursors checkpoint position, survive crashes
- Type-safe - Effect-TS with full inference

> **Architecture deep-dive:** See [Swarm Mail Architecture](packages/opencode-swarm-plugin/docs/swarm-mail-architecture.md) for complete implementation details, database schemas, and Effect-TS patterns.

---

## Surviving Context Death

OpenCode compacts context when it gets too long. Swarms survive this.

```
     Session 1                    Context                   Session 2
         │                       Compacts                       │
         ▼                          💥                          ▼
┌─────────────────┐                                   ┌─────────────────┐
│ swarm running   │                                   │ swarm_recover() │
│ ├─ 25% ✓ saved  │                                   │       │         │
│ ├─ 50% ✓ saved  │ ─────────────────────────────────►│       ▼         │
│ └─ 75% ✓ saved  │      checkpoints survive          │ resume at 75%   │
└─────────────────┘                                   └─────────────────┘
```

**Checkpoints capture:**

- Which subtasks are done/in-progress/pending
- File reservations (who owns what)
- Shared context for workers
- Progress percentage

**Recovery restores:**

- Swarm state from last checkpoint
- File locks (prevents conflicts)
- Worker context (what they were doing)

All stored in libSQL (embedded SQLite) - no external servers, survives across sessions.

---

## Learning From Outcomes

Every swarm completion records:

- Duration (how long did it take?)
- Errors (how many retries?)
- Files touched (did scope match prediction?)
- Success (did tests pass? were changes accepted?)

This feeds back into the decomposition strategy:

```
                    ┌─────────────────────────────────┐
                    │         LEARNING LOOP           │
                    └─────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│   OUTCOMES    │           │   PATTERNS    │           │ ANTI-PATTERNS │
│               │           │               │           │               │
│ fast+success  │           │  candidate    │           │ >60% failure  │
│ = good signal │──────────►│      ↓        │──────────►│ = auto-invert │
│               │           │  established  │           │               │
│ slow+errors   │           │      ↓        │           │ "split by X"  │
│ = bad signal  │           │    proven     │           │ becomes       │
│               │           │               │           │ "DON'T split  │
└───────────────┘           └───────────────┘           │  by X"        │
                                                        └───────────────┘

                    Confidence decays over 90 days
                    unless patterns are revalidated
```

**Pattern maturity lifecycle:**

- `candidate` → new pattern, low confidence
- `established` → validated 3+ times
- `proven` → 10+ successes (gets 1.5x weight in future decompositions)
- `deprecated` → >60% failure rate (auto-inverted to anti-pattern)

**Confidence decay:** Patterns fade over 90 days unless revalidated. Prevents stale knowledge from dominating.

---

## Eval-Driven Development

Every swarm run generates eval data. Quality gates prevent regressions.

```
CAPTURE → SCORE → STORE → GATE → LEARN → IMPROVE
```

### Progressive Gates

```
Phase             Runs    Gate Behavior
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bootstrap         <10     ✅ Always pass (collect data)
Stabilization     10-50   ⚠️  Warn on >10% regression
Production        >50     ❌ Fail on >5% regression
```

**What gets evaluated:**

- **Decomposition quality** - file conflicts, complexity balance, coverage
- **Coordinator discipline** - violation count, spawn efficiency, review thoroughness
- **Compaction prompts** - ID specificity, actionability, identity reinforcement

**CLI:**

```bash
swarm eval status              # Check current phase and gates
swarm eval history             # View score trends with sparklines
bun run eval:run               # Run all evals (in package)
```

**Learning loop:**

When eval scores drop >15% from baseline, context is automatically stored to semantic memory with tags. Future prompts query these failures for context.

**Full docs:** [packages/opencode-swarm-plugin/evals/README.md](packages/opencode-swarm-plugin/evals/README.md)

---

## Skills: Knowledge Injection

Skills are reusable knowledge packages. Load them on-demand for specialized tasks.

```typescript
skills_use(name="testing-patterns")     // Feathers seams + Beck's 4 rules
skills_use(name="swarm-coordination")   // Multi-agent decomposition
```

**Bundled skills:**

- `testing-patterns` - 25 dependency-breaking techniques, characterization tests
- `swarm-coordination` - Multi-agent decomposition, file reservations
- `cli-builder` - Argument parsing, help text, subcommands
- `system-design` - Architecture decisions, module boundaries
- `learning-systems` - Confidence decay, pattern maturity

**Create your own:**

```bash
swarm init  # Creates .opencode/skills/ in project
```

Skills can include:

- Step-by-step workflows
- Code examples
- Reference documentation
- Executable scripts

---

## Monorepo Structure

This is a Bun + Turborepo monorepo with two packages:

```
opencode-swarm-plugin/
├── packages/
│   ├── swarm-mail/              # Event sourcing primitives
│   │   └── src/streams/         # DurableMailbox, DurableLock, etc.
│   └── opencode-swarm-plugin/   # Main plugin
│       ├── src/                 # Plugin tools
│       ├── global-skills/       # Bundled skills
│       └── docs/                # Architecture docs
├── package.json                 # Workspace root
└── turbo.json                   # Pipeline config
```

### swarm-mail

Standalone event sourcing package for multi-agent coordination:

- `EventStore` - append-only event log with libSQL
- `Projections` - materialized views (agents, messages, reservations)
- Effect-TS durable primitives (DurableMailbox, DurableCursor, DurableLock, DurableDeferred)
- `DatabaseAdapter` interface for dependency injection

### opencode-swarm-plugin

OpenCode plugin providing:

- Hive integration (git-backed work item tracking)
- Swarm coordination (task decomposition, parallel agents)
- Agent Mail (inter-agent messaging)
- Learning system (pattern maturity, anti-pattern detection)
- Skills system (knowledge injection)

---

## Development

```bash
# Install all workspace dependencies
bun install

# Build all packages (respects dependency order)
bun turbo build

# Test all packages
bun turbo test

# Typecheck all packages
bun turbo typecheck

# Build/test specific package
bun turbo build --filter=swarm-mail
bun turbo test --filter=opencode-swarm-plugin

# Add dependency to specific package
cd packages/swarm-mail && bun add zod
```

See [AGENTS.md](./AGENTS.md) for detailed monorepo guidance.

---

## Dependencies

| Required                            | Optional                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| [OpenCode](https://opencode.ai)     | [CASS](https://github.com/Dicklesworthstone/coding_agent_session_search) - historical context |
|                                     | [UBS](https://github.com/Dicklesworthstone/ultimate_bug_scanner) - bug scanning               |
|                                     | [Ollama](https://ollama.ai) - local embeddings for semantic memory                            |

> **Note:** Semantic memory is embedded in the plugin. Install Ollama for vector search, or it falls back to full-text search.

Run `swarm doctor` to check status.

---

## Credits

**Inspiration & Core Ideas:**

- [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail) - **THE INSPIRATION** for multi-agent coordination. Swarm Mail is our implementation built on actor-model primitives (DurableMailbox, DurableLock) with local-first libSQL and event sourcing.
- [Superpowers](https://github.com/obra/superpowers) - verification patterns, Socratic planning, skill architecture
- [Electric SQL](https://electric-sql.com) - durable streams and event sourcing patterns that power Swarm Mail
- [Evalite](https://evalite.dev) - outcome-based evaluation framework for learning systems

> _"With event sourcing, you can design an event such that it is a self-contained description of a user action."_ — Martin Kleppmann, Designing Data-Intensive Applications

---

## License

MIT
