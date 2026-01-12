#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
};

type ToolDefinition = {
  description?: string;
  args?: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown> | unknown;
};

/**
 * Get the plugin root directory at runtime.
 *
 * Claude Code sets cwd to ${CLAUDE_PLUGIN_ROOT} when launching MCP servers,
 * so process.cwd() gives us the plugin root. The bin/ folder is one level down,
 * so the dist/ folder is a sibling of bin/.
 *
 * For dev/test usage, we fall back to stack trace parsing or env var.
 */
function getPluginRoot(): string {
  // Prefer explicit env var if set (useful for testing)
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return process.env.CLAUDE_PLUGIN_ROOT;
  }

  // Claude Code sets cwd to plugin root when launching MCP servers
  // Check if dist/index.js exists at cwd - if so, we're running from plugin root
  const cwdDistPath = resolve(process.cwd(), "dist/index.js");
  if (existsSync(cwdDistPath)) {
    return process.cwd();
  }

  // Fallback: try to find the plugin root relative to the script location
  // Use Error.stack to get actual runtime path (bundler can't inline this)
  const err = new Error();
  const stack = err.stack || "";
  const match = stack.match(/at\s+(?:Object\.<anonymous>|Module\._compile)\s+\(([^:]+)/);
  if (match) {
    // Script is in bin/, plugin root is parent
    const scriptDir = dirname(match[1]);
    const pluginRoot = resolve(scriptDir, "..");
    if (existsSync(resolve(pluginRoot, "dist/index.js"))) {
      return pluginRoot;
    }
  }

  // Last resort: try require.main.filename
  if (typeof require !== "undefined" && require.main?.filename) {
    const pluginRoot = resolve(dirname(require.main.filename), "..");
    if (existsSync(resolve(pluginRoot, "dist/index.js"))) {
      return pluginRoot;
    }
  }

  throw new Error(
    "[swarm-mcp] Cannot determine plugin root. Set CLAUDE_PLUGIN_ROOT env var or run from plugin directory."
  );
}

/**
 * Resolve the tool registry entrypoint for the MCP server.
 */
export function resolveToolRegistryPath({
  pluginRoot,
}: {
  pluginRoot?: string;
} = {}): string {
  const root = pluginRoot ?? getPluginRoot();
  const pluginDistPath = resolve(root, "dist/index.js");

  if (existsSync(pluginDistPath)) {
    return pluginDistPath;
  }

  // Dev fallback: try src/index.ts relative to package root
  const sourcePath = resolve(root, "../src/index.ts");
  if (existsSync(sourcePath)) {
    return sourcePath;
  }

  throw new Error(
    `[swarm-mcp] Missing Claude plugin runtime bundle. Expected ${pluginDistPath}. ` +
      "Rebuild the package so claude-plugin/dist is populated.",
  );
}

/**
 * Load the swarm tool registry for MCP execution.
 */
export async function loadToolRegistry(): Promise<Record<string, ToolDefinition>> {
  const registryPath = resolveToolRegistryPath();
  const moduleUrl = pathToFileURL(registryPath).href;
  const toolsModule = await import(moduleUrl);
  const tools = toolsModule.allTools ?? toolsModule.default?.allTools;

  if (!tools) {
    throw new Error(`[swarm-mcp] Tool registry missing at ${registryPath}`);
  }

  return tools as Record<string, ToolDefinition>;
}

/**
 * Build a tool execution context for MCP tool calls.
 */
function createToolContext(): ToolContext {
  const sessionId =
    process.env.CLAUDE_SESSION_ID ||
    process.env.OPENCODE_SESSION_ID ||
    `mcp-${Date.now()}`;
  const messageId =
    process.env.CLAUDE_MESSAGE_ID ||
    process.env.OPENCODE_MESSAGE_ID ||
    `msg-${Date.now()}`;
  const agent =
    process.env.CLAUDE_AGENT_NAME || process.env.OPENCODE_AGENT || "claude";

  return {
    sessionID: sessionId,
    messageID: messageId,
    agent,
    abort: new AbortController().signal,
  };
}

/**
 * Normalize tool execution results into text output.
 */
function formatToolOutput(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * Register all swarm tools with the MCP server.
 */
async function registerTools(server: McpServer): Promise<void> {
  const tools = await loadToolRegistry();

  for (const [toolName, toolDef] of Object.entries(tools)) {
    server.registerTool(
      toolName,
      {
        description: toolDef.description ?? `Swarm tool: ${toolName}`,
        inputSchema: toolDef.args ?? {},
      },
      async (args) => {
        const result = await toolDef.execute(
          (args ?? {}) as Record<string, unknown>,
          createToolContext(),
        );

        return {
          content: [{ type: "text", text: formatToolOutput(result) }],
        };
      },
    );
  }
}

/**
 * Start the MCP server over stdio for Claude Code auto-launch.
 */
async function main(): Promise<void> {
  const server = new McpServer({
    name: "swarm-tools",
    version: process.env.SWARM_VERSION || "dev",
  });

  await registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[swarm-mcp] Server started");
}

// Support both ESM (import.meta.main) and CJS (require.main === module)
const isMain = typeof require !== "undefined"
  ? require.main === module
  : import.meta.main;

if (isMain) {
  main().catch((error) => {
    console.error("[swarm-mcp] Server failed", error);
    process.exit(1);
  });
}
