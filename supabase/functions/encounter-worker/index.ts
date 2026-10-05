import postgres from 'npm:postgres@3.4.7';
import {claimDispatch,processJob} from '../encounter-coordinator/orchestration.ts';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
// This endpoint has custom authentication: an expiring, single-use dispatch
// capability issued by the private DB scheduler, bound to one queued job.
Deno.serve(async(req:Request)=>{
  const reply=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.headers.has('origin'))return reply({error:'worker_dispatch_only'},403);
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  try{
    if(!req.headers.get('content-type')?.startsWith('application/json')||!req.body)return reply({error:'invalid_request'},400);
    const reader=req.body.getReader();let size=0,text='';const decoder=new TextDecoder();
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024){await reader.cancel();return reply({error:'request_too_large'},413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
    let body;try{body=JSON.parse(text);}catch(_){return reply({error:'invalid_request'},400);}
    if(!body||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'dispatchId'))return reply({error:'invalid_request'},400);
    const bearer=/^Bearer ([0-9a-f-]{72})$/.exec(req.headers.get('authorization')||'')?.[1];
    const claimed=await claimDispatch(sql,body.dispatchId,bearer);
    if(claimed)await processJob(sql,claimed,Deno.env.get('OPENAI_API_KEY')||'');
    return reply({ok:true});
  }catch(error){return reply({error:(error as any)?.status===401?'invalid_worker_dispatch':'worker_unavailable'},(error as any)?.status===401?401:500);}
});
