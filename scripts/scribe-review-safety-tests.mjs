import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const source = fs.readFileSync("supabase/functions/scribe-review/index.ts", "utf8")
  .replace('import { jsonObject, patientState } from "./json-boundary.ts";', fs.readFileSync("supabase/functions/_shared/json-boundary.ts","utf8").replace(/^export /gm,""))
  .replace('import postgres from "npm:postgres@3.4.7";', "const postgres = globalThis.__mockPostgres;")
  .replace('import { clinician, patientAccess, authFailure } from "./clinician-auth.ts";',
    'const { clinician, patientAccess, authFailure } = globalThis.__mockAuth;');
const patientId = "PT-001";
const proposalId = "11111111-1111-4111-8111-111111111111";
let handler;
let writes = 0;
let state = "pending";
let proposedField = "eGFR";
let savedMetadata;
let canonicalType;
let serializedBp=false;

const tx = {
  async unsafe(query, params) {
    if (/select id,synthetic from ehr.patient/.test(query)) return [{ id: patientId, synthetic: true }];
    if (/select \* from ehr.proposed_observation/.test(query)) return [{
      id: proposalId, status: state, field: proposedField,
      value_numeric: proposedField === "eGFR" ? 30 : null,
      value_json: proposedField === "bloodPressure" ? (serializedBp?JSON.stringify({ systolic: 128, diastolic: 74 }):{ systolic: 128, diastolic: 74 }) : null,
      unit: "mL/min/1.73m²", display_label: "eGFR", observed_at: "2026-09-28T00:00:00Z"
    }];
    if (/^insert|^update/i.test(query)) {
      writes++;
      if (/insert into ehr.clinical_observation/.test(query)) canonicalType = params[1];
      if (/update ehr.proposed_observation/.test(query)) savedMetadata = params;
      return [{ id: "event" }];
    }
    if (/select ehr.reduce_patient_state/.test(query)) return [{ state_version: 2 }];
    if (/select state::text/.test(query)) return [{ state_text: JSON.stringify({ id: patientId }) }];
    if (/from ehr.proposed_observation where patient_id/.test(query)) return [];
    throw new Error("Unexpected SQL: " + query);
  }
};
const sql = { begin: async fn => fn(tx) };
const sandbox = {
  __mockPostgres: () => sql,
  __mockAuth: {
    clinician: async () => ({ id: "demo", externalId: "synthetic-clinician" }),
    patientAccess: async () => patientId,
    authFailure: () => null
  },
  Deno: { env: { get: () => "mock-db" }, serve: fn => { handler = fn; } },
  Headers, Response, URL, console
};
vm.runInNewContext(stripTypeScriptTypes(source), sandbox, { filename: "scribe-review/index.ts" });

async function review(decisions) {
  const request = new Request("https://example.org/functions/v1/scribe-review", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId, decisions })
  });
  const response = await handler(request);
  return { status: response.status, body: await response.json() };
}

const blank = await review([{ proposalId, decision: "edited", editedValue: " " }]);
assert.equal(blank.status, 400);
assert.match(blank.body.error, /blank numeric value/);
assert.equal(writes, 0, "a blank edit must not create an event");

const hexadecimal = await review([{ proposalId, decision: "edited", editedValue: "0x10" }]);
assert.equal(hexadecimal.status, 400);
assert.equal(writes, 0, "a nondecimal edit must not create an event");

const duplicate = await review([
  { proposalId, decision: "rejected" }, { proposalId, decision: "accepted" }
]);
assert.equal(duplicate.status, 400);
assert.equal(writes, 0, "duplicate decisions must not create an event");

state = "accepted";
const stale = await review([{ proposalId, decision: "rejected" }]);
assert.equal(stale.status, 409);
assert.match(stale.body.error, /refresh_and_retry/);
assert.equal(writes, 0, "a stale review must not create an event");

state = "pending";
const accepted = await review([{ proposalId, decision: "edited", editedValue: 25 }]);
assert.equal(accepted.status, 200);
assert.equal(accepted.body.canonicalInserted, 1);
assert.equal(accepted.body.stateVersion, 2);
assert.equal(JSON.parse(savedMetadata[5]), 30, "original value must be preserved");
assert.equal(JSON.parse(savedMetadata[6]), 25, "edited value must be preserved");

proposedField = "bloodPressure";
const bloodPressure = await review([{ proposalId, decision: "accepted" }]);
assert.equal(bloodPressure.status, 200);
assert.equal(canonicalType, "BloodPressure", "accepted BP must match the Patient State reducer's observation type");

serializedBp=true;
const serializedBloodPressure=await review([{proposalId,decision:"edited",editedValue:{systolic:126,diastolic:72}}]);
assert.equal(serializedBloodPressure.status,200);
assert.deepEqual(JSON.parse(savedMetadata[5]),{systolic:128,diastolic:74});
assert.deepEqual(JSON.parse(savedMetadata[6]),{systolic:126,diastolic:72});
console.log("Scribe review safety tests passed, including serialized JSONB blood pressure edits");

