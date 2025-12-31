---
"opencode-swarm-plugin": minor
"swarm-mail": patch
---

## Coordinator Guardrails & Hivemind Resilience

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
