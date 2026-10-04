// Runs only against an isolated local CI database, using the deployed driver version.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

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

  await sql.unsafe("create schema ehr");
  createdSchema = true;
  // Only the columns used by save/sign are needed. The production array constraint
  // is retained so the old writer fails here in exactly the reported way.
  await sql.unsafe(`
    create table ehr.patient (id uuid primary key default gen_random_uuid(), external_id text, synthetic boolean default true, active boolean default true);
    create table ehr.patient_state (patient_id uuid, state_version bigint, generated_at timestamptz default clock_timestamp(), source_event_id uuid default gen_random_uuid(), state jsonb check(jsonb_typeof(state)='object'));
    create table ehr.synthetic_encounter (
      id uuid primary key default gen_random_uuid(), patient_id uuid, clinician_principal_id uuid,
      status text default 'draft', note_text text, sources jsonb constraint synthetic_encounter_sources_check check(jsonb_typeof(sources)='array'),
      base_state_version bigint, final_state_version bigint, version int default 1,
      draft_event_id uuid, signed_event_id uuid, created_at timestamptz default now(), updated_at timestamptz default now(), signed_at timestamptz);
    create table ehr.provenance (id uuid default gen_random_uuid(), patient_id uuid, source_kind text, source_label text, source_system text, actor_type text, actor_id text, certainty text, raw_payload jsonb);
    create table ehr.event (id uuid default gen_random_uuid(), patient_id uuid, event_type text, actor_type text, actor_id text, source text, status text, causation_id uuid, provenance_id uuid, payload jsonb);
    create table ehr.encounter_review (patient_id uuid, encounter_id uuid, status text, reviewed_at timestamptz);
    create table ehr.tool_call (patient_id uuid, input jsonb, status text);
    create table ehr.proposed_observation (encounter_id uuid, patient_id uuid, status text, accepted_observation_id uuid, reviewed_at timestamptz default clock_timestamp());
  `);
  const principal = "11111111-1111-4111-8111-111111111111";
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
} finally {
  if (createdSchema) await sql.unsafe("drop schema ehr cascade");
  await sql.end();
}
