"use client";

import { useState } from "react";

import type { CaseEvent } from "@reissue/contracts";

import { describeEvent } from "@/lib/events";
import { formatDateTime, formatTime, type Tone } from "@/lib/format";

import { cx } from "../ui";

const DOT: Record<Tone, string> = {
  neutral: "bg-line-strong",
  accent: "bg-accent",
  warn: "bg-warn",
  ok: "bg-ok",
  danger: "bg-danger",
};

const COLLAPSED_COUNT = 14;

export function Timeline({ events }: { events: CaseEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const newestFirst = [...events].reverse();
  const visible = expanded ? newestFirst : newestFirst.slice(0, COLLAPSED_COUNT);

  if (!events.length) return <p className="px-4 py-6 text-ink-2">Waiting for the first event.</p>;

  return (
    <div>
      <ol className="px-4 py-3" aria-label="Case events, newest first" data-testid="timeline">
        {visible.map((event, index) => {
          const description = describeEvent(event);
          return (
            <li key={event.id} className="relative grid grid-cols-[3.75rem_14px_1fr] gap-x-2 pb-3 last:pb-0">
              <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)} className="tnum pt-px text-right text-xs text-ink-2">
                {formatTime(event.createdAt)}
              </time>
              <span className="relative flex justify-center">
                <span aria-hidden className={cx("relative z-10 mt-[5px] size-2 rounded-full ring-2 ring-surface", DOT[description.tone])} />
                {index < visible.length - 1 ? <span aria-hidden className="absolute bottom-[-4px] top-3 w-px bg-line" /> : null}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  {description.title}
                  <span className="text-ink-2"> · {event.actor.display}</span>
                </p>
                {description.detail ? <p className="mt-0.5 line-clamp-2 break-words text-xs text-ink-2">{description.detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {newestFirst.length > COLLAPSED_COUNT ? (
        <div className="border-t border-line px-4 py-2">
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-medium text-accent hover:underline" aria-expanded={expanded}>
            {expanded ? "Show recent events only" : `Show all ${newestFirst.length} events`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
