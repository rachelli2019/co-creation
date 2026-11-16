# Writing study

## Run locally

From this directory, run `npm install`, then `npm run dev -- --host 127.0.0.1`.
Open http://127.0.0.1:5173/ . No credentials are needed for the default local preview.

Local testing renders the same `StudyApp` as production: instructions → prompt → brainstorming → rough draft → final draft → survey → quiz → completion. Timers, word-count rules, AI-first editor lock, fullscreen checks, and attention checks are shared. Changes to these screens apply to both local testing and the deployed study.

The development-only toolbar selects the AI schedule, restarts the study, or explicitly jumps to the writing section for focused testing. Changing the schedule restarts the test. Local tests use an AI-DIV test participant, simulated AI replies, and no database reads/writes or participation-history updates. The completion page lets you inspect the test submission without submitting to Prolific. Reloading clears the test.

## Story task

For a quick UI walkthrough, check **Page through UI (skip waits and required answers)** in the local toolbar. Use **Preview: next screen** on the timed screens, then **Continue** through the survey. This freezes timers and bypasses required answers, word counts, focus, and fullscreen checks only in this local mode. Changing this option restarts the preview. Leave it unchecked to test normal study requirements.

The original 20-minute writing block is now two sections:

- **Rough draft:** 10 minutes, then automatically advances regardless of word count.
- **Final draft:** 10 minutes, beginning with the rough draft text. Existing word-count validation and the 3-minute correction grace period are retained. Participants can submit after 5 minutes in this section. AI access ends when the 10-minute timer ends, including during correction time.

Set `VITE_WRITING_AI_ACCESS` in `.env.local` (copy `.env.example`) to `rough`, `final`, `both`, or `neither`. The default is `both`. Restart the development server after changing it; production uses the value at build time. This is a study-wide setting for AI groups, not participant randomization. Existing SELF groups never receive AI. This setting controls local simulated preview only; the backend uses `STUDY_AI_ACCESS` and assigns AI-DIV.

With AI in both sections, rough-draft chat history carries into the final draft, both in the displayed conversation and in messages sent to the model. The 15-query limit remains shared. Saved phase transcripts contain only messages from their respective section; the combined transcript contains each message once. When AI is unavailable, its transcript and composer are hidden. Pending requests are aborted at the section boundary. The existing requirement to use AI before editing applies when AI first becomes available; the local preview follows this requirement too (using a simulated AI reply).

The final submission retains `final_text` and the combined `ai_transcript`. The existing JSON `attention_meta.writing` contains `roughDraft`, both completion timestamps, `aiAccess`, `phaseSeconds`, and separate `roughTranscript` / `finalTranscript` arrays. Existing periodic snapshots retain the `writing` phase for schema compatibility; use the rough completion timestamp to distinguish sections. The rough-draft boundary now also saves an immutable `study_records` row before the final timer starts. This requires the migration below. A failed save retains the artifact and offers Retry save. Database writes have not been verified without credentials.

## Private backend and deployment

The active app is the story study. The inherited product-pitch source is retained but is no longer exposed at `?task=2` because it uses the old browser database/AI integration.

Use `?preview=false` locally to test the actual backend. The default development preview remains simulated and does not save data. The participant study has no timer bypass or simulated model mode. A separately configured hosted walkthrough can enable these for UI review.

All production data and AI requests go through `/api/study` and `/api/recall`. Supabase browser access is revoked on all seven tables, with RLS enabled and no public policies. Anonymous Supabase sign-ins and account signup are disabled. Server secrets are in ignored `.env.local` locally and must be configured as server environment variables in Vercel. Do not add any secret with a `VITE_` prefix.

The new Supabase project is `co-creation-study` (`dcazrcrvcwwsrdekrioi`). `server/study-schema.sql` and `server/recall-schema.sql` were applied to this new project. They are initial migrations, not repeatable update scripts. Do not run them against the original labmate project.

- `STUDY_ENROLLMENT_OPEN=false` closes new enrollment; existing sessions may finish.
- `STUDY_MODE=walkthrough` with `VITE_HOSTED_PREVIEW=true` enables an invitation-gated UI walkthrough with simulated AI, fixed quiz questions, and timer skipping. It never calls the database or model provider. Only a signed walkthrough cookie can use its stateless sample quiz endpoint. The hosted walkthrough code is `preview-2026`; it is a demonstration gate, not a secret protecting participant data.
- `STUDY_MODE=test` requires `STUDY_INVITE_CODE`, labels records as tests, and never returns a Prolific completion link. Share an invitation separately or use a fragment link `https://HOST/#invite=CODE` (fragments are not sent in HTTP requests). Anyone with the code can enter, so keep Vercel deployment protection on for private lab testing.
- `STUDY_MODE=prolific` requires `PROLIFIC_API_TOKEN`, `PROLIFIC_STUDY_ID`, and your own `PROLIFIC_COMPLETION_CODE`. The backend verifies the Prolific submission is ACTIVE and matches participant and study. The study URL must include `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID` via Prolific placeholders. These checks do not make forwarded participant URLs safe to share.
- `STUDY_SESSION_SECRET` must be a random secret of at least 32 characters. The backend issues a two-hour signed, HttpOnly, SameSite cookie (Secure in deployment). Every action checks ownership, expiry, and revocation.
- `STUDY_AI_ACCESS` is the server-authoritative rough/final/both/neither schedule; the existing study group remains AI-DIV. Changing it affects new sessions only.
- The backend enforces phase-specific AI availability, 10-minute AI windows, and an atomic 15-call budget shared across drafts. Chat context is loaded from stored messages. `server/writing-prompt.mjs` contains the writing assistant prompt.

Deploy from `website` using Vercel. Configure server variables from `.env.example` in the preview environment, keep production enrollment closed, and verify Vercel Authentication protection before sharing. A Vercel-protected deployment is configured. Live AI verification still needs an OpenAI key. Set the credit-question bonus amount before recruiting participants.

## Post-task survey and story recall

Survey wording, scale labels, and ordering are in `src/surveyQuestions.ts`. The original two familiarity questions and strategy question appear first, followed by the supplied additional questions with duplicate items and sources removed. Questions about AI collaboration are omitted when the participant has no AI access. The credit question includes the reviewer-agreement bonus explanation in `src/PostTaskSurvey.tsx`; replace its `$[amount]` placeholder with the actual maximum before launch.

Submitting the final story starts one server-side model request while the participant completes the survey. The survey ends with Submit survey, which stores its answers before opening the separate Quiz. Five recall questions have four supplied/generated options plus None of the above. The quiz ends with Submit quiz and earns $0.10 per correct answer (up to $0.50); the score and bonus in cents are saved with the quiz responses. Answer keys stay on the server, which scores the responses. The prompt is editable in `server/recall-prompt.mjs`, or via the server-only `RECALL_PROMPT` environment variable (include `[STORY]`). The formatting instructions request central character, supporting character, setting, plot, and obstacle questions. The saved generation includes the prompt, model, story, answer key, and responses for analysis.

Before using live recall generation:

1. Apply `server/recall-schema.sql` (if `recall_generations` already exists, apply only the new `study_records` section) to the study's Supabase database.
2. Configure server-only `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, and server-only `SUPABASE_URL`. Never give the secret keys a `VITE_` prefix.
3. Deploy with Vercel's project root set to `website`, so `api/recall.mjs` is served alongside the app. `RECALL_MODEL` optionally changes the default model.

Local Vite serves the same endpoint. Preview defaults to clearly labelled example questions and no database writes. To test actual story-based generation locally, set `RECALL_PREVIEW_LIVE=true` and `OPENAI_API_KEY` in `.env.local`, then restart the server. This incurs API usage but still does not write to Supabase. Private database writes and denial of public access were verified using synthetic test records; live provider calls still need an OpenAI key.

The unique session record prevents duplicate production generations. Failed or interrupted generations show a contact-researcher message and do not silently retry the model call. Survey answers remain in the current page's memory; reloading the page does not restore them.

## Checks

`npm test` exercises recall generation, validation, scoring, and local/production isolation with mocked provider calls.

`npm run build` checks TypeScript and creates the production bundle. `npm run lint` runs the repository's existing lint rules. For quick automatic timer checks, set `VITE_FAST_PREVIEW=true` locally; production always uses full timing.

Step 1 starts blank, with no copy/paste buttons. The local writing screens use a sample beach-trip outline when the brainstorm is empty, including when entering from Step 1. Test writing section directly also uses that sample. Use standard Ctrl/Cmd+C and Ctrl/Cmd+V shortcuts to copy and paste; redundant clipboard buttons are omitted. Add draft/outline to prompt appends text without sending; Add to draft appends an AI response without replacing existing writing. The AI receives an outline only when the participant includes it in a message. Sending a chat message no longer requires confirmation.

Survey version 4 uses phase-specific strategy questions. Both-drafts participants answer 3a (rough) and 3b (final); rough-only and final-only participants answer question 3 for their respective phase with identical wording. Answers use `ai_strategy_rough` and `ai_strategy_final` across conditions for comparison. Subsequent question numbers are unchanged.

Survey version 5 standardizes all Likert items to 1–5 and removes former questions 10 (ai_literacy_5), 26 (exploration), and 27 (expression). Remaining item IDs are preserved and displayed questions are renumbered consecutively, retaining 3a/3b for both-drafts participants. The separate credit rating remains 0–100.

Survey version 6 replaces questions 23 and 24 with the supplied concern/excitement and creativity-impact questions. These use three categorical choices, saved as the selected text under `concernExcitement` and `creativityImpact`; they are not numeric Likert scales.

Survey version 7 adds the supplied eight Creative Writing experience statements on a final survey page. Participants select all applicable items; item 0 is exclusive. Selections are stored as an array of original item indices (0–7) under `creative_writing_experience`, without computing a scale score. The source’s Humor skip instruction and unexplained asterisk are omitted. These items describe experience/achievements rather than confidence in future writing ability.

Survey version 8 removes the former question 5 (`writing_ability`, the creative writing ability rating). Remaining questions are renumbered automatically, and the Creative Writing experience checklist remains.

Survey version 9 replaces former questions 10–15 (planning, monitoring, evaluation, creative_control, ai_agency, ownership) with the supplied 11 CAIM items (`caim_p1`–`caim_p4`, `caim_m1`–`caim_m4`, `caim_e1`–`caim_e3`). This page uses a 1–7 agreement scale as requested; other Likert pages remain 1–5. The general-use wording is shown in all conditions, with no participant-facing subscale labels.

Survey version 10 retains only `caim_p1`–`caim_p4` and `caim_m1`–`caim_m2`, with their wording unchanged. The CAIM subset now uses the same 1–5 agreement labels as other agreement items. Remaining questions are renumbered automatically.

Survey version 11 replaces questions 16–18 with outcome-preference mismatch, preferred-action rejection, and outcome mismatch statements, retaining the 1–5 agreement scale. New answer IDs are `outcome_preference_mismatch`, `preferred_action_rejection`, and `outcome_mismatch`; higher responses now indicate disagreement with the assistant or mismatch rather than positive alignment.

Survey version 12 removes former questions 16 and 17 (`outcome_preference_mismatch`, `preferred_action_rejection`), retaining `outcome_mismatch`. Credit anchors now read 0 = You deserve none of the credit and 100 = You deserve all the credit, with none/all bold. The chat’s remaining-query counter is hidden; the existing shared query limit remains enforced.

Survey version 13 changes the outcome item to “The outcome matched what I had aimed for in this task.” It is saved under `outcome_match` to distinguish its positive direction from the former `outcome_mismatch` item. The 1–5 agreement scale is unchanged.

### Backend verification

`node tests/live-smoke.mjs` explicitly creates synthetic TEST records in the configured database, exercises all stage submissions and immutable scoring, verifies all seven tables deny public reads, and mocks both model responses (no charges). It retains the synthetic records for inspection. `npm test` runs the offline security/recall tests. The live test passed on the new project.

Reloading does not restore in-progress editor or survey contents. Keep the study tab open through completion; resume/recovery behavior needs a dedicated implementation before a larger participant pilot.

### Hosted walkthrough (verified October 27, 2026)

The simulated preview is deployed at `https://co-creation-study-jy5sjgalp-rachel-research.vercel.app`. Use the Vercel shareable link delivered in the chat for external reviewers, then enter `preview-2026`. It is scoped to this walkthrough deployment; other deployments retain Vercel authentication. Verified without a Vercel login: entry, sample quiz, and sample scoring. Browser verification covered simulated chat, draft transitions, all survey pages, quiz, and completion. No database writes or model calls occur in walkthrough mode. Redeploying creates a new deployment URL; update/recreate the scoped share link when sharing new changes.

Survey version 14 replaces the former creative-writing achievement checklist (question 22) with three items: creative_writing_comfort (1–5 agreement), creative_writing_experience_frequency (five ordered single-choice responses), and creative_writing_courses (three single-choice responses). These appear as questions 22–24 in AI conditions; the supplied definition of creative writing appears beneath the experience question. New IDs preserve the distinction from the former checklist data.

Survey version 15 replaces former questions 17–19 (`trust_1`–`trust_3`) with eight supplied AI-writing capability and willingness items, displayed as questions 17–24 in AI conditions. All use 1 (Strongly disagree) to 5 (Strongly agree). Responses are stored raw under `ai_writing_capability_1`–`ai_writing_capability_4` and `ai_writing_willingness_1`–`ai_writing_willingness_4`. Willingness items 1 and 3 are reverse-coded for analysis (6 minus the raw response); no scores are computed or reversed during collection. Reverse-coding notes and construct labels are not displayed to participants. The existing AI-only visibility is retained. Subsequent questions are automatically renumbered 25–29.

Survey version 16 standardizes task-specific references to “AI writing assistant” in the strategy, credit, and CAIM items and writing-familiarity question, as well as the study instructions and chat UI. General AI familiarity, general AI literacy, and the Pew-style questions retain their broader AI wording. Answer IDs and response scales are unchanged.

Survey version 17 restores the source wording (“AI”) in the six CAIM items (caim_p1–caim_p4 and caim_m1–caim_m2). Their answer IDs and 1–5 agreement scale remain unchanged.

Survey version 18 replaces the eight trust items with the six supplied statements referring to “the AI writing assistant.” The four capability IDs and first two willingness IDs are retained; willingness items 3 and 4 are removed. The items appear as questions 17–22 in AI conditions and retain the 1–5 agreement scale. Only willingness item 1 is reverse-coded for analysis; raw answers are stored. Subsequent questions are renumbered automatically (23–27).

## GitHub deployments

Vercel project `co-creation-study` is connected to `rachelli2019/co-creation`, with `website` as its root directory. Pushes to `main` create Preview deployments; `codex/study-release` is the Production branch. Update the release branch only when intentionally releasing the participant study.

The OpenAI key is configured server-side for Production and for Preview on `main`. Other preview branches do not inherit that branch-specific key. The shared Preview is still configured as a simulated walkthrough; adding a key alone does not enable real model calls or database writes. Real-backend testing requires a separate configuration step.
