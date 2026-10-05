# Phone alerts v13

The encounter inbox now has Phone alerts controls and a private notification history. Ready preparation, failed preparation and expiration queue an alert automatically after the physician has opened the authenticated workspace. Default delivery is preview only. A synthetic alert preview can be generated immediately without a phone number, SMS account, model request or clinical write. The phone preview and its history explicitly say that no text was sent. Secure review links still require the authenticated owner, current assignment and Office permissions; opening them cannot approve, sign or release care.

Notification preferences persist per physician: off, preview or SMS; ready/paused alerts; quiet hours from 10 PM to 7 AM in the selected IANA time zone. Contacts are encrypted with AES-GCM and clinician identity as authenticated additional data. The browser receives only the last four digits and verification state; phone input and verification codes are cleared after submission and never persisted in browser storage. Credentials and encryption keys are server secrets.

The backend supports Twilio Verify and a Twilio Messaging Service. Enabling actual delivery requires all server settings below, a verification code check, and explicit physician opt-in. Verification only proves phone possession and does not enable encounter messages. Replacing or removing a number stops pending SMS delivery. Number entry currently accepts US numbers in +1 E.164 format. Verification has a one-minute cooldown, three requests per 24 hours and five checks per challenge. Known provider failures commit private attempt receipts so they do not bypass throttling. Responses and logs do not contain raw provider bodies or verification codes.

Configure these **in the development project's Edge Function secrets**, never in GitHub, frontend code or chat:

- `TWILIO_ACCOUNT_SID`: account SID.
- `TWILIO_AUTH_TOKEN`: account auth token.
- `TWILIO_MESSAGING_SERVICE_SID`: Messaging Service SID with an approved SMS sender and STOP handling enabled.
- `TWILIO_VERIFY_SERVICE_SID`: Verify service SID.
- `SMS_CONTACT_ENCRYPTION_KEY`: independent 32-byte random key encoded as 64 hexadecimal characters. Preserve it while encrypted contacts remain; changing it requires re-verification.
- `SMS_DELIVERY_MODE`: set to `twilio` only when the sender, delivery account and opt-out handling are ready. Leave unset to retain preview-only operation.

Then sign in, open Encounter inbox → Phone alerts, verify the phone, choose Text my verified phone, check the alert consent box and save. No real number or account was configured by this build. CI tests every provider response using mocks, including verification. The live synthetic preview remains an implementation test, not a production privacy or clinical validation statement.

## Delivery guarantees and limits

A private sweep finds only active synthetic patients, the current draft, matching source version, owning active synthetic physician, current practice/patient assignments and Office read/draft permissions. Its revision matches the inbox event/status revision. A unique job/revision/transport key suppresses duplicate alerts. Current seen receipts suppress unsent alerts. Preference changes cancel pending alerts; an unsent cancelled alert can be reactivated under the new preference version, while submitted alerts cannot be resubmitted. No alert is generated for normal intermediate agent stages.

The worker repeats identity, role, assignment, source, revision, seen, current encounter, preference, verified contact and consent checks at send time. The lock order matches preparation/signing. A send intent commits before provider I/O. Provider I/O then occurs with the authorization and preference rows locked and an eight-second timeout. If a network failure or database failure prevents knowing whether a message was accepted, the alert becomes delivery unconfirmed and is never automatically resent. A crash watchdog also converts abandoned intents to unconfirmed. This prioritizes avoiding duplicate texts; the inbox remains available if an alert is missed.

The worker polls the provider's exact message receipt, at most twelve times. Accepted and sent are not labeled delivered. Delivery confirmation is a carrier receipt, not physician review or approval. Failed/undelivered/unconfirmed alerts direct the physician back to the inbox. STOP rejection disables SMS consent; provider STOP filtering must remain enabled. No webhook, incoming text approval, read receipt or automatic clinical signing is implemented. Quiet hours, at least two minutes between alerts, three per hour and ten per rolling 24 hours bound notification traffic. A pending alert expires after 24 hours; a source/status change cancels it instead of sending stale work. Disabling preferences stops pending sends; a submission already in progress cannot be recalled.

`phone-alerts-gated` retains platform JWT validation and real session validation. `phone-alert-worker` uses custom authentication: short-lived, single-use scheduler capabilities bound to one alert, hashed at rest; browser origins and extra body fields are rejected. All new private tables have RLS, revoked public/anon/authenticated grants, indexes on foreign keys and immutable clinician-linked audit events. The new functions use security invoker and have no public execution grants. The minute scheduler dispatches at most three alerts or delivery polls per invocation. Patient state, encounter notes, action decisions, signature receipts, prescribing and external order release are unchanged.

## Validation

Focused checks cover exact Verify/Messaging API wires, owner-bound encryption and tampering, quiet hours, PHI-free fixed alert text, receipt mismatch, opt-out, timeout uncertainty, dispatch boundary, genuine PostgreSQL authorization, per-account preferences, stale settings, no contact exposure, verification/consent, throttling, revision deduplication, disabled/current-source/seen/revoked-access cancellation, concurrent send attempts, delivery polling, durable intent surviving post-provider rollback, contact removal, immutable audit and unchanged patient state. DOM checks cover preview truthfulness, transient number/code fields, configuration/verification/consent controls, direct secure review, stale settings and late responses after account changes. Chromium checks real controls in dark/light at desktop and 760/390/320 px with visible target sizes and overflow checks. Existing exact-packet physician finalization and source review suites remain enabled.

Primary implementation references, checked October 5, 2026:

- [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions)
- [Twilio Message resource and delivery statuses](https://www.twilio.com/docs/messaging/api/message-resource)
- [Twilio Verify start](https://www.twilio.com/docs/verify/api/verification)
- [Twilio Verify check](https://www.twilio.com/docs/verify/api/verification-check)
- [Twilio STOP filtering](https://help.twilio.com/articles/223134027)
