/**
 * Swarm Prompts Module - Prompt templates and generation
 *
 * Provides all prompt templates used for swarm coordination:
 * - Decomposition prompts (basic and strategy-specific)
 * - Subtask agent prompts (V1 and V2)
 * - Evaluation prompts
 *
 * Key responsibilities:
 * - Prompt template definitions
 * - Prompt formatting/generation tools
 * - Template parameter substitution
 */

import { tool } from "@opencode-ai/plugin";

// ============================================================================
// Prompt Templates
// ============================================================================

/**
 * Prompt for decomposing a task into parallelizable subtasks.
 *
 * Used by swarm_decompose to instruct the agent on how to break down work.
 * The agent responds with a BeadTree that gets validated.
 */
export const DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a swarm of agents.

## Task
{task}

{context_section}

## MANDATORY: Beads Issue Tracking

**Every subtask MUST become a bead.** This is non-negotiable.

After decomposition, the coordinator will:
1. Create an epic bead for the overall task
2. Create child beads for each subtask
3. Track progress through bead status updates
4. Close beads with summaries when complete

Agents MUST update their bead status as they work. No silent progress.

## Requirements

1. **Break into 2-{max_subtasks} independent subtasks** that can run in parallel
2. **Assign files** - each subtask must specify which files it will modify
3. **No file overlap** - files cannot appear in multiple subtasks (they get exclusive locks)
4. **Order by dependency** - if subtask B needs subtask A's output, A must come first in the array
5. **Estimate complexity** - 1 (trivial) to 5 (complex)
6. **Plan aggressively** - break down more than you think necessary, smaller is better

## Response Format

Respond with a JSON object matching this schema:

\`\`\`typescript
{
  epic: {
    title: string,        // Epic title for the beads tracker
    description?: string  // Brief description of the overall goal
  },
  subtasks: [
    {
      title: string,              // What this subtask accomplishes
      description?: string,       // Detailed instructions for the agent
      files: string[],            // Files this subtask will modify (globs allowed)
      dependencies: number[],     // Indices of subtasks this depends on (0-indexed)
      estimated_complexity: 1-5   // Effort estimate
    },
    // ... more subtasks
  ]
}
\`\`\`

## Guidelines

- **Plan aggressively** - when in doubt, split further. 3 small tasks > 1 medium task
- **Prefer smaller, focused subtasks** over large complex ones
- **Include test files** in the same subtask as the code they test
- **Consider shared types** - if multiple files share types, handle that first
- **Think about imports** - changes to exported APIs affect downstream files
- **Explicit > implicit** - spell out what each subtask should do, don't assume

## File Assignment Examples

- Schema change: \`["src/schemas/user.ts", "src/schemas/index.ts"]\`
- Component + test: \`["src/components/Button.tsx", "src/components/Button.test.tsx"]\`
- API route: \`["src/app/api/users/route.ts"]\`

Now decompose the task:`;

/**
 * Strategy-specific decomposition prompt template
 */
export const STRATEGY_DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a swarm of agents.

## Task
{task}

{strategy_guidelines}

{context_section}

{cass_history}

{skills_context}

## MANDATORY: Beads Issue Tracking

**Every subtask MUST become a bead.** This is non-negotiable.

After decomposition, the coordinator will:
1. Create an epic bead for the overall task
2. Create child beads for each subtask
3. Track progress through bead status updates
4. Close beads with summaries when complete

Agents MUST update their bead status as they work. No silent progress.

## Requirements

1. **Break into 2-{max_subtasks} independent subtasks** that can run in parallel
2. **Assign files** - each subtask must specify which files it will modify
3. **No file overlap** - files cannot appear in multiple subtasks (they get exclusive locks)
4. **Order by dependency** - if subtask B needs subtask A's output, A must come first in the array
5. **Estimate complexity** - 1 (trivial) to 5 (complex)
6. **Plan aggressively** - break down more than you think necessary, smaller is better

## Response Format

Respond with a JSON object matching this schema:

\`\`\`typescript
{
  epic: {
    title: string,        // Epic title for the beads tracker
    description?: string  // Brief description of the overall goal
  },
  subtasks: [
    {
      title: string,              // What this subtask accomplishes
      description?: string,       // Detailed instructions for the agent
      files: string[],            // Files this subtask will modify (globs allowed)
      dependencies: number[],     // Indices of subtasks this depends on (0-indexed)
      estimated_complexity: 1-5   // Effort estimate
    },
    // ... more subtasks
  ]
}
\`\`\`

Now decompose the task:`;

/**
 * Prompt template for spawned subtask agents.
 *
 * Each agent receives this prompt with their specific subtask details filled in.
 * The prompt establishes context, constraints, and expectations.
 */
export const SUBTASK_PROMPT = `You are a swarm agent working on a subtask of a larger epic.

## Your Identity
- **Agent Name**: {agent_name}
- **Bead ID**: {bead_id}
- **Epic ID**: {epic_id}

## Your Subtask
**Title**: {subtask_title}

{subtask_description}

## File Scope
You have exclusive reservations for these files:
{file_list}

**CRITICAL**: Only modify files in your reservation. If you need to modify other files, 
send a message to the coordinator requesting the change.

## Shared Context
{shared_context}

## MANDATORY: Beads Tracking

You MUST keep your bead updated as you work:

1. **Your bead is already in_progress** - don't change this unless blocked
2. **If blocked**: \`bd update {bead_id} --status blocked\` and message coordinator
3. **When done**: Use \`swarm_complete\` - it closes your bead automatically
4. **Discovered issues**: Create new beads with \`bd create "issue" -t bug\`

**Never work silently.** Your bead status is how the swarm tracks progress.

## MANDATORY: Swarm Mail Communication

You MUST communicate with other agents:

1. **Report progress** every significant milestone (not just at the end)
2. **Ask questions** if requirements are unclear - don't guess
3. **Announce blockers** immediately - don't spin trying to fix alone
4. **Coordinate on shared concerns** - if you see something affecting other agents, say so

Use Swarm Mail for all communication:
\`\`\`
swarmmail_send(
  to: ["coordinator" or specific agent],
  subject: "Brief subject",
  body: "Message content",
  thread_id: "{epic_id}"
)
\`\`\`

## Coordination Protocol

1. **Start**: Your bead is already marked in_progress
2. **Progress**: Use swarm_progress to report status updates
3. **Blocked**: Report immediately via Swarm Mail - don't spin
4. **Complete**: Use swarm_complete when done - it handles:
   - Closing your bead with a summary
   - Releasing file reservations
   - Notifying the coordinator

## Self-Evaluation

Before calling swarm_complete, evaluate your work:
- Type safety: Does it compile without errors?
- No obvious bugs: Did you handle edge cases?
- Follows patterns: Does it match existing code style?
- Readable: Would another developer understand it?

If evaluation fails, fix the issues before completing.

## Planning Your Work

Before writing code:
1. **Read the files** you're assigned to understand current state
2. **Plan your approach** - what changes, in what order?
3. **Identify risks** - what could go wrong? What dependencies?
4. **Communicate your plan** via Swarm Mail if non-trivial

Begin work on your subtask now.`;

/**
 * Streamlined subtask prompt (V2) - uses Swarm Mail and beads
 *
 * This is a cleaner version of SUBTASK_PROMPT that's easier to parse.
 * Agents MUST use Swarm Mail for communication and beads for tracking.
 *
 * Supports {error_context} placeholder for retry prompts.
 */
export const SUBTASK_PROMPT_V2 = `You are a swarm agent working on: **{subtask_title}**

## [IDENTITY]
Agent: (assigned at spawn)
Bead: {bead_id}
Epic: {epic_id}

## [TASK]
{subtask_description}

## [FILES]
Reserved (exclusive):
{file_list}

Only modify these files. Need others? Message the coordinator.

## [CONTEXT]
{shared_context}

{compressed_context}

{error_context}

## [MANDATORY SURVIVAL CHECKLIST]

**CRITICAL: Follow this checklist IN ORDER. Each step builds on the previous.**

### Step 1: Initialize Coordination (REQUIRED - DO THIS FIRST)
\`\`\`
swarmmail_init(project_path="{project_path}", task_description="{bead_id}: {subtask_title}")
\`\`\`

**This registers you with the coordination system and enables:**
- File reservation tracking
- Inter-agent communication
- Progress monitoring
- Conflict detection

**If you skip this step, your work will not be tracked and swarm_complete will fail.**

### Step 2: Query Past Learnings (BEFORE starting work)
\`\`\`
semantic-memory_find(query="<keywords from your task>", limit=5)
\`\`\`

**Check if past agents solved similar problems.** Search for:
- Error messages if debugging
- Domain concepts (e.g., "authentication", "caching")
- Technology stack (e.g., "Next.js", "React")
- Patterns (e.g., "event sourcing", "validation")

**Past learnings save time and prevent repeating mistakes.**

### Step 3: Load Relevant Skills (if available)
\`\`\`
skills_list()  # See what skills exist
skills_use(name="<relevant-skill>", context="<your task>")  # Load skill
\`\`\`

**Common skill triggers:**
- Writing tests? → \`skills_use(name="testing-patterns")\`
- Breaking dependencies? → \`skills_use(name="testing-patterns")\`
- Multi-agent coordination? → \`skills_use(name="swarm-coordination")\`
- Building a CLI? → \`skills_use(name="cli-builder")\`

### Step 4: Reserve Your Files (YOU reserve, not coordinator)
\`\`\`
swarmmail_reserve(
  paths=[{file_list}],
  reason="{bead_id}: {subtask_title}",
  exclusive=true
)
\`\`\`

**Workers reserve their own files.** This prevents edit conflicts with other agents.

### Step 5: Do the Work
- Read your assigned files
- Implement changes
- Verify (typecheck if applicable)

### Step 6: Report Progress at Milestones
\`\`\`
swarm_progress(
  project_key="{project_path}",
  agent_name="<your-agent-name>",
  bead_id="{bead_id}",
  status="in_progress",
  progress_percent=25,  # or 50, 75
  message="<what you just completed>"
)
\`\`\`

**Report at 25%, 50%, 75% completion.** This:
- Triggers auto-checkpoint (saves context)
- Keeps coordinator informed
- Prevents silent failures

### Step 7: Manual Checkpoint BEFORE Risky Operations
\`\`\`
swarm_checkpoint(
  project_key="{project_path}",
  agent_name="<your-agent-name>",
  bead_id="{bead_id}"
)
\`\`\`

**Call BEFORE:**
- Large refactors
- File deletions
- Breaking API changes
- Anything that might fail catastrophically

**Checkpoints preserve context so you can recover if things go wrong.**

### Step 8: Store Learnings (if you discovered something)
\`\`\`
semantic-memory_store(
  information="<what you learned, WHY it matters, how to apply it>",
  metadata="<tags: domain, tech-stack, pattern-type>"
)
\`\`\`

**Store:**
- Tricky bugs you solved (root cause + solution)
- Project-specific patterns or domain rules
- Tool/library gotchas and workarounds
- Failed approaches (anti-patterns to avoid)

**Don't store generic knowledge.** Store the WHY, not just the WHAT.

### Step 9: Complete (REQUIRED - releases reservations)
\`\`\`
swarm_complete(
  project_key="{project_path}",
  agent_name="<your-agent-name>",
  bead_id="{bead_id}",
  summary="<what you accomplished>",
  files_touched=["list", "of", "files"]
)
\`\`\`

**This automatically:**
- Runs UBS bug scan
- Releases file reservations
- Records learning signals
- Notifies coordinator

**DO NOT manually close the bead with beads_close.** Use swarm_complete.

## [SWARM MAIL COMMUNICATION]

### Check Inbox Regularly
\`\`\`
swarmmail_inbox()  # Check for coordinator messages
swarmmail_read_message(message_id=N)  # Read specific message
\`\`\`

### When Blocked
\`\`\`
swarmmail_send(
  to=["coordinator"],
  subject="BLOCKED: {bead_id}",
  body="<blocker description, what you need>",
  importance="high",
  thread_id="{epic_id}"
)
beads_update(id="{bead_id}", status="blocked")
\`\`\`

### Report Issues to Other Agents
\`\`\`
swarmmail_send(
  to=["OtherAgent", "coordinator"],
  subject="Issue in {bead_id}",
  body="<describe problem, don't fix their code>",
  thread_id="{epic_id}"
)
\`\`\`

### Manual Release (if needed)
\`\`\`
swarmmail_release()  # Manually release reservations
\`\`\`

**Note:** \`swarm_complete\` automatically releases reservations. Only use manual release if aborting work.

## [OTHER TOOLS]
### Beads - You Have Autonomy to File Issues
You can create new beads against this epic when you discover:
- **Bugs**: Found a bug while working? File it.
- **Tech debt**: Spotted something that needs cleanup? File it.
- **Follow-up work**: Task needs more work than scoped? File a follow-up.
- **Dependencies**: Need something from another agent? File and link it.

\`\`\`
beads_create(
  title="<descriptive title>",
  type="bug",  # or "task", "chore"
  priority=2,
  parent_id="{epic_id}",  # Links to this epic
  description="Found while working on {bead_id}: <details>"
)
\`\`\`

**Don't silently ignore issues.** File them so they get tracked and addressed.

Other bead operations:
- beads_update(id, status) - Mark blocked if stuck
- beads_query(status="open") - See what else needs work

### Skills
- skills_list() - Discover available skills
- skills_use(name) - Activate skill for specialized guidance
- skills_create(name) - Create new skill (if you found a reusable pattern)

## [CRITICAL REQUIREMENTS]

**NON-NEGOTIABLE:**
1. Step 1 (swarmmail_init) MUST be first - do it before anything else
2. Step 2 (semantic-memory_find) MUST happen before starting work
3. Step 4 (swarmmail_reserve) - YOU reserve files, not coordinator
4. Step 6 (swarm_progress) - Report at milestones, don't work silently
5. Step 9 (swarm_complete) - Use this to close, NOT beads_close

**If you skip these steps:**
- Your work won't be tracked (swarm_complete will fail)
- You'll waste time repeating solved problems (no semantic memory query)
- Edit conflicts with other agents (no file reservation)
- Lost work if you crash (no checkpoints)
- Future agents repeat your mistakes (no learnings stored)

Begin now.`;

/**
 * Prompt for self-evaluation before completing a subtask.
 *
 * Agents use this to assess their work quality before marking complete.
 */
export const EVALUATION_PROMPT = `Evaluate the work completed for this subtask.

## Subtask
**Bead ID**: {bead_id}
**Title**: {subtask_title}

## Files Modified
{files_touched}

## Evaluation Criteria

For each criterion, assess passed/failed and provide brief feedback:

1. **type_safe**: Code compiles without TypeScript errors
2. **no_bugs**: No obvious bugs, edge cases handled
3. **patterns**: Follows existing codebase patterns and conventions
4. **readable**: Code is clear and maintainable

## Response Format

\`\`\`json
{
  "passed": boolean,        // Overall pass/fail
  "criteria": {
    "type_safe": { "passed": boolean, "feedback": string },
    "no_bugs": { "passed": boolean, "feedback": string },
    "patterns": { "passed": boolean, "feedback": string },
    "readable": { "passed": boolean, "feedback": string }
  },
  "overall_feedback": string,
  "retry_suggestion": string | null  // If failed, what to fix
}
\`\`\`

If any criterion fails, the overall evaluation fails and retry_suggestion 
should describe what needs to be fixed.`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format the V2 subtask prompt for a specific agent
 */
export function formatSubtaskPromptV2(params: {
  bead_id: string;
  epic_id: string;
  subtask_title: string;
  subtask_description: string;
  files: string[];
  shared_context?: string;
  compressed_context?: string;
  error_context?: string;
  project_path?: string;
  recovery_context?: {
    shared_context?: string;
    skills_to_load?: string[];
    coordinator_notes?: string;
  };
}): string {
  const fileList =
    params.files.length > 0
      ? params.files.map((f) => `- \`${f}\``).join("\n")
      : "(no specific files - use judgment)";

  const compressedSection = params.compressed_context
    ? params.compressed_context
    : "";

  const errorSection = params.error_context ? params.error_context : "";

  // Build recovery context section
  let recoverySection = "";
  if (params.recovery_context) {
    const sections: string[] = [];

    if (params.recovery_context.shared_context) {
      sections.push(
        `### Recovery Context\n${params.recovery_context.shared_context}`,
      );
    }

    if (
      params.recovery_context.skills_to_load &&
      params.recovery_context.skills_to_load.length > 0
    ) {
      sections.push(
        `### Skills to Load\nBefore starting work, load these skills for specialized guidance:\n${params.recovery_context.skills_to_load.map((s) => `- skills_use(name="${s}")`).join("\n")}`,
      );
    }

    if (params.recovery_context.coordinator_notes) {
      sections.push(
        `### Coordinator Notes\n${params.recovery_context.coordinator_notes}`,
      );
    }

    if (sections.length > 0) {
      recoverySection = `\n## [RECOVERY CONTEXT]\n\n${sections.join("\n\n")}`;
    }
  }

  return SUBTASK_PROMPT_V2.replace(/{bead_id}/g, params.bead_id)
    .replace(/{epic_id}/g, params.epic_id)
    .replace(/{project_path}/g, params.project_path || "$PWD")
    .replace("{subtask_title}", params.subtask_title)
    .replace(
      "{subtask_description}",
      params.subtask_description || "(see title)",
    )
    .replace("{file_list}", fileList)
    .replace("{shared_context}", params.shared_context || "(none)")
    .replace("{compressed_context}", compressedSection)
    .replace("{error_context}", errorSection + recoverySection);
}

/**
 * Format the subtask prompt for a specific agent
 */
export function formatSubtaskPrompt(params: {
  agent_name: string;
  bead_id: string;
  epic_id: string;
  subtask_title: string;
  subtask_description: string;
  files: string[];
  shared_context?: string;
}): string {
  const fileList = params.files.map((f) => `- \`${f}\``).join("\n");

  return SUBTASK_PROMPT.replace("{agent_name}", params.agent_name)
    .replace("{bead_id}", params.bead_id)
    .replace(/{epic_id}/g, params.epic_id)
    .replace("{subtask_title}", params.subtask_title)
    .replace("{subtask_description}", params.subtask_description || "(none)")
    .replace("{file_list}", fileList || "(no files assigned)")
    .replace("{shared_context}", params.shared_context || "(none)");
}

/**
 * Format the evaluation prompt
 */
export function formatEvaluationPrompt(params: {
  bead_id: string;
  subtask_title: string;
  files_touched: string[];
}): string {
  const filesList = params.files_touched.map((f) => `- \`${f}\``).join("\n");

  return EVALUATION_PROMPT.replace("{bead_id}", params.bead_id)
    .replace("{subtask_title}", params.subtask_title)
    .replace("{files_touched}", filesList || "(no files recorded)");
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Generate subtask prompt for a spawned agent
 */
export const swarm_subtask_prompt = tool({
  description: "Generate the prompt for a spawned subtask agent",
  args: {
    agent_name: tool.schema.string().describe("Agent Mail name for the agent"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    epic_id: tool.schema.string().describe("Epic bead ID"),
    subtask_title: tool.schema.string().describe("Subtask title"),
    subtask_description: tool.schema
      .string()
      .optional()
      .describe("Detailed subtask instructions"),
    files: tool.schema
      .array(tool.schema.string())
      .describe("Files assigned to this subtask"),
    shared_context: tool.schema
      .string()
      .optional()
      .describe("Context shared across all agents"),
    project_path: tool.schema
      .string()
      .optional()
      .describe("Absolute project path for swarmmail_init"),
  },
  async execute(args) {
    const prompt = formatSubtaskPrompt({
      agent_name: args.agent_name,
      bead_id: args.bead_id,
      epic_id: args.epic_id,
      subtask_title: args.subtask_title,
      subtask_description: args.subtask_description || "",
      files: args.files,
      shared_context: args.shared_context,
    });

    return prompt;
  },
});

/**
 * Prepare a subtask for spawning with Task tool (V2 prompt)
 *
 * Generates a streamlined prompt that tells agents to USE Agent Mail and beads.
 * Returns JSON that can be directly used with Task tool.
 */
export const swarm_spawn_subtask = tool({
  description:
    "Prepare a subtask for spawning. Returns prompt with Agent Mail/beads instructions. IMPORTANT: Pass project_path for swarmmail_init.",
  args: {
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    epic_id: tool.schema.string().describe("Parent epic bead ID"),
    subtask_title: tool.schema.string().describe("Subtask title"),
    subtask_description: tool.schema
      .string()
      .optional()
      .describe("Detailed subtask instructions"),
    files: tool.schema
      .array(tool.schema.string())
      .describe("Files assigned to this subtask"),
    shared_context: tool.schema
      .string()
      .optional()
      .describe("Context shared across all agents"),
    project_path: tool.schema
      .string()
      .optional()
      .describe(
        "Absolute project path for swarmmail_init (REQUIRED for tracking)",
      ),
    recovery_context: tool.schema
      .object({
        shared_context: tool.schema.string().optional(),
        skills_to_load: tool.schema.array(tool.schema.string()).optional(),
        coordinator_notes: tool.schema.string().optional(),
      })
      .optional()
      .describe("Recovery context from checkpoint compaction"),
  },
  async execute(args) {
    const prompt = formatSubtaskPromptV2({
      bead_id: args.bead_id,
      epic_id: args.epic_id,
      subtask_title: args.subtask_title,
      subtask_description: args.subtask_description || "",
      files: args.files,
      shared_context: args.shared_context,
      project_path: args.project_path,
      recovery_context: args.recovery_context,
    });

    return JSON.stringify(
      {
        prompt,
        bead_id: args.bead_id,
        epic_id: args.epic_id,
        files: args.files,
        project_path: args.project_path,
        recovery_context: args.recovery_context,
      },
      null,
      2,
    );
  },
});

/**
 * Generate self-evaluation prompt
 */
export const swarm_evaluation_prompt = tool({
  description: "Generate self-evaluation prompt for a completed subtask",
  args: {
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    subtask_title: tool.schema.string().describe("Subtask title"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .describe("Files that were modified"),
  },
  async execute(args) {
    const prompt = formatEvaluationPrompt({
      bead_id: args.bead_id,
      subtask_title: args.subtask_title,
      files_touched: args.files_touched,
    });

    return JSON.stringify(
      {
        prompt,
        expected_schema: "Evaluation",
        schema_hint: {
          passed: "boolean",
          criteria: {
            type_safe: { passed: "boolean", feedback: "string" },
            no_bugs: { passed: "boolean", feedback: "string" },
            patterns: { passed: "boolean", feedback: "string" },
            readable: { passed: "boolean", feedback: "string" },
          },
          overall_feedback: "string",
          retry_suggestion: "string | null",
        },
      },
      null,
      2,
    );
  },
});

/**
 * Generate a strategy-specific planning prompt
 *
 * Higher-level than swarm_decompose - includes strategy selection and guidelines.
 * Use this when you want the full planning experience with strategy-specific advice.
 */
export const swarm_plan_prompt = tool({
  description:
    "Generate strategy-specific decomposition prompt. Auto-selects strategy or uses provided one. Queries CASS for similar tasks.",
  args: {
    task: tool.schema.string().min(1).describe("Task description to decompose"),
    strategy: tool.schema
      .enum(["file-based", "feature-based", "risk-based", "auto"])
      .optional()
      .describe("Decomposition strategy (default: auto-detect)"),
    max_subtasks: tool.schema
      .number()
      .int()
      .min(2)
      .max(10)
      .default(5)
      .describe("Maximum number of subtasks (default: 5)"),
    context: tool.schema
      .string()
      .optional()
      .describe("Additional context (codebase info, constraints, etc.)"),
    query_cass: tool.schema
      .boolean()
      .optional()
      .describe("Query CASS for similar past tasks (default: true)"),
    cass_limit: tool.schema
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Max CASS results to include (default: 3)"),
    include_skills: tool.schema
      .boolean()
      .optional()
      .describe("Include available skills in context (default: true)"),
  },
  async execute(args) {
    // Import needed modules dynamically
    const { selectStrategy, formatStrategyGuidelines, STRATEGIES } =
      await import("./swarm-strategies");
    const { formatMemoryQueryForDecomposition } = await import("./learning");
    const { listSkills, getSkillsContextForSwarm, findRelevantSkills } =
      await import("./skills");

    // Select strategy
    type StrategyName =
      | "file-based"
      | "feature-based"
      | "risk-based"
      | "research-based";
    let selectedStrategy: StrategyName;
    let strategyReasoning: string;

    if (args.strategy && args.strategy !== "auto") {
      selectedStrategy = args.strategy as StrategyName;
      strategyReasoning = `User-specified strategy: ${selectedStrategy}`;
    } else {
      const selection = selectStrategy(args.task);
      selectedStrategy = selection.strategy;
      strategyReasoning = selection.reasoning;
    }

    // Fetch skills context
    let skillsContext = "";
    let skillsInfo: { included: boolean; count?: number; relevant?: string[] } =
      {
        included: false,
      };

    if (args.include_skills !== false) {
      const allSkills = await listSkills();
      if (allSkills.length > 0) {
        skillsContext = await getSkillsContextForSwarm();
        const relevantSkills = await findRelevantSkills(args.task);
        skillsInfo = {
          included: true,
          count: allSkills.length,
          relevant: relevantSkills,
        };

        // Add suggestion for relevant skills
        if (relevantSkills.length > 0) {
          skillsContext += `\n\n**Suggested skills for this task**: ${relevantSkills.join(", ")}`;
        }
      }
    }

    // Format strategy guidelines
    const strategyGuidelines = formatStrategyGuidelines(selectedStrategy);

    // Combine user context
    const contextSection = args.context
      ? `## Additional Context\n${args.context}`
      : "## Additional Context\n(none provided)";

    // Build the prompt (without CASS - we'll let the module handle that)
    const prompt = STRATEGY_DECOMPOSITION_PROMPT.replace("{task}", args.task)
      .replace("{strategy_guidelines}", strategyGuidelines)
      .replace("{context_section}", contextSection)
      .replace("{cass_history}", "") // Empty for now
      .replace("{skills_context}", skillsContext || "")
      .replace("{max_subtasks}", (args.max_subtasks ?? 5).toString());

    return JSON.stringify(
      {
        prompt,
        strategy: {
          selected: selectedStrategy,
          reasoning: strategyReasoning,
          guidelines:
            STRATEGIES[selectedStrategy as keyof typeof STRATEGIES].guidelines,
          anti_patterns:
            STRATEGIES[selectedStrategy as keyof typeof STRATEGIES]
              .antiPatterns,
        },
        expected_schema: "BeadTree",
        schema_hint: {
          epic: { title: "string", description: "string?" },
          subtasks: [
            {
              title: "string",
              description: "string?",
              files: "string[]",
              dependencies: "number[]",
              estimated_complexity: "1-5",
            },
          ],
        },
        validation_note:
          "Parse agent response as JSON and validate with swarm_validate_decomposition",
        skills: skillsInfo,
        // Add semantic-memory query instruction
        memory_query: formatMemoryQueryForDecomposition(args.task, 3),
      },
      null,
      2,
    );
  },
});

export const promptTools = {
  swarm_subtask_prompt,
  swarm_spawn_subtask,
  swarm_evaluation_prompt,
  swarm_plan_prompt,
};
