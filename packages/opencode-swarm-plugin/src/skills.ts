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
import {
  join,
  basename,
  dirname,
  resolve,
  relative,
  isAbsolute,
  sep,
} from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import { getSwarmMailLibSQL, createEvent } from "swarm-mail";

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
// Always-On Guidance Skill
// =============================================================================

/**
 * Role types for always-on guidance injection.
 */
export type AlwaysOnGuidanceRole = "coordinator" | "worker";

/**
 * Options for always-on guidance skill rendering.
 */
export interface AlwaysOnGuidanceOptions {
  role: AlwaysOnGuidanceRole;
  model?: string;
}

const ALWAYS_ON_GUIDANCE_HEADER = "## Always-On Guidance Skill";

const ALWAYS_ON_TOOL_PRIORITY = `### Tool Priority Order
1. Swarm plugin tools (\`hive_*\`, \`swarm_*\`, \`swarmmail_*\`, \`structured_*\`)
2. \`Read\`/\`Edit\` for file operations
3. \`ast-grep\` for structural search
4. \`Glob\`/\`Grep\` for discovery
5. \`Task\` subagents for exploration
6. \`Bash\` only for system commands

**Never use Bash for file read/write/edit/search.**`;

const ALWAYS_ON_RULE_FOLLOWING = `### Rule-Following Guardrails
- Follow explicit tool constraints and approval modes
- Do not invent tool output or files; ask when unsure
- Keep changes scoped to assigned files and requirements`;

const ALWAYS_ON_ROLE_GUIDANCE: Record<AlwaysOnGuidanceRole, string> = {
  coordinator: `### Coordinator Enforcement
- Coordinator role: orchestrate, decompose, spawn workers
- **Never** edit files or reserve locks directly
- **After every \`swarm_spawn_subtask\`, immediately call \`Task(subagent_type="swarm-worker", prompt="<prompt returned by swarm_spawn_subtask>")\`**
- Coordinator override: use \`swarmmail_release_all\` only for stale/orphaned reservations (announce in Swarm Mail)
- Review work with \`swarm_review\` before accepting`,
  worker: `### Worker Enforcement
- Worker role: implement changes within reserved files
- Reserve files before edits and follow TDD (RED → GREEN → REFACTOR)
- Complete with \`swarm_complete\`, not \`hive_close\``,
};

const GPT_5_2_GUIDANCE = `#### GPT-5.2-code (Strict)
- Follow instructions literally and exactly
- Enforce tool priority order; fail closed if a tool is missing
- Read before Edit; no speculative changes or output`;

const OPUS_4_5_GUIDANCE = `#### Opus 4.5 (Concise)
- Be concise and deliberate while obeying mandates
- Follow tool priorities without shortcuts
- Prefer direct answers over speculation`;

/**
 * Resolve the model guidance bucket for always-on instructions.
 */
function resolveGuidanceModel(model?: string):
  | "gpt-5.2-code"
  | "opus-4.5"
  | "unknown" {
  if (!model) return "unknown";
  const normalized = model.toLowerCase();

  if (normalized.includes("gpt-5.2")) {
    return "gpt-5.2-code";
  }

  if (normalized.includes("opus-4-5") || normalized.includes("opus 4.5")) {
    return "opus-4.5";
  }

  return "unknown";
}

/**
 * Get the always-on guidance skill content for a role and model.
 */
export function getAlwaysOnGuidanceSkill(
  options: AlwaysOnGuidanceOptions,
): string {
  const roleGuidance = ALWAYS_ON_ROLE_GUIDANCE[options.role];
  const modelBucket = resolveGuidanceModel(options.model);

  let modelGuidance = "";
  if (modelBucket === "gpt-5.2-code") {
    modelGuidance = `### Model-Specific Guidance\n${GPT_5_2_GUIDANCE}`;
  } else if (modelBucket === "opus-4.5") {
    modelGuidance = `### Model-Specific Guidance\n${OPUS_4_5_GUIDANCE}`;
  } else {
    modelGuidance = `### Model-Specific Guidance\n${GPT_5_2_GUIDANCE}\n\n${OPUS_4_5_GUIDANCE}`;
  }

  return [
    ALWAYS_ON_GUIDANCE_HEADER,
    ALWAYS_ON_TOOL_PRIORITY,
    ALWAYS_ON_RULE_FOLLOWING,
    roleGuidance,
    modelGuidance,
  ].join("\n\n");
}

// =============================================================================
// State
// =============================================================================

/** Cached project directory for skill discovery */
let skillsProjectDirectory: string = process.cwd();

/** Cached discovered skills (lazy-loaded) */
let skillsCache: Map<string, Skill> | null = null;

/**
 * Emit skill_loaded event
 */
async function emitSkillLoadedEvent(data: {
  skill_name: string;
  skill_source: "global" | "project" | "bundled";
  context_provided?: boolean;
  content_length?: number;
}): Promise<void> {
  try {
    const projectPath = skillsProjectDirectory;
    const swarmMail = await getSwarmMailLibSQL(projectPath);

    const event = createEvent("skill_loaded", {
      project_key: projectPath,
      skill_name: data.skill_name,
      skill_source: data.skill_source,
      context_provided: data.context_provided,
      content_length: data.content_length,
    });

    await swarmMail.appendEvent(event);
  } catch {
    // Silently fail event emission - don't break the tool
  }
}

/**
 * Emit skill_created event
 */
async function emitSkillCreatedEvent(data: {
  skill_name: string;
  skill_scope: "global" | "project";
  description?: string;
}): Promise<void> {
  try {
    const projectPath = skillsProjectDirectory;
    const swarmMail = await getSwarmMailLibSQL(projectPath);

    const event = createEvent("skill_created", {
      project_key: projectPath,
      skill_name: data.skill_name,
      skill_scope: data.skill_scope,
      description: data.description,
    });

    await swarmMail.appendEvent(event);
  } catch {
    // Silently fail event emission - don't break the tool
  }
}

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
 * Parse YAML frontmatter from markdown content using gray-matter
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
  try {
    const { data, content: body } = matter(content);
    return { metadata: data, body: body.trim() };
  } catch {
    // If gray-matter fails, return empty metadata and full content as body
    return { metadata: {}, body: content };
  }
}

/**
 * Validate and extract skill metadata from parsed frontmatter
 */
function validateSkillMetadata(
  raw: Record<string, unknown>,
  filePath: string,
): SkillMetadata {
  const name = raw.name;
  const description = raw.description;

  if (typeof name !== "string" || !name) {
    throw new Error(`Skill at ${filePath} missing required 'name' field`);
  }

  if (typeof description !== "string" || !description) {
    throw new Error(
      `Skill at ${filePath} missing required 'description' field`,
    );
  }

  // Validate name format
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`Skill name '${name}' must be lowercase with hyphens only`);
  }

  if (name.length > 64) {
    throw new Error(`Skill name '${name}' exceeds 64 character limit`);
  }

  if (description.length > 1024) {
    throw new Error(
      `Skill description for '${name}' exceeds 1024 character limit`,
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
// OpenCode uses singular "skill", Claude uses plural "skills"
const PROJECT_SKILL_DIRECTORIES = [
  ".opencode/skill",   // OpenCode native
  ".claude/skills",    // Claude Code (uses plural)
  "skill",             // Simple projects
] as const;

/**
 * Global skills directory (user-level, checked after project)
 */
function getGlobalSkillsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return join(home, ".config", "opencode", "skill");
}

/**
 * Claude Code global skills directory (compatibility)
 */
function getClaudeGlobalSkillsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return join(home, ".claude", "skills"); // Claude uses plural
}

/**
 * Bundled skills from the package (lowest priority)
 */
function getPackageSkillsDir(): string {
  // Resolve relative to this file (handles URL-encoding like spaces)
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    return join(dirname(currentFilePath), "..", "global-skills");
  } catch {
    // Fallback for non-file URLs (best-effort)
    const currentDir = decodeURIComponent(new URL(".", import.meta.url).pathname);
    return join(currentDir, "..", "global-skills");
  }
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
  projectDir?: string,
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
          `[skills] Failed to load ${skillPath}: ${error instanceof Error ? error.message : String(error)}`,
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

  // 4. Check bundled package skills (lowest priority)
  await loadSkillsFromDir(getPackageSkillsDir());

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
  description: `[DEPRECATED] List all available skills in the project.

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
    console.warn('[DEPRECATED] skills_list is deprecated. OpenCode now provides native skills support. This tool will be removed in a future version.');
    const skills = await discoverSkills();
    let refs = Array.from(skills.values());

    // Filter by tag if provided
    if (args.tag) {
      refs = refs.filter((s) => s.metadata.tags?.includes(args.tag as string));
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
  description: `[DEPRECATED] Activate a skill by loading its full instructions.

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
    console.warn('[DEPRECATED] skills_use is deprecated. OpenCode now provides native skills support. This tool will be removed in a future version.');
    const skill = await getSkill(args.name);

    if (!skill) {
      const available = await listSkills();
      const names = available.map((s) => s.name).join(", ");
      return `Skill '${args.name}' not found. Available skills: ${names || "none"}`;
    }

    // Determine skill source
    let skillSource: "global" | "project" | "bundled" = "project";
    if (skill.path.includes(".config/opencode/skill") || skill.path.includes(".claude/skills")) {
      skillSource = "global";
    } else if (skill.path.includes("global-skills")) {
      skillSource = "bundled";
    }

    // Emit skill_loaded event
    await emitSkillLoadedEvent({
      skill_name: skill.metadata.name,
      skill_source: skillSource,
      context_provided: true,
      content_length: skill.body.length,
    });

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
  description: `[DEPRECATED] Execute a script from a skill's scripts/ directory.

Some skills include helper scripts for common operations.
Use skills_use first to see available scripts, then execute them here.

Scripts run in the skill's directory with the project directory as an argument.`,
  args: {
    skill: tool.schema.string().describe("Name of the skill"),
    script: tool.schema.string().describe("Name of the script file to execute"),
    args: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Additional arguments to pass to the script"),
    timeout_ms: tool.schema
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 60000)"),
  },
  async execute(args, ctx) {
    console.warn('[DEPRECATED] skills_execute is deprecated. OpenCode now provides native skills support. This tool will be removed in a future version.');
    const skill = await getSkill(args.skill);

    if (!skill) {
      return `Skill '${args.skill}' not found.`;
    }

    if (!skill.scripts.includes(args.script)) {
      return `Script '${args.script}' not found in skill '${args.skill}'. Available: ${skill.scripts.join(", ") || "none"}`;
    }

    const scriptPath = join(skill.directory, "scripts", args.script);
    const scriptArgs = args.args || [];

    const TIMEOUT_MS = args.timeout_ms ?? 60_000; // 60 second default timeout
    const proc = Bun.spawn(
      [scriptPath, skillsProjectDirectory, ...scriptArgs],
      {
        cwd: skill.directory,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    try {
      // Race between script completion and timeout
      const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
        setTimeout(() => resolve({ timedOut: true }), TIMEOUT_MS);
      });

      const resultPromise = (async () => {
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        return { timedOut: false as const, stdout, stderr, exitCode };
      })();

      const result = await Promise.race([resultPromise, timeoutPromise]);

      if (result.timedOut) {
        return `Script timed out after ${TIMEOUT_MS / 1000} seconds.`;
      }

      const output = result.stdout + result.stderr;
      if (result.exitCode === 0) {
        return output || "Script executed successfully.";
      } else {
        return `Script exited with code ${result.exitCode}:\n${output}`;
      }
    } catch (error) {
      return `Failed to execute script: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      // Ensure process is killed on error or timeout
      proc.kill();
    }
  },
});

/**
 * Read a resource file from a skill directory
 *
 * Skills can include additional resources like examples, templates, or reference docs.
 */
export const skills_read = tool({
  description: `[DEPRECATED] Read a resource file from a skill's directory.

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
    console.warn('[DEPRECATED] skills_read is deprecated. OpenCode now provides native skills support. This tool will be removed in a future version.');
    const skill = await getSkill(args.skill);

    if (!skill) {
      return `Skill '${args.skill}' not found.`;
    }

    // Security: prevent path traversal (cross-platform)
    // Block absolute paths (Unix / and Windows C:\ or \\)
    if (isAbsolute(args.file)) {
      return "Invalid file path. Use a relative path.";
    }

    // Block path traversal attempts
    if (args.file.includes("..")) {
      return "Invalid file path. Path traversal not allowed.";
    }

    const filePath = resolve(skill.directory, args.file);
    const relativePath = relative(skill.directory, filePath);

    // Verify resolved path stays within skill directory
    // Check for ".." at start or after separator (handles both Unix and Windows)
    if (
      relativePath === ".." ||
      relativePath.startsWith(".." + sep) ||
      relativePath.startsWith(".." + "/") ||
      relativePath.startsWith(".." + "\\")
    ) {
      return "Invalid file path. Must stay within the skill directory.";
    }

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
const DEFAULT_SKILLS_DIR = ".opencode/skill";

// =============================================================================
// CSO (Claude Search Optimization) Validation
// =============================================================================

/**
 * CSO validation warnings for skill metadata
 */
export interface CSOValidationWarnings {
  /** Critical warnings (strong indicators of poor discoverability) */
  critical: string[];
  /** Suggestions for improvement */
  suggestions: string[];
}

/**
 * Validate skill metadata against Claude Search Optimization best practices
 *
 * Checks:
 * - 'Use when...' format in description
 * - Description length (warn > 500, max 1024)
 * - Third-person voice (no 'I', 'you')
 * - Name conventions (verb-first, gerunds, hyphens)
 *
 * @returns Warnings object with critical issues and suggestions
 */
export function validateCSOCompliance(
  name: string,
  description: string,
): CSOValidationWarnings {
  const warnings: CSOValidationWarnings = {
    critical: [],
    suggestions: [],
  };

  // Description: Check for 'Use when...' pattern
  const hasUseWhen = /\buse when\b/i.test(description);
  if (!hasUseWhen) {
    warnings.critical.push(
      "Description should include 'Use when...' to focus on triggering conditions",
    );
  }

  // Description: Length checks
  if (description.length > 1024) {
    warnings.critical.push(
      `Description is ${description.length} chars (max 1024) - will be rejected`,
    );
  } else if (description.length > 500) {
    warnings.suggestions.push(
      `Description is ${description.length} chars (aim for <500 for optimal discoverability)`,
    );
  }

  // Description: Third-person check (no 'I', 'you')
  const firstPersonPattern = /\b(I|I'm|I'll|my|mine|myself)\b/i;
  const secondPersonPattern = /\b(you|you're|you'll|your|yours|yourself)\b/i;

  if (firstPersonPattern.test(description)) {
    warnings.critical.push(
      "Description uses first-person ('I', 'my') - skills are injected into system prompt, use third-person only",
    );
  }

  if (secondPersonPattern.test(description)) {
    warnings.critical.push(
      "Description uses second-person ('you', 'your') - use third-person voice (e.g., 'Handles X' not 'You can handle X')",
    );
  }

  // Name: Check for verb-first/gerund patterns
  const nameWords = name.split("-");
  const firstWord = nameWords[0];

  // Common gerund endings: -ing
  // Common verb forms: -ing, -ize, -ify, -ate
  const isGerund = /ing$/.test(firstWord);
  const isVerbForm = /(ing|ize|ify|ate)$/.test(firstWord);

  if (!isGerund && !isVerbForm) {
    // Check if it's a common action verb
    const actionVerbs = [
      "test",
      "debug",
      "fix",
      "scan",
      "check",
      "validate",
      "create",
      "build",
      "deploy",
      "run",
      "load",
      "fetch",
      "parse",
    ];
    const startsWithAction = actionVerbs.includes(firstWord);

    if (!startsWithAction) {
      warnings.suggestions.push(
        `Name '${name}' doesn't follow verb-first pattern. Consider gerunds (e.g., 'testing-skills' not 'test-skill') or action verbs for better clarity`,
      );
    }
  }

  // Name: Check length
  if (name.length > 64) {
    warnings.critical.push(
      `Name exceeds 64 character limit (${name.length} chars)`,
    );
  }

  // Name: Validate format (already enforced by schema, but good to document)
  if (!/^[a-z0-9-]+$/.test(name)) {
    warnings.critical.push(
      "Name must be lowercase letters, numbers, and hyphens only",
    );
  }

  return warnings;
}

/**
 * Format CSO warnings into a readable message for tool output
 */
function formatCSOWarnings(warnings: CSOValidationWarnings): string | null {
  if (warnings.critical.length === 0 && warnings.suggestions.length === 0) {
    return null;
  }

  const parts: string[] = [];

  if (warnings.critical.length > 0) {
    parts.push("**CSO Critical Issues:**");
    for (const warning of warnings.critical) {
      parts.push(`  ⚠️  ${warning}`);
    }
  }

  if (warnings.suggestions.length > 0) {
    parts.push("\n**CSO Suggestions:**");
    for (const suggestion of warnings.suggestions) {
      parts.push(`  💡 ${suggestion}`);
    }
  }

  parts.push("\n**CSO Guide:**");
  parts.push(
    "  • Start description with 'Use when...' (focus on triggering conditions)",
  );
  parts.push("  • Keep description <500 chars (max 1024)");
  parts.push("  • Use third-person voice only (injected into system prompt)");
  parts.push(
    "  • Name: verb-first or gerunds (e.g., 'testing-async' not 'async-test')",
  );
  parts.push(
    "\n  Example: 'Use when tests have race conditions - replaces arbitrary timeouts with condition polling'",
  );

  return parts.join("\n");
}

/**
 * Quote a YAML scalar if it contains special characters
 * Uses double quotes and escapes internal quotes/newlines
 */
function quoteYamlScalar(value: string): string {
  // Check if quoting is needed (contains :, #, newlines, quotes, or starts with special chars)
  const needsQuoting =
    /[:\n\r#"'`\[\]{}|>&*!?@]/.test(value) ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value === "" ||
    /^[0-9]/.test(value) ||
    ["true", "false", "null", "yes", "no", "on", "off"].includes(
      value.toLowerCase(),
    );

  if (!needsQuoting) {
    return value;
  }

  // Escape backslashes and double quotes, then wrap in double quotes
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

/**
 * Generate SKILL.md content from metadata and body
 */
function generateSkillContent(
  name: string,
  description: string,
  body: string,
  options?: { tags?: string[]; tools?: string[] },
): string {
  const frontmatter: string[] = [
    "---",
    `name: ${quoteYamlScalar(name)}`,
    `description: ${quoteYamlScalar(description)}`,
  ];

  if (options?.tags && options.tags.length > 0) {
    frontmatter.push("tags:");
    for (const tag of options.tags) {
      frontmatter.push(`  - ${quoteYamlScalar(tag)}`);
    }
  }

  if (options?.tools && options.tools.length > 0) {
    frontmatter.push("tools:");
    for (const t of options.tools) {
      frontmatter.push(`  - ${quoteYamlScalar(t)}`);
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
      .enum([
        ".opencode/skill",
        ".claude/skills",
        "skill",
        "global",
        "global-claude",
      ])
      .optional()
      .describe(
        "Where to create the skill (default: .opencode/skill). Use 'global' for ~/.config/opencode/skill/, 'global-claude' for ~/.claude/skills/",
      ),
  },
  async execute(args) {
    // Check if skill already exists
    const existing = await getSkill(args.name);
    if (existing) {
      return `Skill '${args.name}' already exists at ${existing.path}. Use skills_update to modify it.`;
    }

    // Validate CSO compliance (advisory warnings only)
    const csoWarnings = validateCSOCompliance(args.name, args.description);

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
        { tags: args.tags, tools: args.tools },
      );

      await writeFile(skillPath, content, "utf-8");

      // Invalidate cache so new skill is discoverable
      invalidateSkillsCache();

      // Determine skill scope
      const skillScope: "global" | "project" = 
        args.directory === "global" || args.directory === "global-claude" 
          ? "global" 
          : "project";

      // Emit skill_created event
      await emitSkillCreatedEvent({
        skill_name: args.name,
        skill_scope: skillScope,
        description: args.description,
      });

      // Build response with CSO warnings if present
      const response: Record<string, unknown> = {
        success: true,
        skill: args.name,
        path: skillPath,
        message: `Created skill '${args.name}'. It's now discoverable via skills_list.`,
        next_steps: [
          "Test with skills_use to verify instructions are clear",
          "Add examples.md or reference.md for supplementary content",
          "Add scripts/ directory for executable helpers",
        ],
      };

      // Add CSO warnings if any
      const warningsMessage = formatCSOWarnings(csoWarnings);
      if (warningsMessage) {
        response.cso_warnings = warningsMessage;
      }

      return JSON.stringify(response, null, 2);
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
    content: tool.schema
      .string()
      .optional()
      .describe("New content/body (replaces existing SKILL.md body)"),
    body: tool.schema
      .string()
      .optional()
      .describe("Alias for content - new body (replaces existing)"),
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

    // Handle body updates (content is preferred, body is alias for backwards compat)
    let newBody = skill.body;
    const bodyContent = args.content ?? args.body;
    if (bodyContent) {
      newBody = bodyContent;
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
      const content = generateSkillContent(args.name, newDescription, newBody, {
        tags: newTags,
        tools: newTools,
      });

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
            content: args.content || args.body || args.append_body ? true : false,
            tags: args.tags || args.add_tags ? true : false,
            tools: args.tools ? true : false,
          },
          message: `Updated skill '${args.name}'.`,
        },
        null,
        2,
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
    confirm: tool.schema.boolean().describe("Must be true to confirm deletion"),
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
        2,
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

    // Security: validate script name (cross-platform)
    // Block absolute paths, path separators, and traversal
    if (
      isAbsolute(args.script_name) ||
      args.script_name.includes("..") ||
      args.script_name.includes("/") ||
      args.script_name.includes("\\") ||
      basename(args.script_name) !== args.script_name
    ) {
      return "Invalid script name. Use simple filenames without paths.";
    }

    const scriptsDir = join(skill.directory, "scripts");
    const scriptPath = join(scriptsDir, args.script_name);

    try {
      // Create scripts directory if needed
      await mkdir(scriptsDir, { recursive: true });

      // Write script
      await writeFile(scriptPath, args.content, {
        mode: args.executable ? 0o755 : 0o644,
      });

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
        2,
      );
    } catch (error) {
      return `Failed to add script: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// =============================================================================
// Skill Initialization
// =============================================================================

/**
 * Generate a skill template with TODO placeholders
 */
function generateSkillTemplate(name: string, description?: string): string {
  const title = name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return `---
name: ${name}
description: ${description || `[TODO: Complete description of what this skill does and WHEN to use it. Be specific about scenarios that trigger this skill.]`}
tags:
  - [TODO: add tags]
---

# ${title}

## Overview

[TODO: 1-2 sentences explaining what this skill enables]

## When to Use This Skill

[TODO: List specific scenarios when this skill should be activated:
- When working on X type of task
- When files matching Y pattern are involved
- When the user asks about Z topic]

## Instructions

[TODO: Add actionable instructions for the agent. Use imperative form:
- "Read the configuration file first"
- "Check for existing patterns before creating new ones"
- "Always validate output before completing"]

## Examples

### Example 1: [TODO: Realistic scenario]

**User**: "[TODO: Example user request]"

**Process**:
1. [TODO: Step-by-step process]
2. [TODO: Next step]
3. [TODO: Final step]

## Resources

This skill may include additional resources:

### scripts/
Executable scripts for automation. Run with \`skills_execute\`.

### references/
Documentation loaded on-demand. Access with \`skills_read\`.

---
*Delete any unused sections and this line when skill is complete.*
`;
}

/**
 * Generate a reference template
 */
function generateReferenceTemplate(skillName: string): string {
  const title = skillName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return `# Reference Documentation for ${title}

## Overview

[TODO: Detailed reference material for this skill]

## API Reference

[TODO: If applicable, document APIs, schemas, or interfaces]

## Detailed Workflows

[TODO: Complex multi-step workflows that don't fit in SKILL.md]

## Troubleshooting

[TODO: Common issues and solutions]
`;
}

/**
 * Initialize a new skill with full directory structure
 *
 * Creates a skill template following best practices from the
 * Anthropic Agent Skills specification and community patterns.
 */
export const skills_init = tool({
  description: `Initialize a new skill with full directory structure and templates.

Creates a complete skill directory with:
- SKILL.md with frontmatter and TODO placeholders
- scripts/ directory for executable helpers
- references/ directory for on-demand documentation

Use this instead of skills_create when you want the full template structure.
Perfect for learning to create effective skills.`,
  args: {
    name: tool.schema
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(64)
      .describe("Skill name (lowercase, hyphens only)"),
    description: tool.schema
      .string()
      .optional()
      .describe("Initial description (can be a TODO placeholder)"),
    directory: tool.schema
      .enum([".opencode/skills", ".claude/skills", "skills", "global"])
      .optional()
      .describe("Where to create (default: .opencode/skills)"),
    include_example_script: tool.schema
      .boolean()
      .default(true)
      .describe("Include example script placeholder (default: true)"),
    include_reference: tool.schema
      .boolean()
      .default(true)
      .describe("Include reference doc placeholder (default: true)"),
  },
  async execute(args) {
    // Check if skill already exists
    const existing = await getSkill(args.name);
    if (existing) {
      return JSON.stringify(
        {
          success: false,
          error: `Skill '${args.name}' already exists`,
          existing_path: existing.path,
        },
        null,
        2,
      );
    }

    // Determine target directory
    let skillDir: string;
    if (args.directory === "global") {
      skillDir = join(getGlobalSkillsDir(), args.name);
    } else {
      const baseDir = args.directory || DEFAULT_SKILLS_DIR;
      skillDir = join(skillsProjectDirectory, baseDir, args.name);
    }

    const createdFiles: string[] = [];

    try {
      // Create skill directory
      await mkdir(skillDir, { recursive: true });

      // Create SKILL.md
      const skillPath = join(skillDir, "SKILL.md");
      const skillContent = generateSkillTemplate(args.name, args.description);
      await writeFile(skillPath, skillContent, "utf-8");
      createdFiles.push("SKILL.md");

      // Create scripts/ directory with example
      if (args.include_example_script !== false) {
        const scriptsDir = join(skillDir, "scripts");
        await mkdir(scriptsDir, { recursive: true });

        const exampleScript = `#!/usr/bin/env bash
# Example helper script for ${args.name}
#
# This is a placeholder. Replace with actual implementation or delete.
#
# Usage: skills_execute(skill: "${args.name}", script: "example.sh")

echo "Hello from ${args.name} skill!"
echo "Project directory: \$1"

# TODO: Add actual script logic
`;
        const scriptPath = join(scriptsDir, "example.sh");
        await writeFile(scriptPath, exampleScript, { mode: 0o755 });
        createdFiles.push("scripts/example.sh");
      }

      // Create references/ directory with example
      if (args.include_reference !== false) {
        const refsDir = join(skillDir, "references");
        await mkdir(refsDir, { recursive: true });

        const refContent = generateReferenceTemplate(args.name);
        const refPath = join(refsDir, "guide.md");
        await writeFile(refPath, refContent, "utf-8");
        createdFiles.push("references/guide.md");
      }

      // Invalidate cache
      invalidateSkillsCache();

      // Determine skill scope
      const skillScope: "global" | "project" = args.directory === "global" ? "global" : "project";

      // Emit skill_created event
      await emitSkillCreatedEvent({
        skill_name: args.name,
        skill_scope: skillScope,
        description: args.description || "[TODO: Complete description]",
      });

      return JSON.stringify(
        {
          success: true,
          skill: args.name,
          path: skillDir,
          created_files: createdFiles,
          next_steps: [
            "Edit SKILL.md to complete TODO placeholders",
            "Update the description in frontmatter",
            "Add specific 'When to Use' scenarios",
            "Add actionable instructions",
            "Delete unused sections and placeholder files",
            "Test with skills_use to verify it works",
          ],
          tips: [
            "Good descriptions explain WHEN to use, not just WHAT it does",
            "Instructions should be imperative: 'Do X' not 'You should do X'",
            "Include realistic examples with user requests",
            "Progressive disclosure: keep SKILL.md lean, use references/ for details",
          ],
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          success: false,
          error: `Failed to initialize skill: ${error instanceof Error ? error.message : String(error)}`,
          partial_files: createdFiles,
        },
        null,
        2,
      );
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
  skills_init,
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
  taskDescription: string,
): Promise<string[]> {
  const skills = await discoverSkills();
  const relevant: string[] = [];
  const taskLower = taskDescription.toLowerCase();

  for (const [name, skill] of skills) {
    const descLower = skill.metadata.description.toLowerCase();

    // Check if task matches skill description keywords
    const keywords = descLower.split(/\s+/).filter((w) => w.length > 4);
    const taskWords = taskLower.split(/\s+/);

    const matches = keywords.filter((k) =>
      taskWords.some((w) => w.includes(k) || k.includes(w)),
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
