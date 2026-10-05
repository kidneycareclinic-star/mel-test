import {testDurableQueue} from './encounter-orchestrator-driver-tests.mjs';
// Actual coordinator SQL, transactions, reducer and auth on the disposable CI database.
import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import {webcrypto} from 'node:crypto';import {pathToFileURL} from 'node:url';
export async function testCoordinator(sql,principal,target){
  await sql.unsafe(`
    alter table ehr.proposed_observation add column id uuid default gen_random_uuid(),add column client_record_id text,add column field text,add column display_label text,add column observation_type text,add column value_numeric numeric,add column value_json jsonb,add column unit text,add column source_text text,add column observed_at timestamptz default now(),add column confidence text,add column certainty text,add column provenance_id uuid,add column decision_event_id uuid,add column reviewed_by_type text,add column reviewed_by_id text,add column metadata jsonb default '{}',add column created_at timestamptz default now();
    alter table ehr.encounter_review add column id uuid default gen_random_uuid(),add column run_id uuid,add column base_state_version bigint,add column generated_content jsonb,add column reviewed_content jsonb,add column decision_event_id uuid,add column reviewed_by_id text;
    alter table ehr.tool_call add column id uuid default gen_random_uuid(),add column tool_name text,add column risk_level text,add column agent_run_id uuid;
    create table ehr.approval(patient_id uuid,tool_call_id uuid,decision text,decided_by_type text,decided_by_id text,event_id uuid);
    create table ehr.clinical_observation(id uuid primary key default gen_random_uuid(),patient_id uuid,observation_type text,display text,value_numeric numeric,value_json jsonb,unit text,status text,observed_at timestamptz,recorded_at timestamptz default now(),provenance_id uuid,source_event_id uuid,client_record_id text);
    create unique index observation_client on ehr.clinical_observation(patient_id,client_record_id) where client_record_id is not null;
    create table ehr.medication(patient_id uuid,medication_name text,status text);
    create table ehr.problem(id uuid,patient_id uuid,problem_key text,problem_name text,code text,coded_label text,primary_problem boolean,status text,code_system text,coding_status text);
    create table ehr.open_loop(id uuid,patient_id uuid,loop_type text,label text,status text,workspace text,due_at timestamptz,owner_type text,owner_id text,created_at timestamptz);
    alter table ehr.patient_state_audit add column id uuid default gen_random_uuid(),add column event_id uuid,add column encounter_id uuid,add column previous_version bigint,add column previous_state jsonb,add column created_at timestamptz default now();
    alter table ehr.provenance add primary key(id);
  `);
  const v4=fs.readFileSync('supabase/sql/encounter-state-v4.sql','utf8');
  await sql.unsafe(v4.slice(v4.indexOf('CREATE OR REPLACE FUNCTION ehr.reduce_patient_state'),v4.indexOf('-- Two physician decisions')));
  await sql.unsafe(v4.slice(v4.indexOf('create or replace function ehr.capture_state_audit()'),v4.indexOf('create or replace function ehr.preserve_state_history()')));
  // Narrative freshness helper uses real existing audit events; no arbitrary state bypass.
  await sql.unsafe(v4.slice(v4.indexOf('-- Two physician decisions')));
  await sql.unsafe(fs.readFileSync('supabase/sql/encounter-coordinator-v9.sql','utf8'));
  await sql.unsafe(fs.readFileSync('supabase/sql/encounter-orchestrator-v11.sql','utf8'));
  await sql`update iam.practice_membership set permissions=${sql.json({'patient.read':true,'encounter.draft':true,'encounter.sign':true,'scribe.review':true,'agent.review':true,'tool.prepare':true})}`;
  let handler,authId=principal,providerCalls=0,providerMode='ok',race=null;
  const parts=['drafting.ts','clinical-actions.ts','json-boundary.ts','observations.ts','coordinator.ts','clinician-auth.ts','orchestration.ts','index.ts'];
  const code=parts.map(p=>fs.readFileSync('supabase/functions/encounter-coordinator/'+p,'utf8').replace(/^import .*$/gm,'').replace(/^export /gm,'')).join('\n')+'\nglobalThis.workerFns={claimDispatch,processJob,jobSummary,ordersRequest};';
  const sandbox={postgres:()=>sql,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Headers,Request,Response,URL,Date,Number,JSON,Map,Set,AbortSignal,structuredClone,console,Deno:{env:{get:n=>n==='OPENAI_API_KEY'?'ci-only-key':target.href},serve:fn=>handler=fn},fetch:async(url,options)=>{
    if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:authId,is_anonymous:false}));
    providerCalls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.doesNotMatch(options.body,/Forbidden raw/);const input=JSON.parse(JSON.parse(options.body).input);assert.equal(input.evidence.mode,'prechart');assert.equal(JSON.parse(options.body).store,false);if(race)await race();if(providerMode==='fail')return new Response('{}',{status:502});
    const value={sections:input.preferences.headings.map((heading,i)=>({heading,body:i?'Not documented.':'No swelling.',sourceQuotes:i?[]:['No swelling.']})),reviewFlags:['Examination not documented.'],actions:[{kind:'lab',label:'BMP',details:'Repeat BMP.',timing:'in 3 months',sourceId:'reviewed-0',sourceQuote:'Physician: repeat BMP in 3 months.',intent:'physician-plan',missingInformation:[],patientText:'Get your repeat BMP in 3 months.',medication:null},{kind:'follow-up',label:'Nephrology follow-up',details:'Return for follow-up.',timing:'in 3 months',sourceId:'reviewed-0',sourceQuote:'Physician: return in 3 months.',intent:'physician-plan',missingInformation:[],patientText:'Return for follow-up in 3 months.',medication:null}]};
    return new Response(JSON.stringify({status:'completed',model:'ci-provider-mock',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}));
  }};vm.runInNewContext(stripTypeScriptTypes(code),sandbox);
  const workerFns=sandbox.workerFns;
  async function post(body){const r=await handler(new Request('https://example.test/coordinator',{method:'POST',headers:{authorization:'Bearer synthetic-ci-only','content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}
  async function get(patientId='PT-002'){const r=await handler(new Request('https://example.test/coordinator?patient_id='+patientId,{headers:{authorization:'Bearer synthetic-ci-only'}}));return {status:r.status,body:await r.json()};}
  const [{id:patientId}]=await sql`select id from ehr.patient where external_id='PT-002'`;
  const sourceText='No swelling. Do not increase to two tablets. Potassium 4.9 mmol/L. Physician: repeat BMP in 3 months. Physician: return in 3 months.';
  async function draft(){return (await sql.unsafe("insert into ehr.synthetic_encounter(patient_id,clinician_principal_id,note_text,sources,base_state_version) values($1::uuid,$2::uuid,$3,$4::text::jsonb,3) returning id,version",[patientId,principal,sourceText,JSON.stringify([{kind:'ambient-transcript',title:'Reviewed source',text:sourceText,rawText:'Forbidden raw'}])]))[0];}
  let encounter=await draft();
  const wrongReviewLink=await handler(new Request('https://example.test/coordinator?patient_id=PT-002&expected_encounter_id=00000000-0000-4000-8000-000000000000',{headers:{authorization:'Bearer synthetic-ci-only'}}));assert.equal(wrongReviewLink.status,409,'link scope cannot load another encounter');
  const correctReviewLink=await handler(new Request('https://example.test/coordinator?patient_id=PT-002&expected_encounter_id='+encounter.id,{headers:{authorization:'Bearer synthetic-ci-only'}}));assert.equal(correctReviewLink.status,200);
const preferences={template:'soap',detail:'standard',headings:[],instructions:''};
  async function dispatch(jobId){const token=webcrypto.randomUUID()+webcrypto.randomUUID(),hash=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');const [{id}]=await sql.unsafe('insert into ehr.encounter_dispatch(job_id,token_hash) values($1::uuid,$2) returning id',[jobId,hash]);return {id,token};}
  async function stage(jobId){const d=await dispatch(jobId),claimed=await workerFns.claimDispatch(sql,d.id,d.token);if(claimed)await workerFns.processJob(sql,claimed,'ci-key');return claimed;}
  async function drive(jobId){for(let i=0;i<12;i++){let [j]=await sql`select * from ehr.encounter_job where id=${jobId}`;if(j.status!=='queued')return j;await sql`update ehr.encounter_job set available_at=now() where id=${jobId}`;await stage(jobId);}throw Error('Job did not settle');}
  async function prep(refresh=false){const q=await post({action:'prepare',patientId:'PT-002',encounterId:encounter.id,expectedVersion:encounter.version,preferences,refresh});if(q.status!==202)return q;const job=await drive(q.body.job.id);if(job.status==='superseded')return {status:409,body:{error:'preparation_source_changed'}};if(job.status==='failed')return {status:job.error_code==='patient_access_denied'?403:502,body:{error:job.error_code}};const [run]=await sql`select * from ehr.encounter_preparation where id=${job.preparation_id}`;return {status:200,body:{preparation:run}};}

  const countBefore=Number((await sql`select count(*) as n from ehr.patient_state where patient_id=${patientId}`)[0].n);
  let r=await prep();assert.equal(r.status,200,JSON.stringify(r));let run=r.body.preparation;assert.equal(run.status,'ready');assert.equal((await get()).body.preparation.current,true);assert.equal(Number((await sql`select count(*) as n from ehr.patient_state where patient_id=${patientId}`)[0].n),countBefore,'preparation never changes clinical state');
  let called=providerCalls;assert.equal((await prep()).body.preparation.id,run.id);assert.equal(providerCalls,called,'same source/profile preparation is idempotent');
  const original=run.packet.noteText;
  let body={patientId:'PT-002',preparationId:run.id,packetHash:run.packet_hash,reviewVersion:0,noteText:original+'\nPhysician retained edit',patientInstructions:'Discuss the documented plan with your clinical team.',observations:[],reviews:[],tools:[],actions:run.packet.actions.map((a,i)=>({actionId:a.id,decision:i?'rejected':'accepted'})),instructionsReviewed:true};
  assert.equal((await post({...body,action:'finalize',actions:[],idempotencyKey:webcrypto.randomUUID()})).body.error,'action_decisions_incomplete');
  assert.equal((await post({...body,action:'finalize',actions:run.packet.actions.map(a=>({actionId:a.id,decision:'pending'})),idempotencyKey:webcrypto.randomUUID()})).body.error,'action_review_required');
  assert.equal((await post({...body,action:'finalize',instructionsReviewed:false,idempotencyKey:webcrypto.randomUUID()})).body.error,'patient_instructions_review_required');
  r=await post({...body,action:'save-review'});assert.equal(r.status,200,JSON.stringify(r));body.reviewVersion=r.body.reviewVersion;
  assert.equal((await get()).body.preparation.edit.reviewed_snapshot.noteText,body.noteText,'physician edits survive reload');assert.equal((await post({...body,reviewVersion:0,action:'save-review'})).body.error,'review_edits_changed');
  const key=webcrypto.randomUUID(),final={...body,action:'finalize',idempotencyKey:key};
  authId='22222222-2222-4222-8222-222222222222';assert.equal((await post(final)).status,409);authId=principal;
  await sql`update iam.patient_assignment set active=false where principal_id=${principal} and patient_id=${patientId}`;assert.equal((await post(final)).status,403);await sql`update iam.patient_assignment set active=true where principal_id=${principal} and patient_id=${patientId}`;
  const beforeState=Number((await sql`select max(state_version) as v from ehr.patient_state where patient_id=${patientId}`)[0].v);
  r=await post(final);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.status,'finalized');const receipt=r.body.receiptId;
  const [approved]=await sql`select * from ehr.encounter_completion where id=${r.body.completionId}`;assert.equal(approved.status,'approved');assert.equal(approved.note_text,body.noteText);
  const tracked=await sql`select kind,status,label from ehr.encounter_completion_item where completion_id=${approved.id} order by kind`;assert.deepEqual(tracked.map(a=>[a.kind,a.status]),[['follow-up','rejected'],['lab','approved']]);
  assert.equal((await get()).body.receipt.reviewed_snapshot.actions.length,2,'signed actions survive reload');
  const history=await sql`select after_snapshot from ehr.encounter_completion_history where completion_id=${approved.id} order by version`;assert(history[0].after_snapshot.items.every(i=>i.status==='pending'));assert(history[1].after_snapshot.items.every(i=>i.status!=='pending'));
  assert.equal(Number(approved.source_state_version),beforeState+1,'clean visit gets a frozen signed state without a fabricated observation');
  const [audit]=await sql`select * from ehr.patient_state_audit where encounter_id=${encounter.id}`;assert.equal(Number(audit.previous_version),beforeState);assert.equal(Number(audit.resulting_version),beforeState+1);
  assert.equal((await post(final)).body.receiptId,receipt);assert.equal((await post({...final,noteText:'different'})).body.error,'approval_replay_mismatch');
  await assert.rejects(sql.unsafe("update ehr.encounter_approval_receipt set packet_hash='tamper' where id=$1::uuid",[receipt]),/approval_receipt_is_immutable/);
  await assert.rejects(sql.unsafe("update ehr.encounter_packet_edit set reviewed_snapshot='{}' where preparation_id=$1::uuid",[run.id]),/approval_receipt_is_immutable/);
  // A pending value is included only in the final physician-approved transaction.
  encounter=await draft();const [{id:po}]=await sql.unsafe("insert into ehr.proposed_observation(patient_id,encounter_id,field,display_label,observation_type,value_numeric,unit,source_text,status,client_record_id,confidence,certainty) values($1::uuid,$2::uuid,'Potassium','Potassium','Potassium',4.9,'mmol/L','Potassium 4.9 mmol/L.','pending',$3,'pattern-match-demo','proposed') returning id",[patientId,encounter.id,'v9-ci-potassium']);
  r=await prep();assert.equal(r.status,200,JSON.stringify(r));run=r.body.preparation;
  const edits=[{proposalId:po,decision:'edited',editedValue:4.8}];
  body={patientId:'PT-002',action:'finalize',preparationId:run.id,packetHash:run.packet_hash,reviewVersion:0,idempotencyKey:webcrypto.randomUUID(),noteText:run.packet.noteText,patientInstructions:'No new instructions documented.',observations:edits,reviews:[],tools:[],actions:run.packet.actions.map(a=>({actionId:a.id,decision:'accepted'})),instructionsReviewed:true};
  assert.equal((await post({...body,observations:[]})).body.error,'packet_decisions_incomplete');
  // Force a late completion insert failure; all clinical writes must roll back.
  await sql.unsafe("create function ehr.ci_block_completion() returns trigger language plpgsql as $$begin raise exception 'ci late failure'; end$$; create trigger ci_block_completion before insert on ehr.encounter_completion for each row execute function ehr.ci_block_completion();");
  const [{n:beforeEvents}]=await sql`select count(*)::int as n from ehr.event`;r=await post(body);assert.equal(r.status,500);assert.equal((await sql`select status from ehr.synthetic_encounter where id=${encounter.id}`)[0].status,'draft');assert.equal((await sql`select status from ehr.proposed_observation where id=${po}`)[0].status,'pending');assert.equal((await sql`select count(*)::int as n from ehr.event`)[0].n,beforeEvents,'late failure rolls back events and decisions');assert.equal((await sql`select count(*)::int as n from ehr.clinical_observation where client_record_id='v9-ci-potassium'`)[0].n,0);
  await sql.unsafe('drop trigger ci_block_completion on ehr.encounter_completion; drop function ehr.ci_block_completion();');
  r=await post(body);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.patient.labs.Potassium.value,4.8);assert.equal((await sql`select value_numeric from ehr.clinical_observation where client_record_id='v9-ci-potassium'`)[0].value_numeric,'4.8');
  // Stale and provider failures retain original sources and never sign.
  encounter=await draft();r=await prep();assert.equal(r.status,200);run=r.body.preparation;
  await sql`update ehr.synthetic_encounter set version=version+1 where id=${encounter.id}`;assert.equal((await get()).body.preparation.current,false);
  assert.equal((await post({...body,preparationId:run.id,packetHash:run.packet_hash,observations:[],idempotencyKey:webcrypto.randomUUID()})).body.error,'review_packet_changed_or_expired');
  encounter.version++;providerMode='fail';r=await prep();assert.equal(r.status,502);assert.equal((await get()).body.job.status,'failed');providerMode='ok';
  race=async()=>{await sql`update ehr.synthetic_encounter set version=version+1 where id=${encounter.id}`;};r=await prep(true);assert.equal(r.status,409);assert.equal(r.body.error,'preparation_source_changed');race=null;encounter.version++;
  race=async()=>{await sql`update iam.patient_assignment set active=false where principal_id=${principal} and patient_id=${patientId}`;};r=await prep();assert.equal(r.status,403);race=null;await sql`update iam.patient_assignment set active=true where principal_id=${principal} and patient_id=${patientId}`;
  r=await prep(true);assert.equal(r.status,200,JSON.stringify(r));run=r.body.preparation;
  // Expiry is enforced without allowing callers to edit immutable run fields.
  const expired=structuredClone(run);expired.id=webcrypto.randomUUID();expired.expires_at='2020-01-01T00:00:00Z';
  await sql.unsafe("insert into ehr.encounter_preparation(id,patient_id,encounter_id,clinician_principal_id,source_version,state_version,source_hash,preferences,source_snapshot,status,packet,packet_hash,expires_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::text::jsonb,$9::text::jsonb,'ready',$10::text::jsonb,$11,$12::timestamptz)",[expired.id,patientId,encounter.id,principal,run.source_version,run.state_version,run.source_hash,JSON.stringify(run.preferences),JSON.stringify(run.source_snapshot),JSON.stringify(run.packet),run.packet_hash,expired.expires_at]);
  assert.equal((await post({...body,preparationId:expired.id,packetHash:run.packet_hash,observations:[],idempotencyKey:webcrypto.randomUUID()})).body.error,'review_packet_changed_or_expired');
  assert.equal((await post({...body,patientId:'PT-003',observations:[],idempotencyKey:webcrypto.randomUUID()})).status,409);
  const [{canRead}]=await sql`select has_table_privilege('authenticated','ehr.encounter_preparation','select') as "canRead"`;assert.equal(canRead,false);
  const {default:parallelDriver}=await import(pathToFileURL(process.env.POSTGRES_DRIVER_PATH).href),parallelSql=parallelDriver(target.href,{prepare:false,max:2});
  try{await testDurableQueue({sql,parallelSql,principal,patientId,workerFns,draft,dispatch,stage,drive,get,post,preferences,setMode:mode=>providerMode=mode,getCalls:()=>providerCalls});}finally{await parallelSql.end();}
  console.log('v11 real driver: source-linked actions, pending/instruction gates, included/excluded completion items, before/after history, signed-action reload, authenticated assignment, read-only/idempotent preparation, exact source binding, durable edits, one-transaction signed completion, actual reducer/audit, clean visits, numeric edits, wrong patient/owner, revocation before/after provider, late rollback, replay mismatch, stale output, failure and expiry passed (provider mocked).');
}
