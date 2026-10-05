import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
import {phoneMutation,phoneView,processPhoneAlert,claimPhoneDispatch} from '../supabase/functions/phone-alerts/alerts.ts';
import {providerConfig} from '../supabase/functions/phone-alerts/provider.ts';
export async function testPhoneAlerts(sql,principal,target){
  await sql.unsafe(fs.readFileSync('supabase/sql/phone-alerts-v13.sql','utf8'));
  const person={id:principal},off=providerConfig(()=>undefined),values={SMS_DELIVERY_MODE:'twilio',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'b'.repeat(32),TWILIO_MESSAGING_SERVICE_SID:'MG'+'c'.repeat(32),TWILIO_VERIFY_SERVICE_SID:'VA'+'d'.repeat(32),SMS_CONTACT_ENCRYPTION_KEY:'e'.repeat(64)},config=providerConfig(n=>values[n]);
  let view=await sql.begin(tx=>phoneView(tx,person,off));assert.equal(view.preferences.mode,'preview');assert.equal(view.providerReady,false);assert.equal(view.preferences.phoneLast4,null);
  const mutation=(fields,cfg=off,fetcher)=>sql.begin(tx=>phoneMutation(tx,person,{expectedVersion:view.preferences.version,...fields},cfg,fetcher));
  const refresh=async(cfg=off)=>view=await sql.begin(tx=>phoneView(tx,person,cfg));
  const preferences=(mode='preview',fields={})=>({action:'preferences',mode,readyAlerts:true,pausedAlerts:true,quietHours:false,timeZone:'America/New_York',...fields});
  await mutation(preferences());await refresh();
  await assert.rejects(mutation({...preferences(),expectedVersion:1}),/phone_preferences_changed/);
  await assert.rejects(mutation(preferences('sms')),/phone_delivery_not_configured/);
  await assert.rejects(mutation(preferences('sms',{consent:true}),config),/verified_phone_and_consent_required/);
  const [practice]=await sql`select practice_id from iam.practice_membership where principal_id=${principal} limit 1`;
  let patientNumber=700;
  async function makeJob(kind='ready'){
    const [patient]=await sql`insert into ehr.patient(external_id,display_name) values(${'PT-'+patientNumber++},'Synthetic alert fixture') returning id`;
    await sql`insert into iam.patient_assignment(practice_id,principal_id,patient_id) values(${practice.practice_id},${principal},${patient.id})`;
    const [encounter]=await sql`insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,note_text,sources,base_state_version) values(${patient.id},${principal},'Reviewed synthetic test',${sql.json([{kind:'typed-note',text:'Reviewed synthetic test'}])},1) returning id`;
    const [job]=await sql`select id from ehr.encounter_job where encounter_id=${encounter.id}`;
    if(kind==='ready'){await sql`update ehr.encounter_job set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=${job.id}`;await sql`update ehr.encounter_job set status='ready',lease_token=null,lease_until=null where id=${job.id}`;}
    else await sql`update ehr.encounter_job set status='failed' where id=${job.id}`;
    await sql`insert into ehr.encounter_job_event(job_id,stage,status,event,attempt) values(${job.id},'verification',${kind},'synthetic_alert_fixture',0)`;
    return {jobId:job.id,encounterId:encounter.id,patientId:patient.id};
  }
  const fixture=await makeJob(),before=(await sql`select md5(string_agg(state::text,'' order by patient_id,state_version)) as digest from ehr.patient_state`)[0].digest;
  await sql`select ehr.queue_phone_alerts()`;const [alert]=await sql`select * from ehr.phone_alert where job_id=${fixture.jobId}`;assert(alert);assert.equal(alert.transport,'preview');
  const count=(await sql`select count(*)::int as n from ehr.phone_alert`)[0].n;await sql`select ehr.queue_phone_alerts()`;assert.equal((await sql`select count(*)::int as n from ehr.phone_alert`)[0].n,count,'revision/transport deduplication');
  let calls=0;await processPhoneAlert(sql,alert.id,off,async()=>{calls++;throw Error('preview cannot call provider');});assert.equal(calls,0);assert.equal((await sql`select status from ehr.phone_alert where id=${alert.id}`)[0].status,'preview');
  await mutation({action:'preview-test'});await refresh();assert.equal(view.history[0].status,'preview');assert.equal(view.history[0].jobId,null);assert.doesNotMatch(JSON.stringify(view),/phone_ciphertext|verify_sid|provider_sid|token_hash|TWILIO/);
  await assert.rejects(mutation({action:'preview-test'}),/preview_rate_limited/);
  // Save an opt-out while work is pending; re-enable reuses only never-submitted alerts.
  const pendingFixture=await makeJob();await sql`select ehr.queue_phone_alerts()`;const [pending]=await sql`select * from ehr.phone_alert where job_id=${pendingFixture.jobId}`;
  await mutation(preferences('off'));await refresh();await processPhoneAlert(sql,pending.id,off);assert.equal((await sql`select status from ehr.phone_alert where id=${pending.id}`)[0].status,'cancelled');
  await mutation(preferences());await refresh();await sql`select ehr.queue_phone_alerts()`;assert.equal((await sql`select status from ehr.phone_alert where id=${pending.id}`)[0].status,'pending');
  // Source replacement and explicit seen receipts prevent stale alerts.
  await sql`update ehr.synthetic_encounter set version=version+1 where id=${pendingFixture.encounterId}`;await processPhoneAlert(sql,pending.id,off);assert.equal((await sql`select status from ehr.phone_alert where id=${pending.id}`)[0].status,'cancelled');
  const seenFixture=await makeJob();await sql`select ehr.queue_phone_alerts()`;const [seen]=await sql`select * from ehr.phone_alert where job_id=${seenFixture.jobId}`;
  await sql`insert into ehr.encounter_inbox_seen(job_id,clinician_principal_id,revision) values(${seenFixture.jobId},${principal},${seen.revision})`;await processPhoneAlert(sql,seen.id,off);assert.equal((await sql`select status from ehr.phone_alert where id=${seen.id}`)[0].status,'cancelled');
  const revokedFixture=await makeJob();await sql`select ehr.queue_phone_alerts()`;const [revoked]=await sql`select id from ehr.phone_alert where job_id=${revokedFixture.jobId}`;
  await sql`update iam.patient_assignment set active=false where patient_id=${revokedFixture.patientId}`;await processPhoneAlert(sql,revoked.id,off);assert.equal((await sql`select status from ehr.phone_alert where id=${revoked.id}`)[0].status,'cancelled');
  // Failed jobs stay failed after expiry, exactly as the inbox revision specifies.
  const [pastPatient]=await sql`insert into ehr.patient(external_id,display_name) values(${'PT-'+patientNumber++},'Expired failure fixture') returning id`;
  await sql`insert into iam.patient_assignment(practice_id,principal_id,patient_id) values(${practice.practice_id},${principal},${pastPatient.id})`;
  const [pastEncounter]=await sql`insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,note_text,sources,base_state_version) values(${pastPatient.id},${principal},'Synthetic expired fixture','[]',1) returning id`;
  const [pastJob]=await sql`insert into ehr.encounter_job(patient_id,encounter_id,clinician_principal_id,source_version,profile_version,preferences,status,expires_at) values(${pastPatient.id},${pastEncounter.id},${principal},1,0,'{}','failed',now()-interval '1 hour') returning id`;
  await sql`select ehr.queue_phone_alerts()`;const [pastAlert]=await sql`select * from ehr.phone_alert where job_id=${pastJob.id}`;assert.equal(pastAlert.reason,'failed');assert.equal(pastAlert.revision,'0:failed');
  await sql`update ehr.phone_alert set send_started_at=now()-interval '3 hours' where clinician_principal_id=${principal}`;
  await processPhoneAlert(sql,pastAlert.id,off);assert.equal((await sql`select status from ehr.phone_alert where id=${pastAlert.id}`)[0].status,'preview');
  // Provider is completely mocked: no verification or encounter text leaves CI.
  const wires=[];let response={sid:'VE'+'a'.repeat(32),status:'pending'},httpStatus=201;
  const fetcher=async(url,options)=>{wires.push({url,body:options.body});return new Response(JSON.stringify(response),{status:httpStatus});};
  await mutation({action:'verify-start',phone:'+12025550123',consent:true},config,fetcher);await refresh(config);
  assert.equal(view.preferences.verified,false);assert.equal(view.preferences.mode,'preview');assert.equal(view.preferences.verificationPending,true);
  const [contact]=await sql`select phone_ciphertext from ehr.clinician_phone_preference where clinician_principal_id=${principal}`;assert.doesNotMatch(contact.phone_ciphertext,/12025550123/);
  await assert.rejects(mutation({action:'verify-start',phone:'+12025550123',consent:true},config,fetcher),/verification_rate_limited/);
  response={status:'pending',valid:false};httpStatus=200;let result=await mutation({action:'verify-check',code:'999999'},config,fetcher);assert.equal(result.error,'verification_code_invalid');await refresh(config);assert.equal(view.preferences.verified,false);
  response={status:'approved',valid:true};await mutation({action:'verify-check',code:'123456'},config,fetcher);await refresh(config);assert.equal(view.preferences.verified,true);assert.equal(view.preferences.mode,'preview');
  await mutation(preferences('sms',{consent:true}),config,fetcher);await refresh(config);assert.equal(view.preferences.mode,'sms');
  await mutation(preferences('off'),config);await refresh(config);assert.equal(view.preferences.consented,false,'disabling delivery clears active consent');
  await mutation(preferences('sms',{consent:true}),config,fetcher);await refresh(config);
  const liveFixture=await makeJob();await sql`select ehr.queue_phone_alerts()`;const [live]=await sql`select * from ehr.phone_alert where job_id=${liveFixture.jobId} and transport='sms'`;
  response={sid:'SM'+'b'.repeat(32),status:'queued'};httpStatus=201;const baseline=wires.length;await Promise.all([processPhoneAlert(sql,live.id,config,fetcher),processPhoneAlert(sql,live.id,config,fetcher)]);assert.equal(wires.length,baseline+1,'concurrent processing sends once');assert.equal((await sql`select status from ehr.phone_alert where id=${live.id}`)[0].status,'accepted');
  response={sid:'SM'+'b'.repeat(32),status:'delivered'};httpStatus=200;await processPhoneAlert(sql,live.id,config,fetcher);assert.equal((await sql`select status from ehr.phone_alert where id=${live.id}`)[0].status,'delivered');
  await processPhoneAlert(sql,live.id,config,fetcher);assert.equal(wires.length,baseline+2,'a delivered message cannot be sent or polled again');
  const limitedFixture=await makeJob();await sql`select ehr.queue_phone_alerts()`;const [limited]=await sql`select id from ehr.phone_alert where job_id=${limitedFixture.jobId} and transport='sms'`;
  const rateBaseline=wires.length;await processPhoneAlert(sql,limited.id,config,fetcher);assert.equal(wires.length,rateBaseline);assert.equal((await sql`select status from ehr.phone_alert where id=${limited.id}`)[0].status,'pending','minimum spacing defers alerts');
  const offset=(new Date().getUTCHours()-1+24)%24,quietZone=offset<=12?'Etc/GMT+'+offset:'Etc/GMT-'+(24-offset);
  await mutation(preferences('sms',{consent:true,quietHours:true,timeZone:quietZone}),config);await refresh(config);await sql`select ehr.queue_phone_alerts()`;
  await sql`update ehr.phone_alert set send_started_at=now()-interval '3 hours' where clinician_principal_id=${principal}`;
  await processPhoneAlert(sql,limited.id,config,fetcher);assert.equal(wires.length,rateBaseline);assert.equal((await sql`select status from ehr.phone_alert where id=${limited.id}`)[0].status,'pending','quiet hours defer an eligible alert');
  await mutation(preferences('sms',{consent:true}),config);await refresh(config);
  await sql`update ehr.phone_alert set send_started_at=now()-interval '3 hours' where clinician_principal_id=${principal}`;
  const unknownFixture=await makeJob();await sql`select ehr.queue_phone_alerts()`;const [unknown]=await sql`select id from ehr.phone_alert where job_id=${unknownFixture.jobId} and transport='sms'`;
  let unknownCalls=0;const timeout=async()=>{unknownCalls++;throw Error('provider timeout');};await processPhoneAlert(sql,unknown.id,config,timeout);await processPhoneAlert(sql,unknown.id,config,timeout);assert.equal(unknownCalls,1);assert.equal((await sql`select status from ehr.phone_alert where id=${unknown.id}`)[0].status,'unknown');
  await sql`update ehr.phone_alert set send_started_at=now()-interval '3 hours' where clinician_principal_id=${principal}`;
  const crashFixture=await makeJob();await sql`select ehr.queue_phone_alerts()`;const [crash]=await sql`select id from ehr.phone_alert where job_id=${crashFixture.jobId} and transport='sms'`;
  let txs=0;const crashingSql={begin:fn=>sql.begin(async tx=>{const output=await fn(tx);if(++txs===2)throw Error('post-send commit failure');return output;})};
  response={sid:'SM'+'c'.repeat(32),status:'queued'};httpStatus=201;const crashBaseline=wires.length;await processPhoneAlert(crashingSql,crash.id,config,fetcher);await processPhoneAlert(sql,crash.id,config,fetcher);assert.equal(wires.length,crashBaseline+1);assert.equal((await sql`select status from ehr.phone_alert where id=${crash.id}`)[0].status,'unknown','durable send intent survives post-provider rollback');
  await sql`update ehr.phone_alert set send_started_at=now()-interval '3 hours' where clinician_principal_id=${principal}`;
  const optoutFixture=await makeJob();await sql`select ehr.queue_phone_alerts()`;const [optout]=await sql`select id from ehr.phone_alert where job_id=${optoutFixture.jobId} and transport='sms'`;
  response={code:21610};httpStatus=400;await processPhoneAlert(sql,optout.id,config,fetcher);await refresh(config);assert.equal(view.preferences.mode,'off');assert.equal(view.preferences.consented,false);
  await mutation({action:'forget-phone'},config);await refresh(config);assert.equal(view.preferences.phoneLast4,null);assert.equal((await sql`select phone_ciphertext from ehr.clinician_phone_preference where clinician_principal_id=${principal}`)[0].phone_ciphertext,null);
  // Dispatch capabilities are short-lived, bound to one alert and replay-protected.
  const bearer=crypto.randomUUID()+crypto.randomUUID(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bearer)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const [dispatch]=await sql`insert into ehr.phone_alert_dispatch(alert_id,token_hash) values(${alert.id},${hash}) returning id`;
  assert.equal(await claimPhoneDispatch(sql,dispatch.id,bearer),alert.id);await assert.rejects(claimPhoneDispatch(sql,dispatch.id,bearer),/invalid_alert_dispatch/);
  await assert.rejects(claimPhoneDispatch(sql,dispatch.id,'a'.repeat(72)),/invalid_alert_dispatch/);
  const [expired]=await sql`insert into ehr.phone_alert_dispatch(alert_id,token_hash,expires_at) values(${alert.id},${hash},now()-interval '1 second') returning id`;await assert.rejects(claimPhoneDispatch(sql,expired.id,bearer),/invalid_alert_dispatch/);
  // Exercise the actual endpoint boundary with real IAM checks.
  let handler,authId=principal;const parts=['clinician-auth.ts','inbox.ts','provider.ts','alerts.ts','index.ts'];
  const source=parts.map(p=>fs.readFileSync('supabase/functions/phone-alerts/'+p,'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')).join('\n');
  vm.runInNewContext(stripTypeScriptTypes(source),{postgres:()=>sql,Deno:{env:{get:name=>['SUPABASE_DB_URL','SUPABASE_URL'].includes(name)?target.href:name==='SUPABASE_ANON_KEY'?'ci-key':undefined},serve:fn=>handler=fn},fetch:async()=>new Response(JSON.stringify({id:authId,is_anonymous:false})),TextEncoder,TextDecoder,Uint8Array,Headers,Request,Response,URL,Date,JSON,Set,Intl,AbortSignal,crypto,btoa,URLSearchParams});
  async function call(body=null,headers={},method=body?'POST':'GET'){const r=await handler(new Request('https://example.test/phone',{method,headers:{authorization:'Bearer ci-session',origin:'https://kidneycareclinic-star.github.io',...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));return {status:r.status,body:await r.json(),headers:r.headers};}
  let r=await call();assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.headers.get('cache-control'),'no-store');assert.doesNotMatch(JSON.stringify(r.body),/ciphertext|token_hash|provider_sid|verify_sid/);
  assert.equal((await call(null,{authorization:''})).status,401);assert.equal((await call(null,{origin:'https://untrusted.test'})).status,403);assert.equal((await call(null,{},'DELETE')).status,405);assert.equal((await call('x'.repeat(4097))).status,413);
  assert.equal((await call({action:'finalize',expectedVersion:r.body.preferences.version})).status,400);
  authId='22222222-2222-4222-8222-222222222222';r=await call();assert.equal(r.status,200);assert.equal(r.body.history.length,0);authId=principal;
  const [membership]=await sql`select permissions from iam.practice_membership where principal_id=${principal} limit 1`;
  for(const change of ["active=false","role='nurse'","workspaces='{hospital}'","permissions='{}'"]){await sql.unsafe('update iam.practice_membership set '+change+' where principal_id=$1::uuid',[principal]);assert.equal((await call()).status,403);await sql`update iam.practice_membership set active=true,role='physician',workspaces='{office}',permissions=${sql.json(membership.permissions)} where principal_id=${principal}`;}
  for(const table of ['clinician_phone_preference','phone_alert','phone_alert_audit','phone_alert_dispatch','phone_alert_config']){assert.equal((await sql.unsafe("select has_table_privilege('authenticated',$1,'select') as yes",['ehr.'+table]))[0].yes,false);assert.equal((await sql.unsafe('select relrowsecurity as yes from pg_class where oid=$1::regclass',['ehr.'+table]))[0].yes,true);}
  await assert.rejects(sql`update ehr.phone_alert_audit set event='tamper'`,/immutable/);
  assert.equal((await sql`select md5(string_agg(state::text,'' order by patient_id,state_version)) as digest from ehr.patient_state`)[0].digest,before);
  console.log('Phone alert real-driver checks passed: default previews, private encrypted contact, consent/verification, throttling, deduplication, current source/seen/access fences, concurrent sends, delivery polling, timeout and commit-rollback uncertainty, opt-out, contact deletion, single-use dispatch, endpoint IAM/origin/body boundaries, immutable audit and unchanged clinical state. Provider fully mocked.');
}
