# opencode-swarm-plugin

## 0.62.0

### Minor Changes

- [#154](https://github.com/joelhooks/swarm-tools/pull/154) [`70d47d5`](https://github.com/joelhooks/swarm-tools/commit/70d47d5c2ae3a9419a00a165e49a9f7f9d98b7d7) Thanks [@joelhooks](https://github.com/joelhooks)! - feat: UserPromptSubmit hook now injects timestamp and semantic memory recall

  - **Timestamp injection**: Every prompt now includes current date/time for temporal awareness
  - **Semantic memory recall**: Automatically searches hivemind for relevant memories on each prompt
    - Queries with prompt text, returns top 3 matches
    - Filters to high-confidence matches (score > 0.5)
    - Injects up to 2 relevant memory snippets as context
  - Uses local memory adapter wrapper for proper db type conversion

- [#154](https://github.com/joelhooks/swarm-tools/pull/154) [`70d47d5`](https://github.com/joelhooks/swarm-tools/commit/70d47d5c2ae3a9419a00a165e49a9f7f9d98b7d7) Thanks [@joelhooks](https://github.com/joelhooks)! - Add Pi-inspired agent enhancements:

  - **skills_reload tool**: Hot-reload skills mid-session with cache invalidation
  - **swarm_branch/swarm_return**: Session branching for side-quests with context forking
  - **skill-generator meta-skill**: Generate properly formatted skill scaffolds
  - **PostToolUse hook**: Auto-trigger skill reload on skills_create/update/init

### Patch Changes

- [#163](https://github.com/joelhooks/swarm-tools/pull/163) [`ed31f5c`](https://github.com/joelhooks/swarm-tools/commit/ed31f5c316e1bb9137bb27e824f2fc58b9ba9d46) Thanks [@joelhooks](https://github.com/joelhooks)! - feat(plugin): upgrade for Claude Code 2.1.32 native integration

  Add dual-mode architecture supporting both native agent teams and task
  fallback. Plugin now complements rather than duplicates native features.

  **claude-code-swarm-plugin:**

  - agents: Add permissionMode, memory, disallowedTools, lifecycle hooks
  - swarm.md: Full rewrite with environment detection, mode-aware protocols
  - hooks: Add SubagentStart/Stop, TaskCreate/TaskUpdate tracking
  - skills: Update for TaskCreate/TaskUpdate, TeammateTool awareness
  - README: Add 2.1.32 integration docs, architecture diagram, comparison table

  **opencode-swarm-plugin:**

  - Fix test schema mismatch: add access_count, last_accessed, category, status
  - Fix decay_factor default from 0.7 to 1.0 to match Drizzle schema
  - Update column count assertions (14 → 18 columns)

  Native teams provide: real-time messaging, planning mode, task UI
  Plugin provides: git-backed persistence, semantic memory, file locking

  > "Make the change easy, then make the easy change." — Kent Beck

## 0.61.0

### Minor Changes

- [#151](https://github.com/joelhooks/swarm-tools/pull/151) [`e686008`](https://github.com/joelhooks/swarm-tools/commit/e686008d437752443af1ccca01cb2047912cf517) Thanks [@joelhooks](https://github.com/joelhooks)! - feat: UserPromptSubmit hook now injects timestamp and semantic memory recall

  - **Timestamp injection**: Every prompt now includes current date/time for temporal awareness
  - **Semantic memory recall**: Automatically searches hivemind for relevant memories on each prompt
    - Queries with prompt text, returns top 3 matches
    - Filters to high-confidence matches (score > 0.5)
    - Injects up to 2 relevant memory snippets as context
  - Uses local memory adapter wrapper for proper db type conversion

### Patch Changes

- [`109f335`](https://github.com/joelhooks/swarm-tools/commit/109f335b663be6420bfd8a471118dc283c5248c2) Thanks [@joelhooks](https://github.com/joelhooks)! - Add SKOS taxonomy extraction to hivemind memory system

  - SKOS entity taxonomy with broader/narrower/related relationships
  - LLM-powered taxonomy extraction wired into adapter.store()
  - Entity extraction now includes prefLabel and altLabels
  - New CLI commands: `swarm memory entities`, `swarm memory entity`, `swarm memory taxonomy`
  - Moltbot plugin: decay tier filtering, entity-aware auto-capture
  - HATEOAS-style hints in hivemind tool responses

- Updated dependencies [[`109f335`](https://github.com/joelhooks/swarm-tools/commit/109f335b663be6420bfd8a471118dc283c5248c2)]:
  - swarm-mail@1.11.1

## 0.60.0

### Minor Changes

- [`ff92377`](https://github.com/joelhooks/swarm-tools/commit/ff923778f4ffb2b39ab3165aaf993e9f766b97db) Thanks [@joelhooks](https://github.com/joelhooks)! - feat: Dex-inspired improvements — result field, status dashboard, doctor, commit linking, tree display

  ### swarm-mail

  - **Schema migration v10**: Added `result` TEXT and `result_at` INTEGER columns to beads table
  - **closeCell result support**: CellClosedEvent now carries optional `result` field, projections write `result`/`result_at` on close
  - **SubtaskOutcomeEvent commit field**: Added optional `commit` object (sha, message, branch) to outcome events
  - **queries-drizzle fix**: Added missing `result`/`result_at` mapping in `findCellsByPartialId`

  ### opencode-swarm-plugin

  - **`hive_close` result param**: Accepts optional `result` string — implementation summary stored on cell completion
  - **`swarm_complete` commit linking**: Auto-captures git SHA, branch, message on task completion; passes summary as `result`
  - **Status dashboard**: `swarm` with no args now shows rich dashboard (progress %, ready/blocked/completed sections, active agents)
  - **Enhanced doctor**: `swarm doctor --deep` runs 6 health checks (DB integrity, orphans, cycles, stale reservations, zombie blocked, ghost workers) with `--fix` auto-repair
  - **Tree display**: Status markers `[x]/[ ]/[~]/[!]`, blocker IDs, priority coloring, epic completion %, ANSI-aware truncation

### Patch Changes

- Updated dependencies [[`ff92377`](https://github.com/joelhooks/swarm-tools/commit/ff923778f4ffb2b39ab3165aaf993e9f766b97db), [`cbdfcdb`](https://github.com/joelhooks/swarm-tools/commit/cbdfcdbc381d607005ad671dde334a5f205dccb6)]:
  - swarm-mail@1.11.0

## 0.59.5

### Patch Changes

- fix(hivemind): add input validation for hivemind_find query parameter

  Fixes TypeError when Claude calls hivemind_find with empty input `{}`.

  **Defense in depth:**

  - hivemind-tools.ts: Early validation returns user-friendly error JSON
  - memory.ts: Throws at adapter boundary (fail fast)
  - store.ts: Returns empty array (graceful degradation)

  Added 3 test cases for missing/empty/whitespace query parameters.

## 0.59.4

### Patch Changes

- docs(swarm): add mandatory hivemind steps for custom worker prompts
  - Added section 6.5 "Custom Prompts: MANDATORY Sections"
  - Custom prompts must include hivemind_find queries and hivemind_store steps

## 0.59.3

### Patch Changes

- feat(swarm): require user confirmation for branch/PR creation
  - Step 3: Confirm feature branch creation
  - Step 11: Confirm PR creation

## 0.59.2

### Patch Changes

- fix(swarmmail): auto-normalize escaped paths in reserve/release tools
  - LLMs escaping `[slug]` and `(content)` now auto-corrected
  - Added worker prompt guidance about Next.js path handling

## 0.59.1

### Patch Changes

- docs(swarm): comprehensive coordinator instructions with mandatory hivemind usage

  - Added visual boxes for GOOD/BAD coordinator behavior patterns
  - FORBIDDEN EXCUSES box prevents "too small for swarm" refusals
  - Mandatory hivemind_find before decomposition, hivemind_store after
  - Context preservation rules (delegate planning to subagent)
  - Inbox monitoring every 5-10 min requirement
  - ASCII art session summary required
  - Planning modes: --fast, --auto, --confirm-only

## 0.59.0

### Minor Changes

- [`8badfe8`](https://github.com/joelhooks/swarm-tools/commit/8badfe8a13324f278b22e35891590f2e84c9cd0e) Thanks [@joelhooks](https://github.com/joelhooks)! - feat(observability): wire linkOutcomeToTrace for quality_score population

  When workers complete via swarm_complete, the outcome event is now linked
  back to its decision trace, enabling quality_score calculation. This fixes
  the 0% success rate previously shown in `swarm stats` and `swarm o11y`.

  New functions:

  - `findDecisionTraceByBead()` - look up decision traces by bead ID
  - `linkOutcomeToDecisionTrace()` - helper to link outcomes to traces

### Patch Changes

- Updated dependencies [[`8badfe8`](https://github.com/joelhooks/swarm-tools/commit/8badfe8a13324f278b22e35891590f2e84c9cd0e)]:
  - swarm-mail@1.10.3

## 0.58.4

### Patch Changes

- [`7d9bf32`](https://github.com/joelhooks/swarm-tools/commit/7d9bf320a6cc5fea03c66f79e9bb61023af16d99) Thanks [@joelhooks](https://github.com/joelhooks)! - fix: add defensive validation with helpful error hints to swarm tools

  - Add null checks to swarm_complete, swarm_progress, swarm_decompose, swarm_validate_decomposition, hive_create_epic
  - Return friendly error messages with examples when required params are missing
  - Improve tool descriptions with workflow hints and required param lists
  - Fix subprocess cleanup with try-finally patterns in hive.ts, skills.ts, storage.ts, tool-availability.ts
  - Add 30s timeout to execSemanticMemory to prevent hanging
  - Add error state tracking to FlushManager

- [`ef6d21d`](https://github.com/joelhooks/swarm-tools/commit/ef6d21de5ae445bb5070f279e5559f1d2499eb49) Thanks [@joelhooks](https://github.com/joelhooks)! - fix(decompose): handle object and double-stringified response in swarm_validate_decomposition

  MCP server may pass response as already-parsed object (not string) when Claude provides the decomposition. Now handles both string and object inputs, plus the edge case of double-stringified JSON.

## 0.57.6

### Patch Changes

- [`9ce3e70`](https://github.com/joelhooks/swarm-tools/commit/9ce3e70a614c75119fd1847ce3dde56bf8f7f2d4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## MCP Server: CommonJS Build for Claude Code Compatibility

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

- [`7f88a03`](https://github.com/joelhooks/swarm-tools/commit/7f88a0394a8d433b32cba8480423c4eb2397a1a8) Thanks [@joelhooks](https://github.com/joelhooks)! - > "The easiest and cheapest way to prevent bad neighborhoods from getting worse is to fix broken windows in abandoned buildings." — _Rails as She Is Spoke_

      \_/

  (o o) "Entry point on disk."
  /|\_|\

  ## 🐝 MCP Entrypoint Ships in Repo

  Committed the built JavaScript MCP entrypoint so GitHub clone installs can run the MCP server without a build step.

  **Why it matters:** prevents missing-file errors when OpenCode launches MCP tooling from a fresh clone.

  **Impact:** smoother onboarding and reliable `swarm mcp` runs in local dev.

  **Backward compatible:** existing npm installs and configs continue to work.

- [`7f88a03`](https://github.com/joelhooks/swarm-tools/commit/7f88a0394a8d433b32cba8480423c4eb2397a1a8) Thanks [@joelhooks](https://github.com/joelhooks)! - > "When you improve code, you have to test to verify that it still works." — Martin Fowler, _Refactoring_

  ## 🧩 MCP JS Entrypoint for Git Clone Installs

  The Claude marketplace now launches a committed JS MCP entrypoint from `claude-plugin/bin`, so GitHub-cloned installs work without a build step.

  **What changed**

  - Bundled JS entrypoint committed at `claude-plugin/bin/swarm-mcp-server.js`
  - Build script keeps the JS entrypoint in sync
  - Tests updated to assert the manifest uses the JS entrypoint

  **Why it matters**

  - Fixes MCP startup when marketplace clones the repo (no `dist/`)

  **Compatibility**

  - No API changes; existing installs keep working

## 0.57.3

### Patch Changes

- [`95a0d33`](https://github.com/joelhooks/swarm-tools/commit/95a0d33398c5336f52daf107d515c24e3b7f51a9) Thanks [@joelhooks](https://github.com/joelhooks)! - > "All you do is create each of these parts in turn which makes it easier to complete." — Jim Edwards, _Copywriting Secrets: How Everyone Can Use the Power of Words to Get More Clicks, Sales, and Profits_

  ## 🧭 MCP Launcher Fix

  The MCP launcher now targets the bundled server artifact at runtime so marketplace installs no longer depend on repo-relative paths.

  **What changed**

  - Launcher resolves the `dist/mcp` bundle for MCP server startup
  - Missing bundle errors surface earlier during setup

  **Why it matters**

  - Claude Code marketplace installs start MCP tools reliably
  - Fewer "missing file" failures after upgrading

  **Compatibility**

  - No API changes

- Updated dependencies [[`95a0d33`](https://github.com/joelhooks/swarm-tools/commit/95a0d33398c5336f52daf107d515c24e3b7f51a9)]:
  - swarm-mail@1.10.2

## 0.57.2

### Patch Changes

- Updated dependencies [[`07391fc`](https://github.com/joelhooks/swarm-tools/commit/07391fc2c664b800aeb41159f7815eea40210878)]:
  - swarm-mail@1.10.1

## 0.57.1

### Patch Changes

- [`d4ae604`](https://github.com/joelhooks/swarm-tools/commit/d4ae6041be8437972c2a78d5d68af6f63d82f3a5) Thanks [@joelhooks](https://github.com/joelhooks)! - > "In other areas, new technology presented both new solutions and new problems for our systems." — Sam Newman, _Building Microservices (2nd ed.)_

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

- [`d5cf909`](https://github.com/joelhooks/swarm-tools/commit/d5cf909947db9a6a778e398c3b71884f0590a588) Thanks [@joelhooks](https://github.com/joelhooks)! - > "When you improve code, you have to test to verify that it still works." — Martin Fowler, Refactoring

  ## 🛡️ MCP Packaging Hardening

  Marketplace installs now fail fast and loudly when the Claude MCP runtime bundle is missing, and CI validates tarballs before publish.

  **What changed**

  - MCP runtime resolution requires `claude-plugin/dist` (actionable error if missing)
  - Claude plugin asset copy now guards against missing `dist`
  - CI/publish verify packed artifacts for `opencode-swarm-plugin` and `swarm-mail`

  **Why it matters**

  - Prevents silent MCP failures in marketplace installs
  - Catches broken tarballs before release

  **Compatibility**

  - No API changes; existing installs keep working once rebuilt

## 0.57.0

### Minor Changes

- [`a6ae4e5`](https://github.com/joelhooks/swarm-tools/commit/a6ae4e5a6f83f26051c2c058114bae33ef38089d) Thanks [@joelhooks](https://github.com/joelhooks)! - > "Smart defaults can help people answer questions by putting default selections in place that serve the interests of most people."

  > — Web Form Design: Filling in the Blanks

  ## Default model switch to openai/gpt-5.2-codex

  Opencode now defaults to `openai/gpt-5.2-codex` for swarm coordination instead of the previous model. The goal is a more consistent out-of-the-box baseline for OpenCode users, aligned with current model availability and performance.

  **Impact**: New sessions that do not explicitly set a model will start with `openai/gpt-5.2-codex` as the default.

  **Compatibility**: Any existing configuration that pins a different model continues to take precedence; no migration is required.

- [`a6ae4e5`](https://github.com/joelhooks/swarm-tools/commit/a6ae4e5a6f83f26051c2c058114bae33ef38089d) Thanks [@joelhooks](https://github.com/joelhooks)! - > "They can be applied again and again in similar situations to help you achieve your goals."

  > — Principles: Life and Work

  ## Enforce reservation TTLs and release-all guardrails

  Swarm reservations now require explicit `ttl_seconds` and release-on-done behavior via `swarm_complete()` to prevent stale locks.

  **Impact**: Workers must pass `ttl_seconds` when reserving files and should rely on completion cleanup; `swarmmail_release_all` is restricted to coordinators for orphaned lock recovery.

  **Compatibility**: Existing calls without `ttl_seconds` must be updated; other workflows are unaffected.

## 0.56.1

### Patch Changes

- [`0568455`](https://github.com/joelhooks/swarm-tools/commit/0568455272bda4502c368d783f8a4c10145267eb) Thanks [@joelhooks](https://github.com/joelhooks)! - > "Tasks should be composable to more complex tasks." — _Dynamic State Charts: Composition and Coordination of Complex Robot Behavior_

       [swarm]--[swarm]--[swarm]
            \         /
             \       /
              [hive]

  ## Prompts Use Swarm Tools Only

  Swarm prompts and skills now reference only `hive_*`, `swarmmail_*`, `swarm_*`, and `hivemind_*` tools. Deprecated `bd`, `cass`, and `semantic_memory` references are removed to keep coordination consistent.

  **What changed**

  - Updated swarm coordination skill and prompt templates to use `hivemind_*` for memory.
  - Removed deprecated tool names from prompts and added test coverage.

  **Why it matters**

  - Ensures Claude Code plugin guidance matches the supported toolchain.
  - Prevents drifting into deprecated interfaces that no longer exist.

  **Backward compatible:** No API changes; guidance and prompts only.

## 0.56.0

### Minor Changes

- [`3e0f222`](https://github.com/joelhooks/swarm-tools/commit/3e0f222c277f55b0bd2050af46a7fe70e8e09dcd) Thanks [@joelhooks](https://github.com/joelhooks)! - > "How we can design tools that achieve these goals is explained in the rest of this paper, through a description of design patterns and case studies that tested them." — _Casual Creators: Design Patterns for Autotelic Creativity Tools_

               .-.
              (o o)
              | O |   Claude Code, meet Swarm.
               '-'

  ## 🐝 Claude Code Plugin, Fully Wired

  This release ships the complete Claude Code plugin experience: the plugin bundle, MCP auto-launch, CLI helpers, hooks, agents/skills, and tests—ready for marketplace install or local dev.

  **What changed**

  - Added bundled Claude Code plugin assets (`.claude-plugin`, commands, agents, skills, hooks, MCP/LSP configs).
  - Implemented MCP server entrypoint + packaging so Claude auto-launches the tools.
  - Added `swarm claude` CLI helpers and debug-only `swarm mcp-serve`.
  - Added tests for MCP wiring, hooks, and CLI behavior.
  - Documented `/plugin` install and `--plugin-dir` dev flow in READMEs.

  **Why it matters**

  - One install path for Claude Code + OpenCode without extra manual setup.
  - Auto-launched MCP servers make the plugin feel native and frictionless.
  - Hooks provide consistent session context for swarm coordination.

  **Backward compatible**: Existing OpenCode workflows remain unchanged; Claude features are additive only.

## 0.55.0

### Minor Changes

- [`8959148`](https://github.com/joelhooks/swarm-tools/commit/89591483bbc83d1cacd539666e4ceeee015d0007) Thanks [@joelhooks](https://github.com/joelhooks)! - > "In addition, there is a huge variation in quality and productivity among programmers, but we have made little attempt to understand what makes the best programmers so much better or to teach those skills in our classes." — John Ousterhout, _A Philosophy of Software Design_

              .-.
             (o o)   "Release the hive."
             | O |
              '-'

  ## 🐝 Coordinator Reservation Overrides

  - Add `releaseAllSwarmFiles` + `releaseSwarmFilesForAgent` admin paths for coordinator recovery.
  - Extend `file_released` events with `release_all` and `target_agent` for precise cleanup.
  - Expose `swarmmail_release_all` and `swarmmail_release_agent` in plugin + wrapper template.

  ## 🧹 UBS Reference Cleanup

  - Remove UBS references from prompts, doctor guidance, and docs.
  - Drop UBS availability checks from swarm init/tool availability.

  **Backward compatible:** existing `swarmmail_release` behavior is unchanged for workers.

### Patch Changes

- [`efade3a`](https://github.com/joelhooks/swarm-tools/commit/efade3afd07d454e477023872e284dcd3967e3b5) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Fix: Correct global skills directory path

  Fixes `swarm doctor` and `swarm config` to check the correct global skills directory path.

  **Before:** `~/.config/opencode/skills` (plural - wrong)
  **After:** `~/.config/opencode/skill` (singular - correct)

  This aligns the CLI with the actual skills system implementation.

  Thanks @JungHoonGhae for the fix! 🐝

- Updated dependencies [[`8959148`](https://github.com/joelhooks/swarm-tools/commit/89591483bbc83d1cacd539666e4ceeee015d0007)]:
  - swarm-mail@1.10.0

## 0.54.2

### Patch Changes

- [`42ac262`](https://github.com/joelhooks/swarm-tools/commit/42ac26268d4ac97ce814f7ecf80108efc5d72e73) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Fix: Remove stale `created_at` column references

  Fixes `SQLITE_ERROR: table events has no column named created_at` that occurred during database migrations.

  **What happened:** The events table schema was updated to remove `created_at`, but migration code and schema checks still referenced it.

  **Fixed locations:**

  - `auto-migrate.ts` - migration column checks
  - `libsql-schema.ts` - required columns validation
  - `streams.ts` - schema definitions

  No data migration needed - the column never existed in production databases.

- Updated dependencies [[`42ac262`](https://github.com/joelhooks/swarm-tools/commit/42ac26268d4ac97ce814f7ecf80108efc5d72e73)]:
  - swarm-mail@1.9.3

## 0.54.1

### Patch Changes

- Updated dependencies [[`6e9538d`](https://github.com/joelhooks/swarm-tools/commit/6e9538d95bebac8817feec6c3d52053fc5e8bd2b)]:
  - swarm-mail@1.9.2

## 0.54.0

### Minor Changes

- [`d6ca070`](https://github.com/joelhooks/swarm-tools/commit/d6ca07079420328ee607d769127bcc88e2fdb509) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 The Hive Learns From Its Mistakes

  ```
       ___
      /   \    "Pattern failed 4 times..."
     | o o |   "...make that 5."
      \ ~ /    "AVOID: Split by file type"
       |||
      /   \
  ```

  The learning system feedback loop is now fully wired. Patterns that consistently fail get auto-deprecated so future swarms don't repeat the same mistakes.

  **What changed:**

  ### Anti-Pattern Auto-Deprecation (opencode-swarm-plugin)

  - `swarm_complete` now extracts decomposition patterns from epic descriptions
  - Records success/failure observations via `recordPatternObservation()`
  - Patterns exceeding 60% failure rate auto-invert to anti-patterns with "AVOID:" prefix
  - Response includes `pattern_observations` with extracted patterns and any inversions

  ### Migration Fix (swarm-mail)

  - Fixed stale `created_at` column reference in events table migration
  - Resolves: `SQLITE_ERROR: table events has no column named created_at`

  ### CLI Bundling (opencode-swarm-plugin)

  - CLI now bundles `swarm-mail` directly instead of marking it external
  - Prevents version mismatch when globally installed via npm
  - CLI size: 4.71 MB → 13.57 MB (acceptable tradeoff for reliability)

  **Why it matters:**

  - Swarms now learn from failures automatically
  - Bad decomposition strategies get flagged before they waste more time
  - The 60% threshold + 3 observation minimum prevents hasty deprecation

  > "The definition of insanity is doing the same thing over and over and expecting different results."
  > — _Not actually Einstein, but the swarm agrees_

### Patch Changes

- Updated dependencies [[`d6ca070`](https://github.com/joelhooks/swarm-tools/commit/d6ca07079420328ee607d769127bcc88e2fdb509)]:
  - swarm-mail@1.9.1

## 0.53.0

### Minor Changes

- [`6cbf39a`](https://github.com/joelhooks/swarm-tools/commit/6cbf39ac3bfaaf6e9271a2f7bcc4a76f94e03ace) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔬 The Hive Learns to See Itself

  ```
          🐝 → 📊 → 🧠
         /         \
      Events     Insights
        |           |
     [Log DB] → [Analytics]
        |           |
     Capture    Understand
  ```

  > "Observability is about instrumenting your system in a way that ensures that sufficient information about a system's runtime is collected and analyzed so that when something goes wrong, it can help you understand why."
  >
  > — _AI Engineering: Building Applications with Foundation Models_

  The swarm is getting smarter about watching itself work. This release adds deep analytics, proper logging, and visibility into what actually happens when agents coordinate. No more flying blind.

  ***

  ### 🐛 CRITICAL FIX: Plugin Wrapper Module Resolution

  **The Bug:** Plugin wrapper imported `captureCompactionEvent` from swarm-mail → transitive deps (`evalite`) not available in OpenCode context → trace trap → crash.

  **The Fix:** Inlined the capture logic directly into the plugin wrapper template. No imports, no deps, no crash.

  **Why it matters:** The plugin wrapper must be **DUMB**. All smarts live in the CLI (where deps are safe). This was the last violation of that rule. Plugin now survives context compaction without exploding.

  ***

  ### 📝 Date-Stamped Logging with Rotation

  **What changed:**

  - Logs now live in `~/.config/swarm-tools/logs/YYYY-MM-DD.log`
  - Daily rotation (one file per day, keeps last 7 days)
  - `swarm log` CLI command to view/filter logs

  **Why it matters:**
  Before this, debug output vanished into the void. Now coordinators and workers leave a trail. When a swarm fails at 2am, you can replay the sequence. Logs are indexed by day, so you can diff "what happened yesterday vs today."

  **Example:**

  ```bash
  # View today's logs
  swarm log

  # Filter by level
  swarm log --level error

  # Watch mode
  swarm log --watch
  ```

  ***

  ### 🎯 Strategy Diversification

  **What changed:**

  - Added keywords for **file-based** strategy: "CRUD", "schema", "API route", "component", "utility"
  - Added keywords for **risk-based** strategy: "refactor", "breaking", "migration", "auth", "payment"

  **Why it matters:**
  The swarm was over-indexing on feature-based decomposition. Now it recognizes when work is naturally file-scoped (CRUD endpoints) or risk-scoped (auth changes that need isolation). Better strategy selection = less conflict, faster completion.

  ***

  ### ⚡ Compaction Tuning

  **What changed:**

  - Narrowed activity detection window: 10 messages → 5 messages
  - Added tool call boosting: messages with tool calls get 2x weight
  - Made compaction prompt dumps opt-in: `swarm stats --compaction-prompts`

  **Why it matters:**
  Context compaction was too conservative - waiting until 10 messages of silence before triggering. Now it fires faster (5 messages) but weighs tool activity higher (an agent editing files is more "active" than chatting). The prompt dumps were noisy, so they're now hidden unless you ask.

  **Compaction is the difference between a swarm that finishes and one that exhausts context mid-flight.**

  ***

  ### 📊 Rejection Analytics

  **What changed:**

  - Added `swarm stats --rejections` flag to surface coordinator review rejections

  **Why it matters:**
  The 3-strike rule exists to catch architectural problems early. Now you can see which tasks are burning review attempts and why. If a subtask gets rejected 3 times, it's not "worker skill issue" - it's a signal that the decomposition was wrong or the epic's requirements are unclear.

  ***

  ### 📚 Research Reports

  This release includes deep analysis:

  - **Database audit** - Found and documented 7 stray database paths, all migrated to global DB
  - **Eval analysis** - Coordinator evals now test REAL sessions, not synthetic prompts
  - **Rejection patterns** - Analyzed what causes review failures (incomplete work, scope creep, missing tests)

  **Why it matters:**
  The swarm plugin learns from outcomes. These reports capture what we learned so the NEXT swarm is smarter.

  ***

  ### Migration Notes

  **No breaking changes.** All new features are opt-in or backwards-compatible.

  If you see `captureCompactionEvent` import errors in the plugin wrapper, update to this version - the inline fix is mandatory for stability.

  ***

  ### What's Next?

  - **Semantic search over logs** - query "show me all file conflicts in the last week"
  - **Real-time dashboard** - `swarm dashboard --live` with worker status, progress bars
  - **Outcome prediction** - "this decomposition has 80% failure rate based on history"

  The hive is learning to see. Next, it learns to predict.

## 0.52.0

### Minor Changes

- [`515b5f0`](https://github.com/joelhooks/swarm-tools/commit/515b5f0653c57698042cf1bd1c0e6f3f8b2e870c) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Session Handoff: The Hive Remembers

  ```
      ┌─────────────────────────────────────────┐
      │  SESSION 1          SESSION 2           │
      │  ┌───────┐          ┌───────┐           │
      │  │ Agent │──notes──▶│ Agent │           │
      │  │  #1   │          │  #2   │           │
      │  └───────┘          └───────┘           │
      │      │                  │               │
      │      ▼                  ▼               │
      │  "Did X, next Y,    "Got it, doing Y,   │
      │   watch out for Z"   avoiding Z..."     │
      └─────────────────────────────────────────┘
  ```

  > "A user's session resides in memory on an application server. When that server
  > goes down, the next request from the user will be directed to another server.
  > Obviously, we would like that transition to be as seamless as possible."
  > — Michael Nygard, _Release It!_

  Agents are ephemeral. Context is not. Session handoff ensures the next agent picks up where you left off.

  **New Tools:**

  - `hive_session_start` - Start session, receive previous handoff notes
  - `hive_session_end` - End session with notes for the next agent

  **New CLI Commands:**

  - `swarm session start` - Start a session
  - `swarm session end` - End with handoff notes
  - `swarm session status` - Check current session
  - `swarm session history` - List recent sessions

  **Schema:** Migration v9 adds `sessions` table with handoff_notes, timestamps, and cell linkage.

  **Usage:**

  ```typescript
  // At session start
  const { previous_handoff } = await hive_session_start({
    active_cell_id: "bd-123",
  });
  // previous_handoff: "Completed auth flow. Next: add tests. Watch out for token refresh race condition."

  // At session end
  await hive_session_end({
    handoff_notes:
      "Added 12 tests. All passing. Next: wire into CI. The mock server needs HTTPS.",
  });
  ```

  **Credit:** Chainlink session management pattern by [@dollspace-gay](https://github.com/dollspace-gay/chainlink)

### Patch Changes

- Updated dependencies [[`515b5f0`](https://github.com/joelhooks/swarm-tools/commit/515b5f0653c57698042cf1bd1c0e6f3f8b2e870c)]:
  - swarm-mail@1.9.0

## 0.51.0

### Minor Changes

- [`1e71320`](https://github.com/joelhooks/swarm-tools/commit/1e713201c7579c3339603e12980588fc8c1aab98) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Standing on the Shoulders of Giants

  > "If I have seen further, it is by standing on the shoulders of giants."
  > — Sir Isaac Newton

  ```
      ┌─────────────────────────────────────────────────────────────┐
      │                                                             │
      │     C H A I N L I N K   I N S P I R E D                     │
      │                                                             │
      │   Session Handoff • Stub Detection • Tree View • Adversary  │
      │                                                             │
      └─────────────────────────────────────────────────────────────┘
                      \
                       \   🐝
                        \  ╱╲
                         ╲╱  ╲
                          ╲  ╱
                           ╲╱
  ```

  ### Session Handoff Notes

  Chainlink-inspired session management with handoff notes for context preservation across sessions.

  **New CLI commands:**

  - `swarm session start` - Start a new session with optional handoff notes
  - `swarm session end` - End session with summary and handoff notes
  - `swarm session status` - Show current session status
  - `swarm session history` - List recent sessions

  **New API:**

  - `SessionAdapter` interface with 5 methods
  - Schema migration v9 adds sessions table

  ### UBS Stub Detection

  15 patterns adapted from Chainlink's `post-edit-check.py` for detecting incomplete code:

  - TODO, FIXME, XXX, HACK comments
  - Empty function bodies (`pass`, `...`)
  - Language-specific stubs (`unimplemented!()`, `todo!()`)
  - Placeholder returns with stub comments

  ### Tree View CLI

  `swarm tree` command with ASCII visualization:

  ```
  Feature Epic [epic] ○ P1
  ├── Subtask 1 [task] ◐ P2
  ├── Subtask 2 [task] ● P2
  └── Subtask 3 [task] ⊘ P2
  ```

  **Status indicators:** ○ open, ◐ in_progress, ● closed, ⊘ blocked

  ### Adversarial Reviewer (Sarcasmotron)

  VDD-style hostile reviewer with zero tolerance for slop:

  - **Fresh context per review** - prevents "relationship drift"
  - **HALLUCINATING verdict** - when adversary invents issues, code is zero-slop
  - **Hostile tone** - no participation trophies

  **Credits:**

  - [Chainlink](https://github.com/dollspace-gay/chainlink) by @dollspace-gay
  - [VDD](https://github.com/Vomikron/VDD) by @Vomikron

### Patch Changes

- Updated dependencies [[`1e71320`](https://github.com/joelhooks/swarm-tools/commit/1e713201c7579c3339603e12980588fc8c1aab98)]:
  - swarm-mail@1.8.0

## 0.50.0

### Minor Changes

- [#113](https://github.com/joelhooks/swarm-tools/pull/113) [`5617c76`](https://github.com/joelhooks/swarm-tools/commit/5617c769fa08a1027d53061d151b7c8273cb88f4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## The Hive Remembers: File History Warnings in Worker Prompts

  > "A second level of learning makes use of positive feedback and questions the very
  > parameters by which the system operates."
  > — Reframing Business: When the Map Changes the Landscape

  ```
                      .---.
                     /     \
                    | () () |
                     \  ^  /    "I see 3 workers before me
                      |||||      failed on null checks here..."
                     /|||||\
                    (_______)
                       |||
                ⚠️ FILE HISTORY ⚠️
  ```

  Workers now receive historical rejection data for their assigned files, surfacing
  institutional knowledge at the point of need.

  **What changed:**

  - `getFileGotchas()` queries hivemind for file-specific learnings (top 3, truncated to 100 chars)
  - `getWorkerInsights()` now uses global DB path (`~/.config/swarm-tools/swarm.db`)
  - `getFileFailureHistory()` wired into prompt generation flow
  - Workers see `⚠️ FILE HISTORY WARNINGS:` section when files have rejection history

  **Example output in worker prompts:**

  ```
  ⚠️ FILE HISTORY WARNINGS:
  - src/auth.ts: 3 previous workers rejected for missing null checks, forgot rate limiting
  - src/api/client.ts: 2 previous workers rejected for rate limiting not implemented
  ```

  **Why it matters:**

  Workers often repeat mistakes that previous workers made on the same files. Now the
  swarm learns from its failures and warns future workers before they make the same
  mistakes. First-attempt success rate should improve.

  **Tests:** 8 new integration tests covering the full flow.

## 0.49.0

### Minor Changes

- [`5d5c403`](https://github.com/joelhooks/swarm-tools/commit/5d5c4032dbdd3db87405c2f65ccb3b5aaeb02f1a) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Coordinator Guardrails & Hivemind Resilience

  ```
      _______________
     /               \
    |  COORDINATORS   |
    |  SHALL NOT PASS |
     \_______________/
           |||
      ╔════╧╧╧════╗
      ║  RUNTIME  ║
      ║   GUARD   ║
      ╚═══════════╝
  ```

  > "The best way to have a good idea is to have lots of ideas and throw away the bad ones."
  > — Linus Pauling (via pdf-brain on iterative refinement)

  ### Coordinator Violation Prevention (19.6% → target <5%)

  **Prompt Engineering:**

  - Added explicit NEVER/ONLY rules with box-drawing visual prominence
  - Concrete violation examples: `read()`, `edit()`, `bash("test")`, `swarmmail_reserve`
  - Correct delegation examples showing `swarm_spawn_subtask` pattern

  **Runtime Guard (`coordinator-guard.ts`):**

  - `CoordinatorGuardError` thrown when coordinators attempt forbidden operations
  - Detects file edits, test execution, and file reservations
  - Helpful error messages with suggestions for correct approach
  - Workers pass through unimpeded

  **Violation Metrics:**

  - `trackCoordinatorViolation()` records violations to event store
  - `getViolationAnalytics()` aggregates violation rates by type
  - Ready for integration with `swarm health` dashboard

  ### Hivemind Resilience

  **FTS Fallback (fixes Josh Wood's bug report):**

  - `hivemind_find` now gracefully falls back to full-text search when Ollama unavailable
  - Response includes `fallback_used: true` indicator
  - No more "Connection failed" errors when Ollama isn't running

  **Invalid Date Fix:**

  - Fixed null/undefined date handling in `store.ts`
  - `new Date(null)` no longer creates Invalid Date
  - Proper fallback to current timestamp for missing dates

  ### Breaking Changes

  None - all changes are additive or fix existing bugs.

### Patch Changes

- Updated dependencies [[`5d5c403`](https://github.com/joelhooks/swarm-tools/commit/5d5c4032dbdd3db87405c2f65ccb3b5aaeb02f1a)]:
  - swarm-mail@1.7.2

## 0.48.1

### Patch Changes

- [`cd1b62e`](https://github.com/joelhooks/swarm-tools/commit/cd1b62ebe5be3aadd768f22109a3ecd461d2e920) Thanks [@joelhooks](https://github.com/joelhooks)! - ## swarm_complete now reports accurate reservation release status

  ```
      🐝 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🐝

           ╭──────────────────────────────────────────────╮
           │  RESERVATION RELEASE TRACKING IMPROVED       │
           │                                              │
           │  Before: reservations_released: true (lie)   │
           │  After:  reservations_released: false        │
           │          reservations_released_count: 0      │
           │          reservations_release_error: "..."   │
           ╰──────────────────────────────────────────────╯

      🐝 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🐝
  ```

  **What changed:**

  `swarm_complete` now accurately reports the reservation release outcome:

  - `reservations_released`: boolean - whether release succeeded
  - `reservations_released_count`: number - how many reservations were released
  - `reservations_release_error`: string | undefined - error message if release failed

  Previously, `reservations_released` was hardcoded to `true` even when the release failed silently.

  **Why it matters:**

  Coordinators and debugging tools can now see the actual state of file reservations after task completion. This helps diagnose coordination issues where files remain locked unexpectedly.

  **Tests added:**

  - Verify reservation release allows other agents to reserve the same files
  - Verify "release all" pattern (no paths specified) works correctly - this is how `swarm_complete` calls `releaseSwarmFiles`

  > "Make the implicit explicit." — Kent Beck

- Updated dependencies [[`cd1b62e`](https://github.com/joelhooks/swarm-tools/commit/cd1b62ebe5be3aadd768f22109a3ecd461d2e920)]:
  - swarm-mail@1.7.1

## 0.48.0

### Minor Changes

- [`923a5c5`](https://github.com/joelhooks/swarm-tools/commit/923a5c5f992a00fa52e97e18fcb0cb5a35cbc539) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🧠 Hivemind Tools Now Accessible

  > "The palest ink is better than the best memory." — Chinese Proverb

  Wired the hivemind unified memory system through CLI and plugin wrapper, making it accessible to OpenCode agents.

  **CLI Commands Added:**

  ```bash
  swarm memory store <info> [--tags]     # Store a learning
  swarm memory find <query> [--limit]    # Search memories (semantic + FTS)
  swarm memory get <id>                  # Get specific memory
  swarm memory remove <id>               # Delete memory
  swarm memory validate <id>             # Reset 90-day decay timer
  swarm memory stats                     # Database statistics
  swarm memory index                     # Index AI session directories
  swarm memory sync                      # Sync to .hive/memories.jsonl
  ```

  **Plugin Wrapper Tools:**

  - `hivemind_store` - Store learnings with tags
  - `hivemind_find` - Search across all memories and sessions
  - `hivemind_get` - Retrieve specific memory by ID
  - `hivemind_remove` - Delete outdated memories
  - `hivemind_validate` - Confirm accuracy (resets decay)
  - `hivemind_stats` - Memory database health
  - `hivemind_index` - Index session directories
  - `hivemind_sync` - Git-sync memories

  **To update your plugin:**

  ```bash
  swarm setup --reinstall
  ```

  **Why this matters:**

  - Agents can now query past learnings before starting work
  - Learnings persist across sessions with 90-day decay
  - Semantic search finds relevant memories even with different wording
  - Git-synced memories enable team knowledge sharing

## 0.47.0

### Minor Changes

- [`ef274d7`](https://github.com/joelhooks/swarm-tools/commit/ef274d783d56c291f19e55a7616d0b72e7ac4c70) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Bun Runtime Required + LLM-Powered AGENTS.md Updates

  > "The best tool is the one that gets out of your way." — Every frustrated regex maintainer

  ### Breaking Change: Bun Runtime Required

  The CLI now requires Bun runtime. The shebang changed from `#!/usr/bin/env node` to `#!/usr/bin/env bun`.

  **Why?** The codebase uses Bun-specific APIs (`Bun.spawn`, `Bun.$`, `Bun.file`) throughout. Running under Node.js caused cryptic "Bun is not defined" errors.

  **Install Bun:**

  ```bash
  curl -fsSL https://bun.sh/install | bash
  # or
  brew install oven-sh/bun/bun
  ```

  ### New: `swarm doctor` Shows Bun Status

  ```
  ◇  Required dependencies:
  │
  ◆  Bun v1.3.6
  ◆  OpenCode v0.0.0
  ```

  ### New: `swarm agents` Uses LLM for Updates

  Instead of brittle regex replacements, `swarm agents` now calls `opencode run` to intelligently update your AGENTS.md:

  - Renames tool references (cass*\* → hivemind*\_, semantic-memory\_\_ → hivemind\_\*)
  - Consolidates CASS + Semantic Memory sections into unified Hivemind section
  - Updates prose to use Hivemind terminology
  - Preserves existing structure

  ```bash
  swarm agents        # Interactive
  swarm agents --yes  # Non-interactive
  ```

  ### ADR-011: Hivemind Unification

  All memory tools are now unified under the `hivemind_*` namespace:

  | Old                        | New                 |
  | -------------------------- | ------------------- |
  | `cass_search`              | `hivemind_find`     |
  | `cass_view`                | `hivemind_get`      |
  | `semantic-memory_store`    | `hivemind_store`    |
  | `semantic-memory_find`     | `hivemind_find`     |
  | `semantic-memory_validate` | `hivemind_validate` |

  The hive remembers everything. 🐝

## 0.46.0

### Minor Changes

- [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a) Thanks [@joelhooks](https://github.com/joelhooks)! - ## The Hive Remembers Everything

  ```
                      🧠
                     /  \
                    /    \      "One mind to remember them all,
                   / HIVE \      one mind to find them,
                  / MIND   \     one mind to bring them all
                 /          \    and in the context bind them."
                /____________\
                     |||
           ┌────────┴┴┴────────┐
           │                   │
      ┌────┴────┐         ┌────┴────┐
      │ Learnings│         │ Sessions │
      │ (manual) │         │ (indexed)│
      └────┬────┘         └────┬────┘
           │                   │
           └─────────┬─────────┘
                     ▼
              ┌─────────────┐
              │  memories   │  ← Same table
              │   table     │  ← Same vectors
              │  (libSQL)   │  ← Same search
              └─────────────┘
  ```

  > _"The palest ink is better than the best memory."_ — Chinese Proverb

  ### ADR-011: Hivemind Memory Unification

  **15 tools → 8 tools.** Sessions and learnings are now unified under one namespace.

  **What changed:**

  | Old Tool                   | New Tool                            |
  | -------------------------- | ----------------------------------- |
  | `semantic-memory_store`    | `hivemind_store`                    |
  | `semantic-memory_find`     | `hivemind_find`                     |
  | `semantic-memory_get`      | `hivemind_get`                      |
  | `semantic-memory_remove`   | `hivemind_remove`                   |
  | `semantic-memory_validate` | `hivemind_validate`                 |
  | `cass_search`              | `hivemind_find` (collection filter) |
  | `cass_view`                | `hivemind_get`                      |
  | `cass_index`               | `hivemind_index`                    |
  | `cass_stats`               | `hivemind_stats`                    |
  | NEW                        | `hivemind_sync`                     |

  **Why it matters:**

  1. **No more naming collision** - External `semantic-memory` MCP was shadowing our internal tools
  2. **Unified search** - `hivemind_find` searches both learnings AND sessions in one query
  3. **Collection filter** - `collection: "claude"` for Claude sessions, `collection: "default"` for learnings
  4. **Simpler mental model** - Sessions ARE memories, just from a different source

  **Backward compatible:** All old tool names (`semantic-memory_*`, `cass_*`) still work via deprecation aliases. They'll emit warnings but won't break.

  **Migration:** None required. Old tool names continue to work. Update at your leisure.

  **117+ tests** covering all tools, lifecycle, deprecation aliases, and integration points.

### Patch Changes

- [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔧 Test Suite Stabilization & Global Database Path

  > "The first step in fixing a broken window is to notice it."
  > — The Pragmatic Programmer

  ```
       ___________
      |  PASSING  |
      |   TESTS   |
      |___________|
           ||
      ╔════╧════╗
      ║ 1538    ║
      ║  ✓ ✓ ✓  ║
      ╚═════════╝
  ```

  ### What Changed

  **swarm-mail:**

  - `getDatabasePath()` now ALWAYS returns global path (`~/.config/swarm-tools/swarm.db`)
  - Local project databases will be auto-migrated in a future release (placeholder warning added)
  - Auto-tagger LLM tests now opt-in via `RUN_LLM_TESTS=1` (prevents flaky CI)

  **opencode-swarm-plugin:**

  - Fixed type mismatches in compaction hook (HiveAdapter → MinimalHiveAdapter)
  - Fixed eval capture in tool hooks (args not available in after hook)
  - All 425 tests passing

  ### Why Global Database?

  Single source of truth across all projects:

  - No more orphaned databases in worktrees
  - Consistent swarm state regardless of working directory
  - Simpler backup/restore story

  ### ⚠️ Breaking: Local Databases Orphaned

  Existing local databases at `{project}/.opencode/swarm.db` are **NOT migrated**.
  They remain on disk but are no longer read. A warning is logged when detected.

  **Tracked:** Cell `mjrd8cyhvnu` - Implement local-to-global DB migration

  **If you have important data in local DBs**, wait for migration tool or manually copy:

  ```bash
  # Check if you have local data
  ls -la .opencode/swarm.db
  ```

  ### Test Results

  | Package               | Pass | Skip | Fail |
  | --------------------- | ---- | ---- | ---- |
  | swarm-mail            | 1113 | 29   | 0    |
  | opencode-swarm-plugin | 425  | 0    | 0    |

- Updated dependencies [[`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a), [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a), [`e5987a7`](https://github.com/joelhooks/swarm-tools/commit/e5987a79659819d7ac91503cfe346724574a1f4a)]:
  - swarm-mail@1.7.0

## 0.45.7

### Patch Changes

- [`f6c63ac`](https://github.com/joelhooks/swarm-tools/commit/f6c63ac1e4a3cf36e66ee03d6b48b12e187a24a3) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 CLI Unicode Fixed

  ```
    BEFORE (bundled @clack):          AFTER (externalized):
    â–¡ Something went wrong            ◇ Something went wrong
    â–ˆ Checking dependencies           ◆ Checking dependencies
  ```

  The CLI was showing garbled unicode instead of proper box-drawing characters.

  **Root cause:** `@clack/prompts` detects unicode support at module load using `process.env.TERM`. When bundled, this detection happened at _build time_ on macOS, not at runtime in the user's terminal.

  **Fix:** Externalize `@clack/prompts` and its dependencies so unicode detection runs in the actual terminal environment.

## 0.45.6

### Patch Changes

- [`8b04270`](https://github.com/joelhooks/swarm-tools/commit/8b0427013f145a3b68535f3e0da134f32e04d239) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Skills Directory Auto-Migration

  OpenCode renamed `skills` → `skill` (singular). This patch handles the migration automatically.

  ```
     ~/.config/opencode/skills/     ~/.config/opencode/skill/
            ┌─────────┐                    ┌─────────┐
            │ BEFORE  │  ──swarm setup──►  │ AFTER   │
            └─────────┘                    └─────────┘
  ```

  **What happens:**

  - `swarm setup` detects old `skills` directory and renames to `skill`
  - Claude compatibility preserved (`.claude/skills` stays plural)
  - Plugin wrapper template now properly included in npm package

  No manual migration needed - just run `swarm setup`.

## 0.45.5

### Patch Changes

- [`be7b129`](https://github.com/joelhooks/swarm-tools/commit/be7b12949becd7cf32f433dca1316761c4a8bbc5) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Logger Finally Works in Global Installs

  ```
    BEFORE: pino.transport()          AFTER: pino.destination()

       ┌────────────┐                    ┌────────────┐
       │ worker     │                    │ main       │
       │ thread     │ ──CRASH──►         │ thread     │ ──WORKS──►
       │ require()  │  module not        │ sync write │
       └────────────┘  found             └────────────┘
  ```

  Fixed `unable to determine transport target for "pino-pretty"` in global installs.

  **Root cause:** `pino.transport()` spawns worker_threads that `require()` modules. In global installs (`bun install -g`), the worker can't find modules because they're hoisted to a different location than the package.

  **Fix:** Replaced `pino.transport()` with `pino.destination()`:

  - Default: stdout JSON (works everywhere)
  - `SWARM_LOG_FILE=1`: writes to `~/.config/swarm-tools/logs/swarm.log`
  - Removed pino-roll/pino-pretty from runtime (they were causing worker thread issues)

  Simple, reliable logging that works in bundled CLIs, global installs, and local dev.

## 0.45.4

### Patch Changes

- [`7c70297`](https://github.com/joelhooks/swarm-tools/commit/7c702977cde5a382e8a602846b4f2adad66f72d4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🪵 pino-roll Now Works in Bundled CLI

  ```
    pino.transport()
         │
         ▼
    ┌─────────────┐      ┌─────────────┐
    │ worker_     │ ──►  │ require()   │ ──► pino-roll ✓
    │ threads     │      │ at runtime  │
    └─────────────┘      └─────────────┘
  ```

  Fixed `unable to determine transport target for "pino-pretty"` error.

  **Root cause:** `pino.transport()` spawns worker_threads that dynamically `require()` transport modules at runtime. When bundled, these modules couldn't be resolved because they were inlined into the bundle.

  **Fix:** Added `pino-roll` and `pino-pretty` to build externals. Now they're resolved from `node_modules` at runtime instead of being bundled.

  Logs now correctly write to `~/.config/swarm-tools/logs/` with daily rotation.

## 0.45.3

### Patch Changes

- [`59ccb55`](https://github.com/joelhooks/swarm-tools/commit/59ccb55fc6a9c9537705ac2a7c25586d294ba459) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔧 CLI No Longer Chokes on Missing Evalite

  ```
    BEFORE                           AFTER
      ┌──────────┐                    ┌──────────┐
      │ swarm    │                    │ swarm    │
      │ setup    │ ──ERROR──►         │ setup    │ ──WORKS──►
      │          │  evalite/runner    │          │
      └──────────┘  not found         └──────────┘
  ```

  Fixed `Cannot find module 'evalite/runner'` error when running `swarm` CLI after npm install.

  **Root cause:** `evalTools` was imported in the main plugin bundle, but `evalite` is a devDependency not available in production installs.

  **Fix:** Removed `evalTools` from the main bundle. To run evals, use `bunx evalite run` directly.

## 0.45.2

### Patch Changes

- [`70e62c9`](https://github.com/joelhooks/swarm-tools/commit/70e62c9c6c9c29ecf7778aad90813adf5ad8a20e) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔬 Smart Operations: From Eval Purgatory to Integration Paradise

  ```
       BEFORE                          AFTER
     ┌─────────┐                    ┌─────────┐
     │ evalite │ ──CORRUPT──►       │ bun:test│
     │ vitest  │   VTAB!            │  vec0   │
     │  vec0?  │                    │   ✓     │
     └────╳────┘                    └────✓────┘
          │                              │
          │  "database disk image        │  5 pass, 2 skip
          │   is malformed"              │  (libSQL bug, not us)
          ▼                              ▼
        💀 RIP                        🎉 ALIVE
  ```

  > "They test implementation detail and hurt migrations."
  > — _The Coding Career Handbook_

  Migrated `smart-operations.eval.ts` from evalite to bun:test integration tests.

  **Why?** The sqlite-vec (vec0) extension loads fine in bun's native test runner but throws `SQLITE_CORRUPT_VTAB` in vitest/evalite. Rather than mock the unmockable, we moved where the tests can breathe.

  **What moved:**

  - `evals/smart-operations.eval.ts` → `swarm-mail/src/memory/__tests__/smart-operations.integration.test.ts`
  - Deleted: `evals/fixtures/smart-operations-fixtures.ts`
  - Deleted: `evals/scorers/smart-operations-scorer.ts`

  **Test results:** 5 pass, 2 skip (UPDATE/DELETE have a separate libSQL corruption bug being tracked)

  **The eval tested:** ADD/UPDATE/DELETE/NOOP smart memory operations with LLM-powered decision making. Now it actually runs.

- Updated dependencies [[`70e62c9`](https://github.com/joelhooks/swarm-tools/commit/70e62c9c6c9c29ecf7778aad90813adf5ad8a20e)]:
  - swarm-mail@1.6.2

## 0.45.1

### Patch Changes

- [`df219d8`](https://github.com/joelhooks/swarm-tools/commit/df219d8f2838eb9f640f61b9b07e326225f404d0) Thanks [@joelhooks](https://github.com/joelhooks)! - ## `swarm capture` - The CLI Stays Dumb, The Plugin Stays Dumber

  > "To conform to the principle of dependency inversion, we must isolate this abstraction from the details of the problem."
  > — Robert C. Martin, Clean Code

  ```
      ┌─────────────────────────────────────────────────────────────┐
      │                                                             │
      │   ~/.config/opencode/plugin/swarm.ts                        │
      │   ┌─────────────────────────────────────────────────────┐   │
      │   │                                                     │   │
      │   │   spawn("swarm", ["capture", "--session", ...])     │───┼──► swarm capture
      │   │                                                     │   │         │
      │   │   // No imports from opencode-swarm-plugin          │   │         │
      │   │   // Version always matches CLI                     │   │         ▼
      │   │   // Fire and forget                                │   │    captureCompactionEvent()
      │   │                                                     │   │
      │   └─────────────────────────────────────────────────────┘   │
      │                                                             │
      └─────────────────────────────────────────────────────────────┘
  ```

  **The Problem:** Plugin wrapper was importing `captureCompactionEvent` directly from the npm package. When installed globally, this import could fail or use a stale version.

  **The Fix:** Shell out to `swarm capture` CLI command instead. The CLI is always the installed version, so no version mismatch.

  **New command:**

  ```bash
  swarm capture --session <id> --epic <id> --type <type> [--payload <json>]

  # Types: detection_complete, prompt_generated, context_injected,
  #        resumption_started, tool_call_tracked
  ```

  **Design principle:** The plugin wrapper in `~/.config/opencode/plugin/swarm.ts` should be as dumb as possible. All logic lives in the CLI/npm package. Users never need to update their local plugin file for new features - just `npm update`.

  **Files changed:**

  - `bin/swarm.ts` - Added `capture` command
  - `examples/plugin-wrapper-template.ts` - Uses CLI instead of import

- [`ff29b26`](https://github.com/joelhooks/swarm-tools/commit/ff29b26344274907b6a0614f9b3b914771edf6e4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔧 Fix CLI Breaking on npm Install

  > "The best code is no code at all."
  > — Jeff Atwood

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  BEFORE: npm install → "Cannot find module '../src/index'"  │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  bin/swarm.ts ──import──► ../src/query-tools.js  ❌         │
  │                                                             │
  │  Published package:                                         │
  │  ├── bin/swarm.ts     (raw TypeScript)                      │
  │  ├── dist/            (compiled JS)                         │
  │  └── src/             ❌ NOT PUBLISHED                      │
  │                                                             │
  ├─────────────────────────────────────────────────────────────┤
  │  AFTER: npm install → works                                 │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  dist/bin/swarm.js ──bundled──► all deps inlined  ✅        │
  │                                                             │
  │  Published package:                                         │
  │  ├── dist/bin/swarm.js  (compiled, bundled)                 │
  │  └── dist/              (all modules)                       │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘
  ```

  **The Problem:**

  CLI used dynamic imports pointing to `../src/` which doesn't exist in published packages. This broke `bun install -g opencode-swarm-plugin` with "Cannot find module" errors.

  **The Fix:**

  1. **Compile CLI to dist/** - Added `bin/swarm.ts` to build entries
  2. **Static imports** - Replaced 20 dynamic imports with static ones (bundler resolves them)
  3. **Update bin path** - `package.json` bin now points to `./dist/bin/swarm.js`

  **Why dynamic imports were wrong:**

  - "Lazy loading for performance" on an M4 Max is absurd
  - Bun tree-shakes unused imports anyway
  - Dynamic imports bypass bundler resolution
  - Paths break when `src/` isn't published

  **What changed:**

  - `scripts/build.ts` - Added CLI build entry
  - `package.json` - bin points to compiled output
  - `bin/swarm.ts` - All imports now static, paths relative to src/

  **Testing:**

  ```bash
  # Build
  bun run build

  # Test locally
  node dist/bin/swarm.js version

  # Test global install
  bun install -g .
  swarm version
  ```

- [`24a986e`](https://github.com/joelhooks/swarm-tools/commit/24a986eb0405895b4b7f5f201f0e1755cf078fc2) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Plugin Wrapper Now Fully Self-Contained

  ```
      ┌──────────────────────────────────────────────────────────┐
      │                                                          │
      │   ~/.config/opencode/plugin/swarm.ts                     │
      │                                                          │
      │   ┌────────────────────────────────────────────────────┐ │
      │   │  BEFORE: import { ... } from "opencode-swarm-plugin"│ │
      │   │          ↓                                          │ │
      │   │  💥 Cannot find module 'evalite/runner'             │ │
      │   └────────────────────────────────────────────────────┘ │
      │                                                          │
      │   ┌────────────────────────────────────────────────────┐ │
      │   │  AFTER: // Inlined swarm detection (~250 lines)    │ │
      │   │         // Zero imports from npm package           │ │
      │   │         ↓                                          │ │
      │   │  ✅ Works everywhere                               │ │
      │   └────────────────────────────────────────────────────┘ │
      │                                                          │
      └──────────────────────────────────────────────────────────┘
  ```

  **Problem:** Plugin wrapper in `~/.config/opencode/plugin/swarm.ts` was importing from `opencode-swarm-plugin` npm package. The package has `evalite` as a dependency, which isn't available in OpenCode's plugin context. Result: trace trap on startup.

  **Solution:** Inline all swarm detection logic directly into the plugin wrapper template:

  - `SwarmProjection`, `ToolCallEvent`, `SubtaskState`, `EpicState` types
  - `projectSwarmState()` - event fold for deterministic state
  - `hasSwarmSignature()` - quick check for epic + spawn
  - `isSwarmActive()` - check for pending work
  - `getSwarmSummary()` - human-readable status

  **Design Principle:** The plugin wrapper must be FULLY SELF-CONTAINED:

  - NO imports from `opencode-swarm-plugin` npm package
  - All logic either inlined OR shells out to `swarm` CLI
  - Users never need to update their local plugin for new features

  **After updating:** Copy the new template to your local plugin:

  ```bash
  cp ~/.config/opencode/plugin/swarm.ts ~/.config/opencode/plugin/swarm.ts.bak
  # Then reinstall: bun add -g opencode-swarm-plugin
  # Or copy from examples/plugin-wrapper-template.ts
  ```

## 0.45.0

### Minor Changes

- [`f9fd732`](https://github.com/joelhooks/swarm-tools/commit/f9fd73295b0f5c4b4f5230853a165af81a04f806) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Swarm Signature Detection: Events as Source of Truth

  > "Applications that use event sourcing need to take the log of events and transform it into
  > application state that is suitable for showing to a user."
  > — Martin Kleppmann, _Designing Data-Intensive Applications_

  ```
                      SESSION EVENTS                    HIVE (projection)
                      ═══════════════                   ═════════════════

      ┌─────────────────────────────────┐              ┌─────────────────┐
      │ hive_create_epic(...)           │──────────────│ epic: open      │
      │ swarm_spawn_subtask(bd-123.1)   │              │ bd-123.1: open  │
      │ swarm_spawn_subtask(bd-123.2)   │              │ bd-123.2: open  │
      │ swarm_complete(bd-123.1)        │──────────────│ bd-123.1: closed│
      │ swarm_complete(bd-123.2)        │──────────────│ bd-123.2: closed│
      │ hive_close(epic)                │──────────────│ epic: closed    │
      └─────────────────────────────────┘              └─────────────────┘
                ↑                                               ↑
           SOURCE OF TRUTH                              STALE PROJECTION
           (immutable log)                              (all cells closed)

      ┌──────────────────────────────────────────────────────────────────┐
      │  COMPACTION TRIGGERS HERE                                        │
      │  ════════════════════════                                        │
      │                                                                  │
      │  Old approach: Query hive → "0 open epics" → "No cells found"   │
      │  New approach: Fold events → "Epic with 2 subtasks, completed"  │
      └──────────────────────────────────────────────────────────────────┘
  ```

  **The Problem:**

  Compaction was detecting swarms (106 high-confidence tool calls) but finding no active epics.
  Why? By the time compaction triggers, all cells are already **closed** in hive. The LLM was
  generating useless continuation prompts because it queried the stale projection instead of
  projecting from the event log.

  **The Fix:**

  New `swarm-signature.ts` module with deterministic, algorithmic swarm detection:

  ```typescript
  // A SWARM is defined by this event sequence (no heuristics):
  // 1. hive_create_epic(epic_title, subtasks[]) → epic_id
  // 2. swarm_spawn_subtask(bead_id, epic_id, ...) → prompt (at least one)

  // Pure fold over events produces ground truth state
  const projection = projectSwarmState(sessionEvents);

  // projection.epics: Map<epicId, { title, subtaskIds, status }>
  // projection.subtasks: Map<subtaskId, { epicId, status, agent, files }>
  // projection.spawned: Set<subtaskId>  // Actually spawned to workers
  // projection.completed: Set<subtaskId>  // Finished via swarm_complete
  ```

  **Key Functions:**

  | Function              | Purpose                            |
  | --------------------- | ---------------------------------- |
  | `projectSwarmState()` | Fold over events → SwarmProjection |
  | `hasSwarmSignature()` | Quick check: epic + spawn present? |
  | `isSwarmActive()`     | Any pending work?                  |
  | `getSwarmSummary()`   | Human-readable status for prompts  |

  **Integration:**

  `scanSessionMessages()` now returns `projection` alongside tool call stats. The compaction
  hook uses projection as PRIMARY source, hive_query as fallback. Logs show `source: "projection"`
  vs `source: "hive_query"` for debugging.

  **Why This Matters:**

  Coordinators waking up after compaction now get accurate state:

  - "Epic 'Add Auth' with 3/5 subtasks complete, 2 pending"
  - Instead of: "No cells found"

  The session event log is the source of truth. Hive is just a convenient projection that
  can become stale. Now we project from events when it matters.

### Patch Changes

- [#86](https://github.com/joelhooks/swarm-tools/pull/86) [`156386a`](https://github.com/joelhooks/swarm-tools/commit/156386a9353a7d92afdc355fbbcf951b9c749048) Thanks [@sm0ol](https://github.com/sm0ol)! - ## 🐝 Fix Missing Plugin Wrapper Template in Published Package

  Fixed `swarm setup` failing with "Could not read plugin template" by adding missing directories to npm publish files.

  **Problem:** The `examples/` and `global-skills/` directories weren't included in package.json `files` array, causing them to be excluded from npm publish. When users ran `swarm setup`, it couldn't find the plugin wrapper template and fell back to a minimal version.

  **Solution:** Added `examples` and `global-skills` to the `files` array in package.json so they're included in published packages.

  **What changed:**

  - `examples/plugin-wrapper-template.ts` now available in installed packages
  - `global-skills/` directory properly included for bundled skills
  - `swarm setup` can read full template instead of falling back

  **Before:** "Could not read plugin template from [path], using minimal wrapper"
  **After:** Full plugin wrapper with all tools and proper OpenCode integration

  No breaking changes - existing minimal wrappers continue working.

- [`fb4b2d5`](https://github.com/joelhooks/swarm-tools/commit/fb4b2d545943fa6e5a5f5294f2bcd129191b8667) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔍 hive_cells Now Returns All Matches for Partial IDs

  > "Tune and test your metadata by comparing it with the tone, coverage, and trends of your searchers' common queries."
  > — _Search Analytics for Your Site_

  Previously, `hive_cells({ id: "mjonid" })` would throw an "Ambiguous ID" error when multiple cells matched. This was hostile UX for a **query tool** — users expect to see all matches, not be forced to guess more characters.

  ```
       ┌──────────────────────────────────────┐
       │  BEFORE: "Ambiguous ID" error 💀     │
       │                                      │
       │  > hive_cells({ id: "mjonid" })      │
       │  Error: multiple cells match         │
       │                                      │
       ├──────────────────────────────────────┤
       │  AFTER: Returns all matches 🎯       │
       │                                      │
       │  > hive_cells({ id: "mjonid" })      │
       │  [                                   │
       │    { id: "...-mjonidihuyq", ... },   │
       │    { id: "...-mjonidimchs", ... },   │
       │    { id: "...-mjonidioq28", ... },   │
       │    ...13 cells total                 │
       │  ]                                   │
       └──────────────────────────────────────┘
  ```

  **What changed:**

  - Added `findCellsByPartialId()` — returns `Cell[]` instead of throwing
  - `hive_cells` now uses this for partial ID lookups
  - `resolvePartialId()` still throws for tools that need exactly one cell (hive_update, hive_close, etc.)

  **Why it matters:**

  - Query tools should return results, not errors
  - Partial ID search is now actually useful for exploration
  - Consistent with how `grep` and other search tools behave

- [`ef21ee0`](https://github.com/joelhooks/swarm-tools/commit/ef21ee0d943e0d993865dd44b69b25c025de79ac) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Memory System Polish: The Hive Remembers

  > _"Our approach draws inspiration from the Zettelkasten method, a sophisticated
  > knowledge management system that creates interconnected information networks
  > through atomic notes and flexible linking."_
  > — A-MEM: Agentic Memory for LLM Agents

  ```
                      .-.
                     (o o)  "Should I ADD, UPDATE, or NOOP?"
                     | O |
                     /   \        ___
                    /     \    .-'   '-.
          _____    /       \  /  .-=-.  \    _____
         /     \  |  ^   ^  ||  /     \  |  /     \
        | () () | |  (o o)  || | () () | | | () () |
         \_____/  |    <    ||  \_____/  |  \_____/
            |      \  ===  /  \    |    /      |
           _|_      '-----'    '--|--'       _|_
          /   \                   |         /   \
         | mem |<----related---->|mem|<--->| mem |
          \___/                   |         \___/
                              supersedes
                                  |
                               ___|___
                              /       \
                             | mem-old |
                              \_______/
                                  †
  ```

  ### What Changed

  **swarm-mail:**

  - **README overhaul** - Documented Wave 1-3 memory features with code examples
  - **Test fixes** - `test.skip()` → `test.skipIf(!hasWorkingLLM)` for graceful CI/local behavior
  - Replaced outdated `pgvector` references with `libSQL vec extension`

  **opencode-swarm-plugin:**

  - **ADR: Memory System Eval Strategy** - 3-tier approach (heuristics/integration/LLM-as-judge)
  - **smart-operations.eval.ts** - Evalite test suite for ADD/UPDATE/DELETE/NOOP decisions
  - Fixtures covering 8 test scenarios (exact match, refinement, contradiction, new info)
  - LLM-as-judge scorer with graceful degradation

  ### The Philosophy

  > _"As the system processes more memories over time, it develops increasingly
  > sophisticated knowledge structures, discovering higher-order patterns and
  > concepts across multiple memories."_
  > — A-MEM

  The memory system isn't just storage—it's a living knowledge graph that evolves.

  ### Run the Eval

  ```bash
  bun run eval:smart-operations
  ```

- Updated dependencies [[`fb4b2d5`](https://github.com/joelhooks/swarm-tools/commit/fb4b2d545943fa6e5a5f5294f2bcd129191b8667), [`ca12bd6`](https://github.com/joelhooks/swarm-tools/commit/ca12bd6dd68ee41bdb9deb78409c73a08460806e), [`ef21ee0`](https://github.com/joelhooks/swarm-tools/commit/ef21ee0d943e0d993865dd44b69b25c025de79ac)]:
  - swarm-mail@1.6.1

## 0.44.2

### Patch Changes

- [`012d21a`](https://github.com/joelhooks/swarm-tools/commit/012d21aefdea0ac275a02d3865c8a134ab507360) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔧 Build Now Ships All Entry Points

  > _"A change to PATCH states that bug fixes have been made to existing functionality."_
  > — Building Microservices, Sam Newman

  Fixed missing `hive.js` and `swarm-prompts.js` from published package. These entry points were defined in `package.json` exports but weren't being built.

  **What was broken:**

  - `opencode-swarm-plugin/hive` → 404
  - `opencode-swarm-plugin/swarm-prompts` → 404

  **What's fixed:**

  - All 6 entry points now build correctly
  - Refactored build to `scripts/build.ts` with config-driven parallel builds
  - Adding new entry points is now a one-liner

  **If you hit "Cannot find module" errors** on hive or swarm-prompts imports, upgrade to this version.

## 0.44.1

### Patch Changes

- [`1d079da`](https://github.com/joelhooks/swarm-tools/commit/1d079da134c048df66db7d28890d1a8bb9908942) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Evals Break Free: The Great Extraction

  > _"Modularity does not necessarily bring uniformity to the design... but it does bring clarity to dependencies."_
  > — Eric Evans, Domain-Driven Design

  **The Problem:** PR #81 reported `Cannot find module 'evalite/runner'` on global install. The eval framework (evalite + vitest) was incorrectly bundled as devDependencies in the main plugin, causing runtime failures.

  **The Fix:** Rather than bloating the plugin with 20MB+ of test framework, we extracted evals to their own package.

  ### What Changed

  **New Package: `@swarmtools/evals`**

  - All eval files migrated from `opencode-swarm-plugin/evals/`
  - Owns evalite, vitest, and AI SDK dependencies
  - Peer-depends on plugin and swarm-mail for scoring utilities

  **opencode-swarm-plugin**

  - Removed evalite/vitest from devDependencies
  - Added `files` field to limit npm publish scope
  - Added subpath exports for eval-capture and compaction-prompt-scoring
  - Build script now generates all entry points

  ### Package Structure

  ```
  packages/
  ├── opencode-swarm-plugin/     # Main plugin (lean, no eval deps)
  ├── swarm-evals/               # @swarmtools/evals (internal)
  │   └── src/
  │       ├── *.eval.ts
  │       ├── scorers/
  │       ├── fixtures/
  │       └── lib/
  └── ...
  ```

  ### Verified

  - ✅ `example.eval.ts` - 100% pass
  - ✅ `compaction-resumption.eval.ts` - 100% pass (8 evals)
  - ✅ Plugin builds without eval deps
  - ✅ Global install no longer fails

  Thanks to @AlexMikhalev for the detailed bug report that led to this architectural improvement.

## 0.44.0

### Minor Changes

- [`5c13dcf`](https://github.com/joelhooks/swarm-tools/commit/5c13dcf02ca0613199dbc84c5809bf8b9d57d3d1) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🎯 New Tool: `contributor_lookup`

  ```
  ┌────────────────────────────────────────────────┐
  │  GitHub Profile  →  Changeset Credit Line      │
  │                                                │
  │  @bcheung        →  Thanks to Brian Cheung     │
  │  twitter: ...    →  ([@justBCheung](x.com/))   │
  │                  →  for reporting #53!         │
  └────────────────────────────────────────────────┘
  ```

  Workers can now call `contributor_lookup(login, issue)` to automatically:

  1. Fetch GitHub profile (name, twitter, bio)
  2. Get a ready-to-paste changeset credit line
  3. Store contributor info in semantic-memory

  **Usage:**

  ```typescript
  contributor_lookup({ login: "bcheung", issue: 53 });
  // → "Thanks to Brian Cheung ([@justBCheung](https://x.com/justBCheung)) for reporting #53!"
  ```

  No more forgetting to credit contributors properly. The tool handles fallbacks when twitter/name is missing.

## 0.43.0

### Minor Changes

- [`d74f68b`](https://github.com/joelhooks/swarm-tools/commit/d74f68ba491fdd127173c1993400c16b17479c3a) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔭 Observability Stack: See What Your Swarm Is Doing

  ```
      ╭──────────────────────────────────────────────────────────╮
      │                                                          │
      │   "Observability is about instrumenting your system      │
      │    in a way that ensures sufficient information about    │
      │    a system's runtime is collected and analyzed so       │
      │    that when something goes wrong, it can help you       │
      │    understand why."                                      │
      │                                                          │
      │                    — AI Engineering, Chip Huyen          │
      │                                                          │
      ╰──────────────────────────────────────────────────────────╯
  ```

  Five new modules for understanding multi-agent coordination at runtime:

  ### Error Enrichment (`error-enrichment.ts`)

  ```typescript
  throw new SwarmError("File reservation failed", {
    file: "src/auth.ts",
    agent: "DarkHawk",
    epic_id: "mjmas3zxlmg",
    recent_events: [
      /* last 5 events */
    ],
  });
  ```

  - `SwarmError` class with structured context (file, line, agent, epic, events)
  - `enrichError()` wraps any error with swarm context
  - `debugLog()` respects `DEBUG=swarm:*` patterns
  - `suggestFix()` maps 8+ error patterns to actionable fixes

  ### SQL Analytics (`swarm query`)

  ```bash
  swarm query --preset failed_decompositions
  swarm query --sql "SELECT * FROM events WHERE type='worker_spawned'"
  swarm query --preset duration_by_strategy --format csv
  ```

  10 preset queries: `failed_decompositions`, `duration_by_strategy`, `file_conflicts`, `worker_success_rate`, `review_rejections`, `blocked_tasks`, `agent_activity`, `event_frequency`, `error_patterns`, `compaction_stats`

  ### Dashboard Data (`swarm dashboard`)

  ```bash
  swarm dashboard --epic mjmas3zxlmg --refresh 1000
  ```

  Real-time data fetching: worker status, subtask progress, file locks, recent messages, epic list.

  ### Event Replay (`swarm replay`)

  ```bash
  swarm replay mjmas3zxlmg --speed 2x --type worker_spawned
  swarm replay mjmas3zxlmg --agent DarkHawk --since "2025-12-25T10:00:00"
  ```

  Replay epic events with timing control. Filter by type, agent, time range. Debug coordination failures by watching the sequence unfold.

  ### Export Formats (`swarm export`)

  ```bash
  swarm export --format otlp --epic mjmas3zxlmg  # OpenTelemetry traces
  swarm export --format csv --output events.csv   # RFC 4180 compliant
  swarm export --format json | jq '.[] | select(.type=="error")'
  ```

  **Test Coverage:** 225 tests (150 unit + 75 CLI integration)

  **TDD Enforced:** RED cells first, GREEN cells second. Every function tested before implementation.

## 0.42.9

### Patch Changes

- [`823987d`](https://github.com/joelhooks/swarm-tools/commit/823987d7b7ef57bf636665008ebbcdffe333e828) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Worktree Support + Graceful Degradation

  ```
      ┌─────────────────────────────────────────────────────┐
      │                                                     │
      │   "It is impossible to reduce the probability       │
      │    of a fault to zero; therefore it is usually      │
      │    best to design fault-tolerance mechanisms        │
      │    that prevent faults from causing failures."      │
      │                                                     │
      │                    — Kleppmann, DDIA                │
      │                                                     │
      └─────────────────────────────────────────────────────┘
  ```

  ### Git Worktree Support (#52)

  All worktrees now share the main repository's database. No more isolated state per worktree.

  ```
  BEFORE:                          AFTER:
  main-repo/.opencode/swarm.db     main-repo/.opencode/swarm.db
  worktree-1/.opencode/swarm.db    worktree-1/ ──┐
  worktree-2/.opencode/swarm.db    worktree-2/ ──┼─→ main-repo/.opencode/
                                   worktree-3/ ──┘
  ```

  **How it works:**

  - Detects worktrees by checking if `.git` is a file (not directory)
  - Parses `gitdir:` path to resolve main repo location
  - All DB operations automatically use main repo's `.opencode/`

  ### Graceful Degradation for semantic-memory (#53)

  When Ollama is unavailable, `semantic-memory_find` now falls back to full-text search instead of erroring.

  **Before:** `OllamaError: Connection failed` → tool fails
  **After:** Warning logged → FTS results returned → tool works

  Also added `repairStaleEmbeddings()` to fix the "dimensions are different: 0 != 1024" error when memories were stored without embeddings.

  ### New Skill: gh-issue-triage

  Added `.opencode/skills/gh-issue-triage/` for GitHub issue triage workflow:

  - Extracts contributor profiles including Twitter handles
  - Templates for acknowledgment comments
  - Changeset credit templates with @mentions

  ***

  Thanks to [@justBCheung](https://x.com/justBCheung) for filing both issues with excellent debugging context. 🙏

- Updated dependencies [[`823987d`](https://github.com/joelhooks/swarm-tools/commit/823987d7b7ef57bf636665008ebbcdffe333e828)]:
  - swarm-mail@1.6.0

## 0.42.8

### Patch Changes

- [`a797bea`](https://github.com/joelhooks/swarm-tools/commit/a797bea871e5d698ebb38b41f47ff07faa7c108b) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔗 Tweets Now Link to the Right PR

  Release tweets were linking to the wrong PR. The old logic grabbed "most recent merged PR that isn't a version bump" - but with the new `release:` prefix on version PRs, it was picking up stale PRs.

  **Fixed:** Now uses `github.sha` to find the exact PR that triggered the workflow. No more guessing.

  ```
  BEFORE: gh pr list --limit 5 --jq 'filter...'  → wrong PR
  AFTER:  gh pr list --search "${{ github.sha }}" → triggering PR
  ```

## 0.42.7

### Patch Changes

- [`7a6a4a3`](https://github.com/joelhooks/swarm-tools/commit/7a6a4a37c4ea753de359dac5062d11186ee98ccd) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 📐 Swarm Insights Gets Its Blueprint

  > _"The major documentation tool for information architecture... diagrams."_
  > — Jesse James Garrett, The Elements of User Experience

  The README now shows you how the swarm learns, not just that it does.

  **Added:**

  - ASCII diagram of the swarm learning loop (task → decompose → execute → complete → insights → repeat)
  - Data flow architecture showing Event Store → Insights Aggregation → Agents
  - Full API reference with TypeScript examples for coordinators and workers
  - Token budget table (500 for coordinators, 300 for workers)
  - Recommendation threshold table (≥80% = good, <40% = AVOID)
  - Data sources table (Event Store, Semantic Memory, Anti-Pattern Registry)

  **Why it matters:**
  Diagrams > prose for architecture. Now you can see the feedback loop at a glance instead of reading paragraphs. The API examples are copy-pasteable.

  ```
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │  TASK    │───▶│ INSIGHTS │───▶│  BETTER  │
  │          │    │  LAYER   │    │  SWARMS  │
  └──────────┘    └──────────┘    └──────────┘
  ```

- [`0ad79d5`](https://github.com/joelhooks/swarm-tools/commit/0ad79d57cd119517a8e04d0e74b4909f20a7f0be) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Release Tweets Link to Source, PR Titles Get Smart

  - Tweets now include link to the feature PR (or commit if pushed direct to main)
  - Version bump PRs get AI-generated titles from changeset content via Opus
  - No more "chore: update versions" - titles describe what actually shipped

## 0.42.6

### Patch Changes

- [`ab90238`](https://github.com/joelhooks/swarm-tools/commit/ab902386883fa9654c9977d28888582fafc093e5) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Query Epic Children Without Rawdogging JSONL

  `hive_cells` and `hive_query` now support `parent_id` filter. Find all children of an epic in one call:

  ```typescript
  hive_cells({ parent_id: "epic-id" }); // Returns all subtasks
  hive_query({ parent_id: "epic-id", status: "open" }); // Open subtasks only
  ```

  No more grep/jq on issues.jsonl. The tools do what they should.

- Updated dependencies [[`ab90238`](https://github.com/joelhooks/swarm-tools/commit/ab902386883fa9654c9977d28888582fafc093e5)]:
  - swarm-mail@1.5.5

## 0.42.5

### Patch Changes

- [`45af762`](https://github.com/joelhooks/swarm-tools/commit/45af762ce656cf652847027d176d7bb7ff91f19b) Thanks [@joelhooks](https://github.com/joelhooks)! - ## The Bees Can Finally Tweet

  New @swarmtoolsai app with proper OAuth. Releases now announce themselves.

## 0.42.4

### Patch Changes

- [`4c7d869`](https://github.com/joelhooks/swarm-tools/commit/4c7d869e385677318fbbda7fa464bbe1223039f1) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Switched to X API v2

  Old action used deprecated v1.1 API. Now using direct OAuth 1.0a signed requests to v2 endpoint.

## 0.42.3

### Patch Changes

- [`35eab3e`](https://github.com/joelhooks/swarm-tools/commit/35eab3e9e482b41e1535020a485561d5174e943c) Thanks [@joelhooks](https://github.com/joelhooks)! - ## First Real Tweet Incoming

  Fixed X OAuth tokens - now with write permissions. Let's see if the bees can actually post.

## 0.42.2

### Patch Changes

- [`9ded2a0`](https://github.com/joelhooks/swarm-tools/commit/9ded2a0929f430a3297e3b62858aa1143179542f) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Tweet Bot Learns to Speak Swarm

  Release tweets now use a manyshot prompt with examples that match the project's voice: terse, technical, slightly cheeky. Focus on what devs can DO, not what we shipped.

## 0.42.1

### Patch Changes

- [`f6707d5`](https://github.com/joelhooks/swarm-tools/commit/f6707d53eb92021b6976212e903994c98c798483) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐦 @swarmtoolsai Now Tweets Releases

  Automated release announcements are live! When packages publish to npm, Claude summarizes the changelog into a tweet and posts from @swarmtoolsai.

  No more manual "hey we shipped" posts - the bees handle it now.

## 0.42.0

### Minor Changes

- [`a79e04b`](https://github.com/joelhooks/swarm-tools/commit/a79e04b1bb3b40c09c5265b5d11739864799e4e2) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔭 Swarm Observability: See What Your Bees Are Doing

  > "Observability is about instrumenting your system in a way that ensures sufficient information about a system's runtime is collected and analyzed so that when something goes wrong, it can help you understand why."
  > — Chip Huyen, _AI Engineering_

  New CLI commands to understand swarm health and history:

  ### `swarm stats`

  ```
  ┌─────────────────────────────────────────┐
  │        🐝  SWARM STATISTICS  🐝         │
  ├─────────────────────────────────────────┤
  │ Total Swarms: 42   Success: 87%         │
  │ Avg Duration: 4.2min                    │
  ├─────────────────────────────────────────┤
  │ BY STRATEGY                             │
  │ ├─ file-based      92% (23/25)          │
  │ ├─ feature-based   78% (14/18)          │
  │ ├─ risk-based      67% (2/3)            │
  ├─────────────────────────────────────────┤
  │ COORDINATOR HEALTH                      │
  │ Violation Rate:   2%                    │
  │ Spawn Efficiency: 94%                   │
  │ Review Rate:      88%                   │
  └─────────────────────────────────────────┘
  ```

  Options: `--since 24h/7d/30d`, `--json`

  ### `swarm history`

  Timeline of recent swarm activity with filtering:

  - `--status success/failed/in_progress`
  - `--strategy file-based/feature-based/risk-based`
  - `--verbose` for subtask details

  ### Prompt Insights Integration

  Coordinators and workers now receive injected insights from past swarm outcomes:

  - Strategy success rates as markdown tables
  - Anti-pattern warnings for low-success strategies
  - File/domain-specific learnings from semantic memory

  This creates a feedback loop where swarms learn from their own history.

  ### Also in this release

  - **swarm-dashboard** (WIP): React/Vite visualizer scaffold
  - **ADR-006**: Swarm PTY decision document
  - **CI fix**: Smarter changeset detection prevents empty PR errors

### Patch Changes

- Updated dependencies [[`a79e04b`](https://github.com/joelhooks/swarm-tools/commit/a79e04b1bb3b40c09c5265b5d11739864799e4e2)]:
  - swarm-mail@1.5.4

## 0.41.0

### Minor Changes

- [`179b3f0`](https://github.com/joelhooks/swarm-tools/commit/179b3f0e49c7959f8d754c1274d301d0b3845a79) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Compaction Prompt Now Speaks Swarm

  > _"Memory is essential for communication: we recall past interactions, infer preferences, and construct evolving mental models of those we engage with."_
  > — Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory

  When context compacts mid-swarm, coordinators were waking up confused. They had state information but no protocol guidance. Now the compaction prompt includes a condensed version of the swarm command template.

  **What's New:**

  The `SWARM_COMPACTION_CONTEXT` now includes:

  1. **What Good Looks Like** - Behavioral examples showing ideal coordinator behavior

     - ✅ Spawned researcher for unfamiliar tech → got summary → stored in semantic-memory
     - ✅ Checked inbox every 5-10 minutes → caught blocked worker → unblocked in 2min
     - ❌ Called context7 directly → dumped 50KB → context exhaustion

  2. **Mandatory Behaviors Checklist** - Post-compaction protocol
     - Inbox monitoring (every 5-10 min with intervention triggers)
     - Skill loading (before spawning workers)
     - Worker review (after every worker returns, 3-strike rule)
     - Research spawning (never call context7/pdf-brain directly)

  **Why This Matters:**

  Coordinators resuming from compaction now have:

  - Clear behavioral guidance (not just state)
  - Actionable tool call examples
  - Anti-patterns to avoid
  - The same protocol as fresh `/swarm` invocations

  **Backward Compatible:** Existing compaction hooks continue to work. This adds guidance, doesn't change the hook signature.

### Patch Changes

- [`3e7c126`](https://github.com/joelhooks/swarm-tools/commit/3e7c126b11aa6ad909ebcb2ab3cf77883f9acfe4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🧪 Bulletproof Test Suite

  > "Setting up our tests to run synchronously and using mocking libraries will greatly speed up our testing"
  > — ng-book

  Fixed test isolation issues that caused 19 tests to fail when run together but pass in isolation.

  ### The Culprits

  **1. Global fetch pollution** (`ollama.test.ts`)

  ```typescript
  // BEFORE: Replaced global.fetch, never restored it
  global.fetch = mockFetch;

  // AFTER: Save and restore
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  ```

  **2. Port conflicts** (`durable-server.test.ts`)

  - Tests used hardcoded ports (4483, 4484, 4485)
  - Parallel test runs fought over the same ports
  - Fixed: Use `port: 0` for OS-assigned ports, made `server.url` a getter

  **3. AI SDK schema incompatibility** (`memory-operations.ts`)

  - `z.discriminatedUnion` creates `oneOf` at top level
  - Anthropic API requires `type: object` at top level
  - Fixed: Flat object schema with optional fields

  ### Test Stats

  ```
  Before: 19 failures when run together
  After:  0 failures, 1406 tests pass
  ```

  ### Files Changed

  - `src/memory/ollama.test.ts` - Restore global.fetch after each test
  - `src/streams/durable-server.ts` - Dynamic port getter
  - `src/streams/durable-server.test.ts` - Use port 0, rewrite for isolation
  - `src/memory/memory-operations.ts` - Flat schema for Anthropic compatibility
  - Renamed `memory-operations.test.ts` → `memory-operations.integration.test.ts`

- Updated dependencies [[`3e7c126`](https://github.com/joelhooks/swarm-tools/commit/3e7c126b11aa6ad909ebcb2ab3cf77883f9acfe4)]:
  - swarm-mail@1.5.3

## 0.40.0

### Minor Changes

- [`948e031`](https://github.com/joelhooks/swarm-tools/commit/948e0318fe5e2c1a5d695a56533fc2a2a7753887) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔭 Observability Swarm: See What the Bees Are Doing

  > "The unexamined swarm is not worth coordinating." — Socrates, probably

  Four parallel workers descended on the observability stack and emerged victorious. The compaction hook no longer runs in darkness, coordinator sessions are now viewable, and the docs finally explain what all those JSONL files are for.

  ### What's New

  **Compaction Observability** (`src/compaction-observability.ts`)

  - Metrics collector tracks phases: START → GATHER → DETECT → INJECT → COMPLETE
  - Pattern extraction/skipping with reasons ("why didn't this get captured?")
  - Timing breakdown per phase (analysis vs extraction vs storage)
  - 15 tests (11 unit + 4 integration)

  **`swarm log sessions` CLI**

  - `swarm log sessions` — list all captured coordinator sessions
  - `swarm log sessions <id>` — view events for a session (partial ID matching)
  - `swarm log sessions --latest` — quick access to most recent
  - `--type`, `--since`, `--limit`, `--json` filters
  - 64 tests covering parsing, listing, filtering

  **Coordinator Observability Docs**

  - AGENTS.md: overview with quick commands
  - evals/README.md: deep dive with ASCII flow diagrams, event type reference, JSONL examples, jq recipes

  **Research: Coordinator Prompt Eval** (`.hive/analysis/coordinator-prompt-eval-research.md`)

  - 26KB analysis of prompt iteration strategies
  - Recommends: versioning + evalite (defer LLM-as-Judge to v0.34+)
  - Implementation plan with effort estimates

  ### The Observability Story

  ```
  CAPTURE ──────────► VIEW ──────────► SCORE
  (eval-capture.ts)   (swarm log       (coordinator
                       sessions)        evals)
  ```

  Now you can answer:

  - "What did the last 10 compaction runs extract?"
  - "Why didn't this pattern get captured?"
  - "Which coordinator sessions had violations?"

## 0.39.1

### Patch Changes

- [`19a6557`](https://github.com/joelhooks/swarm-tools/commit/19a6557cee9878858e7f61e2aba86b37a3ec10ad) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Eval Quality Gates: Signal Over Noise

  The eval system now filters coordinator sessions to focus on high-quality data.

  **Problem:** 67 of 82 captured sessions had <3 events - noise from aborted runs, test pokes, and incomplete swarms. This diluted eval scores and made metrics unreliable.

  **Solution:** Quality filters applied BEFORE sampling:

  | Filter               | Default | Purpose                           |
  | -------------------- | ------- | --------------------------------- |
  | `minEvents`          | 3       | Skip incomplete/aborted sessions  |
  | `requireWorkerSpawn` | true    | Ensure coordinator delegated work |
  | `requireReview`      | true    | Ensure full swarm lifecycle       |

  **Impact:**

  - Filters 93 noisy sessions automatically
  - Overall eval score: 63% → 71% (true signal, not diluted)
  - Coordinator discipline: 47% → 57% (accurate measurement)

  **Usage:**

  ```typescript
  // Default: high-quality sessions only
  const sessions = await loadCapturedSessions();

  // Override for specific analysis
  const allSessions = await loadCapturedSessions({
    minEvents: 1,
    requireWorkerSpawn: false,
    requireReview: false,
  });
  ```

  Includes 7 unit tests covering filter logic and edge cases.

## 0.39.0

### Minor Changes

- [`aa12943`](https://github.com/joelhooks/swarm-tools/commit/aa12943f3edc8d5e23878b22f44073e4c71367c5) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Eval-Driven Development: The System That Scores Itself

  > "What gets measured gets managed." — Peter Drucker
  > "What gets scored gets improved." — The Swarm

  The plugin now evaluates its own output quality through a progressive gate system. Every compaction prompt gets scored, tracked, and learned from. Regressions become impossible to ignore.

  ### The Pipeline

  ```
  CAPTURE → SCORE → STORE → GATE → LEARN → IMPROVE
     ↑                                      ↓
     └──────────────────────────────────────┘
  ```

  ### What's New

  **Event Capture** (5 integration points)

  - `detection_triggered` - When compaction is detected
  - `prompt_generated` - Full LLM prompt captured
  - `context_injected` - Final content before injection
  - All events stored to `~/.config/swarm-tools/sessions/{session_id}.jsonl`

  **5 Compaction Prompt Scorers**

  - `epicIdSpecificity` - Real IDs, not placeholders (20%)
  - `actionability` - Specific tool calls with values (20%)
  - `coordinatorIdentity` - ASCII header + mandates (25%)
  - `forbiddenToolsPresent` - Lists what NOT to do (15%)
  - `postCompactionDiscipline` - First tool is correct (20%)

  **Progressive Gates**
  | Phase | Threshold | Behavior |
  |-------|-----------|----------|
  | Bootstrap | N/A | Always pass, building baseline |
  | Stabilization | 0.6 | Warn but pass |
  | Production | 0.7 | Fail CI on regression |

  **CLI Commands**

  ```bash
  swarm eval status          # Current phase, thresholds, scores
  swarm eval history         # Trends with sparklines ▁▂▃▄▅▆▇█
  swarm eval run [--ci]      # Execute evals, gate check
  ```

  **CI Integration**

  - Runs after tests pass
  - Posts results as PR comment with emoji status
  - Only fails in production phase with actual regression

  **Learning Feedback Loop**

  - Significant score drops auto-stored to semantic memory
  - Future agents learn from past failures
  - Pattern maturity tracking

  ### Breaking Changes

  None. All new functionality is additive.

  ### Files Changed

  - `src/eval-capture.ts` - Event capture with Zod schemas
  - `src/eval-gates.ts` - Progressive gate logic
  - `src/eval-history.ts` - Score tracking over time
  - `src/eval-learning.ts` - Failure-to-learning extraction
  - `src/compaction-prompt-scoring.ts` - 5 pure scoring functions
  - `evals/compaction-prompt.eval.ts` - Evalite integration
  - `bin/swarm.ts` - CLI commands
  - `.github/workflows/ci.yml` - CI integration

  ### Test Coverage

  - 422 new tests for eval-capture
  - 48 CLI tests
  - 7 integration tests for capture wiring
  - All existing tests still passing

### Patch Changes

- Updated dependencies [[`aa12943`](https://github.com/joelhooks/swarm-tools/commit/aa12943f3edc8d5e23878b22f44073e4c71367c5)]:
  - swarm-mail@1.5.2

## 0.38.0

### Minor Changes

- [`41a1965`](https://github.com/joelhooks/swarm-tools/commit/41a19657b252eb1c7a7dc82bc59ab13589e8758f) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Coordinators Now Delegate Research to Workers

  Coordinators finally know their place. They orchestrate, they don't fetch.

  **The Problem:**
  Coordinators were calling `repo-crawl_file`, `webfetch`, `context7_*` directly, burning expensive Sonnet context on raw file contents instead of spawning researcher workers.

  **The Fix:**

  ### Forbidden Tools Section

  COORDINATOR_PROMPT now explicitly lists tools coordinators must NEVER call:

  - `repo-crawl_*`, `repo-autopsy_*` - repository fetching
  - `webfetch`, `fetch_fetch` - web fetching
  - `context7_*` - library documentation
  - `pdf-brain_search`, `pdf-brain_read` - knowledge base

  ### Phase 1.5: Research Phase

  New workflow phase between Initialize and Knowledge Gathering:

  ```
  swarm_spawn_researcher(
    research_id="research-nextjs-cache",
    tech_stack=["Next.js 16 Cache Components"],
    project_path="/path/to/project"
  )
  ```

  ### Strong Coordinator Identity Post-Compaction

  When context compacts, the resuming agent now sees:

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │             🐝  YOU ARE THE COORDINATOR  🐝                 │
  │             NOT A WORKER. NOT AN IMPLEMENTER.               │
  │                  YOU ORCHESTRATE.                           │
  └─────────────────────────────────────────────────────────────┘
  ```

  ### runResearchPhase Returns Spawn Instructions

  ```typescript
  const result = await runResearchPhase(task, projectPath);
  // result.spawn_instructions = [
  //   { research_id, tech, prompt, subagent_type: "swarm/researcher" }
  // ]
  ```

  **32+ new tests, all 425 passing.**

- [`b06f69b`](https://github.com/joelhooks/swarm-tools/commit/b06f69bc3db099c14f712585d88b42c801123d01) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔬 Eval Capture Pipeline: Complete

  > "The purpose of computing is insight, not numbers." — Richard Hamming

  Wire all eval-capture functions into the swarm execution path, enabling ground-truth collection from real swarm executions.

  **What changed:**

  | Function                  | Wired Into                     | Purpose                            |
  | ------------------------- | ------------------------------ | ---------------------------------- |
  | `captureDecomposition()`  | `swarm_validate_decomposition` | Records task → subtasks mapping    |
  | `captureSubtaskOutcome()` | `swarm_complete`               | Records per-subtask execution data |
  | `finalizeEvalRecord()`    | `swarm_record_outcome`         | Computes aggregate metrics         |

  **New npm scripts:**

  ```bash
  bun run eval:run           # Run all evals
  bun run eval:decomposition # Decomposition quality
  bun run eval:coordinator   # Coordinator discipline
  ```

  **Data flow:**

  ```
  swarm_decompose → captureDecomposition → .opencode/eval-data.jsonl
         ↓
  swarm_complete → captureSubtaskOutcome → updates record with outcomes
         ↓
  swarm_record_outcome → finalizeEvalRecord → computes scope_accuracy, time_balance
         ↓
  evalite → reads JSONL → scores decomposition quality
  ```

  **Why it matters:**

  - Enables data-driven decomposition strategy selection
  - Tracks which strategies work for which task types
  - Provides ground truth for Evalite evals
  - Foundation for learning from swarm outcomes

  **Key discovery:** New cell ID format doesn't follow `epicId.subtaskNum` pattern. Must use `cell.parent_id` to get epic ID for subtasks.

### Patch Changes

- [`56e5d4c`](https://github.com/joelhooks/swarm-tools/commit/56e5d4c5ac96ddd2184d12c63e163bb9c291fb69) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔬 Eval Capture Pipeline: Phase 1

  > "The first step toward wisdom is getting things right. The second step is getting them wrong in interesting ways." — Marvin Minsky

  Wire `captureDecomposition()` into `swarm_validate_decomposition` to record decomposition inputs/outputs for evaluation.

  **What changed:**

  - `swarm_validate_decomposition` now calls `captureDecomposition()` after successful validation
  - Captures: epicId, projectPath, task, context, strategy, epicTitle, subtasks
  - Data persisted to `.opencode/eval-data.jsonl` for Evalite consumption

  **Why it matters:**

  - Enables ground-truth collection from real swarm executions
  - Foundation for decomposition quality evals
  - Tracks what strategies work for which task types

  **Tests added:**

  - Verifies `captureDecomposition` called with correct params on success
  - Verifies NOT called on validation failure
  - Handles optional context/description fields

  **Next:** Wire `captureSubtaskOutcome()` and `finalizeEvalRecord()` to complete the pipeline.

## 0.37.0

### Minor Changes

- [`66b5795`](https://github.com/joelhooks/swarm-tools/commit/66b57951e2c114702c663b98829d5f7626607a16) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 `swarm cells` - Query Your Hive Like a Pro

  New CLI command AND plugin tool for querying cells directly from the database.

  ### CLI: `swarm cells`

  ```bash
  swarm cells                      # List all cells (table format)
  swarm cells --status open        # Filter by status
  swarm cells --type bug           # Filter by type
  swarm cells --ready              # Next unblocked cell
  swarm cells mjkmd                # Partial ID lookup
  swarm cells --json               # Raw JSON for scripting
  ```

  **Replaces:** The awkward `swarm tool hive_query --json '{"status":"open"}'` pattern.

  ### Plugin Tool: `hive_cells`

  ```typescript
  // Agents can now query cells directly
  hive_cells({ status: "open", type: "task" });
  hive_cells({ id: "mjkmd" }); // Partial ID works!
  hive_cells({ ready: true }); // Next unblocked
  ```

  **Why this matters:**

  - Reads from DATABASE (fast, indexed) not JSONL files
  - Partial ID resolution built-in
  - Consistent JSON array output
  - Rich descriptions encourage agentic use

  ### Also Fixed

  - `swarm_review_feedback` tests updated for coordinator-driven retry architecture
  - 425 tests passing

## 0.36.1

### Patch Changes

- [`9c1f3f3`](https://github.com/joelhooks/swarm-tools/commit/9c1f3f3e7204f02c133c4a036fa34e83d8376a8c) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Coordinator Discipline: Prohibition-First Enforcement

  Coordinators kept "just doing it themselves" after compaction. Now they can't.

  **The Problem:**
  After context compaction, coordinators would ignore their own instructions to "spawn workers for remaining subtasks" and edit files directly. The compaction context was narrative ("do this") rather than prescriptive ("NEVER do that").

  **The Fix:**

  ### 1. Prohibition-First Compaction Context

  The `SWARM_COMPACTION_CONTEXT` now leads with explicit anti-patterns:

  ```markdown
  ### ⛔ NEVER DO THESE (Coordinator Anti-Patterns)

  - ❌ **NEVER** use `edit` or `write` tools - SPAWN A WORKER
  - ❌ **NEVER** run tests with `bash` - SPAWN A WORKER
  - ❌ **NEVER** implement features yourself - SPAWN A WORKER
  - ❌ **NEVER** "just do it myself to save time" - NO. SPAWN A WORKER.
  ```

  ### 2. Runtime Violation Detection

  `detectCoordinatorViolation()` is now wired up in `tool.execute.before`:

  - Detects when coordinators call `edit`, `write`, or test commands
  - Emits warnings to help coordinators self-correct
  - Captures VIOLATION events for post-hoc analysis

  ### 3. Coordinator Context Tracking

  New functions track when we're in coordinator mode:

  - `setCoordinatorContext()` - Activated when `hive_create_epic` or `swarm_decompose` is called
  - `isInCoordinatorContext()` - Checks if we're currently coordinating
  - `clearCoordinatorContext()` - Cleared when epic is closed

  **Why This Matters:**

  Coordinators that do implementation work burn context, create conflicts, and defeat the purpose of swarm coordination. This fix makes the anti-pattern visible and provides guardrails to prevent it.

  **Validation:**

  - Check `~/.config/swarm-tools/sessions/` for VIOLATION events
  - Run `coordinator-behavior.eval.ts` to score coordinator discipline

- [`4c23c7a`](https://github.com/joelhooks/swarm-tools/commit/4c23c7a31013bc6537d83a9294b51540056cde93) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Fix Double Hook Registration

  The compaction hook was firing twice per compaction event because OpenCode's plugin loader
  calls ALL exports as plugin functions. We were exporting `SwarmPlugin` as both:

  1. Named export: `export const SwarmPlugin`
  2. Default export: `export default SwarmPlugin`

  This caused the plugin to register twice, doubling all hook invocations.

  **Fix:** Changed to default-only export pattern:

  - `src/index.ts`: `const SwarmPlugin` (no export keyword)
  - `src/plugin.ts`: `export default SwarmPlugin` (no named re-export)

  **Impact:** Compaction hooks now fire once. LLM calls during compaction reduced by 50%.

- Updated dependencies [[`e0c422d`](https://github.com/joelhooks/swarm-tools/commit/e0c422de3f5e15c117cc0cc655c0b03242245be4), [`43c8c93`](https://github.com/joelhooks/swarm-tools/commit/43c8c93ef90b2f04ce59317192334f69d7c4204e)]:
  - swarm-mail@1.5.1

## 0.36.0

### Minor Changes

- [`ae213aa`](https://github.com/joelhooks/swarm-tools/commit/ae213aa49be977e425e0a767b5b2db16e462f76b) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔬 Compaction Hook: Now With X-Ray Vision

  The compaction hook was logging to `console.log` like a caveman. Now it writes structured JSON logs to `~/.config/swarm-tools/logs/compaction.log` - visible via `swarm log compaction`.

  **The Problem:**

  - Plugin wrapper used `console.log` → stdout → invisible
  - npm package had pino logging → but wrapper didn't use it
  - Running `/compact` gave zero visibility into what happened

  **The Fix:**
  Added comprehensive file-based logging throughout the compaction flow:

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │                    COMPACTION LOGGING                       │
  ├─────────────────────────────────────────────────────────────┤
  │  compaction_hook_invoked     │ Full input/output objects    │
  │  detect_swarm_*              │ CLI calls, cells, confidence │
  │  query_swarm_state_*         │ Epic/subtask extraction      │
  │  generate_compaction_prompt_*│ LLM timing, success/failure  │
  │  context_injected_via_*      │ Which API used               │
  │  compaction_complete_*       │ Final result + timing        │
  └─────────────────────────────────────────────────────────────┘
  ```

  **Also Enhanced:**

  - SDK message scanning for precise swarm state extraction
  - Merged scanned state (ground truth) with hive detection (heuristic)
  - 9 new tests for `scanSessionMessages()` (32 total passing)

  **To See It Work:**

  ```bash
  swarm setup --reinstall  # Regenerate plugin wrapper
  # Run /compact in OpenCode
  swarm log compaction     # See what happened
  ```

### Patch Changes

- [`5cfc42e`](https://github.com/joelhooks/swarm-tools/commit/5cfc42e93d3e5424e308857a40af4fd9fbda0ba3) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Swarm Workers Unchained

  Removed the vestigial `max_subtasks` parameter from decomposition tools. It was dead code - the prompts already say "as many as needed" and the replacement was doing nothing.

  **What changed:**

  - Removed `max_subtasks` arg from `swarm_decompose`, `swarm_plan_prompt`, `swarm_delegate_planning`
  - Removed from `DecomposeArgsSchema`
  - Renamed `max_subtasks` → `subtask_count` in eval capture (records actual count, not a limit)
  - Cleaned up tests that were passing the unused parameter

  **Why it matters:**
  The LLM decides how many subtasks based on task complexity, not an arbitrary cap. "Plan aggressively" means spawn as many workers as the task needs.

  **No functional change** - the parameter wasn't being used anyway.

## 0.35.0

### Minor Changes

- [`084f888`](https://github.com/joelhooks/swarm-tools/commit/084f888fcac4912f594428b1ac7148c8a8aaa422) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 👁️ Watch Your Swarm in Real-Time

  `swarm log` now has a `--watch` mode for continuous log monitoring. No more running the command repeatedly - just sit back and watch the bees work.

  ```bash
  # Watch all logs
  swarm log --watch

  # Watch with filters
  swarm log compaction -w --level error

  # Faster polling (500ms instead of default 1s)
  swarm log --watch --interval 500
  ```

  **New flags:**

  - `--watch`, `-w` - Enable continuous monitoring mode
  - `--interval <ms>` - Poll interval in milliseconds (default: 1000, min: 100)

  **How it works:**

  - Shows initial logs (last N lines based on `--limit`)
  - Polls log files for new entries at the specified interval
  - Tracks file positions for efficient incremental reads
  - Handles log rotation gracefully (detects file truncation)
  - All existing filters work: `--level`, `--since`, module name
  - Clean shutdown on Ctrl+C

  _"The hive that watches itself, debugs itself."_

## 0.34.0

### Minor Changes

- [`704c366`](https://github.com/joelhooks/swarm-tools/commit/704c36690fb6fd52cfb9222ddeef3b663dfdb9ed) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🪵 Pino Logging Infrastructure

  > "You can't improve what you can't measure." — Peter Drucker

  Finally, visibility into what the swarm is actually doing.

  ### What's New

  **Structured Logging with Pino**

  - Daily log rotation via `pino-roll` (14-day retention)
  - Logs to `~/.config/swarm-tools/logs/`
  - Module-specific log files (e.g., `compaction.1log`, `swarm.1log`)
  - Pretty mode for development: `SWARM_LOG_PRETTY=1`

  **Compaction Hook Instrumented**

  - 14 strategic log points across all phases
  - START: session context, trigger reason
  - GATHER: per-source timing (hive, swarm-mail, skills)
  - DETECT/INJECT: confidence scores, context decisions
  - COMPLETE: duration, success, what was injected

  **New CLI: `swarm log`**

  ```bash
  swarm log                    # Tail recent logs
  swarm log compaction         # Filter by module
  swarm log --level warn       # Filter by severity
  swarm log --since 1h         # Last hour only
  swarm log --json | jq        # Pipe to jq for analysis
  ```

  ### Why This Matters

  The compaction hook does a LOT of work with zero visibility:

  - Context injection decisions
  - Data gathering from multiple sources
  - Template rendering and size calculations

  Now you can answer: "What did compaction do on the last run?"

  ### Technical Details

  - Pino + pino-roll for async, non-blocking file writes
  - Child loggers for module namespacing
  - Lazy initialization pattern for test isolation
  - 56 new tests (10 logger + 18 compaction + 28 CLI)

  Complements existing `DEBUG=swarm:*` env var approach — Pino for structured file logs, debug for stderr filtering.

### Patch Changes

- [`b5792bd`](https://github.com/joelhooks/swarm-tools/commit/b5792bd5f6aa4bf3ad9757fe351bc144e84f09af) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🎯 Coordinators Remember Who They Are

  Fixed the compaction bug where coordinators lost their identity after context compression.

  **The Problem:**
  After compaction, coordinators would wake up and start doing worker tasks directly (running tests, editing files) instead of spawning workers. The injected context said "you are a coordinator" but gave worker-style resume commands.

  **The Fix:**
  `buildDynamicSwarmState()` now generates coordinator-focused context:

  ```
  ## 🎯 YOU ARE THE COORDINATOR

  **Primary role:** Orchestrate workers, review their output, unblock dependencies.
  **Spawn workers** for implementation tasks - don't do them yourself.

  **RESUME STEPS:**
  1. Check swarm status: `swarm_status(epic_id="bd-actual-id", ...)`
  2. Check inbox: `swarmmail_inbox(limit=5)`
  3. For in_progress subtasks: Review with `swarm_review`
  4. For open subtasks: Spawn workers with `swarm_spawn_subtask`
  5. For blocked subtasks: Investigate and unblock
  ```

  Also captures specific swarm state during detection:

  - Epic ID and title (not placeholders)
  - Subtask counts by status
  - Actual project path

  **New eval infrastructure:**

  - `coordinator-behavior.eval.ts` - LLM-as-judge eval testing whether Claude actually behaves like a coordinator given the injected context
  - Scorers for coordinator tools, avoiding worker behaviors, and coordinator mindset

  > "The coordinator's job is to keep the swarm cooking, not to cook themselves."

- Updated dependencies [[`a78a40d`](https://github.com/joelhooks/swarm-tools/commit/a78a40de32eb34d1738b208f2a36929a4ab6cb81), [`5a7c084`](https://github.com/joelhooks/swarm-tools/commit/5a7c084514297b5b9ca5df9459a74f18eb805b8a)]:
  - swarm-mail@1.5.0

## 0.33.0

### Minor Changes

- [`c41abcf`](https://github.com/joelhooks/swarm-tools/commit/c41abcfa37292b72fe41e0cf9d25c6612ae75fa2) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🎓 Skills Grow Up: Discovery Moves to OpenCode

  > _"The best code is no code at all. Every new line of code you willingly bring into the world is code that has to be debugged, code that has to be read and understood, code that has to be supported."_
  > — Jeff Atwood

  Skills outgrew the nest. OpenCode is shipping native skills support following the [Agent Skills spec](https://spec.agentskills.com/), and our discovery tools are now redundant. Time to deprecate the scaffolding and let the platform handle what it does best.

  ### What Changed

  **Deprecated Tools** (soft deprecation with console warnings):

  - `skills_list` - OpenCode will handle discovery natively
  - `skills_use` - OpenCode will handle loading via `use skill <name>` syntax
  - `skills_read` - OpenCode will handle resource access transparently
  - `skills_execute` - OpenCode will handle script execution in skill context

  **Authoring Tools Kept** (fully functional, no changes):

  - `skills_create` - Create new skills with SKILL.md template
  - `skills_update` - Update existing skill content
  - `skills_init` - Initialize skills directory in projects
  - `skills_add_script` - Add executable scripts to skills
  - `skills_delete` - Remove project skills

  **Bundled Skills** - All 6 global skills remain intact and spec-compliant:

  - `testing-patterns` - Feathers seams + Beck's 4 rules
  - `swarm-coordination` - Multi-agent task orchestration
  - `cli-builder` - Command-line interface patterns
  - `learning-systems` - Confidence decay, pattern maturity
  - `skill-creator` - Meta-skill for authoring new skills
  - `system-design` - Architecture decision frameworks

  ### Why It Matters

  **Before:** Two overlapping skill systems causing confusion. Agents could use plugin tools OR OpenCode's native syntax, with different behavior and semantics.

  **After:** One canonical path. OpenCode owns discovery and loading. Plugin owns authoring and validation. Clean separation of concerns.

  **Benefits:**

  - No tool conflicts between plugin and platform
  - Native OpenCode syntax (`use skill testing-patterns`) works seamlessly
  - Simpler mental model for users
  - Authoring tools remain for creating spec-compliant skills

  ### Migration Path

  **For Discovery/Loading:**

  ```typescript
  // OLD (deprecated, still works but warns)
  skills_list()
  skills_use(name="testing-patterns")

  // NEW (OpenCode native syntax)
  use skill testing-patterns
  use skill cli-builder with "building argument parser"
  ```

  **For Authoring (no change needed):**

  ```typescript
  // Still fully supported
  skills_create((name = "my-skill"), (description = "Domain expertise"));
  skills_update((name = "my-skill"), (content = "Updated SKILL.md"));
  skills_add_script(
    (skill_name = "my-skill"),
    (script_name = "validate.ts"),
    (content = "...")
  );
  ```

  ### Backward Compatibility

  **Yes, with warnings.** Deprecated tools continue to function but emit console warnings directing users to OpenCode's native syntax. No breaking changes in this release.

  Future major version (v1.0) will remove deprecated discovery tools entirely. Authoring tools remain permanent.

  ### What This Means for Bundled Skills

  Nothing changes. All 6 global skills ship with the plugin and are accessible via OpenCode's native `use skill <name>` syntax. They follow the Agent Skills spec and work identically whether loaded via deprecated plugin tools or native OpenCode.

  The `global-skills/` directory remains the canonical source for our curated skill library.

- [`4feebaf`](https://github.com/joelhooks/swarm-tools/commit/4feebafed61caa8e2e8729b44bd415d71afd6834) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 LLM-Powered Compaction: The Swarm Remembers

  > "The best way to predict the future is to invent it." — Alan Kay

  Compaction just got smarter. Instead of static "here's what to preserve" instructions, the swarm now **generates dynamic continuation prompts** with actual state data.

  **What changed:**

  The `experimental.session.compacting` hook now uses a three-level fallback chain:

  1. **LLM-Generated Prompt** (NEW) - Queries actual swarm state (cells, epics, subtasks), shells out to `opencode run -m <liteModel>` to generate a structured continuation prompt with real IDs, real status, real next actions
  2. **Static Context** - Falls back to `SWARM_COMPACTION_CONTEXT` if LLM fails
  3. **Detection Fallback** - For low-confidence swarm detection, injects `SWARM_DETECTION_FALLBACK`
  4. **None** - No injection if no swarm evidence

  **Progressive Enhancement:**

  Uses OpenCode PR #5907's new `output.prompt` API when available:

  ```typescript
  if ("prompt" in output) {
    output.prompt = llmGeneratedPrompt; // Replaces entire compaction prompt
  } else {
    output.context.push(llmGeneratedPrompt); // Old API fallback
  }
  ```

  **New interfaces:**

  - `SwarmStateSnapshot` - Structured state for LLM input
  - `querySwarmState()` - Queries cells via swarm CLI
  - `generateCompactionPrompt()` - Shells out to lite model (30s timeout)

  **Why it matters:**

  Before: "Hey, you should preserve swarm state" (agent has to figure out what that means)
  After: "Here's epic bd-xyz with 3/5 subtasks done, bd-xyz.2 is blocked on auth, spawn bd-xyz.4 next"

  The coordinator wakes up from compaction with **concrete data**, not instructions to go find data.

  **Backward compatible:** Falls back gracefully on older OpenCode versions or LLM failures.

- [`652fd16`](https://github.com/joelhooks/swarm-tools/commit/652fd16ff424eff92ebb3f5da0599caf676de2ce) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔭 Observability Stack MVP: See What Your Swarm Is Doing

  > "You can't improve what you can't measure." — Peter Drucker

  The swarm just got eyes. This release adds comprehensive observability for multi-agent coordination, answering the eternal question: "Why did my epic fail?"

  ### What's New

  **Structured Error Classes** (swarm-mail)

  - `BaseSwarmError` with rich context: agent, bead_id, epic_id, timestamp, recent events
  - Specialized errors: `ReservationError`, `CheckpointError`, `ValidationError`, `DecompositionError`
  - Every error includes actionable suggestions for resolution
  - Full `toJSON()` serialization for logging and debugging

  **DEBUG Logging** (swarm-mail)

  - `DEBUG=swarm:*` environment variable filtering
  - 4 subsystems: `swarm:events`, `swarm:reservations`, `swarm:messages`, `swarm:checkpoints`
  - Zero overhead when disabled

  **swarm-db CLI** (swarm-mail)

  ```bash
  # Raw SQL queries (SELECT only, max 1000 rows)
  swarm-db query "SELECT type, COUNT(*) FROM events GROUP BY type"

  # Pre-built analytics
  swarm-db analytics failed-decompositions --since 7d --format json

  # List available analytics
  swarm-db list
  ```

  **10 Pre-built Analytics Queries** (Four Golden Signals mapped)
  | Query | What It Answers |
  |-------|-----------------|
  | `failed-decompositions` | Which strategies are failing? |
  | `strategy-success-rates` | What's working? |
  | `lock-contention` | Where are agents fighting over files? |
  | `agent-activity` | Who's doing what? |
  | `message-latency` | How fast is coordination? |
  | `scope-violations` | Who's touching files they shouldn't? |
  | `task-duration` | How long do tasks take? |
  | `checkpoint-frequency` | Are agents checkpointing enough? |
  | `recovery-success` | Do checkpoints actually help? |
  | `human-feedback` | What are reviewers rejecting? |

  **Agent-Facing Tools** (opencode-swarm-plugin)

  ```typescript
  // Query analytics programmatically
  swarm_analytics({
    query: "failed-decompositions",
    since: "7d",
    format: "summary",
  });

  // Raw SQL for power users (max 50 rows, context-safe)
  swarm_query({ sql: "SELECT * FROM events WHERE type = 'task_blocked'" });

  // Auto-diagnosis for debugging
  swarm_diagnose({
    epic_id: "bd-123",
    include: ["blockers", "errors", "timeline"],
  });

  // Learning insights for feedback loops
  swarm_insights({ scope: "epic", metrics: ["success_rate", "avg_duration"] });
  ```

  ### Why This Matters

  Before: "The swarm failed. No idea why."
  After: "Strategy X failed 80% of the time due to file conflicts. Switching to Y."

  Event sourcing was already 80% of the solution. This release adds the diagnostic views to make that data actionable.

  ### Test Coverage

  - 588 tests passing
  - 1214 assertions
  - Full TDD: every feature started with a failing test

- [`ca9936d`](https://github.com/joelhooks/swarm-tools/commit/ca9936d09b749449ef3c88fd3ec8b937f6ed7c29) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔬 Research Phase: Docs Before Decomposition

  Swarm coordinators now gather documentation BEFORE breaking down tasks. No more workers fumbling through outdated API assumptions.

  **What's New:**

  - **swarm/researcher agent** - READ-ONLY doc gatherer that discovers tools, reads lockfiles, fetches version-specific docs, and stores findings in semantic-memory
  - **Pre-decomposition research** - Coordinator analyzes task → identifies tech stack → spawns researchers → injects findings into shared_context
  - **On-demand research for workers** - Workers can spawn researchers when hitting unknowns mid-task
  - **`--check-upgrades` flag** - Compare installed vs latest versions from npm registry

  **New Tools:**

  | Tool                     | Purpose                                                     |
  | ------------------------ | ----------------------------------------------------------- |
  | `swarm_discover_tools`   | Runtime discovery of available doc tools (MCP, CLI, skills) |
  | `swarm_get_versions`     | Parse lockfiles (npm/pnpm/yarn/bun) for installed versions  |
  | `swarm_spawn_researcher` | Generate researcher prompt for Task tool                    |
  | `swarm_research_phase`   | Manual trigger for research orchestration                   |

  **Architecture:**

  ```
  Coordinator receives task
      ↓
  runResearchPhase(task, projectPath)
      ↓
    extractTechStack() → identify technologies
    discoverDocTools() → find available tools
    getInstalledVersions() → read lockfiles
    Spawn researchers (parallel)
    Collect summaries → shared_context
      ↓
  Normal decomposition with enriched context
  ```

  **Why This Matters:**

  Workers now start with version-specific documentation instead of hallucinating APIs. Researchers store detailed findings in semantic-memory, so future agents don't repeat the research.

### Patch Changes

- Updated dependencies [[`652fd16`](https://github.com/joelhooks/swarm-tools/commit/652fd16ff424eff92ebb3f5da0599caf676de2ce)]:
  - swarm-mail@1.4.0

## 0.32.0

### Minor Changes

- [#54](https://github.com/joelhooks/swarm-tools/pull/54) [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🔍 Coordinator Review Gate + UBS Removal

  > _"This asynchronous back and forth between submitter and reviewer can add days to the process of getting changes made. Do Code Reviews Promptly!"_
  > — Sam Newman, _Building Microservices_

  Two changes that make swarm coordination tighter:

  ### Coordinator Review Tools

  New tools for coordinators to review worker output before approval:

  ```
  ┌─────────────────────────────────────────────────────┐
  │              COORDINATOR REVIEW FLOW                │
  ├─────────────────────────────────────────────────────┤
  │  1. Worker completes → sends completion message     │
  │  2. Coordinator: swarm_review(task_id, files)       │
  │     → Gets diff + epic context + review prompt      │
  │  3. Coordinator reviews against epic goals          │
  │  4. swarm_review_feedback(status, issues)           │
  │     → approved: worker can finalize                 │
  │     → needs_changes: worker gets feedback           │
  │  5. 3-strike rule: 3 rejections = blocked           │
  └─────────────────────────────────────────────────────┘
  ```

  **New tools:**

  - `swarm_review` - Generate review prompt with epic context + git diff
  - `swarm_review_feedback` - Send approval/rejection with structured issues

  **Updated prompts:**

  - Coordinator prompt now includes review checklist
  - Worker prompt explains the review gate
  - Skills updated with review patterns

  ### UBS Scan Removed from swarm_complete

  The `skip_ubs_scan` parameter is gone. UBS was already disabled in v0.31 for performance - this cleans up the vestigial code.

  **Removed:**

  - `skip_ubs_scan` parameter from schema
  - `ubs_scan` deprecation object from output
  - All UBS-related helper functions
  - ~100 lines of dead code

  **If you need UBS scanning:** Run it manually before commit:

  ```bash
  ubs scan src/
  ```

  ### CLI Improvements

  The `swarm` CLI got smarter:

  - Better error messages for missing dependencies
  - Cleaner output formatting
  - Improved help text

### Patch Changes

- [#54](https://github.com/joelhooks/swarm-tools/pull/54) [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🧪 Integration Test Coverage: 0% → 95%

  > _"Many characterization tests look like 'sunny day' tests. They don't test many special conditions; they just verify that particular behaviors are present. From their presence, we can infer that refactoring hasn't broken anything."_
  > — Michael Feathers, _Working Effectively with Legacy Code_

  We had a bug that broke ALL swarm tools:

  ```
  Error: [streams/store] dbOverride parameter is required for this function.
  PGlite getDatabase() has been removed.
  ```

  **Why didn't tests catch it?** No integration tests exercised the full tool → store → DB path.

  **Now they do.**

  ```
  ┌─────────────────────────────────────────────────────────────────┐
  │              tool-adapter.integration.test.ts                   │
  ├─────────────────────────────────────────────────────────────────┤
  │  20 tests | 75 assertions | 1.3s                                │
  │                                                                 │
  │  ✅ swarmmail_* tools (6 tests)                                 │
  │  ✅ hive_* tools (7 tests)                                      │
  │  ✅ swarm_progress, swarm_status (2 tests)                      │
  │  ✅ swarm_broadcast, swarm_checkpoint (2 tests)                 │
  │  ✅ semantic_memory_store, semantic_memory_find (2 tests)       │
  │  ✅ Smoke test - 9 tools in sequence (1 test)                   │
  └─────────────────────────────────────────────────────────────────┘
  ```

  ### What's Tested

  Each test calls `tool.execute()` and verifies:

  1. No "dbOverride required" error (the bug symptom)
  2. Tool returns expected structure
  3. Full path works: tool → store → DB → response

  ### The Smoke Test

  Runs 9 tools in sequence to catch interaction bugs:

  ```
  swarmmail_init → hive_create → swarmmail_reserve → swarm_progress
  → semantic_memory_store → semantic_memory_find → swarmmail_send
  → hive_close → swarmmail_release
  ```

  If ANY step throws "dbOverride required", the test fails.

  ### Also Fixed

  - **Auto-adapter creation** in store.ts - functions now auto-create adapters when not provided
  - **Exported `clearAdapterCache()`** for test isolation
  - **Migrated test files** from old `getDatabase()` to adapter pattern

  ### Mandatory Coordinator Review Loop

  Added `COORDINATOR_POST_WORKER_CHECKLIST` constant and `post_completion_instructions` field to `swarm_spawn_subtask`. Coordinators now get explicit instructions to review worker output before spawning the next worker.

  The "dbOverride required" bug **cannot recur undetected**.

- Updated dependencies [[`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101), [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101), [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101), [`358e18f`](https://github.com/joelhooks/swarm-tools/commit/358e18f0f7f18d03492ef16c2c1d3edd85c00101)]:
  - swarm-mail@1.3.0

## 0.31.7

### Patch Changes

- [`97e89a6`](https://github.com/joelhooks/swarm-tools/commit/97e89a6d944b70f205eeb83eb3f2c55a42f5dc08) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Setup Skips Already-Migrated Memories

  `swarm setup` now detects when semantic memories have already been migrated and skips the migration prompt entirely.

  **Before:** Setup would prompt "Migrate to swarm-mail database?" even when all memories were already migrated, then hang.

  **After:** Setup checks if target database has memories first. If already migrated, shows dim "Already migrated to swarm-mail" and moves on.

  **Changes:**

  - Added `targetHasMemories(targetDb)` function to swarm-mail
  - Updated setup flow to check target before prompting
  - Fixed connection cleanup in all code paths (try/finally pattern)
  - Suppressed internal PGLite NOTICE messages from user output

  **Root cause of hang:** PGLite connection wasn't being closed in all paths, keeping the Node.js event loop alive indefinitely.

- Updated dependencies [[`97e89a6`](https://github.com/joelhooks/swarm-tools/commit/97e89a6d944b70f205eeb83eb3f2c55a42f5dc08)]:
  - swarm-mail@1.2.2

## 0.31.6

### Patch Changes

- [`3147d36`](https://github.com/joelhooks/swarm-tools/commit/3147d36cf2355b9cfe461c7dfc3b30675ea36d89) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🚪 Setup Now Exits Cleanly After Migration

  Fixed a process hang where `swarm setup` would complete the migration but never exit.

  **Root cause:** The PGLite connection created for memory migration kept the Node.js event loop alive indefinitely.

  **Fix:** Close the swarmMail connection after migration completes. The connection is scoped to the migration block and not needed afterward.

  ```typescript
  // After migration completes
  await swarmMail.close();
  ```

  **Before:** `swarm setup` hangs after "Migration complete" message
  **After:** Process exits cleanly, returns to shell

## 0.31.5

### Patch Changes

- Updated dependencies [[`64368aa`](https://github.com/joelhooks/swarm-tools/commit/64368aa6106089346cd2b1324f6235d5c673964b)]:
  - swarm-mail@1.2.1

## 0.31.4

### Patch Changes

- Updated dependencies [[`70ff3e0`](https://github.com/joelhooks/swarm-tools/commit/70ff3e054cd1991154f7631ce078798de1076ba8)]:
  - swarm-mail@1.2.0

## 0.31.3

### Patch Changes

- [`fdddd27`](https://github.com/joelhooks/swarm-tools/commit/fdddd27f9c8627f7de2b9f108827c66c7040b049) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Short Hashes Now Welcome

  The WorkerHandoff schema was too strict - it rejected short project names and partial hashes.

  **Before:** Required 3+ hyphen-separated segments (regex nightmare)

  ```
  /^[a-z0-9]+(-[a-z0-9]+){2,}(\.[\w-]+)?$/
  ```

  **After:** Any non-empty string, validated at runtime via `resolvePartialId()`

  Now you can use:

  - Full IDs: `opencode-swarm-monorepo-lf2p4u-mjd4pjujc7e`
  - Short hashes: `mjd4pjujc7e`
  - Partial hashes: `mjd4pjuj`

  The hive tools already had smart ID resolution - we just needed to stop blocking it at the schema level.

## 0.31.2

### Patch Changes

- [`d5ec86e`](https://github.com/joelhooks/swarm-tools/commit/d5ec86e77bdb1cd06cf168946aaaff91208dfac1) Thanks [@joelhooks](https://github.com/joelhooks)! - Rebuild with fixed swarm-mail dependency (bigint date fix)

## 0.31.1

### Patch Changes

- [`19995a6`](https://github.com/joelhooks/swarm-tools/commit/19995a68dd1283de1d13afa6fc028bd1273d1b27) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Squashed the BigInt Date Bug

  PGLite returns BIGINT columns as JavaScript `bigint` type. The `Date` constructor throws when given a bigint:

  ```javascript
  new Date(1734628445371n); // TypeError: Cannot convert a BigInt value to a number
  ```

  This caused `Invalid Date` errors in all hive operations (`hive_query`, `hive_create`, etc).

  **Fix:** Wrap timestamps in `Number()` before passing to `Date`:

  ```typescript
  // Before (broken)
  new Date(cell.created_at);

  // After (works with both number and bigint)
  new Date(Number(cell.created_at));
  ```

  **Files fixed:**

  - `swarm-mail/src/hive/jsonl.ts` - JSONL export functions
  - `opencode-swarm-plugin/src/hive.ts` - `formatCellForOutput()`

  **Tests added:** 6 new tests covering bigint date handling edge cases.

- Updated dependencies [[`19995a6`](https://github.com/joelhooks/swarm-tools/commit/19995a68dd1283de1d13afa6fc028bd1273d1b27)]:
  - swarm-mail@1.1.1

## 0.31.0

### Minor Changes

- [`39593d7`](https://github.com/joelhooks/swarm-tools/commit/39593d7ee817c683ad1877af52ad5f2ca140c4e2) Thanks [@joelhooks](https://github.com/joelhooks)! - ## Smart ID Resolution: Git-Style Partial Hashes for Hive

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  BEFORE: hive_close(id="opencode-swarm-monorepo-lf2p4u-mjcadqq3fb9")  │
  │  AFTER:  hive_close(id="mjcadqq3fb9")                                 │
  └─────────────────────────────────────────────────────────────┘
  ```

  Cell IDs got long. Now you can use just the hash portion.

  **What changed:**

  ### swarm-mail

  - Added `resolvePartialId(adapter, partialId)` to resolve partial hashes to full cell IDs
  - Supports exact match, prefix match, suffix match, and substring match
  - Returns helpful error messages for ambiguous matches ("Found 3 cells matching 'abc': ...")
  - 36 new tests covering all resolution scenarios

  ### opencode-swarm-plugin

  - `hive_update`, `hive_close`, `hive_start` now accept partial IDs
  - Resolution happens transparently - full ID returned in response
  - Backward compatible - full IDs still work

  **JSONL Fix (bonus):**

  - `serializeToJSONL()` now adds trailing newline for POSIX compliance
  - Prevents parse errors when appending to existing files

  **Why it matters:**

  - Less typing, fewer copy-paste errors
  - Matches git's partial SHA workflow (muscle memory)
  - Ambiguous matches fail fast with actionable error messages

  > "The best interface is no interface" - Golden Krishna
  > (But if you must have one, make it forgive typos)

  ***

  ## Auto-Sync at Key Events

  ```
  ┌─────────────────────────────────────────┐
  │  hive_create_epic  →  auto-sync         │
  │  swarm_complete    →  auto-sync         │
  │  process.exit      →  safety net sync   │
  └─────────────────────────────────────────┘
  ```

  Cells no longer get lost when processes exit unexpectedly.

  **What changed:**

  - `hive_create_epic` syncs after creating epic + subtasks (workers can see them immediately)
  - `swarm_complete` syncs before worker exits (completed work persists)
  - `process.on('beforeExit')` hook catches any remaining dirty cells

  **Why it matters:**

  - Spawned workers couldn't see cells created by coordinator (race condition)
  - Worker crashes could lose completed work
  - Now the lazy-write pattern has strategic checkpoints

  ***

  ## Removed Arbitrary Subtask Limits

  ```
  BEFORE: max_subtasks capped at 10 (why tho?)
  AFTER:  no limit - LLM decides based on task complexity
  ```

  **What changed:**

  - Removed `.max(10)` from `swarm_decompose` and `swarm_plan_prompt`
  - `max_subtasks` is now optional with no default
  - Prompt says "as many as needed" instead of "2-10"

  **Why it matters:**

  - Complex epics need more than 10 subtasks
  - Arbitrary limits force awkward decomposition
  - Trust the coordinator to make good decisions

### Patch Changes

- Updated dependencies [[`39593d7`](https://github.com/joelhooks/swarm-tools/commit/39593d7ee817c683ad1877af52ad5f2ca140c4e2)]:
  - swarm-mail@1.1.0

## 0.30.7

### Patch Changes

- Updated dependencies [[`230e9aa`](https://github.com/joelhooks/swarm-tools/commit/230e9aa91708610183119680cb5f6924c1089552), [`181fdd5`](https://github.com/joelhooks/swarm-tools/commit/181fdd507b957ceb95e069ae71d527d3f7e1b940)]:
  - swarm-mail@1.0.0

## 0.30.6

### Patch Changes

- [`32a2885`](https://github.com/joelhooks/swarm-tools/commit/32a2885115cc3e574e86d8e492f60ee189627488) Thanks [@joelhooks](https://github.com/joelhooks)! - chore: verify CI publish flow works

## 0.30.5

### Patch Changes

- [`08e61ab`](https://github.com/joelhooks/swarm-tools/commit/08e61abd96ced0443a5ac5dca0e8f362ed869075) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Workers Now Choose Their Own Model

  Added intelligent model selection for swarm workers based on task characteristics.

  **What changed:**

  - `swarm setup` now asks for a "lite model" preference (docs/tests/simple edits)
  - New `selectWorkerModel()` function auto-selects based on file types
  - `swarm_spawn_subtask` includes `recommended_model` in metadata
  - `DecomposedSubtask` schema supports optional explicit `model` field

  **Model selection priority:**

  1. Explicit `model` field in subtask (if specified)
  2. File-type inference:
     - All `.md`/`.mdx` files → lite model
     - All `.test.`/`.spec.` files → lite model
  3. Mixed or implementation files → primary model

  **Why it matters:**

  - Cost savings: docs and tests don't need expensive models
  - Faster execution: lite models are snappier for simple tasks
  - Better defaults: right-sized models for each subtask type
  - Still flexible: coordinators can override per-subtask

  **Backward compatible:**

  - Existing workflows continue to work
  - Model selection is transparent to agents
  - Defaults to primary model if lite model not configured

  **Example:**

  ```typescript
  // Subtask with all markdown files
  { files: ["README.md", "docs/guide.mdx"] }
  // → selects lite model (haiku)

  // Subtask with mixed files
  { files: ["src/auth.ts", "README.md"] }
  // → selects primary model (sonnet)

  // Explicit override
  { files: ["complex-refactor.ts"], model: "anthropic/claude-opus-4-5" }
  // → uses opus as specified
  ```

## 0.30.4

### Patch Changes

- [`1c9a2e8`](https://github.com/joelhooks/swarm-tools/commit/1c9a2e8a148b79a33cb8c5b565e485f33d1f617c) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Fix Migration Adapter Type (for real this time)

  The previous release (0.30.3) was published before this fix landed. Now it's actually in.

  **The Bug:**

  ```
  targetDb.query is not a function
  ```

  **Root Cause:**
  `getSwarmMail()` returns `SwarmMailAdapter`, not `DatabaseAdapter`. Need to call `getDatabase()` first.

  **The Fix:**

  ```typescript
  const swarmMail = await getSwarmMail(cwd);
  const targetDb = await swarmMail.getDatabase(cwd);
  ```

## 0.30.3

### Patch Changes

- [`cc84c8f`](https://github.com/joelhooks/swarm-tools/commit/cc84c8f066696c7625dc307a5163ff50d672634e) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Fix Migration Adapter Type Mismatch

  > _"The compiler is your friend. Listen to it."_
  > — Every TypeScript developer, eventually

  Fixed a runtime error in `swarm setup` where the legacy memory migration was receiving a `SwarmMailAdapter` instead of a `DatabaseAdapter`.

  **The Bug:**

  ```
  targetDb.query is not a function
  ```

  **Root Cause:**
  `getSwarmMail()` returns a `SwarmMailAdapter` which has `getDatabase()` method, not a direct `query()` method. The migration code expected a `DatabaseAdapter`.

  **The Fix:**

  ```typescript
  // Before (wrong)
  const targetDb = await getSwarmMail(cwd);

  // After (correct)
  const swarmMail = await getSwarmMail(cwd);
  const targetDb = await swarmMail.getDatabase(cwd);
  ```

  **Test Added:**
  New test case verifies that passing an invalid adapter (without `query()`) fails gracefully with a descriptive error instead of crashing.

- [`1e41c9b`](https://github.com/joelhooks/swarm-tools/commit/1e41c9b42ae468761f813d406171d182fb9948e0) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Semantic Memory Consolidation

  > _"Simplicity is the ultimate sophistication."_
  > — Leonardo da Vinci

  The semantic memory system has moved into swarm-mail, bringing persistent learning to the hive.

  ### What's New

  **Semantic Memory in swarm-mail:**

  - `createSemanticMemory()` - Initialize memory store with PGLite + Ollama embeddings
  - `getMigrationStatus()` - Check if legacy memory needs migration
  - `migrateLegacyMemory()` - Migrate from old semantic-memory-mcp format
  - Automatic migration on first use (no manual intervention needed)

  **Legacy Migration:**

  - Detects old `~/.semantic-memory/` databases
  - Migrates memories, embeddings, and metadata
  - Preserves all tags and timestamps
  - Creates backup before migration

  **Worker Handoff Protocol:**

  - Agents can now hand off work mid-task
  - State preserved via swarm mail messages
  - Enables long-running tasks across context limits

  ### Breaking Changes

  None - this is additive. The old semantic-memory-mcp still works but is deprecated.

  ### Files Added/Changed

  - `packages/swarm-mail/src/memory/` - New memory subsystem
  - `packages/swarm-mail/src/memory/migrate-legacy.ts` - Migration tooling
  - `packages/opencode-swarm-plugin/bin/swarm.ts` - Uses new exports

- Updated dependencies [[`1e41c9b`](https://github.com/joelhooks/swarm-tools/commit/1e41c9b42ae468761f813d406171d182fb9948e0)]:
  - swarm-mail@0.5.0

## 0.30.2

### Patch Changes

- [`5858148`](https://github.com/joelhooks/swarm-tools/commit/5858148d5785393c0a6993a2595fba275f305707) Thanks [@joelhooks](https://github.com/joelhooks)! - chore: trigger publish workflow

## 0.30.1

### Patch Changes

- [`57d5600`](https://github.com/joelhooks/swarm-tools/commit/57d5600a53e148ce1d1da48b3b5a8723a5552e04) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🚦 Review Gate UX Fix + Verbose Setup

  > _"A common mistake that people make when trying to design something completely foolproof is to underestimate the ingenuity of complete fools."_
  > — Douglas Adams, _Mostly Harmless_

  Two UX improvements that make swarm coordination feel less like shouting into the void.

  ### What Changed

  **Review Gate Response Fix:**

  - `swarm_complete` no longer returns `success: false` when code review is pending
  - Now returns `success: true` with `status: "pending_review"` or `status: "needs_changes"`
  - **Why it matters**: The old format made review checkpoints look like errors. Agents would retry unnecessarily or report failures when the workflow was actually working as designed. Review gates are a feature, not a bug.

  **Setup Command Verbosity:**

  - Added `p.log.step()` and `p.log.success()` throughout swarm setup
  - Users can now see exactly what's happening: dependency checks, git init, swarm-mail connection
  - **Why it matters**: Silent setup commands feel broken. Explicit progress logs build trust and make debugging easier when setup actually does fail.

  ### Why It Matters

  **For Agents:**

  - No more false-negative responses from review gates
  - Clear workflow state (pending vs. needs changes vs. complete)
  - Reduced retry loops and error noise

  **For Users:**

  - Setup command shows its work (not a black box)
  - Review process is transparent in logs
  - Easier to diagnose when things actually break

  **Backward compatible:** Yes. Existing agents checking for `success: false` will still work, they just won't see false errors anymore.

## 0.30.0

### Minor Changes

- [`f3917ad`](https://github.com/joelhooks/swarm-tools/commit/f3917ad911d3c716a2470a01c66bce3500f644f4) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 The Great bd CLI Purge

  The `bd` CLI is officially dead. Long live HiveAdapter!

  **What changed:**

  ### `swarm init` Command Rewritten

  - No longer shells out to `bd init` or `bd create`
  - Uses `ensureHiveDirectory()` and `getHiveAdapter()` directly
  - Supports `.beads` → `.hive` migration with user prompts
  - Creates cells via HiveAdapter, not CLI

  ### Auto-sync Removed from `index.ts`

  - Removed `void $\`bd sync\`.quiet().nothrow()`after`hive_close`
  - Users should call `hive_sync` explicitly at session end
  - This was a fire-and-forget that could race with other operations

  ### Plugin Template Updated

  - `detectSwarm()` now has confidence levels (HIGH/MEDIUM/LOW/NONE)
  - Added `SWARM_DETECTION_FALLBACK` for uncertain cases
  - Compaction hook injects context based on confidence:
    - HIGH/MEDIUM → Full swarm context
    - LOW → Fallback detection prompt
    - NONE → No injection

  ### Error Handling Fixed

  - `execTool()` now handles both string and object error formats
  - Fixes "Tool execution failed" generic error from `swarm_complete`
  - Actual error messages now propagate to the agent

  **Why it matters:**

  - No external CLI dependency for core functionality
  - HiveAdapter is type-safe and testable
  - Plugin works in environments without `bd` installed
  - Better error messages for debugging

  **Migration:** Run `swarm setup` to update your deployed plugin.

## 0.29.0

### Minor Changes

- [`a2ff1f4`](https://github.com/joelhooks/swarm-tools/commit/a2ff1f4257a2e9857f63abe4e9b941a573f44380) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Cell IDs Now Wear Their Project Colors

  > _"We may fantasize about being International Men of Mystery, but our code needs to be mundane and clear. One of the most important parts of clear code is good names."_
  > — Martin Fowler, _Refactoring_

  Cell IDs finally know where they came from. Instead of anonymous `bd-xxx` prefixes,
  new cells proudly display their project name: `swarm-mail-lf2p4u-abc123`.

  ### What Changed

  **swarm-mail:**

  - `generateBeadId()` now reads `package.json` name field from project directory
  - Added `slugifyProjectName()` for safe ID generation (lowercase, special chars → dashes)
  - Falls back to `cell-` prefix if no package.json or no name field

  **opencode-swarm-plugin:**

  - Removed all `bd` CLI usage from `swarm-orchestrate.ts` - now uses HiveAdapter
  - Improved compaction hook swarm detection with confidence levels (high/medium/low)
  - Added fallback detection prompt for uncertain swarm states

  ### Examples

  | Before                  | After                           |
  | ----------------------- | ------------------------------- |
  | `bd-lf2p4u-mjbneh7mqah` | `swarm-mail-lf2p4u-mjbneh7mqah` |
  | `bd-abc123-xyz`         | `my-cool-app-abc123-xyz`        |
  | (no package.json)       | `cell-abc123-xyz`               |

  ### Why It Matters

  - **Identifiable at a glance** - Know which project a cell belongs to without looking it up
  - **Multi-project workspaces** - Filter/search cells by project prefix
  - **Terminology cleanup** - Removes legacy "bead" (`bd-`) from user-facing IDs

  ### Backward Compatible

  Existing `bd-*` IDs still work fine. No migration needed - only NEW cells get project prefixes.

  ### Compaction: Keeping the Swarm Alive

  > _"Intelligent and structured group dynamics that emerge not from a leader, but from the local interactions of the elements themselves."_
  > — Daniel Shiffman, _The Nature of Code_

  The compaction hook now uses multi-signal detection to keep swarms cooking through context compression:

  - **HIGH confidence:** Active reservations, in_progress cells → full swarm context
  - **MEDIUM confidence:** Open subtasks, unclosed epics → full swarm context
  - **LOW confidence:** Any cells exist → fallback detection prompt

  Philosophy: Err on the side of continuation. A false positive costs context space. A false negative loses the swarm.

### Patch Changes

- Updated dependencies [[`a2ff1f4`](https://github.com/joelhooks/swarm-tools/commit/a2ff1f4257a2e9857f63abe4e9b941a573f44380)]:
  - swarm-mail@0.4.0

## 0.28.2

### Patch Changes

- Updated dependencies [[`90409ef`](https://github.com/joelhooks/swarm-tools/commit/90409ef4f353844b25fe04221bc80d6f930eced2)]:
  - swarm-mail@0.3.4

## 0.28.1

### Patch Changes

- [`0ee4f65`](https://github.com/joelhooks/swarm-tools/commit/0ee4f656c2fb2cf62d3ef06d329d9e093d124c33) Thanks [@joelhooks](https://github.com/joelhooks)! - Add postinstall hint and update repo URL

  - Show "Run swarm setup" hint after npm install
  - Update repo URL to github.com/joelhooks/swarm-tools
  - Add "Get started" commands to version output

## 0.28.0

### Minor Changes

- [`de2fa62`](https://github.com/joelhooks/swarm-tools/commit/de2fa628524b88511e06164104ff7b5fb93d39e5) Thanks [@joelhooks](https://github.com/joelhooks)! - Add full beads→hive migration pipeline with JSONL import to PGLite

  - Add `mergeHistoricBeads()` to merge beads.base.jsonl into issues.jsonl
  - Add `importJsonlToPGLite()` to import JSONL records into PGLite database
  - Wire both functions into `swarm setup` migration flow
  - Fix closed_at constraint issue when importing closed cells
  - TDD: 12 new integration tests for migration functions

## 0.27.4

### Patch Changes

- [`f23f774`](https://github.com/joelhooks/swarm-tools/commit/f23f774e4b83a3422d8266b6b1ad083daaec03e2) Thanks [@joelhooks](https://github.com/joelhooks)! - Enforce coordinator always spawns workers, never executes work directly

  - Added "Coordinator Role Boundaries" section to /swarm command
  - Coordinators now explicitly forbidden from editing code, running tests, or making "quick fixes"
  - Updated Phase 5 to clarify coordinators NEVER reserve files (workers do)
  - Updated Phase 6 with patterns for both parallel and sequential worker spawning
  - Worker agent template now confirms it was spawned correctly and to report coordinator violations

## 0.27.3

### Patch Changes

- [`ec23d25`](https://github.com/joelhooks/swarm-tools/commit/ec23d25aeca667c0294a6255fecf11dd7d7fd6b3) Thanks [@joelhooks](https://github.com/joelhooks)! - Add .beads → .hive directory migration support

  - Fix migration version collision: beadsMigration now v7, cellsViewMigration now v8 (was conflicting with streams v6)
  - Add `checkBeadsMigrationNeeded()` to detect legacy .beads directories
  - Add `migrateBeadsToHive()` to rename .beads to .hive
  - Add `ensureHiveDirectory()` to create .hive if missing (called by hive_sync)
  - Update hive_sync to ensure .hive directory exists before writing
  - Add migration prompt to `swarm setup` CLI flow

- Updated dependencies [[`ec23d25`](https://github.com/joelhooks/swarm-tools/commit/ec23d25aeca667c0294a6255fecf11dd7d7fd6b3)]:
  - swarm-mail@0.3.3

## 0.27.2

### Patch Changes

- [`50a2bf5`](https://github.com/joelhooks/swarm-tools/commit/50a2bf51c5320c038f202191d7acbfd2179f2cb3) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix cells view migration not being applied

  The v7 migration (cellsViewMigration) that creates the `cells` view was added after
  swarm-mail@0.3.0 was published. This caused `hive_sync` to fail with
  "relation cells does not exist" because the JSONL export queries the `cells` view.

  This patch ensures the v7 migration is included in the published package.

- Updated dependencies [[`50a2bf5`](https://github.com/joelhooks/swarm-tools/commit/50a2bf51c5320c038f202191d7acbfd2179f2cb3)]:
  - swarm-mail@0.3.2

## 0.27.0

### Minor Changes

- [`26fd2ef`](https://github.com/joelhooks/swarm-tools/commit/26fd2ef27562edc39f7db7a9cdbed399a465200d) Thanks [@joelhooks](https://github.com/joelhooks)! - Rename beads → hive across the codebase

  - `createBeadsAdapter` → `createHiveAdapter` (old name still exported as alias)
  - `BeadsAdapter` type → `HiveAdapter` type
  - All internal references updated to use hive terminology
  - Backward compatible: old exports still work but are deprecated

- [`ab23071`](https://github.com/joelhooks/swarm-tools/commit/ab23071cc7509c4fc37e1cac0f38a3812022cdf5) Thanks [@joelhooks](https://github.com/joelhooks)! - Add swarm-aware compaction hook to keep swarms cooking after context compression

  - New `experimental.session.compacting` hook detects active swarms and injects recovery context
  - `hasSwarmSign()` checks for swarm evidence: in-progress beads, subtasks, unclosed epics
  - Compaction prompt instructs coordinator to immediately resume orchestration
  - Fix @types/node conflicts by pinning to 22.19.3 in root overrides

### Patch Changes

- Updated dependencies [[`26fd2ef`](https://github.com/joelhooks/swarm-tools/commit/26fd2ef27562edc39f7db7a9cdbed399a465200d)]:
  - swarm-mail@0.3.0

## 0.26.1

### Patch Changes

- [`b2d4a84`](https://github.com/joelhooks/swarm-tools/commit/b2d4a84748cdef4b9dbca7666dd3d313b6cd2b24) Thanks [@joelhooks](https://github.com/joelhooks)! - Add automatic JSONL migration for beads on first use

  - Auto-migrate from `.beads/issues.jsonl` when database is empty
  - Fix import to handle missing dependencies/labels/comments arrays
  - Fix closed bead import to satisfy check constraint (status + closed_at)
  - Migrates 500+ historical beads seamlessly on first adapter initialization

- Updated dependencies [[`b2d4a84`](https://github.com/joelhooks/swarm-tools/commit/b2d4a84748cdef4b9dbca7666dd3d313b6cd2b24)]:
  - swarm-mail@0.2.1

## 0.26.0

### Minor Changes

- [`1a7b02f`](https://github.com/joelhooks/swarm-tools/commit/1a7b02f707a1490f14465467c6024331d5064878) Thanks [@joelhooks](https://github.com/joelhooks)! - Add PGLite socket server adapter with hybrid daemon management and move streams storage to $TMPDIR.

  **Socket Server Adapter:**

  - New `createSocketAdapter()` wrapping postgres.js for DatabaseAdapter interface
  - Daemon lifecycle: `startDaemon()`, `stopDaemon()`, `isDaemonRunning()`, `healthCheck()`
  - Auto-start daemon on first use with `SWARM_MAIL_SOCKET=true` env var
  - Graceful fallback to embedded PGLite on failure
  - CLI: `swarm-mail-daemon start|stop|status`

  **$TMPDIR Storage (BREAKING):**

  - Streams now stored in `$TMPDIR/opencode-<project-name>-<hash>/streams`
  - Eliminates git pollution from `.opencode/streams/`
  - Auto-cleaned on reboot (ephemeral coordination state)
  - New exports: `getProjectTempDirName()`, `hashProjectPath()`

  This fixes the multi-agent PGLite corruption issue by having all agents connect to a single pglite-server daemon via PostgreSQL wire protocol.

### Patch Changes

- Updated dependencies [[`1a7b02f`](https://github.com/joelhooks/swarm-tools/commit/1a7b02f707a1490f14465467c6024331d5064878)]:
  - swarm-mail@0.2.0

## 0.25.3

### Patch Changes

- [`7471fd4`](https://github.com/joelhooks/swarm-tools/commit/7471fd43ef9b16b32e503d7cd4bdc5b7a74537e4) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm_complete tool execution failures and remove debug logging

  **opencode-swarm-plugin:**

  - Fix: Made sendSwarmMessage non-fatal in swarm_complete - failures no longer cause "Tool execution failed" errors
  - Fix: Added message_sent and message_error fields to swarm_complete response for better error visibility
  - Chore: Removed console.log statements from index.ts, swarm-orchestrate.ts, storage.ts, rate-limiter.ts
  - Test: Added integration tests for swarm_complete error handling

  **swarm-mail:**

  - Chore: Cleaned up debug logging and improved migration handling

- Updated dependencies [[`7471fd4`](https://github.com/joelhooks/swarm-tools/commit/7471fd43ef9b16b32e503d7cd4bdc5b7a74537e4)]:
  - swarm-mail@0.1.4

## 0.25.2

### Patch Changes

- [`34a2c3a`](https://github.com/joelhooks/swarm-tools/commit/34a2c3a07f036297db449414ef8dbeb7b39721e2) Thanks [@joelhooks](https://github.com/joelhooks)! - Grant swarm workers autonomy to file beads against the epic

  Workers can now create bugs, tech debt, and follow-up tasks linked to their parent epic via `parent_id`. Prompt explicitly encourages workers to file issues rather than silently ignoring them.

## 0.25.1

### Patch Changes

- [`757f4a6`](https://github.com/joelhooks/swarm-tools/commit/757f4a690721b3f04a414e4c1694660862504e54) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix skills_update tool - add `content` parameter as primary (with `body` as backwards-compat alias)

  The tool was only accepting `body` but users expected `content`. Now both work:

  - `skills_update(name="foo", content="new stuff")` - preferred
  - `skills_update(name="foo", body="new stuff")` - still works for backwards compat

- [`3d619ff`](https://github.com/joelhooks/swarm-tools/commit/3d619ffda78b2e6066491f053e8fad8dac7b5b71) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm_complete failing when bead project doesn't match CWD

  - Use `project_key` as working directory for `bd close` command
  - Improved error messages with context-specific recovery steps
  - Added planning guardrails to warn when todowrite is used for parallel work (should use swarm)

## 0.25.0

### Minor Changes

- [`b70ae35`](https://github.com/joelhooks/swarm-tools/commit/b70ae352876515bdfe68511d72bb472c85b7fdfc) Thanks [@joelhooks](https://github.com/joelhooks)! - Add Socratic planning phase and improved worker prompts to swarm setup

  **SWARM_COMMAND template:**

  - Added Phase 0: Socratic Planning - asks clarifying questions before decomposing
  - Supports `--fast`, `--auto`, `--confirm-only` flags to skip questions
  - ONE question at a time with concrete options and recommendations

  **Worker agent template:**

  - Reinforces the 9-step survival checklist from SUBTASK_PROMPT_V2
  - Explicitly lists all steps with emphasis on non-negotiables
  - Explains WHY skipping steps causes problems (lost work, conflicts, etc.)

  **Agent path consolidation:**

  - Now creates nested paths: `~/.config/opencode/agent/swarm/worker.md`
  - Matches `Task(subagent_type="swarm/worker")` format
  - Cleans up legacy flat files (`swarm-worker.md`) on reinstall

  To get the new prompts, run `swarm setup` and choose "Reinstall everything".

## 0.24.0

### Minor Changes

- [`434f48f`](https://github.com/joelhooks/swarm-tools/commit/434f48f207c3509f6b924caeb47cd6e019dcc0e1) Thanks [@joelhooks](https://github.com/joelhooks)! - Add worker survival checklist and Socratic planning for swarm coordination

  **Worker Survival Checklist (9-step mandatory flow):**

  - Workers now follow a strict initialization sequence: swarmmail_init → semantic-memory_find → skills_use → swarmmail_reserve
  - Workers reserve their own files (coordinators no longer reserve on behalf of workers)
  - Auto-checkpoint at 25/50/75% progress milestones
  - Workers store learnings via semantic-memory before completing

  **Socratic Planning:**

  - New `swarm_plan_interactive` tool with 4 modes: socratic (default), fast, auto, confirm-only
  - Default mode asks clarifying questions before decomposition
  - Escape hatches for experienced users: `--fast`, `--auto`, `--confirm-only` flags on /swarm command

  **Updated Skills:**

  - swarm-coordination skill now documents worker survival patterns and coordinator rules

### Patch Changes

- [#15](https://github.com/joelhooks/swarm-tools/pull/15) [`299f2d3`](https://github.com/joelhooks/swarm-tools/commit/299f2d3305796bcb411f9b90715cda3513d17b54) Thanks [@tayiorbeii](https://github.com/tayiorbeii)! - Sync bundled skills into the global skills directory during `swarm setup` reinstall, fix bundled-skill path resolution, and make AGENTS.md skill-awareness updates work without relying on `opencode run`.

## 0.23.6

### Patch Changes

- Updated dependencies [[`22befbf`](https://github.com/joelhooks/opencode-swarm-plugin/commit/22befbfa120a37a585cfec0709597172efda92a4)]:
  - swarm-mail@0.1.3

## 0.23.5

### Patch Changes

- [`3826c6d`](https://github.com/joelhooks/opencode-swarm-plugin/commit/3826c6d887f937ccb201b7c4322cbc7b46823658) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* resolution by running bun install before pack

  The lockfile was stale, causing bun pack to resolve workspace:\* to old versions.
  Now runs bun install first to ensure lockfile matches current package.json versions.

## 0.23.4

### Patch Changes

- Updated dependencies [[`2d0fe9f`](https://github.com/joelhooks/opencode-swarm-plugin/commit/2d0fe9fc6278874ea6c4a92f0395cbdd11c4e994)]:
  - swarm-mail@0.1.2

## 0.23.3

### Patch Changes

- [`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm-mail package to include dist folder

  - Add files field to swarm-mail package.json to explicitly include dist/
  - Previous publish was missing build output, causing "Cannot find module" errors

- Updated dependencies [[`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7)]:
  - swarm-mail@0.1.1

## 0.23.2

### Patch Changes

- [`7f9ead6`](https://github.com/joelhooks/opencode-swarm-plugin/commit/7f9ead65dab1dd5dc9aff57df0871cc390556fe1) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* protocol resolution using bun pack + npm publish

  Uses bun pack to create tarball (which resolves workspace:\* to actual versions) then npm publish for OIDC trusted publisher support.

## 0.23.1

### Patch Changes

- [`64ad0e4`](https://github.com/joelhooks/opencode-swarm-plugin/commit/64ad0e4fc033597027e3b0614865cfbf955b5983) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix workspace:\* protocol resolution in npm publish

  Use bun publish instead of npm publish to properly resolve workspace:\* protocols to actual versions.

## 0.23.0

### Minor Changes

- [`b66d77e`](https://github.com/joelhooks/opencode-swarm-plugin/commit/b66d77e484e9b7021b3264d1a7e8f54a16ea5204) Thanks [@joelhooks](https://github.com/joelhooks)! - Add changesets workflow and semantic memory test isolation

  - OIDC publish workflow with GitHub Actions
  - Changesets for independent package versioning
  - TEST_SEMANTIC_MEMORY_COLLECTION env var for test isolation
  - Prevents test pollution of production semantic-memory
