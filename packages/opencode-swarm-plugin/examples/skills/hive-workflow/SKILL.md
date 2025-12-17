---
name: hive-workflow
description: Issue tracking and task management using the hive system. Use when creating, updating, or managing work items. Use when you need to track bugs, features, tasks, or epics. Do NOT use for simple one-off questions or explorations.
tags:
  - hive
  - issues
  - tracking
  - workflow
tools:
  - hive_create
  - hive_query
  - hive_update
  - hive_close
  - hive_create_epic
  - hive_sync
related_skills:
  - swarm-coordination
---

# Hive Workflow Skill

Hive is a local-first issue tracking system designed for AI agents. This skill provides best practices for effective cell management.

**NOTE:** For swarm workflows, combine this skill with `swarm-coordination` from global-skills/.

## Cell Types

| Type      | When to Use                             |
| --------- | --------------------------------------- |
| `bug`     | Something is broken and needs fixing    |
| `feature` | New functionality to add                |
| `task`    | General work item                       |
| `chore`   | Maintenance, refactoring, dependencies  |
| `epic`    | Large initiative with multiple subtasks |

## Creating Effective Cells

### Good Cell Titles

```text
- "Fix null pointer exception in UserService.getProfile()"
- "Add dark mode toggle to settings page"
- "Migrate auth tokens from localStorage to httpOnly cookies"
```

### Bad Cell Titles

```text
- "Fix bug" (too vague)
- "Make it better" (not actionable)
- "stuff" (meaningless)
```

### Cell Body Structure

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
hive_update(id: "hv-abc123", state: "in_progress")
```

Use when you start working on a cell.

### In Progress → Closed

```typescript
hive_close(id: "hv-abc123", resolution: "Fixed in commit abc1234")
```

Use when work is complete.

### In Progress → Blocked

```typescript
hive_update(id: "hv-abc123", state: "blocked", body: "Blocked by #hv-xyz789")
```

Use when you can't proceed due to a dependency.

## Querying Cells

### Find Open Work

```typescript
hive_query(state: "open", type: "bug")
```

### Search by Keywords

```typescript
hive_query(search: "authentication")
```

### List Recent Activity

```typescript
hive_query(limit: 10, sort: "updated")
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

- [ ] #hv-001: Implement OAuth2 provider
- [ ] #hv-002: Add MFA support
- [ ] #hv-003: Migrate session storage
- [ ] #hv-004: Update login UI
```

### Creating an Epic with Subtasks

1. Create the epic first:

```typescript
hive_create(type: "epic", title: "User Auth Overhaul", body: "...")
```

2. Create subtasks linked to the epic:

```typescript
hive_create(type: "task", title: "Implement OAuth2", parent: "epic-id")
```

## Best Practices

```text
1. **One cell per logical unit of work** - Don't combine unrelated fixes
2. **Update state promptly** - Keep cells reflecting reality
3. **Add context in body** - Future you will thank present you
4. **Link related cells** - Use `#hv-id` references
5. **Close with resolution** - Explain how it was resolved
6. **Use labels** - `priority:high`, `area:frontend`, etc.
```

## Sync and Collaboration

Cells sync with git:

- Changes tracked locally
- Use `hive_sync()` to commit and push to remote

## Integration with Swarm

When working in a swarm:

```text
1. Load `swarm-coordination` skill with `skills_use(name="swarm-coordination")`
2. Create epic with `hive_create_epic()` (atomic operation)
3. Coordinator assigns cells to worker agents
4. Workers load relevant skills based on subtask type
5. Close cells as subtasks complete
6. Close epic when all subtasks done
7. Sync with `hive_sync()` (MANDATORY at session end)
```

### Skill Recommendations for Common Cell Types

```text
- `type: "bug"` → Load `testing-patterns` for regression tests
- `type: "feature"` → Load `system-design` for architecture
- `type: "chore"` → Load `testing-patterns` if refactoring
- `type: "epic"` → Load `swarm-coordination` for decomposition
```
