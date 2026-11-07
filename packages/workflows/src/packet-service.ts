import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  buildCorrectionSummaryPdf,
  buildDocumentIndexCsv,
  buildPacketZip,
  verifyPacket,
  type IndexRow,
  type PacketDocument,
  type SummaryResolution,
} from "@reissue/artifacts";
import type { CheckResult, DocType } from "@reissue/contracts";
import { newId, schema, type Database, type Executor } from "@reissue/db";

import { docLabel, readyMessage } from "./messages.js";
import { primaryRoom } from "./rooms.js";
import { withCase, type Services } from "./services.js";
import { artifactKey, blobKey } from "./storage.js";

const DOC_ORDER: DocType[] = ["COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "AIR_WAYBILL", "PURCHASE_ORDER", "CORRECTION_NOTE"];
export const DOWNLOAD_TTL_MS = 24 * 3600 * 1000;

function describeSide(c: CheckResult | undefined): string {
  if (!c) return "not recorded";
  if (c.lhs && c.rhs) {
    const fmt = (s: NonNullable<CheckResult["lhs"]>) =>
      `${s.value ?? "?"}${s.unit && s.unit !== "unknown" ? ` ${s.unit}` : ""}${s.source ? ` (p. ${s.source.page})` : ""}`;
    return `invoice ${fmt(c.lhs)}, packing list ${fmt(c.rhs)}`;
  }
  return c.detail;
}

export async function issueDownloadToken(db: Executor, artifactId: string, issuedTo: string, ttlMs = DOWNLOAD_TTL_MS): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(schema.downloadTokens).values({ tokenHash: createHash("sha256").update(token).digest("hex"), artifactId, expiresAt, issuedTo });
  return { token, expiresAt };
}

/**
 * Builds the broker packet for a READY epoch from the current supplier-issued files, verifies
 * the ZIP against the stored hashes, records artifacts and posts the completion message.
 */
export async function generatePacket(svc: Services, shipmentId: string, epoch: number): Promise<void> {
  const [shipment] = await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (!shipment || shipment.currentEpoch !== epoch || shipment.state !== "READY_FOR_BROKER_REVIEW") return;
  const existing = await svc.db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.shipmentId, shipmentId), eq(schema.artifacts.caseEpoch, epoch)));
  if (existing.length >= 3) return;

  const documents = await svc.db.select().from(schema.documents).where(eq(schema.documents.shipmentId, shipmentId));
  const versions = await svc.db
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.shipmentId, shipmentId))
    .orderBy(asc(schema.documentVersions.receivedAt));
  const current = documents
    .filter((d) => d.currentVersionId)
    .map((d) => ({ doc: d, version: versions.find((v) => v.id === d.currentVersionId)! }))
    .filter((x) => x.version)
    .sort((a, b) => DOC_ORDER.indexOf(a.doc.docType) - DOC_ORDER.indexOf(b.doc.docType));

  const bySha = new Map<string, { types: DocType[]; version: (typeof current)[number]["version"] }>();
  for (const { doc, version } of current) {
    const entry = bySha.get(version.sha256) ?? { types: [], version };
    entry.types.push(doc.docType);
    bySha.set(version.sha256, entry);
  }
  const packetDocs: PacketDocument[] = [];
  let order = 1;
  for (const [sha, { types, version }] of bySha) {
    packetDocs.push({
      order: order++,
      docType: types.join("-AND-"),
      versionId: version.id,
      versionNo: version.versionNo ?? 1,
      originalFilename: version.originalFilename,
      mime: version.mime,
      sha256: sha,
      receivedAt: version.receivedAt.toISOString(),
      sourcePlatform: version.sourcePlatform,
      senderName: version.senderName,
      bytes: await svc.store.get(blobKey(sha)),
    });
  }

  const issues = await svc.db.select().from(schema.issues).where(eq(schema.issues.shipmentId, shipmentId));
  const resolved = issues.filter((i) => i.status === "RESOLVED");
  const allChecks = await svc.db.select().from(schema.checks).where(eq(schema.checks.shipmentId, shipmentId)).orderBy(asc(schema.checks.createdAt));
  const firstCheck = (key: string, atEpoch: number) => allChecks.find((c) => c.fieldKey === key && c.caseEpoch === atEpoch)?.result;
  const lastCheck = (key: string) => [...allChecks].reverse().find((c) => c.fieldKey === key && c.caseEpoch === epoch)?.result;
  const replacements = versions.filter((v) => v.supersedesVersionId && v.state !== "QUARANTINED" && current.some((c) => c.version.id === v.id));
  const clarifications = await svc.db
    .select()
    .from(schema.caseEvents)
    .where(and(eq(schema.caseEvents.shipmentId, shipmentId), eq(schema.caseEvents.eventType, "HUMAN_CLARIFICATION_RECORDED")));

  const resolutions: SummaryResolution[] = resolved.map((issue) => {
    const key = issue.checkKeys[0] ?? "";
    const after = lastCheck(key);
    const replacement = replacements.find((v) => (v.epoch ?? 0) <= (issue.resolvedEpoch ?? epoch));
    return {
      code: issue.code,
      title: issue.title,
      before: describeSide(firstCheck(key, issue.openedEpoch)),
      after: after ? describeSide(after) : "value no longer in conflict",
      resolvedBy: replacement
        ? `${docLabel(documents.find((d) => d.id === replacement.documentId)?.docType ?? "UNKNOWN")} v${replacement.versionNo} from ${replacement.senderName ?? "supplier"} via ${replacement.sourcePlatform}`
        : clarifications.length
          ? `Sourced clarification: ${String(clarifications.at(-1)?.payload.sourceReference ?? "recorded")}`
          : `Recheck at epoch ${issue.resolvedEpoch ?? epoch}`,
    };
  });

  const latestRun = allChecks.filter((c) => c.caseEpoch === epoch);
  const latestRunId = latestRun.at(-1)?.validationRunId;
  const checkedFields = latestRun.filter((c) => c.validationRunId === latestRunId).length;
  const generatedAt = new Date().toISOString();
  const docTypeOf = (versionId: string): DocType => documents.find((d) => d.id === versions.find((v) => v.id === versionId)?.documentId)?.docType ?? "UNKNOWN";
  const currentIds = new Set(current.map((c) => c.version.id));
  const historical = versions.filter((v) => v.documentId && v.versionNo);

  const summaryPdf = await buildCorrectionSummaryPdf({
    caseCode: shipment.caseCode,
    epoch,
    generatedAt,
    supplierName: shipment.supplierName,
    invoiceReference: shipment.invoiceReference,
    purchaseOrder: shipment.purchaseOrder,
    checkedFields,
    documents: historical.map((v) => ({
      label: docLabel(docTypeOf(v.id)).replace(/^./, (c) => c.toUpperCase()),
      version: `v${v.versionNo}`,
      filename: v.originalFilename,
      status: currentIds.has(v.id) ? "current" : "superseded",
      receivedAt: v.receivedAt.toISOString(),
      source: `${v.sourcePlatform}${v.senderName ? ` · ${v.senderName}` : ""}`,
      sha256: v.sha256,
    })),
    resolutions,
    replacements: replacements.map((v) => ({
      document: `${docLabel(docTypeOf(v.id))} v${v.versionNo}`,
      providedBy: v.senderName ?? "unknown sender",
      via: v.sourcePlatform,
      receivedAt: v.receivedAt.toISOString(),
    })),
    remainingNotes: issues.filter((i) => i.status !== "RESOLVED" && i.severity !== "BLOCKING").map((i) => `${i.code} ${i.title}`),
  });

  const indexRows: IndexRow[] = [
    ...packetDocs.map((d) => ({
      packetName: "",
      docType: d.docType,
      versionNo: d.versionNo,
      versionId: d.versionId,
      originalFilename: d.originalFilename,
      sourcePlatform: d.sourcePlatform,
      sender: d.senderName ?? "",
      receivedAt: d.receivedAt,
      status: "current" as const,
      sha256: d.sha256,
    })),
    ...historical
      .filter((v) => !currentIds.has(v.id))
      .map((v) => ({
        packetName: "(not in packet)",
        docType: docTypeOf(v.id),
        versionNo: v.versionNo ?? 0,
        versionId: v.id,
        originalFilename: v.originalFilename,
        sourcePlatform: v.sourcePlatform,
        sender: v.senderName ?? "",
        receivedAt: v.receivedAt.toISOString(),
        status: "superseded" as const,
        sha256: v.sha256,
      })),
  ];
  const draft = await buildPacketZip(shipment.caseCode, packetDocs, []);
  for (const row of indexRows) if (!row.packetName) row.packetName = draft.entries.find((e) => e.sha256 === row.sha256)?.name ?? "";
  const indexCsv = buildDocumentIndexCsv(indexRows);
  const packet = await buildPacketZip(shipment.caseCode, packetDocs, [
    { name: "correction-summary.pdf", bytes: summaryPdf },
    { name: "document-index.csv", bytes: indexCsv },
  ]);
  const verification = await verifyPacket(packet.bytes, packet.entries);
  if (!verification.ok) throw new Error(`Packet verification failed: ${verification.problems.join("; ")}`);

  const files = [
    { type: "PACKET_ZIP" as const, filename: packet.filename, bytes: packet.bytes, mime: "application/zip" },
    { type: "CORRECTION_SUMMARY_PDF" as const, filename: "correction-summary.pdf", bytes: summaryPdf, mime: "application/pdf" },
    { type: "DOCUMENT_INDEX_CSV" as const, filename: "document-index.csv", bytes: indexCsv, mime: "text/csv" },
  ];
  const stored: { id: string; type: string; filename: string; sha256: string }[] = [];
  for (const f of files) {
    const sha = createHash("sha256").update(f.bytes).digest("hex");
    const key = artifactKey(shipmentId, epoch, sha, f.filename);
    await svc.store.putImmutable(key, f.bytes, f.mime, sha);
    stored.push({ id: newId("art"), type: f.type, filename: f.filename, sha256: sha });
  }

  await withCase(svc, shipmentId, async (scope) => {
    if (scope.shipment.currentEpoch !== epoch || scope.shipment.state !== "READY_FOR_BROKER_REVIEW") return;
    const inserted = await scope.tx
      .insert(schema.artifacts)
      .values(
        files.map((f, i) => ({
          id: stored[i]!.id,
          shipmentId,
          caseEpoch: epoch,
          type: f.type,
          filename: f.filename,
          objectKey: artifactKey(shipmentId, epoch, stored[i]!.sha256, f.filename),
          sha256: stored[i]!.sha256,
          sizeBytes: f.bytes.length,
          manifest: f.type === "PACKET_ZIP" ? { entries: packet.entries, versionIds: packetDocs.map((d) => d.versionId) } : {},
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.artifacts.id });
    if (inserted.length === 0) return;
    const zipArtifact = stored[0]!;
    await scope.event("PACKET_GENERATED", {
      epoch,
      artifacts: stored,
      entries: packet.entries,
      versionIds: packetDocs.map((d) => d.versionId),
      verified: true,
    });

    const ops = scope.shipment.opsRoomId
      ? { roomId: scope.shipment.opsRoomId, threadId: scope.shipment.opsThreadId }
      : await primaryRoom(svc.db, svc.config, scope.shipment.tenantId, "OPERATIONS").then((r) => (r ? { roomId: r.switchRoomId, threadId: null } : null));
    const { token } = await issueDownloadToken(scope.tx, zipArtifact.id, "ops-room");
    const downloadUrl = `${svc.config.API_BASE_URL.replace(/\/+$/, "")}/v1/artifacts/${zipArtifact.id}/download?token=${token}`;
    const lastReplacement = replacements.at(-1);
    if (ops) {
      await scope.say({
        purpose: "ops_ready",
        roomId: ops.roomId,
        threadId: ops.threadId,
        content: {
          kind: "post",
          body: readyMessage(scope.shipment, {
            receivedNow: lastReplacement ? `${docLabel(docTypeOf(lastReplacement.id)).replace(/^./, (c) => c.toUpperCase())} v${lastReplacement.versionNo}` : null,
            resolvedCount: resolved.length,
            checked: checkedFields,
            files: [...packet.entries.map((e) => e.name)],
            downloadUrl,
            publicUrl: svc.config.REISSUE_PUBLIC_URL,
          }),
        },
        dedupeKey: `ops_ready:${shipmentId}:e${epoch}`,
        visibility: "internal",
      });
      await scope.say({
        purpose: "ops_packet_file",
        roomId: ops.roomId,
        threadId: ops.threadId,
        content: { kind: "media", caption: `${scope.shipment.caseCode} current packet`, artifactIds: [zipArtifact.id] },
        dedupeKey: `ops_packet_file:${shipmentId}:e${epoch}`,
        visibility: "internal",
      });
    }
    if (scope.shipment.supplierRoomId && scope.shipment.supplierThreadId && resolved.length) {
      await scope.say({
        purpose: "supplier_thanks",
        roomId: scope.shipment.supplierRoomId,
        threadId: scope.shipment.supplierThreadId,
        content: { kind: "post", body: `Reissue · ${scope.shipment.caseCode} — thank you. The revised document resolved the discrepancy; no further action is needed.` },
        dedupeKey: `supplier_thanks:${shipmentId}:e${epoch}`,
        visibility: "supplier",
      });
    }
  });
}

export async function packetArtifacts(db: Database, shipmentId: string) {
  return db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.shipmentId, shipmentId), inArray(schema.artifacts.type, ["PACKET_ZIP", "CORRECTION_SUMMARY_PDF", "DOCUMENT_INDEX_CSV"])));
}
