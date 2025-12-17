---
name: swarm-coordination
description: Multi-agent coordination patterns for OpenCode swarm workflows. Use when working on complex tasks that benefit from parallelization, when coordinating multiple agents, or when managing task decomposition. Do NOT use for simple single-agent tasks.
tags:
  - swarm
  - multi-agent
  - coordination
tools:
  - swarm_decompose
  - swarm_complete
  - swarmmail_init
  - swarmmail_send
  - swarmmail_inbox
  - swarmmail_read_message
  - swarmmail_reserve
  - swarmmail_release
  - skills_use
  - skills_list
related_skills:
  - testing-patterns
  - system-design
  - cli-builder
---

# Swarm Coordination Skill

This skill provides guidance for effective multi-agent coordination in OpenCode swarm workflows.

**IMPORTANT:** This skill references global skills in `global-skills/`. Workers should load domain-specific skills based on their subtask type.

## MANDATORY: Swarm Mail

**ALL coordination MUST use `swarmmail_*` tools.** This is non-negotiable.

Swarm Mail is embedded (no external server needed) and provides:

- File reservations to prevent conflicts
- Message passing between agents
- Thread-based coordination tied to cells

## When to Use Swarm Coordination

Use swarm coordination when:

- A task has multiple independent subtasks that can run in parallel
- The task requires different specializations (e.g., frontend + backend + tests)
- Work can be divided by file/module boundaries
- Time-to-completion matters and parallelization helps

Do NOT use swarm coordination when:

- The task is simple and can be done by one agent
- Subtasks have heavy dependencies on each other
- The overhead of coordination exceeds the benefit

## Task Decomposition Strategy

### 1. Analyze the Task

Before decomposing, understand:

- What are the distinct units of work?
- Which parts can run in parallel vs sequentially?
- What are the file/module boundaries?
- Are there shared resources that need coordination?

### 2. Choose a Decomposition Strategy

**Parallel Strategy** - For independent subtasks:

```text
Parent Task: "Add user authentication"
├── Subtask 1: "Create auth API endpoints" (backend)
├── Subtask 2: "Build login/signup forms" (frontend)
├── Subtask 3: "Write auth integration tests" (testing)
└── Subtask 4: "Add auth documentation" (docs)
```

**Sequential Strategy** - When order matters:

```text
Parent Task: "Migrate database schema"
├── Step 1: "Create migration files"
├── Step 2: "Update model definitions"
├── Step 3: "Run migrations"
└── Step 4: "Verify data integrity"
```

**Hybrid Strategy** - Mixed dependencies:

```text
Parent Task: "Add feature X"
├── Phase 1 (parallel):
│   ├── Subtask A: "Design API"
│   └── Subtask B: "Design UI mockups"
├── Phase 2 (sequential, after Phase 1):
│   └── Subtask C: "Implement based on designs"
└── Phase 3 (parallel):
    ├── Subtask D: "Write tests"
    └── Subtask E: "Update docs"
```

## File Reservation Protocol

When multiple agents work on the same codebase:

1. **Initialize Swarm Mail first** - Use `swarmmail_init` before any work
2. **Reserve files before editing** - Use `swarmmail_reserve` to claim files
3. **Respect reservations** - Don't edit files reserved by other agents
4. **Release when done** - Use `swarmmail_release` or let `swarm_complete` handle it
5. **Coordinate on shared files** - If you must edit a reserved file, send a message to the owning agent

```typescript
// Initialize first
await swarmmail_init({
  project_path: "$PWD",
  task_description: "Working on auth feature",
});

// Reserve files
await swarmmail_reserve({
  paths: ["src/auth/**"],
  reason: "bd-123: Auth implementation",
  ttl_seconds: 3600,
});

// Work...

// Release when done
await swarmmail_release();
```

## Communication Patterns

### Broadcasting Updates

```typescript
swarmmail_send({
  to: ["*"],
  subject: "API Complete",
  body: "Completed API endpoints, ready for frontend integration",
  thread_id: epic_id,
});
```

### Direct Coordination

```typescript
swarmmail_send({
  to: ["frontend-agent"],
  subject: "Auth API Spec",
  body: "Auth API is at /api/auth/*, here's the spec...",
  thread_id: epic_id,
});
```

### Checking for Messages

```typescript
// Check inbox (max 5, no bodies for context safety)
const inbox = await swarmmail_inbox();

// Read specific message body
const message = await swarmmail_read_message({ message_id: N });
```

### Reporting Blockers

```typescript
swarmmail_send({
  to: ["coordinator"],
  subject: "BLOCKED: Need DB schema",
  body: "Can't proceed without users table",
  thread_id: epic_id,
  importance: "urgent",
});
```

## Best Practices

1. **Initialize Swarm Mail first** - Always call `swarmmail_init` before any work
2. **Small, focused subtasks** - Each subtask should be completable in one agent session
3. **Clear boundaries** - Define exactly what files/modules each subtask touches
4. **Explicit handoffs** - When one task enables another, communicate clearly
5. **Graceful failures** - If a subtask fails, don't block the whole swarm
6. **Progress updates** - Use beads to track subtask status
7. **Load relevant skills** - Workers should call `skills_use()` based on their task type:
   - Testing work → `skills_use(name="testing-patterns")`
   - Architecture decisions → `skills_use(name="system-design")`
   - CLI development → `skills_use(name="cli-builder")`
   - Multi-agent coordination → `skills_use(name="swarm-coordination")`

## Common Patterns

### Feature Development

```yaml
decomposition:
  strategy: hybrid
  skills: [system-design, swarm-coordination]
  phases:
    - name: design
      parallel: true
      subtasks: [api-design, ui-design]
      recommended_skills: [system-design]
    - name: implement
      parallel: true
      subtasks: [backend, frontend]
      recommended_skills: [system-design]
    - name: validate
      parallel: true
      subtasks: [tests, docs, review]
      recommended_skills: [testing-patterns]
```

### Bug Fix Swarm

```yaml
decomposition:
  strategy: sequential
  skills: [testing-patterns]
  subtasks:
    - reproduce-bug
    - identify-root-cause
    - implement-fix
    - add-regression-test
  recommended_skills: [testing-patterns]
```

### Refactoring

```yaml
decomposition:
  strategy: parallel
  skills: [testing-patterns, system-design]
  subtasks:
    - refactor-module-a
    - refactor-module-b
    - update-imports
    - run-full-test-suite
  recommended_skills: [testing-patterns, system-design]
```

## Skill Integration Workflow

**For Coordinators:**

1. Initialize Swarm Mail with `swarmmail_init`
2. Load `swarm-coordination` skill
3. Analyze task type
4. Load additional skills based on domain (testing, design, CLI)
5. Include skill recommendations in `shared_context` for workers

**For Workers:**

1. Initialize Swarm Mail with `swarmmail_init`
2. Read `shared_context` from coordinator
3. Load recommended skills with `skills_use(name="skill-name")`
4. Apply skill knowledge to subtask
5. Report progress via `swarmmail_send`
6. Complete with `swarm_complete`

**Example shared_context:**

```markdown
## Context from Coordinator

Past similar tasks: [CASS results]
Project learnings: [semantic-memory results]

## Recommended Skills

- skills_use(name="testing-patterns") - for test creation
- skills_use(name="system-design") - for module boundaries

## Task-Specific Notes

[Domain knowledge from coordinator]
```

## Swarm Mail Quick Reference

| Tool                     | Purpose                             |
| ------------------------ | ----------------------------------- |
| `swarmmail_init`         | Initialize session (REQUIRED FIRST) |
| `swarmmail_send`         | Send message to agents              |
| `swarmmail_inbox`        | Check inbox (max 5, no bodies)      |
| `swarmmail_read_message` | Read specific message body          |
| `swarmmail_reserve`      | Reserve files for exclusive editing |
| `swarmmail_release`      | Release file reservations           |
| `swarmmail_ack`          | Acknowledge message                 |
| `swarmmail_health`       | Check database health               |
