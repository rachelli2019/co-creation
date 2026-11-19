
### Live preview and data cohorts

Apply `data-kind-schema.sql` after `random-noun-schema.sql`.
`STUDY_MODE=preview` enables real AI/storage with page-through controls and no invitation.
Use `?condition=rough`, `final`, `both`, or `random-noun`; the preview dropdown starts a new session when changed.
`STUDY_MODE=test` with `STUDY_DATA_KIND=pilot` is the timed lab pilot. Omit that label for technical tests.
`STUDY_MODE=prolific` assigns `main` after Prolific verification.

The server stores `sessions.data_kind` as `preview`, `pilot`, `test`, or `main`.
Join other data tables by `session_id` to filter exports. Client input cannot select the label.
Legacy non-main records remain `test`; their original purpose cannot be reliably inferred.
Preview noun allocation is separate from pilot and main noun pools. Only previews skip duration checks.

### Interaction timeline (logging version 1)

Apply `interaction-schema.sql` before deploying interaction logging. `interaction_events`
contains draft/chat keydown and keyup, text-edit deltas, selections, focus, visibility,
shortcut clicks, chat submissions, response-display markers, and phase checkpoints.
Only the rough/final writing interface is instrumented. No document-wide keystrokes
outside those two textareas are recorded. Snapshots remain in `snapshots`.

Use `(session_id, stream_id, sequence)` for exact ordering within a page load.
`elapsed_ms` is monotonic time since that page loaded; `client_at` spans reloads
(subject to the participant's clock). `received_at` is upload time, not action time.
A reload creates a new stream. Simultaneous tabs have separate streams; do not infer
an exact cross-tab order from wall-clock timestamps alone. Event IDs deduplicate retries.
Pending events are backed up locally until acknowledged; a browser closed permanently
before successful upload can still lose events. Sequence gaps and checkpoints aid audits.

Edit offsets are UTF-16 code units (JavaScript textarea positions). Replay each
`edit` by replacing `deleted.length` characters at `start` with `inserted`.
Checkpoints provide full text on each phase mount. Native edit metadata records
input type/composition and prior selection where supplied by the browser; application
edits include shortcut insertions and prompt clearing. Keyboard events and text edits
are different event types: do not count both as characters produced.

`chat_response_displayed.payload.requestNumber` links to `ai_requests.request_number`
within the same session. `ai_requests.response_at` is the server completion time;
the browser display marker is recorded in an animation-frame callback after the
response is put into chat state. It indicates presentation timing, not proof of reading.
`Add to draft` shortcut events carry the same request number for newly logged replies.
Inspect subsequent events to describe behavior following that response; temporal
ordering alone does not establish causality.

Example timeline export (replace the session UUID):

```sql
select e.*, s.data_kind, s.condition, s.assigned_noun
from public.interaction_events e
join public.sessions s on s.id=e.session_id
where e.session_id='00000000-0000-0000-0000-000000000000'
order by e.client_at,e.stream_id,e.sequence;
```
