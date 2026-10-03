import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const shared=fs.readFileSync("supabase/functions/_shared/json-boundary.ts","utf8").replace(/^export /gm,"");
const helper=fs.readFileSync("supabase/functions/synthetic-encounter/encounter-review.ts","utf8").replace(/^import .*$/gm,"").replace(/^export /gm,"");
const context={console};
vm.createContext(context);
vm.runInContext(stripTypeScriptTypes(shared+"\n"+helper),context);
const {jsonObject,patientState,reviewAstra}=context;
assert.equal(jsonObject('{"systolic":128,"diastolic":74}').systolic,128);
for(const bad of [null,[],1,"null",JSON.stringify('{"id":"PT-001"}')])assert.throws(()=>jsonObject(bad));
assert.throws(()=>patientState({id:"PT-002"},"PT-001"),/identity_mismatch/);
assert.throws(()=>patientState({id:"PT-001",labs:"{}"},"PT-001"),/invalid_shape/);
assert.throws(()=>patientState({id:"PT-001",labs:[]},"PT-001"),/invalid_shape/);

// The deterministic census generator includes all 24 before the backend-only splice.
const fixture={window:{}};
vm.createContext(fixture);
vm.runInContext(fs.readFileSync("data.js","utf8").replace("patients.splice(backendOwnedIndex, 1)","void backendOwnedIndex")+"\nglobalThis.allPatients=patients;",fixture);
assert.equal(fixture.allPatients.length,24);
for(const patient of fixture.allPatients){
  const original=JSON.stringify(patient);
  const decoded=patientState(original,patient.id);
  assert.equal(JSON.stringify(decoded),original,patient.id+" JSONB read round trip");
  assert.equal(patientState(patient,patient.id),patient);
}

const patientId="22222222-2222-4222-8222-222222222222";
const encounterId="11111111-1111-4111-8111-111111111111";
const reviewId="33333333-3333-4333-8333-333333333333";
const runId="44444444-4444-4444-8444-444444444444";
let status="pending",stateVersion=1,writes=[],reduced=0,fresh=false,hasDraft=true,reviewed;
const generated={review:{summary:"Original generated synthetic summary",signals:[],limitations:[]},telemetry:{model:"gpt-6-astra",serviceTierActual:"ultrafast"}};
const tx={async unsafe(query,params){
  if(query.includes("from ehr.synthetic_encounter"))return hasDraft?[{id:encounterId}]:[];
  if(query.includes("from ehr.encounter_review"))return [{id:reviewId,run_id:runId,status,base_state_version:1,generated_content:JSON.stringify(generated)}];
  if(query.includes("select state_version,state::text"))return [{state_version:stateVersion,state_text:'{"id":"PT-001"}'}];
  if(query.includes("review_source_current"))return [{current:fresh}];
  if(query.startsWith("insert into ehr.event")){writes.push(params);return [{id:reviewId}];}
  if(query.startsWith("update ehr.encounter_review")){writes.push(params);reviewed=params[2]===null?null:JSON.parse(params[2]);return [];}
  if(query.includes("reduce_patient_state")){reduced++;return [{state_version:++stateVersion}];}
  if(query.includes("select state::text"))return [{state_text:JSON.stringify({id:"PT-001",...(reviewed?{approvedEncounterReview:{content:reviewed}}:{})})}];
  throw new Error("Unexpected query "+query);
}};
const person={id:patientId,externalId:"SYN-CLINICIAN-001"};
const base={encounterId,reviewId,decision:"edited",summary:"Physician-edited summary"};
await assert.rejects(reviewAstra(tx,patientId,"PT-001",person,{...base,summary:" "}),/invalid_review_summary/);
assert.equal(writes.length,0);
stateVersion=2;
await assert.rejects(reviewAstra(tx,patientId,"PT-001",person,base),/stale_agent_review/);
assert.equal(writes.length,0);
fresh=true;
const edited=await reviewAstra(tx,patientId,"PT-001",person,base);
assert.equal(edited.persisted,true);
assert.equal(edited.patient.approvedEncounterReview.content.summary,base.summary);
assert.equal(generated.review.summary,"Original generated synthetic summary");
assert.equal(reviewed.signals.length,0);
assert.equal(reduced,1);
status="edited";
await assert.rejects(reviewAstra(tx,patientId,"PT-001",person,base),/refresh_and_retry/);
assert.equal(reduced,1);
status="pending";fresh=false;
const rejected=await reviewAstra(tx,patientId,"PT-001",person,{...base,decision:"rejected"});
assert.equal(rejected.persisted,false);
assert.equal(reduced,1,"rejection cannot create a state version");
hasDraft=false;
await assert.rejects(reviewAstra(tx,patientId,"PT-001",person,base),/encounter_draft_not_found/);

// TypeScript syntax and deployment dependency consistency without network or secrets.
for(const name of ["scribe-review","ambient-scribe-write","workspace-review","synthetic-encounter","astra-review","patient-activity-audit"]){
  stripTypeScriptTypes(fs.readFileSync(`supabase/functions/${name}/index.ts`,"utf8"));
  assert.equal(fs.readFileSync(`supabase/functions/${name}/json-boundary.ts`,"utf8"),fs.readFileSync("supabase/functions/_shared/json-boundary.ts","utf8"));
}
console.log("Encounter State v4: 24 census JSON round trips, shape validation, physician edit/reject/stale/replay guards passed (mocked database).");
