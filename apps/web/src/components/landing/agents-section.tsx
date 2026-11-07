import type { ReactElement } from "react";

import { cx } from "@/components/ui";

import { ReissueMark, SlackMark, SwitchMark, TelegramMark, type MarkProps } from "./marks";
import { ExternalLink, Section, SectionIntro } from "./primitives";
import { SWITCH_DOCS_URL } from "./site";

interface ChatRoom {
  app: string;
  Mark: (props: MarkProps) => ReactElement;
  name: string;
  kind: string;
  events: readonly string[];
}

interface Agent {
  handle: string;
  role: string;
  duty: string;
}

const OPERATIONS_ROOM: ChatRoom = {
  app: "Slack",
  Mark: SlackMark,
  name: "#shipment-ops",
  kind: "Operations room, Northfield Home Goods",
  events: [
    "Your team posts the invoice and packing list and mentions @reissue.",
    "The mismatch comes back in the thread with page and row.",
    "The ready message and the ZIP arrive in the same thread.",
  ],
};

const SUPPLIER_ROOM: ChatRoom = {
  app: "Telegram",
  Mark: TelegramMark,
  name: "Lumen Lighting x Northfield",
  kind: "The supplier's own group",
  events: ["The liaison asks for the correct figures.", "The supplier replies in their own words, with no @.", "The revised PDF arrives in the same thread."],
};

const COORDINATOR: Agent = {
  handle: "reissue",
  role: "Coordinator",
  duty: "An always-on custom Switch agent. It opens cases, checks documents and hands off work.",
};

const SPECIALISTS: readonly Agent[] = [
  { handle: "reissue-examiner", role: "Examiner", duty: "Verifies the cited rows on both documents with read-only evidence tools." },
  { handle: "reissue-liaison", role: "Liaison", duty: "Talks to the supplier with supplier-safe tools only." },
];

const SWITCH_FEATURES = [
  { feature: "Telegram rooms", release: "Server 0.30.0", use: "The supplier's Telegram group is a Switch room." },
  { feature: "Follow-ups", release: "Server 0.31.0", use: "Supplier replies without an @ still reach the liaison." },
  { feature: "Agent-to-agent messages", release: "Server 0.31.0", use: "send_targeted_message carries both handoffs from the coordinator." },
  { feature: "File delivery", release: "Media routes", use: "Supplier PDFs come in and the packet goes back out." },
  { feature: "WebSocket agent protocol", release: "Resume and gap recovery", use: "The coordinator's connection can resume and recover missed messages." },
  { feature: "Managed agents", release: "Console 0.40", use: "Template included." },
] as const;

function RoomCard({ room, className }: { room: ChatRoom; className?: string }): ReactElement {
  return (
    <div className={cx("flex flex-col rounded-panel border border-line bg-surface p-5", className)}>
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <room.Mark className="size-5 shrink-0" />
        {room.app}
      </p>
      <h3 className="mt-3 text-lg font-semibold leading-snug text-ink">{room.name}</h3>
      <p className="text-sm text-ink-2">{room.kind}</p>
      <ul className="mt-4 space-y-2.5 border-t border-line pt-4 text-sm leading-relaxed text-pretty text-ink-2">
        {room.events.map((event) => (
          <li key={event} className="flex gap-2.5">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
            {event}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentCard({ agent, className }: { agent: Agent; className?: string }): ReactElement {
  return (
    <div className={cx("min-w-0 rounded-panel border border-line bg-surface p-4", className)}>
      <div className="flex items-center gap-2">
        <ReissueMark className="size-5 shrink-0" />
        <h3 className="min-w-0 wrap-break-word text-[0.9375rem] font-semibold text-ink">{agent.handle}</h3>
      </div>
      <p className="mt-1 text-sm font-medium text-ink-2">{agent.role}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{agent.duty}</p>
    </div>
  );
}

function Connector({ label, switchSide, className }: { label: string; switchSide: "start" | "end"; className?: string }): ReactElement {
  const switchAtEnd = switchSide === "end";
  return (
    <div className={cx("grid place-items-center", className)}>
      <span className="relative flex h-12 w-full justify-center lg:hidden">
        <span aria-hidden="true" className="h-full w-px bg-line-strong" />
        <span className={cx("absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs text-ink-2", switchAtEnd ? "left-1/2 ml-3" : "right-1/2 mr-3")}>{label}</span>
      </span>
      <span className="relative hidden h-16 w-full lg:block">
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
        <span className={cx("absolute bottom-1/2 mb-2 text-balance text-center text-xs leading-snug text-ink-2", switchAtEnd ? "left-1 right-6" : "left-6 right-1")}>{label}</span>
      </span>
    </div>
  );
}

function Handoffs({ className }: { className?: string }): ReactElement {
  return (
    <div className={cx("relative h-16", className)}>
      <svg aria-hidden="true" viewBox="0 0 100 64" preserveAspectRatio="none" fill="none" className="absolute inset-0 size-full stroke-line-strong">
        <path d="M50 0V32M25 32H75M25 32V64M75 32V64" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <code className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-mark border border-line bg-surface px-2 py-1 font-mono text-xs text-ink">
        send_targeted_message
      </code>
    </div>
  );
}

export function AgentsSection(): ReactElement {
  return (
    <Section id="agents" className="border-y border-line bg-sunken">
      <SectionIntro
        sectionId="agents"
        title="Two rooms, three agents"
        lead="Your team works in Slack and your supplier works in Telegram. Switch connects both rooms and carries every handoff between Reissue's three agents."
      />

      <div className="mt-14 grid lg:mt-20 lg:grid-cols-[minmax(0,0.95fr)_8rem_minmax(0,1.7fr)_8rem_minmax(0,0.95fr)] lg:grid-rows-[auto_auto_auto]">
        <div
          aria-hidden="true"
          className="pointer-events-none relative hidden rounded-2xl border border-dashed border-line-strong lg:col-start-3 lg:row-span-3 lg:row-start-1 lg:-mx-3 lg:-my-9 lg:block"
        >
          <span className="absolute -top-2.5 left-4 flex items-center gap-1.5 bg-sunken px-2 text-xs font-medium leading-5 text-ink-2">
            <SwitchMark className="size-4" />
            Running on Switch
          </span>
        </div>
        <RoomCard room={OPERATIONS_ROOM} className="lg:col-start-1 lg:row-span-3 lg:row-start-1" />
        <Connector label="messages and files" switchSide="end" className="lg:col-start-2 lg:row-start-1" />
        <AgentCard agent={COORDINATOR} className="lg:col-start-3 lg:row-start-1" />
        <Handoffs className="lg:col-start-3 lg:row-start-2" />
        <div className="grid grid-cols-2 gap-3 lg:col-start-3 lg:row-start-3">
          {SPECIALISTS.map((agent) => (
            <AgentCard key={agent.handle} agent={agent} />
          ))}
        </div>
        <Connector
          label="follow-ups and files"
          switchSide="start"
          className="w-1/2 justify-self-end lg:col-start-4 lg:row-start-3 lg:w-auto lg:justify-self-stretch"
        />
        <RoomCard room={SUPPLIER_ROOM} className="lg:col-start-5 lg:row-span-3 lg:row-start-1" />
      </div>

      <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
        <div>
          <h3 className="text-lg font-semibold text-ink">What Switch does here</h3>
          <dl className="mt-4 divide-y divide-line border-y border-line">
            {SWITCH_FEATURES.map((item) => (
              <div key={item.feature} className="grid gap-1 py-3.5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6">
                <dt>
                  <span className="block font-medium text-ink">{item.feature}</span>
                  <span className="block text-sm text-ink-2">{item.release}</span>
                </dt>
                <dd className="text-ink-2">{item.use}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm">
            <ExternalLink href={SWITCH_DOCS_URL} className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Read the Switch docs
            </ExternalLink>
          </p>
        </div>
        <div className="self-start rounded-panel border border-dashed border-line-strong bg-canvas p-6">
          <h3 className="flex items-center gap-2.5 text-lg font-semibold text-ink">
            <SwitchMark on={false} className="size-6 shrink-0" />
            If Switch is off
          </h3>
          <p className="mt-3 leading-relaxed text-ink-2">
            The Workbench can still parse an uploaded PDF. But nobody can open a case from chat, the supplier can&rsquo;t answer in the shared conversation, and
            no handoff completes.
          </p>
        </div>
      </div>
    </Section>
  );
}
