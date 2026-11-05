"use client";

import { useSearchParams } from "next/navigation";

import { IntakeDropzone } from "@/components/intake-dropzone";
import { ErrorNotice, StateBadge, TextLink } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useCaseDetail, useSettings } from "@/lib/queries";

const CASE_CODE = /^[A-Z]{2,6}-\d{3,8}$/;

export function UploadView() {
  const params = useSearchParams();
  const raw = params.get("case")?.trim().toUpperCase() ?? "";
  const caseCode = CASE_CODE.test(raw) ? raw : null;
  const { data: settings } = useSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-serif text-[2rem] font-medium leading-none tracking-[-0.015em]">{caseCode ? `Add documents to ${caseCode}` : "Upload documents"}</h1>
        <p className="mt-3 max-w-[60ch] text-ink-2">
          {caseCode
            ? "Files you add here join the case exactly as if they arrived in the chat thread. Reissue reads them and rechecks the case."
            : "Start a new case from a commercial invoice and packing list. Reissue reads both, compares them line by line and tells you what differs."}
          {settings ? ` Chat attachments are limited to ${formatBytes(settings.limits.chatMediaMaxBytes)}; this page accepts up to ${formatBytes(settings.limits.maxUploadBytes)} per file.` : ""}
        </p>
      </div>
      {raw && !caseCode ? <ErrorNotice error={`"${raw}" is not a case code. Case codes look like SHP-0241.`} /> : null}
      {caseCode ? <CaseContext code={caseCode} /> : null}
      {raw && !caseCode ? null : <IntakeDropzone caseCode={caseCode ?? undefined} />}
      <p className="text-xs text-ink-2">
        Files are stored unaltered with a sha256 fingerprint. PDFs with embedded scripts or launch actions are held for review instead of being read.
      </p>
    </div>
  );
}

function CaseContext({ code }: { code: string }) {
  const { data, error } = useCaseDetail(code);
  if (error) return <ErrorNotice error={errorMessage(error)} />;
  if (!data) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-4 py-3">
      <div className="min-w-0">
        <TextLink href={`/shipments/${data.caseCode}`} className="tnum">
          {data.caseCode}
        </TextLink>
        <p className="truncate text-sm text-ink-2">
          {data.supplierName ?? "Supplier not read yet"}
          {data.invoiceReference ? ` · ${data.invoiceReference}` : ""}
        </p>
      </div>
      <StateBadge state={data.state} />
    </div>
  );
}
