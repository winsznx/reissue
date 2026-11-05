import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  ActorRef,
  CaseState,
  CheckResult,
  ConversionFactor,
  DocType,
  DocumentState,
  ExtractedField,
  FieldPath,
  IssueKind,
  IssueState,
  LineMappingOverride,
  LineMatch,
  PageInfo,
  ResponsibleRole,
  Severity,
  SourceSpan,
  Unit,
} from "@reissue/contracts";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const tenantId = () =>
  text("tenant_id")
    .notNull()
    .references(() => tenants.id);

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  settings: jsonb("settings_json").$type<TenantSettings>().notNull().default(sql`'{}'::jsonb`),
  caseSequence: integer("case_sequence").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export interface ReminderPolicy {
  firstReminderMinutes: number;
  repeatIntervalMinutes: number;
  maxReminders: number;
  escalationAfterMinutes: number;
  quietHours: { start: string; end: string } | null;
  timezone: string;
}

export interface TenantSettings {
  reminderPolicy?: ReminderPolicy;
  fileRetentionDays?: number;
  caseReferenceRule?: "invoice_then_po" | "po_then_invoice";
  extractionProvider?: string;
  defaultConversions?: ConversionFactor[];
  roleAssignments?: Partial<Record<ResponsibleRole, string>>;
}

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: tenantId(),
    userRef: text("user_ref").notNull(),
    role: text("role").$type<"admin" | "coordinator" | "viewer">().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("memberships_tenant_user").on(t.tenantId, t.userRef)],
);

export const suppliers = pgTable("suppliers", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  reminderPolicy: jsonb("reminder_policy").$type<ReminderPolicy | null>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    tenantId: tenantId(),
    personDisplay: text("person_display").notNull(),
    switchParticipantId: text("switch_participant_id"),
    switchName: text("switch_name"),
    platform: text("platform").notNull(),
    allowedRole: text("allowed_role").$type<"supplier" | "coordinator" | "ops_lead" | "warehouse">().notNull(),
    supplierId: text("supplier_id").references(() => suppliers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_participant").on(t.switchParticipantId)],
);

export const roomBindings = pgTable(
  "room_bindings",
  {
    id: id(),
    tenantId: tenantId(),
    switchRoomId: text("switch_room_id").notNull(),
    platform: text("platform").notNull(),
    intent: text("intent").$type<"OPERATIONS" | "SUPPLIER" | "VERIFICATION">().notNull(),
    label: text("label").notNull(),
    supplierId: text("supplier_id").references(() => suppliers.id),
    canReceiveSensitive: boolean("can_receive_sensitive").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("room_bindings_room").on(t.switchRoomId)],
);

export const shipments = pgTable(
  "shipments",
  {
    id: id(),
    tenantId: tenantId(),
    caseCode: text("case_code").notNull(),
    supplierId: text("supplier_id").references(() => suppliers.id),
    supplierName: text("supplier_name"),
    consignee: text("consignee"),
    invoiceReference: text("invoice_reference"),
    purchaseOrder: text("purchase_order"),
    state: text("state").$type<CaseState>().notNull(),
    currentEpoch: integer("current_epoch").notNull().default(1),
    assignedTo: text("assigned_to"),
    conversions: jsonb("conversions").$type<ConversionFactor[]>().notNull().default(sql`'[]'::jsonb`),
    mappingOverrides: jsonb("mapping_overrides").$type<LineMappingOverride[]>().notNull().default(sql`'[]'::jsonb`),
    lastMatches: jsonb("last_matches").$type<LineMatch[]>().notNull().default(sql`'[]'::jsonb`),
    opsRoomId: text("ops_room_id"),
    opsThreadId: text("ops_thread_id"),
    supplierRoomId: text("supplier_room_id"),
    supplierThreadId: text("supplier_thread_id"),
    pausedReason: text("paused_reason"),
    /** Optimistic lock for concurrent replies and rechecks. */
    lockVersion: integer("lock_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("shipments_tenant_code").on(t.tenantId, t.caseCode),
    index("shipments_state").on(t.tenantId, t.state),
    index("shipments_refs").on(t.tenantId, t.invoiceReference, t.purchaseOrder),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    docType: text("doc_type").$type<DocType>().notNull(),
    logicalDocumentKey: text("logical_document_key").notNull(),
    currentVersionId: text("current_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("documents_shipment_key").on(t.shipmentId, t.logicalDocumentKey)],
);

/** A stored file exactly as received. Many document versions may reference one blob (e.g. a combined PDF). */
export const blobs = pgTable("blobs", {
  sha256: text("sha256").primaryKey(),
  objectKey: text("object_key").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  createdAt: createdAt(),
});

export const documentVersions = pgTable(
  "document_versions",
  {
    id: id(),
    documentId: text("document_id").references(() => documents.id),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    intakeId: text("intake_id"),
    versionNo: integer("version_no"),
    state: text("state").$type<DocumentState>().notNull(),
    sha256: text("sha256")
      .notNull()
      .references(() => blobs.sha256),
    originalFilename: text("original_filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sourcePlatform: text("source_platform").notNull(),
    sourceRoomId: text("source_room_id"),
    sourceMessageId: text("source_message_id"),
    senderRef: text("sender_ref"),
    senderName: text("sender_name"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    supersedesVersionId: text("supersedes_version_id"),
    /** Part of a multi-document file: 1-based first page inside the blob. */
    pageStart: integer("page_start").notNull().default(1),
    pageEnd: integer("page_end"),
    revisionLabel: text("revision_label"),
    documentDate: text("document_date"),
    classificationConfidence: real("classification_confidence"),
    classificationSignals: jsonb("classification_signals").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    missingFields: jsonb("missing_fields").$type<FieldPath[]>().notNull().default(sql`'[]'::jsonb`),
    quarantineReason: text("quarantine_reason"),
    failureReason: text("failure_reason"),
    epoch: integer("epoch").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("versions_shipment").on(t.shipmentId), index("versions_sha").on(t.shipmentId, t.sha256)],
);

export const documentPages = pgTable(
  "document_pages",
  {
    id: id(),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id),
    pageNo: integer("page_no").notNull(),
    info: jsonb("info").$type<PageInfo>().notNull(),
  },
  (t) => [uniqueIndex("pages_version_page").on(t.versionId, t.pageNo)],
);

export const extractedFields = pgTable(
  "extracted_fields",
  {
    id: id(),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id),
    fieldPath: text("field_path").$type<FieldPath>().notNull(),
    normalizedValue: text("normalized_value").notNull(),
    unit: text("unit").$type<Unit>(),
    rawText: text("raw_text").notNull(),
    pageNo: integer("page_no").notNull(),
    source: jsonb("source").$type<SourceSpan>().notNull(),
    parser: text("parser").notNull(),
    confidence: real("confidence").notNull(),
  },
  (t) => [index("fields_version").on(t.versionId)],
);

export const lineItems = pgTable(
  "line_items",
  {
    id: id(),
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersions.id),
    rowIndex: integer("row_index").notNull(),
    sku: text("sku"),
    description: text("description").notNull(),
    quantity: text("quantity"),
    unit: text("unit").$type<Unit>(),
    quantityRaw: text("quantity_raw"),
    packages: text("packages"),
    packageUnit: text("package_unit").$type<Unit>(),
    packagesRaw: text("packages_raw"),
    unitPrice: text("unit_price"),
    extendedTotal: text("extended_total"),
    netWeight: text("net_weight"),
    netWeightUnit: text("net_weight_unit").$type<Unit>(),
    grossWeight: text("gross_weight"),
    grossWeightUnit: text("gross_weight_unit").$type<Unit>(),
    cbm: text("cbm"),
    piecesPerPackage: text("pieces_per_package"),
    pageNo: integer("page_no").notNull(),
    source: jsonb("source").$type<SourceSpan>().notNull(),
  },
  (t) => [uniqueIndex("lines_version_row").on(t.versionId, t.rowIndex)],
);

export const lineMatches = pgTable(
  "line_matches",
  {
    id: id(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    epoch: integer("epoch").notNull(),
    invoiceLineId: text("invoice_line_id"),
    packingLineId: text("packing_line_id"),
    method: text("method").notNull(),
    confidence: real("confidence").notNull(),
    reviewerConfirmation: text("reviewer_confirmation"),
  },
  (t) => [index("matches_shipment_epoch").on(t.shipmentId, t.epoch)],
);

export const checks = pgTable(
  "checks",
  {
    id: id(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    caseEpoch: integer("case_epoch").notNull(),
    validationRunId: text("validation_run_id").notNull(),
    fieldKey: text("field_key").notNull(),
    lhsFieldRef: text("lhs_field_ref"),
    rhsFieldRef: text("rhs_field_ref"),
    status: text("status").notNull(),
    ruleId: text("rule_id").notNull(),
    required: boolean("required").notNull(),
    result: jsonb("evidence_json").$type<CheckResult>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("checks_run").on(t.validationRunId), index("checks_shipment_epoch").on(t.shipmentId, t.caseEpoch)],
);

export const issues = pgTable(
  "issues",
  {
    id: id(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    code: text("code").notNull(),
    rootCauseKey: text("root_cause_key").notNull(),
    kind: text("kind").$type<IssueKind>().notNull(),
    status: text("status").$type<IssueState>().notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    responsibleRole: text("responsible_role").$type<ResponsibleRole>().notNull(),
    assignee: text("assignee"),
    title: text("title").notNull(),
    checkKeys: jsonb("check_ids").$type<string[]>().notNull(),
    requestedDocType: text("requested_doc_type").$type<DocType>(),
    needsHumanFact: boolean("needs_human_fact").notNull(),
    openedEpoch: integer("opened_epoch").notNull(),
    resolvedEpoch: integer("resolved_epoch"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("issues_shipment_root").on(t.shipmentId, t.rootCauseKey), uniqueIndex("issues_code").on(t.shipmentId, t.code)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    issueIds: jsonb("issue_ids").$type<string[]>().notNull(),
    kind: text("kind").$type<"DOCUMENT_REVIEW" | "SUPPLIER_REQUEST" | "HUMAN_CLARIFICATION">().notNull(),
    assignee: text("assignee").notNull(),
    requestedAction: text("requested_action").notNull(),
    status: text("status").$type<"PENDING" | "SENT" | "ANSWERED" | "COMPLETED" | "CANCELLED" | "FAILED">().notNull(),
    epoch: integer("epoch").notNull(),
    switchRoomId: text("switch_room_id"),
    switchMessageId: text("switch_message_id"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_shipment").on(t.shipmentId)],
);

export const supplierMessages = pgTable(
  "supplier_messages",
  {
    id: id(),
    shipmentId: text("shipment_id").references(() => shipments.id),
    switchRoomId: text("switch_room_id").notNull(),
    threadId: text("thread_id"),
    messageId: text("message_id").notNull(),
    sender: text("sender").notNull(),
    senderName: text("sender_name").notNull(),
    body: text("body").notNull(),
    classification: text("classification").notNull(),
    statedValue: text("stated_value"),
    relatedIssueIds: jsonb("related_issue_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    attachmentCount: integer("attachment_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("supplier_messages_message").on(t.messageId)],
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    actor: jsonb("actor_ref").$type<ActorRef>().notNull(),
    correlationId: text("correlation_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("events_shipment_seq").on(t.shipmentId, t.sequence)],
);

export const switchEvents = pgTable(
  "switch_events",
  {
    id: id(),
    agentId: text("agent_id").notNull(),
    connectionKey: text("connection_key").notNull(),
    switchEventSequence: bigint("switch_event_sequence", { mode: "number" }),
    messageId: text("message_id"),
    roomId: text("room_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"RECEIVED" | "QUEUED" | "PROCESSED" | "IGNORED" | "FAILED">().notNull(),
    detail: text("detail"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("switch_events_dedupe").on(t.dedupeKey)],
);

/** Durable stream cursor per agent connection, so restarts resume rather than re-read. */
export const switchCursors = pgTable("switch_cursors", {
  connectionKey: text("connection_key").primaryKey(),
  agentId: text("agent_id").notNull(),
  connectionId: text("connection_id").notNull(),
  roomId: text("room_id").notNull(),
  cursor: bigint("cursor", { mode: "number" }),
  generation: integer("generation"),
  serverVersion: text("server_version"),
  state: text("state").notNull(),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
});

export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: id(),
    shipmentId: text("shipment_id").references(() => shipments.id),
    purpose: text("purpose").notNull(),
    targetRoomId: text("target_room_id").notNull(),
    threadId: text("thread_id"),
    content: jsonb("content_json").$type<OutboxContent>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    state: text("state").$type<"PENDING" | "SENDING" | "SENT" | "FAILED" | "CANCELLED">().notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    switchEventId: text("switch_event_id"),
    visibility: text("visibility").$type<"internal" | "supplier">().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("outbox_dedupe").on(t.dedupeKey), index("outbox_state").on(t.state)],
);

export type OutboxContent =
  | { kind: "post"; body: string }
  | { kind: "targeted"; body: string; targetNames: string[] }
  | { kind: "media"; caption: string; artifactIds: string[] };

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    shipmentId: text("shipment_id").references(() => shipments.id),
    jobType: text("job_type").notNull(),
    queueJobId: text("queue_job_id"),
    attempts: integer("attempts").notNull().default(0),
    status: text("status").$type<"QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD">().notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    lastError: text("last_error"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("jobs_idempotency").on(t.idempotencyKey), index("jobs_status").on(t.status)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: id(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    caseEpoch: integer("case_epoch").notNull(),
    type: text("type").$type<"PACKET_ZIP" | "CORRECTION_SUMMARY_PDF" | "DOCUMENT_INDEX_CSV">().notNull(),
    filename: text("filename").notNull(),
    objectKey: text("object_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    superseded: boolean("superseded").notNull().default(false),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("artifacts_epoch_type").on(t.shipmentId, t.caseEpoch, t.type)],
);

export const validationRuns = pgTable(
  "validation_runs",
  {
    id: id(),
    shipmentId: text("shipment_id")
      .notNull()
      .references(() => shipments.id),
    inputEpoch: integer("input_epoch").notNull(),
    inputVersionIds: jsonb("input_version_ids").$type<string[]>().notNull(),
    testedFields: integer("tested_fields").notNull(),
    results: jsonb("results_json").$type<Record<string, unknown>>().notNull(),
    modelId: text("model_id"),
    timings: jsonb("timings").$type<Record<string, number>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("validation_runs_shipment").on(t.shipmentId)],
);

export const downloadTokens = pgTable("download_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  artifactId: text("artifact_id")
    .notNull()
    .references(() => artifacts.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  issuedTo: text("issued_to").notNull(),
  createdAt: createdAt(),
});

export const scenarioRuns = pgTable("scenario_runs", {
  id: id(),
  scenarioId: text("scenario_id").notNull(),
  shipmentId: text("shipment_id").references(() => shipments.id),
  status: text("status").$type<"RUNNING" | "PASSED" | "FAILED">().notNull(),
  expected: jsonb("expected").$type<Record<string, unknown>>().notNull(),
  observed: jsonb("observed").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  timings: jsonb("timings").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

