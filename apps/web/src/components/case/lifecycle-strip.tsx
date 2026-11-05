import type { LifecycleStep } from "@/lib/events";
import { formatDateTime, formatTime } from "@/lib/format";

import { CheckIcon } from "../icons";
import { cx } from "../ui";

const STATUS_TEXT: Record<LifecycleStep["status"], string> = {
  done: "done",
  current: "in progress",
  pending: "not yet",
  skipped: "skipped",
};

export function LifecycleStrip({ steps }: { steps: LifecycleStep[] }) {
  return (
    <ol aria-label="Correction loop" className="grid grid-cols-3 gap-y-3 sm:grid-cols-6" data-testid="lifecycle">
      {steps.map((step, index) => (
        <li key={step.id} className="relative min-w-0 pr-2" data-status={step.status} aria-current={step.status === "current" ? "step" : undefined}>
          <div className="flex items-center">
            <span
              aria-hidden
              className={cx(
                "grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]",
                step.status === "done" && "border-ok bg-ok text-white dark:text-canvas",
                step.status === "current" && "border-accent bg-surface",
                step.status === "pending" && "border-line-strong bg-surface",
                step.status === "skipped" && "border-dashed border-line-strong bg-transparent",
              )}
            >
              {step.status === "done" ? <CheckIcon size={11} strokeWidth={2.2} /> : step.status === "current" ? <span className="live-dot size-[7px] rounded-full bg-accent" /> : null}
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden className={cx("ml-1.5 h-[1.5px] flex-1", step.status === "done" ? "bg-ok/60" : step.status === "skipped" ? "border-t-[1.5px] border-dashed border-line-strong" : "bg-line")} />
            ) : null}
          </div>
          <p className={cx("mt-1.5 truncate text-xs font-medium", step.status === "pending" || step.status === "skipped" ? "text-ink-2" : "text-ink")}>
            {step.label}
            <span className="sr-only">, {STATUS_TEXT[step.status]}</span>
          </p>
          <p className="tnum truncate text-[0.6875rem] text-ink-2">
            {step.at ? (
              <time dateTime={step.at} title={formatDateTime(step.at)}>
                {formatTime(step.at)}
              </time>
            ) : step.status === "current" ? (
              "Now"
            ) : (
              (step.note ?? " ")
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}
