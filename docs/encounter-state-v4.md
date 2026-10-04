# Encounter State v4

When a physician edits a Scribe observation, the saved lab value and the reloaded Scribe summary must both show the reviewed value. The original extraction remains in proposal history. Astra narrative now enters the encounter review queue and becomes authoritative only after acceptance or edited acceptance.

The build adds JSONB runtime validation, a patient lock before write transactions, immutable before/after audit snapshots, source-version checks, and a signed encounter view pinned to its final state version. Rejection records a decision without creating a state version. A pending narrative or encounter-linked action prevents signing. Unrelated clinical changes make Astra decisions stale; the two decisions from the same Astra run can be made in either order.

## Status

Deployed to `nephrology-agentic-harness-dev` on October 3, 2026, following explicit user approval. The migration is applied, all six functions are active with JWT verification, and the public preview Pages deployment succeeded at commit `2d080a834e2a27812ad76317f463e661c6e1e86c`. Draft PR [#4](https://github.com/kidneycareclinic-star/mel-test/pull/4) tracks the source changes and is stacked on Astra gateway PR #3.

The live PostgreSQL verification passed for every patient, PT-001 through PT-024: proposal generation without state mutation, physician-edited narrative and observations, rejection exclusion, before/after audit equality, stale review protection, audit immutability, and signed-state reload equality. All QA writes were rolled back; a follow-up query confirmed zero QA principals/review/audit rows and 24 active synthetic patients. Browser roles cannot directly read the new review table, update audit rows or execute the reducer.

The first migration attempt caught a missing SQL function terminator and rolled back with no tables created. The source was corrected and the second application and live tests succeeded.

Function versions: ambient writer v7, Scribe review v7, workspace review v7, Astra review v10, synthetic encounter v6, and patient activity audit v7. The feature branch CI passed before the final deployment-record update. Direct HTTP and signed-in browser verification are unavailable in this environment because its network policy blocks the Pages and Supabase URLs; the clinician browser acceptance steps below remain to be performed.

## Development deployment scope

1. Apply `supabase/sql/encounter-state-v4.sql` once to `nephrology-agentic-harness-dev` (`excqvjpsmdxzhujsbkmz`). This creates `ehr.encounter_review` and `ehr.patient_state_audit`, installs the snapshot/append-only audit triggers, replaces `ehr.reduce_patient_state`, and adds `ehr.review_source_current`. New tables have RLS enabled and no direct browser grants. Functions use security invoker and an empty search path; public/anon/authenticated execution is revoked. Existing state versions are not rewritten.
2. Deploy the six existing JWT-protected functions from their corresponding source directories: `ambient-scribe-write-gated`, `scribe-review-gated`, `workspace-review-gated`, `astra-review-gated`, `synthetic-encounter-gated`, `patient-activity-audit-gated`. Include local `json-boundary.ts`, `clinician-auth.ts`, existing `deno.json` where present, and `encounter-review.ts` for synthetic encounter. Keep `verify_jwt: true`. No secret or auth configuration changes are needed.
3. Publish the updated browser assets to `main/preview` after the functions are ready. The new sign request requires `expectedStateVersion`; coordinate backend and preview publication.
4. Run `scripts/verify-encounter-state-v4.sql` against development. It performs generation/edit/rejection/reduction/audit/signed-state reload assertions for all 24 patients in one transaction and rolls back every test write. It was executed successfully on October 3, 2026; all 24 rows reported PASS and all test writes were rolled back.
5. Run security advisors, then perform the browser acceptance flow below. Security advisors before this build showed the private-schema RLS/no-policy information notices and an existing leaked-password-protection warning; this patch does not change those auth settings. The post-deployment advisor returned the same existing password warning and informational notices for the private server-only tables. Reference: [RLS/no-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Local verification

Run the seven scripts in `.github/workflows/harness-contract-tests.yml` using Node 24. The v4 test checks all 24 deterministic census fixtures across object/string JSON boundaries and checks narrative edits, blank edits, stale reviews, replay, rejection, and closed encounters with a mocked database. Scribe tests include serialized BP JSONB and preservation of original/reviewed values. Encounter tests cover signing guards and clinician access.

Local tests do not establish live PostgreSQL or browser behavior. This environment has no PostgreSQL runtime or installed Chromium executable; live database verification is complete; signed-in browser and direct HTTP verification remain pending.

## Browser acceptance

### Signing correction

The clinician browser attempt at 23:17 EDT on October 3 exposed a driver-boundary bug: Postgres.js 3.4.7 serialized pre-stringified JSON a second time when an unsafe-query parameter was inferred as JSONB. The source array became a JSON string, and `synthetic_encounter_sources_check` rejected the draft before signing. The failed transaction did not create a saved or signed PT-001 encounter. SQL-only database assertions and mocked driver tests did not exercise this protocol boundary.

Serialized JSON parameters now use `$N::text::jsonb` so Postgres.js sends JSON text and PostgreSQL parses it once. This covers draft/source provenance, reviewed Astra content, generated Astra content, and Scribe decision/original/reviewed metadata. Object-tagged `sql.json(...)` writes remain supported. Signing review guards and authorization remain in force.

The new `encounter-jsonb-driver-tests.mjs` CI job uses the exact Postgres.js version and a disposable PostgreSQL service. It reproduces the old double-encoding, verifies arrays/objects/numbers/null, and executes the production draft create/update and signing handler for all 24 fixture patient IDs with the production source-array constraint. Authentication is mocked for that isolated driver test; existing clinician safety tests cover the access gates. The browser now explains pending-review and stale-state errors with the corresponding next step.

1. Sign in at the synthetic preview and open one of the 24 patients.
2. Add a synthetic pre-chart source and save an encounter draft.
3. Submit explicit Scribe observations, edit one, accept another and reject another. Confirm that only accepted/edited observations appear in canonical state.
4. Run Astra after the observations have been reviewed. In the encounter review panel, inspect the evidence, edit or accept the summary, and explicitly approve/reject any internal action. Pending items are restored when reopening the encounter. If unrelated clinical state changed, reject or regenerate the stale review.
5. Sign the reviewed encounter. Open **Last signed encounter · approved state and history** to inspect its reviewed values, generated text/model, and before/after snapshots.
6. Reload the page. The signed view must show the same final state version and reviewed content. A later encounter must not change the earlier signed snapshot.
7. Repeat across all 24 synthetic patients. Live Scribe/Dictation audio and external order execution remain outside this build.

## Recovery

The additive audit/review tables retain history. If function/preview deployment fails, restore the previous six function bundles and matching preview assets together; leave the new private tables in place. Do not rewrite or delete patient state versions to roll back code. The live reducer replacement requires the previously captured function definition for a database rollback; preserve it in the deployment session before applying the migration.
