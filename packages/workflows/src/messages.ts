import type { CheckResult, DocType } from "@reissue/contracts";

import type { Issue, Shipment } from "./case-log.js";

/**
 * Chat copy. Every message follows: what arrived → what differed → who is acting → what changed.
 * Supplier-facing text is built only from supplier-safe facts: case code, field, both stated
 * values and page references. It never carries buyer pricing context, internal notes or links.
 */

const DOC_LABEL: Record<DocType, string> = {
  COMMERCIAL_INVOICE: "invoice",
  PACKING_LIST: "packing list",
  BILL_OF_LADING: "bill of lading",
  AIR_WAYBILL: "air waybill",
  PURCHASE_ORDER: "purchase order",
  CORRECTION_NOTE: "correction note",
  UNKNOWN: "unidentified file",
};

export const docLabel = (type: DocType): string => DOC_LABEL[type];

export function caseUrl(publicUrl: string, shipment: Pick<Shipment, "caseCode">): string {
  return `${publicUrl.replace(/\/+$/, "")}/shipments/${shipment.caseCode}`;
}

function header(shipment: Pick<Shipment, "caseCode">, suffix?: string): string {
  return `Reissue · ${shipment.caseCode}${suffix ? ` — ${suffix}` : ""}`;
}

function value(side: CheckResult["lhs"]): string {
  if (!side) return "not stated";
  if (side.value === null) return "not found";
  const unit = side.unit && side.unit !== "unknown" ? ` ${side.unit}` : "";
  return `${trimDecimal(side.value)}${unit}`;
}

function trimDecimal(v: string): string {
  return /^-?\d+\.\d+$/.test(v) ? v.replace(/\.?0+$/, "") : v;
}

function where(side: CheckResult["lhs"]): string {
  if (!side?.source) return "";
  const row = /^line:(\d+)\./.exec(side.ref);
  return row ? ` (p. ${side.source.page}, row ${Number(row[1]) + 1})` : ` (p. ${side.source.page})`;
}

export function intakeAck(shipment: Shipment, filenames: string[], duplicates: string[], rejected: { filename: string; detail: string }[]): string {
  const lines = [header(shipment), `Received: ${filenames.length ? filenames.join(" + ") : "no new files"}.`];
  if (duplicates.length) lines.push(`Already on this case (same content): ${duplicates.join(", ")}.`);
  for (const r of rejected) lines.push(`Not accepted: ${r.filename}. ${r.detail}`);
  if (filenames.length) lines.push("Comparing shipment references and line items now.");
  return lines.join("\n");
}

export function checkLine(c: CheckResult): string {
  if (c.lhs && c.rhs) {
    return `${c.label}\nInvoice: ${value(c.lhs)}${where(c.lhs)}\nPacking list: ${value(c.rhs)}${where(c.rhs)}`;
  }
  return `${c.label}: ${c.detail}`;
}

export function discrepancySummary(
  shipment: Shipment,
  issues: Issue[],
  checksByKey: Map<string, CheckResult>,
  nextStep: string,
  publicUrl: string,
): string {
  const lines = [header(shipment), `${issues.length} discrepanc${issues.length === 1 ? "y" : "ies"} found.`];
  for (const issue of issues) {
    lines.push("", `${issue.code} · ${issue.title}`);
    for (const key of issue.checkKeys.slice(0, 4)) {
      const c = checksByKey.get(key);
      if (c) lines.push(checkLine(c));
    }
    if (issue.checkKeys.length > 4) lines.push(`…and ${issue.checkKeys.length - 4} more.`);
  }
  lines.push("", nextStep, `Open comparison: ${caseUrl(publicUrl, shipment)}`);
  return lines.join("\n");
}

function supplierAskLine(issue: Issue, checksByKey: Map<string, CheckResult>): string[] {
  const out: string[] = [];
  for (const key of issue.checkKeys.slice(0, 5)) {
    const c = checksByKey.get(key);
    if (!c) continue;
    if (issue.kind === "UNIT_NOT_COMPARABLE") {
      out.push(`${c.label.replace(/^Quantity · /, "")}: invoice states ${value(c.lhs)}, packing list states ${value(c.rhs)}. How many pieces are in one carton?`);
    } else if (c.lhs && c.rhs) {
      out.push(`${c.label}: invoice says ${value(c.lhs)}; packing list says ${value(c.rhs)}.`);
    } else {
      out.push(`${c.label}: ${c.detail}`);
    }
  }
  return out;
}

function referenceLine(issues: Issue[], checksByKey: Map<string, CheckResult>): string {
  const pages = new Set<string>();
  for (const issue of issues) {
    for (const key of issue.checkKeys) {
      const c = checksByKey.get(key);
      if (c?.lhs?.source) pages.add(`${docLabel(c.lhs.docType)} p. ${c.lhs.source.page}`);
      if (c?.rhs?.source) pages.add(`${docLabel(c.rhs.docType)} p. ${c.rhs.source.page}`);
    }
  }
  return pages.size ? `Reference: ${[...pages].join(" / ")}` : "";
}

export function supplierRequest(shipment: Shipment, issues: Issue[], checksByKey: Map<string, CheckResult>, demoLabel: string | null): string {
  const lines = [`Reissue · correction requested for ${shipment.caseCode}`];
  if (shipment.invoiceReference) lines.push(`Invoice ${shipment.invoiceReference}${shipment.purchaseOrder ? ` · PO ${shipment.purchaseOrder}` : ""}`);
  lines.push("Please confirm the correct figures:");
  for (const issue of issues) lines.push(...supplierAskLine(issue, checksByKey).map((l) => `• ${l}`));
  const requested = [...new Set(issues.map((i) => i.requestedDocType).filter((d): d is DocType => d !== null))];
  if (requested.length === 1) {
    lines.push(`Please attach the corrected supplier-issued ${docLabel(requested[0]!)} PDF in this thread.`);
  } else {
    lines.push("Whichever document is outdated, please attach the revised supplier-issued PDF in this thread.");
  }
  const ref = referenceLine(issues, checksByKey);
  if (ref) lines.push(ref);
  if (demoLabel) lines.push(`(${demoLabel}: reminders run on shortened test intervals.)`);
  return lines.join("\n");
}

export function supplierFollowUp(shipment: Shipment, issues: Issue[], checksByKey: Map<string, CheckResult>, received: string): string {
  const lines = [
    `Reissue · ${shipment.caseCode} — still needs a correction`,
    `Thank you for ${received}. We rechecked it against the invoice and these figures still differ:`,
  ];
  for (const issue of issues) lines.push(...supplierAskLine(issue, checksByKey).map((l) => `• ${l}`));
  lines.push("Please confirm which figure is correct and attach the corrected PDF in this thread.");
  return lines.join("\n");
}

export function supplierReminder(shipment: Shipment, issues: Issue[], checksByKey: Map<string, CheckResult>, step: number, demoLabel: string | null): string {
  const lines = [`Reissue · reminder ${step} for ${shipment.caseCode}`, "We are still waiting on a correction for:"];
  for (const issue of issues) lines.push(...supplierAskLine(issue, checksByKey).map((l) => `• ${l}`));
  lines.push("A reply or the revised PDF in this thread is enough.");
  if (demoLabel) lines.push(`(${demoLabel})`);
  return lines.join("\n");
}

export function readyMessage(shipment: Shipment, opts: {
  receivedNow: string | null;
  resolvedCount: number;
  checked: number;
  files: string[];
  downloadUrl: string;
  publicUrl: string;
}): string {
  const lines = [header(shipment, "READY FOR BROKER REVIEW")];
  if (opts.receivedNow) lines.push(`${opts.receivedNow} received and rechecked.`);
  lines.push(
    opts.resolvedCount > 0
      ? `${opts.resolvedCount === 1 ? "Original mismatch" : `${opts.resolvedCount} discrepancies`} resolved. ${opts.checked} checked fields; no unresolved comparable mismatches.`
      : `${opts.checked} checked fields; the documents agree.`,
    `Current packet: ${opts.downloadUrl}`,
    `Document comparison: ${caseUrl(opts.publicUrl, shipment)}`,
    `Files: ${opts.files.join(" + ")}`,
    "Ready for broker review means internal consistency checks passed, not customs acceptance.",
  );
  return lines.join("\n");
}

export function clarificationNeeded(shipment: Shipment, issues: Issue[], checksByKey: Map<string, CheckResult>, publicUrl: string): string {
  const lines = [header(shipment, "needs a fact from someone who knows"), ""];
  for (const issue of issues) {
    lines.push(`${issue.code} · ${issue.title}`);
    for (const key of issue.checkKeys.slice(0, 3)) {
      const c = checksByKey.get(key);
      if (c) lines.push(c.detail);
    }
  }
  lines.push(
    "",
    "Reply in this thread with the sourced fact, for example:",
    "`@reissue 1 carton = 20 pcs for LL-100, source: supplier spec sheet 2026-10-30`",
    `Or resolve it in the Workbench: ${caseUrl(publicUrl, shipment)}`,
  );
  return lines.join("\n");
}

export function askWhichCase(codes: string[]): string {
  return `Reissue · Which shipment is this about? ${codes.join(" or ")}. Please reply with the case code so nothing is attached to the wrong one.`;
}
