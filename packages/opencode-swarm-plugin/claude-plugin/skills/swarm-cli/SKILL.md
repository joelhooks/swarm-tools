---
name: swarm-cli
description: Swarm CLI commands for workers - hivemind memory, hive tasks, swarmmail coordination. Load this skill when working in a swarm context.
allowed-tools: Bash(swarm *)
---

# Swarm CLI Quick Reference

## Memory (Hivemind)

```bash
swarm memory find "query"           # Semantic search for learnings
swarm memory find "query" --fts     # Full-text search fallback
swarm memory store "info" --tags x  # Store a learning
swarm memory get <id>               # Get specific memory
swarm memory stats                  # Check memory health
```

**When to query:**
- BEFORE starting any task - check for existing solutions
- When stuck - search for similar problems
- Before major decisions - find past rationale

**When to store:**
- Solved a tricky bug (>15min debugging)
- Found a project-specific pattern
- Discovered a tool/library gotcha
- Made an architectural decision

## Task Tracking (Hive)

```bash
swarm hive ready                    # Get next unblocked task
swarm hive query --status open      # List open tasks
swarm hive create "title" --type bug --priority 1
swarm hive update <id> --status in_progress
swarm hive close <id> "summary"     # Close completed task
swarm tree                          # Visualize task hierarchy
```

## Coordination (Swarm Mail)

```bash
swarm mail inbox                    # Check for messages
swarm mail send "coordinator" "Subject" "Body"
swarm mail reserve file.ts          # Reserve file for editing
swarm mail release                  # Release all reservations
```

## Progress & Checkpoints

```bash
swarm progress 50 "message"         # Report 50% progress
swarm checkpoint                    # Save context before risky ops
swarm complete "summary"            # Mark task done (releases locks)
```

## Analytics

```bash
swarm compliance                    # Check tool usage stats
swarm history                       # Recent swarm activity
swarm dashboard                     # Live worker status UI
```

## Core Workflow

1. `swarm memory find "<task keywords>"` - Check for existing solutions
2. `swarm hive ready` - Get your task
3. `swarm mail reserve <files>` - Lock your files
4. Do the work (TDD: red → green → refactor)
5. `swarm progress 50 "message"` - Report milestones
6. `swarm memory store "learning" --tags "domain"` - Store discoveries
7. `swarm complete "summary"` - Finish and release locks

## Tips

- **Query before coding** - 90% of problems have been solved before
- **Store actionable learnings** - Include WHY, not just WHAT
- **Reserve files early** - Prevents edit conflicts with other workers
- **Report progress** - Silent workers look stuck
- **Checkpoint before risky ops** - Saves context for recovery
