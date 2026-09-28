import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("clinician-auth-ui.js", "utf8");
async function runScenario(authStatus, censusStatus) {
  const classes = new Set();
  const callbacks = {};
  const requests = [];
  const button = { disabled: false };
  const form = {
    elements: { email: { value: "clinician@example.test" }, password: { value: "example-password" } },
    querySelector: () => button,
    addEventListener: (_, callback) => { callbacks.submit = callback; }
  };
  const nodes = {
    clinicianSignInForm: form,
    clinicianSignInStatus: { textContent: "" },
    clinicianSignIn: { hidden: false },
    clinicianSignOut: { addEventListener: (_, callback) => { callbacks.signOut = callback; } }
  };
  const window = { location: { reload: () => {} } };
  const document = {
    getElementById: name => nodes[name],
    documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } }
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/auth/v1/token")) {
      return new Response(JSON.stringify(authStatus === 200 ? { access_token: "user-token" } : {}), { status: authStatus });
    }
    return new Response(JSON.stringify(censusStatus === 200 ? { patients: [{ id: "PT-001" }] } : { error: "denied" }), { status: censusStatus });
  };
  vm.runInNewContext(source, { window, document, fetch, console });
  await callbacks.submit({ preventDefault() {}, currentTarget: form });
  return { window, nodes, classes, requests };
}

const invalid = await runScenario(401, 200);
assert.equal(invalid.window.CLINICIAN_AUTH.isSignedIn(), false);
assert.equal(invalid.requests.length, 1);
assert.equal(invalid.nodes.clinicianSignIn.hidden, false);

const unassigned = await runScenario(200, 403);
assert.equal(unassigned.window.CLINICIAN_AUTH.isSignedIn(), false);
assert.equal(unassigned.nodes.clinicianSignIn.hidden, false);

const assigned = await runScenario(200, 200);
assert.equal(await assigned.window.CLINICIAN_AUTH.ready, "user-token");
assert.equal(assigned.window.SUPABASE_DEMO_BACKEND.anonJwt, "user-token");
assert.equal(assigned.requests[0].options.body.includes("example-password"), true);
assert.equal(assigned.requests[1].options.headers.Authorization, "Bearer user-token");
assert.equal(assigned.nodes.clinicianSignIn.hidden, true);
console.log("Clinician sign-in UI tests passed");
