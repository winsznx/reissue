import { createServices, redisConnection, startWorkWorker, sweepStranded } from "@reissue/workflows";

/**
 * Workflow worker: runs extraction, reconciliation, agent handoffs, supplier requests,
 * reminders and packet generation from the durable queue. Safe to kill at any point:
 * every job is idempotent by key and the sweeper resubmits anything stranded.
 */
const { svc, close } = await createServices("reissue-worker");
const worker = startWorkWorker(svc, redisConnection(svc.config.REDIS_URL), Number(process.env.WORKER_CONCURRENCY ?? 4));

const sweep = setInterval(() => {
  sweepStranded(svc).catch((error: unknown) => svc.log.error({ err: String(error) }, "sweep failed"));
}, 30_000);

svc.log.info({ switch: svc.config.switchEnabled, examiner: svc.config.SWITCH_EXAMINER_NAME, liaison: svc.config.SWITCH_LIAISON_NAME }, "workflow worker started");

const shutdown = async (signal: string) => {
  svc.log.info({ signal }, "worker shutting down");
  clearInterval(sweep);
  await worker.close();
  await close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
