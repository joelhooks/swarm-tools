# ADR-001: Async Background Workers via OpenCode API + SwarmMail

```
                                    ╔═══════════════════════════════════════╗
                                    ║                                       ║
     🐝 ─────────────────────────── ║   ASYNC SWARM WORKERS                 ║
        \                           ║                                       ║
         \   "Fire and forget,      ║   Non-blocking task delegation        ║
          \   poll for honey"       ║   with event-sourced coordination     ║
           \                        ║                                       ║
            🐝                      ╚═══════════════════════════════════════╝
```

## Status

**Proposed** - December 2025
**Implementation Status:** Not Implemented

The tools described in this ADR (`swarm_spawn_async`, `swarm_poll_workers`, `swarm_await_workers`) do not exist in the codebase. Current swarm implementation uses blocking `Task` tool via OpenCode's synchronous subagent API.

## Context

### The Problem

Currently, swarm workers are spawned via OpenCode's `Task` tool, which **blocks the coordinator** until the subagent completes. This means:

1. **No true parallelism** - Coordinator waits for each worker sequentially
2. **Context accumulation** - Long-running workers fill coordinator's context
3. **No fire-and-forget** - Can't spawn 5 workers and monitor them asynchronously
4. **Fragile coordination** - If coordinator's context compacts mid-wait, state is lost

```
CURRENT FLOW (Blocking):

Coordinator ──┬── Task(worker1) ────────────────────────┬── Task(worker2) ──────────┬── done
              │                                         │                           │
              │  ⏳ BLOCKED (can't do anything)         │  ⏳ BLOCKED again          │
              │                                         │                           │
              └─────────────────────────────────────────┴───────────────────────────┘
                            TIME WASTED WAITING
```

### What We Want

```
DESIRED FLOW (Non-blocking):

Coordinator ──┬── spawn_async(w1) ── spawn_async(w2) ── spawn_async(w3) ──┬── poll ── review ── done
              │         │                   │                   │         │
              │         ▼                   ▼                   ▼         │
              │    ┌─────────┐         ┌─────────┐         ┌─────────┐    │
              │    │Worker 1 │         │Worker 2 │         │Worker 3 │    │
              │    │ 🔥 runs │         │ 🔥 runs │         │ 🔥 runs │    │
              │    │ in bg   │         │ in bg   │         │ in bg   │    │
              │    └────┬────┘         └────┬────┘         └────┬────┘    │
              │         │                   │                   │         │
              │         └───────────────────┴───────────────────┘         │
              │                             │                             │
              │                    swarm-mail events                      │
              │                   (worker_completed)                      │
              └───────────────────────────────────────────────────────────┘
                            ALL WORKERS RUN IN PARALLEL
```

### OpenCode's Hidden Async Infrastructure

OpenCode already has the primitives we need:

1. **`POST /session`** - Create a new session (returns sessionID)
2. **`POST /session/{id}/prompt_async`** - Fire prompt, return immediately (204)
3. **`GET /session/{id}/status`** - Check if session is idle/busy
4. **`GET /event`** - SSE stream of all events including `session.idle`
5. **`GET /session/{id}/message`** - Get session messages/results

The SDK exposes these as:

- `client.sessionCreate()`
- `client.sessionPromptAsync()`
- `client.sessionStatus()`
- `client.sessionMessages()`

### Related GitHub Issues

- **#5887** - [feat] True Async/Background Sub-Agent Delegation (assigned to thdxr)
- **#1970** - Background Bash Execution
- **#4278** - File locks for parallel agent safety
- **#5826** - Agent Session Tab Bar Navigation

## Decision

Implement async worker spawning using OpenCode's existing API + SwarmMail event sourcing for coordination.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COORDINATOR SESSION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. DECOMPOSE                                                               │
│     swarm_decompose(task) → CellTree                                        │
│     hive_create_epic(epic, subtasks)                                        │
│                                                                             │
│  2. SPAWN WORKERS (non-blocking)                                            │
│     for each subtask:                                                       │
│       swarm_spawn_async({                                                   │
│         bead_id: "bd-xxx.0",                                                │
│         prompt: workerPrompt,                                               │
│         files: ["src/auth/**"]                                              │
│       })                                                                    │
│       → Creates session, fires prompt_async                                 │
│       → Records worker_spawned event in swarm-mail                          │
│       → Returns immediately with session_id                                 │
│                                                                             │
│  3. MONITOR (poll or SSE)                                                   │
│     swarm_poll_workers({ epic_id }) → {                                     │
│       completed: [...],                                                     │
│       in_progress: [...],                                                   │
│       failed: [...]                                                         │
│     }                                                                       │
│                                                                             │
│  4. REVIEW & MERGE                                                          │
│     for each completed:                                                     │
│       swarm_review({ task_id, files_touched })                              │
│       swarm_worktree_merge({ task_id })                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ prompt_async (non-blocking)
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WORKER SESSIONS (background)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │   Worker A      │  │   Worker B      │  │   Worker C      │              │
│  │   session_123   │  │   session_456   │  │   session_789   │              │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤              │
│  │                 │  │                 │  │                 │              │
│  │ swarmmail_init  │  │ swarmmail_init  │  │ swarmmail_init  │              │
│  │       ↓         │  │       ↓         │  │       ↓         │              │
│  │ reserve files   │  │ reserve files   │  │ reserve files   │              │
│  │       ↓         │  │       ↓         │  │       ↓         │              │
│  │ ... do work ... │  │ ... do work ... │  │ ... do work ... │              │
│  │       ↓         │  │       ↓         │  │       ↓         │              │
│  │ swarm_complete  │  │ swarm_complete  │  │ swarm_complete  │              │
│  │       ↓         │  │       ↓         │  │       ↓         │              │
│  │ session.idle    │  │ session.idle    │  │ session.idle    │              │
│  │                 │  │                 │  │                 │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                       │
│           └────────────────────┼────────────────────┘                       │
│                                │                                            │
│                                ▼                                            │
│                    ┌───────────────────────┐                                │
│                    │     SWARM-MAIL DB     │                                │
│                    │                       │                                │
│                    │  worker_spawned       │                                │
│                    │  worker_progress      │                                │
│                    │  worker_completed     │                                │
│                    │  worker_failed        │                                │
│                    │                       │                                │
│                    └───────────────────────┘                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### New Event Types (swarm-mail schema)

```typescript
// packages/swarm-mail/src/types/events.ts

export const WorkerSpawnedEvent = z.object({
  type: z.literal("worker_spawned"),
  session_id: z.string(),
  bead_id: z.string(),
  epic_id: z.string(),
  worktree_path: z.string().optional(),
  files: z.array(z.string()),
  prompt_hash: z.string(), // For deduplication
  timestamp: z.number(),
});

export const WorkerProgressEvent = z.object({
  type: z.literal("worker_progress"),
  session_id: z.string(),
  bead_id: z.string(),
  progress_percent: z.number().min(0).max(100),
  message: z.string().optional(),
  files_touched: z.array(z.string()).optional(),
  timestamp: z.number(),
});

export const WorkerCompletedEvent = z.object({
  type: z.literal("worker_completed"),
  session_id: z.string(),
  bead_id: z.string(),
  epic_id: z.string(),
  status: z.enum(["success", "failed", "blocked"]),
  summary: z.string(),
  files_touched: z.array(z.string()),
  duration_ms: z.number(),
  timestamp: z.number(),
});

export const WorkerFailedEvent = z.object({
  type: z.literal("worker_failed"),
  session_id: z.string(),
  bead_id: z.string(),
  epic_id: z.string(),
  error: z.string(),
  stack: z.string().optional(),
  timestamp: z.number(),
});
```

### New Tools (opencode-swarm-plugin)

#### `swarm_spawn_async`

Spawns a worker in a background session, returns immediately.

```typescript
// packages/opencode-swarm-plugin/src/swarm-async.ts

import { tool } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { z } from "zod";
import { appendEvent, getSwarmMailLibSQL } from "swarm-mail";
import { generateWorkerHandoff } from "./swarm-orchestrate";

export const swarm_spawn_async = tool({
  description: `Spawn a worker in a background session. Returns immediately without blocking.
  
The worker runs in its own OpenCode session and reports progress via swarm-mail events.
Use swarm_poll_workers() to check completion status.

IMPORTANT: Each worker gets its own git worktree for file isolation.`,

  args: {
    bead_id: z.string().describe("Cell ID for this subtask (e.g., 'bd-xxx.0')"),
    epic_id: z.string().describe("Parent epic ID"),
    title: z.string().describe("Subtask title"),
    description: z.string().optional().describe("Detailed task description"),
    files: z
      .array(z.string())
      .describe("Files this worker owns (supports globs)"),
    dependencies: z
      .array(z.string())
      .optional()
      .describe("Bead IDs that must complete first"),
    shared_context: z
      .string()
      .optional()
      .describe("Context from coordinator to inject"),
  },

  async execute(args, ctx) {
    const projectPath = process.cwd();
    const swarmMail = await getSwarmMailLibSQL(projectPath);

    // 1. Check dependencies are complete
    if (args.dependencies?.length) {
      const incomplete = await checkDependencies(
        args.dependencies,
        projectPath,
      );
      if (incomplete.length > 0) {
        return {
          success: false,
          error: `Dependencies not complete: ${incomplete.join(", ")}`,
          blocked_by: incomplete,
        };
      }
    }

    // 2. Create worktree for isolation
    const worktreePath = await createWorktree(projectPath, args.bead_id);

    // 3. Generate worker prompt with handoff contract
    const handoff = generateWorkerHandoff({
      task_id: args.bead_id,
      files_owned: args.files,
      epic_summary: args.shared_context || "",
      your_role: args.title,
    });

    const workerPrompt = formatAsyncWorkerPrompt({
      bead_id: args.bead_id,
      epic_id: args.epic_id,
      title: args.title,
      description: args.description,
      handoff,
      worktree_path: worktreePath,
    });

    // 4. Create session and fire async prompt
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
    });

    const session = await client.sessionCreate({});
    const sessionId = session.data?.id;

    if (!sessionId) {
      throw new Error("Failed to create session");
    }

    // Fire and forget - returns immediately
    await client.sessionPromptAsync({
      path: { sessionID: sessionId },
      body: {
        parts: [{ type: "text", text: workerPrompt }],
      },
    });

    // 5. Record spawn event in swarm-mail
    await swarmMail.appendEvent({
      type: "worker_spawned",
      session_id: sessionId,
      bead_id: args.bead_id,
      epic_id: args.epic_id,
      worktree_path: worktreePath,
      files: args.files,
      prompt_hash: hashPrompt(workerPrompt),
      timestamp: Date.now(),
    });

    return {
      success: true,
      session_id: sessionId,
      bead_id: args.bead_id,
      worktree_path: worktreePath,
      message: `Worker spawned in background session ${sessionId}`,
    };
  },
});

function formatAsyncWorkerPrompt(params: {
  bead_id: string;
  epic_id: string;
  title: string;
  description?: string;
  handoff: WorkerHandoff;
  worktree_path: string;
}): string {
  return `
# ASYNC WORKER SESSION

You are a swarm worker executing task **${params.bead_id}** as part of epic **${params.epic_id}**.

## Your Task
**${params.title}**

${params.description || ""}

## Contract (MUST FOLLOW)

### Files You Own (can modify)
${params.handoff.contract.files_owned.map((f) => `- \`${f}\``).join("\n")}

### Files Read-Only (reference only)
${params.handoff.contract.files_readonly?.map((f) => `- \`${f}\``).join("\n") || "None"}

### Success Criteria
${params.handoff.contract.success_criteria.map((c) => `- ${c}`).join("\n")}

## Working Directory
You are working in a git worktree at: \`${params.worktree_path}\`

This isolates your changes from other workers. Commit freely.

## MANDATORY: Swarm Protocol

1. **START**: Initialize swarm mail
   \`\`\`
   swarmmail_init()
   swarmmail_reserve({ paths: ${JSON.stringify(params.handoff.contract.files_owned)} })
   \`\`\`

2. **PROGRESS**: Report progress periodically
   \`\`\`
   swarm_progress({ 
     bead_id: "${params.bead_id}",
     progress_percent: 50,
     message: "Implemented core logic"
   })
   \`\`\`

3. **BLOCKED?**: Notify coordinator immediately
   \`\`\`
   swarmmail_send({
     to: ["coordinator"],
     subject: "BLOCKED: ${params.bead_id}",
     body: "Need X to proceed",
     importance: "high"
   })
   \`\`\`

4. **COMPLETE**: Use swarm_complete (NOT hive_close)
   \`\`\`
   swarm_complete({
     bead_id: "${params.bead_id}",
     summary: "What you did",
     files_touched: ["list", "of", "files"]
   })
   \`\`\`

## Context from Coordinator
${params.handoff.context.epic_summary}

---

BEGIN WORK. Follow the contract. Report progress. Complete with swarm_complete().
`;
}
```

#### `swarm_poll_workers`

Check status of spawned workers.

```typescript
export const swarm_poll_workers = tool({
  description: `Poll for worker completion status. Returns workers grouped by status.
  
Use this to monitor background workers spawned with swarm_spawn_async().
Checks both swarm-mail events AND OpenCode session status.`,

  args: {
    epic_id: z.string().describe("Epic ID to check workers for"),
    include_messages: z
      .boolean()
      .optional()
      .describe("Include last message from each worker"),
  },

  async execute(args, ctx) {
    const projectPath = process.cwd();
    const swarmMail = await getSwarmMailLibSQL(projectPath);
    const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });

    // 1. Get all spawned workers for this epic
    const spawnedEvents = await swarmMail.readEvents({
      projectKey: projectPath,
      types: ["worker_spawned"],
    });

    const epicWorkers = spawnedEvents.filter(
      (e) => e.type === "worker_spawned" && e.epic_id === args.epic_id,
    );

    // 2. Get completion events
    const completedEvents = await swarmMail.readEvents({
      projectKey: projectPath,
      types: ["worker_completed", "worker_failed"],
    });

    const completedIds = new Set(
      completedEvents
        .filter((e) => e.epic_id === args.epic_id)
        .map((e) => e.session_id),
    );

    // 3. Check session status for non-completed workers
    const results = {
      completed: [] as WorkerStatus[],
      in_progress: [] as WorkerStatus[],
      failed: [] as WorkerStatus[],
      pending: [] as WorkerStatus[],
    };

    for (const worker of epicWorkers) {
      const sessionId = worker.session_id;
      const beadId = worker.bead_id;

      // Check if we have a completion event
      const completionEvent = completedEvents.find(
        (e) => e.session_id === sessionId,
      );

      if (completionEvent) {
        const status =
          completionEvent.type === "worker_completed"
            ? completionEvent.status === "success"
              ? "completed"
              : "failed"
            : "failed";

        results[status].push({
          session_id: sessionId,
          bead_id: beadId,
          status,
          summary: completionEvent.summary || completionEvent.error,
          files_touched: completionEvent.files_touched,
          duration_ms: completionEvent.duration_ms,
        });
        continue;
      }

      // No completion event - check session status
      try {
        const sessionStatus = await client.sessionStatus({
          path: { sessionID: sessionId },
        });

        if (sessionStatus.data?.type === "idle") {
          // Session is idle but no completion event
          // Worker may have finished without calling swarm_complete
          // Mark as completed but flag for review
          results.completed.push({
            session_id: sessionId,
            bead_id: beadId,
            status: "completed",
            summary: "Session idle (no explicit completion)",
            needs_review: true,
          });
        } else {
          // Still running
          results.in_progress.push({
            session_id: sessionId,
            bead_id: beadId,
            status: "in_progress",
            started_at: worker.timestamp,
          });
        }
      } catch (error) {
        // Session may not exist anymore
        results.failed.push({
          session_id: sessionId,
          bead_id: beadId,
          status: "failed",
          error: `Session not found: ${error}`,
        });
      }
    }

    // 4. Optionally fetch last message from each worker
    if (args.include_messages) {
      for (const worker of [...results.in_progress, ...results.completed]) {
        try {
          const messages = await client.sessionMessages({
            path: { sessionID: worker.session_id },
          });
          const lastMessage = messages.data?.slice(-1)[0];
          if (lastMessage) {
            worker.last_message = summarizeMessage(lastMessage);
          }
        } catch {
          // Ignore message fetch errors
        }
      }
    }

    return {
      epic_id: args.epic_id,
      total: epicWorkers.length,
      ...results,
      summary: `${results.completed.length} completed, ${results.in_progress.length} in progress, ${results.failed.length} failed`,
    };
  },
});
```

#### `swarm_await_workers`

Block until all workers complete (for simpler workflows).

```typescript
export const swarm_await_workers = tool({
  description: `Wait for all workers in an epic to complete. Polls every 5 seconds.
  
Use this when you want to block until all background workers finish.
For more control, use swarm_poll_workers() in a loop.`,

  args: {
    epic_id: z.string().describe("Epic ID to wait for"),
    timeout_ms: z
      .number()
      .optional()
      .describe("Max wait time (default: 10 minutes)"),
    poll_interval_ms: z
      .number()
      .optional()
      .describe("Poll interval (default: 5000)"),
  },

  async execute(args, ctx) {
    const timeout = args.timeout_ms || 10 * 60 * 1000; // 10 minutes
    const interval = args.poll_interval_ms || 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await swarm_poll_workers.execute(
        { epic_id: args.epic_id },
        ctx,
      );

      if (status.in_progress.length === 0) {
        return {
          success: true,
          duration_ms: Date.now() - startTime,
          ...status,
        };
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    // Timeout
    const finalStatus = await swarm_poll_workers.execute(
      { epic_id: args.epic_id },
      ctx,
    );

    return {
      success: false,
      error: "Timeout waiting for workers",
      duration_ms: Date.now() - startTime,
      ...finalStatus,
    };
  },
});
```

### Modified Worker Completion

Update `swarm_complete` to emit the completion event:

```typescript
// In swarm-orchestrate.ts, modify swarm_complete

async execute(args, ctx) {
  // ... existing verification logic ...

  // Emit completion event for async polling
  const swarmMail = await getSwarmMailLibSQL(projectPath);

  await swarmMail.appendEvent({
    type: "worker_completed",
    session_id: getCurrentSessionId(), // Need to track this
    bead_id: args.bead_id,
    epic_id: await getEpicIdForBead(args.bead_id),
    status: verificationPassed ? "success" : "failed",
    summary: args.summary,
    files_touched: args.files_touched || [],
    duration_ms: Date.now() - getSessionStartTime(),
    timestamp: Date.now(),
  });

  // ... rest of existing logic ...
}
```

### Coordinator Workflow Example

```typescript
// Example coordinator flow using async workers

async function coordinateSwarm(task: string) {
  // 1. Decompose
  const decomposition = await swarm_decompose({ task, max_subtasks: 5 });
  const epic = await hive_create_epic({
    epic_title: decomposition.epic.title,
    subtasks: decomposition.subtasks,
  });

  // 2. Spawn all workers (non-blocking)
  const spawned = [];
  for (const subtask of decomposition.subtasks) {
    const result = await swarm_spawn_async({
      bead_id: subtask.id,
      epic_id: epic.id,
      title: subtask.title,
      files: subtask.files,
      shared_context: decomposition.shared_context,
    });
    spawned.push(result);
    console.log(`Spawned worker ${result.session_id} for ${subtask.title}`);
  }

  // 3. Monitor progress (poll loop)
  let allComplete = false;
  while (!allComplete) {
    await sleep(5000); // Poll every 5 seconds

    const status = await swarm_poll_workers({ epic_id: epic.id });
    console.log(status.summary);

    // Handle completed workers
    for (const completed of status.completed) {
      if (!completed.reviewed) {
        await swarm_review({ task_id: completed.bead_id });
        await swarm_worktree_merge({ task_id: completed.bead_id });
      }
    }

    // Handle failures
    for (const failed of status.failed) {
      console.error(`Worker ${failed.bead_id} failed: ${failed.error}`);
      // Could respawn or escalate
    }

    allComplete = status.in_progress.length === 0;
  }

  // 4. Final sync
  await hive_sync();

  return { epic_id: epic.id, status: "complete" };
}
```

## Alternatives Considered

### 1. Multiple OpenCode Instances

Run N OpenCode processes on different ports, each handling one worker.

**Pros:**

- True process-level parallelism
- Complete isolation

**Cons:**

- Complex orchestration
- Resource heavy (N processes)
- Port management overhead

**Verdict:** Good for heavy workloads, overkill for most cases.

### 2. Wait for Native Async Subagents (#5887)

Wait for OpenCode to implement native async Task tool.

**Pros:**

- First-class support
- No workarounds needed

**Cons:**

- No timeline
- Blocks progress

**Verdict:** Track the issue, but don't wait.

### 3. External Job Queue (Redis, BullMQ)

Use a proper job queue for worker coordination.

**Pros:**

- Battle-tested patterns
- Retry logic, dead letter queues

**Cons:**

- External dependency
- Overkill for local dev
- Breaks "no external servers" principle

**Verdict:** Not aligned with swarm-mail's local-first philosophy.

## Consequences

### Positive

1. **Non-blocking coordination** - Coordinator can spawn all workers immediately
2. **Event-sourced state** - Full audit trail in swarm-mail
3. **Resumable** - If coordinator dies, state persists in DB
4. **Incremental** - Can review/merge workers as they complete
5. **Observable** - Dashboard can show real-time worker status

### Negative

1. **Single-process limitation** - Workers share OpenCode's event loop
2. **Polling overhead** - Need to poll for completion (no push notifications)
3. **Session management** - More sessions to track and clean up
4. **Complexity** - More moving parts than blocking Task tool

### Neutral

1. **Worktree requirement** - Each worker needs its own worktree (already supported)
2. **New event types** - Schema additions to swarm-mail
3. **SDK dependency** - Uses @opencode-ai/sdk directly

## Implementation Plan

### Phase 1: Event Schema (swarm-mail)

- [ ] Add `worker_spawned`, `worker_progress`, `worker_completed`, `worker_failed` events
- [ ] Add projections for worker status queries
- [ ] Tests for event flow

**Status:** Not started. Swarm-mail events currently do not include async worker lifecycle events.

### Phase 2: Core Tools (opencode-swarm-plugin)

- [ ] Implement `swarm_spawn_async`
- [ ] Implement `swarm_poll_workers`
- [ ] Implement `swarm_await_workers`
- [ ] Modify `swarm_complete` to emit completion event

**Status:** Not started. These tools are not present in `packages/opencode-swarm-plugin/src/`.

### Phase 3: Coordinator Integration

- [ ] Update `/swarm` command to use async spawning
- [ ] Add progress display to dashboard
- [ ] Handle worker failures gracefully

**Status:** Not started. Current coordinator uses blocking Task tool.

### Phase 4: Observability

- [ ] Add `swarm dashboard` support for async workers
- [ ] Add `swarm log` filtering by session
- [ ] Metrics for worker duration, success rate

**Status:** Not started. Dashboard does not track async worker state.

## Open Questions

1. **Session cleanup** - When/how to delete completed worker sessions?
2. **Context limits** - How to handle workers that exhaust context?
3. **Retry logic** - Should failed workers auto-retry?
4. **Priority** - Can high-priority workers preempt others?

## References

- [OpenCode GitHub #5887](https://github.com/sst/opencode/issues/5887) - Async subagent feature request
- [OpenCode GitHub #1970](https://github.com/sst/opencode/issues/1970) - Background bash execution
- [swarm-mail README](../../../packages/swarm-mail/README.md) - Event sourcing primitives
- [OpenCode SDK](https://www.npmjs.com/package/@opencode-ai/sdk) - API client

---

```
                    🐝
                   /  \
                  /    \
    "The hive    /      \    "...while the
     remembers  /   🍯   \    workers dance"
     all..."   /          \
              /____________\
                   |||
                   |||
              ─────┴┴┴─────
```
