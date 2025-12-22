# GitHub API Patterns for PR Comment Triage

## Quick Reference

| Task | Command |
|------|---------|
| List comment metadata | `gh api repos/{owner}/{repo}/pulls/{pr}/comments --jq '.[] \| {id, path, line, author: .user.login}'` |
| Count comments per file | `gh api repos/{owner}/{repo}/pulls/{pr}/comments --jq 'group_by(.path) \| map({file: .[0].path, count: length})'` |
| Filter by author | `gh api repos/{owner}/{repo}/pulls/{pr}/comments --jq '[.[] \| select(.user.login == "username")]'` |
| Root comments only | `gh api repos/{owner}/{repo}/pulls/{pr}/comments --jq '[.[] \| select(.in_reply_to_id == null)]'` |
| Fetch single comment | `gh api repos/{owner}/{repo}/pulls/comments/{comment_id}` |
| Post reply | `gh api repos/{owner}/{repo}/pulls/{pr}/comments --method POST --field body="..." --field in_reply_to_id={id}` |

## API Endpoints

### List PR Comments

```bash
GET /repos/{owner}/{repo}/pulls/{pr}/comments
```

**Response fields:**
- `id` - Comment ID (for fetching/replying)
- `path` - File path
- `line` - Line number (null for file-level comments)
- `original_line` - Line in original diff (fallback if `line` is null)
- `body` - Full comment text (EXPENSIVE, omit in metadata scans)
- `user.login` - Author username
- `created_at` - Timestamp
- `in_reply_to_id` - Parent comment ID (null = root comment)
- `diff_hunk` - Surrounding code context

### Get Single Comment

```bash
GET /repos/{owner}/{repo}/pulls/comments/{comment_id}
```

**Use when:** Metadata scan identified actionable comment.

### Post Comment/Reply

```bash
POST /repos/{owner}/{repo}/pulls/{pr}/comments
```

**Required fields:**
- `body` - Comment text (markdown supported)
- `commit_id` - Commit SHA (for line comments)
- `path` - File path (for line comments)
- `line` - Line number (for line comments)
- `in_reply_to_id` - Parent comment ID (for replies)

**Simpler reply pattern:**
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --method POST \
  --field body="✅ Fixed" \
  --field in_reply_to_id=123
```

### Mark Comment Resolved

```bash
PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}
```

**Body:**
```json
{"body": "✅ Fixed in abc123\n\n<!-- resolved -->"}
```

**Note:** GitHub doesn't have native "resolved" API. Use comment convention.

## jq Query Library

### Metadata-Only Scan (Minimal Context)

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '.[] | {
    id,
    path,
    line: .line // .original_line,
    author: .user.login,
    created: .created_at
  }'
```

**Output size:** ~100 bytes per comment (vs ~5KB with body).

### Group by File with Counts

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq 'group_by(.path) | map({
    file: .[0].path,
    count: length,
    authors: [.[].user.login] | unique
  })'
```

**Use when:** Need overview of where comments are concentrated.

### Filter Human Comments

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '[.[] | select(.user.login != "coderabbitai" and .user.login != "github-actions[bot]")]'
```

**Customize:** Add more bot usernames to exclude list.

### Root Comments Only (Skip Replies)

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '[.[] | select(.in_reply_to_id == null)]'
```

**Why:** Replies usually add context to root comment, not new issues.

### Comments by Recency

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq 'sort_by(.created_at) | reverse | .[0:10] | .[] | {id, path, author: .user.login}'
```

**Use when:** Focusing on latest feedback first.

### Comments on Specific File

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq --arg file "src/auth.ts" '[.[] | select(.path == $file)]'
```

**Use when:** Fixing issues file-by-file.

### Extract Comment IDs for Batch Fetch

```bash
# Get IDs of human comments on changed files
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '[.[] | select(.user.login != "coderabbitai")] | .[].id'
```

**Output:** Space-separated IDs for batch fetch loop.

## CodeRabbit-Specific Patterns

### Severity Extraction Regex

CodeRabbit uses these markers in comment bodies:

```regex
🛑 \*\*Critical\*\*:     # Security, breaking changes
⚠️ \*\*Warning\*\*:       # Best practices, potential bugs
💡 \*\*Suggestion\*\*:    # Style, optimization
📝 \*\*Informational\*\*: # Docs, explanations
```

**jq pattern to detect severity:**
```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '[.[] | select(.user.login == "coderabbitai") | {
    id,
    path,
    severity: (
      if .body | test("🛑 \\*\\*Critical\\*\\*") then "critical"
      elif .body | test("⚠️ \\*\\*Warning\\*\\*") then "warning"
      elif .body | test("💡 \\*\\*Suggestion\\*\\*") then "suggestion"
      else "info"
      end
    )
  }]'
```

**Note:** Requires fetching body (use selectively on high-priority comments).

### Proposed Fix Detection

CodeRabbit suggests fixes in fenced code blocks:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id} \
  --jq 'select(.body | contains("**Suggestion:**")) | .body'
```

**Extract code block:**
```bash
# Regex to extract ```typescript ... ``` blocks
gh api repos/{owner}/{repo}/pulls/comments/{comment_id} \
  --jq '.body' | sed -n '/```typescript/,/```/p' | sed '1d;$d'
```

**Use when:** Applying suggested fix directly.

## Thread Detection

### Find All Replies to a Comment

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq --arg parent_id "123" '[.[] | select(.in_reply_to_id == ($parent_id | tonumber))]'
```

**Use when:** Need full thread context for complex discussions.

### Count Thread Depth

```bash
# Comments with replies (potential threads)
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '[.[] | select(.in_reply_to_id == null)] | map({
    id,
    path,
    replies: [.[] | select(.in_reply_to_id == .id)] | length
  })'
```

**Use when:** Identifying high-engagement discussions.

## Pagination (For Large PRs)

GitHub API returns 30 items per page by default.

### Check if More Pages Exist

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --include \
  --jq -r '.[] | select(.id) | .id' \
  | head -1
```

**Look for `Link:` header in response.** If present, more pages exist.

### Fetch All Pages

```bash
gh api --paginate repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '.[] | {id, path, line, author: .user.login}'
```

**Warning:** `--paginate` fetches ALL pages. For 1000+ comments, this is SLOW. Use selectively.

## Performance Tips

### Cache Metadata Locally

```bash
# Save metadata to temp file
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '.[] | {id, path, line, author: .user.login}' \
  > /tmp/pr-comments-metadata.json

# Query locally
jq '[.[] | select(.author != "coderabbitai")]' < /tmp/pr-comments-metadata.json
```

**Why:** Avoids re-fetching metadata for multiple queries.

### Batch Fetch Bodies

```bash
# Get IDs from metadata
comment_ids=$(jq -r '.[].id' < /tmp/pr-comments-metadata.json)

# Fetch bodies in parallel (careful with rate limits)
for id in $comment_ids; do
  gh api repos/{owner}/{repo}/pulls/comments/$id &
done
wait
```

**Warning:** GitHub rate limit is 5000 req/hour. For >50 comments, use sequential fetch.

### Use GraphQL for Complex Queries

REST API requires multiple calls. GraphQL can fetch metadata + selective bodies in one request.

**Example (fetch comments with severity in body):**
```graphql
query {
  repository(owner: "joelhooks", name: "opencode-swarm-plugin") {
    pullRequest(number: 42) {
      comments(first: 100) {
        nodes {
          id
          path
          body
          author { login }
        }
      }
    }
  }
}
```

**Execute:**
```bash
gh api graphql -f query='...' --jq '.data.repository.pullRequest.comments.nodes'
```

**Trade-off:** More complex query, but fewer API calls for filtered results.

## Rate Limit Handling

### Check Current Rate Limit

```bash
gh api rate_limit --jq '.rate | {remaining, reset: (.reset | todate)}'
```

**Output:**
```json
{"remaining":4987,"reset":"2025-12-22T15:30:00Z"}
```

### Wait if Near Limit

```bash
remaining=$(gh api rate_limit --jq '.rate.remaining')
if [ $remaining -lt 100 ]; then
  echo "Rate limit low, waiting..."
  sleep 60
fi
```

**Use when:** Batch processing many comments.

## Common Workflows

### 1. Initial Triage Scan

```bash
# Fetch metadata only
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '.[] | {id, path, line, author: .user.login}' \
  > metadata.json

# Count by file
jq 'group_by(.path) | map({file: .[0].path, count: length})' < metadata.json

# Count by author
jq 'group_by(.author) | map({author: .[0].author, count: length})' < metadata.json
```

**Result:** Full overview without fetching bodies (~5KB for 50 comments).

### 2. Fetch High-Priority Bodies

```bash
# Get IDs of human comments
human_ids=$(jq -r '[.[] | select(.author != "coderabbitai")] | .[].id' < metadata.json)

# Fetch those bodies
for id in $human_ids; do
  gh api repos/{owner}/{repo}/pulls/comments/$id --jq '{id, body, path, line}'
done
```

### 3. Batch Acknowledge Bot Comments

```bash
# Get bot comment count
bot_count=$(jq '[.[] | select(.author == "coderabbitai")] | length' < metadata.json)

# Post summary reply
gh pr comment {pr} --body "🙏 Thanks CodeRabbit! Reviewed $bot_count suggestions, addressed top priorities."
```

### 4. Create Hive Cell from Comment

```bash
# Fetch specific comment
comment=$(gh api repos/{owner}/{repo}/pulls/comments/{comment_id} --jq '{path, line, body}')

# Create cell (using hive plugin tool)
hive_create(
  title="PR#42: $(echo $comment | jq -r '.path'):$(echo $comment | jq -r '.line')",
  description="$(echo $comment | jq -r '.body')",
  type="task"
)

# Reply with cell reference
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --method POST \
  --field body="Tracked in {cell_id}" \
  --field in_reply_to_id={comment_id}
```

## Debugging

### View Raw API Response

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments --include
```

**Shows:** Headers, pagination links, rate limit info.

### Test jq Queries Locally

```bash
# Save raw response
gh api repos/{owner}/{repo}/pulls/{pr}/comments > response.json

# Test queries
jq '.[] | {id, path, author: .user.login}' < response.json
```

**Why:** Faster iteration than hitting API repeatedly.

## References

- [GitHub REST API - Pull Request Review Comments](https://docs.github.com/en/rest/pulls/comments)
- [gh CLI Manual](https://cli.github.com/manual/gh_api)
- [jq Manual](https://stedolan.github.io/jq/manual/)
- [CodeRabbit Comment Format](https://coderabbit.ai/docs) (severity markers, suggested fixes)