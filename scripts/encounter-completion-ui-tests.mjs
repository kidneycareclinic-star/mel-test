import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const {JSDOM}=await import(pathToFileURL(process.env.DOM_TEST_MODULE).href);
const dom=new JSDOM('<!doctype html><html><body><div class="identity-actions"></div><section class="prechart-panel"></section></body></html>',{url:"https://example.test/preview/",runScripts:"outside-only"});
const w=dom.window,d=w.document;
w.currentPatient={id:"PT-001"};
w.SUPABASE_DEMO_BACKEND={baseUrl:"https://synthetic.test",anonJwt:"synthetic-test-session"};
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
w.HTMLDialogElement.prototype.close=function(){this.open=false;};
Object.defineProperty(w.navigator,"clipboard",{value:{writeText:async()=>{}}});
const encounterIds=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];
const packages=new Map(encounterIds.map((id,i)=>[id,{id:"package-"+i,encounter_id:id,version:1,status:"draft",source_state_version:i+2,note_text:"Saved note "+i,patient_instructions:"Saved instructions "+i,generated_content:{noteText:"Original note "+i,patientInstructions:"Original instructions "+i}}]));
const items=new Map(encounterIds.map(id=>[id,[]]));let addFailure=false,saveStale=false,requests=[];
function view(id){return structuredClone({encounters:encounterIds.map((e,i)=>({id:e,signed_at:"2026-10-04T13:55:28Z",final_state_version:i+2,completion_status:packages.get(e).status})),selectedEncounter:{id,sourceStateVersion:packages.get(id).source_state_version},package:packages.get(id),items:items.get(id),history:[]});}
w.fetch=async(url,options)=>{
  if(url.includes('/note-drafting-gated')){const input=JSON.parse(options.body);return {ok:true,json:async()=>({patientId:input.patientId,encounterId:input.encounterId,sourceVersion:input.expectedVersion,noteText:'Custom reviewed note',reviewFlags:[]})};}
  const values=options.body?JSON.parse(options.body):null;requests.push(values||{action:"get"});
  const id=values?.encounterId||new URL(url).searchParams.get("encounter_id")||encounterIds[0];
  const p=packages.get(id);let status=200,error;
  if(values){
    assert.equal(values.patientId,"PT-001");assert.equal(values.expectedVersion,p.version,"UI must send the current package revision");
    if(values.action==="save"){
      if(saveStale){status=409;error="completion_version_changed";}
      else{p.note_text=values.noteText;p.patient_instructions=values.patientInstructions;p.version++;}
    }else if(values.action==="format-soap"){p.note_text="S — SUBJECTIVE\n"+p.note_text+"\nO — OBJECTIVE\nA — ASSESSMENT\nP — PLAN";p.version++;}
    else if(values.action==="add-item"){
      if(addFailure){status=500;error="completion_unavailable";}
      else{items.get(id).push({id:"item-1",kind:values.kind,label:values.label,details:values.details,due_date:values.dueDate,status:"pending",simulated:true});p.version++;}
    }else if(values.action==="decide-item"){items.get(id)[0].status=values.decision;p.version++;}
    else if(values.action==="approve"){p.status="approved";p.approved_by_id="Synthetic clinician";p.approved_at="2026-10-04T14:00:00Z";p.version++;}
    else if(values.action==="resolve-item"){items.get(id)[0].status=values.decision;items.get(id)[0].completion_note=values.completionNote;items.get(id)[0].resolved_at="2026-10-04T14:01:00Z";p.version++;}
  }
  return {ok:status===200,status,json:async()=>status===200?view(id):{error}};
};
w.SYNTHETIC_NOTE_DRAFTING_ENABLED=true;w.eval(fs.readFileSync("note-drafting-ui.js","utf8"));
w.eval(fs.readFileSync("encounter-completion-ui.js","utf8"));
async function settle(){for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,5));if(!d.querySelector("#completionClose")?.disabled)return;}throw Error("UI remained busy");}
function button(label){const b=Array.from(d.querySelectorAll("button")).find(b=>b.textContent===label);assert.ok(b,"Missing button "+label);return b;}
async function click(label){button(label).click();await settle();}
function field(label){const l=Array.from(d.querySelectorAll("label")).find(l=>l.firstChild?.textContent===label);assert.ok(l,"Missing field "+label);return l.querySelector("input,textarea,select");}
assert.equal(d.querySelector(".identity-actions #openVisitCompletionBtn").textContent,"Visit completion");
await click("Visit completion");assert.equal(d.querySelector("#completionNote").value,"Saved note 0");
d.querySelector("#completionNote").value="Physician edited note";
await click("Save package draft");assert.equal(packages.get(encounterIds[0]).note_text,"Physician edited note");
await click("Generate with my template");assert.ok(d.querySelector('.note-draft-preview'));assert.equal(d.querySelector('#completionNote').value,'Physician edited note','generation cannot silently replace clinician note');
await click("Apply reviewed draft to note");assert.equal(d.querySelector('#completionNote').value,'Custom reviewed note');await click("Save package draft");assert.equal(packages.get(encounterIds[0]).note_text,'Custom reviewed note');
await click("Apply SOAP draft");assert.ok(d.querySelector("#completionNote").value.includes("P — PLAN"));
field("Order or follow-up label").value='<img src=x onerror="alert(1)">';
field("Details entered by physician").value="Synthetic details to retain on failure";
d.querySelector("#completionNote").value="Edited before add failure";
addFailure=true;await click("Add draft");
assert.equal(field("Order or follow-up label").value,'<img src=x onerror="alert(1)">');
assert.equal(d.querySelector("#completionNote").value,"Edited before add failure");
assert.ok(d.querySelector("#completionStatus").classList.contains("is-error"));
addFailure=false;await click("Add draft");assert.equal(d.querySelectorAll("img").length,0,"item labels must render as text");
await click("Approve draft");await click("Approve visit package");
assert.equal(d.querySelector("#completionNote").readOnly,true);
assert.equal(d.querySelector("#completionInstructions").readOnly,true);
field("Completion or cancellation note").value="Simulated test completed";await click("Mark simulated complete");
assert.equal(items.get(encounterIds[0])[0].status,"completed");
const selector=d.querySelector("#completionEncounter");selector.value=encounterIds[1];selector.dispatchEvent(new w.Event("change"));await settle();
assert.equal(d.querySelector("#completionNote").value,"Saved note 1","changing encounters must not copy another visit's note");
d.querySelector("#completionNote").value="Unsaved second visit";saveStale=true;await click("Save package draft");
assert.equal(d.querySelector("#completionNote").value,"Unsaved second visit");
saveStale=false;packages.get(encounterIds[1]).version++;packages.get(encounterIds[1]).note_text="New server revision";
await click("Refresh package");assert.equal(d.querySelector("#completionNote").value,"New server revision","refresh must load the authoritative saved revision");
d.querySelector("#completionNote").value="Saved on close";
await click("×");assert.equal(packages.get(encounterIds[1]).note_text,"Saved on close");
assert.equal(d.querySelector("dialog").open,false);
await w.ENCOUNTER_COMPLETION_UI.open(encounterIds[1]);await settle();
assert.equal(selector.value,encounterIds[1],"queue navigation must select the requested signed visit");
assert.ok(requests.some(r=>r.action==="approve")&&requests.some(r=>r.action==="resolve-item"));
w.SYNTHETIC_NOTE_DRAFTING_ENABLED=false;await click("Refresh package");assert.equal(button("Generate with my template").disabled,true,"disabled generation must remain disabled after withBusy renders new controls");
dom.window.close();
console.log("Visit completion DOM: edits, failed-request retention, current revisions, approval, simulation tracking, stale refresh, visit isolation, and safe rendering passed.");
