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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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
  {
    name: "Beads",
    command: "bd",
    checkArgs: ["--version"],
    required: true,
    install:
      "curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash",
    installType: "curl",
    description: "Git-backed issue tracking",
  },
  {
    name: "Go",
    command: "go",
    checkArgs: ["version"],
    required: false,
    install: "brew install go",
    installType: "brew",
    description: "Required for Agent Mail",
  },
  {
    name: "Agent Mail",
    command: "curl",
    checkArgs: [
      "-s",
      "-X",
      "POST",
      "http://localhost:8765/mcp",
      "-H",
      "Content-Type: application/json",
      "-d",
      "{}",
      "-o",
      "/dev/null",
    ],
    required: false,
    install: "https://github.com/Dicklesworthstone/mcp_agent_mail",
    installType: "manual",
    description: "Multi-agent coordination & file reservations",
  },
  {
    name: "CASS",
    command: "cass",
    checkArgs: ["--help"],
    required: false,
    install: "https://github.com/Dicklesworthstone/cass",
    installType: "manual",
    description: "Cross-agent session search",
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
    name: "semantic-memory",
    command: "semantic-memory",
    checkArgs: ["stats"],
    required: false,
    install: "npm install -g semantic-memory",
    installType: "npm",
    description: "Learning persistence with vector search",
  },
  {
    name: "Redis",
    command: "redis-cli",
    checkArgs: ["ping"],
    required: false,
    install: "brew install redis && brew services start redis",
    installType: "brew",
    description: "Rate limiting (SQLite fallback available)",
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

You are a swarm coordinator. Take a complex task, break it into beads, and unleash parallel agents.

## Usage

/swarm <task description or bead-id>

## Workflow

1. **Initialize**: \`agentmail_init\` with project_path and task_description
2. **Decompose**: Use \`swarm_select_strategy\` then \`swarm_plan_prompt\` to break down the task
3. **Create beads**: \`beads_create_epic\` with subtasks and file assignments
4. **Reserve files**: \`agentmail_reserve\` for each subtask's files
5. **Spawn agents**: Use Task tool with \`swarm_spawn_subtask\` prompts (or use @swarm-worker for sequential/single-file tasks)
6. **Monitor**: Check \`agentmail_inbox\` for progress, use \`agentmail_summarize_thread\` for overview
7. **Complete**: \`swarm_complete\` when done, then \`beads_sync\` to push

## Strategy Selection

The plugin auto-selects decomposition strategy based on task keywords:

| Strategy      | Best For                | Keywords                               |
| ------------- | ----------------------- | -------------------------------------- |
| file-based    | Refactoring, migrations | refactor, migrate, rename, update all  |
| feature-based | New features            | add, implement, build, create, feature |
| risk-based    | Bug fixes, security     | fix, bug, security, critical, urgent   |

Begin decomposition now.
`;

const getPlannerAgent = (model: string) => `---
name: swarm-planner
description: Strategic task decomposition for swarm coordination
model: ${model}
---

You are a swarm planner. Decompose tasks into optimal parallel subtasks.

## Workflow

1. Call \`swarm_select_strategy\` to analyze the task
2. Call \`swarm_plan_prompt\` to get strategy-specific guidance
3. Create a BeadTree following the guidelines
4. Return ONLY valid JSON - no markdown, no explanation

## Output Format

\`\`\`json
{
  "epic": { "title": "...", "description": "..." },
  "subtasks": [
    {
      "title": "...",
      "description": "...",
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
`;

const getWorkerAgent = (model: string) => `---
name: swarm-worker
description: Executes subtasks in a swarm - fast, focused, cost-effective
model: ${model}
---

You are a swarm worker agent. Execute your assigned subtask efficiently.

## Rules
- Focus ONLY on your assigned files
- Report progress via Agent Mail
- Use beads_update to track status
- Call swarm_complete when done

## Workflow
1. Read assigned files
2. Implement changes
3. Verify (typecheck if applicable)
4. Report completion
`;

// ============================================================================
// Commands
// ============================================================================

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
      p.log.message("  Install: " + dep.install);
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
      if (dep.installType !== "manual") {
        p.log.message("  Install: " + dep.install);
      } else {
        p.log.message("  See: " + dep.install);
      }
    }
  }

  const requiredMissing = required.filter((r) => !r.available);
  const optionalMissing = optional.filter((r) => !r.available);

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

  // Check if already configured FIRST
  const configDir = join(homedir(), ".config", "opencode");
  const pluginDir = join(configDir, "plugin");
  const commandDir = join(configDir, "command");
  const agentDir = join(configDir, "agent");

  const pluginPath = join(pluginDir, "swarm.ts");
  const commandPath = join(commandDir, "swarm.md");
  const plannerAgentPath = join(agentDir, "swarm-planner.md");
  const workerAgentPath = join(agentDir, "swarm-worker.md");

  const existingFiles = [
    pluginPath,
    commandPath,
    plannerAgentPath,
    workerAgentPath,
  ].filter((f) => existsSync(f));

  if (existingFiles.length > 0) {
    p.log.success("Swarm is already configured!");
    p.log.message(dim("  Found " + existingFiles.length + "/4 config files"));

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
          hint: "Check deps and regenerate all config files",
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

      // Update model lines in agent files
      if (existsSync(plannerAgentPath)) {
        const content = readFileSync(plannerAgentPath, "utf-8");
        const updated = content.replace(
          /^model: .+$/m,
          `model: ${coordinatorModel}`,
        );
        writeFileSync(plannerAgentPath, updated);
        p.log.success("Planner: " + coordinatorModel);
      }
      if (existsSync(workerAgentPath)) {
        const content = readFileSync(workerAgentPath, "utf-8");
        const updated = content.replace(
          /^model: .+$/m,
          `model: ${workerModel}`,
        );
        writeFileSync(workerAgentPath, updated);
        p.log.success("Worker: " + workerModel);
      }
      p.outro("Models updated! Your customizations are preserved.");
      return;
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

  // Model selection
  p.log.step("Configure swarm agents...");

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

  p.log.step("Setting up OpenCode integration...");

  // Create directories if needed
  for (const dir of [pluginDir, commandDir, agentDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  writeFileSync(pluginPath, getPluginWrapper());
  p.log.success("Plugin: " + pluginPath);

  writeFileSync(commandPath, SWARM_COMMAND);
  p.log.success("Command: " + commandPath);

  writeFileSync(plannerAgentPath, getPlannerAgent(coordinatorModel as string));
  p.log.success("Planner agent: " + plannerAgentPath);

  writeFileSync(workerAgentPath, getWorkerAgent(workerModel as string));
  p.log.success("Worker agent: " + workerAgentPath);

  p.note(
    'cd your-project\nbd init\nopencode\n/swarm "your task"',
    "Next steps",
  );

  p.outro("Setup complete! Run 'swarm doctor' to verify.");
}

async function init() {
  p.intro("swarm init v" + VERSION);

  const gitDir = existsSync(".git");
  if (!gitDir) {
    p.log.error("Not in a git repository");
    p.log.message("Run 'git init' first, or cd to a git repo");
    p.outro("Aborted");
    process.exit(1);
  }

  const beadsDir = existsSync(".beads");
  if (beadsDir) {
    p.log.warn("Beads already initialized in this project");

    const reinit = await p.confirm({
      message: "Re-initialize beads?",
      initialValue: false,
    });

    if (p.isCancel(reinit) || !reinit) {
      p.outro("Aborted");
      process.exit(0);
    }
  }

  const s = p.spinner();
  s.start("Initializing beads...");

  const success = await runInstall("bd init");

  if (success) {
    s.stop("Beads initialized");
    p.log.success("Created .beads/ directory");

    const createBead = await p.confirm({
      message: "Create your first bead?",
      initialValue: true,
    });

    if (!p.isCancel(createBead) && createBead) {
      const title = await p.text({
        message: "Bead title:",
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
          const beadSpinner = p.spinner();
          beadSpinner.start("Creating bead...");

          const createSuccess = await runInstall(
            'bd create --title "' + title + '" --type ' + typeResult,
          );

          if (createSuccess) {
            beadSpinner.stop("Bead created");
          } else {
            beadSpinner.stop("Failed to create bead");
          }
        }
      }
    }

    p.outro("Project initialized! Use '/swarm' in OpenCode to get started.");
  } else {
    s.stop("Failed to initialize beads");
    p.log.error("Make sure 'bd' is installed: swarm doctor");
    p.outro("Aborted");
    process.exit(1);
  }
}

async function version() {
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE));
  console.log();
  console.log("  Version: " + VERSION);
  console.log("  Docs:    https://github.com/joelhooks/opencode-swarm-plugin");
  console.log();

  // Check for updates (non-blocking)
  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

function config() {
  const configDir = join(homedir(), ".config", "opencode");
  const pluginPath = join(configDir, "plugin", "swarm.ts");
  const commandPath = join(configDir, "command", "swarm.md");
  const plannerAgentPath = join(configDir, "agent", "swarm-planner.md");
  const workerAgentPath = join(configDir, "agent", "swarm-worker.md");

  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log();
  console.log(cyan("Config Files:"));
  console.log();

  const files = [
    { path: pluginPath, desc: "Plugin loader", emoji: "🔌" },
    { path: commandPath, desc: "/swarm command prompt", emoji: "📜" },
    { path: plannerAgentPath, desc: "@swarm-planner agent", emoji: "🤖" },
    { path: workerAgentPath, desc: "@swarm-worker agent", emoji: "🐝" },
  ];

  for (const { path, desc, emoji } of files) {
    const exists = existsSync(path);
    const status = exists ? "✓" : "✗";
    const color = exists ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${emoji} ${desc}`);
    console.log(`     ${color}${status}\x1b[0m ${dim(path)}`);
    console.log();
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
  swarm update    Update to latest version
  swarm version   Show version and banner
  swarm tool      Execute a tool (for plugin wrapper)
  swarm help      Show this help

${cyan("Tool Execution:")}
  swarm tool --list                    List all available tools
  swarm tool <name>                    Execute tool with no args
  swarm tool <name> --json '<args>'    Execute tool with JSON args

${cyan("Usage in OpenCode:")}
  /swarm "Add user authentication with OAuth"
  @swarm-planner "Decompose this into parallel tasks"
  @swarm-worker "Execute this specific subtask"

${cyan("Customization:")}
  Edit the generated files to customize behavior:
  ${dim("~/.config/opencode/command/swarm.md")}       - /swarm command prompt
  ${dim("~/.config/opencode/agent/swarm-planner.md")}  - @swarm-planner (coordinator)
  ${dim("~/.config/opencode/agent/swarm-worker.md")}   - @swarm-worker (fast executor)
  ${dim("~/.config/opencode/plugin/swarm.ts")}        - Plugin loader

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
  console.log(dim("Example: swarm tool beads_ready"));
  console.log(
    dim('Example: swarm tool beads_create --json \'{"title": "Fix bug"}\''),
  );
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
