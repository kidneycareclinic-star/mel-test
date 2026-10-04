import { reviewAstra, encounterDetail } from "./encounter-review.ts";
import { jsonObject, patientState } from "./json-boundary.ts";
import postgres from "npm:postgres@3.4.7";
import { clinician, patientAccess, authFailure } from "./clinician-auth.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is not configured");
const sql = postgres(dbUrl, { prepare:false, max:1 });
const VERSION = "synthetic-encounter-v4.1";
const kinds = new Set(["ambient-transcript","physician-dictation","typed-note","outside-note","referral","patient-message","other","attachment","lab-trend"]);
const uuid = (value:unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function allowed(origin:string|null){return origin === "https://kidneycareclinic-star.github.io" || !!origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function response(body:unknown,status=200,origin:string|null=null){
  const headers=new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  if(origin && allowed(origin)){headers.set("Access-Control-Allow-Origin",origin);headers.set("Vary","Origin");}
  headers.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers","authorization, apikey, content-type");
  return new Response(JSON.stringify(body),{status,headers});
}
function fail(code:string,status:number):never{const e=new Error(code) as Error & {status:number};e.status=status;throw e;}
function sourcesFrom(input:unknown){
  if(!Array.isArray(input)||input.length>40)fail("invalid_sources",400);
  return input.map((row:any) => {
    if(!row||!kinds.has(row.kind)||typeof row.title!=="string"||row.title.length>200 ||
      (row.text!=null && (typeof row.text!=="string"||row.text.length>6000)) ||
      (row.rawText!=null && (typeof row.rawText!=="string"||row.rawText.length>6000))) fail("invalid_source",400);
    // Files remain local to the browser. Store filenames only, never file bytes.
    const file=row.kind==="attachment"&&row.file ? {
      name:String(row.file.name||"").slice(0,180),
      size:Number.isSafeInteger(row.file.size)&&row.file.size>=0 ? row.file.size : null,
      type:String(row.file.type||"").slice(0,100)
    } : null;
    return {kind:row.kind,title:row.title,text:row.text||"",rawText:row.rawText||"",file};
  });
}
async function patient(tx:any,externalId:string){
  const rows=await tx.unsafe("select id::text from ehr.patient where external_id=$1 and synthetic=true and active=true limit 1",[externalId]);
  if(!rows.length)fail("synthetic_patient_not_found",404);
  return rows[0].id;
}
async function current(tx:any,patientId:string,clinicianId:string,lock=false){
  const rows=await tx.unsafe(
    "select id::text,patient_id::text,clinician_principal_id::text,status,note_text,sources,base_state_version,final_state_version,version,created_at,updated_at,signed_at from ehr.synthetic_encounter where patient_id=$1::uuid and clinician_principal_id=$2::uuid and status='draft' order by created_at desc limit 1"+(lock?" for update":""),
    [patientId,clinicianId]);
  if(!rows.length)return null;
  const row=rows[0];
  if(typeof row.sources==="string")row.sources=JSON.parse(row.sources);
  return row;
}
async function save(tx:any,patientId:string,person:any,body:any){
  if(typeof body.noteText!=="string"||body.noteText.length>20000)fail("invalid_note",400);
  const sources=sourcesFrom(body.sources);
  if(body.encounterId!=null&&!uuid(body.encounterId))fail("invalid_encounter_id",400);
  if(body.expectedVersion!=null && (!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1))fail("invalid_version",400);
  const draft=await current(tx,patientId,person.id,true);
  if(draft && (body.encounterId && body.encounterId!==draft.id ||
     body.expectedVersion!==draft.version))fail("encounter_version_changed",409);
  if(!draft && (body.encounterId||body.expectedVersion))fail("encounter_version_changed",409);
  const state=await tx.unsafe("select state_version from ehr.patient_state where patient_id=$1::uuid order by state_version desc limit 1",[patientId]);
  if(!state.length)fail("patient_state_not_found",404);
  let encounterId=draft?.id;
  const version=draft?draft.version+1:1;
  // JSON text must enter the protocol as text before PostgreSQL parses JSONB.
  // A direct JSONB parameter makes Postgres.js serialize this string again.
  if(!draft){
    const rows=await tx.unsafe("insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,note_text,sources,base_state_version) values($1::uuid,$2::uuid,$3,$4::text::jsonb,$5) returning id::text",[patientId,person.id,body.noteText,JSON.stringify(sources),state[0].state_version]);
    encounterId=rows[0].id;
  } else {
    await tx.unsafe("update ehr.synthetic_encounter set note_text=$2,sources=$3::text::jsonb,version=version+1,updated_at=now() where id=$1::uuid",[encounterId,body.noteText,JSON.stringify(sources)]);
  }
  const prov=await tx.unsafe([
    "insert into ehr.provenance(patient_id,source_kind,source_label,source_system,actor_type,actor_id,certainty,raw_payload)",
    "values($1::uuid,'encounter-prechart','Clinician-reviewed pre-chart source snapshot','mel-test','physician',$2,'known',",
    "jsonb_build_object('encounterId',$3::uuid,'version',$4::int,'noteText',$5::text,'sources',$6::text::jsonb,'synthetic',true)) returning id"
  ].join(" "),[patientId,person.externalId,encounterId,version,body.noteText,JSON.stringify(sources)]);
  const ev=await tx.unsafe([
    "insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,provenance_id,payload)",
    "values($1::uuid,'ENCOUNTER_DRAFT_SAVED','physician',$2,'synthetic-encounter','recorded',$3::uuid,",
    "jsonb_build_object('encounterId',$4::uuid,'version',$5::int,'sourceCount',$6::int,'noteLength',$7::int,'synthetic',true)) returning id"
  ].join(" "),[patientId,person.externalId,prov[0].id,encounterId,version,sources.length,body.noteText.length]);
  await tx.unsafe("update ehr.synthetic_encounter set draft_event_id=$2::uuid where id=$1::uuid",[encounterId,ev[0].id]);
  return {encounterId,version,status:"draft",baseStateVersion:Number(draft?.base_state_version||state[0].state_version),eventId:ev[0].id};
}
async function sign(tx:any,patientId:string,person:any,body:any){
  if(!uuid(body.encounterId)||!Number.isSafeInteger(body.expectedVersion))fail("invalid_sign_request",400);
  const e=await current(tx,patientId,person.id,true);
  if(!e||e.id!==body.encounterId||e.version!==body.expectedVersion)fail("encounter_version_changed",409);
  if(!e.note_text.trim()||!Array.isArray(e.sources)||!e.sources.length)fail("prechart_note_and_source_required",409);
  const reviews=await tx.unsafe("select count(*) filter(where status='pending')::int as pending,count(*) filter(where status in ('accepted','edited'))::int as accepted,max(reviewed_at) filter(where status in ('accepted','edited')) as last_review from ehr.encounter_review where patient_id=$1::uuid and encounter_id=$2::uuid",[patientId,e.id]);
  if(reviews[0].pending)fail("physician_review_required",409);
  const tools=await tx.unsafe("select count(*)::int as pending from ehr.tool_call where patient_id=$1::uuid and input->>'encounterId'=$2 and status='awaiting_approval'",[patientId,e.id]);
  if(tools[0].pending)fail("physician_review_required",409);
  const stats=await tx.unsafe([
    "select count(*)::int as total,count(*) filter(where status='pending')::int as pending,",
    "count(*) filter(where status in ('accepted','edited') and accepted_observation_id is not null)::int as accepted,",
    "max(reviewed_at) filter(where status in ('accepted','edited')) as last_review",
    "from ehr.proposed_observation where encounter_id=$1::uuid and patient_id=$2::uuid"
  ].join(" "),[e.id,patientId]);
  if(stats[0].pending||!(stats[0].accepted+reviews[0].accepted))fail("physician_review_required",409);
  const state=await tx.unsafe("select state_version,generated_at,source_event_id,state::text as state_text from ehr.patient_state where patient_id=$1::uuid order by state_version desc limit 1",[patientId]);
  if(!Number.isSafeInteger(body.expectedStateVersion)||body.expectedStateVersion!==Number(state[0]?.state_version))fail("patient_state_changed_refresh_and_review",409);
  if(!state.length||Number(state[0].state_version)<=Number(e.base_state_version)||
    new Date(state[0].generated_at)<new Date(Math.max(new Date(stats[0].last_review||0).getTime(),new Date(reviews[0].last_review||0).getTime())))fail("patient_state_update_required",409);
  const prov=await tx.unsafe([
    "insert into ehr.provenance(patient_id,source_kind,source_label,source_system,actor_type,actor_id,certainty,raw_payload)",
    "values($1::uuid,'signed-encounter','Physician-signed synthetic encounter','mel-test','physician',$2,'known',",
    "jsonb_build_object('encounterId',$3::uuid,'noteText',$4::text,'sources',$5::text::jsonb,'stateVersion',$6::bigint,'synthetic',true)) returning id"
  ].join(" "),[patientId,person.externalId,e.id,e.note_text,JSON.stringify(e.sources),state[0].state_version]);
  const ev=await tx.unsafe([
    "insert into ehr.event(patient_id,event_type,actor_type,actor_id,source,status,causation_id,provenance_id,payload)",
    "values($1::uuid,'ENCOUNTER_SIGNED','physician',$2,'synthetic-encounter','recorded',$3::uuid,$4::uuid,",
    "jsonb_build_object('encounterId',$5::uuid,'draftVersion',$6::int,'acceptedCount',$7::int,'approvedReviewCount',$9::int,'stateVersion',$8::bigint,'synthetic',true)) returning id"
  ].join(" "),[patientId,person.externalId,state[0].source_event_id,prov[0].id,e.id,e.version,stats[0].accepted,state[0].state_version,reviews[0].accepted]);
  await tx.unsafe("update ehr.synthetic_encounter set status='signed',signed_at=now(),signed_event_id=$2::uuid,final_state_version=$3,version=version+1,updated_at=now() where id=$1::uuid",[e.id,ev[0].id,state[0].state_version]);
  return {encounterId:e.id,patient:patientState(state[0].state_text,body.patientId),status:"signed",eventId:ev[0].id,acceptedCount:stats[0].accepted,approvedReviewCount:reviews[0].accepted,stateVersion:Number(state[0].state_version)};
}

Deno.serve(async (req:Request) => {
  const origin=req.headers.get("origin");
  if(origin&&!allowed(origin))return response({apiVersion:VERSION,error:"origin_not_allowed"},403,origin);
  if(req.method==="OPTIONS")return response({apiVersion:VERSION,ok:true},200,origin);
  if(req.method!=="GET"&&req.method!=="POST")return response({apiVersion:VERSION,error:"method_not_allowed"},405,origin);
  try{
    const url=new URL(req.url);
    const body=req.method==="POST"?await req.json().catch(()=>null):null;
    const externalId=String(req.method==="GET"?url.searchParams.get("patient_id")||"":body?.patientId||"");
    if(!/^PT-\d{3}$/.test(externalId))fail("invalid_patient",400);
    const person=await clinician(req,sql);
    const action=req.method==="GET"?"encounter.draft":body?.action==="sign"?"encounter.sign":body?.action==="review-astra"?"scribe.review":"encounter.draft";
    await patientAccess(sql,person,externalId,"office",action);
    const patientId=await patient(sql,externalId);
    if(req.method==="GET"){
      return await sql.begin("isolation level repeatable read",async(tx:any)=>{
      const draft=await current(tx,patientId,person.id);
      const signed=await tx.unsafe("select e.id::text,e.final_state_version,e.signed_at,e.note_text,jsonb_array_length(e.sources) as source_count,coalesce(a.resulting_state,ps.state)::text as state_text from ehr.synthetic_encounter e join ehr.patient_state ps on ps.patient_id=e.patient_id and ps.state_version=e.final_state_version left join ehr.patient_state_audit a on a.patient_id=e.patient_id and a.resulting_version=e.final_state_version where e.patient_id=$1::uuid and e.clinician_principal_id=$2::uuid and e.status='signed' order by e.signed_at desc limit 1",[patientId,person.id]);
      const currentState=await tx.unsafe("select state_version,state::text as state_text from ehr.patient_state where patient_id=$1::uuid order by state_version desc limit 1",[patientId]);
      const draftDetail=draft?await encounterDetail(tx,patientId,draft.id):null;
      if(signed[0]){
        signed[0].patient=patientState(signed[0].state_text,externalId);delete signed[0].state_text;
        signed[0].detail=await encounterDetail(tx,patientId,signed[0].id);
      }
      return response({apiVersion:VERSION,draft,draftDetail,patient:patientState(currentState[0].state_text,externalId),stateVersion:Number(currentState[0].state_version),currentStateVersion:Number(currentState[0].state_version),lastSigned:signed[0]||null},200,origin);
      });
    }
    if(body?.action!=="save-draft"&&body?.action!=="sign"&&body?.action!=="review-astra")fail("invalid_action",400);
    const result=await sql.begin(async(tx:any)=>{
      await tx.unsafe("select id from ehr.patient where id=$1::uuid for update",[patientId]);
      return body.action==="review-astra"?reviewAstra(tx,patientId,externalId,person,body):body.action==="save-draft"?save(tx,patientId,person,body):sign(tx,patientId,person,body);
    });
    return response({apiVersion:VERSION,...result},200,origin);
  }catch(error){
    const denied=authFailure(error);
    if(denied)return response({apiVersion:VERSION,error:denied.code},denied.status,origin);
    if(error && typeof (error as any).status==="number")return response({apiVersion:VERSION,error:String((error as Error).message)},(error as any).status,origin);
    console.error("Synthetic encounter failed",error);
    return response({apiVersion:VERSION,error:"encounter_unavailable"},500,origin);
  }
});
