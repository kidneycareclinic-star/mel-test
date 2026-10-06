# Guided encounter lifecycle v19

The encounter card below the agent map shows Capture, Prepare, Review and Sign. Its primary button follows the current patient’s saved encounter and the existing physician-review gates.

## Physician workflow

1. After a signed visit, choose **Start new encounter**. The previous signed note and receipt collapse into an expandable history section. Microphone capture remains explicit.
2. Record, dictate or enter the new encounter. Correct the transcript and choose **Save reviewed transcript** (or save dictation/typed text). This creates the protected draft and starts agent preparation.
3. **Continue review** takes you to the next unresolved action, revision or patient instruction. Agents prepare the draft; the physician decides and reviews it.
4. **Review before signing** opens the full note. **Finalize reviewed encounter** remains a separate explicit signature.

If an editable encounter already exists, opening capture resumes that encounter instead of resetting it. Check preparation refreshes current work; the existing retry control resumes interrupted preparation.

## Source and session boundaries

Opening capture checks the authenticated clinician’s current patient and encounter through the existing protected endpoints. A patient or account change during the check prevents the transition.

A local saved-source snapshot associates the workspace’s sources with its saved encounter ID. When that ID appears as the last signed encounter, a fresh session retires only the matching saved sources. Current dated lab context is retained. Unsubmitted ambient, reviewed, dictated and typed input fields are preserved. Changed source lists or manually edited workspace notes hold the transition and direct the physician to review existing content. Direct reviewed-source submission uses the same boundary, avoiding reuse of signed sources when the explicit Start button was bypassed.

Starting capture does not create an empty encounter or submit a model request. Capture state lasts in this tab until reviewed text is saved. The backend keeps authority over draft versions, clinician assignment, preparation, signing and signed immutability. All order/completion items remain simulated.

## Verification

Actual UI modules run with synthetic service responses in DOM and Chromium tests. Coverage includes signed → fresh capture → automatic preparation → unresolved-review navigation → explicit signature → another visit; exclusion of signed visit sources, existing draft resume, unsaved field/note preservation, and late patient/account responses. Browser checks cover dark/light themes at 1440, 760, 390 and 320 pixels, overflow and 44-pixel primary targets. Existing protected database, revision, audio, notification and runtime checks are retained.

The fixture does not exercise a physical microphone, a live model or an enrolled phone. This change adds no backend schema, function deployment, real order, or notification-send operation.
