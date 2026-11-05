import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://reissue:reissue@127.0.0.1:5442/postgres";
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://reissue:reissue@127.0.0.1:5442/reissue_test";

/** Recreates an isolated database for the run so tests never touch development data. */
export default async function setup(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  await admin.unsafe("drop database if exists reissue_test with (force)");
  await admin.unsafe("create database reissue_test");
  await admin.end();
  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
  await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL("../../packages/db/migrations", import.meta.url)) });
  await sql.end();
}
