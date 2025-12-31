# Database Consolidation

**Status:** ✅ Implemented

## Overview

The consolidation module detects and migrates stray databases to the global database at `~/.config/swarm-tools/swarm.db`.

## Stray Locations

The system scans for stray databases in:

- `.opencode/swarm.db` (project root)
- `.hive/swarm-mail.db` (legacy hive)
- `packages/*/.opencode/swarm.db` (nested packages)

Excludes:
- `.migrated` files (already migrated)
- `.backup-*` files (backups)

## API

### detectStrayDatabases(projectPath)

Scans project for stray databases.

```typescript
const strays = await detectStrayDatabases("/path/to/project");
// => [{ path: "...", location: "project-root" }, ...]
```

### analyzeStrayDatabase(strayPath, globalDbPath?)

Analyzes a stray database:
- Table list and row counts
- Schema version (modern/legacy/unknown)
- Unique data (not in global)
- Migration plan

```typescript
const analysis = await analyzeStrayDatabase(strayPath, globalDbPath);
console.log(analysis.schemaVersion); // "modern"
console.log(analysis.uniqueData.events); // 42
```

### migrateToGlobal(strayPath, globalDbPath, options?)

Migrates a single stray database to global.

**CRITICAL:** Excludes `id` column from INSERTs to avoid conflicts when consolidating multiple DBs with overlapping ID ranges.

```typescript
const result = await migrateToGlobal(strayPath, globalDbPath);
console.log(result.summary.totalMigrated); // 100
console.log(result.summary.totalSkipped); // 5
```

Options:
- `skipBackup?: boolean` - Skip creating `.migrated` backup

### consolidateDatabases(projectPath, globalDbPath, options?)

Orchestrates full consolidation:

1. Detect all strays
2. (If interactive) Show findings, prompt for confirmation
3. Migrate each stray
4. Rename strays to `.migrated`
5. Return report

```typescript
// Interactive mode
const report = await consolidateDatabases(projectPath, globalDbPath, {
  interactive: true
});

// JFDI mode
const report = await consolidateDatabases(projectPath, globalDbPath, {
  yes: true
});
```

Options:
- `yes?: boolean` - Skip confirmation (JFDI mode)
- `interactive?: boolean` - Show findings and prompt
- `skipBackup?: boolean` - Skip backup creation

## Conflict Resolution

**Global wins.** Uses `INSERT OR IGNORE` to skip duplicates.

**Key Insight:** Excludes `id` column from INSERT statements to avoid PRIMARY KEY conflicts. When consolidating multiple stray DBs:
- Each stray has independent AUTOINCREMENT sequences (1, 2, 3, ...)
- Without excluding `id`, inserting stray2's event (id=1) fails when global already has stray1's event (id=1)
- Excluding `id` lets SQLite generate new unique IDs in global DB

## Schema Version Detection

- **Modern:** Has `events`, `agents`, `messages` tables
- **Legacy:** Has `bead_events` table
- **Unknown:** Neither

## Files Created

After migration, stray DBs are renamed to `.migrated`:
- `.opencode/swarm.db` → `.opencode/swarm.db.migrated`
- `.hive/swarm-mail.db` → `.hive/swarm-mail.db.migrated`

## Example Report

```typescript
{
  straysFound: 3,
  straysMigrated: 3,
  totalRowsMigrated: 142,
  migrations: [
    {
      path: ".opencode/swarm.db",
      location: "project-root",
      result: {
        migrated: { events: 50, agents: 2, ... },
        skipped: { events: 0, ... },
        log: ["Migrated 50 events", "Migrated 2 agents"],
        summary: { totalMigrated: 52, totalSkipped: 0 }
      }
    }
  ],
  errors: []
}
```

## Testing

- **Unit tests:** `src/db/consolidate-databases.test.ts`
- **Integration tests:** `src/db/consolidate-databases.integration.test.ts`

## CLI Integration

To be called by `swarm setup`:

```typescript
import { consolidateDatabases } from "swarm-mail/db";

// In swarm setup command
const globalDbPath = join(homedir(), ".config", "swarm-tools", "swarm.db");
const report = await consolidateDatabases(projectPath, globalDbPath, {
  yes: argv.yes,
  interactive: !argv.yes
});

console.log(`Migrated ${report.totalRowsMigrated} rows from ${report.straysMigrated} databases`);
```
