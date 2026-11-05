import { z } from "zod";

import { BBox, DecimalString, DocType, Parser, Unit } from "./domain.js";

/**
 * Wire contract between the document worker (Python) and the Node services.
 * The worker never decides business outcomes; it reports what it read and where.
 */

export const SourceSpan = z.object({
  page: z.number().int().positive(),
  bbox: BBox.nullable(),
  quote: z.string(),
  parser: Parser,
  confidence: z.number().min(0).max(1),
});
export type SourceSpan = z.infer<typeof SourceSpan>;

export const PageInfo = z.object({
  page: z.number().int().positive(),
  width: z.number(),
  height: z.number(),
  textChars: z.number().int().nonnegative(),
  ocr: z.boolean(),
  textHash: z.string(),
});
export type PageInfo = z.infer<typeof PageInfo>;

export const FieldPath = z.enum([
  "invoice_number",
  "packing_list_number",
  "purchase_order",
  "document_date",
  "revision",
  "seller",
  "buyer",
  "consignee",
  "currency",
  "incoterms",
  "total_amount",
  "total_quantity",
  "total_packages",
  "total_net_weight",
  "total_gross_weight",
  "total_cbm",
  "bl_number",
  "awb_number",
]);
export type FieldPath = z.infer<typeof FieldPath>;

export const ExtractedField = z.object({
  path: FieldPath,
  raw: z.string(),
  /** Normalized value: decimals as decimal strings, dates as ISO yyyy-mm-dd, text trimmed. */
  value: z.string(),
  unit: Unit.nullable(),
  source: SourceSpan,
});
export type ExtractedField = z.infer<typeof ExtractedField>;

export const Measure = z.object({
  value: DecimalString,
  unit: Unit,
  raw: z.string(),
});
export type Measure = z.infer<typeof Measure>;

export const ExtractedLineItem = z.object({
  rowIndex: z.number().int().nonnegative(),
  sku: z.string().nullable(),
  description: z.string(),
  quantity: Measure.nullable(),
  packages: z.object({ count: DecimalString, type: Unit, raw: z.string() }).nullable(),
  unitPrice: DecimalString.nullable(),
  amount: DecimalString.nullable(),
  netWeight: Measure.nullable(),
  grossWeight: Measure.nullable(),
  cbm: DecimalString.nullable(),
  /** Pack size stated on the document itself, e.g. "20 pcs/ctn". */
  piecesPerPackage: DecimalString.nullable(),
  source: SourceSpan,
});
export type ExtractedLineItem = z.infer<typeof ExtractedLineItem>;

export const DocumentPart = z.object({
  docType: DocType,
  pageStart: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
  classificationConfidence: z.number().min(0).max(1),
  classificationSignals: z.array(z.string()),
  fields: z.array(ExtractedField),
  lineItems: z.array(ExtractedLineItem),
  missingFields: z.array(FieldPath),
});
export type DocumentPart = z.infer<typeof DocumentPart>;

export const ExtractionResult = z.object({
  workerVersion: z.string(),
  mime: z.string(),
  pageCount: z.number().int().nonnegative(),
  pages: z.array(PageInfo),
  parts: z.array(DocumentPart),
  warnings: z.array(z.string()),
  timingsMs: z.record(z.string(), z.number()),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;
