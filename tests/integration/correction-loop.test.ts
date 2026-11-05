import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { readZipEntries } from "@reissue/artifacts";
import { isIssueOpen } from "@reissue/core";
import { schema } from "@reissue/db";
import { blobKey, deliverOutbox, ingest, markReplacementReceived, recordClarification, sendReminder, type ServiceHandle, type Services } from "@reissue/workflows";

import { ACTOR, drain, events, fixture, issues, openCase, outbox, services, shipment, SUPPLIER_ROOM } from "../support/harness.js";

let handle: ServiceHandle;
let svc: Services;

beforeAll(async () => {
  handle = await services();
  svc = handle.svc;
});
afterAll(async () => handle?.close());

async function replace(shipmentId: string, file: string) {
  await markReplacementReceived(svc, shipmentId);
  await ingest(svc, {
    tenantId: svc.tenantId,
    shipmentId,
    files: [await fixture(file)],
    source: { platform: "telegram", roomId: SUPPLIER_ROOM, messageId: `sup-${file}-${Date.now()}`, threadId: null, senderRef: "u-liwei", senderName: "Li Wei", receivedAt: new Date() },
    actor: { kind: "human", id: "u-liwei", display: "Li Wei", platform: "telegram" },
    replyTo: null,
    correlationId: "test-replacement",
  });
  await drain(svc);
}

describe("quantity correction loop", () => {
  let id: string;

  it("opens one case for a two-file intake and flags the 500 vs 480 mismatch with evidence (E2E-01, E2E-09)", async () => {
    // #given / #when
    id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    // #then
    const s = await shipment(svc, id);
    expect(s.state).toBe("WAITING_ON_SUPPLIER");
    const versions = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, id));
    expect(versions).toHaveLength(2);
    const open = (await issues(svc, id)).filter((i) => isIssueOpen(i.status));
    expect(open.map((i) => i.kind)).toEqual(["QUANTITY_MISMATCH"]);
    const [check] = await svc.db.select().from(schema.checks).where(eq(schema.checks.fieldKey, "line:LLSTR050.quantity"));
    expect(check?.result).toMatchObject({ status: "MISMATCH", lhs: { value: "500", source: { page: 1 } }, rhs: { value: "480", source: { page: 1 } } });
  });

  it("sends one supplier-safe request to the supplier room, without prices or links", async () => {
    const asks = await outbox(svc, id, "supplier_request:");
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ targetRoomId: SUPPLIER_ROOM, visibility: "supplier" });
    const body = asks[0]!.content.kind === "post" ? asks[0]!.content.body : "";
    expect(body).toContain("invoice says 500 pcs; packing list says 480 pcs");
    expect(body).not.toMatch(/3\.80|1,?900|http/);
  });

  it("rechecks a replacement automatically, resolves the issue and builds a byte-exact packet (E2E-03, E2E-17)", async () => {
    // #when
    await replace(id, "packing-list-v2.pdf");
    // #then
    const s = await shipment(svc, id);
    expect(s.state).toBe("READY_FOR_BROKER_REVIEW");
    expect(s.currentEpoch).toBe(2);
    expect((await issues(svc, id)).every((i) => i.status === "RESOLVED")).toBe(true);
    const [zip] = await svc.db.select().from(schema.artifacts).where(eq(schema.artifacts.shipmentId, id)).then((rows) => rows.filter((r) => r.type === "PACKET_ZIP"));
    const entries = await readZipEntries(await svc.store.get(zip!.objectKey));
    const docs = await svc.db.select().from(schema.documents).where(eq(schema.documents.shipmentId, id));
    for (const doc of docs) {
      const [v] = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, doc.currentVersionId!));
      expect([...entries.values()]).toContain(v!.sha256);
      expect((await svc.store.get(blobKey(v!.sha256))).equals((await fixture(v!.originalFilename)).bytes)).toBe(true);
    }
    expect([...entries.keys()]).toEqual(["01-commercial-invoice-v1.pdf", "02-packing-list-v2.pdf", "correction-summary.pdf", "document-index.csv"]);
  });

  it("does not send a reminder for an answered or resolved request (E2E-18)", async () => {
    const [task] = await svc.db.select().from(schema.tasks).where(eq(schema.tasks.shipmentId, id)).then((t) => t.filter((x) => x.kind === "SUPPLIER_REQUEST"));
    const before = (await outbox(svc, id, "supplier_reminder")).length;
    await sendReminder(svc, id, task!.id, 1);
    expect((await outbox(svc, id, "supplier_reminder")).length).toBe(before);
    expect((await events(svc, id, "REMINDER_SENT")).at(-1)?.payload).toMatchObject({ skipped: true });
  });
});

describe("replacement that is still wrong (E2E-04)", () => {
  it("keeps the case open and sends a focused follow-up in the same thread", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    await svc.db.update(schema.shipments).set({ supplierThreadId: "supplier-thread-root" }).where(eq(schema.shipments.id, id));
    await replace(id, "packing-list-v2-still-wrong.pdf");
    expect((await shipment(svc, id)).state).toBe("WAITING_ON_SUPPLIER");
    const followUps = (await outbox(svc, id, "supplier_request:")).filter((o) => o.content.kind === "post" && o.content.body.includes("still needs a correction"));
    expect(followUps).toHaveLength(1);
    expect(followUps[0]!.threadId).toBe("supplier-thread-root");
  });
});

describe("replacement that introduces a new mismatch", () => {
  it("resolves the original issue but does not declare ready", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    await replace(id, "packing-list-v3-new-mismatch.pdf");
    const all = await issues(svc, id);
    expect(all.find((i) => i.kind === "QUANTITY_MISMATCH")?.status).toBe("RESOLVED");
    expect(all.find((i) => i.kind === "WEIGHT_MISMATCH")?.status).toBe("REQUEST_SENT");
    expect((await shipment(svc, id)).state).toBe("WAITING_ON_SUPPLIER");
  });
});

describe("document intelligence on varied inputs", () => {
  it("aligns reordered rows by SKU with no false discrepancy (E2E-05)", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "reordered-packing-list.pdf"]);
    expect((await shipment(svc, id)).state).toBe("READY_FOR_BROKER_REVIEW");
  });

  it("reads an image-only packing list with OCR and keeps page evidence (E2E-06)", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "scanned-packing-list.pdf"]);
    const [check] = await svc.db
      .select()
      .from(schema.checks)
      .where(eq(schema.checks.shipmentId, id))
      .then((rows) => rows.filter((r) => r.fieldKey === "line:LLSTR050.quantity"));
    expect(check?.result.rhs?.source?.parser).toBe("ocr");
    expect(check?.result.rhs?.source?.bbox).not.toBeNull();
    expect(check?.status).toBe("MISMATCH");
  });

  it("splits a combined PDF into invoice and packing list parts", async () => {
    const id = await openCase(svc, ["combined-invoice-and-packing-list.pdf"]);
    const docs = await svc.db.select().from(schema.documents).where(eq(schema.documents.shipmentId, id));
    expect(docs.map((d) => d.docType).sort()).toEqual(["COMMERCIAL_INVOICE", "PACKING_LIST"]);
    expect((await issues(svc, id)).map((i) => i.kind)).toEqual(["QUANTITY_MISMATCH"]);
  });

  it("classifies by content when the filename misleads", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "commercial-invoice-final.pdf"]);
    const docs = await svc.db.select().from(schema.documents).where(eq(schema.documents.shipmentId, id));
    expect(docs.map((d) => d.docType).sort()).toEqual(["COMMERCIAL_INVOICE", "PACKING_LIST"]);
  });

  it("treats hostile document text as inert data (E2E-14)", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "hostile-packing-list.pdf"]);
    expect((await shipment(svc, id)).state).toBe("WAITING_ON_SUPPLIER");
    expect((await issues(svc, id)).map((i) => i.kind)).toEqual(["QUANTITY_MISMATCH"]);
    const asks = await outbox(svc, id);
    expect(asks.every((o) => o.content.kind === "media" || !o.content.body.includes("ignore previous instructions"))).toBe(true);
  });

  it("refuses to compare cartons with pieces until a sourced factor is recorded (E2E-07, E2E-08)", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "cartons-packing-list.pdf"]);
    expect((await shipment(svc, id)).state).toBe("NEEDS_CLARIFICATION");
    expect((await issues(svc, id)).filter((i) => isIssueOpen(i.status)).map((i) => i.kind)).toEqual(["UNIT_NOT_COMPARABLE"]);
    await recordClarification(svc, id, { kind: "conversion_factor", sku: "LL-SHD-090", fromUnit: "carton", toUnit: "pcs", factor: "20", sourceReference: "supplier spec sheet" }, ACTOR, null);
    await drain(svc);
    expect((await shipment(svc, id)).state).toBe("READY_FOR_BROKER_REVIEW");
    const [check] = await svc.db
      .select()
      .from(schema.checks)
      .where(eq(schema.checks.shipmentId, id))
      .then((rows) => rows.filter((r) => r.fieldKey === "line:LLSHD090.quantity").at(-1) ? [rows.filter((r) => r.fieldKey === "line:LLSHD090.quantity").at(-1)!] : []);
    expect(check?.result.evidence).toMatchObject({ converted: "100", conversion: { source: "human_confirmed" } });
  });
});

describe("versions and replays", () => {
  it("keeps the newer revision current when an older document arrives late (E2E-13)", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v2.pdf"]);
    expect((await shipment(svc, id)).state).toBe("READY_FOR_BROKER_REVIEW");
    await replace(id, "packing-list-v1.pdf");
    const [doc] = await svc.db.select().from(schema.documents).where(eq(schema.documents.shipmentId, id)).then((d) => d.filter((x) => x.docType === "PACKING_LIST"));
    const [current] = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, doc!.currentVersionId!));
    expect(current?.originalFilename).toBe("packing-list-v2.pdf");
    expect((await events(svc, id, "STALE_VERSION_KEPT_AS_HISTORY")).length).toBe(1);
    expect((await shipment(svc, id)).state).toBe("READY_FOR_BROKER_REVIEW");
  });

  it("reuses an identical file instead of creating a new version", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    await replace(id, "packing-list-v1.pdf");
    expect((await events(svc, id, "DUPLICATE_FILE_REUSED")).length).toBe(1);
    const versions = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, id));
    expect(versions).toHaveLength(2);
  });

  it("does not re-run a reconcile trigger that already committed (E2E-11)", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    const runs = await svc.db.select().from(schema.validationRuns).where(eq(schema.validationRuns.shipmentId, id));
    const trigger = (runs[0]!.results as { trigger: string }).trigger;
    const { runReconcile } = await import("@reissue/workflows");
    const again = await runReconcile(svc, id, 1, "documents settled", trigger);
    expect(again.skipped).toMatch(/already reconciled/);
    expect(await svc.db.select().from(schema.validationRuns).where(eq(schema.validationRuns.shipmentId, id))).toHaveLength(1);
    expect(await outbox(svc, id, "ops_update")).toHaveLength(1);
  });

  it("quarantines a replacement whose references belong to another shipment", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    await svc.db.update(schema.shipments).set({ invoiceReference: "OTHER-0001" }).where(eq(schema.shipments.id, id));
    await replace(id, "packing-list-v2.pdf");
    expect((await events(svc, id, "REPLACEMENT_REJECTED")).length).toBe(1);
  });
});

describe("Switch outage (E2E-16)", () => {
  it("holds messages pending while Switch is unreachable and delivers each once after recovery", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "reordered-packing-list.pdf"]);
    const [ack] = await outbox(svc, id, "intake_ack");
    const down = {
      post: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { name: "Error" })),
      targeted: () => Promise.reject(new Error("down")),
      media: () => Promise.reject(new Error("down")),
    };
    await expect(deliverOutbox(svc, ack!.id, down)).rejects.toThrow();
    const [pending] = await svc.db.select().from(schema.outboxMessages).where(eq(schema.outboxMessages.id, ack!.id));
    expect(pending?.state).toBe("PENDING");
    let posts = 0;
    const up = { post: async () => `ev-${++posts}`, targeted: async () => ({ eventId: "t", statuses: {} }), media: async () => "m" };
    expect(await deliverOutbox(svc, ack!.id, up)).toBe("sent");
    expect(await deliverOutbox(svc, ack!.id, up)).toBe("skipped");
    expect(posts).toBe(1);
  });
});
