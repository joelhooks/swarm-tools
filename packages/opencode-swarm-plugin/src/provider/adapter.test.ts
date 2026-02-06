/**
 * Provider Adapter Tests
 * 
 * Tests für Provider-Adapter mit Fokus auf:
 * - getAgentDefinition() mit verschiedenen Providers
 * - loadSwarmConfig() mit Fehlerfällen
 * - Edge Cases (malformed JSON, kein Frontmatter, etc.)
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getAgentDefinition, loadSwarmConfig, type ProviderConfig } from "./adapter";

describe("Provider Adapter", () => {
  let testDir: string;
  
  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-provider-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });
  
  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  const mockOpencodeConfig: ProviderConfig = { provider: "opencode" };
  const mockManualConfig: ProviderConfig = { provider: "manual" };
  
  describe("getAgentDefinition", () => {
    test("removes model field when provider is opencode", () => {
      const agent = `---
name: test-agent
model: anthropic/claude-sonnet-4-5
---

Content
`;
      
      const result = getAgentDefinition(agent, mockOpencodeConfig);
      
      expect(result).not.toContain("model:");
      expect(result).toContain("name: test-agent");
      expect(result).toContain("Content");
    });

    test("keeps model field when provider is manual", () => {
      const agent = `---
name: test-agent
model: anthropic/claude-sonnet-4-5
---

Content
`;
      
      const result = getAgentDefinition(agent, mockManualConfig);
      
      expect(result).toBe(agent);
    });

    test("handles agent without model field gracefully (opencode)", () => {
      const agent = `---
name: test-agent
---

Content
`;
      
      const result = getAgentDefinition(agent, mockOpencodeConfig);
      
      expect(result).toBe(agent);
    });

    test("handles agent without model field gracefully (manual)", () => {
      const agent = `---
name: test-agent
---

Content
`;
      
      const result = getAgentDefinition(agent, mockManualConfig);
      
      expect(result).toBe(agent);
    });

    test("removes model field with whitespace variations", () => {
      const agent = `---
name: test-agent
model:   anthropic/claude-sonnet-4-5
---

Content
`;
      
      const result = getAgentDefinition(agent, mockOpencodeConfig);
      
      expect(result).not.toContain("model:");
    });

    test("preserves other fields when removing model", () => {
      const agent = `---
name: test-agent
model: anthropic/claude-sonnet-4-5
description: Test agent
skills: [test]
---

Content
`;
      
      const result = getAgentDefinition(agent, mockOpencodeConfig);
      
      expect(result).toContain("name: test-agent");
      expect(result).toContain("description: Test agent");
      expect(result).toContain("skills: [test]");
      expect(result).not.toContain("model:");
    });

    test("handles YAML with multiple frontmatter keys", () => {
      const agent = `---
name: test-agent
description: A test
model: anthropic/claude-sonnet-4-5
skills: [skill1, skill2]
---

Content
`;
      
      const result = getAgentDefinition(agent, mockOpencodeConfig);
      
      expect(result).not.toContain("model:");
      expect(result).toContain("name: test-agent");
      expect(result).toContain("description: A test");
      expect(result).toContain("skills: [skill1, skill2]");
    });

    test("handles agent with no frontmatter", () => {
      const agent = "Just content, no frontmatter";
      
      const result = getAgentDefinition(agent, mockOpencodeConfig);
      
      expect(result).toBe(agent);
    });

    test("handles multiple model lines (should remove all)", () => {
      const agent = `---
name: test-agent
model: anthropic/claude-sonnet-4-5
description: Test
model: anthropic/claude-haiku-4-5
---

Content
`;
      
      const result = getAgentDefinition(agent, mockOpencodeConfig);
      
      expect(result).not.toContain("model:");
    });
  });

  describe("loadSwarmConfig", () => {
    test("returns null when config file missing", () => {
      const result = loadSwarmConfig("/nonexistent/path");
      
      expect(result).toBeNull();
    });

    test("returns config when file exists and valid", () => {
      const configPath = join(testDir, ".opencode");
      mkdirSync(configPath, { recursive: true });
      
      const configContent = JSON.stringify({ provider: "opencode" });
      writeFileSync(join(configPath, "swarm-config.json"), configContent, "utf-8");
      
      const result = loadSwarmConfig(testDir);
      
      expect(result).toEqual({ provider: "opencode" });
    });

    test("returns config for manual provider", () => {
      const configPath = join(testDir, ".opencode");
      mkdirSync(configPath, { recursive: true });
      
      const configContent = JSON.stringify({ provider: "manual" });
      writeFileSync(join(configPath, "swarm-config.json"), configContent, "utf-8");
      
      const result = loadSwarmConfig(testDir);
      
      expect(result).toEqual({ provider: "manual" });
    });

    test("returns null for invalid provider", () => {
      const configPath = join(testDir, ".opencode");
      mkdirSync(configPath, { recursive: true });
      
      const configContent = JSON.stringify({ provider: "invalid-provider" });
      writeFileSync(join(configPath, "swarm-config.json"), configContent, "utf-8");
      
      const result = loadSwarmConfig(testDir);
      
      expect(result).toBeNull();
    });

    test("returns null for malformed JSON", () => {
      const configPath = join(testDir, ".opencode");
      mkdirSync(configPath, { recursive: true });
      
      const configContent = "{ invalid json";
      writeFileSync(join(configPath, "swarm-config.json"), configContent, "utf-8");
      
      // loadSwarmConfig should catch error and return null
      const result = loadSwarmConfig(testDir);
      
      expect(result).toBeNull();
    });

    test("returns null for empty config", () => {
      const configPath = join(testDir, ".opencode");
      mkdirSync(configPath, { recursive: true });
      
      const configContent = "{}";
      writeFileSync(join(configPath, "swarm-config.json"), configContent, "utf-8");
      
      const result = loadSwarmConfig(testDir);
      
      expect(result).toBeNull();
    });

    test("returns null when provider field is missing", () => {
      const configPath = join(testDir, ".opencode");
      mkdirSync(configPath, { recursive: true });
      
      const configContent = JSON.stringify({ otherField: "value" });
      writeFileSync(join(configPath, "swarm-config.json"), configContent, "utf-8");
      
      const result = loadSwarmConfig(testDir);
      
      expect(result).toBeNull();
    });
  });
});
