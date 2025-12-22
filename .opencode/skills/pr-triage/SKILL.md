---
name: pr-triage
description: "Context-efficient PR comment triage. Fetch metadata first, bodies selectively. Prevents context exhaustion from verbose PR reviews."
tags:
  - pr
  - review
  - github
  - triage
  - context-efficiency
---

# PR Comment Triage - Context-Efficient Workflow

## The Problem

PR review tools (CodeRabbit) generate MASSIVE comment bodies. Fetching all = instant context exhaustion.

## The Solution: Metadata-First

```
┌─────────────────────────────────────────────┐
│   EFFICIENT PR COMMENT TRIAGE WORKFLOW      │
├─────────────────────────────────────────────┤
│                                             │
│  1. METADATA ONLY (compact)                 │
│     → id, path, line, author                │
│     → 50 comments = ~5KB not 500KB          │
│                                             │
│  2. CATEGORIZE without bodies               │
│     → Group by file/severity                │
│     → Filter by author (skip bots)          │
│                                             │
│  3. FETCH BODY selectively                  │
│     → Human comments: YES                   │
│     → Bot critical: YES                     │
│     → Bot suggestions: NO                   │
│                                             │
│  4. TRIAGE into buckets                     │
│     → fix-with-code                         │
│     → won't-fix                             │
│     → tracked-in-cell                       │
│                                             │
│  5. RESPOND with templates                  │
│                                             │
└─────────────────────────────────────────────┘
```

## Quick Commands

```bash
# Metadata only (~100 bytes/comment)
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '.[] | {id, path, line, author: .user.login}'

# Group by file
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq 'group_by(.path) | map({file: .[0].path, count: length})'

# Human comments only
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '[.[] | select(.user.login != "coderabbitai")]'

# Fetch single body (when needed)
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}

# Reply to comment
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --method POST \
  -F body="✅ Fixed in abc123" \
  -F in_reply_to={comment_id}
```

## Triage Buckets

### fix-with-code
**Trigger:** Security/correctness issue with clear fix.

```markdown
✅ Fixed in {commit_sha}

{brief explanation}
```

### won't-fix
**Trigger:** Stylistic, out-of-scope, or disagree.

```markdown
Thanks for the suggestion! Not applying because {reason}.
```

### tracked-in-cell
**Trigger:** Valid but outside PR scope.

```markdown
Good catch! Tracked in {cell_id}.

Out of scope for this PR but we'll address it separately.
```

## Context Budget Rules

| Scenario | Fetch Bodies? | Max |
|----------|---------------|-----|
| Initial scan | NO | Unlimited |
| Human comments | YES | All |
| Bot critical | YES | Top 5 |
| Bot warnings | SELECTIVE | 1-2/file |
| Bot suggestions | NO | Batch ack |

**Rule:** If fetching >10 bodies, you're doing it wrong.

## CodeRabbit Severity

Markers in comment body:
- `🛑 **Critical**:` - Fix before merge
- `⚠️ **Warning**:` - Triage for fix vs defer
- `💡 **Suggestion**:` - Skip unless trivial
- `📝 **Informational**:` - Batch acknowledge

## Anti-Patterns

❌ `gh pr view --comments` - dumps everything, exhausts context

❌ Read every bot suggestion body - 90% is noise

❌ Reply individually to every comment - notification spam

❌ Triage without metadata scan - can't prioritize

## Pro Tips

✅ Use `--jq` liberally - keeps responses compact

✅ Group by file first - batch-address related comments

✅ Create cells proactively - better to track than forget

✅ Check `in_reply_to_id == null` - focus on root comments

## References

See `references/gh-api-patterns.md` for complete jq query library, pagination, GraphQL patterns, and rate limit handling.
