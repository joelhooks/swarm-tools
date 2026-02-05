---
description: Properly end a swarm session - release reservations, sync state, generate continuation prompt
---

# /swarm:handoff

Wrap up a swarm session cleanly.

## Workflow
1. Summarize completed work and open blockers.
2. `hivemind_store()` to persist session learnings.
3. Agent team cleanup: if Teammate tool active, shutdown teammates before git sync.
4. Native task cleanup: mark remaining TaskList tasks completed/pending.
5. `swarmmail_release()` to free reservations (if any).
6. Update cells with `hive_update()` or `hive_close()`.
7. Use git commands directly to persist state (add, commit, push).
8. Provide a concise handoff note for the next session.

## Usage
`/swarm:handoff`
