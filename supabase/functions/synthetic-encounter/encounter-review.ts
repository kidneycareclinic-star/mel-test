import { jsonObject, patientState } from "./json-boundary.ts";

export async function reviewAstra(tx:any, patientId:string, externalId:string, person:any, body:any) {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!uuid.test(body.encounterId||"")||!uuid.test(body.reviewId||"")||!["accepted","edited","rejected"].includes(body.decision))throw new Error("invalid_review");
  const encounter=await tx.unsafe("select id from ehr.synthetic_encounter where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid and status='draft' for update",[body.encounterId,patientId,person.id]);
  if(!encounter.length)throw Object.assign(new Error("encounter_draft_not_found"),{status:409});
  const rows=await tx.unsafe("select * from ehr.encounter_review where id=$1::uuid and patient_id=$2::uuid and encounter_id=$3::uuid for update",[body.reviewId,patientId,body.encounterId]);
  if(!rows.length||rows[0].status!=="pending")throw Object.assign(new Error("review_queue_changed_refresh_and_retry"),{status:409});
  const r=rows[0];
  const state=await tx.unsafe("select state_version,state::text as state_text from ehr.patient_state where patient_id=$1::uuid order by state_version desc limit 1",[patientId]);
  if(!state.length)throw new Error("patient_state_not_found");
  if(body.decision!=="rejected"&&Number(r.base_state_version)!==Number(state[0].state_version)){
    const fresh=await tx.unsafe("select ehr.review_source_current($1::uuid,$2::bigint,$3::uuid) as current",[patientId,r.base_state_version,r.run_id]);
    if(fresh[0]?.current!==true)throw Object.assign(new Error("stale_agent_review_regenerate"),{status:409});
  }
  const generated=jsonObject(r.generated_content,"generated_content");
  let reviewed:any=null;
  if(body.decision==="accepted")reviewed=jsonObject(generated.review,"astra_review");
  if(body.decision==="edited") {
    if(typeof body.summary!=="string"||!body.summary.trim()||body.summary.length>20000)throw new Error("invalid_review_summary");
    reviewed={...jsonObject(generated.review,"astra_review"),summary:body.summary.trim()};
  }
  const ev=await tx.unsafe("insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,payload) values($1::uuid,'ASTRA_REVIEW_DECIDED','physician',$2,'synthetic-encounter','recorded',jsonb_build_object('encounterId',$3::uuid,'reviewId',$4::uuid,'runId',$5::uuid,'decision',$6::text)) returning id",[patientId,person.externalId,body.encounterId,body.reviewId,r.run_id,body.decision]);
  await tx.unsafe("update ehr.encounter_review set status=$2,reviewed_content=$3::text::jsonb,decision_event_id=$4::uuid,reviewed_by_id=$5,reviewed_at=now() where id=$1::uuid",[body.reviewId,body.decision,reviewed===null?null:JSON.stringify(reviewed),ev[0].id,person.externalId]);
  let stateVersion=Number(state[0].state_version);
  if(reviewed){
    const reduced=await tx.unsafe("select ehr.reduce_patient_state($1::uuid,$2::uuid,'patient-state-reducer-v4') as state_version",[patientId,ev[0].id]);
    stateVersion=Number(reduced[0].state_version);
  }
  const saved=await tx.unsafe("select state::text as state_text from ehr.patient_state where patient_id=$1::uuid and state_version=$2",[patientId,stateVersion]);
  return {reviewId:r.id,status:body.decision,persisted:reviewed!==null,eventId:ev[0].id,stateVersion,patient:patientState(saved[0].state_text,externalId)};
}

export async function encounterDetail(tx:any, patientId:string, encounterId:string) {
  const observations=await tx.unsafe("select po.id,po.field,po.display_label,po.status,po.value_numeric as original_numeric,po.value_json as original_json,po.source_text,po.unit,po.reviewed_at,po.reviewed_by_id,co.value_numeric as reviewed_numeric,co.value_json as reviewed_json from ehr.proposed_observation po left join ehr.clinical_observation co on co.id=po.accepted_observation_id and co.patient_id=po.patient_id where po.patient_id=$1::uuid and po.encounter_id=$2::uuid order by po.created_at,po.id",[patientId,encounterId]);
  const reviews=await tx.unsafe("select id,run_id,status,base_state_version,generated_content,reviewed_content,reviewed_by_id,reviewed_at from ehr.encounter_review where patient_id=$1::uuid and encounter_id=$2::uuid order by created_at,id",[patientId,encounterId]);
  const audit=await tx.unsafe("select a.id,a.previous_version,a.resulting_version,a.previous_state,a.resulting_state,a.created_at,e.actor_id,e.event_type,e.payload from ehr.patient_state_audit a join ehr.event e on e.id=a.event_id where a.patient_id=$1::uuid and a.encounter_id=$2::uuid order by a.resulting_version",[patientId,encounterId]);
  for(const row of observations)for(const key of ["original_json","reviewed_json"])if(row[key]!=null)row[key]=jsonObject(row[key],key);
  for(const row of reviews)for(const key of ["generated_content","reviewed_content"])if(row[key]!=null)row[key]=jsonObject(row[key],key);
  for(const row of audit)for(const key of ["previous_state","resulting_state","payload"])if(row[key]!=null)row[key]=jsonObject(row[key],key);
  const tools=await tx.unsafe("select id,tool_name,status,input from ehr.tool_call where patient_id=$1::uuid and input->>'encounterId'=$2 order by created_at,id",[patientId,encounterId]);
  for(const row of tools)row.input=jsonObject(row.input,"tool_input");
  return {observations,reviews,audit,tools};
}
