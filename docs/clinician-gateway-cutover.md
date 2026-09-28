# Synthetic clinician gateway: staged rollout

The synthetic browser preview currently uses public, legacy Edge Functions. A signed-in
preview and protected replacements are prepared. Do not describe the preview as fully
access-controlled until the legacy URLs are secured or retired.

## Current deployment

- Supabase development project: `excqvjpsmdxzhujsbkmz`.
- Protected staging endpoints: `synthetic-census-gated`, `ambient-scribe-write-gated`,
  `scribe-review-gated`, `workspace-review-gated`, `patient-activity-audit-gated`.
- `synthetic-patient` is retired and returns HTTP 410 with JWT verification enabled.
- No real patient data is permitted. No Auth users or linked clinicians existed when this
  work was prepared.

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

1. Publish the signed-in preview and configure the Supabase Auth Site URL (or an allowed
   invite redirect) to that exact preview URL. The preview calls only protected `*-gated`
   functions. Keep the legacy routes in place until existing callers are migrated.
2. Identify the one approved development clinician email. In the Supabase Dashboard use
   Authentication > Users > Add user > Send invitation. The invitation opens the preview's
   password setup form. The invitee sets their password there; never send it in chat or
   commit it to the repository. For default Supabase email delivery, the invited address
   must be an authorized project team address; otherwise configure SMTP.
3. Confirm the exact `auth.users.id` of the verified account. Link it to the intended active
   synthetic `iam.principal` row (`SYN-CLINICIAN-001`) after checking identity. Do not
   automatically link the first person to register.
4. Test signed-in census, an assigned patient read, denied unassigned-patient access,
   a proposed observation followed by physician acceptance/rejection, an agent tool
   proposal and approval, and the corresponding audit entries.
5. Replace the legacy five deployed endpoints with their verified gated implementations
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
