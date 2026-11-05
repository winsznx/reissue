"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { DocumentDto, DocumentVersionDto, LineItemDto } from "@reissue/contracts";

import { errorMessage, pageImageUrl, sendFiles, versionFileUrl } from "@/lib/api";
import { CHECK_STATUS_LABEL, formatDate, formatDateTime } from "@/lib/format";
import type { ComparedDocType, Mark } from "@/lib/evidence";
import type { ReplacementResponse } from "@/lib/types";

import { ACCEPTED_FILES } from "../intake-dropzone";
import { DocIcon, SpinnerIcon, UploadIcon } from "../icons";
import { cx } from "../ui";

interface DocumentViewerProps {
  caseCode: string;
  docType: ComparedDocType;
  title: string;
  doc: DocumentDto | null;
  version: DocumentVersionDto | null;
  page: number | null;
  marks: Mark[];
  lineItems: LineItemDto[];
  focusToken: number;
  onSelectVersion: (versionId: string) => void;
  onSelectPage: (page: number) => void;
  onSelectMark: (checkKey: string) => void;
  onReplaced: () => void;
}

const MARK_TONE: Record<Mark["status"], string> = {
  MATCH: "border-ok bg-ok/15",
  MISMATCH: "border-warn bg-warn/20",
  MISSING: "border-danger bg-danger/15",
  AMBIGUOUS: "border-warn bg-warn/15 border-dashed",
  NOT_COMPARABLE: "border-ink-2 bg-ink-2/10 border-dashed",
};

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function provenance(version: DocumentVersionDto): string {
  const parts = [`Received ${formatDateTime(version.receivedAt)}`];
  if (version.senderRef) parts.push(`from ${version.senderRef}`);
  parts.push(`via ${version.sourcePlatform}`);
  return parts.join(" ");
}

export function DocumentViewer(props: DocumentViewerProps) {
  const { caseCode, title, doc, version, page, marks, lineItems, focusToken, onSelectVersion, onSelectPage, onSelectMark, onReplaced } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const [showLines, setShowLines] = useState(true);
  const pageInfo = version?.pages.find((p) => p.page === page) ?? version?.pages[0] ?? null;
  const pageIndex = version && pageInfo ? version.pages.indexOf(pageInfo) : -1;

  useEffect(() => {
    if (!focusToken) return;
    const target = stageRef.current?.querySelector<HTMLElement>("[data-selected='true']");
    if (!target || !stageRef.current) return;
    const stage = stageRef.current;
    const top = target.offsetTop - stage.clientHeight / 2 + target.offsetHeight / 2;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  }, [focusToken, version?.id, pageInfo?.page]);

  const headingId = `viewer-${props.docType}`;

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col rounded-[10px] border border-line bg-surface" data-testid={`viewer-${props.docType}`}>
      <header className="space-y-2 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 id={headingId} className="flex items-center gap-2 text-[0.8125rem] font-semibold">
            <DocIcon className="text-ink-2" />
            {title}
          </h3>
          {doc ? <ReplacementUpload caseCode={caseCode} documentId={doc.id} title={title} onReplaced={onReplaced} /> : null}
        </div>
        {doc && doc.versions.length > 0 ? (
          <div role="radiogroup" aria-label={`${title} version`} className="flex flex-wrap gap-1.5">
            {[...doc.versions].reverse().map((v) => {
              const active = v.id === version?.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelectVersion(v.id)}
                  className={cx(
                    "tnum inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-xs transition-colors duration-150",
                    active ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink-2 hover:text-ink",
                  )}
                  data-testid="version-chip"
                >
                  <span className="font-semibold">v{v.versionNo}</span>
                  <span className={cx(active ? "text-canvas/80" : undefined)}>{v.isCurrent ? "Current" : v.state === "SUPERSEDED" ? "Superseded" : v.state.toLowerCase()}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {version ? (
          <p className="text-xs text-ink-2">
            <span className="font-medium text-ink">{version.originalFilename}</span>
            {version.revisionLabel ? ` · Rev ${version.revisionLabel}` : ""}
            {version.documentDate ? ` · Dated ${formatDate(version.documentDate)}` : ""}
            <span className="block">{provenance(version)}</span>
          </p>
        ) : null}
      </header>

      {!version || !pageInfo ? (
        <div className="grid flex-1 place-items-center px-6 py-16 text-center text-ink-2">
          <div>
            <p className="font-medium text-ink">No {title.toLowerCase()} yet</p>
            <p className="mt-1 max-w-[36ch] text-sm">
              {version ? "This version has no readable pages. Open the file to inspect it." : "Reissue compares this document once it arrives in the chat or is uploaded."}
            </p>
            {version ? (
              <a href={versionFileUrl(version.id)} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
                Open original file
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div ref={stageRef} className="relative h-[min(72vh,820px)] overflow-auto bg-sunken p-3 md:p-4" tabIndex={0} aria-label={`${title} page ${pageInfo.page}`}>
            <div className="relative mx-auto w-full max-w-[720px] bg-paper shadow-doc" style={{ aspectRatio: `${pageInfo.width} / ${pageInfo.height}` }}>
              <Image
                key={`${version.id}:${pageInfo.page}`}
                src={pageImageUrl(version.id, pageInfo.page)}
                alt={`${title} v${version.versionNo}, page ${pageInfo.page}`}
                width={Math.round(pageInfo.width * 2)}
                height={Math.round(pageInfo.height * 2)}
                unoptimized
                priority
                className="block h-auto w-full select-none"
                data-testid="page-image"
              />
              {showLines
                ? lineItems.map((line) =>
                    line.bbox && line.page === pageInfo.page ? (
                      <span
                        key={line.id}
                        aria-hidden
                        className="pointer-events-none absolute rounded-[3px] border border-accent/25"
                        style={{
                          left: pct(line.bbox[0], pageInfo.width),
                          top: pct(line.bbox[1], pageInfo.height),
                          width: pct(line.bbox[2] - line.bbox[0], pageInfo.width),
                          height: pct(line.bbox[3] - line.bbox[1], pageInfo.height),
                        }}
                      />
                    ) : null,
                  )
                : null}
              {marks.map((mark, index) => (
                <button
                  key={`${mark.key}:${index}`}
                  type="button"
                  onClick={() => onSelectMark(mark.key)}
                  aria-pressed={mark.selected}
                  aria-label={`${mark.label}: ${mark.value}. ${CHECK_STATUS_LABEL[mark.status]}`}
                  data-selected={mark.selected}
                  data-testid="evidence-mark"
                  data-status={mark.status}
                  className={cx(
                    "absolute rounded-[6px] border-[1.5px] transition-[box-shadow,background-color] duration-200",
                    MARK_TONE[mark.status],
                    mark.selected && "z-10 border-2 border-accent! ring-4 ring-accent/20 mark-focused",
                    mark.resolving && "mark-resolving",
                  )}
                  style={{
                    left: `calc(${pct(mark.bbox[0], pageInfo.width)} - 3px)`,
                    top: `calc(${pct(mark.bbox[1], pageInfo.height)} - 3px)`,
                    width: `calc(${pct(mark.bbox[2] - mark.bbox[0], pageInfo.width)} + 6px)`,
                    height: `calc(${pct(mark.bbox[3] - mark.bbox[1], pageInfo.height)} + 6px)`,
                  }}
                >
                  {mark.selected ? (
                    <span className="tnum pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded-[4px] bg-accent px-1.5 py-0.5 text-[0.6875rem] font-semibold text-accent-ink shadow-sm">
                      {mark.value}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-xs text-ink-2">
            <div className="flex items-center gap-2">
              {version.pages.length > 1 ? (
                <nav aria-label={`${title} pages`} className="flex items-center gap-1">
                  {version.pages.map((p) => (
                    <button
                      key={p.page}
                      type="button"
                      aria-current={p.page === pageInfo.page ? "page" : undefined}
                      onClick={() => onSelectPage(p.page)}
                      className={cx("tnum h-6 min-w-6 rounded-[5px] px-1.5", p.page === pageInfo.page ? "bg-ink text-canvas" : "hover:bg-sunken")}
                    >
                      {p.page}
                    </button>
                  ))}
                </nav>
              ) : (
                <span className="tnum">
                  Page {pageIndex + 1} of {version.pages.length}
                </span>
              )}
              {pageInfo.ocr ? <span className="rounded-[4px] bg-sunken px-1.5 py-0.5">Read with OCR</span> : null}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} className="accent-[var(--accent)]" />
                Extracted lines
              </label>
              <a href={versionFileUrl(version.id)} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                Open PDF
              </a>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}

function ReplacementUpload({ caseCode, documentId, title, onReplaced }: { caseCode: string; documentId: string; title: string; onReplaced: () => void }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "pending" } | { kind: "done"; message: string } | { kind: "error"; message: string }>({ kind: "idle" });
  const inputId = `replace-${documentId}`;

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setState({ kind: "pending" });
    try {
      const result = await sendFiles<ReplacementResponse>(`/v1/cases/${encodeURIComponent(caseCode)}/documents/${encodeURIComponent(documentId)}/replacements`, [file]);
      setState(
        result.accepted.length
          ? { kind: "done", message: `${file.name} received. Rechecking.` }
          : { kind: "error", message: result.duplicates.length ? `${file.name} is already on file.` : `${file.name} was not accepted.` },
      );
      onReplaced();
    } catch (err) {
      setState({ kind: "error", message: errorMessage(err) });
    }
  }

  return (
    <div className="flex items-center gap-2">
      {state.kind === "done" || state.kind === "error" ? (
        <span role="status" className={cx("max-w-[18ch] truncate text-xs sm:max-w-[28ch]", state.kind === "error" ? "text-danger" : "text-ok-ink")}>
          {state.message}
        </span>
      ) : null}
      <label
        htmlFor={inputId}
        className="relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] border border-line-strong px-2.5 text-xs font-medium text-ink hover:bg-sunken focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)]"
      >
        {state.kind === "pending" ? <SpinnerIcon size={13} /> : <UploadIcon size={13} />}
        Replace
        <span className="sr-only"> {title} with a revised file</span>
        <input id={inputId} type="file" accept={ACCEPTED_FILES} className="sr-only" disabled={state.kind === "pending"} onChange={(e) => void upload(e.currentTarget.files)} />
      </label>
    </div>
  );
}
