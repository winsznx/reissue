"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { CaseDetailDto, CheckResult } from "@reissue/contracts";
import { isIssueOpen } from "@reissue/core";

import { ApiError, errorMessage } from "@/lib/api";
import { useCaseStream, type StreamStatus } from "@/lib/case-stream";
import { deriveLifecycle } from "@/lib/events";
import { COMPARED_DOC_TYPES, currentVersion, documentFor, marksForPage, newlyResolved, sideValue, sidesOf, versionById, type ComparedDocType } from "@/lib/evidence";
import { DOC_TYPE_LABEL } from "@/lib/format";
import { useCaseDetail } from "@/lib/queries";

import { PacketIcon } from "../icons";
import { CheckBadge, ErrorNotice, LoadingBlock, Panel, Skeleton, StateBadge, buttonClass, cx } from "../ui";
import { ChatLinksPanel, PacketPanel, StatusPanel, TasksPanel } from "./case-rail";
import { ChecksTable } from "./checks-table";
import { DecisionPanel } from "./decision-panel";
import { DocumentViewer } from "./document-viewer";
import { IssuesList } from "./issues-list";
import { LifecycleStrip } from "./lifecycle-strip";
import { Timeline } from "./timeline";

type ViewerOverride = { versionId: string; page: number | null };

const RESOLVE_HIGHLIGHT_MS = 1600;
const REFRESH_DEBOUNCE_MS = 120;

export function CaseView({ code }: { code: string }) {
  const { data: detail, error, isLoading, mutate } = useCaseDetail(code);
  const [selection, setSelection] = useState<{ key: string | null; token: number }>({ key: null, token: 0 });
  const [overrides, setOverrides] = useState<Partial<Record<ComparedDocType, ViewerOverride>>>({});
  const [resolving, setResolving] = useState<ReadonlySet<string>>(new Set());
  const latestChecks = useRef<CheckResult[] | undefined>(undefined);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    latestChecks.current = detail?.checks;
  }, [detail]);

  useEffect(
    () => () => {
      clearTimeout(refreshTimer.current);
      clearTimeout(resolveTimer.current);
    },
    [],
  );

  const refresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      const before = latestChecks.current;
      mutate()
        .then((next) => {
          const keys = next ? newlyResolved(before, next.checks) : [];
          if (!keys.length) return;
          setResolving(new Set(keys));
          clearTimeout(resolveTimer.current);
          resolveTimer.current = setTimeout(() => setResolving(new Set()), RESOLVE_HIGHLIGHT_MS);
        })
        .catch((err: unknown) => console.warn("Case refresh failed", err));
    }, REFRESH_DEBOUNCE_MS);
  }, [mutate]);

  const { events, status } = useCaseStream(code, refresh);

  const selectCheck = useCallback((key: string) => {
    setSelection((s) => ({ key, token: s.token + 1 }));
    setOverrides({});
  }, []);

  if (error && !detail) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="mx-auto max-w-xl py-16 text-center">
          <h1 className="font-serif text-2xl font-medium">No case {code}</h1>
          <p className="mt-2 text-ink-2">Check the case code, or find it from the shipments list.</p>
          <Link href="/shipments" className={cx(buttonClass("secondary"), "mt-6")}>
            Back to shipments
          </Link>
        </div>
      );
    }
    return <ErrorNotice error={errorMessage(error)} onRetry={() => void mutate()} />;
  }

  if (isLoading || !detail) return <CaseSkeleton code={code} />;

  return (
    <CaseLayout
      detail={detail}
      events={events}
      streamStatus={status}
      selectedKey={selection.key}
      focusToken={selection.token}
      overrides={overrides}
      resolving={resolving}
      onSelectCheck={selectCheck}
      onClearSelection={() => setSelection((s) => ({ key: null, token: s.token }))}
      onOverride={(docType, override) => setOverrides((o) => ({ ...o, [docType]: override }))}
      onChanged={refresh}
    />
  );
}

interface CaseLayoutProps {
  detail: CaseDetailDto;
  events: ReturnType<typeof useCaseStream>["events"];
  streamStatus: StreamStatus;
  selectedKey: string | null;
  focusToken: number;
  overrides: Partial<Record<ComparedDocType, ViewerOverride>>;
  resolving: ReadonlySet<string>;
  onSelectCheck: (key: string) => void;
  onClearSelection: () => void;
  onOverride: (docType: ComparedDocType, override: ViewerOverride) => void;
  onChanged: () => void;
}

function CaseLayout(props: CaseLayoutProps) {
  const { detail, events, streamStatus, selectedKey, focusToken, overrides, resolving, onSelectCheck, onClearSelection, onOverride, onChanged } = props;
  const selected = detail.checks.find((c) => c.key === selectedKey) ?? null;
  const lifecycle = useMemo(() => deriveLifecycle(events, detail.state), [events, detail.state]);
  const issueCodes = useMemo(() => new Map(detail.issues.map((i) => [i.id, i.code])), [detail.issues]);
  const openIssues = detail.issues.filter((i) => isIssueOpen(i.status));
  const needsDecision = openIssues.length > 0 || detail.state === "NEEDS_CLARIFICATION" || detail.state === "ERROR_RECOVERABLE";
  const decision = <DecisionPanel detail={detail} onChanged={onChanged} />;
  const [mobileDoc, setMobileDoc] = useState<ComparedDocType>("COMMERCIAL_INVOICE");
  const scrollerRef = useRef<HTMLDivElement>(null);

  const correctedKeys = useMemo(() => new Set(detail.issues.filter((i) => !isIssueOpen(i.status)).flatMap((i) => i.checkKeys)), [detail.issues]);

  function selectFromList(key: string) {
    onSelectCheck(key);
    const compare = document.getElementById("compare");
    if (compare && compare.getBoundingClientRect().top < 0) {
      compare.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }

  const viewers = COMPARED_DOC_TYPES.map((docType) => {
    const doc = documentFor(detail.documents, docType);
    const override = overrides[docType];
    const side = selected ? sidesOf(selected)[docType === "COMMERCIAL_INVOICE" ? "invoice" : "packing"] : null;
    const version = (override ? versionById(doc, override.versionId) : side ? versionById(doc, side.versionId) : null) ?? currentVersion(doc);
    const page = override?.page ?? (side && side.versionId === version?.id ? (side.source?.page ?? null) : null) ?? version?.pages[0]?.page ?? null;
    const marks = version && page !== null ? marksForPage(detail.checks, version.id, page, selectedKey, resolving, correctedKeys) : [];
    const lineItems = version ? detail.lineItems.filter((l) => l.versionId === version.id) : [];
    return { docType, doc, version, page, marks, lineItems };
  });

  function showMobileDoc(docType: ComparedDocType) {
    setMobileDoc(docType);
    const index = COMPARED_DOC_TYPES.indexOf(docType);
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTo({ left: index * scroller.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function onScrollerScroll() {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const index = Math.round(scroller.scrollLeft / scroller.clientWidth);
    const docType = COMPARED_DOC_TYPES[index];
    if (docType && docType !== mobileDoc) setMobileDoc(docType);
  }

  function onCompareKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && selectedKey) onClearSelection();
  }

  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-2">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/shipments" className="hover:text-ink">
                Reissue
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href="/shipments" className="hover:text-ink">
                Shipments
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="tnum font-medium text-ink">
              {detail.caseCode}
            </li>
          </ol>
        </nav>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="tnum font-serif text-[2.25rem] font-medium leading-none tracking-[-0.02em]">{detail.caseCode}</h1>
              <LiveIndicator status={streamStatus} />
            </div>
            <p className="mt-2 text-[0.9375rem] text-ink">{detail.supplierName ?? "Supplier not read yet"}</p>
            <dl className="tnum mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <div className="flex gap-1">
                <dt>Invoice</dt>
                <dd className="font-medium text-ink">{detail.invoiceReference ?? "not read"}</dd>
              </div>
              <div className="flex gap-1">
                <dt>PO</dt>
                <dd className="font-medium text-ink">{detail.purchaseOrder ?? "not stated"}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Documents</dt>
                <dd className="font-medium text-ink">{detail.documents.reduce((n, d) => n + d.versions.length, 0)} files</dd>
              </div>
            </dl>
          </div>
          <div className="flex items-center gap-2">
            <a href="#packet" className={buttonClass(detail.artifacts.some((a) => !a.superseded) ? "primary" : "secondary")}>
              <PacketIcon size={15} />
              Current packet
            </a>
          </div>
        </div>
        <div className="rounded-[10px] border border-line bg-surface px-4 pb-3 pt-4">
          <LifecycleStrip steps={lifecycle} />
        </div>
      </header>

      <div className="sticky top-[97px] z-20 -mx-4 flex items-center gap-3 border-y border-line bg-canvas/95 px-4 py-2 md:hidden">
        <StateBadge state={detail.state} />
        <p className="min-w-0 flex-1 truncate text-xs text-ink">{detail.nextAction}</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <section id="compare" aria-labelledby="arrived-title" onKeyDown={onCompareKeyDown} className="scroll-mt-[150px] space-y-3 md:scroll-mt-[72px]">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 id="arrived-title" className="text-[0.8125rem] font-semibold">
                What arrived
              </h2>
              <p className="text-xs text-ink-2">Select a difference or a check to place both documents on the cited line.</p>
            </div>
            <EvidenceBar selected={selected} openCount={openIssues.length} onClear={onClearSelection} />
            <div role="tablist" aria-label="Document" className="grid grid-cols-2 rounded-[8px] border border-line bg-surface p-0.5 text-sm md:hidden">
              {COMPARED_DOC_TYPES.map((docType) => (
                <button
                  key={docType}
                  type="button"
                  role="tab"
                  aria-selected={mobileDoc === docType}
                  aria-controls={`viewer-panel-${docType}`}
                  onClick={() => showMobileDoc(docType)}
                  className={cx("rounded-[6px] py-1.5 font-medium", mobileDoc === docType ? "bg-ink text-canvas" : "text-ink-2")}
                >
                  {DOC_TYPE_LABEL[docType]}
                </button>
              ))}
            </div>
            <div
              ref={scrollerRef}
              onScroll={onScrollerScroll}
              className="relative -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0"
            >
              {viewers.map((viewer) => (
                <div key={viewer.docType} id={`viewer-panel-${viewer.docType}`} className="w-full shrink-0 snap-center md:w-auto">
                  <DocumentViewer
                    caseCode={detail.caseCode}
                    docType={viewer.docType}
                    title={DOC_TYPE_LABEL[viewer.docType]}
                    doc={viewer.doc}
                    version={viewer.version}
                    page={viewer.page}
                    marks={viewer.marks}
                    lineItems={viewer.lineItems}
                    focusToken={focusToken}
                    onSelectVersion={(versionId) => onOverride(viewer.docType, { versionId, page: null })}
                    onSelectPage={(page) => viewer.version && onOverride(viewer.docType, { versionId: viewer.version.id, page })}
                    onSelectMark={onSelectCheck}
                    onReplaced={onChanged}
                  />
                </div>
              ))}
            </div>
            <OtherDocuments detail={detail} />
          </section>

          <Panel title="What differed" id="issues" action={<span className="tnum text-xs text-ink-2">{openIssues.length} open · {detail.issues.length - openIssues.length} resolved</span>}>
            <IssuesList detail={detail} selectedKey={selectedKey} onSelect={selectFromList} />
          </Panel>

          <Panel title="Checks" id="checks" action={<span className="tnum text-xs text-ink-2">{detail.checks.length} compared</span>}>
            <ChecksTable checks={detail.checks} selectedKey={selectedKey} onSelect={selectFromList} />
          </Panel>

          <Panel title="What changed" id="activity" action={<LiveIndicator status={streamStatus} />}>
            <Timeline events={events} />
          </Panel>
        </div>

        <aside aria-label="Case status and actions" className="min-w-0 space-y-5 xl:sticky xl:top-[72px] xl:max-h-[calc(100dvh-88px)] xl:overflow-y-auto xl:pb-2">
          <StatusPanel detail={detail} onChanged={onChanged} />
          {needsDecision ? decision : null}
          <TasksPanel tasks={detail.tasks} issueCodes={issueCodes} />
          <PacketPanel detail={detail} onChanged={onChanged} />
          <ChatLinksPanel links={detail.chatLinks} />
          {needsDecision ? null : decision}
        </aside>
      </div>
    </div>
  );
}

function LiveIndicator({ status }: { status: StreamStatus }) {
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Reconnecting";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" role="status" data-testid="stream-status" data-status={status}>
      <span aria-hidden className={cx("size-1.5 rounded-full", status === "live" ? "live-dot bg-accent" : "bg-line-strong")} />
      {label}
    </span>
  );
}

function EvidenceBar({ selected, openCount, onClear }: { selected: CheckResult | null; openCount: number; onClear: () => void }) {
  if (!selected) {
    return (
      <div className="flex min-h-12 items-center rounded-[10px] border border-dashed border-line-strong px-4 py-2.5 text-sm text-ink-2" data-testid="evidence-bar">
        {openCount ? `${openCount} open difference${openCount === 1 ? "" : "s"} marked on the pages. Select one to compare the cited lines.` : "No open differences. Select any check to see where each value was read."}
      </div>
    );
  }
  const { invoice, packing } = sidesOf(selected);
  return (
    <div
      className={cx("grid gap-x-4 gap-y-2 rounded-[10px] border bg-surface px-4 py-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center", selected.status === "MATCH" ? "border-ok/50" : "border-warn/60")}
      data-testid="evidence-bar"
      aria-live="polite"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{selected.label}</p>
        <p className="truncate text-xs text-ink-2">{selected.detail}</p>
      </div>
      <SideSummary title="Commercial invoice" side={invoice} />
      <SideSummary title="Packing list" side={packing} warn={selected.status !== "MATCH"} />
      <div className="flex items-center gap-2">
        <CheckBadge status={selected.status} />
        <button type="button" onClick={onClear} className="rounded px-1 text-xs font-medium text-ink-2 hover:text-ink">
          Clear
        </button>
      </div>
    </div>
  );
}

function SideSummary({ title, side, warn }: { title: string; side: CheckResult["lhs"]; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.6875rem] text-ink-2">
        {title}
        {side?.source ? <span className="tnum"> · p.{side.source.page}</span> : null}
      </p>
      <p className={cx("tnum truncate text-[0.9375rem] font-semibold", warn && side ? "text-warn-ink" : "text-ink")}>{side ? sideValue(side) : "Not part of this check"}</p>
    </div>
  );
}

function OtherDocuments({ detail }: { detail: CaseDetailDto }) {
  const others = detail.documents.filter((d) => !COMPARED_DOC_TYPES.some((t) => t === d.docType));
  if (!others.length) return null;
  return (
    <p className="text-xs text-ink-2">
      Also on file:{" "}
      {others
        .map((d) => `${DOC_TYPE_LABEL[d.docType]} (${d.versions.length} file${d.versions.length === 1 ? "" : "s"}${d.versions.some((v) => v.state === "QUARANTINED") ? ", held for review" : ""})`)
        .join(", ")}
    </p>
  );
}

function CaseSkeleton({ code }: { code: string }) {
  return (
    <div className="space-y-5" aria-busy>
      <h1 className="tnum font-serif text-[2.25rem] font-medium leading-none">{code}</h1>
      <Skeleton className="h-16" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[520px]" />
          <Skeleton className="hidden h-[520px] md:block" />
        </div>
        <LoadingBlock label={`Loading ${code}`} rows={6} />
      </div>
    </div>
  );
}
