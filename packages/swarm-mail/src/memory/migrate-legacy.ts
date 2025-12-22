/**
 * Legacy Semantic Memory Migration Tool
 *
 * Migrates memories from the standalone semantic-memory MCP server
 * (~/.semantic-memory/memory) to the consolidated swarm-mail database.
 *
 * ## Usage
 *
 * ```typescript
 * import { migrateLegacyMemories } from 'swarm-mail';
 *
 * const result = await migrateLegacyMemories({
 *   legacyPath: '~/.semantic-memory/memory',
 *   targetAdapter: swarmMailAdapter,
 *   dryRun: false,
 * });
 *
 * console.log(`Migrated ${result.migrated} memories`);
 * ```
 *
 * ## What Gets Migrated
 *
 * - All memories from the `memories` table
 * - All embeddings from the `memory_embeddings` table
 * - Metadata, collections, and timestamps preserved
 *
 * ## Conflict Handling
 *
 * - Duplicate IDs are skipped (existing memories take precedence)
 * - Migration is idempotent - safe to run multiple times
 *
 * @module memory/migrate-legacy
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseAdapter } from "../types/database.js";

/**
 * Migration options
 */
export interface MigrationOptions {
  /** Path to legacy semantic-memory database directory */
  legacyPath?: string;
  /** Target database adapter (from swarm-mail) */
  targetDb: DatabaseAdapter;
  /** If true, only report what would be migrated without making changes */
  dryRun?: boolean;
  /** Callback for progress updates */
  onProgress?: (message: string) => void;
}

/**
 * Migration result
 */
export interface MigrationResult {
  /** Number of memories successfully migrated */
  migrated: number;
  /** Number of memories skipped (already exist) */
  skipped: number;
  /** Number of memories that failed to migrate */
  failed: number;
  /** Error messages for failed migrations */
  errors: string[];
  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * Legacy memory row from old database
 */
interface LegacyMemoryRow {
  id: string;
  content: string;
  metadata: string | Record<string, unknown>;
  collection: string;
  created_at: string;
  last_validated_at: string | null;
}

/**
 * Legacy embedding row from old database
 */
interface LegacyEmbeddingRow {
  memory_id: string;
  embedding: string; // PGLite returns vector as string
}

/**
 * Default path to legacy semantic-memory database
 */
export function getDefaultLegacyPath(): string {
  return join(homedir(), ".semantic-memory", "memory");
}

/**
 * Check if legacy database exists
 * 
 * Checks for the presence of PGLite data files (PG_VERSION file)
 * to distinguish between an empty directory and an actual database.
 */
export function legacyDatabaseExists(path?: string): boolean {
  const dbPath = path || getDefaultLegacyPath();
  if (!existsSync(dbPath)) {
    return false;
  }
  // Check for PGLite's PG_VERSION file which indicates an actual database
  const pgVersionPath = join(dbPath, "PG_VERSION");
  return existsSync(pgVersionPath);
}

/**
 * Migrate memories from legacy semantic-memory database
 *
 * @param options - Migration options
 * @returns Migration result with counts and errors
 */
export async function migrateLegacyMemories(
  options: MigrationOptions,
): Promise<MigrationResult> {
  const {
    legacyPath = getDefaultLegacyPath(),
    targetDb,
    dryRun = false,
    onProgress = console.log,
  } = options;

  const result: MigrationResult = {
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    dryRun,
  };

  // Check if legacy database exists
  if (!existsSync(legacyPath)) {
    onProgress(`[migrate] No legacy database found at ${legacyPath}`);
    return result;
  }

  onProgress(`[migrate] Opening legacy database at ${legacyPath}`);

  // Dynamically import PGlite to avoid loading WASM at module import time
  const { PGlite } = (await import("@electric-sql/pglite")) as any;
  const { vector } = (await import("@electric-sql/pglite/vector")) as any;

  // Open legacy database (read-only)
  let legacyDb: any;
  try {
    legacyDb = await PGlite.create({
      dataDir: legacyPath,
      extensions: { vector },
    });
  } catch (error) {
    const err = error as Error;
    result.errors.push(`Failed to open legacy database: ${err.message}`);
    result.failed = 1;
    return result;
  }

  try {
    // Check if memories table exists
    const tableCheck = await legacyDb.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'memories'
      ) as exists
    `) as { rows: Array<{ exists: boolean }> };

    if (!tableCheck.rows[0]?.exists) {
      onProgress(`[migrate] No memories table found in legacy database`);
      return result;
    }

    // Get all memories from legacy database
    const memoriesResult = await legacyDb.query(`
      SELECT id, content, metadata, collection, created_at, last_validated_at
      FROM memories
      ORDER BY created_at ASC
    `) as { rows: LegacyMemoryRow[] };

    onProgress(`[migrate] Found ${memoriesResult.rows.length} memories to migrate`);

    // Get all embeddings
    const embeddingsResult = await legacyDb.query(`
      SELECT memory_id, embedding::text as embedding
      FROM memory_embeddings
    `) as { rows: LegacyEmbeddingRow[] };

    // Create embedding lookup map
    const embeddingMap = new Map<string, number[]>();
    for (const row of embeddingsResult.rows) {
      // Parse vector string format: [0.1,0.2,0.3,...]
      const embedding = parseVectorString(row.embedding);
      if (embedding) {
        embeddingMap.set(row.memory_id, embedding);
      }
    }

    onProgress(`[migrate] Found ${embeddingMap.size} embeddings`);

    // Migrate each memory
    for (const row of memoriesResult.rows) {
      try {
        // Check if memory already exists in target
        const existingCheck = await targetDb.query<{ id: string }>(
          `SELECT id FROM memories WHERE id = $1`,
          [row.id],
        );
        if (existingCheck.rows.length > 0) {
          result.skipped++;
          continue;
        }

        if (dryRun) {
          onProgress(`[migrate] Would migrate: ${row.id} (${row.content.slice(0, 50)}...)`);
          result.migrated++;
          continue;
        }

        // Parse metadata
        const metadata = typeof row.metadata === "string"
          ? JSON.parse(row.metadata)
          : row.metadata;

        // Get embedding if available
        const embedding = embeddingMap.get(row.id);

        // Insert memory
        await targetDb.query(
          `INSERT INTO memories (id, content, metadata, collection, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.id, row.content, JSON.stringify(metadata), row.collection, row.created_at],
        );

        // Insert embedding if available
        if (embedding && embedding.length > 0) {
          await targetDb.query(
            `INSERT INTO memory_embeddings (memory_id, embedding)
             VALUES ($1, $2::vector)`,
            [row.id, `[${embedding.join(",")}]`],
          );
        }

        result.migrated++;
        
        if (result.migrated % 10 === 0) {
          onProgress(`[migrate] Progress: ${result.migrated} migrated, ${result.skipped} skipped`);
        }
      } catch (error) {
        const err = error as Error;
        result.failed++;
        result.errors.push(`Failed to migrate ${row.id}: ${err.message}`);
      }
    }

    onProgress(`[migrate] Migration complete: ${result.migrated} migrated, ${result.skipped} skipped, ${result.failed} failed`);
  } finally {
    await legacyDb.close();
  }

  return result;
}

/**
 * Parse PGLite vector string format to number array
 *
 * PGLite returns vectors as strings like "[0.1,0.2,0.3]"
 */
function parseVectorString(vectorStr: string): number[] | null {
  try {
    // Remove brackets and split by comma
    const cleaned = vectorStr.replace(/^\[|\]$/g, "");
    if (!cleaned) return null;
    
    const values = cleaned.split(",").map((v) => parseFloat(v.trim()));
    
    // Validate all values are numbers
    if (values.some(Number.isNaN)) return null;
    
    return values;
  } catch {
    return null;
  }
}

/**
 * Get migration status without actually migrating
 *
 * @param legacyPath - Path to legacy database
 * @returns Count of memories that would be migrated
 */
export async function getMigrationStatus(
  legacyPath?: string,
): Promise<{ total: number; withEmbeddings: number } | null> {
  const dbPath = legacyPath || getDefaultLegacyPath();

  if (!legacyDatabaseExists(dbPath)) {
    return null;
  }

  // Dynamically import PGlite to avoid loading WASM at module import time
  const { PGlite } = (await import("@electric-sql/pglite")) as any;
  const { vector } = (await import("@electric-sql/pglite/vector")) as any;

  let db: any;
  try {
    db = await PGlite.create({
      dataDir: dbPath,
      extensions: { vector },
    });
  } catch {
    return null;
  }

  try {
    const memoriesCount = await db.query(`
      SELECT COUNT(*) as count FROM memories
    `) as { rows: Array<{ count: string }> };

    const embeddingsCount = await db.query(`
      SELECT COUNT(*) as count FROM memory_embeddings
    `) as { rows: Array<{ count: string }> };

    return {
      total: parseInt(memoriesCount.rows[0]?.count || "0"),
      withEmbeddings: parseInt(embeddingsCount.rows[0]?.count || "0"),
    };
  } finally {
    await db.close();
  }
}

/**
 * Check if target database already has memories
 * Used to skip migration prompt if already migrated
 *
 * @param targetDb - Target database adapter
 * @returns true if memories exist, false if empty
 */
export async function targetHasMemories(targetDb: DatabaseAdapter): Promise<boolean> {
  const result = await targetDb.query<{ count: string }>(`
    SELECT COUNT(*) as count FROM memories
  `);
  return parseInt(result.rows[0]?.count || "0") > 0;
}
