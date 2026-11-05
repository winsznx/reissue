import type { BBox, CheckResult, CheckSide, CheckStatus, DocType, DocumentDto, DocumentVersionDto, IssueDto } from "@reissue/contracts";

export const COMPARED_DOC_TYPES = ["COMMERCIAL_INVOICE", "PACKING_LIST"] as const satisfies readonly DocType[];
export type ComparedDocType = (typeof COMPARED_DOC_TYPES)[number];

export interface Mark {
  key: string;
  bbox: BBox;
  status: CheckStatus;
  label: string;
  value: string;
  selected: boolean;
  resolving: boolean;
}

export function sideFor(check: CheckResult, docType: DocType): CheckSide | null {
  if (check.lhs?.docType === docType) return check.lhs;
  if (check.rhs?.docType === docType) return check.rhs;
  return null;
}

export function sideValue(side: CheckSide | null): string {
  if (!side) return "Not stated";
  const value = side.value ?? side.raw;
  if (value === null) return "Not stated";
  return side.unit && side.unit !== "unknown" ? `${value} ${side.unit}` : value;
}

export function documentFor(documents: DocumentDto[], docType: DocType): DocumentDto | null {
  return documents.find((d) => d.docType === docType) ?? null;
}

export function currentVersion(doc: DocumentDto | null): DocumentVersionDto | null {
  if (!doc) return null;
  return doc.versions.find((v) => v.id === doc.currentVersionId) ?? doc.versions.at(-1) ?? null;
}

export function versionById(doc: DocumentDto | null, id: string | null): DocumentVersionDto | null {
  if (!doc || !id) return null;
  return doc.versions.find((v) => v.id === id) ?? null;
}

/**
 * Highlights for one rendered page: open differences, the selected check, checks that just
 * resolved, and the checks behind resolved issues so the corrected line stays findable.
 */
export function marksForPage(
  checks: CheckResult[],
  versionId: string,
  page: number,
  selectedKey: string | null,
  resolvingKeys: ReadonlySet<string>,
  correctedKeys: ReadonlySet<string>,
): Mark[] {
  const marks: Mark[] = [];
  for (const check of checks) {
    const selected = check.key === selectedKey;
    const resolving = resolvingKeys.has(check.key);
    if (check.status === "MATCH" && !selected && !resolving && !correctedKeys.has(check.key)) continue;
    for (const side of [check.lhs, check.rhs]) {
      if (!side?.source?.bbox || side.versionId !== versionId || side.source.page !== page) continue;
      marks.push({ key: check.key, bbox: side.source.bbox, status: check.status, label: check.label, value: sideValue(side), selected, resolving });
    }
  }
  return marks.sort((a, b) => Number(a.selected) - Number(b.selected));
}

export function checksForIssue(issue: IssueDto, checks: CheckResult[]): CheckResult[] {
  return issue.checkKeys.flatMap((key) => checks.filter((c) => c.key === key));
}

/** Keys of checks that were not MATCH before and are MATCH now; drives the one resolve animation. */
export function newlyResolved(previous: CheckResult[] | undefined, next: CheckResult[]): string[] {
  if (!previous) return [];
  const before = new Map(previous.map((c) => [c.key, c.status]));
  return next.filter((c) => c.status === "MATCH" && before.has(c.key) && before.get(c.key) !== "MATCH").map((c) => c.key);
}

export function sidesOf(check: CheckResult): { invoice: CheckSide | null; packing: CheckSide | null } {
  const invoice = sideFor(check, "COMMERCIAL_INVOICE");
  const packing = sideFor(check, "PACKING_LIST");
  if (!invoice && !packing) return { invoice: check.lhs, packing: check.rhs };
  return { invoice, packing };
}
