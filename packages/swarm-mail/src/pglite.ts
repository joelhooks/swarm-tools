/**
 * PGLite Compatibility Shim
 *
 * Provides wrapPGlite for tests that still use PGLite directly.
 * This is a temporary shim during the libSQL migration.
 *
 * @deprecated Use libSQL adapter instead. This file will be removed.
 */

import type { DatabaseAdapter, QueryResult } from "./types/database.js";

/**
 * Wrap a PGlite instance as a DatabaseAdapter
 *
 * @deprecated Use createLibSQLAdapter instead
 */
export function wrapPGlite(pglite: any): DatabaseAdapter {
  return {
    async query<T = unknown>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await pglite.query(sql, params);
      return {
        rows: result.rows as T[],
      };
    },

    async exec(sql: string): Promise<void> {
      await pglite.exec(sql);
    },

    async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
      return await pglite.transaction(async (tx: any) => {
        const txAdapter: DatabaseAdapter = {
          async query<U = unknown>(
            sql: string,
            params?: unknown[],
          ): Promise<QueryResult<U>> {
            const result = await tx.query(sql, params);
            return { rows: result.rows as U[] };
          },
          async exec(sql: string): Promise<void> {
            await tx.exec(sql);
          },
        };
        return await fn(txAdapter);
      });
    },

    async close(): Promise<void> {
      await pglite.close();
    },

    async checkpoint(): Promise<void> {
      await pglite.exec("CHECKPOINT");
    },
  };
}
