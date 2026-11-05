import { parseArgs } from "node:util";

/**
 * Runs curated scenarios through the real API and reports expected versus observed state.
 *
 *   pnpm scenario                         # every scenario, including scripted follow-up steps
 *   pnpm scenario quantity-correction     # one scenario
 */

const { positionals, values } = parseArgs({ allowPositionals: true, options: { "no-steps": { type: "boolean", default: false } } });
const API = (process.env.API_BASE_URL ?? "http://localhost:4210").replace(/\/+$/, "");
let cookie = "";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0]!;
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Run {
  id: string;
  scenarioId: string;
  caseId: string | null;
  status: "RUNNING" | "PASSED" | "FAILED";
  expected: { state: string; openIssueKinds: string[]; step: number };
  observed: { state: string | null; openIssueKinds: string[]; epoch: number | null };
}

async function settle(runId: string): Promise<Run> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const { runs } = await call<{ runs: Run[] }>("GET", "/v1/verification/runs");
    const run = runs.find((r) => r.id === runId);
    if (run && run.status !== "RUNNING") return run;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`run ${runId} did not settle`);
}

await call("POST", "/v1/auth/session", { accessCode: process.env.WORKBENCH_ACCESS_CODE, name: "Scenario runner" });
const { scenarios } = await call<{ scenarios: { id: string; title: string; followUps: unknown[] }[] }>("GET", "/v1/demo/scenarios");
const selected = positionals.length ? scenarios.filter((s) => positionals.includes(s.id)) : scenarios;
let failed = 0;

for (const scenario of selected) {
  const started = Date.now();
  const { runId, caseCode } = await call<{ runId: string; caseCode: string }>("POST", `/v1/demo/scenarios/${scenario.id}/start`);
  let run = await settle(runId);
  const report = (r: Run) =>
    console.log(
      `${r.status === "PASSED" ? "PASS" : "FAIL"} ${scenario.id} step ${r.expected.step} ${caseCode}: expected ${r.expected.state} [${r.expected.openIssueKinds.join(",")}], observed ${r.observed.state} [${r.observed.openIssueKinds.join(",")}] epoch ${r.observed.epoch} (${Date.now() - started} ms)`,
    );
  report(run);
  if (run.status === "FAILED") failed += 1;
  for (let step = 0; !values["no-steps"] && step < scenario.followUps.length; step++) {
    await call("POST", `/v1/demo/runs/${runId}/next`);
    await new Promise((r) => setTimeout(r, 1500));
    run = await settle(runId);
    report(run);
    if (run.status === "FAILED") failed += 1;
  }
}
process.exit(failed ? 1 : 0);
