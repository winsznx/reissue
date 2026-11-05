import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { buildApp } from "@reissue/api";
import { newId, schema } from "@reissue/db";
import type { MessagePayload } from "@reissue/switch-adapter";
import { processInboundEvent, type ServiceHandle, type Services } from "@reissue/workflows";

import { drain, openCase, outbox, services, shipment, SUPPLIER_ROOM, TEST_ENV } from "../support/harness.js";

let handle: ServiceHandle;
let svc: Services;

beforeAll(async () => {
  handle = await services();
  svc = handle.svc;
});
afterAll(async () => handle?.close());

function message(partial: Partial<MessagePayload>): MessagePayload {
  return {
    addressed: false,
    sender: "@telegram-li-wei",
    sender_name: "Li Wei",
    sender_kind: "user",
    on_behalf_of: null,
    message_id: newId("msg"),
    body: "",
    timestamp: Date.now(),
    thread_id: null,
    attachments: [],
    opening_message: null,
    sender_role: "member",
    ...partial,
  };
}

async function deliver(roomId: string, payload: MessagePayload): Promise<string> {
  const id = newId("swe");
  await svc.db.insert(schema.switchEvents).values({
    id,
    agentId: "test-agent",
    connectionKey: `test:${roomId}`,
    messageId: payload.message_id,
    roomId,
    dedupeKey: `msg:${roomId}:${payload.message_id}`,
    eventType: "message",
    payload: payload as unknown as Record<string, unknown>,
    status: "QUEUED",
  });
  return id;
}

describe("supplier replies through the room", () => {
  it("ties a natural reply in the request thread to the case without a mention (E2E-02, FR-08)", async () => {
    // #given
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    await svc.db.update(schema.shipments).set({ supplierThreadId: "thread-req-1" }).where(eq(schema.shipments.id, id));
    // #when
    const eventId = await deliver(SUPPLIER_ROOM, message({ thread_id: "thread-req-1", body: "Old packing list. We shipped 500; sending updated document." }));
    const outcome = await processInboundEvent(svc, eventId);
    // #then
    expect(outcome.status).toBe("PROCESSED");
    const replies = await svc.db.select().from(schema.supplierMessages).where(eq(schema.supplierMessages.shipmentId, id));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ classification: "DOCUMENT_OUTDATED", statedValue: "500" });
    const [issue] = await svc.db.select().from(schema.issues).where(eq(schema.issues.shipmentId, id));
    expect(issue?.status).toBe("ANSWER_RECEIVED");
  });

  it("processes a duplicated Switch delivery once (E2E-10)", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    await svc.db.update(schema.shipments).set({ supplierThreadId: "thread-req-2" }).where(eq(schema.shipments.id, id));
    const payload = message({ thread_id: "thread-req-2", body: "I'll send the revision today" });
    const first = await deliver(SUPPLIER_ROOM, payload);
    await expect(deliver(SUPPLIER_ROOM, payload)).rejects.toThrow();
    await processInboundEvent(svc, first);
    await processInboundEvent(svc, first);
    expect(await svc.db.select().from(schema.supplierMessages).where(eq(schema.supplierMessages.shipmentId, id))).toHaveLength(1);
  });

  it("asks which case when a reply could belong to two open shipments (E2E-12)", async () => {
    const a = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    const b = await openCase(svc, ["invoice-v1.pdf", "scanned-packing-list.pdf"]);
    const [sa, sb] = [await shipment(svc, a), await shipment(svc, b)];
    const eventId = await deliver(SUPPLIER_ROOM, message({ body: "the packing list is outdated, new one coming" }));
    const outcome = await processInboundEvent(svc, eventId);
    expect(outcome.detail).toMatch(/asked which case/);
    const asks = await svc.db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.purpose, "chat_reply"));
    const ask = asks.find((o) => o.content.kind === "post" && o.content.body.includes("Which shipment"));
    expect(ask?.content.kind === "post" && ask.content.body).toContain(sa.caseCode);
    expect(ask?.content.kind === "post" && ask.content.body).toContain(sb.caseCode);
    expect(await svc.db.select().from(schema.supplierMessages).where(eq(schema.supplierMessages.messageId, (await svc.db.select().from(schema.switchEvents).where(eq(schema.switchEvents.id, eventId)))[0]!.messageId!))).toHaveLength(0);
  });

  it("records a supplier's stated pack size as a sourced conversion and rechecks", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "cartons-packing-list.pdf"]);
    await svc.db.update(schema.shipments).set({ supplierThreadId: "thread-req-3" }).where(eq(schema.shipments.id, id));
    const eventId = await deliver(SUPPLIER_ROOM, message({ thread_id: "thread-req-3", body: "LL-SHD-090 is packed 20 pcs per carton for SKU LL-SHD-090" }));
    await processInboundEvent(svc, eventId);
    await drain(svc);
    const s = await shipment(svc, id);
    expect(s.conversions[0]).toMatchObject({ sku: "LL-SHD-090", factor: "20", source: "human_confirmed" });
    expect(s.state).toBe("READY_FOR_BROKER_REVIEW");
  });

  it("ignores rooms that are not bound to Reissue", async () => {
    const eventId = await deliver("unbound-room", message({ addressed: true, body: "@reissue check" }));
    expect((await processInboundEvent(svc, eventId)).detail).toMatch(/not bound/);
  });

  it("only accepts review results from the configured examiner", async () => {
    const eventId = await deliver(
      "test-room-ops",
      message({ sender_name: "someone-else", sender_kind: "agent", addressed: true, body: '```reissue\n{"kind":"DOCUMENT_REVIEW_RESULT","case_id":"SHP-0001","task_id":"x","findings":[]}\n```' }),
    );
    expect((await processInboundEvent(svc, eventId)).status).toBe("IGNORED");
  });
});

describe("API access boundaries (E2E-15)", () => {
  async function app() {
    return buildApp({ ...handle, api: { API_PORT: 0, WORKBENCH_ACCESS_CODE: TEST_ENV.WORKBENCH_ACCESS_CODE!, REISSUE_EXAMINER_TOOL_TOKEN: TEST_ENV.REISSUE_EXAMINER_TOOL_TOKEN!, REISSUE_LIAISON_TOOL_TOKEN: TEST_ENV.REISSUE_LIAISON_TOOL_TOKEN! } });
  }
  const mcp = (token: string, method: string, params: Record<string, unknown> = {}) => ({
    method: "POST" as const,
    url: "/mcp",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });

  it("gives the liaison token supplier-safe tools only, and denies internal evidence", async () => {
    const server = await app();
    const list = await server.inject(mcp("test-liaison-token", "tools/list"));
    const names = (JSON.parse(list.body) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_supplier_brief", "list_supplier_cases"]);
    const call = await server.inject(mcp("test-liaison-token", "tools/call", { name: "get_issue_evidence", arguments: { case_code: "SHP-0241", issue_code: "D-001" } }));
    expect(call.body).toMatch(/not found|Tool get_issue_evidence/i);
    await server.close();
  });

  it("gives the examiner evidence tools", async () => {
    const server = await app();
    const list = await server.inject(mcp("test-examiner-token", "tools/list"));
    const names = (JSON.parse(list.body) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_case_overview", "get_issue_evidence", "get_line_items"]);
    await server.close();
  });

  it("rejects unauthenticated tool and API calls", async () => {
    const server = await app();
    expect((await server.inject(mcp("wrong", "tools/list"))).statusCode).toBe(401);
    expect((await server.inject({ method: "GET", url: "/v1/cases" })).statusCode).toBe(401);
    await server.close();
  });

  it("serves packet downloads only with a session or an unexpired signed token", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "reordered-packing-list.pdf"]);
    const [zip] = (await svc.db.select().from(schema.artifacts).where(eq(schema.artifacts.shipmentId, id))).filter((a) => a.type === "PACKET_ZIP");
    const server = await app();
    expect((await server.inject({ method: "GET", url: `/v1/artifacts/${zip!.id}/download` })).statusCode).toBe(401);
    expect((await server.inject({ method: "GET", url: `/v1/artifacts/${zip!.id}/download?token=forged` })).statusCode).toBe(403);
    const ready = await outbox(svc, id, "ops_ready");
    const url = ready[0]!.content.kind === "post" ? /\/v1\/artifacts\/\S+/.exec(ready[0]!.content.body)?.[0] : null;
    const ok = await server.inject({ method: "GET", url: url! });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["x-reissue-sha256"]).toBe(zip!.sha256);
    await svc.db.update(schema.downloadTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await server.inject({ method: "GET", url: url! })).statusCode).toBe(403);
    await server.close();
  });

  it("refuses to bind a supplier room as able to receive internal details", async () => {
    const server = await app();
    const login = await server.inject({ method: "POST", url: "/v1/auth/session", payload: { accessCode: "test-access-code", name: "Tester" } });
    const cookie = login.headers["set-cookie"] as string;
    const res = await server.inject({
      method: "PATCH",
      url: "/v1/settings/rooms",
      headers: { cookie },
      payload: { bindings: [{ switchRoomId: "r", platform: "telegram", intent: "SUPPLIER", label: "s", supplierId: null, canReceiveSensitive: true }] },
    });
    expect(res.statusCode).toBe(400);
    await server.close();
  });
});
