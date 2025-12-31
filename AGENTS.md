# Monorepo Guide: Bun + Turborepo

## CRITICAL: Plugin Wrapper Must Be Self-Contained

**The plugin wrapper at `~/.config/opencode/plugin/swarm.ts` must have ZERO imports from `opencode-swarm-plugin`.**

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   ❌ NEVER DO THIS IN THE PLUGIN WRAPPER:                                 ║
║                                                                           ║
║   import { anything } from "opencode-swarm-plugin";  // BREAKS OPENCODE   ║
║   import { stuff } from "swarm-mail";                // BREAKS OPENCODE   ║
║                                                                           ║
║   ✅ ONLY THESE IMPORTS ARE SAFE:                                         ║
║                                                                           ║
║   import { ... } from "@opencode-ai/plugin";  // Provided by OpenCode     ║
║   import { ... } from "@opencode-ai/sdk";     // Provided by OpenCode     ║
║   import { ... } from "node:*";               // Node.js builtins         ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

**Why?** The npm package has transitive dependencies (`evalite`, etc.) that aren't available in OpenCode's plugin context. Importing causes: `Cannot find module 'evalite/runner'` → trace trap → OpenCode crash.

**Pattern: Plugin wrapper is DUMB, CLI is SMART.**
- **Wrapper:** Thin shell, no logic, just bridges to `swarm` CLI via `spawn()`
- **CLI:** All the smarts, all the deps, runs in its own Node.js context

**If you need logic in the wrapper:** INLINE IT. Copy the code directly into the template. See the `// Swarm Signature Detection (INLINED)` section for an example of ~250 lines of inlined logic.

**Template location:** `packages/opencode-swarm-plugin/examples/plugin-wrapper-template.ts`

---

## CRITICAL: No `bd` CLI Commands

**NEVER use `bd` CLI commands in code.** The `bd` CLI is deprecated and should not be called via `Bun.$` or any shell execution.

Instead, use the **HiveAdapter** from `swarm-mail` package:

```typescript
import { createHiveAdapter } from "swarm-mail";

const adapter = await createHiveAdapter({ projectPath: "/path/to/project" });

// Query cells
const cells = await adapter.queryCells({ status: "open" });

// Create cell
const cell = await adapter.createCell({ title: "Task", type: "task" });

// Update cell
await adapter.updateCell(cellId, { description: "Updated" });

// Close cell
await adapter.closeCell(cellId, "Done");
```

**Why?** The `bd` CLI requires a separate installation and isn't available in all environments. The HiveAdapter provides the same functionality programmatically with proper TypeScript types.

---

## CRITICAL: Single Global Database Architecture

**All swarm data lives in ONE database: `~/.config/swarm-tools/swarm.db`**

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   ✅ GLOBAL DATABASE (the only one):                                      ║
║      ~/.config/swarm-tools/swarm.db                                       ║
║                                                                           ║
║   ❌ LOCAL DATABASES (banned, auto-migrated):                             ║
║      .opencode/swarm.db                                                   ║
║      .hive/swarm-mail.db                                                  ║
║      packages/*/.opencode/swarm.db                                        ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### Why Single Database?

1. **No stray data** - All events, beads, messages in one place
2. **Cross-project visibility** - `swarm stats` shows everything
3. **Simpler debugging** - One database to inspect
4. **No migration headaches** - Data doesn't get lost in project-local DBs

### Runtime Guard

The `getOrCreateAdapter()` function in `swarm-mail` has a runtime guard that throws if code attempts to create a non-global database:

```typescript
// This will THROW:
const adapter = await createLibSQLAdapter({ url: "file:./local.db" });

// This is CORRECT (uses global path automatically):
const swarmMail = await getSwarmMailLibSQL();
```

### Auto-Migration

When `swarm setup` runs, it:
1. Detects stray databases in `.opencode/`, `.hive/`, `packages/*/`
2. Migrates unique data to global database (INSERT OR IGNORE)
3. Renames strays to `*.db.migrated` to prevent re-migration

### For Tests Only

Tests can use in-memory databases:

```typescript
// ✅ CORRECT for tests
const swarmMail = await createInMemorySwarmMailLibSQL("test-123");

// ❌ WRONG - don't create file-based test DBs
const adapter = await createLibSQLAdapter({ url: "file:./test.db" });
```

### Audit Report

See `.hive/analysis/stray-database-audit.md` for the full audit of database paths in the codebase.

---

## Prime Directive: TDD Everything

**All code changes MUST follow Test-Driven Development:**

1. **Red** - Write a failing test first
2. **Green** - Write minimal code to make it pass
3. **Refactor** - Clean up while tests stay green

**No exceptions.** If you're touching code, you're touching tests first.

- New feature? Write the test that describes the behavior.
- Bug fix? Write the test that reproduces the bug.
- Refactor? Ensure existing tests cover the behavior before changing.

Run tests continuously: `bun turbo test --filter=<package>`

## Testing Strategy: Speed Matters

Slow tests don't get run. Fast tests catch bugs early.

### Test Tiers

| Tier | Suffix | Speed | Dependencies | When to Run |
|------|--------|-------|--------------|-------------|
| Unit | `.test.ts` | <100ms | None | Every save |
| Integration | `.integration.test.ts` | <5s | libSQL, filesystem | Pre-commit |
| E2E | `.e2e.test.ts` | <30s | External services | CI only |

### Rules for Fast Tests

1. **Prefer in-memory databases** - Use `createInMemorySwarmMail()` over file-based libSQL
2. **Share instances when possible** - Use `beforeAll`/`afterAll` for expensive setup, not `beforeEach`/`afterEach`
3. **Don't skip tests** - If a test needs external services, mock them or make them optional
4. **Clean up after yourself** - But don't recreate the world for each test

### libSQL Testing Pattern

```typescript
// GOOD: Shared instance for related tests
describe("feature X", () => {
  let swarmMail: SwarmMailAdapter;
  
  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMail("test");
  });
  
  afterAll(async () => {
    await swarmMail.close();
  });
  
  test("does thing A", async () => { /* uses swarmMail */ });
  test("does thing B", async () => { /* uses swarmMail */ });
});

// BAD: New instance per test (slow, wasteful)
beforeEach(async () => {
  swarmMail = await createInMemorySwarmMail("test");
});
```

**Note:** We use libSQL (SQLite-compatible) for all database operations. PGLite is only used for migration from legacy databases.

### Anti-Patterns to Avoid

- Creating new database instances per test
- `test.skip()` without a tracking issue
- Tests that pass by accident (no assertions)
- Tests that only run in CI

See `TEST-STATUS.md` for full testing documentation.

## Structure

```
opencode-swarm-plugin/
├── package.json              # Workspace root (NO dependencies here)
├── turbo.json                # Pipeline configuration
├── bun.lock                  # Single lockfile for all packages
├── packages/
│   ├── swarm-mail/           # Event sourcing primitives
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   └── opencode-swarm-plugin/ # Main plugin
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
```

## Critical Rules

### Root package.json - NO DEPENDENCIES

The root `package.json` is **workspace-only**. Per bun docs, it should NOT contain `dependencies` or `devDependencies`:

```json
{
  "name": "opencode-swarm-monorepo",
  "private": true,
  "packageManager": "bun@1.3.4",
  "workspaces": ["packages/*"]
}
```

**Why?** Each package is self-contained. Root deps cause hoisting confusion and version conflicts.

### packageManager Field - REQUIRED for Turborepo

Turborepo requires `packageManager` in root `package.json`:

```json
{
  "packageManager": "bun@1.3.4"
}
```

Without this, `turbo` fails with: `Could not resolve workspaces. Missing packageManager field`

### Workspace Dependencies

Reference sibling packages with `workspace:*`:

```json
{
  "dependencies": {
    "swarm-mail": "workspace:*"
  }
}
```

After adding, run `bun install` from root to link.

## Commands

```bash
# Install all workspace dependencies
bun install

# Build all packages (respects dependency order)
bun turbo build

# Build specific package
bun turbo build --filter=swarm-mail

# Test all packages
bun turbo test

# Typecheck all packages
bun turbo typecheck

# Run command in specific package
bun --filter=opencode-swarm-plugin test

# Add dependency to specific package
cd packages/swarm-mail && bun add zod
```

## turbo.json Configuration

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

**Key points:**

- `^build` means "build dependencies first" (topological order)
- `outputs` enables caching - turbo skips if inputs unchanged
- Tasks without `dependsOn` run in parallel

## Package Scripts

Each package needs its own scripts in `package.json`:

```json
{
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target node && tsc",
    "test": "bun test src/",
    "typecheck": "tsc --noEmit"
  }
}
```

## Adding a New Package

```bash
# 1. Create directory
mkdir -p packages/new-package/src

# 2. Create package.json
cat > packages/new-package/package.json << 'EOF'
{
  "name": "new-package",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target node && tsc",
    "test": "bun test src/",
    "typecheck": "tsc --noEmit"
  }
}
EOF

# 3. Create tsconfig.json
cat > packages/new-package/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
EOF

# 4. Link workspaces
bun install

# 5. Verify
bun turbo build --filter=new-package
```

## Common Issues

### "Cannot find module 'sibling-package'"

Run `bun install` from root to link workspaces.

### Turbo cache not invalidating

```bash
# Clear turbo cache
rm -rf .turbo/cache

# Or force rebuild
bun turbo build --force
```

### Type errors across packages

Ensure `dependsOn: ["^build"]` in turbo.json so types are generated before dependent packages typecheck.

### PGLite/WASM issues in tests

PGLite may fail to initialize in parallel test runs. Tests fall back to in-memory mode automatically - this is expected behavior, not an error.

**Note:** PGLite is deprecated. New code should use libSQL via `createInMemorySwarmMail()` or `getSwarmMailLibSQL()`.

## Naming Convention: The Hive Metaphor 🐝

We use bee/hive metaphors consistently across the project. This isn't just branding - it's a mental model for multi-agent coordination.

| Concept | Name | Metaphor |
|---------|------|----------|
| Work items (issues/tasks) | **Hive** | Honeycomb cells where work lives |
| Individual work item | **Cell** | Single unit of work in the hive |
| Agent coordination | **Swarm** | Bees working together |
| Inter-agent messaging | **Swarm Mail** | Bees communicating via dance/pheromones |
| Parallel workers | **Workers** | Worker bees |
| Task orchestrator | **Coordinator** | Queen directing the swarm |
| File locks | **Reservations** | Bees claiming cells |
| Checkpoints | **Nectar** | Progress stored for later |

**Naming rules:**
- New features should fit the hive/swarm metaphor when possible
- Avoid generic names (tasks, issues, tickets) - use the domain language
- CLI commands: `swarm`, `hive` (not `beads`, `tasks`)
- Tool prefixes: `hive_*`, `swarm_*`, `swarmmail_*`

**Why bees?**
- Swarms are decentralized but coordinated
- Worker bees are autonomous but follow protocols
- The hive is the shared state (event log)
- Waggle dance = message passing
- Honey = accumulated value from work

## Packages in This Repo

### swarm-mail

Event sourcing primitives for multi-agent coordination:

- `EventStore` - append-only event log with libSQL
- `Projections` - materialized views (agents, messages, reservations)
- Effect-TS durable primitives (mailbox, cursor, lock, deferred)
- `DatabaseAdapter` interface for dependency injection
- **Hive** - git-synced work item tracking (formerly "beads")

**Database:** Uses libSQL (SQLite-compatible) as the primary database. PGLite support exists only for migrating legacy databases.

### opencode-swarm-plugin

OpenCode plugin providing:

- **Hive integration** (work item tracking, epics, dependencies)
- Swarm coordination (task decomposition, parallel agents)
- Swarm Mail (inter-agent messaging)
- Learning system (pattern maturity, anti-pattern detection)
- Skills system (knowledge injection)

## Project Skills

Skills live in `.opencode/skills/` and provide reusable knowledge for agents.

### pr-triage

Context-efficient PR comment handling. **Evaluate → Decide → Act.** Fix important issues, resolve the rest silently.

**Location:** `.opencode/skills/pr-triage/`

**Philosophy:** Replies are SECONDARY to addressing concerns. Don't reply to every comment - that's noise.

| Comment Type | Action | Reply? |
|--------------|--------|--------|
| Security/correctness bug | FIX → reply with commit | ✅ Yes |
| Valid improvement, in scope | FIX → reply with commit | ✅ Yes |
| Valid but out of scope | Create cell → resolve | ❌ No |
| Style/formatting nit | Resolve silently | ❌ No |
| Metadata file (.jsonl, etc) | Resolve silently | ❌ No |
| Already fixed | Reply with commit → resolve | ✅ Yes |

**SOP:**

```bash
# 1. Get unreplied comments (start here)
bun run .opencode/skills/pr-triage/scripts/pr-comments.ts unreplied owner/repo 42

# 2. Evaluate: fetch body for important files only
bun run .opencode/skills/pr-triage/scripts/pr-comments.ts expand owner/repo 123456

# 3. Decide & Act:
#    - Important issue? FIX IT in code, then:
bun run .opencode/skills/pr-triage/scripts/pr-comments.ts reply owner/repo 42 123456 "✅ Fixed in abc123"

#    - Not important? Resolve silently:
bun run .opencode/skills/pr-triage/scripts/pr-comments.ts resolve owner/repo 42 123456
```

**Skip these (resolve silently):**
- `.hive/issues.jsonl`, `.hive/memories.jsonl` - auto-generated
- Changeset formatting suggestions
- Import ordering, style nits
- Suggestions you disagree with

**Fix these (reply + resolve):**
- Security vulnerabilities
- Correctness bugs
- Missing error handling
- Type safety issues

**SDK:** `scripts/pr-comments.ts` - Zod-validated, pagination-aware

**References:** `references/gh-api-patterns.md` for raw jq/GraphQL patterns

## Publishing (Changesets + Bun)

This repo uses **Changesets** for versioning and **bun publish** for npm publishing.

### How It Works

Changesets doesn't support Bun workspaces out of the box - it doesn't resolve `workspace:*` references. We use [Ian Macalinao's approach](https://macalinao.github.io/posts/2025-08-18-changesets-bun-workspaces/):

```json
{
  "scripts": {
    "ci:version": "changeset version && bun update",
    "ci:publish": "for dir in packages/*; do (cd \"$dir\" && bun publish --access public || true); done && changeset tag"
  }
}
```

**Why `bun update` after `changeset version`?**
- `changeset version` bumps package.json versions
- `bun update` syncs the lockfile so `workspace:*` resolves to the new versions
- Without this, `bun publish` would publish with unresolved `workspace:*` references

**Why iterate and `bun publish` each package?**
- `bun publish` resolves `workspace:*` during pack (unlike `changeset publish`)
- `|| true` continues if a package is already published
- `changeset tag` creates git tags after all packages are published

### Release Flow

We use the standard `changesets/action@v1` with BOTH `version` and `publish` scripts. **Don't fight the action** - it handles the state machine internally:

```yaml
- name: Create and publish versions
  uses: changesets/action@v1
  with:
    version: bun run ci:version
    commit: "chore: update versions"
    title: "chore: update versions"
    publish: bun run ci:publish
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The action automatically determines:
- **Changesets exist** → runs `version` script, creates PR
- **No changesets, PR just merged** → runs `publish` script
- **Nothing to do** → exits cleanly

**Normal flow:**

1. Make changes to packages
2. Create a changeset file:
   ```bash
   cat > .changeset/your-change-name.md << 'EOF'
   ---
   "package-name": patch
   ---

   Description of the change
   EOF
   ```
3. Commit the changeset file with your changes
4. Push to main → action creates "chore: update versions" PR
5. Merge that PR → action runs `ci:publish` → packages on npm

**CRITICAL: Don't create changesets for ignored packages.** If you create a changeset that only affects `@swarmtools/web` (which is in `.changeset/config.json` ignore list), the action will try to create a version PR with no actual changes, causing a "No commits between main and changeset-release/main" error.

**Edge cases handled:**

- Version PR merged but publish failed → next push retries publish
- No changes at all → clean exit

### Changeset Lore (REQUIRED)

**Pack changesets with lore.** Changesets are not just version bumps - they're the story of the release. They get read by humans deciding whether to upgrade.

**Good changeset:**
```markdown
---
"swarm-mail": minor
---

## 🐝 Cell IDs Now Wear Their Project Colors

Cell IDs finally know where they came from. Instead of anonymous `bd-xxx` prefixes,
new cells proudly display their project name: `swarm-mail-lf2p4u-abc123`.

**What changed:**
- `generateBeadId()` reads `package.json` name field
- Slugifies project name (lowercase, dashes for special chars)
- Falls back to `cell-` prefix if no package.json

**Why it matters:**
- Cells identifiable at a glance in multi-project workspaces
- Easier filtering/searching across projects
- Removes legacy "bead" terminology from user-facing IDs

**Backward compatible:** Existing `bd-*` IDs still work fine.
```

**Bad changeset:**
```markdown
---
"swarm-mail": patch
---

Updated ID generation
```

**Rules:**
- Use emoji sparingly but effectively (🐝 for hive/swarm features)
- Explain WHAT changed, WHY it matters, and any MIGRATION notes
- Include code examples if API changed
- Mention backward compatibility explicitly
- Make it scannable (headers, bullets, bold for key points)

**MANDATORY: Pull a quote from pdf-brain.** This is NOT optional:
```bash
pdf-brain_search(query="<thematic keyword from your change>", limit=5)
```
Add the quote as an epigraph. Makes changelogs memorable and connects our work to the broader craft. Examples:
- Adding observability? Search "observability monitoring visibility"
- Refactoring? Search "refactoring Fowler small steps"
- Event sourcing? Search "event sourcing CQRS"
- Testing? Search "Beck TDD red green"

**ASCII Art Guidelines:**
- ASCII art is NOT always box-drawing block diagrams
- Be creative: animals, objects, scenes, characters with speech bubbles
- Match the metaphor: bees for swarm, telescopes for observability, locks for auth
- Hand-drawn feel > corporate flowchart
- Surprise and delight > functional documentation

```
# GOOD: Creative, thematic, memorable
                    .-.
                   (o o)  "Should I ADD or UPDATE?"
                   | O |
                    '-'

# BAD: Generic box diagram (every time)
┌─────────────────────────┐
│  SOME FEATURE           │
└─────────────────────────┘
```

### Ignored Packages

The following packages are excluded from changesets (won't be published):
- `@swarmtools/web` - docs site, not an npm package

### Commands

```bash
# Create a new changeset (interactive)
bunx changeset

# Preview what versions would be bumped
bunx changeset status

# Manually bump versions (CI does this automatically)
bun run ci:version

# Manually publish (CI does this automatically)  
bun run ci:publish
```

### Key Gotcha

CLI bin scripts need their imports in `dependencies`, not `devDependencies`. If `bin/swarm.ts` imports `@clack/prompts`, it must be in dependencies or users get "Cannot find module" errors.

### Configured Packages

| Package | npm |
|---------|-----|
| `opencode-swarm-plugin` | [npm](https://www.npmjs.com/package/opencode-swarm-plugin) |
| `swarm-mail` | [npm](https://www.npmjs.com/package/swarm-mail) |

### Adding a New Package to Publishing

1. Add `publishConfig` to package.json:
   ```json
   {
     "publishConfig": {
       "access": "public",
       "registry": "https://registry.npmjs.org/"
     }
   }
   ```
2. First publish happens automatically when changeset PR is merged

### Lockfile Sync (CRITICAL)

**Problem:** `bun pm pack` resolves `workspace:*` from the lockfile, not package.json. If lockfile is stale, you get old versions.

**Solution:** `ci:version` runs `bun update` after `changeset version` to sync the lockfile.

**Tracking:** 
- Bun native npm token support: https://github.com/oven-sh/bun/issues/15601
- When resolved, can switch to `bun publish` directly

## Environment Variables

### Required Keys

| Key | Purpose | Used By |
|-----|---------|---------|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway authentication | Evals, LLM calls |

### .env File Location

The `.env` file lives at **monorepo root** (`/.env`). For packages that need it:

```bash
# Copy to package that needs env vars
cp .env packages/opencode-swarm-plugin/.env
```

**Why copy instead of reference?** `bunx` and some tools don't traverse up to find `.env` files. Each package that needs env vars should have its own copy.

**gitignore:** All `.env` files are gitignored. Don't commit secrets.

### Loading in Scripts

For scripts that need env vars (like evals), use `bun --env-file`:

```json
{
  "scripts": {
    "eval:run": "bun --env-file=.env run bunx evalite run evals/"
  }
}
```

This loads `.env` before spawning the subprocess.

## Evalite Eval Rig

The plugin includes an evaluation system using [Evalite](https://evalite.dev) to score coordinator behavior, decomposition quality, and compaction.

### Running Evals

```bash
cd packages/opencode-swarm-plugin

# Run all evals
bun run eval:run

# Run specific eval suites
bun run eval:decomposition    # Task decomposition quality
bun run eval:coordinator      # Coordinator protocol adherence
```

### Eval Files

| File | What It Tests | Data Source |
|------|---------------|-------------|
| `coordinator-session.eval.ts` | Real coordinator protocol adherence | `~/.config/swarm-tools/sessions/*.jsonl` |
| `coordinator-behavior.eval.ts` | LLM coordinator mindset | Synthetic prompts → LLM |
| `swarm-decomposition.eval.ts` | Task decomposition quality | Fixtures + LLM |
| `compaction-resumption.eval.ts` | Context compaction correctness | Fixtures |
| `example.eval.ts` | Sanity check | Static |

### Data Sources

**Real sessions** are captured during swarm runs to `~/.config/swarm-tools/sessions/`. These are actual coordinator decisions (worker spawns, reviews, etc.) that get scored.

**How session capture works:**
- **Automatic**: No manual instrumentation - tool calls are inspected in real-time
- **Violation detection**: Pattern matching detects edit/write/test/reserve tool calls by coordinators
- **JSONL format**: One event per line, append-only, streamable
- **Event types**: DECISION, VIOLATION, OUTCOME, COMPACTION

**See [evals/README.md - Coordinator Session Capture (Deep Dive)](packages/opencode-swarm-plugin/evals/README.md#coordinator-session-capture-deep-dive) for full details on:**
- Capture flow diagram
- Violation detection patterns
- Event schema
- Viewing sessions with `jq`
- Integration points in code

**Synthetic fixtures** in `evals/fixtures/` provide known-good and known-bad examples for baseline validation.

### Scorers

Scorers live in `evals/scorers/` and measure specific aspects:

- **violationCount** - Protocol violations (editing files directly, skipping reviews)
- **spawnEfficiency** - Did coordinator spawn workers vs do work itself?
- **reviewThoroughness** - Did coordinator review worker output?
- **timeToFirstSpawn** - How fast did coordinator delegate?
- **overallDiscipline** - Weighted composite of above

### Adding New Evals

1. Create `evals/your-eval.eval.ts`
2. Use `evalite()` from evalite package
3. Define `data`, `task`, and `scorers`
4. Scorers use `createScorer()` - returns async function, NOT object with `.scorer`

```typescript
import { evalite } from "evalite";
import { createScorer } from "evalite";

const myScorer = createScorer({
  name: "My Scorer",
  description: "What it measures",
  scorer: async ({ output, expected, input }) => {
    // Return 0-1 score
    return { score: 0.8, message: "Details" };
  },
});

evalite("My Eval", {
  data: async () => [{ input: "...", expected: "..." }],
  task: async (input) => "output",
  scorers: [myScorer],
});
```

### Composite Scorers

When combining multiple scorers, call them directly with `await`:

```typescript
// CORRECT - scorers are async functions
const result = await childScorer({ output, expected, input });
const score = result.score ?? 0;

// WRONG - .scorer property doesn't exist
const result = childScorer.scorer({ output, expected });  // ❌
```

### Troubleshooting

**"GatewayAuthenticationError"** - Missing `AI_GATEWAY_API_KEY`. Copy `.env` to package folder.

**"no such table: eval_records"** - Run any swarm-mail operation to trigger schema creation. Tables are created lazily with `CREATE TABLE IF NOT EXISTS`.

## Swarm CLI Commands

The `swarm` CLI provides observability, analytics, and debugging tools for multi-agent coordination.

### Analytics & Querying

**swarm query** - SQL analytics with presets for common patterns

```bash
# Execute custom SQL query
swarm query --sql "SELECT * FROM events WHERE type='worker_spawned' LIMIT 10"

# Use preset query
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
swarm query --preset decision_quality
swarm query --preset strategy_success_rates
swarm query --preset decisions_by_pattern

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
| `decision_quality` | Recent decisions with quality scores and rationale |
| `strategy_success_rates` | Success rates by decomposition strategy |
| `decisions_by_pattern` | Which semantic memory patterns are cited most often |

### Live Monitoring

**swarm dashboard** - Live terminal UI with worker status

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

### Event Replay

**swarm replay** - Replay epic events with timing control

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

**Use cases:**
- Debug coordination failures by replaying the sequence
- Understand timing of worker spawns vs completions
- Identify where bottlenecks occurred
- Review coordinator decision points

### Data Export

**swarm export** - Export events for external analysis

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

### Stats & History

**swarm stats** - Health metrics powered by swarm-insights

```bash
# Last 7 days (default)
swarm stats

# Custom time period
swarm stats --since 24h
swarm stats --since 30m

# JSON output for scripting
swarm stats --json
```

**swarm history** - Recent swarm activity timeline

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

### Session Logs

**swarm log sessions** - View captured coordinator sessions

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

## Observability Patterns

### Debug Logging

Use `DEBUG` env var to enable swarm debug logs. Logs use box-drawing characters for readability.

**Patterns:**

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

**Output format:**

```
┌─ swarm:coordinator ─────────────────────
│ Spawning worker for task: mjmas40ys7g
│ {"epic_id":"mjmas3zxlmg","strategy":"file-based"}
└──────────────────────────────────────────
```

**Namespaces:**

| Namespace | What It Logs |
|-----------|--------------|
| `swarm:*` | All swarm activity |
| `swarm:coordinator` | Coordinator decisions (spawn, review, approve/reject) |
| `swarm:worker` | Worker progress, reservations, completions |
| `swarm:mail` | Inter-agent messages, inbox/outbox activity |

**Use cases:**
- **Debugging coordination failures**: `DEBUG=swarm:coordinator` to see decision flow
- **Worker issues**: `DEBUG=swarm:worker` to see what workers are doing
- **Message passing problems**: `DEBUG=swarm:mail` to trace communication
- **Everything**: `DEBUG=swarm:*` when you need full visibility

### Viewing Logs

**swarm log** - Tail and filter swarm logs

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

## Error Enrichment

SwarmError provides structured context for debugging multi-agent failures.

### SwarmError Class

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
    epic_id: "mjmas3zxlmg",
    bead_id: "mjmas40ys7g"
  });
}
```

### Context Fields

| Field | Purpose | Example |
|-------|---------|---------|
| `file` | File where error occurred | `"src/auth.ts"` |
| `line` | Line number | `42` |
| `agent` | Agent that encountered error | `"DarkHawk"` |
| `epic_id` | Epic being worked on | `"mjmas3zxlmg"` |
| `bead_id` | Specific task/cell | `"mjmas40ys7g"` |
| `recent_events` | Last N events before error | `[{type, timestamp, message}]` |

### Automatic Fix Suggestions

The `suggestFix()` function pattern-matches common errors and provides actionable fixes:

```typescript
import { suggestFix } from "opencode-swarm-plugin";

try {
  await swarmmail_reserve(["src/auth.ts"]);
} catch (error) {
  const suggestion = suggestFix(error);
  if (suggestion) {
    console.log(suggestion);
  }
  throw error;
}
```

**Patterns detected:**

| Error Pattern | Suggested Fix |
|---------------|---------------|
| "agent not registered" | Call `swarmmail_init()` before any swarm operations |
| "already reserved" | File is reserved by another agent. Wait for release or coordinate. |
| "uncommitted changes" | Run `hive_sync()` or commit changes before proceeding |
| "manual close" detected | Use `swarm_complete()` instead of `hive_close()` in workers |
| "context exhausted" | Use `/checkpoint` or spawn subagent |
| "libsql not initialized" | Ensure `swarmmail_init()` is called |

**Example output:**

```
┌─ Fix Suggestion ─────────────────────────
│ Problem: Agent not initialized
│ Solution: Call swarmmail_init() before any swarm operations
│ Context: agent=DarkHawk epic_id=mjmas3zxlmg
└──────────────────────────────────────────
```

### Integration with Debugging

Combine SwarmError context with DEBUG logging:

```bash
# See full error context in logs
DEBUG=swarm:* swarm replay <epic-id>
```

Errors logged with SwarmError.toJSON() include:
- Error name and message
- Stack trace
- Full context object (file, line, agent, epic, events)

This creates an audit trail from error → context → recent events → root cause.

## Hivemind - Unified Memory System

The hive remembers everything. Learnings, sessions, patterns—all searchable.

**Unified storage:** Manual learnings and AI agent session histories stored in the same database, searchable together. Powered by libSQL vectors + Ollama embeddings.

**Inspired by [CASS (coding_agent_session_search)](https://github.com/Dicklesworthstone/coding_agent_session_search) by Dicklesworthstone** - sessions + semantic memory unified under one API.

**Indexed agents:** Claude Code, Codex, Cursor, Gemini, Aider, ChatGPT, Cline, OpenCode, Amp, Pi-Agent

### When to Use

- **BEFORE implementing** - check if you or any agent solved it before
- **After solving hard problems** - store learnings for future sessions
- **Debugging** - search past sessions for similar errors
- **Architecture decisions** - record reasoning, alternatives, tradeoffs
- **Project-specific patterns** - capture domain rules and gotchas

### Tools

| Tool | Purpose |
|------|---------|
| `hivemind_store` | Store a memory (learnings, decisions, patterns) |
| `hivemind_find` | Search all memories (learnings + sessions, semantic + FTS fallback) |
| `hivemind_get` | Get specific memory by ID |
| `hivemind_remove` | Delete outdated/incorrect memory |
| `hivemind_validate` | Confirm memory still accurate (resets 90-day decay timer) |
| `hivemind_stats` | Memory statistics and health check |
| `hivemind_index` | Index AI session directories |
| `hivemind_sync` | Sync to .hive/memories.jsonl (git-backed, team-shared) |

### Usage

**Store a learning** (include WHY, not just WHAT):

```typescript
hivemind_store({
  information: "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions. Without buffer, token refresh can fail mid-request if expiry happens between check and use.",
  tags: "auth,oauth,tokens,race-conditions"
})
```

**Search all memories** (learnings + sessions):

```typescript
// Search everything
hivemind_find({ query: "token refresh", limit: 5 })

// Search only learnings (manual entries)
hivemind_find({ query: "authentication", collection: "default" })

// Search only Claude sessions
hivemind_find({ query: "Next.js caching", collection: "claude" })

// Search only Cursor sessions
hivemind_find({ query: "API design", collection: "cursor" })
```

**Get specific memory**:

```typescript
hivemind_get({ id: "mem_xyz123" })
```

**Delete outdated memory**:

```typescript
hivemind_remove({ id: "mem_old456" })
```

**Validate memory is still accurate** (resets decay):

```typescript
// Confirmed this memory is still relevant
hivemind_validate({ id: "mem_xyz123" })
```

**Index new sessions**:

```typescript
// Automatically indexes ~/.config/opencode/sessions, ~/.cursor-tutor, etc.
hivemind_index()
```

**Sync to git**:

```typescript
// Writes learnings to .hive/memories.jsonl for git sync
hivemind_sync()
```

**Check stats**:

```typescript
hivemind_stats()
```

### Usage Pattern

```bash
# 1. Before starting work - query for relevant learnings
hivemind_find({ query: "<task keywords>", limit: 5 })

# 2. Do the work...

# 3. After solving hard problem - store learning
hivemind_store({
  information: "<what you learned, WHY it matters>",
  tags: "<relevant,tags>"
})

# 4. Validate memories when you confirm they're still accurate
hivemind_validate({ id: "<memory-id>" })
```

### Integration with Workflow

**At task start** (query BEFORE implementing):

```bash
# Check if you or any agent solved similar problems
hivemind_find({ query: "OAuth token refresh buffer", limit: 5 })
```

**During debugging** (search past sessions):

```bash
# Find similar errors from past sessions
hivemind_find({ query: "cannot read property of undefined", collection: "claude" })
```

**After solving problems** (store learnings):

```bash
# Store root cause + solution, not just "fixed it"
hivemind_store({
  information: "Next.js searchParams causes dynamic rendering. Workaround: destructure in parent, pass as props to cached child.",
  tags: "nextjs,cache-components,dynamic-rendering,searchparams"
})
```

**Learning from other agents**:

```bash
# See how Cursor handled similar feature
hivemind_find({ query: "implement authentication", collection: "cursor" })
```

**Pro tip:** Query Hivemind at the START of complex tasks. Past solutions (yours or other agents') save time and prevent reinventing wheels.

---

## OpenCode Commands

Custom commands available via `/command`:

| Command               | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `/swarm <task>`       | Decompose task into cells, spawn parallel agents with shared context |
| `/parallel "t1" "t2"` | Run explicit task list in parallel                                   |
| `/fix-all`            | Survey PRs + cells, dispatch agents to fix issues                    |
| `/review-my-shit`     | Pre-PR self-review: lint, types, common mistakes                     |
| `/handoff`            | End session: sync hive, generate continuation prompt                |
| `/sweep`              | Codebase cleanup: type errors, lint, dead code                       |
| `/focus <cell-id>`    | Start focused session on specific cell                               |
| `/context-dump`       | Dump state for model switch or context recovery                      |
| `/checkpoint`         | Compress context: summarize session, preserve decisions              |
| `/retro <cell-id>`    | Post-mortem: extract learnings, update knowledge files               |
| `/worktree-task <id>` | Create git worktree for isolated cell work                           |
| `/commit`             | Smart commit with conventional format + cell refs                   |
| `/pr-create`          | Create PR with cell linking + smart summary                         |
| `/debug <error>`      | Investigate error, check known patterns first                        |
| `/debug-plus`         | Enhanced debug with swarm integration and prevention pipeline        |
| `/iterate <task>`     | Evaluator-optimizer loop: generate, critique, improve until good     |
| `/triage <request>`   | Intelligent routing: classify and dispatch to right handler          |
| `/repo-dive <repo>`   | Deep analysis of GitHub repo with autopsy tools                      |

## OpenCode Agents

Specialized subagents (invoke with `@agent-name` or auto-dispatched):

| Agent           | Model             | Purpose                                               |
| --------------- | ----------------- | ----------------------------------------------------- |
| `swarm-planner` | claude-sonnet-4-5 | Strategic task decomposition for swarm coordination   |
| `swarm-worker`  | claude-sonnet-4-5 | **PRIMARY for /swarm** - parallel task implementation |
| `hive`          | claude-haiku      | Work item tracker operations (locked down)            |
| `archaeologist` | claude-sonnet-4-5 | Read-only codebase exploration, architecture mapping  |
| `explore`       | claude-haiku-4-5  | Fast codebase search, pattern discovery (read-only)   |
| `refactorer`    | default           | Pattern migration across codebase                     |
| `reviewer`      | default           | Read-only code review, security/perf audits           |
