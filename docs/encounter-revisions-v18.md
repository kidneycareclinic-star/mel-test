# Coordinated encounter revisions v18

A physician can change an existing follow-up or lab draft by voice or typed command. A single bounded model request proposes matching edits to the note's Plan, existing nonmedication action drafts and full patient instructions. One review card presents the changes and original action source. Approval appends one saved review revision. Final signing remains a separate physician decision.

## Try the synthetic preview

1. Open a synthetic patient with a saved source and a ready prepared encounter. Review the generated note and action drafts first; include the clear drafts you intend to use.
2. Select the Orchestrator dot. Press **Talk to orchestrator**, speak, then **Stop**, or type into the command box and press **Run command**.
3. Try “Change follow-up to three months and update patient instructions.” or “Update BMP timing to two weeks and update patient instructions.” Use a command that matches an existing clear action and Plan wording.
4. Read every before/after pair. Check the heard command, timing, lab name, source quote and full instructions. **Discard revisions** retains the current draft. **Approve changes to draft** saves all proposed parts together.
5. Review remaining observations and actions, confirm the patient instructions, then use the existing final signing control when appropriate.

The current review is saved before proposing. The proposal itself does not change clinical draft content. A pending card holds the local signing button. Editing a note, action, instruction, command, patient or account invalidates the card. A server change, source revision, new encounter or expiration rejects approval. Proposals expire after ten minutes or when their preparation expires, whichever comes first. Accepted approval is replayable only while the approved review is still current.

## Bounded clinical scope

Only an existing clear, nonexcluded physician-plan lab, follow-up or instruction action may change. There are no new actions, medications, prescriptions, external orders, automatic messages or automatic signatures. Timing/test revisions require note, matching action and instruction edits together. Rewording may preserve clinical fields while changing patient wording. One recognizable Plan or Assessment and Plan heading is required. Existing Add/Replace Plan commands retain their previous exact-text workflow.

The server enforces exact unique substring replacements, scope, action identity, number provenance, medication exclusions, negation/uncertainty checks and immutable source/review versions. These guards cannot prove clinical equivalence or model accuracy. The physician must review every proposal. Provider output can be declined or require clarification; existing draft editors remain available.

## Backend and audit

`encounter-revision-gated` verifies JWT at the gateway, validates the actual Auth clinician and assigned synthetic patient permission, and revalidates access after provider work and at approval. It sends only the physician command, Plan text, patient instructions and eligible action fields to the existing OpenAI Responses endpoint (`store:false`, strict schema, no tools). It sends no patient identifiers, session tokens, full chart, Subjective or Objective sections. This remains a synthetic-only prototype; the feature is not a claim of HIPAA readiness or clinical validation.

The private RLS table `ehr.encounter_revision_proposal` retains the command, context hashes, before/after snapshots, changes, model, expiration and approval review version. Public/anon/authenticated access is revoked. Clinical drafts use the existing immutable packet-edit history. The saved proposal is the authority for approval: the browser sends only its ID and explicit confirmation. Writes share the patient/access/encounter/packet lock order. A clinician advisory lock limits proposal reservations to twenty per hour, including failed/preparing requests. Signing continues through the existing encounter approval receipt and completion transaction.

Deploy the established SQL script `supabase/sql/encounter-revision-v18.sql` and function folder, including its pinned function-local `deno.json` and `deno.lock`, with `verify_jwt:true`. Include the shared coordinator helper source files and flatten their relative imports in the upload package. No browser provider keys or new secrets are needed. The previously connected push service is unchanged by this revision build.

## Verification

The workflow runs pure malicious/invalid output contracts, a disposable real PostgreSQL handler/transaction suite (including two-connection replay and separate final-sign integration rolled back), actual UI DOM request races and a Chromium dark/light responsive approval flow. The model and transcription boundaries are mocked in these regression tests. Actual clinical revision quality still needs physician testing with synthetic commands. No live encounter, state, push subscription or notification is created for these tests. Preview publication compares the preview subtree against the exact tested source commit before deployment.

## Capture feedback fix v18a

Selecting the Orchestrator dot opens and focuses its command controls. It does not start the microphone. Press **Talk to orchestrator**, speak, then **Stop command** (the map footer can also stop this command). The smaller COMMAND dot and the command panel meter display actual microphone levels for this session. The larger VOICE orb displays ambient/dictation levels. Explicit labels distinguish microphone permission, recording, transcription and response preparation.

Heard words appear in the editable command box before proposal preparation and remain available if a proposal is blocked. Empty transcripts report that no speech was transcribed; replay or typed correction remains available. Signed or absent editable encounters show their prerequisite. **Add reviewed encounter text** navigates to the existing ambient reviewed-text editor, without clearing text or writing any encounter. Save a new reviewed source and wait for preparation, then repeat the revision command. The approval button is displayed only when a valid proposal exists. Nothing is automatically signed.

Synthetic starting source for testing a new draft: “Synthetic visit. Physician: repeat BMP in six months. Physician: return for follow-up in six months.” Enter and save it as reviewed text. Once the draft is prepared, request the change to three months. This is a software fixture, not a clinical follow-up recommendation.

Regression coverage includes dot selection with no microphone request, a real microphone-meter sampling path driving only the command dot, command stop isolation from ambient, signed/no-draft transcript retention, empty transcription, permission errors, and responsive signed-encounter guidance. Browser microphone and provider requests are mocked; actual device transcription still requires user verification. The existing revision endpoint also handles its exact empty-instructions placeholder: replacement is allowed only when it exactly equals the validated revised actions’ patient wording. Real clinical negations, medication checks and unchanged unrelated decisions remain protected. There are no schema changes.
