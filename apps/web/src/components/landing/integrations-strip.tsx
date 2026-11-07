import type { ReactElement } from "react";

import { SlackMark, SwitchMark, TelegramMark, type MarkProps } from "./marks";

interface Channel {
  name: string;
  role: string;
  Mark: (props: MarkProps) => ReactElement;
}

const CHANNELS: readonly Channel[] = [
  { name: "Slack", role: "Your operations room", Mark: SlackMark },
  { name: "Switch", role: "Rooms, agents and handoffs", Mark: SwitchMark },
  { name: "Telegram", role: "Your supplier's group", Mark: TelegramMark },
];

export function IntegrationsStrip(): ReactElement {
  return (
    <div className="mt-14 grid gap-7 border-t border-line pt-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-12">
      <p className="max-w-[46ch] text-ink-2">
        Your team stays in Slack and your supplier stays in Telegram. Switch carries the messages, files and handoffs between them.
      </p>
      <ul className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {CHANNELS.map((channel, index) => (
          <li key={channel.name} className="flex items-center">
            {index > 0 ? <span aria-hidden="true" className="mr-5 hidden h-px w-10 bg-line-strong sm:block" /> : null}
            <channel.Mark className="size-8 shrink-0" />
            <span className="ml-3">
              <span className="block font-semibold leading-tight text-ink">{channel.name}</span>
              <span className="block text-sm text-ink-2">{channel.role}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
