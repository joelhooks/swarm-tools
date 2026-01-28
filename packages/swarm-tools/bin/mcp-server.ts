#!/usr/bin/env bun
/**
 * MCP server for Clawdbot that shells out to swarm CLI.
 *
 * This is a fallback for MCP-based tool registration.
 * The main plugin uses clawdbot's native plugin API instead.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execSync, execFileSync } from "child_process";
import { z } from "zod";

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const ALLOWED_TOOLS = new Set([
  // Hive
  "hive_cells", "hive_create", "hive_create_epic", "hive_close",
  "hive_query", "hive_ready", "hive_update",
  // Hivemind
  "hivemind_find", "hivemind_store", "hivemind_get", "hivemind_stats",
  // Swarmmail
  "swarmmail_inbox", "swarmmail_send", "swarmmail_reserve",
  "swarmmail_release", "swarmmail_init",
  // Swarm
  "swarm_decompose", "swarm_status", "swarm_plan_prompt",
  "swarm_validate_decomposition", "swarm_spawn_subtask",
  "swarm_review", "swarm_review_feedback", "swarm_progress", "swarm_complete",
]);

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const props = schema.properties as Record<string, { type?: string; enum?: string[] }> | undefined;
  const required = (schema.required as string[]) || [];

  if (!props || Object.keys(props).length === 0) {
    return z.record(z.string(), z.unknown());
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(props)) {
    let fieldSchema: z.ZodTypeAny;
    switch (prop.type) {
      case "string":
        fieldSchema = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string();
        break;
      case "number":
        fieldSchema = z.number();
        break;
      case "boolean":
        fieldSchema = z.boolean();
        break;
      default:
        fieldSchema = z.unknown();
    }
    shape[key] = required.includes(key) ? fieldSchema : fieldSchema.optional();
  }
  return z.object(shape).passthrough();
}

function getToolDefinitions(): ToolInfo[] {
  try {
    const output = execSync("swarm tool --list --json 2>/dev/null", {
      encoding: "utf-8",
      timeout: 10000,
    });
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function executeTool(name: string, args: Record<string, unknown>): string {
  try {
    const argsJson = JSON.stringify(args);
    return execFileSync("swarm", ["tool", name, "--json", argsJson], {
      encoding: "utf-8",
      timeout: 300000,
    });
  } catch (error) {
    const err = error as { stdout?: string; message?: string };
    if (err.stdout) return err.stdout;
    return JSON.stringify({ success: false, error: err.message });
  }
}

async function main(): Promise<void> {
  try {
    execFileSync("swarm", ["--version"], { encoding: "utf-8", timeout: 5000 });
  } catch {
    console.error("[swarm-mcp] swarm CLI not found. Install: npm install -g @opencode/swarm");
    process.exit(1);
  }

  const server = new McpServer({ name: "swarm-tools", version: "0.59.5" });

  const allTools = getToolDefinitions();
  const tools = allTools.filter(t => ALLOWED_TOOLS.has(t.name));
  console.error(`[swarm-mcp] Registering ${tools.length} tools`);

  for (const tool of tools) {
    const zodSchema = jsonSchemaToZod(tool.inputSchema);
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: zodSchema },
      async (args: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: executeTool(tool.name, args ?? {}) }],
      })
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[swarm-mcp] Server started");
}

main().catch((error) => {
  console.error("[swarm-mcp] Server failed", error);
  process.exit(1);
});
