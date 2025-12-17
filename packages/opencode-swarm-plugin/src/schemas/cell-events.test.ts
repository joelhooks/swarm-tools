/**
 * Tests for Cell Event Schemas
 *
 * Validates event creation, validation, and type guards.
 */
import { describe, expect, test } from "bun:test";
import {
  type CellCreatedEvent,
  CellEventSchema,
  createCellEvent,
  getCellIdFromEvent,
  isAgentEvent,
  isCellEventType,
  isEpicEvent,
  isStateTransitionEvent,
  // Legacy aliases for backward compatibility
  type BeadCreatedEvent,
  BeadEventSchema,
  createBeadEvent,
  getBeadIdFromEvent,
  isBeadEventType,
} from "./cell-events.js";

describe("CellEventSchema", () => {
  const projectKey = "/path/to/repo";

  describe("createCellEvent", () => {
    test("creates valid cell_created event", () => {
      const event = createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Add authentication",
        issue_type: "feature",
        priority: 2,
      });

      expect(event.type).toBe("cell_created");
      expect(event.cell_id).toBe("bd-123");
      expect(event.title).toBe("Add authentication");
      expect(event.timestamp).toBeGreaterThan(0);
    });

    test("creates valid cell_closed event", () => {
      const event = createCellEvent("cell_closed", {
        project_key: projectKey,
        cell_id: "bd-123",
        reason: "Implemented OAuth flow",
        closed_by: "BlueLake",
        files_touched: ["src/auth.ts", "src/oauth.ts"],
        duration_ms: 45000,
      });

      expect(event.type).toBe("cell_closed");
      expect(event.reason).toBe("Implemented OAuth flow");
      expect(event.closed_by).toBe("BlueLake");
      expect(event.files_touched).toHaveLength(2);
    });

    test("creates valid cell_dependency_added event", () => {
      const event = createCellEvent("cell_dependency_added", {
        project_key: projectKey,
        cell_id: "bd-123",
        dependency: {
          id: "bd-456",
          type: "blocks",
        },
        reason: "Needs database schema before service layer",
      });

      expect(event.type).toBe("cell_dependency_added");
      expect(event.dependency.type).toBe("blocks");
      expect(event.dependency.id).toBe("bd-456");
    });

    test("creates valid cell_epic_child_added event", () => {
      const event = createCellEvent("cell_epic_child_added", {
        project_key: projectKey,
        cell_id: "bd-epic-1",
        child_id: "bd-epic-1.1",
        child_index: 0,
      });

      expect(event.type).toBe("cell_epic_child_added");
      expect(event.child_id).toBe("bd-epic-1.1");
    });

    test("throws on invalid event data", () => {
      expect(() =>
        createCellEvent("cell_created", {
          project_key: projectKey,
          cell_id: "bd-123",
          title: "Test",
          // @ts-expect-error - Testing invalid issue_type
          issue_type: "invalid_type",
          priority: 2,
        }),
      ).toThrow("Invalid cell event");
    });
  });

  describe("type guards", () => {
    test("isCellEventType narrows type correctly", () => {
      const event: CellCreatedEvent = createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test",
        issue_type: "task",
        priority: 2,
      });

      if (isCellEventType(event, "cell_created")) {
        // TypeScript knows this is CellCreatedEvent
        expect(event.title).toBe("Test");
      }
    });

    test("isStateTransitionEvent identifies status changes", () => {
      const closedEvent = createCellEvent("cell_closed", {
        project_key: projectKey,
        cell_id: "bd-123",
        reason: "Done",
      });

      expect(isStateTransitionEvent(closedEvent)).toBe(true);

      const createdEvent = createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test",
        issue_type: "task",
        priority: 2,
      });

      expect(isStateTransitionEvent(createdEvent)).toBe(false);
    });

    test("isEpicEvent identifies epic operations", () => {
      const epicEvent = createCellEvent("cell_epic_child_added", {
        project_key: projectKey,
        cell_id: "bd-epic",
        child_id: "bd-epic.1",
      });

      expect(isEpicEvent(epicEvent)).toBe(true);

      const regularEvent = createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test",
        issue_type: "task",
        priority: 2,
      });

      expect(isEpicEvent(regularEvent)).toBe(false);
    });

    test("isAgentEvent detects agent-triggered events", () => {
      const agentEvent = createCellEvent("cell_assigned", {
        project_key: projectKey,
        cell_id: "bd-123",
        agent_name: "BlueLake",
      });

      expect(isAgentEvent(agentEvent)).toBe(true);

      const closedByAgentEvent = createCellEvent("cell_closed", {
        project_key: projectKey,
        cell_id: "bd-123",
        reason: "Done",
        closed_by: "agent",
      });

      expect(isAgentEvent(closedByAgentEvent)).toBe(true);
    });
  });

  describe("getCellIdFromEvent", () => {
    test("extracts cell_id from any event", () => {
      const events = [
        createCellEvent("cell_created", {
          project_key: projectKey,
          cell_id: "bd-123",
          title: "Test",
          issue_type: "task",
          priority: 2,
        }),
        createCellEvent("cell_closed", {
          project_key: projectKey,
          cell_id: "bd-456",
          reason: "Done",
        }),
        createCellEvent("cell_epic_child_added", {
          project_key: projectKey,
          cell_id: "bd-epic",
          child_id: "bd-epic.1",
        }),
      ];

      expect(getCellIdFromEvent(events[0])).toBe("bd-123");
      expect(getCellIdFromEvent(events[1])).toBe("bd-456");
      expect(getCellIdFromEvent(events[2])).toBe("bd-epic");
    });
  });

  describe("discriminated union validation", () => {
    test("validates against full CellEventSchema", () => {
      const rawEvent = {
        type: "cell_created",
        project_key: projectKey,
        timestamp: Date.now(),
        cell_id: "bd-123",
        title: "Test cell",
        issue_type: "feature",
        priority: 1,
      };

      const result = CellEventSchema.safeParse(rawEvent);
      expect(result.success).toBe(true);
    });

    test("rejects invalid event type", () => {
      const rawEvent = {
        type: "invalid_event",
        project_key: projectKey,
        timestamp: Date.now(),
        cell_id: "bd-123",
      };

      const result = CellEventSchema.safeParse(rawEvent);
      expect(result.success).toBe(false);
    });

    test("validates dependency types", () => {
      const validTypes = [
        "blocks",
        "blocked-by",
        "related",
        "discovered-from",
      ] as const;

      for (const depType of validTypes) {
        const event = createCellEvent("cell_dependency_added", {
          project_key: projectKey,
          cell_id: "bd-123",
          dependency: {
            id: "bd-456",
            type: depType,
          },
        });

        expect(event.dependency.type).toBe(depType);
      }
    });
  });

  describe("event metadata", () => {
    test("supports metadata field", () => {
      const event = createCellEvent("cell_created", {
        project_key: projectKey,
        cell_id: "bd-123",
        title: "Test",
        issue_type: "task",
        priority: 2,
        metadata: {
          epic_context: "bd-epic-1",
          swarm_strategy: "file-based",
          estimated_duration: 30,
        },
      });

      expect(event.metadata).toBeDefined();
      expect(event.metadata?.epic_context).toBe("bd-epic-1");
    });
  });

  describe("epic closure eligible event", () => {
    test("creates valid closure eligible event", () => {
      const event = createCellEvent("cell_epic_closure_eligible", {
        project_key: projectKey,
        cell_id: "bd-epic",
        child_ids: ["bd-epic.1", "bd-epic.2", "bd-epic.3"],
        total_duration_ms: 120000,
        all_files_touched: ["src/a.ts", "src/b.ts"],
      });

      expect(event.type).toBe("cell_epic_closure_eligible");
      expect(event.child_ids).toHaveLength(3);
      expect(event.total_duration_ms).toBe(120000);
    });
  });

  describe("status changed event", () => {
    test("tracks status transitions", () => {
      const event = createCellEvent("cell_status_changed", {
        project_key: projectKey,
        cell_id: "bd-123",
        from_status: "open",
        to_status: "in_progress",
        changed_by: "agent",
      });

      expect(event.from_status).toBe("open");
      expect(event.to_status).toBe("in_progress");
    });

    test("includes optional reason for blocked/closed", () => {
      const event = createCellEvent("cell_status_changed", {
        project_key: projectKey,
        cell_id: "bd-123",
        from_status: "in_progress",
        to_status: "blocked",
        reason: "Waiting for API credentials",
      });

      expect(event.reason).toBe("Waiting for API credentials");
    });
  });

  describe("comment events", () => {
    test("creates comment with optional parent", () => {
      const event = createCellEvent("cell_comment_added", {
        project_key: projectKey,
        cell_id: "bd-123",
        author: "BlueLake",
        body: "Progress update: auth service implemented",
        parent_comment_id: 42,
      });

      expect(event.author).toBe("BlueLake");
      expect(event.parent_comment_id).toBe(42);
    });
  });

  describe("work tracking events", () => {
    test("tracks work start with file reservations", () => {
      const event = createCellEvent("cell_work_started", {
        project_key: projectKey,
        cell_id: "bd-123",
        agent_name: "BlueLake",
        reserved_files: ["src/auth/**"],
      });

      expect(event.agent_name).toBe("BlueLake");
      expect(event.reserved_files).toEqual(["src/auth/**"]);
    });
  });
});
