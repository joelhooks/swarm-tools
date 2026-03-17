---
name: ralph-supervisor
description: "Ralph loop pattern — Claude supervises while Codex (gpt-5.3-codex) executes implementation work. Use when running autonomous coding loops, delegating coding tasks to background agents, orchestrating sequential implementation with fresh context per iteration, or managing supervisor-executor workflows with validation gates and git-backed persistence. Trigger terms: delegate coding, background task, autonomous loop, supervisor pattern, codex execute. Tools: ralph_init, ralph_story, ralph_iterate, ralph_loop, ralph_status, ralph_cancel, ralph_review."
---

# Ralph Supervisor Pattern

Ralph implements an autonomous coding loop where Claude acts as supervisor and Codex executes implementation work. Named after the pattern from [openclaw-codex-ralph](https://github.com/joelhooks/openclaw-codex-ralph).

## Quick Start

Initialize a Ralph project, add a story, and start the autonomous loop:

```typescript
// 1. Initialize a new Ralph project
ralph_init({ project_path: "/path/to/project", validation_command: "npm test && npm run typecheck" })

// 2. Add a story to the PRD
ralph_story({
  title: "Add user authentication",
  description: "Implement JWT-based login/logout with refresh tokens",
  acceptance_criteria: ["JWT generation works", "Refresh token rotation implemented"],
  validation_command: "npm test -- --grep auth"
})

// 3. Start the autonomous coding loop (Codex executes, Claude supervises)
ralph_loop({ max_iterations: 10 })

// 4. Check progress at any time
ralph_status()

// 5. Review completed work
ralph_review({ approve: true })

// 6. Cancel if needed
ralph_cancel({ reason: "Changing approach" })
```

## Core Philosophy

Traditional AI sessions accumulate context and drift. Ralph uses:
- **Fresh context per iteration** - Each Codex session starts clean
- **Git-backed persistence** - Completed work lives in commits
- **Validation gates** - Tests must pass before progression
- **Progress carryover** - Learnings flow forward (last 2000 chars)

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    RALPH ARCHITECTURE                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐         ┌─────────────┐                 │
│  │   Claude    │ spawns  │   Codex     │                 │
│  │ (Supervisor)│ ──────► │ (Executor)  │                 │
│  └─────────────┘         └─────────────┘                 │
│        │                       │                         │
│        │ plans/reviews         │ implements              │
│        ▼                       ▼                         │
│  ┌─────────────┐         ┌─────────────┐                 │
│  │  prd.json   │         │   Code +    │                 │
│  │  (stories)  │         │   Tests     │                 │
│  └─────────────┘         └─────────────┘                 │
│        │                       │                         │
│        │                       │ validates               │
│        ▼                       ▼                         │
│  ┌─────────────┐         ┌─────────────┐                 │
│  │progress.txt │◄────────│  npm test   │                 │
│  │ (learnings) │ logs    │ typecheck   │                 │
│  └─────────────┘         └─────────────┘                 │
│        │                       │                         │
│        │                       │ on success              │
│        ▼                       ▼                         │
│  ┌─────────────┐         ┌─────────────┐                 │
│  │  Hivemind   │         │ Git Commit  │                 │
│  │ (semantic)  │         │ (persist)   │                 │
│  └─────────────┘         └─────────────┘                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Iteration Lifecycle

```
1. Read PRD → Find next pending story (by priority)
2. Load progress.txt + AGENTS.md for context
3. Build iteration prompt for Codex
4. Spawn Codex (codex exec --full-auto)
5. Run validation command
6. If success:
   - Mark story.status = "passed"
   - Append to progress.txt
   - Git commit
7. If failure:
   - Log failure details
   - Keep story for retry
8. Repeat until all stories pass or limits hit
```

## Story Structure

```json
{
  "id": "story-1234567890",
  "title": "Add user authentication",
  "description": "Implement login/logout with JWT...",
  "priority": 1,
  "status": "pending",
  "validation_command": "npm test && npm run typecheck",
  "acceptance_criteria": [
    "JWT token generation works",
    "Refresh token flow implemented"
  ],
  "attempts": 0,
  "files_touched": [],
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T10:00:00Z"
}
```

## PRD Structure

```json
{
  "version": "1.0",
  "project_name": "My Feature",
  "description": "Adding OAuth support...",
  "stories": [...],
  "metadata": {
    "created_at": "...",
    "last_iteration": "...",
    "total_iterations": 5,
    "total_stories_completed": 3
  }
}
```

## Supervisor Best Practices

### Story Design

- **Granular scope** - Each story should fit in one Codex context
- **Clear acceptance criteria** - Specific, testable requirements
- **Proper validation** - Tests that actually verify the work
- **Priority ordering** - Dependencies first (lower number = higher priority)

### Review Process

```
┌─────────────────────────────────────────────────────────────┐
│                    REVIEW CHECKLIST                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  □ Tests pass (validation_command succeeded)                │
│  □ Acceptance criteria met                                  │
│  □ Code quality acceptable                                  │
│  □ No security issues introduced                            │
│  □ Integration with existing code correct                   │
│                                                             │
│  If YES to all → ralph_review({ approve: true })            │
│  If NO to any  → ralph_review({ approve: false,             │
│                                 feedback: "Specific issue"})│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Knowledge Persistence

After completing a project, store learnings:

```typescript
hivemind_store({
  information: "OAuth implementation: Used refresh token rotation pattern with 7-day expiry. Key gotcha: must invalidate old refresh token on use.",
  tags: "oauth,auth,tokens,patterns",
  confidence: 0.9
})
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | `gpt-5.3-codex` | Codex model to use |
| `sandbox` | `workspace-write` | Sandbox mode |
| `max_iterations` | `20` | Loop limit |
| `auto_commit` | `true` | Commit on success |
| `progress_context_limit` | `2000` | Chars of progress in prompt |
| `default_validation` | `npm run typecheck; npm test` | Fallback validation |

## Events Emitted

| Event | When |
|-------|------|
| `ralph:init` | Project initialized |
| `ralph:story:added` | Story added to PRD |
| `ralph:iteration:start` | Iteration begins |
| `ralph:iteration:complete` | Iteration ends |
| `ralph:loop:start` | Loop begins |
| `ralph:loop:iteration` | Each loop iteration |
| `ralph:loop:complete` | Loop finishes |
| `ralph:loop:error` | Loop error |
| `ralph:review:approved` | Work approved |
| `ralph:review:rejected` | Work rejected |

## Error Handling

| Error | Recovery |
|-------|----------|
| Codex timeout | Retry with longer timeout |
| Validation fail | Fix in next iteration |
| No stories left | All complete, exit |
| Max iterations | Report remaining work |

## Comparison: Ralph vs Swarm

| Aspect | Ralph | Swarm |
|--------|-------|-------|
| Executor | Codex | Claude workers |
| Parallelism | Sequential | Parallel |
| Context | Fresh per iteration | Shared via hivemind |
| Review | Supervisor reviews each | Coordinator reviews all |
| Best for | Complex sequential tasks | Independent parallel tasks |
