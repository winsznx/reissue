# Switch behaviour, measured

Every number below comes from running the frozen build against a real Switch server. The raw runs
are in `tests/scenario-runs/live-switch-*.json`, and `pnpm test:live` reproduces them.

## Environment

| | |
|---|---|
| Switch server | `ghcr.io/sandbox-quantum/switch-core:0.31.0`, self-hosted with `scripts/switch-local.sh`. Feature flags: `follow_the_conversation`, `agent_management`, `agent_chats` |
| Messaging app | Mattermost 11.9.0 through Switch's bundled bridge, on the same machine |
| Agents | `reissue` (custom WebSocket agent, protocol 8), `reissue-examiner` and `reissue-liaison` (agent runtime, Claude Code 2.1.311 headless) |
| People | Two real Mattermost accounts, operator `user` and supplier `li.wei`. In these measured runs their actions were scripted by `tests/end-to-end/live-switch.ts` |
| Machine | Apple silicon laptop, everything local |
| Date | 2026-11-05 |

The six timed runs below used Mattermost, with the people's actions scripted. The run on real
Slack and Telegram accounts is in [Slack and Telegram, live](#slack-and-telegram-live).

## Timings, six live runs

These are wall-clock times from the person's post to the effect. Switch-side times use the
Mattermost post timestamp. Reissue-side times use the stored `switch_events.received_at` and
`case_events.created_at`.

| Primitive | What was measured | n | min | median | max |
|---|---|---|---|---|---|
| Message + file refs reach the agent | Operator posts two PDFs → `switch_events` row stored | 6 | 118 ms | 151 ms | 201 ms |
| First visible acknowledgement | Post → "Received: …" in the same thread | 6 | 233 ms | 319 ms | 421 ms |
| Discrepancy posted | Post → "1 discrepancy found … p. 1, row 3" | 6 | 377 ms | 495 ms | 583 ms |
| Agent-to-agent handoff (`send_targeted_message`) | Handoff visible → examiner's `DOCUMENT_REVIEW_RESULT` visible | 6 | 11.7 s | 15.2 s | 15.8 s |
| Cross-room request | Operator post → liaison's request visible in the supplier room | 6 | 12.4 s | 16.0 s | 17.0 s |
| Follow-up without @ | Supplier's untagged thread reply → `SUPPLIER_REPLY_RECEIVED` on the case | 6 | 92 ms | 102 ms | 164 ms |
| Follow-up answered | Supplier reply → liaison's answer in the thread | 6 | 7.0 s | 10.2 s | 11.1 s |
| Replacement file triggers recheck | Supplier posts v2 → `RECONCILIATION_COMPLETED` | 4 | 236 ms | 254 ms | 271 ms |
| Replacement to ready | Supplier posts v2 → "READY FOR BROKER REVIEW" in the ops thread | 4 | 400 ms | 415 ms | 445 ms |

The two long rows are the Claude Code specialists working: five turns and three tool calls for the
examiner, two tool calls for the liaison. Everything Switch carries arrives in well under a second.

## Failure and recovery runs

| Case | What happened | What people saw |
|---|---|---|
| Revised file still wrong (`--variant still-wrong`, SHP-0252) | v2 still said 480. The recheck kept the issue open, and a focused follow-up went out in the same supplier thread 545 ms after the upload. The correct v2 then resolved it | Supplier: "still needs a correction … invoice says 500 pcs; packing list says 480 pcs". Operator: the case stayed on Waiting on supplier |
| Worker killed right after the replacement upload, first build (SHP-0253) | The extraction job's lock had to expire (120 s) before another worker took it. Recheck took 152 s and produced exactly one READY | 2½ minutes of "Received … rechecking", then one READY |
| Same, after shortening the job lock to 20 s with a 10 s stall check (SHP-0256) | Recheck after 2.3 s, exactly one READY, one packet | A short pause, then one READY |
| Switch unreachable while messages are queued | Covered by `tests/integration/correction-loop.test.ts › Switch outage`. Delivery fails, the outbox row stays `PENDING`, and it's sent exactly once after recovery | Nothing until Switch returns, then the message once |
| Duplicate delivery of the same Switch event | The `msg:<room>:<message_id>` unique key refuses the second row. Re-processing the stored event is a no-op | One reply |

## Other observations from the live server

- A post with two files arrives as one `message` event with two `attachments`, each with an `mxc`
  ref. This was confirmed first on a probe agent: two PDFs, one event, byte-exact downloads, and a
  threaded reply posted.
- `GET /agents/{id}/ops` on 0.31.0 offered 57 operations. `delegate_task` was not among them.
- `connection_state.heartbeat_interval_seconds` was 2.0 on 0.31.0. Pongs are answered inside the
  socket callback, so a 15 s examiner turn never lapsed a connection.
- Stream tickets with `filter=all` sit just above 2^53 − 2^32, so they're still exact JavaScript
  integers. Generations are about 2^33, so `switch_cursors.generation` is `bigint`. The first live
  run found that the 32-bit column overflowed.
- A Mattermost post that is a `!follow-ups on` or `!assign-agent @reissue-liaison` command gets a
  confirmation from Switch itself. After `!assign-agent`, every supplier message in that room
  reached the liaison with `addressed: true`.
- The liaison's addressing had to be widened (`update_agent_detail addressing=anyone`) for the
  supplier's account, which isn't owned by the operator, to reach it. On Console, a custom rule
  that names the supplier is tighter. The examiner kept `owner_and_owner_agents`.

## Slack and Telegram, live

On 2026-11-07 the same self-hosted Switch 0.31.0 server was connected to real Slack and Telegram
accounts through its gateway API (see [switch/setup.md](../switch/setup.md)):

- a Slack app in Socket Mode, in the workspace "Northfield Home Goods", channel `#shipment-ops`
- the Telegram bot `@ReissueSupplierBot`, polled by Switch, in a hand-made group called "Lumen
  Lighting x Northfield"

One real person played the operator in Slack and the supplier in Telegram Desktop. Nothing was
scripted.

Case SHP-0287, timed from Switch's own timestamp of each person's message:

| Step | Time |
|---|---|
| Operator posts two PDFs in Slack → event stored | 164 ms |
| → "Received: …" in the Slack thread | 381 ms |
| → "1 discrepancy found … p. 1, row 3" | 581 ms |
| Handoff to `reissue-examiner` → its review back | 32.9 s |
| Review back → liaison's request posted in the Telegram group | 0.25 s |
| Supplier sends `packing-list-v2.pdf` in Telegram → event stored | 39 ms |
| → recheck done, case Ready for broker review | 336 ms |
| → READY message in the Slack thread | 620 ms |
| → ZIP posted in the Slack thread | 747 ms |
| Supplier's untagged text reply → liaison's relay recorded on the case | 17.0 s |

What the first runs on Slack and Telegram found. All of it was fixed the same morning, and each
fix has a test or a live re-run:

- Room commands such as `!follow-ups on` arrive with `body: null`. The coordinator's gap recovery
  called `.includes` on it and failed again on every reconnect. A null body is now read as empty
  text.
- Moving the supplier room from Mattermost to Telegram with `connect-rooms` kept the old binding,
  and the handoff named the old room. The liaison refused it with "handoff names a supplier room
  this liaison is not bound to". Now the room set in config wins.
- Telegram users often send a message or a file into the group instead of replying to the
  request. With `!assign-agent`, those messages still reach the liaison, but they carry no
  thread. The coordinator now takes a file sent straight into the supplier's group as the
  revision when only one case waits on that group. The liaison's case list now covers only its
  own room, so it no longer asks the supplier which case they mean.
- Without a thread, the file can resolve the case before the liaison's slower answer to the
  text arrives, and that answer then asks for the file. If the supplier sends the text, waits
  for the liaison, and then sends the file, the conversation reads naturally.

The demo film is from a second run, SHP-0290. A script drove the real Slack and Telegram web apps
through the person's own signed-in sessions, and three screen recorders ran at the same time:

- Under that recording load, the Slack side was slower than in SHP-0287. The mismatch was posted
  9.6 s after Switch delivered the message, and the examiner's review came back 39.9 s after the
  handoff.
- Switch's Telegram adapter timed out fetching the supplier's first PDF (`get_file`, `TimedOut`).
  It passed the message on as `_attachment not relayed: packing-list-v2.pdf — download failed:
  Timed out_`, with no file. The liaison told the supplier the download had timed out and asked
  them to attach the PDF again.
- The second send went through. From Switch's timestamp of that message, the case was Ready
  for broker review after 0.41 s, and the ZIP was in the Slack thread after 0.74 s.
- The coordinator ignores Switch's "attachment not relayed" note when it arrives outside the
  request thread. The supplier still got an answer, because the liaison is the group's assigned
  agent. Without an assigned liaison, the note would go unanswered.

Connection notes from the same run:

- Switch refuses a Telegram connection with `channel_creation_enabled: true`, because Telegram
  bots can't create chats. Once the bot was added to the group, Switch adopted the group as a
  room on its own.
- On connect, Switch published 26 Telegram bot commands. Telegram lists `!follow-ups` and
  `!assign-agent` as `/follow_ups` and `/assign_agent`, and the `!` forms work as typed.
- Neither connection needed a public URL. Telegram is polled and Slack uses Socket Mode.

