/**
 * Effect-TS services for durable event stream processing
 *
 * Exports:
 * - DurableCursor: Positioned event consumption with checkpointing
 * - DurableLock: Distributed mutual exclusion via CAS
 * - DurableDeferred: Distributed promises
 * - DurableMailbox: Actor message passing
 * - ask: Request/response pattern (mailbox + deferred)
 * - layers: Composed service layers for common use cases
 */
export * from "./cursor";
export * from "./deferred";
export * from "./lock";
export * from "./mailbox";
export * from "./ask";
export * from "./layers";
