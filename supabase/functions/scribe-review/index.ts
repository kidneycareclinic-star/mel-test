import postgres from "npm:postgres@3.4.7";

const dbUrl=Deno.env.get("SUPABASE_DB_URL");
if(!dbUrl) throw new Error("SUPABASE_DB_URL is not configured");
const sql=postgres(dbUrl,{prepare:false,max:1});
const API_VERSION="scribe-review-v1";

function originAllowed(origin:string|null){if(!origin)return null;if(origin==="https://kidneycareclinic-star.github.io")return origin;if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return origin;return null;}
function response(body:unknown,status=200,origin:string|null=null){const h=new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});const a=originAllowed(origin);if(a){h.set("Access-Control-Allow-Origin",a);h.set("Vary","Origin");}h.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");h.set("Access-Control-Allow-Headers","authorization, apikey, content-type");return new Response(JSON.stringify(body),{status,headers:h});}
function num(v:unknown,name:string){const n=Number(v);if(!Number.isFinite(n))throw new Error("invalid numeric value for "+name);return n;}

async function patientRow(tx:any,externalId:string){const rows=await tx.unsafe("select id,synthetic from ehr.patient where external_id=$1 limit 1",[externalId]);if(!rows.length||rows[0].synthetic!==true)throw new Error("synthetic_patient_not_found");return rows[0];}
async function listPending(conn:any,patientId:string){return await conn.unsafe([
  "select id,client_record_id,field,display_label,observation_type,value_numeric,value_json,unit,source_text,observed_at,confidence,certainty,status,created_at",
  "from ehr.proposed_observation where patient_id=$1 and status='pending' order by created_at,id"
].join(" "),[patientId]);}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(origin&&!originAllowed(origin))return response({apiVersion:API_VERSION,error:"origin_not_allowed"},403,origin);
  if(req.method==="OPTIONS")return response({apiVersion:API_VERSION,ok:true},200,origin);
  const url=new URL(req.url);
  const externalId=String(url.searchParams.get("patient_id")||"");
  try{
    if(req.method==="GET"){
      if(!/^PT-\d{3}$/.test(externalId))return response({apiVersion:API_VERSION,error:"invalid_patient"},400,origin);
      const p=await patientRow(sql,externalId);
      const proposals=await listPending(sql,p.id);
      const sv=await sql.unsafe("select state_version,engine_version from ehr.patient_state where patient_id=$1 order by state_version desc limit 1",[p.id]);
      return response({apiVersion:API_VERSION,patientId:externalId,pending:proposals.length,proposals,stateVersion:sv[0]?.state_version?Number(sv[0].state_version):null,engineVersion:sv[0]?.engine_version||null},200,origin);
    }
    if(req.method!=="POST")return response({apiVersion:API_VERSION,error:"method_not_allowed"},405,origin);
    const body=await req.json().catch(()=>null);
    const patientExternalId=String(body?.patientId||"");
    const decisions=Array.isArray(body?.decisions)?body.decisions:[];
    if(!/^PT-\d{3}$/.test(patientExternalId)||!decisions.length||decisions.length>30)return response({apiVersion:API_VERSION,error:"invalid_payload"},400,origin);
    const result=await sql.begin(async(tx:any)=>{
      const p=await patientRow(tx,patientExternalId);
      const patientId=p.id;
      const acceptedDecisions=decisions.filter((d:any)=>["accepted","edited"].includes(String(d?.decision||"")));
      const rejectedDecisions=decisions.filter((d:any)=>String(d?.decision||"")==="rejected");
      if(acceptedDecisions.length+rejectedDecisions.length!==decisions.length)throw new Error("invalid_decision");
      const ev=await tx.unsafe([
        "insert into ehr.event(patient_id,event_type,actor_type,source,status,payload)",
        "values($1,'SCRIBE_REVIEW_DECIDED','physician','scribe-review','recorded',",
        "jsonb_build_object('acceptedCount',$2::int,'rejectedCount',$3::int,'apiVersion',$4::text)) returning id"
      ].join(" "),[patientId,acceptedDecisions.length,rejectedDecisions.length,API_VERSION]);
      const eventId=ev[0].id;
      let canonicalInserted=0;
      const outcomes:any[]=[];
      for(const d of decisions){
        const proposalId=String(d?.proposalId||"");
        const decision=String(d?.decision||"");
        const rows=await tx.unsafe([
          "select * from ehr.proposed_observation",
          "where id=$1::uuid and patient_id=$2 and status='pending' limit 1 for update"
        ].join(" "),[proposalId,patientId]);
        if(!rows.length){outcomes.push({proposalId,status:"not-pending"});continue;}
        const po=rows[0];
        if(decision==="rejected"){
          await tx.unsafe([
            "update ehr.proposed_observation set status='rejected',decision_event_id=$2,reviewed_by_type='physician',reviewed_by_id='synthetic-demo-physician',reviewed_at=now()",
            "where id=$1::uuid"
          ].join(" "),[proposalId,eventId]);
          outcomes.push({proposalId,status:"rejected"});
          continue;
        }
        let valueNumeric=po.value_numeric==null?null:Number(po.value_numeric);
        let valueJson=po.value_json||null;
        if(decision==="edited"){
          if(po.value_numeric!=null)valueNumeric=num(d?.editedValue,po.field);
          else if(po.field==="bloodPressure"){valueJson={systolic:num(d?.editedValue?.systolic,"systolic"),diastolic:num(d?.editedValue?.diastolic,"diastolic")};}
          else if(po.field==="weight"){valueJson={amount:num(d?.editedValue?.amount,"weight"),reportedUnit:String(d?.editedValue?.reportedUnit||po.value_json?.reportedUnit||"unspecified")};}
        }
        let obsRows:any[];
        if(valueJson&&po.field==="bloodPressure"){
          obsRows=await tx.unsafe([
            "insert into ehr.clinical_observation(patient_id,observation_type,display,value_json,unit,status,observed_at,provenance_id,source_event_id,client_record_id)",
            "values($1,$2,$3,jsonb_build_object('systolic',$4::numeric,'diastolic',$5::numeric),$6,'final',$7,$8,$9,$10)",
            "on conflict(patient_id,client_record_id) where client_record_id is not null do nothing returning id"
          ].join(" "),[patientId,po.field,po.display_label,num(valueJson.systolic,"systolic"),num(valueJson.diastolic,"diastolic"),po.unit,po.observed_at,po.provenance_id,eventId,po.client_record_id]);
        }else if(valueJson&&po.field==="weight"){
          obsRows=await tx.unsafe([
            "insert into ehr.clinical_observation(patient_id,observation_type,display,value_json,unit,status,observed_at,provenance_id,source_event_id,client_record_id)",
            "values($1,$2,$3,jsonb_build_object('amount',$4::numeric,'reportedUnit',$5::text),$6,'final',$7,$8,$9,$10)",
            "on conflict(patient_id,client_record_id) where client_record_id is not null do nothing returning id"
          ].join(" "),[patientId,po.field,po.display_label,num(valueJson.amount,"weight"),String(valueJson.reportedUnit||"unspecified"),po.unit,po.observed_at,po.provenance_id,eventId,po.client_record_id]);
        }else{
          obsRows=await tx.unsafe([
            "insert into ehr.clinical_observation(patient_id,observation_type,display,value_numeric,unit,status,observed_at,provenance_id,source_event_id,client_record_id)",
            "values($1,$2,$3,$4,$5,'final',$6,$7,$8,$9)",
            "on conflict(patient_id,client_record_id) where client_record_id is not null do nothing returning id"
          ].join(" "),[patientId,po.field,po.display_label,valueNumeric,po.unit,po.observed_at,po.provenance_id,eventId,po.client_record_id]);
        }
        const obsId=obsRows[0]?.id||po.accepted_observation_id||null;
        if(obsRows.length)canonicalInserted+=1;
        await tx.unsafe([
          "update ehr.proposed_observation set status=$2,decision_event_id=$3,accepted_observation_id=$4,reviewed_by_type='physician',reviewed_by_id='synthetic-demo-physician',reviewed_at=now(),",
          "metadata=metadata||jsonb_build_object('decisionApi',$5::text) where id=$1::uuid"
        ].join(" "),[proposalId,decision,eventId,obsId,API_VERSION]);
        outcomes.push({proposalId,status:decision,observationId:obsId});
      }
      let stateVersion:null|number=null;
      let patient:any=null;
      if(canonicalInserted>0){
        const reduced=await tx.unsafe("select ehr.reduce_patient_state($1,$2,$3) as state_version",[patientId,eventId,"patient-state-reducer-v1"]);
        stateVersion=Number(reduced[0].state_version);
        const st=await tx.unsafe("select state::text as state_text from ehr.patient_state where patient_id=$1 and state_version=$2 limit 1",[patientId,stateVersion]);
        patient=JSON.parse(String(st[0].state_text));
      }else{
        const st=await tx.unsafe("select state_version,state::text as state_text from ehr.patient_state where patient_id=$1 order by state_version desc limit 1",[patientId]);
        stateVersion=Number(st[0].state_version);patient=JSON.parse(String(st[0].state_text));
      }
      const pending=await listPending(tx,patientId);
      return {eventId,canonicalInserted,stateVersion,patient,pending,outcomes};
    });
    return response({apiVersion:API_VERSION,...result},200,origin);
  }catch(error){return response({apiVersion:API_VERSION,error:String(error?.message||error)},400,origin);}
});