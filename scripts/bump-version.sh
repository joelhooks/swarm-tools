#!/bin/bash
# Bump all version touchpoints in the monorepo
# Usage: ./scripts/bump-version.sh 0.59.0

set -e

NEW_VERSION=$1

if [ -z "$NEW_VERSION" ]; then
  echo "Usage: ./scripts/bump-version.sh <version>"
  echo "Example: ./scripts/bump-version.sh 0.59.0"
  exit 1
fi

echo "Bumping all packages to $NEW_VERSION..."

# opencode-swarm-plugin
echo "  - packages/opencode-swarm-plugin/package.json"
jq ".version = \"$NEW_VERSION\"" packages/opencode-swarm-plugin/package.json > /tmp/pkg.json && mv /tmp/pkg.json packages/opencode-swarm-plugin/package.json

echo "  - packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json"
jq ".version = \"$NEW_VERSION\"" packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json > /tmp/plug.json && mv /tmp/plug.json packages/opencode-swarm-plugin/claude-plugin/.claude-plugin/plugin.json

# claude-code-swarm-plugin (thin wrapper)
echo "  - packages/claude-code-swarm-plugin/package.json"
jq ".version = \"$NEW_VERSION\"" packages/claude-code-swarm-plugin/package.json > /tmp/pkg.json && mv /tmp/pkg.json packages/claude-code-swarm-plugin/package.json

echo "  - packages/claude-code-swarm-plugin/.claude-plugin/plugin.json"
jq ".version = \"$NEW_VERSION\"" packages/claude-code-swarm-plugin/.claude-plugin/plugin.json > /tmp/plug.json && mv /tmp/plug.json packages/claude-code-swarm-plugin/.claude-plugin/plugin.json

echo ""
echo "✅ Bumped all packages to $NEW_VERSION"
echo ""
echo "Changed files:"
git diff --stat

echo ""
echo "Next steps:"
echo "  1. bun run build (in packages/opencode-swarm-plugin)"
echo "  2. git add -A && git commit -m \"release: $NEW_VERSION\""
echo "  3. git push"
echo "  4. bun run ci:publish"
