import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { SwitchClient } from "@reissue/switch-adapter";
import { loadCredentials } from "@reissue/workflows";

/**
 * Binds existing Switch rooms (e.g. the Slack channel and the hand-made Telegram group) to
 * Reissue: invites the agents that belong in each, and records the room ids in .env.
 *
 *   pnpm --filter @reissue/switch-coordinator connect-rooms --ops <room id|name> --supplier <room id|name> [--verification <room>]
 *   pnpm --filter @reissue/switch-coordinator connect-rooms --list
 */

const { values } = parseArgs({
  options: {
    ops: { type: "string" },
    supplier: { type: "string" },
    verification: { type: "string" },
    list: { type: "boolean", default: false },
  },
});

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("run inside the repository");
}

const creds = await loadCredentials();
if (!creds) throw new Error("Register the coordinator first: pnpm --filter @reissue/switch-coordinator register");
const client = new SwitchClient({ baseUrl: creds.baseUrl, agentId: creds.agentId, apiKey: creds.apiKey });
await client.discoverOperations();

interface RoomRow {
  id?: string;
  room_id?: string;
  name: string;
}
const rooms = await client.op<RoomRow[] | { rooms?: RoomRow[] }>(client.hasOperation("list_all_rooms") ? "list_all_rooms" : "list_rooms", {});
const roomList = (Array.isArray(rooms) ? rooms : (rooms.rooms ?? [])).map((r) => ({ id: r.room_id ?? r.id ?? "", name: r.name }));

if (values.list || (!values.ops && !values.supplier)) {
  for (const r of roomList) console.log(`${r.id}  ${r.name}`);
  process.exit(0);
}

function resolveRoom(ref: string): { id: string; name: string } {
  const match = roomList.find((r) => r.id === ref) ?? roomList.find((r) => r.name === ref);
  if (!match) throw new Error(`No room "${ref}" visible to the coordinator. It must be invited first (in Telegram: /invite_agent @${creds!.name}).`);
  return match;
}

async function platformOf(roomId: string): Promise<string> {
  const detail = await client.op<{ bridge_display_name?: string | null }>("get_room_detail", { room_id: roomId });
  const name = (detail.bridge_display_name ?? "").toLowerCase();
  return ["slack", "telegram", "mattermost", "discord", "teams"].find((p) => name.includes(p)) ?? (name || "switch");
}

async function invite(roomId: string, agent: string): Promise<void> {
  try {
    await client.op("invite_agent_to_room", { room_id: roomId, agent_name: agent });
    console.log(`  invited ${agent}`);
  } catch (error) {
    console.log(`  ${agent}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const examiner = process.env.SWITCH_EXAMINER_NAME || "reissue-examiner";
const liaison = process.env.SWITCH_LIAISON_NAME || "reissue-liaison";
const updates: Record<string, string> = {};

if (values.ops) {
  const room = resolveRoom(values.ops);
  console.log(`operations room: ${room.name} (${room.id})`);
  for (const agent of [examiner, liaison]) await invite(room.id, agent);
  updates.SWITCH_OPS_ROOM_ID = room.id;
  updates.SWITCH_OPS_PLATFORM = await platformOf(room.id);
}
if (values.supplier) {
  const room = resolveRoom(values.supplier);
  console.log(`supplier room: ${room.name} (${room.id})`);
  await invite(room.id, liaison);
  updates.SWITCH_SUPPLIER_ROOM_ID = room.id;
  updates.SWITCH_SUPPLIER_PLATFORM = await platformOf(room.id);
}
if (values.verification) {
  const room = resolveRoom(values.verification);
  console.log(`verification room: ${room.name} (${room.id})`);
  await invite(room.id, examiner);
  updates.SWITCH_VERIFICATION_ROOM_ID = room.id;
  updates.SWITCH_VERIFICATION_PLATFORM = await platformOf(room.id);
}

const envFile = join(repoRoot(), ".env");
let text = existsSync(envFile) ? await readFile(envFile, "utf8") : "";
for (const [key, value] of Object.entries(updates)) {
  text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
}
await writeFile(envFile, text, { mode: 0o600 });
await chmod(envFile, 0o600);
console.log("Updated .env. Restart the stack (scripts/stack.sh restart) so every process binds the rooms.");
console.log("In the supplier room, run `!follow-ups on` and `!assign-agent @" + liaison + "` (Telegram also accepts /follow_ups and /assign_agent).");
