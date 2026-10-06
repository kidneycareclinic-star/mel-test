import postgres from 'npm:postgres@3.4.7';
import {clinician,authFailure} from './clinician-auth.ts';
import {pushFail} from './provider.ts';
import {pushView,pushMutation} from './alerts.ts';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
function allowedPushOrigin(origin:string|null){return origin==='https://kidneycareclinic-star.github.io'||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function pushReply(body:any,status=200,origin:string|null=null){const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'});if(origin&&allowedPushOrigin(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}return new Response(JSON.stringify({apiVersion:'push-alerts-v17',...body}),{status,headers});}
async function pushBody(req:Request){
 if(!req.headers.get('content-type')?.startsWith('application/json')||!req.body)pushFail('invalid_push_request');
 const reader=req.body.getReader(),decoder=new TextDecoder();let size=0,text='';try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8192){await reader.cancel();pushFail('request_too_large',413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 try{const body=JSON.parse(text);if(!body||Array.isArray(body)||typeof body!=='object')pushFail('invalid_push_request');return body;}catch(_){pushFail('invalid_push_request');}
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');if(origin&&!allowedPushOrigin(origin))return pushReply({error:'origin_not_allowed'},403,origin);
 if(req.method==='OPTIONS')return pushReply({ok:true},200,origin);if(!['GET','POST'].includes(req.method))return pushReply({error:'method_not_allowed'},405,origin);
 try{
  const person=await clinician(req,sql);let hash=new URL(req.url).searchParams.get('endpoint_hash');
  if(req.method==='POST'){const bodyValue=await pushBody(req);const result=await sql.begin((tx:any)=>pushMutation(tx,person,bodyValue));hash=result.hash||hash;}
  return pushReply(await sql.begin((tx:any)=>pushView(tx,person,hash)),200,origin);
 }catch(error){const denied=authFailure(error);return pushReply({error:denied?.code||((error as any)?.status?(error as Error).message:'push_alerts_unavailable')},denied?.status||(error as any)?.status||500,origin);}
});
