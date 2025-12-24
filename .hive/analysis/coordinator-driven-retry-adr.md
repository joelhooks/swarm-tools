# ADR: Coordinator-Driven Retry Architecture

**Date:** 2025-12-24  
**Cell:** opencode-swarm-monorepo-lf2p4u-mjk8h0da1zn  
**Epic:** opencode-swarm-monorepo-lf2p4u-mjk8h0cnppf (Fix Review Loop - Coordinator-Driven Retry)  
**Status:** Accepted

## Context

### The Worker Lifecycle Problem

In swarm coordination, workers are **ephemeral Task subagents**. They follow a fire-and-forget lifecycle:

```
┌─────────────────────────────────────────┐
│        WORKER LIFECYCLE                 │
├─────────────────────────────────────────┤
│                                         │
│  1. Coordinator spawns Task subagent   │
│  2. Worker executes, outputs result    │
│  3. Worker terminates (dies)           │
│  4. Control returns to coordinator     │
│                                         │
│  ⚠️ Worker CANNOT receive messages      │
│     after step 3 - it's gone.          │
└─────────────────────────────────────────┘
```

This is a **fundamental constraint** of OpenCode's Task subagent model. Per OpenCode issue #5887, true async agent communication (where agents can receive messages after completion) is a future feature.

### The Review Loop Requirement

The swarm review process requires a feedback loop:

```
Worker completes → Coordinator reviews → Needs changes? → Worker fixes issues
```

**Problem:** How do we communicate "needs changes" to a worker that no longer exists?

### Previous Broken Approach

Initial implementation attempted to send messages to dead workers:

```typescript
// ❌ BROKEN: Worker is already dead
if (status === "needs_changes") {
  await sendSwarmMessage({
    to: [workerAgentName],
    subject: `Review feedback: ${taskId}`,
    body: issuesJSON,
    thread_id: epicId,
  });
}
```

**Consequences:**
- Messages go to dead letter queue (worker can't receive them)
- No feedback loop - work just stops
- Coordinator has no clear retry semantics
- Learning signals lost (can't track retry attempts)

## Decision

**The coordinator drives the retry loop, spawning fresh workers with accumulated context.**

Workers are fire-and-forget. Coordinators are long-lived. Therefore, coordinators own retry orchestration.

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                  COORDINATOR RETRY LOOP                       │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  attempt = 1                                                  │
│  loop until approved OR attempt > 3:                          │
│                                                               │
│    1. Spawn Worker(attempt, previous_issues, previous_diff)  │
│    2. Worker executes → swarm_complete → dies                │
│    3. Coordinator: swarm_review(task_id, files)              │
│    4. Coordinator: swarm_review_feedback(status, issues)     │
│                                                               │
│    IF status == "approved":                                   │
│      - hive_close(task_id)                                    │
│      - break loop                                             │
│                                                               │
│    IF status == "needs_changes":                              │
│      - Receive retry_context from swarm_review_feedback      │
│      - swarm_spawn_retry(task, attempt, issues, diff)        │
│      - Spawn NEW worker with retry prompt                    │
│      - attempt++                                              │
│      - continue loop                                          │
│                                                               │
│    IF attempt > 3:                                            │
│      - hive_update(status="blocked")                          │
│      - Escalate to human                                      │
│      - break loop                                             │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. `swarm_review_feedback` Returns Retry Context

Instead of sending messages, `swarm_review_feedback` returns structured retry context to the coordinator:

```typescript
// When review status is "needs_changes"
return {
  success: true,
  status: "needs_changes",
  task_id: "bd-123.2",
  attempt: 1,
  remaining_attempts: 2,
  issues: [
    {
      file: "src/auth.ts",
      line: 42,
      issue: "Missing null check",
      suggestion: "Add guard: if (!user) throw new Error(...)",
    },
  ],
  retry_context: {
    task_id: "bd-123.2",
    attempt: 1,
    max_attempts: 3,
    issues: [...],
    next_action: "Use swarm_spawn_retry to spawn new worker with these issues",
  },
};
```

**Critical:** No message sending. Coordinator receives synchronous return value.

#### 2. `swarm_spawn_retry` Generates Retry Prompts

Coordinators call `swarm_spawn_retry` to generate a fresh prompt for the next worker attempt:

```typescript
swarm_spawn_retry({
  bead_id: "bd-123.2",
  epic_id: "bd-123",
  original_prompt: "<original subtask prompt>",
  attempt: 2, // Incremented from retry_context
  issues: JSON.stringify(retry_context.issues),
  diff: "<git diff of previous attempt>",
  files: ["src/auth.ts"],
  project_path: "/abs/path/to/repo",
});
```

**Output:** Comprehensive retry prompt including:
- `⚠️ RETRY ATTEMPT 2/3` header
- Previous issues with specific line numbers and suggestions
- Git diff of previous changes (what to preserve vs fix)
- Original task description
- Standard worker contract (init, reserve, complete)

#### 3. Coordinator Post-Worker Checklist

Coordinators follow `COORDINATOR_POST_WORKER_CHECKLIST` after every worker completion:

```markdown
### Step 1: Check Swarm Mail
swarmmail_inbox()
swarmmail_read_message(message_id=N)

### Step 2: Review the Work
swarm_review(project_key, epic_id, task_id, files_touched)

### Step 3: Evaluate Against Criteria
- Fulfills subtask requirements?
- Serves epic goal?
- Enables downstream tasks?
- Type safe, no obvious bugs?

### Step 4: Send Feedback
swarm_review_feedback(project_key, task_id, worker_id, status, issues)

### Step 5: Take Action

IF APPROVED:
  - hive_close(task_id)
  - Spawn next worker

IF NEEDS_CHANGES:
  - swarm_spawn_retry(bead_id, epic_id, attempt, issues, diff)
  - Spawn NEW worker with Task(retry_prompt)
  - Increment attempt counter

IF 3 FAILURES:
  - hive_update(status="blocked")
  - Escalate to human
```

### State Machine

```
                    ┌─────────────────┐
                    │  Worker Done    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Coordinator    │
                    │  Reviews Work   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐  ┌───▼────┐  ┌──────▼───────┐
       │  APPROVED   │  │ NEEDS  │  │  3 FAILURES  │
       │             │  │CHANGES │  │              │
       └──────┬──────┘  └───┬────┘  └──────┬───────┘
              │             │               │
       ┌──────▼──────┐      │        ┌──────▼───────┐
       │ hive_close  │      │        │hive_update   │
       │ Spawn next  │      │        │(blocked)     │
       └─────────────┘      │        │Escalate      │
                            │        └──────────────┘
                    ┌───────▼────────┐
                    │ swarm_spawn_   │
                    │ retry          │
                    │ (attempt++)    │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Spawn NEW      │
                    │ Worker         │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Worker Executes│
                    │ & Dies         │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ Back to Review │
                    └────────────────┘
```

## Consequences

### Positive

1. **No Dead Letter Messages**
   - Coordinators never send messages to dead workers
   - All communication is synchronous (return values)
   - No async coordination failures

2. **Clear Retry Semantics**
   - Coordinator owns retry count (`attempt` parameter)
   - 3-strike rule enforced at coordinator level
   - Deterministic state transitions (approved → close, needs_changes → retry, 3 failures → blocked)

3. **Learning Signals Preserved**
   - `swarm_record_outcome` tracks retry counts, duration, errors
   - Pattern maturity learns from high-retry tasks (signals bad decomposition)
   - Coordinator can correlate review issues with decomposition strategy

4. **Context Accumulation**
   - Each retry includes previous issues + diff
   - Workers learn from past mistakes (visible in prompt)
   - Coordinator provides increasingly specific guidance

5. **Stateless Workers**
   - Workers don't need to track retry state
   - Each worker is a fresh Task subagent with full context
   - Simpler worker prompts (no session continuation logic)

### Negative

1. **Coordinator Complexity**
   - Coordinators must implement retry loop
   - More orchestration code vs "send message and forget"
   - Requires careful attempt counter management

2. **No Parallel Retries**
   - Coordinator spawns workers sequentially
   - Can't retry multiple tasks in parallel (coordinator is single-threaded)
   - Acceptable trade-off: retries are rare (good decomposition → <10% retry rate)

3. **Context Growth**
   - Each retry accumulates more context (issues, diff, original prompt)
   - Potential token bloat for attempt 3
   - Mitigated: `swarm_spawn_retry` keeps prompts concise (structured issues, truncated diffs)

### Risks

1. **Lost Retry Context**
   - If coordinator crashes between `swarm_review_feedback` and `swarm_spawn_retry`, retry context is lost
   - Mitigation: Coordinator should checkpoint retry state to hive metadata
   - Future: Store retry context in swarm-mail database

2. **Infinite Loops**
   - Broken coordinator could retry infinitely (ignore max_attempts)
   - Mitigation: `swarm_spawn_retry` enforces hard cap (throws error if attempt > 3)
   - Swarm-mail database tracks attempt count independently

3. **Coordinator Availability**
   - Coordinator must stay alive for entire epic duration
   - If coordinator dies, in-flight retries are orphaned
   - Mitigation: Swarm-mail database persists task state, new coordinator can resume

## Implementation

### Files Modified

1. **`swarm-review.ts`**
   - `swarm_review_feedback`: Returns `retry_context` when `status === "needs_changes"`
   - Removed dead message sending code
   - Added attempt counter tracking

2. **`swarm-prompts.ts`**
   - New tool: `swarm_spawn_retry` (generates retry prompts)
   - Updated `COORDINATOR_POST_WORKER_CHECKLIST` with retry flow
   - Validates attempt <= 3 (throws on 4th attempt)

3. **`swarm-review.test.ts`**
   - Test: `retry_context` structure validation
   - Test: `retry_context` only present when `needs_changes`
   - Test: No `retry_context` after 3 failures

4. **`swarm-prompts.test.ts`**
   - Test: `swarm_spawn_retry` includes issues, diff, attempt counter
   - Test: `swarm_spawn_retry` throws on attempt > 3
   - Test: Retry prompt preserves original task context

### Key Functions

```typescript
/**
 * Returns retry context for coordinator to spawn new worker
 */
interface RetryContext {
  task_id: string;
  attempt: number;
  max_attempts: number;
  issues: ReviewIssue[];
  next_action: string; // Hint for coordinator
}

/**
 * Generate retry prompt for failed review
 */
swarm_spawn_retry({
  bead_id: string;
  epic_id: string;
  original_prompt: string;
  attempt: number; // 1, 2, or 3 (throws on 4+)
  issues: string; // JSON array of ReviewIssue
  diff?: string; // Optional git diff
  files: string[];
  project_path?: string;
}): Promise<string>; // Returns formatted retry prompt
```

### Coordinator Workflow (Pseudocode)

```typescript
async function coordinateEpic(epicId: string, subtasks: Subtask[]) {
  for (const subtask of subtasks) {
    let attempt = 1;
    let approved = false;

    while (!approved && attempt <= 3) {
      // Generate prompt (initial or retry)
      const prompt =
        attempt === 1
          ? await swarm_spawn_subtask(subtask)
          : await swarm_spawn_retry({
              bead_id: subtask.id,
              epic_id: epicId,
              original_prompt: subtask.original_prompt,
              attempt,
              issues: previousIssues,
              diff: previousDiff,
              files: subtask.files,
            });

      // Spawn worker (Task subagent)
      const result = await Task(prompt);

      // Review work
      const review = await swarm_review({
        project_key: projectPath,
        epic_id: epicId,
        task_id: subtask.id,
        files_touched: subtask.files,
      });

      const feedback = await swarm_review_feedback({
        project_key: projectPath,
        task_id: subtask.id,
        worker_id: result.agent_name,
        status: review.status,
        issues: review.issues,
      });

      if (feedback.status === "approved") {
        await hive_close(subtask.id, "Approved by coordinator");
        approved = true;
      } else if (feedback.status === "needs_changes") {
        // Get diff for next retry
        previousDiff = execSync(`git diff ${subtask.files.join(" ")}`).toString();
        previousIssues = feedback.retry_context.issues;
        attempt++;

        if (attempt > 3) {
          await hive_update(subtask.id, { status: "blocked" });
          console.error(
            `Task ${subtask.id} failed after 3 attempts. Escalating to human.`,
          );
          break;
        }
      }
    }
  }
}
```

## Alternatives Considered

### 1. Session Continuation (Rejected)

**Idea:** Use `/session-continue` to resume worker session after review feedback.

**Problems:**
- Session continuation is for human-agent handoff, not agent-agent
- Worker context bleeds across retries (previous attempt state pollutes fresh start)
- No clear retry semantics (is this attempt 2 or a continuation of attempt 1?)

**Why rejected:** OpenCode sessions are designed for single tasks, not multi-attempt loops.

### 2. Persistent Workers (Future Consideration)

**Idea:** Workers stay alive across reviews, receiving feedback via swarm mail.

**Pros:**
- True async agent communication
- Workers can self-correct without respawning
- Reduced context overhead (worker maintains state)

**Cons:**
- Requires OpenCode issue #5887 (async agent communication)
- Workers become stateful (complexity++)
- Session management overhead (keeping workers alive)

**Status:** Blocked on platform support. Revisit when OpenCode supports persistent agent sessions.

### 3. Message Queuing (Over-Engineering)

**Idea:** Coordinator sends retry messages to queue, worker polls on startup.

**Problems:**
- Workers are ephemeral - can't poll after death
- Requires external message broker (RabbitMQ, Redis)
- Coordinator still needs to spawn workers (so why queue?)

**Why rejected:** Adds infrastructure complexity with no benefit over direct spawning.

### 4. Coordinator as Proxy (Rejected)

**Idea:** Coordinator forwards review feedback to swarm mail, worker checks inbox on next spawn.

**Problems:**
- Workers can't receive messages after death (back to original problem)
- Swarm mail inbox becomes retry state store (abuse of messaging system)
- No guarantee worker reads messages before starting work

**Why rejected:** Doesn't solve fire-and-forget constraint, adds indirection.

## OpenCode Constraint: Task Subagents

This architecture is **mandated** by OpenCode's current Task subagent model.

From **OpenCode issue #5887** (paraphrased):

> Task subagents are fire-and-forget executors. They spin up, execute, output, and terminate. They cannot receive messages after completion. True async agent communication (persistent agents receiving messages) is a future feature.

**Implications:**
- Coordinators MUST be long-lived (cannot be Task subagents)
- Workers MUST be ephemeral (Task subagents)
- Retry orchestration MUST happen at coordinator level (only entity that survives)

**This is not a limitation - it's a forcing function for clean architecture.**

Ephemeral workers are **stateless and simple**. Coordinators own orchestration. This separation of concerns makes swarms more reliable than stateful, message-passing agents.

## Future Work

### 1. Checkpoint Retry State

Store retry context in swarm-mail database:

```sql
CREATE TABLE task_retry_state (
  task_id TEXT PRIMARY KEY,
  attempt INTEGER NOT NULL,
  issues TEXT NOT NULL, -- JSON
  previous_diff TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Benefit:** Coordinator crashes don't lose retry context.

### 2. Parallel Retry Coordination

Allow coordinators to spawn multiple retry workers in parallel (for independent tasks):

```typescript
const retries = needsChanges.map((task) =>
  spawnRetryWorker(task, retryContexts[task.id]),
);
await Promise.all(retries);
```

**Challenge:** Coordinator must track attempt counters per task.

### 3. Learning from Retry Patterns

Feed retry data into pattern maturity system:

```typescript
// High retry rate → bad decomposition strategy
if (task.retry_count >= 2) {
  await recordAntiPattern({
    strategy: epic.decomposition_strategy,
    reason: `Task ${task.id} required ${task.retry_count} retries`,
    impact: "harmful",
  });
}
```

**Outcome:** System learns to avoid decomposition strategies that produce high-retry tasks.

### 4. Adaptive Retry Limits

Adjust max attempts based on task complexity:

```typescript
const maxAttempts = task.priority === 3 ? 5 : 3; // Critical tasks get more attempts
```

**Trade-off:** Longer feedback loops for complex tasks vs hard 3-strike rule.

## Conclusion

**The coordinator-driven retry architecture is the only viable approach given OpenCode's Task subagent constraints.**

Workers are ephemeral by design. Coordinators are long-lived by necessity. Retry orchestration belongs where state persists - at the coordinator level.

This architecture:
- ✅ Eliminates dead letter messages
- ✅ Provides clear retry semantics
- ✅ Preserves learning signals
- ✅ Accumulates context across attempts
- ✅ Enforces 3-strike rule deterministically

The alternative (persistent workers with async messaging) requires platform features that don't exist yet. When OpenCode issue #5887 ships, we can revisit. Until then, **this is the right architecture.**

---

## References

- **OpenCode Issue #5887:** Async agent communication (future feature)
- **Implementation:**
  - `packages/opencode-swarm-plugin/src/swarm-review.ts` (retry_context return)
  - `packages/opencode-swarm-plugin/src/swarm-prompts.ts` (swarm_spawn_retry tool)
  - `packages/opencode-swarm-plugin/src/swarm-prompts.test.ts` (retry tests)
- **Related ADRs:**
  - Event Sourcing Feasibility (`.hive/analysis/event-sourced-beads-feasibility.md`)
  - Git Sync and Distributed Coordination (`.hive/analysis/git-sync-distributed-coordination.md`)
