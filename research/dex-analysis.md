# Dex Analysis: Ideas to Steal for Swarm-Tools

**Date:** 2025-07-13  
**Repo:** https://github.com/dcramer/dex  
**Author:** David Cramer (Sentry co-founder)  
**Version analyzed:** 0.2.0

---

## 1. Architecture Overview of Dex

Dex is a **task tracking system designed for AI agents**, specifically targeting Claude Code as the primary consumer. It positions tasks as "tickets, not todos" — structured artifacts with full context (description, context, result) akin to GitHub Issues + PR descriptions combined.

### Core Architecture

```
src/
├── index.ts           # Entry: routes to CLI or MCP server
├── types.ts           # Zod schemas (Task, CreateTaskInput, etc.)
├── errors.ts          # Custom error hierarchy (DexError → NotFoundError, ValidationError, etc.)
├── core/
│   ├── task-service.ts       # Business logic (CRUD, blocking, hierarchy)
│   ├── storage.ts            # File storage (one .json file per task)
│   ├── storage-engine.ts     # Storage interface (sync + async)
│   ├── config.ts             # TOML config (global + per-project)
│   ├── github-sync.ts        # One-way sync to GitHub Issues
│   ├── github-issues-storage.ts  # GitHub Issues as storage backend
│   ├── subtask-markdown.ts   # Embed subtasks as markdown in issue body
│   ├── plan-parser.ts        # Parse markdown plans into tasks
│   ├── sync-state.ts         # Track last sync timestamp
│   └── git-remote.ts         # Parse GitHub remote from git
├── tools/
│   ├── create-task.ts        # MCP tool handler
│   ├── update-task.ts        # MCP tool handler
│   ├── list-tasks.ts         # MCP tool handler
│   └── response.ts           # MCP response formatting
├── mcp/
│   └── server.ts             # MCP server (3 tools only)
├── cli/
│   ├── index.ts              # CLI router (create, list, show, edit, complete, delete, plan, sync, etc.)
│   ├── status.ts             # Dashboard view (the default command)
│   ├── doctor.ts             # Self-diagnosis and repair
│   └── ...                   # Individual command files
└── plugins/
    └── dex/skills/           # Claude Code skill definitions (SKILL.md files)
```

### Key Design Decisions

1. **Single binary, dual mode:** Same `dex` binary serves as CLI and MCP server (`dex mcp`). No separate packages.
2. **One file per task:** `.dex/tasks/{id}.json` — enables git-friendly diffs, no merge conflicts.
3. **3-level hierarchy max:** Epic → Task → Subtask. Enforced at creation time.
4. **Bidirectional relationships:** `parent_id`/`children[]`, `blockedBy[]`/`blocks[]` — always kept in sync.
5. **GitHub sync as enhancement, not storage:** File system is source of truth. GitHub Issues are a one-way sync target.
6. **TOML configuration:** Global (`~/.config/dex/dex.toml`) + per-project (`.dex/config.toml`), layered merge.
7. **Only 3 MCP tools:** `create_task`, `update_task`, `list_tasks` — deliberately minimal API surface.

### Data Model

```typescript
interface Task {
  id: string;              // nanoid, 8 chars
  parent_id: string | null;
  description: string;     // One-line summary (like issue title)
  context: string;         // Full background (like issue body)
  priority: number;        // Lower = higher priority
  completed: boolean;
  result: string | null;   // Implementation summary (like PR description)
  metadata: {
    commit?: { sha, message, branch, url, timestamp };
    github?: { issueNumber, issueUrl, repo, state };
  } | null;
  blockedBy: string[];     // Task IDs that block this
  blocks: string[];        // Task IDs this blocks
  children: string[];      // Child task IDs
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
```

---

## 2. Feature Comparison

### Task/Work Item Management

| Feature | Dex | Our Swarm-Tools |
|---------|-----|-----------------|
| **Task types** | Generic (no type field) | task, bug, feature, epic, chore |
| **Hierarchy** | 3-level max (epic→task→subtask) | parent_id with epics |
| **Blocking** | Bidirectional (`blockedBy`/`blocks`) with cycle detection | Dependencies via `blocked_by` array |
| **Priority** | Numeric (lower=higher) | Numeric (lower=higher) |
| **Status** | Boolean `completed` | open, in_progress, blocked, closed |
| **Context model** | description + context + result (3 fields) | title + description |
| **Storage** | One JSON file per task | SQLite (Drizzle + libSQL) |
| **Task IDs** | nanoid 8-char | UUID-like |
| **Commit linking** | Built-in metadata field | Not built-in |
| **GitHub sync** | Native (Issues sync) | Not built-in |

### Agent Coordination

| Feature | Dex | Our Swarm-Tools |
|---------|-----|-----------------|
| **Multi-agent messaging** | ❌ None | ✅ SwarmMail (inbox, send, file reservations) |
| **File locking** | ❌ None | ✅ File reservations with TTL |
| **Agent spawning** | ❌ None | ✅ Swarm decompose → spawn → review → complete |
| **Review workflow** | ❌ None | ✅ swarm_review + swarm_review_feedback |
| **Progress tracking** | ❌ None | ✅ swarm_progress with percentage |

### Memory / Context

| Feature | Dex | Our Swarm-Tools |
|---------|-----|-----------------|
| **Semantic memory** | ❌ None | ✅ Hivemind (embeddings, decay, validation) |
| **Full-text search** | Basic string matching in list | ✅ FTS + semantic search |
| **Context persistence** | Task `context` + `result` fields | Memory store + session handoffs |
| **Session management** | ❌ None | ✅ Session start/end/status |
| **Analytics** | ❌ None | ✅ Task duration, agent activity, strategy success rates |

### Planning / Decomposition

| Feature | Dex | Our Swarm-Tools |
|---------|-----|-----------------|
| **Plan parsing** | Markdown file → task (with auto-subtask extraction) | ❌ Manual decomposition |
| **Decomposition strategy** | Agent-driven via SKILL.md guidance | file-based, feature-based, risk-based |
| **Validation** | ❌ None | ✅ swarm_validate_decomposition (file conflicts, deps) |

### CLI / UX

| Feature | Dex | Our Swarm-Tools |
|---------|-----|-----------------|
| **Default command** | `dex` → status dashboard | `swarm cells` |
| **Tree display** | ✅ Beautiful tree with connectors | ❌ Flat list |
| **Status dashboard** | ✅ % complete, ready count, blocked count, sections | ❌ None |
| **Doctor command** | ✅ Diagnoses + auto-fixes config/data issues | `swarm doctor` (basic health) |
| **Shell completion** | ✅ bash, zsh, fish | ❌ None |
| **JSON output** | ✅ `--json` flag on every command | ❌ Not consistent |
| **Breadcrumbs** | ✅ Path: Epic → Task → Subtask | ❌ None |
| **Color/formatting** | ✅ Rich terminal output with colors | Basic |
| **MCP tools** | 3 tools (minimal) | 30+ tools (complex) |
| **Fuzzy command matching** | ✅ "Did you mean X?" | ❌ None |

---

## 3. Ideas to Steal (Prioritized)

### 🔴 Priority 1: High Impact, Moderate Effort

#### 3.1 Three-Field Context Model (description + context + result)

**What they do:** Every task has three distinct text fields:
- `description` — one-line summary (like an issue title)  
- `context` — full background, requirements, approach (like an issue body)
- `result` — implementation summary, decisions, outcomes (like a PR description)

**Why steal it:** Our cells have `title` + `description`, which is the same as their `description` + `context`. But we're **missing the `result` field**. When a task is completed, the outcome/implementation details just... vanish. There's no structured place to record what was actually done, what decisions were made, or what trade-offs were considered.

**How to adapt:**
```typescript
// Add to cell schema
result: text('result'),           // Implementation summary when completed
result_at: text('result_at'),     // When result was recorded

// Require result when closing
hive_close({ id, reason, result }) // reason = why, result = what was done
```

This is especially powerful for swarm coordination — when a worker completes a task, the coordinator can read the `result` to understand what actually happened before reviewing.

#### 3.2 Status Dashboard as Default Command

**What they do:** Running `dex` with no arguments shows a beautiful dashboard:
```
  ___  ___ __  __
 |   \| __|\ \/ /
 | |) | _|  >  <
 |___/|___|/_/\_\

  75%      3      1
complete  ready  blocked

Ready to Work (3)
────────────────────
[ ] abc123: Implement JWT middleware
[ ] def456: Add password reset flow
└── [ ] ghi789: Create email templates

Blocked (1)
────────────────────
[ ] jkl012: Deploy to production [B: abc123]

Recently Completed
────────────────────
[x] mno345: Setup database schema
```

**Why steal it:** Our `swarm cells` gives a flat list. A dashboard with categorized sections (ready, blocked, recently completed) with percentage complete is **dramatically more useful** for understanding project state at a glance.

**How to adapt:**
```bash
# Make `swarm` with no args show dashboard
swarm                    # → dashboard
swarm cells              # → existing list
swarm cells --ready      # → ready tasks only
```

The dashboard should show:
- Progress percentage (completed/total)
- Ready tasks (unblocked, highest priority first)
- Blocked tasks (with blocker info)
- Recently completed (last 5)
- Active agents (from swarmmail)

#### 3.3 Doctor Command with Auto-Fix

**What they do:** `dex doctor` checks:
- Config validity (TOML parsing)
- Missing config fields
- Deprecated settings
- Task file validity (JSON, schema conformance)
- Relationship consistency (parent/child, blockers, bidirectional sync)
- Orphaned references
- Depth violations
- Circular references

Each issue has an optional `fix` function. Running `dex doctor --fix` auto-repairs.

**Why steal it:** Our system has SQLite with event sourcing, Drizzle schemas, dependency graphs — **way more things that can go wrong**. A doctor command that verifies data integrity and auto-fixes issues would be invaluable.

**How to adapt:**
```typescript
// Checks to implement:
// 1. Database integrity (SQLite pragma integrity_check)
// 2. Orphaned cells (parent_id references non-existent cell)
// 3. Dependency cycles
// 4. Stale reservations (TTL expired but not cleaned)
// 5. Memory embedding consistency (entries without embeddings)
// 6. Event log consistency (projections match events)
// 7. Blocked cells with completed blockers (should be unblocked)
// 8. In-progress cells with no active agent session

swarm doctor              # Check only
swarm doctor --fix        # Auto-repair
swarm doctor --json       # Machine-readable output
```

#### 3.4 Commit Linking on Task Completion

**What they do:** When completing a task, you can link the git commit:
```bash
dex complete abc123 --result "Implemented feature" --commit a1b2c3d
```

This auto-captures: SHA, commit message, branch, URL, timestamp. The metadata is stored in the task and displayed in `dex show`.

**Why steal it:** When a swarm worker completes a task, knowing which commit(s) were produced is invaluable for the review step. Currently we have `files_touched` in `swarm_complete`, but no commit linkage.

**How to adapt:**
```typescript
// In swarm_complete tool:
swarm_complete({
  ...existing_fields,
  commit_sha: string,     // Git commit SHA
  commit_branch: string,  // Branch name
})

// Auto-capture from git
function getCommitInfo(sha: string) {
  const message = execSync(`git log -1 --format=%B ${sha}`).trim();
  const branch = execSync(`git rev-parse --abbrev-ref HEAD`).trim();
  return { sha, message, branch };
}
```

### 🟡 Priority 2: Medium Impact, Lower Effort

#### 3.5 Bidirectional Relationship Sync

**What they do:** Every relationship is kept bidirectional:
- Setting `child.parent_id = X` → adds child to `X.children[]`
- Adding `blockedBy: [Y]` → adds to `Y.blocks[]`
- Deleting a task → cleans up all references in other tasks
- Cycle detection for both parent hierarchy and blocking chains

**Why steal it:** Our dependency system stores `blocked_by` on cells but may not maintain the inverse consistently. Bidirectional sync means you can always answer "what does this task block?" without scanning all cells.

**How to adapt:** We already have some of this in our hive dependencies, but we should verify:
1. When adding a dependency, the inverse is always recorded
2. When closing/deleting a cell, all references are cleaned up
3. Cycle detection prevents circular dependencies

#### 3.6 Tree Display for Task Hierarchy

**What they do:** `dex list` renders tasks as a tree:
```
[ ] abc123: Add authentication system
├── [ ] def456: Implement JWT middleware
│   └── [ ] ghi789: Add token verification
├── [x] jkl012: Setup database schema
└── [ ] mno345: Add password reset flow [B: def456]
```

With proper connectors (`├──`, `└──`, `│`), truncated descriptions, blocked indicators, and priority coloring.

**Why steal it:** Our `swarm cells` output is flat. For epics with subtasks, tree display makes the structure immediately visible.

**How to adapt:**
```typescript
// In swarm tree (we already have this command)
// Improve to match dex's formatting:
function printTree(cells: Cell[], parentId: string | null, prefix = '') {
  const children = cells.filter(c => c.parent_id === parentId)
    .sort((a, b) => a.priority - b.priority);
  
  children.forEach((cell, i) => {
    const isLast = i === children.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const status = cell.status === 'closed' ? '[x]' : '[ ]';
    const blocked = isBlocked(cell) ? ` [B: ${cell.blocked_by.join(',')}]` : '';
    console.log(`${prefix}${connector}${status} ${cell.id.slice(0,8)}: ${cell.title}${blocked}`);
    printTree(cells, cell.id, prefix + (isLast ? '    ' : '│   '));
  });
}
```

#### 3.7 Plan-to-Task Parsing from Markdown

**What they do:** `dex plan <file.md>` reads a markdown file, extracts the title from the first `#` heading, and creates a task with the full markdown as context. Their SKILL.md then guides the agent to auto-decompose into subtasks.

**Why steal it:** We have `swarm_decompose` and `swarm_plan_prompt` for planning, but no way to ingest an existing markdown plan document. The pattern of "here's a plan file → create an epic with subtasks" is useful.

**How to adapt:**
```bash
# New command
swarm plan <markdown-file>

# Behavior:
# 1. Parse markdown, extract title from first # heading
# 2. Create epic with full markdown as description
# 3. Analyze structure for decomposition
# 4. Auto-create subtasks from numbered lists / sections
# 5. Return epic ID + subtask IDs
```

#### 3.8 Minimal MCP Tool Surface

**What they do:** Only 3 MCP tools: `create_task`, `update_task`, `list_tasks`. Everything else is in the CLI or handled by `update_task` (which can also delete via a flag).

**Why steal it:** We have 30+ MCP tools. While our system is more complex, the tool count creates cognitive overhead for the LLM. Dex's approach of having `update_task` handle completion, deletion, and field updates via a single tool is elegant.

**How to adapt:** We probably can't collapse to 3 tools given our feature set, but we could:
1. Consolidate `hive_create` + `hive_create_epic` → single `hive_create` with optional subtasks
2. Merge `hive_update` + `hive_close` → single `hive_update` with status field
3. Make `hive_cells` + `hive_query` + `hive_ready` → single `hive_query` with flags
4. Target: reduce from 30+ to ~15-20 tools

### 🟢 Priority 3: Nice to Have

#### 3.9 Structured Error Hierarchy

**What they do:** Clean error class hierarchy:
```typescript
DexError (base)
├── NotFoundError      // resourceType + resourceId + suggestion
├── ValidationError    // message + suggestion
├── StorageError       // cause + suggestion
└── DataCorruptionError // filePath + cause + details
```

Every error includes a user-friendly `suggestion` field ("Run 'dex list --all' to see all available tasks").

**Why steal it:** Errors with actionable suggestions are dramatically more useful, especially for LLM consumers who can act on suggestions immediately.

#### 3.10 One-File-Per-Task Storage Pattern

**What they do:** Each task is a separate `.dex/tasks/{id}.json` file. Benefits:
- Git-friendly (each change is one file)
- No merge conflicts
- Easy to inspect/debug
- No index file to corrupt

**Why steal it (partially):** We use SQLite which is better for our needs (queries, embeddings, event sourcing). But we could adopt a **JSON export/import** format that uses one-file-per-cell for:
- Git-trackable project state (`.swarm/cells/*.json` checked into repo)
- Easy debugging/inspection
- Portability between machines

#### 3.11 GitHub Issues Sync

**What they do:** One-way sync from file storage to GitHub Issues. Tasks become issues, subtasks are embedded as collapsible `<details>` blocks in the parent issue body. Supports sync-on-push (only closes issues when completion is pushed to remote).

**Why steal it:** GitHub Issues integration would give visibility to non-agent stakeholders. The pattern of embedding subtasks in the parent issue body (rather than creating separate issues) is clever and avoids clutter.

#### 3.12 Shell Completion

**What they do:** `dex completion bash/zsh/fish` outputs completion scripts.

**Why steal it:** Quality of life for CLI users. Our `swarm` CLI would benefit from tab completion.

#### 3.13 "Did You Mean?" Fuzzy Command Matching

**What they do:** `dex creat` → `Did you mean "create"?` using Levenshtein distance.

**Why steal it:** Small touch, big UX improvement.

#### 3.14 `--json` Output on Every Command

**What they do:** Every CLI command supports `--json` for machine-readable output.

**Why steal it:** Essential for scripting and integration. Our CLI should consistently support this.

#### 3.15 SKILL.md Agent Guidance Pattern

**What they do:** Rather than encoding all workflow logic in tools, they write detailed SKILL.md files that guide the agent through proper task management practices. The SKILL.md for `dex` is essentially a "how to be a good project manager" guide — when to create subtasks, how to write good context, verification requirements.

**Why steal it:** This is a **prompt engineering approach to agent quality**. Instead of trying to enforce good behavior through tool validation, they teach the agent good practices through documentation. We could create similar skill docs for our swarm workflow.

---

## 4. Implementation Notes

### Quick Wins (< 1 day each)

1. **Add `result` field to cells** — Schema migration + update `hive_close` to accept result
2. **Add `--json` to all CLI commands** — Consistent output formatting
3. **Fuzzy command matching** — Levenshtein distance on unknown commands
4. **Commit linking** — Add `commit_sha`, `commit_branch` to `swarm_complete`

### Medium Effort (1-3 days each)

5. **Status dashboard** — New `swarm` default command with categorized sections
6. **Doctor command upgrade** — Comprehensive checks + auto-fix
7. **Tree display** — Improve `swarm tree` with proper connectors and formatting
8. **Plan import** — `swarm plan <file.md>` for markdown plan ingestion
9. **Tool consolidation** — Reduce MCP tool count by merging related tools

### Larger Efforts (3+ days)

10. **GitHub Issues sync** — One-way sync for visibility
11. **JSON export format** — One-file-per-cell export for git tracking
12. **SKILL.md system** — Agent guidance documentation

### Key Architectural Differences to Respect

1. **We're event-sourced, they're not.** Our SQLite + event log approach is more robust for multi-agent scenarios. Don't adopt their file-per-task storage as primary — it doesn't support concurrent writes well.

2. **We have multi-agent, they don't.** Dex is single-agent focused. Our swarmmail, file reservations, and coordination primitives are genuinely needed and don't have equivalents in dex.

3. **We have semantic memory, they don't.** Hivemind with embeddings, decay, and validation is a significant advantage. Nothing to steal here — they have nothing comparable.

4. **Our complexity is justified.** Dex is deliberately simple (3 MCP tools). Our 30+ tools serve a more complex orchestration workflow. The goal isn't to match their simplicity, but to clean up our API surface where tools overlap.

---

## 5. Summary

Dex is a well-designed, focused tool that does task tracking for single agents extremely well. Its strengths are:

- **Opinionated simplicity** — 3 tools, 3 task levels, 3 text fields
- **Beautiful CLI UX** — dashboard, tree views, doctor, breadcrumbs
- **Git-first storage** — one file per task, merge-conflict-free
- **GitHub integration** — native sync to Issues
- **Agent-aware documentation** — SKILL.md as prompt engineering

Our swarm-tools system is significantly more capable in agent coordination, semantic memory, and multi-agent orchestration. The main things to steal are:

1. **The `result` field** — capturing implementation outcomes
2. **The dashboard UX** — status at a glance
3. **The doctor pattern** — self-diagnosis and repair
4. **The tree display** — visual hierarchy
5. **Commit linking** — traceability
6. **Tool consolidation** — reduce cognitive overhead

None of these require architectural changes to our system — they're additive improvements to our existing foundation.
