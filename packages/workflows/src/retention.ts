import { and, eq, inArray, lt, ne } from "drizzle-orm";

import { schema } from "@reissue/db";

import type { Services } from "./services.js";
import { blobKey } from "./storage.js";

export interface RetentionReport {
  cutoff: string;
  dryRun: boolean;
  cases: { caseCode: string; state: string; updatedAt: string }[];
  deletedObjects: number;
}

/**
 * Deletes finished cases (ready or cancelled) untouched for longer than the retention period,
 * with their documents, evidence, messages and stored files. Blobs still referenced by another
 * case are kept. Dry run lists what would go.
 */
export async function applyRetention(svc: Services, options: { days?: number; dryRun: boolean }): Promise<RetentionReport> {
  const days = options.days ?? svc.config.FILE_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const expired = await svc.db
    .select()
    .from(schema.shipments)
    .where(
      and(
        eq(schema.shipments.tenantId, svc.tenantId),
        inArray(schema.shipments.state, ["READY_FOR_BROKER_REVIEW", "CANCELLED"]),
        lt(schema.shipments.updatedAt, cutoff),
      ),
    );
  const report: RetentionReport = {
    cutoff: cutoff.toISOString(),
    dryRun: options.dryRun,
    cases: expired.map((s) => ({ caseCode: s.caseCode, state: s.state, updatedAt: s.updatedAt.toISOString() })),
    deletedObjects: 0,
  };
  if (options.dryRun) return report;

  for (const shipment of expired) {
    const objectKeys = await svc.db.transaction(async (tx) => {
      const id = shipment.id;
      const versions = await tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, id));
      const versionIds = versions.map((v) => v.id);
      const artifacts = await tx.select().from(schema.artifacts).where(eq(schema.artifacts.shipmentId, id));
      if (artifacts.length) await tx.delete(schema.downloadTokens).where(inArray(schema.downloadTokens.artifactId, artifacts.map((a) => a.id)));
      await tx.delete(schema.artifacts).where(eq(schema.artifacts.shipmentId, id));
      await tx.delete(schema.checks).where(eq(schema.checks.shipmentId, id));
      await tx.delete(schema.lineMatches).where(eq(schema.lineMatches.shipmentId, id));
      if (versionIds.length) {
        await tx.delete(schema.lineItems).where(inArray(schema.lineItems.versionId, versionIds));
        await tx.delete(schema.extractedFields).where(inArray(schema.extractedFields.versionId, versionIds));
        await tx.delete(schema.documentPages).where(inArray(schema.documentPages.versionId, versionIds));
      }
      await tx.update(schema.documents).set({ currentVersionId: null }).where(eq(schema.documents.shipmentId, id));
      await tx.delete(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, id));
      await tx.delete(schema.documents).where(eq(schema.documents.shipmentId, id));
      await tx.delete(schema.issues).where(eq(schema.issues.shipmentId, id));
      await tx.delete(schema.tasks).where(eq(schema.tasks.shipmentId, id));
      await tx.delete(schema.supplierMessages).where(eq(schema.supplierMessages.shipmentId, id));
      await tx.delete(schema.caseEvents).where(eq(schema.caseEvents.shipmentId, id));
      await tx.delete(schema.outboxMessages).where(eq(schema.outboxMessages.shipmentId, id));
      await tx.delete(schema.jobs).where(eq(schema.jobs.shipmentId, id));
      await tx.delete(schema.validationRuns).where(eq(schema.validationRuns.shipmentId, id));
      await tx.update(schema.scenarioRuns).set({ shipmentId: null }).where(eq(schema.scenarioRuns.shipmentId, id));
      await tx.delete(schema.shipments).where(eq(schema.shipments.id, id));

      const keys = artifacts.map((a) => a.objectKey);
      for (const sha of new Set(versions.map((v) => v.sha256))) {
        const [stillUsed] = await tx
          .select({ id: schema.documentVersions.id })
          .from(schema.documentVersions)
          .where(and(eq(schema.documentVersions.sha256, sha), ne(schema.documentVersions.shipmentId, id)))
          .limit(1);
        if (stillUsed) continue;
        await tx.delete(schema.blobs).where(eq(schema.blobs.sha256, sha));
        keys.push(blobKey(sha));
      }
      return keys;
    });
    for (const key of objectKeys) {
      await svc.store.delete(key);
      report.deletedObjects += 1;
    }
    svc.log.info({ caseCode: shipment.caseCode, objects: objectKeys.length }, "retention purged case");
  }
  return report;
}
