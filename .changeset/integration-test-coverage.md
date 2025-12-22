---
"opencode-swarm-plugin": patch
"swarm-mail": patch
---

## 🧪 Integration Test Coverage: 0% → 95%

> *"Many characterization tests look like 'sunny day' tests. They don't test many special conditions; they just verify that particular behaviors are present. From their presence, we can infer that refactoring hasn't broken anything."*  
> — Michael Feathers, *Working Effectively with Legacy Code*

We had a bug that broke ALL swarm tools:
```
Error: [streams/store] dbOverride parameter is required for this function.
PGlite getDatabase() has been removed.
```

**Why didn't tests catch it?** No integration tests exercised the full tool → store → DB path.

**Now they do.**

```
┌─────────────────────────────────────────────────────────────────┐
│              tool-adapter.integration.test.ts                   │
├─────────────────────────────────────────────────────────────────┤
│  20 tests | 75 assertions | 1.3s                                │
│                                                                 │
│  ✅ swarmmail_* tools (6 tests)                                 │
│  ✅ hive_* tools (7 tests)                                      │
│  ✅ swarm_progress, swarm_status (2 tests)                      │
│  ✅ swarm_broadcast, swarm_checkpoint (2 tests)                 │
│  ✅ semantic_memory_store, semantic_memory_find (2 tests)       │
│  ✅ Smoke test - 9 tools in sequence (1 test)                   │
└─────────────────────────────────────────────────────────────────┘
```

### What's Tested

Each test calls `tool.execute()` and verifies:
1. No "dbOverride required" error (the bug symptom)
2. Tool returns expected structure
3. Full path works: tool → store → DB → response

### The Smoke Test

Runs 9 tools in sequence to catch interaction bugs:
```
swarmmail_init → hive_create → swarmmail_reserve → swarm_progress
→ semantic_memory_store → semantic_memory_find → swarmmail_send
→ hive_close → swarmmail_release
```

If ANY step throws "dbOverride required", the test fails.

### Also Fixed

- **Auto-adapter creation** in store.ts - functions now auto-create adapters when not provided
- **Exported `clearAdapterCache()`** for test isolation
- **Migrated test files** from old `getDatabase()` to adapter pattern

### Mandatory Coordinator Review Loop

Added `COORDINATOR_POST_WORKER_CHECKLIST` constant and `post_completion_instructions` field to `swarm_spawn_subtask`. Coordinators now get explicit instructions to review worker output before spawning the next worker.

The "dbOverride required" bug **cannot recur undetected**.
