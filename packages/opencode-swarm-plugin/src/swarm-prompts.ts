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
import { generateWorkerHandoff } from "./swarm-orchestrate";

// ============================================================================
// Prompt Templates
// ============================================================================

/**
 * Prompt for decomposing a task into parallelizable subtasks.
 *
 * Used by swarm_decompose to instruct the agent on how to break down work.
 * The agent responds with a CellTree that gets validated.
 */
export const DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a swarm of agents.

## Task
{task}

{context_section}

## MANDATORY: Hive Issue Tracking

**Every subtask MUST become a cell.** This is non-negotiable.

After decomposition, the coordinator will:
1. Create an epic cell for the overall task
2. Create child cells for each subtask
3. Track progress through cell status updates
4. Close cells with summaries when complete

Agents MUST update their cell status as they work. No silent progress.

## Requirements

1. **Break into independent subtasks** that can run in parallel (as many as needed)
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
export const STRATEGY_DECOMPOSITION_PROMPT = `You are decomposing a task into parallelizable subtasks for a swarm of agents.

## Task
{task}

{strategy_guidelines}

{context_section}

{cass_history}

{skills_context}

## MANDATORY: Hive Issue Tracking

**Every subtask MUST become a cell.** This is non-negotiable.

After decomposition, the coordinator will:
1. Create an epic cell for the overall task
2. Create child cells for each subtask
3. Track progress through cell status updates
4. Close cells with summaries when complete

Agents MUST update their cell status as they work. No silent progress.

## Requirements

1. **Break into independent subtasks** that can run in parallel (as many as needed)
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

/**
 * Prompt template for spawned subtask agents.
 *
 * Each agent receives this prompt with their specific subtask details filled in.
 * The prompt establishes context, constraints, and expectations.
 */
export const SUBTASK_PROMPT = `You are a swarm agent working on a subtask of a larger epic.

## Your Identity
- **Agent Name**: {agent_name}
- **Cell ID**: {bead_id}
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

## MANDATORY: Hive Tracking

You MUST keep your cell updated as you work:

1. **Your cell is already in_progress** - don't change this unless blocked
2. **If blocked**: \`hive_update {bead_id} --status blocked\` and message coordinator
3. **When done**: Use \`swarm_complete\` - it closes your cell automatically
4. **Discovered issues**: Create new cells with \`hive_create "issue" -t bug\`

**Never work silently.** Your cell status is how the swarm tracks progress.

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

1. **Start**: Your cell is already marked in_progress
2. **Progress**: Use swarm_progress to report status updates
3. **Blocked**: Report immediately via Swarm Mail - don't spin
4. **Complete**: Use swarm_complete when done - it handles:
   - Closing your cell with a summary
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
 * Streamlined subtask prompt (V2) - uses Swarm Mail and hive tracking
 *
 * This is a cleaner version of SUBTASK_PROMPT that's easier to parse.
 * Agents MUST use Swarm Mail for communication and hive cells for tracking.
 *
 * Supports {error_context} placeholder for retry prompts.
 */
export const SUBTASK_PROMPT_V2 = `You are a swarm agent working on: **{subtask_title}**

## [IDENTITY]
Agent: (assigned at spawn)
Cell: {bead_id}
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

### Step 2: 🧠 Query Past Learnings (MANDATORY - BEFORE starting work)

**⚠️ CRITICAL: ALWAYS query semantic memory BEFORE writing ANY code.**

\`\`\`
semantic-memory_find(query="<keywords from your task>", limit=5, expand=true)
\`\`\`

**Why this is MANDATORY:**
- Past agents may have already solved your exact problem
- Avoids repeating mistakes that wasted 30+ minutes before
- Discovers project-specific patterns and gotchas
- Finds known workarounds for tool/library quirks

**Search Query Examples by Task Type:**

- **Bug fix**: Use exact error message or "<symptom> <component>"
- **New feature**: Search "<domain concept> implementation pattern"
- **Refactor**: Query "<pattern name> migration approach"
- **Integration**: Look for "<library name> gotchas configuration"
- **Testing**: Find "testing <component type> characterization tests"
- **Performance**: Search "<technology> performance optimization"

**BEFORE you start coding:**
1. Run semantic-memory_find with keywords from your task
2. Read the results with expand=true for full content
3. Check if any memory solves your problem or warns of pitfalls
4. Adjust your approach based on past learnings

**If you skip this step, you WILL waste time solving already-solved problems.**

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

### Step 5: Do the Work (TDD MANDATORY)

**Follow RED → GREEN → REFACTOR. No exceptions.**

1. **RED**: Write a failing test that describes the expected behavior
   - Test MUST fail before you write implementation
   - If test passes immediately, your test is wrong
   
2. **GREEN**: Write minimal code to make the test pass
   - Don't over-engineer - just make it green
   - Hardcode if needed, refactor later
   
3. **REFACTOR**: Clean up while tests stay green
   - Run tests after every change
   - If tests break, undo and try again

\`\`\`bash
# Run tests continuously
bun test <your-test-file> --watch
\`\`\`

**Why TDD?**
- Catches bugs before they exist
- Documents expected behavior
- Enables fearless refactoring
- Proves your code works

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

### Step 8: 💾 STORE YOUR LEARNINGS (if you discovered something)

**If you learned it the hard way, STORE IT so the next agent doesn't have to.**

\`\`\`
semantic-memory_store(
  information="<what you learned, WHY it matters, how to apply it>",
  tags="<domain, tech-stack, pattern-type>"
)
\`\`\`

**MANDATORY Storage Triggers - Store when you:**
- 🐛 **Solved a tricky bug** (>15min debugging) - include root cause + solution
- 💡 **Discovered a project-specific pattern** - domain rules, business logic quirks
- ⚠️ **Found a tool/library gotcha** - API quirks, version-specific bugs, workarounds
- 🚫 **Tried an approach that failed** - anti-patterns to avoid, why it didn't work
- 🏗️ **Made an architectural decision** - reasoning, alternatives considered, tradeoffs

**What Makes a GOOD Memory:**

✅ **GOOD** (actionable, explains WHY):
\`\`\`
"OAuth refresh tokens need 5min buffer before expiry to avoid race conditions.
Without buffer, token refresh can fail mid-request if expiry happens between
check and use. Implemented with: if (expiresAt - Date.now() < 300000) refresh()"
\`\`\`

❌ **BAD** (generic, no context):
\`\`\`
"Fixed the auth bug by adding a null check"
\`\`\`

**What NOT to Store:**
- Generic knowledge that's in official documentation
- Implementation details that change frequently
- Vague descriptions without context ("fixed the thing")

**The WHY matters more than the WHAT.** Future agents need context to apply your learning.

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

**DO NOT manually close the cell with hive_close.** Use swarm_complete.

## [ON-DEMAND RESEARCH]

If you encounter unknown API behavior or version-specific issues:

1. **Check semantic-memory first:**
   \`semantic-memory_find(query="<library> <version> <topic>", limit=3, expand=true)\`

2. **If not found, spawn researcher:**
   \`swarm_spawn_researcher(research_id="{bead_id}-research", epic_id="{epic_id}", tech_stack=["<library>"], project_path="{project_path}")\`
   Then spawn with Task tool: \`Task(subagent_type="swarm/researcher", prompt="<from above>")\`

3. **Wait for research, then continue**

**Research triggers:**
- "I'm not sure how this API works in version X"
- "This might have breaking changes"
- "The docs I remember might be outdated"

**Don't research:**
- Standard patterns you're confident about
- Well-documented, stable APIs
- Obvious implementations

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
hive_update(id="{bead_id}", status="blocked")
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
### Hive - You Have Autonomy to File Issues
You can create new cells against this epic when you discover:
- **Bugs**: Found a bug while working? File it.
- **Tech debt**: Spotted something that needs cleanup? File it.
- **Follow-up work**: Task needs more work than scoped? File a follow-up.
- **Dependencies**: Need something from another agent? File and link it.

\`\`\`
hive_create(
  title="<descriptive title>",
  type="bug",  # or "task", "chore"
  priority=2,
  parent_id="{epic_id}",  # Links to this epic
  description="Found while working on {bead_id}: <details>"
)
\`\`\`

**Don't silently ignore issues.** File them so they get tracked and addressed.

Other cell operations:
- hive_update(id, status) - Mark blocked if stuck
- hive_query(status="open") - See what else needs work

### Skills
- skills_list() - Discover available skills
- skills_use(name) - Activate skill for specialized guidance
- skills_create(name) - Create new skill (if you found a reusable pattern)

## [CRITICAL REQUIREMENTS]

**NON-NEGOTIABLE:**
1. Step 1 (swarmmail_init) MUST be first - do it before anything else
2. 🧠 Step 2 (semantic-memory_find) MUST happen BEFORE starting work - query first, code second
3. Step 4 (swarmmail_reserve) - YOU reserve files, not coordinator
4. Step 6 (swarm_progress) - Report at milestones, don't work silently
5. 💾 Step 8 (semantic-memory_store) - If you learned something hard, STORE IT
6. Step 9 (swarm_complete) - Use this to close, NOT hive_close

**If you skip these steps:**
- Your work won't be tracked (swarm_complete will fail)
- 🔄 You'll waste time repeating already-solved problems (no semantic memory query)
- Edit conflicts with other agents (no file reservation)
- Lost work if you crash (no checkpoints)
- 🔄 Future agents repeat YOUR mistakes (no learnings stored)

**Memory is the swarm's collective intelligence. Query it. Feed it.**

Begin now.`;

/**
 * Researcher prompt template for documentation discovery
 *
 * Spawned BEFORE decomposition to gather technology documentation.
 * Researchers receive an EXPLICIT list of technologies to research from the coordinator.
 * They dynamically discover WHAT TOOLS are available to fetch docs.
 * Output: condensed summary for shared_context + detailed findings in semantic-memory.
 */
export const RESEARCHER_PROMPT = `You are a swarm researcher gathering documentation for: **{research_id}**

## [IDENTITY]
Agent: (assigned at spawn)
Research Task: {research_id}
Epic: {epic_id}

## [MISSION]
Gather comprehensive documentation for the specified technologies to inform task decomposition.

**COORDINATOR PROVIDED THESE TECHNOLOGIES TO RESEARCH:**
{tech_stack}

You do NOT discover what to research - the coordinator already decided that.
You DO discover what TOOLS are available to fetch documentation.

## [OUTPUT MODE]
{check_upgrades}

## [WORKFLOW]

### Step 1: Initialize (MANDATORY FIRST)
\`\`\`
swarmmail_init(project_path="{project_path}", task_description="{research_id}: Documentation research")
\`\`\`

### Step 2: Discover Available Documentation Tools
Check what's available for fetching docs:
- **next-devtools**: \`nextjs_docs\` for Next.js documentation
- **context7**: Library documentation lookup (\`use context7\` in prompts)
- **fetch**: General web fetching for official docs sites
- **pdf-brain**: Internal knowledge base search

**Don't assume** - check which tools exist in your environment.

### Step 3: Read Installed Versions
For each technology in the tech stack:
1. Check package.json (or equivalent) for installed version
2. Record exact version numbers
3. Note any version constraints (^, ~, etc.)

### Step 4: Fetch Documentation
For EACH technology in the list:
- Use the most appropriate tool (Next.js → nextjs_docs, libraries → context7, others → fetch)
- Fetch documentation for the INSTALLED version (not latest, unless --check-upgrades)
- Focus on: API changes, breaking changes, migration guides, best practices
- Extract key patterns, gotchas, and compatibility notes

**If --check-upgrades mode:**
- ALSO fetch docs for the LATEST version
- Compare installed vs latest
- Note breaking changes, new features, migration complexity

### Step 5: Store Detailed Findings
For EACH technology, store in semantic-memory:
\`\`\`
semantic-memory_store(
  information="<technology-name> <version>: <key patterns, gotchas, API changes, compatibility notes>",
  tags="research, <tech-name>, documentation, {epic_id}"
)
\`\`\`

**Why store individually?** Future agents can search by technology name.

### Step 6: Broadcast Summary
Send condensed findings to coordinator:
\`\`\`
swarmmail_send(
  to=["coordinator"],
  subject="Research Complete: {research_id}",
  body="<brief summary - see semantic-memory for details>",
  thread_id="{epic_id}"
)
\`\`\`

### Step 7: Return Structured Output
Output JSON with:
\`\`\`json
{
  "technologies": [
    {
      "name": "string",
      "installed_version": "string",
      "latest_version": "string | null",  // Only if --check-upgrades
      "key_patterns": ["string"],
      "gotchas": ["string"],
      "breaking_changes": ["string"],  // Only if --check-upgrades
      "memory_id": "string"  // ID of semantic-memory entry
    }
  ],
  "summary": "string"  // Condensed summary for shared_context
}
\`\`\`

## [CRITICAL REQUIREMENTS]

**NON-NEGOTIABLE:**
1. Step 1 (swarmmail_init) MUST be first
2. Research ONLY the technologies the coordinator specified
3. Fetch docs for INSTALLED versions (unless --check-upgrades)
4. Store detailed findings in semantic-memory (one per technology)
5. Return condensed summary for coordinator (full details in memory)
6. Use appropriate doc tools (nextjs_docs for Next.js, context7 for libraries, etc.)

**Output goes TWO places:**
- **semantic-memory**: Detailed findings (searchable by future agents)
- **Return JSON**: Condensed summary (for coordinator's shared_context)

Begin research now.`;

/**
 * Coordinator post-worker checklist - MANDATORY review loop
 *
 * This checklist is returned to coordinators after spawning a worker.
 * It ensures coordinators REVIEW worker output before spawning the next worker.
 */
export const COORDINATOR_POST_WORKER_CHECKLIST = `
## ⚠️ MANDATORY: Post-Worker Review (DO THIS IMMEDIATELY)

**A worker just returned. Before doing ANYTHING else, complete this checklist:**

### Step 1: Check Swarm Mail
\`\`\`
swarmmail_inbox()
swarmmail_read_message(message_id=N)  // Read any messages from the worker
\`\`\`

### Step 2: Review the Work
\`\`\`
swarm_review(
  project_key="{project_key}",
  epic_id="{epic_id}",
  task_id="{task_id}",
  files_touched=[{files_touched}]
)
\`\`\`

This generates a review prompt with:
- Epic context (what we're trying to achieve)
- Subtask requirements
- Git diff of changes
- Dependency status

### Step 3: Evaluate Against Criteria
- Does the work fulfill the subtask requirements?
- Does it serve the overall epic goal?
- Does it enable downstream tasks?
- Type safety, no obvious bugs?

### Step 4: Send Feedback
\`\`\`
swarm_review_feedback(
  project_key="{project_key}",
  task_id="{task_id}",
  worker_id="{worker_id}",
  status="approved",  // or "needs_changes"
  summary="<brief summary>",
  issues="[]"  // or "[{file, line, issue, suggestion}]"
)
\`\`\`

### Step 5: Take Action Based on Review

**If APPROVED:**
- Close the cell with hive_close
- Spawn next worker (if any) using swarm_spawn_subtask

**If NEEDS_CHANGES:**
- Generate retry prompt:
  \`\`\`
  swarm_spawn_retry(
    bead_id="{task_id}",
    epic_id="{epic_id}",
    original_prompt="<original prompt>",
    attempt=<current_attempt>,
    issues="<JSON from swarm_review_feedback>",
    diff="<git diff of previous changes>",
    files=[{files_touched}],
    project_path="{project_key}"
  )
  \`\`\`
- Spawn new worker with Task() using the retry prompt
- Increment attempt counter (max 3 attempts)

**If 3 FAILURES:**
- Mark task as blocked: \`hive_update(id="{task_id}", status="blocked")\`
- Escalate to human - likely an architectural problem, not execution issue

**⚠️ DO NOT spawn the next worker until review is complete.**
`;

/**
 * Prompt for self-evaluation before completing a subtask.
 *
 * Agents use this to assess their work quality before marking complete.
 */
export const EVALUATION_PROMPT = `Evaluate the work completed for this subtask.

## Subtask
**Cell ID**: {bead_id}
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
 * Format the researcher prompt for a documentation research task
 */
export function formatResearcherPrompt(params: {
  research_id: string;
  epic_id: string;
  tech_stack: string[];
  project_path: string;
  check_upgrades: boolean;
}): string {
  const techList = params.tech_stack.map((t) => `- ${t}`).join("\n");
  
  const upgradesMode = params.check_upgrades
    ? "**UPGRADE COMPARISON MODE**: Fetch docs for BOTH installed AND latest versions. Compare and note breaking changes."
    : "**DEFAULT MODE**: Fetch docs for INSTALLED versions only (from lockfiles).";

  return RESEARCHER_PROMPT
    .replace(/{research_id}/g, params.research_id)
    .replace(/{epic_id}/g, params.epic_id)
    .replace("{tech_stack}", techList)
    .replace("{project_path}", params.project_path)
    .replace("{check_upgrades}", upgradesMode);
}

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

  // Generate WorkerHandoff contract (machine-readable section)
  const handoff = generateWorkerHandoff({
    task_id: params.bead_id,
    files_owned: params.files,
    files_readonly: [],
    dependencies_completed: [],
    success_criteria: [
      "All files compile without errors",
      "Tests pass for modified code",
      "Code follows project patterns",
    ],
    epic_summary: params.subtask_description || params.subtask_title,
    your_role: params.subtask_title,
    what_others_did: params.recovery_context?.shared_context || "",
    what_comes_next: "",
  });

  const handoffJson = JSON.stringify(handoff, null, 2);
  const handoffSection = `\n## WorkerHandoff Contract\n\nThis is your machine-readable contract. The contract IS the instruction.\n\n\`\`\`json\n${handoffJson}\n\`\`\`\n`;

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
    .replace("{error_context}", errorSection + recoverySection + handoffSection);
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
 * Generates a streamlined prompt that tells agents to USE Agent Mail and hive tracking.
 * Returns JSON that can be directly used with Task tool.
 */
export const swarm_spawn_subtask = tool({
  description:
    "Prepare a subtask for spawning. Returns prompt with Agent Mail/hive tracking instructions. IMPORTANT: Pass project_path for swarmmail_init. Automatically selects appropriate model based on file types.",
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
    model: tool.schema
      .string()
      .optional()
      .describe("Optional explicit model override (auto-selected if not provided)"),
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

    // Import selectWorkerModel at function scope to avoid circular dependencies
    const { selectWorkerModel } = await import("./model-selection.js");
    
    // Create a mock subtask for model selection
    const subtask = {
      title: args.subtask_title,
      description: args.subtask_description || "",
      files: args.files,
      estimated_effort: "medium" as const,
      risks: [],
      model: args.model,
    };
    
    // Use placeholder config - actual config should be passed from coordinator
    // For now, we use reasonable defaults
    const config = {
      primaryModel: "anthropic/claude-sonnet-4-5",
      liteModel: "anthropic/claude-haiku-4-5",
    };
    
    const selectedModel = selectWorkerModel(subtask, config);

    // Generate post-completion instructions for coordinator
    const filesJoined = args.files.map(f => `"${f}"`).join(", ");
    const postCompletionInstructions = COORDINATOR_POST_WORKER_CHECKLIST
      .replace(/{project_key}/g, args.project_path || "$PWD")
      .replace(/{epic_id}/g, args.epic_id)
      .replace(/{task_id}/g, args.bead_id)
      .replace(/{files_touched}/g, filesJoined)
      .replace(/{worker_id}/g, "worker");  // Will be filled by actual worker name

    return JSON.stringify(
      {
        prompt,
        bead_id: args.bead_id,
        epic_id: args.epic_id,
        files: args.files,
        project_path: args.project_path,
        recovery_context: args.recovery_context,
        recommended_model: selectedModel,
        post_completion_instructions: postCompletionInstructions,
      },
      null,
      2,
    );
  },
});

/**
 * Prepare a researcher task for spawning with Task tool
 * 
 * Generates a prompt that tells the researcher to fetch documentation for specific technologies.
 * Returns JSON that can be directly used with Task tool.
 */
export const swarm_spawn_researcher = tool({
  description:
    "Prepare a research task for spawning. Returns prompt for gathering technology documentation. Researcher fetches docs and stores findings in semantic-memory.",
  args: {
    research_id: tool.schema.string().describe("Unique ID for this research task"),
    epic_id: tool.schema.string().describe("Parent epic ID"),
    tech_stack: tool.schema
      .array(tool.schema.string())
      .describe("Explicit list of technologies to research (from coordinator)"),
    project_path: tool.schema
      .string()
      .describe("Absolute project path for swarmmail_init"),
    check_upgrades: tool.schema
      .boolean()
      .optional()
      .describe("If true, compare installed vs latest versions (default: false)"),
  },
  async execute(args) {
    const prompt = formatResearcherPrompt({
      research_id: args.research_id,
      epic_id: args.epic_id,
      tech_stack: args.tech_stack,
      project_path: args.project_path,
      check_upgrades: args.check_upgrades ?? false,
    });

    return JSON.stringify(
      {
        prompt,
        research_id: args.research_id,
        epic_id: args.epic_id,
        tech_stack: args.tech_stack,
        project_path: args.project_path,
        check_upgrades: args.check_upgrades ?? false,
        subagent_type: "swarm/researcher",
        expected_output: {
          technologies: [
            {
              name: "string",
              installed_version: "string",
              latest_version: "string | null",
              key_patterns: ["string"],
              gotchas: ["string"],
              breaking_changes: ["string"],
              memory_id: "string",
            },
          ],
          summary: "string",
        },
      },
      null,
      2,
    );
  },
});

/**
 * Generate retry prompt for a worker that needs to fix issues from review feedback
 * 
 * Coordinators use this when swarm_review_feedback returns "needs_changes".
 * Creates a new worker spawn with context about what went wrong and what to fix.
 */
export const swarm_spawn_retry = tool({
  description:
    "Generate retry prompt for a worker that failed review. Includes issues from previous attempt, diff if provided, and standard worker contract.",
  args: {
    bead_id: tool.schema.string().describe("Original subtask bead ID"),
    epic_id: tool.schema.string().describe("Parent epic bead ID"),
    original_prompt: tool.schema.string().describe("The prompt given to failed worker"),
    attempt: tool.schema.number().int().min(1).max(3).describe("Current attempt number (1, 2, or 3)"),
    issues: tool.schema.string().describe("JSON array of ReviewIssue objects from swarm_review_feedback"),
    diff: tool.schema
      .string()
      .optional()
      .describe("Git diff of previous changes"),
    files: tool.schema
      .array(tool.schema.string())
      .describe("Files to modify (from original subtask)"),
    project_path: tool.schema
      .string()
      .optional()
      .describe("Absolute project path for swarmmail_init"),
  },
  async execute(args) {
    // Validate attempt number
    if (args.attempt > 3) {
      throw new Error(
        `Retry attempt ${args.attempt} exceeds maximum of 3. After 3 failures, task should be marked blocked.`,
      );
    }

    // Parse issues
    let issuesArray: Array<{
      file: string;
      line: number;
      issue: string;
      suggestion: string;
    }> = [];
    try {
      issuesArray = JSON.parse(args.issues);
    } catch (e) {
      // If issues is not valid JSON, treat as empty array
      issuesArray = [];
    }

    // Format issues section
    const issuesSection = issuesArray.length > 0
      ? `## ISSUES FROM PREVIOUS ATTEMPT

The previous attempt had the following issues that need to be fixed:

${issuesArray
  .map(
    (issue, idx) =>
      `**${idx + 1}. ${issue.file}:${issue.line}**
   - **Issue**: ${issue.issue}
   - **Suggestion**: ${issue.suggestion}`,
  )
  .join("\n\n")}

**Critical**: Fix these issues while preserving any working changes from the previous attempt.`
      : "";

    // Format diff section
    const diffSection = args.diff
      ? `## PREVIOUS ATTEMPT

Here's what was tried in the previous attempt:

\`\`\`diff
${args.diff}
\`\`\`

Review this carefully - some changes may be correct and should be preserved.`
      : "";

    // Build the retry prompt
    const retryPrompt = `⚠️ **RETRY ATTEMPT ${args.attempt}/3**

This is a retry of a previously attempted subtask. The coordinator reviewed the previous attempt and found issues that need to be fixed.

${issuesSection}

${diffSection}

## ORIGINAL TASK

${args.original_prompt}

## YOUR MISSION

1. **Understand what went wrong** - Read the issues carefully
2. **Fix the specific problems** - Address each issue listed above
3. **Preserve working code** - Don't throw away correct changes from previous attempt
4. **Follow the standard worker contract** - See below

## MANDATORY WORKER CONTRACT

### Step 1: Initialize (REQUIRED FIRST)
\`\`\`
swarmmail_init(project_path="${args.project_path || "$PWD"}", task_description="${args.bead_id}: Retry ${args.attempt}/3")
\`\`\`

### Step 2: Reserve Files
\`\`\`
swarmmail_reserve(
  paths=${JSON.stringify(args.files)},
  reason="${args.bead_id}: Retry attempt ${args.attempt}",
  exclusive=true
)
\`\`\`

### Step 3: Fix the Issues
- Address each issue listed above
- Run tests to verify fixes
- Don't introduce new bugs

### Step 4: Complete
\`\`\`
swarm_complete(
  project_key="${args.project_path || "$PWD"}",
  agent_name="<your-agent-name>",
  bead_id="${args.bead_id}",
  summary="Fixed issues from review: <brief summary>",
  files_touched=[<files you modified>]
)
\`\`\`

**Remember**: This is attempt ${args.attempt} of 3. If this fails review again, there may be an architectural problem that needs human intervention.

Begin work now.`;

    return JSON.stringify(
      {
        prompt: retryPrompt,
        bead_id: args.bead_id,
        attempt: args.attempt,
        max_attempts: 3,
        files: args.files,
        issues_count: issuesArray.length,
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
      .min(1)
      .optional()
      .describe("Suggested max subtasks (optional - LLM decides if not specified)"),
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
  swarm_spawn_researcher,
  swarm_spawn_retry,
  swarm_evaluation_prompt,
  swarm_plan_prompt,
};
