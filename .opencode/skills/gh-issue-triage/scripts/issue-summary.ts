#!/usr/bin/env bun

/**
 * Fetch GitHub issue summary for triage
 * 
 * Usage:
 *   bun run issue-summary.ts <owner/repo> <number>
 *   bun run issue-summary.ts joelhooks/opencode-swarm-plugin 42
 * 
 * Returns JSON with:
 *   - number
 *   - title
 *   - body
 *   - state (open/closed)
 *   - author (login, name if available)
 *   - labels
 *   - url
 *   - created_at
 *   - updated_at
 */

import { z } from "zod";

const IssueAuthorSchema = z.object({
  login: z.string(),
});

const IssueLabelSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
});

const IssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  author: IssueAuthorSchema,
  labels: z.array(IssueLabelSchema),
  url: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type Issue = z.infer<typeof IssueSchema>;

async function getIssueSummary(repo: string, issueNumber: number): Promise<Issue> {
  // Use gh CLI to fetch issue
  // Fields match GraphQL API names
  const result = await Bun.$`gh issue view ${issueNumber} --repo ${repo} --json number,title,body,state,author,labels,url,createdAt,updatedAt`.json();
  
  // Validate response
  const issue = IssueSchema.parse(result);
  
  return issue;
}

function formatOutput(issue: Issue): string {
  const parts = [
    `#${issue.number}: ${issue.title}`,
    `State: ${issue.state}`,
    `Author: @${issue.author.login}`,
    issue.labels.length > 0 ? `Labels: ${issue.labels.map(l => l.name).join(", ")}` : null,
    `URL: ${issue.url}`,
    "",
    issue.body || "(no description)",
  ].filter(Boolean);
  
  return parts.join("\n");
}

function formatForCell(issue: Issue, contributorInfo?: { name?: string | null; twitter?: string | null }): string {
  const lines = [
    issue.url,
    "",
    `Reported by: ${contributorInfo?.name || `@${issue.author.login}`}`,
  ];
  
  if (contributorInfo?.twitter) {
    lines.push(`Twitter: @${contributorInfo.twitter}`);
  }
  
  lines.push(`GitHub: @${issue.author.login}`);
  lines.push("");
  
  // Truncate body to ~500 chars for cell description
  const body = issue.body || "(no description)";
  if (body.length > 500) {
    lines.push(`${body.slice(0, 497)}...`);
  } else {
    lines.push(body);
  }
  
  return lines.join("\n");
}

// CLI
if (import.meta.main) {
  const [repo, issueNumberStr] = Bun.argv.slice(2);
  
  if (!repo || !issueNumberStr) {
    console.error("Usage: bun run issue-summary.ts <owner/repo> <number>");
    console.error("Example: bun run issue-summary.ts joelhooks/opencode-swarm-plugin 42");
    process.exit(1);
  }
  
  const issueNumber = Number.parseInt(issueNumberStr, 10);
  if (Number.isNaN(issueNumber)) {
    console.error(`Invalid issue number: ${issueNumberStr}`);
    process.exit(1);
  }
  
  try {
    const issue = await getIssueSummary(repo, issueNumber);
    
    console.log("\n📋 Issue Summary\n");
    console.log(formatOutput(issue));
    console.log();
    
    console.log("\n📝 Cell Description Template (copy/paste)\n");
    console.log(formatForCell(issue));
    console.log();
    
    // Also output JSON for programmatic use
    if (Bun.argv.includes("--json")) {
      console.log("\n📦 JSON Output\n");
      console.log(JSON.stringify(issue, null, 2));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

export { getIssueSummary, formatForCell, type Issue };
