/**
 * Drizzle schema for memory subsystem (libSQL).
 *
 * Translates PGlite/pgvector memory schema to libSQL with F32_BLOB vectors.
 *
 * ## Key Differences from PGlite
 * - F32_BLOB(1024) instead of vector(1024)
 * - TEXT columns for JSON (metadata, tags)
 * - TEXT columns for timestamps (ISO 8601 strings)
 * - No separate embeddings table (embedding column inline)
 *
 * @module db/schema/memory
 */

import { customType, real, sqliteTable, text, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { EMBEDDING_DIM } from "../../memory/ollama.js";

/**
 * Custom F32_BLOB vector type for libSQL.
 *
 * Handles conversion between JavaScript arrays and libSQL's native vector format.
 * Uses Buffer for efficient storage of Float32 arrays.
 *
 * @param dimension - Vector dimension (e.g., 1024 for mxbai-embed-large)
 */
const vector = (dimension: number) =>
  customType<{ data: number[]; driverData: Buffer }>({
    dataType() {
      return `F32_BLOB(${dimension})`;
    },
    toDriver(value: number[]): Buffer {
      return Buffer.from(new Float32Array(value).buffer);
    },
    fromDriver(value: Buffer): number[] {
      return Array.from(new Float32Array(value.buffer));
    },
  });

/**
 * Memories table schema.
 *
 * Stores semantic memory records with vector embeddings for similarity search.
 *
 * Schema matches libsql-schema.ts structure:
 * - id: Unique identifier (TEXT PRIMARY KEY)
 * - content: Memory content (TEXT NOT NULL)
 * - metadata: JSON metadata as TEXT (default '{}')
 * - collection: Memory collection/namespace (default 'default')
 * - tags: JSON array as TEXT (default '[]')
 * - created_at: ISO timestamp (default current datetime)
 * - updated_at: ISO timestamp (default current datetime)
 * - decay_factor: Confidence decay multiplier (default 1.0)
 * - embedding: F32_BLOB(EMBEDDING_DIM) vector for semantic search
 * - valid_from: Temporal validity start (ISO timestamp, NULL = always valid)
 * - valid_until: Temporal validity end (ISO timestamp, NULL = no expiry)
 * - superseded_by: Link to superseding memory (NULL = not superseded)
 * - auto_tags: LLM-generated tags (JSON array as TEXT)
 * - keywords: Space-separated keywords for FTS boost
 */
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  metadata: text("metadata").default("'{}'"),
  collection: text("collection").default("'default'"),
  tags: text("tags").default("'[]'"),
  created_at: text("created_at").default("(datetime('now'))"),
  updated_at: text("updated_at").default("(datetime('now'))"),
  decay_factor: real("decay_factor").default(1.0),
  embedding: vector(EMBEDDING_DIM)("embedding"),
  // Temporal validity
  valid_from: text("valid_from"),
  valid_until: text("valid_until"),
  superseded_by: text("superseded_by"), // Self-reference added in raw SQL
  // Auto-generated metadata
  auto_tags: text("auto_tags"),
  keywords: text("keywords"),
});

/**
 * TypeScript type for Memory record (inferred from schema).
 */
export type Memory = typeof memories.$inferSelect;

/**
 * TypeScript type for inserting Memory (inferred from schema).
 */
export type NewMemory = typeof memories.$inferInsert;

/**
 * Memory Links table - Zettelkasten-style bidirectional connections
 *
 * Enables:
 * - Related memories discovery
 * - Contradiction detection
 * - Supersession chains
 * - Elaboration relationships
 *
 * Link strength decays or reinforces based on usage.
 */
export const memoryLinks = sqliteTable("memory_links", {
  id: text("id").primaryKey(),
  source_id: text("source_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
  target_id: text("target_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
  link_type: text("link_type").notNull(), // 'related', 'contradicts', 'supersedes', 'elaborates'
  strength: real("strength").default(1.0),
  created_at: text("created_at").default("(datetime('now'))"),
}, (table) => [
  uniqueIndex("unique_link").on(table.source_id, table.target_id, table.link_type),
]);

export type MemoryLink = typeof memoryLinks.$inferSelect;
export type NewMemoryLink = typeof memoryLinks.$inferInsert;

/**
 * Entities table - Named entities extracted from memories
 *
 * Entity types:
 * - person: Joel, Dan Abramov, etc.
 * - project: Next.js, egghead, etc.
 * - technology: React, TypeScript, etc.
 * - concept: RSC, TDD, event sourcing, etc.
 *
 * canonical_name: normalized form for de-duplication
 */
export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  entity_type: text("entity_type").notNull(),
  canonical_name: text("canonical_name"),
  created_at: text("created_at").default("(datetime('now'))"),
  updated_at: text("updated_at").default("(datetime('now'))"),
}, (table) => [
  uniqueIndex("unique_entity").on(table.name, table.entity_type),
]);

export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;

/**
 * Relationships table - Entity-entity triples (subject-predicate-object)
 *
 * Examples:
 * - (Joel, prefers, TypeScript)
 * - (Joel, works_on, egghead)
 * - (Next.js, uses, React)
 *
 * memory_id: source memory that established this relationship (nullable)
 * confidence: 0-1 score, decays over time
 */
export const relationships = sqliteTable("relationships", {
  id: text("id").primaryKey(),
  subject_id: text("subject_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  predicate: text("predicate").notNull(),
  object_id: text("object_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  memory_id: text("memory_id").references(() => memories.id, { onDelete: "set null" }),
  confidence: real("confidence").default(1.0),
  created_at: text("created_at").default("(datetime('now'))"),
}, (table) => [
  uniqueIndex("unique_relationship").on(table.subject_id, table.predicate, table.object_id),
]);

export type Relationship = typeof relationships.$inferSelect;
export type NewRelationship = typeof relationships.$inferInsert;

/**
 * Memory-Entities junction table
 *
 * Links memories to entities with role annotation:
 * - subject: main entity the memory is about
 * - object: secondary entity mentioned
 * - mentioned: entity appears but not central
 */
export const memoryEntities = sqliteTable("memory_entities", {
  memory_id: text("memory_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
  entity_id: text("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  role: text("role"), // 'subject', 'object', 'mentioned'
}, (table) => [
  primaryKey({ columns: [table.memory_id, table.entity_id] }),
]);

export type MemoryEntity = typeof memoryEntities.$inferSelect;
export type NewMemoryEntity = typeof memoryEntities.$inferInsert;
