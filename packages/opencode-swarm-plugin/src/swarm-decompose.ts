/**
 * Swarm Decompose Module - Task decomposition and validation
 *
 * Handles breaking tasks into parallelizable subtasks with file assignments,
 * validates decomposition structure, and detects conflicts.
 *
 * Key responsibilities:
 * - Decomposition prompt generation
 * - CellTree validation
 * - File conflict detection
 * - Instruction conflict detection
 * - Delegation to planner subagents
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { CellTreeSchema } from "./schemas";
import {
  POSITIVE_MARKERS,
  NEGATIVE_MARKERS,
  type DecompositionStrategy,
} from "./swarm-strategies";

// ============================================================================
// Decomposition Prompt (temporary - will be moved to swarm-prompts.ts)
// ============================================================================

/**
 * Prompt for decomposing a task into parallelizable subtasks.
 *
 * Used by swarm_decompose to instruct the agent on how to break down work.
 * The agent responds with a CellTree that gets validated.
 */
const DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a swarm of agents.

## Task
{task}

{context_section}

## MANDATORY: Beads Issue Tracking

**Every subtask MUST become a bead.** This is non-negotiable.

After decomposition, the coordinator will:
1. Create an epic bead for the overall task
2. Create child cells for each subtask
3. Track progress through bead status updates
4. Close cells with summaries when complete

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
    title: string,        // Epic title for the hive tracker
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
const STRATEGY_DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a swarm of agents.

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
2. Create child cells for each subtask
3. Track progress through bead status updates
4. Close cells with summaries when complete

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
    title: string,        // Epic title for the hive tracker
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

// ============================================================================
// Conflict Detection
// ============================================================================

/**
 * A detected conflict between subtask instructions
 */
export interface InstructionConflict {
  subtask_a: number;
  subtask_b: number;
  directive_a: string;
  directive_b: string;
  conflict_type: "positive_negative" | "contradictory";
  description: string;
}

/**
 * Extract directives from text based on marker words
 */
function extractDirectives(text: string): {
  positive: string[];
  negative: string[];
} {
  const sentences = text.split(/[.!?\n]+/).map((s) => s.trim().toLowerCase());
  const positive: string[] = [];
  const negative: string[] = [];

  for (const sentence of sentences) {
    if (!sentence) continue;

    const hasPositive = POSITIVE_MARKERS.some((m) => sentence.includes(m));
    const hasNegative = NEGATIVE_MARKERS.some((m) => sentence.includes(m));

    if (hasPositive && !hasNegative) {
      positive.push(sentence);
    } else if (hasNegative) {
      negative.push(sentence);
    }
  }

  return { positive, negative };
}

/**
 * Check if two directives conflict
 *
 * Simple heuristic: look for common subjects with opposite polarity
 */
function directivesConflict(positive: string, negative: string): boolean {
  // Extract key nouns/concepts (simple word overlap check)
  const positiveWords = new Set(
    positive.split(/\s+/).filter((w) => w.length > 3),
  );
  const negativeWords = negative.split(/\s+/).filter((w) => w.length > 3);

  // If they share significant words, they might conflict
  const overlap = negativeWords.filter((w) => positiveWords.has(w));
  return overlap.length >= 2;
}

/**
 * Detect conflicts between subtask instructions
 *
 * Looks for cases where one subtask says "always use X" and another says "avoid X".
 *
 * @param subtasks - Array of subtask descriptions
 * @returns Array of detected conflicts
 *
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/curate.ts#L36-L89
 */
export function detectInstructionConflicts(
  subtasks: Array<{ title: string; description?: string }>,
): InstructionConflict[] {
  const conflicts: InstructionConflict[] = [];

  // Extract directives from each subtask
  const subtaskDirectives = subtasks.map((s, i) => ({
    index: i,
    title: s.title,
    ...extractDirectives(`${s.title} ${s.description || ""}`),
  }));

  // Compare each pair of subtasks
  for (let i = 0; i < subtaskDirectives.length; i++) {
    for (let j = i + 1; j < subtaskDirectives.length; j++) {
      const a = subtaskDirectives[i];
      const b = subtaskDirectives[j];

      // Check if A's positive conflicts with B's negative
      for (const posA of a.positive) {
        for (const negB of b.negative) {
          if (directivesConflict(posA, negB)) {
            conflicts.push({
              subtask_a: i,
              subtask_b: j,
              directive_a: posA,
              directive_b: negB,
              conflict_type: "positive_negative",
              description: `Subtask ${i} says "${posA}" but subtask ${j} says "${negB}"`,
            });
          }
        }
      }

      // Check if B's positive conflicts with A's negative
      for (const posB of b.positive) {
        for (const negA of a.negative) {
          if (directivesConflict(posB, negA)) {
            conflicts.push({
              subtask_a: j,
              subtask_b: i,
              directive_a: posB,
              directive_b: negA,
              conflict_type: "positive_negative",
              description: `Subtask ${j} says "${posB}" but subtask ${i} says "${negA}"`,
            });
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detect file conflicts in a bead tree
 *
 * @param subtasks - Array of subtasks with file assignments
 * @returns Array of files that appear in multiple subtasks
 */
export function detectFileConflicts(
  subtasks: Array<{ files: string[] }>,
): string[] {
  const allFiles = new Map<string, number>();
  const conflicts: string[] = [];

  for (const subtask of subtasks) {
    for (const file of subtask.files) {
      const count = allFiles.get(file) || 0;
      allFiles.set(file, count + 1);
      if (count === 1) {
        // Second occurrence - it's a conflict
        conflicts.push(file);
      }
    }
  }

  return conflicts;
}

// ============================================================================
// CASS History Integration
// ============================================================================

/**
 * CASS search result from similar past tasks
 */
interface CassSearchResult {
  query: string;
  results: Array<{
    source_path: string;
    line: number;
    agent: string;
    preview: string;
    score: number;
  }>;
}

/**
 * CASS query result with status
 */
type CassQueryResult =
  | { status: "unavailable" }
  | { status: "failed"; error?: string }
  | { status: "empty"; query: string }
  | { status: "success"; data: CassSearchResult };

/**
 * Query CASS for similar past tasks
 *
 * @param task - Task description to search for
 * @param limit - Maximum results to return
 * @returns Structured result with status indicator
 */
async function queryCassHistory(
  task: string,
  limit: number = 3,
): Promise<CassQueryResult> {
  // Check if CASS is available
  try {
    const result = await Bun.$`cass search ${task} --limit ${limit} --json`
      .quiet()
      .nothrow();

    if (result.exitCode !== 0) {
      const error = result.stderr.toString();
      console.warn(
        `[swarm] CASS search failed (exit ${result.exitCode}):`,
        error,
      );
      return { status: "failed", error };
    }

    const output = result.stdout.toString();
    if (!output.trim()) {
      return { status: "empty", query: task };
    }

    try {
      const parsed = JSON.parse(output);
      const searchResult: CassSearchResult = {
        query: task,
        results: Array.isArray(parsed) ? parsed : parsed.results || [],
      };

      if (searchResult.results.length === 0) {
        return { status: "empty", query: task };
      }

      return { status: "success", data: searchResult };
    } catch (error) {
      console.warn(`[swarm] Failed to parse CASS output:`, error);
      return { status: "failed", error: String(error) };
    }
  } catch (error) {
    console.error(`[swarm] CASS query error:`, error);
    return { status: "unavailable" };
  }
}

/**
 * Format CASS history for inclusion in decomposition prompt
 */
function formatCassHistoryForPrompt(history: CassSearchResult): string {
  if (history.results.length === 0) {
    return "";
  }

  const lines = [
    "## Similar Past Tasks",
    "",
    "These similar tasks were found in agent history:",
    "",
    ...history.results.slice(0, 3).map((r, i) => {
      const preview = r.preview.slice(0, 200).replace(/\n/g, " ");
      return `${i + 1}. [${r.agent}] ${preview}...`;
    }),
    "",
    "Consider patterns that worked in these past tasks.",
    "",
  ];

  return lines.join("\n");
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Decompose a task into a bead tree
 *
 * This is a PROMPT tool - it returns a prompt for the agent to respond to.
 * The agent's response (JSON) should be validated with CellTreeSchema.
 *
 * Optionally queries CASS for similar past tasks to inform decomposition.
 */
export const swarm_decompose = tool({
  description:
    "Generate decomposition prompt for breaking task into parallelizable subtasks. Optionally queries CASS for similar past tasks.",
  args: {
    task: tool.schema.string().min(1).describe("Task description to decompose"),
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
  },
  async execute(args) {
    // Import needed modules
    const { formatMemoryQueryForDecomposition } = await import("./learning");

    // Query CASS for similar past tasks
    let cassContext = "";
    let cassResultInfo: {
      queried: boolean;
      results_found?: number;
      included_in_context?: boolean;
      reason?: string;
    };

    if (args.query_cass !== false) {
      const cassResult = await queryCassHistory(
        args.task,
        args.cass_limit ?? 3,
      );
      if (cassResult.status === "success") {
        cassContext = formatCassHistoryForPrompt(cassResult.data);
        cassResultInfo = {
          queried: true,
          results_found: cassResult.data.results.length,
          included_in_context: true,
        };
      } else {
        cassResultInfo = {
          queried: true,
          results_found: 0,
          included_in_context: false,
          reason: cassResult.status,
        };
      }
    } else {
      cassResultInfo = { queried: false, reason: "disabled" };
    }

    // Combine user context with CASS history
    const fullContext = [args.context, cassContext]
      .filter(Boolean)
      .join("\n\n");

    // Format the decomposition prompt
    const contextSection = fullContext
      ? `## Additional Context\n${fullContext}`
      : "## Additional Context\n(none provided)";

    const prompt = DECOMPOSITION_PROMPT.replace("{task}", args.task)
      .replace("{max_subtasks}", (args.max_subtasks ?? 5).toString())
      .replace("{context_section}", contextSection);

    // Return the prompt and schema info for the caller
    return JSON.stringify(
      {
        prompt,
        expected_schema: "CellTree",
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
          "Parse agent response as JSON and validate with CellTreeSchema from schemas/bead.ts",
        cass_history: cassResultInfo,
        // Add semantic-memory query instruction
        memory_query: formatMemoryQueryForDecomposition(args.task, 3),
      },
      null,
      2,
    );
  },
});

/**
 * Validate a decomposition response from an agent
 *
 * Use this after the agent responds to swarm:decompose to validate the structure.
 */
export const swarm_validate_decomposition = tool({
  description: "Validate a decomposition response against CellTreeSchema",
  args: {
    response: tool.schema
      .string()
      .describe("JSON response from agent (CellTree format)"),
  },
  async execute(args) {
    try {
      const parsed = JSON.parse(args.response);
      const validated = CellTreeSchema.parse(parsed);

      // Additional validation: check for file conflicts
      const conflicts = detectFileConflicts(validated.subtasks);

      if (conflicts.length > 0) {
        return JSON.stringify(
          {
            valid: false,
            error: `File conflicts detected: ${conflicts.join(", ")}`,
            hint: "Each file can only be assigned to one subtask",
          },
          null,
          2,
        );
      }

      // Check dependency indices are valid
      for (let i = 0; i < validated.subtasks.length; i++) {
        const deps = validated.subtasks[i].dependencies;
        for (const dep of deps) {
          // Check bounds first
          if (dep < 0 || dep >= validated.subtasks.length) {
            return JSON.stringify(
              {
                valid: false,
                error: `Invalid dependency: subtask ${i} depends on ${dep}, but only ${validated.subtasks.length} subtasks exist (indices 0-${validated.subtasks.length - 1})`,
                hint: "Dependency index is out of bounds",
              },
              null,
              2,
            );
          }
          // Check forward references
          if (dep >= i) {
            return JSON.stringify(
              {
                valid: false,
                error: `Invalid dependency: subtask ${i} depends on ${dep}, but dependencies must be earlier in the array`,
                hint: "Reorder subtasks so dependencies come before dependents",
              },
              null,
              2,
            );
          }
        }
      }

      // Check for instruction conflicts between subtasks
      const instructionConflicts = detectInstructionConflicts(
        validated.subtasks,
      );

      return JSON.stringify(
        {
          valid: true,
          cell_tree: validated,
          stats: {
            subtask_count: validated.subtasks.length,
            total_files: new Set(validated.subtasks.flatMap((s) => s.files))
              .size,
            total_complexity: validated.subtasks.reduce(
              (sum, s) => sum + s.estimated_complexity,
              0,
            ),
          },
          // Include conflicts as warnings (not blocking)
          warnings:
            instructionConflicts.length > 0
              ? {
                  instruction_conflicts: instructionConflicts,
                  hint: "Review these potential conflicts between subtask instructions",
                }
              : undefined,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return JSON.stringify(
          {
            valid: false,
            error: "Schema validation failed",
            details: error.issues,
          },
          null,
          2,
        );
      }
      if (error instanceof SyntaxError) {
        return JSON.stringify(
          {
            valid: false,
            error: "Invalid JSON",
            details: error.message,
          },
          null,
          2,
        );
      }
      throw error;
    }
  },
});

/**
 * Delegate task decomposition to a swarm/planner subagent
 *
 * Returns a prompt for spawning a planner agent that will handle all decomposition
 * reasoning. This keeps the coordinator context lean by offloading:
 * - Strategy selection
 * - CASS queries
 * - Skills discovery
 * - File analysis
 * - CellTree generation
 *
 * The planner returns ONLY structured CellTree JSON, which the coordinator
 * validates and uses to create cells.
 *
 * @example
 * ```typescript
 * // Coordinator workflow:
 * const delegateResult = await swarm_delegate_planning({
 *   task: "Add user authentication",
 *   context: "Next.js 14 app",
 * });
 *
 * // Parse the result
 * const { prompt, subagent_type } = JSON.parse(delegateResult);
 *
 * // Spawn subagent using Task tool
 * const plannerResponse = await Task(prompt, subagent_type);
 *
 * // Validate the response
 * await swarm_validate_decomposition({ response: plannerResponse });
 * ```
 */
export const swarm_delegate_planning = tool({
  description:
    "Delegate task decomposition to a swarm/planner subagent. Returns a prompt to spawn the planner. Use this to keep coordinator context lean - all planning reasoning happens in the subagent.",
  args: {
    task: tool.schema.string().min(1).describe("The task to decompose"),
    context: tool.schema
      .string()
      .optional()
      .describe("Additional context to include"),
    max_subtasks: tool.schema
      .number()
      .int()
      .min(2)
      .max(10)
      .optional()
      .default(5)
      .describe("Maximum number of subtasks (default: 5)"),
    strategy: tool.schema
      .enum(["auto", "file-based", "feature-based", "risk-based"])
      .optional()
      .default("auto")
      .describe("Decomposition strategy (default: auto-detect)"),
    query_cass: tool.schema
      .boolean()
      .optional()
      .default(true)
      .describe("Query CASS for similar past tasks (default: true)"),
  },
  async execute(args) {
    // Import needed modules
    const { selectStrategy, formatStrategyGuidelines } =
      await import("./swarm-strategies");
    const { formatMemoryQueryForDecomposition } = await import("./learning");
    const { listSkills, getSkillsContextForSwarm, findRelevantSkills } =
      await import("./skills");

    // Select strategy
    let selectedStrategy: Exclude<DecompositionStrategy, "auto">;
    let strategyReasoning: string;

    if (args.strategy && args.strategy !== "auto") {
      selectedStrategy = args.strategy;
      strategyReasoning = `User-specified strategy: ${selectedStrategy}`;
    } else {
      const selection = selectStrategy(args.task);
      selectedStrategy = selection.strategy;
      strategyReasoning = selection.reasoning;
    }

    // Query CASS for similar past tasks
    let cassContext = "";
    let cassResultInfo: {
      queried: boolean;
      results_found?: number;
      included_in_context?: boolean;
      reason?: string;
    };

    if (args.query_cass !== false) {
      const cassResult = await queryCassHistory(args.task, 3);
      if (cassResult.status === "success") {
        cassContext = formatCassHistoryForPrompt(cassResult.data);
        cassResultInfo = {
          queried: true,
          results_found: cassResult.data.results.length,
          included_in_context: true,
        };
      } else {
        cassResultInfo = {
          queried: true,
          results_found: 0,
          included_in_context: false,
          reason: cassResult.status,
        };
      }
    } else {
      cassResultInfo = { queried: false, reason: "disabled" };
    }

    // Fetch skills context
    let skillsContext = "";
    let skillsInfo: { included: boolean; count?: number; relevant?: string[] } =
      {
        included: false,
      };

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

    // Format strategy guidelines
    const strategyGuidelines = formatStrategyGuidelines(selectedStrategy);

    // Combine user context
    const contextSection = args.context
      ? `## Additional Context\n${args.context}`
      : "## Additional Context\n(none provided)";

    // Build the planning prompt with clear instructions for JSON-only output
    const planningPrompt = STRATEGY_DECOMPOSITION_PROMPT.replace(
      "{task}",
      args.task,
    )
      .replace("{strategy_guidelines}", strategyGuidelines)
      .replace("{context_section}", contextSection)
      .replace("{cass_history}", cassContext || "")
      .replace("{skills_context}", skillsContext || "")
      .replace("{max_subtasks}", (args.max_subtasks ?? 5).toString());

    // Add strict JSON-only instructions for the subagent
    const subagentInstructions = `
## CRITICAL: Output Format

You are a planner subagent. Your ONLY output must be valid JSON matching the CellTree schema.

DO NOT include:
- Explanatory text before or after the JSON
- Markdown code fences (\`\`\`json)
- Commentary or reasoning

OUTPUT ONLY the raw JSON object.

## Example Output

{
  "epic": {
    "title": "Add user authentication",
    "description": "Implement OAuth-based authentication system"
  },
  "subtasks": [
    {
      "title": "Set up OAuth provider",
      "description": "Configure OAuth client credentials and redirect URLs",
      "files": ["src/auth/oauth.ts", "src/config/auth.ts"],
      "dependencies": [],
      "estimated_complexity": 2
    },
    {
      "title": "Create auth routes",
      "description": "Implement login, logout, and callback routes",
      "files": ["src/app/api/auth/[...nextauth]/route.ts"],
      "dependencies": [0],
      "estimated_complexity": 3
    }
  ]
}

Now generate the CellTree for the given task.`;

    const fullPrompt = `${planningPrompt}\n\n${subagentInstructions}`;

    // Return structured output for coordinator
    return JSON.stringify(
      {
        prompt: fullPrompt,
        subagent_type: "swarm/planner",
        description: "Task decomposition planning",
        strategy: {
          selected: selectedStrategy,
          reasoning: strategyReasoning,
        },
        expected_output: "CellTree JSON (raw JSON, no markdown)",
        next_steps: [
          "1. Spawn subagent with Task tool using returned prompt",
          "2. Parse subagent response as JSON",
          "3. Validate with swarm_validate_decomposition",
          "4. Create cells with hive_create_epic",
        ],
        cass_history: cassResultInfo,
        skills: skillsInfo,
        // Add semantic-memory query instruction
        memory_query: formatMemoryQueryForDecomposition(args.task, 3),
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Errors
// ============================================================================

export class SwarmError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SwarmError";
  }
}

export class DecompositionError extends SwarmError {
  constructor(
    message: string,
    public readonly zodError?: z.ZodError,
  ) {
    super(message, "decompose", zodError?.issues);
  }
}

/**
 * Planning phase state machine for Socratic planning
 */
type PlanningPhase = "questioning" | "alternatives" | "recommendation" | "ready";

/**
 * Planning mode that determines interaction level
 */
type PlanningMode = "socratic" | "fast" | "auto" | "confirm-only";

/**
 * Socratic planning output structure
 */
interface SocraticPlanOutput {
  mode: PlanningMode;
  phase: PlanningPhase;
  questions?: Array<{ question: string; options?: string[] }>;
  alternatives?: Array<{
    name: string;
    description: string;
    tradeoffs: string;
  }>;
  recommendation?: { approach: string; reasoning: string };
  memory_context?: string;
  codebase_context?: {
    git_status?: string;
    relevant_files?: string[];
  };
  ready_to_decompose: boolean;
  next_action?: string;
}

/**
 * Interactive planning tool with Socratic questioning
 *
 * Implements a planning phase BEFORE decomposition that:
 * 1. Gathers context (git, files, semantic memory)
 * 2. Asks clarifying questions (socratic mode)
 * 3. Explores alternatives with tradeoffs
 * 4. Recommends an approach with reasoning
 * 5. Confirms before proceeding to decomposition
 *
 * Modes:
 * - socratic: Full interactive planning with questions, alternatives, recommendations
 * - fast: Skip brainstorming, go straight to decomposition with memory context
 * - auto: Auto-select best approach based on task keywords, minimal interaction
 * - confirm-only: Show decomposition, wait for yes/no confirmation
 *
 * Based on the Socratic Planner Pattern from obra/superpowers.
 *
 * @see docs/analysis-socratic-planner-pattern.md
 */
export const swarm_plan_interactive = tool({
  description:
    "Interactive planning phase with Socratic questioning before decomposition. Supports multiple modes from full interactive to auto-proceed.",
  args: {
    task: tool.schema.string().min(1).describe("The task to plan"),
    mode: tool.schema
      .enum(["socratic", "fast", "auto", "confirm-only"])
      .default("socratic")
      .describe("Planning mode: socratic (full), fast (skip questions), auto (minimal), confirm-only (single yes/no)"),
    context: tool.schema
      .string()
      .optional()
      .describe("Optional additional context about the task"),
    user_response: tool.schema
      .string()
      .optional()
      .describe("User's response to a previous question (for multi-turn socratic mode)"),
    phase: tool.schema
      .enum(["questioning", "alternatives", "recommendation", "ready"])
      .optional()
      .describe("Current planning phase (for resuming multi-turn interaction)"),
  },
  async execute(args): Promise<string> {
    // Import needed modules
    const { selectStrategy, formatStrategyGuidelines, STRATEGIES } =
      await import("./swarm-strategies");
    const { formatMemoryQueryForDecomposition } = await import("./learning");

    // Determine current phase
    const currentPhase: PlanningPhase = args.phase || "questioning";
    const mode: PlanningMode = args.mode || "socratic";

    // Gather context - always do this regardless of mode
    let memoryContext = "";
    let codebaseContext: { git_status?: string; relevant_files?: string[] } = {};

    // Generate semantic memory query instruction
    // Note: Semantic memory is accessed via OpenCode's global tools, not as a direct import
    // The coordinator should call semantic-memory_find before calling this tool
    // and pass results in the context parameter
    try {
      const memoryQuery = formatMemoryQueryForDecomposition(args.task, 3);
      memoryContext = `[Memory Query Instruction]\n${memoryQuery.instruction}\nQuery: "${memoryQuery.query}"\nLimit: ${memoryQuery.limit}`;
    } catch (error) {
      console.warn("[swarm_plan_interactive] Memory query formatting failed:", error);
    }

    // Get git context for codebase awareness
    try {
      const gitResult = await Bun.$`git status --short`.quiet().nothrow();
      if (gitResult.exitCode === 0) {
        codebaseContext.git_status = gitResult.stdout.toString().trim();
      }
    } catch (error) {
      // Git not available or not in a git repo - continue without it
    }

    // Fast mode: Skip to recommendation
    if (mode === "fast") {
      const strategyResult = selectStrategy(args.task);
      const guidelines = formatStrategyGuidelines(strategyResult.strategy);

      const output: SocraticPlanOutput = {
        mode: "fast",
        phase: "ready",
        recommendation: {
          approach: strategyResult.strategy,
          reasoning: `${strategyResult.reasoning}\n\n${guidelines}`,
        },
        memory_context: memoryContext || undefined,
        codebase_context: Object.keys(codebaseContext).length > 0 ? codebaseContext : undefined,
        ready_to_decompose: true,
        next_action: "Proceed to swarm_decompose or swarm_delegate_planning",
      };

      return JSON.stringify(output, null, 2);
    }

    // Auto mode: Auto-select and proceed
    if (mode === "auto") {
      const strategyResult = selectStrategy(args.task);

      const output: SocraticPlanOutput = {
        mode: "auto",
        phase: "ready",
        recommendation: {
          approach: strategyResult.strategy,
          reasoning: `Auto-selected based on task keywords: ${strategyResult.reasoning}`,
        },
        memory_context: memoryContext || undefined,
        codebase_context: Object.keys(codebaseContext).length > 0 ? codebaseContext : undefined,
        ready_to_decompose: true,
        next_action: "Auto-proceeding to decomposition",
      };

      return JSON.stringify(output, null, 2);
    }

    // Confirm-only mode: Generate decomposition, show it, wait for yes/no
    if (mode === "confirm-only") {
      // This mode will be handled by calling swarm_delegate_planning
      // and then asking for confirmation on the result
      const output: SocraticPlanOutput = {
        mode: "confirm-only",
        phase: "ready",
        recommendation: {
          approach: "Will generate decomposition for your review",
          reasoning: "Use swarm_delegate_planning to generate the plan, then present it for yes/no confirmation",
        },
        memory_context: memoryContext || undefined,
        codebase_context: Object.keys(codebaseContext).length > 0 ? codebaseContext : undefined,
        ready_to_decompose: false,
        next_action: "Call swarm_delegate_planning, then show result and ask for confirmation",
      };

      return JSON.stringify(output, null, 2);
    }

    // Socratic mode: Full interactive planning
    // Phase 1: Questioning
    if (currentPhase === "questioning") {
      // Analyze task to identify what needs clarification
      const taskLower = args.task.toLowerCase();
      const questions: Array<{ question: string; options?: string[] }> = [];

      // Check for vague task signals from skill
      const isVague = {
        noFiles: !taskLower.includes("src/") && !taskLower.includes("file"),
        vagueVerb:
          taskLower.includes("improve") ||
          taskLower.includes("fix") ||
          taskLower.includes("update") ||
          taskLower.includes("make better"),
        noSuccessCriteria: !taskLower.includes("test") && !taskLower.includes("verify"),
      };

      // Generate clarifying questions (one at a time)
      if (isVague.noFiles) {
        questions.push({
          question: "Which part of the codebase should this change affect?",
          options: [
            "Core functionality (src/)",
            "UI components (components/)",
            "API routes (app/api/)",
            "Configuration and tooling",
            "Tests",
          ],
        });
      } else if (isVague.vagueVerb) {
        questions.push({
          question: "What specific change are you looking for?",
          options: [
            "Add new functionality",
            "Modify existing behavior",
            "Remove/deprecate something",
            "Refactor without behavior change",
            "Fix a bug",
          ],
        });
      } else if (isVague.noSuccessCriteria) {
        questions.push({
          question: "How will we know this task is complete?",
          options: [
            "All tests pass",
            "Feature works as demonstrated",
            "Code review approved",
            "Documentation updated",
            "Performance target met",
          ],
        });
      }

      // If task seems clear, move to alternatives phase
      if (questions.length === 0) {
        const output: SocraticPlanOutput = {
          mode: "socratic",
          phase: "alternatives",
          memory_context: memoryContext || undefined,
          codebase_context: Object.keys(codebaseContext).length > 0 ? codebaseContext : undefined,
          ready_to_decompose: false,
          next_action: "Task is clear. Call again with phase=alternatives to explore approaches",
        };
        return JSON.stringify(output, null, 2);
      }

      // Return first question only (Socratic principle: one at a time)
      const output: SocraticPlanOutput = {
        mode: "socratic",
        phase: "questioning",
        questions: [questions[0]],
        memory_context: memoryContext || undefined,
        codebase_context: Object.keys(codebaseContext).length > 0 ? codebaseContext : undefined,
        ready_to_decompose: false,
        next_action: "User should answer this question, then call again with user_response",
      };

      return JSON.stringify(output, null, 2);
    }

    // Phase 2: Alternatives
    if (currentPhase === "alternatives") {
      const strategyResult = selectStrategy(args.task);

      // Build 2-3 alternative approaches
      const alternatives: Array<{
        name: string;
        description: string;
        tradeoffs: string;
      }> = [];

      // Primary recommendation
      alternatives.push({
        name: strategyResult.strategy,
        description: strategyResult.reasoning,
        tradeoffs: `Confidence: ${(strategyResult.confidence * 100).toFixed(0)}%. ${STRATEGIES[strategyResult.strategy].description}`,
      });

      // Add top 2 alternatives
      for (let i = 0; i < Math.min(2, strategyResult.alternatives.length); i++) {
        const alt = strategyResult.alternatives[i];
        alternatives.push({
          name: alt.strategy,
          description: STRATEGIES[alt.strategy].description,
          tradeoffs: `Match score: ${alt.score}. ${STRATEGIES[alt.strategy].antiPatterns[0] || "Consider trade-offs carefully"}`,
        });
      }

      const output: SocraticPlanOutput = {
        mode: "socratic",
        phase: "alternatives",
        alternatives,
        memory_context: memoryContext || undefined,
        codebase_context: Object.keys(codebaseContext).length > 0 ? codebaseContext : undefined,
        ready_to_decompose: false,
        next_action: "User should choose an approach, then call again with phase=recommendation",
      };

      return JSON.stringify(output, null, 2);
    }

    // Phase 3: Recommendation
    if (currentPhase === "recommendation") {
      const strategyResult = selectStrategy(args.task);
      const guidelines = formatStrategyGuidelines(strategyResult.strategy);

      const output: SocraticPlanOutput = {
        mode: "socratic",
        phase: "recommendation",
        recommendation: {
          approach: strategyResult.strategy,
          reasoning: `Based on your input and task analysis:\n\n${strategyResult.reasoning}\n\n${guidelines}`,
        },
        memory_context: memoryContext || undefined,
        codebase_context: Object.keys(codebaseContext).length > 0 ? codebaseContext : undefined,
        ready_to_decompose: false,
        next_action: "User should confirm to proceed. Then call again with phase=ready",
      };

      return JSON.stringify(output, null, 2);
    }

    // Phase 4: Ready
    if (currentPhase === "ready") {
      const output: SocraticPlanOutput = {
        mode: "socratic",
        phase: "ready",
        recommendation: {
          approach: "Confirmed by user",
          reasoning: "Ready to proceed with decomposition",
        },
        memory_context: memoryContext || undefined,
        codebase_context: Object.keys(codebaseContext).length > 0 ? codebaseContext : undefined,
        ready_to_decompose: true,
        next_action: "Proceed to swarm_decompose or swarm_delegate_planning",
      };

      return JSON.stringify(output, null, 2);
    }

    // Should never reach here
    throw new Error(`Invalid planning phase: ${currentPhase}`);
  },
});

export const decomposeTools = {
  swarm_decompose,
  swarm_validate_decomposition,
  swarm_delegate_planning,
  swarm_plan_interactive,
};
