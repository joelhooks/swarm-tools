---
name: swarm-coordination
description: "Multi-agent coordination patterns for OpenCode swarm workflows. Use when you need to split work across agents, parallelize tasks, coordinate file ownership, or run a swarm. Covers: task decomposition, worker spawning, file reservations, progress tracking, and review loops."
---

# Swarm Coordination

This skill guides multi-agent coordination for OpenCode swarm workflows.

## When to Use

- Tasks touching 3+ files
- Parallelizable work (frontend/backend/tests)
- Work requiring specialized agents
- Time-to-completion matters

Avoid swarming for 1–2 file changes or tightly sequential work.

## Foreground vs Background vs Agent Teams

- **Foreground agents** can access MCP tools.
- **Background agents** do **not** have MCP tools.
- **Agent Team Teammates** (when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled) have independent context and messaging.
- Use foreground workers for `swarmmail_*`, `swarm_*`, `hive_*`, and MCP calls.
- Use background workers for doc edits and static work only.

## MCP Lifecycle

Claude Code auto-launches MCP servers from `mcpServers` configuration. Do **not** require manual `swarm mcp-serve` except for debugging.

**Agent teams spawn separate instances** with their own MCP connections. Each teammate has independent tool access.

## Coordinator Protocol (Dual-Path)

### Native Teams (When Available)

1. Initialize Swarm Mail (`swarmmail_init`).
2. Query past learnings (`hivemind_find`).
3. Decompose (`swarm_plan_prompt` + `swarm_validate_decomposition`).
4. Spawn via `TeammateTool` for real-time coordination.
5. Review via native team messaging + `swarm_review` for persistence.
6. Record outcomes (`swarm_complete`).

### Fallback (Task Subagents)

1. Initialize Swarm Mail (`swarmmail_init`).
2. Query past learnings (`hivemind_find`).
3. Decompose (`swarm_plan_prompt` + `swarm_validate_decomposition`).
4. Spawn workers via `Task(subagent_type="swarm-worker", prompt="...")`.
5. Review worker output (`swarm_review` + `swarm_review_feedback`).
6. Record outcomes (`swarm_complete`).

## Worker Protocol (Dual-Path)

### With Agent Teams

1. Auto-initialize via `session-start` hook.
2. Reserve files (`swarmmail_reserve`) — **native teams have NO file locking**.
3. Use `TaskUpdate` for UI spinners + `swarm_progress` for persistent tracking.
4. Complete with `swarm_complete` (auto-releases reservations).

### Without Agent Teams

1. Initialize Swarm Mail (`swarmmail_init`).
2. Reserve files (`swarmmail_reserve`).
3. Work within scope and report progress (`swarm_progress`).
4. Complete with `swarm_complete`.

## File Reservations

Workers must reserve files **before** editing and release via `swarm_complete`.
Coordinators never reserve files.

## Progress Reporting

Use `TaskUpdate` for UI spinners (shows instant feedback in Claude Code) and `swarm_progress` at 25%, 50%, and 75% completion for persistent tracking and auto-checkpoints.

## Spawning Workers (CRITICAL - Read This)

### Step 1: Prepare the subtask

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

### Step 2: Spawn the worker with Task

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

**CORRECT - files as array:**
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

**CORRECT - include project_path:**
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
1. Coordinator sets story to `in_progress` when spawning worker
2. Worker completes work and sets to `ready_for_review`
3. Coordinator reviews and sets to `passed` or `failed`

Workers do NOT set final status - that's the coordinator's job after review.

## Skill Loading Guidance

Workers should load skills based on task type:

- Tests or fixes → `testing-patterns`
- Architecture → `system-design`
- CLI work → `cli-builder`
- Coordination → `swarm-coordination`
