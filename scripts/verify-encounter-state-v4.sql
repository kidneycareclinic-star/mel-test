-- Run only after the v4 migration is approved and applied to the development project.
-- All test writes, physician-test decisions and audit rows are rolled back.
begin;
create temporary table v4_results(patient_id text, checks text) on commit drop;
do $$
declare
  p record; v_clinician uuid; v_encounter uuid; v_run uuid; v_review uuid;
  v_event uuid; v_obs uuid; v_proposal uuid; v_sign uuid;
  v_base bigint; v_version bigint; v_before jsonb; v_after jsonb; v_at timestamptz;
  v_rejected boolean; v_count int:=0;
begin
  insert into iam.principal(external_id,display_name,synthetic,active)
    values('V4-ROLLBACK-QA-'||gen_random_uuid(),'Synthetic v4 rollback test',true,true)
    returning id into v_clinician;
  for p in select id,external_id from ehr.patient where active and synthetic order by external_id loop
    perform 1 from ehr.patient where id=p.id for update;
    select state,state_version into v_before,v_base from ehr.patient_state
      where patient_id=p.id order by state_version desc limit 1;
    assert jsonb_typeof(v_before)='object','Invalid baseline JSONB';
    insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,note_text,sources,base_state_version)
      values(p.id,v_clinician,'Synthetic v4 physician review test','[{"kind":"typed-note","title":"Synthetic test source"}]',v_base)
      returning id into v_encounter;
    insert into ehr.agent_run(patient_id,agent_name,status,input_snapshot,output,model_name)
      values(p.id,'v4-rollback-qa','completed',jsonb_build_object('stateVersion',v_base,'encounterId',v_encounter),
        '{"review":{"summary":"Original generated summary"},"telemetry":{"serviceTierActual":"test"}}','synthetic-test') returning id into v_run;
    insert into ehr.encounter_review(patient_id,encounter_id,run_id,base_state_version,generated_content)
      select p.id,v_encounter,v_run,v_base,output from ehr.agent_run where id=v_run returning id into v_review;
    assert (select max(state_version)=v_base from ehr.patient_state where patient_id=p.id),'Generation mutated state';
    insert into ehr.event(patient_id,event_type,actor_type,actor_id,payload)
      values(p.id,'ASTRA_REVIEW_DECIDED','physician','ROLLBACK-QA',
        jsonb_build_object('encounterId',v_encounter,'runId',v_run,'decision','edited')) returning id into v_event;
    update ehr.encounter_review set status='edited',reviewed_content='{"summary":"Physician-edited summary"}',
      decision_event_id=v_event,reviewed_by_id='ROLLBACK-QA',reviewed_at=clock_timestamp() where id=v_review;
    v_version:=ehr.reduce_patient_state(p.id,v_event,'patient-state-reducer-v4');
    assert v_version=v_base+1,'Narrative version mismatch';
    assert ehr.review_source_current(p.id,v_base,v_run),'Same-run narrative should allow sibling action';
    select state into v_after from ehr.patient_state where patient_id=p.id and state_version=v_version;
    assert v_after#>>'{approvedEncounterReview,content,summary}'='Physician-edited summary','Reviewed summary lost';
    assert (select generated_content#>>'{review,summary}'='Original generated summary' from ehr.encounter_review where id=v_review),'Generated text overwritten';
    assert (select previous_state=v_before and resulting_state=v_after from ehr.patient_state_audit where patient_id=p.id and resulting_version=v_version),'Audit snapshots mismatch';
    v_before:=v_after;
    select greatest(clock_timestamp(),max(observed_at)+interval '1 second') into v_at from ehr.clinical_observation where patient_id=p.id;
    insert into ehr.event(patient_id,event_type,actor_type,actor_id,payload)
      values(p.id,'SCRIBE_REVIEW_DECIDED','physician','ROLLBACK-QA',jsonb_build_object('encounterId',v_encounter)) returning id into v_event;
    insert into ehr.clinical_observation(patient_id,observation_type,value_numeric,observed_at,source_event_id,client_record_id)
      values(p.id,'eGFR',25,v_at,v_event,'V4-QA-EGFR-'||gen_random_uuid()) returning id into v_obs;
    insert into ehr.proposed_observation(patient_id,encounter_id,client_record_id,field,display_label,observation_type,value_numeric,observed_at,status,accepted_observation_id,decision_event_id,reviewed_at)
      values(p.id,v_encounter,'V4-QA-PROPOSAL-'||gen_random_uuid(),'eGFR','eGFR','lab',30,v_at,'edited',v_obs,v_event,clock_timestamp()) returning id into v_proposal;
    insert into ehr.clinical_observation(patient_id,observation_type,value_json,observed_at,source_event_id,client_record_id)
      values(p.id,'BloodPressure','{"systolic":126,"diastolic":72}',v_at,v_event,'V4-QA-BP-'||gen_random_uuid()) returning id into v_obs;
    insert into ehr.proposed_observation(patient_id,encounter_id,client_record_id,field,display_label,observation_type,value_json,observed_at,status,accepted_observation_id,decision_event_id,reviewed_at)
      values(p.id,v_encounter,'V4-QA-BP-PROPOSAL-'||gen_random_uuid(),'bloodPressure','Blood pressure','vital','{"systolic":128,"diastolic":74}',v_at,'edited',v_obs,v_event,clock_timestamp());
    insert into ehr.proposed_observation(patient_id,encounter_id,client_record_id,field,display_label,observation_type,value_numeric,observed_at,status,decision_event_id,reviewed_at)
      values(p.id,v_encounter,'V4-QA-REJECT-'||gen_random_uuid(),'eGFR','Rejected eGFR','lab',999,v_at+interval '1 second','rejected',v_event,clock_timestamp());
    v_version:=ehr.reduce_patient_state(p.id,v_event,'patient-state-reducer-v4');
    select state into v_after from ehr.patient_state where patient_id=p.id and state_version=v_version;
    assert v_version=v_base+2,'Observation version mismatch';
    assert (v_after#>>'{labs,eGFR,value}')::numeric=25,'Edited lab lost';
    assert (v_after#>>'{scribeObservations,eGFR,value}')::numeric=25,'Scribe summary used original lab';
    assert (v_after#>>'{scribeObservations,bloodPressure,value,systolic}')::numeric=126,'Scribe summary used original BP';
    assert v_after#>>'{scribeObservations,eGFR,status}'='edited','Edited status lost';
    assert not ehr.review_source_current(p.id,v_base,v_run),'Unrelated clinical change must stale Astra';
    assert (select previous_state=v_before and resulting_state=v_after from ehr.patient_state_audit where patient_id=p.id and resulting_version=v_version),'Observation audit mismatch';
    v_rejected:=false;
    begin
      update ehr.patient_state_audit set resulting_state='{}' where patient_id=p.id and resulting_version=v_version;
    exception when others then
      if sqlerrm='patient_state_history_is_append_only' then v_rejected:=true; else raise; end if;
    end;
    assert v_rejected,'Audit mutation allowed';
    insert into ehr.event(patient_id,event_type,actor_type,actor_id,payload)
      values(p.id,'ENCOUNTER_SIGNED','physician','ROLLBACK-QA',jsonb_build_object('encounterId',v_encounter,'stateVersion',v_version)) returning id into v_sign;
    update ehr.synthetic_encounter set status='signed',signed_at=clock_timestamp(),signed_event_id=v_sign,final_state_version=v_version where id=v_encounter;
    assert (select ps.state=v_after and (ps.state::text)::jsonb=v_after from ehr.synthetic_encounter e
      join ehr.patient_state ps on ps.patient_id=e.patient_id and ps.state_version=e.final_state_version where e.id=v_encounter),'Signed reload mismatch';
    insert into v4_results values(p.external_id,'PASS: generation, edits, rejection, audit, freshness, signed-state reload');
    v_count:=v_count+1;
  end loop;
  assert v_count=24,'Expected all 24 synthetic patients';
end;
$$;
select * from v4_results order by patient_id;
rollback;
