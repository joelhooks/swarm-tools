# Drizzle Migration Status

## Epic: opencode-swarm-monorepo-lf2p4u-mjf9zd9kgo7
## Branch: feat/drizzle-migration-and-tests
## Last Updated: 2024-12-20

---

# COMPREHENSIVE PLAN

## Current State Summary

| Subsystem | Drizzle Status | Notes |
|-----------|---------------|-------|
| **Streams** | ✅ DONE | Wrappers added, exports updated |
| **Memory** | ✅ DONE | Already uses Drizzle (raw SQL only for vector/FTS5) |
| **Hive** | ❌ NOT STARTED | Still uses DatabaseAdapter (raw SQL) |

## Test Status

- **swarm-mail**: 595 pass, 15 skip, 0 fail ✅
- **opencode-swarm-plugin**: 423 pass, 0 fail ✅
- **Integration tests**: 440 pass, 18 skip, 6 fail ⚠️

### Failing Tests (6)
1. `agentmail_release` - reservation release count assertions (3 tests)
2. `swarm_checkpoint` - DatabaseAdapter missing getClient() method (2 tests)
3. Other checkpoint-related test

---

## Remaining Work

### Phase 1: Fix Failing Tests (BLOCKING)
**Priority: P0 - Must fix before proceeding**

1. **agentmail_release tests** - Reservation release logic returning wrong counts
2. **swarm_checkpoint tests** - Need LibSQLAdapter, not generic DatabaseAdapter

### Phase 2: Hive Drizzle Conversion (MAIN WORK)
**Priority: P1 - Core migration work**

Files to convert (in order):
1. `hive/store.ts` - Event store operations
2. `hive/projections.ts` - Query projections  
3. `hive/queries.ts` - Complex queries
4. `hive/comments.ts` - Comment operations
5. `hive/labels.ts` - Label operations
6. `hive/dependencies.ts` - Dependency tracking

**Approach:**
- Follow streams pattern: create Drizzle functions, add wrappers for backward compat
- Use `toSwarmDb()` to convert DatabaseAdapter → SwarmDb
- Keep complex CTEs as raw SQL if Drizzle can't express them

### Phase 3: Remove Duplicate Schemas
**Priority: P2 - Cleanup**

Duplicate schema files to consolidate:
- `memory/libsql-schema.ts` (194 lines) → merge into `db/schema/memory.ts`
- `streams/libsql-schema.ts` (306 lines) → merge into `db/schema/streams.ts`

**Note:** These files contain DDL for FTS5 and vector indexes that Drizzle can't create. Keep the DDL functions, remove duplicate table definitions.

### Phase 4: Integration Test Coverage
**Priority: P3 - Quality**

Current: 440 tests for ~92 tools
Target: Happy-path coverage for all tools

Tools needing tests:
- Review existing coverage
- Add missing tool tests
- Focus on tools that touch database

---

## Blocked Work (from previous session)

### Type Error Fixes (COMPLETED)
These were fixed in previous sessions:
- ✅ Message importance nullability
- ✅ Boolean storage
- ✅ Dynamic query builders
- ✅ Drizzle schema property names

---

## Commands

```bash
# Run all tests
bun turbo test

# Run specific subsystem
bun test packages/swarm-mail/src/hive/
bun test packages/swarm-mail/src/streams/
bun test packages/swarm-mail/src/memory/

# Run integration tests
bun test packages/opencode-swarm-plugin/src/*.integration.test.ts

# Typecheck
bun turbo typecheck
```

---

# Historical Notes (Previous Session)

## Completed Fixes

### 1. Message Importance Nullability (✅ DONE)
**Files:** `packages/swarm-mail/src/streams/projections-drizzle.ts`

**Issue:** Schema allows `null` for `importance`, but Message type expects `string`.

**Fix:** Added nullish coalescing to default to "normal":
```typescript
importance: row.importance ?? "normal"
```

**Locations:**
- Line 197 (getInboxDrizzle)
- Line 233 (getMessageDrizzle)
- Line 264 (getThreadMessagesDrizzle)

### 2. Boolean Storage (✅ DONE)
**Files:** `packages/swarm-mail/src/streams/store-drizzle.ts`

**Issue:** Schema uses `integer({ mode: "boolean" })` but code was manually converting to 1/0.

**Fix:** Pass booleans directly, let Drizzle handle conversion:
```typescript
// BEFORE
ack_required: event.ack_required ? 1 : 0

// AFTER  
ack_required: event.ack_required
```

**Locations:**
- Line 322 (handleMessageSentDrizzle)
- Line 373 (handleFileReservedDrizzle) 
- Lines 476-477 (handleHumanFeedbackDrizzle)

### 3. Dynamic Query Builders (✅ DONE)
**Files:**
- `packages/swarm-mail/src/streams/store-drizzle.ts`
- `packages/swarm-mail/src/streams/projections-drizzle.ts`

**Issue:** TypeScript doesn't narrow query builder type when limit/offset are conditionally applied.

**Fix:** Added `.$dynamic()` to enable type-safe conditional chaining:
```typescript
let query = db.select().from(table).$dynamic();
if (options?.limit) query = query.limit(options.limit);
```

**Locations:**
- store-drizzle.ts line 120
- projections-drizzle.ts line 443

### 4. Drizzle Schema Property Names (✅ DONE)
**File:** `packages/swarm-mail/src/db/schema/hive.ts`

**Issue:** Schema used camelCase TypeScript properties (e.g., `projectKey`) but Cell interface expects snake_case.

**Fix:** Changed all property names to snake_case to match interface:
```typescript
// BEFORE
projectKey: text("project_key").notNull()

// AFTER
project_key: text("project_key").notNull()
```

**Affected tables:**
- beads (16 properties)
- cellEvents (5 properties)
- beadLabels (3 properties)
- beadComments (7 properties)
- beadDependencies (5 properties)
- blockedBeadsCache (3 properties)
- dirtyBeads (2 properties)
- schemaVersion (2 properties)

## Remaining Fixes (BLOCKED - Need File Access)

### 5. Update Query Code to Use Snake_Case (❌ BLOCKED)
**Files:** 
- `packages/swarm-mail/src/hive/projections.ts` (reserved by SilverDusk)
- `packages/swarm-mail/src/hive/queries.ts` (reserved by SilverDusk)

**Issue:** Code still references old camelCase properties after schema update.

**Fix:** Mechanical find-replace:
```
beads.projectKey → beads.project_key
beads.parentId → beads.parent_id
beads.createdAt → beads.created_at
beads.updatedAt → beads.updated_at
beads.deletedAt → beads.deleted_at
beads.closedAt → beads.closed_at
beadDependencies.cellId → beadDependencies.cell_id
beadDependencies.dependsOnId → beadDependencies.depends_on_id
beadLabels.cellId → beadLabels.cell_id
beadComments.cellId → beadComments.cell_id
beadComments.parentId → beadComments.parent_id
beadComments.updatedAt → beadComments.updated_at
```

Also add `.$dynamic()` to queries with conditional limit/offset (projections.ts lines 465-477).

### 6. Remove Duplicate Export (❌ BLOCKED)
**File:** `packages/swarm-mail/src/streams/index.ts` (reserved by SwiftMoon)

**Issue:** Both `projections.ts` and `projections-drizzle.ts` export types with same names (Agent, Message, etc.).

**Fix:** Remove line 597:
```typescript
// DELETE THIS LINE
export * from "./projections-drizzle";
```

The Drizzle implementations are internal - only PGlite projections should be re-exported.

## Verification

After completing remaining fixes, run:
```bash
bun turbo typecheck --filter=swarm-mail
```

Expected: 0 errors

## Memory Subsystem Status (✅ COMPLETE)

**Agent:** WildCloud  
**Cell:** opencode-swarm-monorepo-lf2p4u-mjf9zd9uul8  
**Date:** December 19, 2024

### Audit Results

✅ **Memory subsystem is FULLY Drizzle-converted where technically possible.**

All remaining raw SQL is **REQUIRED** for libSQL-specific features not supported by Drizzle ORM.

### Files Using Drizzle ORM
1. ✅ `store.ts` - Uses Drizzle for all standard queries (select, insert, update, delete)
2. ✅ `adapter.ts` - Pure Drizzle (lines 331-334 for validate operation)
3. ✅ `db/schema/memory.ts` - Drizzle schema definitions (matches libsql-schema.ts)

### Files Using Required Raw SQL
1. ✅ `libsql-schema.ts` - DDL for FTS5 + vector indexes (Drizzle can't create these)
2. ✅ `store.ts` - Vector search + FTS5 queries (Drizzle doesn't support these operations)
3. ✅ `migrate-legacy.ts` - PGlite API + DatabaseAdapter (correct abstraction)
4. ✅ `sync.ts` - DatabaseAdapter (portable abstraction layer)

### Raw SQL That MUST Stay

**libSQL Vector Operations:**
- `vector()` function calls (convert JSON array to F32_BLOB)
- `vector_distance_cos()` (cosine similarity)
- `vector_top_k()` (ANN search)
- Vector indexes: `libsql_vector_idx()` function

**FTS5 Full-Text Search:**
- `CREATE VIRTUAL TABLE ... USING fts5()`
- `CREATE TRIGGER` for FTS5 auto-sync
- `WHERE content MATCH $query` (MATCH operator)
- `fts.rank` for relevance scoring

**DatabaseAdapter Abstraction:**
- Portable queries between PGlite and libSQL
- Migration tooling
- JSONL sync operations

### Test Results
- Memory subsystem: 116 pass, 1 skip, 0 fail
- Plugin integration: 7 pass, 0 fail

### Documentation
See `packages/swarm-mail/MEMORY-DRIZZLE-AUDIT.md` for detailed audit report.

## Notes

- SilverDusk and SwiftMoon agents appear to be orphaned (no active processes found)
- Reservations can be force-released to unblock
- All remaining work is mechanical find-replace (est. 10 minutes)
