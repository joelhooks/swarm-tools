/**
 * Drizzle schema for streams subsystem.
 *
 * Translated from libsql-schema.ts to Drizzle ORM table definitions.
 * Defines event store, projections, and coordination primitives.
 *
 * ## Tables
 *
 * - **events** - Append-only event log (core event store)
 * - **agents** - Registered agents (materialized view)
 * - **messages** - Inter-agent messages (materialized view)
 * - **message_recipients** - Many-to-many message recipients
 * - **reservations** - File locks for coordination
 * - **locks** - Distributed mutex
 * - **cursors** - Stream position tracking
 * - **eval_records** - Decomposition eval tracking
 * - **swarm_contexts** - Swarm checkpoint tracking
 *
 * @module db/schema/streams
 */

import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Events table - append-only event log.
 *
 * Core of the event store. All state changes are recorded as events.
 * Indexed for fast querying by project_key and type.
 */
export const eventsTable = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    project_key: text("project_key").notNull(),
    timestamp: integer("timestamp").notNull(),
    // sequence is a GENERATED ALWAYS AS (id) STORED column in SQLite
    // We mark it as generated so Drizzle doesn't try to INSERT into it
    sequence: integer("sequence").generatedAlwaysAs(sql`id`),
    data: text("data").notNull(), // JSON string
  },
  (table) => ({
    projectKeyIdx: index("idx_events_project_key").on(table.project_key),
    typeIdx: index("idx_events_type").on(table.type),
    timestampIdx: index("idx_events_timestamp").on(table.timestamp),
    projectTypeIdx: index("idx_events_project_type").on(table.project_key, table.type),
  }),
);

/**
 * Agents table - registered agents.
 *
 * Materialized view of agent registrations from event stream.
 * Each agent has a unique name within a project.
 */
export const agentsTable = sqliteTable(
  "agents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project_key: text("project_key").notNull(),
    name: text("name").notNull(),
    program: text("program").default("opencode"),
    model: text("model").default("unknown"),
    task_description: text("task_description"),
    registered_at: integer("registered_at").notNull(),
    last_active_at: integer("last_active_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_agents_project").on(table.project_key),
    // UNIQUE constraint on (project_key, name) is handled in schema SQL
  }),
);

/**
 * Messages table - inter-agent messages.
 *
 * Materialized view of messages sent between agents.
 * Indexed by thread_id for conversation threading.
 */
export const messagesTable = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project_key: text("project_key").notNull(),
    from_agent: text("from_agent").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    thread_id: text("thread_id"),
    importance: text("importance").default("normal"),
    ack_required: integer("ack_required", { mode: "boolean" }).default(false),
    created_at: integer("created_at").notNull(),
  },
  (table) => ({
    projectIdx: index("idx_messages_project").on(table.project_key),
    threadIdIdx: index("idx_messages_thread").on(table.thread_id),
    createdIdx: index("idx_messages_created").on(table.created_at),
    senderTimeIdx: index("idx_messages_sender_time").on(table.project_key, table.from_agent, table.created_at),
  }),
);

/**
 * Message Recipients table - many-to-many message recipients.
 *
 * Tracks which agents received a message and their read/ack status.
 * CASCADE delete when message is deleted.
 */
export const messageRecipientsTable = sqliteTable(
  "message_recipients",
  {
    message_id: integer("message_id").notNull(),
    agent_name: text("agent_name").notNull(),
    read_at: integer("read_at"),
    acked_at: integer("acked_at"),
    // PRIMARY KEY(message_id, agent_name) handled in schema SQL
    // FOREIGN KEY handled in schema SQL
  },
  (table) => ({
    agentIdx: index("idx_recipients_agent").on(table.agent_name),
  }),
);

/**
 * Reservations table - file locks.
 *
 * Agents reserve file paths before editing to prevent conflicts.
 * Expires_at enables automatic cleanup of stale reservations.
 */
export const reservationsTable = sqliteTable(
  "reservations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project_key: text("project_key").notNull(),
    agent_name: text("agent_name").notNull(),
    path_pattern: text("path_pattern").notNull(),
    exclusive: integer("exclusive", { mode: "boolean" }).default(true),
    reason: text("reason"),
    created_at: integer("created_at").notNull(),
    expires_at: integer("expires_at").notNull(),
    released_at: integer("released_at"),
    lock_holder_id: text("lock_holder_id"),
  },
  (table) => ({
    projectIdx: index("idx_reservations_project").on(table.project_key),
    agentIdx: index("idx_reservations_agent").on(table.agent_name),
    expiresIdx: index("idx_reservations_expires").on(table.expires_at),
    activeIdx: index("idx_reservations_active").on(table.project_key, table.released_at, table.expires_at),
    // Partial index for active reservations handled in schema SQL
  }),
);

/**
 * Locks table - distributed locks.
 *
 * Enables distributed mutex for critical sections across agents.
 * Expires_at enables automatic lock release.
 */
export const locksTable = sqliteTable(
  "locks",
  {
    resource: text("resource").primaryKey(),
    holder: text("holder").notNull(),
    seq: integer("seq").notNull().default(0),
    acquired_at: integer("acquired_at").notNull(),
    expires_at: integer("expires_at").notNull(),
  },
  (table) => ({
    expiresIdx: index("idx_locks_expires").on(table.expires_at),
    holderIdx: index("idx_locks_holder").on(table.holder),
  }),
);

/**
 * Cursors table - stream position tracking.
 *
 * Tracks read position in event streams for projections and consumers.
 * Primary key is stream_id.
 */
export const cursorsTable = sqliteTable(
  "cursors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stream: text("stream").notNull(),
    checkpoint: text("checkpoint").notNull(),
    position: integer("position").notNull().default(0),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => ({
    streamIdx: index("idx_cursors_stream").on(table.stream),
    checkpointIdx: index("idx_cursors_checkpoint").on(table.checkpoint),
    updatedIdx: index("idx_cursors_updated").on(table.updated_at),
    // UNIQUE(stream, checkpoint) handled in schema SQL
  }),
);

/**
 * Eval Records table - decomposition eval tracking.
 *
 * Tracks outcomes of swarm decomposition for learning.
 */
export const evalRecordsTable = sqliteTable("eval_records", {
  id: text("id").primaryKey(),
  project_key: text("project_key").notNull(),
  task: text("task").notNull(),
  context: text("context"),
  strategy: text("strategy").notNull(),
  epic_title: text("epic_title").notNull(),
  subtasks: text("subtasks").notNull(), // JSON array
  outcomes: text("outcomes"), // JSON array
  overall_success: integer("overall_success", { mode: "boolean" }),
  total_duration_ms: integer("total_duration_ms"),
  total_errors: integer("total_errors"),
  human_accepted: integer("human_accepted", { mode: "boolean" }),
  human_modified: integer("human_modified", { mode: "boolean" }),
  human_notes: text("human_notes"),
  file_overlap_count: integer("file_overlap_count"),
  scope_accuracy: real("scope_accuracy"),
  time_balance_ratio: real("time_balance_ratio"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

/**
 * Swarm Contexts table - swarm checkpoint tracking.
 *
 * Stores swarm coordination checkpoints for recovery.
 */
export const swarmContextsTable = sqliteTable("swarm_contexts", {
  id: text("id").primaryKey(),
  project_key: text("project_key").notNull(),
  epic_id: text("epic_id").notNull(),
  bead_id: text("bead_id").notNull(),
  strategy: text("strategy").notNull(),
  files: text("files").notNull(), // JSON array
  dependencies: text("dependencies").notNull(), // JSON array
  directives: text("directives").notNull(), // JSON object
  recovery: text("recovery").notNull(), // JSON object
  created_at: integer("created_at").notNull(),
  checkpointed_at: integer("checkpointed_at").notNull(),
  recovered_at: integer("recovered_at"),
  recovered_from_checkpoint: integer("recovered_from_checkpoint"),
  updated_at: integer("updated_at").notNull(),
});

/**
 * Decision Traces table - decision trace log.
 *
 * Captures coordinator and worker decision-making process for analysis.
 * Enables understanding of how agents arrive at task decompositions,
 * strategy selections, and coordination decisions.
 */
export const decisionTracesTable = sqliteTable(
  "decision_traces",
  {
    id: text("id").primaryKey(), // dt-{nanoid}
    decision_type: text("decision_type").notNull(),
    epic_id: text("epic_id"),
    bead_id: text("bead_id"),
    agent_name: text("agent_name").notNull(),
    project_key: text("project_key").notNull(),
    decision: text("decision").notNull(), // JSON
    rationale: text("rationale"),
    inputs_gathered: text("inputs_gathered"), // JSON
    policy_evaluated: text("policy_evaluated"), // JSON
    alternatives: text("alternatives"), // JSON
    precedent_cited: text("precedent_cited"), // JSON
    outcome_event_id: integer("outcome_event_id"),
    quality_score: real("quality_score"), // Computed from outcome events
    timestamp: integer("timestamp").notNull(),
  },
  (table) => ({
    epicIdx: index("idx_decision_traces_epic").on(table.epic_id),
    typeIdx: index("idx_decision_traces_type").on(table.decision_type),
    agentIdx: index("idx_decision_traces_agent").on(table.agent_name),
    timestampIdx: index("idx_decision_traces_timestamp").on(table.timestamp),
  }),
);

export type DecisionTrace = typeof decisionTracesTable.$inferSelect;
export type NewDecisionTrace = typeof decisionTracesTable.$inferInsert;

/**
 * Entity Links table - relationships between decisions and entities.
 *
 * Enables building a knowledge graph of how decisions relate to:
 * - Epics (which epic was this decision part of)
 * - Patterns (which patterns did this decision apply)
 * - Files (which files were affected)
 * - Agents (which agents were involved)
 * - Memories (which past experiences informed this decision)
 *
 * Link types capture the nature of the relationship:
 * - cites_precedent: Decision references a past decision/memory
 * - applies_pattern: Decision applies a known pattern
 * - similar_to: Decision is similar to another decision
 *
 * Strength indicates confidence in the relationship (0.0 to 1.0).
 */
export const entityLinksTable = sqliteTable(
  "entity_links",
  {
    id: text("id").primaryKey(), // el-{nanoid}
    source_decision_id: text("source_decision_id").notNull(),
    target_entity_type: text("target_entity_type").notNull(), // 'epic', 'pattern', 'file', 'agent', 'memory'
    target_entity_id: text("target_entity_id").notNull(),
    link_type: text("link_type").notNull(), // 'cites_precedent', 'applies_pattern', 'similar_to'
    strength: real("strength").default(1.0),
    context: text("context"),
  },
  (table) => ({
    sourceIdx: index("idx_entity_links_source").on(table.source_decision_id),
    targetIdx: index("idx_entity_links_target").on(table.target_entity_type, table.target_entity_id),
    typeIdx: index("idx_entity_links_type").on(table.link_type),
  }),
);

export type EntityLink = typeof entityLinksTable.$inferSelect;
export type NewEntityLink = typeof entityLinksTable.$inferInsert;
