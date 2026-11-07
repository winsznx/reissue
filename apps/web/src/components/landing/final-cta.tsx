import type { ReactElement } from "react";

import { ReissueMark } from "./marks";
import { Container, GitHubLink, WorkbenchLink, actionClass } from "./primitives";

export function FinalCta(): ReactElement {
  return (
    <section aria-labelledby="final-cta-title" className="pb-20 md:pb-28">
      <Container>
        <div className="grid gap-10 rounded-2xl border border-line bg-surface px-6 py-12 sm:px-10 md:px-14 md:py-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16">
          <div>
            <ReissueMark className="size-10" />
            <h2 id="final-cta-title" className="mt-6 max-w-[22ch] text-balance font-serif text-[2.25rem] font-medium leading-[1.08] tracking-[-0.015em] text-ink md:text-[3rem]">
              Open the Workbench, or run the whole loop yourself
            </h2>
            <p className="mt-4 max-w-[58ch] text-pretty text-[1.0625rem] leading-relaxed text-ink-2 md:text-lg">
              The Workbench shows every case with its documents, evidence, corrections and broker packet. The README runs everything locally with Docker,
              including a local Switch server.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:flex-col lg:items-stretch">
            <WorkbenchLink className={actionClass("primary")} />
            <GitHubLink className={actionClass("secondary")} />
          </div>
        </div>
      </Container>
    </section>
  );
}
