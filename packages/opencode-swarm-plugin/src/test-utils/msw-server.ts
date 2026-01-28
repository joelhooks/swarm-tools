/**
 * Shared MSW (Mock Service Worker) server for tests.
 *
 * Replaces manual globalThis.fetch mocking with network-level interception.
 * MSW v2 syntax — uses http.post(), not rest.post().
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// ============================================================================
// Deterministic fake embedding for fast, reliable tests
// ============================================================================

/**
 * Generate a deterministic 1024-dim embedding from text using bag-of-words hashing.
 * Tokens that overlap between texts produce overlapping dimensions → positive cosine similarity.
 * This replaces real Ollama calls (network + GPU) with pure computation (~0ms).
 */
export function fakeDeterministicEmbedding(text: string): number[] {
	const dim = 1024;
	const embedding = new Float64Array(dim);

	const tokens = text.toLowerCase().split(/[\s\W]+/).filter(Boolean);
	for (const token of tokens) {
		let hash = 0;
		for (let i = 0; i < token.length; i++) {
			hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
		}
		for (let j = 0; j < 4; j++) {
			const idx = Math.abs((hash + j * 257) % dim);
			embedding[idx] += 1.0;
		}
	}

	// Normalize to unit vector for proper cosine similarity
	let norm = 0;
	for (let i = 0; i < dim; i++) norm += embedding[i] * embedding[i];
	norm = Math.sqrt(norm);
	if (norm > 0) {
		for (let i = 0; i < dim; i++) embedding[i] /= norm;
	}

	return Array.from(embedding);
}

// ============================================================================
// Ollama API handlers
// ============================================================================

export const ollamaHandlers = [
	// POST /api/embeddings → deterministic fake embedding
	http.post("*/api/embeddings", async ({ request }) => {
		const body = (await request.json()) as { prompt?: string };
		const embedding = fakeDeterministicEmbedding(body.prompt || "");
		return HttpResponse.json({ embedding });
	}),

	// POST /api/tags → health check (list models)
	http.post("*/api/tags", () => {
		return HttpResponse.json({ models: [{ name: "mxbai-embed-large" }] });
	}),

	// GET /api/tags → health check (some clients use GET)
	http.get("*/api/tags", () => {
		return HttpResponse.json({ models: [{ name: "mxbai-embed-large" }] });
	}),
];

// ============================================================================
// Agent Mail MCP handler factory
// ============================================================================

/**
 * Creates MSW handlers for the Agent Mail MCP server at 127.0.0.1:8765.
 *
 * @param requests - Mutable array to track intercepted requests (tool name + args)
 * @param toolResponses - Map of tool name → response body to return
 * @returns Array of MSW handlers (MCP endpoint + health check)
 */
export function createAgentMailHandlers(
	requests: Array<{ tool: string; args: Record<string, unknown> }>,
	toolResponses: Record<string, unknown> = {},
) {
	return [
		// MCP endpoint - JSON-RPC style requests
		http.post("http://127.0.0.1:8765/mcp/", async ({ request }) => {
			const body = (await request.json()) as {
				params?: { name?: string; arguments?: Record<string, unknown> };
			};
			const toolName = body?.params?.name ?? "";
			const args = (body?.params?.arguments ?? {}) as Record<string, unknown>;

			requests.push({ tool: toolName, args });

			if (toolName && toolName in toolResponses) {
				return HttpResponse.json({ result: toolResponses[toolName] });
			}

			if (toolName === "ensure_project") {
				return HttpResponse.json({
					result: { id: "project-1", human_key: args.human_key },
				});
			}

			if (toolName === "register_agent") {
				return HttpResponse.json({
					result: { name: args.name ?? "agent-1" },
				});
			}

			return HttpResponse.json({ result: {} });
		}),

		// Health check endpoint
		http.get("http://127.0.0.1:8765/health/liveness", () => {
			return HttpResponse.json({ status: "ok" });
		}),
	];
}

// ============================================================================
// Server setup
// ============================================================================

/** Shared MSW server with Ollama handlers pre-configured. */
export const server = setupServer(...ollamaHandlers);
