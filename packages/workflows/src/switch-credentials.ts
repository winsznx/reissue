import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { registerAgent } from "@reissue/switch-adapter";

export interface AgentCredentials {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  name: string;
}

export function credentialsPath(): string {
  return resolve(process.env.REISSUE_STATE_DIR ?? resolve(repoRoot(), ".data"), "coordinator-credentials.json");
}

/**
 * Credentials come from the environment when set; otherwise from the local state file written at
 * registration. The agent is registered once: an existing file is never overwritten here.
 */
export async function loadCredentials(): Promise<AgentCredentials | null> {
  const baseUrl = process.env.SWITCH_BASE_URL?.trim();
  const name = process.env.SWITCH_COORDINATOR_NAME?.trim() || "reissue";
  if (!baseUrl) return null;
  const agentId = process.env.SWITCH_COORDINATOR_AGENT_ID?.trim();
  const apiKey = process.env.SWITCH_COORDINATOR_AGENT_API_KEY?.trim();
  if (agentId && apiKey) return { baseUrl, agentId, apiKey, name };
  try {
    const stored = JSON.parse(await readFile(credentialsPath(), "utf8")) as AgentCredentials;
    return stored.baseUrl === baseUrl ? stored : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function registerOnce(): Promise<AgentCredentials> {
  const existing = await loadCredentials();
  if (existing) return existing;
  const baseUrl = process.env.SWITCH_BASE_URL?.trim();
  const key = process.env.SWITCH_REGISTRATION_KEY?.trim();
  const name = process.env.SWITCH_COORDINATOR_NAME?.trim() || "reissue";
  if (!baseUrl || !key) throw new Error("SWITCH_BASE_URL and SWITCH_REGISTRATION_KEY are required to register the coordinator");
  const registered = await registerAgent(baseUrl, key, {
    name,
    displayName: "Reissue",
    description: "Always-on shipment document coordinator: intake, reconciliation, supplier correction requests and packet delivery.",
    connectionModel: "always_on",
  });
  const creds: AgentCredentials = { baseUrl, agentId: registered.id, apiKey: registered.api_key, name };
  const path = credentialsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(creds, null, 2), { mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
  return creds;
}

/** Nearest ancestor holding pnpm-workspace.yaml, so every app resolves the same state directory. */
function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
