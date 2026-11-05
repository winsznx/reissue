import { and, eq, inArray, max, ne, sql } from "drizzle-orm";

import type { DocType, DocumentPart, ExtractedField, ExtractionResult } from "@reissue/contracts";
import { RECONCILED_DOC_TYPES } from "@reissue/contracts";
import { checkReplacementIdentity, decideSupersede } from "@reissue/core";
import { newId, schema, type Transaction } from "@reissue/db";

import { transitionCase, type Shipment } from "./case-log.js";
import { docLabel } from "./messages.js";
import { withCase, type CaseScope, type Services } from "./services.js";
import { blobKey } from "./storage.js";
import { WorkerError } from "./worker-client.js";

type Version = typeof schema.documentVersions.$inferSelect;

const fieldValue = (part: DocumentPart, path: ExtractedField["path"]): string | null =>
  part.fields.find((f) => f.path === path)?.value ?? null;

/** Pulls the bytes, asks the worker what they contain, and records the result under the case lock. */
export async function runExtraction(svc: Services, versionId: string): Promise<void> {
  const [version] = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, versionId));
  if (!version) throw new Error(`Version ${versionId} not found`);
  if (!["RECEIVED", "EXTRACTING", "FAILED"].includes(version.state)) {
    svc.log.info({ versionId, state: version.state }, "extraction already settled; skipping");
    return;
  }

  await withCase(svc, version.shipmentId, async (scope) => {
    if (version.state !== "EXTRACTING") {
      await scope.tx
        .update(schema.documentVersions)
        .set({ state: "EXTRACTING", updatedAt: sql`now()` })
        .where(eq(schema.documentVersions.id, versionId));
      await scope.event("EXTRACTION_STARTED", { versionId, filename: version.originalFilename });
    }
  });

  const bytes = await svc.store.get(blobKey(version.sha256));
  const started = performance.now();
  let result: ExtractionResult;
  try {
    result = await svc.worker.extract(bytes, version.mime, version.originalFilename);
  } catch (error) {
    if (error instanceof WorkerError && error.permanent) {
      await markExtractionFailed(svc, versionId, error.message);
      return;
    }
    throw error;
  }
  const elapsed = Math.round(performance.now() - started);

  await withCase(svc, version.shipmentId, async (scope) => {
    const [fresh] = await scope.tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, versionId));
    if (!fresh || fresh.state !== "EXTRACTING") return;
    await recordParts(scope, fresh, result, elapsed);
    await settleIntakeIfComplete(scope);
  });
}

export async function markExtractionFailed(svc: Services, versionId: string, reason: string): Promise<void> {
  const [version] = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, versionId));
  if (!version) return;
  await withCase(svc, version.shipmentId, async (scope) => {
    await scope.tx
      .update(schema.documentVersions)
      .set({ state: "FAILED", failureReason: reason.slice(0, 1000), updatedAt: sql`now()` })
      .where(eq(schema.documentVersions.id, versionId));
    await scope.event("EXTRACTION_FAILED", { versionId, filename: version.originalFilename, reason });
    const paused = `Could not read ${version.originalFilename}. The file is kept; retry processing once the cause is fixed.`;
    await scope.tx.update(schema.shipments).set({ pausedReason: paused }).where(eq(schema.shipments.id, scope.shipment.id));
    if (scope.shipment.state !== "ERROR_RECOVERABLE" && scope.shipment.state !== "CANCELLED") {
      await transitionCase(scope.tx, scope.shipment, "ERROR_RECOVERABLE", paused);
    }
    if (scope.shipment.opsRoomId) {
      await scope.say({
        purpose: "processing_paused",
        roomId: scope.shipment.opsRoomId,
        threadId: scope.shipment.opsThreadId,
        content: { kind: "post", body: `Reissue · ${scope.shipment.caseCode} — processing paused\n${paused}\nReason: ${reason.slice(0, 200)}` },
        dedupeKey: `paused:${versionId}`,
        visibility: "internal",
      });
    }
  });
}

async function recordParts(scope: CaseScope, version: Version, result: ExtractionResult, elapsedMs: number): Promise<void> {
  const { tx } = scope;
  const parts = result.parts.length ? result.parts : [];
  if (parts.length === 0) {
    await quarantine(scope, version.id, "No readable document content was found.");
    return;
  }

  for (const [index, part] of parts.entries()) {
    const partVersionId = index === 0 ? version.id : newId("ver");
    if (index > 0) {
      await tx.insert(schema.documentVersions).values({
        ...version,
        id: partVersionId,
        state: "EXTRACTING",
        documentId: null,
        versionNo: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await tx
      .update(schema.documentVersions)
      .set({
        pageStart: part.pageStart,
        pageEnd: part.pageEnd,
        classificationConfidence: part.classificationConfidence,
        classificationSignals: part.classificationSignals,
        missingFields: part.missingFields,
        revisionLabel: fieldValue(part, "revision"),
        documentDate: fieldValue(part, "document_date"),
        updatedAt: sql`now()`,
      })
      .where(eq(schema.documentVersions.id, partVersionId));

    for (const page of result.pages.filter((p) => p.page >= part.pageStart && p.page <= part.pageEnd)) {
      await tx.insert(schema.documentPages).values({ id: newId("pg"), versionId: partVersionId, pageNo: page.page, info: page }).onConflictDoNothing();
    }
    if (part.fields.length) {
      await tx.insert(schema.extractedFields).values(
        part.fields.map((f) => ({
          id: newId("fld"),
          versionId: partVersionId,
          fieldPath: f.path,
          normalizedValue: f.value,
          unit: f.unit,
          rawText: f.raw,
          pageNo: f.source.page,
          source: f.source,
          parser: f.source.parser,
          confidence: f.source.confidence,
        })),
      );
    }
    if (part.lineItems.length) {
      await tx.insert(schema.lineItems).values(
        part.lineItems.map((l) => ({
          id: newId("li"),
          versionId: partVersionId,
          rowIndex: l.rowIndex,
          sku: l.sku,
          description: l.description,
          quantity: l.quantity?.value ?? null,
          unit: l.quantity?.unit ?? null,
          quantityRaw: l.quantity?.raw ?? null,
          packages: l.packages?.count ?? null,
          packageUnit: l.packages?.type ?? null,
          packagesRaw: l.packages?.raw ?? null,
          unitPrice: l.unitPrice,
          extendedTotal: l.amount,
          netWeight: l.netWeight?.value ?? null,
          netWeightUnit: l.netWeight?.unit ?? null,
          grossWeight: l.grossWeight?.value ?? null,
          grossWeightUnit: l.grossWeight?.unit ?? null,
          cbm: l.cbm,
          piecesPerPackage: l.piecesPerPackage,
          pageNo: l.source.page,
          source: l.source,
        })),
      );
    }

    await scope.event("EXTRACTION_COMPLETED", {
      versionId: partVersionId,
      filename: version.originalFilename,
      docType: part.docType,
      pages: [part.pageStart, part.pageEnd],
      fields: part.fields.length,
      lineItems: part.lineItems.length,
      missingFields: part.missingFields,
      ocr: result.pages.some((p) => p.ocr && p.page >= part.pageStart && p.page <= part.pageEnd),
      warnings: result.warnings,
      workerVersion: result.workerVersion,
      timingsMs: { ...result.timingsMs, roundTrip: elapsedMs },
    });

    if (part.docType === "UNKNOWN") {
      await quarantine(scope, partVersionId, "Could not identify this file as a shipment document; it is held for review and not used in checks.");
      continue;
    }
    await scope.event("DOCUMENT_CLASSIFIED", {
      versionId: partVersionId,
      docType: part.docType,
      confidence: part.classificationConfidence,
      signals: part.classificationSignals,
      filename: version.originalFilename,
    });
    await assignToDocument(scope, partVersionId, part);
  }
}

async function quarantine(scope: CaseScope, versionId: string, reason: string): Promise<void> {
  await scope.tx
    .update(schema.documentVersions)
    .set({ state: "QUARANTINED", quarantineReason: reason, updatedAt: sql`now()` })
    .where(eq(schema.documentVersions.id, versionId));
  await scope.event("DOCUMENT_QUARANTINED", { versionId, reason });
}

async function refreshShipmentRefs(tx: Transaction, shipment: Shipment, part: DocumentPart): Promise<Shipment> {
  const patch: Partial<Shipment> = {};
  const invoiceRef = fieldValue(part, "invoice_number");
  if (!shipment.invoiceReference && invoiceRef) patch.invoiceReference = invoiceRef;
  const po = fieldValue(part, "purchase_order");
  if (!shipment.purchaseOrder && po) patch.purchaseOrder = po;
  const seller = fieldValue(part, "seller");
  if (!shipment.supplierName && seller) patch.supplierName = seller.split("\n")[0] ?? seller;
  const consignee = fieldValue(part, "consignee") ?? fieldValue(part, "buyer");
  if (!shipment.consignee && consignee) patch.consignee = consignee.split("\n")[0] ?? consignee;
  if (Object.keys(patch).length === 0) return shipment;
  const [updated] = await tx.update(schema.shipments).set({ ...patch, updatedAt: sql`now()` }).where(eq(schema.shipments.id, shipment.id)).returning();
  return updated ?? shipment;
}

/**
 * Places an extracted part into its logical document. A part whose references contradict the
 * shipment is quarantined; an older revision arriving late is kept as history; otherwise it
 * becomes the current version and the case epoch advances if the case was already checked.
 */
async function assignToDocument(scope: CaseScope, versionId: string, part: DocumentPart): Promise<void> {
  const { tx } = scope;
  const shipment = (await tx.select().from(schema.shipments).where(eq(schema.shipments.id, scope.shipment.id)))[0]!;
  const docType: DocType = part.docType;
  const logicalKey = docType;

  const incomingRefs = {
    invoiceReference: fieldValue(part, "invoice_number"),
    purchaseOrder: fieldValue(part, "purchase_order"),
    supplierName: fieldValue(part, "seller"),
    consignee: fieldValue(part, "consignee"),
  };
  const knownRefs = {
    invoiceReference: shipment.invoiceReference,
    purchaseOrder: shipment.purchaseOrder,
    supplierName: shipment.supplierName,
    consignee: shipment.consignee,
  };
  const hasKnownRefs = Boolean(knownRefs.invoiceReference || knownRefs.purchaseOrder);
  if (hasKnownRefs && RECONCILED_DOC_TYPES.includes(docType as (typeof RECONCILED_DOC_TYPES)[number])) {
    const identity = checkReplacementIdentity(knownRefs, incomingRefs);
    if (identity.conflicts.length > 0) {
      await quarantine(scope, versionId, `References do not belong to ${shipment.caseCode}: ${identity.conflicts.join("; ")}.`);
      await scope.event("REPLACEMENT_REJECTED", { versionId, conflicts: identity.conflicts });
      return;
    }
  }

  let [document] = await tx
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.shipmentId, shipment.id), eq(schema.documents.logicalDocumentKey, logicalKey)));
  if (!document) {
    [document] = await tx
      .insert(schema.documents)
      .values({ id: newId("doc"), shipmentId: shipment.id, docType, logicalDocumentKey: logicalKey })
      .returning();
  }
  const [{ maxNo } = { maxNo: 0 }] = await tx
    .select({ maxNo: max(schema.documentVersions.versionNo) })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, document!.id));
  const versionNo = (maxNo ?? 0) + 1;

  const [incoming] = await tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, versionId));
  const current = document!.currentVersionId
    ? (await tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, document!.currentVersionId)))[0]
    : undefined;

  if (current) {
    const decision = decideSupersede(
      { revision: current.revisionLabel, documentDate: current.documentDate, receivedAt: current.receivedAt.toISOString() },
      { revision: incoming!.revisionLabel, documentDate: incoming!.documentDate, receivedAt: incoming!.receivedAt.toISOString() },
    );
    if (decision.decision === "STALE") {
      await tx
        .update(schema.documentVersions)
        .set({ documentId: document!.id, versionNo, state: "SUPERSEDED", updatedAt: sql`now()` })
        .where(eq(schema.documentVersions.id, versionId));
      await scope.event("STALE_VERSION_KEPT_AS_HISTORY", {
        versionId,
        docType,
        versionNo,
        currentVersionId: current.id,
        currentVersionNo: current.versionNo,
        reason: decision.reason,
      });
      const target = incoming!.sourceRoomId === shipment.supplierRoomId ? shipment.supplierRoomId : shipment.opsRoomId;
      if (target) {
        await scope.say({
          purpose: "stale_version_notice",
          roomId: target,
          threadId: target === shipment.supplierRoomId ? shipment.supplierThreadId : shipment.opsThreadId,
          content: {
            kind: "post",
            body: `Reissue · ${shipment.caseCode} — ${incoming!.originalFilename} looks older than the ${docLabel(docType)} v${current.versionNo} already on file (${decision.reason}). Kept v${current.versionNo} as current; the older file is stored as history.`,
          },
          dedupeKey: `stale:${versionId}`,
          visibility: target === shipment.supplierRoomId ? "supplier" : "internal",
        });
      }
      return;
    }
    await tx.update(schema.documentVersions).set({ state: "SUPERSEDED", updatedAt: sql`now()` }).where(eq(schema.documentVersions.id, current.id));
    await scope.event("VERSION_SUPERSEDED", {
      docType,
      previousVersionId: current.id,
      previousVersionNo: current.versionNo,
      versionId,
      versionNo,
      reason: decision.reason,
    });
  }

  await tx
    .update(schema.documentVersions)
    .set({ documentId: document!.id, versionNo, state: "EXTRACTED", supersedesVersionId: current?.id ?? null, updatedAt: sql`now()` })
    .where(eq(schema.documentVersions.id, versionId));
  await tx.update(schema.documents).set({ currentVersionId: versionId, updatedAt: sql`now()` }).where(eq(schema.documents.id, document!.id));

  let updated = await refreshShipmentRefs(tx, shipment, part);
  const [{ runs } = { runs: 0 }] = await tx
    .select({ runs: sql<number>`count(*)::int` })
    .from(schema.validationRuns)
    .where(and(eq(schema.validationRuns.shipmentId, shipment.id), eq(schema.validationRuns.inputEpoch, updated.currentEpoch)));
  if (runs > 0) {
    const [bumped] = await tx
      .update(schema.shipments)
      .set({ currentEpoch: updated.currentEpoch + 1, updatedAt: sql`now()` })
      .where(eq(schema.shipments.id, shipment.id))
      .returning();
    updated = bumped ?? updated;
    const superseded = await tx
      .update(schema.artifacts)
      .set({ superseded: true })
      .where(and(eq(schema.artifacts.shipmentId, shipment.id), eq(schema.artifacts.superseded, false)))
      .returning({ id: schema.artifacts.id });
    if (superseded.length) await scope.event("PACKET_SUPERSEDED", { artifactIds: superseded.map((a) => a.id), newEpoch: updated.currentEpoch });
    await tx.update(schema.documentVersions).set({ epoch: updated.currentEpoch }).where(eq(schema.documentVersions.id, versionId));
  }
  if (current) {
    await scope.event("REPLACEMENT_RECEIVED", {
      versionId,
      docType,
      label: `${docLabel(docType)} v${versionNo}`,
      versionNo,
      supersedes: current.id,
      sender: incoming!.senderName,
      platform: incoming!.sourcePlatform,
      epoch: updated.currentEpoch,
    });
  }
}

/** When every file of the case has settled, run one reconciliation for the resulting epoch. */
export async function settleIntakeIfComplete(scope: CaseScope): Promise<void> {
  const { tx } = scope;
  const pending = await tx
    .select({ id: schema.documentVersions.id })
    .from(schema.documentVersions)
    .where(and(eq(schema.documentVersions.shipmentId, scope.shipment.id), inArray(schema.documentVersions.state, ["RECEIVED", "EXTRACTING"])));
  if (pending.length > 0) return;
  const [shipment] = await tx.select().from(schema.shipments).where(eq(schema.shipments.id, scope.shipment.id));
  const settled = await tx
    .select({ id: schema.documentVersions.id })
    .from(schema.documentVersions)
    .where(and(eq(schema.documentVersions.shipmentId, scope.shipment.id), ne(schema.documentVersions.state, "FAILED")));
  const trigger = settled.map((v) => v.id).sort().join(",");
  scope.enqueue(
    "reconcile",
    { shipmentId: shipment!.id, epoch: shipment!.currentEpoch, reason: "documents settled" },
    `reconcile:${shipment!.id}:e${shipment!.currentEpoch}:${hash(trigger)}`,
  );
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}
