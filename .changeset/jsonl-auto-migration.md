---
"opencode-swarm-plugin": patch
"swarm-mail": patch
---

Add automatic JSONL migration for beads on first use

- Auto-migrate from `.beads/issues.jsonl` when database is empty
- Fix import to handle missing dependencies/labels/comments arrays
- Fix closed bead import to satisfy check constraint (status + closed_at)
- Migrates 500+ historical beads seamlessly on first adapter initialization
