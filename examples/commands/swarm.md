---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Take a complex task, break it into beads, and unleash parallel agents.

## Usage

```
/swarm <task description or bead-id>
/swarm --to-main <task>  # Skip PR, push directly to main (use sparingly)
/swarm --no-sync <task>  # Skip mid-task context sync (for simple independent tasks)
```

**Default behavior: Feature branch + PR with context sync.** All swarm work goes to a feature branch, agents share context mid-task, and creates a PR for review.

## Step 1: Initialize Session

Use the plugin's agent-mail tools to register:

```
agentmail_init with project_path=$PWD, task_description="Swarm coordinator: <task>"
```

This returns your agent name and session state. Remember it.

## Step 2: Create Feature Branch

**CRITICAL: Never push directly to main.**

```bash
# Create branch from bead ID or task name
git checkout -b swarm/<bead-id>  # e.g., swarm/trt-buddy-d7d
# Or for ad-hoc tasks:
git checkout -b swarm/<short-description>  # e.g., swarm/contextual-checkins

git push -u origin HEAD
```

## Step 3: Understand the Task

If given a bead-id:

```
beads_query with id=<bead-id>
```

If given a description, analyze it to understand scope.

## Step 4: Select Strategy & Decompose

### Option A: Use the Planner Agent (Recommended)

Spawn the `@swarm-planner` agent to handle decomposition:

```
Task(
  subagent_type="general",
  description="Plan swarm decomposition",
  prompt="You are @swarm-planner. Decompose this task: <task description>. Use swarm_select_strategy and swarm_plan_prompt to guide your decomposition. Return ONLY valid BeadTree JSON."
)
```

### Option B: Manual Decomposition

1. **Select strategy**:

```
swarm_select_strategy with task="<task description>"
```

2. **Get planning prompt**:

```
swarm_plan_prompt with task="<task description>", strategy="<selected or auto>"
```

3. **Create decomposition** following the prompt guidelines

4. **Validate**:

```
swarm_validate_decomposition with response="<your BeadTree JSON>"
```

### Create Beads

Once you have a valid BeadTree:

```
beads_create_epic with epic_title="<parent task>", subtasks=[{title, description, files, priority}...]
```

**Decomposition rules:**

- Each bead should be completable by one agent
- Beads should be independent (parallelizable) where possible
- If there are dependencies, order them in the subtasks array
- Aim for 3-7 beads per swarm (too few = not parallel, too many = coordination overhead)

## Step 5: Reserve Files

For each subtask, reserve the files it will touch:

```
agentmail_reserve with paths=[<files>], reason="<bead-id>: <brief description>"
```

**Conflict prevention:**

- No two agents should edit the same file
- If overlap exists, merge beads or sequence them

## Step 6: Spawn the Swarm

**CRITICAL: Spawn ALL agents in a SINGLE message with multiple Task calls.**

Use the prompt generator for each subtask:

```
swarm_spawn_subtask with bead_id="<bead-id>", epic_id="<epic-id>", subtask_title="<title>", subtask_description="<description>", files=[<files>], shared_context="Branch: swarm/<id>, sync_enabled: true"
```

Then spawn agents with the generated prompts:

```
Task(
  subagent_type="general",
  description="Swarm worker: <bead-title>",
  prompt="<output from swarm_spawn_subtask>"
)
```

Spawn ALL agents in parallel in a single response.

## Step 7: Monitor Progress (unless --no-sync)

Check swarm status:

```
swarm_status with epic_id="<parent-bead-id>"
```

Monitor inbox for progress updates:

```
agentmail_inbox
```

**When you receive progress updates:**

1. **Review decisions made** - Are agents making compatible choices?
2. **Check for pattern conflicts** - Different approaches to the same problem?
3. **Identify shared concerns** - Common blockers or discoveries?

**If you spot incompatibilities, broadcast shared context:**

```
agentmail_send with to=["*"], subject="Coordinator Update", body="<guidance>", thread_id="<epic-id>", importance="high"
```

## Step 8: Collect Results

When agents complete, they send completion messages. Summarize the thread:

```
agentmail_summarize_thread with thread_id="<epic-id>"
```

## Step 9: Complete Swarm

Use the swarm completion tool:

```
swarm_complete with project_key=$PWD, agent_name=<YOUR_NAME>, bead_id="<epic-id>", summary="<what was accomplished>", files_touched=[<all files>]
```

This:

- Runs [UBS (Ultimate Bug Scanner)](https://github.com/Dicklesworthstone/ultimate_bug_scanner) on touched files to detect bugs before completion
- Releases file reservations
- Closes the bead
- Records outcome for learning

> **Note:** UBS is optional but recommended. If not installed, swarm completion proceeds with a warning that manual review is advised. Install via:
> ```bash
> curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/ultimate_bug_scanner/master/install.sh" | bash
> ```
> See the [UBS repo](https://github.com/Dicklesworthstone/ultimate_bug_scanner) for more options (Docker, Nix, etc.).

Then sync beads:

```
beads_sync
```

## Step 10: Create PR

```bash
gh pr create --title "feat: <epic title>" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points from swarm results>

## Beads Completed
- <bead-id>: <summary>
- <bead-id>: <summary>

## Files Changed
<aggregate list>

## Testing
- [ ] Type check passes
- [ ] Tests pass (if applicable)
EOF
)"
```

Report summary:

```markdown
## Swarm Complete: <task>

### PR: #<number>

### Agents Spawned: N

### Beads Closed: N

### Work Completed

- [bead-id]: [summary]

### Files Changed

- [aggregate list]
```

## Failure Handling

If an agent fails:

- Check its messages: `agentmail_inbox`
- The bead remains in-progress
- Manually investigate or re-spawn

If file conflicts occur:

- Agent Mail reservations should prevent this
- If it happens, one agent needs to wait

## Direct-to-Main Mode (--to-main)

Only use when explicitly requested. Skips branch/PR:

- Trivial fixes across many files
- Automated migrations with high confidence
- User explicitly says "push to main"

## No-Sync Mode (--no-sync)

Skip mid-task context sharing when tasks are truly independent:

- Simple mechanical changes (find/replace, formatting, lint fixes)
- Tasks with zero integration points
- Completely separate feature areas with no shared types

In this mode:

- Agents skip the mid-task progress message
- Coordinator skips Step 7 (monitoring)
- Faster execution, less coordination overhead

**Default is sync ON** - prefer sharing context. Use `--no-sync` deliberately.

## Strategy Reference

| Strategy          | Best For                    | Auto-Detected Keywords                         |
| ----------------- | --------------------------- | ---------------------------------------------- |
| **file-based**    | Refactoring, migrations     | refactor, migrate, rename, update all, convert |
| **feature-based** | New features, functionality | add, implement, build, create, feature, new    |
| **risk-based**    | Bug fixes, security         | fix, bug, security, critical, urgent, hotfix   |

Use `swarm_select_strategy` to see which strategy is recommended and why.
