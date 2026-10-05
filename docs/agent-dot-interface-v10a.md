# Hierarchical agent-dot encounter interface: v10A

This iteration implements the physician's image-inspired interface: a large luminous ambient-voice circle, a smaller orchestrator, and six role-colored specialist dots. It changes presentation and navigation around the existing v9A synthetic encounter workflow. It does not install OpenAI Dots, introduce new clinical agents, or expand execution authority.

## Mapping and interaction

| Dot | Role | Present functionality and boundary |
| --- | --- | --- |
| Large cyan voice orb | Ambient voice and dictation | Opens the existing recording, transcript correction, and dictation controls. The dot itself never starts capture. Its bars react to actual samples from the existing microphone meter. Capture remains visible during recording, with a persistent explicit stop control. |
| Indigo orchestrator | Encounter coordination | Shows the actual preparation state and current approval readiness from the existing coordinator. It does not imply a continuously running background worker. |
| Teal chart organizer | Clinical context | Opens the assembled chart facts inline: dated results, problems, medications, allergies. Patient identity remains visible above the map. |
| Amber clinical evidence | Astra analysis and future guidelines | Brings the existing clinical-analysis pane into the same encounter surface. Dedicated versioned guideline retrieval remains explicitly planned. |
| Violet note writer | Physician documentation | Opens the existing template/detail preferences and editable note. Navigation does not regenerate or overwrite text. |
| Rose orders and instructions | Encounter plan | Navigates to the existing patient instructions and explains the simulated visit package. Automatic order writing and external release remain planned. Legacy internal tool proposals remain excluded by v9A. |
| Green verification | Physician review and approval | Navigates to the review packet. The existing authenticated, version-checked finalization control stays visible and remains the sole encounter approval control. |
| Blue follow-up | Continued work | Brings the patient's open loops inline and offers the existing assigned-patient queue. Phone alerts and mobile approval remain planned. |

Both the circle and its label are part of one native button. Labels, role descriptions, and status text supplement color. Native keyboard activation, visible focus, and aria-pressed expose selection; the function panel names the selected role. Colors identify role, not clinical severity. Missing/held work is described with text rather than an invented percentage or an always-green success light.

## Visual design and continuity

Dark mode uses luminous cyan connections against a restrained dark clinical surface. Light mode uses paired darker role colors and pale surfaces for readable text. The existing persistent theme selector remains. The reference photograph is inspiration only; it is not copied into the product or uploaded to the public repository.

The encounter moves immediately below persistent patient identity, ahead of detailed chart sections. Dot selection reveals the relevant function in place while preserving the full review packet and its finalization gate. Switching roles never invokes a new provider call, signs a note, accepts a proposal, releases an order, or sends a notification. The follow-up queue opens only when its explicitly labeled queue button is selected.

The same DOM editors and existing event handlers are reused. Capture is not duplicated. An active recording cannot be hidden merely by selecting another dot; its actual level and stop control remain visible. An inactive meter's stop event cannot reset a different active capture stream. When a patient changes, the coordinator clears the previous chart immediately, and the agent selection returns to voice for the new encounter. Existing patient-change capture cancellation, edit storage, and stale-response checks still apply.

## OpenAI Dots inspiration

Official OpenAI documentation describes Dots as identifiable ongoing agents with visible activity, contextual continuity, and decisions returned to their user. This informs our role identity, shared encounter context, and physician attention surface. The healthcare application continues to use its own scoped coordinator and clinical review contracts. No OpenAI Dots API or always-on clinical automation is claimed by this UI.

Sources checked October 5, 2026 UTC:

- OpenAI, Meet dots: https://learn.chatgpt.com/docs/dots
- OpenAI, Message your dot: https://learn.chatgpt.com/docs/dots/channels
- Prior project design: [Oracle-inspired encounter interface and literature review](oracle-inspired-agentic-interface-v10.md)
- Existing runtime: [v9A encounter coordinator](encounter-coordinator-v9a.md)

## Verification

The dedicated DOM test exercises all eight labeled dots, navigation without HTTP mutations, editor preservation, approval gating, inline evidence/loop restoration, actual microphone-sample events, explicit stop, patient selection reset, and source/preview parity. The existing coordinator integration test also loads the map and finalizes a synthetic reviewed packet through the unchanged mocked server contract.

Browser verification uses the real page, styles, microphone meter, recorded-audio UI, coordinator, and map with synthetic backend responses. It checks desktop dark/light layouts, 760/390/320-pixel overflow, target separation, and JavaScript errors, and captures screenshots. This does not test a physical microphone, real transcription fidelity, or a live clinician signature.

The source and published preview must carry identical copies of index.html, agent-map-ui.js, agent-map-ui.css, microphone-meter.js, and encounter-coordinator-ui.js. No backend deployment or database migration is needed.
