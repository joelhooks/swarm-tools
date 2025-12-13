/**
 * Ask Pattern - Request/Response over Durable Streams
 *
 * Combines DurableMailbox (message passing) + DurableDeferred (distributed promise)
 * for synchronous-style request/response communication between agents.
 *
 * Based on Kyle Matthews' pattern from Agent Mail.
 *
 * @example
 * ```typescript
 * // Agent A asks Agent B for data
 * const result = yield* ask<Request, Response>({
 *   mailbox: myMailbox,
 *   to: "agent-b",
 *   payload: { query: "getUserData", userId: 123 },
 *   ttlSeconds: 30,
 * });
 *
 * // Agent B receives request and responds
 * for await (const envelope of mailbox.receive()) {
 *   const response = processRequest(envelope.payload);
 *   if (envelope.replyTo) {
 *     yield* DurableDeferred.resolve(envelope.replyTo, response);
 *   }
 *   yield* envelope.commit();
 * }
 * ```
 */

import { Effect } from "effect";
import { DurableCursor } from "./cursor";
import { DurableMailbox, type Mailbox } from "./mailbox";
import { DurableDeferred, type DeferredConfig } from "./deferred";
import type { TimeoutError, NotFoundError } from "./deferred";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for ask() request
 */
export interface AskConfig<Req> {
  /** Mailbox to send message from */
  readonly mailbox: Mailbox;
  /** Recipient agent(s) */
  readonly to: string | string[];
  /** Request payload */
  readonly payload: Req;
  /** Time-to-live in seconds before timeout (default: 60) */
  readonly ttlSeconds?: number;
  /** Optional thread ID for conversation tracking */
  readonly threadId?: string;
  /** Optional importance level */
  readonly importance?: "low" | "normal" | "high" | "urgent";
  /** Optional project path for database isolation */
  readonly projectPath?: string;
}

// ============================================================================
// Ask Implementation
// ============================================================================

/**
 * Request/response pattern combining mailbox send + deferred await
 *
 * Creates a deferred promise, sends message with replyTo URL, then blocks
 * until the recipient resolves the deferred (or timeout).
 *
 * @template Req - Request payload type
 * @template Res - Response type
 * @param config - Ask configuration
 * @returns Effect that resolves with response or fails with timeout/not-found
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const mailbox = yield* DurableMailbox;
 *   const myMailbox = yield* mailbox.create({ agent: "worker-1", projectKey: "proj" });
 *
 *   const response = yield* ask<Request, Response>({
 *     mailbox: myMailbox,
 *     to: "worker-2",
 *     payload: { task: "getData" },
 *     ttlSeconds: 30,
 *   });
 *
 *   console.log("Got response:", response);
 * });
 * ```
 */
export function ask<Req, Res>(
  config: AskConfig<Req>,
): Effect.Effect<Res, TimeoutError | NotFoundError, DurableDeferred> {
  return Effect.gen(function* () {
    const deferred = yield* DurableDeferred;

    // Create deferred for response
    const deferredConfig: DeferredConfig = {
      ttlSeconds: config.ttlSeconds ?? 60,
      projectPath: config.projectPath,
    };
    const responseHandle = yield* deferred.create<Res>(deferredConfig);

    // Send message with replyTo URL
    yield* config.mailbox.send(config.to, {
      payload: config.payload,
      replyTo: responseHandle.url,
      threadId: config.threadId,
      importance: config.importance,
    });

    // Block until response or timeout
    const response = yield* responseHandle.value;

    return response;
  });
}

// ============================================================================
// Convenience Variants
// ============================================================================

/**
 * Ask pattern with automatic mailbox creation
 *
 * Simpler variant when you don't need to reuse the mailbox.
 *
 * @example
 * ```typescript
 * const response = yield* askWithMailbox({
 *   agent: "worker-1",
 *   projectKey: "proj",
 *   to: "worker-2",
 *   payload: { task: "getData" },
 * });
 * ```
 */
export function askWithMailbox<Req, Res>(config: {
  readonly agent: string;
  readonly projectKey: string;
  readonly to: string | string[];
  readonly payload: Req;
  readonly ttlSeconds?: number;
  readonly threadId?: string;
  readonly importance?: "low" | "normal" | "high" | "urgent";
  readonly projectPath?: string;
}): Effect.Effect<
  Res,
  TimeoutError | NotFoundError,
  DurableDeferred | DurableMailbox | DurableCursor
> {
  return Effect.gen(function* () {
    const mailboxService = yield* DurableMailbox;

    const mailbox = yield* mailboxService.create({
      agent: config.agent,
      projectKey: config.projectKey,
      projectPath: config.projectPath,
    });

    return yield* ask<Req, Res>({
      mailbox,
      to: config.to,
      payload: config.payload,
      ttlSeconds: config.ttlSeconds,
      threadId: config.threadId,
      importance: config.importance,
      projectPath: config.projectPath,
    });
  });
}

/**
 * Respond to a message envelope by resolving its replyTo deferred
 *
 * Helper for the receiver side of ask() pattern.
 *
 * @example
 * ```typescript
 * for await (const envelope of mailbox.receive()) {
 *   const response = processRequest(envelope.payload);
 *   yield* respond(envelope, response);
 *   yield* envelope.commit();
 * }
 * ```
 */
export function respond<T>(
  envelope: { readonly replyTo?: string },
  value: T,
  projectPath?: string,
): Effect.Effect<void, NotFoundError, DurableDeferred> {
  return Effect.gen(function* () {
    if (!envelope.replyTo) {
      // No replyTo - this wasn't an ask() request, just return
      return;
    }

    const deferred = yield* DurableDeferred;
    yield* deferred.resolve(envelope.replyTo, value, projectPath);
  });
}
