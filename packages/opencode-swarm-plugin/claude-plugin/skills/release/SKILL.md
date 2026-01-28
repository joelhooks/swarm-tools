# Release Skill

Handles version bumps and releases for the opencode-swarm-plugin monorepo.

## Version Touchpoints

When bumping versions, ALL of these files must be updated:

### opencode-swarm-plugin
- `packages/opencode-swarm-plugin/package.json` - npm package version
- `packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json` - Claude plugin version

### claude-code-swarm-plugin (thin wrapper)
- `packages/claude-code-swarm-plugin/package.json` - npm package version
- `packages/claude-code-swarm-plugin/.claude-plugin/plugin.json` - Claude plugin version

### Other packages (if applicable)
- `packages/swarm-evals/package.json`
- `packages/swarm-mail/package.json`
- `packages/swarm-dashboard/package.json`

## Release Process

1. **Create changeset** (for proper changelog generation):
   ```bash
   # Interactive (won't work in CI/agent context)
   bun changeset

   # Manual - create file in .changeset/
   echo '---
   "opencode-swarm-plugin": minor
   "claude-code-swarm-plugin": minor
   ---

   feat: description of changes' > .changeset/my-change.md
   ```

2. **Version bump** (applies changesets):
   ```bash
   bun run ci:version
   ```
   This runs `changeset version` and updates package.jsons

3. **CRITICAL: Sync plugin.json versions manually**:
   ```bash
   # Get version from package.json
   VERSION=$(cat packages/opencode-swarm-plugin/package.json | jq -r '.version')

   # Update both plugin.json files
   jq ".version = \"$VERSION\"" packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json > /tmp/p1.json && mv /tmp/p1.json packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json

   VERSION=$(cat packages/claude-code-swarm-plugin/package.json | jq -r '.version')
   jq ".version = \"$VERSION\"" packages/claude-code-swarm-plugin/.claude-plugin/plugin.json > /tmp/p2.json && mv /tmp/p2.json packages/claude-code-swarm-plugin/.claude-plugin/plugin.json
   ```

4. **Build**:
   ```bash
   cd packages/opencode-swarm-plugin && bun run build
   ```

5. **Publish**:
   ```bash
   bun run ci:publish
   ```

6. **Commit and push**:
   ```bash
   git add -A && git commit -m "release: bump versions" && git push
   ```

## Quick Version Bump Script

Run this to bump all version touchpoints at once:

```bash
#!/bin/bash
NEW_VERSION=$1

if [ -z "$NEW_VERSION" ]; then
  echo "Usage: ./bump-version.sh 0.59.0"
  exit 1
fi

# Main package
jq ".version = \"$NEW_VERSION\"" packages/opencode-swarm-plugin/package.json > /tmp/pkg.json && mv /tmp/pkg.json packages/opencode-swarm-plugin/package.json
jq ".version = \"$NEW_VERSION\"" packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json > /tmp/plug.json && mv /tmp/plug.json packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json

# Thin wrapper (claude-code-swarm-plugin)
jq ".version = \"$NEW_VERSION\"" packages/claude-code-swarm-plugin/package.json > /tmp/pkg.json && mv /tmp/pkg.json packages/claude-code-swarm-plugin/package.json
jq ".version = \"$NEW_VERSION\"" packages/claude-code-swarm-plugin/.claude-plugin/plugin.json > /tmp/plug.json && mv /tmp/plug.json packages/claude-code-swarm-plugin/.claude-plugin/plugin.json

echo "Bumped all packages to $NEW_VERSION"
git diff --stat
```

## Gotchas

- **plugin.json is NOT auto-bumped by changesets** - must be done manually
- **Two separate plugins**: `opencode-swarm-plugin` (full) and `claude-code-swarm-plugin` (thin wrapper)
- **Claude Code marketplace installs from cache** - users may need to uninstall/reinstall for updates
- **npm publish needs `--access public`** for scoped packages
