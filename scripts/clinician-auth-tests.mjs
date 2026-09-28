import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const names = ["synthetic-census", "ambient-scribe-write", "scribe-review", "workspace-review", "patient-activity-audit"];
const shared = fs.readFileSync("supabase/functions/_shared/clinician-auth.ts", "utf8");
for (const name of names) {
  assert.equal(fs.readFileSync(`supabase/functions/${name}/clinician-auth.ts`, "utf8"), shared);
  assert.match(fs.readFileSync(`supabase/functions/${name}/index.ts`, "utf8"), /from "\.\/clinician-auth\.ts"/);
}

const src = stripTypeScriptTypes(shared.replace(/\bexport (class|async function|function|type)\b/g, "$1")) +
  "\nglobalThis.__auth = { clinician, patientAccess, censusAccess };";
let tokenIsValid = false;
let linked = true;
let assigned = true;
const audits = [];
const sandbox = {
  Deno: { env: { get: name => name === "SUPABASE_URL" ? "https://synthetic.supabase.co" : "public-key" } },
  fetch: async () => tokenIsValid ? new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200 }) : new Response("{}", { status: 401 }),
  AbortSignal, Response, Error, Set
};
vm.runInNewContext(src, sandbox);
const { clinician, patientAccess, censusAccess } = sandbox.__auth;
const req = new Request("https://synthetic.supabase.co/functions/v1/synthetic-census", {
  headers: { Authorization: "Bearer synthetic-session" }
});
const conn = {
  async unsafe(query, params) {
    if (query.includes("from iam.principal")) return linked ? [{ id: "22222222-2222-4222-8222-222222222222", external_id: "SYN-CLINICIAN-001" }] : [];
    if (query.includes("select id::text from ehr.patient")) return [{ id: "33333333-3333-4333-8333-333333333333" }];
    if (query.includes("select p.external_id")) return assigned ? [{ external_id: "PT-001", state: { id: "PT-001" } }] : [];
    if (query.includes("select pm.role")) return assigned ? [{ role: "physician" }] : [];
    if (query.includes("insert into iam.access_audit")) { audits.push(params); return []; }
    throw Error("Unexpected SQL: " + query);
  }
};

await assert.rejects(clinician(req, conn), e => e.status === 401);
tokenIsValid = true;
linked = false;
await assert.rejects(clinician(req, conn), e => e.status === 403);
linked = true;
const person = await clinician(req, conn);
assigned = false;
await assert.rejects(patientAccess(conn, person, "PT-001", "office", "scribe.review"), e => e.status === 403);
assert.equal(audits.at(-1)[4], false, "denied access must be audited");
assigned = true;
assert.equal(await patientAccess(conn, person, "PT-001", "office", "scribe.review"), "33333333-3333-4333-8333-333333333333");
assert.equal(audits.at(-1)[4], true, "granted access must be audited");
assert.equal((await censusAccess(conn, person)).length, 1);
console.log("Clinician access tests passed");
