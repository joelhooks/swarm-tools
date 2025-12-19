# Monorepo Guide: Bun + Turborepo

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
| Integration | `.integration.test.ts` | <5s | PGLite, filesystem | Pre-commit |
| E2E | `.e2e.test.ts` | <30s | External services | CI only |

### Rules for Fast Tests

1. **Prefer in-memory databases** - Use `createInMemorySwarmMail()` over file-based PGLite
2. **Share instances when possible** - Use `beforeAll`/`afterAll` for expensive setup, not `beforeEach`/`afterEach`
3. **Don't skip tests** - If a test needs external services, mock them or make them optional
4. **Clean up after yourself** - But don't recreate the world for each test

### PGLite Testing Pattern

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

- `EventStore` - append-only event log with PGLite
- `Projections` - materialized views (agents, messages, reservations)
- Effect-TS durable primitives (mailbox, cursor, lock, deferred)
- `DatabaseAdapter` interface for dependency injection
- **Hive** - git-synced work item tracking (formerly "beads")

### opencode-swarm-plugin

OpenCode plugin providing:

- **Hive integration** (work item tracking, epics, dependencies)
- Swarm coordination (task decomposition, parallel agents)
- Swarm Mail (inter-agent messaging)
- Learning system (pattern maturity, anti-pattern detection)
- Skills system (knowledge injection)

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
4. Push to main
5. Changesets action creates a "chore: release packages" PR with version bumps
6. Merge that PR → action runs `ci:publish` → packages published to npm

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
- **Pull a quote from pdf-brain** - Search for something thematically relevant and add it as an epigraph. Makes changelogs memorable and connects our work to the broader craft.

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
