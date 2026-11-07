import type { ReactElement, ReactNode } from "react";

import { MinusCircleIcon } from "@/components/icons";

import { Section, SectionIntro, StatePill } from "./primitives";

interface Rule {
  title: string;
  body: string;
  Specimen: () => ReactElement;
}

const CODE_DECISIONS = [
  { subject: "Current versions", outcome: "Invoice v1, packing list v2" },
  { subject: "Line 3 arithmetic", outcome: "10 × 50 = 500 pcs" },
  { subject: "Issue D-001", outcome: "Resolved" },
] as const;

const SHARED_WITH_SUPPLIER = ["SHP-0287", "Quantity", "500 pcs", "480 pcs", "p. 1"] as const;
const NEVER_SHARED = ["Prices", "Other cases"] as const;

const BYTE_CHECKS = [
  { file: "02-packing-list-v2.pdf", check: "SHA-256 matches the stored file", tone: "ok", verdict: "Packed" },
  { file: "A copy with changed bytes", check: "SHA-256 differs", tone: "danger", verdict: "Refused" },
] as const;

const OUTBOX_EVENTS = [
  { moment: "Supplier request written to the outbox", note: "Stored with a dedupe key", tone: null, status: null },
  { moment: "Switch is down", note: "The message waits in the outbox", tone: "warn", status: "Waiting" },
  { moment: "Switch is back", note: "It goes out once", tone: "ok", status: "Sent once" },
] as const;

const UNTRUSTED_INPUTS = [
  { source: "Instructions hidden in a PDF", handling: "Data" },
  { source: "Instructions hidden in a chat message", handling: "Data" },
] as const;

function SpecimenFrame({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="min-w-0 self-start overflow-hidden rounded-panel border border-line bg-surface text-sm">
      <p className="border-b border-line bg-sunken px-4 py-2 text-xs font-medium text-ink-2">{label}</p>
      {children}
    </div>
  );
}

function DecisionsSpecimen(): ReactElement {
  return (
    <SpecimenFrame label="Decided by code for SHP-0287">
      <dl className="divide-y divide-line">
        {CODE_DECISIONS.map((decision) => (
          <div key={decision.subject} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-ink-2">{decision.subject}</dt>
            <dd className="tnum text-right font-medium text-ink">{decision.outcome}</dd>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
          <dt className="text-ink-2">Readiness</dt>
          <dd>
            <StatePill tone="ok">Ready for broker review</StatePill>
          </dd>
        </div>
      </dl>
    </SpecimenFrame>
  );
}

function SupplierViewSpecimen(): ReactElement {
  return (
    <SpecimenFrame label="What the supplier sees">
      <div className="space-y-4 px-4 py-3.5">
        <div>
          <p className="text-xs text-ink-2">Shared</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {SHARED_WITH_SUPPLIER.map((item) => (
              <li key={item} className="tnum rounded-mark border border-line-strong bg-canvas px-2 py-1 font-medium text-ink">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs text-ink-2">Never shared</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {NEVER_SHARED.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5 rounded-mark border border-dashed border-line-strong px-2 py-1 text-ink-2">
                <MinusCircleIcon size={13} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SpecimenFrame>
  );
}

function BytesSpecimen(): ReactElement {
  return (
    <SpecimenFrame label="Packet check">
      <ul className="divide-y divide-line">
        {BYTE_CHECKS.map((item) => (
          <li key={item.file} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <span className="min-w-0">
              <span className="block wrap-break-word font-medium text-ink">{item.file}</span>
              <span className="block text-xs text-ink-2">{item.check}</span>
            </span>
            <StatePill tone={item.tone}>{item.verdict}</StatePill>
          </li>
        ))}
      </ul>
    </SpecimenFrame>
  );
}

function OutboxSpecimen(): ReactElement {
  return (
    <SpecimenFrame label="Outbox">
      <ol className="divide-y divide-line">
        {OUTBOX_EVENTS.map((event) => (
          <li key={event.moment} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <span className="min-w-0">
              <span className="block font-medium text-ink">{event.moment}</span>
              <span className="block text-xs text-ink-2">{event.note}</span>
            </span>
            {event.tone ? <StatePill tone={event.tone}>{event.status}</StatePill> : null}
          </li>
        ))}
      </ol>
    </SpecimenFrame>
  );
}

function UntrustedSpecimen(): ReactElement {
  return (
    <SpecimenFrame label="How agent input is treated">
      <dl className="divide-y divide-line">
        {UNTRUSTED_INPUTS.map((input) => (
          <div key={input.source} className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-ink">{input.source}</dt>
            <dd className="rounded-mark bg-sunken px-2 py-1 text-xs font-medium text-ink-2">{input.handling}</dd>
          </div>
        ))}
      </dl>
    </SpecimenFrame>
  );
}

const RULES: readonly Rule[] = [
  {
    title: "Models read, code decides",
    body: "Models read the documents. Deterministic code decides versions, arithmetic, issue state, readiness and what goes in the packet. Only a clean recheck makes a case ready.",
    Specimen: DecisionsSpecimen,
  },
  {
    title: "The supplier sees only what they need",
    body: "The case code, the field, both stated values and the page. No prices and no other cases.",
    Specimen: SupplierViewSpecimen,
  },
  {
    title: "Original bytes are never changed",
    body: "Files are stored by their SHA-256 hash. The packet refuses any file whose bytes changed.",
    Specimen: BytesSpecimen,
  },
  {
    title: "Every outbound message is sent exactly once",
    body: "Each message goes into an outbox under a dedupe key before it's sent. If Switch is down, it waits and goes out once.",
    Specimen: OutboxSpecimen,
  },
  {
    title: "Hidden instructions stay data",
    body: "Instructions hidden inside a PDF or a chat message are treated as data, never as commands.",
    Specimen: UntrustedSpecimen,
  },
];

export function DesignRules(): ReactElement {
  return (
    <Section id="rules">
      <SectionIntro sectionId="rules" title="Design rules" lead="The rules behind every case, each shown in the part of the product where it applies." />
      <ul className="mt-14 border-t border-line">
        {RULES.map((rule) => (
          <li key={rule.title} className="grid gap-6 border-b border-line py-9 md:grid-cols-2 md:gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
            <div>
              <h3 className="font-serif text-[1.625rem] font-medium leading-tight tracking-[-0.01em] text-ink">{rule.title}</h3>
              <p className="mt-3 max-w-[52ch] leading-relaxed text-ink-2">{rule.body}</p>
            </div>
            <rule.Specimen />
          </li>
        ))}
      </ul>
    </Section>
  );
}
