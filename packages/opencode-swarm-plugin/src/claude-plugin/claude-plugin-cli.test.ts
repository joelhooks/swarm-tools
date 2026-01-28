/**
 * Unit tests for Claude plugin slash command docs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

type FrontmatterResult = {
  metadata: Record<string, string>;
  body: string;
};

type CommandFixture = {
  name: string;
  file: string;
  requiredPhrases: string[];
};

// Resolve paths relative to this test file's location in the package
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const PLUGIN_ROOT = resolve(PACKAGE_ROOT, "claude-plugin");
const COMMANDS_ROOT = resolve(PLUGIN_ROOT, "commands");

const COMMAND_FIXTURES: CommandFixture[] = [
  {
    name: "swarm",
    file: "swarm.md",
    requiredPhrases: [
      "swarmmail_init",
      "swarm_decompose",
      "swarm_validate_decomposition",
      "hive_create_epic",
      "swarm_spawn_subtask",
    ],
  },
  {
    name: "hive",
    file: "hive.md",
    requiredPhrases: ["hive_ready()", "hive_query", "hive_create", "hive_update", "hive_close"],
  },
  {
    name: "inbox",
    file: "inbox.md",
    requiredPhrases: [
      "swarmmail_inbox()",
      "swarmmail_read_message",
      "swarmmail_ack",
    ],
  },
  {
    name: "status",
    file: "status.md",
    requiredPhrases: ["swarm_status", "swarmmail_inbox", "hive_query"],
  },
  {
    name: "handoff",
    file: "handoff.md",
    requiredPhrases: [
      "swarmmail_release()",
      "hive_update()",
      "hive_close()",
      "hive_sync()",
    ],
  },
];

/**
 * Reads a command markdown file from the Claude plugin directory.
 */
function readCommandFile(file: string): string {
  const commandPath = resolve(COMMANDS_ROOT, file);
  return readFileSync(commandPath, "utf-8");
}

/**
 * Parses YAML frontmatter with simple key-value pairs.
 */
function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { metadata: {}, body: content };
  }

  const metadata: Record<string, string> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const [key, ...rest] = line.split(":");
    if (!key || rest.length === 0) {
      continue;
    }
    metadata[key.trim()] = rest.join(":").trim();
  }

  const body = content.slice(match[0].length).trim();
  return { metadata, body };
}

describe("claude-plugin command docs", () => {
  it.each(COMMAND_FIXTURES)(
    "documents the /swarm:$name command",
    ({ name, file, requiredPhrases }) => {
      const content = readCommandFile(file);
      const { metadata, body } = parseFrontmatter(content);

      expect(metadata.description).toBeTruthy();

      for (const phrase of requiredPhrases) {
        expect(body).toContain(phrase);
      }
    },
  );
});
