# SOAP note and transcription review v7

The completed visit note now uses Subjective, Objective, Assessment and Plan. It no longer embeds the pre-chart workspace scaffolding. Explicitly sectioned physician notes are organized without rewriting their clinical wording; reviewed dictation/transcript sources within a workspace are retained as encounter narrative, without assigning speaker roles. Vitals include the BP already recorded in the signed longitudinal/office context. Laboratories keep their values, units and any supplied dates. Missing history, ROS, examination, allergies and plan decisions are marked Not documented, with no invented normal findings or management.

Approved Astra content is assessment material, not an executed treatment plan. Only the selected encounter's approved narrative is used. A physician's explicitly documented plan and approved package items can populate Plan. All package orders remain simulated. Existing approved notes remain immutable. Existing drafts have an explicit Apply SOAP draft action: it keeps the source/generated content immutable, records the before/after change, preserves patient instructions, and retains any physician edits verbatim. No user package is silently reformatted during deployment.

## Recorded speech and review

Ambient transcription now has Record audio, local playback, Transcribe recording and Use recorded text for review. Clips are limited to five minutes and 8 MB. Recording alone does not upload anything. Explicit transcription sends the audio to OpenAI through audio-transcription-gated using the existing server-side OPENAI_API_KEY. The model is gpt-4o-transcribe with original-language transcription and token review hints; the request includes no chart diagnoses, patient identifiers or suggested patient-specific values. See the official [speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text) and [transcription API reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

Audio is retained only in the current browser tab for playback and is not saved to the app's database or Storage. This statement does not override the provider's retention policies. Discard recording clears the local clip but retains imported/reviewed text. Switching patients stops capture, discards the clip and cancels in-flight transcription. The endpoint verifies the actual clinician session, active synthetic office assignment and scribe.review permission before any provider request. It validates size, MIME and language, uses a bounded request/timeout and returns generic provider failures without exposing secrets or audio.

The legacy browser preview remains available. Final results are rebuilt from the current recognition session, avoiding duplicates on replay. Interim words are excluded on stop. Live recognition no longer rewrites the review draft or sends clinical observation proposals. Copying raw text preserves negations, numbers, repetitions and line breaks. Corrections remain until the clinician explicitly copies new raw text. Saving uses physician-reviewed wording for proposals and retains the raw source. No spoken-number arithmetic is performed; repeated, historical or comma-ambiguous numeric matches are not guessed. Observation proposals still require their separate physician gate.

## Verification and limits

Local suites exercise SOAP sections, source wording, BP fallback, missing-data behavior, approved items, source ownership and preserved edits. CI exercises the deployed completion handler through Postgres.js 3.4.7 and PostgreSQL, draft SOAP history/version checks and approved-note protection. DOM tests cover recording/playback, failed transcription retries, explicit import, raw/review provenance, repeated browser results, interim exclusion, review edits and patient switching.

The provider response and browser microphone are mocked in automated tests. These do not measure word error rate, medication/dose accuracy, noise/accent performance or multi-speaker attribution. No real patient audio is used. No claim of clinical reliability or perfect transcription is made. The next acceptance step is a short synthetic recording with known negations, medication names/doses, decimals and units, replayed against its transcript. Speaker roles are not inferred.

## Clinician steps

1. Refresh the preview. Open Visit completion for the current signed encounter.
2. For an existing draft, click Apply SOAP draft, review/fill the missing sections, then Save package draft. Approved packages remain fixed.
3. Open Pre-charting → Ambient transcription. Record a short synthetic conversation, stop, and replay.
4. Click Transcribe recording. Compare with playback, then Use recorded text for review.
5. Correct the review pane. Save reviewed transcript only after confirming wording, numbers, units and negations. Review any proposed observations separately before signing an encounter.
