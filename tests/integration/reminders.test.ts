import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { schema } from "@reissue/db";
import { escalate, sendReminder, type ServiceHandle, type Services } from "@reissue/workflows";

import { drain, events, issues, openCase, outbox, services } from "../support/harness.js";

let handle: ServiceHandle;
let svc: Services;

beforeAll(async () => {
  handle = await services({ DEMO_TIMING_PROFILE: "true" });
  svc = handle.svc;
});
afterAll(async () => handle?.close());

describe("reminders and escalation (FR-15)", () => {
  it("schedules reminders on the demo timing profile and sends exactly one per step", async () => {
    // #given
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    const delayed = await svc.queue.work.getJobs(["delayed"]);
    const reminderJob = delayed.find((j) => j.name === "reminder" && j.data.shipmentId === id);
    expect(reminderJob?.opts.delay).toBe(2 * 60_000);
    const [task] = (await svc.db.select().from(schema.tasks).where(eq(schema.tasks.shipmentId, id))).filter((t) => t.kind === "SUPPLIER_REQUEST");
    // #when
    await sendReminder(svc, id, task!.id, 1);
    await sendReminder(svc, id, task!.id, 1);
    // #then
    const sent = await outbox(svc, id, "supplier_reminder");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content.kind === "post" && sent[0]!.content.body).toContain("Demo timing profile");
    const next = (await svc.queue.work.getJobs(["delayed"])).filter((j) => j.name === "reminder" && j.data.taskId === task!.id && j.data.step === 2);
    expect(next).toHaveLength(1);
  });

  it("escalates an unanswered request to the operations room once", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    const [task] = (await svc.db.select().from(schema.tasks).where(eq(schema.tasks.shipmentId, id))).filter((t) => t.kind === "SUPPLIER_REQUEST");
    await escalate(svc, id, task!.id);
    await escalate(svc, id, task!.id);
    expect(await outbox(svc, id, "ops_escalation")).toHaveLength(1);
    expect((await issues(svc, id)).map((i) => i.status)).toEqual(["ESCALATED"]);
    expect(await events(svc, id, "ESCALATED")).toHaveLength(1);
  });

  it("stops reminding once the supplier has replied", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    const [task] = (await svc.db.select().from(schema.tasks).where(eq(schema.tasks.shipmentId, id))).filter((t) => t.kind === "SUPPLIER_REQUEST");
    await svc.db.insert(schema.supplierMessages).values({
      id: `smsg_${id}`,
      shipmentId: id,
      switchRoomId: "test-room-supplier",
      messageId: `reply-${id}`,
      sender: "u",
      senderName: "Li Wei",
      body: "checking",
      classification: "QUESTION",
    });
    await drain(svc);
    await sendReminder(svc, id, task!.id, 1);
    expect(await outbox(svc, id, "supplier_reminder")).toHaveLength(0);
  });
});
