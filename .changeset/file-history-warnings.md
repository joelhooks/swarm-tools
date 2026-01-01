---
"opencode-swarm-plugin": minor
---

## The Hive Remembers: File History Warnings in Worker Prompts

> "A second level of learning makes use of positive feedback and questions the very 
> parameters by which the system operates."
> — Reframing Business: When the Map Changes the Landscape

```
                    .---.
                   /     \
                  | () () |
                   \  ^  /    "I see 3 workers before me
                    |||||      failed on null checks here..."
                   /|||||\ 
                  (_______)
                     |||
              ⚠️ FILE HISTORY ⚠️
```

Workers now receive historical rejection data for their assigned files, surfacing
institutional knowledge at the point of need.

**What changed:**

- `getFileGotchas()` queries hivemind for file-specific learnings (top 3, truncated to 100 chars)
- `getWorkerInsights()` now uses global DB path (`~/.config/swarm-tools/swarm.db`)
- `getFileFailureHistory()` wired into prompt generation flow
- Workers see `⚠️ FILE HISTORY WARNINGS:` section when files have rejection history

**Example output in worker prompts:**

```
⚠️ FILE HISTORY WARNINGS:
- src/auth.ts: 3 previous workers rejected for missing null checks, forgot rate limiting
- src/api/client.ts: 2 previous workers rejected for rate limiting not implemented
```

**Why it matters:**

Workers often repeat mistakes that previous workers made on the same files. Now the
swarm learns from its failures and warns future workers before they make the same
mistakes. First-attempt success rate should improve.

**Tests:** 8 new integration tests covering the full flow.
