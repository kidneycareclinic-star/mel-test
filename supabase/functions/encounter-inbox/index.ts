import postgres from 'npm:postgres@3.4.7';
import {clinician,authFailure} from './clinician-auth.ts';
import {inboxFail,inboxView,resolveReview,markSeen} from './inbox.ts';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
function allowed(origin:string|null){return origin==='https://kidneycareclinic-star.github.io'||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function reply(body:any,status=200,origin:string|null=null){
  const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'});
  if(origin&&allowed(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}
  return new Response(JSON.stringify({apiVersion:'encounter-inbox-v12',...body}),{status,headers});
}
async function readBody(req:Request){
  if(!req.headers.get('content-type')?.startsWith('application/json')||!req.body)inboxFail('invalid_request');
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();inboxFail('request_too_large',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch(_){inboxFail('invalid_request');}
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');if(origin&&!allowed(origin))return reply({error:'origin_not_allowed'},403,origin);
  if(req.method==='OPTIONS')return reply({ok:true},200,origin);
  if(!['GET','POST'].includes(req.method))return reply({error:'method_not_allowed'},405,origin);
  try{
    const person=await clinician(req,sql);
    if(req.method==='POST'){const body=await readBody(req);return reply(await sql.begin((tx:any)=>markSeen(tx,person,body)),200,origin);}
    const params=new URL(req.url).searchParams;
    return reply(await sql.begin('isolation level repeatable read',async(tx:any)=>{const result=await (params.has('job_id')?resolveReview(tx,person,params.get('job_id')):inboxView(tx,person,params));await tx.unsafe("insert into iam.access_audit(principal_id,patient_id,action,workspace,allowed,reason) values($1::uuid,(select id from ehr.patient where external_id=$2),'patient.read','office',true,'Authenticated encounter inbox navigation; owner and assignment checked.')",[person.id,(result as any).patientId||null]);return result;}),200,origin);
  }catch(error){const denied=authFailure(error);return reply({error:denied?.code||((error as any)?.status?(error as Error).message:'inbox_unavailable')},denied?.status||(error as any)?.status||500,origin);}
});
