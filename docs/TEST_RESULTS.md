# Test results

These runs were on 2026-11-05, with the Slack and Telegram run and its regression tests added on
2026-11-07, all against the build at the head of `main`. The numbers are counts from actual runs.
Where something wasn't tested, this file says so.

## Software

| Component | Version |
|---|---|
| Node.js / pnpm | 24.19.0 / 12.16.1 |
| Python (document worker) | 3.12.14 |
| Tesseract | 5.5.4 |
| PostgreSQL / Redis / SeaweedFS (S3) | 16.15 / 7.4.11 / 4.48 |
| Switch server | switch-core 0.31.0, self-hosted. Mattermost 11.9.0 bridge, plus Slack (Socket Mode) and Telegram (bot polling) on 2026-11-07 |
| Specialist agents | Claude Code 2.1.311, headless, the CLI's default model |
| Workbench | Next.js 16.4.5, React 19.3, Playwright Chromium |

## Automated suites

| Suite | Command | Result |
|---|---|---|
| Reconciler, state machines, versioning | `pnpm --filter @reissue/core test` | 38 / 38 passed |
| Switch WebSocket client, null message bodies | `pnpm --filter @reissue/switch-adapter test` | 7 / 7 |
| Packet, index, summary PDF | `pnpm --filter @reissue/artifacts test` | 7 / 7 |
| Supplier reply and pack-size parsing | `pnpm --filter @reissue/ai test` | 13 / 13 |
| File screening, supplier-safe text | `pnpm --filter @reissue/workflows test` | 9 / 9 |
| Document worker (classification, extraction, OCR, XLSX, limits, model gap-fill with a mocked CLI) | `pnpm --filter @reissue/document-worker test` | 135 / 135 |
| Integration on real Postgres, Redis, S3 and the document worker | `pnpm test:integration` | 36 / 36 |
| Workbench in Chromium | `pnpm --filter @reissue/web test:e2e` | 9 / 9 |
| Typecheck, lint, production build in all 14 packages | `npx turbo run typecheck lint build` | 40 / 40 tasks |

### What the integration suite covers

| Scenario ID | Covered by | Outcome |
|---|---|---|
| E2E-01 500 vs 480 | correction-loop › quantity correction | Mismatch with page and row on both sides. One supplier-safe request with no prices or links |
| E2E-02 untagged reply in thread | inbound › natural reply | Reply tied to the case, classified `DOCUMENT_OUTDATED`, stated 500, issue `ANSWER_RECEIVED` |
| E2E-03 revised file fixes it | correction-loop | Automatic recheck, epoch 2, `READY_FOR_BROKER_REVIEW`, packet built |
| E2E-04 revision still wrong | correction-loop › still wrong | Stays waiting. One focused follow-up in the same supplier thread |
| E2E-05 reordered rows | document intelligence | Ready, no false discrepancy |
| E2E-06 image-only packing list | document intelligence | OCR evidence (`parser: ocr`, bbox) and the mismatch found |
| E2E-07 / 08 cartons vs pieces | document intelligence, inbound › stated pack size | `NOT_COMPARABLE` until a sourced factor arrives, then 100 = 100 and ready |
| E2E-09 two files, one post | correction-loop | One case, two versions |
| E2E-10 duplicate delivery | inbound › duplicated delivery | Second row refused by the unique key. Re-processing is a no-op |
| E2E-11 restart during recheck | versions › reconcile trigger, plus the live restart runs below | A committed trigger isn't re-run. One ops update, one READY |
| E2E-12 two open shipments | inbound › asks which case | Asks with both case codes. Nothing attached |
| E2E-13 old file after a newer one | versions › stale | Newer stays current, older kept as history, still ready |
| E2E-14 hostile document text | document intelligence | Same result as the clean document. Injected text never reaches a message |
| E2E-15 supplier reaching internal data | API access boundaries | Liaison token sees two supplier-safe tools only. The evidence tool is refused |
| E2E-16 Switch down | Switch outage | Message stays `PENDING`, then is delivered exactly once |
| E2E-17 packet hashes | correction-loop | ZIP entries are byte-identical to the stored source bytes and the fixtures |
| E2E-18 reminder after resolution | correction-loop, reminders | No reminder. One per step while unanswered, one escalation |
| Supplier room moved to another chat | inbound › room bindings after a rebind | The room set in config wins over the binding it replaced |
| Retention, signed links, room safety, combined PDF, misleading filename, XLSX, PNG, quarantine of foreign references, dropped attachments | various | All pass |

## Curated scenarios through the API

`pnpm scenario` runs each scenario and its scripted follow-up steps through the HTTP API with the
real worker and document worker.

| Scenario | Steps | Result |
|---|---|---|
| quantity-correction | start, revised packing list | 2 / 2 passed |
| reordered-lines | start | 1 / 1 |
| scanned-packing-list | start | 1 / 1 |
| stale-replacement | start, older file arrives late | 2 / 2 |
| new-mismatch-in-replacement | start, revision 3 | 2 / 2 |
| carton-conversion | start, sourced pack size | 2 / 2 |

Across all scenario runs recorded today (`GET /v1/verification/runs`), 34 of 34 finished runs
passed. The very first carton-conversion run was scored against the wrong expected state
(`WAITING_ON_SUPPLIER`). The system had correctly stopped at `NEEDS_CLARIFICATION`, because a
pack size is a fact a person has to supply. The expectation was corrected and the run re-scored.
A step took 1.2–2.9 s from request to settled state.

## Live Switch runs

`pnpm test:live` drives the real Switch 0.31.0 server through two real Mattermost accounts. The
people's actions are scripted. Raw results are in `tests/scenario-runs/`.

| Variant | Runs | Passed | Notes |
|---|---|---|---|
| clean | 4 | 4 | One READY and one packet each |
| still-wrong | 1 | 1 | Focused follow-up 545 ms after the wrong revision |
| worker-restart | 2 | 2 | Exactly one READY in both. Recovery took 152 s with the old 120 s job lock and 2.3 s after shortening it |

### Slack and Telegram

On 2026-11-07 the server was connected to a real Slack workspace and a real Telegram group. One
person played both roles on two real accounts, and nothing was scripted.

| Case | Result |
|---|---|
| SHP-0286 | Stopped after the examiner. The supplier handoff named the old Mattermost room. Fixed the same morning, with a regression test |
| SHP-0287 | Full loop. Slack upload, examiner review, request in the Telegram group, untagged reply and revised PDF in Telegram, then READY and the ZIP in the Slack thread. From the supplier's PDF to the ZIP in Slack took 0.75 s |

Timings per Switch primitive are in [SPONSOR_BEHAVIOUR.md](SPONSOR_BEHAVIOUR.md). In the last clean
run the examiner result came 112 s after the handoff. The review itself took 14.8 s, and the rest
was queueing behind four reviews the scenario run had just triggered. Handoffs now run three at a
time, and a follow-up burst of three cases finished all three reviews within 5 s of each other.

These manual live checks were also done in the Mattermost rooms:

- "check the documents I posted above" on files posted without a mention opened one case, and
  asking again didn't open a second one
- a 22 MB attachment that the bridge dropped got the case's upload link
- untagged supplier replies reached the liaison through follow-ups and `!assign-agent`
- reminders on the labelled demo timing profile (SHP-0285, supplier left silent): request at
  01:49:53, reminder 1 at 01:51:53, reminder 2 at 01:53:53, escalation to the operations room at
  01:56:53. Each fired exactly once, and cases on the standard profile got none

## Detection on controlled documents

There are 13 controlled document pairs with a known answer (`tests/fixtures/README.md`), checked
through the integration suite and scenarios:

| | Count |
|---|---|
| Pairs with a planted discrepancy, detected | 10 / 10 (v1 pair, scan PDF, scan PNG, XLSX, combined PDF, misleading filename, hostile text, still-wrong v2, v3 weight, cartons as not-comparable) |
| Pairs with no discrepancy, reported clean | 3 / 3 (reordered, v2, stale history) |
| False alerts | 0 |
| Misses | 0 |

These are generated documents. The numbers show the pipeline is correct on known inputs. They
don't show accuracy on arbitrary supplier paperwork.

## Real public documents

`pnpm samples:fetch --extract` covers 8 public samples, fetched and hash-checked at build time and
not redistributed. They have no matched invoice and packing-list pair, so reconciliation accuracy
can't be measured on them. Classification and extraction are:

| Sample | Kind | Classified | Fields | Line items | Required still missing |
|---|---|---|---|---|---|
| GLS Belgium example invoice | filled | Commercial invoice | 12 | 3 | seller |
| Cleverence packing list example | filled | Packing list | 6 | 3 | none |
| Flexport annotated commercial invoice | filled | Commercial invoice | 5 | 3 | seller (6 / 3 / none with `EXTRACTION_MODEL_PROVIDER=claude_code`) |
| Flexport blank commercial invoice | blank form | Commercial invoice | 0 | 0 | all (correct for a blank form) |
| Flexport blank packing list | blank form | Packing list | 0 | 0 | totals |
| CBSA CI1 Canada customs invoice | blank form | Commercial invoice (0.7) | 0 | 0 | all |
| JSE bill of lading sample | blank form | Bill of lading | 0 | 0 | not applicable |
| Sea-Cargo bill of lading 2017 | blank form | Bill of lading | 0 | 0 | not applicable |

Before the extraction work on 2026-11-05, the three filled samples gave 2, 0 and 0 fields and no
line items. Every value now extracted matches the printed document. Model-proposed values are kept
only when they appear verbatim on the page. That was 2 values in this run, and none were dropped.

## Not yet done

- **Telegram's 20 MB limit.** A file too big for the bridge got the case's upload link on
  Mattermost. That path hasn't been tried with a file over 20 MB on Telegram itself.
- **Console-managed specialists.** `switch/template.yaml` passed `save_template` validation. The
  managed agents themselves weren't run, because that needs Switch Console on this machine. The
  runs above used the hosted agent runtime.
- **Manual baseline.** A person comparing and chasing the same documents by hand hasn't been
  timed, so no time saving is claimed.
