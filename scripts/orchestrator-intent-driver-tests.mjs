// Real active IAM authorization and owner/revision fencing; synthetic provider boundary.
import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import {pathToFileURL} from 'node:url';
const target=new URL(process.env.ENCOUNTER_TEST_DB_URL||'http://missing');assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&target.pathname==='/encounter_jsonb_test','Disposable local CI database required.');
const {default:postgres}=await import(pathToFileURL(process.env.POSTGRES_DRIVER_PATH).href);const sql=postgres(target.href,{prepare:false,max:1});let created=false;
const owner='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',patient='33333333-3333-4333-8333-333333333333',encounter='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
let handler,providerCalls=0,hook=null;
try{
 await sql.unsafe(`create schema iam; create schema ehr;`);created=true;
 await sql.unsafe(`create table iam.principal(id uuid primary key,auth_user_id uuid,external_id text,active boolean,synthetic boolean,principal_type text);
 create table iam.practice_membership(principal_id uuid,practice_id uuid,active boolean,workspaces text[],permissions jsonb,role text);
 create table iam.patient_assignment(principal_id uuid,practice_id uuid,patient_id uuid,active boolean,workspaces text[]);
 create table iam.access_audit(principal_id uuid,patient_id uuid,action text,workspace text,allowed boolean,reason text);
 create table ehr.patient(id uuid primary key,external_id text,active boolean,synthetic boolean);
 create table ehr.synthetic_encounter(id uuid primary key,patient_id uuid,clinician_principal_id uuid,status text,version integer,created_at timestamptz);
 `);
 await sql`insert into iam.principal values(${owner},${user},'SYN-INTENT-CI',true,true,'clinician')`;
 await sql`insert into ehr.patient values(${patient},'PT-001',true,true)`;
 await sql`insert into iam.practice_membership values(${owner},${other},true,array['office'],'{"encounter.draft":true}'::jsonb,'physician')`;
 await sql`insert into iam.patient_assignment values(${owner},${other},${patient},true,array['office'])`;
 await sql`insert into ehr.synthetic_encounter values(${encounter},${patient},${owner},'draft',1,now())`;
 const source=[fs.readFileSync('supabase/functions/orchestrator-intent/clinician-auth.ts','utf8'),...['intent.ts','index.ts'].map(n=>fs.readFileSync('supabase/functions/orchestrator-intent/'+n,'utf8'))].map(s=>s.replace(/^import .*$/gm,'').replace(/^export /gm,'')).join('\n');
 vm.runInNewContext(stripTypeScriptTypes(source),{postgres:()=>sql,Deno:{env:{get:n=>({SUPABASE_DB_URL:target.href,SUPABASE_URL:'https://identity.test',SUPABASE_ANON_KEY:'ci-only',OPENAI_API_KEY:'ci-provider'})[n]},serve:fn=>handler=fn},fetch:async(url,options)=>{if(url==='https://identity.test/auth/v1/user')return Response.json({id:user,is_anonymous:false});assert.equal(url,'https://api.openai.com/v1/responses');providerCalls++;if(hook)await hook();return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"kind":"navigate","target":"review","soap":false}'}]}]});},Headers,Request,Response,URL,JSON,Number,TextDecoder,Uint8Array,AbortSignal});
 const body={patientId:'PT-001',encounterId:encounter,sourceVersion:1,command:'What remains for me to review?'};
 async function post(changes={}){const r=await handler(new Request('https://intent.test',{method:'POST',headers:{authorization:'Bearer ci-user','content-type':'application/json'},body:JSON.stringify({...body,...changes})}));return {status:r.status,body:await r.json()};}
 assert.equal((await post()).status,200);let before=providerCalls;
 await sql`update iam.patient_assignment set active=false`;assert.equal((await post()).status,403);assert.equal(providerCalls,before);await sql`update iam.patient_assignment set active=true`;
 await sql`update iam.practice_membership set permissions='{}'::jsonb`;assert.equal((await post()).status,403);assert.equal(providerCalls,before);await sql`update iam.practice_membership set permissions='{"encounter.draft":true}'::jsonb`;
 await sql`update iam.principal set active=false`;assert.equal((await post()).status,403);assert.equal(providerCalls,before);await sql`update iam.principal set active=true`;
 assert.equal((await post({encounterId:other})).status,409);assert.equal(providerCalls,before);
 hook=()=>sql`update ehr.synthetic_encounter set version=2`;assert.equal((await post()).status,409);await sql`update ehr.synthetic_encounter set version=1`;
 hook=()=>sql`update iam.patient_assignment set active=false`;assert.equal((await post()).status,403);await sql`update iam.patient_assignment set active=true`;
 hook=()=>sql`update iam.principal set active=false`;assert.equal((await post()).status,403);await sql`update iam.principal set active=true`;
 hook=()=>sql`insert into ehr.synthetic_encounter values(${other},${patient},${owner},'draft',1,now()+interval '1 minute')`;assert.equal((await post()).status,409);await sql`delete from ehr.synthetic_encounter where id=${other}`;
 hook=null;await sql`update ehr.synthetic_encounter set clinician_principal_id=${other}`;assert.equal((await post()).status,409);await sql`update ehr.synthetic_encounter set clinician_principal_id=${owner}`;
 assert.equal((await post()).status,200);const [row]=await sql`select count(*)::int as count,min(status) as status,min(version) as version from ehr.synthetic_encounter`;assert.deepEqual(row,{count:1,status:'draft',version:1});
 const [audit]=await sql`select count(*) filter(where allowed=false)::int as denied,count(*) filter(where allowed=true)::int as allowed from iam.access_audit`;assert.ok(audit.denied>=4&&audit.allowed>=8);
 console.log('Natural intent real driver passed: active clinician/assignment/permission, owner filtering, stale/latest source revisions, post-provider revocation, safe audit and unchanged encounter (provider mocked).');
}finally{if(created)await sql.unsafe('drop schema ehr cascade; drop schema iam cascade;');await sql.end();}
