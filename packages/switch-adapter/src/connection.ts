import { EventEmitter } from "node:events";

import WebSocket from "ws";

import type { SwitchClient } from "./http.js";
import {
  CommandPayload,
  ConnectionState,
  DomainEventData,
  EvictedFrame,
  GapFrame,
  MessagePayload,
  ServerFrame,
  type InboundEvent,
} from "./types.js";

export type ConnectionStatus = "connecting" | "live" | "backoff" | "stopped";

export interface ConnectionLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface SwitchConnectionOptions {
  client: SwitchClient;
  /** Stable per (agent, room); reused on every reconnect so the server resumes rather than re-opens. */
  connectionId: string;
  roomId: string;
  startFrom: number | null;
  generation: number | null;
  clientName: string;
  clientVersion: string;
  logger: ConnectionLogger;
  /** Durably records the event before the cursor moves past it. Must not run long business work. */
  onEvent: (event: InboundEvent) => Promise<void>;
  onCursor: (cursor: number, generation: number | null) => Promise<void>;
  onGap?: (gap: GapFrame) => Promise<void>;
  onState?: (state: ConnectionState) => Promise<void>;
  maxBackoffMs?: number;
}

const PROTOCOL = 8;
/** Close codes after which reconnecting cannot help. */
const FATAL_CLOSE = new Set([4400, 4401]);

/**
 * One Switch agent WebSocket bound to one room. Heartbeats are answered inside the socket
 * callback, before any event work is awaited, so slow downstream processing never lapses
 * the connection. Events are handed off strictly in order; the cursor only advances after
 * `onEvent` resolves, which makes delivery at-least-once and the receiver's dedupe the
 * exactly-once boundary.
 */
export class SwitchConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private cursor: number | null;
  private generation: number | null;
  private status: ConnectionStatus = "connecting";
  private attempt = 0;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private heartbeatMs = 6_000;
  private lastFrameAt = Date.now();
  serverVersion: string | null = null;

  constructor(private readonly opts: SwitchConnectionOptions) {
    super();
    this.cursor = opts.startFrom;
    this.generation = opts.generation;
  }

  get state(): { status: ConnectionStatus; cursor: number | null; generation: number | null } {
    return { status: this.status, cursor: this.cursor, generation: this.generation };
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.setStatus("stopped");
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.ws?.close(1000, "client stop");
    await this.chain;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }

  private buildUrl(): string {
    const { client, connectionId, roomId, clientName, clientVersion } = this.opts;
    const base = client.creds.baseUrl.replace(/\/+$/, "").replace(/^http/, "ws");
    const params = new URLSearchParams({
      connection_id: connectionId,
      scope: "single",
      filter: "all",
      start_from: this.cursor === null ? "head" : String(this.cursor),
      rooms: roomId,
      protocol: String(PROTOCOL),
      protocol_accepts: String(PROTOCOL),
      client: clientName,
      client_version: clientVersion,
    });
    if (this.generation !== null) params.set("expected_generation", String(this.generation));
    return `${base}/agents/${encodeURIComponent(client.creds.agentId)}/connection/ws?${params.toString()}`;
  }

  private open(): void {
    if (this.stopped) return;
    this.setStatus("connecting");
    const ws = new WebSocket(this.buildUrl(), { headers: { authorization: `Bearer ${this.opts.client.creds.apiKey}` } });
    this.ws = ws;
    ws.on("message", (raw) => this.onFrame(ws, raw.toString()));
    ws.on("close", (code, reason) => this.onClose(ws, code, reason.toString()));
    ws.on("error", (error) => this.opts.logger.warn({ room: this.opts.roomId, err: error.message }, "switch socket error"));
  }

  private onFrame(ws: WebSocket, raw: string): void {
    this.lastFrameAt = Date.now();
    let frame: ReturnType<typeof ServerFrame.parse>;
    try {
      frame = ServerFrame.parse(JSON.parse(raw));
    } catch (error) {
      this.opts.logger.warn({ room: this.opts.roomId, err: String(error) }, "unparseable switch frame");
      return;
    }

    if (frame.event === "ping") {
      ws.send(JSON.stringify({ type: "pong", cursor: this.cursor ?? 0 }));
      return;
    }

    switch (frame.event) {
      case "connection_state":
        this.handleConnectionState(frame.data);
        return;
      case "gap":
        this.enqueue(async () => {
          const gap = GapFrame.parse(frame.data);
          this.opts.logger.warn({ room: this.opts.roomId, gap }, "switch reported a gap; resuming and re-reading context");
          this.cursor = gap.resumed_at;
          await this.opts.onCursor(gap.resumed_at, this.generation);
          await this.opts.onGap?.(gap);
        });
        return;
      case "evicted":
        this.handleEvicted(frame.data);
        return;
      case "refused":
        this.opts.logger.warn({ room: this.opts.roomId, detail: frame.data }, "switch refused the connection");
        if (isTakenOver(frame.data)) this.halt("taken_over");
        return;
      case "subscription_changed":
        this.opts.logger.info({ room: this.opts.roomId, data: frame.data }, "switch subscription changed");
        return;
      case "message":
      case "command":
        this.handleDomainEvent(frame.event, frame.data, frame.id);
        return;
      default:
        return;
    }
  }

  private handleConnectionState(data: Record<string, unknown>): void {
    const state = ConnectionState.parse(data);
    this.generation = state.generation;
    this.serverVersion = state.server?.version ?? null;
    this.heartbeatMs = Math.max(2_000, state.heartbeat_interval_seconds * 1000 * 3);
    if (this.cursor === null) this.cursor = state.cursor;
    this.attempt = 0;
    this.setStatus("live");
    this.armWatchdog();
    this.opts.logger.info(
      { room: this.opts.roomId, generation: state.generation, cursor: state.cursor, rooms: state.rooms, server: this.serverVersion },
      "switch connection live",
    );
    this.enqueue(async () => {
      await this.opts.onCursor(this.cursor ?? state.cursor, state.generation);
      await this.opts.onState?.(state);
    });
  }

  private handleEvicted(data: Record<string, unknown>): void {
    const evicted = EvictedFrame.parse(data);
    this.opts.logger.warn({ room: this.opts.roomId, evicted }, "switch evicted the connection");
    if (evicted.code === "taken_over" || evicted.code === "closed" || evicted.code === "launch_superseded") {
      this.halt(evicted.code);
    }
  }

  private handleDomainEvent(kind: "message" | "command", data: Record<string, unknown>, id: number | undefined): void {
    const parsed = DomainEventData.safeParse(data);
    if (!parsed.success) {
      this.opts.logger.warn({ room: this.opts.roomId, err: parsed.error.message }, "malformed switch domain event");
      return;
    }
    const sequence = id ?? parsed.data.sequence ?? null;
    let event: InboundEvent;
    if (kind === "message") {
      const payload = MessagePayload.safeParse(parsed.data.payload);
      if (!payload.success) {
        this.opts.logger.warn({ room: this.opts.roomId, err: payload.error.message }, "malformed switch message payload");
        return;
      }
      event = { kind, roomId: parsed.data.room_id, sequence, missed: parsed.data.missed ?? null, payload: payload.data };
    } else {
      const payload = CommandPayload.safeParse(parsed.data.payload);
      if (!payload.success) return;
      event = { kind, roomId: parsed.data.room_id, sequence, payload: payload.data };
    }
    this.enqueue(async () => {
      await this.opts.onEvent(event);
      if (sequence !== null) {
        this.cursor = sequence;
        await this.opts.onCursor(sequence, this.generation);
      }
    });
  }

  /** Serializes event handling; a failed handler stops the stream so the event is redelivered on resume. */
  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((error: unknown) => {
      this.opts.logger.error({ room: this.opts.roomId, err: error instanceof Error ? error.message : String(error) }, "switch event handling failed; reconnecting to redeliver");
      this.ws?.terminate();
    });
  }

  private armWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastFrameAt > this.heartbeatMs * 2) {
        this.opts.logger.warn({ room: this.opts.roomId }, "no switch frames within heartbeat window; reconnecting");
        this.ws?.terminate();
      }
    }, this.heartbeatMs);
  }

  private halt(reason: string): void {
    this.stopped = true;
    this.setStatus("stopped");
    this.emit("halted", reason);
    this.ws?.close(1000, reason);
  }

  private onClose(ws: WebSocket, code: number, reason: string): void {
    if (ws !== this.ws) return;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.stopped) return;
    if (FATAL_CLOSE.has(code)) {
      this.opts.logger.error({ room: this.opts.roomId, code, reason }, "switch closed the connection permanently");
      this.halt(`close_${code}`);
      return;
    }
    this.attempt += 1;
    const ceiling = this.opts.maxBackoffMs ?? 30_000;
    const delay = Math.min(ceiling, 500 * 2 ** Math.min(this.attempt, 6)) * (0.75 + Math.random() * 0.5);
    this.opts.logger.warn({ room: this.opts.roomId, code, reason, delayMs: Math.round(delay) }, "switch connection closed; reconnecting");
    this.setStatus("backoff");
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }
}

function isTakenOver(data: Record<string, unknown>): boolean {
  const detail = data.detail;
  return typeof detail === "object" && detail !== null && (detail as { code?: string }).code === "taken_over";
}
