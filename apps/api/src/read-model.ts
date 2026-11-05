import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import type {
  ArtifactDto,
  CaseDetailDto,
  CaseEvent,
  CaseListQuery,
  CaseState,
  CaseSummaryDto,
  ChatLink,
  CheckResult,
  DocumentDto,
  IssueDto,
  LineItemDto,
  TaskDto,
} from "@reissue/contracts";
import { isIssueOpen, toKg } from "@reissue/core";
import { schema, type Database } from "@reissue/db";

type ShipmentRow = typeof schema.shipments.$inferSelect;

const TAB_STATES: Record<CaseListQuery["tab"], CaseState[] | null> = {
  all: null,
  needs_correction: ["NEEDS_CLARIFICATION", "RECONCILING", "ERROR_RECOVERABLE"],
  waiting_on_supplier: ["WAITING_ON_SUPPLIER"],
  rechecking: ["RECHECKING", "PARSING", "RECEIVED"],
  ready: ["READY_FOR_BROKER_REVIEW"],
};

/** "What happens next" in the case's own words, derived from state and open issues. */
export function nextAction(shipment: ShipmentRow, openIssues: { responsibleRole: string; needsHumanFact: boolean }[]): string {
  switch (shipment.state) {
    case "RECEIVED":
    case "PARSING":
      return "Reissue is reading the documents";
    case "RECONCILING":
    case "RECHECKING":
      return "Reissue is comparing the current documents";
    case "WAITING_ON_SUPPLIER":
      return "Supplier owes a corrected document";
    case "NEEDS_CLARIFICATION":
      return openIssues.some((i) => i.responsibleRole === "COORDINATOR")
        ? "Coordinator to confirm a mapping or sourced fact"
        : "A sourced fact is needed (e.g. pack size)";
    case "READY_FOR_BROKER_REVIEW":
      return "Send the current packet to the broker";
    case "ERROR_RECOVERABLE":
      return shipment.pausedReason ?? "Processing paused — retry after fixing the cause";
    case "CANCELLED":
      return "Cancelled";
  }
}

export async function listCases(db: Database, tenantId: string, query: CaseListQuery): Promise<CaseSummaryDto[]> {
  const filters: SQL[] = [eq(schema.shipments.tenantId, tenantId)];
  const states = TAB_STATES[query.tab];
  if (states) filters.push(inArray(schema.shipments.state, states));
  if (query.q) {
    const like = `%${query.q.replace(/[%_]/g, "")}%`;
    filters.push(
      or(
        ilike(schema.shipments.caseCode, like),
        ilike(schema.shipments.invoiceReference, like),
        ilike(schema.shipments.purchaseOrder, like),
        ilike(schema.shipments.supplierName, like),
      )!,
    );
  }
  const order = {
    updated_desc: desc(schema.shipments.updatedAt),
    updated_asc: asc(schema.shipments.updatedAt),
    created_desc: desc(schema.shipments.createdAt),
    code_asc: asc(schema.shipments.caseCode),
  }[query.sort];
  const rows = await db.select().from(schema.shipments).where(and(...filters)).orderBy(order).limit(200);
  if (!rows.length) return [];
  const issues = await db
    .select({ shipmentId: schema.issues.shipmentId, status: schema.issues.status, responsibleRole: schema.issues.responsibleRole, needsHumanFact: schema.issues.needsHumanFact })
    .from(schema.issues)
    .where(inArray(schema.issues.shipmentId, rows.map((r) => r.id)));
  return rows.map((r) => {
    const open = issues.filter((i) => i.shipmentId === r.id && isIssueOpen(i.status));
    return summary(r, open);
  });
}

function summary(r: ShipmentRow, open: { responsibleRole: string; needsHumanFact: boolean }[]): CaseSummaryDto {
  return {
    id: r.id,
    caseCode: r.caseCode,
    state: r.state,
    epoch: r.currentEpoch,
    supplierName: r.supplierName,
    invoiceReference: r.invoiceReference,
    purchaseOrder: r.purchaseOrder,
    assignedTo: r.assignedTo,
    nextAction: nextAction(r, open),
    openIssueCount: open.length,
    updatedAt: r.updatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function findShipment(db: Database, tenantId: string, codeOrId: string): Promise<ShipmentRow | null> {
  const [row] = await db
    .select()
    .from(schema.shipments)
    .where(and(eq(schema.shipments.tenantId, tenantId), or(eq(schema.shipments.caseCode, codeOrId.toUpperCase()), eq(schema.shipments.id, codeOrId))));
  return row ?? null;
}

function kg(value: string | null, unit: string | null): string | null {
  if (value === null) return null;
  return toKg(value, (unit ?? "kg") as "kg")?.toString() ?? null;
}

export async function documentsFor(db: Database, shipmentId: string): Promise<DocumentDto[]> {
  const docs = await db.select().from(schema.documents).where(eq(schema.documents.shipmentId, shipmentId));
  const versions = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, shipmentId)).orderBy(asc(schema.documentVersions.receivedAt));
  const pages = versions.length
    ? await db.select().from(schema.documentPages).where(inArray(schema.documentPages.versionId, versions.map((v) => v.id)))
    : [];
  const toDto = (v: (typeof versions)[number], current: boolean) => ({
    id: v.id,
    documentId: v.documentId ?? "",
    versionNo: v.versionNo ?? 0,
    state: v.state,
    sha256: v.sha256,
    originalFilename: v.originalFilename,
    mime: v.mime,
    sizeBytes: v.sizeBytes,
    sourcePlatform: v.sourcePlatform,
    sourceMessageId: v.sourceMessageId,
    senderRef: v.senderName ?? v.senderRef,
    receivedAt: v.receivedAt.toISOString(),
    supersedesVersionId: v.supersedesVersionId,
    revisionLabel: v.revisionLabel,
    documentDate: v.documentDate,
    pageOffset: v.pageStart - 1,
    pages: pages.filter((p) => p.versionId === v.id).sort((a, b) => a.pageNo - b.pageNo).map((p) => p.info),
    isCurrent: current,
  });
  const out: DocumentDto[] = docs.map((d) => ({
    id: d.id,
    docType: d.docType,
    logicalKey: d.logicalDocumentKey,
    currentVersionId: d.currentVersionId,
    versions: versions.filter((v) => v.documentId === d.id).map((v) => toDto(v, v.id === d.currentVersionId)),
  }));
  const unassigned = versions.filter((v) => !v.documentId);
  if (unassigned.length) {
    out.push({ id: "unassigned", docType: "UNKNOWN", logicalKey: "UNASSIGNED", currentVersionId: null, versions: unassigned.map((v) => toDto(v, false)) });
  }
  return out;
}

function issueDto(i: typeof schema.issues.$inferSelect): IssueDto {
  return {
    id: i.id,
    code: i.code,
    kind: i.kind,
    status: i.status,
    severity: i.severity,
    responsibleRole: i.responsibleRole,
    assignee: i.assignee,
    title: i.title,
    requestedDocType: i.requestedDocType,
    needsHumanFact: i.needsHumanFact,
    checkKeys: i.checkKeys,
    openedEpoch: i.openedEpoch,
    resolvedEpoch: i.resolvedEpoch,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export async function latestChecks(db: Database, shipmentId: string): Promise<CheckResult[]> {
  const [run] = await db
    .select({ id: schema.validationRuns.id })
    .from(schema.validationRuns)
    .where(eq(schema.validationRuns.shipmentId, shipmentId))
    .orderBy(desc(schema.validationRuns.createdAt))
    .limit(1);
  if (!run) return [];
  const rows = await db.select().from(schema.checks).where(eq(schema.checks.validationRunId, run.id));
  return rows.map((r) => r.result);
}

export async function caseDetail(db: Database, shipment: ShipmentRow, roomLabels: Map<string, string>): Promise<CaseDetailDto> {
  const [documents, issueRows, checks, taskRows, artifactRows, messageEvents] = await Promise.all([
    documentsFor(db, shipment.id),
    db.select().from(schema.issues).where(eq(schema.issues.shipmentId, shipment.id)).orderBy(asc(schema.issues.code)),
    latestChecks(db, shipment.id),
    db.select().from(schema.tasks).where(eq(schema.tasks.shipmentId, shipment.id)).orderBy(desc(schema.tasks.createdAt)),
    db.select().from(schema.artifacts).where(eq(schema.artifacts.shipmentId, shipment.id)).orderBy(desc(schema.artifacts.generatedAt)),
    db
      .select({ payload: schema.caseEvents.payload })
      .from(schema.caseEvents)
      .where(and(eq(schema.caseEvents.shipmentId, shipment.id), eq(schema.caseEvents.eventType, "MESSAGE_POSTED")))
      .orderBy(asc(schema.caseEvents.sequence)),
  ]);
  const currentIds = documents.flatMap((d) => (d.currentVersionId ? [d.currentVersionId] : []));
  const allVersionIds = documents.flatMap((d) => d.versions.map((v) => v.id));
  const lineRows = allVersionIds.length ? await db.select().from(schema.lineItems).where(inArray(schema.lineItems.versionId, allVersionIds)) : [];
  const lineItems: LineItemDto[] = lineRows
    .sort((a, b) => a.versionId.localeCompare(b.versionId) || a.rowIndex - b.rowIndex)
    .map((l) => ({
      id: l.id,
      versionId: l.versionId,
      rowIndex: l.rowIndex,
      sku: l.sku,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      packages: l.packages,
      packageUnit: l.packageUnit,
      unitPrice: l.unitPrice,
      amount: l.extendedTotal,
      netWeightKg: kg(l.netWeight, l.netWeightUnit),
      grossWeightKg: kg(l.grossWeight, l.grossWeightUnit),
      page: l.pageNo,
      bbox: l.source.bbox,
    }));
  const openIssues = issueRows.filter((i) => isIssueOpen(i.status));
  const required = checks.filter((c) => c.required);

  const chatLinks: ChatLink[] = [];
  if (shipment.opsRoomId) {
    chatLinks.push({ platform: roomLabels.get(`${shipment.opsRoomId}:platform`) ?? "switch", roomId: shipment.opsRoomId, messageId: shipment.opsThreadId, threadId: shipment.opsThreadId, label: roomLabels.get(shipment.opsRoomId) ?? "Operations room" });
  }
  if (shipment.supplierRoomId) {
    chatLinks.push({ platform: roomLabels.get(`${shipment.supplierRoomId}:platform`) ?? "switch", roomId: shipment.supplierRoomId, messageId: shipment.supplierThreadId, threadId: shipment.supplierThreadId, label: roomLabels.get(shipment.supplierRoomId) ?? "Supplier room" });
  }
  for (const e of messageEvents.slice(-6)) {
    const p = e.payload as { roomId?: string; eventId?: string; threadId?: string | null; purpose?: string };
    if (p.roomId && p.eventId) {
      chatLinks.push({ platform: roomLabels.get(`${p.roomId}:platform`) ?? "switch", roomId: p.roomId, messageId: p.eventId, threadId: p.threadId ?? null, label: (p.purpose ?? "message").replace(/[:_].*$/, "").replace(/^\w/, (c) => c.toUpperCase()) });
    }
  }

  return {
    ...summary(shipment, openIssues),
    documents,
    issues: issueRows.map(issueDto),
    checks,
    matches: shipment.lastMatches,
    lineItems: lineItems.filter((l) => currentIds.includes(l.versionId) || allVersionIds.includes(l.versionId)),
    tasks: taskRows.map(
      (t): TaskDto => ({
        id: t.id,
        issueIds: t.issueIds,
        kind: t.kind,
        assignee: t.assignee,
        status: t.status,
        switchRoomId: t.switchRoomId,
        switchMessageId: t.switchMessageId,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }),
    ),
    artifacts: artifactRows.map(
      (a): ArtifactDto => ({
        id: a.id,
        epoch: a.caseEpoch,
        type: a.type,
        filename: a.filename,
        sha256: a.sha256,
        sizeBytes: a.sizeBytes,
        superseded: a.superseded,
        generatedAt: a.generatedAt.toISOString(),
      }),
    ),
    chatLinks,
    checksSummary: { total: required.length, passing: required.filter((c) => c.status === "MATCH").length },
  };
}

export async function caseEvents(db: Database, shipmentId: string, afterSequence = 0): Promise<CaseEvent[]> {
  const rows = await db
    .select()
    .from(schema.caseEvents)
    .where(and(eq(schema.caseEvents.shipmentId, shipmentId), sql`${schema.caseEvents.sequence} > ${afterSequence}`))
    .orderBy(asc(schema.caseEvents.sequence))
    .limit(1000);
  return rows.map((e) => ({
    id: String(e.id),
    caseId: e.shipmentId,
    sequence: e.sequence,
    type: e.eventType as CaseEvent["type"],
    payload: e.payload,
    actor: e.actor,
    correlationId: e.correlationId,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function roomLabelMap(db: Database, tenantId: string): Promise<Map<string, string>> {
  const rows = await db.select().from(schema.roomBindings).where(eq(schema.roomBindings.tenantId, tenantId));
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.switchRoomId, r.label);
    map.set(`${r.switchRoomId}:platform`, r.platform);
  }
  return map;
}
