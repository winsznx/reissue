import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { encodeAgentPayload, type CheckResult, type DocumentReviewResult, type SupplierReplyIntent } from "@reissue/contracts";
import { isIssueOpen, outboundDedupeKey } from "@reissue/core";
import { newId, schema } from "@reissue/db";

import { transitionIssue, type Issue, type Shipment } from "./case-log.js";
import { supplierFollowUp, supplierReminder, supplierRequest } from "./messages.js";
import { primaryRoom } from "./rooms.js";
import { withCase, type CaseScope, type Services } from "./services.js";

type Task = typeof schema.tasks.$inferSelect;

async function latestChecks(scope: CaseScope): Promise<Map<string, CheckResult>> {
  const [run] = await scope.tx
    .select({ id: schema.validationRuns.id })
    .from(schema.validationRuns)
    .where(eq(schema.validationRuns.shipmentId, scope.shipment.id))
    .orderBy(desc(schema.validationRuns.createdAt))
    .limit(1);
  if (!run) return new Map();
  const rows = await scope.tx.select().from(schema.checks).where(eq(schema.checks.validationRunId, run.id));
  return new Map(rows.map((r) => [r.fieldKey, r.result]));
}

async function openIssues(scope: CaseScope): Promise<Issue[]> {
  const rows = await scope.tx.select().from(schema.issues).where(eq(schema.issues.shipmentId, scope.shipment.id));
  return rows.filter((i) => isIssueOpen(i.status));
}

async function opsTarget(svc: Services, shipment: Shipment): Promise<{ roomId: string; threadId: string | null } | null> {
  if (shipment.opsRoomId) return { roomId: shipment.opsRoomId, threadId: shipment.opsThreadId };
  const room = await primaryRoom(svc.db, shipment.tenantId, "OPERATIONS");
  return room ? { roomId: room.switchRoomId, threadId: null } : null;
}

async function supplierRoomId(svc: Services, shipment: Shipment): Promise<string | null> {
  if (shipment.supplierRoomId) return shipment.supplierRoomId;
  const bindings = await svc.db.select().from(schema.roomBindings).where(eq(schema.roomBindings.tenantId, shipment.tenantId));
  const supplierRooms = bindings.filter((b) => b.intent === "SUPPLIER");
  return (supplierRooms.find((b) => b.supplierId && b.supplierId === shipment.supplierId) ?? supplierRooms[0])?.switchRoomId ?? null;
}

/**
 * Hands the open issues to the Examiner agent through a real addressed Switch message.
 * The case does not wait forever: a timeout job proceeds on deterministic evidence alone.
 */
export async function requestReview(svc: Services, shipmentId: string, epoch: number, trigger: string): Promise<void> {
  const examiner = svc.config.SWITCH_EXAMINER_NAME;
  await withCase(svc, shipmentId, async (scope) => {
    const { shipment } = scope;
    if (shipment.currentEpoch !== epoch || !examiner) return;
    const issues = (await openIssues(scope)).filter((i) => i.status === "OPEN" || i.status === "REOPENED");
    const target = await opsTarget(svc, shipment);
    if (!issues.length || !target) {
      scope.enqueue("supplier_request", { shipmentId, epoch, trigger: `supplier_request:${shipmentId}:${trigger}` }, `supplier_request:${shipmentId}:${trigger}`);
      return;
    }
    const versions = await scope.tx
      .select({ id: schema.documents.currentVersionId })
      .from(schema.documents)
      .where(eq(schema.documents.shipmentId, shipmentId));
    const taskId = `tsk_rv_${stableHash(`${shipmentId}|${trigger}`)}`;
    const [already] = await scope.tx.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (already) return;
    await scope.tx.insert(schema.tasks).values({
      id: taskId,
      shipmentId,
      issueIds: issues.map((i) => i.id),
      kind: "DOCUMENT_REVIEW",
      assignee: examiner,
      requestedAction: "Verify the extracted mismatch and line mapping against the source pages",
      status: "PENDING",
      epoch,
      switchRoomId: target.roomId,
      dueAt: new Date(Date.now() + svc.config.REVIEW_TIMEOUT_SECONDS * 1000),
    });
    const payload = encodeAgentPayload({
      kind: "DOCUMENT_REVIEW_REQUESTED",
      case_id: shipment.caseCode,
      task_id: taskId,
      document_version_ids: versions.map((v) => v.id).filter((v): v is string => Boolean(v)),
      issue_ids: issues.map((i) => i.code),
      requested_result: "Verify each flagged value against the source pages with the Reissue tools and cite both pages.",
      reply_room_id: target.roomId,
      visibility: "internal",
    });
    const body = [
      `Please review ${shipment.caseCode}: ${issues.map((i) => `${i.code} ${i.title}`).join("; ")}.`,
      "Use the Reissue case tools to inspect the cited rows on both documents and reply here with a DOCUMENT_REVIEW_RESULT.",
      payload,
    ].join("\n");
    await scope.say({
      purpose: "review_request",
      roomId: target.roomId,
      threadId: target.threadId,
      content: { kind: "targeted", body, targetNames: [examiner] },
      dedupeKey: outboundDedupeKey({ caseId: shipmentId, issueIds: issues.map((i) => i.id), epoch, recipient: examiner, action: "review" }),
      visibility: "internal",
    });
    await scope.event("REVIEW_REQUESTED", { taskId, assignee: examiner, issueCodes: issues.map((i) => i.code), epoch });
    scope.enqueue("review_timeout", { shipmentId, taskId }, `review_timeout:${taskId}`, svc.config.REVIEW_TIMEOUT_SECONDS * 1000);
  });
}

export async function reviewTimeout(svc: Services, shipmentId: string, taskId: string): Promise<void> {
  await withCase(svc, shipmentId, async (scope) => {
    const [task] = await scope.tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task || !["PENDING", "SENT"].includes(task.status)) return;
    await scope.tx.update(schema.tasks).set({ status: "FAILED", result: { reason: "no response before timeout" }, updatedAt: sql`now()` }).where(eq(schema.tasks.id, taskId));
    await scope.event("REVIEW_RECEIVED", { taskId, outcome: "TIMEOUT", note: `No examiner response within ${svc.config.REVIEW_TIMEOUT_SECONDS}s; proceeding on deterministic evidence.` });
    scope.enqueue("supplier_request", { shipmentId, epoch: task.epoch, trigger: `supplier_request:${taskId}` }, `supplier_request:${taskId}`);
  });
}

/**
 * Applies a validated Examiner result. Confirmed issues proceed to the supplier; issues the
 * examiner could not confirm go to the coordinator instead of being sent outside the company.
 */
export async function applyReviewResult(svc: Services, result: DocumentReviewResult, examinerName: string, messageId: string): Promise<{ applied: boolean; reason?: string }> {
  const [task] = await svc.db.select().from(schema.tasks).where(eq(schema.tasks.id, result.task_id));
  if (!task || task.kind !== "DOCUMENT_REVIEW") return { applied: false, reason: "unknown task" };
  return withCase(svc, task.shipmentId, async (scope) => {
    const [fresh] = await scope.tx.select().from(schema.tasks).where(eq(schema.tasks.id, task.id));
    if (!fresh || fresh.status === "COMPLETED") return { applied: false, reason: "already applied" };
    if (scope.shipment.caseCode !== result.case_id) return { applied: false, reason: "case mismatch" };
    if (fresh.assignee !== examinerName) return { applied: false, reason: "result not from the assigned examiner" };
    const issues = await scope.tx.select().from(schema.issues).where(inArray(schema.issues.id, fresh.issueIds));
    for (const finding of result.findings) {
      const issue = issues.find((i) => i.code === finding.issue_id);
      if (!issue || !isIssueOpen(issue.status)) continue;
      if (finding.verdict !== "CONFIRMED" && issue.responsibleRole === "SUPPLIER") {
        await scope.tx.update(schema.issues).set({ responsibleRole: "COORDINATOR", needsHumanFact: true }).where(eq(schema.issues.id, issue.id));
        await transitionIssue(scope.tx, issue, "OWNER_ASSIGNED", `examiner ${finding.verdict}: ${finding.note}`, undefined, { assignee: "coordinator" });
      }
    }
    const lateResult = fresh.status === "FAILED";
    await scope.tx.update(schema.tasks).set({ status: "COMPLETED", result: result as unknown as Record<string, unknown>, switchMessageId: messageId, updatedAt: sql`now()` }).where(eq(schema.tasks.id, task.id));
    await scope.event(
      "REVIEW_RECEIVED",
      { taskId: task.id, outcome: lateResult ? "LATE" : "RECEIVED", findings: result.findings, messageId },
      { kind: "agent", id: examinerName, display: examinerName, platform: "switch" },
    );
    if (!lateResult) scope.enqueue("supplier_request", { shipmentId: task.shipmentId, epoch: task.epoch, trigger: `supplier_request:${task.id}` }, `supplier_request:${task.id}`);
    return { applied: true };
  });
}

/**
 * Sends one coherent correction ask per case epoch, or a focused follow-up when a replacement
 * did not fix the problem. With a Liaison agent configured, the ask is handed to it to post;
 * a timeout falls back to the coordinator posting the same supplier-safe text.
 */
export async function sendSupplierRequest(svc: Services, shipmentId: string, epoch: number, trigger: string): Promise<void> {
  await withCase(svc, shipmentId, async (scope) => {
    const { shipment } = scope;
    if (shipment.currentEpoch !== epoch) return;
    const roomId = await supplierRoomId(svc, shipment);
    const issues = (await openIssues(scope)).filter((i) => i.responsibleRole === "SUPPLIER");
    if (!issues.length) return;
    const checks = await latestChecks(scope);
    const fresh = issues.filter((i) => i.status === "OPEN" || i.status === "REOPENED");
    const followUp = issues.filter((i) => !fresh.includes(i));
    if (!roomId) {
      const ops = await opsTarget(svc, shipment);
      if (ops) {
        await scope.say({
          purpose: "ops_no_supplier_room",
          roomId: ops.roomId,
          threadId: ops.threadId,
          content: { kind: "post", body: `Reissue · ${shipment.caseCode} — no supplier room is connected, so the correction request could not be sent. Bind one in Settings → Rooms.` },
          dedupeKey: `no_supplier_room:${shipmentId}:e${epoch}`,
          visibility: "internal",
        });
      }
      return;
    }

    const demo = svc.config.DEMO_TIMING_PROFILE ? svc.config.reminderPolicy.label : null;
    const replacementLabel = await latestReplacementLabel(scope);
    const body =
      followUp.length && !fresh.length && shipment.supplierThreadId
        ? supplierFollowUp(shipment, followUp, checks, replacementLabel ?? "the revised document")
        : supplierRequest(shipment, issues, checks, demo);
    const taskId = `tsk_sr_${stableHash(`${shipmentId}|${trigger}`)}`;
    const liaison = svc.config.SWITCH_LIAISON_NAME;
    const [already] = await scope.tx.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (already) return;
    await scope.tx.insert(schema.tasks).values({
      id: taskId,
      shipmentId,
      issueIds: issues.map((i) => i.id),
      kind: "SUPPLIER_REQUEST",
      assignee: liaison ?? "supplier",
      requestedAction: body,
      status: "PENDING",
      epoch,
      switchRoomId: roomId,
    });
    await scope.tx
      .update(schema.shipments)
      .set({ supplierRoomId: roomId })
      .where(eq(schema.shipments.id, shipmentId));
    const dedupe = outboundDedupeKey({ caseId: shipmentId, issueIds: issues.map((i) => i.id), epoch, recipient: roomId, action: `${followUp.length && !fresh.length ? "follow_up" : "request"}:${trigger}` });

    const ops = await opsTarget(svc, shipment);
    if (liaison && ops) {
      await scope.say({
        purpose: "liaison_handoff",
        roomId: ops.roomId,
        threadId: ops.threadId,
        content: {
          kind: "targeted",
          targetNames: [liaison],
          body: [
            `Please send this correction request to the supplier room for ${shipment.caseCode} and handle their replies.`,
            encodeAgentPayload({
              kind: "SUPPLIER_REQUEST_ASSIGNED",
              case_id: shipment.caseCode,
              task_id: taskId,
              issue_ids: issues.map((i) => i.code),
              supplier_room_id: roomId,
              supplier_brief: body.slice(0, 1200),
            }),
          ].join("\n"),
        },
        dedupeKey: `${dedupe}|handoff`,
        visibility: "internal",
      });
      scope.enqueue("liaison_post_timeout", { shipmentId, taskId }, `liaison_timeout:${taskId}`, svc.config.LIAISON_POST_TIMEOUT_SECONDS * 1000);
    } else {
      await scope.say({
        purpose: `supplier_request:${taskId}`,
        roomId,
        threadId: shipment.supplierThreadId,
        content: { kind: "post", body },
        dedupeKey: dedupe,
        visibility: "supplier",
      });
    }
    for (const issue of fresh) await transitionIssue(scope.tx, issue, "REQUEST_SENT", liaison ? `handed to ${liaison}` : "posted to supplier room");
    for (const issue of followUp) {
      if (issue.status === "REPLACEMENT_RECEIVED") await transitionIssue(scope.tx, issue, "RECHECKING", "revised document rechecked");
      const [current] = await scope.tx.select().from(schema.issues).where(eq(schema.issues.id, issue.id));
      if (current && current.status !== "REQUEST_SENT" && current.status !== "ESCALATED") await transitionIssue(scope.tx, current, "REQUEST_SENT", "focused follow-up after recheck");
    }
    await scope.event("SUPPLIER_REQUEST_SENT", {
      taskId,
      roomId,
      issueCodes: issues.map((i) => i.code),
      via: liaison ?? "coordinator",
      followUp: followUp.length > 0 && fresh.length === 0,
      epoch,
    });
    scheduleReminders(svc, scope, taskId);
  });
}

async function latestReplacementLabel(scope: CaseScope): Promise<string | null> {
  const [row] = await scope.tx
    .select({ payload: schema.caseEvents.payload })
    .from(schema.caseEvents)
    .where(and(eq(schema.caseEvents.shipmentId, scope.shipment.id), eq(schema.caseEvents.eventType, "REPLACEMENT_RECEIVED")))
    .orderBy(desc(schema.caseEvents.sequence))
    .limit(1);
  return (row?.payload.label as string | undefined) ?? null;
}

function scheduleReminders(svc: Services, scope: CaseScope, taskId: string): void {
  const policy = svc.config.reminderPolicy;
  scope.enqueue("reminder", { shipmentId: scope.shipment.id, taskId, step: 1 }, `reminder:${taskId}:1`, policy.firstReminderMinutes * 60_000);
  scope.enqueue("escalation", { shipmentId: scope.shipment.id, taskId }, `escalation:${taskId}`, policy.escalationAfterMinutes * 60_000);
}

/** If the Liaison never posted the ask, the coordinator posts the identical supplier-safe text. */
export async function liaisonPostTimeout(svc: Services, shipmentId: string, taskId: string): Promise<void> {
  await withCase(svc, shipmentId, async (scope) => {
    const [task] = await scope.tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task || task.status !== "PENDING" || !task.switchRoomId) return;
    await scope.say({
      purpose: `supplier_request:${taskId}`,
      roomId: task.switchRoomId,
      threadId: scope.shipment.supplierThreadId,
      content: { kind: "post", body: task.requestedAction },
      dedupeKey: `liaison_fallback:${taskId}`,
      visibility: "supplier",
    });
    await scope.event("SUPPLIER_REQUEST_SENT", { taskId, roomId: task.switchRoomId, via: "coordinator", fallback: `liaison did not post within ${svc.config.LIAISON_POST_TIMEOUT_SECONDS}s` });
  });
}

/** Records that the supplier-room post for a task exists, from either the Liaison or the coordinator. */
export async function recordSupplierThread(svc: Services, shipmentId: string, taskId: string | null, eventId: string, threadRoot: string | null): Promise<void> {
  await withCase(svc, shipmentId, async (scope) => {
    const root = threadRoot ?? eventId;
    if (!scope.shipment.supplierThreadId) {
      await scope.tx.update(schema.shipments).set({ supplierThreadId: root }).where(eq(schema.shipments.id, shipmentId));
    }
    if (taskId) {
      await scope.tx
        .update(schema.tasks)
        .set({ status: "SENT", switchMessageId: eventId, updatedAt: sql`now()` })
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, "PENDING")));
    }
  });
}

async function reminderEligible(scope: CaseScope, task: Task): Promise<Issue[] | null> {
  if (task.epoch !== scope.shipment.currentEpoch) return null;
  if (!["PENDING", "SENT"].includes(task.status)) return null;
  if (scope.shipment.state !== "WAITING_ON_SUPPLIER") return null;
  const issues = await scope.tx.select().from(schema.issues).where(inArray(schema.issues.id, task.issueIds));
  const waiting = issues.filter((i) => i.status === "REQUEST_SENT" || i.status === "ESCALATED");
  if (!waiting.length) return null;
  const [reply] = await scope.tx
    .select({ id: schema.supplierMessages.id })
    .from(schema.supplierMessages)
    .where(and(eq(schema.supplierMessages.shipmentId, scope.shipment.id), sql`${schema.supplierMessages.createdAt} > ${task.createdAt}`))
    .limit(1);
  return reply ? null : waiting;
}

function inQuietHours(policy: Services["config"]["reminderPolicy"], now: Date): boolean {
  if (!policy.quietHours) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const start = toMin(policy.quietHours.start);
  const end = toMin(policy.quietHours.end);
  return start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
}

/** Checks state at fire time: answered, resolved, or superseded asks get no reminder. */
export async function sendReminder(svc: Services, shipmentId: string, taskId: string, step: number): Promise<void> {
  const policy = svc.config.reminderPolicy;
  await withCase(svc, shipmentId, async (scope) => {
    const [task] = await scope.tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task || !task.switchRoomId) return;
    const issues = await reminderEligible(scope, task);
    if (!issues) {
      await scope.event("REMINDER_SENT", { taskId, step, skipped: true, reason: "answered, resolved or superseded" });
      return;
    }
    if (inQuietHours(policy, new Date())) {
      scope.enqueue("reminder", { shipmentId, taskId, step }, `reminder:${taskId}:${step}:deferred:${new Date().toISOString().slice(0, 13)}`, 60 * 60_000);
      return;
    }
    const checks = await latestChecks(scope);
    await scope.say({
      purpose: "supplier_reminder",
      roomId: task.switchRoomId,
      threadId: scope.shipment.supplierThreadId,
      content: { kind: "post", body: supplierReminder(scope.shipment, issues, checks, step, svc.config.DEMO_TIMING_PROFILE ? policy.label : null) },
      dedupeKey: `reminder:${taskId}:${step}`,
      visibility: "supplier",
    });
    await scope.event("REMINDER_SENT", { taskId, step, policy: policy.label });
    if (step < policy.maxReminders) {
      scope.enqueue("reminder", { shipmentId, taskId, step: step + 1 }, `reminder:${taskId}:${step + 1}`, policy.repeatIntervalMinutes * 60_000);
    }
  });
}

export async function escalate(svc: Services, shipmentId: string, taskId: string): Promise<void> {
  await withCase(svc, shipmentId, async (scope) => {
    const [task] = await scope.tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task) return;
    const issues = await reminderEligible(scope, task);
    if (!issues) return;
    for (const issue of issues) {
      if (issue.status !== "ESCALATED") await transitionIssue(scope.tx, issue, "ESCALATED", "no supplier response within the escalation threshold", undefined, { escalatedAt: new Date() });
    }
    const ops = await opsTarget(svc, scope.shipment);
    if (ops) {
      await scope.say({
        purpose: "ops_escalation",
        roomId: ops.roomId,
        threadId: ops.threadId,
        content: {
          kind: "post",
          body: `Reissue · ${scope.shipment.caseCode} — escalated to operations lead\nNo supplier reply after ${svc.config.reminderPolicy.escalationAfterMinutes} minutes (${svc.config.reminderPolicy.label}). Open: ${issues.map((i) => `${i.code} ${i.title}`).join("; ")}.`,
        },
        dedupeKey: `escalation:${taskId}`,
        visibility: "internal",
      });
    }
    await scope.event("ESCALATED", { taskId, issueCodes: issues.map((i) => i.code) });
  });
}

/** Applies a supplier's natural-language reply to the case it belongs to. */
export async function recordSupplierReply(
  svc: Services,
  shipmentId: string,
  reply: { messageId: string; roomId: string; threadId: string | null; sender: string; senderName: string; body: string; intent: SupplierReplyIntent; statedValue: string | null; attachmentCount: number },
): Promise<void> {
  await withCase(svc, shipmentId, async (scope) => {
    const issues = (await openIssues(scope)).filter((i) => i.responsibleRole === "SUPPLIER");
    const inserted = await scope.tx
      .insert(schema.supplierMessages)
      .values({
        id: newId("smsg"),
        shipmentId,
        switchRoomId: reply.roomId,
        threadId: reply.threadId,
        messageId: reply.messageId,
        sender: reply.sender,
        senderName: reply.senderName,
        body: reply.body.slice(0, 4000),
        classification: reply.intent,
        statedValue: reply.statedValue,
        relatedIssueIds: issues.map((i) => i.id),
        attachmentCount: reply.attachmentCount,
      })
      .onConflictDoNothing({ target: schema.supplierMessages.messageId })
      .returning({ id: schema.supplierMessages.id });
    if (!inserted.length) return;
    for (const issue of issues) {
      if (["REQUEST_SENT", "ESCALATED", "OWNER_ASSIGNED"].includes(issue.status)) {
        await transitionIssue(scope.tx, issue, "ANSWER_RECEIVED", `supplier replied (${reply.intent})`, { kind: "human", id: reply.sender, display: reply.senderName, platform: "switch" });
      }
    }
    await scope.event(
      "SUPPLIER_REPLY_RECEIVED",
      { messageId: reply.messageId, intent: reply.intent, statedValue: reply.statedValue, excerpt: reply.body.slice(0, 280), attachments: reply.attachmentCount, issueCodes: issues.map((i) => i.code) },
      { kind: "human", id: reply.sender, display: reply.senderName, platform: "switch" },
    );
    await scope.tx
      .update(schema.tasks)
      .set({ status: "ANSWERED", updatedAt: sql`now()` })
      .where(and(eq(schema.tasks.shipmentId, shipmentId), eq(schema.tasks.kind, "SUPPLIER_REQUEST"), inArray(schema.tasks.status, ["PENDING", "SENT"])));
  });
}

/** Marks supplier issues as having a replacement in hand, before the recheck runs. */
export async function markReplacementReceived(svc: Services, shipmentId: string): Promise<void> {
  await withCase(svc, shipmentId, async (scope) => {
    for (const issue of (await openIssues(scope)).filter((i) => i.responsibleRole === "SUPPLIER")) {
      if (["REQUEST_SENT", "ANSWER_RECEIVED", "ESCALATED", "OWNER_ASSIGNED"].includes(issue.status)) {
        await transitionIssue(scope.tx, issue, "REPLACEMENT_RECEIVED", "supplier sent a revised document");
      }
    }
  });
}

function stableHash(text: string): string {
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0;
    b = (Math.imul(b, 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}
