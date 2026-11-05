import { and, eq, isNull, sql } from "drizzle-orm";

import { schema } from "@reissue/db";
import { SwitchHttpError } from "@reissue/switch-adapter";

import { appendEvent } from "./case-log.js";
import { recordSupplierThread } from "./collaboration.js";
import type { Services } from "./services.js";

export interface OutboxTransport {
  post(roomId: string, body: string, threadId: string | null): Promise<string>;
  targeted(roomId: string, body: string, targetNames: string[], threadId: string | null): Promise<{ eventId: string; statuses: Record<string, string> }>;
  media(roomId: string, files: { filename: string; mime: string; bytes: Buffer }[], caption: string, threadId: string | null): Promise<string>;
}

type OutboxRow = typeof schema.outboxMessages.$inferSelect;

const MIME_BY_TYPE: Record<string, string> = {
  PACKET_ZIP: "application/zip",
  CORRECTION_SUMMARY_PDF: "application/pdf",
  DOCUMENT_INDEX_CSV: "text/csv",
};

/**
 * Delivers one outbox row through Switch. The row's state is the source of truth: a SENT row is
 * never re-sent, and a crash mid-send leaves it SENDING for the sweeper to retry. Retryable
 * transport failures (Switch down, 5xx, budget) are rethrown so the queue backs off.
 */
export async function deliverOutbox(svc: Services, outboxId: string, transport: OutboxTransport): Promise<"sent" | "skipped" | "failed"> {
  const [row] = await svc.db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.id, outboxId));
  if (!row || row.state === "SENT" || row.state === "CANCELLED") return "skipped";
  await svc.db
    .update(schema.outboxMessages)
    .set({ state: "SENDING", attempts: sql`${schema.outboxMessages.attempts} + 1`, updatedAt: sql`now()` })
    .where(eq(schema.outboxMessages.id, outboxId));

  const threadId = await resolveThread(svc, row);
  let eventId: string;
  let statuses: Record<string, string> | null = null;
  try {
    if (row.content.kind === "post") {
      eventId = await transport.post(row.targetRoomId, row.content.body, threadId);
    } else if (row.content.kind === "targeted") {
      const result = await transport.targeted(row.targetRoomId, row.content.body, row.content.targetNames, threadId);
      eventId = result.eventId;
      statuses = result.statuses;
    } else {
      const artifacts = await Promise.all(
        row.content.artifactIds.map(async (id) => {
          const [a] = await svc.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, id));
          if (!a) throw new Error(`Artifact ${id} missing`);
          return { filename: a.filename, mime: MIME_BY_TYPE[a.type] ?? "application/octet-stream", bytes: await svc.store.get(a.objectKey) };
        }),
      );
      eventId = await transport.media(row.targetRoomId, artifacts, row.content.caption, threadId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = !(error instanceof SwitchHttpError) || error.retryable || error.status === 409;
    await svc.db
      .update(schema.outboxMessages)
      .set({ state: retryable ? "PENDING" : "FAILED", lastError: message.slice(0, 500), updatedAt: sql`now()` })
      .where(eq(schema.outboxMessages.id, outboxId));
    if (retryable) throw error;
    if (row.shipmentId) {
      await svc.db.transaction((tx) =>
        appendEvent(tx, row.shipmentId!, "JOB_FAILED", { job: "deliver_message", purpose: row.purpose, roomId: row.targetRoomId, error: message.slice(0, 300) }),
      );
    }
    return "failed";
  }

  await svc.db
    .update(schema.outboxMessages)
    .set({ state: "SENT", switchEventId: eventId, sentAt: sql`now()`, lastError: null, updatedAt: sql`now()` })
    .where(eq(schema.outboxMessages.id, outboxId));
  await afterDelivery(svc, row, eventId, threadId, statuses);
  return "sent";
}

/** Case threads are created by the first post; later messages queued before that resolve here. */
async function resolveThread(svc: Services, row: OutboxRow): Promise<string | null> {
  if (row.threadId || !row.shipmentId) return row.threadId;
  const [shipment] = await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, row.shipmentId));
  if (!shipment) return null;
  if (row.targetRoomId === shipment.opsRoomId) return shipment.opsThreadId;
  if (row.targetRoomId === shipment.supplierRoomId) return shipment.supplierThreadId;
  return null;
}

async function afterDelivery(svc: Services, row: OutboxRow, eventId: string, threadId: string | null, statuses: Record<string, string> | null): Promise<void> {
  if (!row.shipmentId) return;
  const shipmentId = row.shipmentId;
  if (row.purpose.startsWith("supplier_request:")) {
    await recordSupplierThread(svc, shipmentId, row.purpose.slice("supplier_request:".length), eventId, threadId);
  }
  if (row.visibility === "internal" && !threadId) {
    await svc.db
      .update(schema.shipments)
      .set({ opsRoomId: row.targetRoomId, opsThreadId: eventId })
      .where(and(eq(schema.shipments.id, shipmentId), isNull(schema.shipments.opsThreadId)));
  }
  if (row.purpose === "review_request") {
    await svc.db
      .update(schema.tasks)
      .set({ status: "SENT", switchMessageId: eventId, updatedAt: sql`now()` })
      .where(and(eq(schema.tasks.shipmentId, shipmentId), eq(schema.tasks.kind, "DOCUMENT_REVIEW"), eq(schema.tasks.status, "PENDING")));
  }
  await svc.db.transaction(async (tx) => {
    await tx.select({ id: schema.shipments.id }).from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).for("update");
    await appendEvent(tx, shipmentId, "MESSAGE_POSTED", {
      purpose: row.purpose,
      roomId: row.targetRoomId,
      threadId,
      eventId,
      visibility: row.visibility,
      kind: row.content.kind,
      targets: row.content.kind === "targeted" ? row.content.targetNames : undefined,
      targetStatuses: statuses ?? undefined,
      preview: row.content.kind === "media" ? row.content.caption : row.content.body.split("\n").slice(0, 2).join(" · ").slice(0, 200),
    });
  });
}
