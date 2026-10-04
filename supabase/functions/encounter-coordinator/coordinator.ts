import {patientState,jsonObject} from './json-boundary.ts';
import {preferences,chartContext,providerRequest,validateDraft} from './drafting.ts';
import {applyObservations} from './observations.ts';
export function coordinatorFail(code:string,status=409):never {throw Object.assign(new Error(code),{status});}
export const coordinatorUuid=(v:any)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function canonical(v:any):any {if(v instanceof Date)return v.toISOString();if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
export async function digest(v:any) {const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v))));return Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');}
async function stateRow(tx:any,patientId:string) {
  const [state]=await tx.unsafe('select state_version,state::text as state_text from ehr.patient_state where patient_id=$1::uuid order by state_version desc limit 1',[patientId]);
  if(!state)coordinatorFail('patient_state_not_found',404);return state;
}
export async function snapshot(tx:any,patientId:string,externalId:string,person:any,encounterId:string,lock=false) {
  const [e]=await tx.unsafe("select id,version,note_text,sources::text as sources_text from ehr.synthetic_encounter where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid and status='draft'"+(lock?' for update':''),[encounterId,patientId,person.id]);
  if(!e)coordinatorFail('encounter_draft_required',404);
  const st=await stateRow(tx,patientId),patient=patientState(st.state_text,externalId),sources=JSON.parse(e.sources_text);
  if(!Array.isArray(sources)||!sources.some(s=>s.kind!=='lab-trend'&&s.kind!=='attachment'&&s.text?.trim()))coordinatorFail('reviewed_source_required');
  const observations=await tx.unsafe("select id,client_record_id,field,display_label,observation_type,value_numeric,value_json,unit,source_text,observed_at,confidence,certainty,status,provenance_id from ehr.proposed_observation where patient_id=$1::uuid and encounter_id=$2::uuid and status='pending' order by id"+(lock?' for update':''),[patientId,encounterId]);
  const reviews=await tx.unsafe("select id,run_id,base_state_version,generated_content,status from ehr.encounter_review where patient_id=$1::uuid and encounter_id=$2::uuid and status='pending' order by id"+(lock?' for update':''),[patientId,encounterId]);
  const tools=await tx.unsafe("select id,tool_name,risk_level,input,status from ehr.tool_call where patient_id=$1::uuid and input->>'encounterId'=$2 and status='awaiting_approval' order by id"+(lock?' for update':''),[patientId,encounterId]);
  const context={mode:'prechart',encounterNote:e.note_text||'',reviewedSources:sources.filter(s=>s.kind!=='attachment'&&typeof s.text==='string').map(s=>({kind:s.kind,title:s.title,text:s.text})),chartContext:chartContext(patient,encounterId),approvedItems:[]};
  const result=canonical({encounterId:e.id,sourceVersion:e.version,stateVersion:Number(st.state_version),noteText:e.note_text,sources,patient,context,observations,reviews,tools});
  if(JSON.stringify(result).length>250000)coordinatorFail('encounter_packet_too_large',413);return result;
}
export async function coordinatorView(tx:any,patientId:string,externalId:string,person:any) {
  const st=await stateRow(tx,patientId),patient=patientState(st.state_text,externalId);
  const [e]=await tx.unsafe("select id,version,note_text,sources from ehr.synthetic_encounter where patient_id=$1::uuid and clinician_principal_id=$2::uuid and status='draft' order by created_at desc limit 1",[patientId,person.id]);
  const [run]=await tx.unsafe('select id,encounter_id,source_version,state_version,status,packet,packet_hash,error_code,created_at,expires_at from ehr.encounter_preparation where patient_id=$1::uuid and clinician_principal_id=$2::uuid order by created_at desc,id desc limit 1',[patientId,person.id]);
  const [receipt]=await tx.unsafe('select r.id,r.encounter_id,r.completion_id,r.state_version,r.created_at,c.note_text as "noteText",c.patient_instructions as "patientInstructions" from ehr.encounter_approval_receipt r join ehr.encounter_completion c on c.id=r.completion_id where r.patient_id=$1::uuid and r.clinician_principal_id=$2::uuid order by r.created_at desc limit 1',[patientId,person.id]);
  let current=false;
  if(run?.status==='ready'&&e?.id===run.encounter_id&&Date.parse(run.expires_at)>Date.now()){
    try{current=(await digest(await snapshot(tx,patientId,externalId,person,e.id)))===(await tx.unsafe('select source_hash from ehr.encounter_preparation where id=$1::uuid',[run.id]))[0].source_hash;}catch(_){}
  }
  const [edit]=run?await tx.unsafe('select version,reviewed_snapshot from ehr.encounter_packet_edit where preparation_id=$1::uuid order by version desc limit 1',[run.id]):[];
  return {patientId:externalId,patient,stateVersion:Number(st.state_version),draft:e||null,preparation:run?{...run,current,edit:edit||null}:null,receipt:receipt||null,capabilities:{guidelines:false,automaticOrders:false,phoneDelivery:false,externalExecution:false}};
}
// Call with a patient lock and revalidated assignment. Model work is outside this transaction.
export async function startPreparation(tx:any,patientId:string,externalId:string,person:any,body:any) {
  if(!coordinatorUuid(body.encounterId)||!Number.isSafeInteger(body.expectedVersion))coordinatorFail('invalid_preparation_request',400);
  const prefs=preferences(body.preferences),source=await snapshot(tx,patientId,externalId,person,body.encounterId,true);
  if(source.sourceVersion!==body.expectedVersion)coordinatorFail('encounter_version_changed');
  const sourceHash=await digest(source);
  const rows=await tx.unsafe("select * from ehr.encounter_preparation where encounter_id=$1::uuid and clinician_principal_id=$2::uuid and status in ('preparing','ready') order by created_at desc for update",[body.encounterId,person.id]);
  for(const old of rows){
    const same=old.source_hash===sourceHash&&JSON.stringify(canonical(old.preferences))===JSON.stringify(canonical(prefs));
    if(same&&Date.parse(old.expires_at)>Date.now()&&(old.status==='ready'||Date.parse(old.created_at)>Date.now()-120000))return {existing:true,run:old};
    await tx.unsafe("update ehr.encounter_preparation set status='superseded',completed_at=coalesce(completed_at,now()) where id=$1::uuid",[old.id]);
  }
  const [run]=await tx.unsafe('insert into ehr.encounter_preparation(patient_id,encounter_id,clinician_principal_id,source_version,state_version,source_hash,preferences,source_snapshot) values($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::text::jsonb,$8::text::jsonb) returning *',[patientId,body.encounterId,person.id,source.sourceVersion,source.stateVersion,sourceHash,JSON.stringify(prefs),JSON.stringify(source)]);
  return {existing:false,run};
}
export async function generatePacket(run:any,key:string) {
  const source=jsonObject(run.source_snapshot,'preparation_source'),prefs=jsonObject(run.preferences,'preparation_preferences');
  let res:Response;
  try{res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(providerRequest(source.context,prefs)),signal:AbortSignal.timeout(60000)});}catch(_){coordinatorFail('note_drafting_provider_failed',502);}
  if(!res.ok)coordinatorFail(res.status===429?'note_drafting_rate_limited':'note_drafting_provider_failed',res.status===429?429:502);
  const output=await res.json().catch(()=>coordinatorFail('note_drafting_invalid_output',502));
  if(output.status!=='completed')coordinatorFail('note_drafting_invalid_output',502);
  const text=(output.output||[]).filter((m:any)=>m.type==='message').flatMap((m:any)=>m.content||[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
  let value:any;try{value=JSON.parse(text);}catch(_){coordinatorFail('note_drafting_invalid_output',502);}
  const draft=validateDraft(value,prefs,source.context);
  return {patientId:source.patient.id,encounterId:source.encounterId,sourceVersion:source.sourceVersion,stateVersion:source.stateVersion,...draft,patientInstructions:'No patient-specific instructions documented. Edit this section to record the instructions discussed during the visit.',sources:source.context.reviewedSources,chart:source.patient,observations:source.observations,reviews:source.reviews,tools:source.tools,preferences:prefs,model:output.model,reviewRequired:true,externalExecution:false};
}
export async function finishPreparation(tx:any,patientId:string,externalId:string,person:any,run:any,packet:any) {
  const source=await snapshot(tx,patientId,externalId,person,run.encounter_id,true);
  const [current]=await tx.unsafe('select status from ehr.encounter_preparation where id=$1::uuid for update',[run.id]);
  if(current?.status!=='preparing'||await digest(source)!==run.source_hash)coordinatorFail('preparation_source_changed');
  const hash=await digest({preparationId:run.id,expiresAt:new Date(run.expires_at).toISOString(),packet});
  const [updated]=await tx.unsafe("update ehr.encounter_preparation set status='ready',packet=$2::text::jsonb,packet_hash=$3,completed_at=now() where id=$1::uuid returning *",[run.id,JSON.stringify(packet),hash]);return updated;
}
function content(v:any,max:number) {if(typeof v!=='string'||!v.trim()||v.length>max)coordinatorFail('invalid_review_content',400);return v;}
function exactDecisions(rows:any[],decisions:any[],key:string,allowed:string[]){
  if(!Array.isArray(decisions)||decisions.length!==rows.length||new Set(decisions.map(d=>d?.[key])).size!==rows.length||decisions.some(d=>!rows.some(r=>r.id===d?.[key])||!allowed.includes(d.decision)))coordinatorFail('packet_decisions_incomplete',400);
}
export async function finalizeBundle(tx:any,patientId:string,externalId:string,person:any,body:any) {
  if(!coordinatorUuid(body.preparationId)||!coordinatorUuid(body.idempotencyKey)||typeof body.packetHash!=='string')coordinatorFail('invalid_finalization_request',400);
  const requestHash=await digest({preparationId:body.preparationId,packetHash:body.packetHash,noteText:body.noteText,patientInstructions:body.patientInstructions,observations:body.observations,reviews:body.reviews,tools:body.tools,reviewVersion:body.reviewVersion});
  const [prior]=await tx.unsafe('select * from ehr.encounter_approval_receipt where clinician_principal_id=$1::uuid and idempotency_key=$2::uuid',[person.id,body.idempotencyKey]);
  if(prior){if(prior.patient_id!==patientId||prior.preparation_id!==body.preparationId||prior.request_hash!==requestHash)coordinatorFail('approval_replay_mismatch');return {receiptId:prior.id,encounterId:prior.encounter_id,completionId:prior.completion_id,stateVersion:Number(prior.state_version),status:'finalized',noteText:jsonObject(prior.reviewed_snapshot,'receipt').noteText,patientInstructions:jsonObject(prior.reviewed_snapshot,'receipt').patientInstructions,replayed:true,externalExecution:false};}
  const [run]=await tx.unsafe('select * from ehr.encounter_preparation where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid',[body.preparationId,patientId,person.id]);
  if(!run||run.status!=='ready'||run.packet_hash!==body.packetHash||Date.parse(run.expires_at)<=Date.now())coordinatorFail('review_packet_changed_or_expired');
  const source=await snapshot(tx,patientId,externalId,person,run.encounter_id,true);
  if(await digest(source)!==run.source_hash)coordinatorFail('preparation_source_changed');
  // Lock the run after encounter/items, following the patient -> encounter order.
  await tx.unsafe('select id from ehr.encounter_preparation where id=$1::uuid for update',[run.id]);
  const [edit]=await tx.unsafe('select version from ehr.encounter_packet_edit where preparation_id=$1::uuid order by version desc limit 1',[run.id]);
  if(!Number.isSafeInteger(body.reviewVersion)||body.reviewVersion!==(edit?.version||0))coordinatorFail('review_edits_changed');
  const note=content(body.noteText,20000),instructions=content(body.patientInstructions,40000);
  exactDecisions(source.observations,body.observations,'proposalId',['accepted','edited','rejected']);
  exactDecisions(source.reviews,body.reviews,'reviewId',['accepted','edited','rejected']);
  // v9A does not execute legacy agent tools; exclusions are explicit and audited.
  exactDecisions(source.tools,body.tools,'toolId',['rejected']);
  for(const d of body.reviews){const r=source.reviews.find((r:any)=>r.id===d.reviewId);if(d.decision!=='rejected'&&Number(r.base_state_version)!==source.stateVersion){const [fresh]=await tx.unsafe('select ehr.review_source_current($1::uuid,$2::bigint,$3::uuid) as current',[patientId,r.base_state_version,r.run_id]);if(fresh?.current!==true)coordinatorFail('stale_agent_review_regenerate');}if(d.decision==='edited')content(d.summary,20000);}
  const [event]=await tx.unsafe("insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,payload) values($1::uuid,'ENCOUNTER_BUNDLE_FINALIZED','physician',$2,'encounter-coordinator','recorded',$3::text::jsonb) returning id",[patientId,person.externalId,JSON.stringify({encounterId:run.encounter_id,preparationId:run.id,packetHash:run.packet_hash,requestHash,synthetic:true,externalExecution:false})]);
  try{await applyObservations(tx,patientId,run.encounter_id,person,body.observations);}catch(error){if((error as any)?.code)throw error;coordinatorFail((error as Error).message,400);}
  for(const d of body.reviews){const r=source.reviews.find((r:any)=>r.id===d.reviewId),generated=jsonObject(r.generated_content,'generated_review');const reviewed=d.decision==='rejected'?null:{...jsonObject(generated.review,'review'),...(d.decision==='edited'?{summary:d.summary}:{})};
    await tx.unsafe('update ehr.encounter_review set status=$2,reviewed_content=$3::text::jsonb,decision_event_id=$4::uuid,reviewed_by_id=$5,reviewed_at=now() where id=$1::uuid',[r.id,d.decision,reviewed===null?null:JSON.stringify(reviewed),event.id,person.externalId]);}
  for(const d of body.tools){await tx.unsafe("insert into ehr.approval(patient_id,tool_call_id,decision,decided_by_type,decided_by_id,event_id) values($1::uuid,$2::uuid,'rejected','physician',$3,$4::uuid)",[patientId,d.toolId,person.externalId,event.id]);await tx.unsafe("update ehr.tool_call set status='rejected' where id=$1::uuid",[d.toolId]);}
  // Even a visit with no new observations gets its own frozen audit snapshot.
  const [{state_version}]=await tx.unsafe("select ehr.reduce_patient_state($1::uuid,$2::uuid,'patient-state-reducer-v4') as state_version",[patientId,event.id]);
  const finalState=await stateRow(tx,patientId);
  await tx.unsafe("insert into ehr.provenance(patient_id,source_kind,source_label,source_system,actor_type,actor_id,certainty,raw_payload) values($1::uuid,'signed-encounter','Physician-finalized review bundle','mel-test','physician',$2,'known',$3::text::jsonb)",[patientId,person.externalId,JSON.stringify({encounterId:run.encounter_id,noteText:note,sources:source.sources,stateVersion:Number(state_version),packetHash:run.packet_hash,synthetic:true})]);
  await tx.unsafe("update ehr.synthetic_encounter set note_text=$2,status='signed',signed_at=now(),signed_event_id=$3::uuid,final_state_version=$4,version=version+1,updated_at=now() where id=$1::uuid",[run.encounter_id,note,event.id,state_version]);
  const original=jsonObject(run.packet,'review_packet');
  const [completion]=await tx.unsafe('insert into ehr.encounter_completion(patient_id,encounter_id,clinician_principal_id,source_state_version,source_state,generated_content,note_text,patient_instructions) values($1::uuid,$2::uuid,$3::uuid,$4,$5::text::jsonb,$6::text::jsonb,$7,$8) returning id',[patientId,run.encounter_id,person.id,state_version,finalState.state_text,JSON.stringify({noteText:original.noteText,patientInstructions:original.patientInstructions,generator:'encounter-coordinator-v9a',externalExecution:false}),note,instructions]);
  const before={version:1,status:'draft',noteText:note,patientInstructions:instructions,sourceStateVersion:Number(state_version),items:[]};
  const [created]=await tx.unsafe("insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,causation_id,payload) values($1::uuid,'COMPLETION_DRAFT_CREATED','physician',$2,'encounter-coordinator','recorded',$3::uuid,$4::text::jsonb) returning id",[patientId,person.externalId,event.id,JSON.stringify({encounterId:run.encounter_id,completionId:completion.id,externalExecution:false})]);
  await tx.unsafe("insert into ehr.encounter_completion_history(completion_id,event_id,version,action,actor_id,after_snapshot) values($1::uuid,$2::uuid,1,'DRAFT_CREATED',$3,$4::text::jsonb)",[completion.id,created.id,person.externalId,JSON.stringify(before)]);
  await tx.unsafe("update ehr.encounter_completion set status='approved',approved_by_id=$2,approved_at=now(),version=version+1,updated_at=now() where id=$1::uuid",[completion.id,person.externalId]);
  const after={...before,version:2,status:'approved',approvedBy:person.externalId};
  await tx.unsafe("insert into ehr.encounter_completion_history(completion_id,event_id,version,action,actor_id,before_snapshot,after_snapshot) values($1::uuid,$2::uuid,2,'PACKAGE_APPROVED',$3,$4::text::jsonb,$5::text::jsonb)",[completion.id,event.id,person.externalId,JSON.stringify(before),JSON.stringify(after)]);
  const [receipt]=await tx.unsafe('insert into ehr.encounter_approval_receipt(preparation_id,patient_id,encounter_id,clinician_principal_id,idempotency_key,request_hash,packet_hash,reviewed_snapshot,event_id,completion_id,state_version) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8::text::jsonb,$9::uuid,$10::uuid,$11) returning id',[run.id,patientId,run.encounter_id,person.id,body.idempotencyKey,requestHash,run.packet_hash,JSON.stringify({noteText:note,patientInstructions:instructions,observations:body.observations,reviews:body.reviews,tools:body.tools,before:source,after:JSON.parse(finalState.state_text)}),event.id,completion.id,state_version]);
  await tx.unsafe("update ehr.encounter_preparation set status='finalized' where id=$1::uuid",[run.id]);
  return {receiptId:receipt.id,encounterId:run.encounter_id,completionId:completion.id,stateVersion:Number(state_version),patient:patientState(finalState.state_text,externalId),status:'finalized',noteText:note,patientInstructions:instructions,externalExecution:false};
}

export async function saveReviewDraft(tx:any,patientId:string,externalId:string,person:any,body:any) {
  if(!coordinatorUuid(body.preparationId))coordinatorFail('invalid_review_request',400);
  const [run]=await tx.unsafe('select * from ehr.encounter_preparation where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid for update',[body.preparationId,patientId,person.id]);
  if(!run||run.status!=='ready'||run.packet_hash!==body.packetHash||Date.parse(run.expires_at)<=Date.now())coordinatorFail('review_packet_changed_or_expired');
  const source=await snapshot(tx,patientId,externalId,person,run.encounter_id);
  if(await digest(source)!==run.source_hash)coordinatorFail('preparation_source_changed');
  content(body.noteText,20000);content(body.patientInstructions,40000);
  exactDecisions(source.observations,body.observations,'proposalId',['accepted','edited','rejected']);exactDecisions(source.reviews,body.reviews,'reviewId',['accepted','edited','rejected']);exactDecisions(source.tools,body.tools,'toolId',['rejected']);
  const [prior]=await tx.unsafe('select version,reviewed_snapshot from ehr.encounter_packet_edit where preparation_id=$1::uuid order by version desc limit 1',[run.id]);
  if(!Number.isSafeInteger(body.reviewVersion)||body.reviewVersion!==(prior?.version||0))coordinatorFail('review_edits_changed');
  const reviewed={noteText:body.noteText,patientInstructions:body.patientInstructions,observations:body.observations,reviews:body.reviews,tools:body.tools};
  if(prior&&await digest(prior.reviewed_snapshot)===await digest(reviewed))return {reviewVersion:prior.version,saved:true};
  const version=(prior?.version||0)+1;if(version>1000)coordinatorFail('review_edit_limit');
  await tx.unsafe('insert into ehr.encounter_packet_edit(preparation_id,version,clinician_principal_id,reviewed_snapshot) values($1::uuid,$2,$3::uuid,$4::text::jsonb)',[run.id,version,person.id,JSON.stringify(reviewed)]);
  return {reviewVersion:version,saved:true};
}
