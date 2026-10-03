-- Encounter State v4. Private, server-owned snapshots for future state versions.
-- Historical versions remain untouched; no AI text is auto-approved.
create table ehr.encounter_review (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ehr.patient(id),
  encounter_id uuid not null references ehr.synthetic_encounter(id),
  run_id uuid not null unique references ehr.agent_run(id),
  base_state_version bigint not null,
  generated_content jsonb not null check(jsonb_typeof(generated_content)='object'),
  reviewed_content jsonb check(reviewed_content is null or jsonb_typeof(reviewed_content)='object'),
  status text not null default 'pending' check(status in ('pending','accepted','edited','rejected')),
  decision_event_id uuid references ehr.event(id),
  reviewed_by_id text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check ((status='pending' and decision_event_id is null and reviewed_at is null) or
    (status<>'pending' and decision_event_id is not null and reviewed_at is not null)),
  check (status not in ('accepted','edited') or reviewed_content is not null)
);
create index encounter_review_queue on ehr.encounter_review(encounter_id,status);
alter table ehr.encounter_review enable row level security;
revoke all on ehr.encounter_review from public,anon,authenticated;

create table ehr.patient_state_audit (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ehr.patient(id),
  event_id uuid not null references ehr.event(id),
  encounter_id uuid references ehr.synthetic_encounter(id),
  previous_version bigint,
  resulting_version bigint not null,
  previous_state jsonb,
  resulting_state jsonb not null check (jsonb_typeof(resulting_state)='object'),
  created_at timestamptz not null default now(),
  unique(patient_id,resulting_version)
);
create index patient_state_audit_encounter on ehr.patient_state_audit(encounter_id,resulting_version);
alter table ehr.patient_state_audit enable row level security;
revoke all on ehr.patient_state_audit from public,anon,authenticated;

create or replace function ehr.capture_state_audit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_previous ehr.patient_state; v_encounter uuid;
begin
  select * into v_previous from ehr.patient_state
    where patient_id=new.patient_id and state_version<new.state_version
    order by state_version desc limit 1;
  select nullif(payload->>'encounterId','')::uuid into v_encounter
    from ehr.event where id=new.source_event_id and patient_id=new.patient_id;
  insert into ehr.patient_state_audit(patient_id,event_id,encounter_id,previous_version,resulting_version,previous_state,resulting_state)
    values(new.patient_id,new.source_event_id,v_encounter,v_previous.state_version,new.state_version,v_previous.state,new.state);
  return new;
end;
$$;
revoke all on function ehr.capture_state_audit() from public,anon,authenticated;
create trigger capture_state_audit after insert on ehr.patient_state
  for each row when(new.source_event_id is not null) execute function ehr.capture_state_audit();

create or replace function ehr.preserve_state_history() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'patient_state_history_is_append_only'; end;
$$;
revoke all on function ehr.preserve_state_history() from public,anon,authenticated;
create trigger preserve_state_history before update or delete on ehr.patient_state_audit
  for each row execute function ehr.preserve_state_history();

CREATE OR REPLACE FUNCTION ehr.reduce_patient_state(p_patient_id uuid, p_source_event_id uuid, p_reducer_version text DEFAULT 'patient-state-reducer-v4'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_state jsonb;
  v_prev_version bigint;
  v_next_version bigint;
  v_external_id text;
  v_display_name text;
  v_meds jsonb;
  v_problems jsonb;
  v_loops jsonb;
  v_loop_count int;
  v_scribe jsonb;
  v_field text;
  v_latest record;
  v_hist jsonb;
  v_hist_obj jsonb;
  v_lab_obj jsonb;
  v_bp jsonb;
  v_bp_history jsonb;
  v_value numeric;
begin
  -- Every writer locks the patient before encounter/proposal/state rows.
  -- Locking only the latest version can race an append from another transaction.
  perform 1 from ehr.patient where id=p_patient_id and active and synthetic for update;
  if not found then raise exception 'synthetic_patient_not_found'; end if;
  perform 1 from ehr.event where id=p_source_event_id and patient_id=p_patient_id;
  if not found then raise exception 'state_source_event_mismatch'; end if;
  select ps.state, ps.state_version
  into v_state, v_prev_version
  from ehr.patient_state ps
  where ps.patient_id = p_patient_id
  order by ps.state_version desc
  limit 1
  for update;

  if v_state is null then
    raise exception 'patient_state_not_found';
  end if;
  if jsonb_typeof(v_state) <> 'object' then
    raise exception 'patient_state_invalid_shape';
  end if;

  select p.external_id, p.display_name
  into v_external_id, v_display_name
  from ehr.patient p
  where p.id = p_patient_id;

  v_state := jsonb_set(v_state, '{id}', to_jsonb(v_external_id), true);
  v_state := jsonb_set(v_state, '{name}', to_jsonb(v_display_name), true);

  select coalesce(jsonb_agg(m.medication_name order by m.medication_name), '[]'::jsonb)
  into v_meds
  from ehr.medication m
  where m.patient_id=p_patient_id and m.status='active';
  v_state := jsonb_set(v_state, '{meds}', v_meds, true);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', coalesce(pr.problem_key, pr.id::text),
      'name', pr.problem_name,
      'code', pr.code,
      'codedLabel', pr.coded_label,
      'primary', pr.primary_problem,
      'status', pr.status,
      'codeSystem', pr.code_system,
      'codingStatus', pr.coding_status
    ) order by pr.primary_problem desc, pr.problem_name
  ), '[]'::jsonb)
  into v_problems
  from ehr.problem pr
  where pr.patient_id=p_patient_id and pr.status='active';
  v_state := jsonb_set(v_state, '{problemList}', v_problems, true);

  for v_field in
    select distinct o.observation_type
    from ehr.clinical_observation o
    where o.patient_id=p_patient_id
      and o.status in ('final','amended','corrected')
      and o.value_numeric is not null
      and o.observation_type not in ('heartRate','temperature','oxygenSaturation')
  loop
    select o.*
    into v_latest
    from ehr.clinical_observation o
    where o.patient_id=p_patient_id
      and o.observation_type=v_field
      and o.status in ('final','amended','corrected')
      and o.value_numeric is not null
    order by o.observed_at desc, o.recorded_at desc
    limit 1;

    v_lab_obj := coalesce(v_state #> array['labs',v_field], '{}'::jsonb);
    v_lab_obj := jsonb_set(v_lab_obj, '{value}', to_jsonb(v_latest.value_numeric), true);
    if v_latest.unit is not null then
      v_lab_obj := jsonb_set(v_lab_obj, '{unit}', to_jsonb(v_latest.unit), true);
    end if;
    if jsonb_typeof(v_lab_obj->'ref')='array' and jsonb_array_length(v_lab_obj->'ref')=2 then
      v_lab_obj := jsonb_set(v_lab_obj, '{flag}', to_jsonb(case
        when v_latest.value_numeric < (v_lab_obj->'ref'->>0)::numeric then 'low'
        when v_latest.value_numeric > (v_lab_obj->'ref'->>1)::numeric then 'high'
        else 'normal' end), true);
    end if;
    v_state := jsonb_set(v_state, array['labs',v_field], v_lab_obj, true);

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'date', x.observed_at::date::text,
        'value', x.value_numeric,
        'source', coalesce(pv.source_kind,'clinical-observation')
      )
      order by x.observed_at
    ), '[]'::jsonb)
    into v_hist
    from ehr.clinical_observation x
    left join ehr.provenance pv on pv.id=x.provenance_id
    where x.patient_id=p_patient_id
      and x.observation_type=v_field
      and x.status in ('final','amended','corrected')
      and x.value_numeric is not null;

    v_hist_obj := coalesce(v_state #> array['labHistory',v_field], '{}'::jsonb);
    v_hist_obj := jsonb_set(v_hist_obj, '{values}', v_hist, true);
    if v_latest.unit is not null then
      v_hist_obj := jsonb_set(v_hist_obj, '{unit}', to_jsonb(v_latest.unit), true);
    end if;
    v_state := jsonb_set(v_state, array['labHistory',v_field], v_hist_obj, true);
  end loop;

  select o.value_numeric into v_value
  from ehr.clinical_observation o
  where o.patient_id=p_patient_id and o.observation_type='eGFR'
    and o.status in ('final','amended','corrected') and o.value_numeric is not null
  order by o.observed_at desc, o.recorded_at desc limit 1;
  if v_value is not null then
    v_state := jsonb_set(v_state, '{longitudinal,kidney,currentEgfr}', to_jsonb(v_value), true);
  end if;

  select o.value_numeric into v_value
  from ehr.clinical_observation o
  where o.patient_id=p_patient_id and o.observation_type='UACR'
    and o.status in ('final','amended','corrected') and o.value_numeric is not null
  order by o.observed_at desc, o.recorded_at desc limit 1;
  if v_value is not null then
    v_state := jsonb_set(v_state, '{longitudinal,proteinuria,currentUacr}', to_jsonb(v_value), true);
  end if;

  select o.value_numeric into v_value
  from ehr.clinical_observation o
  where o.patient_id=p_patient_id and o.observation_type='UPCR'
    and o.status in ('final','amended','corrected') and o.value_numeric is not null
  order by o.observed_at desc, o.recorded_at desc limit 1;
  if v_value is not null then
    v_state := jsonb_set(v_state, '{longitudinal,proteinuria,current}', to_jsonb(v_value), true);
  end if;

  select o.value_numeric into v_value
  from ehr.clinical_observation o
  where o.patient_id=p_patient_id and o.observation_type='Potassium'
    and o.status in ('final','amended','corrected') and o.value_numeric is not null
  order by o.observed_at desc, o.recorded_at desc limit 1;
  if v_value is not null then
    v_state := jsonb_set(v_state, '{longitudinal,electrolytes,potassium}', to_jsonb(v_value), true);
  end if;

  select o.value_numeric into v_value
  from ehr.clinical_observation o
  where o.patient_id=p_patient_id and o.observation_type='Bicarbonate'
    and o.status in ('final','amended','corrected') and o.value_numeric is not null
  order by o.observed_at desc, o.recorded_at desc limit 1;
  if v_value is not null then
    v_state := jsonb_set(v_state, '{longitudinal,electrolytes,bicarbonate}', to_jsonb(v_value), true);
  end if;

  select o.value_numeric into v_value
  from ehr.clinical_observation o
  where o.patient_id=p_patient_id and o.observation_type='Hemoglobin'
    and o.status in ('final','amended','corrected') and o.value_numeric is not null
  order by o.observed_at desc, o.recorded_at desc limit 1;
  if v_value is not null then
    v_state := jsonb_set(v_state, '{longitudinal,anemia,hemoglobin}', to_jsonb(v_value), true);
  end if;

  select o.value_numeric into v_value
  from ehr.clinical_observation o
  where o.patient_id=p_patient_id and o.observation_type='Phosphate'
    and o.status in ('final','amended','corrected') and o.value_numeric is not null
  order by o.observed_at desc, o.recorded_at desc limit 1;
  if v_value is not null then
    v_state := jsonb_set(v_state, '{longitudinal,ckdMbd,phosphate}', to_jsonb(v_value), true);
  end if;

  select o.value_json into v_bp
  from ehr.clinical_observation o
  where o.patient_id=p_patient_id
    and o.observation_type='BloodPressure'
    and o.status in ('final','amended','corrected')
    and o.value_json is not null
  order by o.observed_at desc, o.recorded_at desc limit 1;

  if v_bp is not null and (v_bp ? 'systolic') and (v_bp ? 'diastolic') then
    v_state := jsonb_set(
      v_state,
      '{longitudinal,bpVolume,latestBp}',
      to_jsonb((v_bp->>'systolic') || '/' || (v_bp->>'diastolic')),
      true
    );

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'date', o.observed_at::date::text,
        'systolic', (o.value_json->>'systolic')::numeric,
        'diastolic', (o.value_json->>'diastolic')::numeric,
        'source', coalesce(pv.source_kind,'clinical-observation')
      ) order by o.observed_at
    ), '[]'::jsonb)
    into v_bp_history
    from ehr.clinical_observation o
    left join ehr.provenance pv on pv.id=o.provenance_id
    where o.patient_id=p_patient_id
      and o.observation_type='BloodPressure'
      and o.status in ('final','amended','corrected')
      and o.value_json is not null;

    v_state := jsonb_set(v_state, '{longitudinal,bpVolume,history}', v_bp_history, true);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ol.id,
      'type', ol.loop_type,
      'label', ol.label,
      'status', ol.status,
      'workspace', ol.workspace,
      'dueAt', ol.due_at,
      'ownerType', ol.owner_type,
      'ownerId', ol.owner_id
    ) order by ol.created_at
  ), '[]'::jsonb),
  count(*)::int
  into v_loops, v_loop_count
  from ehr.open_loop ol
  where ol.patient_id=p_patient_id
    and ol.status in ('pending','in_progress');

  v_state := jsonb_set(v_state, '{longitudinal,openLoops}', v_loops, true);
  if v_state #> '{contexts,office}' is not null then
    v_state := jsonb_set(v_state, '{contexts,office,openLoops}', to_jsonb(v_loop_count), true);
  end if;

  select coalesce(jsonb_object_agg(po.field,
    jsonb_build_object(
      'id', po.client_record_id,
      'field', po.field,
      'displayLabel', po.display_label,
      'value', coalesce(to_jsonb(co.value_numeric), co.value_json),
      'unit', po.unit,
      'sourceText', po.source_text,
      'observedAt', po.observed_at,
      'observedDate', po.observed_at::date::text,
      'source', 'ambient-scribe-extraction',
      'sourceLabel', 'Ambient scribe · physician accepted',
      'confidence', po.confidence,
      'status', po.status,
      'type', po.observation_type
    )
  ), '{}'::jsonb)
  into v_scribe
  from (
    select distinct on (field) *
    from ehr.proposed_observation
    where patient_id=p_patient_id and status in ('accepted','edited')
    order by field, reviewed_at desc nulls last, created_at desc
  ) po join ehr.clinical_observation co on co.id=po.accepted_observation_id and co.patient_id=p_patient_id;

  v_state := jsonb_set(v_state, '{scribeObservations}', v_scribe, true);
  -- Store only physician-approved narrative; keep original model content in review history.
  select jsonb_build_object('encounterId',r.encounter_id,'runId',r.run_id,
    'content',r.reviewed_content,'status',r.status,'reviewedBy',r.reviewed_by_id,
    'reviewedAt',r.reviewed_at,'source','astra-review') into v_hist_obj
  from ehr.encounter_review r where r.patient_id=p_patient_id and r.status in ('accepted','edited')
  order by r.reviewed_at desc,r.id desc limit 1;
  if v_hist_obj is not null then
    v_state := jsonb_set(v_state,'{approvedEncounterReview}',v_hist_obj,true);
  end if;
  v_state := jsonb_set(
    v_state,
    '{stateReducer}',
    jsonb_build_object(
      'version', p_reducer_version,
      'sourceEventId', p_source_event_id,
      'generatedAt', now()
    ),
    true
  );

  v_next_version := v_prev_version + 1;

  insert into ehr.patient_state(patient_id,state_version,state,source_event_id,engine_version)
  values(p_patient_id,v_next_version,v_state,p_source_event_id,p_reducer_version);

  return v_next_version;
end;
$function$;


revoke execute on function ehr.reduce_patient_state(uuid,uuid,text) from public,anon,authenticated;

-- Two physician decisions from the same Astra run may be made in either order.
-- Only that run's narrative/internal action is tolerated; unrelated state changes remain stale.
create or replace function ehr.review_source_current(p_patient uuid,p_version bigint,p_run uuid)
returns boolean language sql security invoker set search_path='' as $$
 select exists(select 1 from ehr.patient_state where patient_id=p_patient and state_version=p_version)
 and not exists(
   select 1 from ehr.patient_state ps left join ehr.event ev on ev.id=ps.source_event_id
   where ps.patient_id=p_patient and ps.state_version>p_version
   and not coalesce((
     (ev.event_type='ASTRA_REVIEW_DECIDED' and ev.payload->>'runId'=p_run::text)
     or (ev.event_type='TOOL_ACTION_EXECUTED' and exists(
       select 1 from ehr.tool_call tc where tc.id::text=ev.payload->>'toolCallId'
         and tc.patient_id=p_patient and tc.agent_run_id=p_run
     ))
   ),false)
 );
$$;
revoke all on function ehr.review_source_current(uuid,bigint,uuid) from public,anon,authenticated;
