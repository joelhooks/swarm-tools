/**
 * Decision Trace Integration
 *
 * Wires decision trace capture into swarm coordination tools.
 * Provides helper functions that tools can call to record decisions.
 *
 * ## Decision Types Captured
 *
 * - **strategy_selection** - Coordinator choosing decomposition strategy
 * - **worker_spawn** - Coordinator spawning a worker agent
 * - **review_decision** - Coordinator approving/rejecting worker output
 * - **file_selection** - Worker choosing which files to modify
 * - **scope_change** - Worker expanding/contracting task scope
 *
 * ## Usage
 *
 * ```typescript
 * import { traceStrategySelection, traceWorkerSpawn } from "./decision-trace-integration.js";
 *
 * // In swarm_delegate_planning:
 * await traceStrategySelection({
 *   projectKey: "/path/to/project",
 *   agentName: "coordinator",
 *   epicId: "epic-123",
 *   strategy: "file-based",
 *   reasoning: "File-based chosen due to clear file boundaries",
 *   alternatives: [{ strategy: "feature-based", reason: "rejected" }],
 * });
 * ```
 *
 * @module decision-trace-integration
 */

import { 
  createDecisionTrace, 
  createEntityLink,
  type DecisionTraceInput,
  type EntityLinkInput,
} from "swarm-mail";
import { createLibSQLAdapter } from "swarm-mail";
import { getDatabasePath } from "swarm-mail";

// ============================================================================
// Database Helper
// ============================================================================

/**
 * Get database adapter for decision trace storage
 *
 * Uses the same database as swarm-mail for consistency.
 */
async function getTraceDb(projectPath?: string) {
  const dbPath = getDatabasePath(projectPath);
  return createLibSQLAdapter({ url: `file:${dbPath}` });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract memory IDs from precedent_cited object
 *
 * Handles both single memoryId and array memoryIds fields.
 *
 * @param precedentCited - Precedent object from decision trace
 * @returns Array of memory IDs (empty if none found)
 */
export function extractMemoryIds(
  precedentCited?: { memoryId?: string; memoryIds?: string[]; similarity?: number } | null,
): string[] {
  if (!precedentCited) {
    return [];
  }
  
  // Check for array field first
  if (precedentCited.memoryIds && Array.isArray(precedentCited.memoryIds)) {
    return precedentCited.memoryIds;
  }
  
  // Check for single memoryId field
  if (precedentCited.memoryId) {
    return [precedentCited.memoryId];
  }
  
  return [];
}

// ============================================================================
// Strategy Selection Trace
// ============================================================================

/**
 * Input for tracing strategy selection decisions
 */
export interface StrategySelectionInput {
  projectKey: string;
  agentName: string;
  epicId?: string;
  beadId?: string;
  strategy: string;
  reasoning: string;
  confidence?: number;
  taskPreview?: string;
  inputsGathered?: Array<{
    source: string;
    query?: string;
    results?: number;
  }>;
  alternatives?: Array<{
    strategy: string;
    score?: number;
    reason?: string;
  }>;
  precedentCited?: {
    memoryId?: string;
    memoryIds?: string[];
    similarity?: number;
    cassResults?: number;
  };
}

/**
 * Trace a strategy selection decision
 *
 * Call this when the coordinator selects a decomposition strategy.
 * Automatically creates entity links to any memory patterns cited as precedent.
 *
 * @param input - Strategy selection details
 * @returns Created decision trace ID
 */
export async function traceStrategySelection(
  input: StrategySelectionInput,
): Promise<string> {
  try {
    const db = await getTraceDb(input.projectKey);

    const trace = await createDecisionTrace(db, {
      decision_type: "strategy_selection",
      epic_id: input.epicId,
      bead_id: input.beadId,
      agent_name: input.agentName,
      project_key: input.projectKey,
      decision: {
        strategy: input.strategy,
        confidence: input.confidence,
        task_preview: input.taskPreview,
      },
      rationale: input.reasoning,
      inputs_gathered: input.inputsGathered,
      alternatives: input.alternatives,
      precedent_cited: input.precedentCited,
    });

    // Create entity links for memory precedents
    const memoryIds = extractMemoryIds(input.precedentCited);
    for (const memoryId of memoryIds) {
      await createEntityLink(db, {
        source_decision_id: trace.id,
        target_entity_type: "memory",
        target_entity_id: memoryId,
        link_type: "cites_precedent",
        strength: input.precedentCited?.similarity ?? 1.0,
        context: "Cited as precedent for strategy selection",
      });
    }

    await db.close?.();
    return trace.id;
  } catch (error) {
    // Non-fatal - log and continue
    console.warn("[decision-trace] Failed to trace strategy_selection:", error);
    return "";
  }
}

// ============================================================================
// Worker Spawn Trace
// ============================================================================

/**
 * Input for tracing worker spawn decisions
 */
export interface WorkerSpawnInput {
  projectKey: string;
  agentName: string;
  epicId: string;
  beadId: string;
  workerName?: string;
  subtaskTitle: string;
  files: string[];
  model?: string;
  spawnOrder?: number;
  isParallel?: boolean;
  rationale?: string;
}

/**
 * Trace a worker spawn decision
 *
 * Call this when the coordinator spawns a worker agent.
 * Automatically creates entity links to assigned files.
 *
 * @param input - Worker spawn details
 * @returns Created decision trace ID
 */
export async function traceWorkerSpawn(
  input: WorkerSpawnInput,
): Promise<string> {
  try {
    const db = await getTraceDb(input.projectKey);

    const trace = await createDecisionTrace(db, {
      decision_type: "worker_spawn",
      epic_id: input.epicId,
      bead_id: input.beadId,
      agent_name: input.agentName,
      project_key: input.projectKey,
      decision: {
        worker: input.workerName || "worker",
        subtask_title: input.subtaskTitle,
        files: input.files,
        model: input.model,
        spawn_order: input.spawnOrder,
        is_parallel: input.isParallel,
      },
      rationale: input.rationale || `Spawning worker for: ${input.subtaskTitle}`,
    });

    // Create entity links for assigned files
    for (const file of input.files) {
      await createEntityLink(db, {
        source_decision_id: trace.id,
        target_entity_type: "file",
        target_entity_id: file,
        link_type: "assigns_file",
        strength: 1.0,
        context: `File assigned to worker ${input.workerName || "worker"}`,
      });
    }

    await db.close?.();
    return trace.id;
  } catch (error) {
    // Non-fatal - log and continue
    console.warn("[decision-trace] Failed to trace worker_spawn:", error);
    return "";
  }
}

// ============================================================================
// Review Decision Trace
// ============================================================================

/**
 * Input for tracing review decisions
 */
export interface ReviewDecisionInput {
  projectKey: string;
  agentName: string;
  epicId: string;
  beadId: string;
  workerId: string;
  status: "approved" | "needs_changes";
  summary?: string;
  issues?: Array<{
    file: string;
    line?: number;
    issue: string;
    suggestion?: string;
  }>;
  attemptNumber?: number;
  remainingAttempts?: number;
  rationale?: string;
}

/**
 * Trace a review decision
 *
 * Call this when the coordinator approves or rejects worker output.
 * Automatically creates entity link to the worker agent being reviewed.
 *
 * @param input - Review decision details
 * @returns Created decision trace ID
 */
export async function traceReviewDecision(
  input: ReviewDecisionInput,
): Promise<string> {
  try {
    const db = await getTraceDb(input.projectKey);

    const trace = await createDecisionTrace(db, {
      decision_type: "review_decision",
      epic_id: input.epicId,
      bead_id: input.beadId,
      agent_name: input.agentName,
      project_key: input.projectKey,
      decision: {
        status: input.status,
        worker_id: input.workerId,
        issues_count: input.issues?.length || 0,
        attempt_number: input.attemptNumber,
        remaining_attempts: input.remainingAttempts,
      },
      rationale: input.rationale || input.summary || `Review ${input.status}`,
      inputs_gathered: input.issues
        ? [{ source: "code_review", issues: input.issues }]
        : undefined,
    });

    // Create entity link to the worker agent being reviewed
    await createEntityLink(db, {
      source_decision_id: trace.id,
      target_entity_type: "agent",
      target_entity_id: input.workerId,
      link_type: "reviewed_work_by",
      strength: 1.0,
      context: `Review ${input.status} for ${input.workerId}`,
    });

    await db.close?.();
    return trace.id;
  } catch (error) {
    // Non-fatal - log and continue
    console.warn("[decision-trace] Failed to trace review_decision:", error);
    return "";
  }
}

// ============================================================================
// File Selection Trace (Worker)
// ============================================================================

/**
 * Input for tracing file selection decisions
 */
export interface FileSelectionInput {
  projectKey: string;
  agentName: string;
  epicId?: string;
  beadId: string;
  filesSelected: string[];
  filesOwned: string[];
  rationale?: string;
  scopeExpanded?: boolean;
}

/**
 * Trace a file selection decision
 *
 * Call this when a worker selects which files to modify.
 *
 * @param input - File selection details
 * @returns Created decision trace ID
 */
export async function traceFileSelection(
  input: FileSelectionInput,
): Promise<string> {
  try {
    const db = await getTraceDb(input.projectKey);

    const trace = await createDecisionTrace(db, {
      decision_type: "file_selection",
      epic_id: input.epicId,
      bead_id: input.beadId,
      agent_name: input.agentName,
      project_key: input.projectKey,
      decision: {
        files_selected: input.filesSelected,
        files_owned: input.filesOwned,
        scope_expanded: input.scopeExpanded,
      },
      rationale: input.rationale || `Selected ${input.filesSelected.length} files`,
    });

    await db.close?.();
    return trace.id;
  } catch (error) {
    // Non-fatal - log and continue
    console.warn("[decision-trace] Failed to trace file_selection:", error);
    return "";
  }
}

// ============================================================================
// Scope Change Trace (Worker)
// ============================================================================

/**
 * Input for tracing scope change decisions
 */
export interface ScopeChangeInput {
  projectKey: string;
  agentName: string;
  epicId?: string;
  beadId: string;
  filesAdded?: string[];
  filesRemoved?: string[];
  reason: string;
  coordinatorApproved?: boolean;
}

/**
 * Trace a scope change decision
 *
 * Call this when a worker expands or contracts their task scope.
 *
 * @param input - Scope change details
 * @returns Created decision trace ID
 */
export async function traceScopeChange(
  input: ScopeChangeInput,
): Promise<string> {
  try {
    const db = await getTraceDb(input.projectKey);

    const trace = await createDecisionTrace(db, {
      decision_type: "scope_change",
      epic_id: input.epicId,
      bead_id: input.beadId,
      agent_name: input.agentName,
      project_key: input.projectKey,
      decision: {
        files_added: input.filesAdded || [],
        files_removed: input.filesRemoved || [],
        coordinator_approved: input.coordinatorApproved,
      },
      rationale: input.reason,
    });

    await db.close?.();
    return trace.id;
  } catch (error) {
    // Non-fatal - log and continue
    console.warn("[decision-trace] Failed to trace scope_change:", error);
    return "";
  }
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Get all decision traces for an epic
 *
 * Useful for post-hoc analysis of how an epic was coordinated.
 *
 * @param projectKey - Project path
 * @param epicId - Epic ID to query
 * @returns Array of decision traces
 */
export async function getEpicDecisionTraces(
  projectKey: string,
  epicId: string,
) {
  try {
    const { getDecisionTracesByEpic } = await import("swarm-mail");
    const db = await getTraceDb(projectKey);
    const traces = await getDecisionTracesByEpic(db, epicId);
    await db.close?.();
    return traces;
  } catch (error) {
    console.warn("[decision-trace] Failed to query epic traces:", error);
    return [];
  }
}

/**
 * Get decision traces by type for analysis
 *
 * @param projectKey - Project path
 * @param decisionType - Type of decision to query
 * @returns Array of decision traces
 */
export async function getDecisionTracesByType(
  projectKey: string,
  decisionType: string,
) {
  try {
    const { getDecisionTracesByType: queryByType } = await import("swarm-mail");
    const db = await getTraceDb(projectKey);
    const traces = await queryByType(db, decisionType);
    await db.close?.();
    return traces;
  } catch (error) {
    console.warn("[decision-trace] Failed to query traces by type:", error);
    return [];
  }
}

// ============================================================================
// Outcome Linking
// ============================================================================

/**
 * Input for linking an outcome to a decision trace
 */
export interface LinkOutcomeInput {
  projectKey: string;
  beadId: string;
  outcomeEventId: number;
}

/**
 * Link an outcome event to its decision trace and calculate quality score.
 *
 * Finds the most recent decision trace for the bead and links the outcome
 * event to it, triggering quality score calculation.
 *
 * @param input - Outcome linking details
 * @returns true if linked successfully, false if no trace found or error
 */
export async function linkOutcomeToDecisionTrace(
  input: LinkOutcomeInput,
): Promise<boolean> {
  try {
    const { findDecisionTraceByBead, linkOutcomeToTrace } = await import("swarm-mail");
    const db = await getTraceDb(input.projectKey);

    // Find the decision trace for this bead
    const trace = await findDecisionTraceByBead(db, input.beadId);

    if (!trace) {
      // No trace found - this is normal for tasks without decision traces
      await db.close?.();
      return false;
    }

    // Link the outcome and calculate quality score
    await linkOutcomeToTrace(db, trace.id, input.outcomeEventId);

    await db.close?.();
    return true;
  } catch (error) {
    console.warn("[decision-trace] Failed to link outcome to trace:", error);
    return false;
  }
}
