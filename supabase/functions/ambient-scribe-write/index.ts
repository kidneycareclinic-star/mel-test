import postgres from "npm:postgres@3.4.7";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is not configured");
const sql = postgres(dbUrl, { prepare:false, max:1 });
const WRITER_VERSION = "8-proposal";
const LAB_FIELDS = new Set(["eGFR","UACR","UPCR","Potassium","Phosphate","Bicarbonate","Hemoglobin","Creatinine"]);
const VITAL_FIELDS = new Set(["bloodPressure","heartRate","weight","temperature","oxygenSaturation"]);

function originAllowed(origin:string|null){
  if(!origin) return null;
  if(origin==="https://kidneycareclinic-star.github.io") return origin;
  if(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}
function response(body:unknown,status=200,origin:string|null=null){
  const h=new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  const allowed=originAllowed(origin);
  if(allowed){h.set("Access-Control-Allow-Origin",allowed);h.set("Vary","Origin");}
  h.set("Access-Control-Allow-Methods","POST, OPTIONS");
  h.set("Access-Control-Allow-Headers","authorization, apikey, content-type");
  return new Response(JSON.stringify(body),{status,headers:h});
}
function num(v:unknown,name:string){const n=Number(v);if(!Number.isFinite(n)) throw new Error("invalid numeric value for "+name);return n;}
function dateOnly(v:unknown){const s=String(v||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("invalid observedDate");return s;}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(origin && !originAllowed(origin)) return response({writerVersion:WRITER_VERSION,error:"origin_not_allowed"},403,origin);
  if(req.method==="OPTIONS") return response({ok:true,writerVersion:WRITER_VERSION},200,origin);
  if(req.method!=="POST") return response({writerVersion:WRITER_VERSION,error:"method_not_allowed"},405,origin);
  const body=await req.json().catch(()=>null);
  const patientExternalId=String(body?.patientId||"");
  const records=Array.isArray(body?.records)?body.records:[];
  const rawTranscript=String(body?.rawTranscript||"");
  const reviewedTranscript=String(body?.reviewedTranscript||"");
  if(!/^PT-\d{3}$/.test(patientExternalId)||!records.length||records.length>20) return response({writerVersion:WRITER_VERSION,error:"invalid_payload"},400,origin);
  try{
    const result=await sql.begin(async(tx:any)=>{
      const p=await tx.unsafe("select id,synthetic from ehr.patient where external_id=$1 limit 1",[patientExternalId]);
      if(!p.length||p[0].synthetic!==true) throw new Error("synthetic_patient_not_found");
      const patientId=p[0].id;
      const prov=await tx.unsafe([
        "insert into ehr.provenance(patient_id,source_kind,source_label,source_system,observed_at,actor_type,confidence,certainty,raw_payload)",
        "values($1,'ambient-scribe-extraction','Ambient scribe · proposed structured data','mel-test',now(),'ambient_scribe',1.0,'proposed',",
        "jsonb_build_object('rawTranscript',$2::text,'reviewedTranscript',$3::text,'synthetic',true)) returning id"
      ].join(" "),[patientId,rawTranscript,reviewedTranscript]);
      const provenanceId=prov[0].id;
      const ev=await tx.unsafe([
        "insert into ehr.event(patient_id,event_type,actor_type,source,status,payload,provenance_id)",
        "values($1,'SCRIBE_EXTRACTION_PROPOSED','ambient_scribe','ambient-scribe','proposed',",
        "jsonb_build_object('recordCount',$2::int,'writerVersion',$3::text),$4) returning id"
      ].join(" "),[patientId,records.length,WRITER_VERSION,provenanceId]);
      const eventId=ev[0].id;
      const proposals:any[]=[];
      for(const input of records){
        const field=String(input?.field||"");
        const type=String(input?.type||"");
        const id=String(input?.id||"");
        if(!id||id.length>200) throw new Error("invalid record id");
        if(!(LAB_FIELDS.has(field)||VITAL_FIELDS.has(field))) throw new Error("unsupported field: "+field);
        if((LAB_FIELDS.has(field)&&type!=="lab")||(VITAL_FIELDS.has(field)&&type!=="vital")) throw new Error("field/type mismatch");
        const observedDate=dateOnly(input?.observedDate);
        const observedAt=String(input?.observedAt||observedDate+"T12:00:00Z");
        let numericValue:number|null=null;
        let jsonKind:string|null=null;
        let jsonA:number|null=null;
        let jsonB:number|null=null;
        let jsonUnit:string|null=null;
        if(type==="lab" || ["heartRate","temperature","oxygenSaturation"].includes(field)) numericValue=num(input.value,field);
        else if(field==="bloodPressure"){jsonKind="bp";jsonA=num(input?.value?.systolic,"systolic");jsonB=num(input?.value?.diastolic,"diastolic");}
        else if(field==="weight"){jsonKind="weight";jsonA=num(input?.value?.amount,"weight");jsonUnit=String(input?.value?.reportedUnit||"unspecified");}
        const existing=await tx.unsafe("select id,status from ehr.proposed_observation where patient_id=$1 and client_record_id=$2 limit 1",[patientId,id]);
        if(existing.length){proposals.push({id:existing[0].id,clientRecordId:id,status:existing[0].status,duplicate:true});continue;}
        const valueExpr=jsonKind==="bp" ? "jsonb_build_object('systolic',$5::numeric,'diastolic',$6::numeric)" : jsonKind==="weight" ? "jsonb_build_object('amount',$5::numeric,'reportedUnit',$7::text)" : "null::jsonb";
        const q=[
          "insert into ehr.proposed_observation(patient_id,provenance_id,source_event_id,client_record_id,field,display_label,observation_type,value_numeric,value_json,unit,source_text,observed_at,confidence,certainty,status,metadata)",
          "values($1,$2,$3,$4,$8,$9,$10,$11,"+valueExpr+",$12,$13,$14::timestamptz,'deterministic-normalized','proposed','pending',jsonb_build_object('writerVersion',$15::text))",
          "returning id,client_record_id,field,display_label,observation_type,value_numeric,value_json,unit,source_text,observed_at,status"
        ].join(" ");
        const rows=await tx.unsafe(q,[patientId,provenanceId,eventId,id,jsonA,jsonB,jsonUnit,field,String(input.displayLabel||field),type,numericValue,String(input.unit||""),String(input.sourceText||""),observedAt,WRITER_VERSION]);
        proposals.push(rows[0]);
      }
      return {provenanceId,eventId,proposals};
    });
    return response({source:"supabase-postgresql",writerVersion:WRITER_VERSION,proposed:result.proposals.length,...result},200,origin);
  }catch(error){return response({writerVersion:WRITER_VERSION,error:String(error?.message||error)},400,origin);}
});