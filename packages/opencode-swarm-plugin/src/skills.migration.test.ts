/**
 * Integration test for native skills migration
 *
 * Tests that bundled skills are successfully migrated from global-skills/ to .opencode/skill/
 * and are discoverable by the skills system.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import {
  discoverSkills,
  getSkill,
  setSkillsProjectDirectory,
  invalidateSkillsCache,
} from "./skills";
import { fileURLToPath } from "url";

// Get the package directory
const PACKAGE_DIR = join(fileURLToPath(import.meta.url), "..", "..");

// Bundled skills that should be discoverable after migration
const BUNDLED_SKILLS = [
  "testing-patterns",
  "swarm-coordination",
  "cli-builder",
  "learning-systems",
  "skill-creator",
  "system-design",
];

describe("Native Skills Migration", () => {
  const originalProjectDir = process.cwd();

  beforeEach(() => {
    // Reset to package directory
    setSkillsProjectDirectory(PACKAGE_DIR);
    invalidateSkillsCache();
  });

  afterEach(() => {
    setSkillsProjectDirectory(originalProjectDir);
    invalidateSkillsCache();
  });

  describe("bundled skills location", () => {
    it("skills exist in .opencode/skill/ directory (singular)", () => {
      const skillDir = join(PACKAGE_DIR, ".opencode", "skill");

      for (const skillName of BUNDLED_SKILLS) {
        const skillPath = join(skillDir, skillName, "SKILL.md");
        expect(
          existsSync(skillPath),
          `Expected bundled skill '${skillName}' to exist at ${skillPath}`,
        ).toBe(true);
      }
    });

    it("skills do NOT exist in global-skills/ directory after migration", () => {
      const globalSkillsDir = join(PACKAGE_DIR, "global-skills");

      for (const skillName of BUNDLED_SKILLS) {
        const skillPath = join(globalSkillsDir, skillName, "SKILL.md");
        expect(
          existsSync(skillPath),
          `Expected bundled skill '${skillName}' to be removed from global-skills/`,
        ).toBe(false);
      }
    });
  });

  describe("skill discovery", () => {
    it("discovers all 6 bundled skills from .opencode/skill/", async () => {
      const skills = await discoverSkills();

      for (const skillName of BUNDLED_SKILLS) {
        expect(
          skills.has(skillName),
          `Expected to discover bundled skill '${skillName}'`,
        ).toBe(true);
      }
    });

    it("loads bundled skills with correct metadata", async () => {
      const skills = await discoverSkills();

      // Verify a few key skills have correct format
      const testingPatterns = skills.get("testing-patterns");
      expect(testingPatterns).toBeDefined();
      expect(testingPatterns!.metadata.name).toBe("testing-patterns");
      expect(testingPatterns!.metadata.description).toContain("testing");
      expect(testingPatterns!.path).toContain(".opencode");
      expect(testingPatterns!.path).toContain("skill"); // singular
      expect(testingPatterns!.path).not.toContain("global-skills");
    });

    it("swarm-coordination skill has expected tools", async () => {
      const skill = await getSkill("swarm-coordination");

      expect(skill).toBeDefined();
      expect(skill!.metadata.tools).toBeDefined();
      expect(skill!.metadata.tools!.length).toBeGreaterThan(0);
    });

    it("swarm-coordination skill has comprehensive tools", async () => {
      const skill = await getSkill("swarm-coordination");

      expect(skill).toBeDefined();
      expect(skill!.metadata.tools).toBeDefined();
      // Should include swarm_* and hive_* tools
      const tools = skill!.metadata.tools!;
      expect(
        tools.some((t) => t.startsWith("swarm_")),
        "Expected swarm_* tools in swarm-coordination skill",
      ).toBe(true);
      expect(
        tools.some((t) => t.startsWith("hive_")),
        "Expected hive_* tools in swarm-coordination skill",
      ).toBe(true);
    });
  });

  describe("skill frontmatter validation", () => {
    it("all bundled skills have valid frontmatter", async () => {
      const skills = await discoverSkills();

      for (const skillName of BUNDLED_SKILLS) {
        const skill = skills.get(skillName);
        expect(skill, `Skill '${skillName}' should be discoverable`).toBeDefined();

        // Verify required fields
        expect(skill!.metadata.name).toBe(skillName);
        expect(skill!.metadata.description).toBeTruthy();
        expect(skill!.metadata.description.length).toBeGreaterThan(0);
        expect(skill!.metadata.description.length).toBeLessThanOrEqual(1024);

        // Verify name format (lowercase alphanumeric with hyphens)
        expect(/^[a-z0-9-]+$/.test(skill!.metadata.name)).toBe(true);
        expect(skill!.metadata.name.length).toBeLessThanOrEqual(64);
      }
    });

    it("skill references files are preserved", () => {
      const testingPatternsPath = join(
        PACKAGE_DIR,
        ".opencode",
        "skill",
        "testing-patterns",
        "references",
        "dependency-breaking-catalog.md",
      );

      expect(
        existsSync(testingPatternsPath),
        "Expected reference files to be migrated with skill",
      ).toBe(true);
    });
  });

  describe("backwards compatibility", () => {
    it("still discovers skills from .claude/skills/ if present", async () => {
      // Create temporary .claude/skills/ directory
      const testDir = join(PACKAGE_DIR, `.test-back compat-${Date.now()}`);
      const claudeSkillsDir = join(testDir, ".claude", "skills");
      mkdirSync(claudeSkillsDir, { recursive: true });

      try {
        // Write a test skill
        const testSkillContent = `---
name: compat-test-skill
description: Test for backwards compatibility
---
# Compat Test
`;
        const testSkillPath = join(claudeSkillsDir, "compat-test-skill", "SKILL.md");
        mkdirSync(join(claudeSkillsDir, "compat-test-skill"), { recursive: true });
        // Note: We're using Buffer.from to avoid writeFileSync type issues in some test environments
        import("fs").then(({ writeFileSync }) => {
          writeFileSync(testSkillPath, Buffer.from(testSkillContent));
        });

        // Switch to test directory and discover
        setSkillsProjectDirectory(testDir);
        invalidateSkillsCache();

        const skills = await discoverSkills();
        expect(
          skills.has("compat-test-skill"),
          "Should discover skills from .claude/skills/ for backwards compatibility",
        ).toBe(true);
      } finally {
        // Cleanup
        if (existsSync(testDir)) {
          rmSync(testDir, { recursive: true, force: true });
        }
      }
    });
  });
});
