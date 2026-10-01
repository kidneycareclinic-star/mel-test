# Astra Ultrafast EHR gateway

Status: synthetic development only.

## Purpose

`astra-review-gated` proves the OpenAI GPT-6 Astra Ultrafast path end to end without bypassing the existing clinician gateway or physician approval model.

```text
signed-in synthetic clinician
        ↓
assigned synthetic patient
        ↓
canonical Patient State vN
        ↓
astra-review-gated
        ↓
GPT-6 Astra / service_tier=ultrafast
        ↓
strict structured review
        ↓
ehr.agent_run + AGENT_RUN_COMPLETED
        ↓
optional create_open_loop proposal
status = awaiting_approval
        ↓
physician Approve / Reject
        ↓
workspace-review-gated
        ↓
only after approval: open loop + reducer → Patient State vN+1
```

Astra never writes Patient State directly. A proposed open loop records the Patient State version used to generate it. Approval returns HTTP 409 `stale_agent_proposal` if Patient State changed before the physician acted.

## Server secret required

The Edge Function reads `OPENAI_API_KEY` from the Supabase Edge Function environment. Never place the key in GitHub, browser JavaScript, or a request body.

In the Supabase dashboard for `nephrology-agentic-harness-dev`:

1. Open **Edge Functions → Secrets**.
2. Add secret name `OPENAI_API_KEY`.
3. Paste the API key created in the **Nephrology-EHR-Development** OpenAI API project.
4. Save.

Supabase makes updated function secrets available without embedding them in source code.

## Ultrafast proof

Each successful review records and returns:

- requested service tier: `ultrafast`
- actual service tier reported by OpenAI
- `ultrafastVerified` boolean
- model name
- latency in milliseconds
- OpenAI request ID and response ID
- token usage when returned
- Patient State version used for inference

The browser displays the actual tier and latency. Do not declare the proof complete unless `ultrafastVerified=true`.

## Safety boundary

- Synthetic patients only.
- Authenticated clinician session required.
- Active patient assignment and `agent.review` permission required.
- OpenAI key remains server-side.
- OpenAI request storage is disabled in the request.
- Structured model output cannot directly mutate Patient State.
- Only `create_open_loop` is permitted from the Astra proposal path.
- Physician approval remains mandatory.
- Stale proposals cannot execute.
- Medication changes, orders, scheduling, and external actions remain disabled.

## Verification

Run:

```bash
node scripts/astra-gateway-tests.mjs
node scripts/harness-contract-tests.mjs
```

Then perform one signed-in browser run from the preview and confirm the UI reports **Astra · Ultrafast verified**.
