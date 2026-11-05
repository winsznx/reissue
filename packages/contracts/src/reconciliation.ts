import { z } from "zod";

import { CheckRule, CheckStatus, DocType, ResponsibleRole, Severity, Unit } from "./domain.js";
import { SourceSpan } from "./extraction.js";

export const CheckSide = z.object({
  versionId: z.string(),
  docType: DocType,
  /** Stable reference inside the version, e.g. `line:2.quantity` or `field:total_gross_weight`. */
  ref: z.string(),
  raw: z.string().nullable(),
  value: z.string().nullable(),
  unit: Unit.nullable(),
  source: SourceSpan.nullable(),
});
export type CheckSide = z.infer<typeof CheckSide>;

export const CheckResult = z.object({
  /** Deterministic key so the same comparison maps to the same check across epochs. */
  key: z.string(),
  rule: CheckRule,
  status: CheckStatus,
  required: z.boolean(),
  label: z.string(),
  lhs: CheckSide.nullable(),
  rhs: CheckSide.nullable(),
  detail: z.string(),
  /** Normalized comparison inputs and any conversion applied. */
  evidence: z.record(z.string(), z.unknown()),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const LineMatchMethod = z.enum(["sku_exact", "description_similarity", "human_confirmed", "unmatched"]);
export type LineMatchMethod = z.infer<typeof LineMatchMethod>;

export const LineMatch = z.object({
  invoiceRow: z.number().int().nullable(),
  packingRow: z.number().int().nullable(),
  method: LineMatchMethod,
  confidence: z.number().min(0).max(1),
  key: z.string(),
});
export type LineMatch = z.infer<typeof LineMatch>;

export const IssueKind = z.enum([
  "QUANTITY_MISMATCH",
  "WEIGHT_MISMATCH",
  "PACKAGE_MISMATCH",
  "LINE_UNMATCHED",
  "REFERENCE_MISMATCH",
  "PARTY_MISMATCH",
  "ARITHMETIC_ERROR",
  "MISSING_FIELD",
  "UNIT_NOT_COMPARABLE",
  "AMBIGUOUS_MAPPING",
  "MISSING_DOCUMENT",
]);
export type IssueKind = z.infer<typeof IssueKind>;

/** An issue proposal from the reconciler, grouped by root cause. Persisted issues add identity and state. */
export const IssueDraft = z.object({
  rootCauseKey: z.string(),
  kind: IssueKind,
  severity: Severity,
  responsibleRole: ResponsibleRole,
  title: z.string(),
  checkKeys: z.array(z.string()).min(1),
  /** The document the responsible party is asked to reissue, if any; null when the true value is unknown. */
  requestedDocType: DocType.nullable(),
  needsHumanFact: z.boolean(),
});
export type IssueDraft = z.infer<typeof IssueDraft>;

export const ReconciliationOutcome = z.object({
  checks: z.array(CheckResult),
  matches: z.array(LineMatch),
  issues: z.array(IssueDraft),
  ready: z.boolean(),
  summary: z.object({
    checked: z.number().int(),
    match: z.number().int(),
    mismatch: z.number().int(),
    missing: z.number().int(),
    ambiguous: z.number().int(),
    notComparable: z.number().int(),
  }),
});
export type ReconciliationOutcome = z.infer<typeof ReconciliationOutcome>;

export const ConversionFactor = z.object({
  /** Applies to a SKU (or `*` for the case). */
  sku: z.string(),
  fromUnit: Unit,
  toUnit: Unit,
  factor: z.string().regex(/^\d+(\.\d+)?$/),
  source: z.enum(["document", "human_confirmed"]),
  sourceReference: z.string().min(1),
});
export type ConversionFactor = z.infer<typeof ConversionFactor>;

export const LineMappingOverride = z.object({
  invoiceRow: z.number().int(),
  packingRow: z.number().int(),
  sourceReference: z.string().min(1),
});
export type LineMappingOverride = z.infer<typeof LineMappingOverride>;
