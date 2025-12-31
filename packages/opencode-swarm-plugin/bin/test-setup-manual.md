# Manual Test: swarm setup -y database consolidation

## Test Setup UX

Run these commands to verify the database consolidation UX:

### Test 1: No stray databases
```bash
cd /tmp
mkdir test-swarm-setup-1
cd test-swarm-setup-1
swarm setup -y
```

Expected output:
```
Checking for stray databases...
  No stray databases found
```

### Test 2: With stray databases (requires creating test DBs)
```bash
cd /tmp
mkdir test-swarm-setup-2
cd test-swarm-setup-2
mkdir -p .opencode
echo "fake" > .opencode/swarm.db
swarm setup -y
```

Expected output:
```
Checking for stray databases...
Found 1 stray database(s):
  .opencode/swarm.db (... records)

Migrate to global database? [automatic in -y mode]

Migrating...
✓ Migrated X records from 1 stray database(s)
  .opencode/swarm.db: X migrated, Y skipped
```

### Test 3: Interactive mode (without -y)
```bash
cd /tmp
mkdir test-swarm-setup-3
cd test-swarm-setup-3
mkdir -p .hive
echo "fake" > .hive/swarm-mail.db
swarm setup
```

Expected output:
```
Checking for stray databases...
Found 1 stray database(s):
  .hive/swarm-mail.db (... records)

Migrate to global database? [Y/n]
```

## Cleanup

```bash
rm -rf /tmp/test-swarm-setup-*
```
