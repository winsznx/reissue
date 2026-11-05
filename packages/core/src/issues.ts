import type { CheckResult, DocType, IssueDraft, IssueKind, ResponsibleRole } from "@reissue/contracts";

interface Classified {
  kind: IssueKind;
  role: ResponsibleRole;
  requestedDocType: DocType | null;
  needsHumanFact: boolean;
  /** Distinguishes root causes of the same kind that need different asks. */
  scope: string;
}

function classify(c: CheckResult): Classified | null {
  if (!c.required || c.status === "MATCH") return null;
  const invoiceOnly = c.lhs?.docType === "COMMERCIAL_INVOICE" && c.rhs === null;
  const packingOnly = c.lhs?.docType === "PACKING_LIST" && c.rhs === null;
  const onlySide = c.lhs ?? c.rhs;

  switch (c.rule) {
    case "quantity_equal_with_unit_normalization":
      if (c.status === "NOT_COMPARABLE") {
        return { kind: "UNIT_NOT_COMPARABLE", role: "SUPPLIER", requestedDocType: null, needsHumanFact: true, scope: "units" };
      }
      if (c.status === "MISSING") {
        return { kind: "MISSING_FIELD", role: "SUPPLIER", requestedDocType: null, needsHumanFact: false, scope: "line-quantity" };
      }
      return { kind: "QUANTITY_MISMATCH", role: "SUPPLIER", requestedDocType: null, needsHumanFact: false, scope: "quantity" };
    case "gross_weight_equal_where_declared_on_both":
    case "net_weight_equal_where_declared_on_both":
      return { kind: "WEIGHT_MISMATCH", role: "SUPPLIER", requestedDocType: null, needsHumanFact: false, scope: "weight" };
    case "package_count_consistency":
      return {
        kind: "PACKAGE_MISMATCH",
        role: "SUPPLIER",
        requestedDocType: packingOnly ? "PACKING_LIST" : null,
        needsHumanFact: false,
        scope: packingOnly ? "packing-internal" : "packages",
      };
    case "part_no_and_description_mapping":
      if (c.status === "AMBIGUOUS") {
        return { kind: "AMBIGUOUS_MAPPING", role: "COORDINATOR", requestedDocType: null, needsHumanFact: true, scope: "mapping" };
      }
      return { kind: "LINE_UNMATCHED", role: "SUPPLIER", requestedDocType: null, needsHumanFact: false, scope: "lines" };
    case "po_and_invoice_reference_consistency":
      return { kind: "REFERENCE_MISMATCH", role: "SUPPLIER", requestedDocType: null, needsHumanFact: false, scope: "references" };
    case "party_name_consistency":
      return { kind: "PARTY_MISMATCH", role: "SUPPLIER", requestedDocType: null, needsHumanFact: false, scope: "parties" };
    case "line_total_arithmetic":
    case "invoice_grand_total_arithmetic":
      return {
        kind: "ARITHMETIC_ERROR",
        role: "SUPPLIER",
        requestedDocType: "COMMERCIAL_INVOICE",
        needsHumanFact: false,
        scope: "invoice-arithmetic",
      };
    case "missing_required_document_field":
      return {
        kind: "MISSING_FIELD",
        role: "SUPPLIER",
        requestedDocType: onlySide?.docType ?? null,
        needsHumanFact: false,
        scope: `fields:${onlySide?.docType ?? "unknown"}`,
      };
    case "replacement_document_identity_and_version":
    case "document_date_and_revision_order":
      return {
        kind: "REFERENCE_MISMATCH",
        role: "OPERATIONS_LEAD",
        requestedDocType: invoiceOnly ? "COMMERCIAL_INVOICE" : packingOnly ? "PACKING_LIST" : null,
        needsHumanFact: true,
        scope: "versions",
      };
  }
}

const TITLES: Record<IssueKind, (n: number, labels: string[]) => string> = {
  QUANTITY_MISMATCH: (n, l) => (n === 1 ? `Quantity mismatch — ${l[0]?.replace(/^Quantity · /, "")}` : `Quantity mismatch on ${n} lines`),
  WEIGHT_MISMATCH: (n, l) => (n === 1 ? `Weight mismatch — ${l[0]}` : `Weight mismatch on ${n} values`),
  PACKAGE_MISMATCH: (n) => (n === 1 ? "Package count mismatch" : `Package count mismatch on ${n} values`),
  LINE_UNMATCHED: (n) => (n === 1 ? "Line item present on only one document" : `${n} line items present on only one document`),
  REFERENCE_MISMATCH: (_, l) => `Reference mismatch — ${l.join(", ")}`,
  PARTY_MISMATCH: (_, l) => `Party name mismatch — ${l.join(", ")}`,
  ARITHMETIC_ERROR: (n) => (n === 1 ? "Invoice arithmetic does not add up" : `Invoice arithmetic errors on ${n} values`),
  MISSING_FIELD: (_, l) => `Missing required field — ${l.map((x) => x.replace(/^Missing /, "")).join(", ")}`,
  UNIT_NOT_COMPARABLE: (n) => (n === 1 ? "Quantity units not comparable without pack size" : `${n} lines need a pack size to compare`),
  AMBIGUOUS_MAPPING: (n) => (n === 1 ? "Line mapping needs confirmation" : `${n} line mappings need confirmation`),
  MISSING_DOCUMENT: (_, l) => `Missing document — ${l.join(", ")}`,
};

/**
 * Groups failing required checks into root causes so one cause yields one coherent ask.
 * Keys are stable across epochs: the same unresolved cause keeps the same issue.
 */
export function groupIssues(checks: readonly CheckResult[]): IssueDraft[] {
  const groups = new Map<string, { cls: Classified; checks: CheckResult[] }>();
  for (const c of checks) {
    const cls = classify(c);
    if (!cls) continue;
    const rootCauseKey = `${cls.kind}:${cls.scope}`;
    const group = groups.get(rootCauseKey) ?? { cls, checks: [] };
    group.checks.push(c);
    groups.set(rootCauseKey, group);
  }
  return [...groups.entries()]
    .map(([rootCauseKey, { cls, checks: grouped }]) => ({
      rootCauseKey,
      kind: cls.kind,
      severity: "BLOCKING" as const,
      responsibleRole: cls.role,
      title: TITLES[cls.kind](grouped.length, grouped.map((c) => c.label)),
      checkKeys: grouped.map((c) => c.key),
      requestedDocType: cls.requestedDocType,
      needsHumanFact: cls.needsHumanFact,
    }))
    .sort((a, b) => a.rootCauseKey.localeCompare(b.rootCauseKey));
}

export function missingDocumentIssue(missing: readonly DocType[]): IssueDraft | null {
  if (missing.length === 0) return null;
  return {
    rootCauseKey: "MISSING_DOCUMENT:documents",
    kind: "MISSING_DOCUMENT",
    severity: "BLOCKING",
    responsibleRole: "SUPPLIER",
    title: TITLES.MISSING_DOCUMENT(missing.length, missing.map((d) => (d === "COMMERCIAL_INVOICE" ? "commercial invoice" : "packing list"))),
    checkKeys: missing.map((d) => `document:${d}`),
    requestedDocType: missing.length === 1 ? (missing[0] ?? null) : null,
    needsHumanFact: false,
  };
}
