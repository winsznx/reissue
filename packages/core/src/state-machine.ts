import type { CaseState, DocumentState, IssueState } from "@reissue/contracts";

const CASE_TRANSITIONS: Record<CaseState, readonly CaseState[]> = {
  RECEIVED: ["PARSING", "ERROR_RECOVERABLE", "CANCELLED"],
  PARSING: ["RECONCILING", "ERROR_RECOVERABLE", "CANCELLED"],
  RECONCILING: ["NEEDS_CLARIFICATION", "WAITING_ON_SUPPLIER", "READY_FOR_BROKER_REVIEW", "ERROR_RECOVERABLE", "CANCELLED"],
  NEEDS_CLARIFICATION: ["RECHECKING", "WAITING_ON_SUPPLIER", "ERROR_RECOVERABLE", "CANCELLED"],
  WAITING_ON_SUPPLIER: ["RECHECKING", "NEEDS_CLARIFICATION", "ERROR_RECOVERABLE", "CANCELLED"],
  RECHECKING: ["NEEDS_CLARIFICATION", "WAITING_ON_SUPPLIER", "READY_FOR_BROKER_REVIEW", "ERROR_RECOVERABLE", "CANCELLED"],
  READY_FOR_BROKER_REVIEW: ["RECHECKING", "CANCELLED"],
  ERROR_RECOVERABLE: ["PARSING", "RECONCILING", "RECHECKING", "CANCELLED"],
  CANCELLED: [],
};

const ISSUE_TRANSITIONS: Record<IssueState, readonly IssueState[]> = {
  OPEN: ["OWNER_ASSIGNED", "REQUEST_SENT", "RESOLVED", "ESCALATED"],
  OWNER_ASSIGNED: ["REQUEST_SENT", "ANSWER_RECEIVED", "REPLACEMENT_RECEIVED", "RECHECKING", "RESOLVED", "ESCALATED"],
  REQUEST_SENT: ["ANSWER_RECEIVED", "REPLACEMENT_RECEIVED", "RECHECKING", "RESOLVED", "ESCALATED", "OWNER_ASSIGNED"],
  ANSWER_RECEIVED: ["REPLACEMENT_RECEIVED", "RECHECKING", "RESOLVED", "REQUEST_SENT", "ESCALATED", "OWNER_ASSIGNED"],
  REPLACEMENT_RECEIVED: ["RECHECKING", "RESOLVED", "REQUEST_SENT"],
  RECHECKING: ["RESOLVED", "REQUEST_SENT", "OWNER_ASSIGNED", "ESCALATED"],
  RESOLVED: ["REOPENED"],
  REOPENED: ["OWNER_ASSIGNED", "REQUEST_SENT", "RECHECKING", "RESOLVED", "ESCALATED"],
  ESCALATED: ["OWNER_ASSIGNED", "REQUEST_SENT", "ANSWER_RECEIVED", "REPLACEMENT_RECEIVED", "RECHECKING", "RESOLVED"],
};

const DOCUMENT_TRANSITIONS: Record<DocumentState, readonly DocumentState[]> = {
  RECEIVED: ["EXTRACTING", "QUARANTINED"],
  QUARANTINED: ["EXTRACTING"],
  EXTRACTING: ["EXTRACTED", "FAILED", "SUPERSEDED"],
  EXTRACTED: ["SUPERSEDED", "EXTRACTING"],
  FAILED: ["EXTRACTING"],
  SUPERSEDED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: "case" | "issue" | "document",
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${entity} transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransitionCase(from: CaseState, to: CaseState): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

export function assertCaseTransition(from: CaseState, to: CaseState): void {
  if (!canTransitionCase(from, to)) throw new InvalidTransitionError("case", from, to);
}

export function canTransitionIssue(from: IssueState, to: IssueState): boolean {
  return ISSUE_TRANSITIONS[from].includes(to);
}

export function assertIssueTransition(from: IssueState, to: IssueState): void {
  if (!canTransitionIssue(from, to)) throw new InvalidTransitionError("issue", from, to);
}

export function assertDocumentTransition(from: DocumentState, to: DocumentState): void {
  if (!DOCUMENT_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError("document", from, to);
}

export const OPEN_ISSUE_STATES: readonly IssueState[] = [
  "OPEN",
  "OWNER_ASSIGNED",
  "REQUEST_SENT",
  "ANSWER_RECEIVED",
  "REPLACEMENT_RECEIVED",
  "RECHECKING",
  "REOPENED",
  "ESCALATED",
];

export function isIssueOpen(state: IssueState): boolean {
  return OPEN_ISSUE_STATES.includes(state);
}

/**
 * Case state after a reconciliation pass. Only a clean deterministic outcome reaches READY;
 * issues that need a human fact take precedence over supplier asks.
 */
export function stateAfterReconciliation(outcome: { ready: boolean; issues: ReadonlyArray<{ needsHumanFact: boolean; responsibleRole: string }> }): CaseState {
  if (outcome.ready) return "READY_FOR_BROKER_REVIEW";
  const supplierAsk = outcome.issues.some((i) => i.responsibleRole === "SUPPLIER" && !i.needsHumanFact);
  return supplierAsk ? "WAITING_ON_SUPPLIER" : "NEEDS_CLARIFICATION";
}
