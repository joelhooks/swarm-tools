/**
 * Swarm Module - High-level swarm coordination
 *
 * Orchestrates beads, Agent Mail, and structured validation for parallel task execution.
 * The actual agent spawning happens via OpenCode's Task tool - this module provides
 * the primitives and prompts that /swarm command uses.
 *
 * Key responsibilities:
 * - Task decomposition into bead trees with file assignments
 * - Swarm status tracking via beads + Agent Mail
 * - Progress reporting and completion handling
 * - Prompt templates for decomposition, subtasks, and evaluation
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  BeadTreeSchema,
  SwarmStatusSchema,
  AgentProgressSchema,
  EvaluationSchema,
  BeadSchema,
  type SwarmStatus,
  type AgentProgress,
  type Evaluation,
  type SpawnedAgent,
  type Bead,
} from "./schemas";
import { mcpCall, requireState } from "./agent-mail";
import {
  OutcomeSignalsSchema,
  DecompositionStrategySchema,
  scoreImplicitFeedback,
  outcomeToFeedback,
  ErrorAccumulator,
  ErrorEntrySchema,
  type OutcomeSignals,
  type ScoredOutcome,
  type FeedbackEvent,
  type ErrorEntry,
  type ErrorType,
  type DecompositionStrategy as LearningDecompositionStrategy,
  DEFAULT_LEARNING_CONFIG,
} from "./learning";
import {
  isToolAvailable,
  warnMissingTool,
  checkAllTools,
  formatToolAvailability,
  type ToolName,
} from "./tool-availability";

// ============================================================================
// Conflict Detection
// ============================================================================

/**
 * Marker words that indicate positive directives
 */
const POSITIVE_MARKERS = [
  "always",
  "must",
  "required",
  "ensure",
  "use",
  "prefer",
];

/**
 * Marker words that indicate negative directives
 */
const NEGATIVE_MARKERS = [
  "never",
  "dont",
  "don't",
  "avoid",
  "forbid",
  "no ",
  "not ",
];

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

// ============================================================================
// Strategy Definitions
// ============================================================================

/**
 * Decomposition strategy types
 */
export type DecompositionStrategy =
  | "file-based"
  | "feature-based"
  | "risk-based"
  | "research-based"
  | "auto";

/**
 * Strategy definition with keywords, guidelines, and anti-patterns
 */
export interface StrategyDefinition {
  name: DecompositionStrategy;
  description: string;
  keywords: string[];
  guidelines: string[];
  antiPatterns: string[];
  examples: string[];
}

/**
 * Strategy definitions for task decomposition
 */
export const STRATEGIES: Record<
  Exclude<DecompositionStrategy, "auto">,
  StrategyDefinition
> = {
  "file-based": {
    name: "file-based",
    description:
      "Group by file type or directory. Best for refactoring, migrations, and pattern changes across codebase.",
    keywords: [
      "refactor",
      "migrate",
      "update all",
      "rename",
      "replace",
      "convert",
      "upgrade",
      "deprecate",
      "remove",
      "cleanup",
      "lint",
      "format",
    ],
    guidelines: [
      "Group files by directory or type (e.g., all components, all tests)",
      "Minimize cross-directory dependencies within a subtask",
      "Handle shared types/utilities first if they change",
      "Each subtask should be a complete transformation of its file set",
      "Consider import/export relationships when grouping",
    ],
    antiPatterns: [
      "Don't split tightly coupled files across subtasks",
      "Don't group files that have no relationship",
      "Don't forget to update imports when moving/renaming",
    ],
    examples: [
      "Migrate all components to new API → split by component directory",
      "Rename userId to accountId → split by module (types first, then consumers)",
      "Update all tests to use new matcher → split by test directory",
    ],
  },
  "feature-based": {
    name: "feature-based",
    description:
      "Vertical slices with UI + API + data. Best for new features and adding functionality.",
    keywords: [
      "add",
      "implement",
      "build",
      "create",
      "feature",
      "new",
      "integrate",
      "connect",
      "enable",
      "support",
    ],
    guidelines: [
      "Each subtask is a complete vertical slice (UI + logic + data)",
      "Start with data layer/types, then logic, then UI",
      "Keep related components together (form + validation + submission)",
      "Separate concerns that can be developed independently",
      "Consider user-facing features as natural boundaries",
    ],
    antiPatterns: [
      "Don't split a single feature across multiple subtasks",
      "Don't create subtasks that can't be tested independently",
      "Don't forget integration points between features",
    ],
    examples: [
      "Add user auth → [OAuth setup, Session management, Protected routes]",
      "Build dashboard → [Data fetching, Chart components, Layout/navigation]",
      "Add search → [Search API, Search UI, Results display]",
    ],
  },
  "risk-based": {
    name: "risk-based",
    description:
      "Isolate high-risk changes, add tests first. Best for bug fixes, security issues, and critical changes.",
    keywords: [
      "fix",
      "bug",
      "security",
      "vulnerability",
      "critical",
      "urgent",
      "hotfix",
      "patch",
      "audit",
      "review",
    ],
    guidelines: [
      "Write tests FIRST to capture expected behavior",
      "Isolate the risky change to minimize blast radius",
      "Add monitoring/logging around the change",
      "Create rollback plan as part of the task",
      "Audit similar code for the same issue",
    ],
    antiPatterns: [
      "Don't make multiple risky changes in one subtask",
      "Don't skip tests for 'simple' fixes",
      "Don't forget to check for similar issues elsewhere",
    ],
    examples: [
      "Fix auth bypass → [Add regression test, Fix vulnerability, Audit similar endpoints]",
      "Fix race condition → [Add test reproducing issue, Implement fix, Add concurrency tests]",
      "Security audit → [Scan for vulnerabilities, Fix critical issues, Document remaining risks]",
    ],
  },
  "research-based": {
    name: "research-based",
    description:
      "Parallel search across multiple sources, then synthesize. Best for investigation, learning, and discovery tasks.",
    keywords: [
      "research",
      "investigate",
      "explore",
      "find out",
      "discover",
      "understand",
      "learn about",
      "analyze",
      "what is",
      "what are",
      "how does",
      "how do",
      "why does",
      "why do",
      "compare",
      "evaluate",
      "study",
      "look up",
      "look into",
      "search for",
      "dig into",
      "figure out",
      "debug options",
      "debug levers",
      "configuration options",
      "environment variables",
      "available options",
      "documentation",
    ],
    guidelines: [
      "Split by information source (PDFs, repos, history, web)",
      "Each agent searches with different query angles",
      "Include a synthesis subtask that depends on all search subtasks",
      "Use pdf-brain for documentation/books if available",
      "Use repo-crawl for GitHub repos if URL provided",
      "Use cass for past agent session history",
      "Assign NO files to research subtasks (read-only)",
    ],
    antiPatterns: [
      "Don't have one agent search everything sequentially",
      "Don't skip synthesis - raw search results need consolidation",
      "Don't forget to check tool availability before assigning sources",
    ],
    examples: [
      "Research auth patterns → [Search PDFs, Search repos, Search history, Synthesize]",
      "Investigate error → [Search cass for similar errors, Search repo for error handling, Synthesize]",
      "Learn about library → [Search docs, Search examples, Search issues, Synthesize findings]",
    ],
  },
};

/**
 * Analyze task description and select best decomposition strategy
 *
 * @param task - Task description
 * @returns Selected strategy with reasoning
 */
export function selectStrategy(task: string): {
  strategy: Exclude<DecompositionStrategy, "auto">;
  confidence: number;
  reasoning: string;
  alternatives: Array<{
    strategy: Exclude<DecompositionStrategy, "auto">;
    score: number;
  }>;
} {
  const taskLower = task.toLowerCase();

  // Score each strategy based on keyword matches
  const scores: Record<Exclude<DecompositionStrategy, "auto">, number> = {
    "file-based": 0,
    "feature-based": 0,
    "risk-based": 0,
    "research-based": 0,
  };

  for (const [strategyName, definition] of Object.entries(STRATEGIES)) {
    const name = strategyName as Exclude<DecompositionStrategy, "auto">;
    for (const keyword of definition.keywords) {
      // Use word boundary matching to avoid "debug" matching "bug"
      // For multi-word keywords, just check includes (they're specific enough)
      if (keyword.includes(" ")) {
        if (taskLower.includes(keyword)) {
          scores[name] += 1;
        }
      } else {
        // Single word: use word boundary regex
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(taskLower)) {
          scores[name] += 1;
        }
      }
    }
  }

  // Find the winner
  const entries = Object.entries(scores) as Array<
    [Exclude<DecompositionStrategy, "auto">, number]
  >;
  entries.sort((a, b) => b[1] - a[1]);

  const [winner, winnerScore] = entries[0];
  const [runnerUp, runnerUpScore] = entries[1] || [null, 0];

  // Calculate confidence based on margin
  const totalScore = entries.reduce((sum, [, score]) => sum + score, 0);
  const confidence =
    totalScore > 0
      ? Math.min(0.95, 0.5 + (winnerScore - runnerUpScore) / totalScore)
      : 0.5; // Default to 50% if no keywords matched

  // Build reasoning
  let reasoning: string;
  if (winnerScore === 0) {
    reasoning = `No strong keyword signals. Defaulting to feature-based as it's most versatile.`;
  } else {
    const matchedKeywords = STRATEGIES[winner].keywords.filter((k) =>
      taskLower.includes(k),
    );
    reasoning = `Matched keywords: ${matchedKeywords.join(", ")}. ${STRATEGIES[winner].description}`;
  }

  // If no keywords matched, default to feature-based
  const finalStrategy = winnerScore === 0 ? "feature-based" : winner;

  return {
    strategy: finalStrategy,
    confidence,
    reasoning,
    alternatives: entries
      .filter(([s]) => s !== finalStrategy)
      .map(([strategy, score]) => ({ strategy, score })),
  };
}

/**
 * Format strategy-specific guidelines for the decomposition prompt
 */
export function formatStrategyGuidelines(
  strategy: Exclude<DecompositionStrategy, "auto">,
): string {
  const def = STRATEGIES[strategy];

  const guidelines = def.guidelines.map((g) => `- ${g}`).join("\n");
  const antiPatterns = def.antiPatterns.map((a) => `- ${a}`).join("\n");
  const examples = def.examples.map((e) => `- ${e}`).join("\n");

  return `## Strategy: ${strategy}

${def.description}

### Guidelines
${guidelines}

### Anti-Patterns (Avoid These)
${antiPatterns}

### Examples
${examples}`;
}

// ============================================================================
// Prompt Templates
// ============================================================================

/**
 * Prompt for decomposing a task into parallelizable subtasks.
 *
 * Used by swarm:decompose to instruct the agent on how to break down work.
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

## MANDATORY: Agent Mail Communication

You MUST communicate with other agents:

1. **Report progress** every significant milestone (not just at the end)
2. **Ask questions** if requirements are unclear - don't guess
3. **Announce blockers** immediately - don't spin trying to fix alone
4. **Coordinate on shared concerns** - if you see something affecting other agents, say so

Use Agent Mail for all communication:
\`\`\`
agentmail_send(
  to: ["coordinator" or specific agent],
  subject: "Brief subject",
  body: "Message content",
  thread_id: "{epic_id}"
)
\`\`\`

## Coordination Protocol

1. **Start**: Your bead is already marked in_progress
2. **Progress**: Use swarm_progress to report status updates
3. **Blocked**: Report immediately via Agent Mail - don't spin
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
4. **Communicate your plan** via Agent Mail if non-trivial

Begin work on your subtask now.`;

/**
 * Streamlined subtask prompt (V2) - still uses Agent Mail and beads
 *
 * This is a cleaner version of SUBTASK_PROMPT that's easier to parse.
 * Agents MUST use Agent Mail for communication and beads for tracking.
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

## [TOOLS]
### Beads
- beads_update (status: blocked)
- beads_create (new bugs)
- beads_close (via swarm_complete)

### Agent Mail
- agentmail_send (thread_id: {epic_id})

### Completion
- swarm_complete (REQUIRED when done)

## [OUTPUT]
1. Read files first
2. Implement changes
3. Verify (typecheck)
4. Complete with swarm_complete

Return: Summary of changes made

**Never work silently.** Communicate progress and blockers immediately.

Begin now.`;

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
}): string {
  const fileList =
    params.files.length > 0
      ? params.files.map((f) => `- \`${f}\``).join("\n")
      : "(no specific files - use judgment)";

  const compressedSection = params.compressed_context
    ? params.compressed_context
    : "";

  const errorSection = params.error_context ? params.error_context : "";

  return SUBTASK_PROMPT_V2.replace(/{bead_id}/g, params.bead_id)
    .replace(/{epic_id}/g, params.epic_id)
    .replace("{subtask_title}", params.subtask_title)
    .replace(
      "{subtask_description}",
      params.subtask_description || "(see title)",
    )
    .replace("{file_list}", fileList)
    .replace("{shared_context}", params.shared_context || "(none)")
    .replace("{compressed_context}", compressedSection)
    .replace("{error_context}", errorSection);
}

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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format the decomposition prompt with actual values
 */
function formatDecompositionPrompt(
  task: string,
  maxSubtasks: number,
  context?: string,
): string {
  const contextSection = context
    ? `## Additional Context\n${context}`
    : "## Additional Context\n(none provided)";

  return DECOMPOSITION_PROMPT.replace("{task}", task)
    .replace("{max_subtasks}", maxSubtasks.toString())
    .replace("{context_section}", contextSection);
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

/**
 * Query beads for subtasks of an epic
 */
async function queryEpicSubtasks(epicId: string): Promise<Bead[]> {
  // Check if beads is available
  const beadsAvailable = await isToolAvailable("beads");
  if (!beadsAvailable) {
    warnMissingTool("beads");
    return []; // Return empty - swarm can still function without status tracking
  }

  const result = await Bun.$`bd list --parent ${epicId} --json`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    // Don't throw - just return empty and warn
    console.warn(
      `[swarm] Failed to query subtasks: ${result.stderr.toString()}`,
    );
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout.toString());
    return z.array(BeadSchema).parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn(`[swarm] Invalid bead data: ${error.message}`);
      return [];
    }
    throw error;
  }
}

/**
 * Query Agent Mail for swarm thread messages
 */
async function querySwarmMessages(
  projectKey: string,
  threadId: string,
): Promise<number> {
  // Check if agent-mail is available
  const agentMailAvailable = await isToolAvailable("agent-mail");
  if (!agentMailAvailable) {
    // Don't warn here - it's checked elsewhere
    return 0;
  }

  try {
    interface ThreadSummary {
      summary: { total_messages: number };
    }
    const summary = await mcpCall<ThreadSummary>("summarize_thread", {
      project_key: projectKey,
      thread_id: threadId,
      llm_mode: false, // Just need the count
    });
    return summary.summary.total_messages;
  } catch {
    // Thread might not exist yet
    return 0;
  }
}

/**
 * Format a progress message for Agent Mail
 */
function formatProgressMessage(progress: AgentProgress): string {
  const lines = [
    `**Status**: ${progress.status}`,
    progress.progress_percent !== undefined
      ? `**Progress**: ${progress.progress_percent}%`
      : null,
    progress.message ? `**Message**: ${progress.message}` : null,
    progress.files_touched && progress.files_touched.length > 0
      ? `**Files touched**:\n${progress.files_touched.map((f) => `- \`${f}\``).join("\n")}`
      : null,
    progress.blockers && progress.blockers.length > 0
      ? `**Blockers**:\n${progress.blockers.map((b) => `- ${b}`).join("\n")}`
      : null,
  ];

  return lines.filter(Boolean).join("\n\n");
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
 * Query CASS for similar past tasks
 *
 * @param task - Task description to search for
 * @param limit - Maximum results to return
 * @returns Search results or null if CASS unavailable
 */
async function queryCassHistory(
  task: string,
  limit: number = 3,
): Promise<CassSearchResult | null> {
  // Check if CASS is available first
  const cassAvailable = await isToolAvailable("cass");
  if (!cassAvailable) {
    warnMissingTool("cass");
    return null;
  }

  try {
    const result = await Bun.$`cass search ${task} --limit ${limit} --json`
      .quiet()
      .nothrow();

    if (result.exitCode !== 0) {
      return null;
    }

    const output = result.stdout.toString();
    if (!output.trim()) {
      return { query: task, results: [] };
    }

    try {
      const parsed = JSON.parse(output);
      return {
        query: task,
        results: Array.isArray(parsed) ? parsed : parsed.results || [],
      };
    } catch {
      return { query: task, results: [] };
    }
  } catch {
    return null;
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
 * Select the best decomposition strategy for a task
 *
 * Analyzes task description and recommends a strategy with reasoning.
 * Use this before swarm_plan_prompt to understand the recommended approach.
 */
export const swarm_select_strategy = tool({
  description:
    "Analyze task and recommend decomposition strategy (file-based, feature-based, or risk-based)",
  args: {
    task: tool.schema.string().min(1).describe("Task description to analyze"),
    codebase_context: tool.schema
      .string()
      .optional()
      .describe("Optional codebase context (file structure, tech stack, etc.)"),
  },
  async execute(args) {
    const result = selectStrategy(args.task);

    // Enhance reasoning with codebase context if provided
    let enhancedReasoning = result.reasoning;
    if (args.codebase_context) {
      enhancedReasoning += `\n\nCodebase context considered: ${args.codebase_context.slice(0, 200)}...`;
    }

    return JSON.stringify(
      {
        strategy: result.strategy,
        confidence: Math.round(result.confidence * 100) / 100,
        reasoning: enhancedReasoning,
        description: STRATEGIES[result.strategy].description,
        guidelines: STRATEGIES[result.strategy].guidelines,
        anti_patterns: STRATEGIES[result.strategy].antiPatterns,
        alternatives: result.alternatives.map((alt) => ({
          strategy: alt.strategy,
          description: STRATEGIES[alt.strategy].description,
          score: alt.score,
        })),
      },
      null,
      2,
    );
  },
});

/**
 * Strategy-specific decomposition prompt template
 */
const STRATEGY_DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a swarm of agents.

## Task
{task}

{strategy_guidelines}

{context_section}

{cass_history}

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
  },
  async execute(args) {
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
    let cassResult: CassSearchResult | null = null;

    if (args.query_cass !== false) {
      cassResult = await queryCassHistory(args.task, args.cass_limit ?? 3);
      if (cassResult && cassResult.results.length > 0) {
        cassContext = formatCassHistoryForPrompt(cassResult);
      }
    }

    // Format strategy guidelines
    const strategyGuidelines = formatStrategyGuidelines(selectedStrategy);

    // Combine user context
    const contextSection = args.context
      ? `## Additional Context\n${args.context}`
      : "## Additional Context\n(none provided)";

    // Build the prompt
    const prompt = STRATEGY_DECOMPOSITION_PROMPT.replace("{task}", args.task)
      .replace("{strategy_guidelines}", strategyGuidelines)
      .replace("{context_section}", contextSection)
      .replace("{cass_history}", cassContext || "")
      .replace("{max_subtasks}", (args.max_subtasks ?? 5).toString());

    return JSON.stringify(
      {
        prompt,
        strategy: {
          selected: selectedStrategy,
          reasoning: strategyReasoning,
          guidelines: STRATEGIES[selectedStrategy].guidelines,
          anti_patterns: STRATEGIES[selectedStrategy].antiPatterns,
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
        cass_history: cassResult
          ? {
              queried: true,
              results_found: cassResult.results.length,
              included_in_context: cassResult.results.length > 0,
            }
          : { queried: false, reason: "disabled or unavailable" },
      },
      null,
      2,
    );
  },
});

/**
 * Decompose a task into a bead tree
 *
 * This is a PROMPT tool - it returns a prompt for the agent to respond to.
 * The agent's response (JSON) should be validated with BeadTreeSchema.
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
    // Query CASS for similar past tasks
    let cassContext = "";
    let cassResult: CassSearchResult | null = null;

    if (args.query_cass !== false) {
      cassResult = await queryCassHistory(args.task, args.cass_limit ?? 3);
      if (cassResult && cassResult.results.length > 0) {
        cassContext = formatCassHistoryForPrompt(cassResult);
      }
    }

    // Combine user context with CASS history
    const fullContext = [args.context, cassContext]
      .filter(Boolean)
      .join("\n\n");

    const prompt = formatDecompositionPrompt(
      args.task,
      args.max_subtasks ?? 5,
      fullContext || undefined,
    );

    // Return the prompt and schema info for the caller
    return JSON.stringify(
      {
        prompt,
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
          "Parse agent response as JSON and validate with BeadTreeSchema from schemas/bead.ts",
        cass_history: cassResult
          ? {
              queried: true,
              results_found: cassResult.results.length,
              included_in_context: cassResult.results.length > 0,
            }
          : { queried: false, reason: "disabled or unavailable" },
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
  description: "Validate a decomposition response against BeadTreeSchema",
  args: {
    response: tool.schema
      .string()
      .describe("JSON response from agent (BeadTree format)"),
  },
  async execute(args) {
    try {
      const parsed = JSON.parse(args.response);
      const validated = BeadTreeSchema.parse(parsed);

      // Additional validation: check for file conflicts
      const allFiles = new Set<string>();
      const conflicts: string[] = [];

      for (const subtask of validated.subtasks) {
        for (const file of subtask.files) {
          if (allFiles.has(file)) {
            conflicts.push(file);
          }
          allFiles.add(file);
        }
      }

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
          bead_tree: validated,
          stats: {
            subtask_count: validated.subtasks.length,
            total_files: allFiles.size,
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
 * Get status of a swarm by epic ID
 *
 * Requires project_key to query Agent Mail for message counts.
 */
export const swarm_status = tool({
  description: "Get status of a swarm by epic ID",
  args: {
    epic_id: tool.schema.string().describe("Epic bead ID (e.g., bd-abc123)"),
    project_key: tool.schema
      .string()
      .describe("Project path (for Agent Mail queries)"),
  },
  async execute(args) {
    // Query subtasks from beads
    const subtasks = await queryEpicSubtasks(args.epic_id);

    // Count statuses
    const statusCounts = {
      running: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
    };

    const agents: SpawnedAgent[] = [];

    for (const bead of subtasks) {
      // Map bead status to agent status
      let agentStatus: SpawnedAgent["status"] = "pending";
      switch (bead.status) {
        case "in_progress":
          agentStatus = "running";
          statusCounts.running++;
          break;
        case "closed":
          agentStatus = "completed";
          statusCounts.completed++;
          break;
        case "blocked":
          agentStatus = "pending"; // Blocked treated as pending for swarm
          statusCounts.blocked++;
          break;
        default:
          // open = pending
          break;
      }

      agents.push({
        bead_id: bead.id,
        agent_name: "", // We don't track this in beads
        status: agentStatus,
        files: [], // Would need to parse from description
      });
    }

    // Query Agent Mail for message activity
    const messageCount = await querySwarmMessages(
      args.project_key,
      args.epic_id,
    );

    const status: SwarmStatus = {
      epic_id: args.epic_id,
      total_agents: subtasks.length,
      running: statusCounts.running,
      completed: statusCounts.completed,
      failed: statusCounts.failed,
      blocked: statusCounts.blocked,
      agents,
      last_update: new Date().toISOString(),
    };

    // Validate and return
    const validated = SwarmStatusSchema.parse(status);

    return JSON.stringify(
      {
        ...validated,
        message_count: messageCount,
        progress_percent:
          subtasks.length > 0
            ? Math.round((statusCounts.completed / subtasks.length) * 100)
            : 0,
      },
      null,
      2,
    );
  },
});

/**
 * Report progress on a subtask
 *
 * Takes explicit agent identity since tools don't have persistent state.
 */
export const swarm_progress = tool({
  description: "Report progress on a subtask to coordinator",
  args: {
    project_key: tool.schema.string().describe("Project path"),
    agent_name: tool.schema.string().describe("Your Agent Mail name"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    status: tool.schema
      .enum(["in_progress", "blocked", "completed", "failed"])
      .describe("Current status"),
    message: tool.schema
      .string()
      .optional()
      .describe("Progress message or blockers"),
    progress_percent: tool.schema
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Completion percentage"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files modified so far"),
  },
  async execute(args) {
    // Build progress report
    const progress: AgentProgress = {
      bead_id: args.bead_id,
      agent_name: args.agent_name,
      status: args.status,
      progress_percent: args.progress_percent,
      message: args.message,
      files_touched: args.files_touched,
      timestamp: new Date().toISOString(),
    };

    // Validate
    const validated = AgentProgressSchema.parse(progress);

    // Update bead status if needed
    if (args.status === "blocked" || args.status === "in_progress") {
      const beadStatus = args.status === "blocked" ? "blocked" : "in_progress";
      await Bun.$`bd update ${args.bead_id} --status ${beadStatus} --json`
        .quiet()
        .nothrow();
    }

    // Extract epic ID from bead ID (e.g., bd-abc123.1 -> bd-abc123)
    const epicId = args.bead_id.includes(".")
      ? args.bead_id.split(".")[0]
      : args.bead_id;

    // Send progress message to thread
    await mcpCall("send_message", {
      project_key: args.project_key,
      sender_name: args.agent_name,
      to: [], // Coordinator will pick it up from thread
      subject: `Progress: ${args.bead_id} - ${args.status}`,
      body_md: formatProgressMessage(validated),
      thread_id: epicId,
      importance: args.status === "blocked" ? "high" : "normal",
    });

    return `Progress reported: ${args.status}${args.progress_percent !== undefined ? ` (${args.progress_percent}%)` : ""}`;
  },
});

/**
 * UBS scan result schema
 */
interface UbsScanResult {
  exitCode: number;
  bugs: Array<{
    file: string;
    line: number;
    severity: string;
    message: string;
    category: string;
  }>;
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * Run UBS scan on files before completion
 *
 * @param files - Files to scan
 * @returns Scan result or null if UBS not available
 */
async function runUbsScan(files: string[]): Promise<UbsScanResult | null> {
  if (files.length === 0) {
    return null;
  }

  // Check if UBS is available first
  const ubsAvailable = await isToolAvailable("ubs");
  if (!ubsAvailable) {
    warnMissingTool("ubs");
    return null;
  }

  try {
    // Run UBS scan with JSON output
    const result = await Bun.$`ubs scan ${files.join(" ")} --json`
      .quiet()
      .nothrow();

    const output = result.stdout.toString();
    if (!output.trim()) {
      return {
        exitCode: result.exitCode,
        bugs: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      };
    }

    try {
      const parsed = JSON.parse(output);
      return {
        exitCode: result.exitCode,
        bugs: parsed.bugs || [],
        summary: parsed.summary || {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
      };
    } catch {
      // UBS output wasn't JSON, return basic result
      return {
        exitCode: result.exitCode,
        bugs: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      };
    }
  } catch {
    return null;
  }
}

/**
 * Broadcast context updates to all agents in the epic
 *
 * Enables mid-task coordination by sharing discoveries, warnings, or blockers
 * with all agents working on the same epic. Agents can broadcast without
 * waiting for task completion.
 *
 * Based on "Patterns for Building AI Agents" p.31: "Ensure subagents can share context along the way"
 */
export const swarm_broadcast = tool({
  description:
    "Broadcast context update to all agents working on the same epic",
  args: {
    epic_id: tool.schema.string().describe("Epic ID (e.g., bd-abc123)"),
    message: tool.schema
      .string()
      .describe("Context update to share (what changed, what was learned)"),
    importance: tool.schema
      .enum(["info", "warning", "blocker"])
      .default("info")
      .describe("Priority level (default: info)"),
    files_affected: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files this context relates to"),
  },
  async execute(args, ctx) {
    // Get agent state - requires prior initialization
    const state = requireState(ctx.sessionID);

    // Extract bead_id from context if available (for traceability)
    // In the swarm flow, ctx might have the current bead being worked on
    const beadId = (ctx as { beadId?: string }).beadId || "unknown";

    // Format the broadcast message
    const body = [
      `## Context Update`,
      "",
      `**From**: ${state.agentName} (${beadId})`,
      `**Priority**: ${args.importance.toUpperCase()}`,
      "",
      args.message,
      "",
      args.files_affected && args.files_affected.length > 0
        ? `**Files affected**:\n${args.files_affected.map((f) => `- \`${f}\``).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Map importance to Agent Mail importance
    const mailImportance =
      args.importance === "blocker"
        ? "urgent"
        : args.importance === "warning"
          ? "high"
          : "normal";

    // Send as broadcast to thread (empty 'to' = all agents in thread)
    await mcpCall("send_message", {
      project_key: state.projectKey,
      sender_name: state.agentName,
      to: [], // Broadcast to thread
      subject: `[${args.importance.toUpperCase()}] Context update from ${state.agentName}`,
      body_md: body,
      thread_id: args.epic_id,
      importance: mailImportance,
      ack_required: args.importance === "blocker", // Require ack for blockers
    });

    return JSON.stringify(
      {
        broadcast: true,
        epic_id: args.epic_id,
        from: state.agentName,
        bead_id: beadId,
        importance: args.importance,
        recipients: "all agents in epic",
        ack_required: args.importance === "blocker",
      },
      null,
      2,
    );
  },
});

/**
 * Mark a subtask as complete
 *
 * Closes bead, releases reservations, notifies coordinator.
 * Optionally runs UBS scan on modified files before completion.
 */
export const swarm_complete = tool({
  description:
    "Mark subtask complete, release reservations, notify coordinator. Runs UBS bug scan if files_touched provided.",
  args: {
    project_key: tool.schema.string().describe("Project path"),
    agent_name: tool.schema.string().describe("Your Agent Mail name"),
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    summary: tool.schema.string().describe("Brief summary of work done"),
    evaluation: tool.schema
      .string()
      .optional()
      .describe("Self-evaluation JSON (Evaluation schema)"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files modified - will be scanned by UBS for bugs"),
    skip_ubs_scan: tool.schema
      .boolean()
      .optional()
      .describe("Skip UBS bug scan (default: false)"),
  },
  async execute(args) {
    // Run UBS scan on modified files if provided
    let ubsResult: UbsScanResult | null = null;
    if (
      args.files_touched &&
      args.files_touched.length > 0 &&
      !args.skip_ubs_scan
    ) {
      ubsResult = await runUbsScan(args.files_touched);

      // Block completion if critical bugs found
      if (ubsResult && ubsResult.summary.critical > 0) {
        return JSON.stringify(
          {
            success: false,
            error: "UBS found critical bugs - fix before completing",
            ubs_scan: {
              critical_count: ubsResult.summary.critical,
              bugs: ubsResult.bugs.filter((b) => b.severity === "critical"),
            },
            hint: "Fix the critical bugs and try again, or use skip_ubs_scan=true to bypass",
          },
          null,
          2,
        );
      }
    }

    // Parse and validate evaluation if provided
    let parsedEvaluation: Evaluation | undefined;
    if (args.evaluation) {
      try {
        parsedEvaluation = EvaluationSchema.parse(JSON.parse(args.evaluation));
      } catch (error) {
        return JSON.stringify(
          {
            success: false,
            error: "Invalid evaluation format",
            details: error instanceof z.ZodError ? error.issues : String(error),
          },
          null,
          2,
        );
      }

      // If evaluation failed, don't complete
      if (!parsedEvaluation.passed) {
        return JSON.stringify(
          {
            success: false,
            error: "Self-evaluation failed",
            retry_suggestion: parsedEvaluation.retry_suggestion,
            feedback: parsedEvaluation.overall_feedback,
          },
          null,
          2,
        );
      }
    }

    // Close the bead
    const closeResult =
      await Bun.$`bd close ${args.bead_id} --reason ${args.summary} --json`
        .quiet()
        .nothrow();

    if (closeResult.exitCode !== 0) {
      throw new SwarmError(
        `Failed to close bead: ${closeResult.stderr.toString()}`,
        "complete",
      );
    }

    // Release file reservations for this agent
    await mcpCall("release_file_reservations", {
      project_key: args.project_key,
      agent_name: args.agent_name,
    });

    // Extract epic ID
    const epicId = args.bead_id.includes(".")
      ? args.bead_id.split(".")[0]
      : args.bead_id;

    // Send completion message
    const completionBody = [
      `## Subtask Complete: ${args.bead_id}`,
      "",
      `**Summary**: ${args.summary}`,
      "",
      parsedEvaluation
        ? `**Self-Evaluation**: ${parsedEvaluation.passed ? "PASSED" : "FAILED"}`
        : "",
      parsedEvaluation?.overall_feedback
        ? `**Feedback**: ${parsedEvaluation.overall_feedback}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    await mcpCall("send_message", {
      project_key: args.project_key,
      sender_name: args.agent_name,
      to: [], // Thread broadcast
      subject: `Complete: ${args.bead_id}`,
      body_md: completionBody,
      thread_id: epicId,
      importance: "normal",
    });

    return JSON.stringify(
      {
        success: true,
        bead_id: args.bead_id,
        closed: true,
        reservations_released: true,
        message_sent: true,
        ubs_scan: ubsResult
          ? {
              ran: true,
              bugs_found: ubsResult.summary.total,
              summary: ubsResult.summary,
              warnings: ubsResult.bugs.filter((b) => b.severity !== "critical"),
            }
          : {
              ran: false,
              reason: args.skip_ubs_scan
                ? "skipped"
                : "no files or ubs unavailable",
            },
      },
      null,
      2,
    );
  },
});

/**
 * Classify failure based on error message heuristics
 *
 * Simple pattern matching to categorize why a task failed.
 * Used when failure_mode is not explicitly provided.
 *
 * @param error - Error object or message
 * @returns FailureMode classification
 */
function classifyFailure(error: Error | string): string {
  const msg = (typeof error === "string" ? error : error.message).toLowerCase();

  if (msg.includes("timeout")) return "timeout";
  if (msg.includes("conflict") || msg.includes("reservation"))
    return "conflict";
  if (msg.includes("validation") || msg.includes("schema")) return "validation";
  if (msg.includes("context") || msg.includes("token"))
    return "context_overflow";
  if (msg.includes("blocked") || msg.includes("dependency"))
    return "dependency_blocked";
  if (msg.includes("cancel")) return "user_cancelled";

  // Check for tool failure patterns
  if (
    msg.includes("tool") ||
    msg.includes("command") ||
    msg.includes("failed to execute")
  ) {
    return "tool_failure";
  }

  return "unknown";
}

/**
 * Record outcome signals from a completed subtask
 *
 * Tracks implicit feedback (duration, errors, retries) to score
 * decomposition quality over time. This data feeds into criterion
 * weight calculations.
 *
 * Strategy tracking enables learning about which decomposition strategies
 * work best for different task types.
 *
 * @see src/learning.ts for scoring logic
 */
export const swarm_record_outcome = tool({
  description:
    "Record subtask outcome for implicit feedback scoring. Tracks duration, errors, retries to learn decomposition quality.",
  args: {
    bead_id: tool.schema.string().describe("Subtask bead ID"),
    duration_ms: tool.schema
      .number()
      .int()
      .min(0)
      .describe("Duration in milliseconds"),
    error_count: tool.schema
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of errors encountered"),
    retry_count: tool.schema
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of retry attempts"),
    success: tool.schema.boolean().describe("Whether the subtask succeeded"),
    files_touched: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files that were modified"),
    criteria: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Criteria to generate feedback for (default: all default criteria)",
      ),
    strategy: tool.schema
      .enum(["file-based", "feature-based", "risk-based", "research-based"])
      .optional()
      .describe("Decomposition strategy used for this task"),
    failure_mode: tool.schema
      .enum([
        "timeout",
        "conflict",
        "validation",
        "tool_failure",
        "context_overflow",
        "dependency_blocked",
        "user_cancelled",
        "unknown",
      ])
      .optional()
      .describe(
        "Failure classification (only when success=false). Auto-classified if not provided.",
      ),
    failure_details: tool.schema
      .string()
      .optional()
      .describe("Detailed failure context (error message, stack trace, etc.)"),
  },
  async execute(args) {
    // Build outcome signals
    const signals: OutcomeSignals = {
      bead_id: args.bead_id,
      duration_ms: args.duration_ms,
      error_count: args.error_count ?? 0,
      retry_count: args.retry_count ?? 0,
      success: args.success,
      files_touched: args.files_touched ?? [],
      timestamp: new Date().toISOString(),
      strategy: args.strategy as LearningDecompositionStrategy | undefined,
      failure_mode: args.failure_mode,
      failure_details: args.failure_details,
    };

    // If task failed but no failure_mode provided, try to classify from failure_details
    if (!args.success && !args.failure_mode && args.failure_details) {
      signals.failure_mode = classifyFailure(args.failure_details) as any;
    }

    // Validate signals
    const validated = OutcomeSignalsSchema.parse(signals);

    // Score the outcome
    const scored: ScoredOutcome = scoreImplicitFeedback(
      validated,
      DEFAULT_LEARNING_CONFIG,
    );

    // Get error patterns from accumulator
    const errorStats = await globalErrorAccumulator.getErrorStats(args.bead_id);

    // Generate feedback events for each criterion
    const criteriaToScore = args.criteria ?? [
      "type_safe",
      "no_bugs",
      "patterns",
      "readable",
    ];
    const feedbackEvents: FeedbackEvent[] = criteriaToScore.map((criterion) => {
      const event = outcomeToFeedback(scored, criterion);
      // Include strategy in feedback context for future analysis
      if (args.strategy) {
        event.context =
          `${event.context || ""} [strategy: ${args.strategy}]`.trim();
      }
      // Include error patterns in feedback context
      if (errorStats.total > 0) {
        const errorSummary = Object.entries(errorStats.by_type)
          .map(([type, count]) => `${type}:${count}`)
          .join(", ");
        event.context =
          `${event.context || ""} [errors: ${errorSummary}]`.trim();
      }
      return event;
    });

    return JSON.stringify(
      {
        success: true,
        outcome: {
          signals: validated,
          scored: {
            type: scored.type,
            decayed_value: scored.decayed_value,
            reasoning: scored.reasoning,
          },
        },
        feedback_events: feedbackEvents,
        error_patterns: errorStats,
        summary: {
          feedback_type: scored.type,
          duration_seconds: Math.round(args.duration_ms / 1000),
          error_count: args.error_count ?? 0,
          retry_count: args.retry_count ?? 0,
          success: args.success,
          strategy: args.strategy,
          failure_mode: validated.failure_mode,
          failure_details: validated.failure_details,
          accumulated_errors: errorStats.total,
          unresolved_errors: errorStats.unresolved,
        },
        note: "Feedback events should be stored for criterion weight calculation. Use learning.ts functions to apply weights.",
      },
      null,
      2,
    );
  },
});

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
    "Prepare a subtask for spawning. Returns prompt with Agent Mail/beads instructions.",
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
  },
  async execute(args) {
    const prompt = formatSubtaskPromptV2({
      bead_id: args.bead_id,
      epic_id: args.epic_id,
      subtask_title: args.subtask_title,
      subtask_description: args.subtask_description || "",
      files: args.files,
      shared_context: args.shared_context,
    });

    return JSON.stringify(
      {
        prompt,
        bead_id: args.bead_id,
        epic_id: args.epic_id,
        files: args.files,
      },
      null,
      2,
    );
  },
});

/**
 * Schema for task agent result
 */
const TaskResultSchema = z.object({
  success: z.boolean(),
  summary: z.string(),
  files_modified: z.array(z.string()).optional().default([]),
  files_created: z.array(z.string()).optional().default([]),
  issues_found: z.array(z.string()).optional().default([]),
  tests_passed: z.boolean().optional(),
  notes: z.string().optional(),
  blocker: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
});

type TaskResult = z.infer<typeof TaskResultSchema>;

/**
 * Handle subtask completion from a Task agent
 *
 * This tool is for coordinators to process the result after a Task subagent
 * returns. It parses the JSON result, closes the bead on success, and
 * creates new beads for any issues discovered.
 *
 * @example
 * // Task agent returns JSON:
 * // { "success": true, "summary": "Added auth", "files_modified": ["src/auth.ts"], "issues_found": ["Missing tests"] }
 * //
 * // Coordinator calls:
 * swarm_complete_subtask(bead_id="bd-123.1", task_result=<agent_response>)
 */
export const swarm_complete_subtask = tool({
  description:
    "Handle subtask completion after Task agent returns. Parses result JSON, closes bead on success, creates new beads for issues found.",
  args: {
    bead_id: z.string().describe("Subtask bead ID to close"),
    task_result: z
      .string()
      .describe("JSON result from the Task agent (TaskResult schema)"),
    files_touched: z
      .array(z.string())
      .optional()
      .describe(
        "Override files touched (uses task_result.files_modified if not provided)",
      ),
  },
  async execute(args) {
    // Parse the task result JSON
    let result: TaskResult;
    try {
      const parsed = JSON.parse(args.task_result);
      result = TaskResultSchema.parse(parsed);
    } catch (error) {
      // Handle parse errors gracefully
      const errorMessage =
        error instanceof SyntaxError
          ? `Invalid JSON: ${error.message}`
          : error instanceof z.ZodError
            ? `Schema validation failed: ${error.issues.map((i) => i.message).join(", ")}`
            : String(error);

      return JSON.stringify(
        {
          success: false,
          error: "Failed to parse task result",
          details: errorMessage,
          hint: "Task agent should return JSON matching TaskResult schema: { success, summary, files_modified?, issues_found?, ... }",
        },
        null,
        2,
      );
    }

    const filesTouched = args.files_touched ?? [
      ...result.files_modified,
      ...result.files_created,
    ];
    const issuesCreated: Array<{ title: string; id?: string }> = [];

    // If task failed, don't close the bead - return info for coordinator to handle
    if (!result.success) {
      return JSON.stringify(
        {
          success: false,
          bead_id: args.bead_id,
          task_failed: true,
          summary: result.summary,
          blocker: result.blocker,
          suggestions: result.suggestions,
          files_touched: filesTouched,
          action_needed:
            "Task failed - review blocker and decide whether to retry or close as failed",
        },
        null,
        2,
      );
    }

    // Task succeeded - close the bead
    const closeReason = result.summary.slice(0, 200); // Truncate for safety
    await Bun.$`bd close ${args.bead_id} -r "${closeReason}"`.quiet().nothrow();

    // Create new beads for each issue found
    if (result.issues_found.length > 0) {
      for (const issue of result.issues_found) {
        const issueTitle = issue.slice(0, 100); // Truncate long titles
        const createResult = await Bun.$`bd create "${issueTitle}" -t bug`
          .quiet()
          .nothrow();

        if (createResult.exitCode === 0) {
          // Try to parse the bead ID from output
          const output = createResult.stdout.toString();
          const idMatch = output.match(/bd-[a-z0-9]+/);
          issuesCreated.push({
            title: issueTitle,
            id: idMatch?.[0],
          });
        } else {
          issuesCreated.push({
            title: issueTitle,
            id: undefined, // Failed to create
          });
        }
      }
    }

    return JSON.stringify(
      {
        success: true,
        bead_id: args.bead_id,
        bead_closed: true,
        summary: result.summary,
        files_touched: filesTouched,
        tests_passed: result.tests_passed,
        notes: result.notes,
        issues_created: issuesCreated.length > 0 ? issuesCreated : undefined,
        issues_count: issuesCreated.length,
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

// ============================================================================
// Error Accumulator
// ============================================================================

/**
 * Global error accumulator for tracking errors across subtasks
 *
 * This is a session-level singleton that accumulates errors during
 * swarm execution for feeding into retry prompts.
 */
const globalErrorAccumulator = new ErrorAccumulator();

/**
 * Record an error during subtask execution
 *
 * Implements pattern from "Patterns for Building AI Agents" p.40:
 * "Good agents examine and correct errors when something goes wrong"
 *
 * Errors are accumulated and can be fed into retry prompts to help
 * agents learn from past failures.
 */
export const swarm_accumulate_error = tool({
  description:
    "Record an error during subtask execution. Errors feed into retry prompts.",
  args: {
    bead_id: tool.schema.string().describe("Bead ID where error occurred"),
    error_type: tool.schema
      .enum(["validation", "timeout", "conflict", "tool_failure", "unknown"])
      .describe("Category of error"),
    message: tool.schema.string().describe("Human-readable error message"),
    stack_trace: tool.schema
      .string()
      .optional()
      .describe("Stack trace for debugging"),
    tool_name: tool.schema.string().optional().describe("Tool that failed"),
    context: tool.schema
      .string()
      .optional()
      .describe("What was happening when error occurred"),
  },
  async execute(args) {
    const entry = await globalErrorAccumulator.recordError(
      args.bead_id,
      args.error_type as ErrorType,
      args.message,
      {
        stack_trace: args.stack_trace,
        tool_name: args.tool_name,
        context: args.context,
      },
    );

    return JSON.stringify(
      {
        success: true,
        error_id: entry.id,
        bead_id: entry.bead_id,
        error_type: entry.error_type,
        message: entry.message,
        timestamp: entry.timestamp,
        note: "Error recorded for retry context. Use swarm_get_error_context to retrieve accumulated errors.",
      },
      null,
      2,
    );
  },
});

/**
 * Get accumulated errors for a bead to feed into retry prompts
 *
 * Returns formatted error context that can be injected into retry prompts
 * to help agents learn from past failures.
 */
export const swarm_get_error_context = tool({
  description:
    "Get accumulated errors for a bead. Returns formatted context for retry prompts.",
  args: {
    bead_id: tool.schema.string().describe("Bead ID to get errors for"),
    include_resolved: tool.schema
      .boolean()
      .optional()
      .describe("Include resolved errors (default: false)"),
  },
  async execute(args) {
    const errorContext = await globalErrorAccumulator.getErrorContext(
      args.bead_id,
      args.include_resolved ?? false,
    );

    const stats = await globalErrorAccumulator.getErrorStats(args.bead_id);

    return JSON.stringify(
      {
        bead_id: args.bead_id,
        error_context: errorContext,
        stats: {
          total_errors: stats.total,
          unresolved: stats.unresolved,
          by_type: stats.by_type,
        },
        has_errors: errorContext.length > 0,
        usage:
          "Inject error_context into retry prompt using {error_context} placeholder",
      },
      null,
      2,
    );
  },
});

/**
 * Mark an error as resolved
 *
 * Call this after an agent successfully addresses an error to update
 * the accumulator state.
 */
export const swarm_resolve_error = tool({
  description:
    "Mark an error as resolved after fixing it. Updates error accumulator state.",
  args: {
    error_id: tool.schema.string().describe("Error ID to mark as resolved"),
  },
  async execute(args) {
    await globalErrorAccumulator.resolveError(args.error_id);

    return JSON.stringify(
      {
        success: true,
        error_id: args.error_id,
        resolved: true,
      },
      null,
      2,
    );
  },
});

/**
 * Initialize swarm and check tool availability
 *
 * Call this at the start of a swarm session to see what tools are available
 * and what features will be degraded.
 */
export const swarm_init = tool({
  description:
    "Initialize swarm session and check tool availability. Call at swarm start to see what features are available.",
  args: {
    project_path: tool.schema
      .string()
      .optional()
      .describe("Project path (for Agent Mail init)"),
  },
  async execute(args) {
    // Check all tools
    const availability = await checkAllTools();

    // Build status report
    const report = formatToolAvailability(availability);

    // Check critical tools
    const beadsAvailable = availability.get("beads")?.status.available ?? false;
    const agentMailAvailable =
      availability.get("agent-mail")?.status.available ?? false;

    // Build warnings
    const warnings: string[] = [];
    const degradedFeatures: string[] = [];

    if (!beadsAvailable) {
      warnings.push(
        "⚠️  beads (bd) not available - issue tracking disabled, swarm coordination will be limited",
      );
      degradedFeatures.push("issue tracking", "progress persistence");
    }

    if (!agentMailAvailable) {
      warnings.push(
        "⚠️  agent-mail not available - multi-agent communication disabled",
      );
      degradedFeatures.push("agent communication", "file reservations");
    }

    if (!availability.get("cass")?.status.available) {
      degradedFeatures.push("historical context from past sessions");
    }

    if (!availability.get("ubs")?.status.available) {
      degradedFeatures.push("pre-completion bug scanning");
    }

    if (!availability.get("semantic-memory")?.status.available) {
      degradedFeatures.push("persistent learning (using in-memory fallback)");
    }

    return JSON.stringify(
      {
        ready: true,
        tool_availability: Object.fromEntries(
          Array.from(availability.entries()).map(([k, v]) => [
            k,
            {
              available: v.status.available,
              fallback: v.status.available ? null : v.fallbackBehavior,
            },
          ]),
        ),
        warnings: warnings.length > 0 ? warnings : undefined,
        degraded_features:
          degradedFeatures.length > 0 ? degradedFeatures : undefined,
        recommendations: {
          beads: beadsAvailable
            ? "✓ Use beads for all task tracking"
            : "Install beads: npm i -g @joelhooks/beads",
          agent_mail: agentMailAvailable
            ? "✓ Use Agent Mail for coordination"
            : "Start Agent Mail: agent-mail serve",
        },
        report,
      },
      null,
      2,
    );
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const swarmTools = {
  swarm_init: swarm_init,
  swarm_select_strategy: swarm_select_strategy,
  swarm_plan_prompt: swarm_plan_prompt,
  swarm_decompose: swarm_decompose,
  swarm_validate_decomposition: swarm_validate_decomposition,
  swarm_status: swarm_status,
  swarm_progress: swarm_progress,
  swarm_broadcast: swarm_broadcast,
  swarm_complete: swarm_complete,
  swarm_record_outcome: swarm_record_outcome,
  swarm_subtask_prompt: swarm_subtask_prompt,
  swarm_spawn_subtask: swarm_spawn_subtask,
  swarm_complete_subtask: swarm_complete_subtask,
  swarm_evaluation_prompt: swarm_evaluation_prompt,
  swarm_accumulate_error: swarm_accumulate_error,
  swarm_get_error_context: swarm_get_error_context,
  swarm_resolve_error: swarm_resolve_error,
};
