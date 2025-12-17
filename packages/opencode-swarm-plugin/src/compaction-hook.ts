/**
 * Swarm-Aware Compaction Hook
 *
 * Provides context preservation during OpenCode session compaction.
 * When context is compacted, this hook injects instructions for the summarizer
 * to preserve swarm coordination state and enable seamless resumption.
 *
 * Hook signature (from @opencode-ai/plugin):
 * ```typescript
 * "experimental.session.compacting"?: (
 *   input: { sessionID: string },
 *   output: { context: string[] }
 * ) => Promise<void>
 * ```
 *
 * @example
 * ```typescript
 * import { SWARM_COMPACTION_CONTEXT, createCompactionHook } from "opencode-swarm-plugin";
 *
 * const hooks: Hooks = {
 *   "experimental.session.compacting": createCompactionHook(),
 * };
 * ```
 */

// ============================================================================
// Compaction Context
// ============================================================================

/**
 * Swarm-aware compaction context
 *
 * Injected during compaction to keep the swarm cooking. The coordinator should
 * wake up from compaction and immediately resume orchestration - spawning agents,
 * monitoring progress, unblocking work.
 *
 * This is NOT about preserving state for a human - it's about the swarm continuing
 * autonomously after context compression.
 */
export const SWARM_COMPACTION_CONTEXT = `## 🐝 SWARM ACTIVE - Keep Cooking

You are the **COORDINATOR** of an active swarm. Context was compacted but the swarm is still running.

**YOUR JOB:** Keep orchestrating. Spawn agents. Monitor progress. Unblock work. Ship it.

### Preserve in Summary

Extract from session context:

1. **Epic & Subtasks** - IDs, titles, status, file assignments
2. **What's Running** - Which agents are active, what they're working on  
3. **What's Blocked** - Blockers and what's needed to unblock
4. **What's Done** - Completed work and any follow-ups needed
5. **What's Next** - Pending subtasks ready to spawn

### Summary Format

\`\`\`
## 🐝 Swarm State

**Epic:** <bd-xxx> - <title>
**Project:** <path>
**Progress:** X/Y subtasks complete

**Active:**
- <bd-xxx>: <title> [in_progress] → <agent> working on <files>

**Blocked:**
- <bd-xxx>: <title> - BLOCKED: <reason>

**Completed:**
- <bd-xxx>: <title> ✓

**Ready to Spawn:**
- <bd-xxx>: <title> (files: <...>)
\`\`\`

### On Resume - IMMEDIATELY

1. \`swarm_status(epic_id="<epic>", project_key="<path>")\` - Get current state
2. \`swarmmail_inbox(limit=5)\` - Check for agent messages
3. **Spawn ready subtasks** - Don't wait, fire them off
4. **Unblock blocked work** - Resolve dependencies, reassign if needed
5. **Collect completed work** - Close done subtasks, verify quality

### Keep the Swarm Cooking

- **Spawn aggressively** - If a subtask is ready and unblocked, spawn an agent
- **Monitor actively** - Check status, read messages, respond to blockers
- **Close the loop** - When all subtasks done, verify and close the epic
- **Don't stop** - The swarm runs until the epic is closed

**You are not waiting for instructions. You are the coordinator. Coordinate.**
`;

// ============================================================================
// Hook Registration Helper
// ============================================================================

/**
 * Check for swarm sign - evidence a swarm passed through
 * 
 * Like deer scat on a trail, we look for traces:
 * - In-progress cells (active work)
 * - Open cells with parent_id (subtasks of an epic)
 * - Unclosed epics
 * 
 * Uses the adapter directly to query beads.
 */
import { getHiveAdapter, getHiveWorkingDirectory } from "./hive";

async function hasSwarmSign(): Promise<boolean> {
  try {
    const projectKey = getHiveWorkingDirectory();
    const adapter = await getHiveAdapter(projectKey);
    const cells = await adapter.queryCells(projectKey, {});
    
    if (!Array.isArray(cells)) return false;

    // Look for swarm sign:
    // 1. Any in_progress cells
    // 2. Any open cells with a parent (subtasks)
    // 3. Any epics that aren't closed
    return cells.some(
      (c) =>
        c.status === "in_progress" ||
        (c.status === "open" && c.parent_id) ||
        (c.type === "epic" && c.status !== "closed"),
    );
  } catch {
    return false;
  }
}

/**
 * Create the compaction hook for use in plugin registration
 *
 * Only injects swarm context if there's an active swarm (in-progress beads).
 * This keeps the coordinator cooking after compaction.
 *
 * @example
 * ```typescript
 * import { createCompactionHook } from "opencode-swarm-plugin";
 *
 * export const SwarmPlugin: Plugin = async () => ({
 *   tool: { ... },
 *   "experimental.session.compacting": createCompactionHook(),
 * });
 * ```
 */
export function createCompactionHook() {
  return async (
    _input: { sessionID: string },
    output: { context: string[] },
  ): Promise<void> => {
    const hasSign = await hasSwarmSign();
    if (hasSign) {
      output.context.push(SWARM_COMPACTION_CONTEXT);
    }
  };
}
