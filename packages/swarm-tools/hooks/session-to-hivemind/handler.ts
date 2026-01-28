/**
 * Session to Hivemind Hook
 *
 * Stores session transcripts and summaries in hivemind for cross-session memory.
 */
import { execFileSync } from "child_process";

interface HookEvent {
  type: string;
  action: string;
  sessionKey?: string;
  context?: Record<string, unknown>;
  timestamp: Date;
  messages?: string[];
}

function executeSwarmTool(name: string, args: Record<string, unknown>): string {
  try {
    const argsJson = JSON.stringify(args);
    return execFileSync("swarm", ["tool", name, "--json", argsJson], {
      encoding: "utf-8",
      timeout: 30000,
    });
  } catch (error) {
    const err = error as { stdout?: string };
    return err.stdout || JSON.stringify({ success: false });
  }
}

export default async function handler(event: HookEvent): Promise<void> {
  const sessionKey = event.sessionKey || "default";

  if (event.type === "command" && event.action === "new") {
    // New session - query hivemind for relevant context
    try {
      const result = executeSwarmTool("hivemind_find", {
        query: `project context recent learnings for ${sessionKey}`,
        limit: 5,
        expand: true,
      });

      const parsed = JSON.parse(result);
      if (parsed.success && parsed.data?.results?.length > 0) {
        const context = parsed.data.results
          .map((r: { content: string }) => `- ${r.content.slice(0, 200)}...`)
          .join("\n");

        // Push message to be shown to user
        event.messages?.push(`\n📚 Loaded ${parsed.data.results.length} prior learnings from hivemind`);

        console.log(`[session-to-hivemind] Loaded ${parsed.data.results.length} memories for session`);
      }
    } catch (err) {
      console.error("[session-to-hivemind] Failed to query hivemind:", err);
    }
  }

  if (event.type === "session" && event.action === "end") {
    // Session ending - store summary
    try {
      const summary = event.context?.summary as string || "Session ended without summary";
      const timestamp = new Date().toISOString();

      executeSwarmTool("hivemind_store", {
        information: `Session ${sessionKey} (${timestamp}): ${summary}`,
        tags: "clawdbot,session,auto-captured",
      });

      console.log(`[session-to-hivemind] Stored session summary for ${sessionKey}`);
    } catch (err) {
      console.error("[session-to-hivemind] Failed to store session:", err);
    }
  }
}
