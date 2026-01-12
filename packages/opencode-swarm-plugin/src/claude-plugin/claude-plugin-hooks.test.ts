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

const EXPECTED_HOOK_COMMANDS: Record<string, string> = {
  SessionStart: "swarm claude session-start",
  UserPromptSubmit: "swarm claude user-prompt",
  PreCompact: "swarm claude pre-compact",
  SessionEnd: "swarm claude session-end",
};

/**
 * Reads the Claude plugin hooks configuration from disk.
 */
function readHooksConfig(): HooksConfig {
  return JSON.parse(readFileSync(HOOKS_PATH, "utf-8")) as HooksConfig;
}

describe("claude-plugin hooks", () => {
  it("wires all expected hook commands", () => {
    const config = readHooksConfig();

    for (const [event, command] of Object.entries(EXPECTED_HOOK_COMMANDS)) {
      const groups = config.hooks[event];
      expect(groups).toBeDefined();
      expect(groups.length).toBeGreaterThan(0);

      const [group] = groups;
      expect(group.matcher).toBe("");
      expect(group.hooks).toEqual([{ type: "command", command }]);
    }
  });
});
