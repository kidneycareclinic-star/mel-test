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

Development currently uses one explicitly synthetic clinician identity:

`SYN-CLINICIAN-001`

The development identity adapter works only when:

`ENVIRONMENT=development`

The database authorization model checks:

1. active principal
2. active practice membership
3. active patient assignment
4. requested workspace
5. action-specific permission

Patient-specific decisions are written to `iam.access_audit`.

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
# Add a development DATABASE_URL locally. Never commit credentials.
uvicorn app.main:app --reload
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

Development identity example:

```bash
curl \
  -H "X-Dev-Principal: SYN-CLINICIAN-001" \
  "http://127.0.0.1:8000/v1/patients?workspace=office"
```

## Important security boundary

The development header is not production authentication.

Before any real-patient use, replace it with a validated identity provider/session and enforce user/practice authorization for every patient and action.

Never place the database password, service-role key, or other secret in browser code.
