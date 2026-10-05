import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
export async function testEncounterInbox(sql,principal,target){
  await sql.unsafe(fs.readFileSync('supabase/sql/encounter-inbox-v12.sql','utf8'));
  let handler,authId=principal;
  const parts=['clinician-auth.ts','inbox.ts','index.ts'];
  const source=parts.map(p=>fs.readFileSync('supabase/functions/encounter-inbox/'+p,'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')).join('\n');
  vm.runInNewContext(stripTypeScriptTypes(source),{postgres:()=>sql,Deno:{env:{get:()=>target.href},serve:fn=>handler=fn},fetch:async()=>new Response(JSON.stringify({id:authId,is_anonymous:false})),TextEncoder,TextDecoder,Uint8Array,Headers,Request,Response,URL,Date,JSON,Set,AbortSignal});
  async function call(query='',body=null,extra={}){const r=await handler(new Request('https://example.test/inbox'+(query?'?'+query:''),{method:body?'POST':'GET',headers:{authorization:'Bearer ci-session',origin:'https://kidneycareclinic-star.github.io',...(body?{'content-type':'application/json'}:{}),...extra.headers},body:body?JSON.stringify(body):undefined,...extra.options}));return {status:r.status,body:await r.json(),headers:r.headers};}
  const before=await sql`select md5(string_agg(state::text,'' order by patient_id,state_version)) as digest from ehr.patient_state`;
  let r=await call();assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.headers.get('cache-control'),'no-store');
  assert(r.body.items.every(x=>['ready','failed','expired'].includes(x.status)));
  r=await call('filter=preparing');assert(r.body.items.length>0);assert(r.body.items.every(x=>['queued','running'].includes(x.status)));const item=r.body.items[0];
  assert(!JSON.stringify(item).includes('lease_token'));assert(!JSON.stringify(item).includes('checkpoints'));
  r=await call('job_id='+item.id);assert.equal(r.body.encounterId,item.encounterId);assert.equal(r.body.patientId,item.patientId);assert.equal(r.body.mode,'review');
  assert.equal((await call('',{action:'seen',jobId:item.id,revision:item.revision})).status,200);
  assert.equal((await call('',{action:'seen',jobId:item.id,revision:item.revision})).status,200,'ack idempotent');
  assert.equal((await call('filter=preparing')).body.items.find(x=>x.id===item.id).seen,true);
  await sql`update ehr.encounter_job set status='failed',lease_token=null,lease_until=null,error_code='ci-paused' where id=${item.id}`;
  await sql`insert into ehr.encounter_job_event(job_id,stage,status,event,attempt) values(${item.id},'chart','failed','CI_TEST_PAUSE',1)`;
  let paused=(await call()).body.items.find(x=>x.id===item.id);assert(paused);assert.equal(paused.seen,false,'new event re-alerts even for same job');
  assert.equal((await call('',{action:'seen',jobId:item.id,revision:item.revision})).status,409,'stale ack cannot hide new event');
  await call('',{action:'seen',jobId:item.id,revision:paused.revision});assert.equal((await call()).body.items.find(x=>x.id===item.id).seen,true);
  // Source replacement resolves an older link to the current job of the same encounter.
  await sql`update ehr.synthetic_encounter set version=version+1 where id=${item.encounterId}`;
  const resolved=await call('job_id='+item.id);assert.equal(resolved.status,200);assert.equal(resolved.body.replaced,true);assert.notEqual(resolved.body.jobId,item.id);assert.equal(resolved.body.encounterId,item.encounterId);
  const other='22222222-2222-4222-8222-222222222222';authId=other;
  assert.equal((await call('job_id='+item.id)).status,404);assert.equal((await call('',{action:'seen',jobId:item.id,revision:paused.revision})).status,404);assert(!(await call('filter=preparing')).body.items.some(x=>x.encounterId===item.encounterId));authId=principal;
  const [patient]=await sql`select id from ehr.patient where external_id=${item.patientId}`;
  for(const mutation of ["pa.active=false","pa.workspaces='{hospital}'"]){await sql.unsafe('update iam.patient_assignment pa set '+mutation.replace('pa.','')+' where principal_id=$1::uuid and patient_id=$2::uuid',[principal,patient.id]);assert.equal((await call('job_id='+item.id)).status,404);assert(!(await call('filter=preparing')).body.items.some(x=>x.encounterId===item.encounterId));await sql`update iam.patient_assignment set active=true,workspaces='{office}' where principal_id=${principal} and patient_id=${patient.id}`;}
  const [membership]=await sql`select permissions from iam.practice_membership where principal_id=${principal} limit 1`;
  for(const mutation of ["active=false","role='nurse'","workspaces='{hospital}'","permissions='{}'::jsonb"]){await sql.unsafe('update iam.practice_membership set '+mutation+' where principal_id=$1::uuid',[principal]);assert.equal((await call('job_id='+item.id)).status,404);assert.equal((await call()).body.items.length,0);await sql`update iam.practice_membership set active=true,role='physician',workspaces='{office}',permissions=${sql.json(membership.permissions)} where principal_id=${principal}`;}
  await sql`update iam.principal set active=false where id=${principal}`;assert.equal((await call()).status,403);await sql`update iam.principal set active=true where id=${principal}`;
  // An older visit cannot open a newer visit of the same patient.
  await sql.unsafe("insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,note_text,sources,base_state_version,created_at) values($1::uuid,$2::uuid,'newer visit','[]',3,now()+interval '1 second')",[patient.id,principal]);
  assert.equal((await call('job_id='+item.id)).status,410);
  // A signed link targets its exact saved visit, never another patient's packet.
  const [signed]=await sql`select j.id,j.encounter_id from ehr.encounter_job j join ehr.encounter_approval_receipt r on r.encounter_id=j.encounter_id where j.clinician_principal_id=${principal} limit 1`;
  assert(signed);r=await call('job_id='+signed.id);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.mode,'signed');assert.equal(r.body.encounterId,signed.encounter_id);
  assert.equal((await call('',{action:'finalize',jobId:signed.id,revision:'0'})).status,400);
  assert.equal((await call('job_id=00000000-0000-4000-8000-000000000000')).status,404);
  for(const q of ['job_id=bad','filter=all','page=-1','page=1%27'])assert.equal((await call(q)).status,400);
  assert.equal((await call('',null,{headers:{authorization:''}})).status,401);
  assert.equal((await call('',null,{headers:{origin:'https://untrusted.test'}})).status,403);
  assert.equal((await call('',null,{options:{method:'DELETE'}})).status,405);
  assert.equal((await call('',{action:'seen',jobId:item.id,revision:'a'.repeat(5000)})).status,413);
  assert.equal((await sql`select has_table_privilege('authenticated','ehr.encounter_inbox_seen','select') as yes`)[0].yes,false);
  assert.equal((await sql`select relrowsecurity as yes from pg_class where oid='ehr.encounter_inbox_seen'::regclass`)[0].yes,true);
  // More than one page of assigned work is complete and stable, including expired preparation.
  const [practice]=await sql`select practice_id from iam.practice_membership where principal_id=${principal} limit 1`;
  let expiredId;
  for(let i=101;i<156;i++){
    const [p]=await sql`insert into ehr.patient(external_id,display_name) values(${'PT-'+i},${'Synthetic inbox patient '+i}) returning id`;
    await sql`insert into iam.patient_assignment(practice_id,principal_id,patient_id) values(${practice.practice_id},${principal},${p.id})`;
    const [e]=await sql.unsafe("insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,note_text,sources,base_state_version) values($1::uuid,$2::uuid,'Reviewed source',$3::text::jsonb,1) returning id",[p.id,principal,JSON.stringify([{kind:'typed-note',text:'Reviewed source'}])]);
    if(i===101){const [j]=await sql`select * from ehr.encounter_job where encounter_id=${e.id}`;await sql`update ehr.encounter_job set status='superseded' where id=${j.id}`;const [old]=await sql.unsafe("insert into ehr.encounter_job(patient_id,encounter_id,clinician_principal_id,source_version,profile_version,preferences,expires_at) select patient_id,encounter_id,clinician_principal_id,source_version,profile_version,preferences,now()-interval '1 second' from ehr.encounter_job where id=$1::uuid returning id",[j.id]);expiredId=old.id;}
  }
  r=await call('filter=preparing');assert.equal(r.body.items.length,50);assert.equal(r.body.hasNext,true);const firstIds=new Set(r.body.items.map(x=>x.id));const next=await call('filter=preparing&page=1');assert(next.body.items.length>0);assert(next.body.items.every(x=>!firstIds.has(x.id)));assert.equal(next.body.hasNext,false);
  r=await call();assert.equal(r.body.items.find(x=>x.id===expiredId).status,'expired');
  assert.deepEqual(await sql`select md5(string_agg(state::text,'' order by patient_id,state_version)) as digest from ehr.patient_state`,before,'inbox never changes clinical state');
  console.log('Encounter inbox real SQL: current/owner/assignment/role/scope checks; read receipts; new-event re-alert; stale acknowledgement; replacement and old-visit/signed links; no-sign API; origin/session/body limits; private RLS and unchanged clinical state passed.');
}
