-- Synthetic development only. All fixture writes are rolled back.
begin;
create temporary table v5_results(patient_id text,checks text) on commit drop;
do $$
declare
  p record; principal uuid; encounter uuid; package uuid; item uuid; ev uuid;
  source jsonb; base bigint; generated jsonb; denied boolean; count_patients integer:=0;
begin
  insert into iam.principal(external_id,display_name,synthetic,active)
    values('V5-ROLLBACK-QA-'||gen_random_uuid(),'Synthetic v5 rollback QA',true,true) returning id into principal;
  for p in select id,external_id from ehr.patient where active and synthetic order by external_id loop
    perform 1 from ehr.patient where id=p.id for update;
    select coalesce(a.resulting_state,s.state),s.state_version into source,base
      from ehr.patient_state s left join ehr.patient_state_audit a on a.patient_id=s.patient_id and a.resulting_version=s.state_version
      where s.patient_id=p.id order by s.state_version desc limit 1;
    insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,note_text,sources,base_state_version)
      values(p.id,principal,'Synthetic signed QA source','[{"kind":"typed-note","title":"QA"}]',base) returning id into encounter;
    insert into ehr.event(patient_id,event_type,actor_type,actor_id,payload)
      values(p.id,'V5_QA_SIGNED_FIXTURE','physician','ROLLBACK-QA',jsonb_build_object('encounterId',encounter,'synthetic',true)) returning id into ev;
    update ehr.synthetic_encounter set status='signed',signed_at=now(),signed_event_id=ev,final_state_version=base where id=encounter;
    generated:=jsonb_build_object('noteText','Original synthetic note','patientInstructions','Original instructions','externalExecution',false);
    insert into ehr.encounter_completion(patient_id,encounter_id,clinician_principal_id,source_state_version,source_state,generated_content,note_text,patient_instructions)
      values(p.id,encounter,principal,base,source,generated,'Original synthetic note','Original instructions') returning id into package;
    insert into ehr.encounter_completion_item(completion_id,kind,label,details,due_date)
      values(package,'follow-up','Synthetic follow-up','QA only',current_date+7) returning id into item;
    denied:=false;
    begin
      update ehr.encounter_completion set status='approved',approved_by_id='ROLLBACK-QA',approved_at=now(),version=version+1 where id=package;
    exception when others then if sqlerrm='completion_item_review_required' then denied:=true; else raise; end if; end;
    assert denied,'Pending items failed to block package approval';
    denied:=false;
    begin
      update ehr.encounter_completion set source_state='{}',version=version+1 where id=package;
    exception when others then if sqlerrm='completion_source_is_immutable' then denied:=true; else raise; end if; end;
    assert denied,'Source rewrite was allowed';
    update ehr.encounter_completion set note_text='Physician-edited synthetic note',patient_instructions='Edited instructions',version=version+1 where id=package;
    assert (select generated_content=generated from ehr.encounter_completion where id=package),'Original draft changed';
    update ehr.encounter_completion_item set status='approved',reviewed_by_id='ROLLBACK-QA',reviewed_at=now() where id=item;
    update ehr.encounter_completion set status='approved',approved_by_id='ROLLBACK-QA',approved_at=now(),version=version+1 where id=package;
    denied:=false;
    begin
      update ehr.encounter_completion set note_text='tamper',version=version+1 where id=package;
    exception when others then if sqlerrm='approved_completion_is_immutable' then denied:=true; else raise; end if; end;
    assert denied,'Approved note rewrite was allowed';
    update ehr.encounter_completion_item set status='completed',completion_note='Synthetic QA follow-up completed',resolved_by_id='ROLLBACK-QA',resolved_at=now() where id=item;
    update ehr.encounter_completion set version=version+1 where id=package;
    insert into ehr.event(patient_id,event_type,actor_type,actor_id,payload)
      values(p.id,'COMPLETION_QA_VERIFIED','physician','ROLLBACK-QA',jsonb_build_object('completionId',package,'externalExecution',false)) returning id into ev;
    insert into ehr.encounter_completion_history(completion_id,event_id,version,action,actor_id,before_snapshot,after_snapshot)
      values(package,ev,4,'QA_VERIFIED','ROLLBACK-QA',jsonb_build_object('status','draft'),jsonb_build_object('status','approved','noteText','Physician-edited synthetic note'));
    denied:=false;
    begin
      delete from ehr.encounter_completion_history where completion_id=package;
    exception when others then if sqlerrm='completion_history_is_immutable' then denied:=true; else raise; end if; end;
    assert denied,'History deletion was allowed';
    assert (select source_state=source and source_state_version=base from ehr.encounter_completion where id=package),'Source snapshot mismatch';
    assert (select max(state_version)=base from ehr.patient_state where patient_id=p.id),'Completion changed canonical Patient State';
    assert (select simulated=true and status='completed' from ehr.encounter_completion_item where id=item),'Simulated task tracking failed';
    insert into v5_results values(p.external_id,'PASS: source pin, original draft, approval guards, immutable sign-off/history, simulated follow-up, unchanged clinical state');
    count_patients:=count_patients+1;
  end loop;
  assert count_patients=24,'Expected 24 synthetic patients';
  assert not has_table_privilege('anon','ehr.encounter_completion','select'),'Anon table access allowed';
  assert not has_table_privilege('authenticated','ehr.encounter_completion_history','update'),'Browser history update allowed';
end;
$$;
select * from v5_results order by patient_id;
rollback;
