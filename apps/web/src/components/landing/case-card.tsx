import type { ReactElement, ReactNode } from "react";

import { cx } from "@/components/ui";

import { CORRECTION_MOTION as MOTION } from "./correction-motion";
import { StatePill } from "./primitives";

const CASE_FACTS = [
  { term: "Seller", detail: "Hangzhou Lumen Lighting Co., Ltd." },
  { term: "Buyer", detail: "Northfield Home Goods B.V., Rotterdam" },
  { term: "Invoice", detail: "LUM-2026-0417" },
  { term: "PO", detail: "NHG-PO-88213" },
] as const;

const GREEKED_ROW_WIDTHS = ["w-[70%]", "w-[54%]"] as const;

const CROSSFADE_TIMING = {
  detail: { before: MOTION.detailBeforeFades, after: MOTION.detailAfterAppears },
  state: { before: MOTION.stateBeforeFades, after: MOTION.stateAfterAppears },
} as const;

const QUANTITY_CLASS = "tnum relative inline-block pt-[0.62em] text-[2.25rem] font-semibold leading-none tracking-[-0.02em] sm:text-[2.75rem]";

function Crossfade({ before, after, timing, className }: { before: ReactNode; after: ReactNode; timing: keyof typeof CROSSFADE_TIMING; className?: string }): ReactElement {
  return (
    <span className={cx("grid", className)}>
      <span aria-hidden="true" className={cx("[grid-area:1/1]", CROSSFADE_TIMING[timing].before)}>
        {before}
      </span>
      <span className={cx("[grid-area:1/1]", CROSSFADE_TIMING[timing].after)}>{after}</span>
    </span>
  );
}

function GreekedRows(): ReactElement {
  return (
    <span aria-hidden="true" className="mt-3 block space-y-2 px-2.5">
      {GREEKED_ROW_WIDTHS.map((width) => (
        <span key={width} className="flex items-center gap-2">
          <span className="h-1 w-3 rounded-full bg-line" />
          <span className={cx("h-1 rounded-full bg-line", width)} />
          <span className="ml-auto h-1 w-6 rounded-full bg-line" />
        </span>
      ))}
    </span>
  );
}

function DocumentTile({ title, file, rowClassName, children }: { title: string; file: ReactNode; rowClassName: string; children: ReactNode }): ReactElement {
  return (
    <div className="min-w-0 rounded-mark bg-surface p-3 shadow-doc sm:p-4">
      <p className="text-xs font-semibold text-ink">{title}</p>
      <p className="mt-0.5 text-xs text-ink-2">{file}</p>
      <GreekedRows />
      <div className={cx("mt-2 rounded-sm border px-2.5 pb-2.5 pt-2", rowClassName)}>{children}</div>
      <p className="mt-2 text-xs text-ink-2">p. 1, row 3</p>
    </div>
  );
}

function RowHeader({ detail }: { detail: ReactNode }): ReactElement {
  return (
    <span className="flex items-center justify-between gap-2 text-xs text-ink-2">
      <span>Row 3</span>
      <span className="tnum font-medium text-ink">{detail}</span>
    </span>
  );
}

function InvoiceTile(): ReactElement {
  return (
    <DocumentTile title="Commercial invoice" file="invoice-v1.pdf" rowClassName="border-line-strong bg-canvas">
      <RowHeader detail="LL-STR-050" />
      <p className="flex items-baseline gap-1.5">
        <span className={cx(QUANTITY_CLASS, "text-ink")}>500</span>
        <span className="text-sm font-medium text-ink-2">pcs</span>
      </p>
    </DocumentTile>
  );
}

function PackingListTile(): ReactElement {
  return (
    <DocumentTile
      title="Packing list"
      file={<Crossfade timing="detail" before="packing-list-v1.pdf" after="packing-list-v2.pdf, Revision 2" />}
      rowClassName={cx("border-ok/45 bg-ok-soft", MOTION.rowSettles)}
    >
      <RowHeader detail={<Crossfade timing="detail" className="justify-items-end" before="10 cartons × 48" after="10 cartons × 50" />} />
      <p className="flex items-baseline gap-1.5">
        <span className={QUANTITY_CLASS}>
          <del className={cx("absolute bottom-0 left-0 origin-bottom-left translate-y-[-112%] scale-[0.42] text-ink-2 no-underline", MOTION.oldValueLifts)}>
            480
            <span aria-hidden="true" className={cx("absolute inset-x-[-0.06em] top-[52%] h-[0.09em] origin-left rounded-full bg-danger", MOTION.strikeDraws)} />
          </del>
          <ins className={cx("block text-ok no-underline", MOTION.newValueLands)}>500</ins>
        </span>
        <span className="text-sm font-medium text-ink-2">pcs</span>
      </p>
    </DocumentTile>
  );
}

function RelationMark(): ReactElement {
  return (
    <span aria-hidden="true" className="flex justify-center">
      <span className={cx("grid size-9 place-items-center rounded-full bg-ok-soft text-lg font-semibold leading-none text-ok-ink", MOTION.relationSettles)}>
        <span className={cx("[grid-area:1/1]", MOTION.detailBeforeFades)}>≠</span>
        <span className={cx("[grid-area:1/1]", MOTION.detailAfterAppears)}>=</span>
      </span>
    </span>
  );
}

export function CaseCard({ className }: { className?: string }): ReactElement {
  return (
    <div className={cx("min-w-0 rounded-xl border border-line bg-surface shadow-doc", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-5 sm:px-6">
        <p className="tnum font-serif text-[1.75rem] font-medium leading-none tracking-[-0.01em] text-ink">SHP-0287</p>
        <Crossfade
          timing="state"
          className="justify-items-end"
          before={<StatePill tone="warn">Waiting on supplier</StatePill>}
          after={<StatePill tone="ok">Ready for broker review</StatePill>}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line px-4 py-3.5 text-xs sm:px-6">
        {CASE_FACTS.map((fact) => (
          <div key={fact.term} className="min-w-0">
            <dt className="text-ink-2">{fact.term}</dt>
            <dd className="mt-0.5 font-medium text-ink">{fact.detail}</dd>
          </div>
        ))}
      </dl>
      <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.9375rem] font-semibold text-ink">
            <span className="tnum mr-2 text-ink-2">D-001</span>
            Quantity mismatch
          </p>
          <Crossfade
            timing="state"
            className="justify-items-end text-xs font-medium"
            before={<span className="text-danger">Open</span>}
            after={<span className="text-ok-ink">Resolved</span>}
          />
        </div>
        <p className="mt-1 text-sm text-ink-2">
          <span className="mr-2 font-medium text-ink">LL-STR-050</span>
          LED string lights, warm white, 5&nbsp;m
        </p>
        <div className="mt-4 grid gap-3 rounded-panel bg-sunken p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-4 sm:p-4">
          <InvoiceTile />
          <RelationMark />
          <PackingListTile />
        </div>
        <p className="sr-only">
          The packing list said 480 pcs against the invoice&rsquo;s 500 pcs. The supplier&rsquo;s Revision 2 says 500 pcs, and the recheck made the case ready for
          broker review.
        </p>
      </div>
    </div>
  );
}
