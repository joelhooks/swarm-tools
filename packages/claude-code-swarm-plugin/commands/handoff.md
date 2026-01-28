---
description: Properly end a swarm session - release reservations, sync state, generate continuation prompt
---

# /swarm:handoff

Wrap up a swarm session cleanly.

## Workflow
1. Summarize completed work and open blockers.
2. `swarmmail_release()` to free reservations (if any).
3. Update cells with `hive_update()` or `hive_close()`.
4. Use git commands directly to persist state (add, commit, push).
5. Provide a concise handoff note for the next session.

## Usage
`/swarm:handoff`
