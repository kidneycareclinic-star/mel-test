import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("clinician-auth-ui.js", "utf8");
async function runScenario(authStatus, censusStatus, fragment = "") {
  const classes = new Set();
  const callbacks = {};
  const requests = [];
  const button = { disabled: false };
  const form = {
    elements: { email: { value: "clinician@example.test" }, password: { value: "example-password" } },
    querySelector: () => button,
    addEventListener: (_, callback) => { callbacks.submit = callback; }
  };
  const setupForm = {
    hidden: true,
    elements: { password: { value: "test-password-12345" }, confirmation: { value: "test-password-12345" } },
    querySelector: () => ({ disabled: false }),
    addEventListener: (_, callback) => { callbacks.setup = callback; }
  };
  const nodes = {
    clinicianSignInForm: form,
    clinicianPasswordSetupForm: setupForm,
    clinicianSignInStatus: { textContent: "" },
    clinicianSignIn: { hidden: false },
    clinicianSignOut: { addEventListener: (_, callback) => { callbacks.signOut = callback; } }
  };
  const replaced = [];
  const window = {
    location: { reload: () => {}, hash: fragment, pathname: "/preview", search: "" },
    history: { replaceState: (_, __, url) => replaced.push(url) }
  };
  const document = {
    getElementById: name => nodes[name],
    documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } }
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/auth/v1/token")) {
      return new Response(JSON.stringify(authStatus === 200 ? { access_token: "user-token" } : {}), { status: authStatus });
    }
    if (url.endsWith("/auth/v1/user")) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify(censusStatus === 200 ? { patients: [{ id: "PT-001" }] } : { error: "denied" }), { status: censusStatus });
  };
  vm.runInNewContext(source, { window, document, fetch, console, URLSearchParams });
  if (!fragment) await callbacks.submit({ preventDefault() {}, currentTarget: form });
  return { window, nodes, classes, requests, callbacks, replaced };
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
const invited = await runScenario(200, 200, "#type=invite&access_token=temporary-invite-token");
assert.equal(invited.nodes.clinicianSignInForm.hidden, true);
assert.equal(invited.nodes.clinicianPasswordSetupForm.hidden, false);
assert.deepEqual(invited.replaced, ["/preview"]);
await invited.callbacks.setup({ preventDefault() {}, currentTarget: invited.nodes.clinicianPasswordSetupForm });
assert.equal(invited.requests[0].url.endsWith("/auth/v1/user"), true);
assert.equal(invited.requests[0].options.headers.Authorization, "Bearer temporary-invite-token");
assert.equal(invited.nodes.clinicianSignInForm.hidden, false);
assert.equal(invited.window.CLINICIAN_AUTH.isSignedIn(), false);
console.log("Clinician sign-in UI tests passed");
