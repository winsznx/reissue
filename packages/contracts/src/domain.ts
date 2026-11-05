import { z } from "zod";

export const DocType = z.enum([
  "COMMERCIAL_INVOICE",
  "PACKING_LIST",
  "BILL_OF_LADING",
  "AIR_WAYBILL",
  "PURCHASE_ORDER",
  "CORRECTION_NOTE",
  "UNKNOWN",
]);
export type DocType = z.infer<typeof DocType>;

/** Document types that participate in cross-document reconciliation. */
export const RECONCILED_DOC_TYPES = ["COMMERCIAL_INVOICE", "PACKING_LIST"] as const satisfies readonly DocType[];

export const CaseState = z.enum([
  "RECEIVED",
  "PARSING",
  "RECONCILING",
  "NEEDS_CLARIFICATION",
  "WAITING_ON_SUPPLIER",
  "RECHECKING",
  "READY_FOR_BROKER_REVIEW",
  "ERROR_RECOVERABLE",
  "CANCELLED",
]);
export type CaseState = z.infer<typeof CaseState>;

export const IssueState = z.enum([
  "OPEN",
  "OWNER_ASSIGNED",
  "REQUEST_SENT",
  "ANSWER_RECEIVED",
  "REPLACEMENT_RECEIVED",
  "RECHECKING",
  "RESOLVED",
  "REOPENED",
  "ESCALATED",
]);
export type IssueState = z.infer<typeof IssueState>;

export const DocumentState = z.enum(["RECEIVED", "QUARANTINED", "EXTRACTING", "EXTRACTED", "FAILED", "SUPERSEDED"]);
export type DocumentState = z.infer<typeof DocumentState>;

export const CheckStatus = z.enum(["MATCH", "MISMATCH", "MISSING", "AMBIGUOUS", "NOT_COMPARABLE"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CheckRule = z.enum([
  "quantity_equal_with_unit_normalization",
  "gross_weight_equal_where_declared_on_both",
  "net_weight_equal_where_declared_on_both",
  "package_count_consistency",
  "part_no_and_description_mapping",
  "party_name_consistency",
  "po_and_invoice_reference_consistency",
  "line_total_arithmetic",
  "invoice_grand_total_arithmetic",
  "missing_required_document_field",
  "replacement_document_identity_and_version",
  "document_date_and_revision_order",
]);
export type CheckRule = z.infer<typeof CheckRule>;

export const Unit = z.enum(["pcs", "carton", "kg", "g", "lb", "pallet", "set", "pair", "m", "unknown"]);
export type Unit = z.infer<typeof Unit>;

export const ResponsibleRole = z.enum(["SUPPLIER", "WAREHOUSE", "OPERATIONS_LEAD", "COORDINATOR"]);
export type ResponsibleRole = z.infer<typeof ResponsibleRole>;

export const Severity = z.enum(["BLOCKING", "WARNING", "INFO"]);
export type Severity = z.infer<typeof Severity>;

/** Decimal values travel as strings; floats never carry business quantities. */
export const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "decimal string");
export type DecimalString = z.infer<typeof DecimalString>;

export const BBox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBox>;

export const Parser = z.enum(["pdf_text", "pdf_table", "ocr", "spreadsheet", "llm_verified", "human"]);
export type Parser = z.infer<typeof Parser>;
