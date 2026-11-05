import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { schema } from "@reissue/db";
import { applyRetention, blobKey, type ServiceHandle, type Services } from "@reissue/workflows";

import { openCase, services, shipment } from "../support/harness.js";

let handle: ServiceHandle;
let svc: Services;

beforeAll(async () => {
  handle = await services();
  svc = handle.svc;
});
afterAll(async () => handle?.close());

describe("retention", () => {
  it("lists expired finished cases on a dry run and deletes them with their files when enforced", async () => {
    // #given
    const id = await openCase(svc, ["invoice-v1.pdf", "reordered-packing-list.pdf"]);
    const { caseCode } = await shipment(svc, id);
    await svc.db.update(schema.shipments).set({ updatedAt: new Date(Date.now() - 400 * 86_400_000) }).where(eq(schema.shipments.id, id));
    const versions = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, id));
    // #when
    const dry = await applyRetention(svc, { days: 365, dryRun: true });
    // #then
    expect(dry.cases.map((c) => c.caseCode)).toContain(caseCode);
    expect(await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, id))).toHaveLength(1);

    const real = await applyRetention(svc, { days: 365, dryRun: false });
    expect(real.cases.map((c) => c.caseCode)).toContain(caseCode);
    expect(await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, id))).toHaveLength(0);
    for (const v of versions) {
      const shared = await svc.db.select().from(schema.documentVersions).where(eq(schema.documentVersions.sha256, v.sha256));
      expect(await svc.store.exists(blobKey(v.sha256))).toBe(shared.length > 0);
    }
  });

  it("never touches cases that are still open", async () => {
    const id = await openCase(svc, ["invoice-v1.pdf", "packing-list-v1.pdf"]);
    await svc.db.update(schema.shipments).set({ updatedAt: new Date(Date.now() - 400 * 86_400_000) }).where(eq(schema.shipments.id, id));
    await applyRetention(svc, { days: 365, dryRun: false });
    expect(await svc.db.select().from(schema.shipments).where(eq(schema.shipments.id, id))).toHaveLength(1);
  });
});
