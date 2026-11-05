import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { eq } from "drizzle-orm";

import { schema } from "@reissue/db";

import { appendEvent } from "./case-log.js";
import { escalate, liaisonPostTimeout, requestReview, reviewTimeout, sendReminder, sendSupplierRequest } from "./collaboration.js";
import { markExtractionFailed, runExtraction } from "./extraction.js";
import { processInboundEvent } from "./inbound.js";
import { generatePacket } from "./packet-service.js";
import { markJob, WORK_QUEUE, type WorkJobName, type WorkJobs } from "./queue.js";
import { runReconcile } from "./reconcile-service.js";
import type { Services } from "./services.js";

type Handler<N extends WorkJobName> = (svc: Services, data: WorkJobs[N], jobId: string) => Promise<unknown>;

const HANDLERS: { [N in WorkJobName]: Handler<N> } = {
  extract_version: (svc, d) => runExtraction(svc, d.versionId),
  reconcile: (svc, d, jobId) => runReconcile(svc, d.shipmentId, d.epoch, d.reason, jobId),
  request_review: (svc, d) => requestReview(svc, d.shipmentId, d.epoch, d.trigger),
  review_timeout: (svc, d) => reviewTimeout(svc, d.shipmentId, d.taskId),
  supplier_request: (svc, d) => sendSupplierRequest(svc, d.shipmentId, d.epoch, d.trigger),
  liaison_post_timeout: (svc, d) => liaisonPostTimeout(svc, d.shipmentId, d.taskId),
  inbound_event: (svc, d) => processInboundEvent(svc, d.switchEventId),
  generate_packet: (svc, d) => generatePacket(svc, d.shipmentId, d.epoch),
  reminder: (svc, d) => sendReminder(svc, d.shipmentId, d.taskId, d.step),
  escalation: (svc, d) => escalate(svc, d.shipmentId, d.taskId),
};

export async function runJob(svc: Services, job: Job): Promise<unknown> {
  const handler = HANDLERS[job.name as WorkJobName] as Handler<WorkJobName> | undefined;
  if (!handler) throw new Error(`No handler for job ${job.name}`);
  const started = performance.now();
  await markJob(svc.db, job.id!, { status: "RUNNING", attempts: job.attemptsMade + 1 });
  try {
    const result = await handler(svc, job.data as WorkJobs[WorkJobName], job.id!);
    await markJob(svc.db, job.id!, { status: "COMPLETED", durationMs: Math.round(performance.now() - started), lastError: null });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await markJob(svc.db, job.id!, { status: final ? "DEAD" : "FAILED", lastError: message.slice(0, 1000), durationMs: Math.round(performance.now() - started) });
    if (final) await onExhausted(svc, job, message);
    throw error;
  }
}

/** A job out of retries surfaces on the case instead of disappearing. */
async function onExhausted(svc: Services, job: Job, message: string): Promise<void> {
  const data = job.data as { shipmentId?: string; versionId?: string };
  if (job.name === "extract_version" && data.versionId) {
    await markExtractionFailed(svc, data.versionId, message);
    return;
  }
  if (!data.shipmentId) return;
  const shipmentId = data.shipmentId;
  await svc.db.transaction(async (tx) => {
    await tx.select({ id: schema.shipments.id }).from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).for("update");
    await appendEvent(tx, shipmentId, "JOB_FAILED", { job: job.name, jobId: job.id, attempts: job.attemptsMade + 1, error: message.slice(0, 300) });
  });
}

export function startWorkWorker(svc: Services, connection: ConnectionOptions, concurrency = 4): Worker {
  const worker = new Worker(WORK_QUEUE, (job) => runJob(svc, job), { connection, concurrency, lockDuration: 120_000 });
  worker.on("failed", (job, error) => svc.log.warn({ job: job?.name, jobId: job?.id, attempts: job?.attemptsMade, err: error.message }, "job failed"));
  worker.on("error", (error) => svc.log.error({ err: error.message }, "worker error"));
  return worker;
}
