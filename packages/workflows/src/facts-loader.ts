import { and, eq, inArray, isNotNull } from "drizzle-orm";

import type { ExtractedField, ExtractedLineItem, Measure } from "@reissue/contracts";
import type { DocumentFacts } from "@reissue/core";
import { schema, type Executor } from "@reissue/db";

type LineRow = typeof schema.lineItems.$inferSelect;

function measure(value: string | null, unit: LineRow["unit"], raw: string | null): Measure | null {
  if (value === null) return null;
  return { value, unit: unit ?? "unknown", raw: raw ?? value };
}

export function lineFromRow(row: LineRow): ExtractedLineItem {
  return {
    rowIndex: row.rowIndex,
    sku: row.sku,
    description: row.description,
    quantity: measure(row.quantity, row.unit, row.quantityRaw),
    packages: row.packages !== null ? { count: row.packages, type: row.packageUnit ?? "unknown", raw: row.packagesRaw ?? row.packages } : null,
    unitPrice: row.unitPrice,
    amount: row.extendedTotal,
    netWeight: measure(row.netWeight, row.netWeightUnit, row.netWeight),
    grossWeight: measure(row.grossWeight, row.grossWeightUnit, row.grossWeight),
    cbm: row.cbm,
    piecesPerPackage: row.piecesPerPackage,
    source: row.source,
  };
}

export interface CurrentDocuments {
  invoice: DocumentFacts | null;
  packingList: DocumentFacts | null;
  versionIds: string[];
}

/** Loads the current, successfully extracted invoice and packing list for reconciliation. */
export async function loadCurrentFacts(tx: Executor, shipmentId: string): Promise<CurrentDocuments> {
  const docs = await tx
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.shipmentId, shipmentId), isNotNull(schema.documents.currentVersionId)));
  const versionIds = docs.map((d) => d.currentVersionId!).filter(Boolean);
  if (versionIds.length === 0) return { invoice: null, packingList: null, versionIds: [] };

  const versions = await tx.select().from(schema.documentVersions).where(inArray(schema.documentVersions.id, versionIds));
  const fields = await tx.select().from(schema.extractedFields).where(inArray(schema.extractedFields.versionId, versionIds));
  const lines = await tx.select().from(schema.lineItems).where(inArray(schema.lineItems.versionId, versionIds));

  const facts = (docType: "COMMERCIAL_INVOICE" | "PACKING_LIST"): DocumentFacts | null => {
    const doc = docs.find((d) => d.docType === docType);
    const version = versions.find((v) => v.id === doc?.currentVersionId && v.state === "EXTRACTED");
    if (!version) return null;
    return {
      versionId: version.id,
      docType,
      missingFields: version.missingFields,
      fields: fields
        .filter((f) => f.versionId === version.id)
        .map((f): ExtractedField => ({ path: f.fieldPath, raw: f.rawText, value: f.normalizedValue, unit: f.unit, source: f.source })),
      lineItems: lines
        .filter((l) => l.versionId === version.id)
        .sort((a, b) => a.rowIndex - b.rowIndex)
        .map(lineFromRow),
    };
  };

  return { invoice: facts("COMMERCIAL_INVOICE"), packingList: facts("PACKING_LIST"), versionIds };
}
