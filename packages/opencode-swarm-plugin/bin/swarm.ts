#!/usr/bin/env bun
/**
 * OpenCode Swarm Plugin CLI
 *
 * A beautiful interactive CLI for setting up and managing swarm coordination.
 *
 * Commands:
 *   swarm setup    - Interactive installer for all dependencies
 *   swarm doctor   - Check dependency health with detailed status
 *   swarm init     - Initialize swarm in current project
 *   swarm version  - Show version info
 *   swarm          - Interactive mode (same as setup)
 */

import * as p from "@clack/prompts";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  checkBeadsMigrationNeeded,
  migrateBeadsToHive,
  mergeHistoricBeads,
  importJsonlToPGLite,
  ensureHiveDirectory,
  getHiveAdapter,
} from "../src/hive";
import {
  legacyDatabaseExists,
  migratePGliteToLibSQL,
  pgliteExists,
  getLibSQLProjectTempDirName,
  getLibSQLDatabasePath,
  hashLibSQLProjectPath,
} from "swarm-mail";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;

// ============================================================================
// ASCII Art & Branding
// ============================================================================

const BEE = `
    \\ \` - ' /
   - .(o o). -
    (  >.<  )
     /|   |\\
    (_|   |_)  bzzzz...
`;

const BANNER = `
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
`;

const TAGLINE = "Multi-agent coordination for OpenCode";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

const PACKAGE_NAME = "opencode-swarm-plugin";

// ============================================================================
// File Operation Helpers
// ============================================================================

type FileStatus = "created" | "updated" | "unchanged";

interface FileStats {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Write a file with status logging (created/updated/unchanged)
 * @param path - File path to write
 * @param content - Content to write
 * @param label - Label for logging (e.g., "Plugin", "Command")
 * @returns Status of the operation
 */
function writeFileWithStatus(path: string, content: string, label: string): FileStatus {
  const exists = existsSync(path);
  
  if (exists) {
    const current = readFileSync(path, "utf-8");
    if (current === content) {
      p.log.message(dim(`  ${label}: ${path} (unchanged)`));
      return "unchanged";
    }
  }
  
  writeFileSync(path, content);
  const status: FileStatus = exists ? "updated" : "created";
  p.log.success(`${label}: ${path} (${status})`);
  return status;
}

/**
 * Create a directory with logging
 * @param path - Directory path to create
 * @returns true if created, false if already exists
 */
function mkdirWithStatus(path: string): boolean {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
    p.log.message(dim(`  Created directory: ${path}`));
    return true;
  }
  return false;
}

/**
 * Remove a file with logging
 * @param path - File path to remove
 * @param label - Label for logging
 */
function rmWithStatus(path: string, label: string): void {
  if (existsSync(path)) {
    rmSync(path);
    p.log.message(dim(`  Removed ${label}: ${path}`));
  }
}

// ============================================================================
// Seasonal Messages (inspired by Astro's Houston)
// ============================================================================

type Season = "spooky" | "holiday" | "new-year" | "summer" | "default";

function getSeason(): Season {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (month === 1 && day <= 7) return "new-year";
  if (month === 10 && day > 7) return "spooky";
  if (month === 12 && day > 7 && day < 26) return "holiday";
  if (month >= 6 && month <= 8) return "summer";
  return "default";
}

interface SeasonalBee {
  messages: string[];
  decorations?: string[];
}

function getSeasonalBee(): SeasonalBee {
  const season = getSeason();
  const year = new Date().getFullYear();

  switch (season) {
    case "new-year":
      return {
        messages: [
          `New year, new swarm! Let's build something amazing in ${year}!`,
          `${year} is the year of parallel agents! bzzzz...`,
          `Kicking off ${year} with coordinated chaos!`,
          `Happy ${year}! Time to orchestrate some magic.`,
        ],
        decorations: ["🎉", "🎊", "✨"],
      };
    case "spooky":
      return {
        messages: [
          `Boo! Just kidding. Let's spawn some agents!`,
          `The hive is buzzing with spooky energy...`,
          `No tricks here, only parallel treats!`,
          `Let's conjure up a swarm of worker bees!`,
          `Something wicked this way computes...`,
        ],
        decorations: ["🎃", "👻", "🕷️", "🦇"],
      };
    case "holiday":
      return {
        messages: [
          `'Tis the season to parallelize!`,
          `The hive is warm and cozy. Let's build!`,
          `Ho ho ho! Time to unwrap some agents!`,
          `Jingle bells, agents swell, tasks get done today!`,
          `The best gift? A well-coordinated swarm.`,
        ],
        decorations: ["🎄", "🎁", "❄️", "⭐"],
      };
    case "summer":
      return {
        messages: [
          `Summer vibes and parallel pipelines!`,
          `The hive is buzzing in the sunshine!`,
          `Hot code, cool agents. Let's go!`,
          `Beach day? Nah, build day!`,
        ],
        decorations: ["☀️", "🌻", "🌴"],
      };
    default:
      return {
        messages: [
          `The hive awaits your command.`,
          `Ready to coordinate the swarm!`,
          `Let's build something awesome together.`,
          `Parallel agents, standing by.`,
          `Time to orchestrate some magic!`,
          `The bees are ready to work.`,
          `Bzzzz... initializing swarm intelligence.`,
          `Many agents, one mission.`,
        ],
      };
  }
}

function getRandomMessage(): string {
  const { messages } = getSeasonalBee();
  return messages[Math.floor(Math.random() * messages.length)];
}

function getDecoratedBee(): string {
  const { decorations } = getSeasonalBee();
  if (!decorations || Math.random() > 0.5) return cyan(BEE);

  const decoration =
    decorations[Math.floor(Math.random() * decorations.length)];
  // Add decoration to the bee
  return cyan(BEE.replace("bzzzz...", `bzzzz... ${decoration}`));
}

// ============================================================================
// Model Configuration
// ============================================================================

interface ModelOption {
  value: string;
  label: string;
  hint: string;
}

const COORDINATOR_MODELS: ModelOption[] = [
  {
    value: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    hint: "Best balance of speed and capability (recommended)",
  },
  {
    value: "anthropic/claude-opus-4-5",
    label: "Claude Opus 4.5",
    hint: "Most capable, slower and more expensive",
  },
  {
    value: "openai/gpt-4o",
    label: "GPT-4o",
    hint: "Fast, good for most tasks",
  },
  {
    value: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    hint: "Fast and capable",
  },
  {
    value: "google/gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    hint: "More capable, larger context",
  },
];

const WORKER_MODELS: ModelOption[] = [
  {
    value: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "Fast and cost-effective (recommended)",
  },
  {
    value: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    hint: "More capable, slower",
  },
  {
    value: "openai/gpt-4o-mini",
    label: "GPT-4o Mini",
    hint: "Fast and cheap",
  },
  {
    value: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    hint: "Fast and capable",
  },
];

// ============================================================================
// Update Checking
// ============================================================================

interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      {
        signal: AbortSignal.timeout(3000), // 3 second timeout
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const latest = data.version;
    const updateAvailable =
      latest !== VERSION && compareVersions(latest, VERSION) > 0;
    return { current: VERSION, latest, updateAvailable };
  } catch {
    return null; // Silently fail - don't block CLI
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

function showUpdateNotification(info: UpdateInfo) {
  if (info.updateAvailable) {
    console.log();
    console.log(
      yellow("  ╭─────────────────────────────────────────────────────╮"),
    );
    console.log(
      yellow("  │") +
        "  Update available! " +
        dim(info.current) +
        " → " +
        green(info.latest) +
        "                " +
        yellow("│"),
    );
    console.log(
      yellow("  │") +
        "  Run: " +
        cyan("npm install -g " + PACKAGE_NAME + "@latest") +
        "  " +
        yellow("│"),
    );
    console.log(
      yellow("  │") +
        "  Or:  " +
        cyan("swarm update") +
        "                                " +
        yellow("│"),
    );
    console.log(
      yellow("  ╰─────────────────────────────────────────────────────╯"),
    );
    console.log();
  }
}

// ============================================================================
// Types
// ============================================================================

interface Dependency {
  name: string;
  command: string;
  checkArgs: string[];
  required: boolean;
  install: string;
  installType: "brew" | "curl" | "go" | "npm" | "manual";
  description: string;
}

interface CheckResult {
  dep: Dependency;
  available: boolean;
  version?: string;
}

// ============================================================================
// Dependencies
// ============================================================================

const DEPENDENCIES: Dependency[] = [
  {
    name: "OpenCode",
    command: "opencode",
    checkArgs: ["--version"],
    required: true,
    install: "brew install sst/tap/opencode",
    installType: "brew",
    description: "AI coding assistant (plugin host)",
  },
  // Note: Beads CLI (bd) is NO LONGER required - we use HiveAdapter from swarm-mail
  // which provides the same functionality programmatically without external dependencies
  {
    name: "CASS (Coding Agent Session Search)",
    command: "cass",
    checkArgs: ["--help"],
    required: false,
    install: "https://github.com/Dicklesworthstone/coding_agent_session_search",
    installType: "manual",
    description: "Indexes and searches AI coding agent history for context",
  },
  {
    name: "UBS (Ultimate Bug Scanner)",
    command: "ubs",
    checkArgs: ["--help"],
    required: false,
    install: "https://github.com/Dicklesworthstone/ultimate_bug_scanner",
    installType: "manual",
    description: "AI-powered static analysis for pre-completion bug scanning",
  },
  {
    name: "Ollama",
    command: "ollama",
    checkArgs: ["--version"],
    required: false,
    install: "brew install ollama && ollama pull mxbai-embed-large",
    installType: "brew",
    description: "Local embeddings for semantic memory (embedded in plugin)",
  },
];

// ============================================================================
// Utilities
// ============================================================================

async function checkCommand(
  cmd: string,
  args: string[],
): Promise<{ available: boolean; version?: string }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const output = await new Response(proc.stdout).text();
      const versionMatch = output.match(/v?(\d+\.\d+\.\d+)/);
      return { available: true, version: versionMatch?.[1] };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

async function runInstall(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function checkAllDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const dep of DEPENDENCIES) {
    const { available, version } = await checkCommand(
      dep.command,
      dep.checkArgs,
    );
    results.push({ dep, available, version });
  }
  return results;
}

// ============================================================================
// Skills Sync Utilities
// ============================================================================

const BUNDLED_SKILL_MARKER_FILENAME = ".swarm-bundled-skill.json";

function listDirectoryNames(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function copyDirRecursiveSync(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, destPath);
      continue;
    }

    if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
      try {
        chmodSync(destPath, statSync(srcPath).mode);
      } catch {
        // Best effort
      }
    }
  }
}

function writeBundledSkillMarker(
  skillDir: string,
  info: { version: string },
): void {
  const markerPath = join(skillDir, BUNDLED_SKILL_MARKER_FILENAME);
  writeFileSync(
    markerPath,
    JSON.stringify(
      {
        managed_by: "opencode-swarm-plugin",
        version: info.version,
        synced_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function syncBundledSkillsToGlobal({
  bundledSkillsPath,
  globalSkillsPath,
  version,
}: {
  bundledSkillsPath: string;
  globalSkillsPath: string;
  version: string;
}): { installed: string[]; updated: string[]; skipped: string[] } {
  const bundledSkills = listDirectoryNames(bundledSkillsPath);

  const installed: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const name of bundledSkills) {
    const srcSkillDir = join(bundledSkillsPath, name);
    const destSkillDir = join(globalSkillsPath, name);
    const markerPath = join(destSkillDir, BUNDLED_SKILL_MARKER_FILENAME);

    if (!existsSync(destSkillDir)) {
      copyDirRecursiveSync(srcSkillDir, destSkillDir);
      writeBundledSkillMarker(destSkillDir, { version });
      installed.push(name);
      continue;
    }

    // Only overwrite skills that we previously installed/managed
    if (existsSync(markerPath)) {
      rmSync(destSkillDir, { recursive: true, force: true });
      copyDirRecursiveSync(srcSkillDir, destSkillDir);
      writeBundledSkillMarker(destSkillDir, { version });
      updated.push(name);
      continue;
    }

    skipped.push(name);
  }

  return { installed, updated, skipped };
}

// ============================================================================
// AGENTS.md Update Utilities
// ============================================================================

function detectNewline(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function backupFileWithTimestamp(filePath: string): string | null {
  try {
    const dir = dirname(filePath);
    const base = basename(filePath);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "")
      .replace(/Z$/, "Z");
    const backupPath = join(dir, `${base}.swarm-backup-${timestamp}`);
    copyFileSync(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

function buildAgentsSkillsSection(
  bundledSkillsCsv: string,
  newline: string,
): string {
  return [
    "## Skills - Knowledge Injection",
    "",
    "Skills are reusable knowledge packages. Load them on-demand for specialized tasks.",
    "",
    "### When to Use",
    "",
    "- Before unfamiliar work - check if a skill exists",
    "- When you need domain-specific patterns",
    "- For complex workflows that benefit from guidance",
    "",
    "### Usage",
    "",
    "```bash",
    "skills_list()                              # See available skills",
    'skills_use(name="swarm-coordination")      # Load a skill',
    'skills_use(name="cli-builder", context="building a new CLI") # With context',
    "```",
    "",
    `**Bundled Skills:** ${bundledSkillsCsv}`,
  ].join(newline);
}

function buildAgentsCassSection(newline: string): string {
  return [
    "## CASS - Cross-Agent Session Search",
    "",
    "Search across ALL your AI coding agent histories before solving problems from scratch.",
    "",
    "### When to Use",
    "",
    '- **BEFORE implementing anything**: check if any agent solved it before',
    '- **Debugging**: "what did I try last time this error happened?"',
    '- **Learning patterns**: "how did Cursor handle this API?"',
    "",
    "### Usage",
    "",
    "```bash",
    "# Search all agents",
    'cass_search(query="authentication token refresh", limit=5)',
    "",
    "# Filter by agent/time",
    'cass_search(query="useEffect cleanup", agent="claude", days=7)',
    "",
    "# View specific result",
    'cass_view(path="/path/from/search", line=42)',
    "",
    "# Expand context around match",
    'cass_expand(path="/path", line=42, context=10)',
    "```",
    "",
    "**Pro tip:** Query CASS at the START of complex tasks. Past solutions save time.",
  ].join(newline);
}

function buildAgentsSemanticMemorySection(newline: string): string {
  return [
    "## Semantic Memory - Persistent Learning",
    "",
    "Store and retrieve learnings across sessions. Memories persist and are searchable.",
    "",
    "### When to Use",
    "",
    "- After solving a tricky problem - store the solution",
    "- After making architectural decisions - store the reasoning",
    "- Before starting work - search for relevant past learnings",
    "- When you discover project-specific patterns",
    "",
    "### Usage",
    "",
    "```bash",
    "# Store a learning",
    'semantic-memory_store(information="OAuth refresh tokens need 5min buffer before expiry", metadata="auth, tokens")',
    "",
    "# Search for relevant memories",
    'semantic-memory_find(query="token refresh", limit=5)',
    "",
    "# Validate a memory is still accurate (resets decay timer)",
    'semantic-memory_validate(id="mem_123")',
    "```",
    "",
    "**Pro tip:** Store the WHY, not just the WHAT. Future you needs context.",
  ].join(newline);
}

function buildAgentsSwarmCoordinatorSection(newline: string): string {
  return [
    "## Swarm Coordinator Checklist (MANDATORY)",
    "",
    "When coordinating a swarm, you MUST monitor workers and review their output.",
    "",
    "### Monitor Loop",
    "",
    "```",
    "┌─────────────────────────────────────────────────────────────┐",
    "│                 COORDINATOR MONITOR LOOP                    │",
    "├─────────────────────────────────────────────────────────────┤",
    "│                                                             │",
    "│  1. CHECK INBOX                                             │",
    "│     swarmmail_inbox()                                       │",
    "│     swarmmail_read_message(message_id=N)                    │",
    "│                                                             │",
    "│  2. CHECK STATUS                                            │",
    "│     swarm_status(epic_id, project_key)                      │",
    "│                                                             │",
    "│  3. REVIEW COMPLETED WORK                                   │",
    "│     swarm_review(project_key, epic_id, task_id, files)      │",
    "│     → Generates review prompt with epic context + diff      │",
    "│                                                             │",
    "│  4. SEND FEEDBACK                                           │",
    "│     swarm_review_feedback(                                  │",
    "│       project_key, task_id, worker_id,                      │",
    "│       status=\"approved|needs_changes\",                      │",
    "│       issues=\"[{file, line, issue, suggestion}]\"            │",
    "│     )                                                       │",
    "│                                                             │",
    "│  5. INTERVENE IF NEEDED                                     │",
    "│     - Blocked >5min → unblock or reassign                   │",
    "│     - File conflicts → mediate                              │",
    "│     - Scope creep → approve or reject                       │",
    "│     - 3 review failures → escalate to human                 │",
    "│                                                             │",
    "└─────────────────────────────────────────────────────────────┘",
    "```",
    "",
    "### Review Tools",
    "",
    "| Tool | Purpose |",
    "|------|---------|",
    "| `swarm_review` | Generate review prompt with epic context, dependencies, and git diff |",
    "| `swarm_review_feedback` | Send approval/rejection to worker (tracks 3-strike rule) |",
    "",
    "### Review Criteria",
    "",
    "- Does work fulfill subtask requirements?",
    "- Does it serve the overall epic goal?",
    "- Does it enable downstream tasks?",
    "- Type safety, no obvious bugs?",
    "",
    "### 3-Strike Rule",
    "",
    "After 3 review rejections, task is marked **blocked**. This signals an architectural problem, not \"try harder.\"",
    "",
    "**NEVER skip the review step.** Workers complete faster when they get feedback.",
  ].join(newline);
}

function updateAgentsToolPreferencesBlock(
  content: string,
  newline: string,
): { content: string; changed: boolean } {
  const lower = content.toLowerCase();
  const openTag = "<tool_preferences>";
  const closeTag = "</tool_preferences>";
  const openIdx = lower.indexOf(openTag);
  const closeIdx = lower.indexOf(closeTag);

  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    return { content, changed: false };
  }

  const blockStart = openIdx;
  const blockEnd = closeIdx + closeTag.length;
  const before = content.slice(0, blockStart);
  const block = content.slice(blockStart, blockEnd);
  const after = content.slice(blockEnd);

  const hasSkillsTools =
    /skills_list/i.test(block) &&
    /skills_use/i.test(block) &&
    /skills_read/i.test(block);
  const hasCassTools =
    /cass_search/i.test(block) &&
    /cass_view/i.test(block) &&
    /cass_expand/i.test(block);
  const hasSemanticTools =
    /semantic-memory_find/i.test(block) &&
    /semantic-memory_store/i.test(block);
  const hasSwarmReviewTools =
    /swarm_review\b/i.test(block) &&
    /swarm_review_feedback/i.test(block);

  const linesToAdd: string[] = [];
  if (!hasSkillsTools) {
    linesToAdd.push(
      "- **skills_list, skills_use, skills_read** - Knowledge injection (load reusable skills)",
    );
  }
  if (!hasCassTools) {
    linesToAdd.push(
      "- **cass_search, cass_view, cass_expand** - Search past agent sessions",
    );
  }
  if (!hasSemanticTools) {
    linesToAdd.push(
      "- **semantic-memory_find, semantic-memory_store, semantic-memory_validate** - Persistent learning across sessions",
    );
  }
  if (!hasSwarmReviewTools) {
    linesToAdd.push(
      "- **swarm_review, swarm_review_feedback** - Coordinator reviews worker output (3-strike rule)",
    );
  }

  if (linesToAdd.length === 0) {
    return { content, changed: false };
  }

  const headingRe = /^###\s+Other Custom Tools.*$/m;
  const headingMatch = headingRe.exec(block);

  let updatedBlock: string;
  const insertion = newline + newline + linesToAdd.join(newline) + newline;

  if (headingMatch) {
    const insertAt = headingMatch.index + headingMatch[0].length;
    updatedBlock = block.slice(0, insertAt) + insertion + block.slice(insertAt);
  } else {
    const closeInBlock = block.toLowerCase().lastIndexOf(closeTag);
    updatedBlock =
      block.slice(0, closeInBlock) + insertion + block.slice(closeInBlock);
  }

  return { content: before + updatedBlock + after, changed: true };
}

function updateAgentsMdContent({
  content,
  bundledSkillsCsv,
}: {
  content: string;
  bundledSkillsCsv: string;
}): { updated: string; changed: boolean; changes: string[] } {
  const newline = detectNewline(content);
  const changes: string[] = [];
  let updated = content;

  // Update bundled skills line (common formats)
  const beforeBundled = updated;
  updated = updated.replace(
    /^\*\*Bundled Skills:\*\*.*$/gm,
    `**Bundled Skills:** ${bundledSkillsCsv}`,
  );
  updated = updated.replace(
    /^\*\*Bundled:\*\*.*$/gm,
    `**Bundled:** ${bundledSkillsCsv}`,
  );
  if (updated !== beforeBundled) {
    changes.push("Updated bundled skills list");
  }

  // Update tool preferences block if present
  const toolPrefsResult = updateAgentsToolPreferencesBlock(updated, newline);
  if (toolPrefsResult.changed) {
    updated = toolPrefsResult.content;
    changes.push("Updated tool_preferences tool list");
  }

  // Add missing sections (append at end)
  const hasSkillsSection =
    /^#{1,6}\s+Skills\b/im.test(updated) || /skills_list\(\)/.test(updated);
  const hasCassSection =
    /^#{1,6}\s+.*CASS\b/im.test(updated) || /cass_search\(/.test(updated);
  const hasSemanticMemorySection =
    /^#{1,6}\s+Semantic Memory\b/im.test(updated) ||
    /semantic-memory_store\(/.test(updated);
  const hasSwarmCoordinatorSection =
    /^#{1,6}\s+Swarm Coordinator\b/im.test(updated) ||
    /swarm_review\(/.test(updated) ||
    /COORDINATOR MONITOR LOOP/i.test(updated);

  const sectionsToAppend: string[] = [];
  if (!hasSkillsSection) {
    sectionsToAppend.push(
      buildAgentsSkillsSection(bundledSkillsCsv, newline),
    );
    changes.push("Added Skills section");
  }
  if (!hasCassSection) {
    sectionsToAppend.push(buildAgentsCassSection(newline));
    changes.push("Added CASS section");
  }
  if (!hasSemanticMemorySection) {
    sectionsToAppend.push(buildAgentsSemanticMemorySection(newline));
    changes.push("Added Semantic Memory section");
  }
  if (!hasSwarmCoordinatorSection) {
    sectionsToAppend.push(buildAgentsSwarmCoordinatorSection(newline));
    changes.push("Added Swarm Coordinator Checklist section");
  }

  if (sectionsToAppend.length > 0) {
    const trimmed = updated.replace(/\s+$/g, "");
    const needsRule = !/^\s*---\s*$/m.test(trimmed.slice(-3000));
    updated =
      trimmed +
      newline +
      newline +
      (needsRule ? `---${newline}${newline}` : "") +
      sectionsToAppend.join(newline + newline);
  }

  // Ensure trailing newline
  if (!updated.endsWith(newline)) {
    updated += newline;
  }

  return { updated, changed: updated !== content, changes };
}

function updateAgentsMdFile({
  agentsPath,
  bundledSkillsCsv,
}: {
  agentsPath: string;
  bundledSkillsCsv: string;
}): { changed: boolean; backupPath?: string; changes: string[] } {
  const original = readFileSync(agentsPath, "utf-8");
  const { updated, changed, changes } = updateAgentsMdContent({
    content: original,
    bundledSkillsCsv,
  });

  if (!changed) {
    return { changed: false, changes: ["No changes needed"] };
  }

  const backupPath = backupFileWithTimestamp(agentsPath) || undefined;
  writeFileSync(agentsPath, updated, "utf-8");
  return { changed: true, backupPath, changes };
}

// ============================================================================
// File Templates
// ============================================================================

/**
 * Get the plugin wrapper template
 *
 * Reads from examples/plugin-wrapper-template.ts which contains a self-contained
 * plugin that shells out to the `swarm` CLI for all tool execution.
 */
function getPluginWrapper(): string {
  const templatePath = join(
    __dirname,
    "..",
    "examples",
    "plugin-wrapper-template.ts",
  );
  try {
    return readFileSync(templatePath, "utf-8");
  } catch (error) {
    // Fallback to minimal wrapper if template not found (shouldn't happen in normal install)
    console.warn(
      `[swarm] Could not read plugin template from ${templatePath}, using minimal wrapper`,
    );
    return `// Minimal fallback - install opencode-swarm-plugin globally for full functionality
import { SwarmPlugin } from "opencode-swarm-plugin"
export default SwarmPlugin
`;
  }
}

const SWARM_COMMAND = `---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Your job is to clarify the task, decompose it into beads, and spawn parallel agents.

## Task

$ARGUMENTS

## CRITICAL: Coordinator Role Boundaries

**⚠️ COORDINATORS NEVER EXECUTE WORK DIRECTLY**

Your role is **ONLY** to:
1. **Clarify** - Ask questions to understand scope
2. **Decompose** - Break into subtasks with clear boundaries  
3. **Spawn** - Create worker agents for ALL subtasks
4. **Monitor** - Check progress, unblock, mediate conflicts
5. **Verify** - Confirm completion, run final checks

**YOU DO NOT:**
- Read implementation files (only metadata/structure for planning)
- Edit code directly
- Run tests yourself (workers run tests)
- Implement features
- Fix bugs inline
- Make "quick fixes" yourself

**ALWAYS spawn workers, even for sequential tasks.** Sequential just means spawn them in order and wait for each to complete before spawning the next.

### Why This Matters

| Coordinator Work | Worker Work | Consequence of Mixing |
|-----------------|-------------|----------------------|
| Sonnet context ($$$) | Disposable context | Expensive context waste |
| Long-lived state | Task-scoped state | Context exhaustion |
| Orchestration concerns | Implementation concerns | Mixed concerns |
| No checkpoints | Checkpoints enabled | No recovery |
| No learning signals | Outcomes tracked | No improvement |

## Workflow

### Phase 0: Socratic Planning (INTERACTIVE - unless --fast)

**Before decomposing, clarify the task with the user.**

Check for flags in the task:
- \`--fast\` → Skip questions, use reasonable defaults
- \`--auto\` → Zero interaction, heuristic decisions
- \`--confirm-only\` → Show plan, get yes/no only

**Default (no flags): Full Socratic Mode**

1. **Analyze task for ambiguity:**
   - Scope unclear? (what's included/excluded)
   - Strategy unclear? (file-based vs feature-based)
   - Dependencies unclear? (what needs to exist first)
   - Success criteria unclear? (how do we know it's done)

2. **If clarification needed, ask ONE question at a time:**
   \`\`\`
   The task "<task>" needs clarification before I can decompose it.

   **Question:** <specific question>

   Options:
   a) <option 1> - <tradeoff>
   b) <option 2> - <tradeoff>
   c) <option 3> - <tradeoff>

   I'd recommend (b) because <reason>. Which approach?
   \`\`\`

3. **Wait for user response before proceeding**

4. **Iterate if needed** (max 2-3 questions)

**Rules:**
- ONE question at a time - don't overwhelm
- Offer concrete options - not open-ended
- Lead with recommendation - save cognitive load
- Wait for answer - don't assume

### Phase 1: Initialize
\`swarmmail_init(project_path="$PWD", task_description="Swarm: <task>")\`

### Phase 2: Knowledge Gathering (MANDATORY)

**Before decomposing, query ALL knowledge sources:**

\`\`\`
semantic-memory_find(query="<task keywords>", limit=5)   # Past learnings
cass_search(query="<task description>", limit=5)         # Similar past tasks  
skills_list()                                            # Available skills
\`\`\`

Synthesize findings into shared_context for workers.

### Phase 3: Decompose
\`\`\`
swarm_select_strategy(task="<task>")
swarm_plan_prompt(task="<task>", context="<synthesized knowledge>")
swarm_validate_decomposition(response="<CellTree JSON>")
\`\`\`

### Phase 4: Create Beads
\`hive_create_epic(epic_title="<task>", subtasks=[...])\`

### Phase 5: DO NOT Reserve Files

> **⚠️ Coordinator NEVER reserves files.** Workers reserve their own files.
> If coordinator reserves, workers get blocked and swarm stalls.

### Phase 6: Spawn Workers for ALL Subtasks (MANDATORY)

> **⚠️ ALWAYS spawn workers, even for sequential tasks.**
> - Parallel tasks: Spawn ALL in a single message
> - Sequential tasks: Spawn one, wait for completion, spawn next

**For parallel work:**
\`\`\`
// Single message with multiple Task calls
swarm_spawn_subtask(bead_id_1, epic_id, title_1, files_1, shared_context, project_path="$PWD")
Task(subagent_type="swarm/worker", prompt="<from above>")
swarm_spawn_subtask(bead_id_2, epic_id, title_2, files_2, shared_context, project_path="$PWD")
Task(subagent_type="swarm/worker", prompt="<from above>")
\`\`\`

**For sequential work:**
\`\`\`
// Spawn worker 1, wait for completion
swarm_spawn_subtask(bead_id_1, ...)
const result1 = await Task(subagent_type="swarm/worker", prompt="<from above>")

// THEN spawn worker 2 with context from worker 1
swarm_spawn_subtask(bead_id_2, ..., shared_context="Worker 1 completed: " + result1)
const result2 = await Task(subagent_type="swarm/worker", prompt="<from above>")
\`\`\`

**NEVER do the work yourself.** Even if it seems faster, spawn a worker.

**IMPORTANT:** Pass \`project_path\` to \`swarm_spawn_subtask\` so workers can call \`swarmmail_init\`.

### Phase 7: MANDATORY Review Loop (NON-NEGOTIABLE)

**⚠️ AFTER EVERY Task() RETURNS, YOU MUST:**

1. **CHECK INBOX** - Worker may have sent messages
   \`swarmmail_inbox()\`
   \`swarmmail_read_message(message_id=N)\`

2. **REVIEW WORK** - Generate review with diff
   \`swarm_review(project_key, epic_id, task_id, files_touched)\`

3. **EVALUATE** - Does it meet epic goals?
   - Fulfills subtask requirements?
   - Serves overall epic goal?
   - Enables downstream tasks?
   - Type safety, no obvious bugs?

4. **SEND FEEDBACK** - Approve or request changes
   \`swarm_review_feedback(project_key, task_id, worker_id, status, issues)\`
   
   **If approved:**
   - Close cell, spawn next worker
   
   **If needs_changes:**
   - \`swarm_review_feedback\` returns \`retry_context\` (NOT sends message - worker is dead)
   - Generate retry prompt: \`swarm_spawn_retry(retry_context)\`
   - Spawn NEW worker with Task() using retry prompt
   - Max 3 attempts before marking task blocked
   
   **If 3 failures:**
   - Mark task blocked, escalate to human

5. **ONLY THEN** - Spawn next worker or complete

**DO NOT skip this. DO NOT batch reviews. Review EACH worker IMMEDIATELY after return.**

**Intervene if:**
- Worker blocked >5min → unblock or reassign
- File conflicts → mediate between workers
- Scope creep → approve or reject expansion
- Review fails 3x → mark task blocked, escalate to human

### Phase 8: Complete
\`\`\`
# After all workers complete and reviews pass:
hive_sync()                                    # Sync all cells to git
# Coordinator does NOT call swarm_complete - workers do that
\`\`\`

## Strategy Reference

| Strategy       | Best For                 | Keywords                               |
| -------------- | ------------------------ | -------------------------------------- |
| file-based     | Refactoring, migrations  | refactor, migrate, rename, update all  |
| feature-based  | New features             | add, implement, build, create, feature |
| risk-based     | Bug fixes, security      | fix, bug, security, critical, urgent   |
| research-based | Investigation, discovery | research, investigate, explore, learn  |

## Flag Reference

| Flag | Effect |
|------|--------|
| \`--fast\` | Skip Socratic questions, use defaults |
| \`--auto\` | Zero interaction, heuristic decisions |
| \`--confirm-only\` | Show plan, get yes/no only |

Begin with Phase 0 (Socratic Planning) unless \`--fast\` or \`--auto\` flag is present.
`;

const getPlannerAgent = (model: string) => `---
name: swarm-planner
description: Strategic task decomposition for swarm coordination
model: ${model}
---

You are a swarm planner. Decompose tasks into optimal parallel subtasks.

## Workflow

### 1. Knowledge Gathering (MANDATORY)

**Before decomposing, query ALL knowledge sources:**

\`\`\`
semantic-memory_find(query="<task keywords>", limit=5)   # Past learnings
cass_search(query="<task description>", limit=5)         # Similar past tasks  
pdf-brain_search(query="<domain concepts>", limit=5)     # Design patterns
skills_list()                                            # Available skills
\`\`\`

Synthesize findings - note relevant patterns, past approaches, and skills to recommend.

### 2. Strategy Selection

\`swarm_select_strategy(task="<task>")\`

### 3. Generate Plan

\`swarm_plan_prompt(task="<task>", context="<synthesized knowledge>")\`

### 4. Output CellTree

Return ONLY valid JSON - no markdown, no explanation:

\`\`\`json
{
  "epic": { "title": "...", "description": "..." },
  "subtasks": [
    {
      "title": "...",
      "description": "Include relevant context from knowledge gathering",
      "files": ["src/..."],
      "dependencies": [],
      "estimated_complexity": 2
    }
  ]
}
\`\`\`

## Rules

- 2-7 subtasks (too few = not parallel, too many = overhead)
- No file overlap between subtasks
- Include tests with the code they test
- Order by dependency (if B needs A, A comes first)
- Pass synthesized knowledge to workers via subtask descriptions
`;

const getWorkerAgent = (model: string) => `---
name: swarm-worker
description: Executes subtasks in a swarm - fast, focused, cost-effective
model: ${model}
---

You are a swarm worker agent. Your prompt contains a **MANDATORY SURVIVAL CHECKLIST** - follow it IN ORDER.

## You Were Spawned Correctly

If you're reading this, a coordinator spawned you - that's the correct pattern. Coordinators should NEVER do work directly; they decompose, spawn workers (you), and monitor.

**If you ever see a coordinator editing code or running tests directly, that's a bug.** Report it.

## CRITICAL: Read Your Prompt Carefully

Your Task prompt contains detailed instructions including:
- 9-step survival checklist (FOLLOW IN ORDER)
- File reservations (YOU reserve, not coordinator)
- Progress reporting requirements
- Completion protocol

**DO NOT skip steps.** The checklist exists because skipping steps causes:
- Lost work (no tracking)
- Edit conflicts (no reservations)
- Wasted time (no semantic memory query)
- Silent failures (no progress reports)

## Step Summary (details in your prompt)

1. **swarmmail_init()** - FIRST, before anything else
2. **semantic-memory_find()** - Check past learnings
3. **skills_list() / skills_use()** - Load relevant skills
4. **swarmmail_reserve()** - YOU reserve your files
5. **Do the work** - Read, implement, verify
6. **swarm_progress()** - Report at 25/50/75%
7. **swarm_checkpoint()** - Before risky operations
8. **semantic-memory_store()** - Store learnings
9. **swarm_complete()** - NOT hive_close

## Non-Negotiables

- **Step 1 is MANDATORY** - swarm_complete fails without init
- **Step 2 saves time** - past agents may have solved this
- **Step 4 prevents conflicts** - workers reserve, not coordinator
- **Step 6 prevents silent failure** - report progress
- **Step 9 is the ONLY way to close** - releases reservations, records learning

## When Blocked

\`\`\`
swarmmail_send(
  to=["coordinator"],
  subject="BLOCKED: <bead-id>",
  body="<what you need>",
  importance="high"
)
hive_update(id="<bead-id>", status="blocked")
\`\`\`

## Focus

- Only modify your assigned files
- Don't fix other agents' code - coordinate instead
- Report scope changes before expanding

Begin by reading your full prompt and executing Step 1.
`;

const getResearcherAgent = (model: string) => `---
name: swarm-researcher
description: READ-ONLY research agent - discovers tools, fetches docs, stores findings
model: ${model}
---

You are a research agent. Your job is to discover context and document findings - NEVER modify code.

## CRITICAL: You Are READ-ONLY

**YOU DO NOT:**
- Edit code files
- Run tests
- Make commits
- Reserve files (you don't edit, so no reservations needed)
- Implement features

**YOU DO:**
- Discover available tools (MCP servers, skills, CLI tools)
- Read lockfiles to get current package versions
- Fetch documentation for those versions
- Store findings in semantic-memory (full details)
- Broadcast summaries via swarm mail (condensed)
- Return structured summary for shared context

## Workflow

### Step 1: Initialize (MANDATORY FIRST)

\`\`\`
swarmmail_init(project_path="/abs/path/to/project", task_description="Research: <what you're researching>")
\`\`\`

### Step 2: Discover Available Tools

**DO NOT assume what tools are installed. Discover them:**

\`\`\`
# Check what skills user has installed
skills_list()

# Check what MCP servers are available (look for context7, pdf-brain, fetch, etc.)
# Note: No direct MCP listing tool - infer from task context or ask coordinator

# Check for CLI tools if relevant (bd, cass, ubs, ollama)
# Use Bash tool to check: which <tool-name>
\`\`\`

### Step 3: Load Relevant Skills

Based on research task, load appropriate skills:

\`\`\`
skills_use(name="<skill-name>", context="Researching <topic>")
\`\`\`

### Step 4: Read Lockfiles (if researching dependencies)

**DO NOT read implementation code.** Only read metadata:

\`\`\`
# For package.json projects
read("package.json")
read("package-lock.json") or read("bun.lock") or read("pnpm-lock.yaml")

# For Python
read("requirements.txt") or read("pyproject.toml")

# For Go
read("go.mod")
\`\`\`

Extract current version numbers for libraries you need to research.

### Step 5: Fetch Documentation

Use available doc tools to get version-specific docs:

\`\`\`
# If context7 available (check skills_list or task context)
# Use it for library docs

# If pdf-brain available
pdf-brain_search(query="<library> <version> <topic>", limit=5)

# If fetch tool available
fetch(url="https://docs.example.com/v2.0/...")

# If repo-crawl available for OSS libraries
repo-crawl_readme(repo="owner/repo")
repo-crawl_file(repo="owner/repo", path="docs/...")
\`\`\`

### Step 6: Store Full Findings in Semantic Memory

**Store detailed findings for future agents:**

\`\`\`
semantic-memory_store(
  information="Researched <library> v<version>. Key findings: <detailed notes with examples, gotchas, patterns>",
  metadata="<library>, <version>, <topic>, research"
)
\`\`\`

**Include:**
- Library/framework versions discovered
- Key API patterns
- Breaking changes from previous versions
- Common gotchas
- Relevant examples

### Step 7: Broadcast Condensed Summary via Swarm Mail

**Send concise summary to coordinator:**

\`\`\`
swarmmail_send(
  to=["coordinator"],
  subject="Research Complete: <topic>",
  body="<3-5 bullet points with key takeaways>",
  thread_id="<epic-id>"
)
\`\`\`

### Step 8: Return Structured Summary

**Output format for shared_context:**

\`\`\`json
{
  "researched": "<topic>",
  "tools_discovered": ["skill-1", "skill-2", "mcp-server-1"],
  "versions": {
    "library-1": "1.2.3",
    "library-2": "4.5.6"
  },
  "key_findings": [
    "Finding 1 with actionable insight",
    "Finding 2 with actionable insight",
    "Finding 3 with actionable insight"
  ],
  "relevant_skills": ["skill-to-use-1", "skill-to-use-2"],
  "stored_in_memory": true
}
\`\`\`

## Tool Discovery Patterns

### Skills Discovery

\`\`\`
skills_list()
# Returns: Available skills from global, project, bundled sources

# Load relevant skill for research domain
skills_use(name="<skill>", context="Researching <topic>")
\`\`\`

### MCP Server Detection

**No direct listing tool.** Infer from:
- Task context (coordinator may mention available tools)
- Trial: Try calling a tool and catch error if not available
- Read OpenCode config if accessible

### CLI Tool Detection

\`\`\`
# Check if tool is installed
bash("which <tool>", description="Check if <tool> is available")

# Examples:
bash("which cass", description="Check CASS availability")
bash("which ubs", description="Check UBS availability")
bash("ollama --version", description="Check Ollama availability")
\`\`\`

## Context Efficiency Rules (MANDATORY)

**NEVER dump raw documentation.** Always summarize.

| ❌ Bad (Context Bomb) | ✅ Good (Condensed) |
|---------------------|-------------------|
| Paste entire API reference | "Library uses hooks API. Key hooks: useQuery, useMutation. Breaking change in v2: callbacks removed." |
| Copy full changelog | "v2.0 breaking changes: renamed auth() → authenticate(), dropped IE11 support" |
| Include all examples | "Common pattern: async/await with error boundaries (stored full example in semantic-memory)" |

**Storage Strategy:**
- **Semantic Memory**: Full details, examples, code snippets
- **Swarm Mail**: 3-5 bullet points only
- **Return Value**: Structured JSON summary

## When to Use This Agent

**DO spawn researcher when:**
- Task requires understanding current tech stack versions
- Need to fetch library/framework documentation
- Discovering project conventions from config files
- Researching best practices for unfamiliar domain

**DON'T spawn researcher when:**
- Information is already in semantic memory (query first!)
- Task doesn't need external docs
- Time-sensitive work (research adds latency)

## Example Research Tasks

**"Research Next.js 16 caching APIs"**

1. Read package.json → extract Next.js version
2. Use context7 or fetch to get Next.js 16 cache docs
3. Store findings: unstable_cache, revalidatePath, cache patterns
4. Broadcast: "Next.js 16 uses native fetch caching + unstable_cache for functions"
5. Return structured summary with key APIs

**"Discover available testing tools"**

1. Check skills_list for testing-patterns skill
2. Check which jest/vitest/bun (bash tool)
3. Read package.json devDependencies
4. Store findings: test runner, assertion library, coverage tool
5. Broadcast: "Project uses Bun test with happy-dom"
6. Return tool inventory

Begin by executing Step 1 (swarmmail_init).
`;

// ============================================================================
// Commands
// ============================================================================

/**
 * Get the fix command for a dependency
 * Returns null for manual installs (those show a link instead)
 */
function getFixCommand(dep: Dependency): string | null {
  switch (dep.name) {
    case "OpenCode":
      return "brew install sst/tap/opencode";
    case "Ollama":
      return "brew install ollama && ollama pull mxbai-embed-large";
    case "Redis":
      return "brew install redis && brew services start redis";
    case "CASS (Coding Agent Session Search)":
      return "See: https://github.com/Dicklesworthstone/coding_agent_session_search";
    case "UBS (Ultimate Bug Scanner)":
      return "See: https://github.com/Dicklesworthstone/ultimate_bug_scanner";
    default:
      // Fallback to generic install command if available
      return dep.installType !== "manual" ? dep.install : null;
  }
}

async function doctor() {
  p.intro("swarm doctor v" + VERSION);

  const s = p.spinner();
  s.start("Checking dependencies...");

  const results = await checkAllDependencies();

  s.stop("Dependencies checked");

  const required = results.filter((r) => r.dep.required);
  const optional = results.filter((r) => !r.dep.required);

  p.log.step("Required dependencies:");
  for (const { dep, available, version } of required) {
    if (available) {
      p.log.success(dep.name + (version ? " v" + version : ""));
    } else {
      p.log.error(dep.name + " - not found");
      const fixCmd = getFixCommand(dep);
      if (fixCmd) {
        p.log.message(dim("   └─ Fix: " + fixCmd));
      }
    }
  }

  p.log.step("Optional dependencies:");
  for (const { dep, available, version } of optional) {
    if (available) {
      p.log.success(
        dep.name + (version ? " v" + version : "") + " - " + dep.description,
      );
    } else {
      p.log.warn(dep.name + " - not found (" + dep.description + ")");
      const fixCmd = getFixCommand(dep);
      if (fixCmd) {
        p.log.message(dim("   └─ Fix: " + fixCmd));
      }
    }
  }

  const requiredMissing = required.filter((r) => !r.available);
  const optionalMissing = optional.filter((r) => !r.available);

  // Check skills
  p.log.step("Skills:");
  const configDir = join(homedir(), ".config", "opencode");
  const globalSkillsPath = join(configDir, "skills");
  const bundledSkillsPath = join(__dirname, "..", "global-skills");

  // Global skills directory
  if (existsSync(globalSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const skills = readdirSync(globalSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      if (skills.length > 0) {
        p.log.success(`Global skills (${skills.length}): ${skills.join(", ")}`);
      } else {
        p.log.warn("Global skills directory exists but is empty");
      }
    } catch {
      p.log.warn("Global skills directory: " + globalSkillsPath);
    }
  } else {
    p.log.warn("No global skills directory (run 'swarm setup' to create)");
  }

  // Bundled skills
  if (existsSync(bundledSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const bundled = readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      p.log.success(
        `Bundled skills (${bundled.length}): ${bundled.join(", ")}`,
      );
    } catch {
      p.log.warn("Could not read bundled skills");
    }
  }

  // Project skills (check current directory)
  const projectSkillsDirs = [".opencode/skills", ".claude/skills", "skills"];
  for (const dir of projectSkillsDirs) {
    if (existsSync(dir)) {
      try {
        const { readdirSync } = require("fs");
        const skills = readdirSync(dir, { withFileTypes: true })
          .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
          .map((d: { name: string }) => d.name);
        if (skills.length > 0) {
          p.log.success(
            `Project skills in ${dir}/ (${skills.length}): ${skills.join(", ")}`,
          );
        }
      } catch {
        // Ignore
      }
    }
  }

  if (requiredMissing.length > 0) {
    p.outro(
      "Missing " +
        requiredMissing.length +
        " required dependencies. Run 'swarm setup' to install.",
    );
    process.exit(1);
  } else if (optionalMissing.length > 0) {
    p.outro(
      "All required dependencies installed. " +
        optionalMissing.length +
        " optional missing.",
    );
  } else {
    p.outro("All dependencies installed!");
  }

  // Check for updates (non-blocking)
  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

async function setup() {
  console.clear();
  console.log(yellow(BANNER));
  console.log(getDecoratedBee());
  console.log();
  console.log(magenta("  " + getRandomMessage()));
  console.log();

  p.intro("opencode-swarm-plugin v" + VERSION);

  // Migrate legacy database if present (do this first, before config check)
  const cwd = process.cwd();
  const tempDirName = getLibSQLProjectTempDirName(cwd);
  const tempDir = join(tmpdir(), tempDirName);
  const pglitePath = join(tempDir, "streams");
  const libsqlPath = join(tempDir, "streams.db");
  
  if (pgliteExists(pglitePath)) {
    const migrateSpinner = p.spinner();
    migrateSpinner.start("Migrating...");
    
    try {
      const result = await migratePGliteToLibSQL({
        pglitePath,
        libsqlPath,
        dryRun: false,
        onProgress: () => {},
      });
      
      const total = result.memories.migrated + result.beads.migrated;
      if (total > 0) {
        migrateSpinner.stop(`Migrated ${result.memories.migrated} memories, ${result.beads.migrated} cells`);
      } else {
        migrateSpinner.stop("Migrated");
      }
      
      if (result.errors.length > 0) {
        p.log.warn(`${result.errors.length} errors during migration`);
      }
    } catch (error) {
      migrateSpinner.stop("Migration failed");
      p.log.error(error instanceof Error ? error.message : String(error));
    }
  }

  let isReinstall = false;

  // Check if already configured
  p.log.step("Checking existing configuration...");
  const configDir = join(homedir(), ".config", "opencode");
  const pluginDir = join(configDir, "plugin");
  const commandDir = join(configDir, "command");
  const agentDir = join(configDir, "agent");

  const pluginPath = join(pluginDir, "swarm.ts");
  const commandPath = join(commandDir, "swarm.md");
  const swarmAgentDir = join(agentDir, "swarm");
  const plannerAgentPath = join(swarmAgentDir, "planner.md");
  const workerAgentPath = join(swarmAgentDir, "worker.md");
  const researcherAgentPath = join(swarmAgentDir, "researcher.md");
  // Legacy flat paths (for detection/cleanup)
  const legacyPlannerPath = join(agentDir, "swarm-planner.md");
  const legacyWorkerPath = join(agentDir, "swarm-worker.md");

  const existingFiles = [
    pluginPath,
    commandPath,
    plannerAgentPath,
    workerAgentPath,
    researcherAgentPath,
    legacyPlannerPath,
    legacyWorkerPath,
  ].filter((f) => existsSync(f));

  if (existingFiles.length > 0) {
    p.log.success("Swarm is already configured!");
    p.log.message(dim("  Found " + existingFiles.length + "/5 config files"));

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        {
          value: "skip",
          label: "Keep existing config",
          hint: "Exit without changes",
        },
        {
          value: "models",
          label: "Update agent models",
          hint: "Keep customizations, just change models",
        },
        {
          value: "reinstall",
          label: "Reinstall everything",
          hint: "Check deps, sync bundled skills, regenerate config files",
        },
      ],
    });

    if (p.isCancel(action) || action === "skip") {
      p.outro("Config unchanged. Run 'swarm config' to see file locations.");
      return;
    }

    if (action === "models") {
      // Quick model update flow
      const coordinatorModel = await p.select({
        message: "Select coordinator model:",
        options: COORDINATOR_MODELS,
        initialValue: "anthropic/claude-sonnet-4-5",
      });

      if (p.isCancel(coordinatorModel)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      const workerModel = await p.select({
        message: "Select worker model:",
        options: WORKER_MODELS,
        initialValue: "anthropic/claude-haiku-4-5",
      });

      if (p.isCancel(workerModel)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      // Update model lines in agent files (check both nested and legacy paths)
      const plannerPaths = [plannerAgentPath, legacyPlannerPath].filter(existsSync);
      const workerPaths = [workerAgentPath, legacyWorkerPath].filter(existsSync);

      for (const path of plannerPaths) {
        const content = readFileSync(path, "utf-8");
        const updated = content.replace(
          /^model: .+$/m,
          `model: ${coordinatorModel}`,
        );
        writeFileSync(path, updated);
      }
      if (plannerPaths.length > 0) {
        p.log.success("Planner: " + coordinatorModel);
      }

      for (const path of workerPaths) {
        const content = readFileSync(path, "utf-8");
        const updated = content.replace(
          /^model: .+$/m,
          `model: ${workerModel}`,
        );
        writeFileSync(path, updated);
      }
      if (workerPaths.length > 0) {
        p.log.success("Worker: " + workerModel);
      }

      p.outro("Models updated! Your customizations are preserved.");
      return;
    }
    if (action === "reinstall") {
      isReinstall = true;
      p.log.step("Reinstalling swarm configuration...");
      p.log.message(dim("  This will check dependencies, sync skills, and update config files"));
    }
    // action === "reinstall" - fall through to full setup
  }

  // Full setup flow
  const s = p.spinner();
  s.start("Checking dependencies...");

  const results = await checkAllDependencies();

  s.stop("Dependencies checked");

  const required = results.filter((r) => r.dep.required);
  const optional = results.filter((r) => !r.dep.required);
  const requiredMissing = required.filter((r) => !r.available);
  const optionalMissing = optional.filter((r) => !r.available);

  for (const { dep, available } of results) {
    if (available) {
      p.log.success(dep.name);
    } else if (dep.required) {
      p.log.error(dep.name + " (required)");
    } else {
      p.log.warn(dep.name + " (optional)");
    }
  }

  if (requiredMissing.length > 0) {
    p.log.step("Missing " + requiredMissing.length + " required dependencies");

    for (const { dep } of requiredMissing) {
      const shouldInstall = await p.confirm({
        message: "Install " + dep.name + "? (" + dep.description + ")",
        initialValue: true,
      });

      if (p.isCancel(shouldInstall)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (shouldInstall) {
        const installSpinner = p.spinner();
        installSpinner.start("Installing " + dep.name + "...");

        const success = await runInstall(dep.install);

        if (success) {
          installSpinner.stop(dep.name + " installed");
        } else {
          installSpinner.stop("Failed to install " + dep.name);
          p.log.error("Manual install: " + dep.install);
        }
      } else {
        p.log.warn("Skipping " + dep.name + " - swarm may not work correctly");
      }
    }
  }

  // Only prompt for optional deps if there are missing ones
  if (optionalMissing.length > 0) {
    const installable = optionalMissing.filter(
      (r) => r.dep.installType !== "manual",
    );

    if (installable.length > 0) {
      const toInstall = await p.multiselect({
        message: "Install optional dependencies?",
        options: installable.map(({ dep }) => ({
          value: dep.name,
          label: dep.name,
          hint: dep.description,
        })),
        required: false,
      });

      if (p.isCancel(toInstall)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (Array.isArray(toInstall) && toInstall.length > 0) {
        for (const name of toInstall) {
          const { dep } = installable.find((r) => r.dep.name === name)!;

          if (dep.name === "Agent Mail") {
            const goResult = results.find((r) => r.dep.name === "Go");
            if (!goResult?.available) {
              p.log.warn("Agent Mail requires Go. Installing Go first...");
              const goDep = DEPENDENCIES.find((d) => d.name === "Go")!;
              const goSpinner = p.spinner();
              goSpinner.start("Installing Go...");
              const goSuccess = await runInstall(goDep.install);
              if (goSuccess) {
                goSpinner.stop("Go installed");
              } else {
                goSpinner.stop("Failed to install Go");
                p.log.error("Cannot install Agent Mail without Go");
                continue;
              }
            }
          }

          const installSpinner = p.spinner();
          installSpinner.start("Installing " + dep.name + "...");

          const success = await runInstall(dep.install);

          if (success) {
            installSpinner.stop(dep.name + " installed");
          } else {
            installSpinner.stop("Failed to install " + dep.name);
            p.log.message("  Manual: " + dep.install);
          }
        }
      }
    }

    const manual = optionalMissing.filter(
      (r) => r.dep.installType === "manual",
    );
    if (manual.length > 0) {
      p.log.step("Manual installation required:");
      for (const { dep } of manual) {
        p.log.message("  " + dep.name + ": " + dep.install);
      }
    }
  }

  // Check for .beads → .hive migration
  p.log.step("Checking for legacy .beads directory...");
  const migrationCheck = checkBeadsMigrationNeeded(cwd);
  if (migrationCheck.needed) {
    p.log.warn("Found legacy .beads directory");
    p.log.message(dim("  Path: " + migrationCheck.beadsPath));
    p.log.message(dim("  Will rename to .hive/ and merge history"));
    
    const shouldMigrate = await p.confirm({
      message: "Migrate .beads to .hive? (recommended)",
      initialValue: true,
    });

    if (p.isCancel(shouldMigrate)) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }

    if (shouldMigrate) {
      const migrateSpinner = p.spinner();
      migrateSpinner.start("Migrating .beads to .hive...");
      
      try {
        const result = await migrateBeadsToHive(cwd);
        if (result.migrated) {
          migrateSpinner.stop("Renamed .beads/ → .hive/");
          p.log.success("Directory migration complete");
          
          // Merge historic beads into issues.jsonl
          migrateSpinner.start("Merging historic cells...");
          const mergeResult = await mergeHistoricBeads(cwd);
          if (mergeResult.merged > 0) {
            migrateSpinner.stop("Historic cells merged");
            p.log.success(`Merged ${mergeResult.merged} cells (${mergeResult.skipped} already present)`);
          } else {
            migrateSpinner.stop("No historic cells to merge");
          }
          
          // Import JSONL into PGLite database
          migrateSpinner.start("Importing to database...");
          const importResult = await importJsonlToPGLite(cwd);
          migrateSpinner.stop("Database import complete");
          if (importResult.imported > 0 || importResult.updated > 0) {
            p.log.success(`Database: ${importResult.imported} imported, ${importResult.updated} updated`);
          }
        } else {
          migrateSpinner.stop("Migration skipped");
          p.log.warn(result.reason || "Unknown reason");
        }
      } catch (error) {
        migrateSpinner.stop("Migration failed");
        p.log.error(error instanceof Error ? error.message : String(error));
      }
    } else {
      p.log.warn("Skipping migration - .beads will continue to work but is deprecated");
    }
  } else {
    p.log.message(dim("  No legacy .beads directory found"));
  }

  // Check for legacy semantic-memory MCP server in OpenCode config
  p.log.step("Checking for legacy MCP servers...");
  const opencodeConfigPath = join(configDir, 'config.json');
  if (existsSync(opencodeConfigPath)) {
    try {
      const opencodeConfig = JSON.parse(readFileSync(opencodeConfigPath, 'utf-8'));
      if (opencodeConfig.mcpServers?.['semantic-memory']) {
        p.log.warn('Found legacy semantic-memory MCP server');
        p.log.message(dim('  Semantic memory is now embedded in the plugin'));
        
        const removeMcp = await p.confirm({
          message: 'Remove from MCP servers config?',
          initialValue: true,
        });

        if (p.isCancel(removeMcp)) {
          p.cancel('Setup cancelled');
          process.exit(0);
        }

        if (removeMcp) {
          delete opencodeConfig.mcpServers['semantic-memory'];
          writeFileSync(opencodeConfigPath, JSON.stringify(opencodeConfig, null, 2));
          p.log.success('Removed semantic-memory from MCP servers');
          p.log.message(dim(`  Updated: ${opencodeConfigPath}`));
        } else {
          p.log.warn('Keeping legacy MCP - you may see duplicate semantic-memory tools');
        }
      } else {
        p.log.message(dim('  No legacy MCP servers found'));
      }
    } catch (error) {
      p.log.message(dim('  Could not parse OpenCode config (skipping MCP check)'));
    }
  } else {
    p.log.message(dim('  No OpenCode config found (skipping MCP check)'));
  }

  // Model selection
  p.log.step("Configuring swarm agents...");
  p.log.message(dim("  Coordinator handles orchestration, worker executes tasks"));

  const coordinatorModel = await p.select({
    message: "Select coordinator model (for orchestration/planning):",
    options: [
      {
        value: "anthropic/claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        hint: "Best balance of speed and capability (recommended)",
      },
      {
        value: "anthropic/claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        hint: "Fast and cost-effective",
      },
      {
        value: "anthropic/claude-opus-4-5",
        label: "Claude Opus 4.5",
        hint: "Most capable, slower",
      },
      {
        value: "openai/gpt-4o",
        label: "GPT-4o",
        hint: "Fast, good for most tasks",
      },
      {
        value: "openai/gpt-4-turbo",
        label: "GPT-4 Turbo",
        hint: "Powerful, more expensive",
      },
      {
        value: "google/gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        hint: "Fast and capable",
      },
      {
        value: "google/gemini-1.5-pro",
        label: "Gemini 1.5 Pro",
        hint: "More capable",
      },
    ],
    initialValue: "anthropic/claude-sonnet-4-5",
  });

  if (p.isCancel(coordinatorModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const workerModel = await p.select({
    message: "Select worker model (for task execution):",
    options: [
      {
        value: "anthropic/claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        hint: "Fast and cost-effective (recommended)",
      },
      {
        value: "anthropic/claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        hint: "Best balance of speed and capability",
      },
      {
        value: "anthropic/claude-opus-4-5",
        label: "Claude Opus 4.5",
        hint: "Most capable, slower",
      },
      {
        value: "openai/gpt-4o",
        label: "GPT-4o",
        hint: "Fast, good for most tasks",
      },
      {
        value: "openai/gpt-4-turbo",
        label: "GPT-4 Turbo",
        hint: "Powerful, more expensive",
      },
      {
        value: "google/gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        hint: "Fast and capable",
      },
      {
        value: "google/gemini-1.5-pro",
        label: "Gemini 1.5 Pro",
        hint: "More capable",
      },
    ],
    initialValue: "anthropic/claude-haiku-4-5",
  });

  if (p.isCancel(workerModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  // Lite model selection for simple tasks (docs, tests)
  const liteModel = await p.select({
    message: "Select lite model (for docs, tests, simple edits):",
    options: [
      {
        value: "anthropic/claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        hint: "Fast and cost-effective (recommended)",
      },
      {
        value: "anthropic/claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        hint: "More capable, slower",
      },
      {
        value: "openai/gpt-4o-mini",
        label: "GPT-4o Mini",
        hint: "Fast and cheap",
      },
      {
        value: "google/gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        hint: "Fast and capable",
      },
    ],
    initialValue: "anthropic/claude-haiku-4-5",
  });

  if (p.isCancel(liteModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  p.log.success("Selected models:");
  p.log.message(dim(`  Coordinator: ${coordinatorModel}`));
  p.log.message(dim(`  Worker: ${workerModel}`));
  p.log.message(dim(`  Lite: ${liteModel}`));

  p.log.step("Setting up OpenCode integration...");

  // Track file operation statistics
  const stats: FileStats = { created: 0, updated: 0, unchanged: 0 };

  // Create directories if needed
  p.log.step("Creating configuration directories...");
  const skillsDir = join(configDir, "skills");
  for (const dir of [pluginDir, commandDir, agentDir, swarmAgentDir, skillsDir]) {
    mkdirWithStatus(dir);
  }

  // Write plugin and command files
  p.log.step("Writing configuration files...");
  stats[writeFileWithStatus(pluginPath, getPluginWrapper(), "Plugin")]++;
  stats[writeFileWithStatus(commandPath, SWARM_COMMAND, "Command")]++;

  // Write nested agent files (swarm/planner.md, swarm/worker.md, swarm/researcher.md)
  // This is the format used by Task(subagent_type="swarm/worker")
  p.log.step("Writing agent configuration...");
  stats[writeFileWithStatus(plannerAgentPath, getPlannerAgent(coordinatorModel as string), "Planner agent")]++;
  stats[writeFileWithStatus(workerAgentPath, getWorkerAgent(workerModel as string), "Worker agent")]++;
  stats[writeFileWithStatus(researcherAgentPath, getResearcherAgent(workerModel as string), "Researcher agent")]++;

  // Clean up legacy flat agent files if they exist
  if (existsSync(legacyPlannerPath) || existsSync(legacyWorkerPath)) {
    p.log.step("Cleaning up legacy agent files...");
  }
  rmWithStatus(legacyPlannerPath, "legacy planner");
  rmWithStatus(legacyWorkerPath, "legacy worker");

  p.log.message(dim(`  Skills directory: ${skillsDir}`));

  // Show bundled skills info (and optionally sync to global skills dir)
  const bundledSkillsPath = join(__dirname, "..", "global-skills");
  const bundledSkills = listDirectoryNames(bundledSkillsPath);
  if (existsSync(bundledSkillsPath)) {
    if (bundledSkills.length > 0) {
      p.log.message(dim("  Bundled skills: " + bundledSkills.join(", ")));
    }
  }

  // If the user keeps their skills in ~/.config/opencode/skills, offer to sync the bundled set
  if (bundledSkills.length > 0) {
    const globalSkills = listDirectoryNames(skillsDir);
    const managedBundled = globalSkills.filter((name) =>
      existsSync(join(skillsDir, name, BUNDLED_SKILL_MARKER_FILENAME)),
    );
    const missingBundled = bundledSkills.filter(
      (name) => !globalSkills.includes(name),
    );

    if (missingBundled.length > 0 || managedBundled.length > 0) {
      const shouldSync = await p.confirm({
        message:
          "Sync bundled skills into your global skills directory? " +
          (missingBundled.length > 0
            ? `(${missingBundled.length} missing)`
            : "(update managed skills)"),
        initialValue: isReinstall || missingBundled.length > 0,
      });

      if (p.isCancel(shouldSync)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (shouldSync) {
        const syncSpinner = p.spinner();
        syncSpinner.start("Syncing bundled skills...");
        try {
          const { installed, updated, skipped } = syncBundledSkillsToGlobal({
            bundledSkillsPath,
            globalSkillsPath: skillsDir,
            version: VERSION,
          });
          syncSpinner.stop("Bundled skills synced");

          if (installed.length > 0) {
            p.log.success("Installed: " + installed.join(", "));
          }
          if (updated.length > 0) {
            p.log.success("Updated: " + updated.join(", "));
          }
          if (skipped.length > 0) {
            p.log.message(
              dim(
                "Skipped (already exists, not managed): " + skipped.join(", "),
              ),
            );
          }
        } catch (error) {
          syncSpinner.stop("Could not sync bundled skills");
          p.log.warn(
            "Bundled skills are still available from the package via skills_list.",
          );
          p.log.message(
            dim(error instanceof Error ? error.message : String(error)),
          );
        }
      }
    }
  }

  // Offer to update AGENTS.md with skill awareness
  const agentsPath = join(configDir, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const updateAgents = await p.confirm({
      message: "Update AGENTS.md with skill awareness?",
      initialValue: true,
    });

    if (!p.isCancel(updateAgents) && updateAgents) {
      const s = p.spinner();
      s.start("Updating AGENTS.md...");

      try {
        const bundledSkillsCsv =
          bundledSkills.length > 0
            ? bundledSkills.join(", ")
            : "cli-builder, learning-systems, skill-creator, swarm-coordination, system-design, testing-patterns";

        const result = updateAgentsMdFile({ agentsPath, bundledSkillsCsv });

        if (result.changed) {
          s.stop("AGENTS.md updated");
          p.log.success("Updated: " + agentsPath);
          if (result.backupPath) {
            p.log.message(dim("  Backup: " + result.backupPath));
          }
        } else {
          s.stop("AGENTS.md already up to date");
        }
      } catch (error) {
        s.stop("Could not update AGENTS.md");
        p.log.error(
          error instanceof Error ? error.message : "Unknown error updating file",
        );
      }
    }
  }

  // Show setup summary
  const totalFiles = stats.created + stats.updated + stats.unchanged;
  const summaryParts: string[] = [];
  if (stats.created > 0) summaryParts.push(`${stats.created} created`);
  if (stats.updated > 0) summaryParts.push(`${stats.updated} updated`);
  if (stats.unchanged > 0) summaryParts.push(`${stats.unchanged} unchanged`);
  
  p.log.message("");
  p.log.success(`Setup complete: ${totalFiles} files (${summaryParts.join(", ")})`);

  p.note(
    'cd your-project\nswarm init\nopencode\n/swarm "your task"\n\nSkills: Use skills_list to see available skills',
    "Next steps",
  );

  p.outro("Run 'swarm doctor' to verify installation.");
}

async function init() {
  p.intro("swarm init v" + VERSION);

  const projectPath = process.cwd();

  const gitDir = existsSync(".git");
  if (!gitDir) {
    p.log.error("Not in a git repository");
    p.log.message("Run 'git init' first, or cd to a git repo");
    p.outro("Aborted");
    process.exit(1);
  }

  // Check for existing .hive or .beads directories
  const hiveDir = existsSync(".hive");
  const beadsDir = existsSync(".beads");
  
  if (hiveDir) {
    p.log.warn("Hive already initialized in this project (.hive/ exists)");

    const reinit = await p.confirm({
      message: "Continue anyway?",
      initialValue: false,
    });

    if (p.isCancel(reinit) || !reinit) {
      p.outro("Aborted");
      process.exit(0);
    }
  } else if (beadsDir) {
    // Offer migration from .beads to .hive
    p.log.warn("Found legacy .beads/ directory");
    
    const migrate = await p.confirm({
      message: "Migrate .beads/ to .hive/?",
      initialValue: true,
    });

    if (!p.isCancel(migrate) && migrate) {
      const s = p.spinner();
      s.start("Migrating .beads/ to .hive/...");
      
      const result = await migrateBeadsToHive(projectPath);
      
      if (result.migrated) {
        s.stop("Migration complete");
        p.log.success("Renamed .beads/ to .hive/");
        
        // Merge historic beads if beads.base.jsonl exists
        const mergeResult = await mergeHistoricBeads(projectPath);
        if (mergeResult.merged > 0) {
          p.log.success(`Merged ${mergeResult.merged} historic cells`);
        }
      } else {
        s.stop("Migration skipped: " + result.reason);
      }
    }
  }

  const s = p.spinner();
  s.start("Initializing hive...");

  try {
    // Create .hive directory using our function (no bd CLI needed)
    ensureHiveDirectory(projectPath);
    
    s.stop("Hive initialized");
    p.log.success("Created .hive/ directory");

    const createCell = await p.confirm({
      message: "Create your first cell?",
      initialValue: true,
    });

    if (!p.isCancel(createCell) && createCell) {
      const title = await p.text({
        message: "Cell title:",
        placeholder: "Implement user authentication",
        validate: (v) => (v.length === 0 ? "Title required" : undefined),
      });

      if (!p.isCancel(title)) {
        const typeResult = await p.select({
          message: "Type:",
          options: [
            { value: "feature", label: "Feature", hint: "New functionality" },
            { value: "bug", label: "Bug", hint: "Something broken" },
            { value: "task", label: "Task", hint: "General work item" },
            { value: "chore", label: "Chore", hint: "Maintenance" },
          ],
        });

        if (!p.isCancel(typeResult)) {
          const cellSpinner = p.spinner();
          cellSpinner.start("Creating cell...");

          try {
            // Use HiveAdapter to create the cell (no bd CLI needed)
            const adapter = await getHiveAdapter(projectPath);
            const cell = await adapter.createCell(projectPath, {
              title: title as string,
              type: typeResult as "feature" | "bug" | "task" | "chore",
              priority: 2,
            });
            
            cellSpinner.stop("Cell created: " + cell.id);
          } catch (error) {
            cellSpinner.stop("Failed to create cell");
            p.log.error(error instanceof Error ? error.message : String(error));
          }
        }
      }
    }

    // Offer to create project skills directory
    const createSkillsDir = await p.confirm({
      message: "Create project skills directory (.opencode/skills/)?",
      initialValue: false,
    });

    if (!p.isCancel(createSkillsDir) && createSkillsDir) {
      const skillsPath = ".opencode/skills";
      if (!existsSync(skillsPath)) {
        mkdirSync(skillsPath, { recursive: true });
        p.log.success("Created " + skillsPath + "/");
        p.log.message(
          dim("  Add SKILL.md files here for project-specific skills"),
        );
      } else {
        p.log.warn(skillsPath + "/ already exists");
      }
    }

    p.outro("Project initialized! Use '/swarm' in OpenCode to get started.");
  } catch (error) {
    s.stop("Failed to initialize hive");
    p.log.error(error instanceof Error ? error.message : String(error));
    p.outro("Aborted");
    process.exit(1);
  }
}

async function version() {
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE));
  console.log();
  console.log("  Version: " + VERSION);
  console.log("  Docs:    https://github.com/joelhooks/swarm-tools");
  console.log();
  console.log(cyan("  Get started:"));
  console.log("    swarm setup    " + dim("Configure OpenCode integration"));
  console.log("    swarm doctor   " + dim("Check dependencies"));
  console.log();

  // Check for updates (non-blocking)
  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

function config() {
  const configDir = join(homedir(), ".config", "opencode");
  const pluginPath = join(configDir, "plugin", "swarm.ts");
  const commandPath = join(configDir, "command", "swarm.md");
  const swarmAgentDir = join(configDir, "agent", "swarm");
  const plannerAgentPath = join(swarmAgentDir, "planner.md");
  const workerAgentPath = join(swarmAgentDir, "worker.md");
  const researcherAgentPath = join(swarmAgentDir, "researcher.md");
  const globalSkillsPath = join(configDir, "skills");

  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log();
  console.log(cyan("Config Files:"));
  console.log();

  const files = [
    { path: pluginPath, desc: "Plugin loader", emoji: "🔌" },
    { path: commandPath, desc: "/swarm command prompt", emoji: "📜" },
    { path: plannerAgentPath, desc: "@swarm/planner agent", emoji: "🤖" },
    { path: workerAgentPath, desc: "@swarm/worker agent", emoji: "🐝" },
    { path: researcherAgentPath, desc: "@swarm/researcher agent", emoji: "🔬" },
  ];

  for (const { path, desc, emoji } of files) {
    const exists = existsSync(path);
    const status = exists ? "✓" : "✗";
    const color = exists ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${emoji} ${desc}`);
    console.log(`     ${color}${status}\x1b[0m ${dim(path)}`);
    console.log();
  }

  // Skills section
  console.log(cyan("Skills:"));
  console.log();

  // Global skills directory
  const globalSkillsExists = existsSync(globalSkillsPath);
  const globalStatus = globalSkillsExists ? "✓" : "✗";
  const globalColor = globalSkillsExists ? "\x1b[32m" : "\x1b[31m";
  console.log(`  📚 Global skills directory`);
  console.log(
    `     ${globalColor}${globalStatus}\x1b[0m ${dim(globalSkillsPath)}`,
  );

  // Count skills if directory exists
  if (globalSkillsExists) {
    try {
      const { readdirSync } = require("fs");
      const skills = readdirSync(globalSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      if (skills.length > 0) {
        console.log(
          `     ${dim(`Found ${skills.length} skill(s): ${skills.join(", ")}`)}`,
        );
      }
    } catch {
      // Ignore errors
    }
  }
  console.log();

  // Project skills locations
  console.log(`  📁 Project skills locations ${dim("(checked in order)")}`);
  console.log(`     ${dim(".opencode/skills/")}`);
  console.log(`     ${dim(".claude/skills/")}`);
  console.log(`     ${dim("skills/")}`);
  console.log();

  // Bundled skills info
  const bundledSkillsPath = join(__dirname, "..", "global-skills");
  if (existsSync(bundledSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const bundled = readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      console.log(`  🎁 Bundled skills ${dim("(always available)")}`);
      console.log(`     ${dim(bundled.join(", "))}`);
      console.log();
    } catch {
      // Ignore errors
    }
  }

  console.log(dim("Edit these files to customize swarm behavior."));
  console.log(dim("Run 'swarm setup' to regenerate defaults."));
  console.log();
}

async function update() {
  p.intro("swarm update v" + VERSION);

  const s = p.spinner();
  s.start("Checking for updates...");

  const updateInfo = await checkForUpdates();

  if (!updateInfo) {
    s.stop("Failed to check for updates");
    p.log.error("Could not reach npm registry");
    p.outro("Try again later or update manually:");
    console.log("  " + cyan("npm install -g " + PACKAGE_NAME + "@latest"));
    process.exit(1);
  }

  if (!updateInfo.updateAvailable) {
    s.stop("Already on latest version");
    p.log.success("You're running " + VERSION);
    p.outro("No update needed!");
    return;
  }

  s.stop("Update available: " + VERSION + " → " + updateInfo.latest);

  const confirmUpdate = await p.confirm({
    message: "Update to v" + updateInfo.latest + "?",
    initialValue: true,
  });

  if (p.isCancel(confirmUpdate) || !confirmUpdate) {
    p.outro("Update cancelled");
    return;
  }

  const updateSpinner = p.spinner();
  updateSpinner.start("Updating to v" + updateInfo.latest + "...");

  const success = await runInstall(
    "npm install -g " + PACKAGE_NAME + "@latest",
  );

  if (success) {
    updateSpinner.stop("Updated to v" + updateInfo.latest);
    p.outro("Success! Restart your terminal to use the new version.");
  } else {
    updateSpinner.stop("Update failed");
    p.log.error("Failed to update via npm");
    p.log.message("Try manually:");
    console.log("  " + cyan("npm install -g " + PACKAGE_NAME + "@latest"));
    p.outro("Update failed");
    process.exit(1);
  }
}

async function help() {
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log(getDecoratedBee());
  console.log(magenta("  " + getRandomMessage()));
  console.log(`
${cyan("Commands:")}
  swarm setup     Interactive installer - checks and installs dependencies
  swarm doctor    Health check - shows status of all dependencies
  swarm init      Initialize beads in current project
  swarm config    Show paths to generated config files
  swarm agents    Update AGENTS.md with skill awareness
  swarm migrate   Migrate PGlite database to libSQL
  swarm log       View swarm logs with filtering
  swarm update    Update to latest version
  swarm version   Show version and banner
  swarm tool      Execute a tool (for plugin wrapper)
  swarm help      Show this help

${cyan("Tool Execution:")}
  swarm tool --list                    List all available tools
  swarm tool <name>                    Execute tool with no args
  swarm tool <name> --json '<args>'    Execute tool with JSON args

${cyan("Log Viewing:")}
  swarm log                            Tail recent logs (last 50 lines)
  swarm log <module>                   Filter by module (e.g., compaction)
  swarm log --level <level>            Filter by level (trace, debug, info, warn, error, fatal)
  swarm log --since <duration>         Time filter (30s, 5m, 2h, 1d)
  swarm log --json                     Raw JSON output for jq
  swarm log --limit <n>                Limit output to n lines (default: 50)

${cyan("Usage in OpenCode:")}
  /swarm "Add user authentication with OAuth"
  @swarm/planner "Decompose this into parallel tasks"
  @swarm/worker "Execute this specific subtask"
  @swarm/researcher "Research Next.js caching APIs"

${cyan("Customization:")}
  Edit the generated files to customize behavior:
  ${dim("~/.config/opencode/command/swarm.md")}           - /swarm command prompt
  ${dim("~/.config/opencode/agent/swarm/planner.md")}     - @swarm/planner (coordinator)
  ${dim("~/.config/opencode/agent/swarm/worker.md")}      - @swarm/worker (task executor)
  ${dim("~/.config/opencode/agent/swarm/researcher.md")}  - @swarm/researcher (read-only research)
  ${dim("~/.config/opencode/plugin/swarm.ts")}           - Plugin loader

${dim("Docs: https://github.com/joelhooks/opencode-swarm-plugin")}
`);

  // Check for updates (non-blocking)
  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

// ============================================================================
// Tool Execution (for plugin wrapper)
// ============================================================================

/**
 * Execute a tool by name with JSON args
 *
 * This is the bridge between the plugin wrapper and the actual tool implementations.
 * The plugin wrapper shells out to `swarm tool <name> --json '<args>'` and this
 * function executes the tool and returns JSON.
 *
 * Exit codes:
 * - 0: Success
 * - 1: Tool execution error (error details in JSON output)
 * - 2: Unknown tool name
 * - 3: Invalid JSON args
 */
async function executeTool(toolName: string, argsJson?: string) {
  // Lazy import to avoid loading all tools on every CLI invocation
  const { allTools } = await import("../src/index");

  // Validate tool name
  if (!(toolName in allTools)) {
    const availableTools = Object.keys(allTools).sort();
    console.log(
      JSON.stringify({
        success: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: `Unknown tool: ${toolName}`,
          available_tools: availableTools,
        },
      }),
    );
    process.exit(2);
  }

  // Parse args
  let args: Record<string, unknown> = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.log(
        JSON.stringify({
          success: false,
          error: {
            code: "INVALID_JSON",
            message: `Invalid JSON args: ${e instanceof Error ? e.message : String(e)}`,
            raw_input: argsJson.slice(0, 200),
          },
        }),
      );
      process.exit(3);
    }
  }

  // Create mock context for tools that need sessionID
  // This mimics what OpenCode provides to plugins
  const mockContext = {
    sessionID: process.env.OPENCODE_SESSION_ID || `cli-${Date.now()}`,
    messageID: process.env.OPENCODE_MESSAGE_ID || `msg-${Date.now()}`,
    agent: process.env.OPENCODE_AGENT || "cli",
    abort: new AbortController().signal,
  };

  // Get the tool
  const toolDef = allTools[toolName as keyof typeof allTools];

  // Execute tool
  // Note: We cast args to any because the CLI accepts arbitrary JSON
  // The tool's internal Zod validation will catch type errors
  try {
    const result = await toolDef.execute(args as any, mockContext);

    // If result is already valid JSON, try to parse and re-wrap it
    // Otherwise wrap the string result
    try {
      const parsed = JSON.parse(result);
      // If it's already a success/error response, pass through
      if (typeof parsed === "object" && "success" in parsed) {
        console.log(JSON.stringify(parsed));
      } else {
        console.log(JSON.stringify({ success: true, data: parsed }));
      }
    } catch {
      // Result is a plain string, wrap it
      console.log(JSON.stringify({ success: true, data: result }));
    }
    process.exit(0);
  } catch (error) {
    console.log(
      JSON.stringify({
        success: false,
        error: {
          code: error instanceof Error ? error.name : "TOOL_ERROR",
          message: error instanceof Error ? error.message : String(error),
          details:
            error instanceof Error && "zodError" in error
              ? (error as { zodError?: unknown }).zodError
              : undefined,
        },
      }),
    );
    process.exit(1);
  }
}

/**
 * List all available tools
 */
async function listTools() {
  const { allTools } = await import("../src/index");
  const tools = Object.keys(allTools).sort();

  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log();
  console.log(cyan("Available tools:") + ` (${tools.length} total)`);
  console.log();

  // Group by prefix
  const groups: Record<string, string[]> = {};
  for (const tool of tools) {
    const prefix = tool.split("_")[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(tool);
  }

  for (const [prefix, toolList] of Object.entries(groups)) {
    console.log(green(`  ${prefix}:`));
    for (const t of toolList) {
      console.log(`    ${t}`);
    }
    console.log();
  }

  console.log(dim("Usage: swarm tool <name> [--json '<args>']"));
  console.log(dim("Example: swarm tool hive_ready"));
  console.log(
    dim('Example: swarm tool hive_create --json \'{"title": "Fix bug"}\''),
  );
}

// ============================================================================
// Agents Command - Update AGENTS.md with skill awareness
// ============================================================================

async function agents() {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  const agentsPath = join(home, ".config", "opencode", "AGENTS.md");

  p.intro(yellow(BANNER));

  // Check if AGENTS.md exists
  if (!existsSync(agentsPath)) {
    p.log.warn("No AGENTS.md found at " + agentsPath);
    p.log.message(
      dim("Create one first, then run this command to add skill awareness"),
    );
    p.outro("Aborted");
    return;
  }

  const confirm = await p.confirm({
    message: "Update AGENTS.md with skill awareness?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro("Aborted");
    return;
  }

  const s = p.spinner();
  s.start("Updating AGENTS.md with skill awareness...");

  const bundledSkillsPath = join(__dirname, "..", "global-skills");
  const bundledSkills = listDirectoryNames(bundledSkillsPath);

  try {
    const bundledSkillsCsv =
      bundledSkills.length > 0
        ? bundledSkills.join(", ")
        : "cli-builder, learning-systems, skill-creator, swarm-coordination, system-design, testing-patterns";

    const result = updateAgentsMdFile({ agentsPath, bundledSkillsCsv });

    if (result.changed) {
      s.stop("AGENTS.md updated with skill awareness");
      p.log.success("Skills section added to " + agentsPath);
      p.log.message(
        dim("Skills available: skills_list, skills_use, skills_read"),
      );
      if (result.backupPath) {
        p.log.message(dim("Backup: " + result.backupPath));
      }
    } else {
      s.stop("AGENTS.md already up to date");
    }
  } catch (error) {
    s.stop("Failed to update AGENTS.md");
    p.log.error(String(error));
  }

  p.outro("Done");
}

// ============================================================================
// Migrate Command - PGlite → libSQL migration
// ============================================================================

async function migrate() {
  p.intro("swarm migrate v" + VERSION);

  const projectPath = process.cwd();
  
  // Calculate the temp directory path (same logic as libsql.convenience.ts)
  const tempDirName = getLibSQLProjectTempDirName(projectPath);
  const tempDir = join(tmpdir(), tempDirName);
  const pglitePath = join(tempDir, "streams");
  const libsqlPath = join(tempDir, "streams.db");

  // Check if PGlite exists
  if (!pgliteExists(pglitePath)) {
    p.log.success("No PGlite database found - nothing to migrate!");
    p.outro("Done");
    return;
  }

  // Dry run to show counts
  const s = p.spinner();
  s.start("Scanning PGlite database...");

  try {
    const dryResult = await migratePGliteToLibSQL({
      pglitePath,
      libsqlPath,
      dryRun: true,
      onProgress: () => {}, // silent during dry run
    });

    s.stop("Scan complete");

    // Show summary
    const totalItems = 
      dryResult.memories.migrated + 
      dryResult.beads.migrated + 
      dryResult.messages.migrated + 
      dryResult.agents.migrated + 
      dryResult.events.migrated;

    if (totalItems === 0) {
      p.log.warn("PGlite database exists but contains no data");
      p.outro("Nothing to migrate");
      return;
    }

    p.log.step("Found data to migrate:");
    if (dryResult.memories.migrated > 0) {
      p.log.message(`  📝 ${dryResult.memories.migrated} memories`);
    }
    if (dryResult.beads.migrated > 0) {
      p.log.message(`  🐝 ${dryResult.beads.migrated} cells`);
    }
    if (dryResult.messages.migrated > 0) {
      p.log.message(`  ✉️  ${dryResult.messages.migrated} messages`);
    }
    if (dryResult.agents.migrated > 0) {
      p.log.message(`  🤖 ${dryResult.agents.migrated} agents`);
    }
    if (dryResult.events.migrated > 0) {
      p.log.message(`  📋 ${dryResult.events.migrated} events`);
    }

    // Confirm
    const confirm = await p.confirm({
      message: "Migrate this data to libSQL?",
      initialValue: true,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.outro("Migration cancelled");
      return;
    }

    // Run actual migration
    const migrateSpinner = p.spinner();
    migrateSpinner.start("Migrating data...");

    const result = await migratePGliteToLibSQL({
      pglitePath,
      libsqlPath,
      dryRun: false,
      onProgress: (msg) => {
        // Update spinner for key milestones
        if (msg.includes("Migrating") || msg.includes("complete")) {
          migrateSpinner.message(msg.replace("[migrate] ", ""));
        }
      },
    });

    migrateSpinner.stop("Migration complete!");

    // Show results
    const showStat = (label: string, stat: { migrated: number; skipped: number; failed: number }) => {
      if (stat.migrated > 0 || stat.skipped > 0 || stat.failed > 0) {
        const parts: string[] = [];
        if (stat.migrated > 0) parts.push(green(`${stat.migrated} migrated`));
        if (stat.skipped > 0) parts.push(dim(`${stat.skipped} skipped`));
        if (stat.failed > 0) parts.push(`\x1b[31m${stat.failed} failed\x1b[0m`);
        p.log.message(`  ${label}: ${parts.join(", ")}`);
      }
    };

    showStat("Memories", result.memories);
    showStat("Cells", result.beads);
    showStat("Messages", result.messages);
    showStat("Agents", result.agents);
    showStat("Events", result.events);

    if (result.errors.length > 0) {
      p.log.warn(`${result.errors.length} errors occurred`);
    }

    p.outro("Migration complete! 🐝");

  } catch (error) {
    s.stop("Migration failed");
    p.log.error(error instanceof Error ? error.message : String(error));
    p.outro("Migration failed");
    process.exit(1);
  }
}

// ============================================================================
// Log Command - View swarm logs with filtering
// ============================================================================

interface LogLine {
  level: number;
  time: string;
  module: string;
  msg: string;
}

function parseLogLine(line: string): LogLine | null {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed.level === "number" && parsed.time && parsed.msg) {
      return {
        level: parsed.level,
        time: parsed.time,
        module: parsed.module || "unknown",
        msg: parsed.msg,
      };
    }
  } catch {
    // Invalid JSON
  }
  return null;
}

function levelToName(level: number): string {
  if (level >= 60) return "FATAL";
  if (level >= 50) return "ERROR";
  if (level >= 40) return "WARN ";
  if (level >= 30) return "INFO ";
  if (level >= 20) return "DEBUG";
  return "TRACE";
}

function levelToColor(level: number): (s: string) => string {
  if (level >= 50) return (s: string) => `\x1b[31m${s}\x1b[0m`; // red
  if (level >= 40) return (s: string) => `\x1b[33m${s}\x1b[0m`; // yellow
  if (level >= 30) return green; // green
  return dim; // dim for debug/trace
}

function levelNameToNumber(name: string): number {
  const lower = name.toLowerCase();
  if (lower === "fatal") return 60;
  if (lower === "error") return 50;
  if (lower === "warn") return 40;
  if (lower === "info") return 30;
  if (lower === "debug") return 20;
  if (lower === "trace") return 10;
  return 30; // default to info
}

function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  
  const [, num, unit] = match;
  const value = parseInt(num, 10);
  
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  
  return value * multipliers[unit];
}

function formatLogLine(log: LogLine, useColor = true): string {
  const timestamp = new Date(log.time).toLocaleTimeString();
  const levelName = levelToName(log.level);
  const module = log.module.padEnd(12);
  const levelStr = useColor ? levelToColor(log.level)(levelName) : levelName;
  
  return `${timestamp} ${levelStr} ${module} ${log.msg}`;
}

function readLogFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  
  const allFiles = readdirSync(dir);
  const logFiles = allFiles
    .filter((f: string) => /\.\d+log$/.test(f))
    .sort()
    .map((f: string) => join(dir, f));
  
  const lines: string[] = [];
  for (const file of logFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      const fileLines = content.split("\n").filter((line: string) => line.trim());
      lines.push(...fileLines);
    } catch {
      // Skip unreadable files
    }
  }
  
  return lines;
}

async function logs() {
  const args = process.argv.slice(3);
  
  // Parse arguments
  let moduleFilter: string | null = null;
  let levelFilter: number | null = null;
  let sinceMs: number | null = null;
  let jsonOutput = false;
  let limit = 50;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--level" && i + 1 < args.length) {
      levelFilter = levelNameToNumber(args[++i]);
    } else if (arg === "--since" && i + 1 < args.length) {
      const duration = parseDuration(args[++i]);
      if (duration === null) {
        p.log.error(`Invalid duration format: ${args[i]}`);
        p.log.message(dim("  Use format: 30s, 5m, 2h, 1d"));
        process.exit(1);
      }
      sinceMs = duration;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--limit" && i + 1 < args.length) {
      limit = parseInt(args[++i], 10);
      if (isNaN(limit) || limit <= 0) {
        p.log.error(`Invalid limit: ${args[i]}`);
        process.exit(1);
      }
    } else if (!arg.startsWith("--")) {
      // Positional arg = module filter
      moduleFilter = arg;
    }
  }
  
  // Read logs from ~/.config/swarm-tools/logs/
  const logsDir = join(homedir(), ".config", "swarm-tools", "logs");
  
  if (!existsSync(logsDir)) {
    if (!jsonOutput) {
      p.log.warn("No logs directory found");
      p.log.message(dim(`  Expected: ${logsDir}`));
    } else {
      console.log(JSON.stringify({ logs: [] }));
    }
    return;
  }
  
  const rawLines = readLogFiles(logsDir);
  
  // Parse and filter
  let logs: LogLine[] = rawLines
    .map(parseLogLine)
    .filter((log): log is LogLine => log !== null);
  
  // Apply filters
  if (moduleFilter) {
    logs = logs.filter((log) => log.module === moduleFilter);
  }
  
  if (levelFilter !== null) {
    logs = logs.filter((log) => log.level >= levelFilter);
  }
  
  if (sinceMs !== null) {
    const cutoffTime = Date.now() - sinceMs;
    logs = logs.filter((log) => new Date(log.time).getTime() >= cutoffTime);
  }
  
  // Apply limit (keep most recent)
  logs = logs.slice(-limit);
  
  // Output
  if (jsonOutput) {
    console.log(JSON.stringify({ logs }, null, 2));
  } else {
    if (logs.length === 0) {
      p.log.warn("No logs found matching filters");
      return;
    }
    
    console.log(yellow(BANNER));
    console.log(dim(`  Logs (${logs.length} entries)`));
    if (moduleFilter) console.log(dim(`  Module: ${moduleFilter}`));
    if (levelFilter !== null) console.log(dim(`  Level: >=${levelToName(levelFilter)}`));
    if (sinceMs !== null) console.log(dim(`  Since: last ${args[args.indexOf("--since") + 1]}`));
    console.log();
    
    for (const log of logs) {
      console.log(formatLogLine(log));
    }
    console.log();
  }
}

// ============================================================================
// Database Info Command
// ============================================================================

/**
 * Show database location and status
 * 
 * Helps debug which database is being used and its schema state.
 */
async function db() {
  const projectPath = process.cwd();
  const projectName = basename(projectPath);
  const hash = hashLibSQLProjectPath(projectPath);
  const dbPath = getLibSQLDatabasePath(projectPath);
  const dbDir = dirname(dbPath.replace("file:", ""));
  const dbFile = dbPath.replace("file:", "");
  
  console.log(yellow(BANNER));
  console.log(dim(`  ${TAGLINE}\n`));
  
  console.log(cyan("  Database Info\n"));
  
  console.log(`  ${dim("Project:")}     ${projectPath}`);
  console.log(`  ${dim("Project Name:")} ${projectName}`);
  console.log(`  ${dim("Hash:")}         ${hash}`);
  console.log(`  ${dim("DB Directory:")} ${dbDir}`);
  console.log(`  ${dim("DB File:")}      ${dbFile}`);
  console.log();
  
  // Check if database exists
  if (existsSync(dbFile)) {
    const stats = statSync(dbFile);
    const sizeKB = Math.round(stats.size / 1024);
    console.log(`  ${green("✓")} Database exists (${sizeKB} KB)`);
    
    // Check schema
    try {
      const { execSync } = await import("child_process");
      const schema = execSync(`sqlite3 "${dbFile}" "SELECT sql FROM sqlite_master WHERE type='table' AND name='beads'"`, { encoding: "utf-8" }).trim();
      
      if (schema) {
        const hasProjectKey = schema.includes("project_key");
        if (hasProjectKey) {
          console.log(`  ${green("✓")} Schema is correct (has project_key)`);
        } else {
          console.log(`  \x1b[31m✗\x1b[0m Schema is OLD (missing project_key)`);
          console.log();
          console.log(dim("    To fix: delete the database and restart OpenCode"));
          console.log(dim(`    rm -r "${dbDir}"`));
        }
      } else {
        console.log(`  ${dim("○")} No beads table yet (will be created on first use)`);
      }
      
      // Check schema_version
      try {
        const version = execSync(`sqlite3 "${dbFile}" "SELECT MAX(version) FROM schema_version"`, { encoding: "utf-8" }).trim();
        if (version && version !== "") {
          console.log(`  ${dim("○")} Schema version: ${version}`);
        }
      } catch {
        console.log(`  ${dim("○")} No schema_version table`);
      }
      
      // Count records
      try {
        const beadCount = execSync(`sqlite3 "${dbFile}" "SELECT COUNT(*) FROM beads"`, { encoding: "utf-8" }).trim();
        console.log(`  ${dim("○")} Cells: ${beadCount}`);
      } catch {
        // Table doesn't exist yet
      }
      
      try {
        const memoryCount = execSync(`sqlite3 "${dbFile}" "SELECT COUNT(*) FROM memories"`, { encoding: "utf-8" }).trim();
        console.log(`  ${dim("○")} Memories: ${memoryCount}`);
      } catch {
        // Table doesn't exist yet
      }
      
    } catch (error) {
      console.log(`  ${dim("○")} Could not inspect schema (sqlite3 not available)`);
    }
  } else {
    console.log(`  ${dim("○")} Database does not exist yet`);
    console.log(dim("    Will be created on first use"));
  }
  
  // Check for legacy PGLite
  console.log();
  const pglitePath = join(dbDir, "streams");
  if (existsSync(pglitePath)) {
    console.log(`  \x1b[33m!\x1b[0m Legacy PGLite directory exists`);
    console.log(dim(`    ${pglitePath}`));
    console.log(dim("    Run 'swarm migrate' to migrate data"));
  }
  
  console.log();
}

// ============================================================================
// Main
// ============================================================================

const command = process.argv[2];

switch (command) {
  case "setup":
    await setup();
    break;
  case "doctor":
    await doctor();
    break;
  case "init":
    await init();
    break;
  case "config":
    config();
    break;
  case "update":
    await update();
    break;
  case "tool": {
    const toolName = process.argv[3];
    if (!toolName || toolName === "--list" || toolName === "-l") {
      await listTools();
    } else {
      // Look for --json flag
      const jsonFlagIndex = process.argv.indexOf("--json");
      const argsJson =
        jsonFlagIndex !== -1 ? process.argv[jsonFlagIndex + 1] : undefined;
      await executeTool(toolName, argsJson);
    }
    break;
  }
  case "agents":
    await agents();
    break;
  case "migrate":
    await migrate();
    break;
  case "db":
    await db();
    break;
  case "log":
  case "logs":
    await logs();
    break;
  case "version":
  case "--version":
  case "-v":
    await version();
    break;
  case "help":
  case "--help":
  case "-h":
    await help();
    break;
  case undefined:
    await setup();
    break;
  default:
    console.error("Unknown command: " + command);
    help();
    process.exit(1);
}
