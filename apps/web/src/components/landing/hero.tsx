import type { ReactElement } from "react";

import { CaseCard } from "./case-card";
import { SlackSnippet, TelegramSnippet } from "./chat-snippets";
import { IntegrationsStrip } from "./integrations-strip";
import { SwitchMark } from "./marks";
import { Container, WorkbenchLink, actionClass } from "./primitives";

function HeroStage(): ReactElement {
  return (
    <figure className="mt-12 md:mt-16">
      <div className="rounded-2xl border border-line bg-sunken p-3 sm:p-6 lg:p-10">
        <div className="grid justify-items-center gap-4 sm:gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:justify-items-stretch lg:gap-x-10">
          <SlackSnippet className="lg:col-start-1 lg:row-start-1 lg:self-end lg:justify-self-start" />
          <CaseCard className="w-full lg:col-start-2 lg:row-span-2 lg:row-start-1" />
          <TelegramSnippet className="lg:col-start-1 lg:row-start-2 lg:self-start lg:justify-self-end" />
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-ink-2">Case SHP-0287 from a live run on 7 Nov 2026, on a local Switch 0.31.0 server with Slack and Telegram.</figcaption>
    </figure>
  );
}

export function Hero(): ReactElement {
  return (
    <section aria-labelledby="hero-title" className="pb-20 pt-12 md:pb-28 md:pt-20">
      <Container>
        <p className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <SwitchMark className="size-5" />
          Built on Switch for Slack and Telegram
        </p>
        <h1
          id="hero-title"
          className="mt-5 font-serif text-[2.5rem] font-medium leading-[1.04] tracking-[-0.022em] text-ink sm:text-[3.25rem] lg:text-[4.25rem] xl:text-[4.5rem]"
        >
          <span className="block">Wrong shipping papers in.</span> <span className="block">Corrected shipment package out.</span>
        </h1>
        <div className="mt-8 flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <p className="max-w-[52ch] text-pretty text-lg leading-relaxed text-ink-2 md:text-[1.3125rem] md:leading-[1.55]">
            Reissue is a teammate for small import and freight teams that lives in the chat they already use. Drop a commercial invoice and packing list in
            your Slack operations room and mention <span className="font-medium text-ink">@reissue</span>.
          </p>
          <div className="flex flex-wrap gap-3">
            <WorkbenchLink className={actionClass("primary")} />
            <a href="#how-it-works" className={actionClass("secondary")}>
              See how it works
            </a>
          </div>
        </div>
        <HeroStage />
        <IntegrationsStrip />
      </Container>
    </section>
  );
}
