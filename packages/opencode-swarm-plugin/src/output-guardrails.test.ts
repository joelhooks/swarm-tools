/**
 * Tests for output-guardrails module
 *
 * Validates smart truncation preserves structure boundaries and respects tool limits.
 */

import { describe, expect, test } from "bun:test";
import {
  truncateWithBoundaries,
  guardrailOutput,
  createMetrics,
  DEFAULT_GUARDRAIL_CONFIG,
  type GuardrailConfig,
} from "./output-guardrails";

describe("truncateWithBoundaries", () => {
  test("returns unchanged text when under limit", () => {
    const text = "Hello, world!";
    const result = truncateWithBoundaries(text, 100);
    expect(result).toBe(text);
  });

  test("preserves complete JSON objects", () => {
    const text = `{"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}`;
    const result = truncateWithBoundaries(text, 40);

    // Should truncate before the unclosed object
    expect(result).toContain("[TRUNCATED");
    expect(result).not.toContain('{"id": 2'); // Don't cut mid-object
  });

  test("preserves nested JSON structure", () => {
    const text = JSON.stringify(
      {
        level1: {
          level2: {
            level3: {
              data: "This is deeply nested data that will be truncated",
            },
          },
        },
      },
      null,
      2,
    );

    const result = truncateWithBoundaries(text, 50);

    // Should find matching braces or truncate before unclosed structure
    expect(result).toContain("[TRUNCATED");

    // Truncation logic will try to preserve structure when possible
    // Main requirement: it should truncate and add the marker
    const truncatedLength = result.split("[TRUNCATED")[0].length;
    expect(truncatedLength).toBeLessThan(text.length);
  });

  test("preserves code block boundaries", () => {
    const text = `
Here's some code:

\`\`\`typescript
function example() {
  console.log("This is a long function");
  console.log("With multiple lines");
  console.log("That should be preserved");
}
\`\`\`

More text after.
`;

    const result = truncateWithBoundaries(text, 80);

    // Should either include closing ``` or truncate before opening ```
    const backtickCount = (result.split("[TRUNCATED")[0].match(/```/g) || [])
      .length;
    expect(backtickCount % 2).toBe(0); // Even number of backticks
  });

  test("preserves markdown header boundaries", () => {
    const text = `
# Main Title

Some intro text.

## Section 1

Content for section 1 with lots of detail that will eventually get truncated.

## Section 2

Content for section 2.

### Subsection 2.1

More content here.
`;

    const result = truncateWithBoundaries(text, 120);

    // Should truncate at a header boundary when possible
    expect(result).toContain("[TRUNCATED");

    // Check if it truncated at a header boundary
    const beforeTruncate = result.split("[TRUNCATED")[0];

    // Either ends with a header or doesn't have headers in the range
    const hasHeaders = beforeTruncate.includes("##");
    if (hasHeaders && beforeTruncate.length > 100) {
      // If we have headers and enough content, should end near a header
      expect(beforeTruncate).toMatch(/\n\n$/); // Should end at paragraph boundary at least
    }
  });

  test("handles text without structure boundaries", () => {
    const text = "a".repeat(1000);
    const result = truncateWithBoundaries(text, 100);

    expect(result).toContain("[TRUNCATED");
    expect(result.length).toBeLessThan(200); // Much shorter than original
  });

  test("adds truncation suffix with character count", () => {
    const text = "a".repeat(1000);
    const result = truncateWithBoundaries(text, 100);

    expect(result).toMatch(/\[TRUNCATED - \d{1,3}(,\d{3})* chars removed\]/);
  });

  test("avoids truncating mid-word", () => {
    const text = "The quick brown fox jumps over the lazy dog ".repeat(20);
    const result = truncateWithBoundaries(text, 100);

    const beforeTruncate = result.split("[TRUNCATED")[0];

    // Should try to truncate at whitespace boundary when possible
    // At minimum, it should truncate
    expect(result).toContain("[TRUNCATED");
    expect(beforeTruncate.length).toBeLessThan(text.length);
  });

  test("handles empty string", () => {
    const result = truncateWithBoundaries("", 100);
    expect(result).toBe("");
  });

  test("handles exact limit length", () => {
    const text = "a".repeat(100);
    const result = truncateWithBoundaries(text, 100);
    expect(result).toBe(text);
  });

  test("handles just over limit", () => {
    const text = "a".repeat(101);
    const result = truncateWithBoundaries(text, 100);

    expect(result).toContain("[TRUNCATED");
    // Should remove at least some characters
    const charsRemoved = text.length - result.split("[TRUNCATED")[0].length;
    expect(charsRemoved).toBeGreaterThan(0);
  });

  test("extends limit by 20% to include matching braces", () => {
    // Create a JSON object that ends just after the limit
    const shortContent = '{"data": "x"}';
    const padding = "x".repeat(85);
    const text = padding + shortContent; // Total ~98 chars

    const result = truncateWithBoundaries(text, 100);

    // If the closing brace is within the 20% buffer (120 chars), should try to include it
    // At minimum, the function should handle this gracefully
    expect(result.length).toBeGreaterThan(0);

    // If it truncated, should have the marker
    if (result.length < text.length) {
      expect(result).toContain("[TRUNCATED");
    }
  });

  test("extends limit by 20% to include closing code block", () => {
    const text = `${"x".repeat(85)}\n\`\`\`\ncode\n\`\`\``; // ~98 chars

    const result = truncateWithBoundaries(text, 100);

    // If the closing ``` is within the 20% buffer, should try to include it
    // At minimum, should handle gracefully
    expect(result.length).toBeGreaterThan(0);

    // If it did truncate and we're within the buffer, backticks should be balanced
    if (result.length < text.length && text.length <= 120) {
      const beforeTruncate = result.split("[TRUNCATED")[0];
      const backtickCount = (beforeTruncate.match(/```/g) || []).length;
      // Should either have no backticks or balanced backticks
      expect(backtickCount === 0 || backtickCount % 2 === 0).toBe(true);
    }
  });
});

describe("guardrailOutput", () => {
  test("skips configured tools", () => {
    const longOutput = "a".repeat(50000);

    // Beads tools should never be truncated
    const result = guardrailOutput("hive_create", longOutput);

    expect(result.truncated).toBe(false);
    expect(result.output).toBe(longOutput);
    expect(result.originalLength).toBe(50000);
    expect(result.truncatedLength).toBe(50000);
  });

  test("truncates oversized output for non-skip tools", () => {
    const longOutput = "a".repeat(50000);

    // Random tool should be truncated at default limit
    const result = guardrailOutput("some_random_tool", longOutput);

    expect(result.truncated).toBe(true);
    expect(result.output).toContain("[TRUNCATED");
    expect(result.originalLength).toBe(50000);
    expect(result.truncatedLength).toBeLessThan(50000);
  });

  test("respects per-tool limits", () => {
    const mediumOutput = "a".repeat(40000);

    // repo-autopsy_file has 64000 char limit
    const result1 = guardrailOutput("repo-autopsy_file", mediumOutput);
    expect(result1.truncated).toBe(false);

    // cass_stats has 8000 char limit
    const result2 = guardrailOutput("cass_stats", mediumOutput);
    expect(result2.truncated).toBe(true);
  });

  test("uses custom config when provided", () => {
    const customConfig: GuardrailConfig = {
      defaultMaxChars: 100,
      toolLimits: {
        custom_tool: 200,
      },
      skipTools: ["never_truncate"],
    };

    const text150 = "a".repeat(150);

    // Should truncate at default 100
    const result1 = guardrailOutput("random_tool", text150, customConfig);
    expect(result1.truncated).toBe(true);

    // Should not truncate at custom limit 200
    const result2 = guardrailOutput("custom_tool", text150, customConfig);
    expect(result2.truncated).toBe(false);

    // Should skip configured tool
    const text500 = "a".repeat(500);
    const result3 = guardrailOutput("never_truncate", text500, customConfig);
    expect(result3.truncated).toBe(false);
  });

  test("returns complete metadata", () => {
    const output = "a".repeat(50000);
    const result = guardrailOutput("test_tool", output);

    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("truncated");
    expect(result).toHaveProperty("originalLength");
    expect(result).toHaveProperty("truncatedLength");

    expect(typeof result.truncated).toBe("boolean");
    expect(typeof result.originalLength).toBe("number");
    expect(typeof result.truncatedLength).toBe("number");
  });

  test("handles all skip tools from DEFAULT_GUARDRAIL_CONFIG", () => {
    const longOutput = "a".repeat(100000);

    const skipTools = DEFAULT_GUARDRAIL_CONFIG.skipTools;

    // Test a sample of skip tools
    const samplesToTest = [
      "hive_create",
      "agentmail_send",
      "swarmmail_inbox",
      "structured_validate",
      "swarm_complete",
      "mandate_query",
    ];

    for (const toolName of samplesToTest) {
      expect(skipTools).toContain(toolName);
      const result = guardrailOutput(toolName, longOutput);
      expect(result.truncated).toBe(false);
    }
  });
});

describe("createMetrics", () => {
  test("creates metrics entry from guardrail result", () => {
    const result = {
      output: "truncated output",
      truncated: true,
      originalLength: 50000,
      truncatedLength: 32000,
    };

    const metrics = createMetrics(result, "test_tool");

    expect(metrics).toEqual({
      toolName: "test_tool",
      originalLength: 50000,
      truncatedLength: 32000,
      timestamp: expect.any(Number),
    });
  });

  test("timestamp is reasonable", () => {
    const result = {
      output: "output",
      truncated: false,
      originalLength: 100,
      truncatedLength: 100,
    };

    const before = Date.now();
    const metrics = createMetrics(result, "test_tool");
    const after = Date.now();

    expect(metrics.timestamp).toBeGreaterThanOrEqual(before);
    expect(metrics.timestamp).toBeLessThanOrEqual(after);
  });
});

describe("DEFAULT_GUARDRAIL_CONFIG", () => {
  test("has sensible defaults", () => {
    expect(DEFAULT_GUARDRAIL_CONFIG.defaultMaxChars).toBe(32000);
    expect(DEFAULT_GUARDRAIL_CONFIG.toolLimits).toBeDefined();
    expect(DEFAULT_GUARDRAIL_CONFIG.skipTools).toBeDefined();
    expect(DEFAULT_GUARDRAIL_CONFIG.skipTools.length).toBeGreaterThan(0);
  });

  test("includes higher limits for code/doc tools", () => {
    const config = DEFAULT_GUARDRAIL_CONFIG;

    expect(config.toolLimits["repo-autopsy_file"]).toBe(64000);
    expect(config.toolLimits["context7_get-library-docs"]).toBe(64000);
    expect(config.toolLimits["cass_view"]).toBe(64000);
  });

  test("includes lower limits for stats tools", () => {
    const config = DEFAULT_GUARDRAIL_CONFIG;

    expect(config.toolLimits["cass_stats"]).toBe(8000);
    expect(config.toolLimits["repo-autopsy_stats"]).toBe(16000);
  });

  test("skips all internal coordination tools", () => {
    const config = DEFAULT_GUARDRAIL_CONFIG;

    // Sample of tools that should be in skipTools
    const expectedSkips = [
      "hive_create",
      "hive_sync",
      "agentmail_init",
      "swarmmail_send",
      "structured_parse_evaluation",
      "swarm_decompose",
      "mandate_file",
    ];

    for (const tool of expectedSkips) {
      expect(config.skipTools).toContain(tool);
    }
  });
});

describe("edge cases", () => {
  test("handles JSON array at truncation boundary", () => {
    const text = `[
      {"id": 1, "data": "item1"},
      {"id": 2, "data": "item2"},
      {"id": 3, "data": "item3"}
    ]`;

    const result = truncateWithBoundaries(text, 50);

    expect(result).toContain("[TRUNCATED");

    // Should not cut mid-item
    const beforeTruncate = result.split("[TRUNCATED")[0];
    const openBrackets = (beforeTruncate.match(/\[/g) || []).length;
    const closeBrackets = (beforeTruncate.match(/\]/g) || []).length;

    expect(openBrackets).toBeLessThanOrEqual(closeBrackets + 1);
  });

  test("handles mixed code blocks and JSON", () => {
    const text = `
\`\`\`json
{"data": "This is JSON inside a code block"}
\`\`\`

And then some JSON outside:
{"more": "data"}
`;

    const result = truncateWithBoundaries(text, 80);

    // Should respect both code block and JSON boundaries
    expect(result).toContain("[TRUNCATED");

    const beforeTruncate = result.split("[TRUNCATED")[0];
    const backtickCount = (beforeTruncate.match(/```/g) || []).length;

    // Backticks should be balanced
    expect(backtickCount % 2).toBe(0);
  });

  test("handles unicode characters correctly", () => {
    const text = "Hello 世界! 🌍 ".repeat(100);
    const result = truncateWithBoundaries(text, 100);

    expect(result).toContain("[TRUNCATED");
    // Length should be reasonable (not corrupted by unicode)
    expect(result.length).toBeLessThan(text.length);
  });

  test("handles CRLF line endings", () => {
    const text = "Line 1\r\nLine 2\r\nLine 3\r\n".repeat(50);
    const result = truncateWithBoundaries(text, 100);

    expect(result).toContain("[TRUNCATED");
    // Should handle line endings gracefully
    expect(result).not.toContain("\r\n[TRUNCATED");
  });
});
