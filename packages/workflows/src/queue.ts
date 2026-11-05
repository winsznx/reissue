import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { sql } from "drizzle-orm";

import { newId, schema, type Database } from "@reissue/db";

export const WORK_QUEUE = "reissue-work";
export const OUTBOX_QUEUE = "reissue-outbox";

export interface WorkJobs {
  extract_version: { shipmentId: string; versionId: string };
  reconcile: { shipmentId: string; epoch: number; reason: string };
  request_review: { shipmentId: string; epoch: number; trigger: string };
  review_timeout: { shipmentId: string; taskId: string };
  supplier_request: { shipmentId: string; epoch: number; trigger: string };
  liaison_post_timeout: { shipmentId: string; taskId: string };
  inbound_event: { switchEventId: string };
  generate_packet: { shipmentId: string; epoch: number };
  reminder: { shipmentId: string; taskId: string; step: number };
  escalation: { shipmentId: string; taskId: string };
}

export type WorkJobName = keyof WorkJobs;

export interface OutboxJob {
  outboxId: string;
}

export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

const DEFAULT_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
  removeOnFail: false,
};

/**
 * Durable job submission. The idempotency key is both the BullMQ job id and a unique row in
 * `jobs`, so a retried handler or replayed event cannot enqueue the same business step twice.
 */
export class JobQueue {
  readonly work: Queue;
  readonly outbox: Queue;

  constructor(
    connection: ConnectionOptions,
    private readonly db: Database,
  ) {
    this.work = new Queue(WORK_QUEUE, { connection, defaultJobOptions: DEFAULT_OPTS });
    this.outbox = new Queue(OUTBOX_QUEUE, {
      connection,
      defaultJobOptions: { ...DEFAULT_OPTS, attempts: 12, backoff: { type: "exponential", delay: 1_000 } },
    });
  }

  async enqueue<N extends WorkJobName>(
    name: N,
    data: WorkJobs[N],
    idempotencyKey: string,
    options: { delayMs?: number; shipmentId?: string | null } = {},
  ): Promise<{ queued: boolean }> {
    const jobId = idempotencyKey.replace(/:/g, "_");
    const inserted = await this.db
      .insert(schema.jobs)
      .values({
        id: newId("job"),
        shipmentId: options.shipmentId ?? ("shipmentId" in data ? (data as { shipmentId: string }).shipmentId : null),
        jobType: name,
        queueJobId: jobId,
        status: "QUEUED",
        idempotencyKey,
        payload: data as unknown as Record<string, unknown>,
        nextRunAt: options.delayMs ? new Date(Date.now() + options.delayMs) : new Date(),
      })
      .onConflictDoNothing({ target: schema.jobs.idempotencyKey })
      .returning({ id: schema.jobs.id });
    if (inserted.length === 0) {
      const existing = await this.work.getJob(jobId);
      if (existing) return { queued: false };
    }
    await this.work.add(name, data, { jobId, delay: options.delayMs });
    return { queued: true };
  }

  async enqueueOutbox(outboxId: string): Promise<void> {
    await this.outbox.add("deliver", { outboxId } satisfies OutboxJob, { jobId: `outbox_${outboxId}` });
  }

  async counts(): Promise<Record<string, number>> {
    const [work, outbox] = await Promise.all([this.work.getJobCounts(), this.outbox.getJobCounts()]);
    return Object.fromEntries([
      ...Object.entries(work).map(([k, v]) => [`work_${k}`, v]),
      ...Object.entries(outbox).map(([k, v]) => [`outbox_${k}`, v]),
    ]);
  }

  async ping(): Promise<number> {
    const started = performance.now();
    await this.work.getJobCounts("waiting");
    return performance.now() - started;
  }

  async close(): Promise<void> {
    await Promise.all([this.work.close(), this.outbox.close()]);
  }
}

export async function markJob(
  db: Database,
  queueJobId: string,
  patch: { status: "RUNNING" | "COMPLETED" | "FAILED" | "DEAD"; attempts?: number; lastError?: string | null; durationMs?: number },
): Promise<void> {
  await db
    .update(schema.jobs)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(sql`${schema.jobs.queueJobId} = ${queueJobId}`);
}
