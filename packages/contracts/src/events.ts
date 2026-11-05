import { z } from "zod";

export const CaseEventType = z.enum([
  "CASE_CREATED",
  "FILES_RECEIVED",
  "DUPLICATE_FILE_REUSED",
  "DOCUMENT_QUARANTINED",
  "DOCUMENT_CLASSIFIED",
  "EXTRACTION_STARTED",
  "EXTRACTION_COMPLETED",
  "EXTRACTION_FAILED",
  "RECONCILIATION_COMPLETED",
  "ISSUE_OPENED",
  "ISSUE_RESOLVED",
  "ISSUE_REOPENED",
  "ISSUE_STATE_CHANGED",
  "ISSUE_REASSIGNED",
  "REVIEW_REQUESTED",
  "REVIEW_RECEIVED",
  "SUPPLIER_REQUEST_SENT",
  "SUPPLIER_REPLY_RECEIVED",
  "REPLACEMENT_RECEIVED",
  "REPLACEMENT_REJECTED",
  "VERSION_SUPERSEDED",
  "STALE_VERSION_KEPT_AS_HISTORY",
  "HUMAN_CLARIFICATION_RECORDED",
  "CASE_CODE_REQUESTED",
  "REMINDER_SENT",
  "ESCALATED",
  "PACKET_GENERATED",
  "PACKET_SUPERSEDED",
  "COMPLETION_POSTED",
  "STATE_CHANGED",
  "ASSIGNEE_CHANGED",
  "RECHECK_REQUESTED",
  "JOB_FAILED",
  "JOB_RETRIED",
  "MESSAGE_POSTED",
]);
export type CaseEventType = z.infer<typeof CaseEventType>;

export const ActorRef = z.object({
  kind: z.enum(["system", "agent", "human", "switch"]),
  id: z.string(),
  display: z.string(),
  platform: z.string().nullable(),
});
export type ActorRef = z.infer<typeof ActorRef>;

export const CaseEvent = z.object({
  id: z.string(),
  caseId: z.string(),
  sequence: z.number().int(),
  type: CaseEventType,
  payload: z.record(z.string(), z.unknown()),
  actor: ActorRef,
  correlationId: z.string().nullable(),
  createdAt: z.string(),
});
export type CaseEvent = z.infer<typeof CaseEvent>;

/** Frame pushed on the Workbench SSE stream. One state event drives both chat and UI. */
export const StreamFrame = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: CaseEvent }),
  z.object({ kind: z.literal("heartbeat"), at: z.string() }),
]);
export type StreamFrame = z.infer<typeof StreamFrame>;
