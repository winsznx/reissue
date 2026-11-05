import type { CaseDetailDto, CheckResult, CheckSide, IssueDto } from "@reissue/contracts";
import { isIssueOpen } from "@reissue/core";

import { sideValue, sidesOf } from "@/lib/evidence";
import { ISSUE_STATE_LABEL, ROLE_LABEL, formatQuantity, issueTone } from "@/lib/format";

import { ArrowRightIcon } from "../icons";
import { Badge, cx } from "../ui";

const FIELD_RE = /^line:(\d+)\.(\w+)$/;

/** Value the same line carried on the version this side superseded, when the line can be matched by SKU. */
function priorValue(detail: CaseDetailDto, side: CheckSide): string | null {
  const match = FIELD_RE.exec(side.ref);
  if (!match) return null;
  const [, row, field] = match;
  const version = detail.documents.flatMap((d) => d.versions).find((v) => v.id === side.versionId);
  if (!version?.supersedesVersionId) return null;
  const line = detail.lineItems.find((l) => l.versionId === side.versionId && l.rowIndex === Number(row));
  const prior = line?.sku ? detail.lineItems.find((l) => l.versionId === version.supersedesVersionId && l.sku === line.sku) : undefined;
  if (!prior) return null;
  switch (field) {
    case "quantity":
      return formatQuantity(prior.quantity, prior.unit);
    case "packages":
      return formatQuantity(prior.packages, prior.packageUnit);
    case "amount":
      return prior.amount;
    case "netWeight":
    case "net_weight":
      return formatQuantity(prior.netWeightKg, "kg");
    case "grossWeight":
    case "gross_weight":
      return formatQuantity(prior.grossWeightKg, "kg");
    default:
      return null;
  }
}

function ChangeLine({ issue, check, detail }: { issue: IssueDto; check: CheckResult | undefined; detail: CaseDetailDto }) {
  if (!check) return <span className="text-ink-2">Check no longer in the latest comparison</span>;
  const { invoice, packing: other } = sidesOf(check);
  if (isIssueOpen(issue.status) || check.status !== "MATCH") {
    return (
      <span className="tnum">
        Invoice <strong className="font-semibold">{sideValue(invoice)}</strong>
        {other ? (
          <>
            {" "}
            vs packing list <strong className="font-semibold text-warn-ink">{sideValue(other)}</strong>
          </>
        ) : null}
      </span>
    );
  }
  const changed = [check.lhs, check.rhs].flatMap((side) => {
    if (!side) return [];
    const before = priorValue(detail, side);
    return before ? [{ side, before }] : [];
  });
  const first = changed[0];
  if (first) {
    return (
      <span className="tnum inline-flex flex-wrap items-center gap-1">
        {first.side.docType === "PACKING_LIST" ? "Packing list" : "Invoice"}
        <s className="text-ink-2 decoration-warn">{first.before}</s>
        <ArrowRightIcon size={12} className="text-ink-2" />
        <strong className="font-semibold text-ok-ink">{sideValue(first.side)}</strong>
      </span>
    );
  }
  return <span className="tnum">Both documents now state {sideValue(check.lhs ?? check.rhs)}</span>;
}

export function IssuesList({ detail, selectedKey, onSelect }: { detail: CaseDetailDto; selectedKey: string | null; onSelect: (checkKey: string) => void }) {
  const issues = [...detail.issues].sort((a, b) => Number(isIssueOpen(b.status)) - Number(isIssueOpen(a.status)) || a.code.localeCompare(b.code));
  if (!issues.length) {
    return <p className="px-4 py-6 text-ink-2">No differences were found between the current documents.</p>;
  }
  return (
    <ul className="divide-y divide-line" data-testid="issues">
      {issues.map((issue) => {
        const key = issue.checkKeys[0] ?? null;
        const check = detail.checks.find((c) => c.key === key);
        const selected = key !== null && key === selectedKey;
        const open = isIssueOpen(issue.status);
        return (
          <li key={issue.id}>
            <button
              type="button"
              disabled={!key}
              onClick={() => key && onSelect(key)}
              aria-pressed={selected}
              data-testid="issue-row"
              className={cx(
                "grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors duration-150 hover:bg-sunken/60",
                selected && "bg-accent-soft/60 shadow-[inset_3px_0_0_var(--accent)]",
              )}
            >
              <span className={cx("tnum row-span-2 pt-px text-sm font-semibold", open ? "text-warn-ink" : "text-ok-ink")}>{issue.code}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-ink">{issue.title}</span>
                <Badge tone={issueTone(issue.status)}>{ISSUE_STATE_LABEL[issue.status]}</Badge>
                {issue.severity !== "BLOCKING" ? <Badge tone="neutral">{issue.severity.toLowerCase()}</Badge> : null}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                <ChangeLine issue={issue} check={check} detail={detail} />
                <span>
                  {ROLE_LABEL[issue.responsibleRole]}
                  {issue.assignee ? ` · ${issue.assignee}` : ""}
                </span>
                {issue.resolvedEpoch !== null ? <span className="tnum">Resolved at epoch {issue.resolvedEpoch}</span> : <span className="tnum">Opened at epoch {issue.openedEpoch}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
