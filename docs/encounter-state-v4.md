# Encounter State v4

When a physician edits a Scribe observation, the saved lab value and the reloaded Scribe summary must both show the reviewed value. The original extraction remains in proposal history. Astra narrative now enters the encounter review queue and becomes authoritative only after acceptance or edited acceptance.

The build adds JSONB runtime validation, a patient lock before write transactions, immutable before/after audit snapshots, source-version checks, and a signed encounter view pinned to its final state version. Rejection records a decision without creating a state version. A pending narrative or encounter-linked action prevents signing. Unrelated clinical changes make Astra decisions stale; the two decisions from the same Astra run can be made in either order.

## Status

Implementation and local tests are complete. The user explicitly approved public patch/PR publication, the development migration, all six function deployments, preview publication and live verification on October 3, 2026. Deployment is in progress; live verification results will be recorded after it completes.

## Development deployment scope

1. Apply `supabase/sql/encounter-state-v4.sql` once to `nephrology-agentic-harness-dev` (`excqvjpsmdxzhujsbkmz`). This creates `ehr.encounter_review` and `ehr.patient_state_audit`, installs the snapshot/append-only audit triggers, replaces `ehr.reduce_patient_state`, and adds `ehr.review_source_current`. New tables have RLS enabled and no direct browser grants. Functions use security invoker and an empty search path; public/anon/authenticated execution is revoked. Existing state versions are not rewritten.
2. Deploy the six existing JWT-protected functions from their corresponding source directories: `ambient-scribe-write-gated`, `scribe-review-gated`, `workspace-review-gated`, `astra-review-gated`, `synthetic-encounter-gated`, `patient-activity-audit-gated`. Include local `json-boundary.ts`, `clinician-auth.ts`, existing `deno.json` where present, and `encounter-review.ts` for synthetic encounter. Keep `verify_jwt: true`. No secret or auth configuration changes are needed.
3. Publish the updated browser assets to `main/preview` after the functions are ready. The new sign request requires `expectedStateVersion`; coordinate backend and preview publication.
4. Run `scripts/verify-encounter-state-v4.sql` against development. It performs generation/edit/rejection/reduction/audit/signed-state reload assertions for all 24 patients in one transaction and rolls back every test write. It has been prepared but not executed.
5. Run security advisors, then perform the browser acceptance flow below. Security advisors before this build showed the private-schema RLS/no-policy information notices and an existing leaked-password-protection warning; this patch does not change those auth settings.

## Local verification

Run the seven scripts in `.github/workflows/harness-contract-tests.yml` using Node 24. The v4 test checks all 24 deterministic census fixtures across object/string JSON boundaries and checks narrative edits, blank edits, stale reviews, replay, rejection, and closed encounters with a mocked database. Scribe tests include serialized BP JSONB and preservation of original/reviewed values. Encounter tests cover signing guards and clinician access.

Local tests do not establish live PostgreSQL or browser behavior. This environment has no PostgreSQL runtime or installed Chromium executable; database migration execution and browser visual verification remain pending.

## Browser acceptance

1. Sign in at the synthetic preview and open one of the 24 patients.
2. Add a synthetic pre-chart source and save an encounter draft.
3. Submit explicit Scribe observations, edit one, accept another and reject another. Confirm that only accepted/edited observations appear in canonical state.
4. Run Astra after the observations have been reviewed. In the encounter review panel, inspect the evidence, edit or accept the summary, and explicitly approve/reject any internal action. Pending items are restored when reopening the encounter. If unrelated clinical state changed, reject or regenerate the stale review.
5. Sign the reviewed encounter. Open **Last signed encounter · approved state and history** to inspect its reviewed values, generated text/model, and before/after snapshots.
6. Reload the page. The signed view must show the same final state version and reviewed content. A later encounter must not change the earlier signed snapshot.
7. Repeat across all 24 synthetic patients. Live Scribe/Dictation audio and external order execution remain outside this build.

## Recovery

The additive audit/review tables retain history. If function/preview deployment fails, restore the previous six function bundles and matching preview assets together; leave the new private tables in place. Do not rewrite or delete patient state versions to roll back code. The live reducer replacement requires the previously captured function definition for a database rollback; preserve it in the deployment session before applying the migration.
