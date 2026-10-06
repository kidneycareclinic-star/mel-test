export function inboxFail(code:string,status=400):never {throw Object.assign(new Error(code),{status});}
export const inboxUuid=(value:any)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// Every query checks current ownership, identity, assignment, role, workspace and read/draft scope.
const eligible=`select j.*,p.external_id,p.display_name,e.status as encounter_status,e.version as encounter_version,
  (select d.id from ehr.synthetic_encounter d where d.patient_id=p.id and d.clinician_principal_id=$1::uuid and d.status='draft' order by d.created_at desc,d.id desc limit 1) as current_draft
  from ehr.encounter_job j join ehr.synthetic_encounter e on e.id=j.encounter_id and e.patient_id=j.patient_id and e.clinician_principal_id=j.clinician_principal_id
  join ehr.patient p on p.id=j.patient_id and p.active and p.synthetic
  join iam.principal person on person.id=j.clinician_principal_id and person.active and person.synthetic and person.principal_type='clinician'
  where j.clinician_principal_id=$1::uuid and exists(
    select 1 from iam.practice_membership pm join iam.patient_assignment pa on pa.principal_id=pm.principal_id and pa.practice_id=pm.practice_id
    where pm.principal_id=$1::uuid and pa.patient_id=p.id and pm.active and pa.active and pm.role='physician'
    and 'office'=any(pm.workspaces) and 'office'=any(pa.workspaces)
    and pm.permissions->'patient.read'='true'::jsonb and pm.permissions->'encounter.draft'='true'::jsonb)`;
const decorated=`with eligible as (${eligible}), current_jobs as (
  select e.id,e.encounter_id,e.external_id as "patientId",e.display_name as "patientName",e.stage,e.updated_at as "updatedAt",
    case when e.status in ('ready','queued','running') and e.expires_at<=now() then 'expired' else e.status end as status,
    e.source_version<>e.encounter_version as "sourceChanged",
    coalesce((select max(ev.id)::text from ehr.encounter_job_event ev where ev.job_id=e.id),'0') as event_key
  from eligible e where e.encounter_status='draft' and e.current_draft=e.encounter_id and e.status in ('queued','running','ready','failed')
), described as (select c.*,c.event_key||':'||c.status as revision from current_jobs c), visible as (
  select d.id,d.encounter_id as "encounterId",d."patientId",d."patientName",d.stage,d."updatedAt",d.status,d."sourceChanged",d.revision,
    coalesce(s.revision=d.revision,false) as seen from described d left join ehr.encounter_inbox_seen s on s.job_id=d.id and s.clinician_principal_id=$1::uuid
)`;
export async function inboxView(tx:any,person:any,params:URLSearchParams){
  const filter=params.get('filter')||'attention',raw=params.get('page')||'0';
  if(!['attention','preparing'].includes(filter)||!/^\d{1,4}$/.test(raw))inboxFail('invalid_filter');
  const page=Number(raw),limit=50;
  const [counts]=await tx.unsafe(decorated+` select count(*) filter(where status in ('ready','failed','expired'))::int as attention,
    count(*) filter(where status in ('ready','failed','expired') and not seen)::int as unseen,
    count(*) filter(where status in ('queued','running'))::int as preparing from visible`,[person.id]);
  const statuses=filter==='attention'?['ready','failed','expired']:['queued','running'];
  const items=await tx.unsafe(decorated+` select * from visible where status=any($2::text[]) order by seen,"updatedAt" desc,id limit $3 offset $4`,[person.id,statuses,limit,page*limit]);
  const total=filter==='attention'?counts.attention:counts.preparing;
  return {items,counts,page,total,hasNext:(page+1)*limit<total,phoneDelivery:false};
}
export async function resolveReview(tx:any,person:any,jobId:any){
  if(!inboxUuid(jobId))inboxFail('invalid_link');
  const [original]=await tx.unsafe('with eligible as ('+eligible+') select id,patient_id,external_id,encounter_id,encounter_status,current_draft from eligible where id=$2::uuid',[person.id,jobId]);
  if(!original)inboxFail('review_link_unavailable',404);
  if(original.encounter_status==='signed'){
    const [receipt]=await tx.unsafe('select encounter_id from ehr.encounter_approval_receipt where encounter_id=$1::uuid and clinician_principal_id=$2::uuid limit 1',[original.encounter_id,person.id]);
    if(!receipt)inboxFail('review_link_no_longer_current',410);
    return {mode:'signed',patientId:original.external_id,encounterId:original.encounter_id,jobId:original.id,replaced:false};
  }
  if(original.current_draft!==original.encounter_id)inboxFail('review_link_no_longer_current',410);
  const [current]=await tx.unsafe(decorated+' select * from visible where "encounterId"=$2::uuid',[person.id,original.encounter_id]);
  if(!current)inboxFail('review_link_no_longer_current',410);
  return {mode:'review',patientId:current.patientId,encounterId:current.encounterId,jobId:current.id,status:current.status,revision:current.revision,replaced:current.id!==original.id||current.sourceChanged};
}
export async function markSeen(tx:any,person:any,body:any){
  if(body?.action!=='seen'||!inboxUuid(body.jobId)||typeof body.revision!=='string'||body.revision.length>100)inboxFail('invalid_request');
  // Match the same lock order as preparation/signing: patient, IAM, job.
  const [row]=await tx.unsafe('with eligible as ('+eligible+') select patient_id from eligible where id=$2::uuid',[person.id,body.jobId]);
  if(!row)inboxFail('review_link_unavailable',404);
  await tx.unsafe('select id from ehr.patient where id=$1::uuid for update',[row.patient_id]);
  await tx.unsafe(`select person.id from iam.principal person join iam.practice_membership pm on pm.principal_id=person.id join iam.patient_assignment pa on pa.principal_id=person.id and pa.practice_id=pm.practice_id
    where person.id=$1::uuid and pa.patient_id=$2::uuid for share of person,pm,pa`,[person.id,row.patient_id]);
  await tx.unsafe('select id from ehr.encounter_job where id=$1::uuid for update',[body.jobId]);
  const current=await resolveReview(tx,person,body.jobId);
  if(current.mode!=='review'||current.jobId!==body.jobId||current.revision!==body.revision)inboxFail('inbox_item_changed',409);
  await tx.unsafe(`insert into ehr.encounter_inbox_seen(job_id,clinician_principal_id,revision) values($1::uuid,$2::uuid,$3)
    on conflict(job_id,clinician_principal_id) do update set revision=excluded.revision,seen_at=now()`,[body.jobId,person.id,body.revision]);
  await tx.unsafe("insert into iam.access_audit(principal_id,patient_id,action,workspace,allowed,reason) values($1::uuid,$2::uuid,'patient.read','office',true,'Encounter inbox marked seen; no clinical approval.')",[person.id,row.patient_id]);
  return {seen:true,jobId:body.jobId,revision:body.revision};
}
