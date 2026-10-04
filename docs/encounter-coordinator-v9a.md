# Encounter coordinator v9A

Status: deployed for synthetic testing on October 4, 2026. The private migration and authenticated coordinator endpoint are active; the enabled preview completed its Pages deployment. Synthetic patients only.

The main patient view now reuses the existing ambient/dictation capture controls and presents one linked physician review packet. Stopping recorded capture starts the existing approved transcription endpoint, then places the result in the review text area when that area has no physician correction. The physician corrects and saves the transcript. That save persists the source and automatically starts preparation; typed physician sources and dictation use the same preparation trigger. Initial patient selection assembles chart context. The normal path no longer requires opening separate note, Astra and completion views.

This is the first architecture increment. It still requires an explicit reviewed-transcript save before documentation preparation. The broader design target of automatic provisional transcript capture followed by only one final approval is not fully implemented here. Browser speech preview keeps its existing capture behavior. Guideline retrieval, new clinical extraction, automatic order/instruction specialists and phone alerts are not enabled in v9A.

## Preparation and review

`encounter-coordinator-gated` authenticates the actual clinician session and assigned synthetic patient. Private preparation records preserve the encounter/source version, clinical State version, SHA-256 source binding, physician template preferences, generation outcome, immutable review packet and expiry. Identical current source/preferences reuse the preparation rather than call the model twice. Model generation uses the same bounded, fact-grounded v8 request and quote validation, outside the clinical write transaction. Only reviewed text and minimal chart context reach the provider; raw audio/transcript provenance remains excluded from the note-generation input.

The screen displays the note, editable instructions, source evidence and any already-existing pending encounter-linked observations/narratives. Proposed observations have visible include/edit/exclude choices; no new automatic extraction capability is introduced. Previously proposed legacy internal tools are visibly excluded and their rejection is recorded at finalization; those tools are not executed through this endpoint. Orders remain simulated and automatic order drafting is a later capability. The initial instruction text states that patient-specific instructions are not documented and remains editable, rather than inventing care directions.

Physician review edits autosave to append-only private revisions without signing or changing Patient State. Reopening restores saved edits. Regeneration preserves physician edits and exposes the refreshed generated note for comparison. Another tab's saved edit invalidates an old review version. Local empty/invalid edits cannot be finalized; autosave failure retains the visible text and blocks finalization.

The UI scopes its requests and displayed content by patient and clinician account. A patient change stops existing microphones through the prior capture lifecycle, clears the displayed packet, and ignores late results from the previous patient. Audio remains local except for the approved transcription request, and is discarded by the existing reload/patient-switch lifecycle.

## One transaction

Explicit **Finalize reviewed encounter** checks active identity, role, patient assignment and action permissions again inside the write transaction. It verifies the current encounter version, source/State/queue hash, immutable packet hash, expiry, current physician edit revision and complete item decisions. It applies selected existing observations/narrative reviews, records explicit legacy tool exclusions, runs the actual patient reducer, freezes the signed note and State, creates an approved simulated completion package and its history, and writes an immutable approval receipt in one transaction.

A clean encounter gets its own frozen audit snapshot even when no new clinical observation is accepted. No fabricated lab is needed. Failure at any stage rolls back clinical decisions, signature, completion, events and receipt together. The existing v4/v5 endpoints and approved-note immutability remain available for history/specialist inspection.

Receipts bind the clinician, patient, encounter, preparation, packet hash, exact reviewed content/decisions, edit revision and idempotency key. A repeated identical approval returns the existing receipt. Reusing a key for changed content fails. Source changes, expired packets, assignment revocation and stale review edits block new approval.

Preparation statuses survive reload. The provider request executes in the request handler with a persisted run; this increment has no independent durable worker. A request interrupted before committing its result does not become a successful packet. A preparing run older than two minutes can be superseded and retried on reopening. A lost finalization response can be retried with the same idempotency key while that browser retains it; reloading displays the persisted finalized receipt.

## Validation and remaining limits

The real-driver suite uses PostgreSQL 17 and the deployed Postgres.js 3.4.7, the actual v9 migration, SQL handlers, patient reducer and audit trigger. It tests preparation idempotency/read-only clinical behavior, durable edits, empty-observation visits, numeric observation edits, ownership/assignment, post-provider source/permission races, stale packets, expiry, replay and a deliberately induced late completion failure to prove rollback. DOM tests exercise main-view capture, automatic preparation, inline decisions, saved edit reload, explicit finalization and patient-switch isolation. Provider output is mocked; these tests do not establish transcription fidelity or clinical note accuracy.

A clinician must evaluate actual synthetic recordings and generated notes in the deployed preview. No real PHI, real prescriptions/lab release, guideline-derived new care, patient-message dispatch or cellphone delivery is introduced. Phone provider/verified recipient configuration belongs to v9C. There is no notification outbox or delivery claim in this increment. Full specification: `docs/agent-led-encounter-v9.md`.

## Deployment record

- Preview: https://kidneycareclinic-star.github.io/mel-test/preview/
- Preview commit: `041ac4d2a7879dcc744743d910860e340f1cf80c`; Pages run `37243164512` succeeded.
- Coordinator: `encounter-coordinator-gated`, JWT gateway enabled with additional verified clinician/assignment checks. Six deployed source files were compared with the prepared source.
- Migration: `encounter_coordinator_v9a`; all three new tables have RLS enabled and no anonymous/authenticated direct read/write grants.
- Runtime validation: contract and real PostgreSQL/DOM jobs passed in run `37243001509`. The automatic transcription handoff test also passed. Provider responses and browser capture are mocked in CI.
- Deployment verification found no changes to existing encounter/completion content hashes or the 30 existing Patient State snapshots; no clinical encounter was signed by deployment.
- There was no signed-in clinician generation or physical microphone trial in this environment. Actual synthetic conversation fidelity and clinical output still require physician evaluation in the preview.

To try the normal path, select a synthetic patient, use Ambient and Record and transcribe, stop, correct and save the reviewed transcript, review/edit the automatically prepared packet, and choose Finalize reviewed encounter. The exact signed note and approved instructions remain visible in the main patient view. Previous signed encounters remain accessible under Saved pre-charting text and prior encounter.
