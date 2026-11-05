import { and, eq, sql } from "drizzle-orm";

import type { ActorRef } from "@reissue/contracts";
import { formatCaseCode } from "@reissue/core";
import { newId, schema } from "@reissue/db";

import { appendEvent, transitionCase, type Shipment } from "./case-log.js";
import { checkFile, safeDisplayName } from "./files.js";
import { intakeAck } from "./messages.js";
import { withCase, type Services } from "./services.js";
import { blobKey } from "./storage.js";

export interface IncomingFile {
  filename: string;
  bytes: Buffer;
}

export interface IntakeSource {
  platform: string;
  roomId: string | null;
  messageId: string | null;
  threadId: string | null;
  senderRef: string | null;
  senderName: string | null;
  receivedAt: Date;
}

export interface IntakeRejection {
  filename: string;
  reason: string;
  detail: string;
}

export interface IntakeResult {
  shipment: Shipment;
  intakeId: string;
  accepted: { versionId: string; filename: string }[];
  duplicates: { filename: string; versionId: string }[];
  quarantined: { filename: string; versionId: string; detail: string }[];
  rejected: IntakeRejection[];
}

export interface IntakeRequest {
  tenantId: string;
  /** Existing case to add files to; omitted to open a new case. */
  shipmentId?: string;
  files: IncomingFile[];
  /** Files that could not even be fetched (e.g. over the chat platform's size cap). */
  preRejected?: IntakeRejection[];
  source: IntakeSource;
  actor: ActorRef;
  /** Where intake acknowledgements go; null for direct API intake with no chat thread. */
  replyTo: { roomId: string; threadId: string | null } | null;
  correlationId: string;
}

async function openCase(svc: Services, tenantId: string, source: IntakeSource, replyTo: IntakeRequest["replyTo"]): Promise<string> {
  return svc.db.transaction(async (tx) => {
    const [tenant] = await tx
      .update(schema.tenants)
      .set({ caseSequence: sql`${schema.tenants.caseSequence} + 1` })
      .where(eq(schema.tenants.id, tenantId))
      .returning({ seq: schema.tenants.caseSequence });
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    const id = newId("shp");
    const caseCode = formatCaseCode(tenant.seq + 240);
    await tx.insert(schema.shipments).values({
      id,
      tenantId,
      caseCode,
      state: "RECEIVED",
      opsRoomId: replyTo?.roomId ?? null,
      opsThreadId: replyTo ? (replyTo.threadId ?? source.messageId) : null,
    });
    await appendEvent(tx, id, "CASE_CREATED", { caseCode, platform: source.platform, roomId: source.roomId, messageId: source.messageId });
    return id;
  });
}

/**
 * Accepts one chat message's (or one upload's) files as a single intake transaction.
 * Bytes are stored content-addressed before the transaction, so a crash after storage
 * leaves an orphan blob at worst, never a version row without its file.
 */
export async function ingest(svc: Services, request: IntakeRequest): Promise<IntakeResult> {
  const checked = request.files.map((file) => ({
    file,
    name: safeDisplayName(file.filename),
    check: checkFile(file.bytes, svc.config.MAX_UPLOAD_BYTES),
  }));
  for (const item of checked) {
    if (item.check.ok) await svc.store.putImmutable(blobKey(item.check.sha256), item.file.bytes, item.check.mime, item.check.sha256);
  }
  const suspicious = checked.filter((c) => !c.check.ok && c.check.reason === "suspicious");
  for (const item of suspicious) {
    const sha = (await import("node:crypto")).createHash("sha256").update(item.file.bytes).digest("hex");
    await svc.store.putImmutable(blobKey(sha), item.file.bytes, "application/octet-stream", sha);
  }

  const shipmentId = request.shipmentId ?? (await openCase(svc, request.tenantId, request.source, request.replyTo));
  const intakeId = newId("int");

  return withCase(svc, shipmentId, async (scope) => {
    const { tx } = scope;
    let shipment = scope.shipment;
    const result: IntakeResult = {
      shipment,
      intakeId,
      accepted: [],
      duplicates: [],
      quarantined: [],
      rejected: [...(request.preRejected ?? [])],
    };

    for (const item of checked) {
      const { check } = item;
      if (!check.ok) {
        if (check.reason !== "suspicious") {
          result.rejected.push({ filename: item.name, reason: check.reason, detail: check.detail });
          continue;
        }
      }
      const sha = check.ok ? check.sha256 : (await import("node:crypto")).createHash("sha256").update(item.file.bytes).digest("hex");
      const mime = check.ok ? check.mime : "application/octet-stream";

      const [existing] = await tx
        .select({ id: schema.documentVersions.id })
        .from(schema.documentVersions)
        .where(and(eq(schema.documentVersions.shipmentId, shipmentId), eq(schema.documentVersions.sha256, sha)))
        .limit(1);
      if (existing) {
        result.duplicates.push({ filename: item.name, versionId: existing.id });
        await scope.event("DUPLICATE_FILE_REUSED", { filename: item.name, sha256: sha, reusedVersionId: existing.id }, request.actor, request.correlationId);
        continue;
      }

      await tx
        .insert(schema.blobs)
        .values({ sha256: sha, objectKey: blobKey(sha), mime, sizeBytes: item.file.bytes.length })
        .onConflictDoNothing();
      const versionId = newId("ver");
      const quarantine = check.ok ? null : check.detail;
      await tx.insert(schema.documentVersions).values({
        id: versionId,
        shipmentId,
        intakeId,
        state: quarantine ? "QUARANTINED" : "RECEIVED",
        sha256: sha,
        originalFilename: item.name,
        mime,
        sizeBytes: item.file.bytes.length,
        sourcePlatform: request.source.platform,
        sourceRoomId: request.source.roomId,
        sourceMessageId: request.source.messageId,
        senderRef: request.source.senderRef,
        senderName: request.source.senderName,
        receivedAt: request.source.receivedAt,
        quarantineReason: quarantine,
        epoch: shipment.currentEpoch,
      });
      if (quarantine) {
        result.quarantined.push({ filename: item.name, versionId, detail: quarantine });
        await scope.event("DOCUMENT_QUARANTINED", { versionId, filename: item.name, reason: quarantine }, request.actor, request.correlationId);
      } else {
        result.accepted.push({ versionId, filename: item.name });
      }
    }

    await scope.event(
      "FILES_RECEIVED",
      {
        intakeId,
        accepted: result.accepted,
        duplicates: result.duplicates.map((d) => d.filename),
        quarantined: result.quarantined.map((q) => q.filename),
        rejected: result.rejected,
        platform: request.source.platform,
        roomId: request.source.roomId,
        messageId: request.source.messageId,
        sender: request.source.senderName,
      },
      request.actor,
      request.correlationId,
    );

    if (result.accepted.length > 0) {
      const next = shipment.state === "RECEIVED" ? "PARSING" : shipment.state === "ERROR_RECOVERABLE" ? "PARSING" : "RECHECKING";
      if (shipment.state !== next && shipment.state !== "PARSING" && shipment.state !== "RECHECKING") {
        shipment = await transitionCase(tx, shipment, next, `${result.accepted.length} file(s) received`, request.actor);
      }
      for (const accepted of result.accepted) {
        scope.enqueue("extract_version", { shipmentId, versionId: accepted.versionId }, `extract:${accepted.versionId}`);
      }
    }

    if (request.replyTo) {
      await scope.say({
        purpose: "intake_ack",
        roomId: request.replyTo.roomId,
        threadId: request.replyTo.threadId ?? request.source.messageId,
        content: {
          kind: "post",
          body: intakeAck(
            shipment,
            result.accepted.map((a) => a.filename),
            result.duplicates.map((d) => d.filename),
            [...result.rejected, ...result.quarantined.map((q) => ({ filename: q.filename, detail: `Held for review: ${q.detail}` }))],
          ),
        },
        dedupeKey: `intake_ack:${intakeId}`,
        visibility: "internal",
      });
    }

    result.shipment = shipment;
    return result;
  });
}
