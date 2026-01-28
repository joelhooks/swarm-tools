/**
 * Skills Integration Tests
 *
 * Tests all skills_* tools with real filesystem operations.
 * These are happy-path integration tests verifying tools work end-to-end.
 *
 * Tools under test:
 * - skills_list
 * - skills_read
 * - skills_use
 * - skills_create
 * - skills_update
 * - skills_delete
 * - skills_init
 * - skills_add_script
 * - skills_execute
 */

import { describe, expect, it, afterAll, beforeEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  skills_list,
  skills_read,
  skills_use,
  skills_create,
  skills_update,
  skills_delete,
  skills_init,
  skills_add_script,
  skills_execute,
  setSkillsProjectDirectory,
  invalidateSkillsCache,
} from "./skills";

// =============================================================================
// Test Setup
// =============================================================================

const TEST_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_DIR = join(process.cwd(), `.test-skills-integration-${TEST_RUN_ID}`);
const SKILLS_DIR = join(TEST_DIR, ".opencode", "skill"); // Note: singular "skill" to match PROJECT_SKILL_DIRECTORIES

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function setupTestDir() {
  cleanupTestDir();
  mkdirSync(SKILLS_DIR, { recursive: true });
  setSkillsProjectDirectory(TEST_DIR);
  invalidateSkillsCache();
}

// =============================================================================
// skills_list Tool
// =============================================================================

describe("skills_list tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should list empty skills directory", async () => {
    const result = await skills_list.execute({});

    // May find global skills, so just verify it doesn't error
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("should list discovered skills with metadata", async () => {
    // Create a test skill first
    await skills_create.execute({
      name: "test-skill",
      description: "Use when testing - this is a test skill",
      body: "# Test Instructions\n\nDo the thing.",
      tags: ["testing"],
    });

    invalidateSkillsCache();
    const result = await skills_list.execute({});

    // Should include our test skill (may include global skills too)
    expect(result).toContain("test-skill");
    expect(result).toContain("Use when testing");
    expect(result).toContain("(testing)");
  });

  it("should filter skills by tag", async () => {
    await skills_create.execute({
      name: "skill-a",
      description: "Use when A",
      body: "A",
      tags: ["frontend"],
    });

    await skills_create.execute({
      name: "skill-b",
      description: "Use when B",
      body: "B",
      tags: ["backend"],
    });

    invalidateSkillsCache();
    const result = await skills_list.execute({ tag: "frontend" });

    expect(result).toContain("skill-a");
    expect(result).not.toContain("skill-b");
  });

  it("should show [has scripts] indicator", async () => {
    await skills_create.execute({
      name: "with-scripts",
      description: "Use when scripting",
      body: "Scripts",
    });

    await skills_add_script.execute({
      skill: "with-scripts",
      script_name: "helper.sh",
      content: "#!/bin/bash\necho hi",
    });

    invalidateSkillsCache();
    const result = await skills_list.execute({});

    expect(result).toContain("with-scripts");
    expect(result).toContain("[has scripts]");
  });
});

// =============================================================================
// skills_use Tool
// =============================================================================

describe("skills_use tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should activate a skill and return full content", async () => {
    const body = "# Test Skill\n\nThese are the instructions.";
    await skills_create.execute({
      name: "test-skill",
      description: "Use when testing",
      body,
    });

    invalidateSkillsCache();
    const result = await skills_use.execute({ name: "test-skill" });

    expect(result).toContain("# Skill: test-skill");
    expect(result).toContain(body);
  });

  it("should list available scripts when skill has them", async () => {
    await skills_create.execute({
      name: "scripted-skill",
      description: "Use when scripting",
      body: "Instructions",
    });

    await skills_add_script.execute({
      skill: "scripted-skill",
      script_name: "setup.sh",
      content: "#!/bin/bash\necho setup",
    });

    invalidateSkillsCache();
    const result = await skills_use.execute({ name: "scripted-skill" });

    expect(result).toContain("Available Scripts");
    expect(result).toContain("setup.sh");
    expect(result).toContain("skills_execute");
  });

  it("should exclude scripts when include_scripts=false", async () => {
    await skills_create.execute({
      name: "scripted-skill",
      description: "Use when scripting",
      body: "Instructions",
    });

    await skills_add_script.execute({
      skill: "scripted-skill",
      script_name: "setup.sh",
      content: "#!/bin/bash\necho setup",
    });

    invalidateSkillsCache();
    const result = await skills_use.execute({
      name: "scripted-skill",
      include_scripts: false,
    });

    expect(result).not.toContain("Available Scripts");
    expect(result).not.toContain("setup.sh");
  });

  it("should return error for non-existent skill", async () => {
    const result = await skills_use.execute({ name: "non-existent" });

    expect(result).toContain("not found");
    expect(result).toContain("Available skills:");
  });
});

// =============================================================================
// skills_read Tool
// =============================================================================

describe("skills_read tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should read a resource file from skill directory", async () => {
    await skills_create.execute({
      name: "documented-skill",
      description: "Use when documenting",
      body: "Instructions",
    });

    // Manually create a reference file
    const skillDir = join(SKILLS_DIR, "documented-skill");
    const exampleContent = "# Examples\n\nExample content here.";
    writeFileSync(join(skillDir, "examples.md"), exampleContent);

    const result = await skills_read.execute({
      skill: "documented-skill",
      file: "examples.md",
    });

    expect(result).toBe(exampleContent);
  });

  it("should prevent path traversal attacks", async () => {
    await skills_create.execute({
      name: "secure-skill",
      description: "Use when securing",
      body: "Secure",
    });

    const maliciousPaths = [
      "../../../etc/passwd",
      "../../..",
      "/etc/passwd",
      "..\\..\\windows\\system32",
    ];

    for (const path of maliciousPaths) {
      const result = await skills_read.execute({
        skill: "secure-skill",
        file: path,
      });

      expect(result).toContain("Invalid file path");
    }
  });

  it("should return error for non-existent skill", async () => {
    const result = await skills_read.execute({
      skill: "non-existent",
      file: "anything.md",
    });

    expect(result).toContain("not found");
  });

  it("should return error for non-existent file", async () => {
    await skills_create.execute({
      name: "empty-skill",
      description: "Use when empty",
      body: "Empty",
    });

    const result = await skills_read.execute({
      skill: "empty-skill",
      file: "non-existent.md",
    });

    expect(result).toContain("Failed to read");
  });
});

// =============================================================================
// skills_create Tool
// =============================================================================

describe("skills_create tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should create a new skill with minimal fields", async () => {
    const result = await skills_create.execute({
      name: "minimal-skill",
      description: "Use when minimal",
      body: "# Minimal\n\nInstructions here.",
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.skill).toBe("minimal-skill");
    expect(parsed.path).toContain("minimal-skill");

    // Verify file exists
    const skillPath = join(SKILLS_DIR, "minimal-skill", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    // Verify content (description may or may not be quoted depending on content)
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("name: minimal-skill");
    expect(content).toContain("Use when minimal"); // Either quoted or unquoted
    expect(content).toContain("# Minimal");
  });

  it("should create skill with tags and tools", async () => {
    const result = await skills_create.execute({
      name: "full-skill",
      description: "Use when full",
      body: "Full body",
      tags: ["testing", "automation"],
      tools: ["Read", "Write", "Bash"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const skillPath = join(SKILLS_DIR, "full-skill", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");

    expect(content).toContain("tags:");
    expect(content).toContain("- testing");
    expect(content).toContain("- automation");
    expect(content).toContain("tools:");
    expect(content).toContain("- Read");
  });

  it("should return CSO warnings for non-compliant metadata", async () => {
    const result = await skills_create.execute({
      name: "bad-skill",
      description: "I can help you with testing", // First-person, no "Use when"
      body: "Body",
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true); // Still creates, just warns
    expect(parsed.cso_warnings).toBeDefined();
    expect(parsed.cso_warnings).toContain("first-person");
    expect(parsed.cso_warnings).toContain("Use when");
  });

  it("should prevent duplicate skill creation", async () => {
    await skills_create.execute({
      name: "duplicate-skill",
      description: "Use when duplicating",
      body: "First",
    });

    invalidateSkillsCache();

    const result = await skills_create.execute({
      name: "duplicate-skill",
      description: "Use when duplicating again",
      body: "Second",
    });

    expect(result).toContain("already exists");
    expect(result).toContain("skills_update");
  });

  it("should invalidate cache after creation", async () => {
    await skills_create.execute({
      name: "cache-test",
      description: "Use when caching",
      body: "Cache",
    });

    // Should be immediately discoverable without manual cache clear
    const skill = await skills_list.execute({});
    expect(skill).toContain("cache-test");
  });
});

// =============================================================================
// skills_update Tool
// =============================================================================

describe("skills_update tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should update skill description", async () => {
    await skills_create.execute({
      name: "update-test",
      description: "Use when old",
      body: "Old body",
    });

    invalidateSkillsCache();

    const result = await skills_update.execute({
      name: "update-test",
      description: "Use when new",
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.updated.description).toBe(true);

    const skillPath = join(SKILLS_DIR, "update-test", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("Use when new");
  });

  it("should update skill body with content parameter", async () => {
    await skills_create.execute({
      name: "body-test",
      description: "Use when body",
      body: "Old body",
    });

    invalidateSkillsCache();

    const result = await skills_update.execute({
      name: "body-test",
      content: "New body content",
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.updated.content).toBe(true);

    const skillPath = join(SKILLS_DIR, "body-test", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("New body content");
  });

  it("should append to existing body", async () => {
    await skills_create.execute({
      name: "append-test",
      description: "Use when appending",
      body: "Original content",
    });

    invalidateSkillsCache();

    const result = await skills_update.execute({
      name: "append-test",
      append_body: "\n\nAppended content",
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const skillPath = join(SKILLS_DIR, "append-test", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("Original content");
    expect(content).toContain("Appended content");
  });

  it("should replace tags", async () => {
    await skills_create.execute({
      name: "tags-test",
      description: "Use when tagging",
      body: "Body",
      tags: ["old", "tag"],
    });

    invalidateSkillsCache();

    const result = await skills_update.execute({
      name: "tags-test",
      tags: ["new", "tags"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const skillPath = join(SKILLS_DIR, "tags-test", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("- new");
    expect(content).toContain("- tags");
    expect(content).not.toContain("- old");
  });

  it("should add tags to existing", async () => {
    await skills_create.execute({
      name: "add-tags-test",
      description: "Use when adding tags",
      body: "Body",
      tags: ["existing"],
    });

    invalidateSkillsCache();

    const result = await skills_update.execute({
      name: "add-tags-test",
      add_tags: ["new", "additional"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const skillPath = join(SKILLS_DIR, "add-tags-test", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("- existing");
    expect(content).toContain("- new");
    expect(content).toContain("- additional");
  });

  it("should deduplicate tags when adding", async () => {
    await skills_create.execute({
      name: "dedup-test",
      description: "Use when deduping",
      body: "Body",
      tags: ["tag1"],
    });

    invalidateSkillsCache();

    await skills_update.execute({
      name: "dedup-test",
      add_tags: ["tag1", "tag2"], // tag1 already exists
    });

    const skillPath = join(SKILLS_DIR, "dedup-test", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");

    // Count occurrences of "tag1"
    const matches = content.match(/- tag1/g);
    expect(matches?.length).toBe(1); // Should only appear once
  });

  it("should return error for non-existent skill", async () => {
    const result = await skills_update.execute({
      name: "non-existent",
      description: "New desc",
    });

    expect(result).toContain("not found");
    expect(result).toContain("Available:");
  });
});

// =============================================================================
// skills_delete Tool
// =============================================================================

describe("skills_delete tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should delete a skill when confirm=true", async () => {
    await skills_create.execute({
      name: "delete-me",
      description: "Use when deleting",
      body: "Delete this",
    });

    const skillDir = join(SKILLS_DIR, "delete-me");
    expect(existsSync(skillDir)).toBe(true);

    const result = await skills_delete.execute({
      name: "delete-me",
      confirm: true,
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.skill).toBe("delete-me");

    // Verify directory removed
    expect(existsSync(skillDir)).toBe(false);
  });

  it("should refuse deletion without confirm", async () => {
    await skills_create.execute({
      name: "keep-me",
      description: "Use when keeping",
      body: "Keep this",
    });

    const result = await skills_delete.execute({
      name: "keep-me",
      confirm: false,
    });

    expect(result).toContain("not confirmed");
    expect(result).toContain("confirm=true");

    // Verify still exists
    const skillDir = join(SKILLS_DIR, "keep-me");
    expect(existsSync(skillDir)).toBe(true);
  });

  it("should return error for non-existent skill", async () => {
    const result = await skills_delete.execute({
      name: "non-existent",
      confirm: true,
    });

    expect(result).toContain("not found");
  });

  it("should invalidate cache after deletion", async () => {
    await skills_create.execute({
      name: "cache-delete-test",
      description: "Use when cache testing",
      body: "Cache",
    });

    await skills_delete.execute({
      name: "cache-delete-test",
      confirm: true,
    });

    // Should be immediately gone from list
    const result = await skills_list.execute({});
    expect(result).not.toContain("cache-delete-test");
  });
});

// =============================================================================
// skills_init Tool
// =============================================================================

describe("skills_init tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should initialize skill with full template structure", async () => {
    const result = await skills_init.execute({
      name: "init-test",
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.skill).toBe("init-test");
    expect(parsed.created_files).toContain("SKILL.md");
    expect(parsed.created_files).toContain("scripts/example.sh");
    expect(parsed.created_files).toContain("references/guide.md");

    // Verify files exist
    const skillDir = join(SKILLS_DIR, "init-test");
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "scripts", "example.sh"))).toBe(true);
    expect(existsSync(join(skillDir, "references", "guide.md"))).toBe(true);
  });

  it("should create SKILL.md with TODO placeholders", async () => {
    await skills_init.execute({ name: "todo-test" });

    const skillPath = join(SKILLS_DIR, "todo-test", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");

    expect(content).toContain("[TODO:");
    expect(content).toContain("## When to Use This Skill");
    expect(content).toContain("## Instructions");
    expect(content).toContain("## Examples");
  });

  it("should exclude example script when include_example_script=false", async () => {
    const result = await skills_init.execute({
      name: "no-scripts",
      include_example_script: false,
    });

    const parsed = JSON.parse(result);
    expect(parsed.created_files).not.toContain("scripts/example.sh");

    const scriptPath = join(SKILLS_DIR, "no-scripts", "scripts", "example.sh");
    expect(existsSync(scriptPath)).toBe(false);
  });

  it("should exclude reference when include_reference=false", async () => {
    const result = await skills_init.execute({
      name: "no-refs",
      include_reference: false,
    });

    const parsed = JSON.parse(result);
    expect(parsed.created_files).not.toContain("references/guide.md");

    const refPath = join(SKILLS_DIR, "no-refs", "references", "guide.md");
    expect(existsSync(refPath)).toBe(false);
  });

  it("should use provided description in frontmatter", async () => {
    await skills_init.execute({
      name: "custom-desc",
      description: "Use when custom description",
    });

    const skillPath = join(SKILLS_DIR, "custom-desc", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");

    expect(content).toContain("Use when custom description"); // May or may not be quoted
  });

  it("should prevent duplicate skill initialization", async () => {
    // Provide a valid description so the skill is discoverable
    await skills_init.execute({
      name: "duplicate-init",
      description: "Use when duplicate testing",
    });

    invalidateSkillsCache();

    const result = await skills_init.execute({ name: "duplicate-init" });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("already exists");
  });
});

// =============================================================================
// skills_add_script Tool
// =============================================================================

describe("skills_add_script tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should add executable script to skill", async () => {
    await skills_create.execute({
      name: "script-test",
      description: "Use when scripting",
      body: "Body",
    });

    const scriptContent = "#!/bin/bash\necho 'Hello from script'";
    const result = await skills_add_script.execute({
      skill: "script-test",
      script_name: "hello.sh",
      content: scriptContent,
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.script).toBe("hello.sh");
    // executable defaults to true if not specified
    expect(parsed.executable !== false).toBe(true);

    const scriptPath = join(SKILLS_DIR, "script-test", "scripts", "hello.sh");
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, "utf-8");
    expect(content).toBe(scriptContent);
  });

  it("should create scripts directory if needed", async () => {
    await skills_create.execute({
      name: "new-scripts",
      description: "Use when new scripts",
      body: "Body",
    });

    const scriptsDir = join(SKILLS_DIR, "new-scripts", "scripts");
    expect(existsSync(scriptsDir)).toBe(false);

    await skills_add_script.execute({
      skill: "new-scripts",
      script_name: "first.sh",
      content: "#!/bin/bash\necho first",
    });

    expect(existsSync(scriptsDir)).toBe(true);
  });

  it("should add non-executable script when executable=false", async () => {
    await skills_create.execute({
      name: "data-script",
      description: "Use when data",
      body: "Body",
    });

    await skills_add_script.execute({
      skill: "data-script",
      script_name: "data.json",
      content: '{"key": "value"}',
      executable: false,
    });

    const parsed = await skills_add_script.execute({
      skill: "data-script",
      script_name: "config.yaml",
      content: "key: value",
      executable: false,
    });

    const result = JSON.parse(parsed);
    expect(result.executable).toBe(false);
  });

  it("should prevent path traversal in script names", async () => {
    await skills_create.execute({
      name: "secure-scripts",
      description: "Use when secure",
      body: "Body",
    });

    const maliciousNames = [
      "../../../etc/passwd.sh",
      "../../bad.sh",
      "/etc/script.sh",
      "subdir/script.sh", // No subdirectories allowed
    ];

    for (const name of maliciousNames) {
      const result = await skills_add_script.execute({
        skill: "secure-scripts",
        script_name: name,
        content: "echo bad",
      });

      expect(result).toContain("Invalid script name");
    }
  });

  it("should return error for non-existent skill", async () => {
    const result = await skills_add_script.execute({
      skill: "non-existent",
      script_name: "test.sh",
      content: "echo test",
    });

    expect(result).toContain("not found");
  });

  it("should invalidate cache after adding script", async () => {
    await skills_create.execute({
      name: "cache-script-test",
      description: "Use when cache",
      body: "Body",
    });

    await skills_add_script.execute({
      skill: "cache-script-test",
      script_name: "test.sh",
      content: "echo test",
    });

    // Should immediately show [has scripts]
    const result = await skills_list.execute({});
    expect(result).toContain("cache-script-test");
    expect(result).toContain("[has scripts]");
  });
});

// =============================================================================
// skills_execute Tool
// =============================================================================

describe("skills_execute tool", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("should execute a script successfully", async () => {
    await skills_create.execute({
      name: "exec-test",
      description: "Use when executing",
      body: "Body",
    });

    await skills_add_script.execute({
      skill: "exec-test",
      script_name: "echo.sh",
      content: '#!/bin/bash\necho "Hello from script"',
    });

    // Manually ensure executable (writeFileSync mode doesn't always work)
    const scriptPath = join(SKILLS_DIR, "exec-test", "scripts", "echo.sh");
    chmodSync(scriptPath, 0o755);

    const result = await skills_execute.execute({
      skill: "exec-test",
      script: "echo.sh",
    });

    expect(result).toContain("Hello from script");
  });

  it("should pass project directory as first argument", async () => {
    await skills_create.execute({
      name: "args-test",
      description: "Use when args",
      body: "Body",
    });

    await skills_add_script.execute({
      skill: "args-test",
      script_name: "check-args.sh",
      content: '#!/bin/bash\necho "Project dir: $1"',
    });

    const scriptPath = join(SKILLS_DIR, "args-test", "scripts", "check-args.sh");
    chmodSync(scriptPath, 0o755);

    const result = await skills_execute.execute({
      skill: "args-test",
      script: "check-args.sh",
    });

    expect(result).toContain("Project dir:");
    expect(result).toContain(TEST_DIR);
  });

  it("should pass additional arguments to script", async () => {
    await skills_create.execute({
      name: "multi-args-test",
      description: "Use when multi args",
      body: "Body",
    });

    await skills_add_script.execute({
      skill: "multi-args-test",
      script_name: "args.sh",
      content: '#!/bin/bash\necho "Args: $1 $2 $3"',
    });

    const scriptPath = join(SKILLS_DIR, "multi-args-test", "scripts", "args.sh");
    chmodSync(scriptPath, 0o755);

    const result = await skills_execute.execute({
      skill: "multi-args-test",
      script: "args.sh",
      args: ["arg1", "arg2"],
    });

    expect(result).toContain("Args:");
    expect(result).toContain("arg1");
    expect(result).toContain("arg2");
  });

  it("should return error for non-existent skill", async () => {
    const result = await skills_execute.execute({
      skill: "non-existent",
      script: "test.sh",
    });

    expect(result).toContain("not found");
  });

  it("should return error for non-existent script", async () => {
    await skills_create.execute({
      name: "no-script",
      description: "Use when no script",
      body: "Body",
    });

    const result = await skills_execute.execute({
      skill: "no-script",
      script: "missing.sh",
    });

    expect(result).toContain("not found");
    expect(result).toContain("Available:");
  });

  it("should return non-zero exit code output", async () => {
    await skills_create.execute({
      name: "fail-test",
      description: "Use when failing",
      body: "Body",
    });

    await skills_add_script.execute({
      skill: "fail-test",
      script_name: "fail.sh",
      content: '#!/bin/bash\necho "Failed"\nexit 1',
    });

    const scriptPath = join(SKILLS_DIR, "fail-test", "scripts", "fail.sh");
    chmodSync(scriptPath, 0o755);

    const result = await skills_execute.execute({
      skill: "fail-test",
      script: "fail.sh",
    });

    expect(result).toContain("exited with code 1");
    expect(result).toContain("Failed");
  });

  it("should timeout long-running scripts", async () => {
    await skills_create.execute({
      name: "timeout-test",
      description: "Use when timing out",
      body: "Body",
    });

    await skills_add_script.execute({
      skill: "timeout-test",
      script_name: "slow.sh",
      content: '#!/bin/bash\nsleep 10', // 10s (longer than 2s timeout)
    });

    const scriptPath = join(SKILLS_DIR, "timeout-test", "scripts", "slow.sh");
    chmodSync(scriptPath, 0o755);

    const result = await skills_execute.execute({
      skill: "timeout-test",
      script: "slow.sh",
      timeout_ms: 2000,
    });

    expect(result).toContain("timed out");
    expect(result).toContain("2 seconds");
  }, 5000); // Allow 5s for test itself
});

// =============================================================================
// Deprecation Warnings Tests
// =============================================================================

describe("deprecation warnings", () => {
  beforeEach(() => {
    setupTestDir();
  });

  afterAll(() => {
    cleanupTestDir();
  });

  it("skills_list emits deprecation warning", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    
    await skills_list.execute({});
    
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[DEPRECATED] skills_list")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("OpenCode now provides native skills support")
    );
    warnSpy.mockRestore();
  });

  it("skills_use emits deprecation warning", async () => {
    await skills_create.execute({
      name: "test-skill",
      description: "Use when testing",
      body: "Instructions",
    });

    invalidateSkillsCache();
    
    const warnSpy = vi.spyOn(console, "warn");
    
    await skills_use.execute({ name: "test-skill" });
    
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[DEPRECATED] skills_use")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("OpenCode now provides native skills support")
    );
    warnSpy.mockRestore();
  });

  it("skills_read emits deprecation warning", async () => {
    await skills_create.execute({
      name: "test-skill",
      description: "Use when testing",
      body: "Instructions",
    });

    const skillDir = join(SKILLS_DIR, "test-skill");
    writeFileSync(join(skillDir, "example.md"), "# Example");

    invalidateSkillsCache();
    
    const warnSpy = vi.spyOn(console, "warn");
    
    await skills_read.execute({
      skill: "test-skill",
      file: "example.md",
    });
    
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[DEPRECATED] skills_read")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("OpenCode now provides native skills support")
    );
    warnSpy.mockRestore();
  });

  it("skills_execute emits deprecation warning", async () => {
    await skills_create.execute({
      name: "test-skill",
      description: "Use when testing",
      body: "Instructions",
    });

    await skills_add_script.execute({
      skill: "test-skill",
      script_name: "test.sh",
      content: '#!/bin/bash\necho "test"',
    });

    const scriptPath = join(SKILLS_DIR, "test-skill", "scripts", "test.sh");
    chmodSync(scriptPath, 0o755);

    invalidateSkillsCache();
    
    const warnSpy = vi.spyOn(console, "warn");
    
    await skills_execute.execute({
      skill: "test-skill",
      script: "test.sh",
    });
    
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[DEPRECATED] skills_execute")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("OpenCode now provides native skills support")
    );
    warnSpy.mockRestore();
  });

  it("deprecated tools still function correctly (soft deprecation)", async () => {
    // Create a skill
    await skills_create.execute({
      name: "functional-test",
      description: "Use when testing functionality",
      body: "# Test\n\nStill works!",
    });

    invalidateSkillsCache();

    // Suppress console.warn for this test
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // skills_list should still list skills
    const listResult = await skills_list.execute({});
    expect(listResult).toContain("functional-test");

    // skills_use should still return content
    const useResult = await skills_use.execute({ name: "functional-test" });
    expect(useResult).toContain("Still works!");

    warnSpy.mockRestore();
  });
});
