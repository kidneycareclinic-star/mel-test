# Nephrology Agentic Harness — deployed backend contract

Updated: 2026-09-28

## Supabase project

- Project: `nephrology-agentic-harness-dev`
- Project ref: `excqvjpsmdxzhujsbkmz`
- Region: `us-east-1`
- Data: synthetic development data only
- Operational schema: private `ehr`
- Browser roles do not have direct table access.

## Canonical write model

```text
source / scribe / agent
        ↓
append-only event + provenance
        ↓
canonical tables
        ↓
ehr.reduce_patient_state(...)
        ↓
versioned ehr.patient_state
```

Agents and frontend code must not directly create a new Patient State JSON snapshot.

## Scribe workflow

```text
ambient speech
  ↓
deterministic normalization/extraction
  ↓
ambient-scribe-write
  ↓
ehr.proposed_observation (PROPOSED)
  ↓
physician review: accept / edit / reject
  ↓
scribe-review
  ↓
ehr.clinical_observation
  ↓
SCRIBE_REVIEW_DECIDED event
  ↓
ehr.reduce_patient_state
  ↓
Patient State vN+1
```

Rejected observations never enter `ehr.clinical_observation` and do not create a new Patient State version.
`scribe-review-v2` validates every proposal before recording a decision event. Blank numeric
edits, duplicate IDs, and proposals already decided fail the whole batch; stale queues return
HTTP 409. Accepted edits retain original and reviewed values in proposal metadata for audit.

## Agent workflow

Current operational review agents:

- CKD review agent
- Dialysis review agent
- Hospital nephrology review agent

They are deterministic review agents over canonical Patient State. They do not prescribe and do not directly mutate Patient State.

```text
workspace-review
  ↓
ehr.agent_run
  ↓
AGENT_RUN_COMPLETED event
  ↓
ehr.tool_call(create_open_loop)
  status = awaiting_approval
  ↓
physician Approve / Reject
```

Approved `create_open_loop`:

```text
PHYSICIAN_APPROVAL_GRANTED
  ↓
TOOL_ACTION_EXECUTED
  ↓
ehr.open_loop
  ↓
ehr.reduce_patient_state
  ↓
Patient State vN+1
```

Rejected proposals are audited and create no state change.

## Tool registry

Current registered tools:

| Tool | Risk | Approval | Execution |
|---|---|---|---|
| `create_open_loop` | low | required | internal |
| `prepare_followup_lab_order` | moderate | required | external-preparation only |
| `prepare_followup_appointment` | low | required | external-preparation only |

`create_open_loop`, `prepare_followup_lab_order`, and `prepare_followup_appointment` can now complete an internal approval workflow. The two follow-up tools create preparation artifacts/open loops only; their outputs explicitly record `externalExecution=false` and they do not place orders or schedule appointments externally.

## Core tables

- `ehr.patient`
- `ehr.provenance`
- `ehr.event` — append-only
- `ehr.clinical_observation`
- `ehr.proposed_observation`
- `ehr.medication`
- `ehr.problem`
- `ehr.open_loop`
- `ehr.patient_state`
- `ehr.agent_run`
- `ehr.tool_registry`
- `ehr.tool_call`
- `ehr.approval`
- `ehr.document`

## Database invariants

- `ehr.event` is append-only.
- `ehr.patient_state.state` must be a JSON object.
- Patient State is derived/cache state, not source of truth.
- Browser roles do not directly access clinical tables.
- High-risk/external actions are not enabled.
- Synthetic patient records only.

## Reducer

Function:

```text
ehr.reduce_patient_state(patient_id, source_event_id, reducer_version)
```

Current version:

```text
patient-state-reducer-v1
```

The reducer currently refreshes:

- patient identity
- active medications
- active problem list
- latest structured numeric observations
- longitudinal lab histories
- current eGFR
- UACR / UPCR
- potassium / bicarbonate
- hemoglobin
- phosphate
- blood-pressure history
- open loops
- accepted scribe observations
- reducer metadata

## Deployed Edge Functions

| Function | Version | Purpose |
|---|---:|---|
| `synthetic-census` | 2 | read latest Patient State for synthetic census |
| `ambient-scribe-write` | 8 | create proposed observations only |
| `scribe-review` | 2 | physician accept/edit/reject + atomic review validation + reducer |
| `workspace-review` | 4 | CKD/Dialysis/Hospital review + low-risk approval workflow |
| `patient-activity-audit` | 2 | event/provenance/agent/tool/approval/open-loop audit |
| `synthetic-patient` | 2 | retired legacy endpoint; HTTP 410 |
| `synthetic-census-gated` | 2 | authenticated assigned-patient census (staged) |
| `ambient-scribe-write-gated` | 2 | authenticated observation proposals (staged) |
| `scribe-review-gated` | 2 | authenticated physician review (staged) |
| `workspace-review-gated` | 2 | authenticated agent/approval flow (staged) |
| `patient-activity-audit-gated` | 2 | authenticated audit read (staged) |

## Frontend workflow modules

- `backend-patient-loader.js`
- `prechart-workspace.js`
- `scribe-review-ui.js`
- `workspace-review-ui.js`
- `activity-audit-ui.js`

## CI contracts

`.github/workflows/harness-contract-tests.yml` checks:

- JavaScript syntax
- proposal-first scribe language
- no direct Patient State replacement from the proposal writer
- scribe-review wiring
- CKD/Dialysis/Hospital workspace-review wiring
- PostgreSQL census loader
- absence of service-role credentials in frontend code
- browser fixture ownership rules
- scribe review safety checks for blank edits, duplicate decisions, and stale proposals

## Next production-oriented backend steps

### Clinician gateway staging (2026-09-28)

Five `*-gated` Edge Functions are deployed beside the existing demo endpoints. They ask
Supabase Auth to verify the user, require a linked active synthetic clinician, check
practice and patient assignment and action permission, and record access decisions.
The legacy `synthetic-patient` route now returns HTTP 410. A confirmed development
clinician Auth account is linked to its synthetic assignment, and the published
`/preview/` browser path shows clinician sign-in and uses
the gated functions. See `docs/clinician-gateway-cutover.md` for activation and
legacy-route retirement. The existing demo endpoints remain active until the cutover
is verified.


1. Move from static GitHub Pages + Edge Functions to FastAPI service boundary.
2. Replace legacy anon JWT use with production auth/session handling.
3. Introduce user/tenant/practice authorization and ABAC.
4. Add real integration tests against an isolated Supabase branch.
5. Add outbound EHR tool adapters only after policy/approval/audit controls are enforced.
6. Keep order placement, medication changes, and external execution disabled until authenticated clinical integrations exist.
