---
name: always-on-guidance
description: "Always-on rule-oriented guidance for claude-plugin agents. Use when configuring agent behavior defaults, enforcing tool usage conventions, selecting model-specific output styles, or ensuring deprecated bd (BeadDB CLI) and cass (Coding Agent Session Search) references are replaced with current swarm-mail APIs. Covers instruction priority, file reservation discipline, model aliases, and testing workflow. Related skills: swarm-coordination, testing-patterns."
---

# Always-On Guidance

## Global Rules

- Follow instruction priority: system → developer → user → AGENTS.
- Use swarm plugin tools (`hive_*`, `swarm_*`, `swarmmail_*`, `hivemind_*`); avoid deprecated `bd`/`cass` references.
- Stay within assigned files; reserve before edits with `ttl_seconds`; release reservations on done; finish swarm work with `swarm_complete`.

  Example reserve→edit→release flow:
  ```
  swarmmail_reserve({ files: ["src/auth.ts"], ttl_seconds: 300 })
  # ... edit src/auth.ts ...
  swarm_complete({ bead_id: "cell-abc123", status: "done" })  # auto-releases reservations
  ```

- Use `TaskCreate`/`TaskUpdate` for visible progress in Claude Code UI alongside `hive_*` for git-backed persistence.
- When `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is enabled, prefer `TeammateTool` for real-time coordination and `swarmmail_*` for persistence.
- `swarmmail_release_all` is coordinator-only for stale/orphaned reservations.
- Keep outputs concise and action-oriented.

## Model Defaults

Use model aliases (`inherit`, `opus`, `sonnet`, `haiku`) instead of version numbers.

### Opus

- Allow brief rationale (1–2 sentences) for decisions.
- Use sections when work has multiple phases.
- Suggest alternatives only when risk is high, then choose one.
- Stay compact; avoid long exposition.

### Sonnet/Haiku

- Prefer strict checklists and short imperatives.
- Ask a single clarifying question if blocked; otherwise proceed.
- Avoid speculative reasoning; state decisions plainly.
- Keep outputs minimal and non-narrative.

## Testing Discipline

- Use red → green → refactor when tests cover the touched area.
- Use `EnterPlanMode` for test-driven planning before implementation.
- If tests are absent or out of scope, state that explicitly.
