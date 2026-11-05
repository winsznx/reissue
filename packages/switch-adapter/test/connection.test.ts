import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { SwitchConnection } from "../src/connection.js";
import { SwitchClient } from "../src/http.js";
import type { InboundEvent } from "../src/types.js";

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function message(id: number, body: string, attachments: unknown[] = []) {
  return JSON.stringify({
    event: "message",
    id,
    data: {
      type: "message",
      room_id: "room-1",
      payload: {
        addressed: true,
        sender: "@u:localhost",
        sender_name: "Coordinator",
        sender_kind: "user",
        message_id: `m${id}`,
        body,
        timestamp: 1,
        thread_id: null,
        attachments,
      },
    },
  });
}

const state = (cursor: number) =>
  JSON.stringify({
    event: "connection_state",
    data: { connection_id: "c", agent_id: "a", generation: 3, rooms: ["room-1"], cursor, heartbeat_interval_seconds: 2 },
  });

describe("SwitchConnection", () => {
  let server: WebSocketServer | null = null;
  let connection: SwitchConnection | null = null;

  afterEach(async () => {
    await connection?.stop();
    server?.close();
  });

  async function setup(onSocket: (ws: WebSocket, url: URL) => void, handlers: Partial<{ onEvent: (e: InboundEvent) => Promise<void> }> = {}) {
    server = new WebSocketServer({ port: 0 });
    server.on("connection", (ws, req) => onSocket(ws, new URL(req.url ?? "/", "http://x")));
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const events: InboundEvent[] = [];
    const cursors: number[] = [];
    connection = new SwitchConnection({
      client: new SwitchClient({ baseUrl: `http://127.0.0.1:${port}`, agentId: "agent-1", apiKey: "k" }),
      connectionId: "conn-1",
      roomId: "room-1",
      startFrom: 40,
      generation: 2,
      clientName: "test",
      clientVersion: "0",
      logger: silent,
      onEvent: handlers.onEvent ?? (async (e) => void events.push(e)),
      onCursor: async (c) => void cursors.push(c),
      maxBackoffMs: 50,
    });
    connection.start();
    return { events, cursors };
  }

  it("resumes from the stored cursor and generation with protocol 8 and a room claim", async () => {
    // #given
    let seen: URL | null = null;
    await setup((ws, url) => {
      seen = url;
      ws.send(state(40));
    });
    // #when
    await new Promise((r) => setTimeout(r, 50));
    // #then
    expect(Object.fromEntries(seen!.searchParams)).toMatchObject({
      connection_id: "conn-1",
      start_from: "40",
      expected_generation: "2",
      rooms: "room-1",
      protocol: "8",
    });
  });

  it("answers ping immediately even while an event handler is still running", async () => {
    // #given
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const pongs: unknown[] = [];
    await setup(
      (ws) => {
        ws.on("message", (raw) => pongs.push(JSON.parse(raw.toString())));
        ws.send(state(40));
        ws.send(message(41, "slow"));
        ws.send(JSON.stringify({ event: "ping", data: {} }));
      },
      { onEvent: () => blocked },
    );
    // #when
    await new Promise((r) => setTimeout(r, 50));
    // #then
    expect(pongs).toEqual([{ type: "pong", cursor: 40 }]);
    release();
  });

  it("delivers events in order and advances the cursor only after each is handled", async () => {
    // #given
    const { events, cursors } = await setup((ws) => {
      ws.send(state(40));
      ws.send(message(41, "first", [{ filename: "a.pdf", mimetype: "application/pdf", size: 3, mxc: "mxc://a", msgtype: "m.file" }]));
      ws.send(message(42, "second"));
    });
    // #when
    await new Promise((r) => setTimeout(r, 80));
    // #then
    expect(events.map((e) => (e.kind === "message" ? e.payload.body : ""))).toEqual(["first", "second"]);
    expect(cursors.slice(-2)).toEqual([41, 42]);
  });

  it("stops for good when evicted by a takeover", async () => {
    // #given
    let opens = 0;
    await setup((ws) => {
      opens += 1;
      ws.send(state(40));
      ws.send(JSON.stringify({ event: "evicted", data: { code: "taken_over", reason: "another connection" } }));
    });
    // #when
    await new Promise((r) => setTimeout(r, 200));
    // #then
    expect(opens).toBe(1);
    expect(connection!.state.status).toBe("stopped");
  });

  it("reconnects after a recoverable drop and resumes from the last handled event", async () => {
    // #given
    const urls: URL[] = [];
    await setup((ws, url) => {
      urls.push(url);
      ws.send(state(40));
      if (urls.length === 1) {
        ws.send(message(41, "before drop"));
        setTimeout(() => ws.terminate(), 20);
      }
    });
    // #when
    await new Promise((r) => setTimeout(r, 300));
    // #then
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls[1]!.searchParams.get("start_from")).toBe("41");
    expect(urls[1]!.searchParams.get("expected_generation")).toBe("3");
  });
});
