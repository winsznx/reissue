import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
  ping: () => Promise<number>;
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => undefined });
  const db = drizzle(sql, { schema });
  return {
    db,
    close: () => sql.end({ timeout: 5 }),
    ping: async () => {
      const started = performance.now();
      await sql`select 1`;
      return performance.now() - started;
    },
  };
}
