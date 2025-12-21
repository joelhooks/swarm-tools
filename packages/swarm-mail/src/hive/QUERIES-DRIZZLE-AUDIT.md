# Hive Queries Drizzle Migration Audit

## Summary

Pragmatic migration of `hive/queries.ts` to Drizzle ORM. **Simple CRUD queries migrated to Drizzle, complex queries kept as raw SQL.**

**Result:** 3 functions migrated, 3 functions kept as raw SQL. All 36 tests passing.

## Migration Decisions

### ✅ Migrated to Drizzle

| Function | Complexity | Why Drizzle Works |
|----------|-----------|-------------------|
| `resolvePartialId` | Simple | Single SELECT with LIKE pattern, no joins |
| `getStaleIssues` | Simple | SELECT with WHERE + timestamp comparison, ORDER BY, LIMIT |
| `getStatistics` (partial) | Mixed | Status/type counts use Drizzle, blocked/ready counts use raw SQL |

### ❌ Kept as Raw SQL

| Function | Complexity | Why Raw SQL Better |
|----------|-----------|-------------------|
| `getReadyWork` | High | Dynamic WHERE building, EXISTS subquery on cache table, complex CASE sorting, label filtering |
| `getBlockedIssues` | Medium | JOIN with blocked_beads_cache, JSON parsing (SQLite doesn't have arrays) |
| `getEpicsEligibleForClosure` | Medium | Self-JOIN, GROUP BY + HAVING, conditional COUNT with CASE |

## Decision Framework

**Convert to Drizzle if:**
- Simple SELECT with WHERE, ORDER BY, LIMIT
- Basic JOINs
- Standard aggregations (COUNT, SUM, etc.)

**Keep as raw SQL if:**
- Recursive CTEs (WITH RECURSIVE)
- Complex JSON operators (json_extract, json_group_array)
- Window functions with complex partitioning
- Queries with multiple CTEs
- **Dynamic query building** (conditional WHERE clauses)
- **Materialized view queries** (blocked_beads_cache)

## Implementation Details

### getHiveDrizzle() Helper

Created a hive-specific Drizzle client factory that only loads the hive schema:

```typescript
function getHiveDrizzle(db: DatabaseAdapter) {
  const hiveSchema = { beads };
  // ...
  return drizzle(client, { schema: hiveSchema });
}
```

**Why?** The default `toDrizzleDb()` loads the FULL swarm-mail schema (streams, memory, hive). This breaks tests where the test database only has hive tables.

**Pattern:** When migrating subsystems to Drizzle, create subsystem-specific Drizzle clients.

### Drizzle Implementations

Simple Drizzle query pattern:

```typescript
const db = getHiveDrizzle(await adapter.getDatabase());

const results = await db
  .select()
  .from(beads)
  .where(
    and(
      eq(beads.project_key, projectKey),
      isNull(beads.deleted_at),
      like(beads.id, pattern)
    )
  );
```

### Hybrid Approach: getStatistics

Status counts and type counts migrated to Drizzle:

```typescript
const counts = await getStatusCountsDrizzle(adapter, projectKey);
const by_type = await getCountsByTypeDrizzle(adapter, projectKey);
```

Blocked/ready counts kept as raw SQL (needs EXISTS on cache table):

```typescript
const blockedResult = await db.query<{ count: string }>(
  `SELECT COUNT(DISTINCT b.id) as count
   FROM beads b
   JOIN blocked_beads_cache bbc ON b.id = bbc.cell_id
   WHERE b.project_key = $1 AND b.deleted_at IS NULL`,
  [projectKey],
);
```

**Rationale:** Don't force everything into Drizzle. Use the right tool for each sub-problem.

## Test Results

```
✅ 36/36 tests passing
- resolvePartialId: 5 tests
- getStaleIssues: 6 tests
- getStatistics: 5 tests
- getReadyWork: 10 tests (unchanged - raw SQL)
- getBlockedIssues: 4 tests (unchanged - raw SQL)
- getEpicsEligibleForClosure: 3 tests (unchanged - raw SQL)
```

## Files Modified

| File | Status | Description |
|------|--------|-------------|
| `hive/queries-drizzle.ts` | ✅ NEW | Drizzle implementations of simple queries |
| `hive/queries.ts` | ✅ MODIFIED | Updated to use Drizzle functions, added inline docs for raw SQL |
| `hive/queries.test.ts` | ✅ PASSING | No changes needed |

## Key Learnings

1. **Schema Isolation**: Create subsystem-specific Drizzle clients to avoid loading unrelated schemas in tests
2. **Pragmatism Over Purity**: Don't force complex queries into Drizzle just for consistency
3. **Hybrid Approach Works**: Mix Drizzle and raw SQL within a single function when appropriate
4. **Document Decisions**: Inline comments explain WHY queries stay as raw SQL

## Future Work (Optional)

These queries COULD be migrated to Drizzle with more effort:

- `getReadyWork`: Drizzle can do this, but requires complex conditional query building
- `getBlockedIssues`: Needs custom JSON column handling for blocker_ids
- `getEpicsEligibleForClosure`: Drizzle supports GROUP BY + HAVING, but it's verbose

**Recommendation:** Leave as-is unless performance issues arise or Drizzle improves its query builder ergonomics.

## References

- Semantic Memory: "Drizzle ORM Migration Pattern for Event-Sourced Projections"
- Semantic Memory: "Drizzle ORM has specific limitations with libSQL vector operations and FTS5"
