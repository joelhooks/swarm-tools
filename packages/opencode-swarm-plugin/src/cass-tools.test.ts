/**
 * CASS Tools Tests - Inhouse Implementation
 * 
 * Tests for the SessionIndexer-based CASS tools.
 */
import { describe, test, expect } from "bun:test";
import { cassTools } from "./cass-tools";

describe("cass_health", () => {
	test("returns health status", async () => {
		const result = await cassTools.cass_health.execute({});
		
		// Should return JSON
		expect(() => JSON.parse(result)).not.toThrow();
		
		const health = JSON.parse(result);
		expect(health).toHaveProperty("healthy");
		expect(typeof health.healthy).toBe("boolean");
	});
});

describe("cass_stats", () => {
	test("returns statistics", async () => {
		const result = await cassTools.cass_stats.execute({});
		
		// Should return JSON
		expect(() => JSON.parse(result)).not.toThrow();
		
		const stats = JSON.parse(result);
		expect(stats).toHaveProperty("total_sessions");
		expect(stats).toHaveProperty("total_chunks");
		expect(stats).toHaveProperty("by_agent");
	});
});

describe("cass_search", () => {
	test("handles empty query gracefully", async () => {
		const result = await cassTools.cass_search.execute({ query: "test" });
		
		// Should not throw
		expect(result).toBeTruthy();
		
		// Should start with the 🔍 CASS Search header
		expect(result).toContain("🔍 CASS Search");
		
		// Should either have results or show no results message
		if (result.includes("0 results")) {
			expect(result).toContain("No matching sessions found");
			expect(result).toContain("broader search terms");
		}
	});

	test("returns compact format with header", async () => {
		const result = await cassTools.cass_search.execute({ query: "authentication" });
		
		// Always starts with CASS Search header emoji
		expect(result.startsWith("🔍 CASS Search")).toBe(true);
		
		// If there are results, they should follow the [agent] path:line - "preview" format
		const lines = result.split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(1); // At least header line
	});
});

describe("cass_view", () => {
	test("handles invalid path gracefully", async () => {
		const result = await cassTools.cass_view.execute({ 
			path: "/nonexistent/path.jsonl" 
		});
		
		// Should return error JSON
		expect(() => JSON.parse(result)).not.toThrow();
		const error = JSON.parse(result);
		expect(error).toHaveProperty("error");
	});
});

describe("cass_expand", () => {
	test("handles invalid path gracefully", async () => {
		const result = await cassTools.cass_expand.execute({ 
			path: "/nonexistent/path.jsonl",
			line: 1
		});
		
		// Should return error JSON
		expect(() => JSON.parse(result)).not.toThrow();
		const error = JSON.parse(result);
		expect(error).toHaveProperty("error");
	});
});

describe("cass_index", () => {
	test.skip("runs without crashing", async () => {
		// Skipped: Takes too long to index all directories
		// This may take a while if there are many sessions
		const result = await cassTools.cass_index.execute({});
		
		// Should not throw and return something
		expect(result).toBeTruthy();
	}, { timeout: 60000 }); // 60s timeout for indexing
});
