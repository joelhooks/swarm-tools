# swarm-tools

## 0.59.7

### Patch Changes

- [`3bbf31d`](https://github.com/joelhooks/swarm-tools/commit/3bbf31d73874d49c319f4b89f51934ae9049622d) Thanks [@joelhooks](https://github.com/joelhooks)! - fix(mcp): inline tool schemas to fix params arriving as undefined

  The MCP server scraped tool definitions from `swarm tool --list --json` at
  startup, but the CLI's `--list` handler never supported `--json`. The fallback
  parsed colored text output and registered every tool with an empty JSON schema
  (`properties: {}`), which converted to a Zod schema with no required fields.
  The MCP SDK then treated all params as optional, delivering `undefined` to
  every handler.

  - **claude-code-swarm-plugin**: Replace runtime CLI scraping with static
    `TOOL_DEFINITIONS` array containing all 25 tools with proper JSON schemas
    (properties, required fields, types, descriptions)
  - **swarm-tools**: Export `SWARM_TOOLS` from index.ts; MCP server imports
    canonical definitions instead of scraping CLI
  - Remove dead `getToolDefinitions()`, `filterTools()`, unused `execSync` import

  > "The most fundamental problem in computer science is problem decomposition:
  > how to take a complex problem and divide it up into pieces that can be solved
  > independently." — John Ousterhout, A Philosophy of Software Design

## 0.59.6

### Patch Changes

- [`109f335`](https://github.com/joelhooks/swarm-tools/commit/109f335b663be6420bfd8a471118dc283c5248c2) Thanks [@joelhooks](https://github.com/joelhooks)! - Add SKOS taxonomy extraction to hivemind memory system

  - SKOS entity taxonomy with broader/narrower/related relationships
  - LLM-powered taxonomy extraction wired into adapter.store()
  - Entity extraction now includes prefLabel and altLabels
  - New CLI commands: `swarm memory entities`, `swarm memory entity`, `swarm memory taxonomy`
  - Moltbot plugin: decay tier filtering, entity-aware auto-capture
  - HATEOAS-style hints in hivemind tool responses
