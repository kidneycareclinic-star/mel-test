-- Durable, synthetic-only preparation. No signing authority or clinical release.
create table ehr.encounter_profile (
  clinician_principal_id uuid primary key references iam.principal(id),
  version int not null default 1 check(version>0),
  preferences jsonb not null check(jsonb_typeof(preferences)='object'),
  updated_at timestamptz not null default now()
);
create table ehr.encounter_job (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ehr.patient(id),
  encounter_id uuid not null references ehr.synthetic_encounter(id),
  clinician_principal_id uuid not null references iam.principal(id),
  source_version int not null,
  profile_version int not null,
  preferences jsonb not null check(jsonb_typeof(preferences)='object'),
  preparation_id uuid references ehr.encounter_preparation(id),
  status text not null default 'queued' check(status in ('queued','running','ready','failed','superseded','cancelled','finalized')),
  stage text not null default 'chart' check(stage in ('chart','evidence','note','orders','verification')),
  checkpoints jsonb not null default '{}' check(jsonb_typeof(checkpoints)='object'),
  stage_attempts int not null default 0 check(stage_attempts between 0 and 3),
  attempts int not null default 0 check(attempts between 0 and 30),
  lease_token uuid,
  lease_until timestamptz,
  dispatch_until timestamptz,
  available_at timestamptz not null default now(),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '2 hours'),
  check((status='running')=(lease_token is not null and lease_until is not null))
);
create unique index encounter_job_current on ehr.encounter_job(encounter_id) where status in ('queued','running','ready','failed');
create index encounter_job_dispatch on ehr.encounter_job(available_at,created_at) where status='queued';
create index encounter_job_lease on ehr.encounter_job(lease_until) where status='running';
create index encounter_job_encounter on ehr.encounter_job(encounter_id,created_at desc);
create index encounter_job_clinician on ehr.encounter_job(clinician_principal_id);
create index encounter_job_preparation on ehr.encounter_job(preparation_id) where preparation_id is not null;
create index encounter_job_owner on ehr.encounter_job(patient_id,clinician_principal_id,created_at desc);
create table ehr.encounter_job_event (
  id bigint generated always as identity primary key,
  job_id uuid not null references ehr.encounter_job(id),
  stage text not null,
  status text not null,
  event text not null,
  error_code text,
  attempt int not null,
  created_at timestamptz not null default now()
);
create index encounter_job_event_parent on ehr.encounter_job_event(job_id,id);
create table ehr.encounter_dispatch (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ehr.encounter_job(id),
  token_hash text not null,
  expires_at timestamptz not null default(now()+interval '2 minutes'),
  used_at timestamptz,
  request_id bigint,
  created_at timestamptz not null default now()
);
create index encounter_dispatch_job on ehr.encounter_dispatch(job_id);
create index encounter_dispatch_expiry on ehr.encounter_dispatch(expires_at);
create table ehr.encounter_dispatch_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  endpoint text not null default '' check(endpoint='' or endpoint ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/encounter-worker$')
);
insert into ehr.encounter_dispatch_config(singleton) values(true);
alter table ehr.encounter_profile enable row level security;
alter table ehr.encounter_job enable row level security;
alter table ehr.encounter_job_event enable row level security;
alter table ehr.encounter_dispatch enable row level security;
alter table ehr.encounter_dispatch_config enable row level security;
revoke all on ehr.encounter_profile,ehr.encounter_job,ehr.encounter_job_event,ehr.encounter_dispatch,ehr.encounter_dispatch_config from public,anon,authenticated;
revoke all on sequence ehr.encounter_job_event_id_seq from public,anon,authenticated;
create trigger preserve_encounter_job_event before update or delete on ehr.encounter_job_event for each row execute function ehr.preserve_encounter_receipt();
create function ehr.guard_encounter_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'encounter_job_history_is_retained'; end if;
  if (NEW.patient_id,NEW.encounter_id,NEW.clinician_principal_id,NEW.source_version,NEW.profile_version,NEW.preferences,NEW.created_at,NEW.expires_at)
    is distinct from (OLD.patient_id,OLD.encounter_id,OLD.clinician_principal_id,OLD.source_version,OLD.profile_version,OLD.preferences,OLD.created_at,OLD.expires_at) then raise exception 'encounter_job_source_is_immutable'; end if;
  if exists(select 1 from jsonb_each(OLD.checkpoints) c where NEW.checkpoints->c.key is distinct from c.value) then raise exception 'completed_checkpoint_is_immutable'; end if;
  if OLD.preparation_id is not null and NEW.preparation_id is distinct from OLD.preparation_id then raise exception 'job_preparation_is_immutable'; end if;
  if NEW.attempts<OLD.attempts then raise exception 'job_attempt_count_is_monotonic'; end if;
  if not ((OLD.status='queued' and NEW.status in ('queued','running','failed','superseded','cancelled')) or
    (OLD.status='running' and NEW.status in ('running','queued','ready','failed','superseded','cancelled')) or
    (OLD.status='failed' and NEW.status in ('queued','superseded','cancelled')) or
    (OLD.status='ready' and NEW.status in ('superseded','cancelled','finalized'))) then raise exception 'invalid_encounter_job_transition'; end if;
  return NEW;
end; $$;
create trigger guard_encounter_job before update or delete on ehr.encounter_job for each row execute function ehr.guard_encounter_job();

create function ehr.enqueue_encounter(encounter_uuid uuid, refresh boolean default false) returns uuid language plpgsql security invoker set search_path='' as $$
declare e ehr.synthetic_encounter%rowtype; prior ehr.encounter_job%rowtype; prefs jsonb; profile_ver int; result uuid;
begin
  select * into e from ehr.synthetic_encounter where id=encounter_uuid for update;
  if e.id is null or e.status<>'draft' or not exists(select 1 from ehr.patient where id=e.patient_id and synthetic and active) then return null; end if;
  if not exists(select 1 from jsonb_array_elements(e.sources) s where s->>'kind' not in ('lab-trend','attachment') and length(trim(coalesce(s->>'text','')))>0) then return null; end if;
  select preferences,version into prefs,profile_ver from ehr.encounter_profile where clinician_principal_id=e.clinician_principal_id;
  prefs:=coalesce(prefs,'{"template":"soap","detail":"standard","headings":["Subjective","Objective","Assessment","Plan"],"instructions":""}'::jsonb); profile_ver:=coalesce(profile_ver,0);
  select * into prior from ehr.encounter_job where encounter_id=e.id and status in ('queued','running','ready','failed') for update;
  if prior.id is not null and prior.source_version=e.version and prior.preferences=prefs and prior.expires_at>now() then
    if prior.status in ('queued','running') or (prior.status='ready' and not refresh) or (prior.status='failed' and not refresh) then return prior.id; end if;
    if prior.status='failed' and refresh and prior.attempts<30 then
      update ehr.encounter_job set status='queued',stage_attempts=0,available_at=now(),dispatch_until=null,error_code=null,updated_at=now() where id=prior.id;
      insert into ehr.encounter_job_event(job_id,stage,status,event,attempt) values(prior.id,prior.stage,'queued','physician_retry',prior.attempts);
      return prior.id;
    end if;
  end if;
  if prior.id is not null then
    update ehr.encounter_job set status='superseded',lease_token=null,lease_until=null,updated_at=now() where id=prior.id;
    insert into ehr.encounter_job_event(job_id,stage,status,event,attempt) values(prior.id,prior.stage,'superseded','source_or_preferences_changed',prior.attempts);
  end if;
  update ehr.encounter_preparation set status='superseded',completed_at=coalesce(completed_at,now()) where encounter_id=e.id and status in ('preparing','ready');
  insert into ehr.encounter_job(patient_id,encounter_id,clinician_principal_id,source_version,profile_version,preferences) values(e.patient_id,e.id,e.clinician_principal_id,e.version,profile_ver,prefs) returning id into result;
  insert into ehr.encounter_job_event(job_id,stage,status,event,attempt) values(result,'chart','queued','source_saved',0);
  return result;
end; $$;
create function ehr.queue_saved_encounter() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if NEW.status='draft' then
    if TG_OP='INSERT' then perform ehr.enqueue_encounter(NEW.id);
    elsif (NEW.version,NEW.note_text,NEW.sources) is distinct from (OLD.version,OLD.note_text,OLD.sources) then perform ehr.enqueue_encounter(NEW.id); end if;
  else
    update ehr.encounter_job set status=case when NEW.status='signed' and status='ready' then 'finalized' else 'cancelled' end,lease_token=null,lease_until=null,updated_at=now() where encounter_id=NEW.id and status in ('queued','running','ready','failed');
  end if;
  return NEW;
end; $$;
create trigger queue_saved_encounter after insert or update of note_text,sources,version,status on ehr.synthetic_encounter for each row execute function ehr.queue_saved_encounter();

-- Core watchdog is independent of HTTP and can be tested on ordinary PostgreSQL.
create function ehr.recover_encounter_jobs() returns int language plpgsql security invoker set search_path='' as $$
declare j ehr.encounter_job%rowtype; next_status text; recovered int:=0;
begin
  for j in select * from ehr.encounter_job where (status='running' and lease_until<=now()) or (status='queued' and expires_at<=now()) order by created_at for update skip locked loop
    next_status:=case when j.expires_at<=now() or j.stage_attempts>=3 or j.attempts>=30 then 'failed' else 'queued' end;
    update ehr.encounter_job set status=next_status,lease_token=null,lease_until=null,dispatch_until=null,available_at=now(),error_code=case when j.expires_at<=now() then 'job_expired' else 'worker_interrupted' end,updated_at=now() where id=j.id;
    insert into ehr.encounter_job_event(job_id,stage,status,event,error_code,attempt) values(j.id,j.stage,next_status,'lease_recovery','worker_interrupted',j.attempts);
    recovered:=recovered+1;
  end loop;
  return recovered;
end; $$;
create function ehr.dispatch_encounter_jobs() returns int language plpgsql security invoker set search_path='' as $$
declare j ehr.encounter_job%rowtype; endpoint_url text; dispatch_id uuid; bearer text; request bigint; sent int:=0;
begin
  perform ehr.recover_encounter_jobs();
  select endpoint into endpoint_url from ehr.encounter_dispatch_config where singleton and enabled;
  if endpoint_url is null or endpoint_url='' then return 0; end if;
  for j in select * from ehr.encounter_job where status='queued' and available_at<=now() and (dispatch_until is null or dispatch_until<=now()) and expires_at>now() order by created_at limit 3 for update skip locked loop
    bearer:=gen_random_uuid()::text||gen_random_uuid()::text;
    insert into ehr.encounter_dispatch(job_id,token_hash) values(j.id,encode(sha256(convert_to(bearer,'UTF8')),'hex')) returning id into dispatch_id;
    select net.http_post(url:=endpoint_url,body:=jsonb_build_object('dispatchId',dispatch_id),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer),timeout_milliseconds:=90000) into request;
    update ehr.encounter_dispatch set request_id=request where id=dispatch_id;
    update ehr.encounter_job set dispatch_until=now()+interval '100 seconds',updated_at=now() where id=j.id;
    sent:=sent+1;
  end loop;
  delete from ehr.encounter_dispatch where expires_at<now()-interval '1 day';
  return sent;
end; $$;
revoke all on function ehr.guard_encounter_job(),ehr.enqueue_encounter(uuid,boolean),ehr.queue_saved_encounter(),ehr.recover_encounter_jobs(),ehr.dispatch_encounter_jobs() from public,anon,authenticated;
