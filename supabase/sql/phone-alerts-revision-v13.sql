-- Preserve the exact inbox expiration revision for failed preparation.
create or replace function ehr.queue_phone_alerts() returns int language plpgsql security invoker set search_path='' as $$
declare added int;
begin
  insert into ehr.phone_alert(clinician_principal_id,job_id,revision,preference_version,transport,reason)
  select q.clinician_principal_id,q.id,q.revision,q.preference_version,q.mode,q.effective_status
  from (
    select j.id,j.clinician_principal_id,pref.version as preference_version,pref.mode,pref.ready_alerts,pref.paused_alerts,
      case when j.status in ('ready','queued','running') and j.expires_at<=now() then 'expired' else j.status end as effective_status,
      coalesce((select max(ev.id)::text from ehr.encounter_job_event ev where ev.job_id=j.id),'0')||':'||case when j.status in ('ready','queued','running') and j.expires_at<=now() then 'expired' else j.status end as revision
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
