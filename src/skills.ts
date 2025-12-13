/**
 * Skills Module for OpenCode
 *
 * Implements Anthropic's Agent Skills specification for OpenCode.
 * Skills are markdown files with YAML frontmatter that provide
 * domain-specific instructions the model can activate when relevant.
 *
 * Discovery locations (in priority order):
 * 1. {projectDir}/.opencode/skills/
 * 2. {projectDir}/.claude/skills/ (compatibility)
 * 3. {projectDir}/skills/ (simple projects)
 *
 * Skill format:
 * ```markdown
 * ---
 * name: my-skill
 * description: What it does. Use when X.
 * ---
 *
 * # Skill Instructions
 * ...
 * ```
 *
 * @module skills
 */

import { tool } from "@opencode-ai/plugin";
import { readdir, readFile, stat, mkdir, writeFile, rm } from "fs/promises";
import { join, basename, dirname } from "path";

// =============================================================================
// Types
// =============================================================================

/**
 * Skill metadata from YAML frontmatter
 */
export interface SkillMetadata {
  /** Unique skill identifier (lowercase, hyphens) */
  name: string;
  /** Description of what the skill does and when to use it */
  description: string;
  /** Optional list of tools this skill works with */
  tools?: string[];
  /** Optional tags for categorization */
  tags?: string[];
}

/**
 * Full skill definition including content
 */
export interface Skill {
  /** Parsed frontmatter metadata */
  metadata: SkillMetadata;
  /** Raw markdown body (instructions) */
  body: string;
  /** Absolute path to the SKILL.md file */
  path: string;
  /** Directory containing the skill */
  directory: string;
  /** Whether this skill has executable scripts */
  hasScripts: boolean;
  /** List of script files in the skill directory */
  scripts: string[];
}

/**
 * Lightweight skill reference for listing
 */
export interface SkillRef {
  name: string;
  description: string;
  path: string;
  hasScripts: boolean;
}

// =============================================================================
// State
// =============================================================================

/** Cached project directory for skill discovery */
let skillsProjectDirectory: string = process.cwd();

/** Cached discovered skills (lazy-loaded) */
let skillsCache: Map<string, Skill> | null = null;

/**
 * Set the project directory for skill discovery
 */
export function setSkillsProjectDirectory(dir: string): void {
  skillsProjectDirectory = dir;
  skillsCache = null; // Invalidate cache when directory changes
}

// =============================================================================
// YAML Frontmatter Parser
// =============================================================================

/**
 * Parse YAML frontmatter from markdown content
 *
 * Handles the common frontmatter format:
 * ```
 * ---
 * key: value
 * ---
 * body content
 * ```
 */
export function parseFrontmatter(content: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { metadata: {}, body: content };
  }

  const [, yamlContent, body] = match;
  const metadata: Record<string, unknown> = {};

  // Simple YAML parser for frontmatter (handles key: value and key: [array])
  const lines = yamlContent.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Check for array item
    if (trimmed.startsWith("- ") && currentKey && currentArray !== null) {
      currentArray.push(trimmed.slice(2).trim());
      continue;
    }

    // Check for key: value
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      // Save previous array if any
      if (currentKey && currentArray !== null) {
        metadata[currentKey] = currentArray;
      }

      currentKey = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      if (value === "" || value === "|" || value === ">") {
        // Start of array or multiline
        currentArray = [];
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Inline array: [a, b, c]
        metadata[currentKey] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""));
        currentKey = null;
        currentArray = null;
      } else {
        // Simple value (strip quotes)
        metadata[currentKey] = value.replace(/^["']|["']$/g, "");
        currentKey = null;
        currentArray = null;
      }
    }
  }

  // Save final array if any
  if (currentKey && currentArray !== null) {
    metadata[currentKey] = currentArray;
  }

  return { metadata, body: body.trim() };
}

/**
 * Validate and extract skill metadata from parsed frontmatter
 */
function validateSkillMetadata(
  raw: Record<string, unknown>,
  filePath: string
): SkillMetadata {
  const name = raw.name;
  const description = raw.description;

  if (typeof name !== "string" || !name) {
    throw new Error(`Skill at ${filePath} missing required 'name' field`);
  }

  if (typeof description !== "string" || !description) {
    throw new Error(
      `Skill at ${filePath} missing required 'description' field`
    );
  }

  // Validate name format
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(
      `Skill name '${name}' must be lowercase with hyphens only`
    );
  }

  if (name.length > 64) {
    throw new Error(`Skill name '${name}' exceeds 64 character limit`);
  }

  if (description.length > 1024) {
    throw new Error(
      `Skill description for '${name}' exceeds 1024 character limit`
    );
  }

  return {
    name,
    description,
    tools: Array.isArray(raw.tools)
      ? raw.tools.filter((t): t is string => typeof t === "string")
      : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string")
      : undefined,
  };
}

// =============================================================================
// Discovery
// =============================================================================

/**
 * Skill discovery locations relative to project root (checked first)
 */
const PROJECT_SKILL_DIRECTORIES = [
  ".opencode/skills",
  ".claude/skills",
  "skills",
] as const;

/**
 * Global skills directory (user-level, checked after project)
 */
function getGlobalSkillsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return join(home, ".config", "opencode", "skills");
}

/**
 * Claude Code global skills directory (compatibility)
 */
function getClaudeGlobalSkillsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return join(home, ".claude", "skills");
}

/**
 * Find all SKILL.md files in a directory
 */
async function findSkillFiles(baseDir: string): Promise<string[]> {
  const skillFiles: string[] = [];

  try {
    const entries = await readdir(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(baseDir, entry.name, "SKILL.md");
        try {
          const s = await stat(skillPath);
          if (s.isFile()) {
            skillFiles.push(skillPath);
          }
        } catch {
          // SKILL.md doesn't exist in this subdirectory
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return skillFiles;
}

/**
 * Find script files in a skill directory
 */
async function findSkillScripts(skillDir: string): Promise<string[]> {
  const scripts: string[] = [];
  const scriptsDir = join(skillDir, "scripts");

  try {
    const entries = await readdir(scriptsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        scripts.push(entry.name);
      }
    }
  } catch {
    // No scripts directory
  }

  return scripts;
}

/**
 * Load a skill from its SKILL.md file
 */
async function loadSkill(skillPath: string): Promise<Skill> {
  const content = await readFile(skillPath, "utf-8");
  const { metadata: rawMetadata, body } = parseFrontmatter(content);
  const metadata = validateSkillMetadata(rawMetadata, skillPath);
  const directory = dirname(skillPath);
  const scripts = await findSkillScripts(directory);

  return {
    metadata,
    body,
    path: skillPath,
    directory,
    hasScripts: scripts.length > 0,
    scripts,
  };
}

/**
 * Discover all skills in the project and global directories
 *
 * Priority order (first match wins):
 * 1. Project: .opencode/skills/
 * 2. Project: .claude/skills/
 * 3. Project: skills/
 * 4. Global: ~/.config/opencode/skills/
 * 5. Global: ~/.claude/skills/
 */
export async function discoverSkills(
  projectDir?: string
): Promise<Map<string, Skill>> {
  const dir = projectDir || skillsProjectDirectory;

  // Return cached skills if available
  if (skillsCache && !projectDir) {
    return skillsCache;
  }

  const skills = new Map<string, Skill>();
  const seenNames = new Set<string>();

  /**
   * Helper to load skills from a directory
   */
  async function loadSkillsFromDir(skillsDir: string): Promise<void> {
    const skillFiles = await findSkillFiles(skillsDir);

    for (const skillPath of skillFiles) {
      try {
        const skill = await loadSkill(skillPath);

        // First definition wins (project overrides global)
        if (!seenNames.has(skill.metadata.name)) {
          skills.set(skill.metadata.name, skill);
          seenNames.add(skill.metadata.name);
        }
      } catch (error) {
        // Log but don't fail on individual skill parse errors
        console.warn(
          `[skills] Failed to load ${skillPath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // 1. Check project skill directories first (highest priority)
  for (const relPath of PROJECT_SKILL_DIRECTORIES) {
    await loadSkillsFromDir(join(dir, relPath));
  }

  // 2. Check global OpenCode skills directory
  await loadSkillsFromDir(getGlobalSkillsDir());

  // 3. Check global Claude skills directory (compatibility)
  await loadSkillsFromDir(getClaudeGlobalSkillsDir());

  // Cache for future lookups
  if (!projectDir) {
    skillsCache = skills;
  }

  return skills;
}

/**
 * Get a single skill by name
 */
export async function getSkill(name: string): Promise<Skill | null> {
  const skills = await discoverSkills();
  return skills.get(name) || null;
}

/**
 * List all available skills (lightweight refs only)
 */
export async function listSkills(): Promise<SkillRef[]> {
  const skills = await discoverSkills();
  return Array.from(skills.values()).map((skill) => ({
    name: skill.metadata.name,
    description: skill.metadata.description,
    path: skill.path,
    hasScripts: skill.hasScripts,
  }));
}

/**
 * Invalidate the skills cache (call when skills may have changed)
 */
export function invalidateSkillsCache(): void {
  skillsCache = null;
}

// =============================================================================
// Tools
// =============================================================================

/**
 * List available skills with metadata
 *
 * Returns lightweight skill references for the model to evaluate
 * which skills are relevant to the current task.
 */
export const skills_list = tool({
  description: `List all available skills in the project.

Skills are specialized instructions that help with specific domains or tasks.
Use this tool to discover what skills are available, then use skills_use to
activate a relevant skill.

Returns skill names, descriptions, and whether they have executable scripts.`,
  args: {
    tag: tool.schema
      .string()
      .optional()
      .describe("Optional tag to filter skills by"),
  },
  async execute(args) {
    const skills = await discoverSkills();
    let refs = Array.from(skills.values());

    // Filter by tag if provided
    if (args.tag) {
      refs = refs.filter(
        (s) => s.metadata.tags?.includes(args.tag as string)
      );
    }

    if (refs.length === 0) {
      return args.tag
        ? `No skills found with tag '${args.tag}'. Try skills_list without a tag filter.`
        : `No skills found. Skills should be in .opencode/skills/, .claude/skills/, or skills/ directories with SKILL.md files.`;
    }

    const formatted = refs
      .map((s) => {
        const scripts = s.hasScripts ? " [has scripts]" : "";
        const tags = s.metadata.tags?.length
          ? ` (${s.metadata.tags.join(", ")})`
          : "";
        return `• ${s.metadata.name}${tags}${scripts}\n  ${s.metadata.description}`;
      })
      .join("\n\n");

    return `Found ${refs.length} skill(s):\n\n${formatted}`;
  },
});

/**
 * Load and activate a skill by name
 *
 * Loads the full skill content for injection into context.
 * The skill's instructions become available for the model to follow.
 */
export const skills_use = tool({
  description: `Activate a skill by loading its full instructions.

After calling this tool, follow the skill's instructions for the current task.
Skills provide domain-specific guidance and best practices.

If the skill has scripts, you can run them with skills_execute.`,
  args: {
    name: tool.schema.string().describe("Name of the skill to activate"),
    include_scripts: tool.schema
      .boolean()
      .optional()
      .describe("Also list available scripts (default: true)"),
  },
  async execute(args) {
    const skill = await getSkill(args.name);

    if (!skill) {
      const available = await listSkills();
      const names = available.map((s) => s.name).join(", ");
      return `Skill '${args.name}' not found. Available skills: ${names || "none"}`;
    }

    const includeScripts = args.include_scripts !== false;
    let output = `# Skill: ${skill.metadata.name}\n\n`;
    output += `${skill.body}\n`;

    if (includeScripts && skill.scripts.length > 0) {
      output += `\n---\n\n## Available Scripts\n\n`;
      output += `This skill includes the following scripts in ${skill.directory}/scripts/:\n\n`;
      output += skill.scripts.map((s) => `• ${s}`).join("\n");
      output += `\n\nRun scripts with skills_execute tool.`;
    }

    return output;
  },
});

/**
 * Execute a script from a skill
 *
 * Skills can include helper scripts in their scripts/ directory.
 * This tool runs them with appropriate context.
 */
export const skills_execute = tool({
  description: `Execute a script from a skill's scripts/ directory.

Some skills include helper scripts for common operations.
Use skills_use first to see available scripts, then execute them here.

Scripts run in the skill's directory with the project directory as an argument.`,
  args: {
    skill: tool.schema.string().describe("Name of the skill"),
    script: tool.schema
      .string()
      .describe("Name of the script file to execute"),
    args: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Additional arguments to pass to the script"),
  },
  async execute(args, ctx) {
    const skill = await getSkill(args.skill);

    if (!skill) {
      return `Skill '${args.skill}' not found.`;
    }

    if (!skill.scripts.includes(args.script)) {
      return `Script '${args.script}' not found in skill '${args.skill}'. Available: ${skill.scripts.join(", ") || "none"}`;
    }

    const scriptPath = join(skill.directory, "scripts", args.script);
    const scriptArgs = args.args || [];

    try {
      // Use Bun shell from context if available, otherwise exec directly
      const $ = ctx?.$;
      if ($) {
        const result =
          await $`${scriptPath} ${skillsProjectDirectory} ${scriptArgs}`.quiet();
        return result.text();
      } else {
        // Fallback to direct execution
        const { spawn } = await import("child_process");
        return new Promise((resolve) => {
          const proc = spawn(scriptPath, [skillsProjectDirectory, ...scriptArgs], {
            cwd: skill.directory,
            stdio: ["pipe", "pipe", "pipe"],
          });

          let output = "";
          proc.stdout?.on("data", (d) => (output += d.toString()));
          proc.stderr?.on("data", (d) => (output += d.toString()));
          proc.on("close", (code) => {
            if (code === 0) {
              resolve(output || "Script executed successfully.");
            } else {
              resolve(`Script exited with code ${code}:\n${output}`);
            }
          });
          proc.on("error", (err) => {
            resolve(`Failed to execute script: ${err.message}`);
          });
        });
      }
    } catch (error) {
      return `Failed to execute script: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Read a resource file from a skill directory
 *
 * Skills can include additional resources like examples, templates, or reference docs.
 */
export const skills_read = tool({
  description: `Read a resource file from a skill's directory.

Skills may include additional files like:
- examples.md - Example usage
- reference.md - Reference documentation
- templates/ - Template files

Use this to access supplementary skill resources.`,
  args: {
    skill: tool.schema.string().describe("Name of the skill"),
    file: tool.schema
      .string()
      .describe("Relative path to the file within the skill directory"),
  },
  async execute(args) {
    const skill = await getSkill(args.skill);

    if (!skill) {
      return `Skill '${args.skill}' not found.`;
    }

    // Security: prevent path traversal
    if (args.file.includes("..") || args.file.startsWith("/")) {
      return "Invalid file path. Use relative paths without '..'";
    }

    const filePath = join(skill.directory, args.file);

    try {
      const content = await readFile(filePath, "utf-8");
      return content;
    } catch (error) {
      return `Failed to read '${args.file}' from skill '${args.skill}': ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// =============================================================================
// Skill Creation & Maintenance Tools
// =============================================================================

/**
 * Default skills directory for new skills
 */
const DEFAULT_SKILLS_DIR = ".opencode/skills";

/**
 * Generate SKILL.md content from metadata and body
 */
function generateSkillContent(
  name: string,
  description: string,
  body: string,
  options?: { tags?: string[]; tools?: string[] }
): string {
  const frontmatter: string[] = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
  ];

  if (options?.tags && options.tags.length > 0) {
    frontmatter.push("tags:");
    for (const tag of options.tags) {
      frontmatter.push(`  - ${tag}`);
    }
  }

  if (options?.tools && options.tools.length > 0) {
    frontmatter.push("tools:");
    for (const t of options.tools) {
      frontmatter.push(`  - ${t}`);
    }
  }

  frontmatter.push("---");

  return `${frontmatter.join("\n")}\n\n${body}`;
}

/**
 * Create a new skill in the project
 *
 * Agents can use this to codify learned patterns, best practices,
 * or domain-specific knowledge into reusable skills.
 */
export const skills_create = tool({
  description: `Create a new skill in the project.

Use this to codify learned patterns, best practices, or domain knowledge
into a reusable skill that future agents can discover and use.

Skills are stored in .opencode/skills/<name>/SKILL.md by default.

Good skills have:
- Clear, specific descriptions explaining WHEN to use them
- Actionable instructions with examples
- Tags for discoverability`,
  args: {
    name: tool.schema
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(64)
      .describe("Skill name (lowercase, hyphens only, max 64 chars)"),
    description: tool.schema
      .string()
      .max(1024)
      .describe("What the skill does and when to use it (max 1024 chars)"),
    body: tool.schema
      .string()
      .describe("Markdown content with instructions, examples, guidelines"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tags for categorization (e.g., ['testing', 'frontend'])"),
    tools: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tools this skill commonly uses"),
    directory: tool.schema
      .enum([".opencode/skills", ".claude/skills", "skills", "global", "global-claude"])
      .optional()
      .describe("Where to create the skill (default: .opencode/skills). Use 'global' for ~/.config/opencode/skills/, 'global-claude' for ~/.claude/skills/"),
  },
  async execute(args) {
    // Check if skill already exists
    const existing = await getSkill(args.name);
    if (existing) {
      return `Skill '${args.name}' already exists at ${existing.path}. Use skills_update to modify it.`;
    }

    // Determine target directory
    let skillDir: string;
    if (args.directory === "global") {
      skillDir = join(getGlobalSkillsDir(), args.name);
    } else if (args.directory === "global-claude") {
      skillDir = join(getClaudeGlobalSkillsDir(), args.name);
    } else {
      const baseDir = args.directory || DEFAULT_SKILLS_DIR;
      skillDir = join(skillsProjectDirectory, baseDir, args.name);
    }
    const skillPath = join(skillDir, "SKILL.md");

    try {
      // Create skill directory
      await mkdir(skillDir, { recursive: true });

      // Generate and write SKILL.md
      const content = generateSkillContent(
        args.name,
        args.description,
        args.body,
        { tags: args.tags, tools: args.tools }
      );

      await writeFile(skillPath, content, "utf-8");

      // Invalidate cache so new skill is discoverable
      invalidateSkillsCache();

      return JSON.stringify(
        {
          success: true,
          skill: args.name,
          path: skillPath,
          message: `Created skill '${args.name}'. It's now discoverable via skills_list.`,
          next_steps: [
            "Test with skills_use to verify instructions are clear",
            "Add examples.md or reference.md for supplementary content",
            "Add scripts/ directory for executable helpers",
          ],
        },
        null,
        2
      );
    } catch (error) {
      return `Failed to create skill: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Update an existing skill
 *
 * Modify a skill's metadata or content based on learned improvements.
 */
export const skills_update = tool({
  description: `Update an existing skill's content or metadata.

Use this to refine skills based on experience:
- Clarify instructions that were confusing
- Add examples from successful usage
- Update descriptions for better discoverability
- Add new tags or tool references`,
  args: {
    name: tool.schema.string().describe("Name of the skill to update"),
    description: tool.schema
      .string()
      .max(1024)
      .optional()
      .describe("New description (replaces existing)"),
    body: tool.schema
      .string()
      .optional()
      .describe("New body content (replaces existing)"),
    append_body: tool.schema
      .string()
      .optional()
      .describe("Content to append to existing body"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("New tags (replaces existing)"),
    add_tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tags to add to existing"),
    tools: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("New tools list (replaces existing)"),
  },
  async execute(args) {
    const skill = await getSkill(args.name);
    if (!skill) {
      const available = await listSkills();
      const names = available.map((s) => s.name).join(", ");
      return `Skill '${args.name}' not found. Available: ${names || "none"}`;
    }

    // Build updated metadata
    const newDescription = args.description ?? skill.metadata.description;

    // Handle body updates
    let newBody = skill.body;
    if (args.body) {
      newBody = args.body;
    } else if (args.append_body) {
      newBody = `${skill.body}\n\n${args.append_body}`;
    }

    // Handle tags
    let newTags = skill.metadata.tags;
    if (args.tags) {
      newTags = args.tags;
    } else if (args.add_tags) {
      newTags = [...(skill.metadata.tags || []), ...args.add_tags];
      // Deduplicate
      newTags = [...new Set(newTags)];
    }

    // Handle tools
    const newTools = args.tools ?? skill.metadata.tools;

    try {
      // Generate and write updated SKILL.md
      const content = generateSkillContent(
        args.name,
        newDescription,
        newBody,
        { tags: newTags, tools: newTools }
      );

      await writeFile(skill.path, content, "utf-8");

      // Invalidate cache
      invalidateSkillsCache();

      return JSON.stringify(
        {
          success: true,
          skill: args.name,
          path: skill.path,
          updated: {
            description: args.description ? true : false,
            body: args.body || args.append_body ? true : false,
            tags: args.tags || args.add_tags ? true : false,
            tools: args.tools ? true : false,
          },
          message: `Updated skill '${args.name}'.`,
        },
        null,
        2
      );
    } catch (error) {
      return `Failed to update skill: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Delete a skill from the project
 */
export const skills_delete = tool({
  description: `Delete a skill from the project.

Use sparingly - only delete skills that are:
- Obsolete or superseded by better skills
- Incorrect or harmful
- Duplicates of other skills

Consider updating instead of deleting when possible.`,
  args: {
    name: tool.schema.string().describe("Name of the skill to delete"),
    confirm: tool.schema
      .boolean()
      .describe("Must be true to confirm deletion"),
  },
  async execute(args) {
    if (!args.confirm) {
      return "Deletion not confirmed. Set confirm=true to delete the skill.";
    }

    const skill = await getSkill(args.name);
    if (!skill) {
      return `Skill '${args.name}' not found.`;
    }

    try {
      // Remove the entire skill directory
      await rm(skill.directory, { recursive: true, force: true });

      // Invalidate cache
      invalidateSkillsCache();

      return JSON.stringify(
        {
          success: true,
          skill: args.name,
          deleted_path: skill.directory,
          message: `Deleted skill '${args.name}' and its directory.`,
        },
        null,
        2
      );
    } catch (error) {
      return `Failed to delete skill: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

/**
 * Add a script to a skill
 *
 * Skills can include helper scripts for automation.
 */
export const skills_add_script = tool({
  description: `Add a helper script to an existing skill.

Scripts are stored in the skill's scripts/ directory and can be
executed with skills_execute. Use for:
- Automation helpers
- Validation scripts
- Setup/teardown utilities`,
  args: {
    skill: tool.schema.string().describe("Name of the skill"),
    script_name: tool.schema
      .string()
      .describe("Script filename (e.g., 'validate.sh', 'setup.py')"),
    content: tool.schema.string().describe("Script content"),
    executable: tool.schema
      .boolean()
      .default(true)
      .describe("Make script executable (default: true)"),
  },
  async execute(args) {
    const skill = await getSkill(args.skill);
    if (!skill) {
      return `Skill '${args.skill}' not found.`;
    }

    // Security: validate script name
    if (args.script_name.includes("..") || args.script_name.includes("/")) {
      return "Invalid script name. Use simple filenames without paths.";
    }

    const scriptsDir = join(skill.directory, "scripts");
    const scriptPath = join(scriptsDir, args.script_name);

    try {
      // Create scripts directory if needed
      await mkdir(scriptsDir, { recursive: true });

      // Write script
      await writeFile(scriptPath, args.content, { mode: args.executable ? 0o755 : 0o644 });

      // Invalidate cache to update hasScripts
      invalidateSkillsCache();

      return JSON.stringify(
        {
          success: true,
          skill: args.skill,
          script: args.script_name,
          path: scriptPath,
          executable: args.executable,
          message: `Added script '${args.script_name}' to skill '${args.skill}'.`,
          usage: `Run with: skills_execute(skill: "${args.skill}", script: "${args.script_name}")`,
        },
        null,
        2
      );
    } catch (error) {
      return `Failed to add script: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * All skills tools for plugin registration
 */
export const skillsTools = {
  skills_list,
  skills_use,
  skills_execute,
  skills_read,
  skills_create,
  skills_update,
  skills_delete,
  skills_add_script,
};

// =============================================================================
// Swarm Integration
// =============================================================================

/**
 * Get skill context for swarm task decomposition
 *
 * Returns a summary of available skills that can be referenced
 * in subtask prompts for specialized handling.
 */
export async function getSkillsContextForSwarm(): Promise<string> {
  const skills = await listSkills();

  if (skills.length === 0) {
    return "";
  }

  const skillsList = skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `
## Available Skills

The following skills are available in this project and can be activated
with \`skills_use\` when relevant to subtasks:

${skillsList}

Consider which skills may be helpful for each subtask.`;
}

/**
 * Find skills relevant to a task description
 *
 * Simple keyword matching to suggest skills for a task.
 * Returns skill names that may be relevant.
 */
export async function findRelevantSkills(
  taskDescription: string
): Promise<string[]> {
  const skills = await discoverSkills();
  const relevant: string[] = [];
  const taskLower = taskDescription.toLowerCase();

  for (const [name, skill] of skills) {
    const descLower = skill.metadata.description.toLowerCase();
    const bodyLower = skill.body.toLowerCase();

    // Check if task matches skill description keywords
    const keywords = descLower.split(/\s+/).filter((w) => w.length > 4);
    const taskWords = taskLower.split(/\s+/);

    const matches = keywords.filter((k) =>
      taskWords.some((w) => w.includes(k) || k.includes(w))
    );

    // Also check tags
    const tagMatches =
      skill.metadata.tags?.filter((t) => taskLower.includes(t.toLowerCase())) ||
      [];

    if (matches.length >= 2 || tagMatches.length > 0) {
      relevant.push(name);
    }
  }

  return relevant;
}
