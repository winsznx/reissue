import { and, eq, inArray, sql } from "drizzle-orm";

import type { CheckResult, IssueDraft } from "@reissue/contracts";
import { isIssueOpen, reconcile, stateAfterReconciliation } from "@reissue/core";
import { newId, schema } from "@reissue/db";

import { transitionCase, transitionIssue, type Issue } from "./case-log.js";
import { loadCurrentFacts } from "./facts-loader.js";
import { caseUrl, checkLine, clarificationNeeded, discrepancySummary } from "./messages.js";
import { primaryRoom } from "./rooms.js";
import { nextIssueCode, withCase, type Services } from "./services.js";

export interface ReconcileReport {
  skipped?: string;
  ready?: boolean;
  opened: string[];
  reopened: string[];
  resolved: string[];
  stillOpen: string[];
}

/**
 * One deterministic reconciliation pass over the current documents of a case epoch.
 * Persists checks and issue transitions, picks the next case state, and schedules the
 * follow-on work (agent review, supplier ask, packet) as post-commit jobs.
 */
export async function runReconcile(svc: Services, shipmentId: string, epoch: number, reason: string, trigger: string | null = null): Promise<ReconcileReport> {
  return withCase(svc, shipmentId, async (scope) => {
    const { tx } = scope;
    let shipment = scope.shipment;
    const report: ReconcileReport = { opened: [], reopened: [], resolved: [], stillOpen: [] };
    if (shipment.currentEpoch !== epoch) return { ...report, skipped: `epoch ${epoch} superseded by ${shipment.currentEpoch}` };
    if (shipment.state === "CANCELLED") return { ...report, skipped: "cancelled" };

    const versions = await tx.select().from(schema.documentVersions).where(eq(schema.documentVersions.shipmentId, shipmentId));
    if (versions.some((v) => v.state === "RECEIVED" || v.state === "EXTRACTING")) return { ...report, skipped: "extraction pending" };
    if (versions.some((v) => v.state === "FAILED")) return { ...report, skipped: "extraction failed; case paused" };

    if (trigger) {
      const [done] = await tx
        .select({ id: schema.validationRuns.id })
        .from(schema.validationRuns)
        .where(and(eq(schema.validationRuns.shipmentId, shipmentId), sql`${schema.validationRuns.results}->>'trigger' = ${trigger}`));
      if (done) return { ...report, skipped: `trigger ${trigger} already reconciled` };
    }

    const started = performance.now();
    const facts = await loadCurrentFacts(tx, shipmentId);
    const outcome = reconcile({
      invoice: facts.invoice,
      packingList: facts.packingList,
      conversions: shipment.conversions,
      mappingOverrides: shipment.mappingOverrides,
    });
    const reconcileMs = Math.round(performance.now() - started);

    const priorRuns = await tx
      .select({ id: schema.validationRuns.id })
      .from(schema.validationRuns)
      .where(eq(schema.validationRuns.shipmentId, shipmentId));
    const isFirstRun = priorRuns.length === 0;

    if (shipment.state === "PARSING" || shipment.state === "RECEIVED" || shipment.state === "ERROR_RECOVERABLE") {
      if (shipment.state === "RECEIVED") shipment = await transitionCase(tx, shipment, "PARSING", "documents extracted");
      shipment = await transitionCase(tx, shipment, isFirstRun ? "RECONCILING" : "RECHECKING", reason);
    } else if (shipment.state !== "RECONCILING" && shipment.state !== "RECHECKING") {
      shipment = await transitionCase(tx, shipment, "RECHECKING", reason);
    }

    const runId = newId("run");
    await tx.insert(schema.validationRuns).values({
      id: runId,
      shipmentId,
      inputEpoch: epoch,
      inputVersionIds: facts.versionIds,
      testedFields: outcome.checks.length,
      results: { summary: outcome.summary, ready: outcome.ready, issues: outcome.issues.map((i) => i.rootCauseKey), reason, trigger },
      modelId: null,
      timings: { reconcileMs },
    });
    if (outcome.checks.length) {
      await tx.insert(schema.checks).values(
        outcome.checks.map((c) => ({
          id: newId("chk"),
          shipmentId,
          caseEpoch: epoch,
          validationRunId: runId,
          fieldKey: c.key,
          lhsFieldRef: c.lhs ? `${c.lhs.versionId}#${c.lhs.ref}` : null,
          rhsFieldRef: c.rhs ? `${c.rhs.versionId}#${c.rhs.ref}` : null,
          status: c.status,
          ruleId: c.rule,
          required: c.required,
          result: c,
        })),
      );
    }
    const lineIds = await tx
      .select({ id: schema.lineItems.id, versionId: schema.lineItems.versionId, rowIndex: schema.lineItems.rowIndex })
      .from(schema.lineItems)
      .where(inArray(schema.lineItems.versionId, facts.versionIds.length ? facts.versionIds : ["-"]));
    const lineId = (versionId: string | undefined, row: number | null): string | null =>
      row === null || !versionId ? null : (lineIds.find((l) => l.versionId === versionId && l.rowIndex === row)?.id ?? null);
    if (outcome.matches.length) {
      await tx.insert(schema.lineMatches).values(
        outcome.matches.map((m) => ({
          id: newId("lm"),
          shipmentId,
          epoch,
          invoiceLineId: lineId(facts.invoice?.versionId, m.invoiceRow),
          packingLineId: lineId(facts.packingList?.versionId, m.packingRow),
          method: m.method,
          confidence: m.confidence,
          reviewerConfirmation: m.method === "human_confirmed" ? "human" : null,
        })),
      );
    }
    await tx.update(schema.shipments).set({ lastMatches: outcome.matches, pausedReason: null }).where(eq(schema.shipments.id, shipmentId));

    const existing = await tx.select().from(schema.issues).where(eq(schema.issues.shipmentId, shipmentId));
    const replacementArrived = reason.startsWith("replacement") || versions.some((v) => v.epoch === epoch && v.supersedesVersionId !== null);
    const touched = new Set<string>();
    for (const draft of outcome.issues) {
      const prior = existing.find((i) => i.rootCauseKey === draft.rootCauseKey);
      if (!prior) {
        const code = await nextIssueCode(tx, shipmentId);
        const [created] = await tx
          .insert(schema.issues)
          .values({ id: newId("iss"), shipmentId, code, ...draftColumns(draft), status: "OPEN", openedEpoch: epoch })
          .returning();
        await scope.event("ISSUE_OPENED", { issueId: created!.id, code, kind: draft.kind, title: draft.title, checkKeys: draft.checkKeys, responsibleRole: draft.responsibleRole });
        report.opened.push(created!.id);
        touched.add(created!.id);
        continue;
      }
      touched.add(prior.id);
      await tx.update(schema.issues).set({ ...draftColumns(draft), updatedAt: sql`now()` }).where(eq(schema.issues.id, prior.id));
      if (prior.status === "RESOLVED") {
        await transitionIssue(tx, prior, "REOPENED", "the same discrepancy is present in the current documents");
        report.reopened.push(prior.id);
      } else if (prior.status === "REPLACEMENT_RECEIVED" || (replacementArrived && ["REQUEST_SENT", "ANSWER_RECEIVED", "RECHECKING", "ESCALATED"].includes(prior.status))) {
        report.stillOpen.push(prior.id);
      }
    }
    for (const issue of existing) {
      if (touched.has(issue.id) || !isIssueOpen(issue.status)) continue;
      await transitionIssue(tx, issue, "RESOLVED", `no longer present at epoch ${epoch}`, undefined, { resolvedEpoch: epoch });
      report.resolved.push(issue.id);
    }

    const nextState = stateAfterReconciliation(outcome);
    shipment = await transitionCase(tx, shipment, nextState, outcome.ready ? "all required checks pass" : `${outcome.issues.length} blocking issue(s)`);
    report.ready = outcome.ready;
    await scope.event("RECONCILIATION_COMPLETED", {
      runId,
      epoch,
      reason,
      summary: outcome.summary,
      ready: outcome.ready,
      versionIds: facts.versionIds,
      opened: report.opened.length,
      reopened: report.reopened.length,
      resolved: report.resolved.length,
      timingsMs: { reconcileMs },
    });

    const issues = await tx.select().from(schema.issues).where(eq(schema.issues.shipmentId, shipmentId));
    const openIssues = issues.filter((i) => isIssueOpen(i.status));
    const checksByKey = new Map<string, CheckResult>(outcome.checks.map((c) => [c.key, c]));
    const opsRoom = shipment.opsRoomId ?? (await primaryRoom(svc.db, svc.config, shipment.tenantId, "OPERATIONS"))?.switchRoomId ?? null;
    const opsThread = shipment.opsRoomId ? shipment.opsThreadId : null;

    if (outcome.ready) {
      await tx
        .update(schema.tasks)
        .set({ status: "COMPLETED", updatedAt: sql`now()` })
        .where(and(eq(schema.tasks.shipmentId, shipmentId), inArray(schema.tasks.status, ["PENDING", "SENT", "ANSWERED"])));
      scope.enqueue("generate_packet", { shipmentId, epoch }, `packet:${shipmentId}:e${epoch}`);
      return report;
    }

    const needsAsk = openIssues.filter((i) => i.responsibleRole === "SUPPLIER" && (i.status === "OPEN" || i.status === "REOPENED"));
    const humanOnly = openIssues.filter((i) => i.responsibleRole !== "SUPPLIER" && i.needsHumanFact && (i.status === "OPEN" || i.status === "REOPENED"));

    if (needsAsk.length || report.stillOpen.length) {
      if (svc.config.SWITCH_EXAMINER_NAME && needsAsk.length) {
        scope.enqueue("request_review", { shipmentId, epoch, trigger: runId }, `review:${shipmentId}:${runId}`);
      } else {
        scope.enqueue("supplier_request", { shipmentId, epoch, trigger: `supplier_request:${shipmentId}:${runId}` }, `supplier_request:${shipmentId}:${runId}`);
      }
    }

    if (opsRoom) {
      const body = isFirstRun
        ? discrepancySummary(
            shipment,
            openIssues,
            checksByKey,
            needsAsk.length
              ? svc.config.SWITCH_EXAMINER_NAME
                ? `Asking ${svc.config.SWITCH_EXAMINER_NAME} to verify the evidence, then the supplier for a corrected document.`
                : "Asking the supplier for a corrected document."
              : "Waiting on a sourced fact from the team (see below).",
            svc.config.REISSUE_PUBLIC_URL,
          )
        : recheckSummary(shipment.caseCode, issues, report, checksByKey, svc.config.REISSUE_PUBLIC_URL, shipment);
      await scope.say({
        purpose: "ops_update",
        roomId: opsRoom,
        threadId: opsThread,
        content: { kind: "post", body },
        dedupeKey: `ops_update:${runId}`,
        visibility: "internal",
      });
      if (humanOnly.length) {
        await scope.say({
          purpose: "ops_clarification",
          roomId: opsRoom,
          threadId: opsThread,
          content: { kind: "post", body: clarificationNeeded(shipment, humanOnly, checksByKey, svc.config.REISSUE_PUBLIC_URL) },
          dedupeKey: `ops_clarification:${shipmentId}:e${epoch}:${humanOnly.map((i) => i.id).sort().join(",")}`,
          visibility: "internal",
        });
      }
    }
    return report;
  });
}

function draftColumns(draft: IssueDraft) {
  return {
    rootCauseKey: draft.rootCauseKey,
    kind: draft.kind,
    severity: draft.severity,
    responsibleRole: draft.responsibleRole,
    title: draft.title,
    checkKeys: draft.checkKeys,
    requestedDocType: draft.requestedDocType,
    needsHumanFact: draft.needsHumanFact,
  };
}

function recheckSummary(
  caseCode: string,
  issues: Issue[],
  report: ReconcileReport,
  checksByKey: Map<string, CheckResult>,
  publicUrl: string,
  shipment: { caseCode: string },
): string {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const lines = [`Reissue · ${caseCode} — rechecked`];
  for (const id of report.resolved) lines.push(`Resolved ${byId.get(id)?.code}: ${byId.get(id)?.title}`);
  for (const id of report.reopened) lines.push(`Reopened ${byId.get(id)?.code}: ${byId.get(id)?.title}`);
  for (const id of report.opened) {
    const issue = byId.get(id);
    if (!issue) continue;
    lines.push(`New ${issue.code}: ${issue.title}`);
    const first = checksByKey.get(issue.checkKeys[0] ?? "");
    if (first) lines.push(checkLine(first));
  }
  for (const id of report.stillOpen) {
    const issue = byId.get(id);
    if (!issue) continue;
    lines.push(`Still open ${issue.code}: ${issue.title}`);
    const first = checksByKey.get(issue.checkKeys[0] ?? "");
    if (first) lines.push(checkLine(first));
  }
  if (lines.length === 1) lines.push("No change in open discrepancies.");
  lines.push(`Open comparison: ${caseUrl(publicUrl, shipment)}`);
  return lines.join("\n");
}
