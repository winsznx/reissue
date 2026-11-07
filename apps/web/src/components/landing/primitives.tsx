import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

import { AlertIcon, CheckIcon, ClockIcon, DocIcon } from "@/components/icons";
import { cx } from "@/components/ui";

import { GITHUB_URL, WORKBENCH_HREF } from "./site";

type ActionVariant = "primary" | "secondary";

const ACTION_VARIANT: Record<ActionVariant, string> = {
  primary: "border-accent bg-accent text-accent-ink hover:brightness-110",
  secondary: "border-line-strong bg-surface text-ink hover:bg-sunken",
};

export function actionClass(variant: ActionVariant, size: "md" | "lg" = "lg"): string {
  return cx(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[7px] border font-medium transition-[background-color,filter] duration-150",
    size === "lg" ? "h-12 px-5 text-[0.9375rem]" : "h-9 px-3.5 text-sm",
    ACTION_VARIANT[variant],
  );
}

export function WorkbenchLink({ className }: { className?: string }): ReactElement {
  return (
    <Link href={WORKBENCH_HREF} prefetch={false} className={className}>
      Open the Workbench
    </Link>
  );
}

export function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }): ReactElement {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function GitHubLink({ className }: { className?: string }): ReactElement {
  return (
    <ExternalLink href={GITHUB_URL} className={className}>
      View on GitHub
    </ExternalLink>
  );
}

export function Container({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cx("mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Section({ id, className, children }: { id: string; className?: string; children: ReactNode }): ReactElement {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx("scroll-mt-16 py-20 md:py-28", className)}>
      <Container>{children}</Container>
    </section>
  );
}

export function SectionIntro({ sectionId, title, lead, className }: { sectionId: string; title: ReactNode; lead?: ReactNode; className?: string }): ReactElement {
  return (
    <div className={cx("max-w-[44rem]", className)}>
      <h2 id={`${sectionId}-title`} className="text-balance font-serif text-[2.25rem] font-medium leading-[1.08] tracking-[-0.015em] text-ink md:text-[3rem]">
        {title}
      </h2>
      {lead ? <p className="mt-4 text-pretty text-[1.0625rem] leading-relaxed text-ink-2 md:text-lg">{lead}</p> : null}
    </div>
  );
}

export function FileChip({ name, className }: { name: string; className?: string }): ReactElement {
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-mark border border-line bg-canvas px-2 py-1 text-xs font-medium text-ink", className)}>
      <DocIcon size={14} className="shrink-0 text-ink-2" />
      <span className="truncate">{name}</span>
    </span>
  );
}

type PillTone = "ok" | "warn" | "danger";

const PILL_TONE: Record<PillTone, string> = {
  ok: "bg-ok-soft text-ok-ink",
  warn: "bg-warn-soft text-warn-ink",
  danger: "bg-danger-soft text-danger",
};

const PILL_ICON: Record<PillTone, ReactElement> = {
  ok: <CheckIcon size={13} strokeWidth={2} />,
  warn: <ClockIcon size={13} />,
  danger: <AlertIcon size={13} />,
};

export function StatePill({ tone, children, className }: { tone: PillTone; children: ReactNode; className?: string }): ReactElement {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-mark px-2 py-1 text-[0.8125rem] font-medium leading-none", PILL_TONE[tone], className)}>
      {PILL_ICON[tone]}
      {children}
    </span>
  );
}
