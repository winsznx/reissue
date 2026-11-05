import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { CaseState, CheckStatus } from "@reissue/contracts";

import { CASE_STATE_LABEL, CASE_STATE_TONE, CHECK_STATUS_LABEL, CHECK_STATUS_TONE, type Tone } from "@/lib/format";

import { AlertIcon, CheckIcon, ClockIcon, MinusCircleIcon, QuestionIcon, SpinnerIcon } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  warn: "bg-warn-soft text-warn-ink border-transparent",
  ok: "bg-ok-soft text-ok-ink border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};

export function Badge({ tone, icon, children, className }: { tone: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] border px-1.5 py-0.5 text-xs font-medium", TONE_CLASS[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

const STATE_ICON: Record<Tone, ReactNode> = {
  neutral: <MinusCircleIcon size={12} />,
  accent: <SpinnerIcon size={12} />,
  warn: <ClockIcon size={12} />,
  ok: <CheckIcon size={12} />,
  danger: <AlertIcon size={12} />,
};

export function StateBadge({ state, className }: { state: CaseState; className?: string }) {
  const tone = CASE_STATE_TONE[state];
  const icon = state === "NEEDS_CLARIFICATION" ? <QuestionIcon size={12} /> : STATE_ICON[tone];
  return (
    <Badge tone={tone} icon={icon} className={className}>
      <span data-testid="case-state">{CASE_STATE_LABEL[state]}</span>
    </Badge>
  );
}

const CHECK_ICON: Record<CheckStatus, ReactNode> = {
  MATCH: <CheckIcon size={12} />,
  MISMATCH: <AlertIcon size={12} />,
  MISSING: <MinusCircleIcon size={12} />,
  AMBIGUOUS: <QuestionIcon size={12} />,
  NOT_COMPARABLE: <MinusCircleIcon size={12} />,
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  return (
    <Badge tone={CHECK_STATUS_TONE[status]} icon={CHECK_ICON[status]}>
      {CHECK_STATUS_LABEL[status]}
    </Badge>
  );
}

type ButtonVariant = "primary" | "secondary" | "quiet";

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink border-accent hover:brightness-110",
  secondary: "bg-surface text-ink border-line-strong hover:bg-sunken",
  quiet: "bg-transparent text-ink-2 border-transparent hover:text-ink hover:bg-sunken",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md"): string {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-[7px] border font-medium transition-[background-color,filter,color] duration-150 disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
    BUTTON_CLASS[variant],
  );
}

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button type={type} className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function Panel({ title, action, children, className, id, headingLevel = 2 }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section id={id} aria-labelledby={id && title ? `${id}-title` : undefined} className={cx("rounded-[10px] border border-line bg-surface", className)}>
      {title ? (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <Heading id={id ? `${id}-title` : undefined} className="text-[0.8125rem] font-semibold text-ink">
            {title}
          </Heading>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function ErrorNotice({ error, onRetry, className }: { error: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cx("flex items-start gap-3 rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-ink", className)}>
      <AlertIcon className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">The Workbench could not load this.</p>
        <p className="mt-0.5 break-words text-ink-2">{error}</p>
      </div>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("rounded-[6px] bg-sunken motion-safe:animate-pulse", className)} />;
}

export function LoadingBlock({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx("font-medium text-accent underline-offset-2 hover:underline", className)}>
      {children}
    </Link>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-2">
      {children}
      {hint ? <span className="ml-1 font-normal">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "mt-1 block h-9 w-full rounded-[7px] border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-2/70 focus-visible:border-accent";
