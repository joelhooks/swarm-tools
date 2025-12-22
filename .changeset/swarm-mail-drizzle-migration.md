---
"swarm-mail": minor
---

## 🐝 The Great Drizzle Migration

> *"In most cases, a change to an application's features also requires a change to data that it stores: perhaps a new field or record type needs to be captured, or perhaps existing data needs to be presented in a new way."*  
> — Martin Kleppmann, *Designing Data-Intensive Applications*

The hive's data layer got a complete overhaul. PGlite is out, libSQL is in, and Drizzle ORM now handles all the heavy lifting.

```
┌─────────────────────────────────────────────────────┐
│                  BEFORE → AFTER                     │
├─────────────────────────────────────────────────────┤
│  PGlite (WASM Postgres)  →  libSQL (SQLite fork)   │
│  Raw SQL strings         →  Drizzle ORM            │
│  Implicit connections    →  Explicit adapters      │
│  Test flakiness          →  Deterministic tests    │
└─────────────────────────────────────────────────────┘
```

### What Changed

**Database Layer:**
- Migrated from PGlite to libSQL for all persistence
- Introduced `DatabaseAdapter` interface for dependency injection
- All Effect primitives now accept explicit database connections
- Added `getSwarmMailLibSQL()` factory for clean initialization

**Effect Primitives Refactored:**
- `DurableDeferred` - now takes adapter, cleaner resolve/reject
- `DurableLock` - explicit connection, better timeout handling
- `DurableCursor` - adapter-based, no global state
- `DurableMailbox` - consistent with other primitives

**Test Infrastructure:**
- 32 failing tests fixed through schema alignment
- `createInMemorySwarmMail()` for fast, isolated tests
- No more WASM initialization flakiness
- Tests run in <100ms instead of 5s+

**Schema Alignment:**
- Unified schema between memory and streams
- Fixed PostgreSQL → SQLite syntax (ANY() → IN())
- Vector search now uses proper `vector_top_k` with index

### Migration Notes

If you were using internal APIs:

```typescript
// BEFORE (implicit global state)
import { getDatabase } from "swarm-mail";
const db = await getDatabase();

// AFTER (explicit adapter)
import { getSwarmMailLibSQL } from "swarm-mail";
const adapter = await getSwarmMailLibSQL({ path: "./data.db" });
```

**PGlite is deprecated.** It remains only for migrating legacy databases. New code should use libSQL exclusively.

### Why This Matters

- **Faster tests** - No WASM cold start, in-memory SQLite is instant
- **Cleaner architecture** - No hidden global state, explicit dependencies
- **Better debugging** - Drizzle's query logging beats raw SQL
- **Future-proof** - libSQL's Turso integration for edge deployment
