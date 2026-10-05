# Voice control of the encounter orchestrator

The main encounter screen now has a **Talk to your orchestrator** command surface beneath the agent map, in dark and light mode. Push Talk, speak, and Stop; a live microphone meter shows actual input levels. A short English command is transcribed through the authenticated audio gateway, never inserted into ambient transcript sources. Audio is limited to 30 seconds and 1 MB, stays in the current tab for playback, and is cleared on a new command, patient change or reload.

Recognized navigation and preparation commands run directly. Low-scoring transcription tokens hold execution for correction. Unsupported, negated or multi-action commands show help; signing, prescribing, approving orders and sending messages cannot be performed through voice commands. This first implementation uses bounded English phrases rather than open-ended model tool selection.

Examples:

- Prepare this visit using my nephrology SOAP template.
- Show me what still needs review.
- Open the proposed orders / patient instructions / chart / note / encounter inbox / phone alerts.
- Add to plan: [exact dictated text].
- Replace in plan "exact existing text" with "new text".

Plan edits show current and proposed text. Applying preserves other note sections, saves the exact revised draft through the existing protected review API, resets action decisions to pending and clears instruction confirmation. Actions and patient wording must be reconciled manually against a changed plan. Ambiguous/missing plan headings or repeated replacement anchors require manual editing. No provider is asked to invent clinical plan content.

Preparation and draft saving require the same active clinician, patient, current draft encounter, source version, preparation hash and review version. The server holds the existing patient/assignment locks and checks the latest draft for voice writes. The audio gateway rechecks active clinician and assignment after provider completion. Old permission requests and late transcription responses cannot act in a new patient/session; microphone tracks stop on capture termination or cancellation.

Tests cover strict parsing, preserved values/negations, protected sections, read-only proposals, explicit apply, review resets, source/review changes, microphone lifecycle and patient/account isolation. PostgreSQL CI exercises real current-encounter fences and existing signing regressions. Browser CI checks both themes and 320/390/760/1440-pixel layouts. Provider and microphone fixtures are synthetic; this does not validate real-world speech or clinical accuracy.

Phone alerts are configured separately: [SMS connection guide](sms-connection-guide.md).
