/**
 * Drizzle migration runner with schema validation.
 * 
 * Validates actual database schema matches Drizzle schema definitions.
 * Detects and fixes schema drift (missing columns, wrong types).
 * 
 * ## Strategy
 * 
 * 1. **ALTER TABLE for missing columns** - Safe, preserves data
 * 2. **DROP + CREATE for wrong types** - Only if table is empty
 * 3. **Error for type mismatches with data** - Manual intervention required
 * 
 * ## Usage
 * 
 * ```typescript
 * import { migrateDatabase, validateSchema } from "./migrate.js";
 * import { eventsTable, messagesTable } from "./schema/index.js";
 * 
 * // Validate schema
 * const validation = await validateSchema(client, { eventsTable, messagesTable });
 * if (!validation.valid) {
 *   console.error("Schema issues:", validation.issues);
 * }
 * 
 * // Apply migrations
 * await migrateDatabase(client, { eventsTable, messagesTable });
 * ```
 * 
 * @module db/migrate
 */

import type { Client } from "@libsql/client";
import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Schema validation issue types
 */
export type SchemaIssueType = 
  | "missing_column" 
  | "wrong_column_type" 
  | "missing_table";

/**
 * Schema validation issue
 */
export interface SchemaIssue {
  table: string;
  type: SchemaIssueType;
  column?: string;
  expected?: string;
  actual?: string;
  message: string;
}

/**
 * Schema validation result
 */
export interface SchemaValidationResult {
  valid: boolean;
  issues: SchemaIssue[];
}

/**
 * Table column metadata from PRAGMA table_info
 */
interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * Validates database schema against Drizzle schema definitions.
 * 
 * Checks for:
 * - Missing tables
 * - Missing columns
 * - Wrong column types
 * 
 * @param client - libSQL client
 * @param tables - Record of Drizzle table definitions
 * @returns Validation result with issues
 */
export async function validateSchema(
  client: Client,
  tables: Record<string, SQLiteTableWithColumns<any>>
): Promise<SchemaValidationResult> {
  const issues: SchemaIssue[] = [];

  for (const [_key, table] of Object.entries(tables)) {
    const tableName = (table as any)[Symbol.for("drizzle:Name")];
    
    // Check if table exists
    const tableExists = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      args: [tableName],
    });

    if (tableExists.rows.length === 0) {
      issues.push({
        table: tableName,
        type: "missing_table",
        message: `Table ${tableName} does not exist`,
      });
      continue;
    }

    // Get actual columns
    const actualColumns = await client.execute({
      sql: `PRAGMA table_info(${tableName})`,
      args: [],
    });

    const actualColMap = new Map<string, ColumnInfo>();
    for (const row of actualColumns.rows) {
      const col: ColumnInfo = {
        cid: row.cid as number,
        name: row.name as string,
        type: (row.type as string).toUpperCase(),
        notnull: row.notnull as number,
        dflt_value: row.dflt_value as string | null,
        pk: row.pk as number,
      };
      actualColMap.set(col.name, col);
    }

    // Get expected columns from Drizzle schema
    const columns = Object.values(table).filter(
      (val): val is AnySQLiteColumn<any> => 
        val != null && typeof val === "object" && "name" in val
    );

    for (const col of columns) {
      const colName = col.name;
      const actual = actualColMap.get(colName);

      if (!actual) {
        issues.push({
          table: tableName,
          type: "missing_column",
          column: colName,
          message: `Column ${tableName}.${colName} is missing`,
        });
        continue;
      }

      // Check type match
      const expectedType = normalizeType(col.getSQLType());
      const actualType = normalizeType(actual.type);

      if (expectedType !== actualType) {
        issues.push({
          table: tableName,
          type: "wrong_column_type",
          column: colName,
          expected: expectedType,
          actual: actualType,
          message: `Column ${tableName}.${colName} has wrong type: expected ${expectedType}, got ${actualType}`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Applies migrations to fix schema drift.
 * 
 * Strategy:
 * - Missing columns → ALTER TABLE ADD COLUMN
 * - Wrong types (empty table) → DROP + CREATE
 * - Wrong types (with data) → Error (manual migration required)
 * 
 * @param client - libSQL client
 * @param tables - Record of Drizzle table definitions
 * @throws Error if table has data and needs type change
 */
export async function migrateDatabase(
  client: Client,
  tables: Record<string, SQLiteTableWithColumns<any>>
): Promise<void> {
  const validation = await validateSchema(client, tables);

  if (validation.valid) {
    return; // Nothing to do
  }

  // Group issues by table
  const issuesByTable = new Map<string, SchemaIssue[]>();
  for (const issue of validation.issues) {
    const existing = issuesByTable.get(issue.table) || [];
    existing.push(issue);
    issuesByTable.set(issue.table, existing);
  }

  for (const [tableName, tableIssues] of issuesByTable) {
    const hasMissingColumns = tableIssues.some(i => i.type === "missing_column");
    const hasWrongTypes = tableIssues.some(i => i.type === "wrong_column_type");
    const isMissingTable = tableIssues.some(i => i.type === "missing_table");

    if (isMissingTable) {
      // Create table using Drizzle's generated schema
      // For now, we'll use the raw SQL approach
      // In production, you'd use drizzle-kit migrations
      await createTableFromSchema(client, tableName, tables);
      continue;
    }

    if (hasWrongTypes) {
      // Check if table has data
      const countResult = await client.execute({
        sql: `SELECT COUNT(*) as count FROM ${tableName}`,
        args: [],
      });
      const count = countResult.rows[0]?.count as number;

      if (count > 0) {
        throw new Error(
          `Cannot recreate table ${tableName} - it has ${count} rows. ` +
          `Type mismatches require manual migration. Issues: ` +
          tableIssues.map(i => i.message).join(", ")
        );
      }

      // Safe to recreate (empty table)
      await client.execute({ sql: `DROP TABLE ${tableName}`, args: [] });
      await createTableFromSchema(client, tableName, tables);
      continue;
    }

    if (hasMissingColumns) {
      // Add missing columns via ALTER TABLE
      for (const issue of tableIssues.filter(i => i.type === "missing_column")) {
        await addMissingColumn(client, issue, tables);
      }
    }
  }
}

/**
 * Normalizes SQL type strings for comparison.
 * 
 * SQLite is flexible with type names - "INTEGER" and "INT" are equivalent.
 * This function normalizes to canonical forms.
 */
function normalizeType(type: string): string {
  const upper = type.toUpperCase().trim();
  
  // Handle type with size modifiers: VARCHAR(255) → TEXT
  const baseType = upper.split("(")[0];
  
  // Normalize SQLite type affinity
  if (baseType === "INT" || baseType === "BIGINT") return "INTEGER";
  if (baseType === "VARCHAR" || baseType === "CHAR") return "TEXT";
  if (baseType === "DOUBLE" || baseType === "FLOAT") return "REAL";
  
  return baseType;
}

/**
 * Adds a missing column via ALTER TABLE.
 * 
 * SQLite ALTER TABLE has limitations:
 * - Cannot add columns with non-constant defaults (e.g., datetime('now'))
 * - Cannot add NOT NULL columns without a default
 * 
 * We handle this by providing sensible defaults for required columns.
 * 
 * @param client - libSQL client
 * @param issue - Schema issue describing missing column
 * @param tables - Record of Drizzle table definitions
 */
async function addMissingColumn(
  client: Client,
  issue: SchemaIssue,
  tables: Record<string, SQLiteTableWithColumns<any>>
): Promise<void> {
  if (!issue.column) return;

  // Find the table definition
  const table = Object.values(tables).find(
    t => (t as any)[Symbol.for("drizzle:Name")] === issue.table
  );

  if (!table) {
    throw new Error(`Table definition not found for ${issue.table}`);
  }

  // Find the column definition
  const columns = Object.values(table).filter(
    (val): val is AnySQLiteColumn<any> => 
      val != null && typeof val === "object" && "name" in val
  );

  const col = columns.find(c => c.name === issue.column);
  if (!col) {
    throw new Error(`Column definition not found for ${issue.table}.${issue.column}`);
  }

  // Build ALTER TABLE statement
  const sqlType = col.getSQLType();
  const notNull = col.notNull ? "NOT NULL" : "";
  const defaultValue = getColumnDefaultForAlterTable(col);
  
  const sql = `ALTER TABLE ${issue.table} ADD COLUMN ${issue.column} ${sqlType} ${notNull} ${defaultValue}`.trim();
  
  await client.execute({ sql, args: [] });
}

/**
 * Get default value suitable for ALTER TABLE ADD COLUMN.
 * 
 * ALTER TABLE in SQLite has stricter requirements than CREATE TABLE:
 * - Only constant values allowed (no function calls like datetime('now'))
 * 
 * We provide sensible constant defaults to allow the ALTER to succeed.
 */
function getColumnDefaultForAlterTable(col: AnySQLiteColumn<any>): string {
  const config = (col as any).config;
  
  if (config?.default !== undefined) {
    const defaultVal = config.default;
    
    // Skip SQL functions - they're not allowed in ALTER TABLE
    if (typeof defaultVal === "string" && defaultVal.includes("(")) {
      // Fall through to provide a constant default instead
    } else if (typeof defaultVal === "number") {
      return `DEFAULT ${defaultVal}`;
    } else if (typeof defaultVal === "boolean") {
      return `DEFAULT ${defaultVal ? 1 : 0}`;
    } else if (typeof defaultVal === "string") {
      return `DEFAULT '${defaultVal}'`;
    }
  }
  
  // For columns without constant defaults, provide type-appropriate defaults
  // This allows ALTER TABLE to succeed
  const sqlType = normalizeType(col.getSQLType());
  if (sqlType === "TEXT") return "DEFAULT ''";
  if (sqlType === "INTEGER") return "DEFAULT 0";
  if (sqlType === "REAL") return "DEFAULT 0.0";
  
  return "";
}

/**
 * Creates table from Drizzle schema.
 * 
 * Generates CREATE TABLE statement from Drizzle table definition.
 * Used when table is missing or needs to be recreated (if empty).
 */
async function createTableFromSchema(
  client: Client,
  tableName: string,
  tables: Record<string, SQLiteTableWithColumns<any>>
): Promise<void> {
  // Find the table definition
  const table = Object.values(tables).find(
    t => (t as any)[Symbol.for("drizzle:Name")] === tableName
  );

  if (!table) {
    throw new Error(`Table definition not found for ${tableName}`);
  }

  // Get columns from Drizzle schema
  const columns = Object.values(table).filter(
    (val): val is AnySQLiteColumn<any> => 
      val != null && typeof val === "object" && "name" in val
  );

  // Build column definitions
  const columnDefs: string[] = [];
  const primaryKeys: string[] = [];

  for (const col of columns) {
    const colName = col.name;
    const sqlType = col.getSQLType();
    const notNull = col.notNull ? "NOT NULL" : "";
    
    // Check if it's a primary key
    const isPrimary = (col as any).primary;
    const isAutoIncrement = (col as any).config?.autoIncrement;
    
    let def = `${colName} ${sqlType}`;
    
    if (isPrimary) {
      if (isAutoIncrement) {
        def += " PRIMARY KEY AUTOINCREMENT";
      } else {
        primaryKeys.push(colName);
      }
    }
    
    if (notNull && !isPrimary) {
      def += " NOT NULL";
    }
    
    const defaultVal = getColumnDefault(col);
    if (defaultVal && !isAutoIncrement) {
      def += ` ${defaultVal}`;
    }
    
    columnDefs.push(def);
  }

  // Add composite primary key if exists
  if (primaryKeys.length > 0) {
    columnDefs.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
  }

  const createSQL = `CREATE TABLE ${tableName} (\n  ${columnDefs.join(",\n  ")}\n)`;
  
  await client.execute({ sql: createSQL, args: [] });
}

/**
 * Extracts default value from column definition.
 * 
 * Handles SQL function defaults (like datetime('now')) specially - they need
 * to be unquoted. String literals get quoted.
 */
function getColumnDefault(col: AnySQLiteColumn<any>): string {
  // Access default via column's config if available
  const config = (col as any).config;
  
  if (config?.default !== undefined) {
    const defaultVal = config.default;
    
    // Handle SQL functions (like datetime('now'))
    if (typeof defaultVal === "object" && defaultVal !== null) {
      // Check if it's a SQL function wrapper
      const sqlChunk = (defaultVal as any).queryChunks?.[0];
      if (sqlChunk) {
        return `DEFAULT ${sqlChunk}`;
      }
    }
    
    // Handle different default value types
    if (typeof defaultVal === "string") {
      // Check if it's a SQL function call (contains parentheses)
      if (defaultVal.includes("(") && defaultVal.includes(")")) {
        // SQL function - don't quote it
        return `DEFAULT (${defaultVal})`;
      }
      // String literal - quote it
      return `DEFAULT '${defaultVal}'`;
    }
    if (typeof defaultVal === "number") {
      return `DEFAULT ${defaultVal}`;
    }
    if (typeof defaultVal === "boolean") {
      return `DEFAULT ${defaultVal ? 1 : 0}`;
    }
  }
  
  // For NOT NULL columns without explicit default, provide a sensible default
  // based on type to allow ALTER TABLE to succeed
  if (col.notNull) {
    const sqlType = normalizeType(col.getSQLType());
    if (sqlType === "TEXT") return "DEFAULT ''";
    if (sqlType === "INTEGER") return "DEFAULT 0";
    if (sqlType === "REAL") return "DEFAULT 0.0";
  }
  
  return "";
}
