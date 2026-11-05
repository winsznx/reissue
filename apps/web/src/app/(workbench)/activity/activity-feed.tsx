"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import type { CaseEvent, CaseEventType, CaseSummaryDto } from "@reissue/contracts";

import { ErrorNotice, LoadingBlock, TextLink, cx } from "@/components/ui";
import { errorMessage, getJson } from "@/lib/api";
import { describeEvent } from "@/lib/events";
import { formatDate, formatDateTime, formatTime, type Tone } from "@/lib/format";
import { caseListKey } from "@/lib/queries";
import type { CaseEventsResponse, CaseListResponse } from "@/lib/types";

const CASE_LIMIT = 15;

const ROUTINE: ReadonlySet<CaseEventType> = new Set(["EXTRACTION_STARTED", "EXTRACTION_COMPLETED", "DOCUMENT_CLASSIFIED", "MESSAGE_POSTED", "DUPLICATE_FILE_REUSED", "REMINDER_SENT"]);

const DOT: Record<Tone, string> = {
  neutral: "bg-line-strong",
  accent: "bg-accent",
  warn: "bg-warn",
  ok: "bg-ok",
  danger: "bg-danger",
};

interface FeedItem {
  event: CaseEvent;
  summary: CaseSummaryDto;
}

async function loadFeed(): Promise<{ items: FeedItem[]; caseCount: number }> {
  const { cases } = await getJson<CaseListResponse>(caseListKey("all", "", "updated_desc"));
  const recent = cases.slice(0, CASE_LIMIT);
  const perCase = await Promise.all(
    recent.map(async (summary) => {
      const { events } = await getJson<CaseEventsResponse>(`/v1/cases/${encodeURIComponent(summary.caseCode)}/events`);
      return events.map((event) => ({ event, summary }));
    }),
  );
  const items = perCase.flat().sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt) || b.event.sequence - a.event.sequence);
  return { items, caseCount: recent.length };
}

export function ActivityFeed() {
  const { data, error, isLoading, mutate } = useSWR("activity-feed", loadFeed, { refreshInterval: 10_000 });
  const [showRoutine, setShowRoutine] = useState(false);
  const items = (data?.items ?? []).filter((item) => showRoutine || !ROUTINE.has(item.event.type));

  const days = new Map<string, FeedItem[]>();
  for (const item of items.slice(0, 300)) {
    const day = formatDate(item.event.createdAt);
    days.set(day, [...(days.get(day) ?? []), item]);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-[2rem] font-medium leading-none tracking-[-0.015em]">Activity</h1>
          <p className="mt-2 text-ink-2">
            What happened across the {data?.caseCount ?? CASE_LIMIT} most recently updated shipments, newest first.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={showRoutine} onChange={(e) => setShowRoutine(e.target.checked)} className="accent-[var(--accent)]" />
          Include routine reading steps
        </label>
      </div>

      {error ? (
        <ErrorNotice error={errorMessage(error)} onRetry={() => void mutate()} />
      ) : isLoading && !data ? (
        <LoadingBlock label="Loading activity" rows={8} />
      ) : items.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-surface px-6 py-10 text-center">
          <p className="font-medium">Nothing has happened yet.</p>
          <p className="mt-1 text-ink-2">
            Upload documents on <TextLink href="/shipments">Shipments</TextLink> or start a scenario in <TextLink href="/verification">Verification</TextLink>.
          </p>
        </div>
      ) : (
        <div className="space-y-6" data-testid="activity-feed">
          {[...days.entries()].map(([day, dayItems]) => (
            <section key={day} aria-labelledby={`day-${day}`} className="rounded-[10px] border border-line bg-surface">
              <h2 id={`day-${day}`} className="border-b border-line px-4 py-2.5 text-[0.8125rem] font-semibold">
                {day}
              </h2>
              <ol className="divide-y divide-line">
                {dayItems.map(({ event, summary }) => {
                  const description = describeEvent(event);
                  return (
                    <li key={`${event.caseId}:${event.sequence}`} className="grid grid-cols-[4rem_1fr] gap-3 px-4 py-2.5 sm:grid-cols-[4rem_6.5rem_1fr]">
                      <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)} className="tnum pt-0.5 text-xs text-ink-2">
                        {formatTime(event.createdAt)}
                      </time>
                      <Link href={`/shipments/${summary.caseCode}`} className="tnum hidden pt-px text-sm font-semibold text-ink hover:text-accent sm:block">
                        {summary.caseCode}
                      </Link>
                      <div className="min-w-0">
                        <p className="flex items-start gap-2 text-sm">
                          <span aria-hidden className={cx("mt-[7px] size-1.5 shrink-0 rounded-full", DOT[description.tone])} />
                          <span>
                            <Link href={`/shipments/${summary.caseCode}`} className="tnum mr-1.5 font-semibold hover:text-accent sm:hidden">
                              {summary.caseCode}
                            </Link>
                            {description.title}
                            <span className="text-ink-2"> · {event.actor.display}</span>
                          </span>
                        </p>
                        {description.detail ? <p className="ml-3.5 mt-0.5 line-clamp-2 break-words text-xs text-ink-2">{description.detail}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
