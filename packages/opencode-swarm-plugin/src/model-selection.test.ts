/**
 * Model Selection Tests
 *
 * Tests for selectWorkerModel function that determines which model
 * a worker should use based on subtask characteristics.
 */
import { describe, test, expect } from "bun:test";
import { selectWorkerModel } from "./model-selection";
import type { DecomposedSubtask } from "./schemas/task";

// Mock config type matching expected SwarmConfig structure
interface TestConfig {
  primaryModel: string;
  liteModel?: string;
}

describe("selectWorkerModel", () => {
  const mockConfig: TestConfig = {
    primaryModel: "anthropic/claude-sonnet-4-5",
    liteModel: "anthropic/claude-haiku-4-5",
  };

  test("uses explicit model field from subtask when provided", () => {
    const subtask: DecomposedSubtask & { model?: string } = {
      title: "Update docs",
      description: "Update README",
      files: ["README.md"],
      estimated_effort: "trivial",
      model: "anthropic/claude-opus-4-5", // Explicit override
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-opus-4-5");
  });

  test("uses liteModel for all markdown files", () => {
    const subtask: DecomposedSubtask = {
      title: "Update docs",
      description: "Update all docs",
      files: ["README.md", "CONTRIBUTING.md"],
      estimated_effort: "small",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-haiku-4-5");
  });

  test("uses liteModel for all MDX files", () => {
    const subtask: DecomposedSubtask = {
      title: "Update docs",
      description: "Update content",
      files: ["docs/intro.mdx", "docs/guide.mdx"],
      estimated_effort: "small",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-haiku-4-5");
  });

  test("uses liteModel for test files with .test. pattern", () => {
    const subtask: DecomposedSubtask = {
      title: "Write tests",
      description: "Add unit tests",
      files: ["src/auth.test.ts", "src/user.test.ts"],
      estimated_effort: "small",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-haiku-4-5");
  });

  test("uses liteModel for test files with .spec. pattern", () => {
    const subtask: DecomposedSubtask = {
      title: "Write specs",
      description: "Add spec tests",
      files: ["src/auth.spec.ts", "src/user.spec.ts"],
      estimated_effort: "small",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-haiku-4-5");
  });

  test("uses primaryModel when files are mixed (code + docs)", () => {
    const subtask: DecomposedSubtask = {
      title: "Implement feature with docs",
      description: "Add feature and document it",
      files: ["src/feature.ts", "README.md"],
      estimated_effort: "medium",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-sonnet-4-5");
  });

  test("uses primaryModel when files are mixed (code + tests)", () => {
    const subtask: DecomposedSubtask = {
      title: "Implement feature with tests",
      description: "Add feature and tests",
      files: ["src/feature.ts", "src/feature.test.ts"],
      estimated_effort: "medium",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-sonnet-4-5");
  });

  test("uses primaryModel for implementation files", () => {
    const subtask: DecomposedSubtask = {
      title: "Implement auth",
      description: "Add authentication",
      files: ["src/auth.ts", "src/middleware.ts"],
      estimated_effort: "large",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-sonnet-4-5");
  });

  test("defaults to primaryModel when liteModel not configured", () => {
    const configWithoutLite: TestConfig = {
      primaryModel: "anthropic/claude-sonnet-4-5",
      // liteModel is undefined
    };

    const subtask: DecomposedSubtask = {
      title: "Update docs",
      description: "Update README",
      files: ["README.md"],
      estimated_effort: "trivial",
    };

    const result = selectWorkerModel(subtask, configWithoutLite);
    expect(result).toBe("anthropic/claude-sonnet-4-5");
  });

  test("falls back to claude-haiku when liteModel not configured but primaryModel missing", () => {
    const emptyConfig: TestConfig = {
      primaryModel: "",
    };

    const subtask: DecomposedSubtask = {
      title: "Update docs",
      description: "Update README",
      files: ["README.md"],
      estimated_effort: "trivial",
    };

    const result = selectWorkerModel(subtask, emptyConfig);
    expect(result).toBe("anthropic/claude-haiku-4-5");
  });

  test("handles empty files array by defaulting to primaryModel", () => {
    const subtask: DecomposedSubtask = {
      title: "Research task",
      description: "Investigate options",
      files: [],
      estimated_effort: "small",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-sonnet-4-5");
  });

  test("handles mixed markdown and mdx files", () => {
    const subtask: DecomposedSubtask = {
      title: "Update all docs",
      description: "Update docs",
      files: ["README.md", "docs/guide.mdx", "CHANGELOG.md"],
      estimated_effort: "small",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-haiku-4-5");
  });

  test("case insensitive file extension matching", () => {
    const subtask: DecomposedSubtask = {
      title: "Update docs",
      description: "Update README",
      files: ["README.MD", "CONTRIBUTING.MD"],
      estimated_effort: "trivial",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("anthropic/claude-haiku-4-5");
  });

  test("uses Synthetic model when explicitly provided", () => {
    const subtask: DecomposedSubtask & { model?: string } = {
      title: "Complex reasoning task",
      description: "Use advanced reasoning",
      files: ["src/ai.ts"],
      estimated_effort: "large",
      model: "synthetic/hf:moonshotai/Kimi-K2.5",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("synthetic/hf:moonshotai/Kimi-K2.5");
  });

  test("synthetic DeepSeek model is selectable", () => {
    const subtask: DecomposedSubtask & { model?: string } = {
      title: "Deep reasoning task",
      description: "Deep analysis required",
      files: ["src/deep.ts"],
      estimated_effort: "large",
      model: "synthetic/hf:deepseek-ai/DeepSeek-V3.2",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("synthetic/hf:deepseek-ai/DeepSeek-V3.2");
  });

  test("synthetic MiniMax model is selectable for worker tasks", () => {
    const subtask: DecomposedSubtask & { model?: string } = {
      title: "Fast processing task",
      description: "Process data quickly",
      files: ["src/process.ts"],
      estimated_effort: "small",
      model: "synthetic/hf:MiniMaxAI/MiniMax-M2.1",
    };

    const result = selectWorkerModel(subtask, mockConfig);
    expect(result).toBe("synthetic/hf:MiniMaxAI/MiniMax-M2.1");
  });
});
