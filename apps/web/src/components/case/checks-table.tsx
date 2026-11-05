import type { CheckResult, CheckSide, CheckStatus } from "@reissue/contracts";

import { sideValue, sidesOf } from "@/lib/evidence";
import { CHECK_STATUS_LABEL, CHECK_STATUS_ORDER } from "@/lib/format";

import { CheckBadge, cx } from "../ui";

function SideCell({ side }: { side: CheckSide | null }) {
  if (!side) return <span className="text-ink-2">Not part of this check</span>;
  return (
    <div className="min-w-0">
      <span className="tnum font-medium text-ink">{sideValue(side)}</span>
      {side.source ? (
        <>
          <span className="tnum ml-2 text-xs text-ink-2">p.{side.source.page}</span>
          <q className="mt-0.5 block truncate text-xs text-ink-2 before:content-none after:content-none" title={side.source.quote}>
            {side.source.quote}
          </q>
        </>
      ) : null}
    </div>
  );
}

function CheckRows({ checks, selectedKey, onSelect }: { checks: CheckResult[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  return (
    <>
      {checks.map((check) => {
        const selected = check.key === selectedKey;
        const located = Boolean(check.lhs?.source?.bbox ?? check.rhs?.source?.bbox);
        const { invoice, packing } = sidesOf(check);
        return (
          <tr key={check.key} className={cx("border-t border-line align-top", selected && "bg-accent-soft/60")} data-testid="check-row" data-status={check.status}>
            <th scope="row" className="w-[34%] px-4 py-2.5 text-left font-normal">
              <button
                type="button"
                onClick={() => onSelect(check.key)}
                disabled={!located}
                aria-pressed={selected}
                className="text-left font-medium text-ink hover:text-accent disabled:cursor-default disabled:hover:text-ink"
              >
                {check.label}
              </button>
              <span className="mt-0.5 block text-xs text-ink-2">
                {check.detail}
                {check.required ? "" : " Advisory."}
              </span>
            </th>
            <td className="w-[27%] max-w-0 px-4 py-2.5">
              <SideCell side={invoice} />
            </td>
            <td className="w-[27%] max-w-0 px-4 py-2.5">
              <SideCell side={packing} />
            </td>
            <td className="px-4 py-2.5 text-right">
              <CheckBadge status={check.status} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function GroupTable({ checks, selectedKey, onSelect, caption }: { checks: CheckResult[]; selectedKey: string | null; onSelect: (key: string) => void; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-ink-2">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">Check</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">Commercial invoice</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">Packing list</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          <CheckRows checks={checks} selectedKey={selectedKey} onSelect={onSelect} />
        </tbody>
      </table>
    </div>
  );
}

export function ChecksTable({ checks, selectedKey, onSelect }: { checks: CheckResult[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  if (!checks.length) return <p className="px-4 py-6 text-ink-2">No comparison has run yet. Checks appear once both documents are read.</p>;
  const groups = CHECK_STATUS_ORDER.map((status) => ({ status, checks: checks.filter((c) => c.status === status) })).filter((g) => g.checks.length);
  return (
    <div className="divide-y divide-line">
      {groups.map((group) => (
        <CheckGroup key={group.status} status={group.status} checks={group.checks} selectedKey={selectedKey} onSelect={onSelect} />
      ))}
    </div>
  );
}

function CheckGroup({ status, checks, selectedKey, onSelect }: { status: CheckStatus; checks: CheckResult[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  const caption = `${CHECK_STATUS_LABEL[status]}: ${checks.length} check${checks.length === 1 ? "" : "s"}`;
  const containsSelection = checks.some((c) => c.key === selectedKey);
  return (
    <details open={status !== "MATCH" || containsSelection || undefined} className="group" data-testid={`check-group-${status}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm hover:bg-sunken/50 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-ink-2 transition-transform duration-150 group-open:rotate-90">
          ›
        </span>
        <CheckBadge status={status} />
        <span className="tnum text-ink-2">
          {checks.length} check{checks.length === 1 ? "" : "s"}
        </span>
      </summary>
      <GroupTable checks={checks} selectedKey={selectedKey} onSelect={onSelect} caption={caption} />
    </details>
  );
}
