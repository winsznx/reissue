import type { ReactElement } from "react";

import { ExternalLink, Section, SectionIntro } from "./primitives";
import { GITHUB_URL } from "./site";

interface FaqItem {
  question: string;
  answer: string;
  link?: { href: string; label: string };
}

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "Does the supplier need a new account or app?",
    answer: "No. They answer in their own Telegram group, in their own words, without tagging anyone. The revised PDF goes in the same thread.",
  },
  {
    question: "What does the AI decide?",
    answer:
      "Models read the documents. Deterministic code decides versions, arithmetic, issue state, readiness and what goes in the packet. Only a clean recheck makes a case ready.",
  },
  {
    question: "What if the revised file is still wrong?",
    answer: "The case stays waiting on the supplier, and the liaison sends one focused follow-up in the same supplier thread.",
  },
  {
    question: "What does the supplier get to see?",
    answer: "The case code, the field, both stated values and the page. No prices and no other cases.",
  },
  {
    question: "What happens if Switch is down?",
    answer: "Outbound messages wait in an outbox under a dedupe key and go out once when Switch is back, so nobody gets the same message twice.",
  },
  {
    question: "Can I run it myself?",
    answer: "Yes. The README on GitHub runs everything locally with Docker, including a local Switch server. It can also connect real Slack and Telegram.",
    link: { href: GITHUB_URL, label: "Read the README on GitHub" },
  },
];

export function FaqSection(): ReactElement {
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-16">
        <SectionIntro sectionId="faq" title="Questions" lead="Short answers about suppliers, the AI and running Reissue yourself." className="lg:sticky lg:top-28 lg:self-start" />
        <div className="border-t border-line">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[1.0625rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
                {item.question}
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong text-ink-2 transition-transform duration-200 group-open:rotate-45"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" focusable="false">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </span>
              </summary>
              <div className="max-w-[62ch] pb-6 pr-12 leading-relaxed text-ink-2">
                <p>{item.answer}</p>
                {item.link ? (
                  <p className="mt-3">
                    <ExternalLink href={item.link.href} className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                      {item.link.label}
                    </ExternalLink>
                  </p>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
