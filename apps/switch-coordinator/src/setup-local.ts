import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { registerAgent, SwitchClient } from "@reissue/switch-adapter";
import { credentialsPath, registerOnce } from "@reissue/workflows";

/**
 * Builds the local verification topology on the self-hosted Switch server started by
 * scripts/switch-local.sh: three Reissue agents, three Mattermost-bridged rooms, a separate
 * supplier account, follow-ups on, and the Liaison as the supplier room's main agent.
 * Slack and Telegram rooms are connected by hand (see switch/setup.md); this path exists so
 * the whole loop can be exercised locally with real Switch routing.
 */

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("run inside the repository");
}

const ROOT = repoRoot();
const STATE = join(ROOT, ".data");
const SWITCH_ENV = join(STATE, "switch", ".env");
const ENV_FILE = join(ROOT, ".env");

async function readEnv(path: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1]!, m[2]!);
  }
  return map;
}

async function upsertEnv(values: Record<string, string>): Promise<void> {
  let text = existsSync(ENV_FILE) ? await readFile(ENV_FILE, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  }
  await writeFile(ENV_FILE, text, { mode: 0o600 });
  await chmod(ENV_FILE, 0o600);
}

async function json<T>(url: string, init: RequestInit = {}): Promise<{ body: T; headers: Headers }> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${response.status}: ${text.slice(0, 300)}`);
  return { body: (text ? JSON.parse(text) : null) as T, headers: response.headers };
}

const sw = await readEnv(SWITCH_ENV);
const apiPort = sw.get("API_HOST_PORT") ?? "8000";
const mmPort = sw.get("MATTERMOST_HOST_PORT") ?? "8065";
const SWITCH = `http://127.0.0.1:${apiPort}`;
const MM = `http://127.0.0.1:${mmPort}`;
const env = await readEnv(ENV_FILE);

// 1. A personal registration key owned by the local admin (who is linked to the Mattermost "user").
let registrationKey = env.get("SWITCH_REGISTRATION_KEY") ?? "";
if (!registrationKey) {
  const login = await fetch(`${SWITCH}/gateway/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: sw.get("GATEWAY_ADMIN_EMAIL"), password: sw.get("GATEWAY_ADMIN_PASSWORD") }),
  });
  if (!login.ok) throw new Error(`Gateway login failed: ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const { body } = await json<{ key: string }>(`${SWITCH}/gateway/api-keys`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ label: "reissue-local" }),
  });
  registrationKey = body.key;
}
const toolToken = (key: string) => env.get(key) || randomBytes(24).toString("base64url");
await upsertEnv({
  SWITCH_BASE_URL: SWITCH,
  SWITCH_REGISTRATION_KEY: registrationKey,
  SWITCH_COORDINATOR_NAME: "reissue",
  SWITCH_EXAMINER_NAME: "reissue-examiner",
  SWITCH_LIAISON_NAME: "reissue-liaison",
  REISSUE_EXAMINER_TOOL_TOKEN: toolToken("REISSUE_EXAMINER_TOOL_TOKEN"),
  REISSUE_LIAISON_TOOL_TOKEN: toolToken("REISSUE_LIAISON_TOOL_TOKEN"),
});
process.env.SWITCH_BASE_URL = SWITCH;
process.env.SWITCH_REGISTRATION_KEY = registrationKey;
process.env.SWITCH_COORDINATOR_NAME = "reissue";
delete process.env.SWITCH_COORDINATOR_AGENT_ID;
delete process.env.SWITCH_COORDINATOR_AGENT_API_KEY;

// 2. Agents. Each is registered once; stored credentials are reused on later runs.
const coordinator = await registerOnce();
console.log(`coordinator: ${coordinator.agentId} (${credentialsPath()})`);
async function specialist(role: "examiner" | "liaison", name: string, description: string): Promise<{ agentId: string; apiKey: string }> {
  const path = join(STATE, `${role}-credentials.json`);
  if (existsSync(path)) {
    const stored = JSON.parse(await readFile(path, "utf8")) as { agentId: string; apiKey: string; baseUrl: string };
    if (stored.baseUrl === SWITCH) return stored;
  }
  const reg = await registerAgent(SWITCH, registrationKey, { name, description, displayName: role === "examiner" ? "Reissue Examiner" : "Reissue Liaison", connectionModel: "always_on" });
  const creds = { baseUrl: SWITCH, agentId: reg.id, apiKey: reg.api_key };
  await mkdir(STATE, { recursive: true });
  await writeFile(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
  console.log(`${role}: ${reg.id}`);
  return creds;
}
await specialist("examiner", "reissue-examiner", "Verifies extracted invoice and packing-list evidence for Reissue cases using Reissue's case tools.");
const liaison = await specialist("liaison", "reissue-liaison", "Handles supplier correction requests and replies in the supplier room using supplier-safe Reissue tools.");

const co = new SwitchClient({ baseUrl: SWITCH, agentId: coordinator.agentId, apiKey: coordinator.apiKey });
await co.discoverOperations();

// The Liaison answers people outside the team; the Examiner keeps the default owner-and-owned-agents policy.
await co.op("update_agent_detail", { agent_id: liaison.agentId, addressing: "anyone" }).catch((error: unknown) => {
  console.warn(`Could not widen liaison addressing via the coordinator (${String(error)}); retrying with the liaison's own key.`);
  return new SwitchClient({ baseUrl: SWITCH, agentId: liaison.agentId, apiKey: liaison.apiKey }).op("update_agent_detail", { agent_id: liaison.agentId, addressing: "anyone" });
});

// 3. Mattermost accounts: the operator ("user", created by Switch setup) and a separate supplier person.
async function mmLogin(login: string, password: string): Promise<string> {
  const response = await fetch(`${MM}/api/v4/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login_id: login, password }) });
  if (!response.ok) throw new Error(`Mattermost login for ${login} failed: ${response.status}`);
  return response.headers.get("token")!;
}
const adminToken = await mmLogin(sw.get("MATTERMOST_ADMIN_USER") ?? "admin", sw.get("MATTERMOST_ADMIN_PASSWORD")!);
const operatorToken = await mmLogin(sw.get("MATTERMOST_USER") ?? "user", sw.get("MATTERMOST_USER_PASSWORD")!);
const mm = <T>(path: string, token: string, init: RequestInit = {}) =>
  json<T>(`${MM}/api/v4${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } }).then((r) => r.body);
const team = await mm<{ id: string }>(`/teams/name/${sw.get("MATTERMOST_TEAM_NAME") ?? "switch"}`, adminToken);

const supplierFile = join(STATE, "switch", "supplier-account.json");
let supplier: { username: string; password: string; id: string };
if (existsSync(supplierFile)) {
  supplier = JSON.parse(await readFile(supplierFile, "utf8")) as typeof supplier;
} else {
  const password = `${randomBytes(12).toString("base64url")}Aa1!`;
  const created = await mm<{ id: string }>("/users", adminToken, {
    method: "POST",
    body: JSON.stringify({ username: "li.wei", email: "li.wei@supplier.example", password, first_name: "Li", last_name: "Wei (Lumen Lighting)" }),
  });
  supplier = { username: "li.wei", password, id: created.id };
  await writeFile(supplierFile, JSON.stringify(supplier, null, 2), { mode: 0o600 });
}
await mm(`/teams/${team.id}/members`, adminToken, { method: "POST", body: JSON.stringify({ team_id: team.id, user_id: supplier.id }) }).catch((e: unknown) => console.warn(`skipped (already set up?): ${String(e).slice(0, 160)}`));

// 4. Rooms. Created through Switch so they are bridged; reused if they already exist.
const bridges = await co.op<{ id: string; type: string; is_default: boolean }[]>("list_bridges", {});
const bridge = bridges.find((b) => b.type === "mattermost") ?? bridges[0];
if (!bridge) throw new Error("No Mattermost bridge on this Switch server");
const existingRooms = await co.op<{ id: string; name: string }[]>("list_rooms", {});
async function room(name: string, description: string, agents: string[]): Promise<string> {
  const found = existingRooms.find((r) => r.name === name);
  if (found) return found.id;
  const created = await co.op<{ id: string }>("create_room", { name, description, agent_names: agents, bridge_id: bridge!.id });
  return created.id;
}
const ops = await room("shipment-ops", "Import operations: drop shipment paperwork and mention @reissue.", ["reissue", "reissue-examiner", "reissue-liaison"]);
const supplierRoom = await room("supplier-corrections", "Supplier correction requests for Lumen Lighting.", ["reissue", "reissue-liaison"]);
const verification = await room("reissue-verification", "Reissue verification traces and replayed tests.", ["reissue", "reissue-examiner"]);

const channels = await mm<{ id: string; name: string }[]>(`/users/me/teams/${team.id}/channels`, operatorToken);
const channelFor = (name: string) => channels.find((c) => c.name === name)?.id;
const supplierChannel = channelFor("supplier-corrections");
if (supplierChannel) {
  await mm(`/channels/${supplierChannel}/members`, adminToken, { method: "POST", body: JSON.stringify({ user_id: supplier.id }) }).catch((e: unknown) => console.warn(`skipped (already set up?): ${String(e).slice(0, 160)}`));
  await mm("/posts", operatorToken, { method: "POST", body: JSON.stringify({ channel_id: supplierChannel, message: "!follow-ups on" }) });
  await mm("/posts", operatorToken, { method: "POST", body: JSON.stringify({ channel_id: supplierChannel, message: "!assign-agent @reissue-liaison" }) });
}
const opsChannel = channelFor("shipment-ops");
if (opsChannel) await mm("/posts", operatorToken, { method: "POST", body: JSON.stringify({ channel_id: opsChannel, message: "!follow-ups on" }) });

await upsertEnv({
  SWITCH_OPS_ROOM_ID: ops,
  SWITCH_OPS_PLATFORM: "mattermost",
  SWITCH_SUPPLIER_ROOM_ID: supplierRoom,
  SWITCH_SUPPLIER_PLATFORM: "mattermost",
  SWITCH_VERIFICATION_ROOM_ID: verification,
  SWITCH_VERIFICATION_PLATFORM: "mattermost",
});
console.log(JSON.stringify({ ops, supplier: supplierRoom, verification, mattermost: MM, supplierLogin: supplier.username }, null, 2));
console.log("Local topology ready. Restart the API, worker and coordinator so they pick up the new .env.");
