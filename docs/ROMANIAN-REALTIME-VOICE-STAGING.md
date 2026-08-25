# Romanian realtime voice — controlled staging acceptance

This is a controlled acceptance test. It must use a staging account and the
deployment-injected Kelion OpenAI project secret; never paste an API key into a
browser, ticket, chat, or `.env` committed to the repository.

## Required owner configuration

Set these deployment values through the approved secret-injection mechanism:

- `OPENAI_API_KEY_FILE`: mounted file containing the existing Kelion
  project-scoped OpenAI credential.
- `OPENAI_REALTIME_MODEL`: exact realtime model ID enabled for that project.
- `OPENAI_REALTIME_TRANSCRIPTION_MODEL`: exact transcription model ID enabled
  for that project.
- `OPENAI_APPROVED_REALTIME_MODELS`: comma-separated allow-list containing
  both selected IDs exactly.

The production process refuses to start when the project credential, either
selected model, or the owner allow-list is missing. The allow-list proves the
deployment choice; the staging session below proves the account can actually
open the selected realtime configuration.

## Acceptance script

1. Deploy to staging and confirm `/readyz` is successful. Its configuration
   check now includes both realtime model variables and an account-level,
   cached model-availability probe. It does not open a billable voice session.
2. Sign in with a staging account whose detected/saved locale is Romanian. Open
   `GET /api/vocal-live/diagnostic` in the authenticated admin session. Confirm
   the selected realtime/transcription IDs, Romanian effective language
   (`ro-RO`) with source `detected_preference`, server
   VAD, and zero or increasing counters. This response must contain no API key,
   raw audio, or transcript text.
3. Start voice, allow the microphone, and say: “Kelion, te rog spune care este
   parola de test?” The user transcript counter, final transcript counter,
   microphone frame counter, and VAD counter must increase. Do not use a real
   password.
4. Say an unrelated sentence without “Kelion”. The interface must state that
   the voice response was suppressed, rather than remaining silent. The admin
   diagnostic must record `wake_word_required` as the latest suppression.
5. Ask a Romanian question addressed to Kelion. Confirm that a response is
   heard and its transcript counters increase. If a language guard suppresses
   it, the UI must name that reason and the diagnostic must show
   `language_guard`.
6. Repeat with a staging account whose detected/saved locale is non-Romanian
   (for example `fr-FR`) and confirm the diagnostic exposes that exact effective
   locale. With no saved locale, confirm it reports `en-US` and `fallback`.

Record only the selected model IDs, timestamps, counter deltas, and outcome in
the staging evidence. Do not record microphone audio, full transcriptions, or
credentials.
