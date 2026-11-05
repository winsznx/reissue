import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "./client.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const handle = createDb(url, { max: 1 });
try {
  await migrate(handle.db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  console.log("Migrations applied");
} finally {
  await handle.close();
}
