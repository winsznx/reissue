import { normalizePartyName, normalizeReference } from "./text.js";

export interface VersionMeta {
  revision: string | null;
  documentDate: string | null;
  receivedAt: string;
}

export type SupersedeDecision =
  | { decision: "SUPERSEDES"; reason: string }
  | { decision: "STALE"; reason: string };

function revisionNumber(revision: string | null): number | null {
  if (!revision) return null;
  const match = /(\d+)/.exec(revision);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

/**
 * Decides whether an incoming version replaces the current one. A revision marker or document
 * date that is older than the current version's keeps the current version; arrival order alone
 * is used only when the documents carry neither.
 */
export function decideSupersede(current: VersionMeta, incoming: VersionMeta): SupersedeDecision {
  const curRev = revisionNumber(current.revision);
  const newRev = revisionNumber(incoming.revision);
  if (curRev !== null && newRev !== null && curRev !== newRev) {
    return newRev > curRev
      ? { decision: "SUPERSEDES", reason: `Revision ${newRev} follows revision ${curRev}.` }
      : { decision: "STALE", reason: `Revision ${newRev} is older than current revision ${curRev}.` };
  }
  if (current.documentDate && incoming.documentDate && current.documentDate !== incoming.documentDate) {
    return incoming.documentDate > current.documentDate
      ? { decision: "SUPERSEDES", reason: `Dated ${incoming.documentDate}, after ${current.documentDate}.` }
      : { decision: "STALE", reason: `Dated ${incoming.documentDate}, before current ${current.documentDate}.` };
  }
  if (curRev !== null && newRev === null) {
    return { decision: "STALE", reason: `Has no revision marker while the current version is revision ${curRev}.` };
  }
  if (newRev !== null && curRev === null) {
    return { decision: "SUPERSEDES", reason: `Revision ${newRev} replaces an unrevised original.` };
  }
  return { decision: "SUPERSEDES", reason: "Received after the current version; no revision or date ordering on the documents." };
}

export interface ShipmentRefs {
  invoiceReference: string | null;
  purchaseOrder: string | null;
  supplierName: string | null;
  consignee: string | null;
}

export interface IdentityCheck {
  ok: boolean;
  conflicts: string[];
  matchedOn: string[];
}

/** A replacement must carry the shipment's own references; any contradicting reference quarantines it. */
export function checkReplacementIdentity(shipment: ShipmentRefs, incoming: ShipmentRefs): IdentityCheck {
  const conflicts: string[] = [];
  const matchedOn: string[] = [];
  const compare = (label: string, a: string | null, b: string | null, norm: (s: string) => string): void => {
    if (!a || !b) return;
    if (norm(a) === norm(b)) matchedOn.push(label);
    else conflicts.push(`${label}: shipment ${a}, document ${b}`);
  };
  compare("invoice reference", shipment.invoiceReference, incoming.invoiceReference, normalizeReference);
  compare("purchase order", shipment.purchaseOrder, incoming.purchaseOrder, normalizeReference);
  compare("supplier", shipment.supplierName, incoming.supplierName, normalizePartyName);
  return { ok: conflicts.length === 0 && matchedOn.length > 0, conflicts, matchedOn };
}

/**
 * Scores how strongly an intake belongs to an existing shipment. References dominate;
 * party names only corroborate. Filenames are never considered.
 */
export function shipmentMatchScore(shipment: ShipmentRefs, incoming: ShipmentRefs): number {
  let score = 0;
  const eqRef = (a: string | null, b: string | null): boolean | null =>
    a && b ? normalizeReference(a) === normalizeReference(b) : null;
  const eqParty = (a: string | null, b: string | null): boolean | null =>
    a && b ? normalizePartyName(a) === normalizePartyName(b) : null;
  const inv = eqRef(shipment.invoiceReference, incoming.invoiceReference);
  const po = eqRef(shipment.purchaseOrder, incoming.purchaseOrder);
  if (inv === false || po === false) return 0;
  if (inv) score += 0.6;
  if (po) score += 0.3;
  if (eqParty(shipment.supplierName, incoming.supplierName)) score += 0.05;
  if (eqParty(shipment.consignee, incoming.consignee)) score += 0.05;
  return score;
}

const CASE_CODE_TEXT = /\bSHP-\d{3,6}\b/gi;

export function findCaseCodes(text: string): string[] {
  return [...new Set((text.match(CASE_CODE_TEXT) ?? []).map((c) => c.toUpperCase()))];
}

export function formatCaseCode(sequence: number): string {
  return `SHP-${String(sequence).padStart(4, "0")}`;
}

/** Stable dedupe key for any outbound request: case + issue set + document epoch + recipient + action. */
export function outboundDedupeKey(parts: {
  caseId: string;
  issueIds: readonly string[];
  epoch: number;
  recipient: string;
  action: string;
}): string {
  return [parts.caseId, [...parts.issueIds].sort().join(","), `e${parts.epoch}`, parts.recipient, parts.action].join("|");
}
