-- Immutable command/context and proposed content; approval appends one reviewed draft revision.
create table ehr.encounter_revision_proposal (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references ehr.patient(id),
 clinician_principal_id uuid not null references iam.principal(id),encounter_id uuid not null references ehr.synthetic_encounter(id),
 preparation_id uuid not null references ehr.encounter_preparation(id),source_version int not null check(source_version>0),
 packet_hash text not null,base_review_version int not null check(base_review_version>0),base_hash text not null,
 command text not null check(length(command) between 1 and 4000),before_snapshot jsonb not null check(jsonb_typeof(before_snapshot)='object'),
 after_snapshot jsonb check(after_snapshot is null or jsonb_typeof(after_snapshot)='object'),changes jsonb check(changes is null or jsonb_typeof(changes)='array'),
 model text,clarification text,error_code text,status text not null default 'preparing' check(status in ('preparing','pending','applied','discarded','failed','clarified')),
 applied_review_version int,created_at timestamptz not null default now(),expires_at timestamptz not null,updated_at timestamptz not null default now(),
 check(status not in ('pending','applied','discarded') or (after_snapshot is not null and changes is not null and jsonb_array_length(changes)>0)),
 check((status='applied')=(applied_review_version is not null)),unique(preparation_id,applied_review_version)
);
create index revision_proposal_owner on ehr.encounter_revision_proposal(clinician_principal_id,created_at desc);
create index revision_proposal_patient on ehr.encounter_revision_proposal(patient_id);
create index revision_proposal_encounter on ehr.encounter_revision_proposal(encounter_id);
create index revision_proposal_preparation on ehr.encounter_revision_proposal(preparation_id,base_review_version);
alter table ehr.encounter_revision_proposal enable row level security;
revoke all on ehr.encounter_revision_proposal from public,anon,authenticated;
create function ehr.preserve_revision_proposal() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'revision_proposal_is_retained'; end if;
 if (NEW.id,NEW.patient_id,NEW.clinician_principal_id,NEW.encounter_id,NEW.preparation_id,NEW.source_version,NEW.packet_hash,NEW.base_review_version,NEW.base_hash,NEW.command,NEW.before_snapshot,NEW.created_at,NEW.expires_at)
  is distinct from (OLD.id,OLD.patient_id,OLD.clinician_principal_id,OLD.encounter_id,OLD.preparation_id,OLD.source_version,OLD.packet_hash,OLD.base_review_version,OLD.base_hash,OLD.command,OLD.before_snapshot,OLD.created_at,OLD.expires_at) then raise exception 'revision_context_is_immutable'; end if;
 if OLD.status<>'preparing' and (NEW.after_snapshot,NEW.changes,NEW.model,NEW.clarification,NEW.error_code) is distinct from (OLD.after_snapshot,OLD.changes,OLD.model,OLD.clarification,OLD.error_code) then raise exception 'revision_content_is_immutable'; end if;
 if not ((OLD.status='preparing' and NEW.status in ('pending','failed','clarified')) or (OLD.status='pending' and NEW.status in ('applied','discarded'))) then raise exception 'revision_status_is_terminal'; end if;
 return NEW;
end; $$;
create trigger preserve_revision_proposal before update or delete on ehr.encounter_revision_proposal for each row execute function ehr.preserve_revision_proposal();
revoke all on function ehr.preserve_revision_proposal() from public,anon,authenticated;
