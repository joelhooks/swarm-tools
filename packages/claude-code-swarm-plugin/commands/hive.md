---
description: Query and manage swarm tasks (cells)
---

# /swarm:hive

Manage Hive cells with the `hive_*` tools (no deprecated CLI references).

Hive cells are git-backed persistent truth. Native TaskCreate/TaskList provide real-time UI visibility for the same work.

## Native integration
- Hive cells = persistent, git-synced, survives session compaction
- Native tasks (TaskCreate/TaskList) = ephemeral, UI-visible, session-scoped
- Use both: hive for long-term tracking, native tasks for real-time UI feedback

## Common actions
- List ready work: `hive_ready()`
- Query by status: `hive_query({ status: "open" })`
- Create a task: `hive_create({ title, type, priority })`
- Update status/description: `hive_update(id, { status, description })`
- Close a cell: `hive_close(id, "Done")`

## Usage
- `/swarm:hive`
- `/swarm:hive create "Fix auth bug"`
- `/swarm:hive close <cell-id> "Done"`
