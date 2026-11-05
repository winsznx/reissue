# Switch setup

Reissue runs as three Switch agents in two or three rooms:

| Agent | What it is | Rooms |
|---|---|---|
| `reissue` | Always-on coordinator, a custom agent on the WebSocket agent protocol (`apps/switch-coordinator`) | shipment-ops, supplier-corrections, reissue-verification |
| `reissue-examiner` | Claude Code specialist that verifies evidence through Reissue's MCP tools | shipment-ops, reissue-verification |
| `reissue-liaison` | Claude Code specialist that talks to the supplier through supplier-safe tools | shipment-ops, supplier-corrections |

The specialists can run two ways. **Managed** agents are created in Switch Console with
`switch/template.yaml` and run under Console's agent controller. **Hosted** agents use
`apps/agent-runtime`, which registers each one as its own Switch agent and runs headless Claude
Code for every turn. Both use the same instructions (`agents/*/AGENT.md`) and the same MCP tools.

There are two setups. Path A is local and needs no external accounts. Path B uses Slack and
Telegram.

## Path A: local Switch with Mattermost (fully scriptable)

```bash
scripts/switch-local.sh up                         # Switch 0.31.0 + Postgres + Mattermost in Docker
pnpm --filter @reissue/switch-coordinator setup:local
scripts/stack.sh restart
```

`setup:local` does the following:

- creates a personal registration key for the local admin
- registers `reissue`, `reissue-examiner` and `reissue-liaison` once, storing their keys in
  `.data/` (mode 600, git-ignored)
- creates the bridged rooms `shipment-ops`, `supplier-corrections` and `reissue-verification`
- creates a separate supplier person (`li.wei`) and adds them to the supplier room only
- turns follow-ups on, makes the liaison the supplier room's main agent, and writes the room ids
  and tool tokens into `.env`

Mattermost runs at http://localhost:8065. Sign in as `user` (operator) or `li.wei` (supplier).
The passwords are in `.data/switch/.env` and `.data/switch/supplier-account.json`.

## Path B: Slack and Telegram

These steps need your accounts. Credentials go into Switch Console, never into this repository.

1. **Switch Console 0.40+.** Install it from the Switch releases page
   (`switch-console-arm64.dmg` on Apple silicon). Choose **Add a server → Run a server on this
   computer**. A Console-run server has follow-ups and managed agents switched on.
2. **Slack.** Create a Slack app from the manifest on the Switch Slack page, then install it. Collect:
   - the `xoxb-` bot token
   - an `xapp-` app-level token with `connections:write`
   - the `T…` workspace id

   In Console, go to **Messaging apps → Connect → Slack**. Link your Slack account with
   **This is me**.
3. **Telegram.**
   1. In @BotFather, create a bot and turn **Group Privacy off** before adding it anywhere.
   2. In Console, go to **Messaging apps → Connect → Telegram** and enter the bot token and username.
   3. Create the supplier group by hand. Bots cannot create groups, so this step can't be automated.
   4. Add the bot to the group, post once, then link your Telegram account in Console.
   5. Invite the supplier's account to the group. Files sent into Telegram are capped at 20 MB.
      For anything bigger, Reissue replies with a secure upload link.
4. **Coordinator.**
   1. In the Gateway, go to **API Keys → Create Registration Key**.
   2. Set `SWITCH_BASE_URL` and `SWITCH_REGISTRATION_KEY` in `.env`.
   3. Run `pnpm --filter @reissue/switch-coordinator register`. This happens once, and the agent
      key is stored in `.data/coordinator-credentials.json`.
5. **Rooms and specialists.**
   - **Managed:** first add the Reissue MCP server to Claude Code's user config on the agent
     machine (see below). Then import `switch/template.yaml` in Console, pick the Slack
     connection and the Telegram group, and run it.
   - **Hosted:** create or choose the Slack channel and run `/invite @Agent Switch`. In the
     Telegram group, run `/invite_agent @reissue`. Then run
     `pnpm --filter @reissue/switch-coordinator connect-rooms --ops <slack room> --supplier <telegram room>`,
     which invites the specialists and writes the room ids into `.env`.
6. **Follow-ups in the supplier group.** Run `!follow-ups on` and `!assign-agent @reissue-liaison`.
   Telegram also lists them as `/follow_ups` and `/assign_agent`. Untagged supplier replies in a
   request thread then reach the liaison.
7. **Who may address whom.**
   - The examiner keeps the default "Me and my agents", so the coordinator can hand it work.
   - The liaison must hear the supplier. Either set **Custom rules** that allow the supplier's
     Telegram account in that room (preferred), or set **Anyone**. Even with **Anyone**, its tool
     token only reaches supplier-safe briefs.
   - Don't give the examiner **Anyone**.
8. Restart with `scripts/stack.sh restart`. Check `GET /v1/health`, where `coordinator` should
   report every room connection live.

### Reissue MCP server for managed agents

Each specialist sees only the tools its token unlocks.

```bash
claude mcp add --scope user --transport http reissue-examiner http://127.0.0.1:4210/mcp \
  --header "Authorization: Bearer $REISSUE_EXAMINER_TOOL_TOKEN"
```

Use the liaison token for the liaison's machine user or directory. Switch passes only a fixed set
of environment variables to managed agents, so put the token literally in the MCP config instead
of using a `${VAR}` reference.

## What Switch owns and what Reissue owns

| Switch | Reissue |
|---|---|
| Room membership, people and agent identities | Extracted facts with page and bbox evidence |
| Message routing, mentions, follow-ups, main agent | Case, issue and document state machines |
| Addressed handoffs (`send_targeted_message`) | Business payloads in fenced `reissue` blocks |
| Attachment storage and delivery, media routes | Immutable versions, hashes, packets |
| Room history (`read_context`) for gap recovery | Dedupe, outbox, reminders, escalation |

If you switch Switch off, Reissue can still parse a PDF uploaded in the Workbench. What stops is the
loop: nobody can open a case from chat, the supplier can't answer in the shared conversation,
and no handoff completes. Messages queued meanwhile stay `PENDING` in the outbox and go out once
the coordinator reconnects.
