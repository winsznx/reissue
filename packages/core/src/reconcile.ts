import type { CheckResult, DocType, ReconciliationOutcome } from "@reissue/contracts";

import { documentChecks, invoiceArithmeticChecks, lineChecks, missingFieldChecks, packingInternalChecks } from "./checks.js";
import type { ReconcileInput } from "./facts.js";
import { groupIssues, missingDocumentIssue } from "./issues.js";
import { alignLineItems } from "./matching.js";

function documentPresenceCheck(docType: DocType): CheckResult {
  const name = docType === "COMMERCIAL_INVOICE" ? "commercial invoice" : "packing list";
  return {
    key: `document:${docType}`,
    rule: "missing_required_document_field",
    status: "MISSING",
    required: true,
    label: `Document · ${name}`,
    lhs: null,
    rhs: null,
    detail: `No ${name} has been received for this shipment.`,
    evidence: {},
  };
}

/**
 * Deterministic reconciliation of the current invoice and packing list.
 * Pure function: same facts, conversions and overrides always give the same outcome.
 */
export function reconcile(input: ReconcileInput): ReconciliationOutcome {
  const { invoice, packingList } = input;
  const checks: CheckResult[] = [];
  const missingDocs: DocType[] = [];
  if (!invoice) missingDocs.push("COMMERCIAL_INVOICE");
  if (!packingList) missingDocs.push("PACKING_LIST");
  checks.push(...missingDocs.map(documentPresenceCheck));

  let matches: ReconciliationOutcome["matches"] = [];
  if (invoice) {
    checks.push(...missingFieldChecks(invoice), ...invoiceArithmeticChecks(invoice));
  }
  if (packingList) {
    checks.push(...missingFieldChecks(packingList), ...packingInternalChecks(packingList));
  }
  if (invoice && packingList) {
    const pairs = alignLineItems(invoice.lineItems, packingList.lineItems, input.mappingOverrides);
    matches = pairs.map((p) => p.match);
    checks.push(...lineChecks(pairs, invoice, packingList, input.conversions), ...documentChecks(invoice, packingList));
  }

  const docIssue = missingDocumentIssue(missingDocs);
  const issues = groupIssues(checks.filter((c) => !c.key.startsWith("document:")));
  if (docIssue) issues.unshift(docIssue);

  const count = (status: CheckResult["status"]): number => checks.filter((c) => c.status === status).length;
  return {
    checks,
    matches,
    issues,
    ready: issues.length === 0 && missingDocs.length === 0,
    summary: {
      checked: checks.length,
      match: count("MATCH"),
      mismatch: count("MISMATCH"),
      missing: count("MISSING"),
      ambiguous: count("AMBIGUOUS"),
      notComparable: count("NOT_COMPARABLE"),
    },
  };
}
