# Synthetic clinician gateway: staged rollout

The browser preview at `https://kidneycareclinic-star.github.io/mel-test/preview/` has
been published with the clinician sign-in and protected `*-gated` function URLs.
The five legacy function URLs remain callable by older clients; do not describe the
entire development API as access-controlled until those routes are secured or retired.

## Current deployment

- Supabase development project: `excqvjpsmdxzhujsbkmz`.
- Protected staging endpoints: `synthetic-census-gated`, `ambient-scribe-write-gated`,
  `scribe-review-gated`, `workspace-review-gated`, `patient-activity-audit-gated`.
- `synthetic-patient` is retired and returns HTTP 410 with JWT verification enabled.
- The `preview/` browser assets were published to the `main` branch separately from
  the draft gateway PR; invitation setup and sign-in are present there.
- No real patient data is permitted. One confirmed development Auth account is now
  linked to `SYN-CLINICIAN-001`, which has 24 active synthetic patient assignments.
  A real signed-in browser smoke test still requires the clinician's private password.

## Sign-in and authorization

The browser posts a clinician's email and password directly to Supabase Auth and keeps the
access token in memory for the current page session. It checks that the signed-in user has
an assigned synthetic census before revealing the workspace. The browser sends this user
token to each protected Edge Function. Reloading or signing out requires a new sign-in.

Each Edge Function asks Supabase Auth for the current user, rejects anonymous users,
finds an active synthetic clinician by `iam.principal.auth_user_id`, checks active practice
membership and patient assignment, confirms the workspace and action-specific permission,
and writes an `iam.access_audit` decision. The service's database connection remains on
the server. A public anon API key or a valid anon JWT does not identify a clinician.

Accepted scribe edits and tool decisions carry the linked clinician external ID in the
event or decision record. Lab and appointment preparation remains internal only;
external order placement and scheduling remain disabled.

## Activation sequence

1. Configure the Supabase Auth Site URL (or an allowed invite redirect) to
   `https://kidneycareclinic-star.github.io/mel-test/preview/`. The published preview
   calls only protected `*-gated` functions. Keep the legacy routes in place until
   existing callers are migrated.
2. The approved clinician has already accepted an invitation that redirected away
   from the preview. After fixing the Site URL, open the preview directly, enter the
   approved email, and choose Set or reset password. Open the newest recovery email,
   set a private password on the preview, then sign in. Never send a password in chat
   or commit it to the repository. The verified account is already linked to the
   synthetic clinician principal; do not invite or link another account automatically.
3. Test signed-in census, an assigned patient read, denied unassigned-patient access,
   a proposed observation followed by physician acceptance/rejection, an agent tool
   proposal and approval, and the corresponding audit entries.
4. Replace the legacy five deployed endpoints with their verified gated implementations
   (or retire them after callers migrate). Test that the old anon JWT returns 401/403 for
   both reads and writes. Then mark the cutover complete.

The existing FastAPI service is still a separate backend scaffold. This milestone uses
Edge Functions as the currently available deployed gateway; it does not claim FastAPI
is deployed. The migration to FastAPI can follow without changing the access model.

## Verification before account setup

Run `node scripts/clinician-auth-tests.mjs`, `node scripts/clinician-auth-ui-tests.mjs`,
`node scripts/scribe-review-safety-tests.mjs`, and `node scripts/harness-contract-tests.mjs`.
These tests simulate Auth and database responses. They cannot replace a real signed-in
smoke test, which requires a verified, linked clinician account.
