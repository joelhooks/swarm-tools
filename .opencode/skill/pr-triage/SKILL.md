---
name: pr-triage
description: "Use when triaging pull request review comments to decide which need code fixes and which to resolve silently. Fetches unreplied PR comments, evaluates each for security or correctness issues, applies fixes with commit references for important problems, and resolves style nits and metadata comments without reply. Prioritizes action over conversation to keep PR threads focused."
tags:
  - pr
  - review
  - github
  - triage
  - context-efficiency
---

# PR Comment Triage - Evaluate → Decide → Act

## Philosophy

**Replies are SECONDARY to addressing concerns.**

- Important issue? **FIX IT** → reply with commit ref → resolve
- Not important? **RESOLVE SILENTLY** → no reply needed
- Don't reply to every comment - that's noise

## The Workflow

```
┌─────────────────────────────────────────────┐
│         EVALUATE → DECIDE → ACT             │
├─────────────────────────────────────────────┤
│                                             │
│  1. FETCH UNREPLIED (metadata only)         │
│     → Get root comments without replies     │
│     → ~100 bytes/comment, paginated         │
│                                             │
│  2. EVALUATE each comment                   │
│     → Fetch body only if path looks important│
│     → Skip: metadata files, style nits      │
│     → Check: security, correctness, tests   │
│                                             │
│  3. DECIDE action                           │
│     → FIX: implement change, reply, resolve │
│     → RESOLVE: close silently, no reply     │
│     → DEFER: create cell, resolve           │
│                                             │
│  4. ACT                                     │
│     → Fix issues in code                    │
│     → Resolve threads (not reply)           │
│     → Reply ONLY when you fixed something   │
│                                             │
└─────────────────────────────────────────────┘
```

## Decision Matrix

| Comment Type | Action | Reply? |
|--------------|--------|--------|
| Security/correctness bug | FIX → reply with commit | ✅ Yes |
| Valid improvement, in scope | FIX → reply with commit | ✅ Yes |
| Valid but out of scope | Create cell → resolve | ❌ No |
| Style/formatting nit | Resolve silently | ❌ No |
| Metadata file (.jsonl, etc) | Resolve silently | ❌ No |
| Already fixed | Reply with commit → resolve | ✅ Yes |
| Disagree with suggestion | Resolve silently | ❌ No |

## SDK Commands

```bash
# Get unreplied root comments (start here)
bun run scripts/pr-comments.ts unreplied owner/repo 42

# Evaluate: fetch body for specific comment
bun run scripts/pr-comments.ts expand owner/repo 123456

# Act: resolve without reply (preferred)
bun run scripts/pr-comments.ts resolve owner/repo 42 123456

# Act: reply then resolve (only when you fixed something)
bun run scripts/pr-comments.ts reply owner/repo 42 123456 "✅ Fixed in abc123"

# Helpers
bun run scripts/pr-comments.ts summary owner/repo 42   # File-level overview
bun run scripts/pr-comments.ts list owner/repo 42      # All metadata
```

## Quick Triage Pattern

```typescript
import { fetchMetadata, fetchBody, resolveThread, reply, getThreadId } from "./scripts/pr-comments.ts";

const comments = await fetchMetadata("owner/repo", 42);

// Find unreplied root comments
const repliedTo = new Set(comments.filter(c => c.inReplyToId).map(c => c.inReplyToId));
const unreplied = comments.filter(c => !c.inReplyToId && !repliedTo.has(c.id));

for (const c of unreplied) {
  // Skip metadata files - resolve silently
  if (c.path.endsWith('.jsonl') || c.path.includes('.hive/')) {
    const threadId = await getThreadId("owner/repo", 42, c.id);
    if (threadId) await resolveThread("owner/repo", threadId);
    continue;
  }

  // Evaluate important files
  const full = await fetchBody("owner/repo", c.id);
  
  if (full.body.includes('Critical') || full.body.includes('security')) {
    // FIX IT, then reply
    // ... implement fix ...
    await reply("owner/repo", 42, c.id, "✅ Fixed in abc123");
  }
  
  // Resolve either way
  const threadId = await getThreadId("owner/repo", 42, c.id);
  if (threadId) await resolveThread("owner/repo", threadId);
}
```

## Skip These (Resolve Silently)

- `.hive/issues.jsonl` - auto-generated metadata
- `.hive/memories.jsonl` - auto-generated metadata  
- Changeset formatting suggestions
- Import ordering nits
- "Add tracking issue" for intentional skips
- Style preferences you disagree with

## Fix These (Reply + Resolve)

- Security vulnerabilities
- Correctness bugs
- Missing error handling
- Test coverage gaps (if valid)
- Type safety issues

## Context Budget

| Action | Context Cost |
|--------|--------------|
| `unreplied` | ~100 bytes/comment |
| `expand` (1 comment) | ~5KB |
| `resolve` | 0 (GraphQL mutation) |
| `reply` | ~200 bytes |

**Rule:** Fetch <10 bodies per triage session.

## References

- `scripts/pr-comments.ts` - Full SDK with Zod schemas
- `references/gh-api-patterns.md` - Raw jq patterns, GraphQL, pagination
