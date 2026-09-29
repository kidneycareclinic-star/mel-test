import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const source = fs.readFileSync("supabase/functions/synthetic-encounter/index.ts", "utf8")
  .replace('import postgres from "npm:postgres@3.4.7";', "const postgres = globalThis.__mockPostgres;")
  .replace('import { clinician, patientAccess, authFailure } from "./clinician-auth.ts";',
    "const { clinician, patientAccess, authFailure } = globalThis.__mockAuth;");
const encounterId="11111111-1111-4111-8111-111111111111";
const patientUuid="22222222-2222-4222-8222-222222222222";
let handler, allowed=true, accepted=0, pending=1, stateVersion=1, writes=0, signed=false;
let draft=null;
let signProvenanceId=null;
const db={
  async unsafe(query,params){
    if(query.includes("from ehr.patient where external_id"))return [{id:patientUuid}];
    if(query.includes("from ehr.synthetic_encounter where patient_id")&&query.includes("status='draft'"))return draft && !signed ? [{...draft}]:[];
    if(query.includes("from ehr.synthetic_encounter where patient_id")&&query.includes("status='signed'"))return [];
    if(query.includes("from ehr.patient_state where patient_id")&&query.includes("state_version desc"))return [{state_version:stateVersion,generated_at:new Date("2026-09-30T00:00:00Z"),source_event_id:patientUuid}];
    if(query.includes("from ehr.proposed_observation where encounter_id"))return [{total:accepted+pending,pending,accepted,last_review:"2026-09-29T00:00:00Z"}];
    if(query.startsWith("insert into ehr.synthetic_encounter")){
      writes++;
      draft={id:encounterId,patient_id:patientUuid,clinician_principal_id:patientUuid,status:"draft",note_text:params[2],sources:JSON.parse(params[3]),base_state_version:1,version:1};
      return [{id:encounterId}];
    }
    if(query.startsWith("update ehr.synthetic_encounter set note_text")){
      writes++;draft.note_text=params[1];draft.sources=JSON.parse(params[2]);draft.version++;return [];
    }
    if(query.startsWith("update ehr.synthetic_encounter set status")){writes++;signed=true;return [];}
    if(query.startsWith("update ehr.synthetic_encounter set draft_event_id")){writes++;return [];}
    if(query.startsWith("insert into ehr.provenance")){writes++;return [{id:"33333333-3333-4333-8333-333333333333"}];}
    if(query.startsWith("insert into ehr.event")){
      writes++;
      if(query.includes("ENCOUNTER_SIGNED"))signProvenanceId=params[3];
      return [{id:"44444444-4444-4444-8444-444444444444"}];
    }
    throw new Error("Unexpected SQL: "+query);
  },
  begin:async fn=>fn(db)
};
const sandbox={
  __mockPostgres:()=>db,
  __mockAuth:{
    clinician:async()=>({id:patientUuid,externalId:"SYN-CLINICIAN-001"}),
    patientAccess:async()=>{if(!allowed)throw Object.assign(new Error("patient_access_denied"),{status:403,code:"patient_access_denied"});return patientUuid;},
    authFailure:error=>error.code?{status:error.status,code:error.code}:null
  },
  Deno:{env:{get:()=>"mock-db"},serve:fn=>{handler=fn;}},
  Headers,Response,URL,Date,Number,JSON,console,Set
};
vm.runInNewContext(stripTypeScriptTypes(source),sandbox);
async function post(body){
  const req=new Request("https://example.test/functions/v1/synthetic-encounter-gated",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const res=await handler(req);return {status:res.status,body:await res.json()};
}
const base={patientId:"PT-001",action:"save-draft",noteText:"Synthetic review note",sources:[{kind:"typed-note",title:"Source",text:"eGFR 30"}]};
allowed=false;
assert.equal((await post(base)).status,403);
assert.equal(writes,0,"denied clinician must not write");
allowed=true;
const created=await post(base);
assert.equal(created.status,200);
assert.equal(created.body.encounterId,encounterId);
assert.equal(draft.sources[0].text,"eGFR 30");
const stale=await post({...base,encounterId,expectedVersion:99});
assert.equal(stale.status,409,JSON.stringify(stale.body));
const beforeSign=writes;
const notReviewed=await post({patientId:"PT-001",action:"sign",encounterId,expectedVersion:1});
assert.equal(notReviewed.status,409);
assert.equal(writes,beforeSign,"unreviewed encounter must not create a sign event");
accepted=1;pending=0;stateVersion=2;
const signedResult=await post({patientId:"PT-001",action:"sign",encounterId,expectedVersion:1});
assert.equal(signedResult.status,200);
assert.equal(signedResult.body.stateVersion,2);
assert.equal(signed,true);
assert.equal(signProvenanceId,"33333333-3333-4333-8333-333333333333","sign event must reference provenance, not a draft event");
assert.equal((await post({patientId:"PT-001",action:"sign",encounterId,expectedVersion:1})).status,409);
console.log("Synthetic encounter review tests passed");
