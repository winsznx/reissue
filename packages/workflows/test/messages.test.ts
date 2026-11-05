import { describe, expect, it } from "vitest";

import type { CheckResult } from "@reissue/contracts";

import type { Issue, Shipment } from "../src/case-log.js";
import { askWhichCase, supplierRequest } from "../src/messages.js";

const shipment = { caseCode: "SHP-0241", invoiceReference: "LUM-2026-0417", purchaseOrder: "NHG-PO-88213" } as Shipment;
const side = (docType: "COMMERCIAL_INVOICE" | "PACKING_LIST", value: string): CheckResult["lhs"] => ({
  versionId: "v",
  docType,
  ref: "line:2.quantity",
  raw: `${value} PCS`,
  value,
  unit: "pcs",
  source: { page: 1, bbox: [0, 0, 1, 1], quote: `LL-STR-050 LED string lights 3.80 1,900.00 ${value}`, parser: "pdf_table", confidence: 1 },
});
const check: CheckResult = {
  key: "line:LLSTR050.quantity",
  rule: "quantity_equal_with_unit_normalization",
  status: "MISMATCH",
  required: true,
  label: "Quantity · SKU LL-STR-050",
  lhs: side("COMMERCIAL_INVOICE", "500"),
  rhs: side("PACKING_LIST", "480"),
  detail: "Invoice 500 pcs vs packing list 480 pcs.",
  evidence: {},
};
const issue = { code: "D-001", kind: "QUANTITY_MISMATCH", checkKeys: [check.key], requestedDocType: null } as unknown as Issue;

describe("supplierRequest", () => {
  const text = supplierRequest(shipment, [issue], new Map([[check.key, check]]), null);

  it("states both values, the case code and the pages", () => {
    expect(text).toContain("correction requested for SHP-0241");
    expect(text).toContain("invoice says 500 pcs; packing list says 480 pcs");
    expect(text).toContain("Reference: invoice p. 1 / packing list p. 1");
  });

  it("does not assume which document is wrong when the cause is unknown", () => {
    expect(text).toContain("Whichever document is outdated");
  });

  it("never carries prices, quoted source rows or links", () => {
    expect(text).not.toMatch(/3\.80|1,900|http/);
  });
});

describe("askWhichCase", () => {
  it("lists every candidate", () => expect(askWhichCase(["SHP-0241", "SHP-0242"])).toContain("SHP-0241 or SHP-0242"));
});
