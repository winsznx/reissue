import { and, eq, inArray, lt, sql } from "drizzle-orm";
import pino, { type Logger } from "pino";

import type { ReplyModel } from "@reissue/ai";
import type { ActorRef } from "@reissue/contracts";
import { newId, schema, type Database, type OutboxContent, type Transaction } from "@reissue/db";
import type { SwitchClient } from "@reissue/switch-adapter";

import { appendEvent, lockCase, type Shipment } from "./case-log.js";
import type { AppConfig } from "./config.js";
import type { JobQueue, WorkJobName, WorkJobs } from "./queue.js";
import type { ObjectStore } from "./storage.js";
import type { WorkerClient } from "./worker-client.js";

export interface Services {
  config: AppConfig;
  db: Database;
  store: ObjectStore;
  worker: WorkerClient;
  queue: JobQueue;
  log: Logger;
  /** Coordinator's agent-authenticated client; null when Switch is not configured. */
  switch: SwitchClient | null;
  replyModel: ReplyModel | null;
  tenantId: string;
}

export function createLogger(level: string, name: string): Logger {
  return pino({
    name,
    level,
    redact: { paths: ["*.apiKey", "*.api_key", "*.authorization", "*.password", "*.token"], censor: "[redacted]" },
  });
}

type AfterCommit = () => Promise<unknown>;

export interface CaseScope {
  tx: Transaction;
  shipment: Shipment;
  /** Runs after the transaction commits; used for queue submissions so jobs never see uncommitted rows. */
  after: (fn: AfterCommit) => void;
  enqueue: <N extends WorkJobName>(name: N, data: WorkJobs[N], key: string, delayMs?: number) => void;
  say: (message: OutboundMessage) => Promise<string | null>;
  event: (type: Parameters<typeof appendEvent>[2], payload: Record<string, unknown>, actor?: ActorRef, correlationId?: string | null) => Promise<number>;
}

export interface OutboundMessage {
  purpose: string;
  roomId: string;
  threadId: string | null;
  content: OutboxContent;
  dedupeKey: string;
  visibility: "internal" | "supplier";
}

/** Runs a case mutation under the case lock with deferred side effects. */
export async function withCase<T>(svc: Services, shipmentId: string, fn: (scope: CaseScope) => Promise<T>): Promise<T> {
  const effects: AfterCommit[] = [];
  const result = await svc.db.transaction(async (tx) => {
    const shipment = await lockCase(tx, shipmentId);
    const scope: CaseScope = {
      tx,
      shipment,
      after: (fn) => effects.push(fn),
      enqueue: (name, data, key, delayMs) =>
        effects.push(() => svc.queue.enqueue(name, data, key, { delayMs, shipmentId })),
      say: async (message) => {
        const id = await queueMessage(tx, shipmentId, message);
        if (id) effects.push(() => svc.queue.enqueueOutbox(id));
        return id;
      },
      event: (type, payload, actor, correlationId) => appendEvent(tx, shipmentId, type, payload, actor, correlationId ?? null),
    };
    return fn(scope);
  });
  for (const effect of effects) {
    try {
      await effect();
    } catch (error) {
      svc.log.error({ err: error instanceof Error ? error.message : String(error), shipmentId }, "post-commit effect failed; sweeper will retry");
    }
  }
  return result;
}

/** Writes the intent to send exactly once per dedupe key. Delivery is retried separately. */
export async function queueMessage(tx: Transaction, shipmentId: string | null, message: OutboundMessage): Promise<string | null> {
  const id = newId("out");
  const inserted = await tx
    .insert(schema.outboxMessages)
    .values({
      id,
      shipmentId,
      purpose: message.purpose,
      targetRoomId: message.roomId,
      threadId: message.threadId,
      content: message.content,
      dedupeKey: message.dedupeKey,
      state: "PENDING",
      visibility: message.visibility,
    })
    .onConflictDoNothing({ target: schema.outboxMessages.dedupeKey })
    .returning({ id: schema.outboxMessages.id });
  return inserted[0]?.id ?? null;
}

/**
 * Recovers work lost between a commit and its queue submission (process crash, Redis blip):
 * pending outbox rows and queued jobs older than the grace period are resubmitted. Both are
 * idempotent by key, so resubmitting something already in flight is harmless.
 */
export async function sweepStranded(svc: Services, graceMs = 30_000): Promise<{ outbox: number; jobs: number }> {
  const cutoff = new Date(Date.now() - graceMs);
  const outbox = await svc.db
    .select({ id: schema.outboxMessages.id })
    .from(schema.outboxMessages)
    .where(and(inArray(schema.outboxMessages.state, ["PENDING", "SENDING"]), lt(schema.outboxMessages.updatedAt, cutoff)))
    .limit(200);
  for (const row of outbox) await svc.queue.enqueueOutbox(row.id);

  const stranded = await svc.db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.status, "QUEUED"), lt(schema.jobs.nextRunAt, cutoff)))
    .limit(200);
  let jobs = 0;
  for (const job of stranded) {
    if (!job.queueJobId) continue;
    const existing = await svc.queue.work.getJob(job.queueJobId);
    if (existing) continue;
    await svc.queue.work.add(job.jobType, job.payload, { jobId: job.queueJobId });
    jobs += 1;
  }
  if (outbox.length || jobs) svc.log.info({ outbox: outbox.length, jobs }, "resubmitted stranded work");
  return { outbox: outbox.length, jobs };
}

export async function nextIssueCode(tx: Transaction, shipmentId: string): Promise<string> {
  const [row] = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from ${schema.issues} where ${schema.issues.shipmentId} = ${shipmentId}`,
  );
  return `D-${String(Number(row?.n ?? 0) + 1).padStart(3, "0")}`;
}
