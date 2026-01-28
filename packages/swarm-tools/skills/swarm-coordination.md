# Swarm Coordination Skill

Multi-agent coordination for parallel task execution.

## When to Use

- Breaking down complex tasks into parallel subtasks
- Coordinating multiple agents on a shared codebase
- Tracking progress across distributed work

## Core Workflow

```
1. Decompose: swarm_decompose → plan subtasks
2. Create Epic: hive_create_epic → track in hive
3. Spawn Workers: swarm_spawn_subtask → parallel agents
4. Monitor: swarmmail_inbox + swarm_status
5. Review: swarm_review → approve/reject
6. Complete: swarm_complete → close cells
```

## Coordinator Pattern

As coordinator, you orchestrate but don't execute:

```typescript
// 1. Initialize
swarmmail_init({ project_path: pwd, agent_name: "coordinator" })

// 2. Query prior learnings
hivemind_find({ query: "similar task patterns" })

// 3. Decompose (delegate to subagent)
swarm_decompose({ task: "the work to do" })

// 4. Create epic with subtasks
hive_create_epic({
  epic_title: "Feature X",
  subtasks: [
    { title: "Part A", files: ["src/a.ts"] },
    { title: "Part B", files: ["src/b.ts"] }
  ]
})

// 5. Spawn workers (parallel)
// Use Task tool with swarm:worker subagent_type

// 6. Monitor inbox every 5-10 minutes
swarmmail_inbox()

// 7. Review completed work
swarm_review({ epic_id, task_id, files_touched })
```

## Worker Pattern

As worker, you execute and report:

```typescript
// 1. Initialize
swarmmail_init({ project_path: pwd, agent_name: "worker-1" })

// 2. Reserve files
swarmmail_reserve({ paths: "src/my-file.ts", exclusive: true })

// 3. Query hivemind for context
hivemind_find({ query: "relevant patterns" })

// 4. Do the work
// ... your implementation ...

// 5. Report progress
swarm_progress({ bead_id, status: "in_progress", progress_percent: 50 })

// 6. Store learnings
hivemind_store({ information: "What I learned", tags: "pattern,gotcha" })

// 7. Complete
swarm_complete({ bead_id, summary: "What I did", files_touched: [...] })
```

## File Reservations

**Workers reserve their own files.** Coordinator never reserves.

```typescript
swarmmail_reserve({ paths: "src/foo.ts", exclusive: true })
// ... edit files ...
swarmmail_release({ paths: "src/foo.ts" })
```

## Hivemind Integration

**Always query before work:**
```typescript
hivemind_find({ query: "error handling patterns", limit: 5 })
```

**Always store learnings:**
```typescript
hivemind_store({
  information: "OAuth tokens need 5min expiry buffer to avoid race conditions",
  tags: "auth,gotcha,timing"
})
```

## Cell Lifecycle

```
open → in_progress → blocked? → closed
         ↓
    swarm_progress reports
         ↓
    swarm_complete closes
```

## Error Handling

- Blocked? `swarmmail_send({ to: ["coordinator"], importance: "high" })`
- Failed 3x? `hive_update({ id, status: "blocked" })`
- Need help? Message coordinator, don't spin

## Best Practices

1. **Small subtasks** - 3-7 per swarm, each completable by one agent
2. **No file overlap** - Each file owned by one worker
3. **Report progress** - 25%, 50%, 75% updates
4. **Store learnings** - Future agents will thank you
5. **Review before close** - Coordinator approves all work
