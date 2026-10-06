import postgres from "npm:postgres@3.4.7";
import {clinician,patientAccess,authFailure} from './clinician-auth.ts';
import {intentFail,intentInput,currentIntentContext,needsClarification,intentRequest,responseIntent} from './intent.ts';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
function allowed(origin:string|null){return origin==='https://kidneycareclinic-star.github.io'||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function reply(body:any,status=200,origin:string|null=null){const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'});if(origin&&allowed(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}return new Response(JSON.stringify({apiVersion:'orchestrator-intent-v16',...body}),{status,headers});}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');if(origin&&!allowed(origin))return reply({error:'origin_not_allowed'},403,origin);
  if(req.method==='OPTIONS')return reply({ok:true},200,origin);
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405,origin);
  try{
    const person=await clinician(req,sql);
    if(!req.headers.get('content-type')?.startsWith('application/json'))intentFail('command_json_required');
    const reader=req.body?.getReader();if(!reader)intentFail('command_json_required');
    const chunks:Uint8Array[]= [];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>20000){await reader.cancel();intentFail('command_too_large',413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let body:any;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch(_){intentFail('command_json_required');}
    const input=intentInput(body),patient=await patientAccess(sql,person,input.patientId,'office','encounter.draft');
    await currentIntentContext(sql,patient,person.id,input);
    let intent={kind:'clarify',target:'none',soap:false};
    if(!needsClarification(input.command)){
      const key=Deno.env.get('OPENAI_API_KEY');if(!key)intentFail('command_not_configured',503);
      let result:Response;try{result=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(intentRequest(input.command)),signal:AbortSignal.timeout(30000)});}catch(_){intentFail('command_provider_unavailable',502);}
      if(!result.ok)intentFail(result.status===429?'command_rate_limited':'command_provider_unavailable',result.status===429?429:502);
      intent=responseIntent(await result.json().catch(()=>intentFail('command_invalid_output',502)));
    }
    // Revalidate actual identity, active IAM permissions and saved source revision after provider I/O.
    const currentPerson=await clinician(req,sql);if(currentPerson.id!==person.id)intentFail('command_context_changed',409);
    const currentPatient=await patientAccess(sql,currentPerson,input.patientId,'office','encounter.draft');
    if(currentPatient!==patient)intentFail('command_context_changed',409);
    await currentIntentContext(sql,currentPatient,currentPerson.id,input);
    return reply({patientId:input.patientId,encounterId:input.encounterId,sourceVersion:input.sourceVersion,command:input.command,intent,confirmationRequired:true,clinicalWrites:false},200,origin);
  }catch(error){const denied=authFailure(error);if(denied)return reply({error:denied.code},denied.status,origin);if(typeof(error as any)?.status==='number')return reply({error:(error as Error).message},(error as any).status,origin);return reply({error:'command_unavailable'},500,origin);}
});
