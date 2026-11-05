import { and, eq, inArray, sql } from "drizzle-orm";

import type { ActorRef, ClarifyRequest, ConversionFactor, LineMappingOverride, ReassignRequest } from "@reissue/contracts";
import { isIssueOpen } from "@reissue/core";
import { schema } from "@reissue/db";

import { transitionIssue } from "./case-log.js";
import { withCase, type Services } from "./services.js";

/**
 * Records a human-sourced decision and triggers recomputation. Decisions never mark anything
 * resolved directly: they change the inputs to the deterministic checks, which then decide.
 */
export async function recordClarification(
  svc: Services,
  shipmentId: string,
  request: ClarifyRequest,
  actor: ActorRef,
  issueId: string | null,
): Promise<{ sequence: number }> {
  return withCase(svc, shipmentId, async (scope) => {
    const { shipment, tx } = scope;
    const patch: Partial<typeof schema.shipments.$inferInsert> = {};
    if (request.kind === "conversion_factor") {
      const factor: ConversionFactor = {
        sku: request.sku,
        fromUnit: request.fromUnit,
        toUnit: request.toUnit,
        factor: request.factor,
        source: "human_confirmed",
        sourceReference: `${actor.display} (${actor.platform ?? "workbench"}): ${request.sourceReference}`,
      };
      patch.conversions = [
        ...shipment.conversions.filter((c) => !(c.sku === factor.sku && c.fromUnit === factor.fromUnit && c.toUnit === factor.toUnit)),
        factor,
      ];
    } else if (request.kind === "line_mapping") {
      const override: LineMappingOverride = { invoiceRow: request.invoiceRow, packingRow: request.packingRow, sourceReference: `${actor.display}: ${request.sourceReference}` };
      patch.mappingOverrides = [
        ...shipment.mappingOverrides.filter((m) => m.invoiceRow !== override.invoiceRow && m.packingRow !== override.packingRow),
        override,
      ];
    } else if (request.kind === "reissued_source" && issueId) {
      await tx.update(schema.issues).set({ requestedDocType: request.docType, updatedAt: sql`now()` }).where(eq(schema.issues.id, issueId));
    }
    if (Object.keys(patch).length) await tx.update(schema.shipments).set({ ...patch, updatedAt: sql`now()` }).where(eq(schema.shipments.id, shipmentId));

    const sequence = await scope.event(
      "HUMAN_CLARIFICATION_RECORDED",
      { ...request, issueId, sourceReference: request.sourceReference, recomputes: request.kind === "conversion_factor" || request.kind === "line_mapping" },
      actor,
    );
    if (request.kind === "conversion_factor" || request.kind === "line_mapping") {
      scope.enqueue(
        "reconcile",
        { shipmentId, epoch: shipment.currentEpoch, reason: `clarification: ${request.kind}` },
        `reconcile:${shipmentId}:e${shipment.currentEpoch}:clar${sequence}`,
      );
    }
    return { sequence };
  });
}

export async function requestRecheck(svc: Services, shipmentId: string, actor: ActorRef): Promise<{ retriedExtractions: number }> {
  return withCase(svc, shipmentId, async (scope) => {
    const failed = await scope.tx
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(and(eq(schema.documentVersions.shipmentId, shipmentId), eq(schema.documentVersions.state, "FAILED")));
    const sequence = await scope.event("RECHECK_REQUESTED", { retriedExtractions: failed.length }, actor);
    if (failed.length) {
      await scope.tx
        .update(schema.documentVersions)
        .set({ state: "RECEIVED", failureReason: null, updatedAt: sql`now()` })
        .where(inArray(schema.documentVersions.id, failed.map((f) => f.id)));
      for (const f of failed) scope.enqueue("extract_version", { shipmentId, versionId: f.id }, `extract:${f.id}:retry${sequence}`);
    } else {
      scope.enqueue(
        "reconcile",
        { shipmentId, epoch: scope.shipment.currentEpoch, reason: "recheck requested" },
        `reconcile:${shipmentId}:e${scope.shipment.currentEpoch}:recheck${sequence}`,
      );
    }
    return { retriedExtractions: failed.length };
  });
}

export async function assignCase(svc: Services, shipmentId: string, assignee: string, actor: ActorRef): Promise<void> {
  await withCase(svc, shipmentId, async (scope) => {
    await scope.tx.update(schema.shipments).set({ assignedTo: assignee, updatedAt: sql`now()` }).where(eq(schema.shipments.id, shipmentId));
    await scope.event("ASSIGNEE_CHANGED", { from: scope.shipment.assignedTo, to: assignee }, actor);
  });
}

export async function reassignIssue(svc: Services, issueId: string, request: ReassignRequest, actor: ActorRef): Promise<void> {
  const [issue] = await svc.db.select().from(schema.issues).where(eq(schema.issues.id, issueId));
  if (!issue) throw new Error("Issue not found");
  await withCase(svc, issue.shipmentId, async (scope) => {
    const [fresh] = await scope.tx.select().from(schema.issues).where(eq(schema.issues.id, issueId));
    if (!fresh || !isIssueOpen(fresh.status)) throw new Error("Only open issues can be reassigned");
    await scope.tx
      .update(schema.issues)
      .set({ responsibleRole: request.responsibleRole, assignee: request.assignee, updatedAt: sql`now()` })
      .where(eq(schema.issues.id, issueId));
    if (fresh.status !== "OWNER_ASSIGNED") {
      await transitionIssue(scope.tx, fresh, "OWNER_ASSIGNED", request.reason ?? `assigned to ${request.assignee}`, actor, {
        assignee: request.assignee,
        responsibleRole: request.responsibleRole,
      });
    }
    await scope.event("ISSUE_REASSIGNED", { issueId, code: fresh.code, role: request.responsibleRole, assignee: request.assignee, reason: request.reason ?? null }, actor);
    if (request.responsibleRole === "SUPPLIER") {
      await scope.tx.update(schema.issues).set({ needsHumanFact: false }).where(eq(schema.issues.id, issueId));
      scope.enqueue("supplier_request", { shipmentId: issue.shipmentId, epoch: scope.shipment.currentEpoch, trigger: `supplier_request:${issue.shipmentId}:e${scope.shipment.currentEpoch}:reassign${issueId}` }, `supplier_request:${issue.shipmentId}:e${scope.shipment.currentEpoch}:reassign${issueId}`,
      );
    }
  });
}
