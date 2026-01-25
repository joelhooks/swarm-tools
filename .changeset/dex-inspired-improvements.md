---
"swarm-mail": minor
"opencode-swarm-plugin": minor
---

feat: Dex-inspired improvements — result field, status dashboard, doctor, commit linking, tree display

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
