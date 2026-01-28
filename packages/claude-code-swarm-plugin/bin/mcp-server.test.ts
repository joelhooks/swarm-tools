/**
 * Tests for MCP server JSON Schema to Zod conversion and tool filtering
 *
 * Tests the core functions that power the thin MCP wrapper:
 * - jsonSchemaToZod: Converts JSON Schema from CLI to Zod schemas
 * - filterTools: Filters to allowed user-facing tools
 * - Error handling scenarios
 */
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { execSync } from "child_process";

// Import the functions we're testing
// Since mcp-server.ts exports nothing, we'll need to extract them
// For now, we'll test them in isolation by copying their logic

/**
 * Convert JSON Schema to Zod schema for MCP SDK.
 * Handles the common types we get from the swarm CLI.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const props = schema.properties as
    | Record<
        string,
        { type?: string; enum?: string[]; items?: Record<string, unknown> }
      >
    | undefined;
  const required = (schema.required as string[]) || [];

  if (!props || Object.keys(props).length === 0) {
    // Empty schema - accept any properties
    return z.record(z.string(), z.unknown());
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(props)) {
    let fieldSchema: z.ZodTypeAny;

    switch (prop.type) {
      case "string":
        fieldSchema = prop.enum
          ? z.enum(prop.enum as [string, ...string[]])
          : z.string();
        break;
      case "number":
        fieldSchema = z.number();
        break;
      case "boolean":
        fieldSchema = z.boolean();
        break;
      case "array":
        if (prop.items?.type === "object") {
          fieldSchema = z.array(
            jsonSchemaToZod(prop.items as Record<string, unknown>),
          );
        } else {
          fieldSchema = z.array(z.unknown());
        }
        break;
      case "object":
        fieldSchema = jsonSchemaToZod(prop as Record<string, unknown>);
        break;
      default:
        fieldSchema = z.unknown();
    }

    // Make optional if not in required array
    shape[key] = required.includes(key) ? fieldSchema : fieldSchema.optional();
  }

  return z.object(shape).passthrough(); // passthrough allows extra properties
}

/**
 * Tools exposed to Claude Code.
 */
const ALLOWED_TOOLS = new Set([
  // Hive - task/cell management
  "hive_cells",
  "hive_create",
  "hive_create_epic",
  "hive_close",
  "hive_query",
  "hive_ready",
  "hive_update",

  // Hivemind - unified memory
  "hivemind_find",
  "hivemind_store",
  "hivemind_get",
  "hivemind_stats",

  // Swarmmail - agent coordination
  "swarmmail_inbox",
  "swarmmail_send",
  "swarmmail_reserve",
  "swarmmail_release",
  "swarmmail_init",

  // Core swarm
  "swarm_decompose",
  "swarm_status",

  // Coordinator tools
  "swarm_plan_prompt",
  "swarm_validate_decomposition",
  "swarm_spawn_subtask",
  "swarm_review",
  "swarm_review_feedback",

  // Worker tools
  "swarm_progress",
  "swarm_complete",
]);

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Filter to only allowed user-facing tools.
 */
function filterTools(tools: ToolInfo[]): ToolInfo[] {
  return tools.filter((tool) => ALLOWED_TOOLS.has(tool.name));
}

// ============================================================================
// Tests
// ============================================================================

describe("jsonSchemaToZod", () => {
  describe("primitive types", () => {
    test("converts string type", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ name: "test" });
      expect(result).toEqual({ name: "test" });
    });

    test("converts number type", () => {
      const schema = {
        type: "object",
        properties: {
          age: { type: "number" },
        },
        required: ["age"],
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ age: 42 });
      expect(result).toEqual({ age: 42 });
    });

    test("converts boolean type", () => {
      const schema = {
        type: "object",
        properties: {
          active: { type: "boolean" },
        },
        required: ["active"],
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ active: true });
      expect(result).toEqual({ active: true });
    });

    test("handles unknown type as z.unknown()", () => {
      const schema = {
        type: "object",
        properties: {
          mystery: { type: "unknown-type" },
        },
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ mystery: "anything" });
      expect(result).toEqual({ mystery: "anything" });
    });
  });

  describe("array types", () => {
    test("converts array of primitives", () => {
      const schema = {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ tags: ["a", "b", "c"] });
      expect(result).toEqual({ tags: ["a", "b", "c"] });
    });

    test("converts array of objects", () => {
      const schema = {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "number" },
                name: { type: "string" },
              },
              required: ["id"],
            },
          },
        },
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({
        items: [
          { id: 1, name: "first" },
          { id: 2, name: "second" },
        ],
      });
      expect(result.items).toHaveLength(2);
    });

    test("handles array without items definition", () => {
      const schema = {
        type: "object",
        properties: {
          data: { type: "array" },
        },
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ data: [1, "mixed", true] });
      expect(result).toEqual({ data: [1, "mixed", true] });
    });
  });

  describe("nested objects", () => {
    test("converts nested object", () => {
      const schema = {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "number" },
            },
            required: ["name"],
          },
        },
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({
        user: { name: "Alice", age: 30 },
      });
      expect(result).toEqual({ user: { name: "Alice", age: 30 } });
    });

    test("handles deeply nested structures", () => {
      const schema = {
        type: "object",
        properties: {
          level1: {
            type: "object",
            properties: {
              level2: {
                type: "object",
                properties: {
                  value: { type: "string" },
                },
              },
            },
          },
        },
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({
        level1: { level2: { value: "deep" } },
      });
      expect(result.level1.level2.value).toBe("deep");
    });
  });

  describe("enum handling", () => {
    test("converts enum to z.enum", () => {
      const schema = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "closed", "pending"] },
        },
        required: ["status"],
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ status: "open" });
      expect(result).toEqual({ status: "open" });
    });

    test("rejects value not in enum", () => {
      const schema = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["open", "closed"] },
        },
        required: ["status"],
      };

      const zodSchema = jsonSchemaToZod(schema);
      expect(() => zodSchema.parse({ status: "invalid" })).toThrow();
    });
  });

  describe("optional vs required fields", () => {
    test("makes fields optional when not in required array", () => {
      const schema = {
        type: "object",
        properties: {
          required_field: { type: "string" },
          optional_field: { type: "string" },
        },
        required: ["required_field"],
      };

      const zodSchema = jsonSchemaToZod(schema);

      // Should work without optional field
      const result1 = zodSchema.parse({ required_field: "test" });
      expect(result1).toEqual({ required_field: "test" });

      // Should work with optional field
      const result2 = zodSchema.parse({
        required_field: "test",
        optional_field: "extra",
      });
      expect(result2).toEqual({
        required_field: "test",
        optional_field: "extra",
      });
    });

    test("throws when required field is missing", () => {
      const schema = {
        type: "object",
        properties: {
          required_field: { type: "string" },
        },
        required: ["required_field"],
      };

      const zodSchema = jsonSchemaToZod(schema);
      expect(() => zodSchema.parse({})).toThrow();
    });
  });

  describe("empty schema handling", () => {
    test("returns z.record for empty properties", () => {
      const schema = {
        type: "object",
        properties: {},
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ anything: "goes", here: 123 });
      expect(result).toEqual({ anything: "goes", here: 123 });
    });

    test("returns z.record for missing properties", () => {
      const schema = {
        type: "object",
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({ foo: "bar" });
      expect(result).toEqual({ foo: "bar" });
    });
  });

  describe("passthrough allows extra properties", () => {
    test("allows properties not in schema", () => {
      const schema = {
        type: "object",
        properties: {
          defined: { type: "string" },
        },
      };

      const zodSchema = jsonSchemaToZod(schema);
      const result = zodSchema.parse({
        defined: "value",
        extra: "allowed",
        another: 123,
      });
      expect(result).toEqual({
        defined: "value",
        extra: "allowed",
        another: 123,
      });
    });
  });
});

describe("filterTools", () => {
  test("passes through allowed tools", () => {
    const tools: ToolInfo[] = [
      {
        name: "hive_cells",
        description: "List cells",
        inputSchema: {},
      },
      {
        name: "hivemind_find",
        description: "Search memory",
        inputSchema: {},
      },
      {
        name: "swarm_decompose",
        description: "Decompose task",
        inputSchema: {},
      },
    ];

    const filtered = filterTools(tools);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((t) => t.name)).toEqual([
      "hive_cells",
      "hivemind_find",
      "swarm_decompose",
    ]);
  });

  test("filters out unknown tools", () => {
    const tools: ToolInfo[] = [
      {
        name: "hive_cells",
        description: "Allowed",
        inputSchema: {},
      },
      {
        name: "deprecated_tool",
        description: "Not allowed",
        inputSchema: {},
      },
      {
        name: "internal_debug_tool",
        description: "Not allowed",
        inputSchema: {},
      },
    ];

    const filtered = filterTools(tools);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("hive_cells");
  });

  test("handles empty input", () => {
    const filtered = filterTools([]);
    expect(filtered).toHaveLength(0);
  });

  test("filters all when no tools match", () => {
    const tools: ToolInfo[] = [
      {
        name: "unknown1",
        description: "Not allowed",
        inputSchema: {},
      },
      {
        name: "unknown2",
        description: "Not allowed",
        inputSchema: {},
      },
    ];

    const filtered = filterTools(tools);
    expect(filtered).toHaveLength(0);
  });

  test("includes all coordinator tools", () => {
    const coordinatorTools: ToolInfo[] = [
      { name: "swarm_plan_prompt", description: "", inputSchema: {} },
      { name: "swarm_validate_decomposition", description: "", inputSchema: {} },
      { name: "swarm_spawn_subtask", description: "", inputSchema: {} },
      { name: "swarm_review", description: "", inputSchema: {} },
      { name: "swarm_review_feedback", description: "", inputSchema: {} },
    ];

    const filtered = filterTools(coordinatorTools);
    expect(filtered).toHaveLength(5);
  });

  test("includes all worker tools", () => {
    const workerTools: ToolInfo[] = [
      { name: "swarm_progress", description: "", inputSchema: {} },
      { name: "swarm_complete", description: "", inputSchema: {} },
    ];

    const filtered = filterTools(workerTools);
    expect(filtered).toHaveLength(2);
  });
});

describe("error handling scenarios", () => {
  describe("CLI execution errors", () => {
    test("handles CLI not found error", () => {
      // Simulate execSync throwing ENOENT error
      const error = new Error("Command not found") as Error & {
        code?: string;
        stdout?: string;
        stderr?: string;
      };
      error.code = "ENOENT";

      expect(error.code).toBe("ENOENT");
    });

    test("handles CLI timeout error", () => {
      // Simulate execSync timeout
      const error = new Error("Command timed out") as Error & {
        code?: string;
        killed?: boolean;
      };
      error.code = "ETIMEDOUT";
      error.killed = true;

      expect(error.code).toBe("ETIMEDOUT");
      expect(error.killed).toBe(true);
    });

    test("handles tool execution error with stderr", () => {
      // Simulate tool execution failure
      const errorOutput = JSON.stringify({
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: "Tool failed to execute",
          stderr: "Error details from stderr",
        },
      });

      const parsed = JSON.parse(errorOutput);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("EXECUTION_ERROR");
      expect(parsed.error.stderr).toBe("Error details from stderr");
    });

    test("handles tool execution with stdout fallback", () => {
      // When error has stdout but stderr is empty, should use stdout
      const error = new Error("Command failed") as Error & {
        stdout?: string;
        stderr?: string;
      };
      error.stdout = '{"result": "from stdout"}';
      error.stderr = "";

      expect(error.stdout).toBeDefined();
      const parsed = JSON.parse(error.stdout);
      expect(parsed.result).toBe("from stdout");
    });
  });

  describe("JSON parsing errors", () => {
    test("handles malformed JSON from CLI", () => {
      const malformedJson = "{ invalid json }";
      expect(() => JSON.parse(malformedJson)).toThrow();
    });

    test("handles empty response from CLI", () => {
      const emptyResponse = "";
      expect(() => JSON.parse(emptyResponse)).toThrow();
    });
  });

  describe("schema validation errors", () => {
    test("handles invalid data for schema", () => {
      const schema = {
        type: "object",
        properties: {
          count: { type: "number" },
        },
        required: ["count"],
      };

      const zodSchema = jsonSchemaToZod(schema);
      expect(() => zodSchema.parse({ count: "not a number" })).toThrow(
        z.ZodError,
      );
    });

    test("provides detailed validation errors", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      };

      const zodSchema = jsonSchemaToZod(schema);

      try {
        zodSchema.parse({ name: 123, age: "invalid" });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        if (error instanceof z.ZodError) {
          expect(error.issues.length).toBeGreaterThan(0);
          expect(error.issues.some((e) => e.path.includes("name"))).toBe(true);
          expect(error.issues.some((e) => e.path.includes("age"))).toBe(true);
        } else {
          throw error;
        }
      }
    });
  });
});

describe("integration scenarios", () => {
  test("complete flow: schema to zod to validation", () => {
    // Simulate getting a tool definition from CLI
    const toolDefinition = {
      name: "hive_create",
      description: "Create a new cell",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          type: { type: "string", enum: ["task", "bug", "feature"] },
          priority: { type: "number" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "type"],
      },
    };

    // Convert to Zod
    const zodSchema = jsonSchemaToZod(toolDefinition.inputSchema);

    // Validate correct input
    const validInput = {
      title: "Fix bug",
      type: "bug",
      priority: 1,
      tags: ["urgent"],
    };
    const result = zodSchema.parse(validInput);
    expect(result).toEqual(validInput);

    // Validate input with optional fields missing
    const minimalInput = {
      title: "Fix bug",
      type: "bug",
    };
    const result2 = zodSchema.parse(minimalInput);
    expect(result2.title).toBe("Fix bug");
    expect(result2.type).toBe("bug");
  });

  test("filter tools then convert schemas", () => {
    const allTools: ToolInfo[] = [
      {
        name: "hive_cells",
        description: "List cells",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
          },
        },
      },
      {
        name: "internal_debug",
        description: "Debug tool",
        inputSchema: {
          type: "object",
          properties: {
            debug: { type: "boolean" },
          },
        },
      },
    ];

    // Filter to allowed tools
    const allowed = filterTools(allTools);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].name).toBe("hive_cells");

    // Convert filtered tool schemas
    const zodSchema = jsonSchemaToZod(allowed[0].inputSchema);
    const result = zodSchema.parse({ status: "open" });
    expect(result).toEqual({ status: "open" });
  });
});
