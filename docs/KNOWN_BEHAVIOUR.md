# Known behaviour

These are the operating boundaries of the current build. Each was either seen in testing or is a
deliberate design choice.

## What counts as ready

- **Ready for broker review** means the current invoice and packing list passed every required
  internal consistency check. It isn't a customs decision. The Workbench, the chat message and
  `correction-summary.pdf` all say so.
- Only the deterministic recheck can mark a case ready. No agent message, supplier claim or
  Workbench action does. Even a human clarification only changes the inputs to the checks.

## Comparisons

- Cartons are never converted to pieces without a pack size. The pack size can come from the
  document itself (a "pcs/ctn" column) or from a recorded human statement with a source. Until
  then the check stays `NOT_COMPARABLE` and the case asks for the fact.
- Weights compare at the coarser precision the two documents declare. For example, 12.5 kg and
  12.50 kg match, and 12 kg matches 12.4 kg when one side prints whole kilograms. Weights in lb
  and g convert with exact factors.
- Gross weight is never compared with net weight, and package counts are only compared within the
  same package type.
- Rows pair by SKU first. Rows without a SKU pair by description similarity. A pair below 0.6
  similarity is never made, and one below 0.8 is flagged for a person to confirm.
- Party names compare after dropping legal-form suffixes such as Co., Ltd., B.V. and GmbH.
  Different trading names still count as a mismatch.

## Documents

- Classification reads content. The filename is only a hint. A file that isn't recognisably a
  shipment document is held as `QUARANTINED` and left out of the checks.
- A replacement whose invoice or PO reference contradicts the case is quarantined instead of
  applied.
- An older revision that arrives after a newer one is kept as history and does not replace it.
  The order comes from revision markers, then document dates, then arrival order.
- PDFs with JavaScript, launch actions or embedded files, and spreadsheets with macros, are stored
  but held for review rather than parsed.
- Spreadsheet evidence has no bounding box. The Workbench points to the sheet but can't highlight a
  cell.
- Scanned pages use Tesseract at 300 dpi. OCR bounding boxes were within 8 pt of the digital
  original on the test scan, which has 0.6° rotation and added noise. Heavily skewed or handwritten
  scans haven't been tested.

## Chat

- Switch merges a multi-file post into one message, so one post with two PDFs opens one case.
- A supplier message is linked to a case by reply thread first, then a case code in the text, then
  the only open request in that room. If two cases could match, Reissue asks which one and changes
  nothing.
- Telegram limits incoming files to 20 MB. Larger files get a reply with the Workbench upload link
  for that case.
- Switch's media upload has no target names. The packet ZIP is posted as an attachment in the case
  thread, and the completion message carries a signed download link (24 h for the chat link,
  15 min for links made in the Workbench).
- A self-hosted Switch server needs `follow_the_conversation` turned on (`scripts/switch-local.sh`
  does this). Servers run by Switch Console have it on by default.

## Agents

- The examiner and liaison are language-model agents. Their outputs are checked against schemas
  and can only do two things: flag an issue for a person when the examiner doesn't confirm it, and
  label supplier replies. A malformed result is retried once, then dropped, and the case continues
  on deterministic evidence.
- If the examiner doesn't answer within `REVIEW_TIMEOUT_SECONDS` (default 180), the supplier ask
  goes out anyway and the timeline records why. If the liaison doesn't post within
  `LIAISON_POST_TIMEOUT_SECONDS` (default 120), the coordinator posts the same supplier-safe text
  itself.
- Measured on this build: an examiner review (five turns, three tool calls) took 11.5–15.9 s and
  cost US$0.34–0.44 per case. A liaison reply took 6.8–11.0 s and cost US$0.24–0.34. Both run
  under the operator's own Claude Code sign-in.

## Operations

- If Switch is unreachable, outgoing messages stay `PENDING` and go out once each when the
  coordinator reconnects. Inbound messages that arrived meanwhile are replayed from the stored
  cursor, or recovered through `read_context` after a reported gap.
- A job that fails five times shows up as `JOB_FAILED` on the case and in Verification → Dead
  letters, where it can be retried.
- Local deployments run one workspace (`ten_default`). Every query is scoped by tenant, but there is
  no tenant administration UI.
