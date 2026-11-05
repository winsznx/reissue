import { buildApp } from "./app.js";
import { createContext } from "./context.js";

const ctx = await createContext();
const app = await buildApp(ctx);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await ctx.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: process.env.API_HOST ?? "127.0.0.1", port: ctx.api.API_PORT });
