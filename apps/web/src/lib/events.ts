import type { CaseEvent, CaseState, DocType } from "@reissue/contracts";

import { CASE_STATE_LABEL, DOC_TYPE_LABEL, type Tone } from "./format";

type Payload = CaseEvent["payload"];

const str = (p: Payload, key: string): string | null => {
  const value = p[key];
  return typeof value === "string" && value.length ? value : null;
};
const num = (p: Payload, key: string): number | null => {
  const value = p[key];
  return typeof value === "number" ? value : null;
};
const list = (p: Payload, key: string): unknown[] => {
  const value = p[key];
  return Array.isArray(value) ? value : [];
};
const strings = (p: Payload, key: string): string[] => list(p, key).filter((v): v is string => typeof v === "string");

function docLabel(value: string | null): string {
  return value && value in DOC_TYPE_LABEL ? DOC_TYPE_LABEL[value as DocType] : "Document";
}

function stateLabel(value: string | null): string {
  return value && value in CASE_STATE_LABEL ? CASE_STATE_LABEL[value as CaseState] : (value ?? "unknown");
}

function filenames(p: Payload, key: string): string[] {
  return list(p, key).flatMap((item) => {
    if (item && typeof item === "object" && "filename" in item && typeof item.filename === "string") return [item.filename];
    return [];
  });
}

export interface EventDescription {
  title: string;
  detail: string | null;
  tone: Tone;
}

/** Turns an append-only case event into a sentence for the activity timeline. */
export function describeEvent(event: CaseEvent): EventDescription {
  const p = event.payload;
  switch (event.type) {
    case "CASE_CREATED":
      return { title: `Case ${str(p, "caseCode") ?? ""} opened`.trim(), detail: str(p, "platform") ? `via ${str(p, "platform")}` : null, tone: "neutral" };
    case "FILES_RECEIVED": {
      const files = filenames(p, "accepted");
      return { title: `${files.length || "No"} file${files.length === 1 ? "" : "s"} received`, detail: [files.join(", "), str(p, "sender") ? `from ${str(p, "sender")}` : null].filter(Boolean).join(" ") || null, tone: "neutral" };
    }
    case "DUPLICATE_FILE_REUSED":
      return { title: "Duplicate file recognised", detail: str(p, "filename"), tone: "neutral" };
    case "DOCUMENT_QUARANTINED":
      return { title: "File held for review", detail: [str(p, "filename"), str(p, "reason")].filter(Boolean).join(": ") || null, tone: "danger" };
    case "DOCUMENT_CLASSIFIED":
      return { title: `Classified as ${docLabel(str(p, "docType")).toLowerCase()}`, detail: null, tone: "neutral" };
    case "EXTRACTION_STARTED":
      return { title: "Reading started", detail: str(p, "filename"), tone: "neutral" };
    case "EXTRACTION_COMPLETED": {
      const lines = num(p, "lineItems");
      const fields = num(p, "fields");
      const ocr = p.ocr === true;
      return {
        title: `${docLabel(str(p, "docType"))} read${ocr ? " with OCR" : ""}`,
        detail: [str(p, "filename"), lines !== null ? `${lines} lines` : null, fields !== null ? `${fields} fields` : null].filter(Boolean).join(" · ") || null,
        tone: "neutral",
      };
    }
    case "EXTRACTION_FAILED":
      return { title: "Could not read a file", detail: [str(p, "filename"), str(p, "reason")].filter(Boolean).join(": ") || null, tone: "danger" };
    case "RECONCILIATION_COMPLETED": {
      const summary = p.summary && typeof p.summary === "object" ? (p.summary as Payload) : {};
      const checked = num(summary, "checked");
      const mismatch = num(summary, "mismatch") ?? 0;
      const missing = num(summary, "missing") ?? 0;
      const differing = mismatch + missing + (num(summary, "ambiguous") ?? 0) + (num(summary, "notComparable") ?? 0);
      return {
        title: p.ready === true ? "Compared: every required check passes" : `Compared: ${differing} check${differing === 1 ? "" : "s"} differ`,
        detail: [num(p, "epoch") !== null ? `Epoch ${num(p, "epoch")}` : null, checked !== null ? `${checked} checks` : null].filter(Boolean).join(" · ") || null,
        tone: p.ready === true ? "ok" : "warn",
      };
    }
    case "ISSUE_OPENED":
      return { title: `${str(p, "code") ?? "Issue"} opened`, detail: str(p, "title"), tone: "warn" };
    case "ISSUE_RESOLVED":
      return { title: `${str(p, "code") ?? "Issue"} resolved`, detail: str(p, "reason"), tone: "ok" };
    case "ISSUE_REOPENED":
      return { title: `${str(p, "code") ?? "Issue"} reopened`, detail: str(p, "reason"), tone: "danger" };
    case "ISSUE_STATE_CHANGED":
      return { title: `${str(p, "code") ?? "Issue"}: ${(str(p, "to") ?? "").toLowerCase().replaceAll("_", " ")}`, detail: str(p, "reason"), tone: "neutral" };
    case "ISSUE_REASSIGNED":
      return { title: `${str(p, "code") ?? "Issue"} reassigned to ${str(p, "assignee") ?? "a new owner"}`, detail: str(p, "reason"), tone: "accent" };
    case "REVIEW_REQUESTED":
      return { title: `Examiner review requested${str(p, "assignee") ? ` from ${str(p, "assignee")}` : ""}`, detail: strings(p, "issueCodes").join(", ") || null, tone: "accent" };
    case "REVIEW_RECEIVED":
      return { title: str(p, "outcome") === "TIMEOUT" ? "Examiner review timed out" : "Examiner review received", detail: str(p, "note"), tone: "accent" };
    case "SUPPLIER_REQUEST_SENT":
      return { title: "Supplier asked for a corrected document", detail: [strings(p, "issueCodes").join(", "), str(p, "via") ? `via ${str(p, "via")}` : null].filter(Boolean).join(" · ") || null, tone: "accent" };
    case "SUPPLIER_REPLY_RECEIVED":
      return { title: "Supplier replied", detail: str(p, "summary") ?? str(p, "excerpt"), tone: "accent" };
    case "REPLACEMENT_RECEIVED":
      return { title: `Revised ${str(p, "label") ?? "document"} received`, detail: str(p, "sender") ? `from ${str(p, "sender")}` : null, tone: "accent" };
    case "REPLACEMENT_REJECTED":
      return { title: "Replacement did not match the shipment", detail: null, tone: "danger" };
    case "VERSION_SUPERSEDED":
      return { title: `${docLabel(str(p, "docType"))} v${num(p, "previousVersionNo") ?? "?"} superseded by v${num(p, "versionNo") ?? "?"}`, detail: str(p, "reason"), tone: "neutral" };
    case "STALE_VERSION_KEPT_AS_HISTORY":
      return { title: `Older ${docLabel(str(p, "docType")).toLowerCase()} kept as history`, detail: str(p, "reason"), tone: "neutral" };
    case "HUMAN_CLARIFICATION_RECORDED":
      return { title: "Sourced fact recorded", detail: str(p, "sourceReference"), tone: "accent" };
    case "CASE_CODE_REQUESTED":
      return { title: "Asked which case a file belongs to", detail: null, tone: "neutral" };
    case "REMINDER_SENT":
      return { title: p.skipped === true ? "Reminder skipped" : "Reminder sent", detail: str(p, "reason") ?? str(p, "policy"), tone: "neutral" };
    case "ESCALATED":
      return { title: "Escalated to operations lead", detail: strings(p, "issueCodes").join(", ") || null, tone: "danger" };
    case "PACKET_GENERATED":
      return { title: "Broker packet generated", detail: num(p, "epoch") !== null ? `Epoch ${num(p, "epoch")}` : null, tone: "ok" };
    case "PACKET_SUPERSEDED":
      return { title: "Earlier packet superseded", detail: null, tone: "neutral" };
    case "COMPLETION_POSTED":
      return { title: "Completion posted to chat", detail: null, tone: "ok" };
    case "STATE_CHANGED":
      return { title: `Now ${stateLabel(str(p, "to")).toLowerCase()}`, detail: str(p, "reason"), tone: str(p, "to") === "READY_FOR_BROKER_REVIEW" ? "ok" : "neutral" };
    case "ASSIGNEE_CHANGED":
      return { title: `Assigned to ${str(p, "to") ?? "nobody"}`, detail: str(p, "from") ? `previously ${str(p, "from")}` : null, tone: "neutral" };
    case "RECHECK_REQUESTED":
      return { title: "Recheck requested", detail: null, tone: "accent" };
    case "JOB_FAILED":
      return { title: `Background job failed${str(p, "job") ? `: ${str(p, "job")}` : ""}`, detail: str(p, "error")?.split("\n")[0] ?? null, tone: "danger" };
    case "JOB_RETRIED":
      return { title: "Background job retried", detail: str(p, "job"), tone: "neutral" };
    case "MESSAGE_POSTED":
      return { title: "Message posted to chat", detail: str(p, "purpose")?.replace(/[:_].*$/, "") ?? null, tone: "neutral" };
  }
}

export type LifecycleStepId = "intake" | "detected" | "asked" | "revised" | "rechecked" | "ready";
export type LifecycleStatus = "done" | "current" | "pending" | "skipped";

export interface LifecycleStep {
  id: LifecycleStepId;
  label: string;
  status: LifecycleStatus;
  at: string | null;
  note: string | null;
}

/** Derives the correction loop from the event log, so the strip always matches the timeline. */
export function deriveLifecycle(events: CaseEvent[], state: CaseState): LifecycleStep[] {
  const first = (predicate: (e: CaseEvent) => boolean) => events.find(predicate) ?? null;
  const intake = first((e) => e.type === "FILES_RECEIVED" || e.type === "CASE_CREATED");
  const detected = first((e) => e.type === "ISSUE_OPENED");
  const asked = first((e) => e.type === "SUPPLIER_REQUEST_SENT" || (e.type === "STATE_CHANGED" && e.payload.to === "WAITING_ON_SUPPLIER"));
  const revised = first((e) => e.type === "REPLACEMENT_RECEIVED" || e.type === "HUMAN_CLARIFICATION_RECORDED");
  const reconciliations = events.filter((e) => e.type === "RECONCILIATION_COMPLETED");
  const rechecked = revised ? (reconciliations.find((e) => e.sequence > revised.sequence) ?? null) : null;
  const readyEvent = [...events].reverse().find((e) => e.type === "STATE_CHANGED" && e.payload.to === "READY_FOR_BROKER_REVIEW") ?? null;
  const ready = state === "READY_FOR_BROKER_REVIEW" ? readyEvent : null;
  const settled = state === "READY_FOR_BROKER_REVIEW";
  const needsFact = !asked && (state === "NEEDS_CLARIFICATION" || revised?.type === "HUMAN_CLARIFICATION_RECORDED");
  const revisedLabel = needsFact ? "Fact recorded" : "Revised file";

  const raw: { id: LifecycleStepId; label: string; event: CaseEvent | null; skipNote: string }[] = [
    { id: "intake", label: "Intake", event: intake, skipNote: "" },
    { id: "detected", label: "Difference found", event: detected, skipNote: "No differences" },
    { id: "asked", label: "Supplier asked", event: asked, skipNote: needsFact ? "Fact needed instead" : "Not needed" },
    { id: "revised", label: revisedLabel, event: revised, skipNote: "Not needed" },
    { id: "rechecked", label: "Rechecked", event: rechecked, skipNote: "Not needed" },
    { id: "ready", label: "Ready", event: ready, skipNote: "" },
  ];

  let currentAssigned = false;
  return raw.map((step) => {
    if (step.event) return { id: step.id, label: step.label, status: "done", at: step.event.createdAt, note: null };
    if (settled || (step.id === "asked" && (revised || needsFact))) return { id: step.id, label: step.label, status: "skipped", at: null, note: step.skipNote };
    if (!currentAssigned) {
      currentAssigned = true;
      return { id: step.id, label: step.label, status: "current", at: null, note: null };
    }
    return { id: step.id, label: step.label, status: "pending", at: null, note: null };
  });
}
