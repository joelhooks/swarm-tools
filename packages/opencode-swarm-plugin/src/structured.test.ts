/**
 * Comprehensive tests for structured.ts module
 *
 * Tests all JSON extraction strategies, validation tools, and edge cases.
 */
import type { ToolContext } from "@opencode-ai/plugin";
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  CellTreeSchema,
  EvaluationSchema,
  TaskDecompositionSchema,
} from "./schemas";
import {
  JsonExtractionError,
  StructuredValidationError,
  extractJsonFromText,
  formatZodErrors,
  getSchemaByName,
  structured_extract_json,
  structured_parse_cell_tree,
  structured_parse_decomposition,
  structured_parse_evaluation,
  structured_validate,
} from "./structured";

// ============================================================================
// 1. extractJsonFromText - All Strategies
// ============================================================================

describe("extractJsonFromText", () => {
  describe("Strategy 1: Direct parse", () => {
    it("extracts clean JSON directly", () => {
      const [result] = extractJsonFromText('{"key": "value"}');
      expect(result).toEqual({ key: "value" });
    });

    it("handles nested objects", () => {
      const input = '{"outer": {"inner": "value"}}';
      const [result] = extractJsonFromText(input);
      expect(result).toEqual({ outer: { inner: "value" } });
    });

    it("handles arrays", () => {
      const [result] = extractJsonFromText("[1, 2, 3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("handles complex nested structures", () => {
      const input = JSON.stringify({
        epic: { title: "Test", description: "Desc" },
        subtasks: [
          { title: "Task 1", files: ["a.ts", "b.ts"] },
          { title: "Task 2", files: ["c.ts"] },
        ],
      });
      const [result] = extractJsonFromText(input);
      expect(result).toEqual({
        epic: { title: "Test", description: "Desc" },
        subtasks: [
          { title: "Task 1", files: ["a.ts", "b.ts"] },
          { title: "Task 2", files: ["c.ts"] },
        ],
      });
    });
  });

  describe("Strategy 2: JSON code block", () => {
    it("extracts JSON from ```json code block", () => {
      const input = '```json\n{"key": "value"}\n```';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ key: "value" });
      expect(method).toBe("json_code_block");
    });

    it("handles code block with surrounding text", () => {
      const input =
        'Here is the result:\n```json\n{"key": "value"}\n```\nEnd of response';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ key: "value" });
      expect(method).toBe("json_code_block");
    });

    it("handles multiline JSON in code block", () => {
      const input = '```json\n{\n  "key": "value",\n  "key2": "value2"\n}\n```';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ key: "value", key2: "value2" });
      expect(method).toBe("json_code_block");
    });
  });

  describe("Strategy 3: Generic code block", () => {
    it("extracts JSON from unlabeled code block", () => {
      const input = '```\n{"key": "value"}\n```';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ key: "value" });
      expect(method).toBe("any_code_block");
    });

    it("prefers json-labeled block over generic block", () => {
      const input =
        '```\n{"wrong": true}\n```\n```json\n{"correct": true}\n```';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ correct: true });
      expect(method).toBe("json_code_block");
    });
  });

  describe("Strategy 4: Brace matching for objects", () => {
    it("extracts JSON with surrounding text", () => {
      const input = 'Here is the result: {"key": "value"} and more text';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ key: "value" });
      expect(method).toBe("brace_match_object");
    });

    it("extracts first balanced object when multiple present", () => {
      const input = 'First: {"a": 1} Second: {"b": 2}';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ a: 1 });
      expect(method).toBe("brace_match_object");
    });

    it("handles deeply nested objects", () => {
      // Valid JSON will use direct_parse strategy
      const deep = '{"a":{"b":{"c":{"d":"value"}}}}';
      const [result, method] = extractJsonFromText(deep);
      expect(result).toEqual({ a: { b: { c: { d: "value" } } } });
      expect(method).toBe("direct_parse");
    });

    it("handles strings containing braces", () => {
      const input = 'text {"key": "value with { and } chars"} more text';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ key: "value with { and } chars" });
      expect(method).toBe("brace_match_object");
    });

    it("handles escaped quotes in strings", () => {
      // Valid JSON will use direct_parse strategy
      const input = '{"key": "value with \\"quotes\\""}';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ key: 'value with "quotes"' });
      expect(method).toBe("direct_parse");
    });
  });

  describe("Strategy 5: Bracket matching for arrays", () => {
    it("extracts arrays with surrounding text", () => {
      const input = "Here is an array: [1, 2, 3] end";
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual([1, 2, 3]);
      expect(method).toBe("brace_match_array");
    });

    it("handles nested arrays", () => {
      // Valid JSON will use direct_parse strategy
      const input = "[[1, 2], [3, 4]]";
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(method).toBe("direct_parse");
    });

    it("prefers object matching over array when both present", () => {
      const input = '{"obj": true} [1, 2, 3]';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ obj: true });
      expect(method).toBe("brace_match_object");
    });
  });

  describe("Strategy 6: JSON repair", () => {
    it("fixes single quotes in keys (limited support)", () => {
      // The repair strategy has limited support for single quotes
      // It primarily handles trailing commas and simple quote replacements
      // This test documents a known limitation: complex single-quote cases may not parse
      const input = "text {'key': 'value'} more";
      expect(() => extractJsonFromText(input)).toThrow(JsonExtractionError);
    });

    it("fixes trailing commas in objects", () => {
      const input = '{"key": "value",}';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ key: "value" });
      expect(method).toBe("repair_json");
    });

    it("fixes trailing commas in arrays", () => {
      const input = "[1, 2, 3,]";
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual([1, 2, 3]);
      expect(method).toBe("repair_json");
    });

    it("fixes multiple trailing commas", () => {
      const input = '{"a": 1, "b": [1, 2,], "c": 3,}';
      const [result, method] = extractJsonFromText(input);
      expect(result).toEqual({ a: 1, b: [1, 2], c: 3 });
      expect(method).toBe("repair_json");
    });
  });

  describe("Error cases", () => {
    it("throws JsonExtractionError for invalid JSON", () => {
      expect(() => extractJsonFromText("not json at all")).toThrow(
        JsonExtractionError,
      );
    });

    it("throws JsonExtractionError for empty input", () => {
      expect(() => extractJsonFromText("")).toThrow(JsonExtractionError);
      expect(() => extractJsonFromText("   ")).toThrow(JsonExtractionError);
    });

    it("throws JsonExtractionError for unbalanced braces", () => {
      expect(() => extractJsonFromText('{"key": "value"')).toThrow(
        JsonExtractionError,
      );
    });

    it("throws JsonExtractionError for malformed JSON", () => {
      expect(() => extractJsonFromText('{"key": undefined}')).toThrow(
        JsonExtractionError,
      );
    });

    it("includes attempted strategies in error", () => {
      try {
        extractJsonFromText("not json");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        if (error instanceof JsonExtractionError) {
          expect(error.attemptedStrategies.length).toBeGreaterThan(0);
          expect(error.attemptedStrategies).toContain("direct_parse");
        } else {
          throw error;
        }
      }
    });

    it("returns null for deeply nested input exceeding MAX_BRACE_DEPTH", () => {
      // Build a deeply nested structure exceeding MAX_BRACE_DEPTH (100)
      let deep = "text ";
      for (let i = 0; i < 101; i++) {
        deep += "{";
      }
      deep += '"key":"value"';
      for (let i = 0; i < 101; i++) {
        deep += "}";
      }

      expect(() => extractJsonFromText(deep)).toThrow(JsonExtractionError);
    });
  });
});

// ============================================================================
// 2. formatZodErrors
// ============================================================================

describe("formatZodErrors", () => {
  it("formats single error with path", () => {
    const schema = z.object({ name: z.string() });
    try {
      schema.parse({ name: 123 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formatted = formatZodErrors(error);
        expect(formatted.length).toBeGreaterThan(0);
        expect(formatted[0]).toContain("name");
      }
    }
  });

  it("formats multiple errors", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    try {
      schema.parse({ name: 123, age: "not a number" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formatted = formatZodErrors(error);
        expect(formatted.length).toBe(2);
      }
    }
  });

  it("formats nested path", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
      }),
    });
    try {
      schema.parse({ user: { name: 123 } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formatted = formatZodErrors(error);
        expect(formatted[0]).toContain("user.name");
      }
    }
  });

  it("formats error without path", () => {
    const schema = z.string();
    try {
      schema.parse(123);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formatted = formatZodErrors(error);
        expect(formatted.length).toBeGreaterThan(0);
        // Zod error messages include description like "Expected string, received number"
        // The format is: "path: message" for nested, or just "message" for top-level
        expect(formatted[0]).toContain("expected string");
      }
    }
  });
});

// ============================================================================
// 3. getSchemaByName
// ============================================================================

describe("getSchemaByName", () => {
  it("returns EvaluationSchema for 'evaluation'", () => {
    const schema = getSchemaByName("evaluation");
    expect(schema).toBe(EvaluationSchema);
  });

  it("returns TaskDecompositionSchema for 'task_decomposition'", () => {
    const schema = getSchemaByName("task_decomposition");
    expect(schema).toBe(TaskDecompositionSchema);
  });

  it("returns CellTreeSchema for 'cell_tree'", () => {
    const schema = getSchemaByName("cell_tree");
    expect(schema).toBe(CellTreeSchema);
  });

  it("throws error for unknown schema name", () => {
    expect(() => getSchemaByName("unknown")).toThrow("Unknown schema");
  });

  it("error message lists available schemas", () => {
    try {
      getSchemaByName("invalid");
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).toContain("evaluation");
        expect(error.message).toContain("task_decomposition");
        expect(error.message).toContain("cell_tree");
      }
    }
  });
});

// ============================================================================
// 4. StructuredValidationError
// ============================================================================

describe("StructuredValidationError", () => {
  it("formats error bullets from ZodError", () => {
    const schema = z.object({ name: z.string() });
    let zodError: z.ZodError | null = null;

    try {
      schema.parse({ name: 123 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        zodError = error;
      }
    }

    if (zodError) {
      const err = new StructuredValidationError(
        "Validation failed",
        zodError,
        '{"name": 123}',
      );
      expect(err.errorBullets.length).toBeGreaterThan(0);
      expect(err.toFeedback()).toContain("- ");
    }
  });

  it("handles null ZodError", () => {
    const err = new StructuredValidationError(
      "Custom error",
      null,
      "raw input",
    );
    expect(err.errorBullets).toEqual(["Custom error"]);
    expect(err.toFeedback()).toBe("- Custom error");
  });

  it("includes extraction method when provided", () => {
    const err = new StructuredValidationError(
      "Error",
      null,
      "input",
      "direct_parse",
    );
    expect(err.extractionMethod).toBe("direct_parse");
  });
});

// ============================================================================
// 5. structured_extract_json tool
// ============================================================================

describe("structured_extract_json", () => {
  const mockCtx = {} as ToolContext;

  it("returns success for valid JSON", async () => {
    const result = await structured_extract_json.execute(
      { text: '{"key": "value"}' },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ key: "value" });
    expect(parsed.extraction_method).toBe("direct_parse");
  });

  it("returns success for JSON in code block", async () => {
    const result = await structured_extract_json.execute(
      { text: '```json\n{"key": "value"}\n```' },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ key: "value" });
    expect(parsed.extraction_method).toBe("json_code_block");
  });

  it("returns error for invalid JSON", async () => {
    const result = await structured_extract_json.execute(
      { text: "not json" },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Could not extract");
    expect(parsed.attempted_strategies).toBeDefined();
  });

  it("includes raw input preview in error", async () => {
    const longText = "x".repeat(300);
    const result = await structured_extract_json.execute(
      { text: longText },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.raw_input_preview.length).toBeLessThanOrEqual(200);
  });
});

// ============================================================================
// 6. structured_validate tool
// ============================================================================

describe("structured_validate", () => {
  const mockCtx = {} as ToolContext;

  describe("evaluation schema", () => {
    it("validates correct evaluation", async () => {
      const validEval = {
        passed: true,
        criteria: {
          test: { passed: true, feedback: "good" },
        },
        overall_feedback: "All good",
        retry_suggestion: null,
      };
      const result = await structured_validate.execute(
        {
          response: JSON.stringify(validEval),
          schema_name: "evaluation",
        },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual(validEval);
    });

    it("returns error for invalid evaluation", async () => {
      const result = await structured_validate.execute(
        {
          response: '{"invalid": true}',
          schema_name: "evaluation",
        },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.errors.length).toBeGreaterThan(0);
    });

    it("handles empty response", async () => {
      const result = await structured_validate.execute(
        {
          response: "",
          schema_name: "evaluation",
        },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.valid).toBe(false);
      expect(parsed.error).toContain("empty");
    });

    it("handles whitespace-only response", async () => {
      const result = await structured_validate.execute(
        {
          response: "   \n  ",
          schema_name: "evaluation",
        },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.valid).toBe(false);
    });
  });

  describe("task_decomposition schema", () => {
    it("validates correct decomposition", async () => {
      const validDecomp = {
        task: "Implement feature",
        subtasks: [
          {
            title: "Task 1",
            description: "Do thing",
            files: ["a.ts"],
            estimated_effort: "small",
          },
        ],
      };
      const result = await structured_validate.execute(
        {
          response: JSON.stringify(validDecomp),
          schema_name: "task_decomposition",
        },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe("cell_tree schema", () => {
    it("validates correct bead tree", async () => {
      const validTree = {
        epic: { title: "Epic", description: "Desc" },
        subtasks: [
          {
            title: "Task 1",
            files: ["a.ts"],
            dependencies: [],
            estimated_complexity: 2,
          },
        ],
      };
      const result = await structured_validate.execute(
        {
          response: JSON.stringify(validTree),
          schema_name: "cell_tree",
        },
        mockCtx,
      );
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });
  });

  it("extracts JSON from markdown before validation", async () => {
    const evalObj = {
      passed: true,
      criteria: { test: { passed: true, feedback: "ok" } },
      overall_feedback: "Good",
      retry_suggestion: null,
    };
    const markdown = `Here is the eval:\n\`\`\`json\n${JSON.stringify(evalObj)}\n\`\`\``;

    const result = await structured_validate.execute(
      {
        response: markdown,
        schema_name: "evaluation",
      },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.extractionMethod).toBe("json_code_block");
  });

  it("includes retry hint when attempts < max_retries", async () => {
    const result = await structured_validate.execute(
      {
        response: '{"invalid": true}',
        schema_name: "evaluation",
        max_retries: 3,
      },
      mockCtx,
    );
    const parsed = JSON.parse(result);
    expect(parsed.errors.some((e: string) => e.includes("try again"))).toBe(
      true,
    );
  });
});

// ============================================================================
// 7. structured_parse_evaluation tool
// ============================================================================

describe("structured_parse_evaluation", () => {
  const mockCtx = {} as ToolContext;

  it("parses valid evaluation", async () => {
    const validEval = {
      passed: true,
      criteria: {
        type_safe: { passed: true, feedback: "All types validated" },
        no_bugs: { passed: true, feedback: "No issues found" },
      },
      overall_feedback: "Excellent work",
      retry_suggestion: null,
    };
    const result = await structured_parse_evaluation.execute(
      { response: JSON.stringify(validEval) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data.passed).toBe(true);
    expect(parsed.summary.passed).toBe(true);
    expect(parsed.summary.criteria_count).toBe(2);
    expect(parsed.summary.failed_criteria).toEqual([]);
  });

  it("identifies failed criteria in summary", async () => {
    const evalWithFailures = {
      passed: false,
      criteria: {
        type_safe: { passed: true, feedback: "OK" },
        no_bugs: { passed: false, feedback: "Found null pointer" },
        patterns: { passed: false, feedback: "Missing error handling" },
      },
      overall_feedback: "Needs fixes",
      retry_suggestion: "Add null checks and error handling",
    };
    const result = await structured_parse_evaluation.execute(
      { response: JSON.stringify(evalWithFailures) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.summary.passed).toBe(false);
    expect(parsed.summary.failed_criteria).toContain("no_bugs");
    expect(parsed.summary.failed_criteria).toContain("patterns");
  });

  it("returns error for malformed JSON", async () => {
    const result = await structured_parse_evaluation.execute(
      { response: "not json" },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("extract JSON");
    expect(parsed.feedback).toBeDefined();
  });

  it("returns error for invalid evaluation schema", async () => {
    const invalidEval = {
      passed: "not a boolean", // Invalid type
      criteria: {},
      overall_feedback: "test",
      retry_suggestion: null,
    };
    const result = await structured_parse_evaluation.execute(
      { response: JSON.stringify(invalidEval) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("does not match schema");
    expect(parsed.validation_errors).toBeDefined();
  });

  it("includes expected shape in error feedback", async () => {
    const result = await structured_parse_evaluation.execute(
      { response: '{"wrong": "structure"}' },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.expected_shape).toBeDefined();
    expect(parsed.expected_shape.passed).toBe("boolean");
  });
});

// ============================================================================
// 8. structured_parse_decomposition tool
// ============================================================================

describe("structured_parse_decomposition", () => {
  const mockCtx = {} as ToolContext;

  it("parses valid decomposition", async () => {
    const validDecomp = {
      task: "Implement authentication",
      reasoning: "Split by feature layer",
      subtasks: [
        {
          title: "Auth service",
          description: "Core logic",
          files: ["src/auth.ts"],
          estimated_effort: "medium",
        },
        {
          title: "Auth UI",
          description: "Login form",
          files: ["src/components/Login.tsx"],
          estimated_effort: "small",
        },
      ],
    };
    const result = await structured_parse_decomposition.execute(
      { response: JSON.stringify(validDecomp) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data.task).toBe("Implement authentication");
    expect(parsed.summary.subtask_count).toBe(2);
    expect(parsed.summary.total_files).toBe(2);
    expect(parsed.summary.files).toContain("src/auth.ts");
    expect(parsed.summary.files).toContain("src/components/Login.tsx");
  });

  it("includes effort breakdown in summary", async () => {
    const decomp = {
      task: "Test",
      subtasks: [
        {
          title: "T1",
          description: "D1",
          files: ["a.ts"],
          estimated_effort: "small",
        },
        {
          title: "T2",
          description: "D2",
          files: ["b.ts"],
          estimated_effort: "small",
        },
        {
          title: "T3",
          description: "D3",
          files: ["c.ts"],
          estimated_effort: "medium",
        },
      ],
    };
    const result = await structured_parse_decomposition.execute(
      { response: JSON.stringify(decomp) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary.effort_breakdown.small).toBe(2);
    expect(parsed.summary.effort_breakdown.medium).toBe(1);
  });

  it("handles dependencies in summary", async () => {
    const decomp = {
      task: "Test",
      subtasks: [
        {
          title: "T1",
          description: "D1",
          files: ["a.ts"],
          estimated_effort: "small",
        },
        {
          title: "T2",
          description: "D2",
          files: ["b.ts"],
          estimated_effort: "small",
        },
      ],
      dependencies: [{ from: 0, to: 1, type: "blocks" }],
    };
    const result = await structured_parse_decomposition.execute(
      { response: JSON.stringify(decomp) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary.dependency_count).toBe(1);
  });

  it("deduplicates files in summary", async () => {
    const decomp = {
      task: "Test",
      subtasks: [
        {
          title: "T1",
          description: "D1",
          files: ["shared.ts", "a.ts"],
          estimated_effort: "small",
        },
        {
          title: "T2",
          description: "D2",
          files: ["shared.ts", "b.ts"],
          estimated_effort: "small",
        },
      ],
    };
    const result = await structured_parse_decomposition.execute(
      { response: JSON.stringify(decomp) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary.total_files).toBe(3); // shared.ts counted once
    expect(parsed.summary.files).toEqual(["shared.ts", "a.ts", "b.ts"]);
  });

  it("returns error for invalid decomposition", async () => {
    const result = await structured_parse_decomposition.execute(
      { response: '{"task": "Test"}' }, // Missing subtasks
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("does not match schema");
  });
});

// ============================================================================
// 9. structured_parse_cell_tree tool
// ============================================================================

describe("structured_parse_cell_tree", () => {
  const mockCtx = {} as ToolContext;

  it("parses valid bead tree", async () => {
    const validTree = {
      epic: {
        title: "Add authentication",
        description: "OAuth + session management",
      },
      subtasks: [
        {
          title: "OAuth integration",
          description: "Connect to provider",
          files: ["src/auth/oauth.ts"],
          dependencies: [],
          estimated_complexity: 3,
        },
        {
          title: "Session store",
          description: "Redis sessions",
          files: ["src/auth/sessions.ts"],
          dependencies: [0],
          estimated_complexity: 2,
        },
      ],
    };
    const result = await structured_parse_cell_tree.execute(
      { response: JSON.stringify(validTree) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data.epic.title).toBe("Add authentication");
    expect(parsed.summary.subtask_count).toBe(2);
    expect(parsed.summary.complexity_total).toBe(5);
  });

  it("calculates complexity total", async () => {
    const tree = {
      epic: { title: "Test" },
      subtasks: [
        {
          title: "T1",
          files: ["a.ts"],
          dependencies: [],
          estimated_complexity: 2,
        },
        {
          title: "T2",
          files: ["b.ts"],
          dependencies: [],
          estimated_complexity: 3,
        },
        {
          title: "T3",
          files: ["c.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    };
    const result = await structured_parse_cell_tree.execute(
      { response: JSON.stringify(tree) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary.complexity_total).toBe(6);
  });

  it("lists unique files", async () => {
    const tree = {
      epic: { title: "Test" },
      subtasks: [
        {
          title: "T1",
          files: ["shared.ts", "a.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
        {
          title: "T2",
          files: ["shared.ts", "b.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    };
    const result = await structured_parse_cell_tree.execute(
      { response: JSON.stringify(tree) },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.summary.total_files).toBe(3);
    expect(parsed.summary.files).toEqual(["shared.ts", "a.ts", "b.ts"]);
  });

  it("returns error for invalid bead tree", async () => {
    const result = await structured_parse_cell_tree.execute(
      { response: '{"epic": {}}' }, // Missing required fields
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("does not match schema");
  });

  it("includes expected shape in error", async () => {
    const result = await structured_parse_cell_tree.execute(
      { response: '{"wrong": true}' },
      mockCtx,
    );
    const parsed = JSON.parse(result);

    expect(parsed.expected_shape).toBeDefined();
    expect(parsed.expected_shape.epic).toBeDefined();
    expect(parsed.expected_shape.subtasks).toBeDefined();
  });
});

// ============================================================================
// 10. Edge Cases and Regression Tests
// ============================================================================

describe("Edge cases", () => {
  it("handles JSON with unicode characters", () => {
    const unicodeJson = '{"emoji": "🎉", "chinese": "你好"}';
    const [result, _method] = extractJsonFromText(unicodeJson);
    expect(result).toEqual({ emoji: "🎉", chinese: "你好" });
  });

  it("handles very long strings in JSON", () => {
    const longString = "x".repeat(10000);
    const json = JSON.stringify({ long: longString });
    const [result, _method] = extractJsonFromText(json);
    expect((result as Record<string, unknown>).long).toBe(longString);
  });

  it("handles JSON with null values", () => {
    const json = '{"key": null, "key2": "value"}';
    const [result, _method] = extractJsonFromText(json);
    expect(result).toEqual({ key: null, key2: "value" });
  });

  it("handles JSON with boolean values", () => {
    const json = '{"t": true, "f": false}';
    const [result, _method] = extractJsonFromText(json);
    expect(result).toEqual({ t: true, f: false });
  });

  it("handles JSON with number types", () => {
    const json = '{"int": 42, "float": 3.14, "exp": 1e10}';
    const [result, _method] = extractJsonFromText(json);
    expect(result).toEqual({ int: 42, float: 3.14, exp: 1e10 });
  });

  it("handles mixed content markdown with multiple code blocks", () => {
    const markdown = `
Some text here.

\`\`\`typescript
const code = "not json";
\`\`\`

And the result is:

\`\`\`json
{"result": "success"}
\`\`\`

More text.
    `;
    const [result, method] = extractJsonFromText(markdown);
    expect(result).toEqual({ result: "success" });
    expect(method).toBe("json_code_block");
  });

  it("handles JSON with escaped characters", () => {
    const json =
      '{"path": "C:\\\\Users\\\\file.txt", "newline": "line1\\nline2"}';
    const [result, _method] = extractJsonFromText(json);
    const typedResult = result as Record<string, unknown>;
    expect(typedResult.path).toBe("C:\\Users\\file.txt");
    expect(typedResult.newline).toBe("line1\nline2");
  });
});
