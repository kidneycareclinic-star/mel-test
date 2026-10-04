import { jsonObject, patientState } from "./json-boundary.ts";

export function fail(code:string,status=409):never { throw Object.assign(new Error(code),{status}); }
export const uuid=(value:unknown) => typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const kinds=new Set(["lab","medication","referral","follow-up"]);
function text(value:unknown,limit:number,required=true):string {
  if(typeof value!=="string"||value.length>limit||(required&&!value.trim()))fail("invalid_completion_content",400);
  return value.trim();
}
function date(value:unknown):string|null {
  if(value==null||value==="")return null;
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail("invalid_due_date",400);
  const parsed=new Date(value+"T12:00:00Z");
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail("invalid_due_date",400);
  return value;
}
function readable(value:any):string {return value==null?"Not documented":typeof value==="object"?String(value.name||value.label||JSON.stringify(value)):String(value);}
export function buildContent(source:any,externalId:string) {
  const patient=patientState(source.state_text,externalId);
  const summary=patient.approvedEncounterReview?.encounterId===source.id?patient.approvedEncounterReview?.content?.summary:null;
  const approvedSummary=typeof summary==="string"?summary:"No separate Astra narrative was approved for this encounter.";
  const labs=Object.entries(patient.labs||{}).map(([name,value]:[string,any])=>name+": "+readable(value.value)+" "+(value.unit||"")).join("\n");
  const meds=(patient.meds||[]).map(readable).join("\n")||"No medications documented in this snapshot.";
  const bp=patient.vitals?.bp||patient.bp;
  const bloodPressure=bp&&typeof bp==="object"?readable(bp.systolic)+"/"+readable(bp.diastolic):readable(bp);
  const note=["NEPHROLOGY VISIT NOTE",readable(patient.name||patient.displayName)+" · "+externalId,
    "Encounter signed: "+new Date(source.signed_at).toISOString(),
    "HISTORY AND SOURCE NOTE",source.note_text||"", "PHYSICIAN-APPROVED ASSESSMENT AND PLAN",approvedSummary,
    "REVIEWED CLINICAL DATA","Blood pressure: "+bloodPressure,labs,"MEDICATIONS RECORDED AT THIS VISIT",meds].join("\n\n");
  const instructions=["YOUR KIDNEY VISIT", "Patient: "+readable(patient.name||patient.displayName)+" · "+externalId,
    "Your visit record", "Kidney filtering blood test (eGFR): "+readable(patient.labs?.eGFR?.value)+" "+(patient.labs?.eGFR?.unit||""),
    "Blood pressure: "+bloodPressure,
    "What was reviewed",approvedSummary,
    "Medication list recorded at this visit",meds,
    "Questions to confirm with your clinician", "Which next steps should I follow? When should I have tests or return for my next visit?"].join("\n\n");
  return {noteText:note,patientInstructions:instructions,generator:"signed-snapshot-template-v5",externalExecution:false};
}
export async function signedSource(tx:any,patientId:string,externalId:string,person:any,encounterId:string,lock=false) {
  if(!uuid(encounterId))fail("invalid_encounter_id",400);
  const rows=await tx.unsafe("select e.id,e.note_text,e.signed_at,e.signed_event_id,e.final_state_version,coalesce(a.resulting_state,s.state)::text as state_text from ehr.synthetic_encounter e join ehr.patient_state s on s.patient_id=e.patient_id and s.state_version=e.final_state_version left join ehr.patient_state_audit a on a.patient_id=e.patient_id and a.resulting_version=e.final_state_version where e.id=$1::uuid and e.patient_id=$2::uuid and e.clinician_principal_id=$3::uuid and e.status='signed'"+(lock?" for update of e":""),[encounterId,patientId,person.id]);
  if(!rows.length)fail("signed_encounter_required",404);
  patientState(rows[0].state_text,externalId);
  return rows[0];
}
async function packageRow(tx:any,encounterId:string,lock=false) {
  const rows=await tx.unsafe("select * from ehr.encounter_completion where encounter_id=$1::uuid"+(lock?" for update":""),[encounterId]);
  return rows[0]||null;
}
async function items(tx:any,completionId:string) {
  return tx.unsafe("select id,kind,label,details,due_date::text,status,reviewed_by_id,reviewed_at,completion_note,resolved_by_id,resolved_at,simulated,created_at from ehr.encounter_completion_item where completion_id=$1::uuid order by created_at,id",[completionId]);
}
async function snapshot(tx:any,row:any) {
  const p=await packageRow(tx,row.encounter_id);
  return {version:p.version,status:p.status,noteText:p.note_text,patientInstructions:p.patient_instructions,approvedAt:p.approved_at,approvedBy:p.approved_by_id,sourceStateVersion:Number(p.source_state_version),items:await items(tx,p.id)};
}
async function record(tx:any,row:any,source:any,person:any,action:string,before:any) {
  const after=await snapshot(tx,row);
  const ev=await tx.unsafe("insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,causation_id,payload) values($1::uuid,$2,'physician',$3,'encounter-completion','recorded',$4::uuid,jsonb_build_object('encounterId',$5::uuid,'completionId',$6::uuid,'version',$7::int,'sourceStateVersion',$8::bigint,'externalExecution',false)) returning id",[row.patient_id,"COMPLETION_"+action,person.externalId,source.signed_event_id,row.encounter_id,row.id,after.version,after.sourceStateVersion]);
  await tx.unsafe("insert into ehr.encounter_completion_history(completion_id,event_id,version,action,actor_id,before_snapshot,after_snapshot) values($1::uuid,$2::uuid,$3,$4,$5,$6::text::jsonb,$7::text::jsonb)",[row.id,ev[0].id,after.version,action,person.externalId,before==null?null:JSON.stringify(before),JSON.stringify(after)]);
}
export async function completionView(tx:any,patientId:string,externalId:string,person:any,encounterId?:string) {
  const encounters=await tx.unsafe("select e.id,e.signed_at,e.final_state_version,c.status as completion_status,c.version as completion_version from ehr.synthetic_encounter e left join ehr.encounter_completion c on c.encounter_id=e.id where e.patient_id=$1::uuid and e.clinician_principal_id=$2::uuid and e.status='signed' order by e.signed_at desc,e.id limit 100",[patientId,person.id]);
  const selected=encounterId||encounters[0]?.id;
  if(!selected)return {encounters,selectedEncounter:null,package:null,items:[],history:[],externalExecution:false};
  const source=await signedSource(tx,patientId,externalId,person,selected);
  const row=await packageRow(tx,selected);
  if(row) {
    row.source_state=patientState(row.source_state,externalId);
    row.generated_content=jsonObject(row.generated_content,"generated_completion");
  }
  const history=row?await tx.unsafe("select version,action,actor_id,before_snapshot,after_snapshot,created_at from ehr.encounter_completion_history where completion_id=$1::uuid order by version desc limit 100",[row.id]):[];
  for(const entry of history)for(const key of ["before_snapshot","after_snapshot"])if(entry[key]!=null)entry[key]=jsonObject(entry[key],key);
  return {encounters,selectedEncounter:{id:source.id,signedAt:source.signed_at,sourceStateVersion:Number(source.final_state_version)},package:row,items:row?await items(tx,row.id):[],history,externalExecution:false};
}
export async function completionMutation(tx:any,patientId:string,externalId:string,person:any,body:any) {
  const source=await signedSource(tx,patientId,externalId,person,body.encounterId,true);
  let row=await packageRow(tx,body.encounterId,true);
  if(body.action==="create") {
    if(!row) {
      const generated=buildContent(source,externalId);
      const rows=await tx.unsafe("insert into ehr.encounter_completion(patient_id,encounter_id,clinician_principal_id,source_state_version,source_state,generated_content,note_text,patient_instructions) values($1::uuid,$2::uuid,$3::uuid,$4,$5::text::jsonb,$6::text::jsonb,$7,$8) returning *",[patientId,body.encounterId,person.id,source.final_state_version,source.state_text,JSON.stringify(generated),generated.noteText,generated.patientInstructions]);
      row=rows[0];
      await record(tx,row,source,person,"DRAFT_CREATED",null);
    }
    return completionView(tx,patientId,externalId,person,body.encounterId);
  }
  if(!row)fail("completion_package_required");
  if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion!==row.version)fail("completion_version_changed");
  const before=await snapshot(tx,row);
  let action:string;
  if(body.action==="save") {
    if(row.status!=="draft")fail("approved_completion_is_immutable");
    const note=text(body.noteText,60000),instructions=text(body.patientInstructions,40000);
    await tx.unsafe("update ehr.encounter_completion set note_text=$2,patient_instructions=$3,version=version+1,updated_at=now() where id=$1::uuid",[row.id,note,instructions]);
    action="DRAFT_SAVED";
  } else if(body.action==="add-item") {
    if(row.status!=="draft")fail("draft_package_required");
    if(before.items.length>=25)fail("completion_item_limit",400);
    if(!kinds.has(body.kind))fail("invalid_item_kind",400);
    const label=text(body.label,240),details=text(body.details??"",4000,false),due=date(body.dueDate);
    await tx.unsafe("insert into ehr.encounter_completion_item(completion_id,kind,label,details,due_date) values($1::uuid,$2,$3,$4,$5::date)",[row.id,body.kind,label,details,due]);
    await advance(tx,row.id);action="ITEM_ADDED";
  } else if(body.action==="decide-item"||body.action==="resolve-item") {
    if(!uuid(body.itemId))fail("invalid_item_id",400);
    const results=await tx.unsafe("select * from ehr.encounter_completion_item where id=$1::uuid and completion_id=$2::uuid for update",[body.itemId,row.id]);
    if(!results.length)fail("completion_item_not_found",404);
    const item=results[0];
    if(body.action==="decide-item") {
      if(row.status!=="draft"||item.status!=="pending"||!["approved","rejected"].includes(body.decision))fail("invalid_completion_item_transition");
      await tx.unsafe("update ehr.encounter_completion_item set status=$2,reviewed_by_id=$3,reviewed_at=now(),updated_at=now() where id=$1::uuid",[item.id,body.decision,person.externalId]);
      action=body.decision==="approved"?"ITEM_APPROVED":"ITEM_REJECTED";
    } else {
      if(row.status!=="approved"||item.status!=="approved"||!["completed","cancelled"].includes(body.decision))fail("invalid_completion_item_transition");
      const note=text(body.completionNote,2000);
      await tx.unsafe("update ehr.encounter_completion_item set status=$2,completion_note=$3,resolved_by_id=$4,resolved_at=now(),updated_at=now() where id=$1::uuid",[item.id,body.decision,note,person.externalId]);
      action=body.decision==="completed"?"ITEM_COMPLETED":"ITEM_CANCELLED";
    }
    await advance(tx,row.id);
  } else if(body.action==="approve") {
    if(row.status!=="draft")fail("approved_completion_is_immutable");
    if(before.items.some((item:any)=>item.status==="pending"))fail("completion_item_review_required");
    text(row.note_text,60000);text(row.patient_instructions,40000);
    await tx.unsafe("update ehr.encounter_completion set status='approved',approved_by_id=$2,approved_at=now(),version=version+1,updated_at=now() where id=$1::uuid",[row.id,person.externalId]);action="PACKAGE_APPROVED";
  } else fail("invalid_completion_action",400);
  await record(tx,row,source,person,action,before);
  return completionView(tx,patientId,externalId,person,body.encounterId);
}
async function advance(tx:any,id:string) {await tx.unsafe("update ehr.encounter_completion set version=version+1,updated_at=now() where id=$1::uuid",[id]);}
