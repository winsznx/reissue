import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import postgres from "postgres";

/**
 * Live end-to-end run over the real local Switch server and its Mattermost bridge.
 *
 * Two real Mattermost accounts act as people: the operator ("user") and a supplier ("li.wei").
 * Their actions here are scripted, and the report labels them as such; everything else (Switch
 * routing, follow-ups, agent handoffs, Claude Code specialists, extraction, recheck, packet)
 * runs for real. Each run records timings for the Switch primitives.
 *
 *   pnpm --filter @reissue/tests live:switch [--runs 3] [--variant clean|still-wrong|worker-restart]
 */

const { values } = parseArgs({ options: { runs: { type: "string", default: "1" }, variant: { type: "string", default: "clean" } } });
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIX = `${ROOT}tests/fixtures/documents/`;
const env = (k: string): string => process.env[k] ?? "";

async function switchEnv(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const line of (await readFile(`${ROOT}.data/switch/.env`, "utf8")).split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1]!, m[2]!);
  }
  return map;
}

const sw = await switchEnv();
const MM = `http://127.0.0.1:${sw.get("MATTERMOST_HOST_PORT") ?? "8065"}`;
const sql = postgres(env("DATABASE_URL"), { max: 2, onnotice: () => undefined });

async function login(user: string, password: string): Promise<string> {
  const r = await fetch(`${MM}/api/v4/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login_id: user, password }) });
  if (!r.ok) throw new Error(`login ${user}: ${r.status}`);
  return r.headers.get("token")!;
}

const supplierAccount = JSON.parse(await readFile(`${ROOT}.data/switch/supplier-account.json`, "utf8")) as { username: string; password: string };
const operator = await login(sw.get("MATTERMOST_USER") ?? "user", sw.get("MATTERMOST_USER_PASSWORD")!);
const supplier = await login(supplierAccount.username, supplierAccount.password);

async function mm<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${MM}/api/v4${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

interface Post {
  id: string;
  message: string;
  root_id: string;
  user_id: string;
  create_at: number;
  file_ids?: string[];
}

const team = await mm<{ id: string }>(operator, `/teams/name/${sw.get("MATTERMOST_TEAM_NAME") ?? "switch"}`);
const channels = await mm<{ id: string; name: string }[]>(operator, `/users/me/teams/${team.id}/channels`);
const opsChannel = channels.find((c) => c.name === "shipment-ops")!.id;
const supplierChannel = channels.find((c) => c.name === "supplier-corrections")!.id;

async function upload(token: string, channel: string, file: string): Promise<string> {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(await readFile(`${FIX}${file}`))], { type: "application/pdf" }), file);
  const r = await mm<{ file_infos: { id: string }[] }>(token, `/files?channel_id=${channel}`, { method: "POST", body: form });
  return r.file_infos[0]!.id;
}

async function post(token: string, channel: string, message: string, rootId = "", files: string[] = []): Promise<Post> {
  return mm<Post>(token, "/posts", { method: "POST", body: JSON.stringify({ channel_id: channel, message, root_id: rootId, file_ids: files }) });
}

async function threadPosts(token: string, rootId: string): Promise<Post[]> {
  const t = await mm<{ order: string[]; posts: Record<string, Post> }>(token, `/posts/${rootId}/thread`);
  return Object.values(t.posts).sort((a, b) => a.create_at - b.create_at);
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 300_000): Promise<{ value: T; at: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return { value, at: Date.now() };
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function caseEvent(caseCode: string, type: string, after: number): Promise<number | null> {
  const rows = await sql<{ created_at: Date }[]>`
    select e.created_at from case_events e join shipments s on s.id = e.shipment_id
    where s.case_code = ${caseCode} and e.event_type = ${type} and e.created_at > ${new Date(after)} order by e.sequence limit 1`;
  return rows[0]?.created_at.getTime() ?? null;
}

async function switchEventReceived(messageId: string): Promise<number | null> {
  const rows = await sql<{ received_at: Date }[]>`select received_at from switch_events where message_id = ${messageId} limit 1`;
  return rows[0]?.received_at.getTime() ?? null;
}

async function mmMessageToSwitchId(text: string, after: number): Promise<string | null> {
  const rows = await sql<{ message_id: string }[]>`select message_id from switch_events where payload->>'body' = ${text} and received_at > ${new Date(after)} order by received_at desc limit 1`;
  return rows[0]?.message_id ?? null;
}

async function oneRun(index: number, variant: string): Promise<Record<string, unknown>> {
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const tag = `run ${index + 1} ${new Date(t0).toISOString()}`;
  const files = [await upload(operator, opsChannel, "invoice-v1.pdf"), await upload(operator, opsChannel, "packing-list-v1.pdf")];
  const intakeText = `@reissue check these for the Lumen shipment (${tag})`;
  const intake = await post(operator, opsChannel, intakeText, "", files);
  const sent = Date.now();

  const switchId = await waitFor("switch event", () => mmMessageToSwitchId(intakeText, t0 - 1000), 60_000);
  timings.chatToSwitchEventMs = ((await switchEventReceived(switchId.value)) ?? switchId.at) - sent;

  const ack = await waitFor("intake acknowledgement", async () => (await threadPosts(operator, intake.id)).find((p) => p.id !== intake.id && p.message.includes("Received:")), 120_000);
  timings.chatToAcknowledgementMs = ack.value.create_at - sent;
  const caseCode = /SHP-\d+/.exec(ack.value.message)![0];

  const discrepancy = await waitFor("discrepancy", async () => (await threadPosts(operator, intake.id)).find((p) => p.message.includes("discrepanc")), 120_000);
  timings.chatToDiscrepancyMs = discrepancy.value.create_at - sent;
  const handoff = await waitFor("examiner handoff", async () => (await threadPosts(operator, intake.id)).find((p) => p.message.startsWith("@reissue-examiner")), 60_000);
  const review = await waitFor("examiner result", async () => (await threadPosts(operator, intake.id)).find((p) => p.message.includes('"kind":"DOCUMENT_REVIEW_RESULT"')), 400_000);
  timings.handoffToExaminerResultMs = review.value.create_at - handoff.value.create_at;

  const request = await waitFor("supplier request", async () => {
    const recent = await mm<{ order: string[]; posts: Record<string, Post> }>(supplier, `/channels/${supplierChannel}/posts?since=${t0}`);
    return Object.values(recent.posts).find((p) => !p.root_id && p.message.includes(`correction requested for ${caseCode}`));
  }, 400_000);
  timings.chatToSupplierRequestMs = request.value.create_at - sent;

  const replyText = "Old packing list. We shipped 500; sending updated document.";
  const replied = await post(supplier, supplierChannel, replyText, request.value.id);
  const replyState = await waitFor("reply on case", () => caseEvent(caseCode, "SUPPLIER_REPLY_RECEIVED", replied.create_at - 1), 120_000);
  timings.supplierReplyToCaseStateMs = replyState.value - replied.create_at;
  const liaisonAnswer = await waitFor("liaison answer", async () => (await threadPosts(supplier, request.value.id)).find((p) => p.create_at > replied.create_at && p.user_id !== replied.user_id && !p.message.startsWith("Reissue ·")), 300_000);
  timings.supplierReplyToLiaisonAnswerMs = liaisonAnswer.value.create_at - replied.create_at;

  if (variant === "still-wrong") {
    const wrongFile = await upload(supplier, supplierChannel, "packing-list-v2-still-wrong.pdf");
    const wrong = await post(supplier, supplierChannel, "here is the revision", request.value.id, [wrongFile]);
    const followUp = await waitFor("focused follow-up", async () => (await threadPosts(supplier, request.value.id)).find((p) => p.create_at > wrong.create_at && p.message.includes("still needs a correction")), 300_000);
    timings.stillWrongToFollowUpMs = followUp.value.create_at - wrong.create_at;
  }

  const v2 = await upload(supplier, supplierChannel, "packing-list-v2.pdf");
  const replacement = await post(supplier, supplierChannel, "this is the new one", request.value.id, [v2]);
  if (variant === "worker-restart") {
    execFileSync(`${ROOT}scripts/stack.sh`, ["restart", "worker"], { stdio: "ignore" });
  }
  const recheck = await waitFor("recheck triggered", () => caseEvent(caseCode, "RECONCILIATION_COMPLETED", replacement.create_at), 300_000);
  timings.replacementToRecheckMs = recheck.value - replacement.create_at;
  const ready = await waitFor("ready message", async () => (await threadPosts(operator, intake.id)).find((p) => p.message.includes("READY FOR BROKER REVIEW")), 300_000);
  timings.replacementToReadyMessageMs = ready.value.create_at - replacement.create_at;
  const packet = await waitFor("packet file in thread", async () => (await threadPosts(operator, intake.id)).find((p) => (p.file_ids?.length ?? 0) > 0 && p.create_at >= ready.value.create_at), 120_000);

  const readyMessages = (await threadPosts(operator, intake.id)).filter((p) => p.message.includes("READY FOR BROKER REVIEW")).length;
  const asks = (await mm<{ order: string[]; posts: Record<string, Post> }>(supplier, `/channels/${supplierChannel}/posts?since=${t0}`)).order.length;
  return { run: index + 1, variant, caseCode, timings, readyMessages, packetPostId: packet.value.id, supplierRoomPosts: asks, participants: "scripted Mattermost accounts (operator: user, supplier: li.wei)" };
}

const runs: Record<string, unknown>[] = [];
for (let i = 0; i < Number(values.runs); i++) {
  try {
    runs.push(await oneRun(i, values.variant!));
    console.log(JSON.stringify(runs.at(-1)));
  } catch (error) {
    runs.push({ run: i + 1, variant: values.variant, error: error instanceof Error ? error.message : String(error) });
    console.log(JSON.stringify(runs.at(-1)));
  }
}
const out = `${ROOT}tests/scenario-runs/live-switch-${values.variant}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(out, JSON.stringify({ switchVersion: sw.get("SWITCH_VERSION"), recordedAt: new Date().toISOString(), runs }, null, 2));
console.log(`wrote ${out}`);
await sql.end();
