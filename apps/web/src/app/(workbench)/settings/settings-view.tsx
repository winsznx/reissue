"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { RoomIntent, type RoomBindingDto } from "@reissue/contracts";

import { Badge, Button, ErrorNotice, FieldLabel, LoadingBlock, Panel, cx, inputClass } from "@/components/ui";
import { errorMessage, sendJson } from "@/lib/api";
import { formatBytes, titleCase } from "@/lib/format";
import { useRooms, useSettings } from "@/lib/queries";
import type { ReminderPolicy } from "@/lib/types";

const INTENT_LABEL: Record<RoomIntent, string> = {
  OPERATIONS: "Operations",
  SUPPLIER: "Supplier",
  VERIFICATION: "Verification",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4">
      <dt className="text-xs text-ink-2 sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function minutes(value: number): string {
  if (value < 60) return `${value} min`;
  if (value % 1440 === 0) return `${value / 1440} d`;
  if (value % 60 === 0) return `${value / 60} h`;
  return `${(value / 60).toFixed(1)} h`;
}

function ReminderRows({ policy, demo }: { policy: ReminderPolicy; demo: boolean }) {
  return (
    <dl className="divide-y divide-line">
      <Row label="Profile">
        <span className="inline-flex items-center gap-2">
          {policy.label}
          {demo ? <Badge tone="warn">Short timings for demonstrations</Badge> : null}
        </span>
      </Row>
      <Row label="First reminder">{minutes(policy.firstReminderMinutes)} after the supplier is asked</Row>
      <Row label="Repeat">
        Every {minutes(policy.repeatIntervalMinutes)}, at most {policy.maxReminders} times
      </Row>
      <Row label="Escalate to operations lead">After {minutes(policy.escalationAfterMinutes)} without a reply</Row>
      <Row label="Quiet hours">{policy.quietHours ? `${policy.quietHours.start} to ${policy.quietHours.end} (${policy.timezone})` : "None"}</Row>
    </dl>
  );
}

export function SettingsView() {
  const settings = useSettings();
  const rooms = useRooms();
  const s = settings.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-[2rem] font-medium leading-none tracking-[-0.015em]">Settings</h1>
        <p className="mt-2 text-ink-2">{s?.workspace ?? "Workspace"} configuration, as the API currently runs it.</p>
      </div>

      <RoomsPanel bindings={rooms.data?.bindings} error={rooms.error} loading={rooms.isLoading} onChanged={() => void rooms.mutate()} />

      {settings.error ? (
        <ErrorNotice error={errorMessage(settings.error)} onRetry={() => void settings.mutate()} />
      ) : !s ? (
        <LoadingBlock label="Loading settings" rows={8} />
      ) : (
        <>
          <Panel title="Agents in chat" id="agents">
            <dl className="divide-y divide-line">
              <Row label="Coordinator">{s.agents.coordinator ?? <span className="text-ink-2">Not configured</span>}</Row>
              <Row label="Document examiner">{s.agents.examiner ?? <span className="text-ink-2">Not configured; Reissue relies on deterministic evidence</span>}</Row>
              <Row label="Supplier liaison">{s.agents.liaison ?? <span className="text-ink-2">Not configured; the coordinator posts supplier requests</span>}</Row>
              <Row label="Reply reading">{s.replyClassifier === "rules" ? "Rules" : s.replyClassifier}</Row>
            </dl>
          </Panel>

          <Panel title="Reminder policy" id="reminders">
            <ReminderRows policy={s.reminderPolicy} demo={s.demoTimingProfile} />
          </Panel>

          <Panel title="Unit conversion rules" id="units">
            <dl className="divide-y divide-line">
              <Row label="Built in">
                <ul className="space-y-0.5">
                  {s.unitConversions.builtIn.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </Row>
              <Row label="Workspace defaults">
                {s.unitConversions.defaults.length ? (
                  <ul className="tnum space-y-0.5">
                    {s.unitConversions.defaults.map((c) => (
                      <li key={`${c.sku}:${c.fromUnit}:${c.toUnit}`}>
                        {c.sku === "*" ? "All SKUs" : c.sku}: 1 {c.fromUnit} = {c.factor} {c.toUnit} <span className="text-ink-2">({c.sourceReference})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-ink-2">None. Pack sizes are recorded per case with a source.</span>
                )}
              </Row>
            </dl>
          </Panel>

          <Panel title="Documents and limits" id="limits">
            <dl className="divide-y divide-line">
              <Row label="Extraction">
                {s.extraction.provider}
                {s.extraction.model ? <span className="text-ink-2"> · {s.extraction.model}</span> : null}
              </Row>
              <Row label="Case reference rule">{s.caseReferenceRule === "invoice_then_po" ? "Invoice number, then PO" : "PO, then invoice number"}</Row>
              <Row label="File retention">{s.fileRetentionDays} days</Row>
              <Row label="Upload limit">{formatBytes(s.limits.maxUploadBytes)} per file in the Workbench</Row>
              <Row label="Chat attachment limit">{formatBytes(s.limits.chatMediaMaxBytes)}; larger files go through the secure upload page</Row>
              <Row label="Suppliers">{s.suppliers.length ? s.suppliers.map((x) => x.name).join(", ") : <span className="text-ink-2">None registered yet</span>}</Row>
            </dl>
          </Panel>
        </>
      )}
    </div>
  );
}

function RoomsPanel({ bindings, error, loading, onChanged }: { bindings: RoomBindingDto[] | undefined; error: unknown; loading: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      title="Connected rooms"
      id="rooms"
      action={
        <Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {adding ? "Cancel" : "Add room"}
        </Button>
      }
    >
      {adding ? <AddRoomForm onAdded={() => { setAdding(false); onChanged(); }} /> : null}
      {error ? (
        <div className="p-4">
          <ErrorNotice error={errorMessage(error)} />
        </div>
      ) : loading && !bindings ? (
        <LoadingBlock label="Loading rooms" />
      ) : !bindings?.length ? (
        <p className="px-4 py-4 text-sm text-ink-2">No rooms are bound. Reissue posts to chat only in rooms bound here, and never sends internal details to a supplier room.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Room bindings</caption>
            <thead className="text-xs text-ink-2">
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2 text-left font-medium">Room</th>
                <th scope="col" className="px-4 py-2 text-left font-medium">Intent</th>
                <th scope="col" className="px-4 py-2 text-left font-medium">Platform</th>
                <th scope="col" className="px-4 py-2 text-left font-medium">Room id</th>
                <th scope="col" className="px-4 py-2 text-left font-medium">Internal details</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr key={b.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">{b.label}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={b.intent === "SUPPLIER" ? "warn" : b.intent === "OPERATIONS" ? "accent" : "neutral"}>{INTENT_LABEL[b.intent]}</Badge>
                  </td>
                  <td className="px-4 py-2.5">{titleCase(b.platform)}</td>
                  <td className="tnum px-4 py-2.5 text-ink-2">{b.switchRoomId}</td>
                  <td className="px-4 py-2.5">{b.canReceiveSensitive ? "Allowed" : <span className="text-ink-2">Supplier-safe only</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AddRoomForm({ onAdded }: { onAdded: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [intent, setIntent] = useState<RoomIntent>("OPERATIONS");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await sendJson("PATCH", "/v1/settings/rooms", {
        bindings: [
          {
            switchRoomId: String(f.get("switchRoomId")).trim(),
            platform: String(f.get("platform")).trim(),
            intent,
            label: String(f.get("label")).trim(),
            supplierId: null,
            canReceiveSensitive: intent !== "SUPPLIER" && f.get("canReceiveSensitive") === "on",
          },
        ],
      });
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-3 border-b border-line bg-sunken/50 px-4 py-4 sm:grid-cols-2" aria-label="Add a room binding">
      <div>
        <FieldLabel htmlFor="room-label">Label</FieldLabel>
        <input id="room-label" name="label" required maxLength={80} placeholder="Ops desk" className={inputClass} />
      </div>
      <div>
        <FieldLabel htmlFor="room-id">Switch room id</FieldLabel>
        <input id="room-id" name="switchRoomId" required className={cx(inputClass, "tnum")} />
      </div>
      <div>
        <FieldLabel htmlFor="room-platform">Platform</FieldLabel>
        <input id="room-platform" name="platform" required placeholder="slack" className={inputClass} />
      </div>
      <div>
        <FieldLabel htmlFor="room-intent">Intent</FieldLabel>
        <select id="room-intent" value={intent} onChange={(e) => setIntent(RoomIntent.parse(e.target.value))} className={inputClass}>
          {RoomIntent.options.map((i) => (
            <option key={i} value={i}>
              {INTENT_LABEL[i]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="canReceiveSensitive" disabled={intent === "SUPPLIER"} className="accent-[var(--accent)]" />
        Room may receive internal case details
        {intent === "SUPPLIER" ? <span className="text-xs text-ink-2">(never for supplier rooms)</span> : null}
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          Save room
        </Button>
      </div>
    </form>
  );
}
