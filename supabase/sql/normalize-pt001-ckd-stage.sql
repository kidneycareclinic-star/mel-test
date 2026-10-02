-- Development-only synthetic data correction.
-- Creates a new Patient State version; does not mutate prior state versions.
do $$
declare
  v_patient_id uuid;
  v_prev_version bigint;
  v_prev_state jsonb;
  v_event_id uuid;
  v_next_state jsonb;
begin
  select id into v_patient_id
  from ehr.patient
  where external_id='PT-001' and active=true and synthetic=true
  limit 1;

  if v_patient_id is null then
    raise exception 'synthetic_patient_PT_001_not_found';
  end if;

  select state_version,state
  into v_prev_version,v_prev_state
  from ehr.patient_state
  where patient_id=v_patient_id
  order by state_version desc
  limit 1
  for update;

  if v_prev_state->>'diagnosis' <> 'Polycystic kidney disease'
     or v_prev_state->>'ckdStage' <> 'PKD'
     or v_prev_state->'labs'->'eGFR'->>'value' <> '31' then
    raise exception 'PT_001_fixture_does_not_match_expected_precondition';
  end if;

  insert into ehr.event(patient_id,event_type,actor_type,source,status,payload)
  values(
    v_patient_id,'SYNTHETIC_DATA_CORRECTION','system','synthetic-fixture-normalizer','recorded',
    jsonb_build_object(
      'field','ckdStage','from','PKD','to','3b',
      'diagnosis','Polycystic kidney disease',
      'reason','Separate CKD stage from disease etiology in synthetic fixture'
    )
  )
  returning id into v_event_id;

  v_next_state := jsonb_set(v_prev_state,'{ckdStage}','"3b"'::jsonb,true);
  v_next_state := jsonb_set(v_next_state,'{longitudinal,kidney,stage}','"3b"'::jsonb,true);
  v_next_state := jsonb_set(
    v_next_state,'{stateReducer}',
    jsonb_build_object(
      'version','synthetic-fixture-normalizer-v1',
      'sourceEventId',v_event_id,
      'generatedAt',now()
    ),true
  );

  insert into ehr.patient_state(patient_id,state_version,state,source_event_id,engine_version)
  values(v_patient_id,v_prev_version+1,v_next_state,v_event_id,'synthetic-fixture-normalizer-v1');
end $$;
