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
  - agentmail_init
  - agentmail_send
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

```
Parent Task: "Add user authentication"
├── Subtask 1: "Create auth API endpoints" (backend)
├── Subtask 2: "Build login/signup forms" (frontend)
├── Subtask 3: "Write auth integration tests" (testing)
└── Subtask 4: "Add auth documentation" (docs)
```

**Sequential Strategy** - When order matters:

```
Parent Task: "Migrate database schema"
├── Step 1: "Create migration files"
├── Step 2: "Update model definitions"
├── Step 3: "Run migrations"
└── Step 4: "Verify data integrity"
```

**Hybrid Strategy** - Mixed dependencies:

```
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

1. **Reserve files before editing** - Use `agentmail_reserve` to claim files
2. **Respect reservations** - Don't edit files reserved by other agents
3. **Release when done** - Files auto-release on task completion
4. **Coordinate on shared files** - If you must edit a reserved file, send a message to the owning agent

## Communication Patterns

### Broadcasting Updates

```
agentmail_send(recipients: ["all"], message: "Completed API endpoints, ready for frontend integration")
```

### Direct Coordination

```
agentmail_send(recipients: ["frontend-agent"], message: "Auth API is at /api/auth/*, here's the spec...")
```

### Blocking on Dependencies

```
# Wait for a dependency before proceeding
agentmail_receive(wait: true, filter: "api-complete")
```

## Best Practices

1. **Small, focused subtasks** - Each subtask should be completable in one agent session
2. **Clear boundaries** - Define exactly what files/modules each subtask touches
3. **Explicit handoffs** - When one task enables another, communicate clearly
4. **Graceful failures** - If a subtask fail, don't block the whole swarm
5. **Progress updates** - Use beads to track subtask status
6. **Load relevant skills** - Workers should call `skills_use()` based on their task type:
   - Testing work → `skills_use(name="testing-patterns")`
   - Architecture decisions → `skills_use(name="system-design")`
   - CLI development → `skills_use(name="cli-builder")`
   - Multi-agent coordination → `skills_use(name="swarm-coordination")`

## Common Patterns

### Feature Development

```yaml
decomposition:
  strategy: hybrid
  skills: [system-design, swarm-coordination] # Load before decomposing
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
  skills: [testing-patterns] # Load before decomposing
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
  skills: [testing-patterns, system-design] # Load before decomposing
  subtasks:
    - refactor-module-a
    - refactor-module-b
    - update-imports
    - run-full-test-suite
  recommended_skills: [testing-patterns, system-design]
```

## Skill Integration Workflow

**For Coordinators:**

1. Load `swarm-coordination` skill first
2. Analyze task type
3. Load additional skills based on domain (testing, design, CLI)
4. Include skill recommendations in `shared_context` for workers

**For Workers:**

1. Read `shared_context` from coordinator
2. Load recommended skills with `skills_use(name="skill-name")`
3. Apply skill knowledge to subtask
4. Report completion

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

### Bug Fix Swarm

```yaml
decomposition:
  strategy: sequential
  subtasks:
    - reproduce-bug
    - identify-root-cause
    - implement-fix
    - add-regression-test
```

### Refactoring

```yaml
decomposition:
  strategy: parallel
  subtasks:
    - refactor-module-a
    - refactor-module-b
    - update-imports
    - run-full-test-suite
```
