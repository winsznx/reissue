import { describe, expect, it } from "vitest";

import { solveAssignment } from "../src/assignment.js";
import { parseLocaleDecimal, toKg, weightEquals } from "../src/numbers.js";
import { assertCaseTransition, InvalidTransitionError, stateAfterReconciliation } from "../src/state-machine.js";
import { normalizePartyName } from "../src/text.js";
import {
  checkReplacementIdentity,
  decideSupersede,
  findCaseCodes,
  formatCaseCode,
  outboundDedupeKey,
  shipmentMatchScore,
} from "../src/versioning.js";

describe("parseLocaleDecimal", () => {
  it.each([
    ["1,234.50", "1234.5"],
    ["1.234,50", "1234.5"],
    ["1 234,5", "1234.5"],
    ["480", "480"],
    ["12,5", "12.5"],
    ["1.234.567", "1234567"],
  ])("%s → %s", (input, expected) => expect(parseLocaleDecimal(input)).toBe(expected));

  it("refuses to guess an ambiguous thousands/decimal comma", () => expect(parseLocaleDecimal("1,234")).toBeNull());
  it("rejects non-numeric text", () => expect(parseLocaleDecimal("12kg")).toBeNull());
});

describe("weights", () => {
  it("converts lb exactly", () => expect(toKg("1", "lb")?.toString()).toBe("0.45359237"));
  it("compares at the coarser declared precision", () => {
    expect(weightEquals(toKg("12.5", "kg")!, toKg("12.50", "kg")!, "12.5", "12.50")).toBe(true);
    expect(weightEquals(toKg("12.5", "kg")!, toKg("12.6", "kg")!, "12.5", "12.6")).toBe(false);
  });
  it("returns null for non-weight units", () => expect(toKg("1", "pcs")).toBeNull());
});

describe("solveAssignment", () => {
  it("finds the minimum-cost pairing", () => {
    expect(
      solveAssignment([
        [4, 1, 3],
        [2, 0, 5],
        [3, 2, 2],
      ]),
    ).toEqual([1, 0, 2]);
  });
  it("leaves rows unassigned when only infinite costs remain", () => {
    expect(solveAssignment([[Infinity], [0]])).toEqual([-1, 0]);
  });
  it("handles rectangular matrices", () => expect(solveAssignment([[1, 0, 9]])).toEqual([1]));
});

describe("case state machine", () => {
  it("rejects impossible transitions with a typed error", () => {
    expect(() => assertCaseTransition("RECEIVED", "READY_FOR_BROKER_REVIEW")).toThrow(InvalidTransitionError);
    expect(() => assertCaseTransition("RECHECKING", "READY_FOR_BROKER_REVIEW")).not.toThrow();
  });
  it("routes human-fact issues to clarification and supplier asks to waiting", () => {
    expect(stateAfterReconciliation({ ready: true, issues: [] })).toBe("READY_FOR_BROKER_REVIEW");
    expect(stateAfterReconciliation({ ready: false, issues: [{ needsHumanFact: true, responsibleRole: "SUPPLIER" }] })).toBe(
      "NEEDS_CLARIFICATION",
    );
    expect(stateAfterReconciliation({ ready: false, issues: [{ needsHumanFact: false, responsibleRole: "SUPPLIER" }] })).toBe(
      "WAITING_ON_SUPPLIER",
    );
  });
});

describe("versioning", () => {
  const at = "2026-11-05T10:00:00Z";
  it("keeps the newer revision current when an older one arrives late (E2E-13)", () => {
    expect(decideSupersede({ revision: "Rev. 2", documentDate: null, receivedAt: at }, { revision: "Rev. 1", documentDate: null, receivedAt: at }).decision).toBe(
      "STALE",
    );
    expect(decideSupersede({ revision: null, documentDate: "2026-11-01", receivedAt: at }, { revision: null, documentDate: "2026-10-28", receivedAt: at }).decision).toBe(
      "STALE",
    );
  });
  it("accepts higher revisions", () => {
    expect(decideSupersede({ revision: null, documentDate: "2026-11-01", receivedAt: at }, { revision: "Revision 2", documentDate: "2026-11-01", receivedAt: at }).decision).toBe(
      "SUPERSEDES",
    );
  });
  it("quarantines a replacement whose references contradict the shipment", () => {
    const shipment = { invoiceReference: "HLL-2026-0417", purchaseOrder: "PO-88213", supplierName: "Lumen Co., Ltd.", consignee: null };
    expect(checkReplacementIdentity(shipment, { ...shipment, purchaseOrder: "po 88213" }).ok).toBe(true);
    expect(checkReplacementIdentity(shipment, { ...shipment, invoiceReference: "HLL-2026-0999" }).ok).toBe(false);
    expect(checkReplacementIdentity(shipment, { invoiceReference: null, purchaseOrder: null, supplierName: null, consignee: null }).ok).toBe(false);
  });
  it("scores shipment identity on references, not filenames", () => {
    const s = { invoiceReference: "INV-1", purchaseOrder: "PO-1", supplierName: "A Ltd", consignee: null };
    expect(shipmentMatchScore(s, s)).toBeGreaterThan(0.8);
    expect(shipmentMatchScore(s, { ...s, invoiceReference: "INV-2" })).toBe(0);
  });
  it("extracts and formats case codes", () => {
    expect(findCaseCodes("is this for shp-0241 or SHP-0242? shp-0241")).toEqual(["SHP-0241", "SHP-0242"]);
    expect(formatCaseCode(241)).toBe("SHP-0241");
  });
  it("builds order-independent dedupe keys", () => {
    const a = outboundDedupeKey({ caseId: "c", issueIds: ["b", "a"], epoch: 2, recipient: "room", action: "ask" });
    const b = outboundDedupeKey({ caseId: "c", issueIds: ["a", "b"], epoch: 2, recipient: "room", action: "ask" });
    expect(a).toBe(b);
  });
  it("normalizes party names", () => expect(normalizePartyName("Northfield Home Goods B.V.")).toBe("northfield home goods"));
});
