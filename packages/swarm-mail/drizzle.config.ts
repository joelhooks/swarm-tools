import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit configuration for libSQL migrations.
 * 
 * ## Standard Drizzle Kit Commands
 * 
 * - `bunx drizzle-kit generate` - Generate migration files from schema changes
 * - `bunx drizzle-kit migrate` - Apply migrations to database
 * - `bunx drizzle-kit push` - Push schema changes without migration files (development only)
 * - `bunx drizzle-kit studio` - Launch Drizzle Studio GUI
 * 
 * ## Runtime Migration Validation
 * 
 * The custom migration runner (`src/db/migrate.ts`) validates actual database
 * schema matches Drizzle schema definitions at runtime:
 * 
 * ```typescript
 * import { validateSchema, migrateDatabase } from "./db/migrate.js";
 * import * as schema from "./db/schema/index.js";
 * 
 * // Validate schema
 * const result = await validateSchema(client, schema);
 * if (!result.valid) {
 *   console.error("Schema drift detected:", result.issues);
 * }
 * 
 * // Auto-fix schema drift
 * await migrateDatabase(client, schema);
 * ```
 * 
 * ## Schema Drift Handling
 * 
 * The migration runner handles common schema drift scenarios:
 * 
 * - **Missing columns** → `ALTER TABLE ADD COLUMN` (preserves data)
 * - **Wrong types (empty table)** → `DROP + CREATE` (safe to recreate)
 * - **Wrong types (with data)** → Error (manual migration required)
 * 
 * This catches issues like the "no such column: project_key" bug where
 * `CREATE TABLE IF NOT EXISTS` didn't update stale schema.
 * 
 * @see src/db/migrate.ts for implementation details
 * @see src/db/migrate.test.ts for usage examples
 */
export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "turso",
} satisfies Config;
