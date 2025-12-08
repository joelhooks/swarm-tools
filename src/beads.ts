/**
 * Beads Module - Type-safe wrappers around the `bd` CLI
 *
 * This module provides validated, type-safe operations for the beads
 * issue tracker. All responses are parsed and validated with Zod schemas.
 *
 * Key principles:
 * - Always use `--json` flag for bd commands
 * - Validate all output with Zod schemas
 * - Throw typed errors on failure
 * - Support atomic epic creation with rollback hints
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  BeadSchema,
  BeadCreateArgsSchema,
  BeadUpdateArgsSchema,
  BeadCloseArgsSchema,
  BeadQueryArgsSchema,
  EpicCreateArgsSchema,
  EpicCreateResultSchema,
  type Bead,
  type BeadCreateArgs,
  type EpicCreateResult,
} from "./schemas";

/**
 * Custom error for bead operations
 */
export class BeadError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "BeadError";
  }
}

/**
 * Custom error for validation failures
 */
export class BeadValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: z.ZodError,
  ) {
    super(message);
    this.name = "BeadValidationError";
  }
}

/**
 * Build a bd create command from args
 */
function buildCreateCommand(args: BeadCreateArgs): string[] {
  const parts = ["bd", "create", args.title];

  if (args.type && args.type !== "task") {
    parts.push("-t", args.type);
  }

  if (args.priority !== undefined && args.priority !== 2) {
    parts.push("-p", args.priority.toString());
  }

  if (args.description) {
    parts.push("-d", args.description);
  }

  if (args.parent_id) {
    parts.push("--parent", args.parent_id);
  }

  parts.push("--json");
  return parts;
}

/**
 * Parse and validate bead JSON output
 * Handles both object and array responses (CLI may return either)
 */
function parseBead(output: string): Bead {
  try {
    const parsed = JSON.parse(output);
    // CLI commands like `bd close`, `bd update` return arrays even for single items
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!data) {
      throw new BeadError("No bead data in response", "parse");
    }
    return BeadSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BeadValidationError(
        `Invalid bead data: ${error.message}`,
        error,
      );
    }
    if (error instanceof BeadError) {
      throw error;
    }
    throw new BeadError(`Failed to parse bead JSON: ${output}`, "parse");
  }
}

/**
 * Parse and validate array of beads
 */
function parseBeads(output: string): Bead[] {
  try {
    const parsed = JSON.parse(output);
    return z.array(BeadSchema).parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BeadValidationError(
        `Invalid beads data: ${error.message}`,
        error,
      );
    }
    throw new BeadError(`Failed to parse beads JSON: ${output}`, "parse");
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create a new bead with type-safe validation
 */
export const beads_create = tool({
  description: "Create a new bead with type-safe validation",
  args: {
    title: tool.schema.string().describe("Bead title"),
    type: tool.schema
      .enum(["bug", "feature", "task", "epic", "chore"])
      .optional()
      .describe("Issue type (default: task)"),
    priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("Priority 0-3 (default: 2)"),
    description: tool.schema.string().optional().describe("Bead description"),
    parent_id: tool.schema
      .string()
      .optional()
      .describe("Parent bead ID for epic children"),
  },
  async execute(args, ctx) {
    const validated = BeadCreateArgsSchema.parse(args);
    const cmdParts = buildCreateCommand(validated);

    // Execute command
    const result = await Bun.$`${cmdParts}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to create bead: ${result.stderr.toString()}`,
        cmdParts.join(" "),
        result.exitCode,
        result.stderr.toString(),
      );
    }

    const bead = parseBead(result.stdout.toString());
    return JSON.stringify(bead, null, 2);
  },
});

/**
 * Create an epic with subtasks in one atomic operation
 */
export const beads_create_epic = tool({
  description: "Create epic with subtasks in one atomic operation",
  args: {
    epic_title: tool.schema.string().describe("Epic title"),
    epic_description: tool.schema
      .string()
      .optional()
      .describe("Epic description"),
    subtasks: tool.schema
      .array(
        tool.schema.object({
          title: tool.schema.string(),
          priority: tool.schema.number().min(0).max(3).optional(),
          files: tool.schema.array(tool.schema.string()).optional(),
        }),
      )
      .describe("Subtasks to create under the epic"),
  },
  async execute(args, ctx) {
    const validated = EpicCreateArgsSchema.parse(args);
    const created: Bead[] = [];

    try {
      // 1. Create epic
      const epicCmd = buildCreateCommand({
        title: validated.epic_title,
        type: "epic",
        priority: 1,
        description: validated.epic_description,
      });

      const epicResult = await Bun.$`${epicCmd}`.quiet().nothrow();

      if (epicResult.exitCode !== 0) {
        throw new BeadError(
          `Failed to create epic: ${epicResult.stderr.toString()}`,
          epicCmd.join(" "),
          epicResult.exitCode,
        );
      }

      const epic = parseBead(epicResult.stdout.toString());
      created.push(epic);

      // 2. Create subtasks
      for (const subtask of validated.subtasks) {
        const subtaskCmd = buildCreateCommand({
          title: subtask.title,
          type: "task",
          priority: subtask.priority ?? 2,
          parent_id: epic.id,
        });

        const subtaskResult = await Bun.$`${subtaskCmd}`.quiet().nothrow();

        if (subtaskResult.exitCode !== 0) {
          throw new BeadError(
            `Failed to create subtask: ${subtaskResult.stderr.toString()}`,
            subtaskCmd.join(" "),
            subtaskResult.exitCode,
          );
        }

        const subtaskBead = parseBead(subtaskResult.stdout.toString());
        created.push(subtaskBead);
      }

      const result: EpicCreateResult = {
        success: true,
        epic,
        subtasks: created.slice(1),
      };

      return JSON.stringify(result, null, 2);
    } catch (error) {
      // Partial failure - return what was created with rollback hint
      const rollbackHint = created
        .map((b) => `bd close ${b.id} --reason "Rollback partial epic"`)
        .join("\n");

      const result: EpicCreateResult = {
        success: false,
        epic: created[0] || ({} as Bead),
        subtasks: created.slice(1),
        rollback_hint: rollbackHint,
      };

      return JSON.stringify(
        {
          ...result,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      );
    }
  },
});

/**
 * Query beads with filters
 */
export const beads_query = tool({
  description: "Query beads with filters (replaces bd list, bd ready, bd wip)",
  args: {
    status: tool.schema
      .enum(["open", "in_progress", "blocked", "closed"])
      .optional()
      .describe("Filter by status"),
    type: tool.schema
      .enum(["bug", "feature", "task", "epic", "chore"])
      .optional()
      .describe("Filter by type"),
    ready: tool.schema
      .boolean()
      .optional()
      .describe("Only show unblocked beads (uses bd ready)"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max results to return (default: 20)"),
  },
  async execute(args, ctx) {
    const validated = BeadQueryArgsSchema.parse(args);

    let cmd: string[];

    if (validated.ready) {
      cmd = ["bd", "ready", "--json"];
    } else {
      cmd = ["bd", "list", "--json"];
      if (validated.status) {
        cmd.push("--status", validated.status);
      }
      if (validated.type) {
        cmd.push("--type", validated.type);
      }
    }

    const result = await Bun.$`${cmd}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to query beads: ${result.stderr.toString()}`,
        cmd.join(" "),
        result.exitCode,
      );
    }

    const beads = parseBeads(result.stdout.toString());
    const limited = beads.slice(0, validated.limit);

    return JSON.stringify(limited, null, 2);
  },
});

/**
 * Update a bead's status or description
 */
export const beads_update = tool({
  description: "Update bead status/description",
  args: {
    id: tool.schema.string().describe("Bead ID"),
    status: tool.schema
      .enum(["open", "in_progress", "blocked", "closed"])
      .optional()
      .describe("New status"),
    description: tool.schema.string().optional().describe("New description"),
    priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("New priority"),
  },
  async execute(args, ctx) {
    const validated = BeadUpdateArgsSchema.parse(args);

    const cmd = ["bd", "update", validated.id];

    if (validated.status) {
      cmd.push("--status", validated.status);
    }
    if (validated.description) {
      cmd.push("-d", validated.description);
    }
    if (validated.priority !== undefined) {
      cmd.push("-p", validated.priority.toString());
    }
    cmd.push("--json");

    const result = await Bun.$`${cmd}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to update bead: ${result.stderr.toString()}`,
        cmd.join(" "),
        result.exitCode,
      );
    }

    const bead = parseBead(result.stdout.toString());
    return JSON.stringify(bead, null, 2);
  },
});

/**
 * Close a bead with reason
 */
export const beads_close = tool({
  description: "Close a bead with reason",
  args: {
    id: tool.schema.string().describe("Bead ID"),
    reason: tool.schema.string().describe("Completion reason"),
  },
  async execute(args, ctx) {
    const validated = BeadCloseArgsSchema.parse(args);

    const cmd = [
      "bd",
      "close",
      validated.id,
      "--reason",
      validated.reason,
      "--json",
    ];

    const result = await Bun.$`${cmd}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to close bead: ${result.stderr.toString()}`,
        cmd.join(" "),
        result.exitCode,
      );
    }

    const bead = parseBead(result.stdout.toString());
    return `Closed ${bead.id}: ${validated.reason}`;
  },
});

/**
 * Mark a bead as in-progress
 */
export const beads_start = tool({
  description:
    "Mark a bead as in-progress (shortcut for update --status in_progress)",
  args: {
    id: tool.schema.string().describe("Bead ID"),
  },
  async execute(args, ctx) {
    const cmd = ["bd", "update", args.id, "--status", "in_progress", "--json"];

    const result = await Bun.$`${cmd}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to start bead: ${result.stderr.toString()}`,
        cmd.join(" "),
        result.exitCode,
      );
    }

    const bead = parseBead(result.stdout.toString());
    return `Started: ${bead.id}`;
  },
});

/**
 * Get the next ready bead
 */
export const beads_ready = tool({
  description: "Get the next ready bead (unblocked, highest priority)",
  args: {},
  async execute(args, ctx) {
    const cmd = ["bd", "ready", "--json"];

    const result = await Bun.$`${cmd}`.quiet().nothrow();

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to get ready beads: ${result.stderr.toString()}`,
        cmd.join(" "),
        result.exitCode,
      );
    }

    const beads = parseBeads(result.stdout.toString());

    if (beads.length === 0) {
      return "No ready beads";
    }

    const next = beads[0];
    return JSON.stringify(next, null, 2);
  },
});

/**
 * Sync beads to git and push
 */
export const beads_sync = tool({
  description: "Sync beads to git and push (MANDATORY at session end)",
  args: {
    auto_pull: tool.schema
      .boolean()
      .optional()
      .describe("Pull before sync (default: true)"),
  },
  async execute(args, ctx) {
    const autoPull = args.auto_pull ?? true;

    // 1. Pull if requested
    if (autoPull) {
      const pullResult = await Bun.$`git pull --rebase`.quiet().nothrow();
      if (pullResult.exitCode !== 0) {
        throw new BeadError(
          `Failed to pull: ${pullResult.stderr.toString()}`,
          "git pull --rebase",
          pullResult.exitCode,
        );
      }
    }

    // 2. Sync beads
    const syncResult = await Bun.$`bd sync`.quiet().nothrow();
    if (syncResult.exitCode !== 0) {
      throw new BeadError(
        `Failed to sync beads: ${syncResult.stderr.toString()}`,
        "bd sync",
        syncResult.exitCode,
      );
    }

    // 3. Push
    const pushResult = await Bun.$`git push`.quiet().nothrow();
    if (pushResult.exitCode !== 0) {
      throw new BeadError(
        `Failed to push: ${pushResult.stderr.toString()}`,
        "git push",
        pushResult.exitCode,
      );
    }

    // 4. Verify clean state
    const statusResult = await Bun.$`git status --porcelain`.quiet().nothrow();
    const status = statusResult.stdout.toString().trim();

    if (status !== "") {
      return `Beads synced and pushed, but working directory not clean:\n${status}`;
    }

    return "Beads synced and pushed successfully";
  },
});

/**
 * Link a bead to an Agent Mail thread
 */
export const beads_link_thread = tool({
  description: "Add metadata linking bead to Agent Mail thread",
  args: {
    bead_id: tool.schema.string().describe("Bead ID"),
    thread_id: tool.schema.string().describe("Agent Mail thread ID"),
  },
  async execute(args, ctx) {
    // Update bead description to include thread link
    // This is a workaround since bd doesn't have native metadata support
    const queryResult = await Bun.$`bd show ${args.bead_id} --json`
      .quiet()
      .nothrow();

    if (queryResult.exitCode !== 0) {
      throw new BeadError(
        `Failed to get bead: ${queryResult.stderr.toString()}`,
        `bd show ${args.bead_id} --json`,
        queryResult.exitCode,
      );
    }

    const bead = parseBead(queryResult.stdout.toString());
    const existingDesc = bead.description || "";

    // Add thread link if not already present
    const threadMarker = `[thread:${args.thread_id}]`;
    if (existingDesc.includes(threadMarker)) {
      return `Bead ${args.bead_id} already linked to thread ${args.thread_id}`;
    }

    const newDesc = existingDesc
      ? `${existingDesc}\n\n${threadMarker}`
      : threadMarker;

    const updateResult =
      await Bun.$`bd update ${args.bead_id} -d ${newDesc} --json`
        .quiet()
        .nothrow();

    if (updateResult.exitCode !== 0) {
      throw new BeadError(
        `Failed to update bead: ${updateResult.stderr.toString()}`,
        `bd update ${args.bead_id} -d ...`,
        updateResult.exitCode,
      );
    }

    return `Linked bead ${args.bead_id} to thread ${args.thread_id}`;
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const beadsTools = {
  beads_create: beads_create,
  beads_create_epic: beads_create_epic,
  beads_query: beads_query,
  beads_update: beads_update,
  beads_close: beads_close,
  beads_start: beads_start,
  beads_ready: beads_ready,
  beads_sync: beads_sync,
  beads_link_thread: beads_link_thread,
};
