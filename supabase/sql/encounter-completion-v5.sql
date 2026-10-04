-- Encounter Completion v5. All writes are synthetic, assigned-clinician gated.
create table ehr.encounter_completion (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ehr.patient(id),
  encounter_id uuid not null unique references ehr.synthetic_encounter(id),
  clinician_principal_id uuid not null references iam.principal(id),
  source_state_version bigint not null,
  source_state jsonb not null check(jsonb_typeof(source_state)='object'),
  generated_content jsonb not null check(jsonb_typeof(generated_content)='object'),
  note_text text not null check(char_length(note_text)<=60000),
  patient_instructions text not null check(char_length(patient_instructions)<=40000),
  status text not null default 'draft' check(status in ('draft','approved')),
  version integer not null default 1 check(version>0),
  approved_by_id text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(patient_id,source_state_version) references ehr.patient_state(patient_id,state_version),
  check((status='draft' and approved_at is null and approved_by_id is null) or
        (status='approved' and approved_at is not null and approved_by_id is not null))
);
create index encounter_completion_patient_owner on ehr.encounter_completion(patient_id,clinician_principal_id,created_at desc);

create table ehr.encounter_completion_item (
  id uuid primary key default gen_random_uuid(),
  completion_id uuid not null references ehr.encounter_completion(id),
  kind text not null check(kind in ('lab','medication','referral','follow-up')),
  label text not null check(char_length(trim(label)) between 1 and 240),
  details text not null default '' check(char_length(details)<=4000),
  due_date date,
  status text not null default 'pending' check(status in ('pending','approved','rejected','completed','cancelled')),
  reviewed_by_id text,
  reviewed_at timestamptz,
  completion_note text not null default '' check(char_length(completion_note)<=2000),
  resolved_by_id text,
  resolved_at timestamptz,
  simulated boolean not null default true check(simulated=true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((status='pending' and reviewed_by_id is null and reviewed_at is null) or
        (status<>'pending' and reviewed_by_id is not null and reviewed_at is not null)),
  check((status in ('completed','cancelled') and resolved_by_id is not null and resolved_at is not null and char_length(trim(completion_note))>0) or
        (status not in ('completed','cancelled') and resolved_by_id is null and resolved_at is null))
);
create index encounter_completion_item_parent on ehr.encounter_completion_item(completion_id,created_at,id);

create table ehr.encounter_completion_history (
  id uuid primary key default gen_random_uuid(),
  completion_id uuid not null references ehr.encounter_completion(id),
  event_id uuid not null unique references ehr.event(id),
  version integer not null check(version>0),
  action text not null,
  actor_id text not null,
  before_snapshot jsonb check(before_snapshot is null or jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb not null check(jsonb_typeof(after_snapshot)='object'),
  created_at timestamptz not null default now(),
  unique(completion_id,version)
);

alter table ehr.encounter_completion enable row level security;
alter table ehr.encounter_completion_item enable row level security;
alter table ehr.encounter_completion_history enable row level security;
revoke all on ehr.encounter_completion,ehr.encounter_completion_item,ehr.encounter_completion_history from public,anon,authenticated;

create function ehr.guard_completion() returns trigger language plpgsql security invoker set search_path='' as $$
declare e ehr.synthetic_encounter%rowtype; pending_count integer;
begin
  if TG_OP='DELETE' then raise exception 'completion_history_is_retained'; end if;
  if TG_OP='INSERT' then
    select * into e from ehr.synthetic_encounter where id=NEW.encounter_id;
    if e.status is distinct from 'signed' or e.patient_id is distinct from NEW.patient_id or
       e.clinician_principal_id is distinct from NEW.clinician_principal_id or
       e.final_state_version is distinct from NEW.source_state_version then
      raise exception 'signed_encounter_required';
    end if;
    if NEW.source_state is distinct from (select coalesce(a.resulting_state,s.state)
      from ehr.patient_state s left join ehr.patient_state_audit a on a.patient_id=s.patient_id and a.resulting_version=s.state_version
      where s.patient_id=NEW.patient_id and s.state_version=NEW.source_state_version) then
      raise exception 'signed_snapshot_mismatch';
    end if;
    if NEW.status<>'draft' or NEW.version<>1 then raise exception 'initial_completion_must_be_draft'; end if;
    return NEW;
  end if;
  if (NEW.patient_id,NEW.encounter_id,NEW.clinician_principal_id,NEW.source_state_version,NEW.source_state,NEW.generated_content,NEW.created_at)
    is distinct from (OLD.patient_id,OLD.encounter_id,OLD.clinician_principal_id,OLD.source_state_version,OLD.source_state,OLD.generated_content,OLD.created_at) then
    raise exception 'completion_source_is_immutable';
  end if;
  if NEW.version<>OLD.version+1 then raise exception 'completion_version_must_advance_once'; end if;
  if OLD.status='approved' and (NEW.status,NEW.note_text,NEW.patient_instructions,NEW.approved_at,NEW.approved_by_id)
    is distinct from (OLD.status,OLD.note_text,OLD.patient_instructions,OLD.approved_at,OLD.approved_by_id) then
    raise exception 'approved_completion_is_immutable';
  end if;
  if NEW.status='approved' and OLD.status='draft' then
    if char_length(trim(NEW.note_text))=0 or char_length(trim(NEW.patient_instructions))=0 then raise exception 'completion_content_required'; end if;
    select count(*) into pending_count from ehr.encounter_completion_item where completion_id=NEW.id and status='pending';
    if pending_count>0 then raise exception 'completion_item_review_required'; end if;
  end if;
  return NEW;
end;
$$;
create trigger guard_completion before insert or update or delete on ehr.encounter_completion for each row execute function ehr.guard_completion();

create function ehr.guard_completion_item() returns trigger language plpgsql security invoker set search_path='' as $$
declare package_status text;
begin
  if TG_OP='DELETE' then raise exception 'completion_items_are_retained'; end if;
  select status into package_status from ehr.encounter_completion where id=NEW.completion_id;
  if TG_OP='INSERT' then
    if package_status is distinct from 'draft' or NEW.status<>'pending' then raise exception 'draft_package_required'; end if;
    return NEW;
  end if;
  if (NEW.completion_id,NEW.kind,NEW.label,NEW.details,NEW.due_date,NEW.simulated,NEW.created_at)
    is distinct from (OLD.completion_id,OLD.kind,OLD.label,OLD.details,OLD.due_date,OLD.simulated,OLD.created_at) then
    raise exception 'reviewed_item_content_is_immutable';
  end if;
  if not ((package_status='draft' and OLD.status='pending' and NEW.status in ('approved','rejected')) or
          (package_status='approved' and OLD.status='approved' and NEW.status in ('completed','cancelled'))) then
    raise exception 'invalid_completion_item_transition';
  end if;
  if OLD.status='approved' and (NEW.reviewed_at,NEW.reviewed_by_id) is distinct from (OLD.reviewed_at,OLD.reviewed_by_id) then
    raise exception 'item_review_is_immutable';
  end if;
  return NEW;
end;
$$;
create trigger guard_completion_item before insert or update or delete on ehr.encounter_completion_item for each row execute function ehr.guard_completion_item();

create function ehr.preserve_completion_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'completion_history_is_immutable'; end;
$$;
create trigger preserve_completion_history before update or delete on ehr.encounter_completion_history for each row execute function ehr.preserve_completion_history();
revoke all on function ehr.guard_completion(),ehr.guard_completion_item(),ehr.preserve_completion_history() from public,anon,authenticated;
