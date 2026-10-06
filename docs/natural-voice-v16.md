# Natural voice navigation and preparation · v16

A physician can say or type everyday English, such as “Take me to the patient instructions,” “What remains for me to review?” or “Get this saved visit ready with a SOAP note.” Known navigation phrases still open a section directly. Other phrasing is interpreted by an authenticated, patient-assigned endpoint and presented as an “I understood…” card. The physician confirms the intended section or preparation request.

Preparation always requires a visible confirmation, including previously supported exact commands. It uses the saved encounter and selected writing preferences (or SOAP when explicitly requested), then uses the existing protected preparation API. New content remains subject to note, action and instruction review and the existing final signoff.

## Interpretation boundary

The model receives only the command text, not the patient identifier, chart, encounter transcript, draft note, contact details or templates. Requests use the existing server-side OpenAI key, Responses API, strict JSON schema, store:false, no tools and a 30-second provider timeout. Only navigation to nine existing sections, preparation, or clarification is accepted. No edit payload, patient selection, signature, order release, settings mutation or message sending is available. Negative, conditional, compound, editing and execution requests receive clarification. Clinically meaningful dictation continues to use the existing exact “Add to plan:” or quoted replacement commands with a before-and-after proposal.

The gateway verifies the actual Auth identity, active synthetic clinician, patient assignment and encounter.draft permission. It fences the latest clinician-owned draft ID and source revision both before and after provider I/O and rechecks identity and permissions. No chart, encounter or phone tables are mutated by interpretation; existing IAM access audits record access. Provider errors, refusals, incomplete responses and unexpected enum/field combinations fail closed. The browser validates the response envelope and bounded intent again. Command edits, patient/account changes and source revision changes invalidate pending confirmations and late responses. A plan proposal only reads a note rendered for the current account and patient.

## Phone alerts

The v15 configuration, phone verification, consent and carrier receipt checklist remains available through “Open phone alerts.” No phone was verified or opted into SMS at the start of this build. Use the [setup guide](https://kidneycareclinic-star.github.io/mel-test/preview/phone-alert-setup.html) to configure Twilio and enter credentials in the Supabase administrator console; verify the physician's number and explicitly enable alerts in the application. No SMS is sent by voice navigation or interpretation.

## Validation

Contract tests cover strict prompt/output limits, forbidden routes, body limits, provider errors and post-provider authorization/source races. Real Postgres.js tests use a disposable PostgreSQL database and the actual clinician authorization helper. DOM tests exercise actual coordinator, action, review and voice modules, including confirmation, exact plan edits and late responses. Chromium checks both themes at 1440, 760, 390 and 320 pixels and saves screenshots of the confirmation card.

Audio and model responses are mocked in these tests. These checks validate workflow and access boundaries; they do not establish real speech recognition or clinical accuracy. Current deployment remains a synthetic preview.

Documentation checked 2026-10-06: [Supabase authorization headers](https://supabase.com/docs/guides/functions/auth-headers), [Supabase changelog](https://supabase.com/changelog), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
