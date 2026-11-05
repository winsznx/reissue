import { z } from "zod";

/**
 * Reissue-owned business payloads carried inside Switch messages between agents.
 * They travel as a fenced ```reissue JSON block inside an addressed message; Switch
 * owns delivery and addressing, Reissue owns the schema.
 */

export const DocumentReviewRequested = z.object({
  kind: z.literal("DOCUMENT_REVIEW_REQUESTED"),
  case_id: z.string(),
  task_id: z.string(),
  document_version_ids: z.array(z.string()).min(1),
  issue_ids: z.array(z.string()),
  requested_result: z.string(),
  reply_room_id: z.string(),
  visibility: z.enum(["internal"]),
});
export type DocumentReviewRequested = z.infer<typeof DocumentReviewRequested>;

export const ReviewFinding = z.object({
  issue_id: z.string(),
  verdict: z.enum(["CONFIRMED", "NOT_CONFIRMED", "NEEDS_HUMAN"]),
  /** Citations the examiner inspected through Reissue tools, e.g. `doc_ver_x p.1 line:2.quantity`. */
  citations: z.array(z.string()).min(1),
  note: z.string().max(600),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;

export const DocumentReviewResult = z.object({
  kind: z.literal("DOCUMENT_REVIEW_RESULT"),
  case_id: z.string(),
  task_id: z.string(),
  findings: z.array(ReviewFinding),
});
export type DocumentReviewResult = z.infer<typeof DocumentReviewResult>;

export const SupplierRequestAssigned = z.object({
  kind: z.literal("SUPPLIER_REQUEST_ASSIGNED"),
  case_id: z.string(),
  task_id: z.string(),
  issue_ids: z.array(z.string()).min(1),
  supplier_room_id: z.string(),
  /** Supplier-safe text only: case code, field, both stated values, page references. */
  supplier_brief: z.string().max(1200),
});
export type SupplierRequestAssigned = z.infer<typeof SupplierRequestAssigned>;

export const SupplierReplyIntent = z.enum([
  "CONFIRMS_VALUE",
  "DOCUMENT_OUTDATED",
  "REPLACEMENT_PROMISED",
  "REPLACEMENT_ATTACHED",
  "QUESTION",
  "DISPUTE",
  "UNRELATED",
]);
export type SupplierReplyIntent = z.infer<typeof SupplierReplyIntent>;

export const SupplierReplyRelayed = z.object({
  kind: z.literal("SUPPLIER_REPLY_RELAYED"),
  case_id: z.string(),
  task_id: z.string(),
  supplier_message_id: z.string(),
  intent: SupplierReplyIntent,
  stated_value: z.string().nullable(),
  summary: z.string().max(600),
});
export type SupplierReplyRelayed = z.infer<typeof SupplierReplyRelayed>;

export const AgentPayload = z.discriminatedUnion("kind", [
  DocumentReviewRequested,
  DocumentReviewResult,
  SupplierRequestAssigned,
  SupplierReplyRelayed,
]);
export type AgentPayload = z.infer<typeof AgentPayload>;

const FENCE = /```reissue\s*\n([\s\S]*?)\n```/;

export function encodeAgentPayload(payload: AgentPayload): string {
  return "```reissue\n" + JSON.stringify(payload) + "\n```";
}

export type DecodedPayload =
  | { ok: true; payload: AgentPayload }
  | { ok: false; reason: "absent" | "invalid_json" | "schema"; detail?: string };

export function decodeAgentPayload(text: string): DecodedPayload {
  const match = FENCE.exec(text);
  if (!match?.[1]) return { ok: false, reason: "absent" };
  let json: unknown;
  try {
    json = JSON.parse(match[1]);
  } catch (error) {
    return { ok: false, reason: "invalid_json", detail: error instanceof Error ? error.message : String(error) };
  }
  const parsed = AgentPayload.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "schema", detail: parsed.error.message };
  return { ok: true, payload: parsed.data };
}
