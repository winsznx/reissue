# Sources

## The problem

- r/CustomsBroker, 14 Jan 2026: a small EU importer compares invoices and packing lists by hand,
  sees quantities, weights and descriptions disagree because sales and warehouse data live in
  separate systems, and chases suppliers for corrected PDFs after brokers flag them.
  https://www.reddit.com/r/CustomsBroker/comments/1qcj9sz/anyone_else_constantly_dealing_with_invoice_vs/
- r/supplychain, 28 Mar 2026: suppliers send mismarked shipping documents, and teams verify them
  again and again. One reply recommends standard source templates.
  https://www.reddit.com/r/supplychain/comments/1s5o5dl/how_to_handle_suppliers_sending_low_quality/

Not every team has this problem. Teams running a single ERP may see few mismatches. Reissue is for
small teams whose documents come out of separate systems and get handed between people.

## Existing products

Reissue doesn't claim that document comparison or supplier follow-up is new.

- Digicust AI Document Control already compares documents and automates supplier correction
  emails: https://digicust.com/en/solutions/ai-document-control/
- FreightParse processes commercial invoices and packing lists for customs work:
  https://freightparse.com/en/invoice-to-customs-declaration/
- FreightProof checks freight documents before filing: https://getfreightproof.com/

Reissue's angle is narrower. It runs the correction where the team already works, as Switch agents
in the operations chat and the supplier's own Telegram group, and it ends with the corrected
current documents rather than a report.

## Switch

- Changelog (0.30.0 Telegram, 0.31.0 follow-ups and agent-to-agent messages, Console 0.40.0
  managed agents): https://docs.switchagents.ai/switch-rooms/resources/changelog
- Agent protocol: https://docs.switchagents.ai/switch-rooms/internals/agent-protocol
- WebSocket connection: https://docs.switchagents.ai/switch-rooms/internals/agent-connection
- Events and attachments: https://docs.switchagents.ai/switch-rooms/internals/agent-events
- Telegram: https://docs.switchagents.ai/switch-rooms/deploy/messaging-apps/telegram
- Slack: https://docs.switchagents.ai/switch-rooms/deploy/messaging-apps/slack
- Follow-ups: https://docs.switchagents.ai/switch-rooms/using/work-in-a-room
- Rooms, links and participants: https://docs.switchagents.ai/switch-rooms/administer/rooms
- Template language: https://github.com/sandbox-quantum/switch/blob/main/docs/TEMPLATES.md
- Source, release `switch-v0.31.0`: https://github.com/sandbox-quantum/switch

Field names, close codes and media routes in `packages/switch-adapter` came from the released
0.31.0 source and were then confirmed against a running 0.31.0 server (`GET /agents/{id}/ops`, live
WebSocket frames, media download and upload).

## Hackathon

- https://www.wemakedevs.org/hackathons/switch
- https://www.devtoolsacademy.com/hackathons/flip-the-switch

## Test documents

Everything in `tests/fixtures/documents/` is a generated, fictional shipment. Each page is stamped
"Controlled test document — Reissue fixture", and `tests/fixtures/README.md` lists the controlled
change in every file. `pnpm samples:fetch` downloads the public sample documents listed in
`tests/fixtures/public-samples.json` and checks each one against its recorded SHA-256 before use.
Those files are not redistributed in this repository.
