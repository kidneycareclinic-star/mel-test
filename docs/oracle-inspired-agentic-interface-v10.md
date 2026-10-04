# An encounter-centered nephrology EHR: Oracle review and v10 design

Research date: October 4, 2026. Status: design proposal. This document changes no clinical permissions, live preview, provider endpoint, order integration, or notification service. It follows the implemented v9A coordinator and the earlier [agent-led encounter architecture](agent-led-encounter-v9.md).

## Recommendation

Make one continuous encounter workspace the primary physician interface. Agents assemble information, prepare drafts, reconcile dependencies, and surface exceptions within that workspace. Physicians see the patient's clinical story, edit their preferred note, inspect the proposed plan, and approve the exact version. Clinical data remains directly inspectable throughout.

Oracle offers a useful architectural direction: contextual voice interaction, shared clinical meaning, embedded assistance, and coordinated workflows. We should adopt those principles with a nephrology-specific information hierarchy. The present evidence does not establish that an Oracle-like appearance or a larger number of agents will improve our clinical outcomes. Those are design hypotheses to evaluate with physicians.

The first implementation should rearrange the working v9A components, preserve their review and signature contracts, and measure the resulting physician effort. Advanced automation follows after its individual tasks and execution boundaries are validated.

## What the supplied description gets right, and what needs qualification

| Claim | Finding | Consequence for our project |
| --- | --- | --- |
| New EHR built on OCI, with native AI | Oracle's August 2025 announcement describes a new OCI-based ambulatory EHR, contextual voice interaction, and an open orchestration system [O1]. This is a vendor architectural statement, not an independently inspected implementation. | Build coordination into the encounter workflow. OCI is not a prerequisite for these product principles. |
| Knowledge graph and semantic index | Seema Verma explicitly describes both in her October 2025 article [O2]. Public material does not disclose the full graph schema, grounding evaluation, or all internal services. | Start with dated, structured clinical facts and explicit relationships; add graph infrastructure when a concrete retrieval need justifies it. |
| Eliminates legacy Cerner technical debt | A rebuilt product does not establish that every legacy dependency or migration problem has disappeared. Oracle also announced nursing AI inside Foundation EHR [O5]. | Evolve our existing safeguards and data contracts instead of treating a visual redesign as a backend replacement. |
| Every domain capability is available | The current agent page flags multiple features as planned [O3]. September 2026 revenue-cycle announcements also describe forthcoming capabilities [O6]. Some prior-authorization functionality is already documented in release 26.04 [O7]. | Track availability at the exact feature, product, geography, and release level. Our roadmap should label implemented, simulated, and planned work equally clearly. |
| Physician control over documentation and orders | Oracle's February 2026 order announcement describes ambient drafting for physician review and approval [O4]. August's documentation/coding announcement explicitly retains clinician review, confirmation, and signature [O8]. | Prepare clinical changes automatically; bind execution to a reviewed packet and authenticated physician approval. This does not imply that every administrative action requires a physician signature. |
| A formal governance framework proves bedside safety | The supplied Fierce article reports a structured pre-release review framework. That governance claim is distinct from task-specific clinician approval and from clinical validation. | Evaluate governance, output accuracy, review usability, and execution reliability separately. |
| Every trace and chart pull is mapped to the clinician's session token | I did not find an Oracle primary specification establishing this universal claim. The supplied Scalekit page could not be retrieved. A generic integration tutorial would not establish Oracle's implementation. | Specify audit attribution ourselves: clinician or service identity, patient/encounter, authorization scope, inputs, tool calls, versions, decisions, and dispatch receipts. Do not record bearer tokens in audit logs. |

The reviewed Oracle publications describe assistants that draft and surface actions. They do not justify describing the full platform as unrestricted autonomous clinical care. Product announcements and reported hours saved also cannot substitute for comparative clinical validation.

## Review of all ten supplied links

Duplicate references in the prompt were consolidated. Seven unique pages were accessible. The other three were attempted again and searched by exact URL or title; their full contents remain unreviewed. Access failures are not evidence that the missing documents never existed.

| Supplied source | Access and assessment |
| --- | --- |
| [Fierce: voice-first EHR debut](https://www.fiercehealthcare.com/health-tech/oracle-health-debuts-ai-powered-ehr-designed-voice-first-solution-embedded-agentic-ai) | Read. August 13, 2025 trade reporting on the new EHR and company positioning. The central architecture claims are corroborated by O1; quoted benefits remain vendor claims. |
| [Fierce: clinical, financial, and research AI](https://www.fiercehealthcare.com/health-tech/oracle-health-ai-clinical-financial-research) | Read. September 24, 2026 reporting spans new and existing products, roadmap expansion, orchestration, and a formal pre-release governance process. It should not be read as a single deployed technical specification. |
| [MedCloudInsider: cloud-native rebuild](https://medcloudinsider.com/articles/2026/07/29/oracle-health-cloud-native-ehr-rebuild.aspx) | Read. July 29, 2026 industry analysis places the rebuild within the vendor's commercial and migration challenges. Useful context; not evidence that clinical reliability or migration debt has been solved. |
| [Healthcare IT News: workflow capabilities](https://www.healthcareitnews.com/news/new-ai-capabilities-oracle-health-target-workflow-efficiencies) | Read. August 20, 2026 reporting on chart review, dictation, and coding. O8 supplies the primary announcement and explicit clinician review language. |
| [Seema Verma: AI-enabled healer](https://www.linkedin.com/pulse/oracle-health-ehr-physicians-ai-enabled-healer-seema-verma-csv8e) | Read. October 7, 2025 executive explanation explicitly names a knowledge graph and semantic index. Relevant first-party architectural intent; not an independent trial or detailed engineering specification. |
| [Replace the Humans: Clinical AI Agent](https://www.replacethehumans.com/agents/oracle-health-clinical-ai-agent) | Exact page failed retrieval on repeated attempts. The parent site was discoverable, but that does not validate this entry's contents. No conclusions depend on it. |
| [Oracle: August 2025 EHR announcement](https://www.oracle.com/news/announcement/oracle-ushers-in-new-era-of-ai-driven-electronic-health-records-2025-08-13/) | Read. Primary source for OCI, native orchestration, shared context, openness, and voice-first ambulatory availability. Benefit language is promotional and requires separate evaluation. |
| [Oracle: AI agents product page](https://www.oracle.com/health/clinical-suite/ai-agents/) | Read, including feature disclaimers. Distinguishes several clinical and patient capabilities from planned administrative/accounting features; regional and regulatory availability varies. |
| [Oracle: agentic AI healthcare PDF](https://www.oracle.com/a/ocom/docs/industries/healthcare/agentic-ai-for-healthcare.pdf) | Initially returned 404; a later attempt also failed. No accessible exact replacement was found. Approval claims were instead checked against O4 and O8. I cannot report having read this PDF. |
| [Scalekit: EHR integration for agents](https://www.scalekit.com/blog/ehr-integration-ai-agents-epic-cerner-fhir) | Exact page failed retrieval on repeated attempts. Related Scalekit authorization pages were discoverable, but they do not establish the supplied page's contents or Oracle's internal audit behavior. |

## Literature review and its design implications

This is a targeted literature review, not a systematic review or meta-analysis. Searches covered EHR usability and safety, randomized ambient-scribe studies, clinical decision support, virtual-EHR agents, and repeated-run reliability. Peer-reviewed primary studies receive more weight than company accounts or recent preprints. Earlier and later versions of the same study are not counted as separate evidence.

| Primary study | Result relevant to this design | Limits and implication |
| --- | --- | --- |
| Ratwani et al., JAMIA, 2018 [R1] | Physicians completed standardized tasks at four sites using two major EHR vendors. Time, clicks, and errors varied substantially; some tasks showed approximately eight-fold click and nine-fold time differences. | Simulation and older systems. Local implementation matters. Measure task success and error rates alongside clicks; collapsing everything into one screen can still create an unsafe interface. |
| Lukac et al., NEJM AI, 2025 [R2] | Three-arm pragmatic randomized trial of 238 outpatient physicians across 14 specialties. Nabla reduced time-in-note by 9.5% versus control; DAX's 1.7% reduction was not statistically significant. Clinicians reported occasional clinically significant inaccuracies. | Short, single-system trial with incomplete use across visits. Secondary well-being findings need confirmation. Evidence supports potential documentation benefits, not guaranteed fidelity or autonomous orders. Make correction easy and include correction time in evaluation. |
| Hager et al., Nature Medicine, 2024 [R3] | Evaluated information gathering and decisions using 2,400 abdominal-pain cases. Tested models showed failures in guideline adherence, laboratory interpretation, and sensitivity to input order and quantity. | Llama-2-era open models and a bounded simulated domain; this is not a current-model performance estimate. Evaluate the entire nephrology workflow, including retrieval and tool use, rather than infer readiness from medical exam scores. |
| Gaube et al., npj Digital Medicine, 2021 [R4] | Incorrect diagnostic advice impaired physicians' accuracy in an X-ray experiment, whether presented as human or AI advice. | Controlled decision-aid experiment, not an ambient-scribe trial. A physician approval button alone is insufficient: distinguish observed facts, stated intentions, and new recommendations, and expose their supporting evidence. |
| Jiang et al., MedAgentBench, NEJM AI, 2025 [R5] | Introduces a virtual FHIR-based EHR benchmark covering patient-specific multi-step tasks. | The accessible author manuscript describes 300 tasks and 100 patient profiles. The journal's full text was blocked during this review. This is a useful evaluation environment, not a prospective patient-outcome trial or a current-model leaderboard. |
| Chen et al., MedAgentBench v2, Pacific Symposium on Biocomputing, 2026 [R6] | Structured tools, prompt changes, and memory improved GPT-4.1 benchmark performance; reported success was 91% without memory and 98% with memory. | Benchmark-specific results, not a clinical safety rate, and not directly comparable with older models or a new local test set. Use typed tools and evaluate held-out tasks with memory leakage controls. |
| Bellibatlu et al., September 2026 preprint [R7] | Repeated identical-input runs in a subset of write-capable MedAgentBench tasks produced differing actions that a single benchmark verdict could conceal. | Not peer reviewed; two small quantized models and limited tasks. Treat as a testing hypothesis. Assess action stability and actual server outcomes over repeated runs, not only completion messages. |

Together these findings support carefully bounded preparation and a clearer review interface. They do not demonstrate that multi-agent delegation itself guarantees better clinical outcomes. Independent agents may reproduce the same source error or model bias. A second agent's agreement is not proof of correctness.

## Proposed appearance and interaction

The central object is the encounter, with preparation, capture, review, and completion in the same workspace. Office, hospital, dialysis, and transplant become context modes that adapt the clinical content. They should not require unrelated duplicate workflows.

| Screen area | Visible content | Purpose |
| --- | --- | --- |
| Compact work rail | Today's patients and items needing attention; selected patient identity | Maintain place and patient context. No separate launch button for every agent. |
| Encounter header | Persistent patient/encounter identity, setting, actual preparation state, capture state | Prevent wrong-patient work and make it clear whether audio is being captured, transcribed, or reviewed. |
| Clinical canvas | Reason for visit, concise longitudinal story, dated kidney trends, medications/allergies with reconciliation status, missing information | Keep clinical facts available without repeated chart navigation. Expand the source timeline and detailed records inline. |
| Note and plan | Familiar editable SOAP or problem-oriented note; physician template and detail preference; linked instructions and proposed actions | Support physician authorship. New suggestions remain visibly separate until accepted into the plan. |
| Attention and approval area | A small number of unresolved clinical questions, clear proposed action fields, and one exact-packet finalization action | Focus interaction on judgment and exceptions. Additional suggestions require explicit selection, and incomplete clinical actions cannot silently pass. |
| Voice control | Intentional capture start/stop, actual input-level meter, timer, plain-language status, keyboard alternative | Support voice navigation and documentation without implying that an idle animation is measuring a microphone. |

Avoid a chat-only chart: a physician should be able to scan laboratory values, chronology, and the proposed plan without asking successive questions. Voice queries should reveal those same clinical views. Avoid a large agent dashboard: it would replace form management with agent management. A compact encounter status can expand into task history when needed.

Keep the number of permanent controls small. Template/profile preferences are remembered, while note structure and output length remain adjustable. Automatic save needs an accurate saved/unsaved state and failure recovery. Regeneration produces a separately inspectable revision and protects physician edits. A physician's dictated plan, historical findings, extracted proposals, and guideline suggestions must carry distinct provenance even when displayed together.

The accompanying interactive concept illustrates a synthetic encounter after capture. It demonstrates inline source inspection, template/detail preferences, editing protection, and one missing order field resolved in place. Its controls do not record audio, call agents, persist records, sign an encounter, or transmit an order. Its synthetic values are illustrative, not guideline recommendations.

## The architecture behind the screen

Reuse the v9 hierarchy: encounter coordinator, chart organizer, scribe/extractor, evidence agent, note writer, orders/instructions agent, verifier, and follow-up service. Give the physician one encounter-level view of their results.

The semantic foundation should initially be a versioned encounter fact model, not an unrestricted vector store of chart text. Facts carry patient/encounter, source resource/revision, event time, acquisition time, original units, normalized terminology when valid, certainty, speaker, negation, and accepted/proposed status. Clinical relationships distinguish current medications from discontinued ones, historical results from new observations, and documented plans from model suggestions. Missing and conflicting data remains explicit.

Use scoped APIs and typed tools for read and draft actions. Keep permission checks, arithmetic/unit validation, signing, version gates, and dispatch authorization deterministic. Models may suggest actions but cannot expand their own permissions. Untrusted instructions in transcripts or retrieved documents remain source content.

FHIR Provenance and AuditEvent provide useful, distinct concepts for lineage and activity records [S1]. Our design also needs packet revisions, physician changes, approvals, exclusions, model/prompt identifiers, guideline editions/sections, and actual execution receipts. An audit record should store relevant inputs, outputs, and tool activity under appropriate access controls; it need not expose or retain private model chain-of-thought.

For guideline assistance, retrieve from an approved, versioned nephrology corpus. KDIGO currently identifies its 2024 CKD guideline as the global standard while a focused Chapter 3 update is underway [S2]. Record the source version and applicable section; do not assume a static guideline edition will stay current. A CKD stage label alone cannot determine every patient's workup. Intended orders and additional evidence-derived suggestions need separate labels and acceptance paths.

Preparation and execution need distinct durable states. A draft can be ready while an order is blocked. A signed encounter can coexist with an approved task awaiting dispatch. Preserve these distinctions so the UI never equates generated, approved, sent, and completed. An external delivery timeout remains uncertain until reconciled; retries require idempotency and duplicate prevention.

Phone alerts remain generic and deduplicated: “A clinical review is ready. Open your secure review queue.” Patient details appear only after authentication. Mobile approval must show and bind the current packet; an SMS reply does not authorize a signature. This remains a later integration, with no messaging provider or recipient configured by this proposal.

Before real PHI, assess all processing paths and service contracts. HHS requires appropriate BAAs and risk management for covered cloud processing; encrypted data and clinician oversight do not themselves establish compliance [S3]. This proposal continues the synthetic development scope.

## Relationship to what is implemented

v9A already coordinates preparation after saving reviewed source, presents editable drafts, preserves revisions, validates the exact reviewed version, and creates transactional simulated finalization receipts. The current flow still requires physician correction and saving of the reviewed transcript. Its preparation is bounded synchronous provider work with durable records, not a continuously running autonomous worker.

The v10 layout can reuse that implementation. Dedicated guideline retrieval, transcript-linked discrete extraction, new order generation, a durable background worker, external dispatch, and phone notifications are later work. A screen showing those concepts must label them as proposed or simulated until implemented. A visual redesign is not a reason to weaken existing assignment checks, signing contracts, item review, or source-version validation.

## Build sequence and acceptance

1. **v10A — encounter layout:** Move existing components into the continuous clinical canvas; keep patient identity persistent; show capture/draft destinations; use familiar SOAP editing and remembered profile preferences; retain required review/signature gates. Prototype locally and compare with v9A before replacing the published preview.
2. **v10B — evidence and intended orders:** Add transcript-linked facts, approved guideline retrieval, clear intent/suggestion separation, typed order fields, and synchronized instructions. Initially keep execution simulated. Validate each agent and the complete packet with nephrologist-reviewed cases.
3. **v10C — durable coordination and mobile review:** Add reliable background scheduling, cancellation/supersession, notification outbox, secure mobile packet review, and reconciled delivery status. Configure actual notifications only after provider and recipient setup.
4. **Later — authorized external integrations:** Evaluate production privacy/security readiness and connectors before releasing real orders or patient communications.

The evaluation unit is a completed clinical task. Compare the current and proposed views with counterbalanced scenario order and the same synthetic cases. Include straightforward follow-up, contradictory laboratory units, ambiguous transcript timing, medication correction, interrupted capture, unavailable evidence, stale drafts, and duplicate finalization.

Measure deliberate clicks/keystrokes, view transitions, search time, review/correction time, total time to a correctly finalized encounter, omissions and unsupported statements, clinically important errors accepted into the packet, workload ratings, and confidence in capture/draft location. Report medians and distributions; count automatic saves separately from physician interaction. A low click count with worse omissions fails acceptance.

Require no regression in patient isolation, authorization, edit preservation, stale-result rejection, rollback, or receipt idempotency. Test repeated identical inputs for divergent clinical actions and independently inspect persisted outcomes. Define clinical error thresholds and the evaluation sample with the physician before claiming reliability. No measured efficiency or safety improvement is claimed by this design document.

## Primary sources

- **O1:** Oracle, new EHR announcement, August 13, 2025. https://www.oracle.com/news/announcement/oracle-ushers-in-new-era-of-ai-driven-electronic-health-records-2025-08-13/
- **O2:** Seema Verma, *Oracle Health EHR for Physicians: The AI-Enabled Healer*, October 7, 2025. https://www.linkedin.com/pulse/oracle-health-ehr-physicians-ai-enabled-healer-seema-verma-csv8e
- **O3:** Oracle Health AI Agents product page, accessed October 4, 2026. https://www.oracle.com/health/clinical-suite/ai-agents/
- **O4:** Oracle, order creation announcement, February 2, 2026. https://www.oracle.com/news/announcement/oracle-health-adds-order-creation-capabilities-to-clinical-ai-agent-2026-02-02/
- **O5:** Oracle, nursing AI in Foundation EHR, September 14, 2026. https://www.oracle.com/news/announcement/oracle-health-clinical-ai-agent-helps-nurses-alleviate-documentation-burden-and-streamline-care-2026-09-14/
- **O6:** Oracle, revenue cycle announcement, September 23, 2026. https://www.oracle.com/news/announcement/oracle-health-advances-revenue-cycle-management-with-ai-2026-09-23/
- **O7:** Oracle, Intelligent Prior Authorization release 26.04. https://docs.oracle.com/en/industries/health/claims-prior-authorizations-payments/cpprn/intelligent-prior-authorization-26-04.html
- **O8:** Oracle, coding, dictation, and chart review, August 19, 2026. https://www.oracle.com/news/announcement/oracle-health-expands-clinical-ai-agent-with-coding-dictation-chart-review-2026-08-19/
- **R1:** Ratwani et al. *A usability and safety analysis of electronic health records: a multi-center study.* JAMIA 2018;25:1197–1201. https://pubmed.ncbi.nlm.nih.gov/29982549/
- **R2:** Lukac et al. *Ambient AI Scribes in Clinical Practice: A Randomized Trial.* NEJM AI 2025;2(12). Published online November 26, 2025. DOI:10.1056/AIoa2501000. https://pubmed.ncbi.nlm.nih.gov/41497288/
- **R3:** Hager et al. *Evaluation and mitigation of the limitations of large language models in clinical decision-making.* Nature Medicine 2024;30:2613–2622. https://www.nature.com/articles/s41591-024-03097-1
- **R4:** Gaube et al. *Do as AI say: susceptibility in deployment of clinical decision-aids.* npj Digital Medicine 2021;4:31. https://www.nature.com/articles/s41746-021-00385-9
- **R5:** Jiang et al. *MedAgentBench: A Virtual EHR Environment to Benchmark Medical LLM Agents.* NEJM AI 2025;2(9), published online August 14, 2025. https://doi.org/10.1056/AIdbp2500144 ; accessible author manuscript: https://arxiv.org/abs/2501.14654 ; author code: https://github.com/stanfordmlgroup/MedAgentBench
- **R6:** Chen et al. *MedAgentBench v2: Improving Medical LLM Agent Design.* Pacific Symposium on Biocomputing 2026;31:354–371. https://pubmed.ncbi.nlm.nih.gov/41758153/
- **R7:** Bellibatlu et al. *Same Patient, Different Order: Action-Level Reliability of Clinical LLM Agents Under Repeated Runs.* September 2026 preprint; not peer reviewed. https://arxiv.org/abs/2609.13582
- **S1:** HL7 FHIR R4, Provenance and its relationship to AuditEvent. https://hl7.org/fhir/R4/provenance.html
- **S2:** KDIGO, CKD Evaluation and Management guideline and focused update status, accessed October 4, 2026. https://kdigo.org/guidelines/ckd-evaluation-and-management/
- **S3:** HHS, Guidance on HIPAA and Cloud Computing. https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html
