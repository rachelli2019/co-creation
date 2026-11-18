
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
