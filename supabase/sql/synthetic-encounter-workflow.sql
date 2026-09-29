-- Development-only synthetic encounter workflow. Apply once to the synthetic project.
-- Private schema: only the server-side Edge Function database connection may read it.
create table if not exists ehr.synthetic_encounter (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ehr.patient(id),
  clinician_principal_id uuid not null references iam.principal(id),
  status text not null default 'draft' check (status in ('draft','signed')),
  note_text text not null default '' check (char_length(note_text) <= 20000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  base_state_version bigint not null check (base_state_version >= 1),
  final_state_version bigint,
  version integer not null default 1 check (version >= 1),
  draft_event_id uuid references ehr.event(id),
  signed_event_id uuid references ehr.event(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  signed_at timestamptz,
  constraint signed_encounter_complete check (
    (status = 'draft' and signed_at is null and signed_event_id is null and final_state_version is null)
    or (status = 'signed' and signed_at is not null and signed_event_id is not null and final_state_version is not null)
  )
);
create unique index if not exists synthetic_encounter_one_draft
  on ehr.synthetic_encounter(patient_id, clinician_principal_id) where status = 'draft';
create index if not exists synthetic_encounter_patient_recent
  on ehr.synthetic_encounter(patient_id, created_at desc);
alter table ehr.synthetic_encounter enable row level security;
revoke all on ehr.synthetic_encounter from public, anon, authenticated;

alter table ehr.proposed_observation
  add column if not exists encounter_id uuid references ehr.synthetic_encounter(id);
create index if not exists proposed_observation_encounter_queue
  on ehr.proposed_observation(encounter_id, status) where encounter_id is not null;

-- The single existing synthetic clinician gets only the two encounter actions.
update iam.practice_membership pm
set permissions = jsonb_set(
  jsonb_set(pm.permissions, '{encounter.draft}', 'true'::jsonb, true),
  '{encounter.sign}', 'true'::jsonb, true
)
from iam.principal p
where pm.principal_id = p.id and p.external_id = 'SYN-CLINICIAN-001'
  and p.active and p.synthetic and pm.active and pm.role = 'physician';
