# Encounter and phone connection checklists

The encounter screen has a compact, expandable **Encounter review** checklist. It reads the existing coordinator state and signing controls: preparation freshness, pending action decisions, clarification or missing medication fields, instruction confirmation, saved edit state and signing availability. **Continue review** navigates to the next unresolved item; it never accepts actions, checks clinical review boxes, changes a draft or signs. Reading the note and source facts remains the physician's review, rather than a computed completion mark.

Say **Show me what still needs review** to open this checklist. Queued/failed jobs, edited plans, autosave and patient/account changes update its displayed status. Signed encounters display the saved receipt state. Other clinicians' local review state is not adopted after account changes.

Phone alerts now include a four-step connection checklist:

1. Six server settings saved with the expected format.
2. Mobile possession verified through the existing consented Verify flow.
3. SMS delivery, alert types and consent explicitly saved.
4. A carrier-reported delivery receipt for the current saved preference version.

**Check connection status** is an authenticated GET; it does not contact Twilio or send a message. The backend returns only missing/invalid/configured statuses for known settings, never credentials or encrypted contacts. Presence/format validation does not certify provider credentials, sender registration or account balance. Verification and a real eligible encounter alert exercise the respective services.

Accepted/sent/unconfirmed receipts, previews and receipts from an older preference/contact version cannot complete delivery confirmation. Changing preferences requires a new eligible delivery test. Quiet hours and existing throttles continue to apply. A delivered receipt is a carrier status, not a physician review or signature.

Say **Open phone alerts** or **Show phone connection status** to open the connection checklist. **Read SMS setup steps** opens the bundled [setup guide](../phone-alert-setup.html), with Twilio registration/service instructions, server secret names, local encryption-key generation, verification/opt-in and delivery testing. No provider account or real phone was configured by this build.

No schema, clinical write, order release or signing API was added. The phone gateway includes additive sanitized configuration checks and history preference versions; the existing worker's delivery policy is unchanged. Tests use synthetic provider/audio fixtures and check both themes, narrow layouts, account isolation and read-only checklist navigation.
