import { describe, expect, it } from "vitest";

import { classifyByRules, classifySupplierReply, parseConversionStatement, type ReplyModel } from "../src/supplier-reply.js";

describe("classifyByRules", () => {
  it.each([
    ["the packing list is old", "DOCUMENT_OUTDATED"],
    ["we actually shipped 480", "CONFIRMS_VALUE"],
    ["I'll send the revision this afternoon", "REPLACEMENT_PROMISED"],
    ["Which invoice do you mean?", "QUESTION"],
    ["thanks, have a good weekend", "UNRELATED"],
  ] as const)("reads %j as %s", (text, intent) => {
    expect(classifyByRules(text, false).intent).toBe(intent);
  });

  it("treats any reply with a file as a claimed replacement", () => {
    expect(classifyByRules("this is the new one", true).intent).toBe("REPLACEMENT_ATTACHED");
  });

  it("captures the quantity a supplier states as shipped", () => {
    expect(classifyByRules("Old packing list. We shipped 500; sending updated document.", false).statedValue).toBe("500");
  });
});

describe("parseConversionStatement", () => {
  it("reads per-carton statements with a SKU", () => {
    expect(parseConversionStatement("@reissue 1 carton = 20 pcs for LL-STR-050, source: spec sheet")).toMatchObject({
      piecesPerPackage: "20",
      packageUnit: "carton",
      sku: "LL-STR-050",
    });
  });
  it("reads 'N pcs per carton'", () => expect(parseConversionStatement("it's 48 pcs per ctn")?.piecesPerPackage).toBe("48"));
  it("ignores text without a pack size", () => expect(parseConversionStatement("we shipped 20 cartons")).toBeNull());
});

describe("classifySupplierReply", () => {
  const model = (out: unknown): ReplyModel => ({ id: "test", classify: async () => out });

  it("accepts a schema-valid model label but drops a stated value not present in the text", async () => {
    const result = await classifySupplierReply("old list, real qty is 500", false, model({ intent: "DOCUMENT_OUTDATED", stated_value: "480", confidence: 0.9 }));
    expect(result).toMatchObject({ intent: "DOCUMENT_OUTDATED", statedValue: null, method: "model" });
  });

  it("falls back to rules when the model output is invalid or the call fails", async () => {
    expect((await classifySupplierReply("the packing list is old", false, model({ intent: "MARK_READY" }))).method).toBe("rules");
    const failing: ReplyModel = { id: "x", classify: async () => Promise.reject(new Error("down")) };
    expect((await classifySupplierReply("the packing list is old", false, failing)).intent).toBe("DOCUMENT_OUTDATED");
  });
});
