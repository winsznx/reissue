"use client";

import { useEffect, useRef, useState } from "react";

import { StreamFrame, type CaseEvent } from "@reissue/contracts";

import { API_PREFIX } from "./api";

export type StreamStatus = "connecting" | "live" | "reconnecting";

interface StreamState {
  code: string;
  events: CaseEvent[];
  status: StreamStatus;
}

const MAX_BACKOFF_MS = 15_000;

function mergeEvent(events: CaseEvent[], event: CaseEvent): CaseEvent[] {
  const last = events.at(-1);
  if (!last || event.sequence > last.sequence) return [...events, event];
  if (events.some((e) => e.sequence === event.sequence)) return events;
  return [...events, event].sort((a, b) => a.sequence - b.sequence);
}

/**
 * Subscribes to the case's server-sent event stream. The server replays every event after
 * `after` on connect, so the timeline is built from the stream alone. The browser's own retry
 * would resend the original `?after=` (which the API prefers over Last-Event-ID), so reconnects
 * are driven here with the last sequence seen. `onEvent` fires for each new frame.
 */
export function useCaseStream(code: string, onEvent: (event: CaseEvent) => void): { events: CaseEvent[]; status: StreamStatus } {
  const [state, setState] = useState<StreamState>({ code, events: [], status: "connecting" });
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let lastSequence = 0;
    let disposed = false;

    const update = (patch: (current: StreamState) => Partial<StreamState>) =>
      setState((s) => {
        const current = s.code === code ? s : { code, events: [], status: "connecting" as const };
        return { ...current, ...patch(current) };
      });

    const connect = () => {
      source = new EventSource(`${API_PREFIX}/v1/cases/${encodeURIComponent(code)}/stream?after=${lastSequence}`);
      source.onopen = () => {
        attempt = 0;
        update(() => ({ status: "live" }));
      };
      source.addEventListener("case_event", (message: MessageEvent<string>) => {
        const frame = StreamFrame.safeParse(JSON.parse(message.data));
        if (!frame.success || frame.data.kind !== "event") return;
        const event = frame.data.event;
        if (event.sequence <= lastSequence) return;
        lastSequence = event.sequence;
        update((s) => ({ status: "live", events: mergeEvent(s.events, event) }));
        onEventRef.current(event);
      });
      source.onerror = () => {
        if (disposed) return;
        update(() => ({ status: "reconnecting" }));
        source?.close();
        const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [code]);

  if (state.code !== code) return { events: [], status: "connecting" };
  return { events: state.events, status: state.status };
}
