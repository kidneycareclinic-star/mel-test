import postgres from "npm:postgres@3.4.7";
import { clinician, patientAccess, authFailure } from "./clinician-auth.ts";
import { completionView, completionMutation, fail } from "./completion.ts";

const url=Deno.env.get("SUPABASE_DB_URL");
if(!url)throw new Error("SUPABASE_DB_URL is not configured");
const sql=postgres(url,{prepare:false,max:1});
const VERSION="encounter-completion-v7";
function allowed(origin:string|null) {return origin==="https://kidneycareclinic-star.github.io"||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function response(body:unknown,status=200,origin:string|null=null) {
  const headers=new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  if(origin&&allowed(origin)){headers.set("Access-Control-Allow-Origin",origin);headers.set("Vary","Origin");}
  headers.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers","authorization, apikey, content-type");
  return new Response(JSON.stringify({apiVersion:VERSION,...body as any}),{status,headers});
}
Deno.serve(async(req:Request)=> {
  const origin=req.headers.get("origin");
  if(origin&&!allowed(origin))return response({error:"origin_not_allowed"},403,origin);
  if(req.method==="OPTIONS")return response({ok:true},200,origin);
  if(!["GET","POST"].includes(req.method))return response({error:"method_not_allowed"},405,origin);
  try {
    const query=new URL(req.url).searchParams;
    const body=req.method==="POST"?await req.json().catch(()=>null):null;
    const externalId=req.method==="GET"?query.get("patient_id"):body?.patientId;
    if(typeof externalId!=="string"||!/^PT-\d{3}$/.test(externalId))fail("invalid_patient",400);
    if(req.method==="POST"&&!["create","save","format-soap","add-item","decide-item","resolve-item","approve"].includes(body?.action))fail("invalid_completion_action",400);
    const person=await clinician(req,sql);
    const permission=req.method==="GET"?"patient.read":["decide-item","resolve-item","approve"].includes(body.action)?"encounter.sign":"encounter.draft";
    const patientId=await patientAccess(sql,person,externalId,"office",permission);
    const result=req.method==="GET"?
      await sql.begin("isolation level repeatable read",(tx:any)=>completionView(tx,patientId,externalId,person,query.get("encounter_id")||undefined)):
      await sql.begin(async(tx:any)=> {
        await tx.unsafe("select id from ehr.patient where id=$1::uuid for update",[patientId]);
        return completionMutation(tx,patientId,externalId,person,body);
      });
    return response(result,200,origin);
  } catch(error) {
    const denied=authFailure(error);
    if(denied)return response({error:denied.code},denied.status,origin);
    if(error&&typeof(error as any).status==="number")return response({error:(error as Error).message},(error as any).status,origin);
    console.error("Encounter completion failed",error);
    return response({error:"completion_unavailable"},500,origin);
  }
});
