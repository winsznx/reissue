import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { and, eq } from "drizzle-orm";

import type { ActorRef } from "@reissue/contracts";
import { schema } from "@reissue/db";
import { createServices, ingest, runJob, type IncomingFile, type ServiceHandle, type Services } from "@reissue/workflows";

export const FIXTURES = fileURLToPath(new URL("../fixtures/documents/", import.meta.url));
export const OPS_ROOM = "test-room-ops";
export const SUPPLIER_ROOM = "test-room-supplier";

export const TEST_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://reissue:reissue@127.0.0.1:5442/reissue_test",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6392/5",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9210",
  S3_BUCKET: "reissue-test",
  S3_ACCESS_KEY_ID: "reissue",
  S3_SECRET_ACCESS_KEY: "reissue-local-secret",
  WORKER_URL: process.env.WORKER_URL ?? "http://127.0.0.1:4220",
  APP_SESSION_SECRET: "test-session-secret-0123456789abcdef",
  WORKBENCH_ACCESS_CODE: "test-access-code",
  REISSUE_EXAMINER_TOOL_TOKEN: "test-examiner-token",
  REISSUE_LIAISON_TOOL_TOKEN: "test-liaison-token",
  REISSUE_STATE_DIR: "/nonexistent-reissue-test-state",
  SWITCH_BASE_URL: "",
  SWITCH_OPS_ROOM_ID: OPS_ROOM,
  SWITCH_OPS_PLATFORM: "slack",
  SWITCH_SUPPLIER_ROOM_ID: SUPPLIER_ROOM,
  SWITCH_SUPPLIER_PLATFORM: "telegram",
  LOG_LEVEL: "warn",
};

export const ACTOR: ActorRef = { kind: "human", id: "test:coordinator", display: "Test Coordinator", platform: "test" };

export async function services(overrides: NodeJS.ProcessEnv = {}): Promise<ServiceHandle> {
  const handle = await createServices("reissue-test", { ...TEST_ENV, ...overrides });
  await handle.svc.queue.work.obliterate({ force: true });
  await handle.svc.queue.outbox.obliterate({ force: true });
  return handle;
}

export async function fixture(name: string): Promise<IncomingFile> {
  return { filename: name, bytes: await readFile(`${FIXTURES}${name}`) };
}

/**
 * Runs queued jobs inline through the real job runner until the queue is empty. Delayed jobs
 * (reminders, timeouts) are left alone unless `includeDelayed` names their job types.
 */
export async function drain(svc: Services, includeDelayed: string[] = [], maxRounds = 50): Promise<string[]> {
  const ran: string[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const waiting = await svc.queue.work.getJobs(["waiting", "prioritized"]);
    const delayed = includeDelayed.length ? (await svc.queue.work.getJobs(["delayed"])).filter((j) => includeDelayed.includes(j.name)) : [];
    const batch = [...waiting, ...delayed];
    if (!batch.length) return ran;
    for (const job of batch) {
      await job.remove();
      await runJob(svc, job);
      ran.push(job.name);
    }
    includeDelayed = [];
  }
  throw new Error("queue did not drain");
}

export async function openCase(svc: Services, files: string[], replyTo: { roomId: string; threadId: string | null } | null = { roomId: OPS_ROOM, threadId: "ops-thread-root" }) {
  const result = await ingest(svc, {
    tenantId: svc.tenantId,
    files: await Promise.all(files.map(fixture)),
    source: { platform: "slack", roomId: OPS_ROOM, messageId: `msg-${Math.random().toString(36).slice(2)}`, threadId: null, senderRef: "u-dana", senderName: "Dana", receivedAt: new Date() },
    actor: ACTOR,
    replyTo,
    correlationId: "test",
  });
  await drain(svc);
  return result.shipment.id;
}

export async function shipment(svc: Services, id: string) {
  const [row] = await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, id));
  return row!;
}

export async function issues(svc: Services, id: string) {
  return svc.db.select().from(schema.issues).where(eq(schema.issues.shipmentId, id));
}

export async function outbox(svc: Services, id: string, purpose?: string) {
  const rows = await svc.db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.shipmentId, id));
  return purpose ? rows.filter((r) => r.purpose.startsWith(purpose)) : rows;
}

export async function events(svc: Services, id: string, type?: string) {
  const rows = await svc.db.select().from(schema.caseEvents).where(type ? and(eq(schema.caseEvents.shipmentId, id), eq(schema.caseEvents.eventType, type)) : eq(schema.caseEvents.shipmentId, id));
  return rows;
}
