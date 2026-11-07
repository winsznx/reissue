"use client";

import { useState, type ReactElement } from "react";

import { ArrowRightIcon, DocIcon } from "@/components/icons";
import { cx } from "@/components/ui";

import { ReissueMark, SlackMark, SwitchMark, TelegramMark, type MarkProps } from "./marks";
import { LIVE_RUN_LABEL } from "./site";

type Room = "slack" | "switch" | "telegram" | "reissue";

type StepFigure =
  | { kind: "stat"; value: string; label: string }
  | { kind: "quote"; author: string; text: string }
  | { kind: "file"; name: string; lines: readonly string[] };

type StepDetail = { kind: "note"; text: string } | { kind: "change"; field: string; before: string; after: string };

interface LoopStep {
  title: string;
  summary: string;
  room: Room;
  place: string;
  figure: StepFigure;
  detail: StepDetail;
}

const ROOMS: Record<Room, { label: string; Mark: (props: MarkProps) => ReactElement }> = {
  slack: { label: "Slack", Mark: SlackMark },
  switch: { label: "Switch", Mark: SwitchMark },
  telegram: { label: "Telegram", Mark: TelegramMark },
  reissue: { label: "Reissue", Mark: ReissueMark },
};

const LOOP_STEPS: readonly [LoopStep, ...LoopStep[]] = [
  {
    title: "Finds the exact contradiction",
    summary: "Reissue reads the commercial invoice and the packing list and points to the page and row where they disagree.",
    room: "slack",
    place: "#shipment-ops",
    figure: { kind: "stat", value: "0.58 s", label: "from the Slack post to the mismatch in the thread, with page and row" },
    detail: { kind: "note", text: "Invoice 500 pcs on p. 1, row 3. Packing list 480 pcs, 10 cartons × 48, on p. 1, row 3." },
  },
  {
    title: "A second agent verifies the evidence",
    summary: "reissue-examiner checks the cited rows on both documents with read-only evidence tools.",
    room: "switch",
    place: "Coordinator to examiner",
    figure: { kind: "stat", value: "33 s", label: "for the examiner's review to come back after the handoff" },
    detail: { kind: "note", text: "The coordinator hands the case over agent to agent with send_targeted_message." },
  },
  {
    title: "Asks the supplier in their own Telegram group",
    summary: "reissue-liaison posts the request in the supplier's own Telegram group.",
    room: "telegram",
    place: "Lumen Lighting x Northfield",
    figure: {
      kind: "quote",
      author: "reissue-liaison",
      text: "Reissue · correction requested for SHP-0287. Invoice LUM-2026-0417 · PO NHG-PO-88213. Please confirm the correct figures: Quantity · SKU LL-STR-050: invoice says 500 pcs; packing list says 480 pcs. Whichever document is outdated, please attach the revised supplier-issued PDF in this thread.",
    },
    detail: { kind: "note", text: "The liaison uses supplier-safe tools only. The supplier sees no prices and no other cases." },
  },
  {
    title: "Follows the supplier's natural replies",
    summary: "The supplier answers in their own words, in the same thread. Nobody has to tag anyone.",
    room: "telegram",
    place: "Lumen Lighting x Northfield",
    figure: { kind: "quote", author: "Supplier", text: "Old packing list. We shipped 500, sending the updated document." },
    detail: { kind: "note", text: "Switch follow-ups carry replies without an @ to the liaison." },
  },
  {
    title: "Takes in the revised PDF they send",
    summary: "The file arrives through Switch and becomes the current packing list.",
    room: "telegram",
    place: "Lumen Lighting x Northfield",
    figure: { kind: "file", name: "packing-list-v2.pdf", lines: ["Revision 2, dated 21 Oct 2026", "Line 3: 500 pcs, 10 cartons × 50"] },
    detail: { kind: "note", text: "Stored by its SHA-256 hash, byte for byte as the supplier sent it." },
  },
  {
    title: "Rechecks everything on its own",
    summary: "Code runs every check again on the current documents. Only a clean recheck makes a case ready.",
    room: "reissue",
    place: "Recheck",
    figure: { kind: "stat", value: "0.34 s", label: "from the revised PDF arriving in Telegram to Ready for broker review" },
    detail: { kind: "change", field: "Packing list, LL-STR-050", before: "480 pcs", after: "500 pcs" },
  },
  {
    title: "Returns a packet for the customs broker",
    summary: "The current, unaltered supplier files go back to the Slack thread as one ZIP.",
    room: "slack",
    place: "#shipment-ops",
    figure: { kind: "stat", value: "0.75 s", label: "from the revised PDF to the ZIP posted in the Slack thread" },
    detail: { kind: "note", text: "The ready message reached the same thread at 0.62 s." },
  },
];

function FigureView({ figure }: { figure: StepFigure }): ReactElement {
  switch (figure.kind) {
    case "stat":
      return (
        <p>
          <span className="tnum block font-serif text-[4rem] font-medium leading-none tracking-[-0.03em] text-ink sm:text-[5.25rem]">{figure.value}</span>
          <span className="mt-3 block max-w-[34ch] text-ink-2">{figure.label}</span>
        </p>
      );
    case "quote":
      return (
        <figure>
          <figcaption className="text-xs font-semibold text-ink">{figure.author}</figcaption>
          <blockquote className="mt-1.5 max-w-[60ch] rounded-xl rounded-tl-sm bg-sunken px-4 py-3 text-[0.9375rem] leading-relaxed text-ink">
            <p>{figure.text}</p>
          </blockquote>
        </figure>
      );
    case "file":
      return (
        <div className="flex max-w-md items-start gap-3 rounded-xl border border-line bg-canvas p-4">
          <DocIcon size={22} className="mt-0.5 shrink-0 text-ink-2" />
          <div className="min-w-0">
            <p className="font-medium text-ink">{figure.name}</p>
            {figure.lines.map((line) => (
              <p key={line} className="tnum mt-0.5 text-sm text-ink-2">
                {line}
              </p>
            ))}
          </div>
        </div>
      );
  }
}

function DetailView({ detail }: { detail: StepDetail }): ReactElement {
  if (detail.kind === "change") {
    return (
      <p className="tnum flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-ink-2">{detail.field}</span>
        <s className="text-ink-2 decoration-danger decoration-2">{detail.before}</s>
        <ArrowRightIcon size={12} className="text-ink-2" />
        <strong className="font-semibold text-ok-ink">{detail.after}</strong>
      </p>
    );
  }
  return <p className="tnum text-sm leading-relaxed text-ink-2">{detail.text}</p>;
}

export function LoopStepper(): ReactElement {
  const [activeIndex, setActiveIndex] = useState(0);
  const step = LOOP_STEPS[activeIndex] ?? LOOP_STEPS[0];
  const room = ROOMS[step.room];

  return (
    <div className="mt-12 grid gap-6 md:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <div className="relative lg:self-start">
        <span aria-hidden="true" className="absolute bottom-7 left-7.25 top-7 w-px bg-line" />
        <ol aria-label="Steps in the correction loop" className="relative space-y-1">
          {LOOP_STEPS.map((item, index) => {
            const pressed = index === activeIndex;
            return (
              <li key={item.title}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-controls="loop-panel"
                  onClick={() => setActiveIndex(index)}
                  className={cx(
                    "flex min-h-14 w-full items-center gap-4 rounded-panel border px-3.5 py-2.5 text-left transition-colors duration-150",
                    pressed ? "border-line bg-surface" : "border-transparent hover:bg-surface/60",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      "tnum grid size-7.5 shrink-0 place-items-center rounded-full border text-sm font-semibold",
                      pressed ? "border-ink bg-ink text-canvas" : "border-line-strong bg-canvas text-ink-2",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className={cx("text-[0.9375rem] font-medium", pressed ? "text-ink" : "text-ink-2")}>{item.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div id="loop-panel" aria-live="polite" className="flex min-w-0 flex-col rounded-xl border border-line bg-surface lg:min-h-140">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 text-sm sm:px-7">
          <span className="flex min-w-0 items-center gap-2">
            <room.Mark className="size-4 shrink-0" />
            <span className="font-medium text-ink">{room.label}</span>
            <span className="truncate text-ink-2">{step.place}</span>
          </span>
          <span className="tnum shrink-0 text-ink-2">
            Step {activeIndex + 1} of {LOOP_STEPS.length}
          </span>
        </div>
        <div className="flex flex-1 flex-col px-5 py-6 sm:px-7 sm:py-8">
          <h3 className="text-balance font-serif text-[1.625rem] font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[1.875rem]">{step.title}</h3>
          <p className="mt-2 max-w-[52ch] text-ink-2">{step.summary}</p>
          <div className="mt-8">
            <FigureView figure={step.figure} />
          </div>
          <div className="mt-auto pt-8">
            <div className="rounded-mark border border-line bg-canvas px-4 py-3">
              <DetailView detail={step.detail} />
            </div>
          </div>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-2 sm:px-7">Case SHP-0287. {LIVE_RUN_LABEL}.</p>
      </div>
    </div>
  );
}
