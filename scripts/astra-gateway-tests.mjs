import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const gateway = fs.readFileSync("supabase/functions/astra-review/index.ts", "utf8");
const review = fs.readFileSync("supabase/functions/workspace-review/index.ts", "utf8");
const ui = fs.readFileSync("workspace-review-ui.js", "utf8");
const preview = fs.readFileSync("preview/workspace-review-ui.js", "utf8");

assert(gateway.includes('const MODEL = "gpt-6-astra"'), "Astra model must be explicit");
assert(gateway.includes('const SERVICE_TIER = "ultrafast"'), "Ultrafast tier must be explicit");
assert(gateway.includes('Deno.env.get("OPENAI_API_KEY")'), "OpenAI key must come from server-side secret");
assert(!gateway.includes("sk-"), "No OpenAI secret may be committed");
assert(gateway.includes('store: false'), "Synthetic review requests must disable OpenAI storage");
assert(gateway.includes('"json_schema"'), "Astra output must use strict structured JSON");
assert(gateway.includes('"awaiting_approval"'), "Astra proposals must require physician approval");
assert(gateway.includes("sql.json(inputSnapshot)"), "Agent input_snapshot must bind a JavaScript object as JSONB");
assert(gateway.includes("tx.json(completedOutput)"), "Agent output must bind a JavaScript object as JSONB");
assert(gateway.includes("tx.json(completedEventPayload)"), "Event payload must bind a JavaScript object as JSONB");
assert(gateway.includes("tx.json(toolInput)"), "Tool input must bind a JavaScript object as JSONB");
assert(!gateway.includes("typed(JSON.stringify"), "JSONB writes must not double-stringify through typed parameters");
assert(gateway.includes("testApprovalPath"), "Synthetic approval-path exercise must be explicit");
assert(gateway.includes("Synthetic Astra approval-path verification"), "Approval-path exercise must be clearly test-only");
assert(gateway.includes("baseStateVersion"), "Astra proposal must capture source Patient State version");
assert(gateway.includes("ultrafastVerified"), "Gateway must report whether Ultrafast was actually served");
assert(gateway.includes("openaiRequestId"), "Gateway must persist OpenAI request ID for audit");
assert(gateway.includes("patientAccess(sql, person"), "Gateway must enforce clinician patient access");
assert(gateway.includes('"agent.review"'), "Gateway must require agent.review permission");
assert(review.includes("stale_agent_proposal"), "Approval path must reject stale Astra proposals");
assert(ui.includes("/functions/v1/astra-review-gated"), "UI must call clinician-gated Astra endpoint");
assert(ui.includes("Astra Ultrafast"), "UI must expose explicit Astra test control");
assert(ui.includes("Astra Approval Test"), "UI must expose explicit physician-approval exercise");
assert(ui.includes("testApprovalPath"), "UI approval exercise must call the explicit synthetic test path");
assert(ui.includes("Ultrafast verified"), "UI must surface tier verification");
assert(ui === preview, "published preview Astra UI must match protected root UI");

console.log("Astra gateway safety tests passed");

const data = fs.readFileSync("data.js", "utf8");
const previewData = fs.readFileSync("preview/data.js", "utf8");
assert(data.includes('"Polycystic kidney disease": { stage: "3b", eGFR: [30, 44] }'), "PKD fixture must separate diagnosis from CKD stage");
assert(data === previewData, "published preview synthetic data must match root data");
