# Synthetic encounter workflow

This workflow is available only for active, assigned synthetic patients after a
clinician signs in. The new `ehr.synthetic_encounter` table stores a versioned draft,
note text, a snapshot of source text/metadata, the reviewing clinician, and the final
Patient State version. File attachments remain in the browser; the draft stores their
names and metadata, not bytes. Do not enter real patient information.

## Clinician sequence

1. Open an assigned synthetic patient and the **Pre-charting workspace**. Add text,
   dictation, or other synthetic sources, organize the note, and click **Save encounter
   draft**. The saved draft and sources survive a page reload.
2. Record or paste a synthetic ambient transcript containing discrete values. The
   proposals are attached to the saved encounter. They do not change Patient State.
3. In the **Physician review queue**, accept, edit, or reject each proposed value.
   Accepted values create final clinical observations and run the Patient State reducer
   inside one transaction. Rejected proposals do not update Patient State.
4. Review the note, then click **Sign reviewed encounter**. This saves the latest note
   and requires a source, no pending proposals, at least one accepted observation,
   and a Patient State version newer than the draft's starting version. The signed
   record points to a provenance entry and a physician event; Activity / Audit shows
   the note, source count, decision event, accepted observation, and state version.

The function checks the Supabase Auth session, the linked synthetic clinician, active
practice membership, patient assignment, and `encounter.draft`/`encounter.sign`
permissions. Stale draft versions return 409 and require a refresh. The table is in a
private schema, has RLS enabled, and grants no direct `anon` or `authenticated` access.
No external order placement or real EHR write is available.

## Deployment and verification

The schema SQL is `supabase/sql/synthetic-encounter-workflow.sql`. The protected
`synthetic-encounter-gated` function and encounter-aware scribe writer/review/audit
functions are staged on the synthetic development project. The browser UI is
published at the `/preview/` path with matching root and preview assets. Run
`node scripts/encounter-workflow-tests.mjs`, `node scripts/scribe-review-safety-tests.mjs`,
and `node scripts/harness-contract-tests.mjs`.

Mock tests and schema checks passed; a live end-to-end browser review with a private
clinician password must still be completed before declaring the workflow validated.
