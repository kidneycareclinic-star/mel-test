import postgres from 'npm:postgres@3.4.7';
import {clinician,patientAccess,authFailure} from '../encounter-coordinator/clinician-auth.ts';
import {revisionFail,revisionInput,revisionSupported} from './revision.ts';
import {proposeRevision,applyRevision,discardRevision} from './store.ts';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
function revisionOrigin(origin:string|null){return origin==='https://kidneycareclinic-star.github.io'||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function revisionReply(body:any,status=200,origin:string|null=null){const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'});if(origin&&revisionOrigin(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}return new Response(JSON.stringify({apiVersion:'encounter-revision-v18',...body}),{status,headers});}
async function revisionBody(req:Request){if(!req.headers.get('content-type')?.startsWith('application/json')||!req.body)revisionFail('invalid_revision_request');const reader=req.body.getReader(),decoder=new TextDecoder();let size=0,text='';try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>12000){await reader.cancel();revisionFail('request_too_large',413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}try{return revisionInput(JSON.parse(text));}catch(error){if((error as any)?.status)throw error;revisionFail('invalid_revision_request');}}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');if(origin&&!revisionOrigin(origin))return revisionReply({error:'origin_not_allowed'},403,origin);if(req.method==='OPTIONS')return revisionReply({ok:true},200,origin);if(req.method!=='POST')return revisionReply({error:'method_not_allowed'},405,origin);
 try{const person=await clinician(req,sql),input=await revisionBody(req),patientId=await patientAccess(sql,person,input.patientId,'office','encounter.draft');
  if(input.action==='propose'){
   if(!revisionSupported(input.command))return revisionReply({kind:'clarify',clarification:'Ask for a specific follow-up, lab-plan or patient-instruction revision. Other changes use the existing review controls.',confirmationRequired:true,externalExecution:false},200,origin);
   const key=Deno.env.get('OPENAI_API_KEY');if(!key)revisionFail('revision_provider_not_configured',503);
   return revisionReply(await proposeRevision(sql,person,patientId,input.patientId,input,key),200,origin);
  }
  return revisionReply(await sql.begin((tx:any)=>input.action==='apply'?applyRevision(tx,person,patientId,input.patientId,input):discardRevision(tx,person,patientId,input.patientId,input)),200,origin);
 }catch(error){const denied=authFailure(error);return revisionReply({error:denied?.code||((error as any)?.status?(error as Error).message:'revision_unavailable')},denied?.status||(error as any)?.status||500,origin);}
});
