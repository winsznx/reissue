# What I learned wiring three agents across Slack and Telegram with Switch

The invoice said 500 pieces of LL-STR-050 and the packing list said 480, both on page 1, row 3. Getting the supplier to fix it meant asking in their own Telegram group, and when they answered without tagging anyone, the reply still reached the right agent. Seventeen seconds later, that agent's relay was recorded on the case.

In plain terms, a supplier's paperwork had the wrong number, and someone had to chase them to fix it. I built three AI agents that do the chasing inside Slack and Telegram, with Switch connecting the agents, the people and the two chat apps. This post shows how to wire that up and the six things that went wrong on the way.

Here's the two-minute demo: https://youtu.be/vKjUc5GknYc

This is the setup behind it, for anyone new to Switch.

## What Reissue does

Reissue lives in the chat a small import team already uses. Drop an invoice and packing list into the operations room, mention `@reissue`, and it finds the contradiction down to page and row, gets a second agent to verify it, asks the supplier for a fix in Telegram, rechecks the revision and posts a ZIP for the broker.

Three Switch agents do this. `reissue` is the coordinator, a custom agent on WebSocket agent protocol 8. `reissue-examiner` verifies evidence and `reissue-liaison` talks to the supplier. Both run headless Claude Code against role-scoped MCP tools.

It all ran on self-hosted `switch-core` 0.31.0, using Telegram from server 0.30.0 and follow-ups and agent-to-agent messages from 0.31.0. The live rooms were `#shipment-ops` in the Slack workspace "Northfield Home Goods" and the Telegram group "Lumen Lighting x Northfield" with the bot `@ReissueSupplierBot`. In case SHP-0287, one person played operator and supplier on two real accounts, and nothing was scripted.

## Setup from zero

### Run a server

```bash
scripts/switch-local.sh up
```

That starts Switch 0.31.0, Postgres and Mattermost in Docker. Path A in `switch/setup.md` runs the whole loop on that Mattermost with no outside accounts. For Slack and Telegram, I skipped Switch Console and used the same server's gateway API.

### Register the agent

Create a registration key in the Gateway under API Keys. Registering is one `POST /agents` with that key as the bearer token. The body carries a `name`, a `description` and an `integration_profile` with `connection_model: "always_on"` and `message_exchange: true`. The response has an `id` and an `api_key` that's shown once. Reissue's `register` script keeps it in `.data/coordinator-credentials.json`.

### Connect Telegram

Log in once and keep the cookie. The password is `GATEWAY_ADMIN_PASSWORD` in `.data/switch/.env`.

```bash
curl -c gw.txt -H 'content-type: application/json' http://127.0.0.1:8000/gateway/auth/login \
  -d '{"email":"<admin email>","password":"<GATEWAY_ADMIN_PASSWORD>"}'
```

Create the bot in @BotFather, turn Group Privacy off, then create the connection.

```bash
curl -b gw.txt -H 'content-type: application/json' http://127.0.0.1:8000/gateway/collaborations \
  -d '{"bridge_type":"telegram","display_name":"Telegram","channel_creation_enabled":false,
       "connection_config":{"bot_token":"<token>","bot_username":"<bot username>"}}'
```

Bots can't create groups, so make one by hand and add the bot. Switch adopts it as a room, and since Switch polls Telegram, nothing needs a public URL.

### Connect Slack

1. `GET /gateway/collaborations/setup/slack` returns a Socket Mode manifest. Create and install the app from it.
2. Make an `xapp-` token with `connections:write`.
3. `POST /gateway/collaborations/setup/slack/check` with `{"bot_token":"<xoxb- token>","app_token":"<xapp- token>"}` returns the workspace id.
4. Create the connection with `bridge_type: "slack"` and `connection_config: {bot_token, app_token, workspace_id, agent_usergroups: false}`, since user groups need a paid plan.
5. Link yourself with `POST /gateway/collaborations/{bridge_id}/identities` and `{"external_user_id":"<Slack user id>","username":"<Slack username>"}`.
6. Run `/invite @Agent Switch` in the channel.

### Add the agents

`GET /gateway/rooms` lists the new rooms, and `POST /gateway/rooms/{room_id}/agents` with `{"agent_ids":[<agent ids>]}` adds agents. Agent ids are in `.data/*-credentials.json`. Then Reissue binds the rooms.

```bash
pnpm --filter @reissue/switch-coordinator connect-rooms --ops <Slack room id> --supplier <Telegram room id>
scripts/stack.sh restart
```

In the Telegram group, send `!follow-ups on` and `!assign-agent @reissue-liaison`. Telegram lists them as `/follow_ups` and `/assign_agent`, and the `!` forms work as typed. After that, supplier messages reach the liaison whether or not they tag anyone. The supplier's account isn't owned by the operator, so the liaison's addressing also had to be widened with `update_agent_detail addressing=anyone`. The examiner stays on the default.

## The agent protocol

The coordinator keeps one WebSocket per room at `/agents/{agent_id}/connection/ws`, authorized with the agent's API key. Its connection id is a hash of the agent and room ids, so the server resumes the same connection after every reconnect. The query string comes from `packages/switch-adapter/src/connection.ts`.

```ts
const params = new URLSearchParams({
  connection_id: connectionId,
  scope: "single",
  filter: "all",
  start_from: this.cursor === null ? "head" : String(this.cursor),
  rooms: roomId,
  protocol: String(PROTOCOL),
  protocol_accepts: String(PROTOCOL),
  client: clientName,
  client_version: clientVersion,
});
if (this.generation !== null) params.set("expected_generation", String(this.generation));
```

Switch's `connection_state` frame carries the `generation`, the `cursor` and `heartbeat_interval_seconds`, which was 2.0 on 0.31.0. Reissue stores the first two per room and sends them back as `expected_generation` and `start_from`.

- Answer `ping` with `{"type":"pong","cursor":<cursor>}` inside the socket callback, before awaiting any event work. That's why a 15-second examiner turn never lapsed a connection.
- Move the cursor only after the event is stored under `msg:<room>:<message_id>`. A redelivery then hits the unique key and does nothing.
- On a `gap` frame, jump to its `resumed_at` and call `read_context` to pick up what the stream skipped.
- Store generations as `bigint`. They're about 2^33, and the first live run overflowed a 32-bit column.
- Read `GET /agents/{id}/ops` first. On 0.31.0 it offered 57 operations, without `delegate_task`. Reissue checks every `POST /agents/{id}/ops/{name}` call against the published `input_schema`, so a bad payload fails locally.

## Handing work between agents

Agents address each other with the `send_targeted_message` op, which takes a `body`, `target_names` and an optional `thread_id`, and returns an `event_id` and `target_statuses`. Switch owns delivery and addressing. Reissue owns the payload, a fenced `reissue` JSON block in the body. This is the coordinator's handoff to the liaison, with placeholders.

````text
Please send this correction request to the supplier room for <case code> and handle their replies.
```reissue
{"kind":"SUPPLIER_REQUEST_ASSIGNED","case_id":"<case code>","task_id":"<task id>","issue_ids":["<issue code>"],"supplier_room_id":"<Telegram room id>","supplier_brief":"<supplier-safe request text>"}
```
````

The examiner gets a `DOCUMENT_REVIEW_REQUESTED` and answers with a `DOCUMENT_REVIEW_RESULT`. The liaison reports supplier replies back with `SUPPLIER_REPLY_RELAYED`. The coordinator only accepts a review from the assigned examiner, and if an agent never answers, a timeout keeps the case moving.

## Files through the media routes

A post with two PDFs arrives as one `message` event with two `attachments`, each with an `mxc` ref. Download the bytes from `GET /agents/{agent_id}/rooms/{room_id}/media?mxc=<mxc>`. A multipart `POST` to the same path with `files`, `caption` and `thread_id` is how the ZIP gets back into the Slack thread. Files sent into Telegram are capped at 20 MB, and anything bigger gets a secure upload link. I've only tested that on Mattermost.

## Gotchas

### Switch refused the Telegram connection

It refuses `channel_creation_enabled: true`, because Telegram bots can't create chats. Send `false` and make the group yourself.

### Group Privacy has to be off before the bot joins

Turn it off in @BotFather before adding the bot anywhere. Both setup paths in `switch/setup.md` put it first.

### Gap recovery failed on every reconnect

Room commands such as `!follow-ups on` arrive with `body: null`, and `read_context` returns `body: null` for entries without text. Gap recovery called `.includes` on that and failed on each reconnect. The fix reads null as empty text at the boundary, with a test for both paths.

```ts
body: z.string().nullish().transform((body) => body ?? ""),
```

### The handoff named the old room

SHP-0286 stopped after the examiner. Moving the supplier room from Mattermost to Telegram with `connect-rooms` kept the old binding, so the liaison refused the handoff with "handoff names a supplier room this liaison is not bound to". Now the room set in config wins, with a regression test.

### Suppliers don't reply in threads

Telegram users often send a file straight into the group instead of replying. `!assign-agent` still routes it to the liaison, but with no thread. The coordinator now takes such a file as the revision when only one case waits on that group. Without a thread, the file can also resolve the case before the liaison answers the supplier's text, and that answer then asks for the file.

### The Telegram adapter dropped a PDF

In SHP-0290, Switch's Telegram adapter timed out in `get_file` on the supplier's first PDF. It only tries once, so the message came through as an "attachment not relayed" note with no file. The liaison, as the group's assigned agent, asked for the PDF again and the second send went through. Without an assigned agent, nobody would have answered. A retry for network failures is proposed upstream in [sandbox-quantum/switch#1689](https://github.com/sandbox-quantum/switch/pull/1689).

## The numbers

In six scripted Mattermost runs, everything Switch carried arrived in well under a second, and an untagged supplier reply reached the case in a median of 102 ms. On real Slack and Telegram in SHP-0287, the discrepancy was in the thread 581 ms after the PDFs were posted. The supplier's `packing-list-v2.pdf` made the case Ready for broker review in 336 ms and put the ZIP in Slack in 0.75 s. In SHP-0290, the resent PDF reached Ready in 0.41 s and the ZIP in 0.74 s.

The slow part is the specialists. The examiner took five turns and three tool calls in the scripted runs, and its review came back 32.9 s after the handoff in SHP-0287.

## What I'd tell myself on day one

- Read the ops list before writing a client, and validate against it.
- Parse every frame with a schema and expect `body: null`.
- Let delivery be at least once and dedupe on your side.
- Expect Telegram messages outside any thread.

What worked was the routing. Follow-ups, `!assign-agent` and `send_targeted_message` carried a full loop across Slack and Telegram.

The specialists ran as hosted agents for every run above. The repo also ships a Switch Console template that runs them as managed agents, and it passes `save_template` validation.

The code and every timing above are at https://github.com/winsznx/reissue.

#HowISwitch
