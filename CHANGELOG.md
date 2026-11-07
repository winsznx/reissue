# Changelog

## 1.0.0 (2026-11-07)

First release, built for the Flip the Switch hackathon.

### The loop
- An operator drops a commercial invoice and packing list into Slack and mentions `@reissue`.
  The coordinator opens a case and posts the exact contradiction with page and row.
- The coordinator hands the evidence to `reissue-examiner` with Switch's `send_targeted_message`.
  The examiner verifies the cited rows with read-only evidence tools.
- `reissue-liaison` asks the supplier in their own Telegram group. Untagged replies reach it
  through Switch follow-ups and `!assign-agent`.
- The supplier's revised PDF triggers an automatic recheck. When every required check passes,
  the case is Ready for broker review and a ZIP lands in the Slack thread. The ZIP holds the
  unaltered current files, `correction-summary.pdf` and `document-index.csv`.

### Built in
- **Document worker.** It classifies documents, splits combined PDFs, extracts tables and fields
  with page, bbox and quote, falls back to OCR for scans, and reads XLSX packing data.
- **Deterministic reconciler.** It covers unit normalisation, SKU-first line matching, 12 rule
  types, root-cause grouping and the state machines for cases, issues and documents.
- **Durable jobs and messaging.** Jobs are idempotent and recover from restarts. Every message
  goes through an outbox and is delivered exactly once, and reminders and escalation are
  scheduled.
- **Workbench.** Document compare with evidence highlights, versions, a live timeline,
  decisions, downloads and curated scenarios, plus a public overview page at `/`.
- **Switch setup.** A local server with a Mattermost bridge, a gateway API path for real Slack
  and Telegram, a validated Console template, and a live verification script.

### Verified
- **Live on real Slack and Telegram.** On SHP-0290, the revised PDF reached Ready in 0.41 s and
  the ZIP was in Slack in 0.74 s. Details are in
  [docs/SPONSOR_BEHAVIOUR.md](docs/SPONSOR_BEHAVIOUR.md).
- **Tests.** Integration is 36 of 36 on real Postgres, Redis, S3 and the document worker. Unit
  suites cover the reconciler, adapter, artifacts, reply parsing and the document worker.

### Upstream
- A fix for Switch's Telegram adapter, retrying a timed-out attachment download:
  [sandbox-quantum/switch#1689](https://github.com/sandbox-quantum/switch/pull/1689).
