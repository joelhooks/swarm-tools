---
"opencode-swarm-plugin": minor
---

## 🔍 Coordinator Review Gate + UBS Removal

> *"Code review is not about catching bugs. It's about sharing knowledge."*  
> — Someone who clearly never reviewed my PRs

Two changes that make swarm coordination tighter:

### Coordinator Review Tools

New tools for coordinators to review worker output before approval:

```
┌─────────────────────────────────────────────────────┐
│              COORDINATOR REVIEW FLOW                │
├─────────────────────────────────────────────────────┤
│  1. Worker completes → sends completion message     │
│  2. Coordinator: swarm_review(task_id, files)       │
│     → Gets diff + epic context + review prompt      │
│  3. Coordinator reviews against epic goals          │
│  4. swarm_review_feedback(status, issues)           │
│     → approved: worker can finalize                 │
│     → needs_changes: worker gets feedback           │
│  5. 3-strike rule: 3 rejections = blocked           │
└─────────────────────────────────────────────────────┘
```

**New tools:**
- `swarm_review` - Generate review prompt with epic context + git diff
- `swarm_review_feedback` - Send approval/rejection with structured issues

**Updated prompts:**
- Coordinator prompt now includes review checklist
- Worker prompt explains the review gate
- Skills updated with review patterns

### UBS Scan Removed from swarm_complete

The `skip_ubs_scan` parameter is gone. UBS was already disabled in v0.31 for performance - this cleans up the vestigial code.

**Removed:**
- `skip_ubs_scan` parameter from schema
- `ubs_scan` deprecation object from output
- All UBS-related helper functions
- ~100 lines of dead code

**If you need UBS scanning:** Run it manually before commit:
```bash
ubs scan src/
```

### CLI Improvements

The `swarm` CLI got smarter:
- Better error messages for missing dependencies
- Cleaner output formatting
- Improved help text
