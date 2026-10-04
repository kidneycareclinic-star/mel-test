// Called by the isolated real PostgreSQL suite after its 24 v5 package fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
export async function testFollowUpQueue(sql,principal,target,post){
  await sql.unsafe(`alter table ehr.patient add column display_name text default 'Synthetic patient';
    alter table ehr.patient_state add column engine_version text default 'ci';
    alter table iam.principal add column auth_user_id uuid,add column external_id text default 'SYN-CI',add column active boolean default true,add column synthetic boolean default true,add column principal_type text default 'clinician';
    create table iam.practice_membership(practice_id uuid,principal_id uuid,active boolean default true,role text default 'physician',workspaces text[] default '{office}',permissions jsonb default '{"patient.read":true}');
    create table iam.patient_assignment(practice_id uuid,principal_id uuid,patient_id uuid,active boolean default true,workspaces text[] default '{office}');
    create table iam.access_audit(principal_id uuid,patient_id uuid,action text,workspace text,allowed boolean,reason text);`);
  const other='22222222-2222-4222-8222-222222222222',practice='33333333-3333-4333-8333-333333333333';
  await sql`update iam.principal set auth_user_id=id`;
  await sql`insert into iam.principal(id,auth_user_id) values(${other},${other})`;
  for(const id of [principal,other]){
    await sql`insert into iam.practice_membership(practice_id,principal_id) values(${practice},${id})`;
    await sql`insert into iam.patient_assignment(practice_id,principal_id,patient_id) select ${practice}::uuid,${id}::uuid,id from ehr.patient`;
  }
  // Additional approved packages create 104 visible rows and genuine pagination.
  for(let i=1;i<=8;i++){
    const patientId='PT-'+String(i).padStart(3,'0');
    const [{id:patientUuid}]=await sql`select id from ehr.patient where external_id=${patientId}`;
    const [{id:encounterId}]=await sql`insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,status,final_state_version,note_text,signed_at) values(${patientUuid},${principal},'signed',2,'Second signed synthetic visit',now()) returning id`;
    let response=await post({patientId,encounterId,action:'create'});assert.equal(response.status,200,JSON.stringify(response));let view=response.body;
    async function mutate(action,fields={}){const r=await post({patientId,encounterId,expectedVersion:view.package.version,action,...fields});assert.equal(r.status,200,JSON.stringify(r));view=r.body;}
    for(let j=0;j<4;j++)await mutate('add-item',{kind:'lab',label:'Synthetic additional lab '+j,details:'No date fixture'});
    for(const item of view.items)await mutate('decide-item',{itemId:item.id,decision:'approved'});
    await mutate('approve');
  }
  const [{id:patientUuid}]=await sql`select id from ehr.patient where external_id='PT-001'`;
  for(let i=0;i<2;i++){
    const [{id:encounterId}]=await sql`insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,status,final_state_version,note_text,signed_at) values(${patientUuid},${principal},'signed',2,'Unfinished signed visit',now()) returning id`;
    if(i===1){let r=await post({patientId:'PT-001',encounterId,action:'create'});assert.equal(r.status,200);r=await post({patientId:'PT-001',encounterId,action:'add-item',expectedVersion:r.body.package.version,kind:'lab',label:'Pending draft must stay outside queue'});assert.equal(r.status,200);}
  }
  let handler,authId=principal;
  const source=fs.readFileSync('supabase/functions/follow-up-queue/index.ts','utf8').replace(/^import .*$/gm,'')+'\n'+fs.readFileSync('supabase/functions/follow-up-queue/queue.ts','utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync('supabase/functions/follow-up-queue/clinician-auth.ts','utf8').replace(/^export /gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source),{postgres:()=>sql,Deno:{env:{get:()=>target.href},serve:fn=>{handler=fn;}},fetch:async()=>new Response(JSON.stringify({id:authId,is_anonymous:false}),{status:200}),Headers,Response,URL,Date,Number,JSON,console,Set,AbortSignal});
  async function get(query='',options={}){const params=new URLSearchParams(query);if(!params.has('today'))params.set('today','2026-10-04');const r=await handler(new Request('https://example.test/queue?'+params.toString(),{headers:{authorization:'Bearer synthetic-ci-session',origin:'https://kidneycareclinic-star.github.io',...options.headers},method:options.method||'GET'}));return {status:r.status,body:await r.json(),headers:r.headers};}
  let r=await get();assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.total,56);assert.equal(r.body.summary.total,104);assert.equal(r.body.summary.outstanding,56);assert.equal(r.body.summary.completed,24);assert.equal(r.body.summary.cancelled,24);assert.equal(r.body.summary.no_date,32);assert.equal(r.body.summary.overdue,0);assert.equal(r.body.patients.length,24);assert.equal(r.body.waitingVisits.length,2);assert.equal(r.body.externalExecution,false);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual(r.body.waitingVisits.map(x=>x.package_status).sort(),['draft','not-created']);
  assert.ok(r.body.items.every(x=>x.source_state_version===2),'queue must retain the signed snapshot despite later state v3');
  r=await get('status=all');assert.equal(r.body.items.length,100);assert.equal(r.body.total,104);assert.equal(r.body.hasNext,true);const firstIds=r.body.items.map(x=>x.id);
  r=await get('status=all&page=1');assert.equal(r.body.items.length,4);assert.equal(r.body.hasNext,false);assert.ok(r.body.items.every(x=>!firstIds.includes(x.id)));
  assert.equal((await get('status=completed')).body.total,24);
  assert.equal((await get('status=cancelled')).body.total,24);
  assert.equal((await get('kind=medication&due=future')).body.total,24);
  assert.equal((await get('kind=lab&due=no-date')).body.total,32);
  assert.equal((await get('due=overdue')).body.total,0);
  assert.equal((await get('today=2026-10-05&due=today')).body.total,24);
  assert.equal((await get('today=2026-10-06&due=overdue')).body.total,24);
  assert.equal((await get('status=all&patient_id=PT-001')).body.total,7);
  assert.equal((await get('patient_id=PT-002')).body.waitingVisits.length,0);
  authId=other;r=await get('status=all');assert.equal(r.status,200);assert.equal(r.body.total,0);assert.equal(r.body.waitingVisits.length,0);authId=principal;
  await sql`update iam.patient_assignment set active=false where principal_id=${principal} and patient_id=(select id from ehr.patient where external_id='PT-024')`;
  r=await get('status=all');assert.equal(r.body.total,101);assert.equal(r.body.patients.length,23);
  await sql`update iam.patient_assignment set active=true where principal_id=${principal}`;
  await sql`update ehr.patient set synthetic=false where external_id='PT-023'`;
  assert.equal((await get('status=all')).body.total,101);
  await sql`update ehr.patient set synthetic=true where external_id='PT-023'`;
  for(const change of ["permissions='{}'::jsonb","role='nurse'","workspaces='{hospital}'::text[]","active=false"]){await sql.unsafe('update iam.practice_membership set '+change+' where principal_id=$1::uuid',[principal]);assert.equal((await get()).status,403);await sql`update iam.practice_membership set permissions=${sql.json({'patient.read':true})},role='physician',workspaces='{office}',active=true where principal_id=${principal}`;}
  assert.equal((await get('',{headers:{authorization:''}})).status,401);
  assert.equal((await get('',{headers:{origin:'https://untrusted.test'}})).status,403);
  assert.equal((await get('',{method:'POST'})).status,405);
  for(const q of ['today=2026-02-30','status=pending','patient_id=PT-001%27'])assert.equal((await get(q)).status,400);
  assert.equal((await sql`select count(*)::int as n from iam.access_audit where principal_id=${principal} and allowed=true`)[0].n>0,true);
  console.log('Follow-up queue real driver: 104 approved/resolved items; pagination; status/type/local-date/patient filters; unfinished packages; immutable source; actual clinician/census auth; owner, assignment, role, permission, workspace, origin and session isolation passed.');
}
