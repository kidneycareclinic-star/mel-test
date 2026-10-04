import postgres from 'npm:postgres@3.4.7';
import {clinician,patientAccess,authFailure} from './clinician-auth.ts';
import {patientState} from './json-boundary.ts';
import {preferences,chartContext,providerRequest,validateDraft,fail} from './drafting.ts';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
function allowed(origin:string|null){return origin==='https://kidneycareclinic-star.github.io'||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function reply(body:any,status=200,origin:string|null=null){const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'});if(origin&&allowed(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}return new Response(JSON.stringify({apiVersion:'note-drafting-v8',...body}),{status,headers});}
async function source(patientId:string,externalId:string,person:any,body:any){
  let rows:any[];
  if(body.mode==='prechart')rows=await sql.unsafe("select e.id,e.version,e.note_text,e.sources::text as sources_text,s.state::text as state_text from ehr.synthetic_encounter e join lateral (select state from ehr.patient_state where patient_id=e.patient_id order by state_version desc limit 1) s on true where e.id=$1::uuid and e.patient_id=$2::uuid and e.clinician_principal_id=$3::uuid and e.status='draft'",[body.encounterId,patientId,person.id]);
  else rows=await sql.unsafe("select e.id,c.version,c.status as package_status,c.note_text,e.sources::text as sources_text,coalesce(a.resulting_state,s.state)::text as state_text from ehr.synthetic_encounter e join ehr.patient_state s on s.patient_id=e.patient_id and s.state_version=e.final_state_version left join ehr.patient_state_audit a on a.patient_id=e.patient_id and a.resulting_version=e.final_state_version join ehr.encounter_completion c on c.encounter_id=e.id where e.id=$1::uuid and e.patient_id=$2::uuid and e.clinician_principal_id=$3::uuid and c.clinician_principal_id=$3::uuid and e.status='signed'",[body.encounterId,patientId,person.id]);
  if(!rows.length)fail(body.mode==='prechart'?'encounter_draft_required':'signed_encounter_required',404);
  const row=rows[0];if(row.package_status&&row.package_status!=='draft')fail('approved_completion_is_immutable',409);if(row.version!==body.expectedVersion)fail('draft_version_changed',409);
  const patient=patientState(row.state_text,externalId),sources=JSON.parse(row.sources_text);if(!Array.isArray(sources))fail('note_drafting_invalid_source',409);
  const approved=body.mode==='completion'?await sql.unsafe("select i.kind,i.label,i.details,i.due_date::text as due_date from ehr.encounter_completion_item i join ehr.encounter_completion c on c.id=i.completion_id where c.encounter_id=$1::uuid and i.status='approved' order by i.created_at,i.id",[body.encounterId]):[];
  const context={mode:body.mode,encounterNote:row.note_text||'',reviewedSources:sources.filter((s:any)=>s.kind!=='attachment'&&typeof s.text==='string').map((s:any)=>({kind:s.kind,title:s.title,text:s.text})),chartContext:chartContext(patient,body.encounterId),approvedItems:approved};
  if(JSON.stringify(context).length>150000)fail('note_source_too_large',413);return context;
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');if(origin&&!allowed(origin))return reply({error:'origin_not_allowed'},403,origin);if(req.method==='OPTIONS')return reply({ok:true},200,origin);if(req.method!=='POST')return reply({error:'method_not_allowed'},405,origin);
  try{
    const person=await clinician(req,sql);
    if(!req.headers.get('content-type')?.startsWith('application/json'))fail('invalid_note_request');
    // Bound streamed request bodies as well as Content-Length.
    if(!req.body)fail('invalid_note_request');const reader=req.body.getReader();let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();fail('note_request_too_large',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let body:any;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch(_){fail('invalid_note_request');}
    if(!/^PT-\d{3}$/.test(String(body?.patientId||''))||!['prechart','completion'].includes(body?.mode)||!Number.isSafeInteger(body?.expectedVersion)||body.expectedVersion<1||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body?.encounterId||''))))fail('invalid_note_request');
    const prefs=preferences(body.preferences),patientId=await patientAccess(sql,person,body.patientId,'office','encounter.draft');
    const context=await source(patientId,body.patientId,person,body),key=Deno.env.get('OPENAI_API_KEY');if(!key)fail('note_drafting_not_configured',503);
    let res:Response;try{res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(providerRequest(context,prefs)),signal:AbortSignal.timeout(60000)});}catch(_){fail('note_drafting_provider_failed',502);}
    if(!res.ok)fail(res.status===429?'note_drafting_rate_limited':'note_drafting_provider_failed',res.status===429?429:502);
    const output=await res.json().catch(()=>fail('note_drafting_invalid_output',502));if(output.status!=='completed')fail('note_drafting_invalid_output',502);
    const outputText=(output.output||[]).filter((m:any)=>m.type==='message').flatMap((m:any)=>m.content||[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
    let value:any;try{value=JSON.parse(outputText);}catch(_){fail('note_drafting_invalid_output',502);}
    const draft=validateDraft(value,prefs,context);
    // Another tab can save/approve while the provider is running. Reject stale output.
    const current=await source(patientId,body.patientId,person,body);if(JSON.stringify(current)!==JSON.stringify(context))fail('draft_version_changed',409);
    return reply({mode:body.mode,patientId:body.patientId,encounterId:body.encounterId,sourceVersion:body.expectedVersion,preferences:prefs,...draft,model:output.model,requestId:res.headers.get('x-request-id'),reviewRequired:true,applied:false},200,origin);
  }catch(error){const denied=authFailure(error);if(denied)return reply({error:denied.code},denied.status,origin);if(typeof(error as any)?.status==='number')return reply({error:(error as Error).message},(error as any).status,origin);return reply({error:'note_drafting_unavailable'},500,origin);}
});
