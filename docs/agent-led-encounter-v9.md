# Agent-led encounters: v9 design

Status: proposed architecture, October 4, 2026. This change records the design; it does not deploy an autonomous clinical workflow, send phone messages, or enable real orders. It builds on the deployed v8 synthetic scribe and physician drafting workflow.

## Physician experience

The product centers on one patient encounter view. On opening the patient, the system assembles relevant longitudinal information in the background. The physician starts the scribe once, conducts the visit, and stops capture. The encounter coordinator prepares a linked draft of the note, discrete observations, orders, patient instructions and follow-up. The physician reviews that packet in the same view, edits or excludes individual items when necessary, and explicitly finalizes the displayed version.

Routine saving, generation, refreshes, moving content between panes, linking sources, preparing follow-up and opening subsidiary workflows become system responsibilities. The physician spends interaction on clinical judgment, exceptions and signature. The normal-path design target after capture is one review surface and one explicit finalization action. This is a target, not a measured reduction; patient selection and starting/stopping recording remain intentional interactions.

Evidence and history expand inline. The existing specialist views remain available for investigation, but normal visit completion does not require navigating through them. Status shows actual job outcomes: assembling, preparing, needs clarification, ready for review, finalized, or delivery uncertain. No agent reports completion until its required work succeeded.

## Hierarchy and authority

One encounter coordinator schedules bounded specialist tasks and presents their results. A deterministic policy/execution service enforces permissions and physician decisions. The coordinator and specialists cannot approve their own outputs or grant themselves additional tools.

| Component | Work performed automatically | Authority boundary |
| --- | --- | --- |
| Encounter coordinator | Collect source changes, schedule dependencies, cancel outdated runs, assemble one review packet, report exceptions | Can prepare and save drafts; cannot sign, approve clinical changes or release real orders |
| Chart organizer | Assemble dated labs and trends, problem list, medications, allergies and relevant office/hospital/dialysis context | Read assigned patient data; preserve source and date; no invented reconciliation |
| Scribe/extraction agent | Preserve transcript provenance, propose discrete values and physician intent with supporting spans | Proposed values stay distinct from accepted Patient State; uncertain speaker, unit, negation or correction requires review |
| Guideline evidence agent | Retrieve applicable nephrology guidance from an approved, versioned corpus; provide recommendation, source section and applicability conditions | Produces evidence and suggestions; does not approve a diagnosis or issue orders |
| Note writer | Draft the physician's preferred template and detail from the shared encounter packet | Distinguish documented findings, physician decisions, historical chart data and new suggestions |
| Orders/instructions agent | Draft orders, follow-up and patient-facing instructions; keep them consistent with the plan | Label dictated intent separately from additional suggested care; incomplete required fields block release |
| Verification service | Check identity, versions, provenance, medication/dose/unit consistency, contradictions, duplicates and missing information | Deterministic hard gates plus advisory clinical critique; an LLM critique cannot replace authorization or certify correctness |
| Follow-up/notification service | Track approved tasks and prepare one encounter-level review/status notification | Uses recorded recipient preferences; no patient details or approval authority in ordinary SMS |

Agents use authenticated, scoped application APIs rather than manipulate buttons in the browser. Separate execution grants are required for EHR changes, external orders and patient communications. Transcript text, retrieved documents and model output are evidence; instructions embedded in them are never executable control commands.

## Shared encounter packet

Every task consumes a bounded packet with patient and encounter identity, source revision, clinical State version, dated chart data, transcript segments, provisional observations, physician preferences and approved guideline references. It records which facts are accepted, historical, provisional or unresolved. Raw wording and reviewed corrections remain linked; extracted values never silently replace either.

The packet contains the minimum relevant clinical context for the task. A specialist gets its permitted inputs and tool grants, not unrestricted access to every chart. A source change creates a new revision. Results from an older revision cannot enter the current approval packet. Generated drafts and physician edits have separate lineage; regeneration cannot erase an edit without an explicit replacement action.

Guideline-derived suggestions are displayed beside their supporting recommendation and applicability conditions. They do not enter the final note as if the physician had already made that decision. Acceptance promotes a suggestion into the approved plan and updates the linked draft note and instructions for the physician to inspect before finalization.

## Automatic preparation and one consolidated review

| Trigger | Automatic work | Physician interaction |
| --- | --- | --- |
| Open patient | Assemble relevant chart data and missing-data flags | Inspect only as needed |
| Start scribe in a clearly labeled prepare mode | Record with visible level/timer and agreed transcription behavior | One intentional start; capture never silently begins |
| Stop capture | Transcribe, preserve source, save a provisional draft, extract proposals and assemble encounter context | Correct material transcript errors in the encounter view |
| Reviewed source or plan changes | Re-run affected specialists and regenerate dependent drafts | Clarify unresolved facts; edits remain protected |
| Packet ready | Show note, proposed observations, orders, patient instructions, follow-up and source links together | Review/edit/exclude; new guideline suggestions are visibly identified |
| Explicit finalize | Validate exact displayed packet; apply accepted changes, record signature and approved simulated tasks atomically | One authenticated approval action for the chosen items and displayed note |
| Approved follow-up becomes due or work is blocked | Update the work queue and send a configured encounter-level notification | Open the secure review view when attention is needed |

Transcript accuracy remains a clinical dependency. A physician's spoken request can prepare a draft; ambiguous ambient speech must not authorize signing or execution. Conversational statements are not a substitute for an authenticated approval event.

No per-agent approval buttons are required. The consolidated packet makes every clinical change inspectable and individually editable or excludable, with no hidden selections. Routine documented intentions may be presented together for batch approval. Additional recommendations require an explicit visible selection; unresolved high-impact ambiguity blocks finalization rather than disappearing into a bundle. A clean encounter need not contain a new accepted laboratory observation merely to satisfy a workflow gate.

## CKD example and guideline use

For a patient with a recorded CKD G3 diagnosis, the organizer gathers eGFR/creatinine trends, urine albumin/protein results, relevant medication history and prior plans. The scribe identifies what was actually discussed. The guideline agent evaluates applicable guidance using GFR and albuminuria categories, clinical trajectory, relevant risk estimates and patient-specific prerequisites. It does not infer a universal workup from the label CKD3.

If the physician clearly says to repeat a particular test in a stated interval, the order agent prepares that intended order and timing. If guidance suggests an additional action not stated by the physician, it appears as a separate suggestion with its source and rationale. Missing medication dose, conflicting units, uncertain attribution or an unavailable recent result produces a targeted clarification request. Patient instructions reflect the reviewed plan and distinguish what is pending from what is approved.

Use an approved guideline corpus with recorded edition, publication/update date, section, source URL and retrieved passage. Select the applicable version deliberately; do not let arbitrary web content become executable clinical instructions. KDIGO 2024 CKD guidance is an initial source, not an assertion that it covers every nephrology problem or remains the newest applicable guidance indefinitely.

## Backend changes needed

The present v4/v5/v8 APIs enforce separate observation/narrative review, encounter signing and completion-package approval. A front-end macro calling them in sequence would leave partial approvals and continue the click burden. v9 needs a server-side encounter bundle with explicit approval scope and transactional application.

Proposed new records: encounter coordination runs, specialist task outcomes, revisioned review packets, item-level evidence and decisions, approval receipts, and notification/execution outbox entries. Link them to the existing encounter, agent_run, proposed_observation, tool_call, completion and immutable audit history where appropriate. Schema details are an implementation step, not an applied migration.

Model requests run outside clinical write transactions. Finalization locks in the existing patient/encounter/completion/item order, rechecks assignment and source revisions, verifies the exact packet hash and selected items, applies accepted clinical values, freezes the physician-reviewed note, creates the signed snapshot and approved simulated completion package, then records immutable before/after history. Failure rolls the clinical transaction back. The existing signed-snapshot contract and approved-note immutability remain.

Approval receipts bind clinician, patient, encounter, packet revision/hash, selected action IDs, expiry and an idempotency key. Another tab, changed source, revoked assignment or edited approval packet invalidates the pending approval. Repeated finalization returns the original receipt instead of creating a second order or signature. A specialized agent never holds an approval credential.

A transactional outbox separates approved state from network delivery. External release needs a separately configured integration, approved payload, current preflight checks and idempotent dispatch. Persist a provider receipt before claiming delivery. A timeout with unknown delivery becomes delivery uncertain and requires reconciliation; retry must not duplicate an order. Clinically relevant changes before dispatch hold affected actions for re-review. In the first v9 implementation, orders and patient-message dispatch stay simulated.

## Phone updates and approvals

Use one notification per meaningful encounter-level event, with deduplication, configurable quiet hours and reminders. Do not send a text for every specialist task. SMS is an alert channel; mobile approval happens in the authenticated application.

Example ordinary SMS: "A clinical review is ready. Open your secure review queue." Avoid patient name, diagnosis, laboratory values, order details and patient identifiers in the message or URL. A notification link conveys no authorization, reveals no clinical content before login and carries no bearer credential. The app shows the authorized packet after clinician authentication, with step-up authentication according to practice policy and action risk. A reply such as YES is not sufficient to sign or release clinical work.

From the phone the physician can inspect the exact packet, edit or reject items, and finalize the current revision. The same receipt/version checks apply as on desktop. Delivery acknowledgement is not evidence that the physician read or approved the packet. Urgent clinical escalation uses a separately defined, reliable practice workflow; SMS delivery is not an emergency-response guarantee.

Phone delivery requires a selected messaging service, verified clinician recipient, recorded preferences and production contracting/configuration. Those items are not configured by this design. No phone number is requested or message sent in this iteration.

## Production PHI readiness

Continue implementing and validating with synthetic patients. Before real PHI, evaluate the exact services and configurations that receive, maintain or transmit it, execute required business associate agreements, perform documented risk analysis and implement operational safeguards. Encryption or a multi-agent architecture alone does not establish HIPAA compliance. Check transcription, model, hosting/storage, monitoring and messaging paths, including retention and subprocessors; store:false is not a complete retention policy.

Required design properties include minimum relevant data access; verified clinician/assignment permissions; protected secrets and transport; authentication appropriate to action risk; immutable, access-controlled audit history; approved retention/deletion policies for audio and transcripts; PHI-aware logs; incident response and recovery procedures; clinician notification/recording workflows; and testing of clinical and technical failure modes. Human approval does not itself establish clinical correctness. Safety must be supported by evaluated outputs, clear uncertainty and reliable execution boundaries.

## Build sequence and acceptance

1. v9A: encounter coordinator, durable preparation runs, automatic chart assembly, one inline review packet and transactional simulated finalization. Reuse the working scribe and drafting components; prepare guideline/order outputs behind explicit capabilities until those specialists are validated.
2. v9B: vetted guideline evidence, transcript-linked discrete proposals, intended-order drafting and synchronized patient instructions. Add new suggestions as separately labeled choices, with traceable applicability.
3. v9C: secure mobile review and encounter-level notification outbox; configure and verify delivery after provider and recipient setup.
4. Later production integration: PHI readiness, validated EHR/order connectors and approved release policies. Keep real prescription, lab and patient-message release gated until that work is complete.

Acceptance measures: count physician interactions, page/modal transitions, repeated data entry, preparation latency and exception burden. The normal path should have no navigation among separate scribe, Astra, note and completion windows after opening the encounter. A physician must be able to review and finalize the packet in one surface while correcting or excluding any generated item.

Regression tests must cover patient/encounter isolation, source dates and contradictory units, transcript negations/corrections, missing required order fields, new suggestion labels, exact guideline provenance/applicability, edit preservation, stale task completion, role/assignment revocation, packet expiry, duplicate approvals, transaction rollback, uncertain delivery, notification deduplication and PHI-free alerts. Known synthetic conversations and clinician review assess factual/note/order accuracy; mocked agent responses cannot establish reliability. Phone receipt must never finalize a packet, and a source change must invalidate an outstanding approval.

## Sources

- HHS, Guidance on HIPAA & Cloud Computing: https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html
- HHS, cloud processing of ePHI and business associate agreements: https://www.hhs.gov/hipaa/for-professionals/faq/may-a-hipaa-covered-entity-or-business-associate-use-cloud-service-to-store-or-process-ephi/index.html
- KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease: https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf

Sources checked October 4, 2026. Workflow, authority boundaries, SMS content and implementation sequence above are proposed product-design decisions informed by these sources; they are not assertions that the prototype is ready for real PHI.
