/**
 * Structured Output Module - JSON extraction and schema validation
 *
 * Handles parsing agent responses that contain JSON, with multiple fallback
 * strategies for malformed or wrapped content.
 *
 * ## Usage
 * 1. `structured_extract_json` - Raw JSON extraction from text (no validation)
 * 2. `structured_validate` - Extract + validate against named schema
 * 3. `structured_parse_evaluation` - Typed parsing for agent self-evaluations
 * 4. `structured_parse_decomposition` - Typed parsing for task breakdowns
 * 5. `structured_parse_cell_tree` - Typed parsing for epic + subtasks
 *
 * @module structured
 */
import { tool } from "@opencode-ai/plugin";
import { z, type ZodSchema } from "zod";
import {
  EvaluationSchema,
  TaskDecompositionSchema,
  CellTreeSchema,
  ValidationResultSchema,
  CriterionEvaluationSchema,
  type Evaluation,
  type TaskDecomposition,
  type CellTree,
  type ValidationResult,
} from "./schemas";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Structured validation error with formatted feedback
 *
 * Contains both raw Zod errors for programmatic access and
 * pre-formatted error bullets suitable for retry prompts.
 */
export class StructuredValidationError extends Error {
  public readonly errorBullets: string[];

  constructor(
    message: string,
    public readonly zodError: z.ZodError | null,
    public readonly rawInput: string,
    public readonly extractionMethod?: string,
  ) {
    super(message);
    this.name = "StructuredValidationError";
    this.errorBullets = zodError ? formatZodErrors(zodError) : [message];
  }

  /**
   * Format errors as bullet list for retry prompts
   */
  toFeedback(): string {
    return this.errorBullets.map((e) => `- ${e}`).join("\n");
  }
}

/**
 * Error when JSON cannot be extracted from text
 */
export class JsonExtractionError extends Error {
  constructor(
    message: string,
    public readonly rawInput: string,
    public readonly attemptedStrategies: string[],
  ) {
    super(message);
    this.name = "JsonExtractionError";
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format Zod validation errors as readable bullet points
 *
 * @param error - Zod error from schema validation
 * @returns Array of error messages suitable for feedback
 */
function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

/**
 * Schema registry for named schema lookups
 */
const SCHEMA_REGISTRY: Record<string, ZodSchema> = {
  evaluation: EvaluationSchema,
  task_decomposition: TaskDecompositionSchema,
  cell_tree: CellTreeSchema,
};

/**
 * Get schema by name from registry
 */
function getSchemaByName(name: string): ZodSchema {
  const schema = SCHEMA_REGISTRY[name];
  if (!schema) {
    throw new Error(
      `Unknown schema: ${name}. Available: ${Object.keys(SCHEMA_REGISTRY).join(", ")}`,
    );
  }
  return schema;
}

/**
 * Extract JSON from text using multiple strategies.
 *
 * Strategies tried in priority order:
 * 1. Direct parse - fastest, works for clean JSON
 * 2. JSON code block - common in markdown responses
 * 3. Generic code block - fallback for unlabeled blocks
 * 4. First brace match - finds outermost {...}
 * 5. Last brace match - handles trailing content
 * 6. Repair attempt - fixes common issues (quotes, trailing commas)
 *
 * @param text Raw text potentially containing JSON
 * @returns Parsed JSON object or null if all strategies fail
 */
function extractJsonFromText(text: string): [unknown, string] {
  const trimmed = text.trim();
  const strategies: string[] = [];

  // Strategy 1: Direct parse (entire string is valid JSON)
  strategies.push("direct_parse");
  try {
    return [JSON.parse(trimmed), "direct_parse"];
  } catch {
    // Continue to other strategies
  }

  // Strategy 2: Extract from ```json code blocks
  strategies.push("json_code_block");
  const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    try {
      return [JSON.parse(jsonBlockMatch[1].trim()), "json_code_block"];
    } catch {
      // Continue to other strategies
    }
  }

  // Strategy 3: Extract from any code block (```...```)
  strategies.push("any_code_block");
  const codeBlockMatch = trimmed.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return [JSON.parse(codeBlockMatch[1].trim()), "any_code_block"];
    } catch {
      // Continue to other strategies
    }
  }

  // Strategy 4: Find first balanced {...} object
  strategies.push("brace_match_object");
  const objectJson = findBalancedBraces(trimmed, "{", "}");
  if (objectJson) {
    try {
      return [JSON.parse(objectJson), "brace_match_object"];
    } catch {
      // Continue to other strategies
    }
  }

  // Strategy 5: Find first balanced [...] array
  strategies.push("brace_match_array");
  const arrayJson = findBalancedBraces(trimmed, "[", "]");
  if (arrayJson) {
    try {
      return [JSON.parse(arrayJson), "brace_match_array"];
    } catch {
      // Continue to other strategies
    }
  }

  // Strategy 6: Try to repair common JSON issues and parse
  strategies.push("repair_json");
  const repaired = attemptJsonRepair(trimmed);
  if (repaired !== trimmed) {
    try {
      return [JSON.parse(repaired), "repair_json"];
    } catch {
      // All strategies failed
    }
  }

  throw new JsonExtractionError(
    "Could not extract valid JSON from response",
    text,
    strategies,
  );
}

/** Maximum nesting depth before aborting (prevents stack overflow on malformed input) */
const MAX_BRACE_DEPTH = 100;

/**
 * Find a balanced pair of braces/brackets
 */
function findBalancedBraces(
  text: string,
  open: string,
  close: string,
): string | null {
  const startIdx = text.indexOf(open);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === open) {
      depth++;
      if (depth > MAX_BRACE_DEPTH) {
        return null; // Malformed input - too deeply nested
      }
    } else if (char === close) {
      depth--;
      if (depth < 0) {
        return null; // Malformed input - unbalanced braces
      }
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

/**
 * Attempt to repair common JSON issues.
 *
 * This is a simple heuristic - won't work for all cases.
 *
 * **Known Limitations:**
 * - Single quotes in nested objects may not be handled correctly
 * - Escaped quotes in keys can confuse the regex
 * - Multiline strings are not detected
 * - Trailing commas in nested arrays may be missed
 *
 * @param text Potentially malformed JSON string
 * @returns Repaired JSON string (may still be invalid)
 */
function attemptJsonRepair(text: string): string {
  let repaired = text;

  // Find JSON-like content first
  const match = repaired.match(/[\[{][\s\S]*[\]}]/);
  if (!match) return text;

  repaired = match[0];

  // Replace single quotes with double quotes (but not inside strings)
  // This is a simple heuristic - won't work for all cases
  repaired = repaired.replace(/(?<![\\])'([^']*)'(?=\s*:)/g, '"$1"');

  // Remove trailing commas before } or ]
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");

  // Replace literal newlines in strings with \n
  repaired = repaired.replace(
    /"([^"]*)\n([^"]*)"/g,
    (_, before, after) => `"${before}\\n${after}"`,
  );

  return repaired;
}

// ============================================================================
// Validation Result Types
// ============================================================================

/** Maximum characters to show in raw input previews */
const RAW_INPUT_PREVIEW_LENGTH = 200;

/**
 * Result of a structured validation attempt
 */
interface StructuredValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  attempts: number;
  errors?: string[];
  extractionMethod?: string;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Extract JSON from markdown/text response
 *
 * Tries multiple extraction strategies in order:
 * 1. Direct JSON parse
 * 2. ```json code blocks
 * 3. Any code blocks
 * 4. Brace matching for objects
 * 5. Bracket matching for arrays
 * 6. JSON repair attempts
 */
export const structured_extract_json = tool({
  description:
    "Extract JSON from markdown/text response. Tries multiple strategies: direct parse, code blocks, brace matching, JSON repair.",
  args: {
    text: tool.schema.string().describe("Text containing JSON to extract"),
  },
  async execute(args, ctx) {
    try {
      const [parsed, method] = extractJsonFromText(args.text);
      return JSON.stringify(
        {
          success: true,
          data: parsed,
          extraction_method: method,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof JsonExtractionError) {
        return JSON.stringify(
          {
            success: false,
            error: error.message,
            attempted_strategies: error.attemptedStrategies,
            raw_input_preview: args.text.slice(0, RAW_INPUT_PREVIEW_LENGTH),
          },
          null,
          2,
        );
      }
      throw error;
    }
  },
});

/**
 * Validate agent response against a named schema
 *
 * Extracts JSON from the response using multiple strategies,
 * then validates against the specified schema.
 */
export const structured_validate = tool({
  description:
    "Validate agent response against a schema. Extracts JSON and validates with Zod. Returns structured errors for retry feedback.",
  args: {
    response: tool.schema.string().describe("Agent response to validate"),
    schema_name: tool.schema
      .enum(["evaluation", "task_decomposition", "cell_tree"])
      .describe(
        "Schema to validate against: " +
          "evaluation = agent self-eval with criteria, " +
          "task_decomposition = swarm task breakdown, " +
          "cell_tree = epic with subtasks",
      ),
    max_retries: tool.schema
      .number()
      .min(1)
      .max(5)
      .optional()
      .describe("Max retries (for tracking - actual retry logic is external)"),
  },
  async execute(args, ctx) {
    const maxRetries = args.max_retries ?? 3;
    const result: ValidationResult = {
      success: false,
      attempts: 1,
      errors: [],
    };

    // Check for empty response before attempting extraction
    if (!args.response || args.response.trim().length === 0) {
      return JSON.stringify({
        valid: false,
        error: "Response is empty or contains only whitespace",
        raw_input: "(empty)",
      });
    }

    // Step 1: Extract JSON
    let extracted: unknown;
    let extractionMethod: string;

    try {
      [extracted, extractionMethod] = extractJsonFromText(args.response);
      result.extractionMethod = extractionMethod;
    } catch (error) {
      if (error instanceof JsonExtractionError) {
        result.errors = [
          `JSON extraction failed after trying: ${error.attemptedStrategies.join(", ")}`,
          `Input preview: ${args.response.slice(0, RAW_INPUT_PREVIEW_LENGTH)}...`,
        ];
        return JSON.stringify(result, null, 2);
      }
      throw error;
    }

    // Step 2: Validate against schema
    try {
      const schema = getSchemaByName(args.schema_name);
      const validated = schema.parse(extracted);

      result.success = true;
      result.data = validated;
      delete result.errors;

      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formatted = formatZodErrors(error);
        result.errors = formatted;

        // Add hint for retries
        if (result.attempts < maxRetries) {
          result.errors.push(
            `\nFix these issues and try again (attempt ${result.attempts}/${maxRetries})`,
          );
        }

        return JSON.stringify(result, null, 2);
      }
      throw error;
    }
  },
});

/**
 * Parse and validate evaluation response from an agent
 *
 * Specialized tool for parsing self-evaluations. Returns
 * the validated Evaluation or structured errors.
 */
export const structured_parse_evaluation = tool({
  description:
    "Parse and validate evaluation response from an agent. Uses EvaluationSchema.",
  args: {
    response: tool.schema
      .string()
      .describe("Agent response containing evaluation"),
  },
  async execute(args, ctx) {
    try {
      const [extracted, method] = extractJsonFromText(args.response);
      const validated = EvaluationSchema.parse(extracted) as Evaluation;

      return JSON.stringify(
        {
          success: true,
          data: validated,
          extraction_method: method,
          summary: {
            passed: validated.passed,
            criteria_count: Object.keys(validated.criteria).length,
            failed_criteria: Object.entries(validated.criteria)
              .filter(([_, v]) => {
                const criterion = v as z.infer<
                  typeof CriterionEvaluationSchema
                >;
                return !criterion.passed;
              })
              .map(([k]) => k),
          },
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof JsonExtractionError) {
        return JSON.stringify(
          {
            success: false,
            error: "Failed to extract JSON from response",
            details: error.message,
            attempted_strategies: error.attemptedStrategies,
            feedback: [
              "- Response must contain valid JSON",
              "- Use ```json code blocks for clarity",
              "- Ensure all braces and brackets are balanced",
            ].join("\n"),
          },
          null,
          2,
        );
      }

      if (error instanceof z.ZodError) {
        const bullets = formatZodErrors(error);
        return JSON.stringify(
          {
            success: false,
            error: "Evaluation does not match schema",
            validation_errors: bullets,
            feedback: bullets.map((e) => `- ${e}`).join("\n"),
            expected_shape: {
              passed: "boolean",
              criteria: "Record<string, { passed: boolean, feedback: string }>",
              overall_feedback: "string",
              retry_suggestion: "string | null",
            },
          },
          null,
          2,
        );
      }

      throw error;
    }
  },
});

/**
 * Parse and validate task decomposition response
 *
 * Specialized tool for parsing decomposition results.
 * Validates the structure and returns file lists for reservations.
 */
export const structured_parse_decomposition = tool({
  description:
    "Parse and validate task decomposition response. Uses TaskDecompositionSchema. Returns validated decomposition with file lists.",
  args: {
    response: tool.schema
      .string()
      .describe("Agent response containing decomposition"),
  },
  async execute(args, ctx) {
    try {
      const [extracted, method] = extractJsonFromText(args.response);
      const validated = TaskDecompositionSchema.parse(
        extracted,
      ) as TaskDecomposition;

      // Collect all files for reservation planning
      const allFiles = validated.subtasks.flatMap((s) => s.files);
      const uniqueFiles = [...new Set(allFiles)];

      return JSON.stringify(
        {
          success: true,
          data: validated,
          extraction_method: method,
          summary: {
            task:
              validated.task.slice(0, 50) +
              (validated.task.length > 50 ? "..." : ""),
            subtask_count: validated.subtasks.length,
            dependency_count: validated.dependencies?.length ?? 0,
            total_files: uniqueFiles.length,
            files: uniqueFiles,
            effort_breakdown: validated.subtasks.reduce(
              (acc, s) => {
                acc[s.estimated_effort] = (acc[s.estimated_effort] || 0) + 1;
                return acc;
              },
              {} as Record<string, number>,
            ),
          },
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof JsonExtractionError) {
        return JSON.stringify(
          {
            success: false,
            error: "Failed to extract JSON from response",
            details: error.message,
            attempted_strategies: error.attemptedStrategies,
            feedback: [
              "- Response must contain valid JSON",
              "- Use ```json code blocks for clarity",
              "- Ensure all braces and brackets are balanced",
            ].join("\n"),
          },
          null,
          2,
        );
      }

      if (error instanceof z.ZodError) {
        const bullets = formatZodErrors(error);
        return JSON.stringify(
          {
            success: false,
            error: "Decomposition does not match schema",
            validation_errors: bullets,
            feedback: bullets.map((e) => `- ${e}`).join("\n"),
            expected_shape: {
              task: "string (original task)",
              reasoning: "string (optional)",
              subtasks: [
                {
                  title: "string",
                  description: "string",
                  files: ["string array of file paths"],
                  estimated_effort: "trivial | small | medium | large",
                  risks: ["optional string array"],
                },
              ],
              dependencies: [
                {
                  from: "number (subtask index)",
                  to: "number (subtask index)",
                  type: "blocks | requires | related",
                },
              ],
            },
          },
          null,
          2,
        );
      }

      throw error;
    }
  },
});

/**
 * Parse and validate a bead tree (epic with subtasks)
 *
 * Validates the structure before creating cells.
 */
export const structured_parse_cell_tree = tool({
  description:
    "Parse and validate bead tree response. Uses CellTreeSchema. Validates before creating epic with subtasks.",
  args: {
    response: tool.schema
      .string()
      .describe("Agent response containing bead tree"),
  },
  async execute(args, ctx) {
    try {
      const [extracted, method] = extractJsonFromText(args.response);
      const validated = CellTreeSchema.parse(extracted) as CellTree;

      // Collect all files for reservation planning
      const allFiles = validated.subtasks.flatMap((s) => s.files);
      const uniqueFiles = [...new Set(allFiles)];

      return JSON.stringify(
        {
          success: true,
          data: validated,
          extraction_method: method,
          summary: {
            epic_title: validated.epic.title,
            subtask_count: validated.subtasks.length,
            total_files: uniqueFiles.length,
            files: uniqueFiles,
            complexity_total: validated.subtasks.reduce(
              (sum, s) => sum + s.estimated_complexity,
              0,
            ),
          },
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof JsonExtractionError) {
        return JSON.stringify(
          {
            success: false,
            error: "Failed to extract JSON from response",
            details: error.message,
            feedback: [
              "- Response must contain valid JSON",
              "- Use ```json code blocks for clarity",
            ].join("\n"),
          },
          null,
          2,
        );
      }

      if (error instanceof z.ZodError) {
        const bullets = formatZodErrors(error);
        return JSON.stringify(
          {
            success: false,
            error: "Bead tree does not match schema",
            validation_errors: bullets,
            feedback: bullets.map((e) => `- ${e}`).join("\n"),
            expected_shape: {
              epic: { title: "string", description: "string (optional)" },
              subtasks: [
                {
                  title: "string",
                  description: "string (optional)",
                  files: ["string array"],
                  dependencies: ["number array of subtask indices"],
                  estimated_complexity: "1-5",
                },
              ],
            },
          },
          null,
          2,
        );
      }

      throw error;
    }
  },
});

// ============================================================================
// Utility Exports (for use by other modules)
// ============================================================================

export { extractJsonFromText, formatZodErrors, getSchemaByName };

// ============================================================================
// Tool Exports
// ============================================================================

export const structuredTools = {
  structured_extract_json: structured_extract_json,
  structured_validate: structured_validate,
  structured_parse_evaluation: structured_parse_evaluation,
  structured_parse_decomposition: structured_parse_decomposition,
  structured_parse_cell_tree: structured_parse_cell_tree,
};

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================

/** @deprecated Use structured_parse_cell_tree instead */
export const structured_parse_bead_tree = structured_parse_cell_tree;
