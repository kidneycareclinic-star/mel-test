import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const helper=fs.readFileSync("supabase/functions/encounter-completion/completion.ts","utf8").replace(/^import .*$/gm,"").replace(/^export /gm,"");
const boundary=fs.readFileSync("supabase/functions/encounter-completion/json-boundary.ts","utf8").replace(/^export /gm,"");
const context={console,Date,Number,JSON,Set};vm.createContext(context);
vm.runInContext(stripTypeScriptTypes(boundary+"\n"+helper+"\nglobalThis.api={buildContent,completionMutation};"),context);
const fixtures={window:{}};vm.createContext(fixtures);
vm.runInContext(fs.readFileSync("data.js","utf8").replace("patients.splice(backendOwnedIndex, 1)","void backendOwnedIndex")+"\nglobalThis.fixtures=patients;",fixtures);
assert.equal(fixtures.fixtures.length,24);
for(const p of fixtures.fixtures){
  p.approvedEncounterReview={encounterId:"signed-fixture",content:{summary:"Physician-approved synthetic plan for "+p.id}};
  const source={id:"signed-fixture",state_text:JSON.stringify(p),signed_at:"2026-10-04T13:55:28Z",note_text:"Signed source note"};
  const generated=context.api.buildContent(source,p.id);
  assert.ok(generated.noteText.includes("Signed source note"));
  assert.ok(generated.noteText.includes(p.approvedEncounterReview.content.summary));
  assert.ok(generated.patientInstructions.includes(p.id));
  assert.equal(generated.externalExecution,false);
  assert.ok(generated.noteText.length<=60000&&generated.patientInstructions.length<=40000);
  const otherVisit=context.api.buildContent({...source,id:"later-visit"},p.id);
  assert.ok(!otherVisit.noteText.includes(p.approvedEncounterReview.content.summary),"a prior visit's narrative must not be presented as the current plan");
}
assert.throws(()=>context.api.buildContent({state_text:'{"id":"PT-002"}',signed_at:new Date(),note_text:""},"PT-001"),/identity_mismatch/);
const patient="11111111-1111-4111-8111-111111111111",encounter="22222222-2222-4222-8222-222222222222";
let writes=0;
const tx={unsafe:async(query)=>{
  if(query.startsWith("select e.id,e.note_text"))return [{id:encounter,state_text:'{"id":"PT-001"}',signed_event_id:patient,final_state_version:1}];
  if(query.startsWith("select * from ehr.encounter_completion"))return [{id:patient,encounter_id:encounter,status:"draft",version:3,note_text:"Note",patient_instructions:"Instructions",source_state_version:1}];
  if(query.startsWith("select id,kind,label"))return [];
  writes++;throw Error("Unexpected write");
}};
const base={encounterId:encounter,expectedVersion:3,action:"add-item",kind:"lab",label:"Physician-entered test",details:"Synthetic"};
for(const dueDate of ["2026-99-99","2026-02-30","bad"]){await assert.rejects(context.api.completionMutation(tx,patient,"PT-001",{id:patient}, {...base,dueDate}),/invalid_due_date/);}
await assert.rejects(context.api.completionMutation(tx,patient,"PT-001",{id:patient},{...base,expectedVersion:2}),/completion_version_changed/);
await assert.rejects(context.api.completionMutation(tx,patient,"PT-001",{id:patient},{...base,kind:"external-prescription"}),/invalid_item_kind/);
assert.equal(writes,0,"invalid and stale requests must not write");
assert.equal(fs.readFileSync("supabase/functions/encounter-completion/clinician-auth.ts","utf8"),fs.readFileSync("supabase/functions/_shared/clinician-auth.ts","utf8"));
assert.doesNotMatch(helper,/\$\d+::jsonb/);
assert.doesNotMatch(helper,/reduce_patient_state|fetch\(/,"completion does not mutate clinical state or execute external requests");
console.log("Encounter Completion v5: 24 source drafts, identity, stale version, date, item type, and shared-auth checks passed.");
