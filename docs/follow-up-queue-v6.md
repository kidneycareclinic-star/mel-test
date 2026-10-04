# Follow-up queue v6

Approved visit-package items now appear in a work queue across the signed-in physician's assigned synthetic patients. The patient header also has a **Visit completion** shortcut beside the existing Activity / Audit action; the full Visit completion panel remains immediately below Pre-charting note.

The top-bar **Follow-up queue** button opens outstanding, completed and cancelled items, with patient, item type, due-date and status filters. Summary counts cover all of the physician's approved packages. The browser sends its local calendar date; the editable **As of date** controls overdue/today/future comparisons. Undated items have a separate filter. Pages contain up to 100 items, ordered by outstanding status, due date and patient.

**Visit packages to finish** lists up to 100 recent signed visits without an approved package. **Create visit package** or **Finish package review** selects the correct patient and signed visit in the v5 editor. It does not generate or approve content automatically. An empty approved queue is expected until the clinician creates and explicitly approves a visit package and its intended items.

## Access and updates

`follow-up-queue-gated` accepts authenticated GET requests only. The unchanged shared authentication helper verifies the real clinician session and assigned office census. Every queue query independently limits records to active synthetic patients, active office assignments and physician memberships with `patient.read`, and to that physician's own encounter packages. Draft packages and pending/rejected items stay outside actionable results. No schema migration or new browser table permission is needed.

Completing or cancelling an item calls the existing v5 endpoint, with the correct patient, encounter, item ID, current package version and required clinician note. Existing permissions, owner checks, transitions, locks and immutable history apply. A stale update retains the typed note and offers refresh. If the update succeeds but the subsequent queue reload fails, the interface explicitly reports that the update was saved. No clinical Patient State changes or external laboratory, prescribing, referral, scheduling or patient-message actions occur. All orders remain simulated.

## Verification

The safety suite validates real calendar dates, bounded filters and pages, injection rejection, read-only SQL, unchanged shared auth and preview parity. The existing CI real-driver suite applies the v5 migration to isolated PostgreSQL, exercises 24 full v4/v5 workflows, then tests the v6 handler with Postgres.js 3.4.7 and the actual authentication/census helper. Its 104 approved/resolved item fixtures cover pagination, filters, unfinished packages, source-version pinning and owner/assignment/role/permission/workspace/session/origin isolation. DOM suites verify the header shortcut, requested signed-visit navigation, local dates, filters, escaped labels, required notes, stale retention, successful writes with failed reload, enabled controls and cross-patient navigation. These tests do not claim signed-in live browser acceptance.

## Browser acceptance

1. Refresh the current preview and sign in as the assigned physician.
2. Select PT-001. Click **Visit completion** beside the patient's name, or **Open visit package** below Pre-charting note. Choose the signed visit and create its package if needed.
3. Review/edit the final note and patient instructions. Add intended simulated items, approve or reject each item, and approve the visit package.
4. Click **Follow-up queue** in the top bar. Approved outstanding items should appear; use the filters and **As of date** to inspect the list.
5. Enter a completion/cancellation note and update an item. Refresh and inspect its saved status and visit-package history.
6. Click **Open visit package** from another patient's item and confirm both the selected patient and signed visit.

At v6 preflight, PT-001 had one signed v4 encounter and no visit package. Accordingly the initial queue is empty and that encounter appears under **Visit packages to finish**. Signing an encounter and approving a visit package are distinct saved steps.
