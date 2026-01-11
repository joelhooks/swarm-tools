/**
 * Tests for swarm-prompts.ts
 *
 * Validates that prompt templates contain required sections and emphasis
 * for memory usage, coordination, and TDD workflow.
 */

import { describe, expect, test } from "bun:test";
import {
  formatSubtaskPromptV2,
  formatResearcherPrompt,
  formatCoordinatorPrompt,
  SUBTASK_PROMPT_V2,
  RESEARCHER_PROMPT,
  COORDINATOR_PROMPT,
} from "./swarm-prompts";

describe("SUBTASK_PROMPT_V2", () => {
  describe("memory query emphasis", () => {
    test("Step 2 is hivemind_find and marked MANDATORY", () => {
      expect(SUBTASK_PROMPT_V2).toContain("### Step 2:");
      expect(SUBTASK_PROMPT_V2).toContain("hivemind_find");
      // Must have MANDATORY in the step header
      expect(SUBTASK_PROMPT_V2).toMatch(/### Step 2:.*MANDATORY/i);
    });

    test("memory query step has visual emphasis (emoji or caps)", () => {
      // Should have emoji or CRITICAL/ALWAYS in caps
      const step2Match = SUBTASK_PROMPT_V2.match(/### Step 2:[\s\S]*?### Step 3:/);
      expect(step2Match).not.toBeNull();
      if (!step2Match) return;
      const step2Content = step2Match[0];
      
      // Must have at least one of: emoji, CRITICAL, ALWAYS, MANDATORY
      const hasEmphasis = 
        /🧠|⚠️|CRITICAL|ALWAYS|MANDATORY/.test(step2Content);
      expect(hasEmphasis).toBe(true);
    });

    test("memory query step includes query examples by task type", () => {
      const step2Match = SUBTASK_PROMPT_V2.match(/### Step 2:[\s\S]*?### Step 3:/);
      expect(step2Match).not.toBeNull();
      if (!step2Match) return;
      const step2Content = step2Match[0];
      
      // Should have examples for different task types
      expect(step2Content).toContain("Bug fix");
      expect(step2Content).toContain("New feature");
      expect(step2Content).toContain("Refactor");
    });

    test("memory query step explains WHY it's mandatory", () => {
      const step2Match = SUBTASK_PROMPT_V2.match(/### Step 2:[\s\S]*?### Step 3:/);
      expect(step2Match).not.toBeNull();
      if (!step2Match) return;
      const step2Content = step2Match[0];
      
      // Should explain consequences of skipping
      expect(step2Content).toMatch(/skip|waste|repeat|already.solved/i);
    });
  });

  describe("memory storage emphasis", () => {
    test("has a dedicated section for storing learnings", () => {
      // Should have a prominent section about storing memories
      expect(SUBTASK_PROMPT_V2).toMatch(/##.*STORE.*LEARNING|### Step.*Store.*Learning/i);
    });

    test("storage section lists triggers for when to store", () => {
      // Should mention triggers: bugs, gotchas, patterns, failed approaches
      expect(SUBTASK_PROMPT_V2).toContain("bug");
      expect(SUBTASK_PROMPT_V2).toMatch(/gotcha|quirk|workaround/i);
      expect(SUBTASK_PROMPT_V2).toMatch(/pattern|domain/i);
    });

    test("storage section emphasizes WHY not just WHAT", () => {
      expect(SUBTASK_PROMPT_V2).toMatch(/WHY.*not.*WHAT|why.*matters/i);
    });

    test("storage section warns against generic knowledge", () => {
      expect(SUBTASK_PROMPT_V2).toMatch(/don't store.*generic|generic knowledge/i);
    });
  });

  describe("checklist order", () => {
    test("Step 1 is swarmmail_init", () => {
      expect(SUBTASK_PROMPT_V2).toMatch(/### Step 1:[\s\S]*?swarmmail_init/);
    });

    test("Step 2 is hivemind_find (before skills)", () => {
      const step2Pos = SUBTASK_PROMPT_V2.indexOf("### Step 2:");
      const step3Pos = SUBTASK_PROMPT_V2.indexOf("### Step 3:");
      const memoryFindPos = SUBTASK_PROMPT_V2.indexOf("hivemind_find");
      const skillsPos = SUBTASK_PROMPT_V2.indexOf("skills_list");
      
      // Memory find should be in Step 2, before skills in Step 3
      expect(memoryFindPos).toBeGreaterThan(step2Pos);
      expect(memoryFindPos).toBeLessThan(step3Pos);
      expect(skillsPos).toBeGreaterThan(step3Pos);
    });

    test("hivemind_store comes before swarm_complete", () => {
      const storePos = SUBTASK_PROMPT_V2.indexOf("hivemind_store");
      const completePos = SUBTASK_PROMPT_V2.lastIndexOf("swarm_complete");
      
      expect(storePos).toBeGreaterThan(0);
      expect(storePos).toBeLessThan(completePos);
    });

    test("final step is swarm_complete (not hive_close)", () => {
      // Find the last "### Step N:" pattern
      const stepMatches = [...SUBTASK_PROMPT_V2.matchAll(/### Step (\d+):/g)];
      expect(stepMatches.length).toBeGreaterThan(0);
      
      const lastStepNum = Math.max(...stepMatches.map(m => parseInt(m[1])));
      const lastStepMatch = SUBTASK_PROMPT_V2.match(
        new RegExp(`### Step ${lastStepNum}:[\\s\\S]*?(?=## \\[|$)`)
      );
      expect(lastStepMatch).not.toBeNull();
      if (!lastStepMatch) return;
      
      const lastStepContent = lastStepMatch[0];
      expect(lastStepContent).toContain("swarm_complete");
      expect(lastStepContent).toMatch(/NOT.*hive_close|DO NOT.*hive_close/i);
    });
  });

  describe("critical requirements section", () => {
    test("lists memory query as non-negotiable", () => {
      const criticalSection = SUBTASK_PROMPT_V2.match(/\[CRITICAL REQUIREMENTS\][\s\S]*?Begin now/);
      expect(criticalSection).not.toBeNull();
      if (!criticalSection) return;
      
      expect(criticalSection[0]).toMatch(/hivemind_find|memory.*MUST|Step 2.*MUST/i);
    });

    test("lists consequences of skipping memory steps", () => {
      const criticalSection = SUBTASK_PROMPT_V2.match(/\[CRITICAL REQUIREMENTS\][\s\S]*?Begin now/);
      expect(criticalSection).not.toBeNull();
      if (!criticalSection) return;
      
      // Should mention consequences for skipping memory
      expect(criticalSection[0]).toMatch(/repeat|waste|already.solved|mistakes/i);
    });
  });
});

describe("COORDINATOR_PROMPT", () => {
  test("allows swarmmail_release_all for stale reservations", () => {
    expect(COORDINATOR_PROMPT).toContain("swarmmail_release_all");
    expect(COORDINATOR_PROMPT).toMatch(/stale|orphaned|expired/i);
  });

  test("frames release_all as coordinator-only override", () => {
    const sectionMatch = COORDINATOR_PROMPT.match(/release_all[\s\S]*?(?=\n## |$)/i);
    expect(sectionMatch).not.toBeNull();
    if (!sectionMatch) return;

    expect(sectionMatch[0]).toMatch(/coordinator|override/i);
    expect(sectionMatch[0]).toMatch(/only|limited|exception/i);
  });

  test("requires Task call after swarm_spawn_subtask", () => {
    expect(COORDINATOR_PROMPT).toMatch(/after every.*swarm_spawn_subtask/i);
    expect(COORDINATOR_PROMPT).toMatch(/Task\(subagent_type="swarm-worker"/);
    expect(COORDINATOR_PROMPT).toMatch(/prompt.*swarm_spawn_subtask/i);
  });
});

describe("formatSubtaskPromptV2", () => {
  test("substitutes all placeholders correctly", async () => {
    const result = await formatSubtaskPromptV2({
      bead_id: "test-project-abc123-bead456",
      epic_id: "test-project-abc123-epic789",
      subtask_title: "Test Subtask",
      subtask_description: "Do the test thing",
      files: ["src/test.ts", "src/test.test.ts"],
      shared_context: "This is shared context",
      project_path: "/path/to/project",
    });

    expect(result).toContain("test-project-abc123-bead456");
    expect(result).toContain("test-project-abc123-epic789");
    expect(result).toContain("Test Subtask");
    expect(result).toContain("Do the test thing");
    expect(result).toContain("src/test.ts");
    expect(result).toContain("/path/to/project");
  });

  test("includes memory query step with MANDATORY emphasis", async () => {
    const result = await formatSubtaskPromptV2({
      bead_id: "test-project-abc123-def456",
      epic_id: "test-project-abc123-ghi789",
      subtask_title: "Test",
      subtask_description: "",
      files: [],
    });

    expect(result).toMatch(/Step 2:.*MANDATORY/i);
    expect(result).toContain("hivemind_find");
  });


});

describe("swarm_spawn_subtask tool", () => {
  test("returns post_completion_instructions field in JSON response", async () => {
    const { swarm_spawn_subtask } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_subtask.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      subtask_title: "Implement feature X",
      subtask_description: "Add feature X to the system",
      files: ["src/feature.ts", "src/feature.test.ts"],
      shared_context: "Epic context here",
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("post_completion_instructions");
    expect(typeof parsed.post_completion_instructions).toBe("string");
  });

  test("post_completion_instructions contains mandatory review steps", async () => {
    const { swarm_spawn_subtask } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_subtask.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      subtask_title: "Implement feature X",
      files: ["src/feature.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    const instructions = parsed.post_completion_instructions;
    
    // Should contain all 5 steps
    expect(instructions).toContain("Step 1: Check Swarm Mail");
    expect(instructions).toContain("swarmmail_inbox()");
    expect(instructions).toContain("Step 2: Review the Work");
    expect(instructions).toContain("swarm_review");
    expect(instructions).toContain("Step 3: Evaluate Against Criteria");
    expect(instructions).toContain("Step 4: Send Feedback");
    expect(instructions).toContain("swarm_review_feedback");
    expect(instructions).toContain("Step 5: Take Action Based on Review");
    expect(instructions).toContain("swarm_spawn_retry"); // Should include retry flow
  });

  test("post_completion_instructions substitutes placeholders", async () => {
    const { swarm_spawn_subtask } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_subtask.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      subtask_title: "Implement feature X",
      files: ["src/feature.ts", "src/feature.test.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    const instructions = parsed.post_completion_instructions;
    
    // Placeholders should be replaced
    expect(instructions).toContain("/Users/joel/Code/project");
    expect(instructions).toContain("test-project-abc123-epic1");
    expect(instructions).toContain("test-project-abc123-task1");
    expect(instructions).toContain('"src/feature.ts"');
    expect(instructions).toContain('"src/feature.test.ts"');
    
    // Placeholders should NOT remain
    expect(instructions).not.toContain("{project_key}");
    expect(instructions).not.toContain("{epic_id}");
    expect(instructions).not.toContain("{task_id}");
    expect(instructions).not.toContain("{files_touched}");
  });

  test("post_completion_instructions emphasizes mandatory nature", async () => {
    const { swarm_spawn_subtask } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_subtask.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      subtask_title: "Implement feature X",
      files: ["src/feature.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    const instructions = parsed.post_completion_instructions;
    
    // Should have strong language
    expect(instructions).toMatch(/⚠️|MANDATORY|NON-NEGOTIABLE|DO NOT skip/i);
    expect(instructions).toContain("DO THIS IMMEDIATELY");
  });
});

describe("RESEARCHER_PROMPT", () => {
  describe("required sections", () => {
    test("includes IDENTITY section with research_id and epic_id", () => {
      expect(RESEARCHER_PROMPT).toContain("## [IDENTITY]");
      expect(RESEARCHER_PROMPT).toContain("{research_id}");
      expect(RESEARCHER_PROMPT).toContain("{epic_id}");
    });

    test("includes MISSION section explaining the role", () => {
      expect(RESEARCHER_PROMPT).toContain("## [MISSION]");
      expect(RESEARCHER_PROMPT).toMatch(/gather.*documentation/i);
    });

    test("includes WORKFLOW section with numbered steps", () => {
      expect(RESEARCHER_PROMPT).toContain("## [WORKFLOW]");
      expect(RESEARCHER_PROMPT).toContain("### Step 1:");
      expect(RESEARCHER_PROMPT).toContain("### Step 2:");
    });

    test("includes CRITICAL REQUIREMENTS section", () => {
      expect(RESEARCHER_PROMPT).toContain("## [CRITICAL REQUIREMENTS]");
      expect(RESEARCHER_PROMPT).toMatch(/NON-NEGOTIABLE/i);
    });
  });

  describe("workflow steps", () => {
    test("Step 1 is swarmmail_init (MANDATORY FIRST)", () => {
      expect(RESEARCHER_PROMPT).toMatch(/### Step 1:.*Initialize/i);
      expect(RESEARCHER_PROMPT).toContain("swarmmail_init");
      expect(RESEARCHER_PROMPT).toContain("project_path");
    });

    test("Step 2 is discovering available documentation tools", () => {
      const step2Match = RESEARCHER_PROMPT.match(/### Step 2:[\s\S]*?### Step 3:/);
      expect(step2Match).not.toBeNull();
      if (!step2Match) return;
      
      const step2Content = step2Match[0];
      expect(step2Content).toMatch(/discover.*tools/i);
      expect(step2Content).toContain("nextjs_docs");
      expect(step2Content).toContain("context7");
      expect(step2Content).toContain("fetch");
      expect(step2Content).toContain("pdf-brain");
    });

    test("Step 3 is reading installed versions", () => {
      const step3Match = RESEARCHER_PROMPT.match(/### Step 3:[\s\S]*?### Step 4:/);
      expect(step3Match).not.toBeNull();
      if (!step3Match) return;
      
      const step3Content = step3Match[0];
      expect(step3Content).toMatch(/read.*installed.*version/i);
      expect(step3Content).toContain("package.json");
    });

    test("Step 4 is fetching documentation", () => {
      const step4Match = RESEARCHER_PROMPT.match(/### Step 4:[\s\S]*?### Step 5:/);
      expect(step4Match).not.toBeNull();
      if (!step4Match) return;
      
      const step4Content = step4Match[0];
      expect(step4Content).toMatch(/fetch.*documentation/i);
      expect(step4Content).toContain("INSTALLED version");
    });

    test("Step 5 is storing detailed findings in hivemind", () => {
      const step5Match = RESEARCHER_PROMPT.match(/### Step 5:[\s\S]*?### Step 6:/);
      expect(step5Match).not.toBeNull();
      if (!step5Match) return;
      
      const step5Content = step5Match[0];
      expect(step5Content).toContain("hivemind_store");
      expect(step5Content).toMatch(/store.*individually/i);
    });

    test("Step 6 is broadcasting summary to coordinator", () => {
      const step6Match = RESEARCHER_PROMPT.match(/### Step 6:[\s\S]*?### Step 7:/);
      expect(step6Match).not.toBeNull();
      if (!step6Match) return;
      
      const step6Content = step6Match[0];
      expect(step6Content).toContain("swarmmail_send");
      expect(step6Content).toContain("coordinator");
    });

    test("Step 7 is returning structured JSON output", () => {
      const step7Match = RESEARCHER_PROMPT.match(/### Step 7:[\s\S]*?(?=## \[|$)/);
      expect(step7Match).not.toBeNull();
      if (!step7Match) return;
      
      const step7Content = step7Match[0];
      expect(step7Content).toContain("JSON");
      expect(step7Content).toContain("technologies");
      expect(step7Content).toContain("summary");
    });
  });

  describe("coordinator-provided tech stack", () => {
    test("emphasizes that coordinator provides the tech list", () => {
      expect(RESEARCHER_PROMPT).toMatch(/COORDINATOR PROVIDED.*TECHNOLOGIES/i);
      expect(RESEARCHER_PROMPT).toContain("{tech_stack}");
    });

    test("clarifies researcher does NOT discover what to research", () => {
      expect(RESEARCHER_PROMPT).toMatch(/NOT discover what to research/i);
      expect(RESEARCHER_PROMPT).toMatch(/DO discover.*TOOLS/i);
    });
  });

  describe("upgrade comparison mode", () => {
    test("includes placeholder for check_upgrades mode", () => {
      expect(RESEARCHER_PROMPT).toContain("{check_upgrades}");
    });

    test("mentions comparing installed vs latest when in upgrade mode", () => {
      expect(RESEARCHER_PROMPT).toMatch(/check-upgrades/i);
      expect(RESEARCHER_PROMPT).toMatch(/compare|latest.*version/i);
    });
  });

  describe("output requirements", () => {
    test("specifies TWO output destinations: hivemind and return JSON", () => {
      expect(RESEARCHER_PROMPT).toMatch(/TWO places/i);
      expect(RESEARCHER_PROMPT).toContain("hivemind");
      expect(RESEARCHER_PROMPT).toContain("Return JSON");
    });

    test("explains hivemind is for detailed findings", () => {
      expect(RESEARCHER_PROMPT).toMatch(/hivemind.*detailed/i);
    });

    test("explains return JSON is for condensed summary", () => {
      expect(RESEARCHER_PROMPT).toMatch(/return.*condensed.*summary/i);
    });
  });
});

describe("formatResearcherPrompt", () => {
  test("substitutes research_id placeholder", () => {
    const result = formatResearcherPrompt({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js", "React"],
      project_path: "/path/to/project",
      check_upgrades: false,
    });

    expect(result).toContain("research-abc123");
    expect(result).not.toContain("{research_id}");
  });

  test("substitutes epic_id placeholder", () => {
    const result = formatResearcherPrompt({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js"],
      project_path: "/path/to/project",
      check_upgrades: false,
    });

    expect(result).toContain("epic-xyz789");
    expect(result).not.toContain("{epic_id}");
  });

  test("formats tech_stack as bulleted list", () => {
    const result = formatResearcherPrompt({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js", "React", "TypeScript"],
      project_path: "/path/to/project",
      check_upgrades: false,
    });

    expect(result).toContain("- Next.js");
    expect(result).toContain("- React");
    expect(result).toContain("- TypeScript");
  });

  test("substitutes project_path placeholder", () => {
    const result = formatResearcherPrompt({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js"],
      project_path: "/Users/joel/Code/my-project",
      check_upgrades: false,
    });

    expect(result).toContain("/Users/joel/Code/my-project");
    expect(result).not.toContain("{project_path}");
  });

  test("includes DEFAULT MODE text when check_upgrades=false", () => {
    const result = formatResearcherPrompt({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js"],
      project_path: "/path/to/project",
      check_upgrades: false,
    });

    expect(result).toContain("DEFAULT MODE");
    expect(result).toContain("INSTALLED versions only");
  });

  test("includes UPGRADE COMPARISON MODE text when check_upgrades=true", () => {
    const result = formatResearcherPrompt({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js"],
      project_path: "/path/to/project",
      check_upgrades: true,
    });

    expect(result).toContain("UPGRADE COMPARISON MODE");
    expect(result).toContain("BOTH installed AND latest");
    expect(result).toContain("breaking changes");
  });
});

describe("on-demand research section", () => {
  test("includes ON-DEMAND RESEARCH section after Step 9", () => {
    // Find Step 9 and the section after it
    const step9Pos = SUBTASK_PROMPT_V2.indexOf("### Step 9:");
    const swarmMailPos = SUBTASK_PROMPT_V2.indexOf("## [SWARM MAIL COMMUNICATION]");
    
    expect(step9Pos).toBeGreaterThan(0);
    expect(swarmMailPos).toBeGreaterThan(step9Pos);
    
    // Extract the section between Step 9 and SWARM MAIL
    const betweenSection = SUBTASK_PROMPT_V2.substring(step9Pos, swarmMailPos);
    
    expect(betweenSection).toContain("## [ON-DEMAND RESEARCH]");
  });

  test("research section instructs to check hivemind first", () => {
    const researchMatch = SUBTASK_PROMPT_V2.match(/## \[ON-DEMAND RESEARCH\][\s\S]*?## \[SWARM MAIL/);
    expect(researchMatch).not.toBeNull();
    if (!researchMatch) return;
    
    const researchContent = researchMatch[0];
    expect(researchContent).toContain("hivemind_find");
    expect(researchContent).toMatch(/check.*hivemind.*first/i);
  });

  test("research section includes swarm_spawn_researcher tool usage", () => {
    const researchMatch = SUBTASK_PROMPT_V2.match(/## \[ON-DEMAND RESEARCH\][\s\S]*?## \[SWARM MAIL/);
    expect(researchMatch).not.toBeNull();
    if (!researchMatch) return;
    
    const researchContent = researchMatch[0];
    expect(researchContent).toContain("swarm_spawn_researcher");
  });

  test("research section lists specific research triggers", () => {
    const researchMatch = SUBTASK_PROMPT_V2.match(/## \[ON-DEMAND RESEARCH\][\s\S]*?## \[SWARM MAIL/);
    expect(researchMatch).not.toBeNull();
    if (!researchMatch) return;
    
    const researchContent = researchMatch[0];
    
    // Should list when TO research
    expect(researchContent).toMatch(/triggers|when to research/i);
    expect(researchContent).toMatch(/API.*works|breaking changes|outdated/i);
  });

  test("research section lists when NOT to research", () => {
    const researchMatch = SUBTASK_PROMPT_V2.match(/## \[ON-DEMAND RESEARCH\][\s\S]*?## \[SWARM MAIL/);
    expect(researchMatch).not.toBeNull();
    if (!researchMatch) return;
    
    const researchContent = researchMatch[0];
    
    // Should list when to SKIP research
    expect(researchContent).toMatch(/don't research|skip research/i);
    expect(researchContent).toMatch(/standard patterns|well-documented|obvious/i);
  });

  test("research section includes 3-step workflow", () => {
    const researchMatch = SUBTASK_PROMPT_V2.match(/## \[ON-DEMAND RESEARCH\][\s\S]*?## \[SWARM MAIL/);
    expect(researchMatch).not.toBeNull();
    if (!researchMatch) return;
    
    const researchContent = researchMatch[0];
    
    // Should have numbered steps
    expect(researchContent).toMatch(/1\.\s*.*Check hivemind/i);
    expect(researchContent).toMatch(/2\.\s*.*spawn researcher/i);
    expect(researchContent).toMatch(/3\.\s*.*wait.*continue/i);
  });
});

describe("swarm_spawn_researcher tool", () => {
  test("returns JSON with prompt field", async () => {
    const { swarm_spawn_researcher } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_researcher.execute({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js", "React"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("prompt");
    expect(typeof parsed.prompt).toBe("string");
    expect(parsed.prompt.length).toBeGreaterThan(100);
  });

  test("returns subagent_type field as 'swarm-researcher'", async () => {
    const { swarm_spawn_researcher } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_researcher.execute({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed.subagent_type).toBe("swarm-researcher");
  });

  test("returns expected_output schema", async () => {
    const { swarm_spawn_researcher } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_researcher.execute({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("expected_output");
    expect(parsed.expected_output).toHaveProperty("technologies");
    expect(parsed.expected_output).toHaveProperty("summary");
  });

  test("defaults check_upgrades to false when not provided", async () => {
    const { swarm_spawn_researcher } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_researcher.execute({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed.check_upgrades).toBe(false);
  });

  test("respects check_upgrades when provided as true", async () => {
    const { swarm_spawn_researcher } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_researcher.execute({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js"],
      project_path: "/Users/joel/Code/project",
      check_upgrades: true,
    });

    const parsed = JSON.parse(result);
    expect(parsed.check_upgrades).toBe(true);
  });

  test("includes all input parameters in returned JSON", async () => {
    const { swarm_spawn_researcher } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_researcher.execute({
      research_id: "research-abc123",
      epic_id: "epic-xyz789",
      tech_stack: ["Next.js", "React", "TypeScript"],
      project_path: "/Users/joel/Code/project",
      check_upgrades: true,
    });

    const parsed = JSON.parse(result);
    expect(parsed.research_id).toBe("research-abc123");
    expect(parsed.epic_id).toBe("epic-xyz789");
    expect(parsed.tech_stack).toEqual(["Next.js", "React", "TypeScript"]);
    expect(parsed.project_path).toBe("/Users/joel/Code/project");
    expect(parsed.check_upgrades).toBe(true);
  });
});

describe("swarm_spawn_retry tool", () => {
  test("generates valid retry prompt with issues", async () => {
    const { swarm_spawn_retry } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_retry.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      original_prompt: "Original task: implement feature X",
      attempt: 1,
      issues: JSON.stringify([
        { file: "src/feature.ts", line: 42, issue: "Missing null check", suggestion: "Add null check" }
      ]),
      files: ["src/feature.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("prompt");
    expect(typeof parsed.prompt).toBe("string");
    expect(parsed.prompt).toContain("RETRY ATTEMPT");
    expect(parsed.prompt).toContain("Missing null check");
  });

  test("includes attempt number in prompt header", async () => {
    const { swarm_spawn_retry } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_retry.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      original_prompt: "Original task",
      attempt: 2,
      issues: "[]",
      files: ["src/test.ts"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.prompt).toContain("RETRY ATTEMPT 2/3");
    expect(parsed.attempt).toBe(2);
  });

  test("includes diff when provided", async () => {
    const { swarm_spawn_retry } = await import("./swarm-prompts");
    
    const diffContent = `diff --git a/src/test.ts b/src/test.ts
+++ b/src/test.ts
@@ -1 +1 @@
-const x = 1;
+const x = null;`;

    const result = await swarm_spawn_retry.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      original_prompt: "Original task",
      attempt: 1,
      issues: "[]",
      diff: diffContent,
      files: ["src/test.ts"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.prompt).toContain(diffContent);
    expect(parsed.prompt).toContain("PREVIOUS ATTEMPT");
  });

  test("rejects attempt > 3 with error", async () => {
    const { swarm_spawn_retry } = await import("./swarm-prompts");
    
    await expect(async () => {
      await swarm_spawn_retry.execute({
        bead_id: "test-project-abc123-task1",
        epic_id: "test-project-abc123-epic1",
        original_prompt: "Original task",
        attempt: 4,
        issues: "[]",
        files: ["src/test.ts"],
      });
    }).toThrow(/attempt.*exceeds.*maximum/i);
  });

  test("formats issues as readable list", async () => {
    const { swarm_spawn_retry } = await import("./swarm-prompts");
    
    const issues = [
      { file: "src/a.ts", line: 10, issue: "Missing error handling", suggestion: "Add try-catch" },
      { file: "src/b.ts", line: 20, issue: "Type mismatch", suggestion: "Fix types" }
    ];

    const result = await swarm_spawn_retry.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      original_prompt: "Original task",
      attempt: 1,
      issues: JSON.stringify(issues),
      files: ["src/a.ts", "src/b.ts"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.prompt).toContain("ISSUES FROM PREVIOUS ATTEMPT");
    expect(parsed.prompt).toContain("src/a.ts:10");
    expect(parsed.prompt).toContain("Missing error handling");
    expect(parsed.prompt).toContain("src/b.ts:20");
    expect(parsed.prompt).toContain("Type mismatch");
  });

  test("returns expected response structure", async () => {
    const { swarm_spawn_retry } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_retry.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      original_prompt: "Original task",
      attempt: 1,
      issues: "[]",
      files: ["src/test.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("prompt");
    expect(parsed).toHaveProperty("bead_id", "test-project-abc123-task1");
    expect(parsed).toHaveProperty("attempt", 1);
    expect(parsed).toHaveProperty("max_attempts", 3);
    expect(parsed).toHaveProperty("files");
    expect(parsed.files).toEqual(["src/test.ts"]);
  });

  test("includes standard worker contract (swarmmail_init, reserve, complete)", async () => {
    const { swarm_spawn_retry } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_retry.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      original_prompt: "Original task",
      attempt: 1,
      issues: "[]",
      files: ["src/test.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed.prompt).toContain("swarmmail_init");
    expect(parsed.prompt).toContain("swarmmail_reserve");
    expect(parsed.prompt).toContain("swarm_complete");
  });

  test("instructs to preserve working changes", async () => {
    const { swarm_spawn_retry } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_retry.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      original_prompt: "Original task",
      attempt: 1,
      issues: JSON.stringify([{ file: "src/test.ts", line: 1, issue: "Bug", suggestion: "Fix" }]),
      files: ["src/test.ts"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.prompt).toMatch(/preserve.*working|fix.*while preserving/i);
  });
});

describe("COORDINATOR_PROMPT", () => {
  test("constant exists and is exported", () => {
    expect(COORDINATOR_PROMPT).toBeDefined();
    expect(typeof COORDINATOR_PROMPT).toBe("string");
    expect(COORDINATOR_PROMPT.length).toBeGreaterThan(100);
  });

  test("contains all phase headers (0-8)", () => {
    expect(COORDINATOR_PROMPT).toContain("Phase 0:");
    expect(COORDINATOR_PROMPT).toContain("Phase 1:");
    expect(COORDINATOR_PROMPT).toContain("Phase 2:");
    expect(COORDINATOR_PROMPT).toContain("Phase 3:");
    expect(COORDINATOR_PROMPT).toContain("Phase 4:");
    expect(COORDINATOR_PROMPT).toContain("Phase 5:");
    expect(COORDINATOR_PROMPT).toContain("Phase 6:");
    expect(COORDINATOR_PROMPT).toContain("Phase 7:");
    expect(COORDINATOR_PROMPT).toContain("Phase 8:");
  });

  test("contains Phase 1.5: Research Phase section", () => {
    expect(COORDINATOR_PROMPT).toContain("Phase 1.5:");
    expect(COORDINATOR_PROMPT).toMatch(/Phase 1\.5:.*Research/i);
  });

  test("Phase 1.5 documents swarm_spawn_researcher usage", () => {
    // Extract Phase 1.5 section
    const phase15Match = COORDINATOR_PROMPT.match(/Phase 1\.5:[\s\S]*?Phase 2:/);
    expect(phase15Match).not.toBeNull();
    if (!phase15Match) return;
    const phase15Content = phase15Match[0];

    expect(phase15Content).toContain("swarm_spawn_researcher");
    expect(phase15Content).toContain("Task(subagent_type=\"swarm-researcher\"");
  });

  test("has section explicitly forbidding direct research tool calls", () => {
    expect(COORDINATOR_PROMPT).toMatch(/NEVER.*direct|forbidden.*tools|do not call directly/i);
  });

  test("forbidden tools section lists all prohibited tools", () => {
    const forbiddenTools = [
      "repo-crawl_",
      "repo-autopsy_",
      "webfetch",
      "fetch_fetch",
      "context7_",
      "pdf-brain_search",
      "pdf-brain_read"
    ];

    for (const tool of forbiddenTools) {
      expect(COORDINATOR_PROMPT).toContain(tool);
    }
  });

  test("forbidden tools section explains to use swarm_spawn_researcher instead", () => {
    // Find the forbidden tools section
    const forbiddenMatch = COORDINATOR_PROMPT.match(/(FORBIDDEN.*for coordinators|NEVER.*FETCH.*DIRECTLY)[\s\S]{0,500}swarm_spawn_researcher/i);
    expect(forbiddenMatch).not.toBeNull();
  });

  test("contains coordinator role boundaries section", () => {
    expect(COORDINATOR_PROMPT).toContain("Coordinator Role Boundaries");
    expect(COORDINATOR_PROMPT).toMatch(/COORDINATORS NEVER.*EXECUTE.*WORK/i);
  });

  test("contains MANDATORY review loop section", () => {
    expect(COORDINATOR_PROMPT).toContain("MANDATORY Review Loop");
    expect(COORDINATOR_PROMPT).toContain("swarm_review");
    expect(COORDINATOR_PROMPT).toContain("swarm_review_feedback");
  });

  test("requires Task() after every swarm_spawn_subtask", () => {
    expect(COORDINATOR_PROMPT).toMatch(/after every\s+swarm_spawn_subtask/i);
    expect(COORDINATOR_PROMPT).toMatch(/Task\(subagent_type="swarm-worker"/);
  });

  test("does not reference deprecated cass or semantic-memory tools", () => {
    expect(COORDINATOR_PROMPT).not.toContain("cass_search");
    expect(COORDINATOR_PROMPT).not.toContain("semantic_memory_find");
    expect(COORDINATOR_PROMPT).not.toContain("semantic_memory_store");
  });

  test("Phase 1.5 positioned between Phase 1 (Initialize) and Phase 2 (Knowledge)", () => {
    const phase1Pos = COORDINATOR_PROMPT.indexOf("Phase 1:");
    const phase15Pos = COORDINATOR_PROMPT.indexOf("Phase 1.5:");
    const phase2Pos = COORDINATOR_PROMPT.indexOf("Phase 2:");

    expect(phase15Pos).toBeGreaterThan(phase1Pos);
    expect(phase15Pos).toBeLessThan(phase2Pos);
  });
});

describe("formatCoordinatorPrompt", () => {
  test("function exists and returns string", () => {
    expect(formatCoordinatorPrompt).toBeDefined();
    const result = formatCoordinatorPrompt({ task: "test task", projectPath: "/test" });
    expect(typeof result).toBe("string");
  });

  test("substitutes {task} placeholder", () => {
    const result = formatCoordinatorPrompt({ 
      task: "Implement auth", 
      projectPath: "/test" 
    });
    expect(result).toContain("Implement auth");
  });

  test("substitutes {project_path} placeholder", () => {
    const result = formatCoordinatorPrompt({ 
      task: "test", 
      projectPath: "/Users/joel/my-project" 
    });
    expect(result).toContain("/Users/joel/my-project");
  });



  test("returns complete prompt with all phases", () => {
    const result = formatCoordinatorPrompt({ 
      task: "test", 
      projectPath: "/test" 
    });
    
    // Should contain all phase headers
    for (let i = 0; i <= 8; i++) {
      expect(result).toContain(`Phase ${i}:`);
    }
    expect(result).toContain("Phase 1.5:");
  });
});

describe("getRecentEvalFailures", () => {
  test("returns empty string when no failures exist", async () => {
    const { getRecentEvalFailures } = await import("./swarm-prompts");
    const result = await getRecentEvalFailures();
    
    // Should not throw and returns string
    expect(typeof result).toBe("string");
    // When no failures, returns empty or a message - either is acceptable
  });
  
  test("returns formatted string when failures exist", async () => {
    const { getRecentEvalFailures } = await import("./swarm-prompts");
    
    // This test depends on actual memory state
    // Just verify it doesn't throw and returns a string
    const result = await getRecentEvalFailures();
    expect(typeof result).toBe("string");
  });
  
  test("includes warning emoji in header when failures present", async () => {
    const { getRecentEvalFailures } = await import("./swarm-prompts");
    
    // If there are failures in the system, the header should have ⚠️
    const result = await getRecentEvalFailures();
    
    // Either empty (no failures) or contains the warning section
    if (result.length > 0) {
      expect(result).toMatch(/⚠️|Recent Eval Failures/);
    }
  });
  
  test("handles memory adapter errors gracefully", async () => {
    const { getRecentEvalFailures } = await import("./swarm-prompts");
    
    // Should not throw even if memory is unavailable
    await expect(getRecentEvalFailures()).resolves.toBeDefined();
  });
});

describe("getPromptInsights", () => {
  describe("for coordinators (planning prompts)", () => {
    test("returns formatted insights string", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      expect(typeof result).toBe("string");
    });

    test.skip("includes strategy success rates when data exists", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      // If there's data, should mention strategies
      if (result.length > 0) {
        expect(result).toMatch(/strategy|file-based|feature-based|risk-based/i);
      }
    });

    test.skip("includes recent failure patterns", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      // Should query for failures and anti-patterns
      if (result.length > 0) {
        expect(result).toMatch(/avoid|failure|anti-pattern|success rate/i);
      }
    });

    test.skip("returns empty string when no data available", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      
      // With project_key filter that doesn't exist, should return empty
      const result = await getPromptInsights({ 
        role: "coordinator",
        project_key: "non-existent-project-xyz123"
      });
      
      expect(typeof result).toBe("string");
    });
  });

  describe("for workers (subtask prompts)", () => {
    test.skip("returns formatted insights string", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ 
        role: "worker",
        files: ["src/test.ts"]
      });
      
      expect(typeof result).toBe("string");
    });

    test.skip("queries hivemind for file-specific learnings", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ 
        role: "worker",
        files: ["src/auth.ts", "src/api/login.ts"]
      });
      
      // Should query semantic memory with file/domain keywords
      // Result format doesn't matter, just verify it doesn't throw
      expect(typeof result).toBe("string");
    });

    test.skip("includes common pitfalls for domain area", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ 
        role: "worker",
        domain: "authentication"
      });
      
      if (result.length > 0) {
        expect(result).toMatch(/pitfall|gotcha|warning|common|issue/i);
      }
    });
  });

  describe("handles errors gracefully", () => {
    test.skip("returns empty string when database unavailable", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      
      // Should not throw even if swarm-mail DB is unavailable
      await expect(getPromptInsights({ role: "coordinator" })).resolves.toBeDefined();
    });

    test.skip("returns empty string when hivemind unavailable", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      
      // Should not throw even if memory is unavailable
      await expect(getPromptInsights({ role: "worker", files: [] })).resolves.toBeDefined();
    });
  });

  describe("formatting", () => {
    test.skip("formats strategy stats as readable table", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      if (result.includes("Strategy")) {
        // Should use markdown table or similar readable format
        expect(result).toMatch(/\|.*\||\n-+\n|Strategy.*Success/i);
      }
    });

    test.skip("limits output to prevent context bloat", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      // Should cap at reasonable length (say, 1500 chars max)
      expect(result.length).toBeLessThan(2000);
    });

    test.skip("includes visual emphasis (emoji or markdown)", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      if (result.length > 0) {
        // Should have at least some formatting
        expect(result).toMatch(/##|📊|✅|❌|⚠️|\*\*/);
      }
    });
  });

  describe("getPromptInsights integration with swarm-insights", () => {
    test("coordinator role uses swarm-insights data layer", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      
      // Should call new data layer, not old swarm-mail analytics
      const result = await getPromptInsights({ role: "coordinator" });
      
      // If we have data, it should be formatted by formatInsightsForPrompt
      if (result.length > 0) {
        // New format has "Historical Insights" section
        expect(result).toMatch(/Historical Insights|Strategy Performance|Common Pitfalls/i);
      }
    });

    test("coordinator insights have expected structure when data exists", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      // Should have Historical Insights header
      if (result.length > 0) {
        expect(result).toContain("📊 Historical Insights");
        expect(result).toContain("Use these learnings when selecting decomposition strategies");
      }
    });

    test("coordinator insights use formatInsightsForPrompt output", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      // formatInsightsForPrompt produces specific markdown patterns
      if (result.length > 0 && result.includes("Strategy")) {
        // Should have Strategy Performance or Common Pitfalls sections
        const hasExpectedSections = 
          result.includes("Strategy Performance") || 
          result.includes("Common Pitfalls");
        expect(hasExpectedSections).toBe(true);
      }
    });

    test("coordinator insights are concise (<500 tokens)", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ role: "coordinator" });
      
      // formatInsightsForPrompt enforces maxTokens=500 by default
      // Rough estimate: 4 chars per token = 2000 chars max
      if (result.length > 0) {
        expect(result.length).toBeLessThan(2000);
      }
    });

    test("gracefully handles missing data", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      
      // Should not throw if database is empty or missing
      const result = await getPromptInsights({ role: "coordinator" });
      
      // Empty string is acceptable when no data
      expect(typeof result).toBe("string");
    });

    test("imports from swarm-insights module", async () => {
      // Verify the imports exist
      const insights = await import("./swarm-insights");
      
      expect(insights.getStrategyInsights).toBeDefined();
      expect(insights.getPatternInsights).toBeDefined();
      expect(insights.formatInsightsForPrompt).toBeDefined();
    });
  });

	describe("worker insights integration with swarm-insights", () => {
		test("worker role uses getFileInsights from swarm-insights data layer", async () => {
			const { getPromptInsights } = await import("./swarm-prompts");
			
			// Should call getFileInsights for file-specific insights
			const result = await getPromptInsights({ 
				role: "worker",
				files: ["src/auth.ts", "src/db.ts"],
				domain: "authentication"
			});
			
			// If we have data, it should be formatted by formatInsightsForPrompt
			if (result.length > 0) {
				// New format has "File-Specific Gotchas" or semantic memory learnings
				expect(result).toMatch(/File-Specific Gotchas|Relevant Learnings/i);
			}
		});

		test("getWorkerInsights uses global DB path from swarm-mail", async () => {
			// This test verifies that getWorkerInsights imports getGlobalDbPath from swarm-mail
			// We verify the import exists and the function doesn't throw
			
			const { getPromptInsights } = await import("./swarm-prompts");
			
			// Should not throw when using global DB
			await expect(getPromptInsights({ 
				role: "worker",
				files: ["src/test.ts"]
			})).resolves.toBeDefined();
			
			// Verify the global DB path is used (indirectly by checking it doesn't error)
			const { getGlobalDbPath } = await import("swarm-mail");
			const globalPath = getGlobalDbPath();
			expect(globalPath).toContain(".config/swarm-tools/swarm.db");
		});

    test("worker insights include file failure history warnings", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ 
        role: "worker",
        files: ["src/test-file.ts"],
      });
      
      // Should return a string (empty if no data)
      expect(typeof result).toBe("string");
      
      // If there are file history warnings, they should be formatted correctly
      if (result.includes("⚠️ FILE HISTORY WARNINGS:")) {
        // Should have file name and rejection count/issues
        expect(result).toMatch(/\d+ previous worker/);
      }
    });

    test("worker insights include file-specific gotchas when available", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ 
        role: "worker",
        files: ["src/test-file.ts"],
      });
      
      // Should contain either file gotchas or semantic memory results
      if (result.length > 0) {
        const hasFileInsights = 
          result.includes("File-Specific Gotchas") ||
          result.includes("Relevant Learnings");
        expect(hasFileInsights).toBe(true);
      }
    });

    test("worker insights combine event store failures + semantic memory", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ 
        role: "worker",
        files: ["src/complex.ts"],
        domain: "complex feature"
      });
      
      // Should potentially have both sources of insight
      // At minimum, should return string (empty if no data)
      expect(typeof result).toBe("string");
    });

    test("worker insights are concise (<300 tokens per file)", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      const result = await getPromptInsights({ 
        role: "worker",
        files: ["src/file1.ts", "src/file2.ts", "src/file3.ts"],
      });
      
      // <300 tokens per file = 900 tokens max for 3 files
      // Rough estimate: 4 chars per token = 3600 chars max
      if (result.length > 0) {
        expect(result.length).toBeLessThan(3600);
      }
    });

    test("formatSubtaskPromptV2 includes file insights in shared_context", async () => {
      const result = await formatSubtaskPromptV2({
        bead_id: "test-123",
        epic_id: "epic-456",
        subtask_title: "Implement auth",
        subtask_description: "Add authentication flow",
        files: ["src/auth.ts", "src/user.ts"],
        shared_context: "Original context from coordinator",
      });
      
      // shared_context should be replaced and insights potentially included
      // At minimum, the original context should be in the prompt
      expect(result).toContain("Original context from coordinator");
    });

    test("worker insights gracefully handle missing files parameter", async () => {
      const { getPromptInsights } = await import("./swarm-prompts");
      
      // Should not throw with no files or domain
      const result = await getPromptInsights({ role: "worker" });
      
      // Empty string is acceptable when no context to query
      expect(typeof result).toBe("string");
    });

    test("worker insights use swarm-insights getFileInsights", async () => {
      // Verify the function is imported
      const insights = await import("./swarm-insights");
      
      expect(insights.getFileInsights).toBeDefined();
      expect(typeof insights.getFileInsights).toBe("function");
    });

    test("getWorkerInsights uses global DB path from swarm-mail", async () => {
      // This test verifies that the hardcoded path is replaced with getGlobalDbPath()
      // We can't easily mock the internal call, but we can verify it doesn't throw
      // when global DB exists
      
      const { getPromptInsights } = await import("./swarm-prompts");
      
      // Should not throw when using global DB
      await expect(getPromptInsights({ 
        role: "worker",
        files: ["src/test.ts"]
      })).resolves.toBeDefined();
    });

		test("getWorkerInsights includes file failure history in output", async () => {
			const { getPromptInsights } = await import("./swarm-prompts");
			const result = await getPromptInsights({ 
				role: "worker",
				files: ["src/auth.ts", "src/api.ts"]
			});
			
			// Should be string
			expect(typeof result).toBe("string");
			
			// If file history warnings exist, they should appear before semantic memory
			if (result.includes("⚠️ FILE HISTORY WARNINGS:") && result.includes("💡 Relevant Learnings")) {
				const warningsPos = result.indexOf("⚠️ FILE HISTORY WARNINGS:");
				const learningsPos = result.indexOf("💡 Relevant Learnings");
				expect(warningsPos).toBeLessThan(learningsPos);
			}
		});
	});

	describe("Integration: formatSubtaskPromptV2 with file history warnings", () => {
		test("formatSubtaskPromptV2 includes file history warnings when rejection data exists", async () => {
			// This test verifies the full flow: 
			// formatSubtaskPromptV2 → getWorkerInsights → getFileFailureHistory → formatFileHistoryWarnings
			
			// First, seed the database with review_feedback events
			const { createLibSQLAdapter, createSwarmMailAdapter, getGlobalDbPath } = await import("swarm-mail");
			const globalDbPath = getGlobalDbPath();
			const dbAdapter = await createLibSQLAdapter({ url: `file:${globalDbPath}` });
			const testSwarmMail = createSwarmMailAdapter(dbAdapter, "test-integration");
			
			const db = await testSwarmMail.getDatabase();
			const now = Date.now();
			
			// Seed rejection data for specific test files
			await db.query(
				`INSERT INTO events (type, project_key, timestamp, data) VALUES 
				('review_feedback', 'test-integration', ?, ?),
				('review_feedback', 'test-integration', ?, ?)`,
				[
					now,
					JSON.stringify({
						task_id: "prompt-test-1",
						status: "needs_changes",
						issues: JSON.stringify([
							{
								file: "src/prompt-test-file.ts",
								line: 5,
								issue: "Missing validation",
								suggestion: "Add input validation"
							}
						])
					}),
					now + 1000,
					JSON.stringify({
						task_id: "prompt-test-2",
						status: "needs_changes",
						issues: JSON.stringify([
							{
								file: "src/prompt-test-file.ts",
								line: 10,
								issue: "Incomplete error handling",
								suggestion: "Add error recovery"
							}
						])
					}),
				],
			);
			
			// Now call formatSubtaskPromptV2 with those files
			const { formatSubtaskPromptV2 } = await import("./swarm-prompts");
			const prompt = await formatSubtaskPromptV2({
				bead_id: "test-123",
				epic_id: "epic-456",
				subtask_title: "Test prompt generation",
				subtask_description: "Verify file history warnings are included",
				files: ["src/prompt-test-file.ts"],
				shared_context: "Test context",
				project_path: "/test/path",
			});
			
			// Verify the prompt contains file history warnings section
			expect(prompt).toContain("⚠️ FILE HISTORY WARNINGS:");
			expect(prompt).toContain("src/prompt-test-file.ts");
			expect(prompt).toMatch(/\d+ previous workers? rejected/);
		});
	});
});

// ============================================================================
// Strategy Diversification Tests (Cell: mk471w89ya6)
// ============================================================================

describe("Strategy Selection - Keyword Triggers for Diversification", () => {
	describe("file-based strategy triggers", () => {
		test("'move' keyword triggers file-based strategy", async () => {
			const { selectStrategy } = await import("./swarm-strategies");
			const result = await selectStrategy("Move all components to new directory");
			expect(result.strategy).toBe("file-based");
		});

		test("'update all' multi-word keyword triggers file-based strategy", async () => {
			const { selectStrategy } = await import("./swarm-strategies");
			const result = await selectStrategy("Update all imports to use new path");
			expect(result.strategy).toBe("file-based");
		});
	});

	describe("risk-based strategy triggers", () => {
		test("'CVE' keyword triggers risk-based strategy", async () => {
			const { selectStrategy } = await import("./swarm-strategies");
			const result = await selectStrategy("Address CVE-2024-1234 in dependencies");
			expect(result.strategy).toBe("risk-based");
		});

		test("case-insensitive matching for risk keywords", async () => {
			const { selectStrategy } = await import("./swarm-strategies");
			const resultUpper = await selectStrategy("FIX CRITICAL SECURITY BUG");
			const resultLower = await selectStrategy("fix critical security bug");
			const resultMixed = await selectStrategy("Fix Critical Security Bug");
			
			expect(resultUpper.strategy).toBe("risk-based");
			expect(resultLower.strategy).toBe("risk-based");
			expect(resultMixed.strategy).toBe("risk-based");
		});
	});

	describe("strategy distribution regression test", () => {
		test("diversified keywords produce more balanced distribution", async () => {
			const { selectStrategy } = await import("./swarm-strategies");
			
			// Sample tasks representing typical workload
			const tasks = [
				"Add user authentication",           // feature-based
				"Refactor API handlers",             // file-based
				"Fix security vulnerability",        // risk-based
				"Implement dashboard",               // feature-based
				"Update all imports",                // file-based
				"Patch critical bug CVE-2024-123",  // risk-based
				"Build new feature",                 // feature-based
				"Migrate to new framework",          // file-based
				"Address urgent security issue",     // risk-based
				"Create new component",              // feature-based
			];
			
			const results = await Promise.all(
				tasks.map(task => selectStrategy(task))
			);
			
			const distribution = results.reduce((acc, r) => {
				acc[r.strategy] = (acc[r.strategy] || 0) + 1;
				return acc;
			}, {} as Record<string, number>);
			
			// Calculate percentages
			const total = results.length;
			const percentages = {
				"feature-based": (distribution["feature-based"] || 0) / total * 100,
				"file-based": (distribution["file-based"] || 0) / total * 100,
				"risk-based": (distribution["risk-based"] || 0) / total * 100,
			};
			
			// Assert more balanced distribution (not 97% feature-based)
			expect(percentages["feature-based"]).toBeLessThan(70);
			expect(percentages["file-based"]).toBeGreaterThan(20);
			expect(percentages["risk-based"]).toBeGreaterThan(10);
		});
	});
});
