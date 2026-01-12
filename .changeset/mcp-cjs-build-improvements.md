---
"opencode-swarm-plugin": patch
---

## MCP Server: CommonJS Build for Claude Code Compatibility

Switched MCP server entrypoint from `.js` to `.cjs` for reliable CommonJS execution in Claude Code's plugin runtime.

**Changes:**
- Build outputs `swarm-mcp-server.cjs` instead of `.js`
- Plugin manifest points to `.cjs` entrypoint
- Build script supports `format: "cjs"` option per entry
- Plugin version synced to package version (0.57.5)

**New utilities:**
- `scripts/sync-plugin-versions.ts` - keeps plugin.json version in sync
- `scripts/recover-memories.ts` - memory recovery tooling
- `scripts/regenerate-embeddings.ts` - embedding regeneration

**Why it matters:** Ensures the MCP server runs correctly when Claude Code spawns it, regardless of the host environment's module resolution.
