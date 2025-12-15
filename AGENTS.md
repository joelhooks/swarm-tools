# Monorepo Guide: Bun + Turborepo

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

## Packages in This Repo

### swarm-mail

Event sourcing primitives for multi-agent coordination:

- `EventStore` - append-only event log with PGLite
- `Projections` - materialized views (agents, messages, reservations)
- Effect-TS durable primitives (mailbox, cursor, lock, deferred)
- `DatabaseAdapter` interface for dependency injection

### opencode-swarm-plugin

OpenCode plugin providing:

- Beads integration (issue tracking)
- Swarm coordination (task decomposition, parallel agents)
- Agent Mail (inter-agent messaging)
- Learning system (pattern maturity, anti-pattern detection)
- Skills system (knowledge injection)

## Publishing (Changesets + Trusted Publishers)

This repo uses **Changesets** for versioning and **npm Trusted Publishers** (OIDC) for publishing - no npm tokens needed.

### Release Flow

1. Make changes to packages
2. Create a changeset describing the change:
   ```bash
   bunx changeset
   # Select packages, bump type (patch/minor/major), write summary
   ```
3. Commit the changeset file (`.changeset/*.md`) with your changes
4. Push to main
5. Changesets action creates a "chore: release packages" PR with version bumps
6. Merge that PR → automatically publishes to npm via OIDC

### Commands

```bash
# Create a new changeset
bunx changeset

# Preview what versions would be bumped
bunx changeset status

# Manually bump versions (CI does this automatically)
bunx changeset version

# Manually publish (CI does this automatically)
bunx changeset publish
```

### How Trusted Publishers Work

- No `NPM_TOKEN` secret needed
- GitHub Actions workflow has `id-token: write` permission
- npm packages configured with Trusted Publisher pointing to `joelhooks/opencode-swarm-plugin` + `publish.yml`
- npm CLI 11.5.1+ auto-detects OIDC environment and authenticates
- Provenance attestations generated automatically

### workspace:* Protocol Resolution

**Problem:** `workspace:*` in package.json dependencies doesn't get resolved by `npm publish` or `bunx changeset publish`, causing install failures.

**Solution:** Custom `scripts/publish.ts` uses a two-step process:
1. `bun pm pack` - Creates tarball with `workspace:*` resolved to actual versions (e.g., `0.1.0`)
2. `npm publish <tarball>` - Publishes the tarball with OIDC trusted publisher support

**Why not just `bun publish`?** Bun publish resolves workspace protocols but doesn't support npm OIDC - it requires `npm login`.

**Key gotcha:** CLI bin scripts need their imports in `dependencies`, not `devDependencies`. If `bin/swarm.ts` imports `@clack/prompts`, it must be in dependencies or users get "Cannot find module" errors.

### Configured Packages

| Package | npm | Trusted Publisher |
|---------|-----|-------------------|
| `opencode-swarm-plugin` | [npm](https://www.npmjs.com/package/opencode-swarm-plugin) | ✅ `publish.yml` |
| `swarm-mail` | [npm](https://www.npmjs.com/package/swarm-mail) | ✅ `publish.yml` |

### Adding a New Package to Publishing

1. Publish initial version manually: `cd packages/new-pkg && npm publish --access public`
2. Go to https://www.npmjs.com/package/new-pkg/access
3. Add Trusted Publisher:
   - Organization: `joelhooks`
   - Repository: `opencode-swarm-plugin`
   - Workflow: `publish.yml`
4. Future releases handled automatically via changesets

### Lockfile Sync (CRITICAL)

**Problem:** `bun pm pack` resolves `workspace:*` from the lockfile, not package.json. If lockfile is stale, you get old versions.

**Solution:** `scripts/publish.ts` runs `bun install` before packing to sync the lockfile.

**Tracking:** 
- Bun native npm token support: https://github.com/oven-sh/bun/issues/15601
- When resolved, can switch to `bun publish` directly
