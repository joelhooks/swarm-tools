---
"swarm-mail": patch
---

## Fix: Bare Filesystem Paths Now Work with libSQL

```
┌─────────────────────────────────────────────────────────────┐
│  BEFORE: URL_INVALID error on bare paths                    │
│  AFTER:  Automatic normalization to file: URLs              │
└─────────────────────────────────────────────────────────────┘
```

**The Bug:**
```
Error: URL_INVALID: The URL '/Users/joel/.config/swarm-tools/swarm.db' 
is not in a valid format
```

libSQL's `createClient()` requires URL-formatted paths (`file:/path/to/db.db`), 
but `getDatabasePath()` returns bare filesystem paths (`/path/to/db.db`).

**The Fix:**
`createLibSQLAdapter()` now normalizes bare paths automatically:

```typescript
// These all work now:
createLibSQLAdapter({ url: "/path/to/db.db" })     // → file:/path/to/db.db
createLibSQLAdapter({ url: "./relative/db.db" })   // → file:./relative/db.db
createLibSQLAdapter({ url: ":memory:" })           // → :memory: (unchanged)
createLibSQLAdapter({ url: "file:/path/db.db" })   // → file:/path/db.db (unchanged)
createLibSQLAdapter({ url: "libsql://host/db" })   // → libsql://host/db (unchanged)
```

**Affected Users:**
Anyone using `swarmmail_init` or other tools that create file-based databases
was hitting this error. Now it just works.
