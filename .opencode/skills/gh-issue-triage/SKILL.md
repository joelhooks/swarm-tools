---
name: gh-issue-triage
description: GitHub issue triage workflow with contributor profile extraction. Analyze → clarify → file cells → tag → implement → credit. Captures Twitter handles for changeset acknowledgments.
tags:
  - github
  - issues
  - triage
  - contributors
  - twitter
  - credits
---

---
name: gh-issue-triage
description: GitHub issue triage workflow with contributor profile extraction. Analyze → clarify → file cells → tag → implement → credit. Captures Twitter handles for changeset acknowledgments.
tags:
  - github
  - issues
  - triage
  - contributors
  - twitter
  - credits
---

# GitHub Issue Triage - Analyze → Clarify → File → Tag → Implement → Credit

## Philosophy

**Issues are conversations, not tickets.** Treat contributors with respect - they took time to file the issue. Extract their profile info so changesets can properly credit them when fixes ship.

- Good issue? **CLARIFY** → file cell → acknowledge → implement → credit in changeset
- Bug report? **REPRODUCE** → confirm → file cell → fix → credit
- Feature request? **VALIDATE** → check scope → defer or implement → credit
- Duplicate? **LINK** → close gently → no cell needed
- Not a bug? **EXPLAIN** → close kindly → no cell needed

## The Workflow

```
┌─────────────────────────────────────────────┐
│   ANALYZE → CLARIFY → FILE → IMPLEMENT     │
├─────────────────────────────────────────────┤
│                                             │
│  1. FETCH ISSUE                             │
│     gh issue view <number> --json ...       │
│     → Get title, body, author, state        │
│                                             │
│  2. GET CONTRIBUTOR PROFILE                 │
│     gh api users/<login>                    │
│     → twitter_username, blog, bio, name     │
│     → Store for changeset credits           │
│                                             │
│  3. ANALYZE                                 │
│     → Is it a bug? Feature? Question?       │
│     → Can you reproduce?                    │
│     → Is it in scope?                       │
│                                             │
│  4. CLARIFY (if needed)                     │
│     → Ask for repro steps                   │
│     → Request context/versions              │
│     → Genuine questions, not interrogation  │
│                                             │
│  5. FILE CELL                               │
│     hive_create(                            │
│       title="Issue #N: <summary>",          │
│       type="bug|feature",                   │
│       description="<link + contributor>"    │
│     )                                       │
│                                             │
│  6. TAG ISSUE                               │
│     gh issue edit <number> --add-label bug  │
│                                             │
│  7. IMPLEMENT                               │
│     → Fix the issue                         │
│     → Write tests                           │
│     → Close cell                            │
│                                             │
│  8. CREDIT IN CHANGESET                     │
│     → Add "Thanks @twitter" or              │
│       "Thanks <name> (<blog>)"              │
│                                             │
└─────────────────────────────────────────────┘
```

## Decision Matrix

| Issue Type | Action | Create Cell? | Credit? |
|------------|--------|--------------|---------|
| Valid bug with repro | Confirm → file cell → fix | ✅ Yes | ✅ Yes |
| Bug missing repro | Ask for steps → wait | ⏸️ Defer | ✅ Yes (when fixed) |
| Feature request in scope | Validate → file cell → implement | ✅ Yes | ✅ Yes |
| Feature out of scope | Explain why → close | ❌ No | ❌ No |
| Duplicate | Link to original → close | ❌ No | ✅ Maybe (if original gets fixed) |
| Question/support | Answer → close | ❌ No | ❌ No |
| Already fixed | Confirm → close | ❌ No | ✅ Yes (if recent) |

## SDK Commands

```bash
# Get issue details
bun run scripts/issue-summary.ts <owner/repo> <number>
# Returns: title, body, author, state, labels, url

# Get contributor profile (includes Twitter!)
bun run scripts/get-contributor.ts <login>
# Returns: name, twitter_username, blog, bio, avatar_url
```

## Quick Triage Pattern

```typescript
import { getIssueSummary } from "./scripts/issue-summary.ts";
import { getContributor } from "./scripts/get-contributor.ts";

// 1. Fetch issue
const issue = await getIssueSummary("owner/repo", 42);

// 2. Get contributor profile
const contributor = await getContributor(issue.author.login);

// 3. Store contributor for later credit
// (Twitter handle: contributor.twitter_username)

// 4. Analyze and decide
if (issue.body.includes("TypeError") && issue.body.includes("steps to reproduce")) {
  // Valid bug with repro - file cell
  await hive_create({
    title: `Issue #42: ${issue.title}`,
    type: "bug",
    description: `${issue.url}\n\nReported by: ${contributor.name || contributor.login}\nTwitter: ${contributor.twitter_username || 'N/A'}\n\n${issue.body.slice(0, 500)}`
  });
  
  // Tag issue
  await $`gh issue edit 42 --add-label bug`;
} else if (!issue.body.includes("steps to reproduce")) {
  // Missing info - ask nicely
  await $`gh issue comment 42 --body "Hey ${contributor.name || contributor.login}! Could you share steps to reproduce? That'll help me track this down."`;
}
```

## Acknowledgment Comment Templates

**After filing cell:**
```
Hey [name]! Thanks for reporting this. I've filed a tracking issue - we'll get this sorted.
```

**After asking for clarification:**
```
Hey [name], could you share [X]? That'll help me nail down what's happening.
```

**After fixing:**
```
Fixed in [commit]! Should be in the next release. Thanks for catching this 🙏
```

**When closing as duplicate:**
```
This is a dupe of #[N] - tracking there. Thanks for the report!
```

**When closing as not-a-bug:**
```
This is actually expected behavior because [reason]. If you're trying to [X], here's how: [link/example]
```

## Changeset Credit Templates

**With Twitter handle:**
```markdown
---
"package-name": patch
---

Fixed [bug description]

Thanks @twitter_username for the report!
```

**Without Twitter (use name + blog):**
```markdown
---
"package-name": patch
---

Fixed [bug description]

Thanks [Name] ([blog URL]) for the report!
```

**Without any profile info:**
```markdown
---
"package-name": patch
---

Fixed [bug description]

Thanks @github_username for the report!
```

## Profile Extraction

GitHub user profiles have these useful fields:

```json
{
  "login": "bcheung",
  "name": "Brandon Cheung",
  "twitter_username": "justBCheung",  // ← THIS!
  "blog": "https://example.com",
  "bio": "Building cool stuff",
  "avatar_url": "...",
  "html_url": "..."
}
```

**Always fetch the profile** - it's one API call and gives you credit info for changesets that get tweeted.

## Voice Guide (You're Joel the Maintainer)

**DO:**
- Be genuine and conversational
- Use "Hey [name]" not "Hello"
- Say "Thanks for the report!" not "Thank you for your contribution"
- Use emoji sparingly (🙏 after fixes, not in every comment)
- Explain WHY something is/isn't a bug
- Link to docs/examples when helpful

**DON'T:**
- Corporate speak ("We appreciate your feedback")
- Interrogate ("Can you provide more details about...")
- Over-promise ("We'll fix this ASAP!")
- Apologize excessively ("Sorry for the inconvenience")
- Use ticket numbers as if it's Jira ("TKT-1234")

**Examples:**

❌ **Corporate:** "Thank you for your contribution. We have logged this issue and will investigate."

✅ **Joel:** "Hey Brandon! Thanks for catching this. I can reproduce it - looks like the auth refresh logic is borked. Tracking in #42."

---

❌ **Interrogative:** "Can you please provide the following information: 1) Version 2) Steps to reproduce 3) Expected behavior 4) Actual behavior"

✅ **Joel:** "Hey! Could you share which version you're on? And if you've got repro steps that'd be 🔥"

---

❌ **Over-promise:** "We'll fix this in the next patch release!"

✅ **Joel:** "On it! Should have a fix soon."

## Integration with Hive

```typescript
// File cell with issue reference
hive_create({
  title: `Issue #42: Token refresh fails`,
  type: "bug",
  description: `https://github.com/owner/repo/issues/42

Reported by: Brandon Cheung
Twitter: @justBCheung
GitHub: @bcheung

User reports auth tokens aren't refreshing. Repro steps in issue.`
});

// When closing cell, reference in commit
git commit -m "fix: token refresh race condition

Fixes #42 - adds 5min buffer before token expiry.

Thanks @justBCheung for the report!"
```

## References

- `scripts/get-contributor.ts` - GitHub user profile fetcher
- `scripts/issue-summary.ts` - Issue details with smart formatting
- GitHub CLI: `gh issue view`, `gh api users/<login>`
