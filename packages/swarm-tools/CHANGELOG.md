# swarm-tools

## 0.60.0

### Minor Changes

- [`2ad83e6`](https://github.com/joelhooks/swarm-tools/commit/2ad83e6ece83fb409267d5b92e6ff59444d9ebcd) Thanks [@joelhooks](https://github.com/joelhooks)! - Overhaul hivemind memory hooks to stop flooding sessions with garbage context

  **Auto-recall fixes:**

  - Add 30s cooldown between recall queries (was firing ~608x per 8hr session)
  - Raise minScore from 0.3 to 0.55 (filter weak matches)
  - Skip system messages (watchdog, heartbeat, exec logs, telegrams, etc.)
  - Truncate query to first 200 chars instead of sending full prompt
  - Move console.log spam behind debug flag
  - Reduce maxRecallResults from 5 to 3

  **Auto-capture fixes:**

  - Only capture assistant responses (was also capturing user messages and system prompts)
  - Replace loose CAPTURE_PATTERNS with STRONG_CAPTURE_PATTERNS requiring actual knowledge signals
  - Add 19-pattern system message blocklist (heartbeat, watchdog, OUTCOME/DECISION blocks, etc.)
  - Raise min capture length from 50 to 80 chars
  - Long messages (300+) only captured if also entity-rich
  - Reduce captures per turn from 2 to 1
  - Increase truncation from 500 to 1000 chars (capture complete thoughts)

  **Format improvements:**

  - Increase recalled content from 300 to 600 chars
  - Drop emoji decay badges (waste tokens)
  - Drop "Relevant memories:" header and "Use naturally" instruction
  - Cleaner format: `- (85%) [tags] content`

  **Tag detection:**

  - Remove "task" tag (matched every system log)
  - Add "gotcha", "architecture", "config" tags

  **Session handler:**

  - Don't store "Session ended without summary" garbage (require 50+ char summary)
  - Better session start query, limit results from 5 to 3

  **New config options:** recallCooldownMs, maxCapturePerTurn, captureContentLimit, recallContentLimit

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
