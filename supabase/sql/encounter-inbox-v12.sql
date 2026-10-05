-- Seen state is a navigation receipt, never clinical approval.
create table ehr.encounter_inbox_seen (
  job_id uuid not null references ehr.encounter_job(id),
  clinician_principal_id uuid not null references iam.principal(id),
  revision text not null check(length(revision) between 1 and 100),
  seen_at timestamptz not null default now(),
  primary key(job_id,clinician_principal_id)
);
create index encounter_inbox_seen_owner on ehr.encounter_inbox_seen(clinician_principal_id);
alter table ehr.encounter_inbox_seen enable row level security;
revoke all on ehr.encounter_inbox_seen from public,anon,authenticated;
