---
"swarm-mail": minor
"opencode-swarm-plugin": patch
---

## 🐝 Worktree Support + Graceful Degradation

```
    ┌─────────────────────────────────────────────────────┐
    │                                                     │
    │   "It is impossible to reduce the probability       │
    │    of a fault to zero; therefore it is usually      │
    │    best to design fault-tolerance mechanisms        │
    │    that prevent faults from causing failures."      │
    │                                                     │
    │                    — Kleppmann, DDIA                │
    │                                                     │
    └─────────────────────────────────────────────────────┘
```

### Git Worktree Support (#52)

All worktrees now share the main repository's database. No more isolated state per worktree.

```
BEFORE:                          AFTER:
main-repo/.opencode/swarm.db     main-repo/.opencode/swarm.db
worktree-1/.opencode/swarm.db    worktree-1/ ──┐
worktree-2/.opencode/swarm.db    worktree-2/ ──┼─→ main-repo/.opencode/
                                 worktree-3/ ──┘
```

**How it works:**
- Detects worktrees by checking if `.git` is a file (not directory)
- Parses `gitdir:` path to resolve main repo location
- All DB operations automatically use main repo's `.opencode/`

### Graceful Degradation for semantic-memory (#53)

When Ollama is unavailable, `semantic-memory_find` now falls back to full-text search instead of erroring.

**Before:** `OllamaError: Connection failed` → tool fails
**After:** Warning logged → FTS results returned → tool works

Also added `repairStaleEmbeddings()` to fix the "dimensions are different: 0 != 1024" error when memories were stored without embeddings.

### New Skill: gh-issue-triage

Added `.opencode/skills/gh-issue-triage/` for GitHub issue triage workflow:
- Extracts contributor profiles including Twitter handles
- Templates for acknowledgment comments
- Changeset credit templates with @mentions

---

Thanks to [@justBCheung](https://x.com/justBCheung) for filing both issues with excellent debugging context. 🙏
