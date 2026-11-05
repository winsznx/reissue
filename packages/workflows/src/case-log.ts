import { and, eq, sql } from "drizzle-orm";

import type { ActorRef, CaseEventType, CaseState, IssueState } from "@reissue/contracts";
import { assertCaseTransition, assertIssueTransition } from "@reissue/core";
import { schema, type Executor, type Transaction } from "@reissue/db";

export const SYSTEM_ACTOR: ActorRef = { kind: "system", id: "reissue", display: "Reissue", platform: null };

export type Shipment = typeof schema.shipments.$inferSelect;
export type Issue = typeof schema.issues.$inferSelect;

export const CASE_EVENTS_CHANNEL = "reissue_case_events";

/**
 * Takes the per-case row lock for the rest of the transaction. Every case mutation goes
 * through this, so a replacement and a supplier reply landing together are serialized.
 */
export async function lockCase(tx: Transaction, shipmentId: string): Promise<Shipment> {
  const rows = await tx.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).for("update");
  const row = rows[0];
  if (!row) throw new Error(`Case ${shipmentId} not found`);
  return row;
}

/** Appends to the case timeline and notifies listeners when the transaction commits. */
export async function appendEvent(
  tx: Executor,
  shipmentId: string,
  type: CaseEventType,
  payload: Record<string, unknown>,
  actor: ActorRef = SYSTEM_ACTOR,
  correlationId: string | null = null,
): Promise<number> {
  const [row] = await tx.execute<{ next: number }>(
    sql`select coalesce(max(${schema.caseEvents.sequence}), 0) + 1 as next from ${schema.caseEvents} where ${schema.caseEvents.shipmentId} = ${shipmentId}`,
  );
  const sequence = Number(row?.next ?? 1);
  await tx.insert(schema.caseEvents).values({ shipmentId, sequence, eventType: type, payload, actor, correlationId });
  await tx.execute(sql`select pg_notify(${CASE_EVENTS_CHANNEL}, ${`${shipmentId}:${sequence}`})`);
  return sequence;
}

export async function transitionCase(
  tx: Transaction,
  shipment: Shipment,
  to: CaseState,
  reason: string,
  actor: ActorRef = SYSTEM_ACTOR,
): Promise<Shipment> {
  if (shipment.state === to) return shipment;
  assertCaseTransition(shipment.state, to);
  const [updated] = await tx
    .update(schema.shipments)
    .set({ state: to, updatedAt: sql`now()`, lockVersion: sql`${schema.shipments.lockVersion} + 1` })
    .where(and(eq(schema.shipments.id, shipment.id), eq(schema.shipments.lockVersion, shipment.lockVersion)))
    .returning();
  if (!updated) throw new Error(`Case ${shipment.caseCode} changed concurrently`);
  await appendEvent(tx, shipment.id, "STATE_CHANGED", { from: shipment.state, to, reason }, actor);
  return updated;
}

export async function transitionIssue(
  tx: Transaction,
  issue: Issue,
  to: IssueState,
  reason: string,
  actor: ActorRef = SYSTEM_ACTOR,
  extra: Partial<Pick<Issue, "resolvedEpoch" | "assignee" | "responsibleRole" | "escalatedAt">> = {},
): Promise<Issue> {
  if (issue.status === to) return issue;
  assertIssueTransition(issue.status, to);
  const [updated] = await tx
    .update(schema.issues)
    .set({ status: to, updatedAt: sql`now()`, ...extra })
    .where(eq(schema.issues.id, issue.id))
    .returning();
  await appendEvent(
    tx,
    issue.shipmentId,
    to === "RESOLVED" ? "ISSUE_RESOLVED" : to === "REOPENED" ? "ISSUE_REOPENED" : "ISSUE_STATE_CHANGED",
    { issueId: issue.id, code: issue.code, from: issue.status, to, reason },
    actor,
  );
  return updated!;
}
