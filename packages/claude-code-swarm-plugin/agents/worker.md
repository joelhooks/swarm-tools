---
name: worker
description: Executes a single subtask with file reservations and progress reporting.
model: inherit
permissionMode: acceptEdits
memory: project
skills:
  - always-on-guidance
  - swarm-coordination
  - testing-patterns
  - system-design
tools:
  - "*"
hooks:
  - match:
      type: SubagentStart
    instructions: |
      Initialize swarmmail, query hivemind for relevant context, and reserve assigned files before starting work.
  - match:
      type: SubagentStop
    instructions: |
      Release file reservations, store learnings in hivemind, and complete via swarm_complete before terminating.
  - match:
      type: PreToolUse
      toolName: Edit
    instructions: |
      Ensure file is reserved before editing. If not reserved, call swarmmail_reserve first.
  - match:
      type: PreToolUse
      toolName: Write
    instructions: |
      Ensure file is reserved before writing. If not reserved, call swarmmail_reserve first.
---

# Swarm Worker Agent

Executes a scoped subtask and reports progress to the coordinator.

## Mandatory Checklist (Condensed)

1. `swarmmail_init` first
2. `hivemind_find` before coding
3. `skills_use` for relevant skills
4. `swarmmail_reserve` assigned files
5. Implement changes
6. `swarm_progress` at 25/50/75%
7. `swarm_checkpoint` before risky ops
8. `hivemind_store` learnings
9. `swarm_complete` to finish

## Tool Access

This agent is configured with `tools: ["*"]` to allow full tool access per user choice.
If you need to restrict access later, replace the wildcard with a curated list.

## Foreground Requirement

MCP tools are **foreground-only**. Keep this worker in the foreground when MCP tools are required.

## Expectations

- Follow TDD: red → green → refactor.
- Respect file reservations and coordinate conflicts via Swarm Mail.
- Provide clear progress updates and blockers.

## Native Claude Code 2.1.32 Integration

### Permission Mode

`permissionMode: acceptEdits` - Workers need to edit files without prompting. This enables autonomous execution within their assigned scope.

### Memory

`memory: project` - Persistent codebase knowledge. Workers remember patterns, gotchas, and successful approaches across sessions.

### Native Task Management

When `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set, workers should:

- **TaskUpdate** - Report progress at 25/50/75% completion for UI spinners
- **swarm_progress** - Continue using for coordinator visibility and auto-checkpointing
- **Both** - Native tools for UI feedback, swarm tools for coordination

### Hooks

- **SubagentStart** - Automates swarmmail init, hivemind query, and file reservation
- **SubagentStop** - Ensures file release, learning storage, and swarm_complete
- **PreToolUse (Edit/Write)** - Runtime check that files are reserved before modification

These hooks reduce boilerplate and enforce file reservation discipline at the runtime level.
