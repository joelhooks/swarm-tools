/**
 * Composed Layers for Durable Streams Services
 *
 * Provides pre-configured Layer compositions for common use cases.
 *
 * @example
 * ```typescript
 * // For ask pattern (request/response):
 * const program = Effect.gen(function* () {
 *   const mailbox = yield* DurableMailbox;
 *   const deferred = yield* DurableDeferred;
 *   // Use services...
 * }).pipe(Effect.provide(DurableAskLive));
 *
 * // For cursor + deferred only:
 * const program = Effect.gen(function* () {
 *   const cursor = yield* DurableCursor;
 *   const deferred = yield* DurableDeferred;
 * }).pipe(Effect.provide(DurableCursorDeferredLive));
 * ```
 */

import { Layer } from "effect";
import { DurableCursor, DurableCursorLive } from "./cursor";
import { DurableDeferred, DurableDeferredLive } from "./deferred";
import { DurableLock, DurableLockLive } from "./lock";
import { DurableMailbox, DurableMailboxLive } from "./mailbox";

// ============================================================================
// Layer Wrappers (convert Context.make to Layer.succeed)
// ============================================================================

/**
 * Cursor service as Layer
 */
const CursorLayer = Layer.succeed(DurableCursor, DurableCursorLive);

/**
 * Mailbox service as Layer (with cursor dependency)
 */
const MailboxLayer = Layer.mergeAll(CursorLayer, DurableMailboxLive);

/**
 * Minimal layer with just Cursor and Deferred
 *
 * Use when you only need event consumption and distributed promises.
 */
export const DurableCursorDeferredLive = Layer.mergeAll(
  CursorLayer,
  DurableDeferredLive,
);

/**
 * Mailbox layer with dependencies
 *
 * Provides DurableMailbox + DurableCursor (required dependency).
 */
export const DurableMailboxWithDepsLive = MailboxLayer;

/**
 * Ask pattern layer (Mailbox + Deferred)
 *
 * Provides all services needed for ask<Req, Res>() pattern:
 * - DurableMailbox (with DurableCursor dependency)
 * - DurableDeferred
 */
export const DurableAskLive = Layer.mergeAll(DurableDeferredLive, MailboxLayer);

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { DurableCursor, DurableDeferred, DurableLock, DurableMailbox };
