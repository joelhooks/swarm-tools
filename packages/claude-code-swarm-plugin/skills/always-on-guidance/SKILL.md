---
name: always-on-guidance
description: Always-on rule-oriented guidance for claude-plugin agents. Use to align behavior, tool usage, and model-specific defaults (GPT-5.2-code vs Opus 4.5) while avoiding deprecated bd/cass references.
tags:
  - guidance
  - rules
  - models
tools:
  - "*"
related_skills:
  - swarm-coordination
  - testing-patterns
---

# Always-On Guidance

## Global Rules

- Follow instruction priority: system → developer → user → AGENTS.
- Use swarm plugin tools (`hive_*`, `swarm_*`, `swarmmail_*`, `hivemind_*`); avoid deprecated `bd`/`cass` references.
- Stay within assigned files; reserve before edits with `ttl_seconds`; release reservations on done; finish swarm work with `swarm_complete`.
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
