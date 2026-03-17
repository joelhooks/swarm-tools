---
name: release
description: "Handles version bumps and npm releases for the swarm-tools monorepo (opencode-swarm-plugin, claude-code-swarm-plugin, swarm-mail, swarm-queue). Use when creating changesets, bumping versions, preparing releases, checking release status, debugging publish failures, verifying npm packages, or merging release PRs. Triggers: release, publish, changeset, bump version, ship it, new version, create a release, check npm, verify publish, /release."
---

# Release Workflow

## Standard Release (CI-driven)

All releases go through changesets → CI → npm. Never publish manually unless CI is broken.

### 1. Create changeset

```bash
cat > .changeset/<descriptive-name>.md << 'EOF'
---
"opencode-swarm-plugin": patch
---

fix: description of what changed and why
EOF
```

**Bump levels**: `patch` (bug fixes), `minor` (features), `major` (breaking changes).

**Which packages to include** — only packages with actual changes:
- `opencode-swarm-plugin` — main plugin (CLI, MCP server, swarm orchestration)
- `claude-code-swarm-plugin` — thin Claude Code wrapper (commands, agents, hooks, skills)
- `swarm-mail` — agent messaging, memory, reservations
- `swarm-queue` — task queue

**Use pdf-brain for commit quotes:**
```bash
pdf-brain search "<relevant topic>" --limit 1 --expand 500
```

### 2. Commit and push

```bash
git add .changeset/<name>.md <changed-files>
git commit -m "feat: description"
git push origin main
```

### 3. CI creates release PR

CI (`publish.yml`) runs on push to main:
1. Detects changesets → runs `changeset version` + `bun update`
2. Syncs `plugin.json` versions (lifecycle hook at `.changeset/config.json`)
3. Opens/updates PR on `changeset-release/main` branch
4. AI generates PR title via `vercel/ai-action`

### 4. Merge release PR

```bash
gh pr merge <number> --squash --delete-branch
```

CI then:
1. Builds all packages
2. Verifies tarballs contain expected artifacts
3. Runs `scripts/ci-publish.sh` — packs with `bun pm pack` (resolves `workspace:*`), publishes via `npm publish`
4. Tags releases
5. Generates and posts release tweet to @swarmtoolsai

### 5. Verify

```bash
npm view opencode-swarm-plugin@latest dependencies
npm view claude-code-swarm-plugin@latest version
```

**Critical check**: Verify no `workspace:*` in published deps. If found, the publish script's safety net failed — see Troubleshooting.

## Version Touchpoints

CI handles all of these via changesets. For manual bumps, ALL must be updated:

| Package | Files |
|---------|-------|
| opencode-swarm-plugin | `packages/opencode-swarm-plugin/package.json`, `claude-plugin/.claude-plugin/plugin.json` |
| claude-code-swarm-plugin | `packages/claude-code-swarm-plugin/package.json`, `.claude-plugin/plugin.json` |
| swarm-mail | `packages/swarm-mail/package.json` |
| swarm-queue | `packages/swarm-queue/package.json` |

Manual bump script: `./scripts/bump-version.sh <version>`

## Troubleshooting

### `workspace:*` in published npm package

The `scripts/ci-publish.sh` uses `bun pm pack` (resolves workspace protocol) + a python3 safety net that rewrites any remaining `workspace:*` to actual versions. If this still fails:

1. Check bun version — `packageManager` in root `package.json` must be >= 1.3.5
2. Verify safety net ran — CI logs should show "resolving from monorepo" if workspace deps leaked
3. Nuclear option: bump the broken package (patch changeset), push, merge release PR

### CI publish fails with E403

Already-published version. Normal when re-running publish — `|| true` catches it. Only a problem if the VERSION wasn't bumped (changeset not applied).

### Plugin.json version mismatch

CI lifecycle hook should sync these. If not, manually:
```bash
VERSION=$(jq -r .version packages/opencode-swarm-plugin/package.json)
jq ".version = \"$VERSION\"" packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json > /tmp/p.json
mv /tmp/p.json packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json
```

### Release PR not created/updated

Changesets action only runs when `.changeset/*.md` files exist (excluding README.md). If no changesets, it skips version PR creation and goes straight to publish (for any packages with unpublished versions).

## Architecture Notes

- **Two Claude Code plugins**: `opencode-swarm-plugin` (full, bundles MCP server + CLI) and `claude-code-swarm-plugin` (thin wrapper, shells out to `swarm` CLI). Both register as plugin name "swarm".
- **Publish script** (`scripts/ci-publish.sh`): Iterates all `packages/*`, skips private, packs, resolves workspace deps, publishes tarball.
- **Changeset config** (`.changeset/config.json`): Public access, GitHub changelog, ignores `@swarmtools/web`.
- **Tweet bot**: CI generates release tweet via claude-opus and posts to X via OAuth. Cloudflare retry logic included.
