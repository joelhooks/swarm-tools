/**
 * Integration tests for research phase
 *
 * Tests the full research workflow:
 * - Tool discovery (discoverDocTools)
 * - Lockfile parsing (getInstalledVersions)
 * - Researcher prompt generation (formatResearcherPrompt, swarm_spawn_researcher)
 * - Research orchestration (runResearchPhase, extractTechStack)
 *
 * Uses this repo as a real-world test fixture.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SwarmMailAdapter } from "swarm-mail";
import {
	clearAdapterCache,
	createInMemorySwarmMailLibSQL,
} from "swarm-mail";
import { extractTechStack, runResearchPhase } from "./swarm-orchestrate";
import {
	formatResearcherPrompt,
	swarm_spawn_researcher,
} from "./swarm-prompts";
import {
	discoverDocTools,
	getInstalledVersions,
	swarm_discover_tools,
	swarm_get_versions,
} from "./swarm-research";

/**
 * Get plugin directory regardless of where tests are run from
 * (handles both monorepo root and package directory)
 */
function getPluginDir(): string {
	const cwd = process.cwd();
	// If we're in the monorepo root, point to packages/opencode-swarm-plugin
	if (existsSync(join(cwd, "packages/opencode-swarm-plugin/package.json"))) {
		return join(cwd, "packages/opencode-swarm-plugin");
	}
	// If we're already in the plugin directory, use cwd
	if (existsSync(join(cwd, "package.json"))) {
		return cwd;
	}
	throw new Error("Cannot find plugin directory");
}

describe("Tool discovery integration", () => {
	test("discoverDocTools returns available tools", async () => {
		const tools = await discoverDocTools();

		// Should return a non-empty array
		expect(tools.length).toBeGreaterThan(0);

		// Check structure of returned tools
		for (const tool of tools) {
			expect(tool.name).toBeDefined();
			expect(tool.type).toMatch(/^(skill|mcp|cli)$/);
			expect(Array.isArray(tool.capabilities)).toBe(true);
			expect(typeof tool.available).toBe("boolean");
		}

		// Should include known tools
		const toolNames = tools.map((t) => t.name);
		expect(toolNames).toContain("next-devtools");
		expect(toolNames).toContain("context7");
		expect(toolNames).toContain("fetch");
		expect(toolNames).toContain("pdf-brain");
	});

	test("swarm_discover_tools plugin tool returns JSON summary", async () => {
		const result = await swarm_discover_tools.execute({});
		const parsed = JSON.parse(result);

		// Check summary structure
		expect(parsed.tools).toBeDefined();
		expect(parsed.summary).toBeDefined();
		expect(parsed.summary.total).toBeGreaterThan(0);
		expect(parsed.summary.available).toBeGreaterThanOrEqual(0);
		expect(parsed.summary.by_type).toBeDefined();

		// Check usage hint
		expect(parsed.usage_hint).toBeDefined();
	});
});

describe("Lockfile parsing integration", () => {
	let testProjectPath: string;

	beforeEach(() => {
		// Create temp directory for test fixtures
		testProjectPath = join(tmpdir(), `lockfile-test-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });
	});

	afterEach(() => {
		// Clean up
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("getInstalledVersions reads from bun.lock fallback to package.json", async () => {
		// Create a package.json (bun.lock is binary, can't easily mock)
		const packageJson = {
			dependencies: {
				zod: "^3.22.4",
				typescript: "^5.3.3",
			},
			devDependencies: {
				"@types/node": "^20.0.0",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		// Query for specific packages
		const versions = await getInstalledVersions(testProjectPath, [
			"zod",
			"typescript",
			"@types/node",
		]);

		// Should return versions from package.json (since no npm/pnpm/yarn lockfile)
		expect(versions.length).toBeGreaterThan(0);

		// Check zod
		const zodVersion = versions.find((v) => v.name === "zod");
		expect(zodVersion).toBeDefined();
		expect(zodVersion?.version).toBe("3.22.4");
		expect(zodVersion?.source).toBe("package.json");
		expect(zodVersion?.constraint).toBe("^3.22.4");

		// Check typescript
		const tsVersion = versions.find((v) => v.name === "typescript");
		expect(tsVersion).toBeDefined();
		expect(tsVersion?.version).toBe("5.3.3");
		expect(tsVersion?.source).toBe("package.json");
	});

	test("getInstalledVersions handles missing packages gracefully", async () => {
		// Create minimal package.json
		const packageJson = {
			dependencies: {
				zod: "^3.22.4",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		// Query for packages that don't exist
		const versions = await getInstalledVersions(testProjectPath, [
			"zod",
			"nonexistent-package",
			"another-missing",
		]);

		// Should only return zod
		expect(versions.length).toBe(1);
		expect(versions[0].name).toBe("zod");
	});

	test("getInstalledVersions returns empty array for no lockfile or package.json", async () => {
		// Don't create any files - project has no dependencies
		const versions = await getInstalledVersions(testProjectPath, [
			"zod",
			"typescript",
		]);

		// Should return empty array
		expect(versions).toEqual([]);
	});

	test("swarm_get_versions plugin tool returns JSON summary", async () => {
		// Create a package.json
		const packageJson = {
			dependencies: {
				zod: "^3.22.4",
				typescript: "^5.3.3",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		// Call plugin tool
		const result = await swarm_get_versions.execute({
			projectPath: testProjectPath,
			packages: ["zod", "typescript", "missing-pkg"],
		});

		const parsed = JSON.parse(result);

		// Check summary
		expect(parsed.versions).toBeDefined();
		expect(parsed.summary).toBeDefined();
		expect(parsed.summary.found).toBe(2);
		expect(parsed.summary.requested).toBe(3);
		expect(parsed.summary.missing).toEqual(["missing-pkg"]);
		expect(parsed.summary.sources.package_json).toBe(2);

		// Check usage hint
		expect(parsed.usage_hint).toBeDefined();
	});

	test("reads from real bun.lock in this repo", async () => {
		// Use the plugin package directory which has the dependencies
		const pluginDir = getPluginDir();

		// Query for packages we know exist in the plugin
		const versions = await getInstalledVersions(pluginDir, [
			"zod",
			"effect",
			"@opencode-ai/plugin",
		]);

		// Should find at least some versions from package.json
		expect(versions.length).toBeGreaterThan(0);

		// Check zod (we know it's in dependencies)
		const zodVersion = versions.find((v) => v.name === "zod");
		expect(zodVersion).toBeDefined();
		expect(zodVersion?.version).toMatch(/^\d+\.\d+\.\d+/); // Semver format
	});
});

describe("Researcher prompt generation", () => {
	test("formatResearcherPrompt generates valid prompt with tech stack", () => {
		const prompt = formatResearcherPrompt({
			research_id: "test-research-123",
			epic_id: "epic-456",
			tech_stack: ["zod", "typescript", "next.js"],
			project_path: "/test/project",
			check_upgrades: false,
		});

		// Should contain all parameters
		expect(prompt).toContain("test-research-123");
		expect(prompt).toContain("epic-456");
		expect(prompt).toContain("zod");
		expect(prompt).toContain("typescript");
		expect(prompt).toContain("next.js");
		expect(prompt).toContain("/test/project");

		// Should be in DEFAULT MODE (not UPGRADE COMPARISON MODE)
		expect(prompt).toContain("DEFAULT MODE");
		expect(prompt).not.toContain("UPGRADE COMPARISON MODE");
	});

	test("formatResearcherPrompt includes upgrade mode when check_upgrades=true", () => {
		const prompt = formatResearcherPrompt({
			research_id: "test-research-123",
			epic_id: "epic-456",
			tech_stack: ["zod"],
			project_path: "/test/project",
			check_upgrades: true,
		});

		// Should be in UPGRADE COMPARISON MODE
		expect(prompt).toContain("UPGRADE COMPARISON MODE");
		expect(prompt).toContain("BOTH installed AND latest versions");
	});

	test("swarm_spawn_researcher returns JSON with prompt and metadata", async () => {
		const result = await swarm_spawn_researcher.execute({
			research_id: "research-789",
			epic_id: "epic-101",
			tech_stack: ["zod", "typescript"],
			project_path: "/test/project",
			check_upgrades: false,
		});

		const parsed = JSON.parse(result);

		// Check structure
		expect(parsed.prompt).toBeDefined();
		expect(parsed.research_id).toBe("research-789");
		expect(parsed.epic_id).toBe("epic-101");
		expect(parsed.tech_stack).toEqual(["zod", "typescript"]);
		expect(parsed.project_path).toBe("/test/project");
		expect(parsed.check_upgrades).toBe(false);
		expect(parsed.subagent_type).toBe("swarm-researcher");

		// Check expected output schema
		expect(parsed.expected_output).toBeDefined();
		expect(parsed.expected_output.technologies).toBeDefined();
		expect(parsed.expected_output.summary).toBeDefined();
	});
});

describe("Research orchestration integration", () => {
	let testProjectPath: string;
	let swarmMail: SwarmMailAdapter;

	beforeEach(async () => {
		// Create temp project directory
		testProjectPath = join(tmpdir(), `research-test-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });

		// Initialize swarm-mail for this project
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
	});

	afterEach(async () => {
		// Clean up
		await swarmMail.close();
		clearAdapterCache();
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("extractTechStack identifies technologies from task description", () => {
		const task =
			"Add Zod validation to Next.js API routes with TypeScript types";
		const techStack = extractTechStack(task);

		// Should extract known technologies
		expect(techStack).toContain("zod");
		expect(techStack).toContain("next"); // Pattern matches "next" (not "next.js")
		expect(techStack).toContain("typescript");
	});

	test("extractTechStack handles case-insensitive matches", () => {
		const task = "Use REACT and NextJS with TYPESCRIPT";
		const techStack = extractTechStack(task);

		// Should normalize to lowercase
		expect(techStack).toContain("react");
		expect(techStack).toContain("next"); // Pattern matches "next"
		expect(techStack).toContain("typescript");
	});

	test("extractTechStack returns empty array for unknown technologies", () => {
		const task = "Implement something with FooBarBaz library";
		const techStack = extractTechStack(task);

		// Should return empty array (no known tech)
		expect(techStack).toEqual([]);
	});

	test("runResearchPhase returns tech stack and research summaries", async () => {
		// Create a package.json with dependencies
		const packageJson = {
			dependencies: {
				zod: "^3.22.4",
				typescript: "^5.3.3",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		// Run research phase
		const result = await runResearchPhase(
			"Add Zod validation to TypeScript API",
			testProjectPath,
		);

		// Should extract tech stack
		expect(result.tech_stack).toBeDefined();
		expect(result.tech_stack.length).toBeGreaterThan(0);
		expect(result.tech_stack).toContain("zod");
		expect(result.tech_stack).toContain("typescript");

		// Should have summaries object (even if empty for now)
		expect(result.summaries).toBeDefined();
		expect(typeof result.summaries).toBe("object");

		// Should have memory_ids array (even if empty for now)
		expect(result.memory_ids).toBeDefined();
		expect(Array.isArray(result.memory_ids)).toBe(true);
	});

	test("runResearchPhase handles no package.json gracefully", async () => {
		// Don't create package.json - project has no dependencies

		const result = await runResearchPhase(
			"Add Zod validation",
			testProjectPath,
		);

		// Should still extract tech stack from description
		expect(result.tech_stack).toBeDefined();
		expect(result.tech_stack).toContain("zod");

		// Should have empty summaries (no research yet)
		expect(result.summaries).toEqual({});
		expect(result.memory_ids).toEqual([]);
	});
});

describe("End-to-end research workflow", () => {
	let testProjectPath: string;
	let swarmMail: SwarmMailAdapter;

	beforeEach(async () => {
		// Create temp project directory
		testProjectPath = join(tmpdir(), `e2e-research-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });

		// Create a realistic package.json
		const packageJson = {
			name: "test-project",
			version: "1.0.0",
			dependencies: {
				zod: "^3.22.4",
				"@opencode-ai/plugin": "^0.1.0",
			},
			devDependencies: {
				typescript: "^5.3.3",
				"@types/node": "^20.0.0",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		// Initialize swarm-mail
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
	});

	afterEach(async () => {
		await swarmMail.close();
		clearAdapterCache();
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("full research phase workflow", async () => {
		// Step 1: Extract tech stack from task
		const task =
			"Add Zod validation to OpenCode plugin with TypeScript types";
		const techStack = extractTechStack(task);

		expect(techStack).toContain("zod");
		expect(techStack).toContain("typescript");

		// Step 2: Discover available doc tools
		const tools = await discoverDocTools();
		expect(tools.length).toBeGreaterThan(0);

		// Step 3: Get installed versions
		const versions = await getInstalledVersions(testProjectPath, techStack);
		expect(versions.length).toBeGreaterThan(0);

		const zodVersion = versions.find((v) => v.name === "zod");
		expect(zodVersion?.version).toBe("3.22.4");
		expect(zodVersion?.source).toBe("package.json");

		// Step 4: Generate researcher prompt
		const prompt = formatResearcherPrompt({
			research_id: "e2e-research",
			epic_id: "epic-test",
			tech_stack: techStack,
			project_path: testProjectPath,
			check_upgrades: false,
		});

		// Prompt should contain all context
		expect(prompt).toContain("e2e-research");
		expect(prompt).toContain("zod");
		expect(prompt).toContain("typescript");
		expect(prompt).toContain(testProjectPath);

		// Step 5: Spawn researcher (get JSON for Task tool)
		const spawnResult = await swarm_spawn_researcher.execute({
			research_id: "e2e-research",
			epic_id: "epic-test",
			tech_stack: techStack,
			project_path: testProjectPath,
			check_upgrades: false,
		});

		const spawnData = JSON.parse(spawnResult);
		expect(spawnData.prompt).toBeDefined();
		expect(spawnData.subagent_type).toBe("swarm-researcher");
		expect(spawnData.tech_stack).toEqual(techStack);

		// The spawned prompt should be ready for Task tool
		expect(spawnData.prompt).toContain("swarmmail_init");
		expect(spawnData.prompt).toContain("hivemind_store");
		expect(spawnData.prompt).toContain(testProjectPath);
	});

	test("research phase orchestration with runResearchPhase", async () => {
		const task = "Build Next.js app with Zod validation and TypeScript";

		// Run full research phase
		const result = await runResearchPhase(task, testProjectPath);

		// Should extract tech stack (normalized names)
		expect(result.tech_stack).toContain("zod");
		expect(result.tech_stack).toContain("typescript");
		expect(result.tech_stack).toContain("next"); // Normalized from "Next.js"

		// Should have research result structure (GREEN phase - empty for now)
		expect(result.summaries).toBeDefined();
		expect(result.memory_ids).toBeDefined();
		expect(Array.isArray(result.memory_ids)).toBe(true);
	});
});

describe("Research spawn instructions (NEW)", () => {
	let testProjectPath: string;

	beforeEach(() => {
		testProjectPath = join(tmpdir(), `spawn-test-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });
	});

	afterEach(() => {
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("runResearchPhase generates spawn instructions for each technology", async () => {
		// Create package.json with dependencies
		const packageJson = {
			dependencies: {
				zod: "^3.22.4",
				typescript: "^5.3.3",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		// Run research phase
		const result = await runResearchPhase(
			"Add Zod validation to TypeScript API",
			testProjectPath,
		);

		// Should have spawn_instructions array
		expect(result.spawn_instructions).toBeDefined();
		expect(Array.isArray(result.spawn_instructions)).toBe(true);

		// Should have one instruction per technology
		expect(result.spawn_instructions.length).toBe(result.tech_stack.length);

		// Each instruction should have required fields
		for (const instruction of result.spawn_instructions) {
			expect(instruction.research_id).toBeDefined();
			expect(instruction.research_id).toMatch(/^research-/); // Should start with "research-"
			expect(instruction.tech).toBeDefined();
			expect(result.tech_stack).toContain(instruction.tech); // Tech should be from tech_stack
			expect(instruction.prompt).toBeDefined();
			expect(typeof instruction.prompt).toBe("string");
			expect(instruction.prompt.length).toBeGreaterThan(0);
			expect(instruction.subagent_type).toBe("swarm-researcher");
		}
	});

	test("runResearchPhase prompts contain correct technology", async () => {
		const packageJson = {
			dependencies: {
				zod: "^3.22.4",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		const result = await runResearchPhase("Use Zod", testProjectPath);

		// Should have exactly one spawn instruction (one tech)
		expect(result.spawn_instructions.length).toBe(1);

		const instruction = result.spawn_instructions[0];
		expect(instruction.tech).toBe("zod");
		expect(instruction.prompt).toContain("zod");
		expect(instruction.prompt).toContain(testProjectPath);
	});

	test("runResearchPhase with multiple technologies generates multiple instructions", async () => {
		const packageJson = {
			dependencies: {
				zod: "^3.22.4",
				typescript: "^5.3.3",
				react: "^18.2.0",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		const result = await runResearchPhase(
			"Build React app with Zod and TypeScript",
			testProjectPath,
		);

		// Should extract 3 technologies
		expect(result.tech_stack.length).toBe(3);

		// Should have 3 spawn instructions
		expect(result.spawn_instructions.length).toBe(3);

		// Each tech should have one instruction
		const techs = result.spawn_instructions.map((i) => i.tech);
		expect(techs).toContain("zod");
		expect(techs).toContain("typescript");
		expect(techs).toContain("react");

		// Research IDs should be unique
		const researchIds = result.spawn_instructions.map((i) => i.research_id);
		const uniqueIds = new Set(researchIds);
		expect(uniqueIds.size).toBe(researchIds.length);
	});

	test("runResearchPhase with empty tech_stack returns empty spawn_instructions", async () => {
		// Don't create package.json - no dependencies

		const result = await runResearchPhase(
			"Implement something with FooBarBaz",
			testProjectPath,
		);

		// Should have empty tech_stack (no known technologies)
		expect(result.tech_stack).toEqual([]);

		// Should have empty spawn_instructions
		expect(result.spawn_instructions).toEqual([]);

		// Other fields should be empty
		expect(result.summaries).toEqual({});
		expect(result.memory_ids).toEqual([]);
	});

	test("spawn instruction prompts include swarmmail_init", async () => {
		const packageJson = {
			dependencies: {
				zod: "^3.22.4",
			},
		};

		writeFileSync(
			join(testProjectPath, "package.json"),
			JSON.stringify(packageJson, null, 2),
		);

		const result = await runResearchPhase("Use Zod", testProjectPath);

		// Prompt should include swarmmail_init (researcher workers need this)
		const instruction = result.spawn_instructions[0];
		expect(instruction.prompt).toContain("swarmmail_init");
		expect(instruction.prompt).toContain("hivemind_store");
	});
});

describe("Real-world fixture: this repo", () => {
	test("discovers tools and versions from actual repo", async () => {
		// Use the plugin package directory, not monorepo root
		const pluginDir = getPluginDir();

		// Step 1: Discover tools
		const tools = await discoverDocTools();
		expect(tools.length).toBeGreaterThan(0);

		// Step 2: Version detection for packages we know exist in the plugin
		const versions = await getInstalledVersions(pluginDir, [
			"zod",
			"@opencode-ai/plugin",
			"effect",
		]);

		// Should find at least some packages (from plugin's package.json)
		expect(versions.length).toBeGreaterThan(0);

		// Zod should be found (it's in dependencies)
		const zodVersion = versions.find((v) => v.name === "zod");
		expect(zodVersion).toBeDefined();

		// Effect should be found (it's in dependencies)
		const effectVersion = versions.find((v) => v.name === "effect");
		expect(effectVersion).toBeDefined();
	});

	test("research phase with real task on this repo", async () => {
		// Use the plugin package directory, not monorepo root
		const pluginDir = getPluginDir();
		const task =
			"Add Zod validation to swarm coordination with TypeScript types";

		// Run research phase on actual repo
		const result = await runResearchPhase(task, pluginDir);

		// Should extract tech stack
		expect(result.tech_stack).toContain("zod");
		expect(result.tech_stack).toContain("typescript");

		// Should have research result structure
		expect(result.summaries).toBeDefined();
		expect(result.memory_ids).toBeDefined();
		expect(Array.isArray(result.memory_ids)).toBe(true);

		// NEW: Should have spawn_instructions
		expect(result.spawn_instructions).toBeDefined();
		expect(Array.isArray(result.spawn_instructions)).toBe(true);
		expect(result.spawn_instructions.length).toBeGreaterThan(0);
	});
});
