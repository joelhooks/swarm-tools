/**
 * Decision Trace Store
 *
 * Service layer for capturing and querying decision traces.
 * Decision traces record the reasoning process of coordinators and workers,
 * enabling post-hoc analysis of how agents arrive at decisions.
 *
 * ## Decision Types
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
 * import { createDecisionTrace, getDecisionTracesByEpic } from "./decision-trace-store.js";
 *
 * // Record a decision
 * const trace = await createDecisionTrace(db, {
 *   decision_type: "strategy_selection",
 *   agent_name: "coordinator",
 *   project_key: "/path/to/project",
 *   decision: { strategy: "file-based", confidence: 0.85 },
 *   rationale: "File-based chosen due to clear file boundaries",
 *   inputs_gathered: [{ source: "cass", query: "similar tasks", results: 3 }],
 * });
 *
 * // Query decisions for an epic
 * const traces = await getDecisionTracesByEpic(db, "epic-123");
 * ```
 *
 * @module streams/decision-trace-store
 */

import { nanoid } from "nanoid";
import type { DatabaseAdapter } from "../types/database.js";

/**
 * Input for creating a decision trace.
 * All JSON fields accept objects that will be serialized.
 */
export interface DecisionTraceInput {
  /** Type of decision being made */
  decision_type: string;
  /** Epic this decision relates to (optional) */
  epic_id?: string;
  /** Specific cell/bead this decision relates to (optional) */
  bead_id?: string;
  /** Agent making the decision */
  agent_name: string;
  /** Project key for scoping */
  project_key: string;
  /** The decision itself (JSON-serializable) */
  decision: Record<string, unknown>;
  /** Human-readable explanation of why this decision was made */
  rationale?: string;
  /** Inputs gathered before making the decision */
  inputs_gathered?: Array<Record<string, unknown>>;
  /** Policy rules evaluated during decision */
  policy_evaluated?: Record<string, unknown>;
  /** Alternative decisions considered but rejected */
  alternatives?: Array<Record<string, unknown>>;
  /** Prior decisions or memories cited as precedent */
  precedent_cited?: Record<string, unknown>;
}

/**
 * Stored decision trace with generated fields.
 */
export interface DecisionTrace {
  id: string;
  decision_type: string;
  epic_id: string | null;
  bead_id: string | null;
  agent_name: string;
  project_key: string;
  decision: string; // JSON string
  rationale: string | null;
  inputs_gathered: string | null; // JSON string
  policy_evaluated: string | null; // JSON string
  alternatives: string | null; // JSON string
  precedent_cited: string | null; // JSON string
  outcome_event_id: number | null;
  quality_score: number | null;
  timestamp: number;
  created_at: string | null;
}

/**
 * Input for creating an entity link.
 */
export interface EntityLinkInput {
  /** Decision that is the source of this link */
  source_decision_id: string;
  /** Type of entity being linked to */
  target_entity_type: string;
  /** ID of the entity being linked to */
  target_entity_id: string;
  /** Nature of the relationship */
  link_type: string;
  /** Confidence in the relationship (0.0 to 1.0) */
  strength?: number;
  /** Optional context explaining the link */
  context?: string;
}

/**
 * Stored entity link with generated fields.
 */
export interface EntityLink {
  id: string;
  source_decision_id: string;
  target_entity_type: string;
  target_entity_id: string;
  link_type: string;
  strength: number;
  context: string | null;
  created_at: string | null;
}

/**
 * Decision with optional link metadata.
 */
export interface DecisionWithLink extends DecisionTrace {
  link_type?: string;
  link_strength?: number;
  link_context?: string | null;
}

/**
 * Decision quality metrics.
 */
export interface DecisionQuality {
  decision_id: string;
  quality_score: number | null;
  outcome_type: string | null;
  success: boolean | null;
  error_count: number | null;
}

/**
 * Strategy success rate metrics.
 */
export interface StrategySuccessRate {
  strategy: string;
  total_decisions: number;
  successful_decisions: number;
  failed_decisions: number;
  success_rate: number;
  avg_quality: number | null;
}

/**
 * Create a new decision trace.
 *
 * Generates a unique ID with `dt-` prefix and records the decision
 * with all provided context.
 *
 * @param db - Database adapter
 * @param input - Decision trace input
 * @returns Created decision trace with generated ID and timestamp
 */
export async function createDecisionTrace(
  db: DatabaseAdapter,
  input: DecisionTraceInput,
): Promise<DecisionTrace> {
  const id = `dt-${nanoid(10)}`;
  const timestamp = Date.now();

  await db.query(
    `INSERT INTO decision_traces (
      id, decision_type, epic_id, bead_id, agent_name, project_key,
      decision, rationale, inputs_gathered, policy_evaluated,
      alternatives, precedent_cited, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.decision_type,
      input.epic_id ?? null,
      input.bead_id ?? null,
      input.agent_name,
      input.project_key,
      JSON.stringify(input.decision),
      input.rationale ?? null,
      input.inputs_gathered ? JSON.stringify(input.inputs_gathered) : null,
      input.policy_evaluated ? JSON.stringify(input.policy_evaluated) : null,
      input.alternatives ? JSON.stringify(input.alternatives) : null,
      input.precedent_cited ? JSON.stringify(input.precedent_cited) : null,
      timestamp,
    ],
  );

  return {
    id,
    decision_type: input.decision_type,
    epic_id: input.epic_id ?? null,
    bead_id: input.bead_id ?? null,
    agent_name: input.agent_name,
    project_key: input.project_key,
    decision: JSON.stringify(input.decision),
    rationale: input.rationale ?? null,
    inputs_gathered: input.inputs_gathered ? JSON.stringify(input.inputs_gathered) : null,
    policy_evaluated: input.policy_evaluated ? JSON.stringify(input.policy_evaluated) : null,
    alternatives: input.alternatives ? JSON.stringify(input.alternatives) : null,
    precedent_cited: input.precedent_cited ? JSON.stringify(input.precedent_cited) : null,
    outcome_event_id: null,
    quality_score: null,
    timestamp,
    created_at: null, // Set by database default
  };
}

/**
 * Get all decision traces for an epic, ordered by timestamp.
 *
 * @param db - Database adapter
 * @param epicId - Epic ID to query
 * @returns Array of decision traces in chronological order
 */
export async function getDecisionTracesByEpic(
  db: DatabaseAdapter,
  epicId: string,
): Promise<DecisionTrace[]> {
  const result = await db.query<DecisionTrace>(
    `SELECT * FROM decision_traces WHERE epic_id = ? ORDER BY timestamp ASC`,
    [epicId],
  );

  return result.rows;
}

/**
 * Find the most recent decision trace for a bead.
 *
 * Used to link outcome events back to the decision that spawned the work.
 * Returns the most recent trace since multiple decisions may reference the same bead.
 *
 * @param db - Database adapter
 * @param beadId - Bead/cell ID to query
 * @returns Most recent decision trace for the bead, or null if none found
 */
export async function findDecisionTraceByBead(
  db: DatabaseAdapter,
  beadId: string,
): Promise<DecisionTrace | null> {
  const result = await db.query<DecisionTrace>(
    `SELECT * FROM decision_traces WHERE bead_id = ? ORDER BY timestamp DESC LIMIT 1`,
    [beadId],
  );

  return result.rows[0] ?? null;
}

/**
 * Get all decision traces for an agent, ordered by timestamp.
 *
 * @param db - Database adapter
 * @param agentName - Agent name to query
 * @returns Array of decision traces in chronological order
 */
export async function getDecisionTracesByAgent(
  db: DatabaseAdapter,
  agentName: string,
): Promise<DecisionTrace[]> {
  const result = await db.query<DecisionTrace>(
    `SELECT * FROM decision_traces WHERE agent_name = ? ORDER BY timestamp ASC`,
    [agentName],
  );

  return result.rows;
}

/**
 * Get all decision traces of a specific type, ordered by timestamp.
 *
 * @param db - Database adapter
 * @param decisionType - Decision type to query
 * @returns Array of decision traces in chronological order
 */
export async function getDecisionTracesByType(
  db: DatabaseAdapter,
  decisionType: string,
): Promise<DecisionTrace[]> {
  const result = await db.query<DecisionTrace>(
    `SELECT * FROM decision_traces WHERE decision_type = ? ORDER BY timestamp ASC`,
    [decisionType],
  );

  return result.rows;
}

/**
 * Link an outcome event to a decision trace and update quality score.
 *
 * This creates a bidirectional link between the decision and its outcome,
 * enabling analysis of decision quality. Automatically calculates and
 * updates the quality_score based on the outcome event.
 *
 * @param db - Database adapter
 * @param traceId - Decision trace ID
 * @param outcomeEventId - Event ID of the outcome
 */
export async function linkOutcomeToTrace(
  db: DatabaseAdapter,
  traceId: string,
  outcomeEventId: number,
): Promise<void> {
  // Link the outcome
  await db.query(
    `UPDATE decision_traces SET outcome_event_id = ? WHERE id = ?`,
    [outcomeEventId, traceId],
  );

  // Calculate and update quality score
  const quality = await calculateDecisionQuality(db, traceId);
  if (quality.quality_score !== null) {
    await db.query(
      `UPDATE decision_traces SET quality_score = ? WHERE id = ?`,
      [quality.quality_score, traceId],
    );
  }
}

/**
 * Find similar past strategy_selection decisions.
 *
 * Searches for past strategy_selection decision traces that are similar
 * to the given task description. Uses simple text matching on the decision
 * JSON (which includes the task description).
 *
 * @param db - Database adapter
 * @param task - Task description to match against
 * @param limit - Maximum number of results to return
 * @returns Array of similar decision traces with outcomes
 */
export async function findSimilarDecisions(
  db: DatabaseAdapter,
  task: string,
  limit: number,
): Promise<DecisionTrace[]> {
  // Simple text matching - in production, this could use vector similarity
  const searchTerm = `%${task.toLowerCase()}%`;
  
  const result = await db.query<DecisionTrace>(
    `SELECT * FROM decision_traces 
     WHERE decision_type = 'strategy_selection' 
     AND LOWER(decision) LIKE ?
     ORDER BY timestamp DESC
     LIMIT ?`,
    [searchTerm, limit],
  );

  return result.rows;
}

/**
 * Create an entity link between a decision and another entity.
 *
 * Entity links capture relationships like:
 * - Decision cites a memory as precedent
 * - Decision applies a known pattern
 * - Decision is similar to another decision
 *
 * @param db - Database adapter
 * @param input - Entity link input
 * @returns Created entity link with generated ID
 */
export async function createEntityLink(
  db: DatabaseAdapter,
  input: EntityLinkInput,
): Promise<EntityLink> {
  const id = `el-${nanoid(10)}`;
  const strength = input.strength ?? 1.0;

  await db.query(
    `INSERT INTO entity_links (
      id, source_decision_id, target_entity_type, target_entity_id,
      link_type, strength, context
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.source_decision_id,
      input.target_entity_type,
      input.target_entity_id,
      input.link_type,
      strength,
      input.context ?? null,
    ],
  );

  return {
    id,
    source_decision_id: input.source_decision_id,
    target_entity_type: input.target_entity_type,
    target_entity_id: input.target_entity_id,
    link_type: input.link_type,
    strength,
    context: input.context ?? null,
    created_at: null, // Set by database default
  };
}

/**
 * Get all decisions that cite a specific memory.
 *
 * Finds decisions that have entity links to the given memory ID
 * with link_type 'cites_precedent'.
 *
 * @param db - Database adapter
 * @param memoryId - Memory ID to query
 * @returns Array of decisions with link metadata
 */
export async function getDecisionsByMemoryPattern(
  db: DatabaseAdapter,
  memoryId: string,
): Promise<DecisionWithLink[]> {
  const result = await db.query<DecisionWithLink>(
    `SELECT 
      dt.*,
      el.link_type,
      el.strength as link_strength,
      el.context as link_context
     FROM decision_traces dt
     INNER JOIN entity_links el ON dt.id = el.source_decision_id
     WHERE el.target_entity_type = 'memory' 
     AND el.target_entity_id = ?
     ORDER BY dt.timestamp DESC`,
    [memoryId],
  );

  return result.rows;
}

/**
 * Calculate decision quality from linked outcome events.
 *
 * Quality is computed based on:
 * - Event type (swarm.completed vs swarm.failed)
 * - Success field in event data
 * - Error count in event data
 *
 * Quality score is 0.0 to 1.0, where:
 * - 1.0 = successful with no errors
 * - 0.5 = completed with some errors
 * - 0.0 = failed
 *
 * @param db - Database adapter
 * @param decisionId - Decision trace ID
 * @returns Decision quality metrics
 */
export async function calculateDecisionQuality(
  db: DatabaseAdapter,
  decisionId: string,
): Promise<DecisionQuality> {
  const result = await db.query<{
    outcome_event_id: number | null;
    event_type: string | null;
    event_data: string | null;
  }>(
    `SELECT 
      dt.outcome_event_id,
      e.type as event_type,
      e.data as event_data
     FROM decision_traces dt
     LEFT JOIN events e ON dt.outcome_event_id = e.id
     WHERE dt.id = ?`,
    [decisionId],
  );

  const row = result.rows[0];
  
  if (!row || !row.outcome_event_id || !row.event_type || !row.event_data) {
    return {
      decision_id: decisionId,
      quality_score: null,
      outcome_type: null,
      success: null,
      error_count: null,
    };
  }

  // Parse event data
  const eventData = JSON.parse(row.event_data);
  const success = eventData.success ?? null;
  const errorCount = eventData.errors ?? eventData.error_count ?? 0;

  // Calculate quality score
  let qualityScore: number;
  
  if (row.event_type.includes("failed") || success === false) {
    qualityScore = 0.0;
  } else if (row.event_type.includes("completed") || success === true) {
    if (errorCount === 0) {
      qualityScore = 1.0;
    } else {
      // Penalize for errors, but don't go below 0.5 if completed
      qualityScore = Math.max(0.5, 1.0 - (errorCount * 0.1));
    }
  } else {
    qualityScore = 0.5; // Unknown outcome type
  }

  return {
    decision_id: decisionId,
    quality_score: qualityScore,
    outcome_type: row.event_type,
    success,
    error_count: errorCount,
  };
}

/**
 * Get success rates aggregated by strategy type.
 *
 * Analyzes all strategy_selection decisions with outcomes and
 * computes success rates for each strategy (file-based, feature-based, etc).
 *
 * @param db - Database adapter
 * @returns Array of strategy success rates
 */
export async function getStrategySuccessRates(
  db: DatabaseAdapter,
): Promise<StrategySuccessRate[]> {
  const result = await db.query<{
    strategy: string;
    total_decisions: number;
    successful_decisions: number;
    failed_decisions: number;
    avg_quality: number | null;
  }>(
    `SELECT 
      JSON_EXTRACT(decision, '$.strategy') as strategy,
      COUNT(*) as total_decisions,
      SUM(CASE WHEN quality_score >= 0.5 THEN 1 ELSE 0 END) as successful_decisions,
      SUM(CASE WHEN quality_score < 0.5 THEN 1 ELSE 0 END) as failed_decisions,
      AVG(quality_score) as avg_quality
     FROM decision_traces
     WHERE decision_type = 'strategy_selection'
     AND outcome_event_id IS NOT NULL
     AND quality_score IS NOT NULL
     GROUP BY strategy
     ORDER BY total_decisions DESC`,
  );

  return result.rows.map(row => ({
    strategy: row.strategy,
    total_decisions: row.total_decisions,
    successful_decisions: row.successful_decisions,
    failed_decisions: row.failed_decisions,
    success_rate: row.total_decisions > 0 
      ? row.successful_decisions / row.total_decisions 
      : 0,
    avg_quality: row.avg_quality,
  }));
}
