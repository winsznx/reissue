"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import type { CaseState, HealthDto, ScenarioDto, VerificationRunDto } from "@reissue/contracts";

import { AlertIcon, CheckIcon, DownloadIcon, SpinnerIcon } from "@/components/icons";
import { Badge, Button, ErrorNotice, LoadingBlock, Panel, cx } from "@/components/ui";
import { errorMessage, evidenceExportUrl, sendJson } from "@/lib/api";
import { CASE_STATE_LABEL, formatDateTime, formatDuration, formatRelative, titleCase } from "@/lib/format";
import { useHealth, useJobs, useScenarios, useVerificationRuns } from "@/lib/queries";
import type { ScenarioNextResponse, ScenarioStartResponse } from "@/lib/types";

const HEALTH_LABEL: Record<keyof HealthDto["components"], string> = {
  database: "Database",
  queue: "Job queue",
  objectStore: "Object store",
  documentWorker: "Document worker",
  switch: "Switch",
  coordinator: "Chat coordinator",
};

function stepOf(run: VerificationRunDto): number {
  const step = run.expected.step;
  return typeof step === "number" ? step : 0;
}

function describeExpectation(record: Record<string, unknown>): ReactNode {
  const state = typeof record.state === "string" ? record.state : null;
  const kinds = Array.isArray(record.openIssueKinds) ? record.openIssueKinds.filter((k): k is string => typeof k === "string") : [];
  const minEpoch = typeof record.minEpoch === "number" ? record.minEpoch : null;
  const epoch = typeof record.epoch === "number" ? record.epoch : null;
  return (
    <span className="block text-xs leading-relaxed">
      <span className="text-ink">{state && state in CASE_STATE_LABEL ? CASE_STATE_LABEL[state as CaseState] : (state ?? "No case")}</span>
      <span className="block text-ink-2">{kinds.length ? kinds.map(titleCase).join(", ") : "No open issues"}</span>
      {minEpoch !== null ? <span className="tnum block text-ink-2">Epoch at least {minEpoch}</span> : null}
      {epoch !== null ? <span className="tnum block text-ink-2">Epoch {epoch}</span> : null}
    </span>
  );
}

export function VerificationView() {
  const scenarios = useScenarios();
  const runs = useVerificationRuns();
  const [started, setStarted] = useState<Record<string, ScenarioStartResponse>>({});
  const scenarioById = new Map((scenarios.data?.scenarios ?? []).map((s) => [s.id, s]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-[2rem] font-medium leading-none tracking-[-0.015em]">Verification</h1>
        <p className="mt-2 max-w-[70ch] text-ink-2">
          Curated scenarios run through the real pipeline with controlled test documents. Scripted follow-ups stand in for a supplier and are labelled as such; they never come from a live person.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Scenarios" id="scenarios" action={scenarios.data ? <Badge tone="neutral">{scenarios.data.fixtureLabel}</Badge> : null}>
            {scenarios.error ? (
              <div className="p-4">
                <ErrorNotice error={errorMessage(scenarios.error)} onRetry={() => void scenarios.mutate()} />
              </div>
            ) : !scenarios.data ? (
              <LoadingBlock label="Loading scenarios" />
            ) : (
              <ul className="divide-y divide-line">
                {scenarios.data.scenarios.map((scenario) => (
                  <ScenarioRow
                    key={scenario.id}
                    scenario={scenario}
                    started={started[scenario.id]}
                    onStarted={(result) => {
                      setStarted((s) => ({ ...s, [scenario.id]: result }));
                      void runs.mutate();
                    }}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Runs"
            id="runs"
            action={
              runs.data ? (
                <span className="tnum text-xs text-ink-2">
                  {runs.data.metrics.passed} passed · {runs.data.metrics.failed} failed · {runs.data.metrics.running} running
                  {runs.data.metrics.medianSettleMs !== null ? ` · median settle ${formatDuration(runs.data.metrics.medianSettleMs)}` : ""}
                </span>
              ) : null
            }
          >
            {runs.error ? (
              <div className="p-4">
                <ErrorNotice error={errorMessage(runs.error)} onRetry={() => void runs.mutate()} />
              </div>
            ) : !runs.data ? (
              <LoadingBlock label="Loading runs" />
            ) : runs.data.runs.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-2">No runs yet. Start a scenario above.</p>
            ) : (
              <RunsTable runs={runs.data.runs} scenarioById={scenarioById} onChanged={() => void runs.mutate()} />
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <HealthPanel />
          <DeadLetterPanel />
        </div>
      </div>
    </div>
  );
}

function ScenarioRow({ scenario, started, onStarted }: { scenario: ScenarioDto; started: ScenarioStartResponse | undefined; onStarted: (result: ScenarioStartResponse) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      onStarted(await sendJson<ScenarioStartResponse>("POST", `/v1/demo/scenarios/${scenario.id}/start`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto]" data-testid={`scenario-${scenario.id}`}>
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-2 font-medium">
          {scenario.title}
          {scenario.usesSwitch ? <Badge tone="accent">Posts to chat</Badge> : null}
        </h3>
        <p className="mt-1 max-w-[72ch] text-sm text-ink-2">{scenario.description}</p>
        <p className="mt-2 flex flex-wrap items-baseline gap-2 text-xs">
          <Badge tone="warn" icon={<AlertIcon size={11} />}>
            Controlled test document
          </Badge>
          <span className="text-ink">{scenario.controlledModification}</span>
        </p>
        <p className="mt-1.5 text-xs text-ink-2">
          Inputs: {scenario.inputs.join(", ")}
          {scenario.followUps.length ? ` · Scripted follow-up: ${scenario.followUps.map((f) => f.label).join("; ")}` : ""}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex items-start gap-3 md:flex-col md:items-end">
        <Button variant="primary" size="sm" onClick={() => void start()} disabled={pending} data-testid="start-scenario">
          {pending ? <SpinnerIcon size={13} /> : null}
          Start run
        </Button>
        {started ? (
          <Link href={`/shipments/${started.caseCode}`} className="tnum text-sm font-medium text-accent hover:underline" data-testid="started-case-link">
            Open {started.caseCode}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function RunsTable({ runs, scenarioById, onChanged }: { runs: VerificationRunDto[]; scenarioById: Map<string, ScenarioDto>; onChanged: () => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <caption className="sr-only">Scenario runs, newest first</caption>
        <thead className="text-xs text-ink-2">
          <tr className="border-b border-line">
            <th scope="col" className="px-4 py-2 text-left font-medium">Scenario</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">Result</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">Expected</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">Observed</th>
            <th scope="col" className="px-4 py-2 text-left font-medium">Settled in</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} scenario={scenarioById.get(run.scenarioId)} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunRow({ run, scenario, onChanged }: { run: VerificationRunDto; scenario: ScenarioDto | undefined; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const step = stepOf(run);
  const nextFollowUp = scenario?.followUps[step];

  async function next() {
    setPending(true);
    setMessage(null);
    try {
      const result = await sendJson<ScenarioNextResponse>("POST", `/v1/demo/runs/${encodeURIComponent(run.id)}/next`);
      setMessage({ ok: true, text: `Step ${result.step}: ${result.label}` });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  const tone = run.status === "PASSED" ? "ok" : run.status === "FAILED" ? "danger" : "accent";
  const icon = run.status === "PASSED" ? <CheckIcon size={12} /> : run.status === "FAILED" ? <AlertIcon size={12} /> : <SpinnerIcon size={12} />;
  const settle = run.timingsMs.settleMs;

  return (
    <tr className="border-b border-line align-top last:border-0" data-testid="run-row" data-scenario={run.scenarioId} data-case={run.caseId ?? ""}>
      <th scope="row" className="px-4 py-3 text-left font-normal">
        <span className="block font-medium">{scenario?.title ?? run.scenarioId}</span>
        {run.caseId ? (
          <Link href={`/shipments/${run.caseId}`} className="tnum text-xs font-medium text-accent hover:underline">
            {run.caseId}
          </Link>
        ) : null}
        <span className="tnum block text-xs text-ink-2" title={formatDateTime(run.startedAt)}>
          Started {formatRelative(run.startedAt)} · step {step}
        </span>
      </th>
      <td className="px-4 py-3">
        <Badge tone={tone} icon={icon}>
          <span data-testid="run-status">{titleCase(run.status)}</span>
        </Badge>
      </td>
      <td className="px-4 py-3">{describeExpectation(run.expected)}</td>
      <td className="px-4 py-3">{describeExpectation(run.observed)}</td>
      <td className="tnum px-4 py-3 text-xs text-ink-2">{typeof settle === "number" ? formatDuration(settle) : "Not settled"}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex flex-col items-end gap-2">
          {nextFollowUp && run.caseId ? (
            <Button size="sm" onClick={() => void next()} disabled={pending || run.status === "RUNNING"} title={nextFollowUp.label} data-testid="next-step">
              Next step
              <Badge tone="warn" className="py-0">Scripted fixture</Badge>
            </Button>
          ) : null}
          {run.caseId ? (
            <a href={evidenceExportUrl(run.caseId)} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" download>
              <DownloadIcon size={12} />
              Evidence export
            </a>
          ) : null}
          {message ? (
            <span role={message.ok ? "status" : "alert"} className={cx("max-w-[28ch] text-xs", message.ok ? "text-ink-2" : "text-danger")}>
              {message.text}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function HealthPanel() {
  const { data, error, mutate } = useHealth();
  return (
    <Panel
      title="System health"
      id="health"
      action={data ? <Badge tone={data.ok ? "ok" : "warn"} icon={data.ok ? <CheckIcon size={12} /> : <AlertIcon size={12} />}>{data.ok ? "Core services up" : "Degraded"}</Badge> : null}
    >
      {error ? (
        <div className="p-4">
          <ErrorNotice error={errorMessage(error)} onRetry={() => void mutate()} />
        </div>
      ) : !data ? (
        <LoadingBlock label="Checking health" />
      ) : (
        <ul className="divide-y divide-line" data-testid="health">
          {(Object.keys(HEALTH_LABEL) as (keyof HealthDto["components"])[]).map((key) => {
            const component = data.components[key];
            return (
              <li key={key} className="flex items-start gap-2.5 px-4 py-2.5">
                <span className={cx("mt-0.5", component.ok ? "text-ok" : "text-warn")}>{component.ok ? <CheckIcon size={14} /> : <AlertIcon size={14} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2 text-sm font-medium">
                    {HEALTH_LABEL[key]}
                    <span className="tnum text-xs font-normal text-ink-2">{component.latencyMs !== null && component.ok ? `${component.latencyMs} ms` : component.ok ? "Up" : "Down"}</span>
                  </p>
                  {component.detail !== "ok" ? <p className="break-words text-xs text-ink-2">{component.detail}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data ? <p className="tnum border-t border-line px-4 py-2 text-xs text-ink-2">API version {data.version}</p> : null}
    </Panel>
  );
}

function DeadLetterPanel() {
  const { data, error, mutate } = useJobs();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function retry(path: string, label: string) {
    setMessage(null);
    try {
      await sendJson("POST", path);
      setMessage({ ok: true, text: `${label} queued again.` });
      void mutate();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  const total = (data?.jobs.length ?? 0) + (data?.failedMessages.length ?? 0);
  return (
    <Panel title="Failed work" id="failed" action={data ? <span className="tnum text-xs text-ink-2">{total} waiting</span> : null}>
      {error ? (
        <div className="p-4">
          <ErrorNotice error={errorMessage(error)} onRetry={() => void mutate()} />
        </div>
      ) : !data ? (
        <LoadingBlock label="Loading failed jobs" />
      ) : total === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-2">No failed jobs or undelivered messages.</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.jobs.map((job) => (
            <li key={job.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{titleCase(job.type)}</span>
                <Button size="sm" onClick={() => void retry(`/v1/jobs/${encodeURIComponent(job.id)}/retry`, titleCase(job.type))}>
                  Retry
                </Button>
              </div>
              <p className="tnum text-xs text-ink-2">
                {titleCase(job.status)} after {job.attempts} attempt{job.attempts === 1 ? "" : "s"} · {formatRelative(job.updatedAt)}
              </p>
              {job.lastError ? <p className="mt-0.5 line-clamp-2 break-words text-xs text-danger">{job.lastError}</p> : null}
            </li>
          ))}
          {data.failedMessages.map((msg) => (
            <li key={msg.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Message: {msg.purpose.replace(/[:_].*$/, "")}</span>
                <Button size="sm" onClick={() => void retry(`/v1/messages/${encodeURIComponent(msg.id)}/retry`, "Message")}>
                  Retry
                </Button>
              </div>
              <p className="tnum text-xs text-ink-2">{msg.attempts} attempts</p>
              {msg.lastError ? <p className="mt-0.5 line-clamp-2 break-words text-xs text-danger">{msg.lastError}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={cx("border-t border-line px-4 py-2 text-xs", message.ok ? "text-ink-2" : "text-danger")}>
          {message.text}
        </p>
      ) : null}
    </Panel>
  );
}
