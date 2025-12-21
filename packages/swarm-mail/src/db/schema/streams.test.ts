import { describe, expect, test } from "bun:test";
import {
  agentsTable,
  cursorsTable,
  evalRecordsTable,
  eventsTable,
  locksTable,
  messageRecipientsTable,
  messagesTable,
  reservationsTable,
  swarmContextsTable,
} from "./streams.js";

describe("Streams Schema", () => {
  test("eventsTable has correct structure", () => {
    expect(eventsTable).toBeDefined();

    // Core columns
    expect(eventsTable.id).toBeDefined();
    expect(eventsTable.type).toBeDefined();
    expect(eventsTable.project_key).toBeDefined();
    expect(eventsTable.timestamp).toBeDefined();
    expect(eventsTable.sequence).toBeDefined();
    expect(eventsTable.data).toBeDefined();
    expect(eventsTable.created_at).toBeDefined();
  });

  test("agentsTable has correct structure", () => {
    expect(agentsTable).toBeDefined();

    expect(agentsTable.id).toBeDefined();
    expect(agentsTable.project_key).toBeDefined();
    expect(agentsTable.name).toBeDefined();
    expect(agentsTable.program).toBeDefined();
    expect(agentsTable.model).toBeDefined();
    expect(agentsTable.task_description).toBeDefined();
    expect(agentsTable.registered_at).toBeDefined();
    expect(agentsTable.last_active_at).toBeDefined();
  });

  test("messagesTable has correct structure", () => {
    expect(messagesTable).toBeDefined();

    expect(messagesTable.id).toBeDefined();
    expect(messagesTable.project_key).toBeDefined();
    expect(messagesTable.from_agent).toBeDefined();
    expect(messagesTable.subject).toBeDefined();
    expect(messagesTable.body).toBeDefined();
    expect(messagesTable.thread_id).toBeDefined();
    expect(messagesTable.importance).toBeDefined();
    expect(messagesTable.ack_required).toBeDefined();
    expect(messagesTable.created_at).toBeDefined();
  });

  test("messageRecipientsTable has correct structure", () => {
    expect(messageRecipientsTable).toBeDefined();

    expect(messageRecipientsTable.message_id).toBeDefined();
    expect(messageRecipientsTable.agent_name).toBeDefined();
    expect(messageRecipientsTable.read_at).toBeDefined();
    expect(messageRecipientsTable.acked_at).toBeDefined();
  });

  test("reservationsTable has correct structure", () => {
    expect(reservationsTable).toBeDefined();

    expect(reservationsTable.id).toBeDefined();
    expect(reservationsTable.project_key).toBeDefined();
    expect(reservationsTable.agent_name).toBeDefined();
    expect(reservationsTable.path_pattern).toBeDefined();
    expect(reservationsTable.exclusive).toBeDefined();
    expect(reservationsTable.reason).toBeDefined();
    expect(reservationsTable.created_at).toBeDefined();
    expect(reservationsTable.expires_at).toBeDefined();
    expect(reservationsTable.released_at).toBeDefined();
  });

  test("cursorsTable has correct structure", () => {
    expect(cursorsTable).toBeDefined();

    expect(cursorsTable.id).toBeDefined();
    expect(cursorsTable.stream).toBeDefined();
    expect(cursorsTable.checkpoint).toBeDefined();
    expect(cursorsTable.position).toBeDefined();
    expect(cursorsTable.updated_at).toBeDefined();
  });

  test("locksTable has correct structure", () => {
    expect(locksTable).toBeDefined();

    expect(locksTable.resource).toBeDefined();
    expect(locksTable.holder).toBeDefined();
    expect(locksTable.seq).toBeDefined();
    expect(locksTable.acquired_at).toBeDefined();
    expect(locksTable.expires_at).toBeDefined();
  });

  test("evalRecordsTable has correct structure", () => {
    expect(evalRecordsTable).toBeDefined();

    expect(evalRecordsTable.id).toBeDefined();
    expect(evalRecordsTable.project_key).toBeDefined();
    expect(evalRecordsTable.task).toBeDefined();
    expect(evalRecordsTable.strategy).toBeDefined();
    expect(evalRecordsTable.epic_title).toBeDefined();
    expect(evalRecordsTable.subtasks).toBeDefined();
    expect(evalRecordsTable.outcomes).toBeDefined();
    expect(evalRecordsTable.overall_success).toBeDefined();
    expect(evalRecordsTable.created_at).toBeDefined();
    expect(evalRecordsTable.updated_at).toBeDefined();
  });

  test("swarmContextsTable has correct structure", () => {
    expect(swarmContextsTable).toBeDefined();

    expect(swarmContextsTable.id).toBeDefined();
    expect(swarmContextsTable.project_key).toBeDefined();
    expect(swarmContextsTable.epic_id).toBeDefined();
    expect(swarmContextsTable.bead_id).toBeDefined();
    expect(swarmContextsTable.strategy).toBeDefined();
    expect(swarmContextsTable.files).toBeDefined();
    expect(swarmContextsTable.dependencies).toBeDefined();
    expect(swarmContextsTable.directives).toBeDefined();
    expect(swarmContextsTable.recovery).toBeDefined();
    expect(swarmContextsTable.created_at).toBeDefined();
    expect(swarmContextsTable.checkpointed_at).toBeDefined();
    expect(swarmContextsTable.updated_at).toBeDefined();
  });
});
