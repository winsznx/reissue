import { z } from "zod";

/** Agent-facing Switch wire types (agent-protocol revision 8), validated at the boundary. */

export const AttachmentRef = z.object({
  filename: z.string(),
  mimetype: z.string(),
  size: z.number(),
  mxc: z.string(),
  msgtype: z.string(),
});
export type AttachmentRef = z.infer<typeof AttachmentRef>;

export const MessagePayload = z.object({
  addressed: z.boolean(),
  sender: z.string(),
  sender_name: z.string(),
  sender_kind: z.enum(["user", "agent", "platform"]).nullable().optional(),
  on_behalf_of: z.string().nullable().optional(),
  message_id: z.string(),
  body: z.string(),
  timestamp: z.number(),
  thread_id: z.string().nullable(),
  attachments: z.array(AttachmentRef).default([]),
  opening_message: z.string().nullable().optional(),
  sender_role: z.enum(["owner", "admin", "member"]).nullable().optional(),
});
export type MessagePayload = z.infer<typeof MessagePayload>;

export const CommandPayload = z.object({
  command: z.string(),
  args: z.string().default(""),
  user_id: z.string(),
  user_name: z.string(),
  thread_id: z.string().nullable().optional(),
});
export type CommandPayload = z.infer<typeof CommandPayload>;

export const RoomJoinPayload = z.object({
  member: z.string(),
  member_name: z.string(),
  timestamp: z.number(),
  listening: z.boolean(),
});

export const DomainEventData = z.object({
  type: z.enum(["message", "command", "room_join"]),
  room_id: z.string(),
  bridge_id: z.string().nullable().optional(),
  channel_type: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  sequence: z.number().optional(),
  missed: z.object({ count: z.number().nullable(), reason: z.string().nullable() }).optional(),
});

export const ConnectionState = z.object({
  connection_id: z.string(),
  agent_id: z.string(),
  generation: z.number(),
  rooms: z.array(z.string()),
  cursor: z.number(),
  heartbeat_interval_seconds: z.number(),
  protocol: z.number().optional(),
  server: z.object({ version: z.string().nullable() }).partial().optional(),
});
export type ConnectionState = z.infer<typeof ConnectionState>;

export const GapFrame = z.object({
  from_sequence: z.number(),
  resumed_at: z.number(),
  rooms: z.array(z.string()).optional(),
  all_rooms: z.boolean().optional(),
  reason: z.string(),
});
export type GapFrame = z.infer<typeof GapFrame>;

export const EvictedFrame = z.object({
  code: z.string(),
  reason: z.string().optional().default(""),
  room_id: z.string().nullable().optional(),
});
export type EvictedFrame = z.infer<typeof EvictedFrame>;

export const ServerFrame = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
  id: z.number().optional(),
});

export interface InboundMessage {
  kind: "message";
  roomId: string;
  sequence: number | null;
  missed: { count: number | null; reason: string | null } | null;
  payload: MessagePayload;
}

export interface InboundCommand {
  kind: "command";
  roomId: string;
  sequence: number | null;
  payload: CommandPayload;
}

export type InboundEvent = InboundMessage | InboundCommand;

export interface OperationSpec {
  description: string;
  input_schema: { properties?: Record<string, unknown>; required?: string[] };
}

export interface ContextEntry {
  id: string;
  kind: "message" | "room_join";
  sender: string;
  sender_name: string;
  body: string;
  timestamp: number;
  attachments: AttachmentRef[];
}

export interface ReadContextResult {
  threads: { root: ContextEntry; replies: ContextEntry[] }[];
  truncated: boolean;
  oldest_timestamp: number | null;
}

export interface Participant {
  id: string;
  name: string;
  type: string;
  status?: string;
  alias?: string | null;
}

export class SwitchHttpError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    readonly detail: unknown,
  ) {
    super(`Switch ${operation} failed with ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    this.name = "SwitchHttpError";
  }

  /** Errors worth retrying: transport, rate/budget limits, server faults. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}
