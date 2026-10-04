# Encounter Completion v5

After a physician signs a synthetic encounter, its visit package starts from that exact saved Patient State version. The final nephrology note and patient instructions are editable drafts assembled from the signed note, recorded values and encounter-linked approved Astra summary. No new medical recommendations or order suggestions are inferred. The physician supplies intended lab, medication, referral or follow-up drafts, reviews each item, and approves the completed visit package.

## Approval and history

- Original drafts and the signed source snapshot are immutable. A later patient-state update or encounter does not change an earlier package.
- Draft edits and every item decision create a versioned before/after history entry linked to an EHR event and clinician identity. Duplicate creation is idempotent. Stale versions and replayed decisions are rejected.
- Pending items block package sign-off. A package with no order drafts can be approved after reviewing its note and instructions.
- Approval freezes the final note, instructions and order details. Approved items can subsequently be completed or cancelled with a recorded note. Due dates and overdue status remain visible.
- All orders remain simulated. No prescription, laboratory order, referral, appointment or patient message is transmitted. Completion records do not alter canonical clinical Patient State.

## Access and deployment

The additive migration `supabase/sql/encounter-completion-v5.sql` creates three private RLS-enabled tables and security-invoker guards. Browser/public table access and trigger-function execution are revoked. The JWT-protected `encounter-completion-gated` function verifies the clinician, active patient assignment and existing encounter permissions. It also requires the same clinician owner as the signed encounter. Mutation locks follow the existing patient → encounter → completion → item order.

Deploy all four files from `supabase/functions/encounter-completion/` together with JWT verification enabled. Publish `encounter-completion-ui.js`, `encounter-completion-ui.css` and the versioned preview index. No API-key or authentication configuration changes are required. Existing v4 signed encounters are retained.

## Verification

The local safety suite checks all 24 source fixtures, encounter-specific narrative use, identity, stale versions, dates, item validation and unchanged shared auth. CI runs the real production handlers with Postgres.js 3.4.7 against a disposable PostgreSQL instance, including the production v5 migration, for all 24 synthetic IDs. It covers draft creation/editing, approval/rejection, pending and replay guards, package sign-off, completion/cancellation, later-state isolation, database immutability and denied browser grants. DOM tests use jsdom 26.1.0 to exercise real interface interactions, failed-write retention, revision handling, safe rendering, visit switching and saving on close. These tests do not claim a signed-in live browser session.

## Clinician acceptance

1. Reload the preview, sign in and select PT-001, whose v4 encounter is signed at Patient State v6.
2. In **Visit completion**, click **Open visit package**. Choose a signed visit, then **Create visit package**.
3. Review and edit the **Final nephrology note** and **Patient instructions**, then **Save package draft**.
4. Enter any intended synthetic lab, medication, referral or follow-up item, including an optional due date. Click **Add draft**, then explicitly approve or reject each item. Correct an item by rejecting it and adding a replacement.
5. Click **Approve visit package**. The final note and instructions become read-only. Copy buttons are available for review.
6. Enter a completion or cancellation note for an approved item, then mark it complete or cancel it. Inspect **Visit-package history**.
7. Close, reload and reopen the same signed visit. Its approved text, simulated statuses and source version must match. Other signed visits are selectable separately.

The new tables are intentionally private with no browser policies; Supabase may show informational [RLS/no-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). The existing [password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is unrelated to this change.
