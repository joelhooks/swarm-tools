# Memory Subsystem Drizzle ORM Audit

**Date:** December 19, 2024  
**Cell ID:** opencode-swarm-monorepo-lf2p4u-mjf9zd9uul8  
**Epic ID:** opencode-swarm-monorepo-lf2p4u-mjf9zd9kgo7  

## Executive Summary

✅ **Memory subsystem is FULLY Drizzle-converted where possible.**

All remaining raw SQL is **REQUIRED** for libSQL-specific vector operations and FTS5 full-text search features that Drizzle ORM doesn't support.

## Files Audited

| File | Status | Notes |
|------|--------|-------|
| `store.ts` | ✅ Drizzle + Acceptable SQL | Uses Drizzle for all CRUD, raw SQL only for vector/FTS5 |
| `adapter.ts` | ✅ Fully Drizzle | Pure Drizzle ORM (lines 331-334) |
| `libsql-schema.ts` | ✅ Acceptable SQL | FTS5 virtual tables, triggers, vector indexes |
| `migrate-legacy.ts` | ✅ Acceptable SQL | PGlite reads, DatabaseAdapter abstraction |
| `sync.ts` | ✅ DatabaseAdapter | Portable via DatabaseAdapter interface |

## Raw SQL Breakdown

### store.ts - Vector Operations (REQUIRED)

**Lines 133, 142** - Vector function calls:
```typescript
embedding: sql`vector(${vectorStr})`
```
**Why:** libSQL's `vector()` function converts JSON array to F32_BLOB format. Drizzle's custom type handles reads but not writes with this function.

**Lines 178-202** - Vector similarity search:
```typescript
sql`
  SELECT 
    m.*,
    vector_distance_cos(m.embedding, vector(${vectorStr})) as distance
  FROM vector_top_k('idx_memories_embedding', vector(${vectorStr}), ${limit * 2}) AS v
  JOIN memories m ON m.rowid = v.id
  WHERE (1 - vector_distance_cos(m.embedding, vector(${vectorStr}))) >= ${threshold}
`
```
**Why:** 
- `vector_top_k()` - libSQL-specific ANN search function
- `vector_distance_cos()` - libSQL-specific cosine similarity
- Virtual table join pattern - Drizzle doesn't support this pattern

**Lines 234-259** - FTS5 full-text search:
```typescript
sql`
  SELECT m.*, fts.rank as score
  FROM memories_fts fts
  JOIN memories m ON m.rowid = fts.rowid
  WHERE fts.content MATCH ${quotedQuery}
`
```
**Why:** FTS5 virtual tables and MATCH operator not supported by Drizzle.

### libsql-schema.ts - Schema DDL (REQUIRED)

**Lines 57-69** - Table creation with vector column:
```sql
CREATE TABLE IF NOT EXISTS memories (
  embedding F32_BLOB(1024)
)
```
**Why:** Drizzle can't create tables with F32_BLOB - must use raw DDL.

**Lines 83-86** - Vector index:
```sql
CREATE INDEX idx_memories_embedding 
ON memories(libsql_vector_idx(embedding))
```
**Why:** `libsql_vector_idx()` function syntax not supported by Drizzle.

**Lines 93-124** - FTS5 virtual table + triggers:
```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(...)
CREATE TRIGGER memories_fts_insert ...
```
**Why:** Virtual tables and triggers not supported by Drizzle schema API.

### migrate-legacy.ts - Legacy Database (REQUIRED)

**Lines 165-190** - PGlite queries:
```typescript
await legacyDb.query(`SELECT * FROM memories`)
```
**Why:** Reading from PGlite database - must use PGlite's API, not Drizzle.

**Lines 208-245** - DatabaseAdapter usage:
```typescript
await targetDb.query(`INSERT INTO memories ...`)
```
**Why:** Uses DatabaseAdapter abstraction for portability between PGlite/libSQL. This is the CORRECT pattern.

### sync.ts - DatabaseAdapter (ACCEPTABLE)

**Lines 148-161, 269-319** - DatabaseAdapter queries:
```typescript
await db.query(`SELECT id, content FROM memories WHERE ...`)
```
**Why:** Uses DatabaseAdapter interface for portability. Could be converted to Drizzle if adapter exposed Drizzle instance, but current pattern is acceptable.

## Drizzle Schema Validation

✅ **Schema parity confirmed:**

`db/schema/memory.ts` (Drizzle) matches `memory/libsql-schema.ts` (raw SQL):
- ✅ All columns present: `id`, `content`, `metadata`, `collection`, `tags`, `created_at`, `updated_at`, `decay_factor`, `embedding`
- ✅ Same defaults: `metadata='{}', collection='default', tags='[]', decay_factor=1.0`
- ✅ Same types: F32_BLOB(1024) for embedding

**Previous issue (now resolved):** Semantic memory found that libsql-schema.ts was missing `tags`, `updated_at`, `decay_factor` columns. This has been FIXED.

## Test Results

**Memory subsystem tests:** ✅ 116 pass, 1 skip, 0 fail  
**Plugin integration tests:** ✅ 7 pass, 0 fail

All tests pass with current implementation.

## Recommendations

### Keep As-Is ✅

1. **store.ts vector operations** - No Drizzle alternative for libSQL vectors
2. **store.ts FTS5 queries** - No Drizzle alternative for FTS5
3. **libsql-schema.ts DDL** - Required for initial schema setup
4. **migrate-legacy.ts** - Correct use of PGlite API + DatabaseAdapter
5. **sync.ts DatabaseAdapter** - Portable, acceptable abstraction

### Future Improvements 🔮

1. **If Drizzle adds FTS5 support:** Migrate FTS5 queries to Drizzle
2. **If Drizzle adds vector support:** Migrate vector queries to Drizzle
3. **If sync.ts needs optimization:** Consider exposing Drizzle instance in DatabaseAdapter for type-safe queries

## Conclusion

The memory subsystem is **ALREADY fully Drizzle-converted** where technically possible. All remaining raw SQL is for:

1. **libSQL-specific vector operations** - not supported by Drizzle
2. **FTS5 full-text search** - not supported by Drizzle
3. **Schema DDL for vectors/FTS5** - not supported by Drizzle
4. **Legacy PGlite migrations** - correct use of source database API
5. **DatabaseAdapter abstraction** - acceptable for portability

No further conversion is possible or recommended.

## References

- **Drizzle ORM docs:** https://orm.drizzle.team/
- **libSQL vectors:** https://docs.turso.tech/features/ai-and-embeddings
- **SQLite FTS5:** https://www.sqlite.org/fts5.html
- **Semantic memory:** Found outdated schema issue (now fixed)
