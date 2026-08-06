---
"opencode-swarm-plugin": patch
"swarm-mail": patch
---

## 🐝 Memories Were Whispering Into a Room With No Door

> "Program testing can be used to show the presence of bugs, but never to show their absence." — Edsger W. Dijkstra

**What changed:**
- `packages/swarm-mail/src/db/schema/memory.ts`: the Drizzle column default for `status` carried literal quote characters — `.default("'active'")` instead of `.default("active")`. `store()` never sets `status` explicitly, so every memory was written with the 8-character string `'active'` (quotes included, as data) instead of the correct 6-character `active`.
- `search()` and `ftsSearch()` filter on `status = 'active'`, so every corrupted row silently became permanently unsearchable — while `getStats()` kept counting the rows and reporting a perfectly healthy corpus. Store succeeds, search returns nothing, stats lies. Indistinguishable from an empty index.
- Added a regression test that reads the *raw* `status` column value straight off `store()`'s output, not just round-trip search behavior — the existing widened `statusFilter` (`m.status = 'active' OR m.status = '''active'''`) already masks this bug on the read side, so only a direct column read catches the write-side corruption.

**Why it matters:**

Found in the wild: this silently disabled semantic memory across a full multi-agent session. Every agent's "no prior results" looked exactly like a legitimately empty index — no error, no warning, nothing to notice, right up until someone checked the raw column against the stats count by hand.

**Migration:** none needed. The existing `statusFilter` widening (already on `main`, unchanged by this patch) keeps pre-existing corrupted rows searchable — this fix only stops *new* writes from being corrupted going forward. The widening can be dropped in a future major version once old installs have aged out.

**Backward compatible:** yes — no data is lost or requires backfill; previously-corrupted rows stay reachable through the existing filter, they just stop multiplying.

```
    ,-.__,-.
   ( o     o )   "getStats() says I'm fine."
    \   ^   /    "search() says I don't exist."
     `-----'     turns out: I was written with my own name in quotes.
```
