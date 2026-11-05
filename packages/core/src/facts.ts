import type {
  ConversionFactor,
  DocType,
  ExtractedField,
  ExtractedLineItem,
  FieldPath,
  LineMappingOverride,
} from "@reissue/contracts";

/** Extracted content of one current document version, as stored after extraction. */
export interface DocumentFacts {
  versionId: string;
  docType: DocType;
  fields: ExtractedField[];
  lineItems: ExtractedLineItem[];
  missingFields: FieldPath[];
}

export interface ReconcileInput {
  invoice: DocumentFacts | null;
  packingList: DocumentFacts | null;
  conversions: readonly ConversionFactor[];
  mappingOverrides: readonly LineMappingOverride[];
}

export function field(facts: DocumentFacts | null, path: FieldPath): ExtractedField | null {
  return facts?.fields.find((f) => f.path === path) ?? null;
}
