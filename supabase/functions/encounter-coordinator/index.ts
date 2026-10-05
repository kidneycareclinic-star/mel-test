import postgres from 'npm:postgres@3.4.7';
import {clinician,patientAccess,authFailure} from './clinician-auth.ts';
import {coordinatorFail,coordinatorView,finalizeBundle,saveReviewDraft} from './coordinator.ts';
import {profileAndJob,queuePreparation,queueCurrentAfterProfile} from './orchestration.ts';
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:1});
function allowed(origin:string|null){return origin==='https://kidneycareclinic-star.github.io'||!!origin&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function reply(body:any,status=200,origin:string|null=null){const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type'});if(origin&&allowed(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}return new Response(JSON.stringify({apiVersion:'encounter-coordinator-v11',...body}),{status,headers});}
async function access(tx:any,person:any,patientId:string,externalId:string,permission:string){
  // Hold the active identity and assignment through each write, including provider completion.
  const rows=await tx.unsafe("select p.id from iam.principal p join iam.practice_membership pm on pm.principal_id=p.id join iam.patient_assignment pa on pa.principal_id=p.id and pa.practice_id=pm.practice_id where p.id=$1::uuid and p.active and p.synthetic and pm.active and pa.active and pa.patient_id=$2::uuid for share of p,pm,pa",[person.id,patientId]);
  if(!rows.length)coordinatorFail('patient_access_denied',403);
  await patientAccess(tx,person,externalId,'office',permission);
}
async function write(person:any,patientId:string,externalId:string,permission:string,callback:any){return sql.begin(async(tx:any)=>{await tx.unsafe('select id from ehr.patient where id=$1::uuid for update',[patientId]);await access(tx,person,patientId,externalId,permission);return callback(tx);});}
async function readBody(req:Request){
  if(!req.headers.get('content-type')?.startsWith('application/json')||!req.body)coordinatorFail('invalid_request',400);
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>180000){await reader.cancel();coordinatorFail('request_too_large',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch(_){coordinatorFail('invalid_request',400);}
}
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin');if(origin&&!allowed(origin))return reply({error:'origin_not_allowed'},403,origin);if(req.method==='OPTIONS')return reply({ok:true},200,origin);if(!['GET','POST'].includes(req.method))return reply({error:'method_not_allowed'},405,origin);
  try{
    const person=await clinician(req,sql),body=req.method==='POST'?await readBody(req):null;
    const externalId=req.method==='GET'?new URL(req.url).searchParams.get('patient_id'):body?.patientId;
    if(typeof externalId!=='string'||!/^PT-\d{3}$/.test(externalId))coordinatorFail('invalid_patient',400);
    if(req.method==='POST'&&!['prepare','finalize','save-review','save-profile'].includes(body?.action))coordinatorFail('invalid_action',400);
    const permission=req.method==='GET'?'patient.read':body.action==='finalize'?'encounter.sign':'encounter.draft';
    const patientId=await patientAccess(sql,person,externalId,'office',permission);
    if(req.method==='GET')return reply(await sql.begin('isolation level repeatable read',async(tx:any)=>{const view=await coordinatorView(tx,patientId,externalId,person);const expected=new URL(req.url).searchParams.get('expected_encounter_id');if(expected&&view.draft?.id!==expected)coordinatorFail('review_link_no_longer_current',409);return {...view,...await profileAndJob(tx,person,patientId,view.draft?.id||null)};}),200,origin);
    if(body.action==='save-profile')return reply(await write(person,patientId,externalId,'encounter.draft',(tx:any)=>queueCurrentAfterProfile(tx,patientId,person,body)),200,origin);
    if(body.action==='save-review')return reply(await write(person,patientId,externalId,'encounter.draft',(tx:any)=>saveReviewDraft(tx,patientId,externalId,person,body)),200,origin);
    if(body.action==='finalize'){
      const result=await write(person,patientId,externalId,permission,async(tx:any)=>{
        if(body.observations?.length)await patientAccess(tx,person,externalId,'office','scribe.review');
        if(body.reviews?.length)await patientAccess(tx,person,externalId,'office','agent.review');
        if(body.tools?.length)await patientAccess(tx,person,externalId,'office','tool.prepare');
        return finalizeBundle(tx,patientId,externalId,person,body);
      });return reply(result,200,origin);
    }
    const result=await write(person,patientId,externalId,permission,(tx:any)=>queuePreparation(tx,patientId,person,body));
    return reply({patientId:externalId,...result},202,origin);
  }catch(error){
    const denied=authFailure(error),code=denied?.code||((error as any)?.status?(error as Error).message:'coordinator_unavailable');
    return reply({error:code},denied?.status||(error as any)?.status||500,origin);
  }
});
