---
description: Check swarm coordination status - workers, messages, reservations
---

# /swarm:status

Summarize active swarm state.

## Workflow
1. `swarm_status({ epic_id, project_key })` for progress and workers.
2. `swarmmail_inbox()` to surface new messages.
3. `hive_query({ status: "in_progress" })` for active cells.
4. `TaskList()` for native task UI view (if agent teams active).

## Usage
`/swarm:status`
