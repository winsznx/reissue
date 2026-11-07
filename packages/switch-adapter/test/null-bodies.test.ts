import { afterEach, describe, expect, it, vi } from "vitest";

import { SwitchClient } from "../src/http.js";
import { MessagePayload } from "../src/types.js";

const entry = (id: string, body: string | null) => ({ id, kind: "message", sender: "@u:localhost", sender_name: "winszn_x", body, timestamp: 1, attachments: [] });

describe("messages without text", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a live message whose body is null and reads it as empty text", () => {
    const parsed = MessagePayload.parse({ addressed: false, sender: "@u:localhost", sender_name: "winszn_x", message_id: "m1", body: null, timestamp: 1, thread_id: null });
    expect(parsed.body).toBe("");
  });

  it("returns room history entries with null bodies as empty text", async () => {
    const result = { threads: [{ root: entry("r1", null), replies: [entry("r2", "hi"), entry("r3", null)] }], truncated: false, oldest_timestamp: 1 };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ result }), { status: 200 })));
    const client = new SwitchClient({ baseUrl: "http://switch.test", agentId: "agent-1", apiKey: "k" });

    const context = await client.readContext("room-1");

    const bodies = context.threads.flatMap((t) => [t.root, ...t.replies]).map((e) => e.body);
    expect(bodies).toEqual(["", "hi", ""]);
  });
});
