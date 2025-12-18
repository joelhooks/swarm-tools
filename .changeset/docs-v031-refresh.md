---
"@swarmtools/web": patch
---

## 📚 Documentation Refresh for v0.31

> *"People are often afraid to rename things, feeling that it's not worth the effort, but a good name can save hours of puzzled incomprehension in the future."*
> — Martin Fowler, *Refactoring*

The hive has new signage. Everything that was "beads" is now "hive" — because bees live in hives, not bead jars.

### What Changed

**Terminology Migration:**
- `beads_*` tools → `hive_*` tools throughout all docs
- "bead/beads" → "cell/cells" (work items in the hive)
- `.beads/` → `.hive/` directory references
- `beads.mdx` → `hive.mdx` (file renamed)

**Homepage Rewrite:**
- Deleted marketing fluff ("The Problem", "What if...", feature cards)
- Replaced with **comprehensive quickstart** that assumes you're already in OpenCode
- Install → Basic Usage → What Happens → Key Commands → Doc Links
- Get to `/swarm "your task"` in 30 seconds, not 3 scrolls

**New Documentation:**
- Worker Handoff Protocol section in swarm.mdx
- TDD Mandate section (Red → Green → Refactor)
- Updated all tool references and examples

**Removed:**
- All `bd` CLI references (it's gone, use `hive_*` tools)
- Backward compatibility cruft from pre-event-sourcing era

### Files Touched
- `apps/web/app/page.tsx` - Homepage quickstart rewrite
- `apps/web/content/docs/getting-started/quickstart.mdx` - Terminology update
- `apps/web/content/docs/index.mdx` - Navigation links fixed
- `apps/web/content/docs/packages/opencode-plugin/hive.mdx` - Renamed from beads.mdx
- `apps/web/content/docs/packages/opencode-plugin/swarm.mdx` - New sections added
