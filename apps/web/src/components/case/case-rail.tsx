"use client";

import { useState, type FormEvent } from "react";

import type { ArtifactDto, CaseDetailDto, ChatLink, TaskDto } from "@reissue/contracts";

import { artifactDownloadUrl, errorMessage, sendJson } from "@/lib/api";
import { formatBytes, formatDateTime, formatRelative, shortSha } from "@/lib/format";
import type { PackageResponse } from "@/lib/types";

import { ChatIcon, DownloadIcon, PacketIcon, PersonIcon } from "../icons";
import { Badge, Button, Panel, StateBadge, cx, inputClass } from "../ui";

const TASK_LABEL: Record<TaskDto["kind"], string> = {
  DOCUMENT_REVIEW: "Examiner review",
  SUPPLIER_REQUEST: "Supplier request",
  HUMAN_CLARIFICATION: "Coordinator clarification",
};

const TASK_STATUS_LABEL: Record<TaskDto["status"], string> = {
  PENDING: "Pending",
  SENT: "Sent",
  ANSWERED: "Answered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

const ARTIFACT_LABEL: Record<ArtifactDto["type"], string> = {
  PACKET_ZIP: "Broker packet",
  CORRECTION_SUMMARY_PDF: "Correction summary",
  DOCUMENT_INDEX_CSV: "Document index",
};

const ARTIFACT_ORDER: ArtifactDto["type"][] = ["PACKET_ZIP", "CORRECTION_SUMMARY_PDF", "DOCUMENT_INDEX_CSV"];

export function StatusPanel({ detail, onChanged }: { detail: CaseDetailDto; onChanged: () => void }) {
  const { passing, total } = detail.checksSummary;
  const ratio = total ? passing / total : 0;
  return (
    <Panel title="Status" id="case-status">
      <div className="space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={detail.state} />
          <span className="tnum text-xs text-ink-2">Epoch {detail.epoch}</span>
        </div>
        <div>
          <p className="tnum text-sm" data-testid="checks-summary">
            <strong className="text-lg font-semibold">{passing}</strong>
            <span className="text-ink-2"> / {total} required checks passing</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" role="presentation">
            <div className={cx("h-full rounded-full transition-[width] duration-200", ratio === 1 ? "bg-ok" : "bg-warn")} style={{ width: `${ratio * 100}%` }} />
          </div>
        </div>
        <div>
          <h3 className="text-xs font-medium text-ink-2">Next action</h3>
          <p className="mt-1 font-serif text-[1.125rem] font-medium leading-snug" data-testid="next-action">
            {detail.nextAction}
          </p>
        </div>
        <OwnerForm caseCode={detail.caseCode} assignedTo={detail.assignedTo} onChanged={onChanged} />
      </div>
    </Panel>
  );
}

function OwnerForm({ caseCode, assignedTo, onChanged }: { caseCode: string; assignedTo: string | null; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const assignee = String(new FormData(event.currentTarget).get("assignee") ?? "").trim();
    if (!assignee) return;
    setPending(true);
    setError(null);
    try {
      await sendJson("POST", `/v1/cases/${encodeURIComponent(caseCode)}/assign`, { assignee });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h3 className="text-xs font-medium text-ink-2">Owner</h3>
      {editing ? (
        <form onSubmit={(e) => void onSubmit(e)} className="mt-1 flex gap-2">
          <label htmlFor="case-assignee" className="sr-only">
            Assign case to
          </label>
          <input id="case-assignee" name="assignee" defaultValue={assignedTo ?? ""} required maxLength={120} className={cx(inputClass, "mt-0 h-8")} placeholder="Name" />
          <Button type="submit" size="sm" variant="primary" disabled={pending} className="h-8">
            Save
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setEditing(false)} className="h-8">
            Cancel
          </Button>
        </form>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <PersonIcon size={14} className="text-ink-2" />
            {assignedTo ?? <span className="text-ink-2">Unassigned</span>}
          </span>
          <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
            {assignedTo ? "Change" : "Assign"}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TasksPanel({ tasks, issueCodes }: { tasks: TaskDto[]; issueCodes: Map<string, string> }) {
  const active = tasks.filter((t) => t.status === "PENDING" || t.status === "SENT" || t.status === "ANSWERED");
  const finished = tasks.filter((t) => !active.includes(t));
  return (
    <Panel title="Who is acting" id="case-tasks">
      {tasks.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-2">No reviews or supplier requests have been opened on this case.</p>
      ) : (
        <ul className="divide-y divide-line">
          {[...active, ...finished].map((task) => (
            <li key={task.id} className={cx("px-4 py-3", !active.includes(task) && "opacity-70")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{TASK_LABEL[task.kind]}</span>
                <Badge tone={task.status === "FAILED" ? "danger" : active.includes(task) ? "accent" : "neutral"}>{TASK_STATUS_LABEL[task.status]}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-ink-2">
                {task.assignee}
                {task.issueIds.length ? ` · ${task.issueIds.map((id) => issueCodes.get(id) ?? id).join(", ")}` : ""}
                {` · updated ${formatRelative(task.updatedAt)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function PacketPanel({ detail, onChanged }: { detail: CaseDetailDto; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const current = detail.artifacts.filter((a) => !a.superseded);
  const superseded = detail.artifacts.filter((a) => a.superseded);
  const ready = detail.state === "READY_FOR_BROKER_REVIEW";
  const currentEpochBuilt = current.some((a) => a.epoch === detail.epoch);

  async function build() {
    setPending(true);
    setError(null);
    try {
      const result = await sendJson<PackageResponse>("POST", `/v1/cases/${encodeURIComponent(detail.caseCode)}/package`);
      setNotice(result.queued ? `Building the packet for epoch ${result.epoch}.` : (result.reason ?? "Packet already built."));
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const sorted = (list: ArtifactDto[]) => [...list].sort((a, b) => b.epoch - a.epoch || ARTIFACT_ORDER.indexOf(a.type) - ARTIFACT_ORDER.indexOf(b.type));

  return (
    <Panel title="Broker packet" id="packet" action={<PacketIcon className="text-ink-2" />}>
      <div className="px-4 py-3">
        {current.length ? (
          <ArtifactList artifacts={sorted(current)} />
        ) : (
          <p className="text-sm text-ink-2">{ready ? "Every required check passes. Build the packet to send to the broker." : "The packet is built once every required check passes on the current documents."}</p>
        )}
        {ready && !currentEpochBuilt ? (
          <Button variant="primary" size="sm" className="mt-3" onClick={() => void build()} disabled={pending}>
            Build current packet
          </Button>
        ) : null}
        {notice ? <p className="mt-2 text-xs text-ink-2" role="status">{notice}</p> : null}
        {error ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {superseded.length ? (
        <details className="border-t border-line px-4 py-2.5">
          <summary className="cursor-pointer text-xs font-medium text-ink-2">Superseded packets ({superseded.length} files)</summary>
          <div className="mt-2">
            <ArtifactList artifacts={sorted(superseded)} />
          </div>
        </details>
      ) : null}
    </Panel>
  );
}

function ArtifactList({ artifacts }: { artifacts: ArtifactDto[] }) {
  return (
    <ul className="space-y-2" data-testid="artifacts">
      {artifacts.map((artifact) => (
        <li key={artifact.id} className={cx("flex items-start gap-3 rounded-[8px] border border-line px-3 py-2", artifact.superseded && "bg-sunken/60")}>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
              {ARTIFACT_LABEL[artifact.type]}
              {artifact.superseded ? <Badge tone="neutral">Superseded</Badge> : null}
            </p>
            <p className="truncate text-xs text-ink-2" title={artifact.filename}>
              {artifact.filename}
            </p>
            <p className="tnum text-[0.6875rem] text-ink-2" title={`sha256 ${artifact.sha256}`}>
              sha256 {shortSha(artifact.sha256)} · {formatBytes(artifact.sizeBytes)} · epoch {artifact.epoch} · {formatDateTime(artifact.generatedAt)}
            </p>
          </div>
          <a
            href={artifactDownloadUrl(artifact.id)}
            download={artifact.filename}
            className="grid size-8 shrink-0 place-items-center rounded-[7px] border border-line-strong text-ink hover:bg-sunken"
            aria-label={`Download ${artifact.filename}${artifact.superseded ? " (superseded)" : ""}`}
          >
            <DownloadIcon size={14} />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ChatLinksPanel({ links }: { links: ChatLink[] }) {
  return (
    <Panel title="Chat threads" id="chat">
      {links.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-2">This case has not posted to a chat room. Cases started from an upload or a scenario without Switch stay in the Workbench.</p>
      ) : (
        <ul className="divide-y divide-line">
          {links.map((link, index) => (
            <li key={`${index}:${link.roomId}:${link.messageId ?? ""}`} className="flex items-start gap-2.5 px-4 py-2.5">
              <ChatIcon size={14} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{link.label}</p>
                <p className="truncate text-xs text-ink-2">
                  {link.platform} · room {link.roomId}
                  {link.threadId ? ` · thread ${link.threadId}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
