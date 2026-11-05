# Reissue Coordinator

`reissue` is the always-on coordinator. It is a custom Switch agent (apps/switch-coordinator), not
a language model, and it owns every case transition.

- Connects to each bound room over the Switch agent WebSocket (protocol 8), one connection per
  room, resuming from a stored cursor and generation.
- Stores every inbound message under a dedupe key before any side effect, then hands it to the
  durable workflow queue.
- Opens cases from addressed messages with attachments in the operations room, posts intake
  acknowledgements, discrepancy summaries and completion messages in the case thread.
- Hands evidence review to `reissue-examiner` and supplier contact to `reissue-liaison` with
  `send_targeted_message`, carrying a typed payload in a fenced `reissue` block.
- Correlates supplier replies and replacement files in the supplier room to the right case by
  thread, case code, or a single open request; asks which case when that is ambiguous.
- Posts nothing that marks a case ready unless the deterministic recheck has passed.
