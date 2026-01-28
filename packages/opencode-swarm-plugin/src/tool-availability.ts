/**
 * Tool Availability Module
 *
 * Checks for external tool availability and provides graceful degradation.
 * Tools are checked once and cached for the session.
 *
 * Supported tools:
 * - semantic-memory: Learning persistence with semantic search
 * - cass: Cross-agent session search for historical context
 * - hive: Git-backed issue tracking (primary)
 * - beads (bd): DEPRECATED - Use hive instead (kept for backward compatibility)
 * - swarm-mail: Embedded multi-agent coordination (PGLite-based)
 * - agent-mail: DEPRECATED - Legacy MCP server (use swarm-mail instead)
 */

import { checkSwarmHealth } from "swarm-mail";

/** Default timeout for URL reachability checks in milliseconds */
const DEFAULT_URL_TIMEOUT_MS = 2000;

/** Timeout for bunx commands (semantic-memory check) in milliseconds */
const BUNX_TIMEOUT_MS = 10000;

export type ToolName =
  | "semantic-memory"
  | "cass"
  | "hivemind" // Unified memory system (ADR-011) - replaces semantic-memory + cass
  | "hive"
  | "beads" // DEPRECATED: Use "hive" instead
  | "swarm-mail"
  | "agent-mail";

export interface ToolStatus {
  available: boolean;
  checkedAt: string;
  error?: string;
  version?: string;
}

export interface ToolAvailability {
  tool: ToolName;
  status: ToolStatus;
  fallbackBehavior: string;
}

// Cached tool status
const toolCache = new Map<ToolName, ToolStatus>();

// Warnings already logged (to avoid spam)
const warningsLogged = new Set<ToolName>();

/**
 * Check if a command exists and is executable
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await Bun.$`which ${cmd}`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a URL is reachable.
 * Uses GET instead of HEAD because some servers don't support HEAD.
 * We only check response.ok status, not body content, so GET has minimal overhead vs HEAD.
 */
async function urlReachable(
  url: string,
  timeoutMs: number = DEFAULT_URL_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Use GET instead of HEAD - some servers don't support HEAD
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Tool-specific availability checks
 */
const toolCheckers: Record<ToolName, () => Promise<ToolStatus>> = {
  "semantic-memory": async () => {
    // Check native first, then bunx
    const nativeExists = await commandExists("semantic-memory");
    if (nativeExists) {
      try {
        const result = await Bun.$`semantic-memory stats`.quiet().nothrow();
        return {
          available: result.exitCode === 0,
          checkedAt: new Date().toISOString(),
          version: "native",
        };
      } catch (e) {
        return {
          available: false,
          checkedAt: new Date().toISOString(),
          error: String(e),
        };
      }
    }

    // Try bunx with manual timeout
    try {
      const proc = Bun.spawn(["bunx", "semantic-memory", "stats"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeout = setTimeout(() => proc.kill(), BUNX_TIMEOUT_MS);
      try {
        const exitCode = await proc.exited;
        return {
          available: exitCode === 0,
          checkedAt: new Date().toISOString(),
          version: "bunx",
        };
      } finally {
        clearTimeout(timeout);
        proc.kill(); // Safe to call even if already dead
      }
    } catch (e) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: String(e),
      };
    }
  },

  cass: async () => {
    const exists = await commandExists("cass");
    if (!exists) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: "cass command not found",
      };
    }

    try {
      const result = await Bun.$`cass health`.quiet().nothrow();
      return {
        available: result.exitCode === 0,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: String(e),
      };
    }
  },

  // Hivemind: Unified memory system (ADR-011)
  // Checks both semantic-memory and cass availability
  hivemind: async () => {
    // Check native hivemind command first
    const hivemindExists = await commandExists("hivemind");
    if (hivemindExists) {
      try {
        const result = await Bun.$`hivemind stats`.quiet().nothrow();
        return {
          available: result.exitCode === 0,
          checkedAt: new Date().toISOString(),
          version: "native",
        };
      } catch (e) {
        return {
          available: false,
          checkedAt: new Date().toISOString(),
          error: String(e),
        };
      }
    }

    // Fall back to checking semantic-memory (hivemind uses same backend)
    const semanticMemoryExists = await commandExists("semantic-memory");
    if (semanticMemoryExists) {
      try {
        const result = await Bun.$`semantic-memory stats`.quiet().nothrow();
        return {
          available: result.exitCode === 0,
          checkedAt: new Date().toISOString(),
          version: "semantic-memory-backend",
        };
      } catch (e) {
        return {
          available: false,
          checkedAt: new Date().toISOString(),
          error: String(e),
        };
      }
    }

    // Try bunx semantic-memory with manual timeout
    try {
      const proc = Bun.spawn(["bunx", "semantic-memory", "stats"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeout = setTimeout(() => proc.kill(), BUNX_TIMEOUT_MS);
      try {
        const exitCode = await proc.exited;
        return {
          available: exitCode === 0,
          checkedAt: new Date().toISOString(),
          version: "bunx-semantic-memory",
        };
      } finally {
        clearTimeout(timeout);
        proc.kill(); // Safe to call even if already dead
      }
    } catch (e) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: String(e),
      };
    }
  },

  hive: async () => {
    const exists = await commandExists("hive");
    if (!exists) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: "hive command not found",
      };
    }

    try {
      // Just check if hive can run - don't require a repo
      const result = await Bun.$`hive --version`.quiet().nothrow();
      return {
        available: result.exitCode === 0,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: String(e),
      };
    }
  },

  // DEPRECATED: Use hive instead
  // bd CLI is deprecated - always return false, use HiveAdapter instead
  beads: async () => {
    return {
      available: false,
      checkedAt: new Date().toISOString(),
      error: "bd CLI is deprecated - use hive_* tools with HiveAdapter instead",
    };
  },

  "swarm-mail": async () => {
    try {
      // Note: checkSwarmHealth() accepts optional projectPath parameter.
      // For tool availability checking, we call it without args to check global health.
      // This is intentional - we're verifying the embedded Swarm Mail system is functional,
      // not checking health for a specific project.
      const healthResult = await checkSwarmHealth();
      return {
        available: healthResult.healthy,
        checkedAt: new Date().toISOString(),
        error: healthResult.healthy
          ? undefined
          : "Swarm Mail database not healthy",
        version: "embedded",
      };
    } catch (e) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        error: String(e),
      };
    }
  },

  // DEPRECATED: Use swarm-mail instead
  // Kept for backward compatibility only
  "agent-mail": async () => {
    const reachable = await urlReachable(
      "http://127.0.0.1:8765/health/liveness",
    );
    return {
      available: reachable,
      checkedAt: new Date().toISOString(),
      error: reachable ? undefined : "Agent Mail server not reachable at :8765",
    };
  },
};

/**
 * Human-readable descriptions of graceful degradation behavior when tools are unavailable.
 * Shown to users in warnings and tool status output.
 */
const fallbackBehaviors: Record<ToolName, string> = {
  "semantic-memory":
    "Learning data stored in-memory only (lost on session end)",
  cass: "Decomposition proceeds without historical context from past sessions",
  hivemind:
    "Unified memory unavailable - learnings stored in-memory only, no session history search",
  hive: "Swarm cannot track issues - task coordination will be less reliable",
  beads:
    "DEPRECATED: Use hive instead. Swarm cannot track issues - task coordination will be less reliable",
  "swarm-mail":
    "Multi-agent coordination disabled - file conflicts possible if multiple agents active",
  "agent-mail":
    "DEPRECATED: Use swarm-mail instead. Legacy MCP server mode - file conflicts possible if multiple agents active",
};

/**
 * Check if a tool is available (cached)
 *
 * @param tool - Tool name to check
 * @returns Tool status
 */
export async function checkTool(tool: ToolName): Promise<ToolStatus> {
  const cached = toolCache.get(tool);
  if (cached) {
    return cached;
  }

  const checker = toolCheckers[tool];
  const status = await checker();
  toolCache.set(tool, status);

  return status;
}

/**
 * Check if a tool is available (simple boolean, cached)
 */
export async function isToolAvailable(tool: ToolName): Promise<boolean> {
  const status = await checkTool(tool);
  return status.available;
}

/**
 * Get full availability info including fallback behavior
 */
export async function getToolAvailability(
  tool: ToolName,
): Promise<ToolAvailability> {
  const status = await checkTool(tool);
  return {
    tool,
    status,
    fallbackBehavior: fallbackBehaviors[tool],
  };
}

/**
 * Check all tools and return availability map
 */
export async function checkAllTools(): Promise<
  Map<ToolName, ToolAvailability>
> {
  const tools: ToolName[] = [
    "semantic-memory",
    "cass",
    "hivemind",
    "hive",
    "beads",
    "swarm-mail",
    "agent-mail",
  ];

  const results = new Map<ToolName, ToolAvailability>();

  // Check all in parallel
  const checks = await Promise.all(
    tools.map(async (tool) => ({
      tool,
      availability: await getToolAvailability(tool),
    })),
  );

  for (const { tool, availability } of checks) {
    results.set(tool, availability);
  }

  return results;
}

/**
 * Log a warning when a tool is missing.
 * Uses Set to deduplicate - logs once per tool per session to prevent spam
 * when tool availability is checked repeatedly.
 */
export function warnMissingTool(tool: ToolName): void {
  if (warningsLogged.has(tool)) {
    return;
  }

  warningsLogged.add(tool);
  const fallback = fallbackBehaviors[tool];
  console.warn(`[swarm] ${tool} not available: ${fallback}`);
}

/**
 * Require a tool - throws if not available
 *
 * Use this for tools that are mandatory for a feature.
 */
export async function requireTool(tool: ToolName): Promise<void> {
  const status = await checkTool(tool);
  if (!status.available) {
    throw new Error(
      `Required tool '${tool}' is not available: ${status.error || "unknown error"}`,
    );
  }
}

/**
 * Execute with fallback - runs the action if tool available, otherwise runs fallback
 *
 * @param tool - Tool to check
 * @param action - Action to run if tool available
 * @param fallback - Fallback to run if tool not available
 * @returns Result from action or fallback
 */
export async function withToolFallback<T>(
  tool: ToolName,
  action: () => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  const available = await isToolAvailable(tool);

  if (available) {
    return action();
  }

  warnMissingTool(tool);
  return fallback();
}

/**
 * Execute if tool available, otherwise return undefined
 */
export async function ifToolAvailable<T>(
  tool: ToolName,
  action: () => Promise<T>,
): Promise<T | undefined> {
  const available = await isToolAvailable(tool);

  if (available) {
    return action();
  }

  warnMissingTool(tool);
  return undefined;
}

/**
 * Reset the tool availability cache.
 * Use in tests to ensure fresh checks, or when tool availability may have
 * changed mid-session (e.g., after installing a tool via `bunx`).
 *
 * @example
 * // In tests
 * beforeEach(() => resetToolCache());
 *
 * @example
 * // After installing a tool
 * await installTool('semantic-memory');
 * resetToolCache();
 * const available = await isToolAvailable('semantic-memory');
 */
export function resetToolCache(): void {
  toolCache.clear();
  warningsLogged.clear();
}

/**
 * Format tool availability for display
 */
export function formatToolAvailability(
  availability: Map<ToolName, ToolAvailability>,
): string {
  const lines: string[] = ["Tool Availability:"];

  for (const [tool, info] of availability) {
    const status = info.status.available ? "✓" : "✗";
    const version = info.status.version ? ` (${info.status.version})` : "";
    const fallback = info.status.available ? "" : ` → ${info.fallbackBehavior}`;
    lines.push(`  ${status} ${tool}${version}${fallback}`);
  }

  return lines.join("\n");
}
