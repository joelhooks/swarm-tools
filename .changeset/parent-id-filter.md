---
"swarm-mail": patch
"opencode-swarm-plugin": patch
---

## Query Epic Children Without Rawdogging JSONL

`hive_cells` and `hive_query` now support `parent_id` filter. Find all children of an epic in one call:

```typescript
hive_cells({ parent_id: "epic-id" })  // Returns all subtasks
hive_query({ parent_id: "epic-id", status: "open" })  // Open subtasks only
```

No more grep/jq on issues.jsonl. The tools do what they should.
