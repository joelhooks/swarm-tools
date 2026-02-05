---
"claude-code-swarm-plugin": minor
"opencode-swarm-plugin": patch
---

feat(plugin): upgrade for Claude Code 2.1.32 native integration

Add dual-mode architecture supporting both native agent teams and task
fallback. Plugin now complements rather than duplicates native features.

**claude-code-swarm-plugin:**
- agents: Add permissionMode, memory, disallowedTools, lifecycle hooks
- swarm.md: Full rewrite with environment detection, mode-aware protocols
- hooks: Add SubagentStart/Stop, TaskCreate/TaskUpdate tracking
- skills: Update for TaskCreate/TaskUpdate, TeammateTool awareness
- README: Add 2.1.32 integration docs, architecture diagram, comparison table

**opencode-swarm-plugin:**
- Fix test schema mismatch: add access_count, last_accessed, category, status
- Fix decay_factor default from 0.7 to 1.0 to match Drizzle schema
- Update column count assertions (14 → 18 columns)

Native teams provide: real-time messaging, planning mode, task UI
Plugin provides: git-backed persistence, semantic memory, file locking

> "Make the change easy, then make the easy change." — Kent Beck
