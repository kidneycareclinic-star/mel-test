import {patientAccess} from '../encounter-coordinator/clinician-auth.ts';
import {snapshot,digest,saveReviewDraft} from '../encounter-coordinator/coordinator.ts';
import {jsonObject} from '../encounter-coordinator/json-boundary.ts';
import {reviewActions,evidenceCorpus} from '../encounter-coordinator/clinical-actions.ts';
import {revisionFail,revisionRequest,revisionOutput,buildRevision} from './revision.ts';
// All writes use the existing patient -> identity/assignment -> encounter -> packet order.
export async function revisionAccess(tx:any,person:any,patientId:string,externalId:string){
 await tx.unsafe('select id from ehr.patient where id=$1::uuid for update',[patientId]);
 const rows=await tx.unsafe('select p.id from iam.principal p join iam.practice_membership pm on pm.principal_id=p.id join iam.patient_assignment pa on pa.principal_id=p.id and pa.practice_id=pm.practice_id where p.id=$1::uuid and pa.patient_id=$2::uuid and p.active and p.synthetic and pm.active and pa.active for share of p,pm,pa',[person.id,patientId]);
 if(!rows.length)revisionFail('patient_access_denied',403);await patientAccess(tx,person,externalId,'office','encounter.draft');
}
export async function revisionCurrent(tx:any,person:any,patientId:string,externalId:string,expected:any){
 const [encounter]=await tx.unsafe("select id,version from ehr.synthetic_encounter where patient_id=$1::uuid and clinician_principal_id=$2::uuid and status='draft' order by created_at desc,id desc limit 1 for update",[patientId,person.id]);
 if(encounter?.id!==expected.encounterId||Number(encounter.version)!==expected.sourceVersion)revisionFail('revision_context_changed',409);
 const source=await snapshot(tx,patientId,externalId,person,encounter.id,true);
 const [run]=await tx.unsafe('select * from ehr.encounter_preparation where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid for update',[expected.preparationId,patientId,person.id]);
 if(!run||run.encounter_id!==encounter.id||run.status!=='ready'||run.packet_hash!==expected.packetHash||Date.parse(run.expires_at)<=Date.now()||await digest(source)!==run.source_hash)revisionFail('revision_context_changed',409);
 const [edit]=await tx.unsafe('select version,reviewed_snapshot from ehr.encounter_packet_edit where preparation_id=$1::uuid order by version desc limit 1',[run.id]);
 if(!edit||edit.version!==expected.reviewVersion)revisionFail('revision_review_changed',409);
 const before=jsonObject(edit.reviewed_snapshot,'revision_review'),packet=jsonObject(run.packet,'revision_packet');if(!['v10b','v11'].includes(packet.packetVersion)||packet.clinicalEvidence?.corpusVersion!==evidenceCorpus.version)revisionFail('revision_context_changed',409);return {run,packet,before,hash:await digest(before)};
}
function revisionExpected(row:any){return {encounterId:row.encounter_id,sourceVersion:row.source_version,preparationId:row.preparation_id,packetHash:row.packet_hash,reviewVersion:row.base_review_version};}
export function revisionEnvelope(externalId:string,row:any){return {patientId:externalId,encounterId:row.encounter_id,sourceVersion:row.source_version,preparationId:row.preparation_id,packetHash:row.packet_hash,reviewVersion:row.base_review_version,command:row.command,proposalId:row.id,expiresAt:row.expires_at,confirmationRequired:true,externalExecution:false};}
export async function proposeRevision(sql:any,person:any,patientId:string,externalId:string,input:any,key:string,fetcher=fetch){
 const reserved=await sql.begin(async(tx:any)=>{await revisionAccess(tx,person,patientId,externalId);const current=await revisionCurrent(tx,person,patientId,externalId,input);await tx.unsafe('select pg_advisory_xact_lock(hashtextextended($1,18))',['revision:'+person.id]);
  const [rate]=await tx.unsafe("select count(*)::int as count from ehr.encounter_revision_proposal where clinician_principal_id=$1::uuid and created_at>now()-interval '1 hour'",[person.id]);if(rate.count>=20)revisionFail('revision_rate_limited',429);
  const expires=new Date(Math.min(Date.now()+600000,Date.parse(current.run.expires_at))).toISOString();
  const [row]=await tx.unsafe('insert into ehr.encounter_revision_proposal(patient_id,clinician_principal_id,encounter_id,preparation_id,source_version,packet_hash,base_review_version,base_hash,command,before_snapshot,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::text::jsonb,$11::timestamptz) returning *',[patientId,person.id,input.encounterId,input.preparationId,input.sourceVersion,input.packetHash,input.reviewVersion,current.hash,input.command,JSON.stringify(current.before),expires]);return {row,current};
 });
 try{
  let response:Response;try{response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(revisionRequest(input.command,reserved.current.before,reserved.current.packet)),signal:AbortSignal.timeout(45000)});}catch(_){revisionFail('revision_provider_failed',502);}
  if(!response.ok)revisionFail(response.status===429?'revision_provider_rate_limited':'revision_provider_failed',response.status===429?429:502);
  const output=await response.json().catch(()=>revisionFail('revision_invalid_output',502)),built=buildRevision(revisionOutput(output),reserved.current.before,reserved.current.packet,input.command);
  if(built.kind==='proposal')reviewActions(reserved.current.packet,built.after.actions);
  return await sql.begin(async(tx:any)=>{await revisionAccess(tx,person,patientId,externalId);const current=await revisionCurrent(tx,person,patientId,externalId,input);if(current.hash!==reserved.row.base_hash)revisionFail('revision_review_changed',409);
   const [row]=await tx.unsafe('select * from ehr.encounter_revision_proposal where id=$1::uuid for update',[reserved.row.id]);if(row.status!=='preparing'||Date.parse(row.expires_at)<=Date.now())revisionFail('revision_expired',409);
   const model=typeof output.model==='string'?output.model.slice(0,120):null;
   if(built.kind==='clarify'){await tx.unsafe("update ehr.encounter_revision_proposal set status='clarified',clarification=$2,model=$3,updated_at=now() where id=$1::uuid",[row.id,built.clarification,model]);return {...revisionEnvelope(externalId,row),kind:'clarify',clarification:built.clarification};}
   await tx.unsafe("update ehr.encounter_revision_proposal set status='pending',after_snapshot=$2::text::jsonb,changes=$3::text::jsonb,model=$4,updated_at=now() where id=$1::uuid",[row.id,JSON.stringify(built.after),JSON.stringify(built.changes),model]);return {...revisionEnvelope(externalId,row),kind:'proposal',changes:built.changes};
  });
 }catch(error){await sql.begin(async(tx:any)=>{await tx.unsafe("update ehr.encounter_revision_proposal set status='failed',error_code=$2,updated_at=now() where id=$1::uuid and status='preparing'",[reserved.row.id,(error as any)?.status?(error as Error).message:'revision_provider_failed']);});throw error;}
}
export async function applyRevision(tx:any,person:any,patientId:string,externalId:string,input:any){
 await revisionAccess(tx,person,patientId,externalId);
 const [base]=await tx.unsafe('select * from ehr.encounter_revision_proposal where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid',[input.proposalId,patientId,person.id]);if(!base)revisionFail('revision_unavailable',404);
 if(!['pending','applied'].includes(base.status))revisionFail('revision_unavailable',409);if(base.status==='pending'&&Date.parse(base.expires_at)<=Date.now())revisionFail('revision_expired',409);
 const expected=revisionExpected(base);if(base.status==='applied')expected.reviewVersion=base.applied_review_version;
 const current=await revisionCurrent(tx,person,patientId,externalId,expected),after=jsonObject(base.after_snapshot,'revision_proposal');
 if(current.hash!==(base.status==='applied'?await digest(after):base.base_hash))revisionFail('revision_review_changed',409);
 const [row]=await tx.unsafe('select * from ehr.encounter_revision_proposal where id=$1::uuid for update',[base.id]);
 if(row.status==='applied')return {...revisionEnvelope(externalId,row),saved:true,appliedReviewVersion:row.applied_review_version,reviewedSnapshot:after,replayed:true};
 if(row.status!=='pending')revisionFail('revision_unavailable',409);
 const saved=await saveReviewDraft(tx,patientId,externalId,person,{preparationId:row.preparation_id,packetHash:row.packet_hash,reviewVersion:row.base_review_version,...after});
 await tx.unsafe("update ehr.encounter_revision_proposal set status='applied',applied_review_version=$2,updated_at=now() where id=$1::uuid",[row.id,saved.reviewVersion]);
 return {...revisionEnvelope(externalId,row),saved:true,appliedReviewVersion:saved.reviewVersion,reviewedSnapshot:after,replayed:false};
}
export async function discardRevision(tx:any,person:any,patientId:string,externalId:string,input:any){await revisionAccess(tx,person,patientId,externalId);const rows=await tx.unsafe("update ehr.encounter_revision_proposal set status='discarded',updated_at=now() where id=$1::uuid and patient_id=$2::uuid and clinician_principal_id=$3::uuid and status='pending' returning id",[input.proposalId,patientId,person.id]);if(!rows.length)revisionFail('revision_unavailable',404);return {discarded:true,proposalId:input.proposalId,externalExecution:false};}
