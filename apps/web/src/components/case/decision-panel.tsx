"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { ResponsibleRole, Unit, type CaseDetailDto, type ClarifyRequest, type IssueDto, type LineItemDto } from "@reissue/contracts";
import { isIssueOpen } from "@reissue/core";

import { errorMessage, sendJson } from "@/lib/api";
import { currentVersion, documentFor, sidesOf } from "@/lib/evidence";
import { ROLE_LABEL, UNIT_LABEL, formatQuantity } from "@/lib/format";

import { RefreshIcon } from "../icons";
import { Button, FieldLabel, Panel, cx, inputClass } from "../ui";

type Mode = "conversion" | "mapping" | "reassign";

const MODES: { id: Mode; label: string }[] = [
  { id: "conversion", label: "Pack size" },
  { id: "mapping", label: "Line mapping" },
  { id: "reassign", label: "Reassign" },
];

const LINE_REF = /^line:(\d+)\./;

function defaultMode(issue: IssueDto): Mode {
  if (issue.kind === "UNIT_NOT_COMPARABLE") return "conversion";
  if (issue.kind === "LINE_UNMATCHED" || issue.kind === "AMBIGUOUS_MAPPING") return "mapping";
  return issue.needsHumanFact ? "conversion" : "reassign";
}

function linesOf(detail: CaseDetailDto, docType: "COMMERCIAL_INVOICE" | "PACKING_LIST"): LineItemDto[] {
  const version = currentVersion(documentFor(detail.documents, docType));
  return version ? detail.lineItems.filter((l) => l.versionId === version.id).sort((a, b) => a.rowIndex - b.rowIndex) : [];
}

function lineLabel(line: LineItemDto): string {
  return `Row ${line.rowIndex + 1} · ${line.sku ?? line.description.slice(0, 28)} · ${formatQuantity(line.quantity, line.unit)}`;
}

/** Prefills the fact forms from the issue's first check so the coordinator confirms rather than retypes. */
function issueContext(detail: CaseDetailDto, issue: IssueDto) {
  const check = detail.checks.find((c) => c.key === issue.checkKeys[0]);
  const { invoice, packing } = check ? sidesOf(check) : { invoice: null, packing: null };
  const invoiceRow = invoice ? Number(LINE_REF.exec(invoice.ref)?.[1] ?? NaN) : NaN;
  const packingRow = packing ? Number(LINE_REF.exec(packing.ref)?.[1] ?? NaN) : NaN;
  const invoiceLine = linesOf(detail, "COMMERCIAL_INVOICE").find((l) => l.rowIndex === invoiceRow);
  return {
    sku: invoiceLine?.sku ?? "",
    fromUnit: packing?.unit ?? "carton",
    toUnit: invoice?.unit ?? "pcs",
    invoiceRow: Number.isNaN(invoiceRow) ? null : invoiceRow,
    packingRow: Number.isNaN(packingRow) ? null : packingRow,
  };
}

export function DecisionPanel({ detail, onChanged }: { detail: CaseDetailDto; onChanged: () => void }) {
  const open = detail.issues.filter((i) => isIssueOpen(i.status));
  const [issueId, setIssueId] = useState<string | null>(null);
  const issue = open.find((i) => i.id === issueId) ?? open.find((i) => i.needsHumanFact) ?? open[0] ?? null;

  return (
    <Panel title="Human decision" id="decision" action={<RecheckButton caseCode={detail.caseCode} onChanged={onChanged} />}>
      {issue ? (
        <div className="px-4 py-3">
          {open.length > 1 ? (
            <div className="mb-3">
              <FieldLabel htmlFor="decision-issue">Issue</FieldLabel>
              <select id="decision-issue" value={issue.id} onChange={(e) => setIssueId(e.target.value)} className={inputClass}>
                {open.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} · {i.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mb-3 text-sm">
              <span className="tnum font-semibold text-warn-ink">{issue.code}</span> {issue.title}
            </p>
          )}
          <IssueDecision key={issue.id} detail={detail} issue={issue} onChanged={onChanged} />
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-ink-2">Nothing needs a decision. Recheck reprocesses the current documents if something looks off.</p>
      )}
    </Panel>
  );
}

function IssueDecision({ detail, issue, onChanged }: { detail: CaseDetailDto; issue: IssueDto; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>(defaultMode(issue));
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const context = issueContext(detail, issue);

  async function submit(path: string, body: unknown, success: string) {
    setPending(true);
    setResult(null);
    try {
      await sendJson("POST", path, body);
      setResult({ ok: true, message: success });
      onChanged();
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  function clarify(body: ClarifyRequest) {
    return submit(`/v1/issues/${encodeURIComponent(issue.id)}/clarify`, body, "Recorded. Reissue is recomputing the checks.");
  }

  function onConversion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const fromUnit = Unit.parse(f.get("fromUnit"));
    const toUnit = Unit.parse(f.get("toUnit"));
    void clarify({ kind: "conversion_factor", sku: String(f.get("sku")).trim(), fromUnit, toUnit, factor: String(f.get("factor")).trim(), sourceReference: String(f.get("sourceReference")).trim() });
  }

  function onMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void clarify({ kind: "line_mapping", invoiceRow: Number(f.get("invoiceRow")), packingRow: Number(f.get("packingRow")), sourceReference: String(f.get("sourceReference")).trim() });
  }

  function onReassign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const reason = String(f.get("reason") ?? "").trim();
    void submit(
      `/v1/issues/${encodeURIComponent(issue.id)}/reassign`,
      { responsibleRole: ResponsibleRole.parse(f.get("responsibleRole")), assignee: String(f.get("assignee")).trim(), ...(reason ? { reason } : {}) },
      "Reassigned.",
    );
  }

  const invoiceLines = linesOf(detail, "COMMERCIAL_INVOICE");
  const packingLines = linesOf(detail, "PACKING_LIST");
  const skus = Array.from(new Set(invoiceLines.flatMap((l) => (l.sku ? [l.sku] : []))));

  return (
    <div>
      <div role="tablist" aria-label="Decision type" className="mb-3 grid grid-cols-3 rounded-[8px] border border-line bg-sunken p-0.5 text-xs">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cx("rounded-[6px] px-2 py-1.5 font-medium transition-colors duration-150", mode === m.id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "conversion" ? (
        <form onSubmit={onConversion} className="space-y-3" aria-label="Record a sourced pack size">
          <p className="text-xs text-ink-2">Reissue never guesses a pack size. Record the factor and where it is stated.</p>
          <Field label="SKU" id="cf-sku">
            <input id="cf-sku" name="sku" list="cf-skus" required defaultValue={context.sku} className={inputClass} />
            <datalist id="cf-skus">
              {skus.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-end gap-1.5">
            <Field label="1" id="cf-from" srLabel="From unit">
              <UnitSelect id="cf-from" name="fromUnit" defaultValue={context.fromUnit} />
            </Field>
            <span className="pb-2 text-ink-2">=</span>
            <Field label="Factor" id="cf-factor">
              <input id="cf-factor" name="factor" required inputMode="decimal" pattern="\d+(\.\d+)?" placeholder="20" className={cx(inputClass, "tnum")} />
            </Field>
            <span className="pb-2 text-ink-2">×</span>
            <Field label="Unit" id="cf-to" srLabel="To unit">
              <UnitSelect id="cf-to" name="toUnit" defaultValue={context.toUnit} />
            </Field>
          </div>
          <SourceField id="cf-source" placeholder="e.g. Supplier spec sheet LL-SHD-090, p.2" />
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            Record pack size
          </Button>
        </form>
      ) : null}

      {mode === "mapping" ? (
        <form onSubmit={onMapping} className="space-y-3" aria-label="Map an invoice line to a packing-list line">
          <p className="text-xs text-ink-2">Confirm which packing-list row carries the same goods as the invoice row.</p>
          <Field label="Invoice row" id="lm-invoice">
            <select id="lm-invoice" name="invoiceRow" required defaultValue={context.invoiceRow ?? undefined} className={inputClass}>
              {invoiceLines.map((l) => (
                <option key={l.id} value={l.rowIndex}>
                  {lineLabel(l)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Packing-list row" id="lm-packing">
            <select id="lm-packing" name="packingRow" required defaultValue={context.packingRow ?? undefined} className={inputClass}>
              {packingLines.map((l) => (
                <option key={l.id} value={l.rowIndex}>
                  {lineLabel(l)}
                </option>
              ))}
            </select>
          </Field>
          <SourceField id="lm-source" placeholder="e.g. Warehouse confirmed by phone, 5 Nov" />
          <Button type="submit" variant="primary" size="sm" disabled={pending || !invoiceLines.length || !packingLines.length}>
            Record mapping
          </Button>
        </form>
      ) : null}

      {mode === "reassign" ? (
        <form onSubmit={onReassign} className="space-y-3" aria-label="Reassign this issue">
          <Field label="Responsible role" id="ra-role">
            <select id="ra-role" name="responsibleRole" defaultValue={issue.responsibleRole} className={inputClass}>
              {ResponsibleRole.options.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assignee" id="ra-assignee">
            <input id="ra-assignee" name="assignee" required maxLength={120} defaultValue={issue.assignee ?? ""} className={inputClass} />
          </Field>
          <Field label="Reason" id="ra-reason" hint="(optional)">
            <input id="ra-reason" name="reason" maxLength={300} className={inputClass} />
          </Field>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            Reassign {issue.code}
          </Button>
        </form>
      ) : null}

      {result ? (
        <p role={result.ok ? "status" : "alert"} className={cx("mt-3 text-xs", result.ok ? "text-ok-ink" : "text-danger")}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, id, hint, srLabel, children }: { label: string; id: string; hint?: string; srLabel?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id} hint={hint}>
        <span aria-hidden={srLabel ? true : undefined}>{label}</span>
        {srLabel ? <span className="sr-only">{srLabel}</span> : null}
      </FieldLabel>
      {children}
    </div>
  );
}

function SourceField({ id, placeholder }: { id: string; placeholder: string }) {
  return (
    <Field label="Source reference" id={id} hint="(required)">
      <input id={id} name="sourceReference" required minLength={3} maxLength={300} placeholder={placeholder} className={inputClass} />
    </Field>
  );
}

function UnitSelect({ id, name, defaultValue }: { id: string; name: string; defaultValue: Unit }) {
  return (
    <select id={id} name={name} defaultValue={defaultValue} className={cx(inputClass, "px-1.5")}>
      {Unit.options
        .filter((u) => u !== "unknown")
        .map((u) => (
          <option key={u} value={u}>
            {UNIT_LABEL[u]}
          </option>
        ))}
    </select>
  );
}

function RecheckButton({ caseCode, onChanged }: { caseCode: string; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recheck() {
    setPending(true);
    setError(null);
    try {
      await sendJson("POST", `/v1/cases/${encodeURIComponent(caseCode)}/recheck`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="max-w-[16ch] truncate text-xs text-danger" title={error}>
          {error}
        </span>
      ) : null}
      <Button size="sm" onClick={() => void recheck()} disabled={pending}>
        <RefreshIcon size={13} className={pending ? "motion-safe:animate-spin" : undefined} />
        Recheck
      </Button>
    </span>
  );
}
