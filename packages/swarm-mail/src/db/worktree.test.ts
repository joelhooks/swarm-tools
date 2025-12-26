import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMainRepoPath, isWorktree, resolveDbPath } from "./worktree.js";
import { getOldProjectDbPaths } from "../streams/index.js";

describe("worktree path resolution", () => {
	let testDir: string;
	let mainRepoDir: string;
	let worktreeDir: string;

	beforeEach(() => {
		// Create temp test directory
		testDir = join(tmpdir(), `worktree-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });

		// Create main repo structure
		mainRepoDir = join(testDir, "main-repo");
		mkdirSync(mainRepoDir, { recursive: true });
		mkdirSync(join(mainRepoDir, ".git", "worktrees"), { recursive: true });

		// Create worktree structure
		worktreeDir = join(testDir, "worktree");
		mkdirSync(worktreeDir, { recursive: true });

		// Write .git file in worktree (not directory)
		const gitdirPath = join(mainRepoDir, ".git", "worktrees", "worktree");
		writeFileSync(
			join(worktreeDir, ".git"),
			`gitdir: ${gitdirPath}\n`,
			"utf-8",
		);
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe("isWorktree", () => {
		test("returns true when .git is a file", () => {
			expect(isWorktree(worktreeDir)).toBe(true);
		});

		test("returns false when .git is a directory", () => {
			expect(isWorktree(mainRepoDir)).toBe(false);
		});

		test("returns false when .git does not exist", () => {
			const nonGitDir = join(testDir, "not-a-repo");
			mkdirSync(nonGitDir, { recursive: true });
			expect(isWorktree(nonGitDir)).toBe(false);
		});
	});

	describe("getMainRepoPath", () => {
		test("returns main repo path from worktree", () => {
			const result = getMainRepoPath(worktreeDir);
			expect(result).toBe(mainRepoDir);
		});

		test("returns same path if already in main repo", () => {
			const result = getMainRepoPath(mainRepoDir);
			expect(result).toBe(mainRepoDir);
		});

		test("throws error if .git file cannot be parsed", () => {
			// Write invalid .git file
			const invalidWorktree = join(testDir, "invalid-worktree");
			mkdirSync(invalidWorktree, { recursive: true });
			writeFileSync(join(invalidWorktree, ".git"), "invalid content\n", "utf-8");

			expect(() => getMainRepoPath(invalidWorktree)).toThrow();
		});
	});

	describe("resolveDbPath", () => {
		test("uses main repo path for DB location when in worktree", () => {
			const dbPath = resolveDbPath(worktreeDir);
			expect(dbPath).toBe(join(mainRepoDir, ".opencode", "swarm.db"));
		});

		test("uses same path for DB location when in main repo", () => {
			const dbPath = resolveDbPath(mainRepoDir);
			expect(dbPath).toBe(join(mainRepoDir, ".opencode", "swarm.db"));
		});

		test("resolves custom filename", () => {
			const dbPath = resolveDbPath(worktreeDir, "custom.db");
			expect(dbPath).toBe(join(mainRepoDir, ".opencode", "custom.db"));
		});
	});

	describe("integration with getOldProjectDbPaths", () => {
		test("resolves old DB paths to main repo when in worktree", async () => {
			// Import should work now that we've added the import
			const paths = getOldProjectDbPaths(worktreeDir);

			// Should point to main repo's .opencode, not worktree's
			expect(paths.libsql).toBe(join(mainRepoDir, ".opencode", "streams.db"));
			expect(paths.pglite).toBe(join(mainRepoDir, ".opencode", "streams"));
		});

		test("resolves old DB paths normally when in main repo", async () => {
			const paths = getOldProjectDbPaths(mainRepoDir);

			expect(paths.libsql).toBe(join(mainRepoDir, ".opencode", "streams.db"));
			expect(paths.pglite).toBe(join(mainRepoDir, ".opencode", "streams"));
		});
	});
});
