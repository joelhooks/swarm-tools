import { describe, test, expect, beforeAll, beforeEach, afterAll, afterEach, mock } from "bun:test";
import { server, createAgentMailHandlers } from "./test-utils/msw-server";

const mockIsToolAvailable = mock(async () => true);
const mockWarnMissingTool = mock(() => {});

mock.module("./tool-availability.js", () => ({
  isToolAvailable: mockIsToolAvailable,
  warnMissingTool: mockWarnMissingTool,
}));

import {
  agentmail_init,
  agentmail_reserve,
  agentmail_release,
  resetAgentMailCache,
  clearState,
} from "./agent-mail";

// Start MSW server for all agent-mail tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe("agentmail_init", () => {
  const mockContext = { sessionID: "agentmail-init-test" } as const;

  beforeEach(() => {
    resetAgentMailCache();
    mockIsToolAvailable.mockClear();
    mockWarnMissingTool.mockClear();
  });

  afterEach(() => {
    clearState(mockContext.sessionID);
  });

  test("registers agent with default OpenCode model", async () => {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    server.use(...createAgentMailHandlers(requests));

    await agentmail_init.execute(
      {
        project_path: "/tmp/opencode-test",
        agent_name: "TestAgent",
        task_description: "Test init",
      },
      mockContext,
    );

    const registration = requests.find((request) => request.tool === "register_agent");
    expect(registration?.args.model).toBe("openai/gpt-5.2-codex");
  });
});

describe("agentmail_reserve", () => {
  const mockContext = { sessionID: "agentmail-reserve-test" } as const;

  beforeEach(() => {
    resetAgentMailCache();
    mockIsToolAvailable.mockClear();
    mockWarnMissingTool.mockClear();
  });

  afterEach(() => {
    clearState(mockContext.sessionID);
  });

  test("requires ttl_seconds", async () => {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    server.use(...createAgentMailHandlers(requests));

    await agentmail_init.execute(
      {
        project_path: "/tmp/opencode-test",
        agent_name: "TestAgent",
        task_description: "Test reserve",
      },
      mockContext,
    );

    await expect(
      agentmail_reserve.execute({ paths: ["src/agent.ts"] }, mockContext),
    ).rejects.toThrow("ttl_seconds");

    const reservation = requests.find(
      (request) => request.tool === "file_reservation_paths",
    );
    expect(reservation).toBeUndefined();
  });

  test("releases stored reservations on completion", async () => {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    server.use(
      ...createAgentMailHandlers(requests, {
        file_reservation_paths: {
          granted: [
            {
              id: 42,
              path_pattern: "src/agent.ts",
              exclusive: true,
              reason: "",
              expires_ts: "2026-01-10T00:00:00Z",
            },
          ],
          conflicts: [],
        },
        release_file_reservations: {
          released: 1,
          released_at: "2026-01-10T00:00:01Z",
        },
      }),
    );

    await agentmail_init.execute(
      {
        project_path: "/tmp/opencode-test",
        agent_name: "TestAgent",
        task_description: "Test release",
      },
      mockContext,
    );

    await agentmail_reserve.execute(
      { paths: ["src/agent.ts"], ttl_seconds: 60 },
      mockContext,
    );

    await agentmail_release.execute({}, mockContext);

    const releaseRequest = requests.find(
      (request) => request.tool === "release_file_reservations",
    );

    expect(releaseRequest?.args.file_reservation_ids).toEqual([42]);
  });
});
