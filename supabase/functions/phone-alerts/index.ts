import postgres from 'npm:postgres@3.4.7';
import {clinician,authFailure} from './clinician-auth.ts';
import {providerConfig,alertFail} from './provider.ts';
import {phoneView,phoneMutation} from './alerts.ts';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
function allowedPhoneOrigin(origin:string|null){return origin==='https://kidneycareclinic-star.github.io'||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function phoneReply(body:any,status=200,origin:string|null=null){
  const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'});
  if(origin&&allowedPhoneOrigin(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}
  return new Response(JSON.stringify({apiVersion:'phone-alerts-v13',...body}),{status,headers});
}
async function phoneBody(req:Request){
  if(!req.headers.get('content-type')?.startsWith('application/json')||!req.body)alertFail('invalid_request');
  const reader=req.body.getReader(),decoder=new TextDecoder();let size=0,text='';
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();alertFail('request_too_large',413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  try{const body=JSON.parse(text);if(!body||Array.isArray(body)||typeof body!=='object')alertFail('invalid_request');return body;}catch(_){alertFail('invalid_request');}
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');if(origin&&!allowedPhoneOrigin(origin))return phoneReply({error:'origin_not_allowed'},403,origin);
  if(req.method==='OPTIONS')return phoneReply({ok:true},200,origin);
  if(!['GET','POST'].includes(req.method))return phoneReply({error:'method_not_allowed'},405,origin);
  try{
    const person=await clinician(req,sql),config=providerConfig(name=>Deno.env.get(name));
    if(req.method==='POST'){
      const body=await phoneBody(req),result=await sql.begin((tx:any)=>phoneMutation(tx,person,body,config));
      if(result.error)return phoneReply({error:result.error},result.httpStatus,origin);
    }
    return phoneReply(await sql.begin((tx:any)=>phoneView(tx,person,config)),200,origin);
  }catch(error){const denied=authFailure(error);return phoneReply({error:denied?.code||((error as any)?.status?(error as Error).message:'phone_alerts_unavailable')},denied?.status||(error as any)?.status||500,origin);}
});
