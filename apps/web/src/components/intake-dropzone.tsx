"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type DragEvent } from "react";

import { errorMessage, sendFiles } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useSettings } from "@/lib/queries";
import type { IntakeResponse } from "@/lib/types";

import { SpinnerIcon, UploadIcon } from "./icons";
import { cx } from "./ui";

export const ACCEPTED_FILES = ".pdf,.png,.jpg,.jpeg,.xlsx,application/pdf,image/png,image/jpeg";

interface IntakeDropzoneProps {
  caseCode?: string;
  compact?: boolean;
  onUploaded?: (result: IntakeResponse) => void;
}

export function IntakeDropzone({ caseCode, compact = false, onUploaded }: IntakeDropzoneProps) {
  const router = useRouter();
  const inputId = useId();
  const { data: settings } = useSettings();
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maxBytes = settings?.limits.maxUploadBytes;

  async function upload(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    const tooLarge = maxBytes ? files.find((f) => f.size > maxBytes) : undefined;
    if (tooLarge && maxBytes) {
      setError(`${tooLarge.name} is ${formatBytes(tooLarge.size)}; the limit is ${formatBytes(maxBytes)} per file.`);
      return;
    }
    setError(null);
    setPending(files.map((f) => f.name));
    try {
      const result = await sendFiles<IntakeResponse>("/v1/cases/intake", files, caseCode ? { caseCode } : {});
      onUploaded?.(result);
      router.push(`/shipments/${encodeURIComponent(result.caseCode)}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(null);
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files);
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "group relative flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed text-left transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)]",
          compact ? "px-4 py-3" : "flex-col justify-center px-6 py-12 text-center",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-accent",
        )}
      >
        <span className={cx("grid shrink-0 place-items-center rounded-full bg-sunken text-ink-2 group-hover:text-accent", compact ? "size-9" : "size-11")}>
          {pending ? <SpinnerIcon /> : <UploadIcon />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">
            {pending ? `Uploading ${pending.length} file${pending.length === 1 ? "" : "s"}…` : caseCode ? `Add documents to ${caseCode}` : "Upload documents"}
          </span>
          <span className="block text-xs text-ink-2">
            PDF, PNG, JPEG or XLSX. Drop an invoice and packing list, or choose files{maxBytes ? `. Up to ${formatBytes(maxBytes)} each.` : "."}
          </span>
        </span>
        <input
          id={inputId}
          type="file"
          multiple
          disabled={pending !== null}
          accept={ACCEPTED_FILES}
          className="sr-only"
          onChange={(e) => void upload(e.currentTarget.files)}
        />
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
