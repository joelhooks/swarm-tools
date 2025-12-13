---
name: beads-workflow
description: Issue tracking and task management using the beads system. Use when creating, updating, or managing work items. Use when you need to track bugs, features, tasks, or epics. Do NOT use for simple one-off questions or explorations.
tags:
  - beads
  - issues
  - tracking
  - workflow
tools:
  - beads_create
  - beads_query
  - beads_update
  - beads_close
  - beads_create_epic
  - beads_sync
related_skills:
  - swarm-coordination
---

# Beads Workflow Skill

Beads is a local-first issue tracking system designed for AI agents. This skill provides best practices for effective bead management.

**NOTE:** For swarm workflows, combine this skill with `swarm-coordination` from global-skills/.

## Bead Types

| Type      | When to Use                             |
| --------- | --------------------------------------- |
| `bug`     | Something is broken and needs fixing    |
| `feature` | New functionality to add                |
| `task`    | General work item                       |
| `chore`   | Maintenance, refactoring, dependencies  |
| `epic`    | Large initiative with multiple subtasks |

## Creating Effective Beads

### Good Bead Titles

```text
- "Fix null pointer exception in UserService.getProfile()"
- "Add dark mode toggle to settings page"
- "Migrate auth tokens from localStorage to httpOnly cookies"
```

### Bad Bead Titles

```text
- "Fix bug" (too vague)
- "Make it better" (not actionable)
- "stuff" (meaningless)
```

### Bead Body Structure

```markdown
## Problem

[Clear description of the issue or need]

## Expected Behavior

[What should happen]

## Current Behavior

[What currently happens, for bugs]

## Proposed Solution

[How to fix/implement, if known]

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Notes

[Any additional context, links, or constraints]
```

## Workflow States

```text
open → in_progress → closed
         ↓
      blocked (optional)
```

### State Transitions

### Open → In Progress

```typescript
beads_update(id: "abc123", state: "in_progress")
```

Use when you start working on a bead.

### In Progress → Closed

```typescript
beads_close(id: "abc123", resolution: "Fixed in commit abc1234")
```

Use when work is complete.

### In Progress → Blocked

```typescript
beads_update(id: "abc123", state: "blocked", body: "Blocked by #xyz789")
```

Use when you can't proceed due to a dependency.

## Querying Beads

### Find Open Work

```typescript
beads_query(state: "open", type: "bug")
```

### Search by Keywords

```typescript
beads_query(search: "authentication")
```

### List Recent Activity

```typescript
beads_query(limit: 10, sort: "updated")
```

## Epic Management

Epics are containers for related work:

```markdown
---
type: epic
title: User Authentication Overhaul
---

## Objective

Modernize the authentication system

## Subtasks

- [ ] #bead-001: Implement OAuth2 provider
- [ ] #bead-002: Add MFA support
- [ ] #bead-003: Migrate session storage
- [ ] #bead-004: Update login UI
```

### Creating an Epic with Subtasks

1. Create the epic first:

```typescript
beads_create(type: "epic", title: "User Auth Overhaul", body: "...")
```

2. Create subtasks linked to the epic:

```typescript
beads_create(type: "task", title: "Implement OAuth2", parent: "epic-id")
```

## Best Practices

```text
1. **One bead per logical unit of work** - Don't combine unrelated fixes
2. **Update state promptly** - Keep beads reflecting reality
3. **Add context in body** - Future you will thank present you
4. **Link related beads** - Use `#bead-id` references
5. **Close with resolution** - Explain how it was resolved
6. **Use labels** - `priority:high`, `area:frontend`, etc.
```

## Sync and Collaboration

Beads sync with git:

- Changes tracked locally
- Use `beads_sync()` to commit and push to remote

## Integration with Swarm

When working in a swarm:

```text
1. Load `swarm-coordination` skill with `skills_use(name="swarm-coordination")`
2. Create epic with `beads_create_epic()` (atomic operation)
3. Coordinator assigns beads to worker agents
4. Workers load relevant skills based on subtask type
5. Close beads as subtasks complete
6. Close epic when all subtasks done
7. Sync with `beads_sync()` (MANDATORY at session end)
```

### Skill Recommendations for Common Bead Types

```text
- `type: "bug"` → Load `testing-patterns` for regression tests
- `type: "feature"` → Load `system-design` for architecture
- `type: "chore"` → Load `testing-patterns` if refactoring
- `type: "epic"` → Load `swarm-coordination` for decomposition
```
