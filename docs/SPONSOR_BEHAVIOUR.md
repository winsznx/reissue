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

Slack and Telegram were not connected for these runs, because their credentials aren't available
in this environment. The code path is the same: Switch delivers the same `message` events and
attachment refs whichever messaging app sits behind the room. That still has to be confirmed on
Slack and Telegram before the demo is recorded.

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
