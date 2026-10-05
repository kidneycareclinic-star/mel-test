import assert from 'node:assert/strict';
export async function testDurableQueue({sql,parallelSql,principal,patientId,workerFns,draft,dispatch,stage,drive,get,post,preferences,setMode,getCalls}){
  let e=await draft();let [job]=await sql`select * from ehr.encounter_job where encounter_id=${e.id}`;
  assert.equal(job.status,'queued','saving reviewed sources queues work without any browser preparation request');
  const beforeCalls=getCalls();await stage(job.id);await stage(job.id);await stage(job.id);
  [job]=await sql`select * from ehr.encounter_job where id=${job.id}`;assert.equal(job.stage,'orders');assert.equal(getCalls(),beforeCalls+1,'note and orders have separate actual tasks');
  const note=job.checkpoints.note;setMode('fail');await drive(job.id);[job]=await sql`select * from ehr.encounter_job where id=${job.id}`;assert.equal(job.status,'failed');assert.deepEqual(job.checkpoints.note,note);
  const afterFailure=getCalls();setMode('ok');const q=await post({action:'prepare',patientId:'PT-002',encounterId:e.id,expectedVersion:e.version,preferences,refresh:true});assert.equal(q.status,202);assert.equal(q.body.job.id,job.id);
  await drive(job.id);[job]=await sql`select * from ehr.encounter_job where id=${job.id}`;assert.equal(job.status,'ready');assert.equal(getCalls(),afterFailure+1,'resume does not rewrite the completed note');assert.equal(job.checkpoints.verification,true);
  const summary=workerFns.jobSummary(job);assert(Object.values(summary.stages).every(s=>s==='complete'));assert.doesNotMatch(JSON.stringify(summary),/source_snapshot|lease_token|token_hash|No swelling|checkpoints/);
  const originalPoints=JSON.stringify(job.checkpoints);await assert.rejects(sql.unsafe("update ehr.encounter_job set checkpoints='{}' where id=$1::uuid",[job.id]),/completed_checkpoint_is_immutable/);
  await assert.rejects(sql.unsafe('update ehr.encounter_job set source_version=source_version+1 where id=$1::uuid',[job.id]),/encounter_job_source_is_immutable/);
  await assert.rejects(sql.unsafe('delete from ehr.encounter_job_event where job_id=$1::uuid',[job.id]),/approval_receipt_is_immutable/);
  assert.equal(JSON.stringify((await sql`select checkpoints from ehr.encounter_job where id=${job.id}`)[0].checkpoints),originalPoints);

  // A dead worker is reclaimed, and the old lease cannot publish its late output.
  e=await draft();[job]=await sql`select * from ehr.encounter_job where encounter_id=${e.id}`;const d=await dispatch(job.id),first=await workerFns.claimDispatch(sql,d.id,d.token);
  await assert.rejects(workerFns.claimDispatch(sql,d.id,d.token),/invalid_worker_dispatch/);
  await sql`update ehr.encounter_job set lease_until=now()-interval '1 second' where id=${job.id}`;
  assert.equal((await sql`select ehr.recover_encounter_jobs() as n`)[0].n,1);assert.equal((await sql`select status from ehr.encounter_job where id=${job.id}`)[0].status,'queued');
  const next=await dispatch(job.id),second=await workerFns.claimDispatch(sql,next.id,next.token);assert.notEqual(first.lease_token,second.lease_token);
  const oldCalls=getCalls();await workerFns.processJob(sql,first,'ci-key');assert.equal(getCalls(),oldCalls);assert.equal((await sql`select lease_token from ehr.encounter_job where id=${job.id}`)[0].lease_token,second.lease_token);
  await workerFns.processJob(sql,second,'ci-key');assert.equal((await sql`select stage from ehr.encounter_job where id=${job.id}`)[0].stage,'evidence');
  const forged=await dispatch(job.id);await assert.rejects(workerFns.claimDispatch(sql,forged.id,'a'.repeat(72)),/invalid_worker_dispatch/);
  await sql`update ehr.encounter_dispatch set expires_at=now()-interval '1 second' where id=${forged.id}`;await assert.rejects(workerFns.claimDispatch(sql,forged.id,forged.token),/invalid_worker_dispatch/);
  const a=await dispatch(job.id),b=await dispatch(job.id),claim=await workerFns.claimDispatch(sql,a.id,a.token);assert.equal(await workerFns.claimDispatch(sql,b.id,b.token),null,'duplicate dispatch cannot start a second worker');await workerFns.processJob(sql,claim,'ci-key');

  // Source and profile changes invalidate a worker before it can publish.
  const pending=await dispatch(job.id),late=await workerFns.claimDispatch(sql,pending.id,pending.token);
  await sql`update ehr.synthetic_encounter set version=version+1 where id=${e.id}`;await workerFns.processJob(sql,late,'ci-key');
  assert.equal((await sql`select status from ehr.encounter_job where id=${job.id}`)[0].status,'superseded');
  let [fresh]=await sql`select * from ehr.encounter_job where encounter_id=${e.id} and status='queued'`;assert.equal(fresh.source_version,e.version+1);
  await post({action:'prepare',patientId:'PT-002',encounterId:e.id,expectedVersion:e.version+1,preferences:{...preferences,detail:'brief'}});
  assert.equal((await sql`select status from ehr.encounter_job where id=${fresh.id}`)[0].status,'superseded');
  [fresh]=await sql`select * from ehr.encounter_job where encounter_id=${e.id} and status='queued'`;assert.equal(fresh.preferences.detail,'brief');
  assert.equal((await post({action:'prepare',patientId:'PT-003',encounterId:e.id,expectedVersion:e.version+1,preferences})).status,409,'cannot queue an encounter under another patient');
  await sql`update iam.patient_assignment set active=false where principal_id=${principal} and patient_id=${patientId}`;await stage(fresh.id);
  assert.equal((await sql`select error_code from ehr.encounter_job where id=${fresh.id}`)[0].error_code,'patient_access_denied');await sql`update iam.patient_assignment set active=true where principal_id=${principal} and patient_id=${patientId}`;

  // Server-side edit inheritance survives browser closure and regeneration.
  e=await draft();const p=await post({action:'prepare',patientId:'PT-002',encounterId:e.id,expectedVersion:e.version,preferences});await drive(p.body.job.id);
  let view=(await get()).body,run=view.preparation;const edits={action:'save-review',patientId:'PT-002',preparationId:run.id,packetHash:run.packet_hash,reviewVersion:0,noteText:run.packet.noteText+'\nSaved physician edit',patientInstructions:'Manually reviewed instructions.',observations:[],reviews:[],tools:[],actions:run.packet.actions.map(a=>({actionId:a.id,decision:'pending'})),instructionsReviewed:false};
  assert.equal((await post(edits)).status,200);
  await sql`update ehr.synthetic_encounter set version=version+1 where id=${e.id}`;const [newJob]=await sql`select * from ehr.encounter_job where encounter_id=${e.id} and status='queued'`;await drive(newJob.id);
  view=(await get()).body;assert.match(view.preparation.inheritedEdit.reviewed_snapshot.noteText,/Saved physician edit/);assert.equal(view.preparation.edit,null,'inherited text does not confer new packet approval');
  for(const table of ['encounter_profile','encounter_job','encounter_job_event','encounter_dispatch','encounter_dispatch_config']){
    const [permissions]=await sql.unsafe("select has_table_privilege('authenticated',$1,'select') as readable,has_table_privilege('anon',$1,'insert') as writable",['ehr.'+table]);assert.equal(permissions.readable,false);assert.equal(permissions.writable,false);
  }
  assert.equal((await sql`select has_function_privilege('authenticated','ehr.enqueue_encounter(uuid,boolean)','execute') as yes`)[0].yes,false);
  // Two independent connections race for one job: only one lease is awarded.
  e=await draft();[job]=await sql`select * from ehr.encounter_job where encounter_id=${e.id}`;
  const one=await dispatch(job.id),two=await dispatch(job.id),claims=await Promise.all([workerFns.claimDispatch(parallelSql,one.id,one.token),workerFns.claimDispatch(parallelSql,two.id,two.token)]);
  assert.equal(claims.filter(Boolean).length,1);await workerFns.processJob(sql,claims.find(Boolean),'ci-key');
  // Exercise the real scheduler SQL with a disposable HTTP transport stub.
  await sql.unsafe(`create schema net;create table net.ci_request(id bigint generated always as identity,url text,body jsonb,headers jsonb,timeout_ms int);
    create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.ci_request(url,body,headers,timeout_ms) values(url,body,headers,timeout_milliseconds) returning id$$;`);
  await sql`update ehr.encounter_dispatch_config set enabled=true,endpoint='https://excqvjpsmdxzhujsbkmz.supabase.co/functions/v1/encounter-worker'`;
  assert((await sql`select ehr.dispatch_encounter_jobs() as n`)[0].n>=1);
  const [request]=await sql`select * from net.ci_request order by id limit 1`;assert.deepEqual(Object.keys(request.body),['dispatchId']);assert.equal(request.timeout_ms,90000);
  const scheduled=await workerFns.claimDispatch(sql,request.body.dispatchId,request.headers.Authorization.slice(7));assert(scheduled,'real dispatcher and worker hashes match');await workerFns.processJob(sql,scheduled,'ci-key');
  await sql`update ehr.encounter_dispatch_config set enabled=false`;await sql.unsafe('drop schema net cascade');
  console.log('v11 durable queue: source-trigger enqueue, per-task checkpoints, bounded retries, note-preserving resume, expired worker recovery, late-output fencing, single-use/forged/expired dispatch, duplicate claim, source/profile invalidation, revocation, patient binding, edit inheritance, private tables and immutable history passed.');
}
