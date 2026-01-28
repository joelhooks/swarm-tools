import { execSync } from "child_process";

export interface GitCommitInfo {
  sha: string;
  message: string;
  branch: string;
}

/**
 * Get current git commit info. Returns null if not in a git repo or on error.
 */
export function getGitCommitInfo(cwd?: string): GitCommitInfo | null {
  try {
    const opts = { cwd, encoding: "utf-8" as const, timeout: 5000 };
    const sha = execSync("git rev-parse HEAD", opts).trim();
    const message = execSync("git log -1 --format=%s", opts).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", opts).trim();
    return { sha, message, branch };
  } catch {
    return null;
  }
}
