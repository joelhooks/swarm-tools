/**
 * Repo Crawl Module - GitHub API tools for repository research
 *
 * Provides lightweight tools to explore GitHub repositories without cloning.
 * Uses GitHub REST API v3 with optional authentication for higher rate limits.
 *
 * Features:
 * - Parse repo from various formats (owner/repo, URLs)
 * - Support GITHUB_TOKEN env var for auth (optional)
 * - Handle rate limiting gracefully (return error, don't throw)
 * - No external dependencies (uses fetch)
 *
 * Rate Limits:
 * - Unauthenticated: 60 requests/hour
 * - Authenticated: 5000 requests/hour
 *
 * @example
 * ```typescript
 * // Get README
 * repo_readme({ repo: "vercel/next.js" })
 *
 * // Get repo structure
 * repo_structure({ repo: "facebook/react", depth: 2 })
 *
 * // Search code
 * repo_search({ repo: "remix-run/remix", query: "useLoaderData" })
 * ```
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

// ============================================================================
// Configuration
// ============================================================================

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_MAX_LENGTH = 10000;
const DEFAULT_DEPTH = 2;

// ============================================================================
// Types
// ============================================================================

/** GitHub API response for repository */
interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  topics: string[];
}

/** GitHub API response for file content */
interface GitHubContent {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  content?: string;
  encoding?: string;
  download_url?: string;
}

/** GitHub API response for tree */
interface GitHubTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

/** GitHub API response for search */
interface GitHubSearchResult {
  total_count: number;
  items: Array<{
    name: string;
    path: string;
    repository: {
      full_name: string;
    };
    html_url: string;
    text_matches?: Array<{
      fragment: string;
    }>;
  }>;
}

// ============================================================================
// Errors
// ============================================================================

export class RepoCrawlError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = "RepoCrawlError";
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Parse owner/repo from various formats
 *
 * Supports:
 * - "owner/repo"
 * - "github.com/owner/repo"
 * - "https://github.com/owner/repo"
 * - "https://github.com/owner/repo.git"
 *
 * @returns { owner, repo } or throws if invalid
 */
function parseRepo(input: string): { owner: string; repo: string } {
  // Remove protocol and .git suffix
  let normalized = input
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/^github\.com\//, "");

  // Split by slash
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new RepoCrawlError(
      `Invalid repo format: "${input}". Expected "owner/repo" or GitHub URL.`,
    );
  }

  const [owner, repo] = parts;
  return { owner, repo };
}

/**
 * Make a GitHub API request with auth if available
 */
async function githubFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "opencode-swarm-plugin",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const url = `${GITHUB_API_URL}${endpoint}`;
  const response = await fetch(url, { ...options, headers });

  // Handle rate limiting
  if (response.status === 403) {
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    const rateLimitReset = response.headers.get("x-ratelimit-reset");

    if (rateLimitRemaining === "0" && rateLimitReset) {
      const resetDate = new Date(parseInt(rateLimitReset) * 1000);
      throw new RepoCrawlError(
        `GitHub API rate limit exceeded. Resets at ${resetDate.toISOString()}. ` +
          `${GITHUB_TOKEN ? "Using authenticated token." : "Set GITHUB_TOKEN env var for higher limits."}`,
        403,
        endpoint,
      );
    }
  }

  // Handle not found
  if (response.status === 404) {
    throw new RepoCrawlError(`Resource not found: ${endpoint}`, 404, endpoint);
  }

  // Handle other errors
  if (!response.ok) {
    const body = await response.text();
    throw new RepoCrawlError(
      `GitHub API error (${response.status}): ${body}`,
      response.status,
      endpoint,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Decode base64 content from GitHub API
 */
function decodeContent(content: string, encoding: string): string {
  if (encoding === "base64") {
    return Buffer.from(content, "base64").toString("utf-8");
  }
  return content;
}

/**
 * Detect tech stack from file extensions and package files
 */
function detectTechStack(tree: GitHubTreeItem[]): string[] {
  const stack = new Set<string>();

  const filePatterns: Record<string, string> = {
    "package.json": "Node.js/npm",
    "yarn.lock": "Yarn",
    "pnpm-lock.yaml": "pnpm",
    "bun.lockb": "Bun",
    "Cargo.toml": "Rust",
    "go.mod": "Go",
    "requirements.txt": "Python/pip",
    Pipfile: "Python/pipenv",
    "pyproject.toml": "Python/poetry",
    Gemfile: "Ruby/Bundler",
    "composer.json": "PHP/Composer",
    "pom.xml": "Java/Maven",
    "build.gradle": "Java/Gradle",
    "tsconfig.json": "TypeScript",
    "next.config.js": "Next.js",
    "nuxt.config.js": "Nuxt.js",
    "vue.config.js": "Vue.js",
    "angular.json": "Angular",
    "svelte.config.js": "Svelte",
    Dockerfile: "Docker",
    "docker-compose.yml": "Docker Compose",
    ".terraform": "Terraform",
    Makefile: "Make",
  };

  for (const item of tree) {
    const basename = item.path.split("/").pop() || "";

    // Check exact matches
    if (filePatterns[basename]) {
      stack.add(filePatterns[basename]);
    }

    // Check extensions
    if (basename.endsWith(".rs")) stack.add("Rust");
    if (basename.endsWith(".go")) stack.add("Go");
    if (basename.endsWith(".py")) stack.add("Python");
    if (basename.endsWith(".rb")) stack.add("Ruby");
    if (basename.endsWith(".php")) stack.add("PHP");
    if (basename.endsWith(".java")) stack.add("Java");
    if (basename.endsWith(".kt")) stack.add("Kotlin");
    if (basename.endsWith(".swift")) stack.add("Swift");
    if (basename.endsWith(".ts") || basename.endsWith(".tsx"))
      stack.add("TypeScript");
    if (basename.endsWith(".jsx")) stack.add("React");
  }

  return Array.from(stack).sort();
}

/**
 * Truncate text to max length with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "\n\n[... truncated ...]";
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Get README.md content from a repository
 */
export const repo_readme = tool({
  description: "Get README.md content from a GitHub repository",
  args: {
    repo: tool.schema
      .string()
      .describe('Repository (e.g., "owner/repo" or GitHub URL)'),
    maxLength: tool.schema
      .number()
      .optional()
      .describe(`Max content length (default: ${DEFAULT_MAX_LENGTH})`),
  },
  async execute(args, ctx) {
    try {
      const { owner, repo } = parseRepo(args.repo);
      const maxLength = args.maxLength || DEFAULT_MAX_LENGTH;

      // Fetch README
      const readme = await githubFetch<GitHubContent>(
        `/repos/${owner}/${repo}/readme`,
      );

      if (!readme.content || !readme.encoding) {
        return "README exists but content is not available";
      }

      const content = decodeContent(readme.content, readme.encoding);
      const truncated = truncate(content, maxLength);

      return JSON.stringify(
        {
          repo: `${owner}/${repo}`,
          path: readme.path,
          size: readme.size,
          content: truncated,
          truncated: content.length > maxLength,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof RepoCrawlError) {
        return JSON.stringify({ error: error.message }, null, 2);
      }
      throw error;
    }
  },
});

/**
 * Get repository structure and detect tech stack
 */
export const repo_structure = tool({
  description:
    "Get repository structure with tech stack detection (root level only by default)",
  args: {
    repo: tool.schema
      .string()
      .describe('Repository (e.g., "owner/repo" or GitHub URL)'),
    depth: tool.schema
      .number()
      .optional()
      .describe(
        `Tree depth (1=root only, 2=one level deep, etc. Default: ${DEFAULT_DEPTH})`,
      ),
  },
  async execute(args, ctx) {
    try {
      const { owner, repo } = parseRepo(args.repo);
      const depth = args.depth || DEFAULT_DEPTH;

      // Fetch repo metadata
      const repoInfo = await githubFetch<GitHubRepo>(`/repos/${owner}/${repo}`);

      // Fetch git tree
      const tree = await githubFetch<{
        tree: GitHubTreeItem[];
        truncated: boolean;
      }>(`/repos/${owner}/${repo}/git/trees/${repoInfo.default_branch}`, {
        method: "GET",
      });

      // Filter by depth
      const filtered = tree.tree.filter((item) => {
        const pathDepth = item.path.split("/").length;
        return pathDepth <= depth;
      });

      // Detect tech stack
      const techStack = detectTechStack(filtered);

      // Group by type
      const dirs = filtered
        .filter((item) => item.type === "tree")
        .map((item) => item.path);
      const files = filtered
        .filter((item) => item.type === "blob")
        .map((item) => item.path);

      return JSON.stringify(
        {
          repo: repoInfo.full_name,
          description: repoInfo.description,
          language: repoInfo.language,
          stars: repoInfo.stargazers_count,
          topics: repoInfo.topics,
          techStack,
          directories: dirs.slice(0, 50), // Limit output
          files: files.slice(0, 50), // Limit output
          truncated: tree.truncated || dirs.length > 50 || files.length > 50,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof RepoCrawlError) {
        return JSON.stringify({ error: error.message }, null, 2);
      }
      throw error;
    }
  },
});

/**
 * Get directory tree for a specific path
 */
export const repo_tree = tool({
  description: "Get directory tree for a path in a repository",
  args: {
    repo: tool.schema
      .string()
      .describe('Repository (e.g., "owner/repo" or GitHub URL)'),
    path: tool.schema
      .string()
      .optional()
      .describe("Path in repo (default: root)"),
    maxDepth: tool.schema
      .number()
      .optional()
      .describe(`Max depth to traverse (default: ${DEFAULT_DEPTH})`),
  },
  async execute(args, ctx) {
    try {
      const { owner, repo } = parseRepo(args.repo);
      const targetPath = args.path || "";
      const maxDepth = args.maxDepth || DEFAULT_DEPTH;

      // Fetch repo info for default branch
      const repoInfo = await githubFetch<GitHubRepo>(`/repos/${owner}/${repo}`);

      // Fetch contents at path
      const contents = await githubFetch<GitHubContent[]>(
        `/repos/${owner}/${repo}/contents/${targetPath}`,
      );

      if (!Array.isArray(contents)) {
        return JSON.stringify({ error: "Path is a file, not a directory" });
      }

      // Build tree structure
      const tree: Array<{ path: string; type: string; size?: number }> = [];

      for (const item of contents) {
        tree.push({
          path: item.path,
          type: item.type,
          size: item.size,
        });

        // Recursively fetch subdirectories (up to maxDepth)
        if (item.type === "dir" && maxDepth > 1) {
          try {
            const subContents = await githubFetch<GitHubContent[]>(
              `/repos/${owner}/${repo}/contents/${item.path}`,
            );
            if (Array.isArray(subContents)) {
              for (const subItem of subContents.slice(0, 20)) {
                // Limit per dir
                tree.push({
                  path: subItem.path,
                  type: subItem.type,
                  size: subItem.size,
                });
              }
            }
          } catch {
            // Ignore errors fetching subdirectories
          }
        }
      }

      return JSON.stringify(
        {
          repo: `${owner}/${repo}`,
          path: targetPath || "(root)",
          items: tree,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof RepoCrawlError) {
        return JSON.stringify({ error: error.message }, null, 2);
      }
      throw error;
    }
  },
});

/**
 * Get file content from repository
 */
export const repo_file = tool({
  description: "Get file content from a GitHub repository",
  args: {
    repo: tool.schema
      .string()
      .describe('Repository (e.g., "owner/repo" or GitHub URL)'),
    path: tool.schema.string().describe("File path in repository"),
    maxLength: tool.schema
      .number()
      .optional()
      .describe(`Max content length (default: ${DEFAULT_MAX_LENGTH})`),
  },
  async execute(args, ctx) {
    try {
      const { owner, repo } = parseRepo(args.repo);
      const maxLength = args.maxLength || DEFAULT_MAX_LENGTH;

      // Fetch file content
      const file = await githubFetch<GitHubContent>(
        `/repos/${owner}/${repo}/contents/${args.path}`,
      );

      if (file.type !== "file") {
        return JSON.stringify({ error: "Path is not a file" });
      }

      if (!file.content || !file.encoding) {
        return JSON.stringify({ error: "File content not available" });
      }

      const content = decodeContent(file.content, file.encoding);
      const truncated = truncate(content, maxLength);

      return JSON.stringify(
        {
          repo: `${owner}/${repo}`,
          path: file.path,
          size: file.size,
          content: truncated,
          truncated: content.length > maxLength,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof RepoCrawlError) {
        return JSON.stringify({ error: error.message }, null, 2);
      }
      throw error;
    }
  },
});

/**
 * Search code in a repository
 */
export const repo_search = tool({
  description: "Search code in a GitHub repository",
  args: {
    repo: tool.schema
      .string()
      .describe('Repository (e.g., "owner/repo" or GitHub URL)'),
    query: tool.schema.string().describe("Search query (GitHub code search)"),
    maxResults: tool.schema
      .number()
      .optional()
      .describe(`Max results (default: ${DEFAULT_MAX_RESULTS})`),
  },
  async execute(args, ctx) {
    try {
      const { owner, repo } = parseRepo(args.repo);
      const maxResults = args.maxResults || DEFAULT_MAX_RESULTS;

      // GitHub search API requires "repo:" qualifier
      const searchQuery = `${args.query} repo:${owner}/${repo}`;

      // Search code
      const results = await githubFetch<GitHubSearchResult>(
        `/search/code?q=${encodeURIComponent(searchQuery)}&per_page=${maxResults}`,
      );

      const items = results.items.map((item) => ({
        path: item.path,
        url: item.html_url,
        matches: item.text_matches?.map((m) => m.fragment) || [],
      }));

      return JSON.stringify(
        {
          repo: `${owner}/${repo}`,
          query: args.query,
          totalCount: results.total_count,
          results: items,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof RepoCrawlError) {
        return JSON.stringify({ error: error.message }, null, 2);
      }
      throw error;
    }
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const repoCrawlTools = {
  repo_readme,
  repo_structure,
  repo_tree,
  repo_file,
  repo_search,
};
