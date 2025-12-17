# Coordinator Patterns

The coordinator is the orchestration layer that manages the swarm. This document covers the coordinator's responsibilities, decision points, and intervention patterns.

## Coordinator Responsibilities

### 1. Knowledge Gathering (BEFORE decomposition)

**MANDATORY**: Before decomposing any task, the coordinator MUST query all available knowledge sources:

```
# 1. Search semantic memory for past learnings
semantic-memory_find(query="<task keywords>", limit=5)

# 2. Search CASS for similar past tasks
cass_search(query="<task description>", limit=5)

# 3. Search pdf-brain for design patterns and prior art
pdf-brain_search(query="<domain concepts>", limit=5)

# 4. List available skills
skills_list()
```

**Why this matters:** From "Patterns for Building AI Agents":

> "AI agents, like people, make better decisions when they understand the full context rather than working from fragments."

The coordinator synthesizes findings into `shared_context` that all workers receive.

### 2. Task Decomposition

After knowledge gathering:

1. Select strategy (auto or explicit)
2. Generate decomposition with `swarm_plan_prompt` or `swarm_decompose`
3. Validate with `swarm_validate_decomposition`
4. Create cells with `hive_create_epic`

### 3. Worker Spawning

For each subtask:

1. Generate worker prompt with `swarm_spawn_subtask`
2. Include relevant skills in prompt
3. Spawn worker agent via Task tool
4. Track bead status

### 4. Progress Monitoring

- Check `hive_query(status="in_progress")` for active work
- Check `swarmmail_inbox()` for worker messages
- Intervene on blockers (see Intervention Patterns below)

### 5. Completion & Aggregation

- Verify all subtasks completed via bead status
- Aggregate results from worker summaries
- Run final verification (typecheck, tests)
- Close epic bead with summary

---

## Decision Points

### When to Swarm vs Single Agent

**Swarm when:**

- 3+ files need modification
- Task has natural parallel boundaries
- Different specializations needed (frontend/backend/tests)
- Time-to-completion matters

**Single agent when:**

- Task touches 1-2 files
- Heavy sequential dependencies
- Coordination overhead > parallelization benefit
- Task requires tight feedback loop

**Heuristic:** If you can describe the task in one sentence without "and", probably single agent.

### When to Intervene

| Signal                    | Action                                                |
| ------------------------- | ----------------------------------------------------- |
| Worker blocked >5 min     | Check inbox, offer guidance                           |
| File conflict detected    | Mediate, reassign files                               |
| Worker asking questions   | Answer directly, don't spawn new agent                |
| Scope creep detected      | Redirect to original task, create new bead for extras |
| Worker failing repeatedly | Take over subtask or reassign                         |

### When to Abort

- Critical blocker affects all subtasks
- Scope changed fundamentally mid-swarm
- Resource exhaustion (context, time, cost)

On abort: Close all cells with reason, summarize partial progress.

---

## Context Engineering

From "Patterns for Building AI Agents":

> "Instead of just instructing subagents 'Do this specific task,' you should try to ensure they are able to share context along the way."

### Shared Context Template

```markdown
## Project Context

- Repository: {repo_name}
- Tech stack: {stack}
- Relevant patterns: {patterns from pdf-brain}

## Task Context

- Epic: {epic_title}
- Goal: {what success looks like}
- Constraints: {time, scope, dependencies}

## Prior Art

- Similar past tasks: {from CASS}
- Relevant learnings: {from semantic-memory}

## Coordination

- Other active subtasks: {list}
- Shared files to avoid: {reserved files}
- Communication channel: thread_id={epic_id}
```

### Context Compression

For long-running swarms, compress context periodically:

- Summarize completed subtasks (don't list all details)
- Keep only active blockers and decisions
- Preserve key learnings for remaining work

---

## Failure Modes & Recovery

### Incompatible Parallel Outputs

**Problem:** Two agents produce conflicting results that can't be merged.

**From "Patterns for Building AI Agents":**

> "Subagents can create responses that are in conflict — forcing the final agent to combine two incompatible, intermediate products."

**Prevention:**

- Clear file boundaries (no overlap)
- Explicit interface contracts in shared_context
- Sequential phases for tightly coupled work

**Recovery:**

- Identify conflict source
- Pick one approach, discard other
- Re-run losing subtask with winning approach as constraint

### Worker Drift

**Problem:** Worker goes off-task, implements something different.

**Prevention:**

- Specific, actionable subtask descriptions
- Clear success criteria in prompt
- File list as hard constraint

**Recovery:**

- Revert changes
- Re-run with more explicit instructions
- Consider taking over manually

### Cascade Failure

**Problem:** One failure blocks multiple dependent subtasks.

**Prevention:**

- Minimize dependencies in decomposition
- Front-load risky/uncertain work
- Have fallback plans for critical paths

**Recovery:**

- Unblock manually if possible
- Reassign dependent work
- Partial completion is okay - close what's done

---

## Anti-Patterns

### The Mega-Coordinator

**Problem:** Coordinator does too much work itself instead of delegating.

**Symptom:** Coordinator editing files, running tests, debugging.

**Fix:** Coordinator only orchestrates. If you're writing code, you're a worker.

### The Silent Swarm

**Problem:** Workers don't communicate, coordinator doesn't monitor.

**Symptom:** Swarm runs for 30 minutes, then fails with conflicts.

**Fix:** Require progress updates. Check inbox regularly. Intervene early.

### The Over-Decomposed Task

**Problem:** 10 subtasks for a 20-line change.

**Symptom:** Coordination overhead exceeds actual work.

**Fix:** 2-5 subtasks is the sweet spot. If task is small, don't swarm.

### The Under-Specified Subtask

**Problem:** "Implement the backend" with no details.

**Symptom:** Worker asks questions, guesses wrong, or stalls.

**Fix:** Each subtask needs: clear goal, file list, success criteria, context.
