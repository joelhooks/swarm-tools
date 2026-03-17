---
name: swarm-coordination
description: "Multi-agent coordination patterns for OpenCode swarm workflows. Use when parallelizing tasks across multiple agents, coordinating worker spawning, managing file reservations, tracking progress across subtasks, or running review loops. Trigger terms: swarm, parallel tasks, spawn workers, coordinate agents, decompose work, multi-agent, delegate subtasks, fan out. Covers: decomposition, worker spawning, file reservations, progress tracking, and review loops."
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

## Spawning Workers (CRITICAL - Read This)

### Step 1: Prepare the subtask with swarm_spawn_subtask

```typescript
const spawnResult = await swarm_spawn_subtask({
  bead_id: "cell-abc123",           // The hive cell ID for this subtask
  epic_id: "epic-xyz789",           // Parent epic ID
  subtask_title: "Add logging utilities",
  subtask_description: "Create a logger module with structured logging support",
  files: ["src/utils/logger.ts", "src/utils/logger.test.ts"],  // Array of strings, NOT a JSON string
  shared_context: "This epic is adding observability. Other workers are adding metrics and tracing.",
  project_path: "/absolute/path/to/project"  // Required for tracking
});
```

### Step 2: Spawn the worker with Task tool

```typescript
// Parse the result to get the prompt
const { prompt, recommended_model } = JSON.parse(spawnResult);

// Spawn the worker
await Task({
  subagent_type: "swarm:worker",
  prompt: prompt,
  model: recommended_model  // Optional: use the auto-selected model
});
```

### Common Mistakes

**WRONG - files as JSON string:**
```typescript
files: '["src/auth.ts"]'  // DON'T do this
```

**CORRECT - files as proper array:**
```typescript
files: ["src/auth.ts", "src/auth.test.ts"]  // Do this
```

**WRONG - missing project_path:**
```typescript
swarm_spawn_subtask({
  bead_id: "...",
  epic_id: "...",
  // No project_path - worker can't initialize tracking!
})
```

**CORRECT - always include project_path:**
```typescript
swarm_spawn_subtask({
  bead_id: "...",
  epic_id: "...",
  project_path: "/Users/joel/myproject"  // Required!
})
```

## Parallel vs Sequential Spawning

### Parallel (independent tasks)

Send multiple Task calls in a single message:

```typescript
// All in one message - runs in parallel
Task({ subagent_type: "swarm:worker", prompt: prompt1 })
Task({ subagent_type: "swarm:worker", prompt: prompt2 })
Task({ subagent_type: "swarm:worker", prompt: prompt3 })
```

### Sequential (dependent tasks)

Await each before spawning next:

```typescript
const result1 = await Task({ subagent_type: "swarm:worker", prompt: prompt1 });
// Review result1...
const result2 = await Task({ subagent_type: "swarm:worker", prompt: prompt2 });
```

## Story Status Flow

Status transitions should flow:
1. **Coordinator** sets story to `in_progress` when spawning worker
2. **Worker** completes work and sets to `ready_for_review`
3. **Coordinator** reviews and sets to `passed` or `failed`

Workers do NOT set final status - that's the coordinator's job after review.

## Skill Loading Guidance

Workers should load skills based on task type:

- Tests or fixes → `testing-patterns`
- Architecture → `system-design`
- CLI work → `cli-builder`
- Coordination → `swarm-coordination`
