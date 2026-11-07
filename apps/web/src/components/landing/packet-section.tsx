import type { ReactElement } from "react";

import { DocIcon, PacketIcon } from "@/components/icons";

import { Section, SectionIntro, StatePill } from "./primitives";

interface PacketFile {
  name: string;
  about: string;
}

interface PacketGroup {
  title: string;
  files: readonly PacketFile[];
}

const PACKET_GROUPS: readonly PacketGroup[] = [
  {
    title: "From the supplier, unaltered",
    files: [
      { name: "01-commercial-invoice-v1.pdf", about: "Commercial invoice LUM-2026-0417, as the supplier issued it" },
      { name: "02-packing-list-v2.pdf", about: "The supplier's revised packing list, Revision 2 of 21 Oct 2026" },
    ],
  },
  {
    title: "Written by Reissue",
    files: [
      { name: "correction-summary.pdf", about: "What was wrong, what changed and where the revised file came from" },
      { name: "document-index.csv", about: "Each document with its version, source, sender, time received and SHA-256" },
    ],
  },
];

const PACKET_PROMISES = [
  { title: "Current versions only", body: "The invoice is still v1 because it was right. The packing list is the supplier's v2." },
  { title: "The bytes the supplier sent", body: "Files are stored by their SHA-256 hash, and the packet refuses any file whose bytes changed." },
] as const;

export function PacketSection(): ReactElement {
  return (
    <Section id="packet">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <SectionIntro
            sectionId="packet"
            title="What your broker gets"
            lead="One ZIP, posted in the Slack thread where the case started. It holds the current documents exactly as the supplier issued them, plus a summary of what changed."
          />
          <dl className="mt-10 space-y-6">
            {PACKET_PROMISES.map((promise) => (
              <div key={promise.title} className="border-l-2 border-line-strong pl-4">
                <dt className="font-semibold text-ink">{promise.title}</dt>
                <dd className="mt-1 leading-relaxed text-ink-2">{promise.body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="self-start overflow-hidden rounded-panel border border-line bg-surface shadow-doc">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-sunken px-5 py-4">
            <p className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-mark bg-accent-soft text-accent">
                <PacketIcon size={20} />
              </span>
              <span className="min-w-0">
                <span className="block wrap-break-word font-semibold text-ink">SHP-0287-current-documents.zip</span>
                <span className="block text-sm text-ink-2">Posted in the #shipment-ops thread</span>
              </span>
            </p>
            <StatePill tone="ok">Ready for broker review</StatePill>
          </div>
          {PACKET_GROUPS.map((group) => (
            <div key={group.title} className="border-b border-line last:border-b-0">
              <p className="px-5 pb-1 pt-4 text-sm font-medium text-ink-2">{group.title}</p>
              <ul className="px-2 pb-3">
                {group.files.map((file) => (
                  <li key={file.name} className="flex items-start gap-3 rounded-mark px-3 py-3">
                    <DocIcon size={20} className="mt-0.5 shrink-0 text-ink-2" />
                    <span className="min-w-0">
                      <span className="block wrap-break-word font-medium text-ink">{file.name}</span>
                      <span className="block text-sm leading-relaxed text-ink-2">{file.about}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
