# swarm-mail

## 1.7.0

### Minor Changes

- [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a) Thanks [@joelhooks](https://github.com/joelhooks)! - ## The Hive Remembers Everything

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

  > _"The palest ink is better than the best memory."_ — Chinese Proverb

  ### ADR-011: Hivemind Memory Unification

  **15 tools → 8 tools.** Sessions and learnings are now unified under one namespace.

  **What changed:**

  | Old Tool                   | New Tool                            |
  | -------------------------- | ----------------------------------- |
  | `semantic-memory_store`    | `hivemind_store`                    |
  | `semantic-memory_find`     | `hivemind_find`                     |
  | `semantic-memory_get`      | `hivemind_get`                      |
  | `semantic-memory_remove`   | `hivemind_remove`                   |
  | `semantic-memory_validate` | `hivemind_validate`                 |
  | `cass_search`              | `hivemind_find` (collection filter) |
  | `cass_view`                | `hivemind_get`                      |
  | `cass_index`               | `hivemind_index`                    |
  | `cass_stats`               | `hivemind_stats`                    |
  | NEW                        | `hivemind_sync`                     |

  **Why it matters:**

  1. **No more naming collision** - External `semantic-memory` MCP was shadowing our internal tools
  2. **Unified search** - `hivemind_find` searches both learnings AND sessions in one query
  3. **Collection filter** - `collection: "claude"` for Claude sessions, `collection: "default"` for learnings
  4. **Simpler mental model** - Sessions ARE memories, just from a different source

  **Backward compatible:** All old tool names (`semantic-memory_*`, `cass_*`) still work via deprecation aliases. They'll emit warnings but won't break.

  **Migration:** None required. Old tool names continue to work. Update at your leisure.

  **117+ tests** covering all tools, lifecycle, deprecation aliases, and integration points.

- [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🗄️ → 🌐 Database Migration: Local to Global

  ```
      ┌──────────────────┐
      │ Project A        │           ┌─────────────────────┐
      │  .opencode/      │──┐        │                     │
      │  streams.db      │  │        │   GLOBAL DATABASE   │
      └──────────────────┘  │        │                     │
                            ├───────▶│  ~/.config/         │
      ┌──────────────────┐  │        │  swarm-tools/       │
      │ Project B        │  │        │  swarm.db           │
      │  .opencode/      │──┘        │                     │
      │  streams.db      │           │  ALL YOUR DATA      │
      └──────────────────┘           │  ONE PLACE          │
                                     └─────────────────────┘
  ```

  > "When you are pretty sure you know where the data ought to be, you can move and migrate the data in a single move. Only the accessors need to change, reducing the risk for problems with bugs."
  >
  > — Martin Fowler, _Refactoring: Improving the Design of Existing Code_

  **What changed:**

  Swarm Mail now automatically consolidates project-local databases into a single global database at `~/.config/swarm-tools/swarm.db`. No more scattered data across projects.

  **Why it matters:**

  - **One source of truth** - All coordination data (events, messages, reservations) centralized
  - **Cross-project visibility** - Query patterns across all your projects
  - **Simpler backups** - One database to backup, not N scattered files
  - **Zero user intervention** - Triggers automatically on first access to any project
  - **Idempotent & safe** - Renames old DB to `.migrated` suffix after success, never re-runs

  **How it works:**

  1. On first `getSwarmMailLibSQL()` call, checks for local database
  2. If found, migrates all 16 tables to global DB in background (fire-and-forget)
  3. Renames local DB to `streams.db.migrated` to mark completion
  4. Future calls use global DB directly

  **Migration coverage:**

  Migrates all subsystems:

  - **Streams:** events, agents, messages, message_recipients, reservations, cursors, locks
  - **Hive:** beads, bead_dependencies, bead_labels, bead_comments, blocked_beads_cache, dirty_beads
  - **Learning:** eval_records, swarm_contexts, deferred

  **Manual migration:**

  For power users who want explicit control:

  ```typescript
  import { migrateLocalDbToGlobal } from "swarm-mail";

  const stats = await migrateLocalDbToGlobal(
    "/abs/path/to/.opencode/streams.db",
    "~/.config/swarm-tools/swarm.db"
  );

  console.log(`Migrated ${stats.events} events, ${stats.messages} messages`);
  ```

  **Backward compatible:** Existing code continues to work. Projects without local DBs start fresh with global DB.

### Patch Changes

- [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔧 Test Suite Stabilization & Global Database Path

  > "The first step in fixing a broken window is to notice it."
  > — The Pragmatic Programmer

  ```
       ___________
      |  PASSING  |
      |   TESTS   |
      |___________|
           ||
      ╔════╧════╗
      ║ 1538    ║
      ║  ✓ ✓ ✓  ║
      ╚═════════╝
  ```

  ### What Changed

  **swarm-mail:**

  - `getDatabasePath()` now ALWAYS returns global path (`~/.config/swarm-tools/swarm.db`)
  - Local project databases will be auto-migrated in a future release (placeholder warning added)
  - Auto-tagger LLM tests now opt-in via `RUN_LLM_TESTS=1` (prevents flaky CI)

  **opencode-swarm-plugin:**

  - Fixed type mismatches in compaction hook (HiveAdapter → MinimalHiveAdapter)
  - Fixed eval capture in tool hooks (args not available in after hook)
  - All 425 tests passing

  ### Why Global Database?

  Single source of truth across all projects:

  - No more orphaned databases in worktrees
  - Consistent swarm state regardless of working directory
  - Simpler backup/restore story

  ### ⚠️ Breaking: Local Databases Orphaned

  Existing local databases at `{project}/.opencode/swarm.db` are **NOT migrated**.
  They remain on disk but are no longer read. A warning is logged when detected.

  **Tracked:** Cell `mjrd8cyhvnu` - Implement local-to-global DB migration

  **If you have important data in local DBs**, wait for migration tool or manually copy:

  ```bash
  # Check if you have local data
  ls -la .opencode/swarm.db
  ```

  ### Test Results

  | Package               | Pass | Skip | Fail |
  | --------------------- | ---- | ---- | ---- |
  | swarm-mail            | 1113 | 29   | 0    |
  | opencode-swarm-plugin | 425  | 0    | 0    |

## 1.6.2

### Patch Changes

- [`70e62c9`](https://github.com/joelhooks/swarm-tools/commit/70e62c9c6c9c29ecf7778aad90813adf5ad8a20e) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔬 Smart Operations: From Eval Purgatory to Integration Paradise

  ```
       BEFORE                          AFTER
     ┌─────────┐                    ┌─────────┐
     │ evalite │ ──CORRUPT──►       │ bun:test│
     │ vitest  │   VTAB!            │  vec0   │
     │  vec0?  │                    │   ✓     │
     └────╳────┘                    └────✓────┘
          │                              │
          │  "database disk image        │  5 pass, 2 skip
          │   is malformed"              │  (libSQL bug, not us)
          ▼                              ▼
        💀 RIP                        🎉 ALIVE
  ```

  > "They test implementation detail and hurt migrations."
  > — _The Coding Career Handbook_

  Migrated `smart-operations.eval.ts` from evalite to bun:test integration tests.

  **Why?** The sqlite-vec (vec0) extension loads fine in bun's native test runner but throws `SQLITE_CORRUPT_VTAB` in vitest/evalite. Rather than mock the unmockable, we moved where the tests can breathe.

  **What moved:**

  - `evals/smart-operations.eval.ts` → `swarm-mail/src/memory/__tests__/smart-operations.integration.test.ts`
  - Deleted: `evals/fixtures/smart-operations-fixtures.ts`
  - Deleted: `evals/scorers/smart-operations-scorer.ts`

  **Test results:** 5 pass, 2 skip (UPDATE/DELETE have a separate libSQL corruption bug being tracked)

  **The eval tested:** ADD/UPDATE/DELETE/NOOP smart memory operations with LLM-powered decision making. Now it actually runs.

## 1.6.1

### Patch Changes

- [`fb4b2d5`](https://github.com/joelhooks/swarm-tools/commit/fb4b2d545943fa6e5a5f5294f2bcd129191b8667) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔍 hive_cells Now Returns All Matches for Partial IDs

  > "Tune and test your metadata by comparing it with the tone, coverage, and trends of your searchers' common queries."
  > — _Search Analytics for Your Site_

  Previously, `hive_cells({ id: "mjonid" })` would throw an "Ambiguous ID" error when multiple cells matched. This was hostile UX for a **query tool** — users expect to see all matches, not be forced to guess more characters.

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

  **What changed:**

  - Added `findCellsByPartialId()` — returns `Cell[]` instead of throwing
  - `hive_cells` now uses this for partial ID lookups
  - `resolvePartialId()` still throws for tools that need exactly one cell (hive_update, hive_close, etc.)

  **Why it matters:**

  - Query tools should return results, not errors
  - Partial ID search is now actually useful for exploration
  - Consistent with how `grep` and other search tools behave

- [`ca12bd6`](https://github.com/joelhooks/swarm-tools/commit/ca12bd6dd68ee41bdb9deb78409c73a08460806e) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 📚 Wave 1-3 Memory Features Now Documented

  > "Following the basic principles of the Zettelkasten method, we designed our memory system to create interconnected knowledge networks through dynamic indexing and linking."
  > — _A-MEM: Agentic Memory for LLM Agents_

  The swarm-mail README now comprehensively documents all Wave 1-3 memory features:

  ```
       ┌─────────────────────────────────────────┐
       │         MEMORY SYSTEM DOCS              │
       ├─────────────────────────────────────────┤
       │                                         │
       │  📝 Smart Upsert (Mem0 Pattern)         │
       │     ADD / UPDATE / DELETE / NOOP        │
       │     LLM decides, you relax              │
       │                                         │
       │  🏷️  Auto-Tagging                       │
       │     LLM extracts tags from content      │
       │                                         │
       │  🔗 Memory Linking (Zettelkasten)       │
       │     Interconnected knowledge web        │
       │                                         │
       │  🧠 Entity Extraction (A-MEM)           │
       │     Knowledge graph from memories       │
       │                                         │
       │  ⏰ Temporal Queries                    │
       │     Supersession chains, validity       │
       │                                         │
       └─────────────────────────────────────────┘
  ```

  **What's documented:**

  - Basic usage with code examples
  - Smart operations (Mem0 pattern)
  - Knowledge graph queries
  - Temporal validity tracking
  - New schema tables and columns
  - Service exports for advanced use
  - Graceful degradation behavior

  **Also fixed:** Removed stale pgvector references → now correctly states libSQL native vector support via sqlite-vec.

- [`ef21ee0`](https://github.com/joelhooks/swarm-tools/commit/ef21ee0d943e0d993865dd44b69b25c025de79ac) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Memory System Polish: The Hive Remembers

  > _"Our approach draws inspiration from the Zettelkasten method, a sophisticated
  > knowledge management system that creates interconnected information networks
  > through atomic notes and flexible linking."_
  > — A-MEM: Agentic Memory for LLM Agents

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

  ### What Changed

  **swarm-mail:**

  - **README overhaul** - Documented Wave 1-3 memory features with code examples
  - **Test fixes** - `test.skip()` → `test.skipIf(!hasWorkingLLM)` for graceful CI/local behavior
  - Replaced outdated `pgvector` references with `libSQL vec extension`

  **opencode-swarm-plugin:**

  - **ADR: Memory System Eval Strategy** - 3-tier approach (heuristics/integration/LLM-as-judge)
  - **smart-operations.eval.ts** - Evalite test suite for ADD/UPDATE/DELETE/NOOP decisions
  - Fixtures covering 8 test scenarios (exact match, refinement, contradiction, new info)
  - LLM-as-judge scorer with graceful degradation

  ### The Philosophy

  > _"As the system processes more memories over time, it develops increasingly
  > sophisticated knowledge structures, discovering higher-order patterns and
  > concepts across multiple memories."_
  > — A-MEM

  The memory system isn't just storage—it's a living knowledge graph that evolves.

  ### Run the Eval

  ```bash
  bun run eval:smart-operations
  ```

## 1.6.0

### Minor Changes

- [`823987d`](https://github.com/joelhooks/swarm-tools/commit/823987d7b7ef57bf636665008ebbcdffe333e828) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Worktree Support + Graceful Degradation

  ```
      ┌─────────────────────────────────────────────────────┐
      │                                                     │
      │   "It is impossible to reduce the probability       │
      │    of a fault to zero; therefore it is usually      │
      │    best to design fault-tolerance mechanisms        │
      │    that prevent faults from causing failures."      │
      │                                                     │
      │                    — Kleppmann, DDIA                │
      │                                                     │
      └─────────────────────────────────────────────────────┘
  ```

  ### Git Worktree Support (#52)

  All worktrees now share the main repository's database. No more isolated state per worktree.

  ```
  BEFORE:                          AFTER:
  main-repo/.opencode/swarm.db     main-repo/.opencode/swarm.db
  worktree-1/.opencode/swarm.db    worktree-1/ ──┐
  worktree-2/.opencode/swarm.db    worktree-2/ ──┼─→ main-repo/.opencode/
                                   worktree-3/ ──┘
  ```

  **How it works:**

  - Detects worktrees by checking if `.git` is a file (not directory)
  - Parses `gitdir:` path to resolve main repo location
  - All DB operations automatically use main repo's `.opencode/`

  ### Graceful Degradation for semantic-memory (#53)

  When Ollama is unavailable, `semantic-memory_find` now falls back to full-text search instead of erroring.

  **Before:** `OllamaError: Connection failed` → tool fails
  **After:** Warning logged → FTS results returned → tool works

  Also added `repairStaleEmbeddings()` to fix the "dimensions are different: 0 != 1024" error when memories were stored without embeddings.

  ### New Skill: gh-issue-triage

  Added `.opencode/skills/gh-issue-triage/` for GitHub issue triage workflow:

  - Extracts contributor profiles including Twitter handles
  - Templates for acknowledgment comments
  - Changeset credit templates with @mentions

  ***

  Thanks to [@justBCheung](https://x.com/justBCheung) for filing both issues with excellent debugging context. 🙏

## 1.5.5

### Patch Changes

- [`ab90238`](https://github.com/joelhooks/swarm-tools/commit/ab902386883fa9654c9977d28888582fafc093e5) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Query Epic Children Without Rawdogging JSONL

  `hive_cells` and `hive_query` now support `parent_id` filter. Find all children of an epic in one call:

  ```typescript
  hive_cells({ parent_id: "epic-id" }); // Returns all subtasks
  hive_query({ parent_id: "epic-id", status: "open" }); // Open subtasks only
  ```

  No more grep/jq on issues.jsonl. The tools do what they should.

## 1.5.4

### Patch Changes

- [`a79e04b`](https://github.com/joelhooks/swarm-tools/commit/a79e04b1bb3b40c09c5265b5d11739864799e4e2) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔭 Swarm Observability: See What Your Bees Are Doing

  > "Observability is about instrumenting your system in a way that ensures sufficient information about a system's runtime is collected and analyzed so that when something goes wrong, it can help you understand why."
  > — Chip Huyen, _AI Engineering_

  New CLI commands to understand swarm health and history:

  ### `swarm stats`

  ```
  ┌─────────────────────────────────────────┐
  │        🐝  SWARM STATISTICS  🐝         │
  ├─────────────────────────────────────────┤
  │ Total Swarms: 42   Success: 87%         │
  │ Avg Duration: 4.2min                    │
  ├─────────────────────────────────────────┤
  │ BY STRATEGY                             │
  │ ├─ file-based      92% (23/25)          │
  │ ├─ feature-based   78% (14/18)          │
  │ ├─ risk-based      67% (2/3)            │
  ├─────────────────────────────────────────┤
  │ COORDINATOR HEALTH                      │
  │ Violation Rate:   2%                    │
  │ Spawn Efficiency: 94%                   │
  │ Review Rate:      88%                   │
  └─────────────────────────────────────────┘
  ```

  Options: `--since 24h/7d/30d`, `--json`

  ### `swarm history`

  Timeline of recent swarm activity with filtering:

  - `--status success/failed/in_progress`
  - `--strategy file-based/feature-based/risk-based`
  - `--verbose` for subtask details

  ### Prompt Insights Integration

  Coordinators and workers now receive injected insights from past swarm outcomes:

  - Strategy success rates as markdown tables
  - Anti-pattern warnings for low-success strategies
  - File/domain-specific learnings from semantic memory

  This creates a feedback loop where swarms learn from their own history.

  ### Also in this release

  - **swarm-dashboard** (WIP): React/Vite visualizer scaffold
  - **ADR-006**: Swarm PTY decision document
  - **CI fix**: Smarter changeset detection prevents empty PR errors

## 1.5.3

### Patch Changes

- [`3e7c126`](https://github.com/joelhooks/swarm-tools/commit/3e7c126b11aa6ad909ebcb2ab3cf77883f9acfe4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🧪 Bulletproof Test Suite

  > "Setting up our tests to run synchronously and using mocking libraries will greatly speed up our testing"
  > — ng-book

  Fixed test isolation issues that caused 19 tests to fail when run together but pass in isolation.

  ### The Culprits

  **1. Global fetch pollution** (`ollama.test.ts`)

  ```typescript
  // BEFORE: Replaced global.fetch, never restored it
  global.fetch = mockFetch;

  // AFTER: Save and restore
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  ```

  **2. Port conflicts** (`durable-server.test.ts`)

  - Tests used hardcoded ports (4483, 4484, 4485)
  - Parallel test runs fought over the same ports
  - Fixed: Use `port: 0` for OS-assigned ports, made `server.url` a getter

  **3. AI SDK schema incompatibility** (`memory-operations.ts`)

  - `z.discriminatedUnion` creates `oneOf` at top level
  - Anthropic API requires `type: object` at top level
  - Fixed: Flat object schema with optional fields

  ### Test Stats

  ```
  Before: 19 failures when run together
  After:  0 failures, 1406 tests pass
  ```

  ### Files Changed

  - `src/memory/ollama.test.ts` - Restore global.fetch after each test
  - `src/streams/durable-server.ts` - Dynamic port getter
  - `src/streams/durable-server.test.ts` - Use port 0, rewrite for isolation
  - `src/memory/memory-operations.ts` - Flat schema for Anthropic compatibility
  - Renamed `memory-operations.test.ts` → `memory-operations.integration.test.ts`

## 1.5.2

### Patch Changes

- [`aa12943`](https://github.com/joelhooks/swarm-tools/commit/aa12943f3edc8d5e23878b22f44073e4c71367c5) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Eval-Driven Development: The System That Scores Itself

  > "What gets measured gets managed." — Peter Drucker
  > "What gets scored gets improved." — The Swarm

  The plugin now evaluates its own output quality through a progressive gate system. Every compaction prompt gets scored, tracked, and learned from. Regressions become impossible to ignore.

  ### The Pipeline

  ```
  CAPTURE → SCORE → STORE → GATE → LEARN → IMPROVE
     ↑                                      ↓
     └──────────────────────────────────────┘
  ```

  ### What's New

  **Event Capture** (5 integration points)

  - `detection_triggered` - When compaction is detected
  - `prompt_generated` - Full LLM prompt captured
  - `context_injected` - Final content before injection
  - All events stored to `~/.config/swarm-tools/sessions/{session_id}.jsonl`

  **5 Compaction Prompt Scorers**

  - `epicIdSpecificity` - Real IDs, not placeholders (20%)
  - `actionability` - Specific tool calls with values (20%)
  - `coordinatorIdentity` - ASCII header + mandates (25%)
  - `forbiddenToolsPresent` - Lists what NOT to do (15%)
  - `postCompactionDiscipline` - First tool is correct (20%)

  **Progressive Gates**
  | Phase | Threshold | Behavior |
  |-------|-----------|----------|
  | Bootstrap | N/A | Always pass, building baseline |
  | Stabilization | 0.6 | Warn but pass |
  | Production | 0.7 | Fail CI on regression |

  **CLI Commands**

  ```bash
  swarm eval status          # Current phase, thresholds, scores
  swarm eval history         # Trends with sparklines ▁▂▃▄▅▆▇█
  swarm eval run [--ci]      # Execute evals, gate check
  ```

  **CI Integration**

  - Runs after tests pass
  - Posts results as PR comment with emoji status
  - Only fails in production phase with actual regression

  **Learning Feedback Loop**

  - Significant score drops auto-stored to semantic memory
  - Future agents learn from past failures
  - Pattern maturity tracking

  ### Breaking Changes

  None. All new functionality is additive.

  ### Files Changed

  - `src/eval-capture.ts` - Event capture with Zod schemas
  - `src/eval-gates.ts` - Progressive gate logic
  - `src/eval-history.ts` - Score tracking over time
  - `src/eval-learning.ts` - Failure-to-learning extraction
  - `src/compaction-prompt-scoring.ts` - 5 pure scoring functions
  - `evals/compaction-prompt.eval.ts` - Evalite integration
  - `bin/swarm.ts` - CLI commands
  - `.github/workflows/ci.yml` - CI integration

  ### Test Coverage

  - 422 new tests for eval-capture
  - 48 CLI tests
  - 7 integration tests for capture wiring
  - All existing tests still passing

## 1.5.1

### Patch Changes

- [`e0c422d`](https://github.com/joelhooks/swarm-tools/commit/e0c422de3f5e15c117cc0cc655c0b03242245be4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔍 Short IDs Finally Work

  Cell ID resolution now matches **any unique substring**, not just the hash segment.

  **Before:** `hive_start(id="mjkmdat26vq")` → ❌ "No cell found"
  **After:** `hive_start(id="mjkmdat26vq")` → ✅ Works!

  **What changed:**

  - `resolvePartialId()` pattern: `%-hash%-%` → `%substring%`
  - Matches project name, hash, OR timestamp+random segments
  - Added 3 new tests for timestamp+random matching

  **Cell ID anatomy:**

  ```
  opencode-swarm-monorepo-lf2p4u-mjkmdat26vq
  │                       │      │
  └── project name ───────┘      │
                          └ hash ┘
                                 └── timestamp+random (NOW MATCHABLE!)
  ```

  Users can now use the short, memorable end portion of cell IDs.

- [`43c8c93`](https://github.com/joelhooks/swarm-tools/commit/43c8c93ef90b2f04ce59317192334f69d7c4204e) Thanks [@joelhooks](https://github.com/joelhooks)! - ## ⚠️ PGlite Deprecated - libSQL is the Future

  PGlite support is now deprecated and will be removed in the next major version.

  **What changed:**

  - Added deprecation warnings to all PGlite-related functions
  - `createInMemorySwarmMail()` now uses libSQL by default
  - `getSwarmMailPGlite()` logs deprecation notice on first use

  **Migration path:**

  - New projects: Use `createInMemorySwarmMail()` or `getSwarmMailLibSQL()`
  - Existing PGlite databases: Run `migratePGliteToLibSQL()` to migrate your data
  - The migration utility preserves all events, projections, and metadata

  **Why the change:**
  libSQL (SQLite-compatible) provides better performance, stability, and ecosystem support. PGlite was experimental and is no longer actively maintained.

  **Timeline:**

  - Current (v0.x): PGlite works with deprecation warnings
  - Next major (v1.0): PGlite support removed entirely

  Start migrating now to avoid breaking changes in v1.0.

## 1.5.0

### Minor Changes

- [`a78a40d`](https://github.com/joelhooks/swarm-tools/commit/a78a40de32eb34d1738b208f2a36929a4ab6cb81) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 📊 Analytics Queries: Four Golden Signals for Swarms

  > "Without data, you're just another person with an opinion." — W. Edwards Deming

  Five pre-built analytics queries based on Google's SRE Four Golden Signals:

  ### The Queries

  1. **Latency** - Task duration by strategy (avg/P95 completion times)
  2. **Traffic** - Events per hour (time-series with bucketing)
  3. **Errors** - Failed tasks by agent (failure tracking)
  4. **Saturation** - Active reservations (resource usage)
  5. **Conflicts** - Most contested files (hotspot detection)

  ### Usage

  ```typescript
  import { runAnalyticsQuery, ANALYTICS_QUERIES } from "swarm-mail";

  // List available queries
  ANALYTICS_QUERIES.forEach((q) => console.log(q.name, q.description));

  // Run a query
  const result = await runAnalyticsQuery(db, "latency", {
    since: new Date(Date.now() - 24 * 60 * 60 * 1000), // last 24h
    format: "table", // or 'json', 'csv'
  });
  ```

  ### Why This Matters

  Event sourcing gives us the data. These queries give us the answers:

  - Which decomposition strategies are fastest?
  - Which agents fail most often?
  - Which files cause the most contention?
  - How busy is the swarm right now?

  All queries use parameterized SQL (security) and support time filtering.

### Patch Changes

- [`5a7c084`](https://github.com/joelhooks/swarm-tools/commit/5a7c084514297b5b9ca5df9459a74f18eb805b8a) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 SSE Streams Now Actually Stream

  Fixed a subtle bug where SSE connections would hang indefinitely when requesting live events from the current head offset.

  **The Problem:**
  When a client connects with `?live=true&offset=N` where N equals the current head (meaning "only send me NEW events"), the server had nothing to send immediately. Bun's `fetch()` would block waiting for the first byte, and the connection would timeout.

  **The Fix:**
  Send an SSE comment (`: connected\n\n`) at stream start to flush headers. SSE comments are ignored by clients but establish the connection immediately.

  ```typescript
  // Before: fetch() hangs waiting for first byte
  const stream = new ReadableStream({
    async start(controller) {
      // If no existing events, nothing gets enqueued
      // Client's fetch() blocks forever
    },
  });

  // After: connection established immediately
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      // Client receives headers, can start reading
    },
  });
  ```

  **Bonus fix:** Added `startOffset` parameter to `subscribe()` to eliminate async initialization race condition.

  All 18 durable-server tests now pass (was 17/18).

## 1.4.0

### Minor Changes

- [`652fd16`](https://github.com/joelhooks/swarm-tools/commit/652fd16ff424eff92ebb3f5da0599caf676de2ce) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔭 Observability Stack MVP: See What Your Swarm Is Doing

  > "You can't improve what you can't measure." — Peter Drucker

  The swarm just got eyes. This release adds comprehensive observability for multi-agent coordination, answering the eternal question: "Why did my epic fail?"

  ### What's New

  **Structured Error Classes** (swarm-mail)

  - `BaseSwarmError` with rich context: agent, bead_id, epic_id, timestamp, recent events
  - Specialized errors: `ReservationError`, `CheckpointError`, `ValidationError`, `DecompositionError`
  - Every error includes actionable suggestions for resolution
  - Full `toJSON()` serialization for logging and debugging

  **DEBUG Logging** (swarm-mail)

  - `DEBUG=swarm:*` environment variable filtering
  - 4 subsystems: `swarm:events`, `swarm:reservations`, `swarm:messages`, `swarm:checkpoints`
  - Zero overhead when disabled

  **swarm-db CLI** (swarm-mail)

  ```bash
  # Raw SQL queries (SELECT only, max 1000 rows)
  swarm-db query "SELECT type, COUNT(*) FROM events GROUP BY type"

  # Pre-built analytics
  swarm-db analytics failed-decompositions --since 7d --format json

  # List available analytics
  swarm-db list
  ```

  **10 Pre-built Analytics Queries** (Four Golden Signals mapped)
  | Query | What It Answers |
  |-------|-----------------|
  | `failed-decompositions` | Which strategies are failing? |
  | `strategy-success-rates` | What's working? |
  | `lock-contention` | Where are agents fighting over files? |
  | `agent-activity` | Who's doing what? |
  | `message-latency` | How fast is coordination? |
  | `scope-violations` | Who's touching files they shouldn't? |
  | `task-duration` | How long do tasks take? |
  | `checkpoint-frequency` | Are agents checkpointing enough? |
  | `recovery-success` | Do checkpoints actually help? |
  | `human-feedback` | What are reviewers rejecting? |

  **Agent-Facing Tools** (opencode-swarm-plugin)

  ```typescript
  // Query analytics programmatically
  swarm_analytics({
    query: "failed-decompositions",
    since: "7d",
    format: "summary",
  });

  // Raw SQL for power users (max 50 rows, context-safe)
  swarm_query({ sql: "SELECT * FROM events WHERE type = 'task_blocked'" });

  // Auto-diagnosis for debugging
  swarm_diagnose({
    epic_id: "bd-123",
    include: ["blockers", "errors", "timeline"],
  });

  // Learning insights for feedback loops
  swarm_insights({ scope: "epic", metrics: ["success_rate", "avg_duration"] });
  ```

  ### Why This Matters

  Before: "The swarm failed. No idea why."
  After: "Strategy X failed 80% of the time due to file conflicts. Switching to Y."

  Event sourcing was already 80% of the solution. This release adds the diagnostic views to make that data actionable.

  ### Test Coverage

  - 588 tests passing
  - 1214 assertions
  - Full TDD: every feature started with a failing test

## 1.3.0

### Minor Changes

- [#54](https://github.com/joelhooks/swarm-tools/pull/54) [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 The Great Drizzle Migration

  > _"In most cases, a change to an application's features also requires a change to data that it stores: perhaps a new field or record type needs to be captured, or perhaps existing data needs to be presented in a new way."_
  > — Martin Kleppmann, _Designing Data-Intensive Applications_

  The hive's data layer got a complete overhaul. PGlite is out, libSQL is in, and Drizzle ORM now handles all the heavy lifting.

  ```
  ┌─────────────────────────────────────────────────────┐
  │                  BEFORE → AFTER                     │
  ├─────────────────────────────────────────────────────┤
  │  PGlite (WASM Postgres)  →  libSQL (SQLite fork)   │
  │  Raw SQL strings         →  Drizzle ORM            │
  │  Implicit connections    →  Explicit adapters      │
  │  Test flakiness          →  Deterministic tests    │
  └─────────────────────────────────────────────────────┘
  ```

  ### What Changed

  **Database Layer:**

  - Migrated from PGlite to libSQL for all persistence
  - Introduced `DatabaseAdapter` interface for dependency injection
  - All Effect primitives now accept explicit database connections
  - Added `getSwarmMailLibSQL()` factory for clean initialization

  **Effect Primitives Refactored:**

  - `DurableDeferred` - now takes adapter, cleaner resolve/reject
  - `DurableLock` - explicit connection, better timeout handling
  - `DurableCursor` - adapter-based, no global state
  - `DurableMailbox` - consistent with other primitives

  **Test Infrastructure:**

  - 32 failing tests fixed through schema alignment
  - `createInMemorySwarmMail()` for fast, isolated tests
  - No more WASM initialization flakiness
  - Tests run in <100ms instead of 5s+

  **Schema Alignment:**

  - Unified schema between memory and streams
  - Fixed PostgreSQL → SQLite syntax (ANY() → IN())
  - Vector search now uses proper `vector_top_k` with index

  ### Migration Notes

  If you were using internal APIs:

  ```typescript
  // BEFORE (implicit global state)
  import { getDatabase } from "swarm-mail";
  const db = await getDatabase();

  // AFTER (explicit adapter)
  import { getSwarmMailLibSQL } from "swarm-mail";
  const adapter = await getSwarmMailLibSQL({ path: "./data.db" });
  ```

  **PGlite is deprecated.** It remains only for migrating legacy databases. New code should use libSQL exclusively.

  ### Why This Matters

  - **Faster tests** - No WASM cold start, in-memory SQLite is instant
  - **Cleaner architecture** - No hidden global state, explicit dependencies
  - **Better debugging** - Drizzle's query logging beats raw SQL
  - **Future-proof** - libSQL's Turso integration for edge deployment

### Patch Changes

- [#54](https://github.com/joelhooks/swarm-tools/pull/54) [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🧪 Integration Test Coverage: 0% → 95%

  > _"Many characterization tests look like 'sunny day' tests. They don't test many special conditions; they just verify that particular behaviors are present. From their presence, we can infer that refactoring hasn't broken anything."_
  > — Michael Feathers, _Working Effectively with Legacy Code_

  We had a bug that broke ALL swarm tools:

  ```
  Error: [streams/store] dbOverride parameter is required for this function.
  PGlite getDatabase() has been removed.
  ```

  **Why didn't tests catch it?** No integration tests exercised the full tool → store → DB path.

  **Now they do.**

  ```
  ┌─────────────────────────────────────────────────────────────────┐
  │              tool-adapter.integration.test.ts                   │
  ├─────────────────────────────────────────────────────────────────┤
  │  20 tests | 75 assertions | 1.3s                                │
  │                                                                 │
  │  ✅ swarmmail_* tools (6 tests)                                 │
  │  ✅ hive_* tools (7 tests)                                      │
  │  ✅ swarm_progress, swarm_status (2 tests)                      │
  │  ✅ swarm_broadcast, swarm_checkpoint (2 tests)                 │
  │  ✅ semantic_memory_store, semantic_memory_find (2 tests)       │
  │  ✅ Smoke test - 9 tools in sequence (1 test)                   │
  └─────────────────────────────────────────────────────────────────┘
  ```

  ### What's Tested

  Each test calls `tool.execute()` and verifies:

  1. No "dbOverride required" error (the bug symptom)
  2. Tool returns expected structure
  3. Full path works: tool → store → DB → response

  ### The Smoke Test

  Runs 9 tools in sequence to catch interaction bugs:

  ```
  swarmmail_init → hive_create → swarmmail_reserve → swarm_progress
  → semantic_memory_store → semantic_memory_find → swarmmail_send
  → hive_close → swarmmail_release
  ```

  If ANY step throws "dbOverride required", the test fails.

  ### Also Fixed

  - **Auto-adapter creation** in store.ts - functions now auto-create adapters when not provided
  - **Exported `clearAdapterCache()`** for test isolation
  - **Migrated test files** from old `getDatabase()` to adapter pattern

  ### Mandatory Coordinator Review Loop

  Added `COORDINATOR_POST_WORKER_CHECKLIST` constant and `post_completion_instructions` field to `swarm_spawn_subtask`. Coordinators now get explicit instructions to review worker output before spawning the next worker.

  The "dbOverride required" bug **cannot recur undetected**.

- [#54](https://github.com/joelhooks/swarm-tools/pull/54) [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Fix: Bare Filesystem Paths Now Work with libSQL

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  BEFORE: URL_INVALID error on bare paths                    │
  │  AFTER:  Automatic normalization to file: URLs              │
  └─────────────────────────────────────────────────────────────┘
  ```

  **The Bug:**

  ```
  Error: URL_INVALID: The URL '/Users/joel/.config/swarm-tools/swarm.db'
  is not in a valid format
  ```

  libSQL's `createClient()` requires URL-formatted paths (`file:/path/to/db.db`),
  but `getDatabasePath()` returns bare filesystem paths (`/path/to/db.db`).

  **The Fix:**
  `createLibSQLAdapter()` now normalizes bare paths automatically:

  ```typescript
  // These all work now:
  createLibSQLAdapter({ url: "/path/to/db.db" }); // → file:/path/to/db.db
  createLibSQLAdapter({ url: "./relative/db.db" }); // → file:./relative/db.db
  createLibSQLAdapter({ url: ":memory:" }); // → :memory: (unchanged)
  createLibSQLAdapter({ url: "file:/path/db.db" }); // → file:/path/db.db (unchanged)
  createLibSQLAdapter({ url: "libsql://host/db" }); // → libsql://host/db (unchanged)
  ```

  **Affected Users:**
  Anyone using `swarmmail_init` or other tools that create file-based databases
  was hitting this error. Now it just works.

- [#54](https://github.com/joelhooks/swarm-tools/pull/54) [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🧹 PGLite Exorcism Complete

  The last vestiges of PGLite runtime code have been swept away. What remains is only the migration machinery—kept for users upgrading from the old world.

  **Removed:**

  - `pglite.ts` - The `wrapPGlite()` shim that nobody was importing
  - `leader-election.ts` - PGLite-specific file locking (libSQL handles this natively)
  - Associated test files

  **Added:**

  - `pglite-remnants.regression.test.ts` - 9 tests ensuring array parameter handling works correctly in libSQL (the `IN()` vs `ANY()` saga)

  **Updated:**

  - JSDoc examples now show libSQL patterns instead of PGLite
  - Migration test inlines the `wrapPGlite` helper it needs

  **What's left of PGLite:**

  - `migrate-pglite-to-libsql.ts` - Dynamic import, only loads when migrating
  - `memory/migrate-legacy.ts` - Same pattern, migration-only
  - Comments explaining the differences (documentation, not code)

  > "The best code is no code at all." — Jeff Atwood

  The swarm flies lighter now. 🐝

## 1.2.2

### Patch Changes

- [`97e89a6`](https://github.com/joelhooks/swarm-tools/commit/97e89a6d944b70f205eeb83eb3f2c55a42f5dc08) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Setup Skips Already-Migrated Memories

  `swarm setup` now detects when semantic memories have already been migrated and skips the migration prompt entirely.

  **Before:** Setup would prompt "Migrate to swarm-mail database?" even when all memories were already migrated, then hang.

  **After:** Setup checks if target database has memories first. If already migrated, shows dim "Already migrated to swarm-mail" and moves on.

  **Changes:**

  - Added `targetHasMemories(targetDb)` function to swarm-mail
  - Updated setup flow to check target before prompting
  - Fixed connection cleanup in all code paths (try/finally pattern)
  - Suppressed internal PGLite NOTICE messages from user output

  **Root cause of hang:** PGLite connection wasn't being closed in all paths, keeping the Node.js event loop alive indefinitely.

## 1.2.1

### Patch Changes

- [`64368aa`](https://github.com/joelhooks/swarm-tools/commit/64368aa6106089346cd2b1324f6235d5c673964b) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix UNSAFE_TRANSACTION error by setting `max: 1` in socket adapter

  postgres.js requires single-connection mode (`max: 1`) when not using explicit `sql.begin()` transactions. The default of 10 connections caused transaction safety errors and hanging connections during migrations.

## 1.2.0

### Minor Changes

- [`70ff3e0`](https://github.com/joelhooks/swarm-tools/commit/70ff3e054cd1991154f7631ce078798de1076ba8) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Daemon Mode Now Self-Heals

  The daemon socket connection was fragile - it would error out instead of recovering from common scenarios like stale PID files or race conditions.

  **Changes:**

  ### 1. New Default Port: 15433

  Moved from 5433 (too close to Postgres default) to 15433. Override with `SWARM_MAIL_SOCKET_PORT`.

  ### 2. Self-Healing Connection Logic

  New flow tries connecting FIRST before starting:

  ```
  1. Health check → if healthy, connect immediately
  2. Check for stale PID → clean up if process dead
  3. Try startDaemon with retry loop
  4. On EADDRINUSE, wait and retry health check (another process may have started it)
  5. Only error after all recovery attempts fail
  ```

  ### 3. Exported `cleanupPidFile`

  Now available for external cleanup scenarios.

  **What this fixes:**

  - "Failed to listen at 127.0.0.1" errors
  - Stale PID files blocking startup
  - Race conditions when multiple processes start simultaneously
  - Daemon crashes requiring manual `pkill` intervention

  **Tests added:** 4 new tests covering self-healing scenarios.

## 1.1.1

### Patch Changes

- [`19995a6`](https://github.com/joelhooks/swarm-tools/commit/19995a68dd1283de1d13afa6fc028bd1273d1b27) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Squashed the BigInt Date Bug

  PGLite returns BIGINT columns as JavaScript `bigint` type. The `Date` constructor throws when given a bigint:

  ```javascript
  new Date(1734628445371n); // TypeError: Cannot convert a BigInt value to a number
  ```

  This caused `Invalid Date` errors in all hive operations (`hive_query`, `hive_create`, etc).

  **Fix:** Wrap timestamps in `Number()` before passing to `Date`:

  ```typescript
  // Before (broken)
  new Date(cell.created_at);

  // After (works with both number and bigint)
  new Date(Number(cell.created_at));
  ```

  **Files fixed:**

  - `swarm-mail/src/hive/jsonl.ts` - JSONL export functions
  - `opencode-swarm-plugin/src/hive.ts` - `formatCellForOutput()`

  **Tests added:** 6 new tests covering bigint date handling edge cases.

## 1.1.0

### Minor Changes

- [`39593d7`](https://github.com/joelhooks/swarm-tools/commit/39593d7ee817c683ad1877af52ad5f2ca140c4e2) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Smart ID Resolution: Git-Style Partial Hashes for Hive

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  BEFORE: hive_close(id="opencode-swarm-monorepo-lf2p4u-mjcadqq3fb9")  │
  │  AFTER:  hive_close(id="mjcadqq3fb9")                                 │
  └─────────────────────────────────────────────────────────────┘
  ```

  Cell IDs got long. Now you can use just the hash portion.

  **What changed:**

  ### swarm-mail

  - Added `resolvePartialId(adapter, partialId)` to resolve partial hashes to full cell IDs
  - Supports exact match, prefix match, suffix match, and substring match
  - Returns helpful error messages for ambiguous matches ("Found 3 cells matching 'abc': ...")
  - 36 new tests covering all resolution scenarios

  ### opencode-swarm-plugin

  - `hive_update`, `hive_close`, `hive_start` now accept partial IDs
  - Resolution happens transparently - full ID returned in response
  - Backward compatible - full IDs still work

  **JSONL Fix (bonus):**

  - `serializeToJSONL()` now adds trailing newline for POSIX compliance
  - Prevents parse errors when appending to existing files

  **Why it matters:**

  - Less typing, fewer copy-paste errors
  - Matches git's partial SHA workflow (muscle memory)
  - Ambiguous matches fail fast with actionable error messages

  > "The best interface is no interface" - Golden Krishna
  > (But if you must have one, make it forgive typos)

  ***

  ## Auto-Sync at Key Events

  ```
  ┌─────────────────────────────────────────┐
  │  hive_create_epic  →  auto-sync         │
  │  swarm_complete    →  auto-sync         │
  │  process.exit      →  safety net sync   │
  └─────────────────────────────────────────┘
  ```

  Cells no longer get lost when processes exit unexpectedly.

  **What changed:**

  - `hive_create_epic` syncs after creating epic + subtasks (workers can see them immediately)
  - `swarm_complete` syncs before worker exits (completed work persists)
  - `process.on('beforeExit')` hook catches any remaining dirty cells

  **Why it matters:**

  - Spawned workers couldn't see cells created by coordinator (race condition)
  - Worker crashes could lose completed work
  - Now the lazy-write pattern has strategic checkpoints

  ***

  ## Removed Arbitrary Subtask Limits

  ```
  BEFORE: max_subtasks capped at 10 (why tho?)
  AFTER:  no limit - LLM decides based on task complexity
  ```

  **What changed:**

  - Removed `.max(10)` from `swarm_decompose` and `swarm_plan_prompt`
  - `max_subtasks` is now optional with no default
  - Prompt says "as many as needed" instead of "2-10"

  **Why it matters:**

  - Complex epics need more than 10 subtasks
  - Arbitrary limits force awkward decomposition
  - Trust the coordinator to make good decisions

## 1.0.0

### Major Changes

- [`230e9aa`](https://github.com/joelhooks/swarm-tools/commit/230e9aa91708610183119680cb5f6924c1089552) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 The Daemon Awakens: Multi-Process Safety by Default

  PGlite is single-connection. Multiple processes = corruption. We learned this the hard way.

  **Now it just works.**

  ### What Changed

  **Daemon mode is the default.** When you call `getSwarmMail()`, we:

  1. Start an in-process `PGLiteSocketServer` (no external binary!)
  2. All connections go through this server
  3. Multiple processes? No problem. They all talk to the same daemon.

  ```typescript
  // Before: Each process creates its own PGlite → 💥 corruption
  const swarmMail = await getSwarmMail("/project");

  // After: First process starts daemon, others connect → ✅ safe
  const swarmMail = await getSwarmMail("/project");
  ```

  ### Opt-Out (if you must)

  ```bash
  # Single-process mode (embedded PGlite)
  SWARM_MAIL_SOCKET=false
  ```

  ⚠️ Only use embedded mode when you're **certain** only one process accesses the database.

  ### Bonus: 9x Faster Tests

  We added a shared test server pattern. Instead of creating a new PGlite instance per test (~500ms WASM startup), tests share one instance and TRUNCATE between runs.

  | Metric           | Before | After |
  | ---------------- | ------ | ----- |
  | adapter.test.ts  | 8.63s  | 0.96s |
  | Per-test average | 345ms  | 38ms  |

  ### Breaking Change

  If you were relying on embedded mode being the default, set `SWARM_MAIL_SOCKET=false`.

  ### The Architecture

  ```
  ┌─────────────────────────────────────────┐
  │  Process 1      Process 2      ...      │
  │      │              │                   │
  │      └──────┬───────┘                   │
  │             ▼                           │
  │   ┌───────────────────┐                 │
  │   │ PGLiteSocketServer │ (in-process)   │
  │   │      + PGlite      │                │
  │   └───────────────────┘                 │
  │             │                           │
  │             ▼                           │
  │   ┌───────────────────┐                 │
  │   │   Your Data 🍯    │                 │
  │   └───────────────────┘                 │
  └─────────────────────────────────────────┘
  ```

  No external binaries. No global installs. Just safety.

### Minor Changes

- [`181fdd5`](https://github.com/joelhooks/swarm-tools/commit/181fdd507b957ceb95e069ae71d527d3f7e1b940) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🛡️ WAL Safety: The Checkpoint That Saved the Hive

  PGlite's Write-Ahead Log nearly ate our lunch. 930 WAL files. 930MB of uncommitted transactions.
  One WASM OOM crash later, pdf-brain lost 359 documents.

  **Never again.**

  ### What Changed

  **New DatabaseAdapter methods:**

  ```typescript
  // Force WAL flush to data files
  await db.checkpoint();

  // Monitor WAL health (default 100MB threshold)
  const { healthy, message } = await db.checkWalHealth(100);

  // Get raw stats
  const { walSize, walFileCount } = await db.getWalStats();
  ```

  **Automatic checkpoints after:**

  - Hive migrations complete
  - Streams migrations complete
  - Any batch operation that touches multiple records

  **Health check integration:**

  ```typescript
  const health = await swarmMail.healthCheck();
  // { connected: true, walHealth: { healthy: true, message: "WAL healthy: 2.5MB (3 files)" } }
  ```

  ### Why It Matters

  PGlite in embedded mode accumulates WAL files without explicit CHECKPOINT calls. Each unclean shutdown compounds the problem. Eventually: OOM.

  The fix is simple but critical:

  1. **Checkpoint after batch ops** - forces WAL to data files, allows recycling
  2. **Monitor WAL size** - warn at 100MB, not 930MB
  3. **Prefer daemon mode** - single long-lived process handles its own WAL

  ### Deployment Recommendation

  **Use daemon mode in production.** Multiple short-lived PGlite instances compound WAL accumulation. A single daemon process:

  - Owns the database connection
  - Checkpoints naturally during operation
  - Cleans up properly on shutdown

  See README.md "Deployment Modes" section for details.

  ### The Lesson

  > "The database doesn't forget. It just waits."

  WAL is a feature, not a bug. But like any feature, it needs care and feeding.
  Now swarm-mail feeds it automatically.

## 0.5.0

### Minor Changes

- [`1e41c9b`](https://github.com/joelhooks/swarm-tools/commit/1e41c9b42ae468761f813d406171d182fb9948e0) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Semantic Memory Consolidation

  > _"Simplicity is the ultimate sophistication."_
  > — Leonardo da Vinci

  The semantic memory system has moved into swarm-mail, bringing persistent learning to the hive.

  ### What's New

  **Semantic Memory in swarm-mail:**

  - `createSemanticMemory()` - Initialize memory store with PGLite + Ollama embeddings
  - `getMigrationStatus()` - Check if legacy memory needs migration
  - `migrateLegacyMemory()` - Migrate from old semantic-memory-mcp format
  - Automatic migration on first use (no manual intervention needed)

  **Legacy Migration:**

  - Detects old `~/.semantic-memory/` databases
  - Migrates memories, embeddings, and metadata
  - Preserves all tags and timestamps
  - Creates backup before migration

  **Worker Handoff Protocol:**

  - Agents can now hand off work mid-task
  - State preserved via swarm mail messages
  - Enables long-running tasks across context limits

  ### Breaking Changes

  None - this is additive. The old semantic-memory-mcp still works but is deprecated.

  ### Files Added/Changed

  - `packages/swarm-mail/src/memory/` - New memory subsystem
  - `packages/swarm-mail/src/memory/migrate-legacy.ts` - Migration tooling
  - `packages/opencode-swarm-plugin/bin/swarm.ts` - Uses new exports

## 0.4.0

### Minor Changes

- [`a2ff1f4`](https://github.com/joelhooks/swarm-tools/commit/a2ff1f4257a2e9857f63abe4e9b941a573f44380) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Cell IDs Now Wear Their Project Colors

  > _"We may fantasize about being International Men of Mystery, but our code needs to be mundane and clear. One of the most important parts of clear code is good names."_
  > — Martin Fowler, _Refactoring_

  Cell IDs finally know where they came from. Instead of anonymous `bd-xxx` prefixes,
  new cells proudly display their project name: `swarm-mail-lf2p4u-abc123`.

  ### What Changed

  **swarm-mail:**

  - `generateBeadId()` now reads `package.json` name field from project directory
  - Added `slugifyProjectName()` for safe ID generation (lowercase, special chars → dashes)
  - Falls back to `cell-` prefix if no package.json or no name field

  **opencode-swarm-plugin:**

  - Removed all `bd` CLI usage from `swarm-orchestrate.ts` - now uses HiveAdapter
  - Improved compaction hook swarm detection with confidence levels (high/medium/low)
  - Added fallback detection prompt for uncertain swarm states

  ### Examples

  | Before                  | After                           |
  | ----------------------- | ------------------------------- |
  | `bd-lf2p4u-mjbneh7mqah` | `swarm-mail-lf2p4u-mjbneh7mqah` |
  | `bd-abc123-xyz`         | `my-cool-app-abc123-xyz`        |
  | (no package.json)       | `cell-abc123-xyz`               |

  ### Why It Matters

  - **Identifiable at a glance** - Know which project a cell belongs to without looking it up
  - **Multi-project workspaces** - Filter/search cells by project prefix
  - **Terminology cleanup** - Removes legacy "bead" (`bd-`) from user-facing IDs

  ### Backward Compatible

  Existing `bd-*` IDs still work fine. No migration needed - only NEW cells get project prefixes.

  ### Compaction: Keeping the Swarm Alive

  > _"Intelligent and structured group dynamics that emerge not from a leader, but from the local interactions of the elements themselves."_
  > — Daniel Shiffman, _The Nature of Code_

  The compaction hook now uses multi-signal detection to keep swarms cooking through context compression:

  - **HIGH confidence:** Active reservations, in_progress cells → full swarm context
  - **MEDIUM confidence:** Open subtasks, unclosed epics → full swarm context
  - **LOW confidence:** Any cells exist → fallback detection prompt

  Philosophy: Err on the side of continuation. A false positive costs context space. A false negative loses the swarm.

## 0.3.4

### Patch Changes

- [`90409ef`](https://github.com/joelhooks/swarm-tools/commit/90409ef4f353844b25fe04221bc80d6f930eced2) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix table name mismatches and SQL alias typo in hive module

  - jsonl.ts: Fixed DELETE queries using wrong table names (cell*\* → bead*\*)
  - projections.ts: Fixed SQL alias typo (bcc.cell_id → bbc.cell_id)

## 0.3.3

### Patch Changes

- [`ec23d25`](https://github.com/joelhooks/swarm-tools/commit/ec23d25aeca667c0294a6255fecf11dd7d7fd6b3) Thanks [@joelhooks](https://github.com/joelhooks)! - Add .beads → .hive directory migration support

  - Fix migration version collision: beadsMigration now v7, cellsViewMigration now v8 (was conflicting with streams v6)
  - Add `checkBeadsMigrationNeeded()` to detect legacy .beads directories
  - Add `migrateBeadsToHive()` to rename .beads to .hive
  - Add `ensureHiveDirectory()` to create .hive if missing (called by hive_sync)
  - Update hive_sync to ensure .hive directory exists before writing
  - Add migration prompt to `swarm setup` CLI flow

## 0.3.2

### Patch Changes

- [`50a2bf5`](https://github.com/joelhooks/swarm-tools/commit/50a2bf51c5320c038f202191d7acbfd2179f2cb3) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix cells view migration not being applied

  The v7 migration (cellsViewMigration) that creates the `cells` view was added after
  swarm-mail@0.3.0 was published. This caused `hive_sync` to fail with
  "relation cells does not exist" because the JSONL export queries the `cells` view.

  This patch ensures the v7 migration is included in the published package.

## 0.3.0

### Minor Changes

- [`26fd2ef`](https://github.com/joelhooks/swarm-tools/commit/26fd2ef27562edc39f7db7a9cdbed399a465200d) Thanks [@joelhooks](https://github.com/joelhooks)! - Rename beads → hive across the codebase

  - `createBeadsAdapter` → `createHiveAdapter` (old name still exported as alias)
  - `BeadsAdapter` type → `HiveAdapter` type
  - All internal references updated to use hive terminology
  - Backward compatible: old exports still work but are deprecated

## 0.2.1

### Patch Changes

- [`b2d4a84`](https://github.com/joelhooks/swarm-tools/commit/b2d4a84748cdef4b9dbca7666dd3d313b6cd2b24) Thanks [@joelhooks](https://github.com/joelhooks)! - Add automatic JSONL migration for beads on first use

  - Auto-migrate from `.beads/issues.jsonl` when database is empty
  - Fix import to handle missing dependencies/labels/comments arrays
  - Fix closed bead import to satisfy check constraint (status + closed_at)
  - Migrates 500+ historical beads seamlessly on first adapter initialization

## 0.2.0

### Minor Changes

- [`1a7b02f`](https://github.com/joelhooks/swarm-tools/commit/1a7b02f707a1490f14465467c6024331d5064878) Thanks [@joelhooks](https://github.com/joelhooks)! - Add PGLite socket server adapter with hybrid daemon management and move streams storage to $TMPDIR.

  **Socket Server Adapter:**

  - New `createSocketAdapter()` wrapping postgres.js for DatabaseAdapter interface
  - Daemon lifecycle: `startDaemon()`, `stopDaemon()`, `isDaemonRunning()`, `healthCheck()`
  - Auto-start daemon on first use with `SWARM_MAIL_SOCKET=true` env var
  - Graceful fallback to embedded PGLite on failure
  - CLI: `swarm-mail-daemon start|stop|status`

  **$TMPDIR Storage (BREAKING):**

  - Streams now stored in `$TMPDIR/opencode-<project-name>-<hash>/streams`
  - Eliminates git pollution from `.opencode/streams/`
  - Auto-cleaned on reboot (ephemeral coordination state)
  - New exports: `getProjectTempDirName()`, `hashProjectPath()`

  This fixes the multi-agent PGLite corruption issue by having all agents connect to a single pglite-server daemon via PostgreSQL wire protocol.

## 0.1.4

### Patch Changes

- [`7471fd4`](https://github.com/joelhooks/swarm-tools/commit/7471fd43ef9b16b32e503d7cd4bdc5b7a74537e4) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm_complete tool execution failures and remove debug logging

  **opencode-swarm-plugin:**

  - Fix: Made sendSwarmMessage non-fatal in swarm_complete - failures no longer cause "Tool execution failed" errors
  - Fix: Added message_sent and message_error fields to swarm_complete response for better error visibility
  - Chore: Removed console.log statements from index.ts, swarm-orchestrate.ts, storage.ts, rate-limiter.ts
  - Test: Added integration tests for swarm_complete error handling

  **swarm-mail:**

  - Chore: Cleaned up debug logging and improved migration handling

## 0.1.3

### Patch Changes

- [`22befbf`](https://github.com/joelhooks/opencode-swarm-plugin/commit/22befbfa120a37a585cfec0709597172efda92a4) Thanks [@joelhooks](https://github.com/joelhooks)! - fix: mark @electric-sql/pglite as external in build to fix WASM file resolution

  PGLite requires its WASM data file (pglite.data) at runtime. When bundled into swarm-mail, the path resolution broke because it looked for the file relative to the bundle location instead of the installed @electric-sql/pglite package location.

  This caused "ENOENT: no such file or directory" errors when initializing the database.

## 0.1.2

### Patch Changes

- [`2d0fe9f`](https://github.com/joelhooks/opencode-swarm-plugin/commit/2d0fe9fc6278874ea6c4a92f0395cbdd11c4e994) Thanks [@joelhooks](https://github.com/joelhooks)! - Add repository field for npm provenance verification and ASCII art README

  - Add repository, author, license fields to package.json (required for npm provenance)
  - Add sick ASCII art banner to README

## 0.1.1

### Patch Changes

- [`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm-mail package to include dist folder

  - Add files field to swarm-mail package.json to explicitly include dist/
  - Previous publish was missing build output, causing "Cannot find module" errors
