---
name: swarm-coordination
description: Multi-agent coordination patterns for OpenCode swarm workflows. Use when work benefits from parallelization or coordination.
tags:
  - swarm
  - multi-agent
  - coordination
tools:
  - "*"
related_skills:
  - testing-patterns
  - system-design
  - cli-builder
---

# Swarm Coordination

This skill guides multi-agent coordination for OpenCode swarm workflows.

## When to Swarm

**Always swarm when `/swarm` is invoked.** The user's explicit invocation overrides any heuristics.

Swarming serves multiple purposes beyond parallelization:
- **Context preservation** - workers offload work from coordinator
- **Session resilience** - workers persist if coordinator compacts
- **Progress tracking** - hive cells track completion state
- **Learning capture** - hivemind stores discoveries per subtask

Even small tasks (1-2 files) benefit from swarming when context is precious.

For sequential work, use dependencies between subtasks rather than refusing to swarm.

## Tool Access (Wildcard)

This skill is configured with `tools: ["*"]` per user choice. If you need curated access later, replace the wildcard with explicit tool lists.

## Foreground vs Background

- **Foreground agents** can access MCP tools.
- **Background agents** do **not** have MCP tools.
- Use foreground workers for `swarmmail_*`, `swarm_*`, `hive_*`, and MCP calls.
- Use background workers for doc edits and static work only.

## MCP Lifecycle Mitigation

Claude Code auto-launches MCP servers from `mcpServers` configuration. Do **not** require manual `swarm mcp-serve` except for debugging.

## Coordinator Protocol (High-Level)

1. Initialize Swarm Mail (`swarmmail_init`).
2. **Query past learnings** (`hivemind_find`) - MANDATORY before decomposition.
3. Decompose (`swarm_plan_prompt` + `swarm_validate_decomposition`).
4. Spawn workers with explicit file lists.
5. Review worker output (`swarm_review` + `swarm_review_feedback`).
6. Record outcomes (`swarm_complete`).
7. **Store learnings** (`hivemind_store`) - MANDATORY after swarm completion.

## Worker Protocol (High-Level)

1. Initialize Swarm Mail (`swarmmail_init`).
2. Reserve files (`swarmmail_reserve`).
3. Work within scope and report progress.
4. **Store discoveries** (`hivemind_store`) - any gotchas, patterns, or decisions made.
5. Complete with `swarm_complete`.

## Hivemind Usage (MANDATORY)

Agents MUST use hivemind to build collective memory:

**Before work:**
```
hivemind_find({ query: "relevant topic or codebase pattern" })
```

**During work (when discovering something):**
```
hivemind_store({
  information: "The auth module requires X before Y",
  tags: "auth,gotcha,codebase-name"
})
```

**After work:**
```
hivemind_store({
  information: "Completed task X. Key learnings: ...",
  tags: "swarm,completion,epic-id"
})
```

Store liberally. Memory is cheap; re-discovering gotchas is expensive.

## File Reservations

Workers must reserve files **before** editing and release via `swarm_complete`.
Coordinators never reserve files.

## Progress Reporting

Use `swarm_progress` at 25%, 50%, and 75% completion to trigger auto-checkpoints.

## Skill Loading Guidance

Workers should load skills based on task type:

- Tests or fixes → `testing-patterns`
- Architecture → `system-design`
- CLI work → `cli-builder`
- Coordination → `swarm-coordination`
