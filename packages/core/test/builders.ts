import type { ExtractedField, ExtractedLineItem, FieldPath, Unit } from "@reissue/contracts";

import type { DocumentFacts } from "../src/facts.js";

const span = (page = 1) => ({ page, bbox: [10, 10, 100, 20] as [number, number, number, number], quote: "", parser: "pdf_table" as const, confidence: 0.95 });

export function line(
  rowIndex: number,
  sku: string | null,
  description: string,
  qty: string | null,
  unit: Unit = "pcs",
  extra: Partial<ExtractedLineItem> = {},
): ExtractedLineItem {
  return {
    rowIndex,
    sku,
    description,
    quantity: qty === null ? null : { value: qty, unit, raw: `${qty} ${unit}` },
    packages: null,
    unitPrice: null,
    amount: null,
    netWeight: null,
    grossWeight: null,
    cbm: null,
    piecesPerPackage: null,
    source: span(),
    ...extra,
  };
}

export function fieldOf(path: FieldPath, value: string, unit: Unit | null = null): ExtractedField {
  return { path, raw: unit ? `${value} ${unit}` : value, value, unit, source: span() };
}

export function doc(
  docType: "COMMERCIAL_INVOICE" | "PACKING_LIST",
  lineItems: ExtractedLineItem[],
  fields: ExtractedField[] = [],
  versionId = docType === "COMMERCIAL_INVOICE" ? "ver_inv_1" : "ver_pl_1",
): DocumentFacts {
  return { versionId, docType, fields, lineItems, missingFields: [] };
}
