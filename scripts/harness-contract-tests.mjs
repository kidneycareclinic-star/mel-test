import fs from "node:fs";
import vm from "node:vm";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const index = fs.readFileSync("index.html", "utf8");
const prechart = fs.readFileSync("prechart-workspace.js", "utf8");
const loader = fs.readFileSync("backend-patient-loader.js", "utf8");
const authUi = fs.readFileSync("clinician-auth-ui.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const review = fs.readFileSync("scribe-review-ui.js", "utf8");
const agents = fs.readFileSync("workspace-review-ui.js", "utf8");
const prep = fs.readFileSync("workflow-prep-ui.js", "utf8");
const data = fs.readFileSync("data.js", "utf8");

// GitHub Pages serves /preview/ rather than the root app. Keep every gateway
// entry point identical so the published preview enforces the same sign-in.
for (const filename of [
  "index.html", "clinician-auth-ui.js", "clinician-auth-ui.css",
  "activity-audit-ui.js", "app.js", "backend-patient-loader.js",
  "prechart-workspace.js", "scribe-review-ui.js", "workspace-review-ui.js",
  "workflow-prep-ui.js", "encounter-workflow-ui.js", "encounter-workflow-ui.css"
]) {
  assert(fs.readFileSync(`preview/${filename}`, "utf8") === fs.readFileSync(filename, "utf8"),
    `published preview ${filename} must match the protected app`);
}

assert(index.includes("scribe-review-ui.js"), "scribe review UI must be loaded");
assert(index.includes("clinician-auth-ui.js"), "clinician sign-in UI must load before the census");
assert(index.includes("encounter-workflow-ui.js"), "encounter review controls must load");
assert(index.includes("encounter-workflow-ui.css"), "encounter review controls need styling");
assert(index.indexOf("clinician-auth-ui.js") < index.indexOf("backend-patient-loader.js"), "sign-in must load before the census loader");
assert(loader.includes("CLINICIAN_AUTH.ready"), "census loading must wait for sign-in");
assert(app.includes("CLINICIAN_AUTH.isSignedIn()"), "workspace rendering must require a clinician session");
assert(!loader.includes("ANON_JWT"), "the census loader must not use a public token as clinician identity");
assert(authUi.includes("/auth/v1/token?grant_type=password"), "sign-in must contact the configured Auth project");
assert(index.includes("workspace-review-ui.js"), "workspace review UI must be loaded");
assert(index.includes("Recognized discrete values are PROPOSED"), "scribe UI must describe proposal-first workflow");
assert(!index.includes("auto-applies recognized discrete values"), "old auto-apply language must not return");

assert(prechart.includes("/functions/v1/ambient-scribe-write"), "ambient writer endpoint missing");
assert(prechart.includes("for physician review"), "ambient writer must report proposal workflow");
assert(!/persistAmbientExtractions[\s\S]{0,4000}replacePatientFromBackend\(patientId, payload\)/.test(prechart),
  "ambient proposal writer must not directly replace canonical Patient State");

assert(review.includes("/functions/v1/scribe-review"), "scribe review endpoint missing");
assert(review.includes('decision:"accepted"') || review.includes('"accepted"'), "scribe review must support acceptance");
assert(review.includes('"rejected"'), "scribe review must support rejection");
assert(review.includes('"edited"'), "scribe review must support edited acceptance");

assert(agents.includes("/functions/v1/workspace-review"), "workspace review endpoint missing");
assert(agents.includes("CKD review"), "CKD review UI missing");
assert(agents.includes("Dialysis review"), "dialysis review UI missing");
assert(agents.includes("Hospital review"), "hospital review UI missing");
assert(prep.includes("prepare_followup_lab_order"), "lab preparation workflow missing");
assert(prep.includes("prepare_followup_appointment"), "appointment preparation workflow missing");
assert(prep.includes("external execution disabled"), "preparation workflow must declare no external execution");

assert(loader.includes("/functions/v1/synthetic-census"), "PostgreSQL census loader missing");
assert(prechart.includes("encounterId:encounterId"), "scribe proposals must link to a saved encounter");
assert(review.includes("encounter_id="), "scribe review must filter by encounter");
assert(!loader.includes("service_role"), "frontend must never expose service-role credentials");

const sandbox = { console, structuredClone, window: null };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(data, sandbox, { filename: "data.js" });
assert(Array.isArray(sandbox.PATIENTS), "data.js must expose PATIENTS");
assert(sandbox.PATIENTS.length === 23, "browser bootstrap should contain 23 patients after backend-owned PT-001 removal");
const ids = sandbox.PATIENTS.map((p) => p.id);
assert(new Set(ids).size === ids.length, "synthetic bootstrap patient IDs must be unique");
assert(!ids.includes("PT-001"), "PT-001 must remain backend-owned");

console.log("Harness contract tests passed");
