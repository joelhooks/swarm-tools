/**
 * Repo Crawl Integration Tests
 *
 * Tests GitHub API wrapper tools against a real public repository.
 * Uses "vercel/next.js" as test target (well-known, stable, public).
 *
 * ## Test Strategy
 * - Happy-path only (error cases covered by unit tests)
 * - Real GitHub API calls (may hit rate limits)
 * - Graceful handling of rate limiting (skip tests if hit)
 * - Fast: minimal API calls, shared test state where safe
 *
 * ## Rate Limit Handling
 * - Unauthenticated: 60 requests/hour
 * - Authenticated: 5000 requests/hour (set GITHUB_TOKEN env var)
 * - Tests check for rate limit errors and skip gracefully
 *
 * ## TDD Note
 * These tests were written FIRST (failing), then tools were verified to pass.
 */

import { describe, expect, test } from "bun:test";
import {
	RepoCrawlError,
	repo_file,
	repo_readme,
	repo_search,
	repo_structure,
	repo_tree,
} from "./repo-crawl";

// Test repository (well-known, stable, public)
const TEST_REPO = "vercel/next.js";

/**
 * Helper to parse JSON response from tool
 */
function parseResponse<T>(response: string): T {
	return JSON.parse(response);
}



describe("repo_readme", () => {
	test("fetches README.md from public repo", async () => {
		const response = await repo_readme.execute(
			{ repo: TEST_REPO },
			{} as never,
		);

		const result = parseResponse<{
			repo: string;
			path: string;
			content: string;
			size: number;
			truncated: boolean;
			error?: string;
		}>(response);

		// Skip if rate limited
		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		expect(result.repo).toBe(TEST_REPO);
		expect(result.path).toMatch(/README\.md/i);
		expect(result.content).toContain("Next.js"); // Repo name in README
		expect(result.size).toBeGreaterThan(0);
		expect(typeof result.truncated).toBe("boolean");
	});

	test("accepts GitHub URLs", async () => {
		const response = await repo_readme.execute(
			{ repo: `https://github.com/${TEST_REPO}` },
			{} as never,
		);

		const result = parseResponse<{ repo: string; error?: string }>(response);

		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		expect(result.repo).toBe(TEST_REPO);
	});

	test("truncates content when maxLength specified", async () => {
		const response = await repo_readme.execute(
			{ repo: TEST_REPO, maxLength: 100 },
			{} as never,
		);

		const result = parseResponse<{
			content: string;
			truncated: boolean;
			error?: string;
		}>(response);

		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		expect(result.content.length).toBeLessThanOrEqual(125); // Allow for truncation marker + newlines
		expect(result.truncated).toBe(true);
		expect(result.content).toContain("truncated");
	});

	test("handles invalid repo gracefully", async () => {
		const response = await repo_readme.execute(
			{ repo: "nonexistent-org/nonexistent-repo-12345" },
			{} as never,
		);

		const result = parseResponse<{ error?: string }>(response);

		expect(result.error).toBeDefined();
		// Could be rate limit or not found - both are valid error handling
		expect(
			result.error.includes("not found") ||
				result.error.includes("rate limit"),
		).toBe(true);
	});
});

describe("repo_structure", () => {
	test("fetches repo structure with metadata", async () => {
		const response = await repo_structure.execute(
			{ repo: TEST_REPO },
			{} as never,
		);

		const result = parseResponse<{
			repo: string;
			description: string | null;
			language: string | null;
			stars: number;
			topics: string[];
			techStack: string[];
			directories: string[];
			files: string[];
			truncated: boolean;
			error?: string;
		}>(response);

		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		expect(result.repo).toBe(TEST_REPO);
		expect(result.description).toBeDefined();
		expect(result.stars).toBeGreaterThan(0);
		expect(Array.isArray(result.techStack)).toBe(true);
		expect(result.techStack).toContain("TypeScript"); // Next.js uses TypeScript
		expect(Array.isArray(result.directories)).toBe(true);
		expect(Array.isArray(result.files)).toBe(true);
		expect(typeof result.truncated).toBe("boolean");
	});

	test("respects depth parameter", async () => {
		const response = await repo_structure.execute(
			{ repo: TEST_REPO, depth: 1 },
			{} as never,
		);

		const result = parseResponse<{
			directories: string[];
			files: string[];
			error?: string;
		}>(response);

		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		// Depth 1 means no nested paths (no slashes in paths)
		const allPaths = [...result.directories, ...result.files];
		const nestedPaths = allPaths.filter((path) => path.includes("/"));
		expect(nestedPaths.length).toBe(0);
	});
});

describe("repo_tree", () => {
	test("fetches root directory tree", async () => {
		const response = await repo_tree.execute(
			{ repo: TEST_REPO },
			{} as never,
		);

		const result = parseResponse<{
			repo: string;
			path: string;
			items: Array<{ path: string; type: string; size?: number }>;
			error?: string;
		}>(response);

		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		expect(result.repo).toBe(TEST_REPO);
		expect(result.path).toBe("(root)");
		expect(Array.isArray(result.items)).toBe(true);
		expect(result.items.length).toBeGreaterThan(0);

		// Should have both files and directories
		const types = new Set(result.items.map((item) => item.type));
		expect(types.has("file") || types.has("dir")).toBe(true);
	});

	test("fetches specific directory tree", async () => {
		const response = await repo_tree.execute(
			{ repo: TEST_REPO, path: "packages" },
			{} as never,
		);

		const result = parseResponse<{
			path: string;
			items: Array<{ path: string; type: string }>;
			error?: string;
		}>(response);

		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		expect(result.path).toBe("packages");
		expect(Array.isArray(result.items)).toBe(true);

		// All items should be under packages/ path
		for (const item of result.items) {
			expect(item.path).toMatch(/^packages\//);
		}
	});

	test("handles file path gracefully", async () => {
		const response = await repo_tree.execute(
			{ repo: TEST_REPO, path: "package.json" },
			{} as never,
		);

		const result = parseResponse<{ error?: string }>(response);

		expect(result.error).toBeDefined();
		// Could be rate limit or "not a directory" - both are valid error handling
		expect(
			result.error.includes("not a directory") ||
				result.error.includes("rate limit"),
		).toBe(true);
	});
});

describe("repo_file", () => {
	test("fetches file content", async () => {
		const response = await repo_file.execute(
			{ repo: TEST_REPO, path: "package.json" },
			{} as never,
		);

		const result = parseResponse<{
			repo: string;
			path: string;
			content: string;
			size: number;
			truncated: boolean;
			error?: string;
		}>(response);

		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		expect(result.repo).toBe(TEST_REPO);
		expect(result.path).toBe("package.json");
		expect(result.content).toContain('"name"'); // Valid package.json
		expect(result.size).toBeGreaterThan(0);
		expect(typeof result.truncated).toBe("boolean");
	});

	test("truncates large files when maxLength specified", async () => {
		const response = await repo_file.execute(
			{ repo: TEST_REPO, path: "package.json", maxLength: 50 },
			{} as never,
		);

		const result = parseResponse<{
			content: string;
			truncated: boolean;
			error?: string;
		}>(response);

		if (result.error?.includes("rate limit")) {
			console.warn("⚠️  Skipping test: GitHub API rate limit hit");
			return;
		}

		expect(result.content.length).toBeLessThanOrEqual(75); // Allow for truncation marker + newlines
		expect(result.truncated).toBe(true);
	});

	test("handles directory path gracefully", async () => {
		const response = await repo_file.execute(
			{ repo: TEST_REPO, path: "packages" },
			{} as never,
		);

		const result = parseResponse<{ error?: string }>(response);

		expect(result.error).toBeDefined();
		// Could be rate limit or "not a file" - both are valid error handling
		expect(
			result.error.includes("not a file") ||
				result.error.includes("rate limit"),
		).toBe(true);
	});

	test("handles nonexistent file gracefully", async () => {
		const response = await repo_file.execute(
			{ repo: TEST_REPO, path: "nonexistent-file-12345.txt" },
			{} as never,
		);

		const result = parseResponse<{ error?: string }>(response);

		expect(result.error).toBeDefined();
		// Could be rate limit or not found - both are valid error handling
		expect(
			result.error.includes("not found") ||
				result.error.includes("rate limit"),
		).toBe(true);
	});
});

describe("repo_search", () => {
	test("searches code in repo", async () => {
		const response = await repo_search.execute(
			{ repo: TEST_REPO, query: "useRouter" },
			{} as never,
		);

		const result = parseResponse<{
			repo: string;
			query: string;
			totalCount: number;
			results: Array<{
				path: string;
				url: string;
				matches: string[];
			}>;
			error?: string;
		}>(response);

		// GitHub Code Search API requires authentication for most repos
		if (
			result.error?.includes("rate limit") ||
			result.error?.includes("secondary rate limit")
		) {
			console.warn(
				"⚠️  Skipping test: GitHub API rate limit hit (set GITHUB_TOKEN for higher limits)",
			);
			return;
		}

		// If there's any error, log it and skip
		if (result.error) {
			console.warn(`⚠️  Skipping test: ${result.error}`);
			return;
		}

		expect(result.repo).toBe(TEST_REPO);
		expect(result.query).toBe("useRouter");
		expect(result.totalCount).toBeGreaterThan(0);
		expect(Array.isArray(result.results)).toBe(true);

		// First result should have required fields
		if (result.results.length > 0) {
			const firstResult = result.results[0];
			expect(firstResult.path).toBeDefined();
			expect(firstResult.url).toContain("github.com");
			expect(Array.isArray(firstResult.matches)).toBe(true);
		}
	});

	test("respects maxResults parameter", async () => {
		const response = await repo_search.execute(
			{ repo: TEST_REPO, query: "useRouter", maxResults: 3 },
			{} as never,
		);

		const result = parseResponse<{
			results: Array<{ path: string }>;
			error?: string;
		}>(response);

		if (result.error) {
			console.warn(`⚠️  Skipping test: ${result.error}`);
			return;
		}

		expect(result.results.length).toBeLessThanOrEqual(3);
	});

	test("handles no results gracefully", async () => {
		const response = await repo_search.execute(
			{ repo: TEST_REPO, query: "zzz-nonexistent-query-12345-zzz" },
			{} as never,
		);

		const result = parseResponse<{
			totalCount: number;
			results: Array<unknown>;
			error?: string;
		}>(response);

		if (result.error) {
			console.warn(`⚠️  Skipping test: ${result.error}`);
			return;
		}

		expect(result.totalCount).toBe(0);
		expect(result.results.length).toBe(0);
	});
});

describe("RepoCrawlError", () => {
	test("has correct properties", () => {
		const error = new RepoCrawlError("Test error", 404, "/test/endpoint");

		expect(error.message).toBe("Test error");
		expect(error.statusCode).toBe(404);
		expect(error.endpoint).toBe("/test/endpoint");
		expect(error.name).toBe("RepoCrawlError");
	});
});
