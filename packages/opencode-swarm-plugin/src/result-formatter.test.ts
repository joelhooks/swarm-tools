/**
 * Result Formatter Tests
 *
 * Tests for shared result formatting utilities used by semantic-memory and CASS tools.
 * Following TDD - tests written first, implementation follows.
 */

import { describe, test, expect } from "bun:test";
import {
	truncate,
	formatAge,
	formatDecay,
	formatScore,
	formatMemoryResults,
	formatCassResults,
	type MemoryResult,
	type CassResult,
} from "./result-formatter";

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("truncate", () => {
	test("returns original string if shorter than maxLen", () => {
		expect(truncate("short", 10)).toBe("short");
	});

	test("truncates string and adds ellipsis", () => {
		expect(truncate("this is a very long string", 10)).toBe("this is a...");
	});

	test("handles empty string", () => {
		expect(truncate("", 10)).toBe("");
	});

	test("handles string exactly at maxLen", () => {
		expect(truncate("exactly10!", 10)).toBe("exactly10!");
	});

	test("handles maxLen of 0", () => {
		expect(truncate("any string", 0)).toBe("...");
	});

	test("removes trailing whitespace before ellipsis", () => {
		expect(truncate("hello world this", 11)).toBe("hello world...");
	});
});

describe("formatAge", () => {
	test("formats days as Xd", () => {
		expect(formatAge(12)).toBe("12d");
	});

	test("formats 0 days as <1d", () => {
		expect(formatAge(0)).toBe("<1d");
	});

	test("formats fractional days as hours when < 1", () => {
		expect(formatAge(0.5)).toBe("12h");
	});

	test("formats very small values as minutes", () => {
		// 0.02 days = 0.48 hours = 28.8 minutes -> floors to 28m
		expect(formatAge(0.02)).toBe("28m");
	});

	test("formats exactly 1 day", () => {
		expect(formatAge(1)).toBe("1d");
	});

	test("handles large numbers", () => {
		expect(formatAge(365)).toBe("365d");
	});
});

describe("formatDecay", () => {
	test("formats decay as percentage", () => {
		expect(formatDecay(91)).toBe("91%");
	});

	test("formats 100% decay", () => {
		expect(formatDecay(100)).toBe("100%");
	});

	test("formats 0% decay", () => {
		expect(formatDecay(0)).toBe("0%");
	});

	test("rounds decimal percentages", () => {
		expect(formatDecay(91.5)).toBe("92%");
	});

	test("handles fractional percentages", () => {
		expect(formatDecay(0.5)).toBe("1%");
	});
});

describe("formatScore", () => {
	test("formats score with 2 decimal places", () => {
		expect(formatScore(0.57)).toBe("0.57");
	});

	test("formats score of 1.0", () => {
		expect(formatScore(1.0)).toBe("1.00");
	});

	test("formats score of 0", () => {
		expect(formatScore(0)).toBe("0.00");
	});

	test("rounds to 2 decimal places", () => {
		expect(formatScore(0.567)).toBe("0.57");
	});

	test("handles very small scores", () => {
		expect(formatScore(0.001)).toBe("0.00");
	});
});

// ============================================================================
// Memory Result Formatter Tests
// ============================================================================

describe("formatMemoryResults", () => {
	const sampleResults: MemoryResult[] = [
		{
			id: "abc123",
			score: 0.57,
			age_days: 12,
			decay_percent: 91,
			content: "OAuth refresh tokens need 5min buffer before expiry",
		},
		{
			id: "def456",
			score: 0.56,
			age_days: 1,
			decay_percent: 99,
			content: "Next.js cache components gotcha with useSearchParams",
		},
		{
			id: "ghi789",
			score: 0.55,
			age_days: 9,
			decay_percent: 93,
			content: "Zod async validation anti-pattern causes blocking",
			collection: "patterns",
		},
	];

	test("formats results with header and count", () => {
		const result = formatMemoryResults(sampleResults, "auth tokens");
		expect(result).toContain("📚 Semantic Memory");
		expect(result).toContain("3 results");
	});

	test("includes memory IDs in brackets", () => {
		const result = formatMemoryResults(sampleResults, "test");
		expect(result).toContain("[abc123]");
		expect(result).toContain("[def456]");
		expect(result).toContain("[ghi789]");
	});

	test("includes score, decay, and age", () => {
		const result = formatMemoryResults(sampleResults, "test");
		expect(result).toContain("score: 0.57");
		expect(result).toContain("decay: 91%");
		expect(result).toContain("12d");
	});

	test("truncates long content", () => {
		const longContent: MemoryResult[] = [
			{
				id: "long1",
				score: 0.5,
				age_days: 1,
				decay_percent: 99,
				content:
					"This is a very long piece of content that goes on and on and should definitely be truncated at some point to fit in the compact display format",
			},
		];
		const result = formatMemoryResults(longContent, "test");
		expect(result).toContain("...");
		// Should not contain the full text
		expect(result).not.toContain("compact display format");
	});

	test("handles empty results", () => {
		const result = formatMemoryResults([], "nothing");
		expect(result).toContain("0 results");
		expect(result).toContain("nothing");
	});

	test("indents each result line", () => {
		const result = formatMemoryResults(sampleResults, "test");
		// Each result line should start with spaces for indentation
		const lines = result.split("\n").filter((l) => l.includes("["));
		for (const line of lines) {
			expect(line.startsWith("  ")).toBe(true);
		}
	});

	test("shows collection when provided", () => {
		const withCollection: MemoryResult[] = [
			{
				id: "col1",
				score: 0.5,
				age_days: 1,
				decay_percent: 99,
				content: "Test",
				collection: "my-collection",
			},
		];
		const result = formatMemoryResults(withCollection, "test");
		expect(result).toContain("my-collection");
	});
});

// ============================================================================
// CASS Result Formatter Tests
// ============================================================================

describe("formatCassResults", () => {
	const sampleResults: CassResult[] = [
		{
			agent: "claude",
			path: "~/.claude/sessions/abc.jsonl",
			line: 42,
			preview: "auth token refresh pattern with retry",
		},
		{
			agent: "cursor",
			path: "~/.cursor/sessions/def.jsonl",
			line: 89,
			preview: "similar authentication pattern found here",
		},
		{
			agent: "opencode",
			path: "~/.opencode/sessions/ghi.jsonl",
			line: 156,
			preview: "OAuth implementation discussion",
		},
	];

	test("formats results with header and count", () => {
		const result = formatCassResults(sampleResults, "auth", 5);
		expect(result).toContain("🔍 CASS Search");
		expect(result).toContain("3 results");
	});

	test("shows total when different from displayed", () => {
		const result = formatCassResults(sampleResults, "auth", 10);
		expect(result).toContain("10 total");
	});

	test("includes agent name in brackets", () => {
		const result = formatCassResults(sampleResults, "test", 3);
		expect(result).toContain("[claude]");
		expect(result).toContain("[cursor]");
		expect(result).toContain("[opencode]");
	});

	test("includes path and line number", () => {
		const result = formatCassResults(sampleResults, "test", 3);
		expect(result).toContain("abc.jsonl:42");
		expect(result).toContain("def.jsonl:89");
	});

	test("includes preview in quotes", () => {
		const result = formatCassResults(sampleResults, "test", 3);
		expect(result).toContain('"auth token refresh');
	});

	test("truncates long previews", () => {
		const longPreview: CassResult[] = [
			{
				agent: "claude",
				path: "~/.claude/sessions/abc.jsonl",
				line: 1,
				preview:
					"This is a very long preview that goes on and on and should be truncated at some point to fit nicely",
			},
		];
		const result = formatCassResults(longPreview, "test", 1);
		expect(result).toContain("...");
	});

	test("handles empty results", () => {
		const result = formatCassResults([], "nothing", 0);
		expect(result).toContain("0 results");
	});

	test("indents each result line", () => {
		const result = formatCassResults(sampleResults, "test", 3);
		const lines = result.split("\n").filter((l) => l.includes("["));
		for (const line of lines) {
			expect(line.startsWith("  ")).toBe(true);
		}
	});

	test("shows shortened path with directory context", () => {
		const homeResults: CassResult[] = [
			{
				agent: "claude",
				path: "/Users/zacjones/.claude/sessions/abc.jsonl",
				line: 1,
				preview: "test",
			},
		];
		const result = formatCassResults(homeResults, "test", 1);
		// Should include directory context and filename
		expect(result).toContain("sessions/abc.jsonl:1");
	});
});
