# Durable encounter preparation (v11)

Saving physician-reviewed synthetic encounter text now queues preparation in the same database transaction. The browser no longer owns a model request. A private scheduled dispatcher sends a short-lived, single-use capability to a background worker; each request completes one stage: chart assembly, bounded clinical references, note writing, action extraction, and source verification.

The note and action stages use separate OpenAI Responses requests with strict schemas, `store:false`, and the existing model settings. Reference review uses the existing starter KDIGO corpus; it is not a clinically validated guideline recommendation engine. No clinical orders, prescriptions, patient messages, or phone alerts are released by this worker.

Completed stage outputs are immutable checkpoints. Provider failures retry at most three times per stage; a paused job can be resumed explicitly, up to thirty total attempts and a two-hour expiry. Expired worker leases are recovered by the scheduler. Random lease tokens fence late results; changes to the encounter, chart snapshot, preferences, or clinician access prevent publication. A lost transient HTTP dispatch is reissued from the durable queue.

The main patient screen polls scoped job metadata and maps actual stages to the existing agent dots. It resumes polling when the page returns. Preferences persist against the authenticated physician account and are captured for each queued job. Changing preferences in the active patient requeues that patient’s current draft. Saved note and instruction edits from a superseded preparation are available when a refreshed packet is loaded; action decisions and instruction confirmation require renewed review. Finalization still uses the existing authenticated, version-checked, atomic signing transaction and immutable receipt.

## Deployment

Apply `supabase/sql/encounter-orchestrator-v11.sql` with dispatch disabled. Deploy the authenticated coordinator with JWT verification enabled. Deploy `encounter-worker/index.ts` and its relative coordinator dependencies; the worker implements custom dispatch authentication, so platform JWT verification is disabled for that worker only. Apply `encounter-orchestrator-scheduler-v11.sql` to enable pg_cron, pg_net, the fixed endpoint, and a ten-second dispatch schedule. Pause dispatch by setting the private config's `enabled` field to false. No browser service key or stored clinician session token is needed.

Private RLS tables have no public, anon, or authenticated grants. All new SQL functions are security invoker functions with an empty search path and revoked public execution. Dispatch payloads contain only the dispatch ID, and responses contain no clinical data. Clinical audit records contain stage, status, attempt and safe error codes; bearer values are never returned or written into these records. The transient private pg_net request holds the short-lived bearer while the request is sent.

## Verification

The disposable PostgreSQL 17 suite exercises source-trigger enqueue, source-bound checkpoints, interrupted-worker recovery, simultaneous claims, scheduler-to-worker authentication, absolute job deadlines, used/forged/expired dispatch credentials, bounded retries and continuation without rewriting a completed note, source/profile changes, patient binding, revoked access, inherited edits, private grants and append-only history. Existing signing, clinical-state reducer, rollback, replay and action-review gates remain covered. OpenAI outputs in these tests are mocked; these checks do not establish clinical accuracy or HIPAA compliance.
