# Swarm Context - Beads→Hive Rename

## Session State (SAVE THIS)

### Branch
`swarm/beads-to-hive-rename` - pushed to origin

### Epic
Rename beads → hive + add hive prime command

### Completed Work

**Wave 1 (swarm-mail) - DONE:**
- ✅ Directory renamed: `src/beads/` → `src/hive/`
- ✅ Types renamed: `BeadEvent` → `CellEvent`, `Bead` → `Cell`, etc.
- ✅ Adapter renamed: `BeadsAdapter` → `HiveAdapter`
- ✅ Type file renamed: `types/beads-adapter.ts` → `types/hive-adapter.ts`
- ✅ Index exports updated: `export * from "./hive"`
- ✅ Typecheck passes: 0 errors

**Wave 2 (opencode-swarm-plugin) - DONE:**
- ✅ Renamed `src/beads.ts` → `src/hive.ts` with Cell naming
- ✅ Renamed `schemas/bead.ts` → `schemas/cell.ts` with backward compat aliases
- ✅ Renamed `schemas/bead-events.ts` → `schemas/cell-events.ts` with backward compat aliases
- ✅ Updated `schemas/index.ts` to export both Cell* and Bead* names
- ✅ Updated `tool-availability.ts` to add "hive" tool check
- ✅ Updated `index.ts` imports/exports for hive module
- ✅ Updated `swarm-prompts.ts` to use hive/cell terminology
- ✅ Updated `swarm-orchestrate.ts` to use hive/cell terminology
- ✅ Renamed test files and updated content
- ✅ All 407 tests pass
- ✅ Typecheck passes: 0 errors

**NOT YET COMMITTED** - all changes are staged/unstaged

### Remaining Work

**Wave 3 (docs) - NOT STARTED:**
- [ ] Update READMEs (root, swarm-mail, plugin)
- [ ] Update docs site content
- [ ] Update global-skills
- [ ] Update example commands

**Wave 4 (hive prime) - NOT STARTED:**
- [ ] Add `hive prime` command to CLI
- [ ] Create prompt template (inspired by hmans/beans)

**Wave 5 (verification) - NOT STARTED:**
- [ ] Run full test suite across all packages
- [ ] Create changeset for breaking change

### Critical Bugs Found (from earlier session)

1. **PGLite corruption** (bd-lf2p4u-mja7tjentkc) - P0
   - Multiple swarm agents corrupt shared PGLite database
   - Solution: Implement leader election pattern from PGLite docs
   - Reference: https://pglite.dev/docs/multi-tab-worker

2. **Coordinator reserved worker files** (bd-lf2p4u-mja6znqip16) - P0
   - Coordinator should NEVER reserve files for workers
   - Workers reserve their own files
   - Fixed in swarm.md command template

### Key Files Changed (uncommitted)

**swarm-mail package:**
```
D packages/swarm-mail/src/beads/* (deleted)
A packages/swarm-mail/src/hive/* (added)
D packages/swarm-mail/src/types/beads-adapter.ts
A packages/swarm-mail/src/types/hive-adapter.ts
M packages/swarm-mail/src/index.ts
```

**opencode-swarm-plugin package:**
```
D packages/opencode-swarm-plugin/src/beads.ts
A packages/opencode-swarm-plugin/src/hive.ts
D packages/opencode-swarm-plugin/src/beads.integration.test.ts
A packages/opencode-swarm-plugin/src/hive.integration.test.ts
D packages/opencode-swarm-plugin/src/schemas/bead.ts
A packages/opencode-swarm-plugin/src/schemas/cell.ts
D packages/opencode-swarm-plugin/src/schemas/bead-events.ts
A packages/opencode-swarm-plugin/src/schemas/cell-events.ts
D packages/opencode-swarm-plugin/src/schemas/bead-events.test.ts
A packages/opencode-swarm-plugin/src/schemas/cell-events.test.ts
M packages/opencode-swarm-plugin/src/schemas/index.ts
M packages/opencode-swarm-plugin/src/index.ts
M packages/opencode-swarm-plugin/src/tool-availability.ts
M packages/opencode-swarm-plugin/src/swarm-prompts.ts
M packages/opencode-swarm-plugin/src/swarm-orchestrate.ts
```

**Other:**
```
M AGENTS.md (added Hive naming convention, TDD prime directive)
M packages/opencode-swarm-plugin/examples/commands/swarm.md
```

### The Hive Metaphor (from AGENTS.md)
| Concept | Name | Metaphor |
|---------|------|----------|
| Work items | **Hive** | Honeycomb cells where work lives |
| Individual work item | **Cell** | Single unit of work |
| Agent coordination | **Swarm** | Bees working together |
| Inter-agent messaging | **Swarm Mail** | Bees communicating |
| Parallel workers | **Workers** | Worker bees |
| File locks | **Reservations** | Bees claiming cells |

### Backward Compatibility

All old names are exported as deprecated aliases:
- `beads_*` tools → aliases to `hive_*` tools
- `BeadSchema` → alias to `CellSchema`
- `BeadError` → alias to `HiveError`
- `BeadsAdapter` → alias to `HiveAdapter`
- etc.

Existing code using the old names will continue to work.

### Commands to Resume
```bash
# Check status
git status

# Verify typecheck
bun turbo typecheck

# Run tests
bun turbo test

# Continue with Wave 3 (docs)
```
