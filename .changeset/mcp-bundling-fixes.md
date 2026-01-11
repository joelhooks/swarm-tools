---
"opencode-swarm-plugin": patch
---

> "In other areas, new technology presented both new solutions and new problems for our systems." — Sam Newman, *Building Microservices (2nd ed.)*

## 🐝 MCP Bundling Hardening

```
     (\_/)  
    (•_•)   "Ship the bundle."
   / >🍯
```

**What changed**
- Bundles the MCP server into `dist/mcp/swarm-mcp-server.js` and points cached MCP configs at the built artifact.
- Packages MCP artifacts (schemas/tools cache) so installs run without Bun/TS runtime dependencies.
- Updates the spawn prompt to require a Task after spawning, preventing coordinator edits.

**Why it matters**
- Keeps MCP startup reliable across cached installs and npm tarballs.
- Ensures the plugin ships the exact runtime assets it expects.

**Compatibility**
- Backwards compatible; existing configs still work once `bun run build` generates `dist/mcp`.