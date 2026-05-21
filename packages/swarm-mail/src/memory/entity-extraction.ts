/**
 * Entity Extraction - Knowledge Graph Builder
 *
 * Extracts entities and relationships from memory content to build a knowledge graph.
 * Based on A-MEM paper pattern: named entities + subject-predicate-object triples.
 *
 * ## Entity Types
 * - person: People (e.g., "Joel", "Sarah")
 * - project: Projects (e.g., "egghead.io", "Next.js")
 * - technology: Technologies (e.g., "TypeScript", "React")
 * - concept: Abstract concepts (e.g., "DDD", "TDD")
 *
 * ## Relationships
 * Subject-predicate-object triples (e.g., "Joel prefers TypeScript")
 *
 * @module memory/entity-extraction
 */

import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { Client } from "@libsql/client";

// ============================================================================
// Types
// ============================================================================

export type EntityType = "person" | "project" | "technology" | "concept";

export interface Entity {
  id: string;
  name: string;
  entityType: EntityType;
  canonicalName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Relationship {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  memoryId?: string;
  confidence: number;
  createdAt: Date;
}

/** Extracted entity from LLM (before DB storage) */
export interface ExtractedEntity {
  name: string;
  entityType: EntityType;
  prefLabel?: string;
  altLabels?: string[];
}

/** Result from LLM extraction (before DB storage) */
export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: Array<{
    subjectName: string;
    predicate: string;
    objectName: string;
    confidence: number;
  }>;
}

// ============================================================================
// Zod Schemas for LLM Structured Output
// ============================================================================

const EntitySchema = z.object({
  name: z.string().describe("Name of the entity (e.g., 'Joel', 'TypeScript')"),
  entityType: z
    .enum(["person", "project", "technology", "concept"])
    .describe(
      "Type of entity: person (people), project (software projects), technology (languages/frameworks), concept (abstract ideas)"
    ),
  prefLabel: z
    .string()
    .optional()
    .describe(
      "Preferred label (SKOS prefLabel) - the canonical/standard name for this entity"
    ),
  altLabels: z
    .array(z.string())
    .optional()
    .describe(
      "Alternative labels (SKOS altLabel) - synonyms, abbreviations, or alternative names"
    ),
});

const RelationshipSchema = z.object({
  subjectName: z.string().describe("Subject entity name"),
  predicate: z
    .string()
    .describe(
      "Relationship verb (e.g., 'prefers', 'uses', 'built', 'works-on')"
    ),
  objectName: z.string().describe("Object entity name"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score 0-1 for this relationship"),
});

const ExtractionSchema = z.object({
  entities: z
    .array(EntitySchema)
    .describe("Named entities found in the content"),
  relationships: z
    .array(RelationshipSchema)
    .describe(
      "Relationships between entities as subject-predicate-object triples"
    ),
});

// ============================================================================
// LLM Extraction
// ============================================================================

/**
 * Extract entities and relationships from content using LLM
 *
 * Uses Vercel AI SDK with structured output (Output.object pattern).
 * Graceful degradation: returns empty arrays on LLM errors.
 *
 * @param content - Text content to extract from
 * @param config - Model configuration (model name + API key OR LanguageModel instance)
 * @returns Extracted entities and relationships
 *
 * @example
 * ```typescript
 * // With model string (Anthropic via AI Gateway)
 * const result = await extractEntitiesAndRelationships(
 *   "Joel prefers TypeScript for Next.js",
 *   { model: "anthropic/claude-haiku-4-5", apiKey: process.env.API_KEY }
 * );
 *
 * // With Ollama LanguageModel instance
 * import { getOllamaExtractionModel } from "./ollama-llm.js";
 * const result = await extractEntitiesAndRelationships(
 *   "Joel prefers TypeScript for Next.js",
 *   { languageModel: getOllamaExtractionModel() }
 * );
 * ```
 */
export async function extractEntitiesAndRelationships(
  content: string,
  config: { model?: string; apiKey?: string; languageModel?: LanguageModel }
): Promise<ExtractionResult> {
  try {
    // Support both string model names (AI Gateway) and LanguageModel instances (Ollama)
    const modelConfig = config.languageModel
      ? { model: config.languageModel as LanguageModel }
      : {
          model: config.model!,
          headers: config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : undefined,
        };

    const { output } = await generateText({
      ...modelConfig,
      prompt: `Extract named entities and relationships from the following text.

Entities should be people, projects, technologies, or concepts mentioned.
For each entity, extract:
- name: The primary name used in the text
- entityType: person, project, technology, or concept
- prefLabel (optional): The preferred/canonical name if different from how it appears in text
- altLabels (optional): Synonyms, abbreviations, or alternative names (e.g., "TS" for "TypeScript")

Relationships should be clear subject-predicate-object triples.

Text: ${content}`,
      output: Output.object({
        schema: ExtractionSchema,
      }),
    });

    return output as ExtractionResult;
  } catch (error) {
    // Graceful degradation: log error but return empty structure
    console.error("Entity extraction failed:", error);
    return {
      entities: [],
      relationships: [],
    };
  }
}

// ============================================================================
// Database Storage
// ============================================================================

/**
 * Store entities in database with deduplication
 *
 * Deduplicates by (name, entity_type) - case-insensitive name matching.
 * Returns existing entities if already stored.
 *
 * @param entities - Entities to store (without id/timestamps)
 * @param db - libSQL client
 * @returns Stored entities with IDs and timestamps
 */
export async function storeEntities(
  entities: Array<Omit<Entity, "id" | "createdAt" | "updatedAt">>,
  db: Client
): Promise<Entity[]> {
  const seen = new Map<string, Entity>(); // Dedupe in-memory first

  for (const entity of entities) {
    // Dedupe key: lowercase name + type
    const dedupeKey = `${entity.name.toLowerCase()}:${entity.entityType}`;
    
    // Skip if already processed in this batch
    if (seen.has(dedupeKey)) {
      continue;
    }

    // Check if entity already exists in database (case-insensitive)
    const existing = await db.execute(
      `
      SELECT id, name, entity_type, canonical_name, created_at, updated_at
      FROM entities
      WHERE LOWER(name) = LOWER(?) AND entity_type = ?
    `,
      [entity.name, entity.entityType]
    );

    let storedEntity: Entity;

    if (existing.rows.length > 0) {
      // Return existing entity
      const row = existing.rows[0];
      storedEntity = {
        id: row.id as string,
        name: row.name as string,
        entityType: row.entity_type as EntityType,
        canonicalName: (row.canonical_name as string | null) ?? undefined,
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
      };
    } else {
      // Insert new entity
      const id = `ent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date().toISOString();

      try {
        await db.execute(
          `
          INSERT INTO entities (id, name, entity_type, canonical_name, pref_label, alt_labels, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            id,
            entity.name,
            entity.entityType,
            entity.canonicalName ?? null,
            (entity as any).prefLabel ?? null,
            (entity as any).altLabels ? JSON.stringify((entity as any).altLabels) : null,
            now,
            now,
          ]
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("no column named pref_label") && !message.includes("no column named alt_labels")) {
          throw error;
        }

        // Older test/local databases can predate the schema-overhaul columns.
        // Add them lazily so entity extraction remains backward-compatible.
        await db.execute(`ALTER TABLE entities ADD COLUMN pref_label TEXT`).catch(() => undefined);
        await db.execute(`ALTER TABLE entities ADD COLUMN alt_labels TEXT`).catch(() => undefined);
        await db.execute(
          `
          INSERT INTO entities (id, name, entity_type, canonical_name, pref_label, alt_labels, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            id,
            entity.name,
            entity.entityType,
            entity.canonicalName ?? null,
            (entity as any).prefLabel ?? null,
            (entity as any).altLabels ? JSON.stringify((entity as any).altLabels) : null,
            now,
            now,
          ]
        );
      }

      storedEntity = {
        id,
        name: entity.name,
        entityType: entity.entityType,
        canonicalName: entity.canonicalName,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };
    }

    seen.set(dedupeKey, storedEntity);
  }

  // Return only unique entities
  return Array.from(seen.values());
}

/**
 * Store relationships in database with deduplication
 *
 * Deduplicates by (subject_id, predicate, object_id) triple.
 * If duplicate exists, keeps the first one (higher confidence preferred).
 *
 * @param relationships - Relationships to store (without id/createdAt)
 * @param memoryId - Memory ID these relationships came from
 * @param db - libSQL client
 * @returns Stored relationships with IDs and timestamps
 */
export async function storeRelationships(
  relationships: Array<Omit<Relationship, "id" | "createdAt">>,
  memoryId: string,
  db: Client
): Promise<Relationship[]> {
  const seen = new Map<string, Relationship>(); // Dedupe in-memory

  for (const rel of relationships) {
    // Dedupe key: subject+predicate+object triple
    const dedupeKey = `${rel.subjectId}:${rel.predicate}:${rel.objectId}`;
    
    // Skip if already processed in this batch
    if (seen.has(dedupeKey)) {
      continue;
    }

    // Check if relationship already exists in database
    const existing = await db.execute(
      `
      SELECT id, subject_id, predicate, object_id, memory_id, confidence, created_at
      FROM relationships
      WHERE subject_id = ? AND predicate = ? AND object_id = ?
    `,
      [rel.subjectId, rel.predicate, rel.objectId]
    );

    let storedRelationship: Relationship;

    if (existing.rows.length > 0) {
      // Return existing relationship
      const row = existing.rows[0];
      storedRelationship = {
        id: row.id as string,
        subjectId: row.subject_id as string,
        predicate: row.predicate as string,
        objectId: row.object_id as string,
        memoryId: (row.memory_id as string | null) ?? undefined,
        confidence: row.confidence as number,
        createdAt: new Date(row.created_at as string),
      };
    } else {
      // Insert new relationship
      const id = `rel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date().toISOString();

      await db.execute(
        `
        INSERT INTO relationships (id, subject_id, predicate, object_id, memory_id, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [id, rel.subjectId, rel.predicate, rel.objectId, memoryId, rel.confidence, now]
      );

      storedRelationship = {
        id,
        subjectId: rel.subjectId,
        predicate: rel.predicate,
        objectId: rel.objectId,
        memoryId,
        confidence: rel.confidence,
        createdAt: new Date(now),
      };
    }

    seen.set(dedupeKey, storedRelationship);
  }

  // Return only unique relationships
  return Array.from(seen.values());
}

/**
 * Link memory to entities via junction table
 *
 * Creates memory_entities junction records for many-to-many relationship.
 * Idempotent - safe to call multiple times with same IDs.
 *
 * @param memoryId - Memory ID
 * @param entityIds - Entity IDs to link
 * @param db - libSQL client
 */
export async function linkMemoryToEntities(
  memoryId: string,
  entityIds: string[],
  db: Client
): Promise<void> {
  for (const entityId of entityIds) {
    // Use INSERT OR IGNORE to make idempotent
    await db.execute(
      `
      INSERT OR IGNORE INTO memory_entities (memory_id, entity_id)
      VALUES (?, ?)
    `,
      [memoryId, entityId]
    );
  }
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all entities of a specific type
 *
 * @param entityType - Type to filter by
 * @param db - libSQL client
 * @returns Entities of specified type
 */
export async function getEntitiesByType(
  entityType: EntityType,
  db: Client
): Promise<Entity[]> {
  const result = await db.execute(
    `
    SELECT id, name, entity_type, canonical_name, created_at, updated_at
    FROM entities
    WHERE entity_type = ?
    ORDER BY name
  `,
    [entityType]
  );

  return result.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    entityType: row.entity_type as EntityType,
    canonicalName: (row.canonical_name as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }));
}

/**
 * Get relationships for an entity
 *
 * @param entityId - Entity ID to get relationships for
 * @param db - libSQL client
 * @param direction - Filter by direction: "subject" (outgoing), "object" (incoming), or "both"
 * @returns Relationships involving the entity
 */
export async function getRelationshipsForEntity(
  entityId: string,
  db: Client,
  direction: "subject" | "object" | "both" = "both"
): Promise<Relationship[]> {
  let query: string;
  let params: string[];

  if (direction === "subject") {
    query = `
      SELECT id, subject_id, predicate, object_id, memory_id, confidence, created_at
      FROM relationships
      WHERE subject_id = ?
    `;
    params = [entityId];
  } else if (direction === "object") {
    query = `
      SELECT id, subject_id, predicate, object_id, memory_id, confidence, created_at
      FROM relationships
      WHERE object_id = ?
    `;
    params = [entityId];
  } else {
    // both
    query = `
      SELECT id, subject_id, predicate, object_id, memory_id, confidence, created_at
      FROM relationships
      WHERE subject_id = ? OR object_id = ?
    `;
    params = [entityId, entityId];
  }

  const result = await db.execute(query, params);

  return result.rows.map((row) => ({
    id: row.id as string,
    subjectId: row.subject_id as string,
    predicate: row.predicate as string,
    objectId: row.object_id as string,
    memoryId: (row.memory_id as string | null) ?? undefined,
    confidence: row.confidence as number,
    createdAt: new Date(row.created_at as string),
  }));
}
