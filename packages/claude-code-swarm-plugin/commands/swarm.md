---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Decompose the task into subtasks and spawn parallel agents.

## Task

$ARGUMENTS

## ENVIRONMENT DETECTION (CHECK FIRST)

**Before doing anything else, check which mode you're operating in:**

```bash
# Check if native agent teams are available
if [ -n "$CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" ]; then
  MODE="native-teams"
else
  MODE="task-fallback"
fi
```

**Mode Detection Matters:**

- **native-teams**: Use `TeammateTool` + `EnterPlanMode` + `TaskCreate` for UI
- **task-fallback**: Use `Task(subagent_type)` + `TaskCreate` for UI spinners

**What stays the same (plugin's unique value):**
- `hivemind_*` (semantic memory persistence)
- `swarmmail_reserve` (file locking - native teams DON'T have this)
- `swarm_decompose/swarm_validate_decomposition` (intelligent decomposition)
- `swarm_review/swarm_review_feedback` (structured code review)
- `swarm_complete` (verification gates)
- `hive_create_epic` (git-backed persistence)

## Flags (parse from task above)

### Planning Modes

- `--fast` - Skip brainstorming, go straight to decomposition
- `--auto` - Use best recommendations, minimal questions
- `--confirm-only` - Show decomposition, single yes/no, then execute
- (default) - Full Socratic planning with questions and alternatives

### Workflow Options

- `--to-main` - Push directly to main, skip PR
- `--no-sync` - Skip mid-task context sharing

**Defaults: Socratic planning, feature branch + PR, context sync enabled.**

### Example Usage

```bash
/swarm:swarm "task description"              # Full Socratic (default)
/swarm:swarm --fast "task description"       # Skip brainstorming
/swarm:swarm --auto "task description"       # Auto-select, minimal Q&A
/swarm:swarm --confirm-only "task"           # Show plan, yes/no only
/swarm:swarm --fast --to-main "quick fix"    # Fast mode + push to main
```

## Dual-Mode Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DUAL-MODE SWARM SYSTEM                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  MODE 1: NATIVE AGENT TEAMS (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)   │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │  Planning:    EnterPlanMode → explore → ExitPlanMode       │        │
│  │  Spawning:    TeammateTool (spawn teammates)               │        │
│  │  Tasks:       TaskCreate/TaskUpdate/TaskList (UI spinners) │        │
│  │  Messaging:   SendMessage (live, ephemeral)                │        │
│  │  Shutdown:    SendMessage(type="shutdown_request")         │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
│  MODE 2: TASK FALLBACK (default)                                       │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │  Planning:    Task(subagent_type="Plan")                   │        │
│  │  Spawning:    Task(subagent_type="swarm:worker")           │        │
│  │  Tasks:       TaskCreate/TaskUpdate (UI spinners)          │        │
│  │  Messaging:   swarmmail_send (persistent)                  │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
│  SHARED PLUGIN VALUE (both modes):                                     │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │  • hivemind_find/hivemind_store (semantic memory)          │        │
│  │  • swarmmail_reserve (file locking - teams don't have)     │        │
│  │  • swarm_decompose (intelligent task breakdown)            │        │
│  │  • swarm_review/swarm_review_feedback (code review)        │        │
│  │  • swarm_complete (verification gates)                     │        │
│  │  • hive_create_epic (git-backed persistence)               │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Coordination Flow:**

```
                 ┌──────────────┐
                 │  /swarm cmd  │
                 └──────┬───────┘
                        │
            ┌───────────▼────────────┐
            │  Environment Check     │
            │  (CLAUDE_CODE_...)     │
            └───────────┬────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
    ┌────▼─────┐                 ┌────▼────┐
    │  Native  │                 │  Task   │
    │  Teams   │                 │ Fallback│
    └────┬─────┘                 └────┬────┘
         │                             │
    ┌────▼──────────────┐         ┌───▼──────────────┐
    │ EnterPlanMode     │         │ Task(Plan)       │
    │ TeammateTool      │         │ Task(worker)     │
    │ SendMessage       │         │ swarmmail_send   │
    └────┬──────────────┘         └───┬──────────────┘
         │                             │
         └──────────────┬──────────────┘
                        │
                ┌───────▼────────┐
                │  Plugin Tools   │
                │  (hivemind,     │
                │   swarm_review, │
                │   file locks)   │
                └─────────────────┘
```

## CRITICAL: Always Swarm When Invoked

**When the user invokes `/swarm:swarm`, ALWAYS create a swarm. No exceptions.**

Do NOT make judgment calls about task size or complexity. The user invoked `/swarm:swarm` because they want:
- **Context preservation** - spawning workers offloads work from coordinator context
- **Session resilience** - workers can continue if coordinator compacts
- **Parallel execution** - even 2-3 subtasks benefit from parallelization

If the task has only 1 subtask, create a single-worker swarm. If files overlap, make subtasks sequential via dependencies. But ALWAYS swarm.

```
┌─────────────────────────────────────────────────────────────┐
│                  FORBIDDEN COORDINATOR EXCUSES              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ❌ "This is too small for a swarm"                         │
│  ❌ "I'll handle it directly"                               │
│  ❌ "This is straightforward enough"                        │
│  ❌ "Only 2 files, no need to parallelize"                  │
│  ❌ "Let me just do this quickly"                           │
│  ❌ "This doesn't warrant the overhead"                     │
│                                                             │
│  The user typed /swarm:swarm. They want a swarm. SWARM.     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## What Good Looks Like

**Coordinators orchestrate, workers execute.** You're a conductor, not a performer.

### ✅ GOOD Coordinator Behavior

```
┌─────────────────────────────────────────────────────────────┐
│                  COORDINATOR EXCELLENCE                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✅ Called hivemind_find BEFORE decomposition               │
│     → Found prior learnings about this codebase             │
│     → Included relevant patterns in shared_context          │
│                                                             │
│  ✅ Delegated planning to Task subagent                     │
│     → Main context stayed clean (only received JSON)        │
│     → Scaled to 7 workers without context exhaustion        │
│                                                             │
│  ✅ Spawned ALL workers in SINGLE message                   │
│     → Parallel execution from the start                     │
│     → No sequential spawning bottleneck                     │
│                                                             │
│  ✅ Workers reserved their OWN files                        │
│     → Coordinator never called swarmmail_reserve            │
│     → Conflict detection worked, no edit collisions         │
│                                                             │
│  ✅ Checked swarmmail_inbox every 5-10 minutes              │
│     → Caught worker blocked on schema question              │
│     → Unblocked by coordinating with upstream worker        │
│                                                             │
│  ✅ Reviewed worker output with swarm_review                │
│     → Sent specific feedback via swarm_review_feedback      │
│     → Caught integration issue before merge                 │
│                                                             │
│  ✅ Called hivemind_store after completion                  │
│     → Recorded learnings for future swarms                  │
│     → Tagged with epic ID and codebase context              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### ❌ COMMON MISTAKES (Avoid These)

```
┌─────────────────────────────────────────────────────────────┐
│                  COORDINATOR ANTI-PATTERNS                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ❌ Decided task was "too small" → did it inline            │
│     → Burned coordinator context on simple edits            │
│     → No learning capture, no resilience                    │
│                                                             │
│  ❌ Skipped hivemind_find → workers rediscovered gotchas    │
│     → Same mistakes made that were solved last week         │
│     → Wasted 30 min on known issue                          │
│                                                             │
│  ❌ Decomposed task inline in main thread                   │
│     → Read 12 files, reasoned for 100 messages              │
│     → Burned 50% of context BEFORE spawning workers         │
│                                                             │
│  ❌ Spawned workers one-by-one in separate messages         │
│     → Sequential execution, slow                            │
│     → Could have been parallel                              │
│                                                             │
│  ❌ Reserved files as coordinator                           │
│     → Workers blocked trying to reserve same files          │
│     → Swarm stalled, manual cleanup needed                  │
│                                                             │
│  ❌ Never checked inbox                                     │
│     → Worker stuck for 15 minutes on blocker                │
│     → Silent failure, wasted time                           │
│                                                             │
│  ❌ Closed cells when workers said "done"                   │
│     → Skipped swarm_review → shipped broken integration     │
│                                                             │
│  ❌ Skipped hivemind_store                                  │
│     → Learnings lost, next swarm starts from zero           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## MANDATORY: Swarm Mail

**ALL coordination MUST use `swarmmail_*` tools.** This is non-negotiable.

Swarm Mail is embedded (no external server needed) and provides:

- File reservations to prevent conflicts
- Message passing between agents
- Thread-based coordination tied to cells

## Workflow

### 0. Environment & Mode Detection (FIRST)

**Detect which mode you're in BEFORE any other work:**

```bash
# Check environment variable
if [ -n "$CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" ]; then
  echo "Native Teams Mode - use TeammateTool + EnterPlanMode"
else
  echo "Task Fallback Mode - use Task(subagent_type)"
fi
```

**What this determines:**

| Aspect          | Native Teams Mode                        | Task Fallback Mode                  |
| --------------- | ---------------------------------------- | ----------------------------------- |
| Planning        | `EnterPlanMode` (read-only exploration)  | `Task(subagent_type="Plan")`        |
| Spawning        | `TeammateTool(operation="spawnTeam")`    | `Task(subagent_type="swarm:worker")`|
| Messaging       | `SendMessage(type="message")`            | `swarmmail_send`                    |
| Task UI         | `TaskCreate/TaskUpdate` (both modes)     | `TaskCreate/TaskUpdate` (both modes)|
| File Locks      | `swarmmail_reserve` (both modes)         | `swarmmail_reserve` (both modes)    |
| Shutdown        | `SendMessage(type="shutdown_request")`   | Workers exit when done              |

**Both modes share:**
- hivemind (semantic memory)
- swarmmail_reserve (file locking)
- swarm_decompose/swarm_validate_decomposition (intelligent decomposition)
- swarm_review/swarm_review_feedback (code review)
- swarm_complete (verification gates)
- hive_create_epic (git-backed persistence)

### 0.5. Task Clarity Check (BEFORE DECOMPOSING)

**Before decomposing, ask yourself: Is this task clear enough to parallelize?**

**Vague Task Signals:**

- No specific files or components mentioned
- Vague verbs: "improve", "fix", "update", "make better"
- Large scope without constraints: "refactor the codebase"
- Missing success criteria: "add auth" (what kind? OAuth? JWT? Session?)
- Ambiguous boundaries: "handle errors" (which errors? where?)

**If task is vague, ASK QUESTIONS FIRST:**

```
The task "<task>" needs clarification before I can decompose it effectively.

1. [Specific question about scope/files/approach]

Options:
a) [Option A with trade-off]
b) [Option B with trade-off]
c) [Option C with trade-off]

Which approach, or should I explore something else?
```

**Rules for clarifying questions:**

- ONE question at a time (don't overwhelm)
- Offer 2-3 concrete options when possible
- Lead with your recommendation and why
- Wait for answer before next question

**Clear Task Signals (proceed to decompose):**

- Specific files or directories mentioned
- Concrete action verbs: "add X to Y", "migrate A to B", "extract C from D"
- Defined scope: "the auth module", "API routes in /api/v2"
- Measurable outcome: "tests pass", "type errors fixed", "endpoint returns X"

**When in doubt, ask.** A 30-second clarification beats a 30-minute wrong decomposition.

### 1. Initialize Swarm Mail (FIRST)

```
swarmmail_init(project_path="$PWD", task_description="Swarm: <task summary>")
```

This registers you as the coordinator agent.

### 2. Knowledge Gathering (MANDATORY)

**Before decomposing, query hivemind for prior learnings:**

```
hivemind_find({ query: "<task keywords and codebase name>" })
hivemind_find({ query: "<specific patterns or technologies>" })
```

**What to look for:**
- Prior learnings about this codebase
- Gotchas discovered in similar tasks
- Architectural decisions and rationale
- Patterns that worked (or didn't)

**Synthesize findings into shared_context for workers.**

### 2.5. Research Phase (Spawn Researcher If Needed)

```
┌─────────────────────────────────────────────────────────────┐
│              WHEN TO SPAWN A RESEARCHER                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✅ SPAWN RESEARCHER WHEN:                                  │
│  • Task involves unfamiliar framework/library               │
│  • Need version-specific API docs                           │
│  • Working with experimental/preview features               │
│  • Need architectural guidance                              │
│                                                             │
│  ❌ DON'T SPAWN WHEN:                                       │
│  • Using well-known stable APIs                             │
│  • Pure refactoring of existing code                        │
│  • hivemind already has the answer                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**How to spawn a researcher:**

```
Task(
  subagent_type="Explore",
  description="Research: <topic>",
  prompt="Research <topic> for the swarm task '<task>'.

Use WebSearch, WebFetch, and Read tools to gather information.

Store full findings with hivemind_store for future agents.
Return a 3-5 bullet summary for shared_context."
)
```

### 3. Create Feature Branch (unless --to-main)

```bash
git checkout -b swarm/<short-task-name>
git push -u origin HEAD
```

### 4. Decomposition (Mode-Aware)

> **⚠️ CRITICAL: Context Preservation**
>
> **DO NOT decompose inline in the coordinator thread.** This consumes massive context with file reading and reasoning.
>
> **Use mode-appropriate planning:**

#### Native Teams Mode (EnterPlanMode)

**Use `EnterPlanMode` for read-only exploration before implementation:**

```
# 1. Enter planning mode (read-only, no edits allowed)
EnterPlanMode(reason="Decompose task: <task>")

# 2. Get decomposition prompt
swarm_decompose({ task: "<task>", context: "<hivemind findings>" })

# 3. Explore codebase with Read, Glob, Grep (no Edit/Write allowed)
# Read relevant files, understand architecture

# 4. Generate CellTree JSON
# ... create decomposition ...

# 5. Validate decomposition
swarm_validate_decomposition({ response: "<JSON>" })

# 6. Exit planning mode when ready to implement
ExitPlanMode()

# 7. Create epic with validated JSON
hive_create_epic({ ... })
```

**Why EnterPlanMode?**
- Read-only ensures no premature edits
- Clear separation between planning and execution
- Can explore without risk of partial changes

#### Task Fallback Mode (Delegate to Subagent)

**Delegate to a disposable Task subagent:**

```
# 1. Get decomposition prompt
swarm_decompose({ task: "<task>", context: "<hivemind findings>" })

# 2. Delegate to subagent
Task(
  subagent_type="Plan",
  description="Decompose: <task>",
  prompt="<prompt from swarm_decompose>

Generate a CellTree JSON and validate with swarm_validate_decomposition.
Return ONLY the validated JSON."
)

# 3. Parse result and create epic
hive_create_epic({ ... })
```

**Why delegate?**
- Main thread stays clean (only receives final JSON)
- Subagent context is disposable (garbage collected after planning)
- Scales to 10+ worker swarms without exhaustion

**Both modes:** Main coordinator context stays lean, decomposition reasoning is isolated

### 5. Create Epic + Subtasks

```
hive_create_epic({
  epic_title: "<task>",
  subtasks: [
    { title: "<subtask 1>", files: ["src/foo.ts"] },
    { title: "<subtask 2>", files: ["src/bar.ts"] }
  ]
})
```

Rules:

- Each subtask completable by one agent
- Independent where possible (parallelizable)
- 3-7 subtasks per swarm
- No file overlap between subtasks

### 6. Spawn Agents (Workers Reserve Their Own Files)

> **⚠️ CRITICAL: Coordinator NEVER reserves files.**
>
> Workers reserve their own files via `swarmmail_reserve()` as their first action.
> If coordinator reserves, workers get blocked and swarm stalls.

**CRITICAL: Spawn ALL workers in a SINGLE message (parallel execution).**

#### Native Teams Mode (TeammateTool)

```
# 1. Create team
TeammateTool({
  operation: "spawnTeam",
  team_name: "<epic-id>",
  description: "<task summary>",
  agent_type: "coordinator"
})

# 2. Create shared task list with TaskCreate
TaskCreate({
  title: "Subtask 1: <title>",
  description: "<description>",
  owner: "",  # Unassigned initially
  dependencies: []
})
# ... repeat for each subtask ...

# 3. Spawn teammates (all in one message for parallel execution)
Task(
  subagent_type="swarm:worker",
  team_name: "<epic-id>",
  name: "worker-1",
  description: "Subtask 1: <title>",
  prompt: "<worker prompt with MANDATORY:
    - swarmmail_init first
    - hivemind_find for prior learnings
    - swarmmail_reserve for file locks
    - TaskUpdate to claim task
    - SendMessage to report progress
    - swarm_complete to finish>"
)
# ... spawn all workers in same message ...
```

**Teammate coordination:**
- Workers claim tasks via `TaskUpdate(owner="worker-1")`
- Workers message via `SendMessage(recipient="coordinator")`
- Coordinator broadcasts via `SendMessage(type="broadcast")` (use sparingly - expensive)
- Shutdown via `SendMessage(type="shutdown_request")`

#### Task Fallback Mode (Task Subagent)

```
# 1. Create UI tasks for each subtask
TaskCreate({
  title: "Subtask 1: <title>",
  description: "<description>",
  owner: "worker-1",
  dependencies: []
})
# ... repeat for each subtask ...

# 2. Get spawn prompts
swarm_spawn_subtask({
  bead_id: "<subtask-id>",
  epic_id: "<epic-id>",
  subtask_title: "<title>",
  files: ["src/foo.ts"],
  shared_context: "<hivemind findings>"
})

# 3. Spawn workers (all in one message)
Task(
  subagent_type="swarm:worker",
  description="Subtask 1",
  prompt="<prompt from swarm_spawn_subtask>"
)
# ... spawn all workers in same message ...
```

**Both modes:**
- `TaskCreate` provides UI spinners for user visibility
- Workers use `TaskUpdate` to show progress
- Spawn all workers in SINGLE message for parallel execution

**✅ GOOD:** Spawned all 5 workers in single message → parallel execution
**❌ BAD:** Spawned workers one-by-one → sequential, slow

### 6.5. Custom Prompts: MANDATORY Sections

> **⚠️ If you write custom prompts instead of using `swarm_spawn_subtask`, they MUST include hivemind steps.**

**Why?** Workers that skip hivemind waste time rediscovering solved problems and lose learnings for future agents.

```
┌─────────────────────────────────────────────────────────────┐
│         CUSTOM PROMPT CHECKLIST (NON-NEGOTIABLE)            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ✅ [PRIOR LEARNINGS] section with hivemind_find queries    │
│  ✅ hivemind_find as step 1-2 in MANDATORY STEPS            │
│  ✅ hivemind_store before completion                        │
│  ✅ swarmmail_init as first action                          │
│  ✅ swarm_complete (not hive_close) to finish               │
│                                                             │
│  Missing any of these? Your workers will:                   │
│  - Repeat mistakes from last week                           │
│  - Lose discoveries that took 30+ min to find               │
│  - Start from zero every time                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Minimal Custom Prompt Template:**

```markdown
You are a swarm agent working on: **{task_title}**

[IDENTITY]
Agent: {agent_name}
Cell: {bead_id}
Epic: {epic_id}

[TASK]
{task_description}

[CONTEXT]
{shared_context_from_coordinator}

[PRIOR LEARNINGS - QUERY THESE FIRST]
Before starting work, check what past agents learned:
- hivemind_find(query="{task keywords}", limit=5)
- hivemind_find(query="{technology/domain} gotchas", limit=3)

Use findings to avoid known pitfalls and apply proven patterns.

[MANDATORY STEPS]
1. swarmmail_init(project_path="{project_path}", agent_name="{agent_name}", task_description="{bead_id}: {task_title}")
2. hivemind_find - query for relevant prior learnings (see above)
3. {your actual task steps here}
4. hivemind_store - if you discovered something valuable, STORE IT:
   hivemind_store(information="<what you learned>", tags="{domain},{tech}")
5. swarmmail_send(to=["coordinator"], subject="{completion subject}", body="{findings}")
6. swarm_complete(project_key="{project_path}", agent_name="{agent_name}", bead_id="{bead_id}", summary="...", files_touched=[])

[STORE YOUR LEARNINGS]
If you discovered any of these, STORE them before completing:
- 🐛 Tricky bugs (>15min to solve)
- 💡 Project-specific patterns
- ⚠️ Tool/library gotchas
- 🚫 Approaches that failed
- 🏗️ Architectural decisions
```

**Example: Research Task (Fixed)**

Before (missing hivemind):
```
[MANDATORY STEPS]
1. swarmmail_init(...)
2. Search for patterns...
3. Document findings...
4. swarmmail_send(...)
5. swarm_complete(...)
```

After (with hivemind):
```
[PRIOR LEARNINGS]
- hivemind_find(query="client bundle hydration RSC", limit=5)
- hivemind_find(query="course-builder performance patterns", limit=3)

[MANDATORY STEPS]
1. swarmmail_init(...)
2. hivemind_find - check for prior learnings about this task
3. Search for patterns...
4. Document findings...
5. hivemind_store - store discoveries for future agents
6. swarmmail_send(...)
7. swarm_complete(...)
```

### 7. Monitor Progress (MANDATORY - unless --no-sync)

> **⚠️ CRITICAL: Active monitoring is NOT optional.**
>
> Workers get blocked. Files conflict. Scope changes. You must intervene.

#### Native Teams Mode (Automatic Messaging)

**Messages from teammates are automatically delivered to you.**

```
# Check shared task list to see progress
TaskList()

# Messages appear automatically as conversation turns
# No need to poll - the system delivers them to you

# Check overall status
swarm_status({ epic_id: "<epic-id>", project_key: "$PWD" })
```

**When teammates send you messages:**
- Messages appear as new conversation turns (like user messages)
- No manual inbox checking needed
- Respond with `SendMessage(recipient="worker-1", ...)`

**Broadcasting updates (use sparingly - expensive):**
```
SendMessage({
  type: "broadcast",
  content: "<guidance>",
  summary: "Critical update"
})
```

#### Task Fallback Mode (swarmmail_inbox)

**Check swarmmail inbox every 5-10 minutes:**

```
# Every 5-10 minutes while workers are active
swarmmail_inbox()  # Check for worker messages (max 5, no bodies)

# If urgent messages appear, read specific message if needed

# Check overall status
swarm_status({ epic_id: "<epic-id>", project_key: "$PWD" })
```

**Both modes - Intervention triggers:**

- **Worker blocked >5 min** → Offer guidance
- **File conflict** → Mediate, reassign files
- **Worker asking questions** → Answer directly
- **Scope creep** → Redirect, create new cell for extras

### 8. Review Worker Output (MANDATORY)

> **⚠️ CRITICAL: Never skip review.**
>
> Workers say "done" doesn't mean "correct" or "integrated".
> Use `swarm_review` to generate review prompt, then `swarm_review_feedback` to approve/reject.

**Review workflow:**

```
# 1. Generate review prompt with epic context + diff
swarm_review({
  project_key: "$PWD",
  epic_id: "<epic-id>",
  task_id: "<subtask-id>",
  files_touched: ["src/foo.ts"]
})

# 2. Review the output (check for integration, type safety, tests)

# 3. Send feedback
swarm_review_feedback({
  project_key: "$PWD",
  task_id: "<subtask-id>",
  worker_id: "<agent-name>",
  status: "approved",  # or "needs_changes"
  summary: "LGTM - integrates correctly",
  issues: ""  # or specific issues
})
```

**Review criteria:**
- Does work fulfill subtask requirements?
- Does it serve the overall epic goal?
- Does it enable downstream tasks?
- Type safety maintained?
- Tests added/passing?
- No obvious bugs or security issues?

**3-Strike Rule:** After 3 review rejections, task is marked blocked.

### 9. Store Learnings (MANDATORY)

**Before completing, store what you learned:**

```
hivemind_store({
  information: "Swarm <epic-id> completed. Key learnings: <what worked, gotchas found, patterns discovered>",
  tags: "swarm,<codebase>,<technologies>"
})
```

### 10. Complete & Cleanup

#### Native Teams Mode

```
# 1. Request teammates to shut down
SendMessage({
  type: "shutdown_request",
  recipient: "worker-1",
  content: "Task complete, wrapping up session"
})
# ... for each worker ...

# 2. Workers respond with shutdown_response (approve/reject)
# 3. Once all workers shut down, cleanup team
TeammateTool({ operation: "cleanup" })

# 4. Complete coordinator work
swarm_complete({
  project_key: "$PWD",
  agent_name: "coordinator",
  bead_id: "<epic-id>",
  summary: "<what was accomplished>",
  files_touched: [...]
})
```

**IMPORTANT:** `cleanup` fails if team still has active members. Gracefully terminate teammates first.

#### Task Fallback Mode

```
# Workers complete and exit automatically
swarm_complete({
  project_key: "$PWD",
  agent_name: "<your-name>",
  bead_id: "<epic-id>",
  summary: "<what was accomplished>",
  files_touched: [...]
})
```

### 11. Create PR (unless --to-main)

```bash
gh pr create --title "feat: <epic title>" --body "## Summary\n<bullets>\n\n## Subtasks\n<list>"
```

## Mode-Specific Tools Quick Reference

### Native Teams Mode

| Tool                     | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `TeammateTool`           | Create team, cleanup after completion          |
| `EnterPlanMode`          | Enter read-only planning (no edits allowed)    |
| `ExitPlanMode`           | Exit planning, ready to implement              |
| `SendMessage`            | Send message to teammate or broadcast          |
| `TaskCreate`             | Create UI task (spinners for user visibility)  |
| `TaskUpdate`             | Update task status, claim ownership            |
| `TaskList`               | View shared task list                          |

### Task Fallback Mode

| Tool                     | Purpose                             |
| ------------------------ | ----------------------------------- |
| `Task`                   | Spawn subagent worker               |
| `TaskCreate`             | Create UI task (spinners)           |
| `TaskUpdate`             | Update task status                  |
| `swarmmail_send`         | Send message to agents              |
| `swarmmail_inbox`        | Check inbox (max 5, no bodies)      |

### Both Modes (Plugin Tools)

| Tool                     | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `swarmmail_init`         | Initialize session (REQUIRED FIRST)     |
| `swarmmail_reserve`      | Reserve files for exclusive editing     |
| `swarmmail_release`      | Release file reservations               |
| `hivemind_find`          | Search semantic memory                  |
| `hivemind_store`         | Store learnings                         |
| `swarm_decompose`        | Generate decomposition prompt           |
| `swarm_validate_decomposition` | Validate CellTree JSON            |
| `swarm_review`           | Generate review prompt                  |
| `swarm_review_feedback`  | Approve/reject worker output            |
| `swarm_complete`         | Complete with verification              |
| `hive_create_epic`       | Create epic + subtasks (git-backed)     |

## Strategy Reference

| Strategy       | Best For                 | Keywords                              |
| -------------- | ------------------------ | ------------------------------------- |
| file-based     | Refactoring, migrations  | refactor, migrate, rename, update all |
| feature-based  | New features             | add, implement, build, create, new    |
| risk-based     | Bug fixes, security      | fix, bug, security, critical, urgent  |

## Context Preservation Rules

**These are NON-NEGOTIABLE. Violating them burns context and kills long swarms.**

| Rule                               | Why                                                       |
| ---------------------------------- | --------------------------------------------------------- |
| **Delegate planning to subagent**  | Decomposition reasoning + file reads consume huge context |
| **Never read 10+ files inline**    | Use subagent to read + summarize                          |
| **Use swarmmail_inbox carefully**  | Max 5 messages, no bodies by default                      |
| **Receive JSON only from planner** | No analysis, no file contents, just structure             |

**Pattern: Delegate → Receive Summary → Act**

Not: Do Everything Inline → Run Out of Context → Fail

## Hivemind Usage (MANDATORY)

```
┌─────────────────────────────────────────────────────────────┐
│              HIVEMIND IS NOT OPTIONAL                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  BEFORE work:                                               │
│  hivemind_find({ query: "relevant topic" })                 │
│                                                             │
│  AFTER work:                                                │
│  hivemind_store({                                           │
│    information: "What we learned...",                       │
│    tags: "swarm,codebase,technology"                        │
│  })                                                         │
│                                                             │
│  Store liberally. Memory is cheap.                          │
│  Re-discovering gotchas is expensive.                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Quick Checklist

### Pre-Flight
- [ ] **Environment check** - detect mode (native-teams vs task-fallback)
- [ ] **swarmmail_init** called FIRST
- [ ] **hivemind_find** queried for prior learnings (MANDATORY)
- [ ] Researcher spawned if needed for unfamiliar tech

### Planning Phase
- [ ] **Mode-aware planning** (EnterPlanMode OR Task subagent, NOT inline)
- [ ] CellTree validated (no file conflicts)
- [ ] Epic + subtasks created with `hive_create_epic`
- [ ] **UI tasks created** with `TaskCreate` (both modes)

### Execution Phase
- [ ] **Coordinator did NOT reserve files** (workers do this)
- [ ] **Custom prompts include hivemind steps** (see 6.5)
- [ ] **Workers spawned in parallel** (single message, multiple spawns)
- [ ] **Mode-aware monitoring** (automatic in native-teams, poll inbox in fallback)
- [ ] **All workers reviewed** with swarm_review

### Completion
- [ ] **hivemind_store** called with learnings (MANDATORY)
- [ ] **Mode-aware shutdown** (SendMessage shutdown_request OR workers exit naturally)
- [ ] **TeammateTool cleanup** (native-teams only)
- [ ] PR created (or pushed to main)
- [ ] **ASCII art session summary**

## Mode Comparison Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      WHEN TO USE WHICH MODE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  NATIVE TEAMS MODE                                                      │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │  ✅ Real-time coordination needed                          │        │
│  │  ✅ Workers need to message each other                     │        │
│  │  ✅ Complex task dependencies                              │        │
│  │  ✅ Want planning mode safety (read-only exploration)      │        │
│  │  ✅ Shared task list with ownership tracking               │        │
│  │                                                            │        │
│  │  Benefits:                                                 │        │
│  │  • Automatic message delivery                              │        │
│  │  • Planning mode prevents premature edits                  │        │
│  │  • Task ownership via TaskUpdate                           │        │
│  │  • Graceful shutdown protocol                              │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
│  TASK FALLBACK MODE                                                     │
│  ┌────────────────────────────────────────────────────────────┐        │
│  │  ✅ Simple parallel work (independent subtasks)            │        │
│  │  ✅ Minimal inter-worker communication                     │        │
│  │  ✅ Native teams not available/enabled                     │        │
│  │  ✅ Fire-and-forget execution                              │        │
│  │                                                            │        │
│  │  Benefits:                                                 │        │
│  │  • Simpler coordinator logic                               │        │
│  │  • Workers auto-exit when done                             │        │
│  │  • Persistent message history (swarmmail)                  │        │
│  │  • Proven stable architecture                              │        │
│  └────────────────────────────────────────────────────────────┘        │
│                                                                         │
│  BOTH MODES GET:                                                        │
│  • Semantic memory (hivemind)                                           │
│  • File locking (swarmmail_reserve)                                     │
│  • Intelligent decomposition (swarm_decompose)                          │
│  • Code review (swarm_review)                                           │
│  • Verification gates (swarm_complete)                                  │
│  • Git-backed persistence (hive)                                        │
│  • UI task spinners (TaskCreate)                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## ASCII Art Session Summary (MANDATORY)

**Every swarm completion MUST include visual output.**

### Required Elements

1. **ASCII banner** - Big text for epic title or "SWARM COMPLETE"
2. **Architecture diagram** - Show what was built with box-drawing chars
3. **Stats summary** - Files, subtasks in a nice box
4. **Ship-it flourish** - Cow, bee, or memorable closer

### Box-Drawing Reference

```
─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼    (light)
━ ┃ ┏ ┓ ┗ ┛ ┣ ┫ ┳ ┻ ╋    (heavy)
═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬    (double)
```

### Example Session Summary

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                    🐝 SWARM COMPLETE 🐝                     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

    EPIC: Add User Authentication
    ══════════════════════════════

    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │   OAuth     │────▶│   Session   │────▶│  Protected  │
    │   Provider  │     │   Manager   │     │   Routes    │
    └─────────────┘     └─────────────┘     └─────────────┘

    SUBTASKS
    ────────
    ├── auth-123.1 ✓ OAuth provider setup
    ├── auth-123.2 ✓ Session management
    ├── auth-123.3 ✓ Protected route middleware
    └── auth-123.4 ✓ Integration tests

    STATS
    ─────
    Files Modified:  12
    Tests Added:     24

        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||

    moo. ship it.
```

**This is not optional.** Make it beautiful. Make it memorable.

Begin with swarmmail_init and hivemind_find now.
