/**
 * Integration tests for structured_* tools
 *
 * Tests the complete tool execution flow:
 * - Tool argument parsing and validation
 * - JSON extraction from various formats
 * - Schema validation with structured output
 * - Error handling and feedback formatting
 *
 * ## Test Pattern
 * - Call tool.execute() directly (simulates plugin invocation)
 * - Use mock ToolContext
 * - Test happy paths with real-world scenarios
 * - No external dependencies (pure JSON parsing)
 */

import type { ToolContext } from "@opencode-ai/plugin";
import { describe, expect, it } from "bun:test";
import {
	structured_extract_json,
	structured_parse_cell_tree,
	structured_parse_decomposition,
	structured_parse_evaluation,
	structured_validate,
} from "./structured";

// Mock ToolContext for tool execution
const mockCtx = {} as ToolContext;

// ============================================================================
// structured_extract_json - JSON Extraction
// ============================================================================

describe("structured_extract_json integration", () => {
	it("extracts clean JSON and returns success", async () => {
		const result = await structured_extract_json.execute(
			{ text: '{"name": "Joel", "role": "developer"}' },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.data).toEqual({ name: "Joel", role: "developer" });
		expect(parsed.extraction_method).toBe("direct_parse");
	});

	it("extracts JSON from markdown code block", async () => {
		const markdown = `Here is the response:\n\`\`\`json\n{"status": "complete"}\n\`\`\``;

		const result = await structured_extract_json.execute(
			{ text: markdown },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.data).toEqual({ status: "complete" });
		expect(parsed.extraction_method).toBe("json_code_block");
	});

	it("extracts JSON from mixed content with multiple code blocks", async () => {
		const mixed = `
Some text here.

\`\`\`typescript
const code = "not json";
\`\`\`

Result:

\`\`\`json
{"result": "success"}
\`\`\`
    `;

		const result = await structured_extract_json.execute(
			{ text: mixed },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.data).toEqual({ result: "success" });
		expect(parsed.extraction_method).toBe("json_code_block");
	});

	it("handles complex nested structures", async () => {
		const complex = JSON.stringify({
			epic: {
				title: "Add authentication",
				description: "OAuth + session management",
			},
			subtasks: [
				{
					title: "OAuth integration",
					files: ["src/auth/oauth.ts"],
					estimated_complexity: 3,
				},
				{
					title: "Session store",
					files: ["src/auth/sessions.ts"],
					estimated_complexity: 2,
				},
			],
		});

		const result = await structured_extract_json.execute(
			{ text: complex },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.data.epic.title).toBe("Add authentication");
		expect(parsed.data.subtasks).toHaveLength(2);
	});

	it("returns error for non-JSON input", async () => {
		const result = await structured_extract_json.execute(
			{ text: "This is not JSON at all" },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(false);
		expect(parsed.error).toContain("Could not extract");
		expect(Array.isArray(parsed.attempted_strategies)).toBe(true);
		expect(parsed.attempted_strategies.length).toBeGreaterThan(0);
	});

	it("includes input preview in error for long text", async () => {
		const longText = "x".repeat(300);

		const result = await structured_extract_json.execute(
			{ text: longText },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(false);
		expect(parsed.raw_input_preview).toBeDefined();
		expect(parsed.raw_input_preview.length).toBeLessThanOrEqual(200);
	});
});

// ============================================================================
// structured_validate - Schema Validation
// ============================================================================

describe("structured_validate integration", () => {
	describe("evaluation schema", () => {
		it("validates correct evaluation structure", async () => {
			const evalObj = {
				passed: true,
				criteria: {
					type_safety: { passed: true, feedback: "All types validated" },
					no_bugs: { passed: true, feedback: "No issues found" },
				},
				overall_feedback: "Excellent work",
				retry_suggestion: null,
			};

			const result = await structured_validate.execute(
				{
					response: JSON.stringify(evalObj),
					schema_name: "evaluation",
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.data.passed).toBe(true);
			expect(Object.keys(parsed.data.criteria)).toHaveLength(2);
		});

		it("extracts JSON from markdown before validating", async () => {
			const evalObj = {
				passed: false,
				criteria: {
					test: { passed: false, feedback: "Test failed" },
				},
				overall_feedback: "Needs fixes",
				retry_suggestion: "Add tests",
			};

			const markdown = `Analysis complete:\n\`\`\`json\n${JSON.stringify(evalObj)}\n\`\`\``;

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

		it("returns structured errors for invalid evaluation", async () => {
			const result = await structured_validate.execute(
				{
					response: '{"invalid": true}',
					schema_name: "evaluation",
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(false);
			expect(Array.isArray(parsed.errors)).toBe(true);
			expect(parsed.errors.length).toBeGreaterThan(0);
		});

		it("handles empty response gracefully", async () => {
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
	});

	describe("task_decomposition schema", () => {
		it("validates correct decomposition structure", async () => {
			const decompObj = {
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

			const result = await structured_validate.execute(
				{
					response: JSON.stringify(decompObj),
					schema_name: "task_decomposition",
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.data.task).toBe("Implement authentication");
			expect(parsed.data.subtasks).toHaveLength(2);
		});
	});

	describe("cell_tree schema", () => {
		it("validates correct cell tree structure", async () => {
			const treeObj = {
				epic: {
					title: "Add authentication",
					description: "OAuth + sessions",
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
						files: ["src/auth/sessions.ts"],
						dependencies: [0],
						estimated_complexity: 2,
					},
				],
			};

			const result = await structured_validate.execute(
				{
					response: JSON.stringify(treeObj),
					schema_name: "cell_tree",
				},
				mockCtx,
			);

			const parsed = JSON.parse(result);
			expect(parsed.success).toBe(true);
			expect(parsed.data.epic.title).toBe("Add authentication");
			expect(parsed.data.subtasks).toHaveLength(2);
		});
	});

	it("includes retry hint when max_retries provided", async () => {
		const result = await structured_validate.execute(
			{
				response: '{"invalid": true}',
				schema_name: "evaluation",
				max_retries: 3,
			},
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(false);
		const hasRetryHint = parsed.errors.some((e: string) =>
			e.includes("try again"),
		);
		expect(hasRetryHint).toBe(true);
	});
});

// ============================================================================
// structured_parse_evaluation - Typed Evaluation Parsing
// ============================================================================

describe("structured_parse_evaluation integration", () => {
	it("parses valid evaluation with summary", async () => {
		const evalObj = {
			passed: true,
			criteria: {
				type_safe: { passed: true, feedback: "All types validated" },
				no_bugs: { passed: true, feedback: "No issues found" },
				patterns: { passed: true, feedback: "Follows best practices" },
			},
			overall_feedback: "Excellent implementation",
			retry_suggestion: null,
		};

		const result = await structured_parse_evaluation.execute(
			{ response: JSON.stringify(evalObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.data.passed).toBe(true);
		expect(parsed.summary.passed).toBe(true);
		expect(parsed.summary.criteria_count).toBe(3);
		expect(parsed.summary.failed_criteria).toEqual([]);
	});

	it("identifies failed criteria in summary", async () => {
		const evalObj = {
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
			{ response: JSON.stringify(evalObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.summary.passed).toBe(false);
		expect(parsed.summary.failed_criteria).toContain("no_bugs");
		expect(parsed.summary.failed_criteria).toContain("patterns");
		expect(parsed.summary.failed_criteria).not.toContain("type_safe");
	});

	it("returns structured error for malformed JSON", async () => {
		const result = await structured_parse_evaluation.execute(
			{ response: "not json" },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(false);
		expect(parsed.error).toContain("extract JSON");
		expect(parsed.feedback).toBeDefined();
		expect(Array.isArray(parsed.attempted_strategies)).toBe(true);
	});

	it("returns structured error for invalid schema", async () => {
		const invalidEval = {
			passed: "not a boolean",
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
		expect(Array.isArray(parsed.validation_errors)).toBe(true);
		expect(parsed.expected_shape).toBeDefined();
	});
});

// ============================================================================
// structured_parse_decomposition - Typed Decomposition Parsing
// ============================================================================

describe("structured_parse_decomposition integration", () => {
	it("parses valid decomposition with summary", async () => {
		const decompObj = {
			task: "Implement authentication",
			reasoning: "Split by feature layer for parallel development",
			subtasks: [
				{
					title: "Auth service",
					description: "Core authentication logic",
					files: ["src/auth/service.ts", "src/auth/types.ts"],
					estimated_effort: "medium",
				},
				{
					title: "Auth UI",
					description: "Login and signup forms",
					files: ["src/components/Login.tsx", "src/components/Signup.tsx"],
					estimated_effort: "small",
				},
				{
					title: "Auth API",
					description: "REST endpoints",
					files: ["src/api/auth.ts"],
					estimated_effort: "small",
				},
			],
		};

		const result = await structured_parse_decomposition.execute(
			{ response: JSON.stringify(decompObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.data.task).toBe("Implement authentication");
		expect(parsed.summary.subtask_count).toBe(3);
		expect(parsed.summary.total_files).toBe(5);
		expect(parsed.summary.files).toContain("src/auth/service.ts");
	});

	it("includes effort breakdown in summary", async () => {
		const decompObj = {
			task: "Test task",
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
				{
					title: "T4",
					description: "D4",
					files: ["d.ts"],
					estimated_effort: "large",
				},
			],
		};

		const result = await structured_parse_decomposition.execute(
			{ response: JSON.stringify(decompObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.summary.effort_breakdown.small).toBe(2);
		expect(parsed.summary.effort_breakdown.medium).toBe(1);
		expect(parsed.summary.effort_breakdown.large).toBe(1);
	});

	it("deduplicates files in summary", async () => {
		const decompObj = {
			task: "Test task",
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
			{ response: JSON.stringify(decompObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.summary.total_files).toBe(3);
		expect(parsed.summary.files).toEqual(["shared.ts", "a.ts", "b.ts"]);
	});

	it("handles dependencies in summary", async () => {
		const decompObj = {
			task: "Test task",
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
			dependencies: [
				{ from: 0, to: 1, type: "blocks" },
				{ from: 1, to: 0, type: "requires" },
			],
		};

		const result = await structured_parse_decomposition.execute(
			{ response: JSON.stringify(decompObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.summary.dependency_count).toBe(2);
	});

	it("returns error for invalid decomposition", async () => {
		const result = await structured_parse_decomposition.execute(
			{ response: '{"task": "Test"}' }, // Missing required subtasks
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(false);
		expect(parsed.error).toContain("does not match schema");
		expect(parsed.expected_shape).toBeDefined();
	});
});

// ============================================================================
// structured_parse_cell_tree - Typed Cell Tree Parsing
// ============================================================================

describe("structured_parse_cell_tree integration", () => {
	it("parses valid cell tree with summary", async () => {
		const treeObj = {
			epic: {
				title: "Add authentication system",
				description: "OAuth + session management + permissions",
			},
			subtasks: [
				{
					title: "OAuth integration",
					description: "Connect to OAuth provider",
					files: ["src/auth/oauth.ts", "src/auth/config.ts"],
					dependencies: [],
					estimated_complexity: 4,
				},
				{
					title: "Session store",
					description: "Redis-backed session management",
					files: ["src/auth/sessions.ts"],
					dependencies: [0],
					estimated_complexity: 3,
				},
				{
					title: "Permissions system",
					description: "Role-based access control",
					files: ["src/auth/permissions.ts", "src/auth/roles.ts"],
					dependencies: [0, 1],
					estimated_complexity: 5,
				},
			],
		};

		const result = await structured_parse_cell_tree.execute(
			{ response: JSON.stringify(treeObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.data.epic.title).toBe("Add authentication system");
		expect(parsed.summary.subtask_count).toBe(3);
		expect(parsed.summary.total_files).toBe(5);
		expect(parsed.summary.complexity_total).toBe(12);
	});

	it("lists unique files in summary", async () => {
		const treeObj = {
			epic: { title: "Test epic" },
			subtasks: [
				{
					title: "T1",
					files: ["shared.ts", "a.ts"],
					dependencies: [],
					estimated_complexity: 2,
				},
				{
					title: "T2",
					files: ["shared.ts", "b.ts"],
					dependencies: [],
					estimated_complexity: 2,
				},
			],
		};

		const result = await structured_parse_cell_tree.execute(
			{ response: JSON.stringify(treeObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.summary.total_files).toBe(3);
		expect(parsed.summary.files).toEqual(["shared.ts", "a.ts", "b.ts"]);
	});

	it("calculates complexity total correctly", async () => {
		const treeObj = {
			epic: { title: "Test epic" },
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
			{ response: JSON.stringify(treeObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.summary.complexity_total).toBe(6);
	});

	it("returns error for invalid cell tree", async () => {
		const result = await structured_parse_cell_tree.execute(
			{ response: '{"epic": {}}' }, // Missing required fields
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(false);
		expect(parsed.error).toContain("does not match schema");
		expect(parsed.expected_shape).toBeDefined();
	});

	it("includes expected shape in error feedback", async () => {
		const result = await structured_parse_cell_tree.execute(
			{ response: '{"wrong": "structure"}' },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(false);
		expect(parsed.expected_shape.epic).toBeDefined();
		expect(parsed.expected_shape.subtasks).toBeDefined();
	});
});

// ============================================================================
// Edge Cases and Real-World Scenarios
// ============================================================================

describe("Real-world integration scenarios", () => {
	it("handles evaluation with unicode and special characters", async () => {
		const evalObj = {
			passed: true,
			criteria: {
				emoji_support: {
					passed: true,
					feedback: "Handles 🎉 and 你好 correctly",
				},
			},
			overall_feedback: "All special chars work ✅",
			retry_suggestion: null,
		};

		const result = await structured_parse_evaluation.execute(
			{ response: JSON.stringify(evalObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.data.criteria.emoji_support.feedback).toContain("🎉");
	});

	it("handles decomposition with deeply nested file paths", async () => {
		const decompObj = {
			task: "Reorganize project structure",
			subtasks: [
				{
					title: "Move auth files",
					description: "Restructure auth module",
					files: [
						"src/features/auth/services/oauth/providers/google.ts",
						"src/features/auth/services/oauth/providers/github.ts",
					],
					estimated_effort: "small",
				},
			],
		};

		const result = await structured_parse_decomposition.execute(
			{ response: JSON.stringify(decompObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.summary.total_files).toBe(2);
	});

	it("handles cell tree with maximum complexity values", async () => {
		const treeObj = {
			epic: { title: "Complex refactor" },
			subtasks: [
				{
					title: "High complexity task",
					files: ["complex.ts"],
					dependencies: [],
					estimated_complexity: 5,
				},
			],
		};

		const result = await structured_parse_cell_tree.execute(
			{ response: JSON.stringify(treeObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		expect(parsed.summary.complexity_total).toBe(5);
	});

	it("handles JSON with escaped characters in paths", async () => {
		const decompObj = {
			task: "Windows compatibility",
			subtasks: [
				{
					title: "Fix paths",
					description: "Handle backslashes",
					files: ["C:\\Users\\file.ts", "path\\to\\file.ts"],
					estimated_effort: "small",
				},
			],
		};

		const result = await structured_parse_decomposition.execute(
			{ response: JSON.stringify(decompObj) },
			mockCtx,
		);

		const parsed = JSON.parse(result);
		expect(parsed.success).toBe(true);
		// JSON.stringify escapes backslashes, so they become double-escaped
		expect(parsed.data.subtasks[0].files).toContain("C:\\Users\\file.ts");
	});
});
