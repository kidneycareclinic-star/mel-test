-- Device opt-in and notification delivery only. No clinical write authority.
create table ehr.clinician_push_preference (
 clinician_principal_id uuid primary key references iam.principal(id),
 version int not null default 1 check(version>0),enabled boolean not null default false,
 quiet_hours boolean not null default true,time_zone text not null default 'America/New_York',
 updated_at timestamptz not null default now()
);
create table ehr.clinician_push_subscription (
 id uuid primary key default gen_random_uuid(),clinician_principal_id uuid not null references iam.principal(id),
 endpoint_hash text not null unique check(endpoint_hash ~ '^[0-9a-f]{64}$'),
 endpoint text not null,public_key text not null,auth_key text not null,
 version int not null default 1 check(version>0),active boolean not null default true,
 consent_at timestamptz not null,consent_version text not null check(consent_version='push-alerts-v17'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index push_subscription_owner on ehr.clinician_push_subscription(clinician_principal_id);
create table ehr.push_alert (
 id uuid primary key default gen_random_uuid(),clinician_principal_id uuid not null references iam.principal(id),
 subscription_id uuid not null references ehr.clinician_push_subscription(id),subscription_version int not null,
 preference_version int not null,job_id uuid references ehr.encounter_job(id),revision text not null,
 reason text not null check(reason in ('ready','failed','expired','test')),
 status text not null default 'pending' check(status in ('pending','sending','accepted','failed','unknown','cancelled')),
 error_code text,available_at timestamptz not null default now(),dispatch_until timestamptz,send_started_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 expires_at timestamptz not null default(now()+interval '24 hours'),
 unique(job_id,revision,subscription_id),check((reason='test')=(job_id is null))
);
create index push_alert_owner on ehr.push_alert(clinician_principal_id,created_at desc);
create index push_alert_pending on ehr.push_alert(available_at) where status='pending';
create index push_alert_subscription on ehr.push_alert(subscription_id,send_started_at desc);
create index push_alert_job on ehr.push_alert(job_id) where job_id is not null;
create table ehr.push_alert_audit (
 id bigint generated always as identity primary key,clinician_principal_id uuid not null references iam.principal(id),
 alert_id uuid references ehr.push_alert(id),event text not null,created_at timestamptz not null default now()
);
create index push_audit_owner on ehr.push_alert_audit(clinician_principal_id,created_at desc);
create index push_audit_alert on ehr.push_alert_audit(alert_id) where alert_id is not null;
create trigger preserve_push_audit before update or delete on ehr.push_alert_audit for each row execute function ehr.preserve_encounter_receipt();
create table ehr.push_alert_dispatch (
 id uuid primary key default gen_random_uuid(),alert_id uuid not null references ehr.push_alert(id),
 token_hash text not null,expires_at timestamptz not null default(now()+interval '2 minutes'),used_at timestamptz,request_id bigint
);
create index push_dispatch_alert on ehr.push_alert_dispatch(alert_id);
create index push_dispatch_expiry on ehr.push_alert_dispatch(expires_at);
-- Keys are generated once inside an authorized Edge request and remain in this private table.
create table ehr.push_alert_config (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 endpoint text not null default '' check(endpoint='' or endpoint ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/push-alert-worker$'),
 vapid_public text,vapid_private text,
 check((vapid_public is null and vapid_private is null) or (vapid_public ~ '^[A-Za-z0-9_-]{87}$' and vapid_private ~ '^[A-Za-z0-9_-]{43}$'))
);
insert into ehr.push_alert_config(singleton) values(true);
alter table ehr.clinician_push_preference enable row level security;
alter table ehr.clinician_push_subscription enable row level security;
alter table ehr.push_alert enable row level security;
alter table ehr.push_alert_audit enable row level security;
alter table ehr.push_alert_dispatch enable row level security;
alter table ehr.push_alert_config enable row level security;
revoke all on ehr.clinician_push_preference,ehr.clinician_push_subscription,ehr.push_alert,ehr.push_alert_audit,ehr.push_alert_dispatch,ehr.push_alert_config from public,anon,authenticated;
revoke all on sequence ehr.push_alert_audit_id_seq from public,anon,authenticated;

create function ehr.queue_push_alerts() returns int language plpgsql security invoker set search_path='' as $$
declare added int;
begin
 insert into ehr.push_alert(clinician_principal_id,subscription_id,subscription_version,preference_version,job_id,revision,reason)
 select q.clinician_principal_id,q.subscription_id,q.subscription_version,q.preference_version,q.id,q.revision,q.effective_status
 from (
  select j.id,j.clinician_principal_id,s.id as subscription_id,s.version as subscription_version,pref.version as preference_version,
   case when j.status in ('ready','queued','running') and j.expires_at<=now() then 'expired' else j.status end as effective_status,
   coalesce((select max(ev.id)::text from ehr.encounter_job_event ev where ev.job_id=j.id),'0')||':'||case when j.status in ('ready','queued','running') and j.expires_at<=now() then 'expired' else j.status end as revision
  from ehr.encounter_job j join ehr.synthetic_encounter e on e.id=j.encounter_id and e.patient_id=j.patient_id and e.clinician_principal_id=j.clinician_principal_id
  join ehr.patient p on p.id=j.patient_id and p.active and p.synthetic
  join ehr.clinician_push_preference pref on pref.clinician_principal_id=j.clinician_principal_id and pref.enabled
  join ehr.clinician_push_subscription s on s.clinician_principal_id=pref.clinician_principal_id and s.active and s.consent_version='push-alerts-v17'
  join iam.principal person on person.id=j.clinician_principal_id and person.active and person.synthetic and person.principal_type='clinician'
  where e.status='draft' and j.source_version=e.version and j.status in ('ready','failed','queued','running')
  and e.id=(select d.id from ehr.synthetic_encounter d where d.patient_id=p.id and d.clinician_principal_id=person.id and d.status='draft' order by d.created_at desc,d.id desc limit 1)
  and exists(select 1 from iam.practice_membership pm join iam.patient_assignment pa on pa.principal_id=pm.principal_id and pa.practice_id=pm.practice_id
   where pm.principal_id=person.id and pa.patient_id=p.id and pm.active and pa.active and pm.role='physician'
   and 'office'=any(pm.workspaces) and 'office'=any(pa.workspaces)
   and pm.permissions->'patient.read'='true'::jsonb and pm.permissions->'encounter.draft'='true'::jsonb)
 ) q where q.effective_status in ('ready','failed','expired')
 and not exists(select 1 from ehr.encounter_inbox_seen seen where seen.job_id=q.id and seen.clinician_principal_id=q.clinician_principal_id and seen.revision=q.revision)
 on conflict(job_id,revision,subscription_id) do update set subscription_version=excluded.subscription_version,preference_version=excluded.preference_version,status='pending',error_code=null,available_at=now(),dispatch_until=null,updated_at=now()
  where ehr.push_alert.status='cancelled' and ehr.push_alert.error_code='preferences_changed' and ehr.push_alert.send_started_at is null;
 get diagnostics added=row_count;return added;
end; $$;
create function ehr.dispatch_push_alerts() returns int language plpgsql security invoker set search_path='' as $$
declare a ehr.push_alert%rowtype; endpoint_url text; dispatch_id uuid; bearer text; request bigint; sent int:=0;
begin
 perform ehr.queue_push_alerts();
 update ehr.push_alert set status='unknown',error_code='delivery_unconfirmed',updated_at=now() where status='sending' and send_started_at<now()-interval '90 seconds';
 update ehr.push_alert set status='cancelled',error_code='alert_expired',updated_at=now() where status='pending' and expires_at<=now();
 select endpoint into endpoint_url from ehr.push_alert_config where singleton and enabled;
 if endpoint_url is null or endpoint_url='' then return 0; end if;
 for a in select * from ehr.push_alert where status='pending' and available_at<=now() and expires_at>now() and (dispatch_until is null or dispatch_until<=now()) order by available_at,created_at limit 3 for update skip locked loop
  bearer:=gen_random_uuid()::text||gen_random_uuid()::text;
  insert into ehr.push_alert_dispatch(alert_id,token_hash) values(a.id,encode(sha256(convert_to(bearer,'UTF8')),'hex')) returning id into dispatch_id;
  select net.http_post(url:=endpoint_url,body:=jsonb_build_object('dispatchId',dispatch_id),headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||bearer),timeout_milliseconds:=20000) into request;
  update ehr.push_alert_dispatch set request_id=request where id=dispatch_id;
  update ehr.push_alert set dispatch_until=now()+interval '90 seconds' where id=a.id;
  sent:=sent+1;
 end loop;
 delete from ehr.push_alert_dispatch where expires_at<now()-interval '1 day';return sent;
end; $$;
revoke all on function ehr.queue_push_alerts(),ehr.dispatch_push_alerts() from public,anon,authenticated;
