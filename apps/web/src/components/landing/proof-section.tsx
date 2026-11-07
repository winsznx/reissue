import type { ReactElement, ReactNode } from "react";

import { CheckIcon } from "@/components/icons";
import { cx } from "@/components/ui";

import { Section, SectionIntro } from "./primitives";

const LIVE_RUN_TIMINGS = [
  { event: "“Received” reply in the thread", start: "from the operator's Slack post", time: "0.38 s" },
  { event: "Mismatch posted with page and row", start: "from the operator's Slack post", time: "0.58 s" },
  { event: "Examiner's review back", start: "from the handoff", time: "33 s" },
  { event: "Case ready for broker review", start: "from the supplier's PDF in Telegram", time: "0.34 s" },
  { event: "Ready message in the Slack thread", start: "from the supplier's PDF in Telegram", time: "0.62 s" },
  { event: "ZIP posted in the Slack thread", start: "from the supplier's PDF in Telegram", time: "0.75 s" },
] as const;

const DOCUMENT_RESULTS = [
  { measure: "Planted discrepancies found", result: "10 of 10" },
  { measure: "Clean pairs reported clean", result: "3 of 3" },
  { measure: "False alerts", result: "0" },
] as const;

const TEST_SUITES = [
  { lead: "36 of 36", rest: "integration tests pass on real Postgres, Redis, S3 and the document worker." },
  { lead: "Workbench browser tests", rest: "run in Chromium." },
] as const;

const INPUTS_HANDLED = ["Scanned PDFs and PNGs, with OCR", "XLSX packing lists", "Combined PDFs", "Reordered rows", "Cartons vs pieces"] as const;

function ReportPanel({ title, subtitle, children, className }: { title: string; subtitle: string; children: ReactNode; className?: string }): ReactElement {
  return (
    <div className={cx("flex flex-col rounded-panel border border-line bg-surface", className)}>
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h3 className="font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function ProofSection(): ReactElement {
  return (
    <Section id="proof">
      <SectionIntro
        sectionId="proof"
        title="How it was tested"
        lead="Timings from a live run on Slack and Telegram, real services in the integration tests, and documents with a known answer."
      />
      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        <ReportPanel title="Live run, 7 Nov 2026" subtitle="Case SHP-0287 on a local Switch 0.31.0 server with Slack and Telegram">
          <div className="flex-1">
            <table className="h-full w-full text-left">
              <caption className="sr-only">Timings from the live run on 7 Nov 2026</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {LIVE_RUN_TIMINGS.map((row) => (
                  <tr key={row.event}>
                    <th scope="row" className="px-5 py-3.5 font-normal sm:px-6">
                      <span className="block font-medium text-ink">{row.event}</span>
                      <span className="block text-sm text-ink-2">{row.start}</span>
                    </th>
                    <td className="tnum whitespace-nowrap px-5 py-3.5 text-right font-serif text-[1.625rem] font-medium leading-none text-ink sm:px-6">{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-3.5 text-xs leading-relaxed text-ink-2 sm:px-6">Each time starts at Switch&rsquo;s own timestamp of the person&rsquo;s message.</p>
        </ReportPanel>

        <div className="grid content-start gap-6">
          <ReportPanel title="Controlled test documents" subtitle="13 document pairs with a known answer">
            <table className="w-full text-left">
              <caption className="sr-only">Results on 13 controlled test document pairs</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {DOCUMENT_RESULTS.map((row) => (
                  <tr key={row.measure}>
                    <th scope="row" className="px-5 py-3.5 font-medium text-ink sm:px-6">
                      {row.measure}
                    </th>
                    <td className="tnum whitespace-nowrap px-5 py-3.5 text-right font-serif text-[1.625rem] font-medium leading-none text-ink sm:px-6">{row.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-5 py-3.5 text-xs leading-relaxed text-ink-2 sm:px-6">
              These are controlled test documents. They don&rsquo;t measure accuracy on arbitrary supplier paperwork.
            </p>
          </ReportPanel>

          <ReportPanel title="Test suites and inputs" subtitle="Integration and browser tests, and the formats it reads">
            <ul className="space-y-3 px-5 py-4 sm:px-6">
              {TEST_SUITES.map((item) => (
                <li key={item.lead} className="flex gap-3">
                  <CheckIcon size={16} strokeWidth={2} className="mt-1 shrink-0 text-ok" />
                  <span className="text-ink-2">
                    <span className="tnum font-semibold text-ink">{item.lead}</span> {item.rest}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-5 py-4 sm:px-6">
              <p id="inputs-handled" className="text-sm text-ink-2">
                Inputs it handles
              </p>
              <ul aria-labelledby="inputs-handled" className="mt-2.5 flex flex-wrap gap-2">
                {INPUTS_HANDLED.map((input) => (
                  <li key={input} className="rounded-mark border border-line bg-canvas px-2.5 py-1 text-sm text-ink">
                    {input}
                  </li>
                ))}
              </ul>
            </div>
          </ReportPanel>
        </div>
      </div>
    </Section>
  );
}
