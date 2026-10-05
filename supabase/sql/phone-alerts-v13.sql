-- Synthetic encounter notifications. These tables have no clinical write authority.
create table ehr.clinician_phone_preference (
  clinician_principal_id uuid primary key references iam.principal(id),
  version int not null default 1 check(version>0),
  mode text not null default 'preview' check(mode in ('off','preview','sms')),
  ready_alerts boolean not null default true,
  paused_alerts boolean not null default true,
  quiet_hours boolean not null default true,
  time_zone text not null default 'America/New_York',
  phone_ciphertext text,
  phone_last4 text check(phone_last4 ~ '^[0-9]{4}$'),
  verified_at timestamptz,
  consent_at timestamptz,
  consent_version text,
  verify_sid text,
  verify_expires_at timestamptz,
  verify_attempts int not null default 0 check(verify_attempts between 0 and 5),
  updated_at timestamptz not null default now(),
  check(mode<>'sms' or (phone_ciphertext is not null and phone_last4 is not null and verified_at is not null and consent_at is not null and consent_version='phone-alerts-v13'))
);
create table ehr.phone_alert (
  id uuid primary key default gen_random_uuid(),
  clinician_principal_id uuid not null references iam.principal(id),
  job_id uuid references ehr.encounter_job(id),
  revision text not null,
  preference_version int not null,
  transport text not null check(transport in ('preview','sms')),
  reason text not null check(reason in ('ready','failed','expired','test')),
  status text not null default 'pending' check(status in ('pending','sending','preview','accepted','sent','delivered','undelivered','failed','unknown','cancelled')),
  provider_sid text check(provider_sid ~ '^SM[0-9a-fA-F]{32}$'),
  error_code text,
  available_at timestamptz not null default now(),
  dispatch_until timestamptz,
  send_started_at timestamptz,
  poll_attempts int not null default 0 check(poll_attempts between 0 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '24 hours'),
  unique(job_id,revision,transport),
  check(reason<>'test' or (job_id is null and transport='preview'))
);
create index phone_alert_owner on ehr.phone_alert(clinician_principal_id,created_at desc);
create index phone_alert_pending on ehr.phone_alert(available_at) where status='pending';
create index phone_alert_poll on ehr.phone_alert(available_at) where status in ('accepted','sent');
create index phone_alert_job on ehr.phone_alert(job_id) where job_id is not null;
create table ehr.phone_alert_audit (
  id bigint generated always as identity primary key,
  clinician_principal_id uuid not null references iam.principal(id),
  alert_id uuid references ehr.phone_alert(id),
  event text not null,
  created_at timestamptz not null default now()
);
create index phone_alert_audit_owner on ehr.phone_alert_audit(clinician_principal_id,created_at desc);
create index phone_alert_audit_alert on ehr.phone_alert_audit(alert_id) where alert_id is not null;
create trigger preserve_phone_alert_audit before update or delete on ehr.phone_alert_audit for each row execute function ehr.preserve_encounter_receipt();
create table ehr.phone_alert_dispatch (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references ehr.phone_alert(id),
  token_hash text not null,
  expires_at timestamptz not null default(now()+interval '2 minutes'),
  used_at timestamptz,
  request_id bigint
);
create index phone_alert_dispatch_alert on ehr.phone_alert_dispatch(alert_id);
create index phone_alert_dispatch_expiry on ehr.phone_alert_dispatch(expires_at);
create table ehr.phone_alert_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  endpoint text not null default '' check(endpoint='' or endpoint ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/phone-alert-worker$')
);
insert into ehr.phone_alert_config(singleton) values(true);
alter table ehr.clinician_phone_preference enable row level security;
alter table ehr.phone_alert enable row level security;
alter table ehr.phone_alert_audit enable row level security;
alter table ehr.phone_alert_dispatch enable row level security;
alter table ehr.phone_alert_config enable row level security;
revoke all on ehr.clinician_phone_preference,ehr.phone_alert,ehr.phone_alert_audit,ehr.phone_alert_dispatch,ehr.phone_alert_config from public,anon,authenticated;
revoke all on sequence ehr.phone_alert_audit_id_seq from public,anon,authenticated;

-- Pure DB sweep can be verified in ordinary PostgreSQL. No external calls here.
create function ehr.queue_phone_alerts() returns int language plpgsql security invoker set search_path='' as $$
declare added int;
begin
  insert into ehr.phone_alert(clinician_principal_id,job_id,revision,preference_version,transport,reason)
  select q.clinician_principal_id,q.id,q.revision,q.preference_version,q.mode,q.effective_status
  from (
    select j.id,j.clinician_principal_id,pref.version as preference_version,pref.mode,pref.ready_alerts,pref.paused_alerts,
      case when j.expires_at<=now() then 'expired' else j.status end as effective_status,
      coalesce((select max(ev.id)::text from ehr.encounter_job_event ev where ev.job_id=j.id),'0')||':'||case when j.expires_at<=now() then 'expired' else j.status end as revision
    from ehr.encounter_job j join ehr.synthetic_encounter e on e.id=j.encounter_id and e.patient_id=j.patient_id and e.clinician_principal_id=j.clinician_principal_id
    join ehr.patient p on p.id=j.patient_id and p.active and p.synthetic
    join ehr.clinician_phone_preference pref on pref.clinician_principal_id=j.clinician_principal_id and pref.mode<>'off'
    join iam.principal person on person.id=j.clinician_principal_id and person.active and person.synthetic and person.principal_type='clinician'
    where e.status='draft' and j.source_version=e.version and j.status in ('ready','failed','queued','running')
    and e.id=(select d.id from ehr.synthetic_encounter d where d.patient_id=p.id and d.clinician_principal_id=person.id and d.status='draft' order by d.created_at desc,d.id desc limit 1)
    and exists(select 1 from iam.practice_membership pm join iam.patient_assignment pa on pa.principal_id=pm.principal_id and pa.practice_id=pm.practice_id
      where pm.principal_id=person.id and pa.patient_id=p.id and pm.active and pa.active and pm.role='physician'
      and 'office'=any(pm.workspaces) and 'office'=any(pa.workspaces)
      and pm.permissions->'patient.read'='true'::jsonb and pm.permissions->'encounter.draft'='true'::jsonb)
  ) q where ((q.effective_status='ready' and q.ready_alerts) or (q.effective_status in ('failed','expired') and q.paused_alerts))
  and not exists(select 1 from ehr.encounter_inbox_seen s where s.job_id=q.id and s.clinician_principal_id=q.clinician_principal_id and s.revision=q.revision)
  on conflict(job_id,revision,transport) do update set preference_version=excluded.preference_version,status='pending',error_code=null,available_at=now(),dispatch_until=null,updated_at=now()
    where ehr.phone_alert.status='cancelled' and ehr.phone_alert.error_code='preferences_changed' and ehr.phone_alert.send_started_at is null;
  get diagnostics added=row_count;
  return added;
end; $$;

create function ehr.dispatch_phone_alerts() returns int language plpgsql security invoker set search_path='' as $$
declare a ehr.phone_alert%rowtype; endpoint_url text; dispatch_id uuid; bearer text; request bigint; sent int:=0;
begin
  perform ehr.queue_phone_alerts();
  -- A provider may have accepted a message before a crash. Never automatically resend it.
  update ehr.phone_alert set status='unknown',error_code='delivery_unconfirmed',updated_at=now() where status='sending' and send_started_at<now()-interval '90 seconds';
  update ehr.phone_alert set status=case when status='pending' then 'cancelled' else 'unknown' end,error_code='alert_expired',updated_at=now()
    where status in ('pending','accepted','sent') and expires_at<=now();
  select endpoint into endpoint_url from ehr.phone_alert_config where singleton and enabled;
  if endpoint_url is null or endpoint_url='' then return 0; end if;
  for a in select * from ehr.phone_alert where status in ('pending','accepted','sent') and available_at<=now() and expires_at>now()
    and (dispatch_until is null or dispatch_until<=now()) order by available_at,created_at limit 3 for update skip locked loop
    bearer:=gen_random_uuid()::text||gen_random_uuid()::text;
    insert into ehr.phone_alert_dispatch(alert_id,token_hash) values(a.id,encode(sha256(convert_to(bearer,'UTF8')),'hex')) returning id into dispatch_id;
    select net.http_post(url:=endpoint_url,body:=jsonb_build_object('dispatchId',dispatch_id),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer),timeout_milliseconds:=20000) into request;
    update ehr.phone_alert_dispatch set request_id=request where id=dispatch_id;
    update ehr.phone_alert set dispatch_until=now()+interval '90 seconds' where id=a.id;
    sent:=sent+1;
  end loop;
  delete from ehr.phone_alert_dispatch where expires_at<now()-interval '1 day';
  return sent;
end; $$;
revoke all on function ehr.queue_phone_alerts(),ehr.dispatch_phone_alerts() from public,anon,authenticated;
