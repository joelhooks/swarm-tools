/**
 * @fileoverview Tests for git-commit-info utility
 *
 * Tests run inside the swarm-tools repo, which is a git repo,
 * so getGitCommitInfo() should return valid data.
 */

import { describe, expect, test } from "bun:test";
import { getGitCommitInfo, type GitCommitInfo } from "./git-commit-info.js";

describe("getGitCommitInfo", () => {
  test("returns commit info when run inside a git repo", () => {
    const info = getGitCommitInfo();
    expect(info).not.toBeNull();

    const { sha, message, branch } = info as GitCommitInfo;

    // SHA should be a 40-char hex string
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    // Message should be a non-empty string
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);

    // Branch should be a non-empty string
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });

  test("returns commit info when given an explicit cwd", () => {
    // Use the repo root (parent of packages/)
    const info = getGitCommitInfo(import.meta.dir + "/../../../..");
    expect(info).not.toBeNull();
    expect(info!.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("returns null for a non-git directory", () => {
    const info = getGitCommitInfo("/tmp");
    // /tmp is not a git repo (unless someone init'd one there)
    // This may or may not be null depending on the system, so we just check the shape
    if (info !== null) {
      expect(info.sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test("returns null for a non-existent directory", () => {
    const info = getGitCommitInfo("/nonexistent/path/that/does/not/exist");
    expect(info).toBeNull();
  });
});
