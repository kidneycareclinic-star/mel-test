-- Synthetic-only coordinator. No external execution or notification delivery.
create table ehr.encounter_preparation (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ehr.patient(id),
  encounter_id uuid not null references ehr.synthetic_encounter(id),
  clinician_principal_id uuid not null references iam.principal(id),
  source_version int not null,
  state_version bigint not null,
  source_hash text not null,
  preferences jsonb not null check(jsonb_typeof(preferences)='object'),
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  status text not null default 'preparing' check(status in ('preparing','ready','failed','superseded','finalized')),
  packet jsonb check(packet is null or jsonb_typeof(packet)='object'),
  packet_hash text,
  error_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '2 hours'),
  completed_at timestamptz,
  check(status not in ('ready','finalized') or (packet is not null and packet_hash is not null))
);
create index encounter_preparation_owner on ehr.encounter_preparation(patient_id,clinician_principal_id,created_at desc);
create unique index encounter_preparation_active on ehr.encounter_preparation(encounter_id) where status='preparing';
create table ehr.encounter_approval_receipt (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null unique references ehr.encounter_preparation(id),
  patient_id uuid not null references ehr.patient(id),
  encounter_id uuid not null unique references ehr.synthetic_encounter(id),
  clinician_principal_id uuid not null references iam.principal(id),
  idempotency_key uuid not null,
  request_hash text not null,
  packet_hash text not null,
  reviewed_snapshot jsonb not null check(jsonb_typeof(reviewed_snapshot)='object'),
  event_id uuid not null references ehr.event(id),
  completion_id uuid not null references ehr.encounter_completion(id),
  state_version bigint not null,
  created_at timestamptz not null default now(),
  unique(clinician_principal_id,idempotency_key)
);
alter table ehr.encounter_preparation enable row level security;
alter table ehr.encounter_approval_receipt enable row level security;
revoke all on ehr.encounter_preparation,ehr.encounter_approval_receipt from public,anon,authenticated;
create function ehr.guard_encounter_preparation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'preparation_history_is_retained'; end if;
  if (NEW.patient_id,NEW.encounter_id,NEW.clinician_principal_id,NEW.source_version,NEW.state_version,NEW.source_hash,NEW.preferences,NEW.source_snapshot,NEW.created_at,NEW.expires_at)
    is distinct from (OLD.patient_id,OLD.encounter_id,OLD.clinician_principal_id,OLD.source_version,OLD.state_version,OLD.source_hash,OLD.preferences,OLD.source_snapshot,OLD.created_at,OLD.expires_at) then
    raise exception 'preparation_source_is_immutable';
  end if;
  if OLD.status<>'preparing' and (NEW.packet,NEW.packet_hash) is distinct from (OLD.packet,OLD.packet_hash) then raise exception 'review_packet_is_immutable'; end if;
  if not ((OLD.status='preparing' and NEW.status in ('ready','failed','superseded')) or (OLD.status='ready' and NEW.status in ('finalized','superseded'))) then raise exception 'invalid_preparation_transition'; end if;
  return NEW;
end; $$;
create trigger guard_encounter_preparation before update or delete on ehr.encounter_preparation for each row execute function ehr.guard_encounter_preparation();
create function ehr.preserve_encounter_receipt() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'approval_receipt_is_immutable'; end; $$;
create trigger preserve_encounter_receipt before update or delete on ehr.encounter_approval_receipt for each row execute function ehr.preserve_encounter_receipt();
revoke all on function ehr.guard_encounter_preparation(),ehr.preserve_encounter_receipt() from public,anon,authenticated;
-- Append-only physician draft revisions; no clinical approval occurs on autosave.
create table ehr.encounter_packet_edit (
  preparation_id uuid not null references ehr.encounter_preparation(id),
  version int not null check(version>0),
  clinician_principal_id uuid not null references iam.principal(id),
  reviewed_snapshot jsonb not null check(jsonb_typeof(reviewed_snapshot)='object'),
  created_at timestamptz not null default now(),
  primary key(preparation_id,version)
);
alter table ehr.encounter_packet_edit enable row level security;
revoke all on ehr.encounter_packet_edit from public,anon,authenticated;
create trigger preserve_encounter_packet_edit before update or delete on ehr.encounter_packet_edit for each row execute function ehr.preserve_encounter_receipt();
