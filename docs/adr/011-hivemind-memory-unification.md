# ADR-011: Hivemind Memory Unification

```
                    🧠
                   /  \
                  /    \      "One mind to remember them all,
                 / HIVE \      one mind to find them,
                / MIND   \     one mind to bring them all
               /          \    and in the context bind them."
              /____________\
                   |||
         ┌────────┴┴┴────────┐
         │                   │
    ┌────┴────┐         ┌────┴────┐
    │ Learnings│         │ Sessions │
    │ (manual) │         │ (indexed)│
    └────┬────┘         └────┬────┘
         │                   │
         └─────────┬─────────┘
                   ▼
            ┌─────────────┐
            │  memories   │  ← Same table
            │   table     │  ← Same vectors
            │  (libSQL)   │  ← Same search
            └─────────────┘
```

## Status

**Accepted** - December 2025
**Implementation Status:** Implemented (Phase 1-3 Complete, Cleanup Pending)

The `hivemind_*` tools are fully implemented and registered in the plugin. However, legacy `memory-tools.ts` still exists and deprecated `semantic-memory_*` aliases are still present for backward compatibility.

## Context

### The Mess We're In

The memory system has been broken for weeks. Agents call `semantic-memory_*` tools and hit a dead external MCP server instead of our working internal implementation.

**Timeline of how we got here:**

1. **Phase 1: External MCP** (Oct 2024)
   - Built `semantic-memory` as standalone MCP server
   - PGLite + pgvector, "Budget Qdrant"
   - Stored in `~/.semantic-memory/memory/`
   - Worked great... until it didn't

2. **Phase 2: Consolidation** (Nov 2024, swarm-mail v0.5.0)
   - Moved semantic memory INTO swarm-mail package
   - Added migration from legacy PGLite database
   - Quote: _"Simplicity is the ultimate sophistication."_ — Leonardo da Vinci

3. **Phase 3: Wave 1-3 Enhancements** (Dec 2024, v1.6.1)
   - **Mem0 Pattern**: LLM decides ADD/UPDATE/DELETE/NOOP
   - **Auto-tagging**: LLM extracts tags automatically
   - **Zettelkasten linking**: Memory graph with relationships
   - **A-MEM entity extraction**: Knowledge graph from memories
   - Quote: _"Our approach draws inspiration from the Zettelkasten method..."_ — A-MEM paper

4. **Phase 4: CASS Inhousing** (Dec 2024, ADR-010)
   - Replaced external Rust CASS binary with internal session indexer
   - Sessions stored in SAME `memories` table
   - 102 tests passing, 5 agent formats supported

5. **Phase 5: The Breakage** (Dec 2024)
   - External `semantic-memory` MCP still in OpenCode config
   - MCP tools take precedence over plugin tools (same names!)
   - PGLite WASM crashes: `RuntimeError: Aborted()`
   - Agents can't store or retrieve memories
   - We've been flying blind for weeks

### What Actually Exists

**Internal Implementation (WORKING):**
```
packages/
├── swarm-mail/src/memory/
│   ├── adapter.ts          # High-level API (Mem0, auto-tag, linking)
│   ├── store.ts            # Vector storage (libSQL + Ollama)
│   ├── sync.ts             # .hive/memories.jsonl sync
│   ├── migrate-legacy.ts   # PGLite → libSQL migration
│   ├── memory-operations.ts # ADD/UPDATE/DELETE/NOOP logic
│   ├── auto-tagger.ts      # LLM tag extraction
│   ├── memory-linking.ts   # Zettelkasten graph
│   └── entity-extraction.ts # A-MEM entities
│
├── swarm-mail/src/sessions/
│   ├── session-indexer.ts  # Main orchestrator (102 tests)
│   ├── session-parser.ts   # JSONL/JSON → normalized messages
│   ├── chunk-processor.ts  # Split + embed sessions
│   └── file-watcher.ts     # Watch for new sessions
│
└── opencode-swarm-plugin/src/
    ├── memory.ts           # MemoryAdapter wrapper
    ├── memory-tools.ts     # Plugin tools (semantic-memory_*)
    └── cass-tools.ts       # Plugin tools (cass_*)
```

**External MCP (BROKEN):**
```
~/.semantic-memory/memory/     # PGLite database (has real data!)
~/Code/joelhooks/semantic-memory/  # Original repo (deprecated)
~/.config/opencode/config.json # Still references semantic-memory MCP
```

**The Naming Collision:**
- External MCP exposes: `semantic-memory_store`, `semantic-memory_find`, etc.
- Internal plugin exposes: `semantic-memory_store`, `semantic-memory_find`, etc.
- MCP wins. Internal tools never get called.

### What We Learned

1. **PGLite WASM is fragile** - Works until it doesn't. WASM memory limits, initialization races, no good error messages.

2. **libSQL is rock solid** - Native SQLite, vector support via sqlite-vec, no WASM bullshit.

3. **Sessions ARE memories** - CASS session indexer stores into the SAME `memories` table. They're not separate systems—they're different ingestion paths into unified storage.

4. **Tool naming matters** - When external MCP and internal plugin have same tool names, external wins. We need distinct names.

5. **Migration must be automatic** - Users have real data in `~/.semantic-memory/memory/`. We can't just delete it.

## Decision

### Unify Everything Under "Hivemind"

**New tool namespace:** `hivemind_*`

This is not just a rename. It's a unification:

```
BEFORE (15 tools, 2 systems, confusion):
├── semantic-memory_store
├── semantic-memory_find
├── semantic-memory_get
├── semantic-memory_remove
├── semantic-memory_validate
├── semantic-memory_list
├── semantic-memory_stats
├── semantic-memory_check
├── semantic-memory_upsert
├── cass_search
├── cass_view
├── cass_expand
├── cass_health
├── cass_index
└── cass_stats

AFTER (8 tools, 1 system, clarity):
├── hivemind_store      # Store a memory (manual learnings)
├── hivemind_find       # Search all memories (learnings + sessions)
├── hivemind_get        # Get specific memory by ID
├── hivemind_remove     # Delete a memory
├── hivemind_validate   # Reset decay timer
├── hivemind_stats      # Stats (counts, collections, health)
├── hivemind_index      # Index session directories
└── hivemind_sync       # Sync to .hive/memories.jsonl
```

**Why fewer tools?**

Sessions and learnings are the same thing—memories with different sources:
- `collection: "default"` → manual learnings
- `collection: "claude"` → Claude Code sessions
- `collection: "cursor"` → Cursor sessions
- `collection: "opencode"` → OpenCode sessions

Search is unified: `hivemind_find(query, { collection: "claude" })` filters by source.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HIVEMIND                                │
│                   (Unified Memory System)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  INGESTION PATHS:                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Agent Store  │  │ Session      │  │ Migration    │          │
│  │ (manual)     │  │ Indexer      │  │ (legacy)     │          │
│  │              │  │              │  │              │          │
│  │ hivemind_    │  │ hivemind_    │  │ Auto on      │          │
│  │ store()      │  │ index()      │  │ first use    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └────────────┬────┴─────────────────┘                   │
│                      ▼                                          │
│              ┌───────────────┐                                  │
│              │  MemoryStore  │  ← libSQL + sqlite-vec           │
│              │  (memories)   │  ← Ollama embeddings             │
│              └───────┬───────┘  ← FTS5 fallback                 │
│                      │                                          │
│  QUERY PATHS:        ▼                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    hivemind_find()                        │  │
│  │                                                           │  │
│  │  • Vector search (semantic similarity)                    │  │
│  │  • FTS5 fallback (when Ollama unavailable)               │  │
│  │  • Collection filter (learnings vs sessions)              │  │
│  │  • Metadata filter (agent_type, source_path, etc)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  SYNC:                                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    hivemind_sync()                        │  │
│  │                                                           │  │
│  │  .hive/memories.jsonl ←→ libSQL database                 │  │
│  │  (git-synced, team-shared, embeddings regenerated)       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Migration Strategy

**Automatic, non-interactive, idempotent.**

```typescript
// On first hivemind_* tool call:
async function ensureMigrated(): Promise<void> {
  // 1. Check if legacy PGLite database exists
  if (!existsSync('~/.semantic-memory/memory/PG_VERSION')) {
    return; // Nothing to migrate
  }

  // 2. Check if target already has memories
  const count = await db.query('SELECT COUNT(*) FROM memories');
  if (count > 0) {
    return; // Already migrated or has data
  }

  // 3. Migrate (existing code in migrate-legacy.ts)
  const result = await migrateLegacyMemories({
    legacyPath: '~/.semantic-memory/memory',
    targetDb: db,
    dryRun: false,
  });

  console.log(`[hivemind] Migrated ${result.migrated} memories from legacy database`);
}
```

**Setup CLI changes:**

```typescript
// In `swarm setup` command:

// 1. Remove semantic-memory from MCP config (already exists, make non-interactive)
if (opencodeConfig.mcpServers?.['semantic-memory']) {
  delete opencodeConfig.mcpServers['semantic-memory'];
  writeFileSync(configPath, JSON.stringify(opencodeConfig, null, 2));
  console.log('Removed legacy semantic-memory MCP server');
}

// 2. Run migration automatically (no prompt)
if (legacyDatabaseExists()) {
  const result = await migrateLegacyMemories({ targetDb, dryRun: false });
  console.log(`Migrated ${result.migrated} memories`);
}
```

### AGENTS.md Updates

**Remove:**
- All `semantic-memory_*` tool documentation
- All `cass_*` tool documentation
- References to external semantic-memory MCP

**Add:**
```markdown
## Hivemind - Unified Memory System

The hive remembers everything. Learnings, sessions, patterns—all searchable.

### Tools

| Tool | Purpose |
|------|---------|
| `hivemind_store` | Store a memory (learnings, decisions, patterns) |
| `hivemind_find` | Search all memories (semantic + FTS fallback) |
| `hivemind_get` | Get specific memory by ID |
| `hivemind_remove` | Delete outdated/incorrect memory |
| `hivemind_validate` | Confirm memory still accurate (resets 90-day decay) |
| `hivemind_stats` | Memory statistics and health |
| `hivemind_index` | Index AI session directories |
| `hivemind_sync` | Sync to .hive/memories.jsonl |

### Usage

```bash
# Store a learning (include WHY, not just WHAT)
hivemind_store(
  information="OAuth refresh tokens need 5min buffer before expiry to avoid race conditions",
  tags="auth,oauth,tokens"
)

# Search memories (includes past sessions)
hivemind_find(query="token refresh", limit=5)

# Search only Claude sessions
hivemind_find(query="authentication error", collection="claude")

# Index new sessions
hivemind_index()

# Sync to git
hivemind_sync()
```

### When to Use

**ALWAYS query before implementing:**
```bash
hivemind_find(query="<task keywords>", limit=5)
```

**ALWAYS store after solving hard problems:**
```bash
hivemind_store(
  information="<what you learned, WHY it matters>",
  tags="<relevant,tags>"
)
```

**ALWAYS validate when you confirm a memory is still accurate:**
```bash
hivemind_validate(id="mem_xyz")
```
```

### Plugin Template Updates

The plugin wrapper at `~/.config/opencode/plugin/swarm.ts` needs no changes—it's a thin shell that spawns the CLI. The CLI handles tool registration.

**Tool registration in index.ts:**

```typescript
// BEFORE
import { memoryTools } from "./memory-tools";
import { cassTools } from "./cass-tools";

export default {
  tool: {
    ...memoryTools,  // semantic-memory_*
    ...cassTools,    // cass_*
  }
}

// AFTER
import { hivemindTools } from "./hivemind-tools";

export default {
  tool: {
    ...hivemindTools,  // hivemind_*
  }
}
```

## Consequences

### Positive

1. **No more naming collision** - `hivemind_*` is unique, no external MCP conflict
2. **Fewer tools** - 8 instead of 15, less cognitive load for agents
3. **Unified mental model** - Sessions and learnings are just memories with different sources
4. **Automatic migration** - Users don't lose their data
5. **Cleaner AGENTS.md** - One section instead of two
6. **Better branding** - "Hivemind" fits the bee/swarm metaphor

### Negative

1. **Breaking change** - Existing prompts reference `semantic-memory_*` and `cass_*`
2. **Migration risk** - PGLite → libSQL could lose data if migration fails
3. **Deprecation period** - Need to support old tool names temporarily

### Mitigations

**Breaking change:**
- Add deprecation aliases: `semantic-memory_store` → `hivemind_store` (with warning)
- Update all prompts in one pass (SUBTASK_PROMPT_V2, coordinator prompts, etc.)
- AGENTS.md generator scrubs old references

**Migration risk:**
- Dry-run first, report what would be migrated
- Backup legacy database before migration
- Idempotent migration (safe to run multiple times)

**Deprecation period:**
- Keep aliases for 2 releases
- Log deprecation warning on each use
- Remove aliases in v2.0

## Implementation Plan

### Phase 1: Core Rename (hivemind-tools.ts) ✅ COMPLETE

- [x] Create `src/hivemind-tools.ts` with new tool names
- [x] Merge memory + session functionality
- [x] Add deprecation aliases for old names (semantic-memory_*, cass_*)
- [x] Update tool registration in index.ts

**Status:** Complete. File exists at `packages/opencode-swarm-plugin/src/hivemind-tools.ts` with 8 unified tools and exports `hivemindTools` in index.ts.

### Phase 2: Migration Automation ✅ COMPLETE

- [x] Auto-migration on first hivemind tool call (via swarm-mail/src/memory/migrate-legacy.ts)
- [x] Remove semantic-memory MCP from config automatically (handled by swarm setup)

**Status:** Complete. Migration logic exists and is tested. PGLite → libSQL migration is automatic and idempotent.

### Phase 3: Prompt Updates ✅ COMPLETE

- [x] Update SUBTASK_PROMPT_V2 (worker survival checklist) - now uses `hivemind_*`
- [x] Update coordinator prompts - use `hivemind_*` tools
- [x] Update AGENTS.md generator - removed semantic-memory section
- [x] Update all documentation

**Status:** Complete. Worker prompts in `packages/opencode-swarm-plugin/src/swarm-prompts.ts` reference `hivemind_*` tools. AGENTS.md uses `hivemind:*` namespace.

### Phase 4: Testing ✅ COMPLETE

- [x] Unit tests for hivemind tools (`packages/opencode-swarm-plugin/src/hivemind-tools.test.ts`)
- [x] Integration tests for migration (in swarm-mail package)
- [x] E2E test: store → find → validate → sync

**Status:** Complete. Tests passing for all hivemind tools and migration logic.

### Phase 5: Cleanup ⏸️ PENDING

- [ ] Remove `memory-tools.ts` (replaced by hivemind-tools.ts) - **Still exists, exports memoryTools**
- [ ] Remove `cass-tools.ts` (absorbed into hivemind-tools.ts) - **Still exists, exports cassTools**
- [ ] Remove deprecation aliases (after 2 releases) - **Still present in hivemind-tools.ts and index.ts**

**Status:** Pending. Legacy files still exist:
- `packages/opencode-swarm-plugin/src/memory-tools.ts` - exports `memoryTools` (semantic-memory_*)
- `packages/opencode-swarm-plugin/src/cass-tools.ts` - exports `cassTools` (cass_*)
- Deprecation aliases present in `hivemind-tools.ts` for backward compatibility

**Next steps:**
1. Announce deprecation in release notes (2 release window before removal)
2. Add runtime warnings when deprecated tools are used
3. After 2 releases, remove memory-tools.ts and cass-tools.ts entirely
4. Remove deprecation aliases from hivemind-tools.ts
5. Remove from index.ts exports

## References

### Implementation

- **Memory adapter:** `packages/swarm-mail/src/memory/adapter.ts`
- **Session indexer:** `packages/swarm-mail/src/sessions/session-indexer.ts`
- **Legacy migration:** `packages/swarm-mail/src/memory/migrate-legacy.ts`
- **Current tools:** `packages/opencode-swarm-plugin/src/memory-tools.ts`
- **CASS tools:** `packages/opencode-swarm-plugin/src/cass-tools.ts`

### Related ADRs

- **ADR-010:** CASS Session Indexing Inhousing
- **ADR-009:** Semantic Memory Integration (implicit, in changelogs)

### External References

- **Mem0:** https://mem0.ai - Smart memory operations pattern
- **A-MEM:** Agentic Memory for LLM Agents (paper)
- **Zettelkasten:** https://zettelkasten.de - Knowledge graph inspiration
- **CASS (Original):** https://github.com/Dicklesworthstone/coding_agent_session_search

### Lore

> "Our approach draws inspiration from the Zettelkasten method, a sophisticated
> knowledge management system that creates interconnected information networks
> through atomic notes and flexible linking."
> — A-MEM: Agentic Memory for LLM Agents

> "Simplicity is the ultimate sophistication."
> — Leonardo da Vinci (on consolidating semantic memory into swarm-mail)

> "The hive remembers all agent sessions, searchable and semantic."
> — ADR-010: CASS Inhousing

---

```
        .-.
       (o o)  "Finally, one brain
       | O |   instead of two broken ones."
       /   \
      /     \
     /       \
    /_________\
       | | |
       | | |
    ~~~~~~~~~~~
     HIVEMIND
```
