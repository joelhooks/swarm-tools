---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Decompose the task into beads and spawn parallel agents.

## Task

$ARGUMENTS

## Flags (parse from task above)

- `--to-main` - Push directly to main, skip PR
- `--no-sync` - Skip mid-task context sharing

**Default: Feature branch + PR with context sync.**

## Workflow

### 1. Initialize

```
agentmail_init(project_path="$PWD", task_description="Swarm: <task summary>")
```

### 2. Knowledge Gathering (MANDATORY)

**Before decomposing, query ALL knowledge sources:**

```
# Past learnings from this project
semantic-memory_find(query="<task keywords>", limit=5)

# How similar tasks were solved before
cass_search(query="<task description>", limit=5)

# Design patterns and prior art
pdf-brain_search(query="<domain concepts>", limit=5)

# Available skills to inject into workers
skills_list()
```

**Load coordinator skills based on task type:**

```
# For swarm coordination (ALWAYS load this)
skills_use(name="swarm-coordination")

# For architectural decisions
skills_use(name="system-design")

# If task involves testing
skills_use(name="testing-patterns")

# If building CLI tools
skills_use(name="cli-builder")
```

Synthesize findings into shared context for workers. Note:

- Relevant patterns from pdf-brain
- Similar past approaches from CASS
- Project-specific learnings from semantic-memory
- **Skills to recommend for each subtask** (critical for worker effectiveness)

### 3. Create Feature Branch (unless --to-main)

```bash
git checkout -b swarm/<short-task-name>
git push -u origin HEAD
```

### 4. Decompose Task

Use strategy selection and planning:

```
swarm_select_strategy(task="<the task>")
swarm_plan_prompt(task="<the task>", strategy="<auto or selected>", context="<synthesized knowledge>")
```

Follow the prompt to create a BeadTree, then validate:

```
swarm_validate_decomposition(response="<your BeadTree JSON>")
```

### 5. Create Beads

```
beads_create_epic(epic_title="<task>", subtasks=[{title, files, priority}...])
```

Rules:

- Each bead completable by one agent
- Independent where possible (parallelizable)
- 3-7 beads per swarm
- No file overlap between subtasks

### 6. Reserve Files

```
agentmail_reserve(paths=[<files>], reason="<bead-id>: <description>")
```

No two agents should edit the same file.

### 7. Spawn Agents

**CRITICAL: Spawn ALL in a SINGLE message with multiple Task calls.**

For each subtask:

```
swarm_spawn_subtask(
  bead_id="<id>",
  epic_id="<epic>",
  subtask_title="<title>",
  files=[...],
  shared_context="<synthesized knowledge from step 2>"
)
```

**Include skill recommendations in shared_context:**

```markdown
## Recommended Skills

Load these skills before starting work:

- skills_use(name="testing-patterns") - if adding tests or breaking dependencies
- skills_use(name="swarm-coordination") - if coordinating with other agents
- skills_use(name="system-design") - if making architectural decisions
- skills_use(name="cli-builder") - if working on CLI components

See full skill list with skills_list().
```

Then spawn:

```
Task(subagent_type="swarm/worker", description="<bead-title>", prompt="<from swarm_spawn_subtask>")
```

### 8. Monitor (unless --no-sync)

```
swarm_status(epic_id="<epic-id>", project_key="$PWD")
agentmail_inbox()
```

**Intervention triggers:**

- Worker blocked >5 min → Check inbox, offer guidance
- File conflict → Mediate, reassign files
- Worker asking questions → Answer directly
- Scope creep → Redirect, create new bead for extras

If incompatibilities spotted, broadcast:

```
agentmail_send(to=["*"], subject="Coordinator Update", body="<guidance>", importance="high")
```

### 9. Complete

```
swarm_complete(project_key="$PWD", agent_name="<your-name>", bead_id="<epic-id>", summary="<done>", files_touched=[...])
beads_sync()
```

### 10. Create PR (unless --to-main)

```bash
gh pr create --title "feat: <epic title>" --body "## Summary\n<bullets>\n\n## Beads\n<list>"
```

## Strategy Reference

| Strategy       | Best For                 | Keywords                              | Recommended Skills                |
| -------------- | ------------------------ | ------------------------------------- | --------------------------------- |
| file-based     | Refactoring, migrations  | refactor, migrate, rename, update all | system-design, testing-patterns   |
| feature-based  | New features             | add, implement, build, create, new    | system-design, swarm-coordination |
| risk-based     | Bug fixes, security      | fix, bug, security, critical, urgent  | testing-patterns                  |
| research-based | Investigation, discovery | research, investigate, explore, learn | system-design                     |

## Skill Triggers (Auto-load based on task type)

**Task Analysis** → Recommend these skills in shared_context:

| Task Pattern           | Skills to Load                                          |
| ---------------------- | ------------------------------------------------------- |
| Contains "test"        | `skills_use(name="testing-patterns")`                   |
| Contains "refactor"    | `skills_use(name="testing-patterns")` + `system-design` |
| Contains "CLI"         | `skills_use(name="cli-builder")`                        |
| Multi-agent work       | `skills_use(name="swarm-coordination")`                 |
| Architecture decisions | `skills_use(name="system-design")`                      |
| Breaking dependencies  | `skills_use(name="testing-patterns")`                   |

## Quick Checklist

- [ ] Knowledge gathered (semantic-memory, CASS, pdf-brain, skills)
- [ ] Strategy selected
- [ ] BeadTree validated (no file conflicts)
- [ ] Epic + subtasks created
- [ ] Files reserved
- [ ] Workers spawned in parallel
- [ ] Progress monitored
- [ ] PR created (or pushed to main)

Begin with knowledge gathering now.
