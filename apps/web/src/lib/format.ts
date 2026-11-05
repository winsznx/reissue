import type { CaseState, CheckStatus, DocType, IssueState, ResponsibleRole, Unit } from "@reissue/contracts";

export type Tone = "neutral" | "accent" | "warn" | "ok" | "danger";

export const CASE_STATE_LABEL: Record<CaseState, string> = {
  RECEIVED: "Received",
  PARSING: "Reading documents",
  RECONCILING: "Comparing",
  NEEDS_CLARIFICATION: "Needs a sourced fact",
  WAITING_ON_SUPPLIER: "Waiting on supplier",
  RECHECKING: "Rechecking",
  READY_FOR_BROKER_REVIEW: "Ready for broker review",
  ERROR_RECOVERABLE: "Paused",
  CANCELLED: "Cancelled",
};

export const CASE_STATE_TONE: Record<CaseState, Tone> = {
  RECEIVED: "accent",
  PARSING: "accent",
  RECONCILING: "accent",
  NEEDS_CLARIFICATION: "warn",
  WAITING_ON_SUPPLIER: "warn",
  RECHECKING: "accent",
  READY_FOR_BROKER_REVIEW: "ok",
  ERROR_RECOVERABLE: "danger",
  CANCELLED: "neutral",
};

export const ISSUE_STATE_LABEL: Record<IssueState, string> = {
  OPEN: "Open",
  OWNER_ASSIGNED: "Owner assigned",
  REQUEST_SENT: "Request sent",
  ANSWER_RECEIVED: "Answer received",
  REPLACEMENT_RECEIVED: "Replacement received",
  RECHECKING: "Rechecking",
  RESOLVED: "Resolved",
  REOPENED: "Reopened",
  ESCALATED: "Escalated",
};

export function issueTone(status: IssueState): Tone {
  if (status === "RESOLVED") return "ok";
  if (status === "ESCALATED" || status === "REOPENED") return "danger";
  if (status === "RECHECKING" || status === "REPLACEMENT_RECEIVED") return "accent";
  return "warn";
}

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  MATCH: "Match",
  MISMATCH: "Mismatch",
  MISSING: "Missing",
  AMBIGUOUS: "Ambiguous",
  NOT_COMPARABLE: "Not comparable",
};

export const CHECK_STATUS_TONE: Record<CheckStatus, Tone> = {
  MATCH: "ok",
  MISMATCH: "warn",
  MISSING: "danger",
  AMBIGUOUS: "warn",
  NOT_COMPARABLE: "neutral",
};

export const CHECK_STATUS_ORDER: CheckStatus[] = ["MISMATCH", "MISSING", "AMBIGUOUS", "NOT_COMPARABLE", "MATCH"];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  COMMERCIAL_INVOICE: "Commercial invoice",
  PACKING_LIST: "Packing list",
  BILL_OF_LADING: "Bill of lading",
  AIR_WAYBILL: "Air waybill",
  PURCHASE_ORDER: "Purchase order",
  CORRECTION_NOTE: "Correction note",
  UNKNOWN: "Unclassified file",
};

export const ROLE_LABEL: Record<ResponsibleRole, string> = {
  SUPPLIER: "Supplier",
  WAREHOUSE: "Warehouse",
  OPERATIONS_LEAD: "Operations lead",
  COORDINATOR: "Coordinator",
};

export const UNIT_LABEL: Record<Unit, string> = {
  pcs: "pcs",
  carton: "cartons",
  kg: "kg",
  g: "g",
  lb: "lb",
  pallet: "pallets",
  set: "sets",
  pair: "pairs",
  m: "m",
  unknown: "unit unknown",
};

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeOnly = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const formatDate = (iso: string): string => dateOnly.format(new Date(iso));
export const formatTime = (iso: string): string => timeOnly.format(new Date(iso));

export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const shortSha = (sha: string): string => `${sha.slice(0, 8)}…${sha.slice(-4)}`;

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function formatQuantity(value: string | null, unit: Unit | null): string {
  if (value === null) return "—";
  const [whole = "", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const number = fraction ? `${grouped}.${fraction}` : grouped;
  return unit && unit !== "unknown" ? `${number} ${UNIT_LABEL[unit]}` : number;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}
