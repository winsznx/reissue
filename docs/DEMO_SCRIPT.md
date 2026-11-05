# Demo script

Target length is 2:00–2:40, recorded on the frozen build with real interactions. The operator and
the supplier are two real people in two connected chats. Nothing is pre-rendered. Speed-ups are
marked on screen.

## Before recording

- `scripts/stack.sh start`, then confirm `pnpm verify:switch` and `GET /v1/health` are green.
- Slack `#shipment-ops` and the Telegram supplier group are both connected, and the liaison is
  the main agent in the group.
- The Workbench is open at http://localhost:3210 in another window.
- The invoice and packing list are ready to drag in: `tests/fixtures/documents/invoice-v1.pdf`
  and `packing-list-v1.pdf`, labelled on screen "Controlled test modification: packing list
  line 3 changed to 480".
- The supplier's phone has Telegram open on the group, with `packing-list-v2.pdf` ready to send.
- For the reminder beat, start with `DEMO_TIMING_PROFILE=true`. Messages then show "Demo timing
  profile".

## Nine beats

| # | Time | On screen | Voice-over |
|---|---|---|---|
| 1 Person | 0:00 | Both PDFs side by side, quantities large: 500 pcs vs 480 pcs | "Dana runs imports for a small homeware company. Before this shipment can move, the broker needs papers that agree." |
| 2 Problem | 0:12 | The two rows highlighted, with a one-line quote from the r/CustomsBroker thread | "They don't agree. The packing list says 480 string lights, the invoice says 500. Chasing that by email takes days." |
| 3 Gap | 0:24 | A plain PDF diff tool showing the mismatch | "A checker can spot the number. Someone still has to get the supplier to fix it and collect the right file." |
| 4 Turn | 0:32 | Title card: Reissue | "Reissue gets the corrected paperwork back through your team's chat." |
| 5 Mechanism | 0:38 | Slack: Dana drops both PDFs and writes "@reissue check these". The ack, then the discrepancy with page and row, appear in the thread | "Dana just mentions Reissue. It opens a case, reads both files and points to the exact rows." |
| 6 Live proof | 0:58 | Slack thread: the targeted handoff to `@reissue-examiner` and its sourced review. Cut to Telegram: the request lands in the supplier group | "The coordinator hands the evidence to a separate examiner agent, using Switch's agent-to-agent message, then the liaison asks the supplier in their own Telegram group." |
| 7 Range | 1:20 | Telegram: the supplier types "Old packing list. We shipped 500; sending updated document." with no @, the liaison answers, then they attach v2. The Workbench, already open, flips to Rechecking then Ready, and the diff turns green | "No tagging needed. Switch follow-ups route the reply. The new file triggers a recheck without anyone asking." |
| 8 Why Switch | 1:48 | Split screen: Slack thread and Telegram thread with the same case code, plus the Switch Console room list | "Two chats, three agents, one conversation. Switch handles the rooms, the routing and the handoffs. Reissue keeps the facts and the files." |
| 9 Payoff | 2:05 | Slack: the READY message and the ZIP attachment. Open it: invoice v1, packing list v2, correction-summary.pdf. Then measured timings from docs/SPONSOR_BEHAVIOUR.md | "Dana gets the current supplier files, untouched, plus a one-page summary for the broker. From the supplier's file to a ready packet took under a second of processing." |

## Standards

- Show one frame where the input and the output change together: Telegram upload on the left,
  Workbench state flip on the right.
- If a beat is sped up, caption it "2× speed".
- Watch once with sound off and once audio only. The state has to be readable from the UI alone.
- Values have to be legible at phone size. Use the Workbench zoom on the highlighted rows.
