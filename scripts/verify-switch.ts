import postgres from "postgres";

import { switchHealth, SwitchClient } from "@reissue/switch-adapter";
import { loadCredentials } from "@reissue/workflows";

/**
 * Checks the live Switch integration: server health, coordinator credentials, the operations
 * this server offers (and that removed task operations are gone), room bindings and whether the
 * coordinator's room connections are live.
 */

const REQUIRED = ["post_message", "send_targeted_message", "read_context", "list_participants", "connect_to_room", "update_agent_detail"];
let failures = 0;
const line = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const base = process.env.SWITCH_BASE_URL;
if (!base) {
  console.error("SWITCH_BASE_URL is not set");
  process.exit(1);
}
const health = await switchHealth(base);
line(health.ok, `Switch server ${base}/health`, `${Math.round(health.latencyMs)} ms`);

const creds = await loadCredentials();
line(Boolean(creds), "coordinator credentials", creds ? `agent ${creds.agentId}` : "run the register script");
if (creds) {
  const client = new SwitchClient({ baseUrl: creds.baseUrl, agentId: creds.agentId, apiKey: creds.apiKey });
  const ops = await client.discoverOperations();
  line(REQUIRED.every((o) => ops.has(o)), `operations discovered (${ops.size})`, REQUIRED.filter((o) => !ops.has(o)).map((o) => `missing ${o}`).join(", "));
  line(!ops.has("delegate_task"), "removed delegate_task is absent");
  const flags = (await fetch(`${base}/agents/feature-flags`, { headers: { authorization: `Bearer ${creds.apiKey}` } }).then((r) => r.json())) as { flags?: { key: string; enabled: boolean }[] };
  const follow = flags.flags?.find((f) => f.key === "follow_the_conversation");
  line(Boolean(follow?.enabled), "follow_the_conversation feature flag");
  const rooms = (await client.op<{ room_id: string; name: string }[]>("list_all_rooms", {}).catch(() => [])) ?? [];

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined });
  const bindings = await sql<{ switch_room_id: string; intent: string; platform: string; label: string }[]>`select switch_room_id, intent, platform, label from room_bindings`;
  for (const b of bindings) {
    const visible = rooms.some((r) => r.room_id === b.switch_room_id);
    line(visible, `${b.intent.toLowerCase()} room ${b.label} (${b.platform})`, visible ? "coordinator is a member" : "coordinator cannot see this room");
  }
  const cursors = await sql<{ room_id: string; state: string; updated_at: Date; server_version: string | null }[]>`select room_id, state, updated_at, server_version from switch_cursors where agent_id = ${creds.agentId}`;
  for (const c of cursors) {
    const fresh = Date.now() - c.updated_at.getTime() < 120_000;
    line(c.state === "live" && fresh, `connection ${c.room_id.slice(0, 8)}…`, `${c.state}, server ${c.server_version ?? "?"}, updated ${Math.round((Date.now() - c.updated_at.getTime()) / 1000)}s ago`);
  }
  await sql.end();
}

process.exit(failures ? 1 : 0);
