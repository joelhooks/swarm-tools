/**
 * Unit tests for Claude plugin hook wiring.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

type HookDefinition = {
  type: "command";
  command: string;
};

type HookGroup = {
  matcher: string;
  hooks: HookDefinition[];
};

type HooksConfig = {
  hooks: Record<string, HookGroup[]>;
};

// Resolve paths relative to this test file's location in the package
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const PLUGIN_ROOT = resolve(PACKAGE_ROOT, "claude-plugin");
const HOOKS_PATH = resolve(PLUGIN_ROOT, "hooks", "hooks.json");

// Simple hooks with empty matcher (run on all events)
const EXPECTED_SIMPLE_HOOKS: Record<string, string> = {
  SessionStart: "swarm claude session-start",
  UserPromptSubmit: "swarm claude user-prompt",
  PreCompact: "swarm claude pre-compact",
  SessionEnd: "swarm claude session-end",
};

// Tool-specific hooks with matchers
const EXPECTED_TOOL_HOOKS: Record<string, { matcher: string; command: string }[]> = {
  PreToolUse: [
    { matcher: "Edit|Write", command: "swarm claude pre-edit" },
    { matcher: "swarm_complete", command: "swarm claude pre-complete" },
  ],
  PostToolUse: [
    { matcher: "swarm_complete", command: "swarm claude post-complete" },
  ],
};

/**
 * Reads the Claude plugin hooks configuration from disk.
 */
function readHooksConfig(): HooksConfig {
  return JSON.parse(readFileSync(HOOKS_PATH, "utf-8")) as HooksConfig;
}

describe("claude-plugin hooks", () => {
  it("wires all expected simple hook commands", () => {
    const config = readHooksConfig();

    for (const [event, command] of Object.entries(EXPECTED_SIMPLE_HOOKS)) {
      const groups = config.hooks[event];
      expect(groups).toBeDefined();
      expect(groups.length).toBeGreaterThan(0);

      const [group] = groups;
      expect(group.matcher).toBe("");
      expect(group.hooks).toEqual([{ type: "command", command }]);
    }
  });

  it("wires tool-specific PreToolUse hooks", () => {
    const config = readHooksConfig();
    const groups = config.hooks["PreToolUse"];

    expect(groups).toBeDefined();
    expect(groups.length).toBe(2);

    // Edit|Write hook
    const editHook = groups.find(g => g.matcher === "Edit|Write");
    expect(editHook).toBeDefined();
    expect(editHook!.hooks).toEqual([{ type: "command", command: "swarm claude pre-edit" }]);

    // swarm_complete hook
    const completeHook = groups.find(g => g.matcher === "swarm_complete");
    expect(completeHook).toBeDefined();
    expect(completeHook!.hooks).toEqual([{ type: "command", command: "swarm claude pre-complete" }]);
  });

  it("wires tool-specific PostToolUse hooks for tracking and completion", () => {
    const config = readHooksConfig();
    const groups = config.hooks["PostToolUse"];

    expect(groups).toBeDefined();
    expect(groups.length).toBe(5); // hivemind_find, skills_use, swarmmail_init, hivemind_store, swarm_complete

    // Check tracking hooks exist
    const trackingTools = ["hivemind_find", "skills_use", "swarmmail_init", "hivemind_store"];
    for (const tool of trackingTools) {
      const trackingHook = groups.find(g => g.matcher.includes(tool));
      expect(trackingHook).toBeDefined();
      expect(trackingHook!.hooks[0].command).toContain("track-tool");
    }

    // Check swarm_complete hook
    const completeHook = groups.find(g => g.matcher === "swarm_complete");
    expect(completeHook).toBeDefined();
    expect(completeHook!.hooks).toEqual([{ type: "command", command: "swarm claude post-complete" }]);
  });
});
