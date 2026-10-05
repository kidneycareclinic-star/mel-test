# Source-linked clinical evidence and action review · v10B

Saving reviewed encounter text now prepares the note and action drafts in the same orchestration request. The existing agent map opens the KDIGO references or focuses action review without changing screens. No microphone starts, approval occurs, or action executes when a dot is selected.

## Physician workflow

1. Refresh the preview, sign in, select a synthetic patient, and save reviewed transcript, dictation or typed text containing the physician's plan.
2. Review the note and source-linked actions in the encounter. The evidence dot opens the bounded KDIGO reference set. References remain informational and separate from physician intent.
3. Include clear physician-plan drafts together, or decide each item. All new items start pending. Uncertain intent and missing medication fields require an edited draft plus clarification, or exclusion.
4. Instructions rebuild from included action wording. Editing the combined instructions protects that wording from subsequent automatic replacement. The explicit rebuild button restores composition from selected actions.
5. Confirm instructions agree with the note and selected actions, then finalize. Changes to the note, selections or wording invalidate this confirmation. Finalization signs the exact displayed note and instructions, saves reviewed actions and exclusions in the immutable receipt, and places included simulated items in existing follow-up tracking.

No separate visit-completion approval is needed. Source changes, expiry, concurrent edits, assignment changes, and unresolved decisions hold finalization. Returning to a patient reloads the saved review revision. A regenerated action retains a selection only when its complete content fingerprint is unchanged; new or changed action content starts pending. Instructions review is reset after regeneration. Physician edits to the note and manually authored instructions remain protected.

## Contracts and persistence

- `clinical-actions.ts` extends the existing strict Responses schema with up to 12 action candidates. The configured model remains `gpt-6-astra`, `ultrafast`, `store:false`.
- Action candidates can be labs, medications, referrals, follow-up or counseling instructions. Each has an exact quote from saved encounter text or a reviewed source, its source identifier, timing as documented, patient wording, an intent classification, and missing-information flags. Raw audio/transcript alternatives and unparsed attachments are excluded from provider input. Historical chart data and guideline references cannot serve as action citations.
- Medication name, dose, route and frequency must be exact substrings of the cited source when supplied by the model. Missing fields create blockers. Clinician edits are separately recorded; included medication drafts require all four fields and explicit clarification of original blockers.
- Quotation validation proves that wording exists in the source. It does not prove correct speaker attribution, clinical intent, semantic accuracy, completeness or appropriateness. These remain physician review responsibilities. Model output is not clinical validation.
- Existing private, RLS-enabled preparation, revision, completion and receipt tables are reused. No migration or additional public API/table grants are needed. The endpoint retains JWT verification, server-side identity/assignment checks, patient locks and permission checks.
- Finalization records pending completion items, decides them, signs the note, freezes state, approves the package and stores the receipt in one transaction. Failure rolls back all changes. The two completion history snapshots preserve before/after item decisions. Counseling-only items stay in the instruction/receipt packet; other kinds also appear in simulated completion tracking. Relative timing stays text; no absolute due date is inferred.
- The exact request digest includes action decisions and instruction confirmation. Old signed receipts remain replayable with the legacy request digest. Older ready packets are refreshed into the new contract when opened.

## Bounded clinical references

Version `kdigo-2024-monitoring-20261005`, checked October 5, 2026. This is a starter reference set for the synthetic prototype, **not a clinic-approved protocol or clinically validated guideline agent**.

| Reference | Role |
| --- | --- |
| [KDIGO 2024 CKD guideline, Practice Points 2.1.1–2.1.2, PDF page 40](https://kdigo.org/wp-content/uploads/2026/04/KDIGO-2024-CKD-Guideline.pdf#page=40) | Physician review of kidney function and albuminuria monitoring. |
| [KDIGO 2024 CKD guideline, Recommendation 2.2.1, PDF page 41](https://kdigo.org/wp-content/uploads/2026/04/KDIGO-2024-CKD-Guideline.pdf#page=41) | Physician review of validated kidney failure risk assessment in the applicable CKD population. No risk score is calculated. |

The [KDIGO guideline page](https://kdigo.org/guidelines/ckd-evaluation-and-management/) identifies 2024 as the current guideline while a focused Chapter 3 update is underway. The bounded summaries do not include medication recommendations. Historical chart CKD text is shown as an applicability clue with an explicit requirement to confirm diagnosis, stage and lab dates. An absent clue is displayed as unmatched, rather than an inferred diagnosis. Only short paraphrases and source links are stored; the complete PDF is not redistributed.

## Validation and limits

Local contract tests cover strict schema, source selection, quote/medication validation, duplicates, ambiguity gates and exclusions. Disposable PostgreSQL tests exercise the deployed driver, exact revision checks, immutable receipt, included/excluded completion items, history snapshots, idempotency, stale sources, revocation and rollback. DOM tests cover pending defaults, batch inclusion, instruction synchronization, manual edits, regenerated fingerprints, patient switching and reload. Chromium tests render the actual page in both themes at desktop and 760/390/320 pixel widths, including evidence and action controls.

Provider responses in these automated tests are mocked. They do not establish clinical accuracy of action extraction or the note. A physician-reviewed evaluation set and broader guideline corpus remain next steps before clinical use. This build has no independent durable agent workers, autonomous prescribing, EHR order release, PHI workflow, SMS or mobile signing. All completion actions remain simulated.

Implementation references: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration).
