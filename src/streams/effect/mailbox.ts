/**
 * DurableMailbox - Actor-style messaging with envelope pattern
 *
 * Combines DurableCursor (positioned consumption) with Envelope pattern for
 * request/response messaging between agents.
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const mailbox = yield* DurableMailbox;
 *   const myMailbox = yield* mailbox.create({ agent: "worker-1" });
 *
 *   // Send message with optional reply channel
 *   yield* myMailbox.send("worker-2", {
 *     payload: { task: "process-data" },
 *     replyTo: "deferred:xyz"
 *   });
 *
 *   // Receive messages
 *   for await (const envelope of myMailbox.receive()) {
 *     yield* handleMessage(envelope.payload);
 *     if (envelope.replyTo) {
 *       yield* DurableDeferred.resolve(envelope.replyTo, result);
 *     }
 *     yield* envelope.commit();
 *   }
 * });
 * ```
 */
import { Context, Effect, Layer } from "effect";
import { DurableCursor, type Cursor } from "./cursor";
import { appendEvent } from "../store";
import type { MessageSentEvent } from "../events";

// ============================================================================
// Types
// ============================================================================

/**
 * Envelope wrapping a message with metadata
 */
export interface Envelope<T = unknown> {
  /** Message payload */
  readonly payload: T;
  /** Optional URL of DurableDeferred for response */
  readonly replyTo?: string;
  /** Agent who sent the message */
  readonly sender: string;
  /** Original message ID */
  readonly messageId: number;
  /** Thread ID for conversation tracking */
  readonly threadId?: string;
  /** Commit this message position */
  readonly commit: () => Effect.Effect<void>;
}

/**
 * Configuration for creating a mailbox
 */
export interface MailboxConfig {
  /** Agent name (mailbox owner) */
  readonly agent: string;
  /** Project key for scoping messages */
  readonly projectKey: string;
  /** Optional project path for database location */
  readonly projectPath?: string;
  /** Batch size for reading messages (default: 100) */
  readonly batchSize?: number;
}

/**
 * Mailbox instance for an agent
 */
export interface Mailbox {
  /** Agent name */
  readonly agent: string;
  /** Send a message to another agent */
  readonly send: <T>(
    to: string | string[],
    envelope: {
      payload: T;
      replyTo?: string;
      threadId?: string;
      importance?: "low" | "normal" | "high" | "urgent";
    },
  ) => Effect.Effect<void>;
  /** Receive messages as async iterable */
  readonly receive: <T = unknown>() => AsyncIterable<Envelope<T>>;
  /** Peek at next message without consuming */
  readonly peek: <T = unknown>() => Effect.Effect<Envelope<T> | null>;
}

/**
 * DurableMailbox service interface
 */
export interface DurableMailboxService {
  /** Create a new mailbox instance */
  readonly create: (
    config: MailboxConfig,
  ) => Effect.Effect<Mailbox, never, DurableCursor>;
}

// ============================================================================
// Service Definition
// ============================================================================

/**
 * DurableMailbox Context.Tag
 */
export class DurableMailbox extends Context.Tag("DurableMailbox")<
  DurableMailbox,
  DurableMailboxService
>() {}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Extract envelope from MessageSentEvent
 */
function eventToEnvelope<T>(
  event: MessageSentEvent & { id: number; sequence: number },
  agentName: string,
  commitFn: () => Effect.Effect<void>,
): Envelope<T> | null {
  // Filter: only messages addressed to this agent
  if (!event.to_agents.includes(agentName)) {
    return null;
  }

  // Parse body as envelope (assume JSON-encoded)
  let payload: T;
  let replyTo: string | undefined;
  let sender = event.from_agent;

  try {
    // Body can be either:
    // 1. Plain JSON payload (legacy)
    // 2. Envelope JSON with { payload, replyTo?, sender? }
    const parsed = JSON.parse(event.body);
    if (parsed.payload !== undefined) {
      // It's an envelope
      payload = parsed.payload as T;
      replyTo = parsed.replyTo;
      sender = parsed.sender || event.from_agent;
    } else {
      // It's a plain payload
      payload = parsed as T;
    }
  } catch {
    // Body is not JSON, treat as string payload
    payload = event.body as unknown as T;
  }

  return {
    payload,
    replyTo,
    sender,
    messageId: event.message_id || event.id,
    threadId: event.thread_id,
    commit: commitFn,
  };
}

/**
 * Create send function
 */
function createSendFn(config: MailboxConfig): <T>(
  to: string | string[],
  envelope: {
    payload: T;
    replyTo?: string;
    threadId?: string;
    importance?: "low" | "normal" | "high" | "urgent";
  },
) => Effect.Effect<void> {
  return <T>(
    to: string | string[],
    envelope: {
      payload: T;
      replyTo?: string;
      threadId?: string;
      importance?: "low" | "normal" | "high" | "urgent";
    },
  ): Effect.Effect<void> => {
    return Effect.gen(function* () {
      const toAgents = Array.isArray(to) ? to : [to];

      // Create envelope body
      const envelopeBody = {
        payload: envelope.payload,
        replyTo: envelope.replyTo,
        sender: config.agent,
      };

      // Create MessageSentEvent
      const event: Omit<
        MessageSentEvent,
        "id" | "sequence" | "timestamp" | "type"
      > = {
        project_key: config.projectKey,
        from_agent: config.agent,
        to_agents: toAgents,
        subject: envelope.threadId || `msg-${Date.now()}`,
        body: JSON.stringify(envelopeBody),
        thread_id: envelope.threadId,
        importance: envelope.importance || "normal",
        ack_required: false,
      };

      // Append to event store
      yield* Effect.promise(() =>
        appendEvent(
          {
            type: "message_sent",
            timestamp: Date.now(),
            ...event,
          },
          config.projectPath,
        ),
      );
    });
  };
}

/**
 * Create receive function
 */
function createReceiveFn(
  cursor: Cursor,
  agentName: string,
): <T = unknown>() => AsyncIterable<Envelope<T>> {
  return <T = unknown>(): AsyncIterable<Envelope<T>> => {
    const messageStream = cursor.consume<
      MessageSentEvent & { id: number; sequence: number }
    >();

    return {
      async *[Symbol.asyncIterator]() {
        for await (const msg of messageStream) {
          const envelope = eventToEnvelope<T>(msg.value, agentName, msg.commit);
          if (envelope) {
            yield envelope;
          } else {
            // Not for this agent, skip and commit
            await Effect.runPromise(msg.commit());
          }
        }
      },
    };
  };
}

/**
 * Create peek function
 */
function createPeekFn(
  cursor: Cursor,
  agentName: string,
): <T = unknown>() => Effect.Effect<Envelope<T> | null> {
  return <T = unknown>(): Effect.Effect<Envelope<T> | null> => {
    return Effect.promise(async () => {
      const messageStream = cursor.consume<
        MessageSentEvent & { id: number; sequence: number }
      >();

      for await (const msg of messageStream) {
        const envelope = eventToEnvelope<T>(msg.value, agentName, msg.commit);
        if (envelope) {
          return envelope;
        }
        // Not for this agent, skip and commit
        await Effect.runPromise(msg.commit());
      }

      return null;
    });
  };
}

/**
 * Create mailbox implementation
 */
function createMailboxImpl(
  config: MailboxConfig,
): Effect.Effect<Mailbox, never, DurableCursor> {
  return Effect.gen(function* () {
    const cursorService = yield* DurableCursor;

    // Create cursor for this agent's messages
    const cursor = yield* cursorService.create({
      stream: `projects/${config.projectKey}/events`,
      checkpoint: `agents/${config.agent}/mailbox`,
      projectPath: config.projectPath,
      batchSize: config.batchSize,
      types: ["message_sent"], // Only read message_sent events
    });

    return {
      agent: config.agent,
      send: createSendFn(config),
      receive: createReceiveFn(cursor, config.agent),
      peek: createPeekFn(cursor, config.agent),
    };
  });
}

// ============================================================================
// Layer
// ============================================================================

/**
 * Live implementation of DurableMailbox service
 */
export const DurableMailboxLive = Layer.succeed(DurableMailbox, {
  create: createMailboxImpl,
});
