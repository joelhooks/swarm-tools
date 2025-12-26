#!/usr/bin/env bun

/**
 * Fetch GitHub contributor profile including Twitter handle
 * 
 * Usage:
 *   bun run get-contributor.ts <login>
 *   bun run get-contributor.ts bcheung
 * 
 * Returns JSON with:
 *   - login (GitHub username)
 *   - name (display name)
 *   - twitter_username (if set in profile)
 *   - blog (website URL)
 *   - bio (profile description)
 *   - avatar_url
 *   - html_url (GitHub profile)
 */

import { z } from "zod";

const GitHubUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  twitter_username: z.string().nullable(),
  blog: z.string().nullable(),
  bio: z.string().nullable(),
  avatar_url: z.string(),
  html_url: z.string(),
  public_repos: z.number().optional(),
  followers: z.number().optional(),
});

type GitHubUser = z.infer<typeof GitHubUserSchema>;

async function getContributor(login: string): Promise<GitHubUser> {
  // Use gh CLI to fetch user profile
  const result = await Bun.$`gh api users/${login}`.json();
  
  // Validate response
  const user = GitHubUserSchema.parse(result);
  
  return user;
}

function formatOutput(user: GitHubUser): string {
  const parts = [
    `Login: ${user.login}`,
    user.name ? `Name: ${user.name}` : null,
    user.twitter_username ? `Twitter: @${user.twitter_username}` : "Twitter: N/A",
    user.blog ? `Blog: ${user.blog}` : null,
    user.bio ? `Bio: ${user.bio}` : null,
    `Profile: ${user.html_url}`,
  ].filter(Boolean);
  
  return parts.join("\n");
}

function formatForChangeset(user: GitHubUser): string {
  if (user.twitter_username) {
    return `Thanks @${user.twitter_username} for the report!`;
  }
  
  if (user.name && user.blog) {
    return `Thanks ${user.name} (${user.blog}) for the report!`;
  }
  
  if (user.name) {
    return `Thanks ${user.name} (@${user.login}) for the report!`;
  }
  
  return `Thanks @${user.login} for the report!`;
}

// CLI
if (import.meta.main) {
  const [login] = Bun.argv.slice(2);
  
  if (!login) {
    console.error("Usage: bun run get-contributor.ts <login>");
    console.error("Example: bun run get-contributor.ts bcheung");
    process.exit(1);
  }
  
  try {
    const user = await getContributor(login);
    
    console.log("\n📝 Contributor Profile\n");
    console.log(formatOutput(user));
    console.log("\n✨ Changeset Credit (copy/paste)\n");
    console.log(formatForChangeset(user));
    console.log();
    
    // Also output JSON for programmatic use
    if (Bun.argv.includes("--json")) {
      console.log("\n📦 JSON Output\n");
      console.log(JSON.stringify(user, null, 2));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

export { getContributor, formatForChangeset, type GitHubUser };
