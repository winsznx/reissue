import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { classifySupplierReply, parseConversionStatement } from "@reissue/ai";
import { decodeAgentPayload, type ActorRef } from "@reissue/contracts";
import { findCaseCodes, isIssueOpen } from "@reissue/core";
import { schema } from "@reissue/db";
import { MessagePayload, SwitchHttpError, type AttachmentRef } from "@reissue/switch-adapter";

import { applyReviewResult, markReplacementReceived, recordSupplierReply, recordSupplierThread } from "./collaboration.js";
import { assignCase, recordClarification, requestRecheck } from "./case-actions.js";
import { appendEvent, type Shipment } from "./case-log.js";
import { ingest, type IncomingFile, type IntakeRejection } from "./intake.js";
import { askWhichCase, caseUrl } from "./messages.js";
import { bindingForRoom, type RoomBinding } from "./rooms.js";
import { queueMessage, type Services } from "./services.js";

type SwitchEventRow = typeof schema.switchEvents.$inferSelect;
type Outcome = { status: "PROCESSED" | "IGNORED"; detail: string };

/** Text that says a file is attached; used to notice when the chat app dropped it. */
const CLAIMS_ATTACHMENT = /\b(attached|attaching|enclosed|herewith|see (the )?(file|pdf|scan))\b/i;

const ACTIVE_STATES = ["RECEIVED", "PARSING", "RECONCILING", "NEEDS_CLARIFICATION", "WAITING_ON_SUPPLIER", "RECHECKING", "ERROR_RECOVERABLE"] as const;

/** Processes one persisted Switch event. Idempotent: a processed event is never acted on twice. */
export async function processInboundEvent(svc: Services, switchEventId: string): Promise<Outcome> {
  const [row] = await svc.db.select().from(schema.switchEvents).where(eq(schema.switchEvents.id, switchEventId));
  if (!row) return { status: "IGNORED", detail: "event not found" };
  if (row.status === "PROCESSED" || row.status === "IGNORED") return { status: row.status, detail: row.detail ?? "" };
  const outcome = await route(svc, row);
  await svc.db
    .update(schema.switchEvents)
    .set({ status: outcome.status, detail: outcome.detail.slice(0, 500), processedAt: sql`now()` })
    .where(eq(schema.switchEvents.id, row.id));
  return outcome;
}

async function route(svc: Services, row: SwitchEventRow): Promise<Outcome> {
  if (row.eventType !== "message") return { status: "IGNORED", detail: `event type ${row.eventType}` };
  const parsed = MessagePayload.safeParse(row.payload);
  if (!parsed.success) return { status: "IGNORED", detail: "malformed payload" };
  const msg = parsed.data;
  const binding = await bindingForRoom(svc.db, row.roomId);
  if (!binding) return { status: "IGNORED", detail: "room is not bound to Reissue" };
  if (binding.tenantId !== svc.tenantId) return { status: "IGNORED", detail: "room belongs to another workspace" };
  if (msg.sender_name === svc.config.SWITCH_COORDINATOR_NAME) return { status: "IGNORED", detail: "own message" };

  const fromAgent = msg.sender_kind === "agent" || [svc.config.SWITCH_EXAMINER_NAME, svc.config.SWITCH_LIAISON_NAME].includes(msg.sender_name);
  if (fromAgent) return handleAgentMessage(svc, binding, row.roomId, msg);
  if (binding.intent === "SUPPLIER") return handleSupplierMessage(svc, binding, row.roomId, msg);
  return handleOpsMessage(svc, binding, row.roomId, msg);
}

function humanActor(msg: MessagePayload, platform: string): ActorRef {
  return { kind: "human", id: msg.sender, display: msg.sender_name, platform };
}

async function handleAgentMessage(svc: Services, binding: RoomBinding, roomId: string, msg: MessagePayload): Promise<Outcome> {
  const decoded = decodeAgentPayload(msg.body);
  if (decoded.ok && decoded.payload.kind === "DOCUMENT_REVIEW_RESULT") {
    if (msg.sender_name !== svc.config.SWITCH_EXAMINER_NAME) return { status: "IGNORED", detail: "review result from an agent that is not the examiner" };
    const applied = await applyReviewResult(svc, decoded.payload, msg.sender_name, msg.message_id);
    return { status: applied.applied ? "PROCESSED" : "IGNORED", detail: applied.reason ?? "review applied" };
  }
  if (decoded.ok && decoded.payload.kind === "SUPPLIER_REPLY_RELAYED") {
    const relay = decoded.payload;
    const [shipment] = await svc.db.select().from(schema.shipments).where(and(eq(schema.shipments.tenantId, svc.tenantId), eq(schema.shipments.caseCode, relay.case_id)));
    if (!shipment) return { status: "IGNORED", detail: "relay for unknown case" };
    await svc.db.transaction((tx) =>
      appendEvent(tx, shipment.id, "SUPPLIER_REPLY_RECEIVED", { relayedBy: msg.sender_name, intent: relay.intent, statedValue: relay.stated_value, summary: relay.summary, supplierMessageId: relay.supplier_message_id, relay: true }, { kind: "agent", id: msg.sender, display: msg.sender_name, platform: "switch" }),
    );
    return { status: "PROCESSED", detail: "liaison relay recorded" };
  }
  if (binding.intent === "SUPPLIER" && msg.sender_name === svc.config.SWITCH_LIAISON_NAME) {
    const codes = findCaseCodes(msg.body);
    if (codes.length !== 1) return { status: "IGNORED", detail: "liaison post without a single case code" };
    const [shipment] = await svc.db.select().from(schema.shipments).where(and(eq(schema.shipments.tenantId, svc.tenantId), eq(schema.shipments.caseCode, codes[0]!)));
    if (!shipment) return { status: "IGNORED", detail: "liaison post for unknown case" };
    const [task] = await svc.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.shipmentId, shipment.id), eq(schema.tasks.kind, "SUPPLIER_REQUEST"), eq(schema.tasks.status, "PENDING")))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);
    await recordSupplierThread(svc, shipment.id, task?.id ?? null, msg.message_id, msg.thread_id);
    if (task) {
      await svc.db.transaction((tx) =>
        appendEvent(tx, shipment.id, "SUPPLIER_REQUEST_SENT", { taskId: task.id, roomId, via: msg.sender_name, messageId: msg.message_id, posted: true }, { kind: "agent", id: msg.sender, display: msg.sender_name, platform: binding.platform }),
      );
    }
    return { status: "PROCESSED", detail: "liaison supplier post correlated" };
  }
  return { status: "IGNORED", detail: "agent chatter" };
}

async function caseForOpsMessage(svc: Services, msg: MessagePayload): Promise<Shipment | null> {
  if (msg.thread_id) {
    const [byThread] = await svc.db.select().from(schema.shipments).where(and(eq(schema.shipments.tenantId, svc.tenantId), eq(schema.shipments.opsThreadId, msg.thread_id)));
    if (byThread) return byThread;
  }
  const codes = findCaseCodes(msg.body);
  if (codes.length === 1) {
    const [byCode] = await svc.db.select().from(schema.shipments).where(and(eq(schema.shipments.tenantId, svc.tenantId), eq(schema.shipments.caseCode, codes[0]!)));
    return byCode ?? null;
  }
  return null;
}

async function fetchAttachments(svc: Services, roomId: string, attachments: AttachmentRef[], uploadHint: string): Promise<{ files: IncomingFile[]; rejected: IntakeRejection[] }> {
  const files: IncomingFile[] = [];
  const rejected: IntakeRejection[] = [];
  for (const a of attachments) {
    if (a.size > svc.config.SWITCH_MEDIA_MAX_BYTES) {
      rejected.push({ filename: a.filename, reason: "too_large", detail: `It is ${(a.size / 1048576).toFixed(1)} MB; chat files are limited to ${svc.config.SWITCH_MEDIA_MAX_BYTES / 1048576} MB. Upload it here instead: ${uploadHint}` });
      continue;
    }
    try {
      files.push({ filename: a.filename, bytes: await svc.switch!.downloadMedia(roomId, a.mxc, svc.config.SWITCH_MEDIA_MAX_BYTES) });
    } catch (error) {
      if (error instanceof SwitchHttpError && error.retryable) throw error;
      rejected.push({ filename: a.filename, reason: "download_failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return { files, rejected };
}

async function reply(svc: Services, shipmentId: string | null, roomId: string, threadId: string | null, body: string, dedupeKey: string, visibility: "internal" | "supplier"): Promise<void> {
  const id = await svc.db.transaction((tx) => queueMessage(tx, shipmentId, { purpose: "chat_reply", roomId, threadId, content: { kind: "post", body }, dedupeKey, visibility }));
  if (id) await svc.queue.enqueueOutbox(id);
}

/** A redelivered message whose files were already taken in must not open a second case. */
async function alreadyIngested(svc: Services, msg: MessagePayload): Promise<boolean> {
  const [row] = await svc.db
    .select({ id: schema.documentVersions.id })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.sourceMessageId, msg.message_id))
    .limit(1);
  return Boolean(row);
}

async function handleOpsMessage(svc: Services, binding: RoomBinding, roomId: string, msg: MessagePayload): Promise<Outcome> {
  if (!msg.addressed) return { status: "IGNORED", detail: "not addressed to reissue" };
  if (msg.attachments.length && (await alreadyIngested(svc, msg))) return { status: "IGNORED", detail: "files from this message were already taken in" };
  const actor = humanActor(msg, binding.platform);
  const shipment = await caseForOpsMessage(svc, msg);
  const threadId = msg.thread_id ?? msg.message_id;
  const uploadHint = `${svc.config.REISSUE_PUBLIC_URL}/upload${shipment ? `?case=${shipment.caseCode}` : ""}`;

  let attachments = msg.attachments;
  let earlierMessageIds: string[] = [];
  if (!attachments.length && /\b(check|compare|review)\b/i.test(msg.body) && !shipment) {
    const earlier = await recentUnprocessedAttachments(svc, roomId, msg);
    attachments = earlier.attachments;
    earlierMessageIds = earlier.messageIds;
  }

  if (attachments.length) {
    const { files, rejected } = await fetchAttachments(svc, roomId, attachments, uploadHint);
    const result = await ingest(svc, {
      tenantId: svc.tenantId,
      shipmentId: shipment?.id,
      files,
      preRejected: rejected,
      source: { platform: binding.platform, roomId, messageId: msg.message_id, threadId: msg.thread_id, senderRef: msg.sender, senderName: msg.sender_name, receivedAt: new Date(msg.timestamp) },
      actor,
      replyTo: { roomId, threadId: shipment?.opsThreadId ?? threadId },
      correlationId: msg.message_id,
    });
    if (earlierMessageIds.length) {
      await svc.db
        .update(schema.switchEvents)
        .set({ status: "PROCESSED", detail: `files taken in by ${msg.message_id} (${result.shipment.caseCode})`, processedAt: sql`now()` })
        .where(and(eq(schema.switchEvents.roomId, roomId), inArray(schema.switchEvents.messageId, earlierMessageIds)));
    }
    return { status: "PROCESSED", detail: `intake ${result.intakeId}: ${result.accepted.length} accepted, ${result.duplicates.length} duplicate, ${result.rejected.length} rejected` };
  }

  if (!shipment) {
    await reply(svc, null, roomId, threadId, "Reissue · Attach the commercial invoice and packing list (PDF, scan, or XLSX) and mention me, or reply in an existing case thread.", `help:${msg.message_id}`, "internal");
    return { status: "PROCESSED", detail: "help sent" };
  }

  const conversion = parseConversionStatement(msg.body);
  if (conversion) {
    const sourceReference = /source:\s*(.+)$/i.exec(msg.body)?.[1]?.trim() ?? `stated in chat message ${msg.message_id}`;
    await recordClarification(
      svc,
      shipment.id,
      { kind: "conversion_factor", sku: conversion.sku ?? "*", fromUnit: conversion.packageUnit, toUnit: "pcs", factor: conversion.piecesPerPackage, sourceReference: `${sourceReference} (“${conversion.quote}”)` },
      actor,
      null,
    );
    await reply(svc, shipment.id, roomId, shipment.opsThreadId ?? threadId, `Reissue · ${shipment.caseCode} — recorded ${conversion.piecesPerPackage} pcs per ${conversion.packageUnit}${conversion.sku ? ` for ${conversion.sku}` : ""} from ${msg.sender_name}. Recomputing the checks now.`, `clarified:${msg.message_id}`, "internal");
    return { status: "PROCESSED", detail: "conversion recorded" };
  }
  if (/\b(recheck|re-check|try again|retry)\b/i.test(msg.body)) {
    await requestRecheck(svc, shipment.id, actor);
    return { status: "PROCESSED", detail: "recheck requested" };
  }
  const assign = /\bassign(?:ed)?\s+(?:this\s+)?to\s+@?([\w.\- ]{2,40})/i.exec(msg.body);
  if (assign?.[1]) {
    await assignCase(svc, shipment.id, assign[1].trim(), actor);
    await reply(svc, shipment.id, roomId, shipment.opsThreadId ?? threadId, `Reissue · ${shipment.caseCode} is now assigned to ${assign[1].trim()}.`, `assigned:${msg.message_id}`, "internal");
    return { status: "PROCESSED", detail: "assigned" };
  }
  await reply(svc, shipment.id, roomId, shipment.opsThreadId ?? threadId, await statusLine(svc, shipment), `status:${msg.message_id}`, "internal");
  return { status: "PROCESSED", detail: "status sent" };
}

async function statusLine(svc: Services, shipment: Shipment): Promise<string> {
  const issues = (await svc.db.select().from(schema.issues).where(eq(schema.issues.shipmentId, shipment.id))).filter((i) => isIssueOpen(i.status));
  const state = shipment.state.replace(/_/g, " ").toLowerCase();
  const lines = [`Reissue · ${shipment.caseCode} — ${state}`];
  for (const i of issues) lines.push(`${i.code} ${i.title} · ${i.status.replace(/_/g, " ").toLowerCase()} · owner ${i.assignee ?? i.responsibleRole.toLowerCase()}`);
  if (!issues.length) lines.push("No open discrepancies.");
  lines.push(caseUrl(svc.config.REISSUE_PUBLIC_URL, shipment));
  return lines.join("\n");
}

/** "Check the documents above": finds files a person posted recently in this thread or room that no case holds yet. */
async function recentUnprocessedAttachments(svc: Services, roomId: string, msg: MessagePayload): Promise<{ attachments: AttachmentRef[]; messageIds: string[] }> {
  if (!svc.switch) return { attachments: [], messageIds: [] };
  const context = await svc.switch.readContext(roomId, { limit: 20 });
  const thread = msg.thread_id ? context.threads.find((t) => t.root.id === msg.thread_id) : undefined;
  const entries = thread ? [thread.root, ...thread.replies] : context.threads.slice(-5).flatMap((t) => [t.root, ...t.replies]);
  const candidates = entries.filter((e) => e.attachments.length && e.sender === msg.sender && e.timestamp <= msg.timestamp && msg.timestamp - e.timestamp < 30 * 60_000);
  const ids = candidates.map((c) => c.id);
  if (!ids.length) return { attachments: [], messageIds: [] };
  const taken = await svc.db
    .select({ id: schema.switchEvents.messageId })
    .from(schema.switchEvents)
    .where(and(eq(schema.switchEvents.roomId, roomId), inArray(schema.switchEvents.messageId, ids), sql`${schema.switchEvents.detail} like 'files taken in by %'`));
  const used = await svc.db.select({ id: schema.documentVersions.sourceMessageId }).from(schema.documentVersions).where(inArray(schema.documentVersions.sourceMessageId, ids));
  const usedIds = new Set([...taken, ...used].map((u) => u.id));
  const fresh = candidates.filter((c) => !usedIds.has(c.id));
  return { attachments: fresh.flatMap((c) => c.attachments), messageIds: fresh.map((c) => c.id) };
}

async function caseForSupplierMessage(svc: Services, roomId: string, msg: MessagePayload): Promise<{ shipment: Shipment | null; ambiguous: string[] }> {
  const active = await svc.db
    .select()
    .from(schema.shipments)
    .where(and(eq(schema.shipments.tenantId, svc.tenantId), eq(schema.shipments.supplierRoomId, roomId), inArray(schema.shipments.state, [...ACTIVE_STATES, "READY_FOR_BROKER_REVIEW"])));
  if (msg.thread_id) {
    const byThread = active.find((s) => s.supplierThreadId === msg.thread_id);
    if (byThread) return { shipment: byThread, ambiguous: [] };
  }
  const codes = findCaseCodes(msg.body);
  const byCode = active.filter((s) => codes.includes(s.caseCode));
  if (byCode.length === 1) return { shipment: byCode[0]!, ambiguous: [] };
  if (byCode.length > 1) return { shipment: null, ambiguous: byCode.map((s) => s.caseCode) };
  const waiting = active.filter((s) => s.state !== "READY_FOR_BROKER_REVIEW");
  if (waiting.length === 1 && !codes.length) return { shipment: waiting[0]!, ambiguous: [] };
  if (waiting.length > 1) return { shipment: null, ambiguous: waiting.map((s) => s.caseCode) };
  return { shipment: null, ambiguous: [] };
}

async function handleSupplierMessage(svc: Services, binding: RoomBinding, roomId: string, msg: MessagePayload): Promise<Outcome> {
  const { shipment, ambiguous } = await caseForSupplierMessage(svc, roomId, msg);
  const threadId = msg.thread_id ?? msg.message_id;
  if (!shipment) {
    if (ambiguous.length) {
      await reply(svc, null, roomId, threadId, askWhichCase(ambiguous), `which_case:${msg.message_id}`, "supplier");
      return { status: "PROCESSED", detail: `asked which case among ${ambiguous.join(", ")}` };
    }
    return { status: "IGNORED", detail: "no open correction request in this room" };
  }
  const inCaseConversation = msg.addressed || msg.thread_id === shipment.supplierThreadId || findCaseCodes(msg.body).includes(shipment.caseCode);
  // Only this case waits on the supplier room, so a file sent straight into the chat is its revision.
  if (!inCaseConversation && !msg.attachments.length) {
    return { status: "IGNORED", detail: "message is outside the case conversation" };
  }
  const actor = humanActor(msg, binding.platform);

  if (msg.attachments.length) {
    if (await alreadyIngested(svc, msg)) return { status: "IGNORED", detail: "files from this message were already taken in" };
    const { files, rejected } = await fetchAttachments(svc, roomId, msg.attachments, `${svc.config.REISSUE_PUBLIC_URL}/upload?case=${shipment.caseCode}`);
    const classification = await classifySupplierReply(msg.body, true, svc.replyModel);
    await recordSupplierReply(svc, shipment.id, { messageId: msg.message_id, roomId, threadId: msg.thread_id, sender: msg.sender, senderName: msg.sender_name, body: msg.body, intent: classification.intent, statedValue: classification.statedValue, attachmentCount: msg.attachments.length });
    if (files.length) await markReplacementReceived(svc, shipment.id);
    const result = await ingest(svc, {
      tenantId: svc.tenantId,
      shipmentId: shipment.id,
      files,
      preRejected: rejected,
      source: { platform: binding.platform, roomId, messageId: msg.message_id, threadId: msg.thread_id, senderRef: msg.sender, senderName: msg.sender_name, receivedAt: new Date(msg.timestamp) },
      actor,
      replyTo: shipment.opsRoomId ? { roomId: shipment.opsRoomId, threadId: shipment.opsThreadId } : null,
      correlationId: msg.message_id,
    });
    const names = result.accepted.map((a) => a.filename);
    const lines = [`Reissue · ${shipment.caseCode} — received ${names.length ? names.join(", ") : "no usable file"}.`];
    if (names.length) lines.push("Rechecking it against the invoice now.");
    for (const r of [...result.rejected, ...result.quarantined.map((q) => ({ filename: q.filename, detail: `held for review: ${q.detail}` }))]) lines.push(`${r.filename}: ${r.detail}`);
    for (const d of result.duplicates) lines.push(`${d.filename} is identical to a file we already have.`);
    await reply(svc, shipment.id, roomId, threadId, lines.join("\n"), `supplier_file_ack:${msg.message_id}`, "supplier");
    return { status: "PROCESSED", detail: `replacement intake ${result.intakeId}` };
  }

  if (CLAIMS_ATTACHMENT.test(msg.body)) {
    await reply(
      svc,
      shipment.id,
      roomId,
      threadId,
      `Reissue · ${shipment.caseCode} — no file came through with that message. Chat apps drop files over ${svc.config.SWITCH_MEDIA_MAX_BYTES / 1048576} MB; if it is larger, upload it here instead: ${svc.config.REISSUE_PUBLIC_URL}/upload?case=${shipment.caseCode}`,
      `missing_file:${msg.message_id}`,
      "supplier",
    );
  }
  const classification = await classifySupplierReply(msg.body, false, svc.replyModel);
  await recordSupplierReply(svc, shipment.id, { messageId: msg.message_id, roomId, threadId: msg.thread_id, sender: msg.sender, senderName: msg.sender_name, body: msg.body, intent: classification.intent, statedValue: classification.statedValue, attachmentCount: 0 });
  const conversion = parseConversionStatement(msg.body);
  if (conversion) {
    await recordClarification(
      svc,
      shipment.id,
      { kind: "conversion_factor", sku: conversion.sku ?? "*", fromUnit: conversion.packageUnit, toUnit: "pcs", factor: conversion.piecesPerPackage, sourceReference: `supplier message ${msg.message_id}: “${conversion.quote}”` },
      actor,
      null,
    );
  }
  if (!svc.config.SWITCH_LIAISON_NAME) {
    const response =
      classification.intent === "DOCUMENT_OUTDATED" || classification.intent === "REPLACEMENT_PROMISED" || classification.intent === "CONFIRMS_VALUE"
        ? `Reissue · ${shipment.caseCode} — thank you. Please attach the revised supplier-issued PDF in this thread; we recheck it automatically.`
        : conversion
          ? `Reissue · ${shipment.caseCode} — noted ${conversion.piecesPerPackage} pcs per ${conversion.packageUnit}; rechecking.`
          : null;
    if (response) await reply(svc, shipment.id, roomId, threadId, response, `supplier_ack:${msg.message_id}`, "supplier");
  }
  return { status: "PROCESSED", detail: `supplier reply ${classification.intent} (${classification.method})` };
}
