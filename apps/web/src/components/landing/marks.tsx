import type { ReactElement } from "react";

import { cx } from "@/components/ui";

export interface MarkProps {
  className?: string;
}

export function ReissueMark({ className }: MarkProps): ReactElement {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="7" className="fill-ink" />
      <path d="M9 8h9.5a5 5 0 010 10H9z" fill="none" strokeWidth="2.6" className="stroke-canvas" />
      <path d="M9 8v16M16 18l6 6" fill="none" strokeWidth="2.6" strokeLinecap="round" className="stroke-canvas" />
      <circle cx="24" cy="9" r="2.6" className="fill-accent" />
    </svg>
  );
}

export function ReissueLockup({ className }: MarkProps): ReactElement {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <ReissueMark className="size-7 shrink-0" />
      <span className="font-serif text-[1.375rem] font-semibold leading-none tracking-[-0.01em] text-ink">Reissue</span>
    </span>
  );
}

export function SlackMark({ className }: MarkProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" strokeWidth="2.8" strokeLinecap="round" className={className}>
      <path d="M9 4v16" stroke="#36c5f0" />
      <path d="M4 9h16" stroke="#2eb67d" />
      <path d="M15 4v16" stroke="#ecb22e" />
      <path d="M4 15h16" stroke="#e01e5a" />
    </svg>
  );
}

export function TelegramMark({ className }: MarkProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <circle cx="12" cy="12" r="11" fill="#2aabee" />
      <path
        d="M5.6 11.7 16.8 7.4c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.6.8-1.1.5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.5-5c.2-.2 0-.3-.4-.1l-6.8 4.3-2.9-.9c-.6-.2-.6-.6.2-.9z"
        fill="#fff"
      />
    </svg>
  );
}

export function SwitchMark({ className, on = true }: MarkProps & { on?: boolean }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <rect x="1.5" y="6" width="21" height="12" rx="6" className={on ? "fill-ink" : "fill-line-strong"} />
      <circle cx={on ? 16.5 : 7.5} cy="12" r="4" className="fill-canvas" />
    </svg>
  );
}
