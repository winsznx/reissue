import { z } from "zod";

import { CaseState, DocType, DocumentState, IssueState, ResponsibleRole, Severity, Unit } from "./domain.js";
import { PageInfo } from "./extraction.js";
import { CheckResult, IssueKind, LineMatch } from "./reconciliation.js";

export const ChatLink = z.object({
  platform: z.string(),
  roomId: z.string(),
  messageId: z.string().nullable(),
  threadId: z.string().nullable(),
  label: z.string(),
});
export type ChatLink = z.infer<typeof ChatLink>;

export const CaseSummaryDto = z.object({
  id: z.string(),
  caseCode: z.string(),
  state: CaseState,
  epoch: z.number().int(),
  supplierName: z.string().nullable(),
  invoiceReference: z.string().nullable(),
  purchaseOrder: z.string().nullable(),
  assignedTo: z.string().nullable(),
  nextAction: z.string(),
  openIssueCount: z.number().int(),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type CaseSummaryDto = z.infer<typeof CaseSummaryDto>;

export const CaseListTab = z.enum(["all", "needs_correction", "waiting_on_supplier", "rechecking", "ready"]);
export type CaseListTab = z.infer<typeof CaseListTab>;

export const CaseListQuery = z.object({
  tab: CaseListTab.default("all"),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(["updated_desc", "updated_asc", "created_desc", "code_asc"]).default("updated_desc"),
});
export type CaseListQuery = z.infer<typeof CaseListQuery>;

export const DocumentVersionDto = z.object({
  id: z.string(),
  documentId: z.string(),
  versionNo: z.number().int(),
  state: DocumentState,
  sha256: z.string(),
  originalFilename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  sourcePlatform: z.string(),
  sourceMessageId: z.string().nullable(),
  senderRef: z.string().nullable(),
  receivedAt: z.string(),
  supersedesVersionId: z.string().nullable(),
  revisionLabel: z.string().nullable(),
  documentDate: z.string().nullable(),
  pageOffset: z.number().int(),
  pages: z.array(PageInfo),
  isCurrent: z.boolean(),
});
export type DocumentVersionDto = z.infer<typeof DocumentVersionDto>;

export const DocumentDto = z.object({
  id: z.string(),
  docType: DocType,
  logicalKey: z.string(),
  currentVersionId: z.string().nullable(),
  versions: z.array(DocumentVersionDto),
});
export type DocumentDto = z.infer<typeof DocumentDto>;

export const LineItemDto = z.object({
  id: z.string(),
  versionId: z.string(),
  rowIndex: z.number().int(),
  sku: z.string().nullable(),
  description: z.string(),
  quantity: z.string().nullable(),
  unit: Unit.nullable(),
  packages: z.string().nullable(),
  packageUnit: Unit.nullable(),
  unitPrice: z.string().nullable(),
  amount: z.string().nullable(),
  netWeightKg: z.string().nullable(),
  grossWeightKg: z.string().nullable(),
  page: z.number().int(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});
export type LineItemDto = z.infer<typeof LineItemDto>;

export const IssueDto = z.object({
  id: z.string(),
  code: z.string(),
  kind: IssueKind,
  status: IssueState,
  severity: Severity,
  responsibleRole: ResponsibleRole,
  assignee: z.string().nullable(),
  title: z.string(),
  requestedDocType: DocType.nullable(),
  needsHumanFact: z.boolean(),
  checkKeys: z.array(z.string()),
  openedEpoch: z.number().int(),
  resolvedEpoch: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IssueDto = z.infer<typeof IssueDto>;

export const ArtifactDto = z.object({
  id: z.string(),
  epoch: z.number().int(),
  type: z.enum(["PACKET_ZIP", "CORRECTION_SUMMARY_PDF", "DOCUMENT_INDEX_CSV"]),
  filename: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int(),
  superseded: z.boolean(),
  generatedAt: z.string(),
});
export type ArtifactDto = z.infer<typeof ArtifactDto>;

export const TaskDto = z.object({
  id: z.string(),
  issueIds: z.array(z.string()),
  kind: z.enum(["DOCUMENT_REVIEW", "SUPPLIER_REQUEST", "HUMAN_CLARIFICATION"]),
  assignee: z.string(),
  status: z.enum(["PENDING", "SENT", "ANSWERED", "COMPLETED", "CANCELLED", "FAILED"]),
  switchRoomId: z.string().nullable(),
  switchMessageId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskDto = z.infer<typeof TaskDto>;

export const CaseDetailDto = CaseSummaryDto.extend({
  documents: z.array(DocumentDto),
  issues: z.array(IssueDto),
  checks: z.array(CheckResult),
  matches: z.array(LineMatch),
  lineItems: z.array(LineItemDto),
  tasks: z.array(TaskDto),
  artifacts: z.array(ArtifactDto),
  chatLinks: z.array(ChatLink),
  checksSummary: z.object({ total: z.number().int(), passing: z.number().int() }),
});
export type CaseDetailDto = z.infer<typeof CaseDetailDto>;

export const ClarifyRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("conversion_factor"),
    sku: z.string().min(1),
    fromUnit: Unit,
    toUnit: Unit,
    factor: z.string().regex(/^\d+(\.\d+)?$/),
    sourceReference: z.string().min(3).max(300),
  }),
  z.object({
    kind: z.literal("line_mapping"),
    invoiceRow: z.number().int().nonnegative(),
    packingRow: z.number().int().nonnegative(),
    sourceReference: z.string().min(3).max(300),
  }),
  z.object({
    kind: z.literal("reissued_source"),
    docType: DocType,
    sourceReference: z.string().min(3).max(300),
  }),
  z.object({
    kind: z.literal("confirmed_fact"),
    statement: z.string().min(3).max(600),
    sourceReference: z.string().min(3).max(300),
  }),
]);
export type ClarifyRequest = z.infer<typeof ClarifyRequest>;

export const ReassignRequest = z.object({
  responsibleRole: ResponsibleRole,
  assignee: z.string().min(1).max(120),
  reason: z.string().max(300).optional(),
});
export type ReassignRequest = z.infer<typeof ReassignRequest>;

export const AssignCaseRequest = z.object({ assignee: z.string().min(1).max(120) });
export type AssignCaseRequest = z.infer<typeof AssignCaseRequest>;

export const RoomIntent = z.enum(["OPERATIONS", "SUPPLIER", "VERIFICATION"]);
export type RoomIntent = z.infer<typeof RoomIntent>;

export const RoomBindingDto = z.object({
  id: z.string(),
  switchRoomId: z.string(),
  platform: z.string(),
  intent: RoomIntent,
  label: z.string(),
  supplierId: z.string().nullable(),
  canReceiveSensitive: z.boolean(),
});
export type RoomBindingDto = z.infer<typeof RoomBindingDto>;

export const RoomBindingsPatch = z.object({
  bindings: z
    .array(
      z.object({
        switchRoomId: z.string().min(1),
        platform: z.string().min(1),
        intent: RoomIntent,
        label: z.string().min(1).max(80),
        supplierId: z.string().nullable().default(null),
        canReceiveSensitive: z.boolean(),
      }),
    )
    .max(50),
});
export type RoomBindingsPatch = z.infer<typeof RoomBindingsPatch>;

export const HealthComponent = z.object({ ok: z.boolean(), detail: z.string(), latencyMs: z.number().nullable() });
export const HealthDto = z.object({
  ok: z.boolean(),
  version: z.string(),
  components: z.object({
    database: HealthComponent,
    queue: HealthComponent,
    objectStore: HealthComponent,
    documentWorker: HealthComponent,
    switch: HealthComponent,
    coordinator: HealthComponent,
  }),
});
export type HealthDto = z.infer<typeof HealthDto>;

export const ScenarioId = z.enum([
  "quantity-correction",
  "reordered-lines",
  "scanned-packing-list",
  "stale-replacement",
  "new-mismatch-in-replacement",
  "carton-conversion",
]);
export type ScenarioId = z.infer<typeof ScenarioId>;

export const ScenarioDto = z.object({
  id: ScenarioId,
  title: z.string(),
  description: z.string(),
  controlledModification: z.string(),
  inputs: z.array(z.string()),
  followUps: z.array(z.object({ label: z.string(), file: z.string() })),
  usesSwitch: z.boolean(),
});
export type ScenarioDto = z.infer<typeof ScenarioDto>;

export const VerificationRunDto = z.object({
  id: z.string(),
  scenarioId: z.string(),
  caseId: z.string().nullable(),
  status: z.enum(["RUNNING", "PASSED", "FAILED"]),
  expected: z.record(z.string(), z.unknown()),
  observed: z.record(z.string(), z.unknown()),
  timingsMs: z.record(z.string(), z.number()),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type VerificationRunDto = z.infer<typeof VerificationRunDto>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiError>;
