/**
 * Validation Tests - Port of steveyegge/beads internal/validation/bead.go
 *
 * Business rules from types.go Validate() method:
 * - Title required, max 500 chars
 * - Priority 0-4 (0=critical, 4=low)
 * - Valid status: open, in_progress, blocked, closed, tombstone
 * - Valid type: bug, feature, task, epic, chore, message
 * - closed_at only when status=closed
 * - deleted_at required when status=tombstone
 * - Status transitions enforce state machine
 */

import { describe, it, expect } from "bun:test";
import {
  validateCreateBead,
  validateUpdateBead,
  validateStatusTransition,
  type ValidationResult,
} from "./validation.js";
import type { CellStatus } from "../types/hive-adapter.js";

describe("validateCreateBead", () => {
  it("accepts valid bead creation", () => {
    const result = validateCreateBead({
      title: "Fix the thing",
      type: "bug",
      priority: 2,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects empty title", () => {
    const result = validateCreateBead({
      title: "",
      type: "task",
      priority: 2,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("title is required");
  });

  it("rejects title over 500 characters", () => {
    const result = validateCreateBead({
      title: "x".repeat(501),
      type: "task",
      priority: 2,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/title must be 500 characters or less/);
  });

  it("accepts priority 0-4", () => {
    for (let priority = 0; priority <= 4; priority++) {
      const result = validateCreateBead({
        title: "Task",
        type: "task",
        priority,
      });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects priority < 0", () => {
    const result = validateCreateBead({
      title: "Task",
      type: "task",
      priority: -1,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("priority must be between 0 and 4");
  });

  it("rejects priority > 4", () => {
    const result = validateCreateBead({
      title: "Task",
      type: "task",
      priority: 5,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("priority must be between 0 and 4");
  });

  it("defaults priority to 2 if not provided", () => {
    const result = validateCreateBead({
      title: "Task",
      type: "task",
    });

    expect(result.valid).toBe(true);
  });

  it("accepts all valid types", () => {
    const validTypes = ["bug", "feature", "task", "epic", "chore", "message"];

    for (const type of validTypes) {
      const result = validateCreateBead({
        title: "Task",
        type: type as any,
        priority: 2,
      });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects invalid type", () => {
    const result = validateCreateBead({
      title: "Task",
      type: "invalid" as any,
      priority: 2,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/invalid issue type/);
  });

  it("accepts optional description", () => {
    const result = validateCreateBead({
      title: "Task",
      type: "task",
      priority: 2,
      description: "Details here",
    });

    expect(result.valid).toBe(true);
  });

  it("accepts optional parent_id", () => {
    const result = validateCreateBead({
      title: "Subtask",
      type: "task",
      priority: 2,
      parent_id: "bd-abc-123",
    });

    expect(result.valid).toBe(true);
  });

  it("accepts optional assignee", () => {
    const result = validateCreateBead({
      title: "Task",
      type: "task",
      priority: 2,
      assignee: "user@example.com",
    });

    expect(result.valid).toBe(true);
  });
});

describe("validateUpdateBead", () => {
  it("accepts valid title update", () => {
    const result = validateUpdateBead({
      title: "New title",
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects empty title", () => {
    const result = validateUpdateBead({
      title: "",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("title is required");
  });

  it("rejects title over 500 characters", () => {
    const result = validateUpdateBead({
      title: "x".repeat(501),
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/title must be 500 characters or less/);
  });

  it("accepts priority update 0-4", () => {
    for (let priority = 0; priority <= 4; priority++) {
      const result = validateUpdateBead({ priority });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects invalid priority", () => {
    const result = validateUpdateBead({ priority: 5 });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("priority must be between 0 and 4");
  });

  it("accepts description update", () => {
    const result = validateUpdateBead({
      description: "Updated details",
    });

    expect(result.valid).toBe(true);
  });

  it("accepts assignee update", () => {
    const result = validateUpdateBead({
      assignee: "newuser@example.com",
    });

    expect(result.valid).toBe(true);
  });

  it("accepts multiple field updates", () => {
    const result = validateUpdateBead({
      title: "New title",
      priority: 1,
      description: "New description",
      assignee: "user@example.com",
    });

    expect(result.valid).toBe(true);
  });

  it("accepts empty updates (no-op)", () => {
    const result = validateUpdateBead({});

    expect(result.valid).toBe(true);
  });
});

describe("validateStatusTransition", () => {
  describe("from open", () => {
    it("allows open -> in_progress", () => {
      const result = validateStatusTransition("open", "in_progress");
      expect(result.valid).toBe(true);
    });

    it("allows open -> blocked", () => {
      const result = validateStatusTransition("open", "blocked");
      expect(result.valid).toBe(true);
    });

    it("allows open -> closed", () => {
      const result = validateStatusTransition("open", "closed");
      expect(result.valid).toBe(true);
    });

    it("rejects open -> tombstone (use delete operation)", () => {
      const result = validateStatusTransition("open", "tombstone");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/cannot transition directly to tombstone/);
    });

    it("allows open -> open (no-op)", () => {
      const result = validateStatusTransition("open", "open");
      expect(result.valid).toBe(true);
    });
  });

  describe("from in_progress", () => {
    it("allows in_progress -> open", () => {
      const result = validateStatusTransition("in_progress", "open");
      expect(result.valid).toBe(true);
    });

    it("allows in_progress -> blocked", () => {
      const result = validateStatusTransition("in_progress", "blocked");
      expect(result.valid).toBe(true);
    });

    it("allows in_progress -> closed", () => {
      const result = validateStatusTransition("in_progress", "closed");
      expect(result.valid).toBe(true);
    });

    it("rejects in_progress -> tombstone", () => {
      const result = validateStatusTransition("in_progress", "tombstone");
      expect(result.valid).toBe(false);
    });
  });

  describe("from blocked", () => {
    it("allows blocked -> open", () => {
      const result = validateStatusTransition("blocked", "open");
      expect(result.valid).toBe(true);
    });

    it("allows blocked -> in_progress", () => {
      const result = validateStatusTransition("blocked", "in_progress");
      expect(result.valid).toBe(true);
    });

    it("allows blocked -> closed", () => {
      const result = validateStatusTransition("blocked", "closed");
      expect(result.valid).toBe(true);
    });

    it("rejects blocked -> tombstone", () => {
      const result = validateStatusTransition("blocked", "tombstone");
      expect(result.valid).toBe(false);
    });
  });

  describe("from closed", () => {
    it("allows closed -> open (reopen)", () => {
      const result = validateStatusTransition("closed", "open");
      expect(result.valid).toBe(true);
    });

    it("rejects closed -> in_progress (must reopen first)", () => {
      const result = validateStatusTransition("closed", "in_progress");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/must reopen before changing to in_progress/);
    });

    it("rejects closed -> blocked", () => {
      const result = validateStatusTransition("closed", "blocked");
      expect(result.valid).toBe(false);
    });

    it("allows closed -> tombstone (delete after close)", () => {
      const result = validateStatusTransition("closed", "tombstone");
      expect(result.valid).toBe(true);
    });

    it("allows closed -> closed (no-op)", () => {
      const result = validateStatusTransition("closed", "closed");
      expect(result.valid).toBe(true);
    });
  });

  describe("from tombstone", () => {
    it("rejects all transitions from tombstone (permanent)", () => {
      const targets: CellStatus[] = ["open", "in_progress", "blocked", "closed"];

      for (const target of targets) {
        const result = validateStatusTransition("tombstone", target);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toMatch(/cannot transition from tombstone/);
      }
    });

    it("allows tombstone -> tombstone (no-op)", () => {
      const result = validateStatusTransition("tombstone", "tombstone");
      expect(result.valid).toBe(true);
    });
  });
});
