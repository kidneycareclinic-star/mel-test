// Runs only against an isolated local CI database, using the deployed driver version.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { testFollowUpQueue } from "./follow-up-queue-driver-tests.mjs";

const target = new URL(process.env.ENCOUNTER_TEST_DB_URL || "http://missing");
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/encounter_jsonb_test",
  "This regression suite requires a disposable local encounter_jsonb_test database.");
const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_DRIVER_PATH).href);
const sql = postgres(target.href, { prepare: false, max: 1 });
let createdSchema = false;
try {
  // Prove the driver reproduces the production failure, rather than assuming JSON.parse.
  const sample = JSON.stringify([{ kind: "typed-note", title: "Synthetic", text: "quote \" and newline\n" }]);
  const broken = await sql.unsafe("select jsonb_typeof($1::jsonb) as kind", [sample]);
  assert.equal(broken[0].kind, "string", "the old JSONB parameter double-serializes JSON text");
  const fixed = await sql.unsafe("select jsonb_typeof($1::text::jsonb) as kind", [sample]);
  assert.equal(fixed[0].kind, "array");
  for (const value of [{ systolic: 126, diastolic: 72 }, 25, { summary: "Reviewed \"text\"\nwith an edit", signals: [] }, []]) {
    const result = await sql.unsafe("select $1::text::jsonb as value", [JSON.stringify(value)]);
    assert.deepEqual(result[0].value, value);
  }
  assert.equal((await sql.unsafe("select $1::text::jsonb as value", [null]))[0].value, null);

  await sql.unsafe("create schema ehr; create schema iam; create table iam.principal(id uuid primary key);");
  createdSchema = true;
  // Only the columns used by save/sign are needed. The production array constraint
  // is retained so the old writer fails here in exactly the reported way.
  await sql.unsafe(`
    create table ehr.patient (id uuid primary key default gen_random_uuid(), external_id text, synthetic boolean default true, active boolean default true);
    create table ehr.patient_state (patient_id uuid, state_version bigint, generated_at timestamptz default clock_timestamp(), source_event_id uuid default gen_random_uuid(), state jsonb check(jsonb_typeof(state)='object'), unique(patient_id,state_version));
    create table ehr.patient_state_audit (patient_id uuid, resulting_version bigint, resulting_state jsonb);
    create table ehr.synthetic_encounter (
      id uuid primary key default gen_random_uuid(), patient_id uuid, clinician_principal_id uuid,
      status text default 'draft', note_text text, sources jsonb constraint synthetic_encounter_sources_check check(jsonb_typeof(sources)='array'),
      base_state_version bigint, final_state_version bigint, version int default 1,
      draft_event_id uuid, signed_event_id uuid, created_at timestamptz default now(), updated_at timestamptz default now(), signed_at timestamptz);
    create table ehr.provenance (id uuid default gen_random_uuid(), patient_id uuid, source_kind text, source_label text, source_system text, actor_type text, actor_id text, certainty text, raw_payload jsonb);
    create table ehr.event (id uuid primary key default gen_random_uuid(), patient_id uuid, event_type text, actor_type text, actor_id text, source text, status text, causation_id uuid, provenance_id uuid, payload jsonb);
    create table ehr.encounter_review (patient_id uuid, encounter_id uuid, status text, reviewed_at timestamptz);
    create table ehr.tool_call (patient_id uuid, input jsonb, status text);
    create table ehr.proposed_observation (encounter_id uuid, patient_id uuid, status text, accepted_observation_id uuid, reviewed_at timestamptz default clock_timestamp());
  `);
  const principal = "11111111-1111-4111-8111-111111111111";
  await sql`insert into iam.principal(id) values(${principal})`;
  let handler;
  const source = fs.readFileSync("supabase/functions/synthetic-encounter/index.ts", "utf8")
    .replace(/^import .*$/gm, "")
    + "\n" + fs.readFileSync("supabase/functions/_shared/json-boundary.ts", "utf8").replace(/^export /gm, "")
    + "\n" + fs.readFileSync("supabase/functions/synthetic-encounter/encounter-review.ts", "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
  vm.runInNewContext(stripTypeScriptTypes(source), {
    postgres: () => sql,
    clinician: async () => ({ id: principal, externalId: "SYN-CI-CLINICIAN" }),
    patientAccess: async () => {}, authFailure: () => null,
    Deno: { env: { get: () => target.href }, serve: fn => { handler = fn; } },
    Headers, Response, URL, Date, Number, JSON, console, Set
  });
  async function post(body) {
    const res = await handler(new Request("https://example.test/encounter", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    }));
    return { status: res.status, body: await res.json() };
  }
  for (let i = 1; i <= 24; i++) {
    const externalId = "PT-" + String(i).padStart(3, "0");
    const [{ id }] = await sql`insert into ehr.patient(external_id) values(${externalId}) returning id`;
    await sql`insert into ehr.patient_state(patient_id,state_version,state) values(${id},1,${sql.json({ id: externalId })})`;
    const sources = [{ kind: "lab-trend", title: "eGFR trend", text: "Synthetic eGFR 25" },
      { kind: "typed-note", title: "Physician note", text: "Reviewed \"quote\"\nnext line", rawText: "Original" }];
    const base = { patientId: externalId, action: "save-draft", noteText: "Reviewed synthetic note", sources };
    const saved = await post(base);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const encounterId = saved.body.encounterId;
    const updated = await post({ ...base, encounterId, expectedVersion: 1, noteText: "Edited synthetic note" });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    const [{ sources: stored }] = await sql`select sources from ehr.synthetic_encounter where id=${encounterId}`;
    assert.equal(stored.length, 2);
    assert.equal(stored[1].text, sources[1].text);
    const signBody = { patientId: externalId, action: "sign", encounterId, expectedVersion: 2, expectedStateVersion: 2 };
    const blocked = await post(signBody);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, "physician_review_required");
    await sql`insert into ehr.proposed_observation(encounter_id,patient_id,status,accepted_observation_id) values(${encounterId},${id},'edited',gen_random_uuid())`;
    await sql`insert into ehr.patient_state(patient_id,state_version,state) values(${id},2,${sql.json({ id: externalId, labs: { eGFR: { value: 25 } } })})`;
    const signed = await post(signBody);
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.equal(signed.body.patient.labs.eGFR.value, 25);
    const [{ status, final_state_version }] = await sql`select status,final_state_version from ehr.synthetic_encounter where id=${encounterId}`;
    assert.equal(status, "signed");
    assert.equal(Number(final_state_version), 2);
    const provenance = await sql`select raw_payload from ehr.provenance where patient_id=${id}`;
    assert.equal(provenance.length, 3);
    for (const row of provenance) {
      assert.ok(Array.isArray(row.raw_payload.sources));
      assert.equal(row.raw_payload.sources[1].rawText, "Original");
    }
  }
  console.log("Real Postgres.js 3.4.7 + PostgreSQL: old failure reproduced; JSON types and 24 patient draft/create/update/review-gate/sign paths passed.");
  // Apply the actual v5 schema and run the actual handler against the driver.
  await sql.unsafe("create role anon; create role authenticated;");
  await sql.unsafe(fs.readFileSync("supabase/sql/encounter-completion-v5.sql","utf8"));
  let allow=true,currentPrincipal=principal;
  const completionSource=fs.readFileSync("supabase/functions/encounter-completion/index.ts","utf8").replace(/^import .*$/gm,"")
    +"\n"+fs.readFileSync("supabase/functions/encounter-completion/json-boundary.ts","utf8").replace(/^export /gm,"")
    +"\n"+fs.readFileSync("supabase/functions/encounter-completion/completion.ts","utf8").replace(/^import .*$/gm,"").replace(/^export /gm,"");
  vm.runInNewContext(stripTypeScriptTypes(completionSource),{
    postgres:()=>sql,
    clinician:async()=>({id:currentPrincipal,externalId:"SYN-CI-CLINICIAN"}),
    patientAccess:async(_,__,externalId)=>{if(!allow)throw Object.assign(new Error("patient_access_denied"),{status:403,code:"patient_access_denied"});return (await sql`select id from ehr.patient where external_id=${externalId}`)[0]?.id;},
    authFailure:error=>error.code==="patient_access_denied"?{status:error.status,code:error.code}:null,
    Deno:{env:{get:()=>target.href},serve:fn=>{handler=fn;}},Headers,Response,URL,Date,Number,JSON,console,Set
  });
  for(let i=1;i<=24;i++){
    const patientId="PT-"+String(i).padStart(3,"0");
    const [{id:patientUuid}]=await sql`select id from ehr.patient where external_id=${patientId}`;
    const [{id:encounterId}]=await sql`select id from ehr.synthetic_encounter where patient_id=${patientUuid}`;
    const requestBase={patientId,encounterId};
    allow=false;assert.equal((await post({...requestBase,action:"create"})).status,403);allow=true;
    currentPrincipal="22222222-2222-4222-8222-222222222222";
    assert.equal((await post({...requestBase,action:"create"})).status,404);currentPrincipal=principal;
    let result=await post({...requestBase,action:"create"});assert.equal(result.status,200,JSON.stringify(result.body));
    let view=result.body;assert.equal(view.package.source_state_version,"2");
    const original=structuredClone(view.package.generated_content);
    async function mutate(action,fields={}){
      const response=await post({...requestBase,expectedVersion:view.package.version,action,...fields});
      if(response.status===200)view=response.body;return response;
    }
    // Create is idempotent and does not create a second history record.
    assert.equal((await mutate("create")).body.history.length,1);
    assert.equal((await mutate("save",{noteText:"Physician-edited note for "+patientId,patientInstructions:"Plain instructions for "+patientId})).status,200);
    assert.equal((await post({...requestBase,action:"save",expectedVersion:1,noteText:"Stale",patientInstructions:"Stale"})).status,409);
    for(const kind of ["lab","medication","referral","follow-up"]){
      assert.equal((await mutate("add-item",{kind,label:kind+" synthetic draft",details:"Physician-entered details",dueDate:"2026-10-05"})).status,200);
    }
    assert.equal((await mutate("approve")).body.error,"completion_item_review_required");
    const itemIds=view.items.map(item=>item.id);
    for(let j=0;j<itemIds.length;j++)assert.equal((await mutate("decide-item",{itemId:itemIds[j],decision:j===0?"rejected":"approved"})).status,200);
    assert.equal((await mutate("resolve-item",{itemId:itemIds[3],decision:"completed",completionNote:"Too early"})).status,409);
    assert.equal((await mutate("approve")).status,200);
    assert.equal(view.package.status,"approved");
    assert.equal((await mutate("save",{noteText:"Cannot rewrite approval",patientInstructions:"No"})).status,409);
    assert.equal((await mutate("add-item",{kind:"lab",label:"Late order"})).status,409);
    assert.equal((await mutate("resolve-item",{itemId:itemIds[3],decision:"completed",completionNote:"Synthetic follow-up completed"})).status,200);
    assert.equal((await mutate("resolve-item",{itemId:itemIds[3],decision:"completed",completionNote:"Duplicate"})).status,409);
    assert.equal((await mutate("resolve-item",{itemId:itemIds[2],decision:"cancelled",completionNote:"Synthetic referral cancelled by physician"})).status,200);
    assert.deepEqual(view.package.generated_content,original);
    assert.equal(view.package.note_text,"Physician-edited note for "+patientId);
    assert.equal(view.history.length,13);
    assert.deepEqual(view.history.map(h=>h.version),Array.from({length:13},(_,j)=>13-j));
    assert.equal(view.history[0].before_snapshot.items.find(item=>item.id===itemIds[2]).status,"approved");
    assert.equal(view.history[0].after_snapshot.items.find(item=>item.id===itemIds[2]).status,"cancelled");
    const frozen=structuredClone(view.package.source_state);
    await sql`insert into ehr.patient_state(patient_id,state_version,state) values(${patientUuid},3,${sql.json({id:patientId,labs:{eGFR:{value:99}}})})`;
    const res=await handler(new Request("https://example.test/completion?patient_id="+patientId+"&encounter_id="+encounterId));
    assert.equal(res.status,200);view=await res.json();
    assert.deepEqual(view.package.source_state,frozen,"later state cannot alter this package");
    assert.equal(view.package.source_state.labs.eGFR.value,25);
    const [{count}]=await sql`select count(*)::int as count from ehr.patient_state where patient_id=${patientUuid}`;
    assert.equal(count,3,"completion must not reduce canonical Patient State");
    await assert.rejects(sql.unsafe("update ehr.encounter_completion set note_text='tamper',version=version+1 where id=$1::uuid",[view.package.id]),/approved_completion_is_immutable/);
    await assert.rejects(sql.unsafe("update ehr.encounter_completion_history set action='tamper' where completion_id=$1::uuid",[view.package.id]),/completion_history_is_immutable/);
  }
  const [{canRead,canWrite}]=await sql`select has_table_privilege('authenticated','ehr.encounter_completion','select') as "canRead",has_table_privilege('anon','ehr.encounter_completion_item','insert') as "canWrite"`;
  assert.equal(canRead,false);assert.equal(canWrite,false);
  console.log("Encounter Completion v5: 24 real-driver packages, draft edits, item approvals/rejections, package signoff, completion/cancellation, stale/replay/access guards, frozen snapshots, immutable history and private-table grants passed.");
  await testFollowUpQueue(sql,principal,target,post);
} finally {
  if (createdSchema) await sql.unsafe("drop schema ehr cascade; drop schema iam cascade;");
  await sql.end();
}
