import { SwitchHttpError, type OperationSpec, type Participant, type ReadContextResult } from "./types.js";

export interface SwitchAgentCredentials {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

export interface RegisterAgentInput {
  name: string;
  description: string;
  displayName?: string;
  connectionModel?: "always_on" | "session_addressable";
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request(url: string, init: RequestInit, operation: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new SwitchHttpError(0, operation, error instanceof Error ? error.message : String(error));
  }
  const body = await readBody(response);
  if (!response.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : body;
    throw new SwitchHttpError(response.status, operation, detail);
  }
  return body;
}

export async function switchHealth(baseUrl: string): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const started = performance.now();
  try {
    const body = await request(`${trim(baseUrl)}/health`, { method: "GET" }, "health", 5_000);
    const ok = typeof body === "object" && body !== null && (body as { status?: string }).status === "ok";
    return { ok, latencyMs: performance.now() - started, detail: ok ? "ok" : JSON.stringify(body) };
  } catch (error) {
    return { ok: false, latencyMs: performance.now() - started, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** One-time registration with a registration (or bootstrap) key. The returned api_key is shown once. */
export async function registerAgent(
  baseUrl: string,
  registrationKey: string,
  input: RegisterAgentInput,
): Promise<{ id: string; api_key: string }> {
  const body = await request(
    `${trim(baseUrl)}/agents`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${registrationKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        display_name: input.displayName ?? null,
        connector_type: "reissue-ts",
        integration_profile: {
          connection_model: input.connectionModel ?? "always_on",
          message_exchange: true,
          pre_invocation_mediation: [],
          post_invocation_mediation: [],
          event_reporting: [],
        },
      }),
    },
    "register",
  );
  const parsed = body as { id?: string; api_key?: string };
  if (!parsed.id || !parsed.api_key) throw new SwitchHttpError(200, "register", "response missing id or api_key");
  return { id: parsed.id, api_key: parsed.api_key };
}

function trim(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Agent-authenticated Switch client. Operation inputs are checked against the schemas the
 * server publishes at GET /agents/{id}/ops, so a payload the live server would reject fails
 * locally with a clear message instead of a guessed shape.
 */
export class SwitchClient {
  private ops: Map<string, OperationSpec> | null = null;

  constructor(readonly creds: SwitchAgentCredentials) {}

  private url(path: string): string {
    return `${trim(this.creds.baseUrl)}/agents/${encodeURIComponent(this.creds.agentId)}${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.creds.apiKey}`, ...extra };
  }

  async discoverOperations(): Promise<Map<string, OperationSpec>> {
    const body = (await request(this.url("/ops"), { headers: this.headers() }, "ops")) as {
      operations?: Record<string, OperationSpec>;
    };
    this.ops = new Map(Object.entries(body.operations ?? {}));
    return this.ops;
  }

  hasOperation(name: string): boolean {
    return this.ops?.has(name) ?? false;
  }

  private assertArgs(name: string, args: Record<string, unknown>): void {
    if (!this.ops) return;
    const spec = this.ops.get(name);
    if (!spec) throw new SwitchHttpError(404, name, `operation ${name} is not offered by this server`);
    const allowed = new Set(Object.keys(spec.input_schema.properties ?? {}));
    const unknown = Object.keys(args).filter((k) => !allowed.has(k));
    if (unknown.length) throw new SwitchHttpError(400, name, `unexpected arguments: ${unknown.join(", ")}`);
    const missing = (spec.input_schema.required ?? []).filter((k) => args[k] === undefined);
    if (missing.length) throw new SwitchHttpError(400, name, `missing arguments: ${missing.join(", ")}`);
  }

  async op<T>(name: string, args: Record<string, unknown>, connectionId?: string): Promise<T> {
    const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
    this.assertArgs(name, clean);
    const headers = this.headers({ "content-type": "application/json" });
    if (connectionId) headers["x-switch-connection-id"] = connectionId;
    const body = (await request(
      this.url(`/ops/${encodeURIComponent(name)}`),
      { method: "POST", headers, body: JSON.stringify(clean) },
      name,
    )) as { result: T };
    return body.result;
  }

  postMessage(connectionId: string, body: string, threadId?: string | null): Promise<{ event_id: string }> {
    return this.op("post_message", { body, thread_id: threadId ?? undefined }, connectionId);
  }

  sendTargetedMessage(
    connectionId: string,
    body: string,
    targetNames: string[],
    threadId?: string | null,
  ): Promise<{ event_id: string; target_statuses: Record<string, string> }> {
    return this.op("send_targeted_message", { body, target_names: targetNames, thread_id: threadId ?? undefined }, connectionId);
  }

  readContext(roomId: string, options: { limit?: number; since?: string } = {}): Promise<ReadContextResult> {
    return this.op("read_context", { room_id: roomId, limit: options.limit ?? 50, since: options.since });
  }

  listParticipants(connectionId: string): Promise<Participant[]> {
    return this.op("list_participants", {}, connectionId);
  }

  /** Room post without a live connection. Switch's route has no thread support. */
  async postToRoom(roomId: string, content: string): Promise<{ event_id: string }> {
    const body = (await request(
      this.url("/message"),
      { method: "POST", headers: this.headers({ "content-type": "application/json" }), body: JSON.stringify({ room_id: roomId, content }) },
      "message",
    )) as { event_id: string };
    return { event_id: body.event_id };
  }

  async downloadMedia(roomId: string, mxc: string, maxBytes: number): Promise<Buffer> {
    const url = `${this.url(`/rooms/${encodeURIComponent(roomId)}/media`)}?mxc=${encodeURIComponent(mxc)}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new SwitchHttpError(0, "media_download", error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw new SwitchHttpError(response.status, "media_download", await readBody(response));
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new SwitchHttpError(413, "media_download", `file is ${declared} bytes, limit ${maxBytes}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new SwitchHttpError(413, "media_download", `file is ${bytes.length} bytes, limit ${maxBytes}`);
    return bytes;
  }

  async uploadMedia(
    roomId: string,
    files: { filename: string; mime: string; bytes: Buffer }[],
    options: { caption?: string; threadId?: string | null } = {},
  ): Promise<{ event_id: string; attachments: { event_id: string; mxc: string; filename: string }[] }> {
    const form = new FormData();
    for (const f of files) form.append("files", new Blob([new Uint8Array(f.bytes)], { type: f.mime }), f.filename);
    if (options.caption) form.append("caption", options.caption);
    if (options.threadId) form.append("thread_id", options.threadId);
    const body = (await request(
      this.url(`/rooms/${encodeURIComponent(roomId)}/media`),
      { method: "POST", headers: this.headers(), body: form },
      "media_upload",
      60_000,
    )) as { event_id: string; attachments: { event_id: string; mxc: string; filename: string }[] };
    return body;
  }

  async subscribe(connectionId: string, roomId: string, generation: number | null, takeover = false): Promise<void> {
    await request(
      this.url("/connection/subscribe"),
      {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ connection_id: connectionId, room_id: roomId, takeover, generation }),
      },
      "subscribe",
    );
  }

  setRuntimeState(roomId: string, state: "working" | "awaiting-input" | "idle", threadId?: string | null, detail?: string): Promise<unknown> {
    return request(
      this.url("/runtime-state"),
      {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ room_id: roomId, state, thread_id: threadId ?? undefined, detail }),
      },
      "runtime_state",
    );
  }
}
