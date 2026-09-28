# Nephrology Agentic Harness API

FastAPI service boundary for the Nephrology Agentic Harness.

## Current milestone

The service provides the first production-style boundary between the browser and the clinical database.

Current endpoints:

- `GET /health`
- `GET /v1/me`
- `GET /v1/patients?workspace=office`
- `GET /v1/patients/{patient_id}/state?workspace=office`

## Identity and authorization

All patient routes require a Bearer access token issued by Supabase Auth. The service asks
the project's Auth `/auth/v1/user` endpoint to validate the token on every request. The returned
Auth user ID must match an **active, synthetic clinician** in `iam.principal.auth_user_id`.
The older `X-Dev-Principal` header no longer grants access. Missing Auth configuration fails
closed with HTTP 503; a missing or invalid session returns HTTP 401; an unlinked Auth user
returns HTTP 403. Browser code must never receive the database password.

The development database currently has one synthetic clinician record but no Auth user or
linked `auth_user_id`. No one can use the gateway until a clinician Auth account is created
and explicitly linked to the intended `iam.principal` row. Do not enable open sign-up for
clinical accounts. The existing public preview still calls synthetic-only Edge Functions;
this backend has not yet been deployed or wired into that preview.

The database authorization model checks:

1. active principal
2. active practice membership
3. active patient assignment
4. requested workspace
5. action-specific permission

Patient-specific decisions are written to `iam.access_audit`.
Assigned census reads are also audited. All gateway patient queries are restricted to
synthetic records.

## Architecture

```text
Browser
  ↓
FastAPI Harness Service
  ↓
Identity
  ↓
Policy Engine
  ↓
Patient assignment / workspace / permission check
  ↓
PostgreSQL
```

The current GitHub Pages prototype still uses Supabase Edge Functions while this service is being built and tested. It has not yet been cut over to FastAPI.

## Local development

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set DATABASE_URL, SUPABASE_URL, and SUPABASE_PUBLISHABLE_KEY locally.
# Never commit credentials.
uvicorn app.main:app --reload
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

Once the Auth user is linked, an authenticated read looks like:

```bash
curl \
  -H "Authorization: Bearer <clinician access token>" \
  "http://127.0.0.1:8000/v1/patients?workspace=office"
```

## Important security boundary

This slice covers authenticated read access and auditing. Before routing review decisions or
agent approvals through FastAPI, those actions need per-action authorization and the old
anonymous-token write routes must be disabled or secured. No real-patient use is enabled.

Never place the database password, service-role key, or other secret in browser code.
