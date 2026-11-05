import { anthropicReplyModel } from "@reissue/ai";
import { createDb, type DbHandle } from "@reissue/db";
import { SwitchClient } from "@reissue/switch-adapter";

import { loadConfig } from "./config.js";
import { JobQueue, redisConnection } from "./queue.js";
import { ensureTenant, seedRoomBindings } from "./rooms.js";
import { createLogger, type Services } from "./services.js";
import { ObjectStore } from "./storage.js";
import { WorkerClient } from "./worker-client.js";

export interface ServiceHandle {
  svc: Services;
  dbHandle: DbHandle;
  close: () => Promise<void>;
}

/** Wires the shared services for one process. Every app entrypoint starts here. */
export async function createServices(name: string, env: NodeJS.ProcessEnv = process.env): Promise<ServiceHandle> {
  const config = loadConfig(env);
  const log = createLogger(config.LOG_LEVEL, name);
  const dbHandle = createDb(config.DATABASE_URL);
  const store = new ObjectStore(config, config.S3_BUCKET);
  await store.ensureBucket();
  const queue = new JobQueue(redisConnection(config.REDIS_URL), dbHandle.db);
  const tenant = await ensureTenant(dbHandle.db, config.REISSUE_TENANT_NAME);
  await seedRoomBindings(dbHandle.db, config, tenant.id);
  const switchClient = config.switchEnabled
    ? new SwitchClient({ baseUrl: config.SWITCH_BASE_URL!, agentId: config.SWITCH_COORDINATOR_AGENT_ID!, apiKey: config.SWITCH_COORDINATOR_AGENT_API_KEY! })
    : null;
  const replyModel =
    config.REPLY_CLASSIFIER_PROVIDER === "anthropic" && config.EXTRACTION_API_KEY
      ? anthropicReplyModel(config.EXTRACTION_API_KEY, config.EXTRACTION_MODEL ?? "claude-haiku-5-5")
      : null;
  const svc: Services = {
    config,
    db: dbHandle.db,
    store,
    worker: new WorkerClient(config.WORKER_URL),
    queue,
    log,
    switch: switchClient,
    replyModel,
    tenantId: tenant.id,
  };
  return {
    svc,
    dbHandle,
    close: async () => {
      await queue.close();
      await dbHandle.close();
    },
  };
}
