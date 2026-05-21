#!/usr/bin/env bun
/**
 * MCP server for Clawdbot that shells out to swarm CLI.
 *
 * This is a fallback for MCP-based tool registration.
 * The main plugin uses clawdbot's native plugin API instead.
 *
 * Tool schemas are imported from the canonical SWARM_TOOLS definitions
 * in ../index.ts (not scraped from CLI, which never supported --json).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFileSync } from "child_process";
import { z } from "zod";
import { randomBytes } from "crypto";
import { SWARM_TOOLS } from "../index.js";

// Generate a persistent session ID for this MCP server instance
// This ensures all tool calls within the same MCP connection share state
const MCP_SESSION_ID = `mcp-${randomBytes(8).toString("hex")}`;

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

function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const props = schema.properties as Record<string, { type?: string; enum?: string[] }> | undefined;
  const required = (schema.required as string[]) || [];

  if (!props || Object.keys(props).length === 0) {
    return {};
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
  return shape;
}

function executeTool(name: string, args: Record<string, unknown>): string {
  try {
    const argsJson = JSON.stringify(args);
    return execFileSync("swarm", ["tool", name, "--json", argsJson], {
      encoding: "utf-8",
      timeout: 300000,
      env: {
        ...process.env,
        // Pass persistent session ID so swarmmail state persists across tool calls
        OPENCODE_SESSION_ID: MCP_SESSION_ID,
      },
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

  // Use canonical tool definitions from SWARM_TOOLS, filtered by ALLOWED_TOOLS
  const tools = SWARM_TOOLS.filter(t => ALLOWED_TOOLS.has(t.name));
  console.error(`[swarm-mcp] Registering ${tools.length} tools (from ${SWARM_TOOLS.length} available)`);

  for (const tool of tools) {
    const zodSchema = jsonSchemaToZodShape(tool.parameters as Record<string, unknown>);
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: zodSchema as any },
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
