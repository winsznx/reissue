import { describe, expect, it } from "vitest";

import { reconcile } from "../src/reconcile.js";
import { doc, fieldOf, line } from "./builders.js";

const invoiceLines = [
  line(0, "LL-100", "LED panel 600x600 40W", "200", "pcs", { unitPrice: "12.50", amount: "2500.00" }),
  line(1, "LL-220", "LED tube T8 1200mm", "1000", "pcs", { unitPrice: "1.80", amount: "1800.00" }),
  line(2, "LL-310", "Track spotlight 20W black", "500", "pcs", { unitPrice: "6.00", amount: "3000.00" }),
];

const base = { conversions: [], mappingOverrides: [] };

describe("reconcile", () => {
  it("catches a 500 vs 480 quantity mismatch with evidence from both sides (E2E-01)", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", invoiceLines),
      packingList: doc("PACKING_LIST", [
        line(0, "LL-100", "LED panel 600x600 40W", "200"),
        line(1, "LL-220", "LED tube T8 1200mm", "1000"),
        line(2, "LL-310", "Track spotlight 20W black", "480"),
      ]),
    });
    const qty = outcome.checks.find((c) => c.key === "line:LL310.quantity");
    expect(qty?.status).toBe("MISMATCH");
    expect(qty?.lhs?.value).toBe("500");
    expect(qty?.rhs?.value).toBe("480");
    expect(qty?.lhs?.source?.page).toBe(1);
    expect(outcome.ready).toBe(false);
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0]).toMatchObject({ kind: "QUANTITY_MISMATCH", responsibleRole: "SUPPLIER", requestedDocType: null });
  });

  it("aligns reordered rows without false mismatches (E2E-05)", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", invoiceLines),
      packingList: doc("PACKING_LIST", [
        line(0, "LL-310", "Track spotlight 20W black", "500"),
        line(1, "LL-100", "LED panel 600x600 40W", "200"),
        line(2, "LL-220", "LED tube T8 1200mm", "1000"),
      ]),
    });
    expect(outcome.ready).toBe(true);
    expect(outcome.summary.mismatch).toBe(0);
    expect(outcome.matches.every((m) => m.method === "sku_exact")).toBe(true);
  });

  it("keeps cartons vs pieces not comparable without a sourced pack size (E2E-07)", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "LL-100", "LED panel", "100")]),
      packingList: doc("PACKING_LIST", [
        line(0, "LL-100", "LED panel", null, "pcs", { packages: { count: "5", type: "carton", raw: "5 CTNS" } }),
      ]),
    });
    const qty = outcome.checks.find((c) => c.rule === "quantity_equal_with_unit_normalization");
    expect(qty?.status).toBe("NOT_COMPARABLE");
    expect(outcome.issues[0]).toMatchObject({ kind: "UNIT_NOT_COMPARABLE", needsHumanFact: true });
    expect(outcome.summary.mismatch).toBe(0);
  });

  it("recomputes deterministically with a human-confirmed 20 pcs/carton factor (E2E-08)", () => {
    const outcome = reconcile({
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "LL-100", "LED panel", "100")]),
      packingList: doc("PACKING_LIST", [
        line(0, "LL-100", "LED panel", null, "pcs", { packages: { count: "5", type: "carton", raw: "5 CTNS" } }),
      ]),
      conversions: [
        { sku: "LL-100", fromUnit: "carton", toUnit: "pcs", factor: "20", source: "human_confirmed", sourceReference: "Supplier email 4 Nov" },
      ],
      mappingOverrides: [],
    });
    const qty = outcome.checks.find((c) => c.rule === "quantity_equal_with_unit_normalization");
    expect(qty?.status).toBe("MATCH");
    expect(qty?.evidence).toMatchObject({ converted: "100", conversion: { source: "human_confirmed" } });
    expect(outcome.ready).toBe(true);
  });

  it("uses a pack size printed on the packing list as document-sourced conversion", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "LL-100", "LED panel", "100")]),
      packingList: doc("PACKING_LIST", [
        line(0, "LL-100", "LED panel", null, "pcs", { packages: { count: "5", type: "carton", raw: "5 CTNS" }, piecesPerPackage: "20" }),
      ]),
    });
    expect(outcome.checks.find((c) => c.rule === "quantity_equal_with_unit_normalization")?.evidence).toMatchObject({
      conversion: { source: "document" },
    });
  });

  it("compares weights across kg and lb but never gross against net", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "A", "Widget", "10")], [fieldOf("total_gross_weight", "100", "kg")]),
      packingList: doc(
        "PACKING_LIST",
        [line(0, "A", "Widget", "10")],
        [fieldOf("total_gross_weight", "220.46", "lb"), fieldOf("total_net_weight", "100", "kg")],
      ),
    });
    expect(outcome.checks.find((c) => c.key === "total:total_gross_weight")?.status).toBe("MATCH");
    expect(outcome.checks.find((c) => c.key === "total:total_net_weight")).toBeUndefined();
  });

  it("flags a gross weight conflict introduced by a replacement (E2E new mismatch)", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "A", "Widget", "10")], [fieldOf("total_gross_weight", "412.5", "kg")]),
      packingList: doc("PACKING_LIST", [line(0, "A", "Widget", "10")], [fieldOf("total_gross_weight", "421.5", "kg")]),
    });
    expect(outcome.issues.map((i) => i.kind)).toEqual(["WEIGHT_MISMATCH"]);
  });

  it("checks invoice arithmetic on lines and grand total", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc(
        "COMMERCIAL_INVOICE",
        [line(0, "A", "Widget", "3", "pcs", { unitPrice: "1.10", amount: "3.30" }), line(1, "B", "Gadget", "2", "pcs", { unitPrice: "5", amount: "11.00" })],
        [fieldOf("total_amount", "14.30")],
      ),
      packingList: doc("PACKING_LIST", [line(0, "A", "Widget", "3"), line(1, "B", "Gadget", "2")]),
    });
    expect(outcome.checks.find((c) => c.key === "arith:line:A")?.status).toBe("MATCH");
    expect(outcome.checks.find((c) => c.key === "arith:line:B")?.status).toBe("MISMATCH");
    expect(outcome.checks.find((c) => c.key === "arith:grand_total")?.status).toBe("MATCH");
    expect(outcome.issues[0]).toMatchObject({ kind: "ARITHMETIC_ERROR", requestedDocType: "COMMERCIAL_INVOICE" });
  });

  it("groups several quantity conflicts into one root cause", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "A", "Widget", "10"), line(1, "B", "Gadget", "20")]),
      packingList: doc("PACKING_LIST", [line(0, "A", "Widget", "9"), line(1, "B", "Gadget", "19")]),
    });
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0]?.checkKeys).toHaveLength(2);
  });

  it("treats legal-form spelling differences as the same party", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "A", "W", "1")], [fieldOf("seller", "Hangzhou Lumen Lighting Co., Ltd.")]),
      packingList: doc("PACKING_LIST", [line(0, "A", "W", "1")], [fieldOf("seller", "HANGZHOU LUMEN LIGHTING CO LTD")]),
    });
    expect(outcome.checks.find((c) => c.key === "party:seller")?.status).toBe("MATCH");
  });

  it("reports unmatched rows on either side as missing, never force-pairs different SKUs", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "A", "Widget", "10")]),
      packingList: doc("PACKING_LIST", [line(0, "Z", "Widget", "10")]),
    });
    expect(outcome.matches.every((m) => m.method === "unmatched")).toBe(true);
    expect(outcome.issues[0]?.kind).toBe("LINE_UNMATCHED");
  });

  it("matches SKU-less rows by description and flags weak similarity for review", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, null, "Ceramic coffee mug 350ml white", "100")]),
      packingList: doc("PACKING_LIST", [line(0, null, "Ceramic mug 350 ml, white glaze", "100")]),
    });
    expect(outcome.matches[0]?.method).toBe("description_similarity");
    const mapping = outcome.checks.find((c) => c.rule === "part_no_and_description_mapping");
    expect(["MATCH", "AMBIGUOUS"]).toContain(mapping?.status);
  });

  it("applies a human line-mapping override", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, null, "Item alpha", "5")]),
      packingList: doc("PACKING_LIST", [line(0, null, "Totally different words", "5")]),
      mappingOverrides: [{ invoiceRow: 0, packingRow: 0, sourceReference: "Coordinator confirmed with warehouse" }],
    });
    expect(outcome.matches[0]?.method).toBe("human_confirmed");
    expect(outcome.ready).toBe(true);
  });

  it("is not ready when a document is missing", () => {
    const outcome = reconcile({ ...base, invoice: doc("COMMERCIAL_INVOICE", invoiceLines), packingList: null });
    expect(outcome.ready).toBe(false);
    expect(outcome.issues[0]).toMatchObject({ kind: "MISSING_DOCUMENT", requestedDocType: "PACKING_LIST" });
  });

  it("handles duplicate SKUs by pairing equal quantities", () => {
    const outcome = reconcile({
      ...base,
      invoice: doc("COMMERCIAL_INVOICE", [line(0, "A", "Widget red", "10"), line(1, "A", "Widget blue", "30")]),
      packingList: doc("PACKING_LIST", [line(0, "A", "Widget blue", "30"), line(1, "A", "Widget red", "10")]),
    });
    expect(outcome.ready).toBe(true);
    expect(outcome.matches.map((m) => [m.invoiceRow, m.packingRow])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });
});
