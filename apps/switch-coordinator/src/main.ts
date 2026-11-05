import { createHash } from "node:crypto";

import { Worker } from "bullmq";
import { and, eq, sql } from "drizzle-orm";

import { newId, schema } from "@reissue/db";
import { SwitchConnection, SwitchHttpError, type GapFrame, type InboundEvent, type MessagePayload } from "@reissue/switch-adapter";
import {
  createServices,
  deliverOutbox,
  listBindings,
  loadCredentials,
  OUTBOX_QUEUE,
  redisConnection,
  type OutboxJob,
  type OutboxTransport,
} from "@reissue/workflows";

const CLIENT_VERSION = "0.1.0";
const REQUIRED_OPS = ["post_message", "send_targeted_message", "read_context"];

const creds = await loadCredentials();
if (!creds) {
  console.error("No coordinator credentials. Set SWITCH_BASE_URL and SWITCH_REGISTRATION_KEY, then run `pnpm --filter @reissue/switch-coordinator register`.");
  process.exit(1);
}

const { svc, close } = await createServices("reissue-coordinator");
const client = svc.switch!;
const ops = await client.discoverOperations();
const missing = REQUIRED_OPS.filter((op) => !ops.has(op));
if (missing.length) {
  svc.log.error({ missing, available: [...ops.keys()] }, "Switch server does not offer required operations");
  process.exit(1);
}
svc.log.info({ agentId: creds.agentId, name: creds.name, operations: ops.size }, "discovered Switch operations");

/** Stable per (agent, room) so the server resumes the same logical connection across restarts. */
function connectionIdFor(roomId: string): string {
  const h = createHash("sha256").update(`${creds!.agentId}:${roomId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const connections = new Map<string, SwitchConnection>();

async function persistCursor(roomId: string, cursor: number, generation: number | null, state: string, serverVersion: string | null): Promise<void> {
  const key = `${creds!.agentId}:${roomId}`;
  await svc.db
    .insert(schema.switchCursors)
    .values({ connectionKey: key, agentId: creds!.agentId, connectionId: connectionIdFor(roomId), roomId, cursor, generation, serverVersion, state, lastConnectedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.switchCursors.connectionKey,
      set: { cursor, generation, serverVersion, state, updatedAt: sql`now()`, lastError: null },
    });
}

/**
 * Persists the raw event under its dedupe key before any business work, then hands it to the
 * durable queue. A redelivered event hits the unique key and is not queued twice.
 */
async function ingestEvent(event: InboundEvent): Promise<void> {
  if (event.kind !== "message") {
    svc.log.info({ room: event.roomId, command: event.payload.command }, "switch command received");
    return;
  }
  const payload = event.payload;
  if (payload.sender_name === creds!.name) return;
  const id = newId("swe");
  const inserted = await svc.db
    .insert(schema.switchEvents)
    .values({
      id,
      agentId: creds!.agentId,
      connectionKey: `${creds!.agentId}:${event.roomId}`,
      switchEventSequence: event.sequence,
      messageId: payload.message_id,
      roomId: event.roomId,
      dedupeKey: `msg:${event.roomId}:${payload.message_id}`,
      eventType: "message",
      payload: payload as unknown as Record<string, unknown>,
      status: "QUEUED",
    })
    .onConflictDoNothing({ target: schema.switchEvents.dedupeKey })
    .returning({ id: schema.switchEvents.id });
  if (!inserted.length) {
    svc.log.info({ room: event.roomId, messageId: payload.message_id }, "duplicate switch delivery ignored");
    return;
  }
  await svc.queue.enqueue("inbound_event", { switchEventId: id }, `inbound:${id}`);
  svc.log.info(
    { room: event.roomId, messageId: payload.message_id, addressed: payload.addressed, attachments: payload.attachments.length, sender: payload.sender_name },
    "switch message queued",
  );
}

/**
 * After a reported gap, re-read the room and recover messages the stream skipped. Entries
 * already ingested are skipped by the same dedupe key the live path uses.
 */
async function recoverGap(roomId: string, gap: GapFrame): Promise<void> {
  const context = await client.readContext(roomId, { limit: 100 });
  const knownThreads = new Set(
    (await svc.db.select({ ops: schema.shipments.opsThreadId, sup: schema.shipments.supplierThreadId }).from(schema.shipments))
      .flatMap((s) => [s.ops, s.sup])
      .filter((v): v is string => Boolean(v)),
  );
  let recovered = 0;
  for (const thread of context.threads) {
    for (const entry of [thread.root, ...thread.replies]) {
      if (entry.kind !== "message" || entry.sender_name === creds!.name) continue;
      const threadId = entry.id === thread.root.id ? null : thread.root.id;
      const payload: MessagePayload = {
        addressed: entry.body.includes(`@${creds!.name}`) || (threadId !== null && knownThreads.has(threadId)),
        sender: entry.sender,
        sender_name: entry.sender_name,
        sender_kind: null,
        on_behalf_of: null,
        message_id: entry.id,
        body: entry.body,
        timestamp: entry.timestamp,
        thread_id: threadId,
        attachments: entry.attachments,
        opening_message: null,
        sender_role: null,
      };
      const before = await svc.db.select({ id: schema.switchEvents.id }).from(schema.switchEvents).where(eq(schema.switchEvents.dedupeKey, `msg:${roomId}:${entry.id}`));
      if (before.length) continue;
      await ingestEvent({ kind: "message", roomId, sequence: null, missed: null, payload });
      recovered += 1;
    }
  }
  svc.log.warn({ roomId, reason: gap.reason, recovered }, "gap recovery complete");
}

function connect(roomId: string, cursor: number | null, generation: number | null): void {
  const connection: SwitchConnection = new SwitchConnection({
    client,
    connectionId: connectionIdFor(roomId),
    roomId,
    startFrom: cursor,
    generation,
    clientName: "reissue-coordinator",
    clientVersion: CLIENT_VERSION,
    logger: svc.log,
    onEvent: ingestEvent,
    onCursor: (c, g): Promise<void> => persistCursor(roomId, c, g, "live", connection.serverVersion),
    onGap: (gap) => recoverGap(roomId, gap),
  });
  connection.on("status", (status: string) => {
    void svc.db
      .update(schema.switchCursors)
      .set({ state: status, updatedAt: sql`now()` })
      .where(eq(schema.switchCursors.connectionKey, `${creds!.agentId}:${roomId}`))
      .catch((error: unknown) => svc.log.warn({ err: String(error) }, "could not record connection status"));
  });
  connection.on("halted", (reason: string) => {
    svc.log.error({ roomId, reason }, "connection halted; not reconnecting automatically");
    void svc.db
      .update(schema.switchCursors)
      .set({ state: "stopped", lastError: reason, updatedAt: sql`now()` })
      .where(eq(schema.switchCursors.connectionKey, `${creds!.agentId}:${roomId}`))
      .catch((error: unknown) => svc.log.warn({ err: String(error) }, "could not record halt"));
  });
  connections.set(roomId, connection);
  connection.start();
}

async function syncRooms(): Promise<void> {
  const bindings = await listBindings(svc.db, svc.tenantId);
  for (const binding of bindings) {
    if (connections.has(binding.switchRoomId)) continue;
    const [stored] = await svc.db
      .select()
      .from(schema.switchCursors)
      .where(and(eq(schema.switchCursors.agentId, creds!.agentId), eq(schema.switchCursors.roomId, binding.switchRoomId)));
    svc.log.info({ room: binding.switchRoomId, intent: binding.intent, platform: binding.platform, resumeFrom: stored?.cursor ?? "head" }, "connecting room");
    connect(binding.switchRoomId, stored?.cursor ?? null, stored?.generation ?? null);
  }
}

function liveConnection(roomId: string): string {
  const connection = connections.get(roomId);
  if (!connection || connection.state.status !== "live") {
    throw new SwitchHttpError(503, "post", `no live Switch connection for room ${roomId}; will retry`);
  }
  return connectionIdFor(roomId);
}

const transport: OutboxTransport = {
  async post(roomId, body, threadId) {
    return (await client.postMessage(liveConnection(roomId), body, threadId)).event_id;
  },
  async targeted(roomId, body, targetNames, threadId) {
    const result = await client.sendTargetedMessage(liveConnection(roomId), body, targetNames, threadId);
    return { eventId: result.event_id, statuses: result.target_statuses };
  },
  async media(roomId, files, caption, threadId) {
    liveConnection(roomId);
    return (await client.uploadMedia(roomId, files, { caption, threadId })).event_id;
  },
};

await syncRooms();
const roomSync = setInterval(() => {
  syncRooms().catch((error: unknown) => svc.log.error({ err: String(error) }, "room sync failed"));
}, 30_000);
const freshness = setInterval(() => {
  for (const [roomId, connection] of connections) {
    void svc.db
      .update(schema.switchCursors)
      .set({ state: connection.state.status, updatedAt: sql`now()` })
      .where(eq(schema.switchCursors.connectionKey, `${creds.agentId}:${roomId}`))
      .catch((error: unknown) => svc.log.warn({ err: String(error) }, "freshness update failed"));
  }
}, 30_000);

const outboxWorker = new Worker<OutboxJob>(
  OUTBOX_QUEUE,
  async (job) => deliverOutbox(svc, job.data.outboxId, transport),
  { connection: redisConnection(svc.config.REDIS_URL), concurrency: 1 },
);
outboxWorker.on("failed", (job, error) => svc.log.warn({ outboxId: job?.data.outboxId, attempts: job?.attemptsMade, err: error.message }, "message delivery failed"));

svc.log.info({ rooms: connections.size }, "coordinator running");

const shutdown = async (signal: string) => {
  svc.log.info({ signal }, "coordinator shutting down");
  clearInterval(roomSync);
  clearInterval(freshness);
  await outboxWorker.close();
  await Promise.all([...connections.values()].map((c) => c.stop()));
  await close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
