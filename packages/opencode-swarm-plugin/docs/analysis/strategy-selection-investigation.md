# Strategy Selection Investigation

**Date:** 2025-12-31  
**Investigator:** CoolStorm  
**Cell:** opencode-swarm-monorepo-lf2p4u-mju6weg6h67

## Problem Statement

Analytics show extreme strategy imbalance:
- feature-based: 140 (97%)
- file-based: 4 (3%)
- risk-based: 0 (0%)

Goal: Achieve more balanced distribution (60% feature, 30% file, 10% risk)

## Investigation Summary

### Current Implementation

The strategy selection system has THREE components:

1. **`swarm_select_strategy`** (swarm-strategies.ts:253-437)
   - Analyzes task description via keyword matching
   - Returns strategy recommendation with confidence score
   - Supports precedent-aware selection with past success rates

2. **`CellTreeSchema`** (schemas/cell.ts)
   - Defines coordinator decomposition output format
   - Contains ONLY: `epic` (title, description) and `subtasks` array
   - **MISSING: strategy field**

3. **`hive_create_epic`** (hive.ts:689-920)
   - Accepts optional `strategy` parameter
   - **Defaults to "feature-based" if not provided** (line 798)
   - Emits `decomposition_generated` event with strategy

### Root Cause

**The strategy recommendation is NEVER passed to cell creation.**

Flow breakdown:
```
┌─────────────────────────────────────────────────────────────────┐
│ 1. swarm_select_strategy(task)                                  │
│    ✅ Correctly analyzes "Fix test failures" → risk-based       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Coordinator generates CellTree JSON                          │
│    {                                                             │
│      epic: { title, description },                              │
│      subtasks: [...]                                            │
│      // ❌ NO strategy field - recommendation lost              │
│    }                                                             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. hive_create_epic(...subtasks)                                │
│    ❌ No strategy argument passed                               │
│    ✅ Defaults to "feature-based" (line 798)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Evidence

**Test Case: "Fix 39 test failures - mock pollution and isolation issues"**

Keyword analysis:
```javascript
{
  'file-based': 0,    // no matches
  'feature-based': 0, // no matches  
  'risk-based': 1     // matched "fix"
}
// Winner: risk-based (correct)
```

Database record:
```json
{
  "task": "Fix 39 test failures - mock pollution and isolation issues",
  "strategy": "feature-based"  // ❌ WRONG - should be risk-based
}
```

**Test Case: "Refactor build script to scripts/build.ts"**

Keyword analysis:
```javascript
{
  'file-based': 1,    // matched "refactor"
  'feature-based': 1, // matched "build"
  'risk-based': 0
}
// Winner: file-based (first in sort order for ties)
```

Database record:
```json
{
  "strategy": "feature-based"  // ❌ WRONG - tie should go to file-based
}
```

### Keyword Analysis

Current keyword mappings are WELL-TUNED:

**file-based keywords:**
- refactor, migrate, update all, rename, replace, convert, upgrade, deprecate, remove, cleanup, lint, format

**feature-based keywords:**
- add, implement, build, create, feature, new, integrate, connect, enable, support

**risk-based keywords:**
- fix, bug, security, vulnerability, critical, urgent, hotfix, patch, audit, review

**research-based keywords:**
- research, investigate, explore, find out, discover, understand, learn about, analyze, compare, evaluate, etc.

The algorithm uses:
- Word boundary regex for single-word keywords (prevents "debug" matching "bug")
- Simple string inclusion for multi-word phrases ("update all", "find out")
- Score-based selection with confidence based on margin

**The keyword matching logic is NOT the problem.**

## Proposed Fix

### 1. Add `strategy` to CellTreeSchema

```typescript
// schemas/cell.ts
export const CellTreeSchema = z.object({
  epic: z.object({
    title: z.string().min(1),
    description: z.string().optional().default(""),
  }),
  subtasks: z.array(SubtaskSpecSchema).min(1),
  strategy: z.enum(["file-based", "feature-based", "risk-based", "research-based"])
    .optional()
    .describe("Decomposition strategy (from swarm_select_strategy)"),
});
```

### 2. Update coordinator prompt

Add instruction to include strategy in decomposition:

```markdown
### Phase 3: Decompose
\`\`\`
const strategyResult = swarm_select_strategy(task="<task>");
swarm_plan_prompt(task="<task>", context="<synthesized knowledge>");
// Respond with CellTree JSON including strategy from strategyResult
{
  epic: { title, description },
  subtasks: [...],
  strategy: strategyResult.strategy  // ✅ Pass it through
}
\`\`\`
```

### 3. Update `hive_create_epic` to accept strategy from CellTree

Current:
```typescript
strategy: args.strategy || "feature-based",
```

After:
```typescript
// Validate strategy parameter exists in args
// (swarm_validate_decomposition will enforce this)
strategy: args.strategy || "feature-based",
```

### 4. Update `swarm_validate_decomposition`

Add validation that strategy field is present and valid when creating from decomposition:

```typescript
// Already validates CellTreeSchema structure
// Add check that strategy matches recommended strategy if precedent suggests conflict
```

## Success Metrics

After fix, verify:

1. **Unit tests pass:**
   - `swarm_select_strategy("Fix bug")` → risk-based
   - `swarm_select_strategy("Refactor components")` → file-based
   - `swarm_select_strategy("Add feature")` → feature-based

2. **Integration test:**
   - Full flow: select → decompose → create_epic
   - Strategy preserved end-to-end

3. **Analytics show distribution shift:**
   - Target: 60% feature, 30% file, 10% risk
   - Measured via: `strategySuccessRates()` query

## Testing Strategy (TDD)

### RED: Characterization Tests (Document Current Broken Behavior)

```typescript
test("swarm_select_strategy correctly identifies risk-based task", () => {
  const result = await swarm_select_strategy.execute({
    task: "Fix authentication bypass vulnerability"
  });
  const parsed = JSON.parse(result);
  expect(parsed.strategy).toBe("risk-based");  // ✅ This passes
});

test("CellTreeSchema does NOT include strategy field", () => {
  const schema = CellTreeSchema.shape;
  expect(schema.strategy).toBeUndefined();  // ✅ Current behavior (WRONG)
});

test("hive_create_epic defaults to feature-based when strategy omitted", () => {
  const result = await hive_create_epic.execute({
    epic_title: "Fix critical bug",
    subtasks: [{ title: "Write test", files: [] }]
    // strategy NOT provided
  });
  
  // Check emitted event
  const events = await queryEvents({ types: ["decomposition_generated"] });
  const event = events.find(e => e.epic_id === result.epic.id);
  expect(event.strategy).toBe("feature-based");  // ✅ Current behavior (WRONG)
});
```

### GREEN: Minimal Fix

1. Add `strategy` field to CellTreeSchema
2. Update coordinator prompt template
3. Verify end-to-end flow

### REFACTOR: Polish

1. Add validation for strategy consistency
2. Add precedent-aware confidence adjustment
3. Document new flow in architecture docs

## Deliverables

- [x] Analysis document (this file)
- [ ] Tuned keyword mappings (NOT NEEDED - keywords are good)
- [ ] Tests for strategy selection edge cases
- [ ] Schema update (CellTreeSchema + strategy field)
- [ ] Coordinator prompt update
- [ ] End-to-end integration test

## Timeline

- Investigation: 45 min (COMPLETE)
- Characterization tests: 15 min
- Fix implementation: 20 min
- Integration test: 15 min
- Verification: 10 min

**Total ETA:** 1h 45min (60% complete)
