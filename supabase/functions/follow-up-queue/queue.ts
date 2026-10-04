// Read-only queue over approved synthetic visit packages. Updates use v5 gates.
export function options(query:URLSearchParams) {
  const status=query.get("status")||"approved",kind=query.get("kind")||"all",due=query.get("due")||"all";
  const today=query.get("today")||new Date().toISOString().slice(0,10);
  const patient=query.get("patient_id")||"all",pageText=query.get("page")||"0";
  if(!["approved","completed","cancelled","all"].includes(status)||
     !["lab","medication","referral","follow-up","all"].includes(kind)||
     !["overdue","today","future","no-date","all"].includes(due)||
     !(patient==="all"||/^PT-\d{3}$/.test(patient))||
     !/^\d{1,4}$/.test(pageText)||Number(pageText)>1000)throw Object.assign(new Error("invalid_queue_filter"),{status:400});
  const date=new Date(today+"T12:00:00Z");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==today)throw Object.assign(new Error("invalid_queue_date"),{status:400});
  return {status,kind,due,today,patient,page:Number(pageText)};
}
const eligible=`with eligible as (
  select p.id,p.external_id,p.display_name from ehr.patient p
  where p.active=true and p.synthetic=true and exists (
    select 1 from iam.practice_membership pm join iam.patient_assignment pa
      on pa.practice_id=pm.practice_id and pa.principal_id=pm.principal_id
    where pm.principal_id=$1::uuid and pa.patient_id=p.id and pm.active=true and pa.active=true
      and pm.role='physician' and 'office'=any(pm.workspaces) and 'office'=any(pa.workspaces)
      and pm.permissions->'patient.read'='true'::jsonb
  )
) `;
const base=`from ehr.encounter_completion_item i join ehr.encounter_completion c on c.id=i.completion_id
  join eligible p on p.id=c.patient_id
  where c.clinician_principal_id=$1::uuid and c.status='approved'
    and i.status in ('approved','completed','cancelled') `;
const filters=`and ($2::text='all' or i.status=$2::text) and ($3::text='all' or i.kind=$3::text)
  and ($6::text='all' or p.external_id=$6::text)
  and ($4::text='all' or ($4::text='overdue' and i.due_date<$5::date)
    or ($4::text='today' and i.due_date=$5::date) or ($4::text='future' and i.due_date>$5::date)
    or ($4::text='no-date' and i.due_date is null)) `;
export async function queueView(tx:any,person:any,opts:any) {
  const params=[person.id,opts.status,opts.kind,opts.due,opts.today,opts.patient];
  const summary=await tx.unsafe(eligible+`select count(*)::int as total,
    count(*) filter(where i.status='approved')::int as outstanding,
    count(*) filter(where i.status='approved' and i.due_date<$2::date)::int as overdue,
    count(*) filter(where i.status='approved' and i.due_date=$2::date)::int as due_today,
    count(*) filter(where i.status='approved' and i.due_date is null)::int as no_date,
    count(*) filter(where i.status='completed')::int as completed,
    count(*) filter(where i.status='cancelled')::int as cancelled `+base,[person.id,opts.today]);
  const counts=await tx.unsafe(eligible+"select count(*)::int as total "+base+filters,params);
  const rows=await tx.unsafe(eligible+`select i.id,i.kind,i.label,i.details,i.due_date::text,i.status,i.completion_note,i.resolved_at,
    p.external_id as patient_id,p.display_name,c.encounter_id,c.version as package_version,c.source_state_version,
    case when i.due_date is null then 'no-date' when i.due_date<$5::date then 'overdue'
      when i.due_date=$5::date then 'today' else 'future' end as due_group `+base+filters+
    "order by case i.status when 'approved' then 0 when 'completed' then 1 else 2 end,i.due_date nulls last,p.external_id,i.created_at,i.id limit 100 offset $7::int",[...params,opts.page*100]);
  for(const row of rows)row.source_state_version=Number(row.source_state_version);
  const unfinished=await tx.unsafe(eligible+`select p.external_id as patient_id,p.display_name,e.id as encounter_id,e.signed_at,e.final_state_version,
    coalesce(c.status,'not-created') as package_status,
    (select count(*)::int from ehr.encounter_completion_item i where i.completion_id=c.id and i.status='pending') as pending_items
    from ehr.synthetic_encounter e join eligible p on p.id=e.patient_id left join ehr.encounter_completion c on c.encounter_id=e.id
    where e.clinician_principal_id=$1::uuid and e.status='signed' and (c.id is null or c.status='draft')
      and ($2::text='all' or p.external_id=$2::text)
    order by e.signed_at desc,e.id limit 100`,[person.id,opts.patient]);
  for(const row of unfinished)row.final_state_version=Number(row.final_state_version);
  return {items:rows,summary:summary[0],waitingVisits:unfinished,filters:opts,
    page:opts.page,pageSize:100,total:counts[0].total,hasNext:(opts.page+1)*100<counts[0].total,externalExecution:false};
}
