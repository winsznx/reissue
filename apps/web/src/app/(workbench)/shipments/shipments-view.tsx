"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";

import { CaseListTab, type CaseSummaryDto } from "@reissue/contracts";

import { SearchIcon } from "@/components/icons";
import { IntakeDropzone } from "@/components/intake-dropzone";
import { ErrorNotice, LoadingBlock, StateBadge, TextLink, cx, inputClass } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useCaseList, type CaseSort } from "@/lib/queries";

const TABS: { id: CaseListTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_correction", label: "Needs correction" },
  { id: "waiting_on_supplier", label: "Waiting on supplier" },
  { id: "rechecking", label: "Rechecking" },
  { id: "ready", label: "Ready" },
];

const SORTS: { id: CaseSort; label: string }[] = [
  { id: "updated_desc", label: "Recently updated" },
  { id: "updated_asc", label: "Least recently updated" },
  { id: "created_desc", label: "Newest case" },
  { id: "code_asc", label: "Case code" },
];

function parseTab(value: string | null): CaseListTab {
  const parsed = CaseListTab.safeParse(value);
  return parsed.success ? parsed.data : "all";
}

function parseSort(value: string | null): CaseSort {
  return SORTS.find((s) => s.id === value)?.id ?? "updated_desc";
}

export function ShipmentsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const sort = parseSort(params.get("sort"));
  const [query, setQuery] = useState(params.get("q") ?? "");
  const deferredQuery = useDeferredValue(query);
  const { data, error, isLoading, mutate } = useCaseList(tab, deferredQuery, sort);

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(window.location.search);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setParam("q", value.trim(), "");
  }

  const cases = data?.cases ?? [];
  const filtered = tab !== "all" || deferredQuery.trim() !== "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-serif text-[2rem] font-medium leading-none tracking-[-0.015em]">Shipments</h1>
          <p className="mt-2 max-w-[60ch] text-ink-2">Every case Reissue is checking, from first file to broker-ready packet.</p>
        </div>
        <div className="w-full lg:w-[420px]">
          <IntakeDropzone compact />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-line md:flex-row md:items-end md:justify-between">
        <div role="tablist" aria-label="Filter shipments by stage" className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="shipments-list"
                onClick={() => setParam("tab", t.id, "all")}
                className={cx(
                  "shrink-0 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-1 text-sm transition-colors duration-150",
                  active ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <label htmlFor="shipment-search" className="sr-only">
              Search by case, supplier, invoice or PO
            </label>
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 mt-0.5 -translate-y-1/2 text-ink-2" />
            <input
              id="shipment-search"
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Case, supplier, invoice or PO"
              className={cx(inputClass, "mt-0 pl-8")}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <span className="shrink-0">Sort</span>
            <select value={sort} onChange={(e) => setParam("sort", e.target.value, "updated_desc")} className={cx(inputClass, "mt-0 w-auto pr-8")}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <section id="shipments-list" role="tabpanel" aria-label={`${TABS.find((t) => t.id === tab)?.label ?? "All"} shipments`} aria-busy={isLoading}>
        {error ? (
          <ErrorNotice error={errorMessage(error)} onRetry={() => void mutate()} />
        ) : isLoading && !data ? (
          <LoadingBlock label="Loading shipments" rows={6} />
        ) : cases.length === 0 ? (
          filtered ? <NoMatches /> : <EmptyWorkspace />
        ) : (
          <CaseTable cases={cases} />
        )}
      </section>
    </div>
  );
}

function NoMatches() {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-6 py-10 text-center">
      <p className="font-medium">No shipments match this view.</p>
      <p className="mt-1 text-ink-2">Try another stage, or clear the search.</p>
    </div>
  );
}

function EmptyWorkspace() {
  return (
    <div className="grid gap-6 rounded-[10px] border border-line bg-surface p-6 md:grid-cols-[1fr_minmax(0,420px)] md:p-8">
      <div>
        <h2 className="font-serif text-xl font-medium">No shipments yet</h2>
        <p className="mt-2 max-w-[52ch] text-ink-2">
          Cases appear here when a coordinator drops an invoice and packing list in the operations chat, or when you upload them here. You can also run a curated scenario from{" "}
          <TextLink href="/verification">Verification</TextLink> to see a full correction loop.
        </p>
      </div>
      <IntakeDropzone />
    </div>
  );
}

function IssueCount({ count }: { count: number }) {
  if (count === 0) return <span className="text-ink-2">None open</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-warn-ink">
      <span aria-hidden className="size-1.5 rounded-full bg-warn" />
      {count} open
    </span>
  );
}

function CaseTable({ cases }: { cases: CaseSummaryDto[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-[10px] border border-line bg-surface md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Shipments</caption>
          <thead className="border-b border-line bg-sunken/60 text-xs text-ink-2">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Case</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Supplier</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Invoice · PO</th>
              <th scope="col" className="px-4 py-2.5 font-medium">State</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Next action</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Issues</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="group relative border-b border-line last:border-0 hover:bg-sunken/50" data-testid="case-row">
                <td className="px-4 py-3">
                  <Link href={`/shipments/${c.caseCode}`} className="tnum font-semibold text-ink after:absolute after:inset-0 group-hover:text-accent">
                    {c.caseCode}
                  </Link>
                </td>
                <td className="max-w-[220px] truncate px-4 py-3" title={c.supplierName ?? undefined}>
                  {c.supplierName ?? <span className="text-ink-2">Not read yet</span>}
                </td>
                <td className="tnum px-4 py-3 text-ink-2">
                  <span className="text-ink">{c.invoiceReference ?? "—"}</span>
                  <span className="block text-xs">{c.purchaseOrder ?? "No PO"}</span>
                </td>
                <td className="px-4 py-3">
                  <StateBadge state={c.state} />
                </td>
                <td className="max-w-[260px] px-4 py-3 text-ink-2">{c.nextAction}</td>
                <td className="tnum px-4 py-3">
                  <IssueCount count={c.openIssueCount} />
                </td>
                <td className="tnum whitespace-nowrap px-4 py-3 text-right text-ink-2">
                  <time dateTime={c.updatedAt} title={formatDateTime(c.updatedAt)}>
                    {formatRelative(c.updatedAt)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden" aria-label="Shipments">
        {cases.map((c) => (
          <li key={c.id} className="relative rounded-[10px] border border-line bg-surface p-4" data-testid="case-row-mobile">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/shipments/${c.caseCode}`} className="tnum font-semibold after:absolute after:inset-0">
                {c.caseCode}
              </Link>
              <StateBadge state={c.state} />
            </div>
            <p className="mt-1 truncate text-ink-2">{c.supplierName ?? "Supplier not read yet"}</p>
            <p className="mt-2 text-sm">{c.nextAction}</p>
            <div className="tnum mt-3 flex items-center justify-between text-xs text-ink-2">
              <span>
                {c.invoiceReference ?? "No invoice ref"} · <IssueCount count={c.openIssueCount} />
              </span>
              <time dateTime={c.updatedAt}>{formatRelative(c.updatedAt)}</time>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
