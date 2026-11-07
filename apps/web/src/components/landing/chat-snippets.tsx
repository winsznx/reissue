import type { ReactElement, ReactNode } from "react";

import { cx } from "@/components/ui";

import { CORRECTION_MOTION } from "./correction-motion";
import { SlackMark, TelegramMark } from "./marks";
import { FileChip } from "./primitives";

function ChatSnippet({ room, sender, files, footnote, className, children }: {
  room: ReactNode;
  sender: string;
  files: readonly string[];
  footnote: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={cx("w-full max-w-100 rounded-xl border border-line bg-surface p-4 shadow-doc sm:p-5", className)}>
      <p className="flex min-w-0 items-center gap-2 text-xs text-ink-2">{room}</p>
      <p className="mt-4 text-xs font-semibold text-ink">{sender}</p>
      <p className="mt-1 text-[0.9375rem] leading-snug text-ink">{children}</p>
      <ul aria-label="Attached files" className="mt-3 flex flex-wrap gap-2">
        {files.map((file) => (
          <li key={file} className="min-w-0">
            <FileChip name={file} />
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-2">{footnote}</p>
    </div>
  );
}

export function SlackSnippet({ className }: { className?: string }): ReactElement {
  return (
    <ChatSnippet
      className={className}
      room={
        <>
          <SlackMark className="size-4 shrink-0" />
          <span className="font-semibold text-ink">#shipment-ops</span>
          <span className="truncate">Northfield Home Goods</span>
        </>
      }
      sender="Operator"
      files={["invoice-v1.pdf", "packing-list-v1.pdf"]}
      footnote="The mismatch was in the thread 0.58 s later, with page and row."
    >
      <span className="rounded-sm bg-accent-soft px-1 py-px font-medium text-accent">@reissue</span> check these
    </ChatSnippet>
  );
}

export function TelegramSnippet({ className }: { className?: string }): ReactElement {
  return (
    <ChatSnippet
      className={cx(CORRECTION_MOTION.replyArrives, className)}
      room={
        <>
          <TelegramMark className="size-4 shrink-0" />
          <span className="truncate font-semibold text-ink">Lumen Lighting x Northfield</span>
        </>
      }
      sender="Supplier"
      files={["packing-list-v2.pdf"]}
      footnote="No @ needed. The case was ready 0.34 s after the PDF arrived."
    >
      Old packing list. We shipped 500, sending the updated document.
    </ChatSnippet>
  );
}
